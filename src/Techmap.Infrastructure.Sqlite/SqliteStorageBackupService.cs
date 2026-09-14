using System.Globalization;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using Microsoft.Win32.SafeHandles;
using Techmap.Application;
using Techmap.Domain;

namespace Techmap.Infrastructure.Sqlite;

public sealed class SqliteStorageBackupService : IStorageBackupService, IDisposable
{
    public const int ManifestFormat = 1;
    public const string ManifestFileName = "manifest.json";
    public const string ManifestChecksumFileName = "manifest.sha256";
    public const string ProductId = "TECHMAP-GRAPHER";
    public const int MaximumManifestBytes = 16 * 1024 * 1024;
    public const int MaximumBackupFileCount = 100_001;
    public const long MaximumBackupFileBytes = 2L * 1024 * 1024 * 1024;
    public const long MaximumBackupTotalBytes = 100L * 1024 * 1024 * 1024;
    private const string StagingDirectoryName = ".staging";
    private const string DatabaseFileName = "app.db";
    private const int BufferSize = 128 * 1024;
    private const uint FileFlagBackupSemantics = 0x02000000;
    private const uint FileReadAttributes = 0x0080;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true,
    };

    private readonly string dataRoot;
    private readonly string databasePath;
    private readonly TimeProvider timeProvider;
    private readonly Action<string>? progressHook;
    private readonly SemaphoreSlim backupGate = new(1, 1);
    private int disposed;

    public SqliteStorageBackupService(
        string dataRoot,
        string databasePath,
        TimeProvider? timeProvider = null,
        Action<string>? progressHook = null)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(dataRoot);
        ArgumentException.ThrowIfNullOrWhiteSpace(databasePath);
        this.dataRoot = ResolveCanonicalExistingPath(dataRoot, expectDirectory: true);
        this.databasePath = ResolveCanonicalExistingPath(databasePath, expectDirectory: false);
        if (!IsSameOrDescendant(this.dataRoot, this.databasePath))
        {
            throw new ArgumentException("The SQLite database must be inside the data root.", nameof(databasePath));
        }

        this.timeProvider = timeProvider ?? TimeProvider.System;
        this.progressHook = progressHook;
    }

    public async Task<StorageBackupResult> CreateAsync(
        StorageBackupRequest request,
        CancellationToken cancellationToken = default) =>
        await CreateCoreAsync(request, null, cancellationToken).ConfigureAwait(false)
        ?? throw new InvalidOperationException("An unconditional backup was unexpectedly skipped.");

    public Task<StorageBackupResult?> CreateIfChangedAsync(
        StorageBackupRequest request,
        string? previousDatabaseSha256,
        CancellationToken cancellationToken = default) =>
        CreateCoreAsync(request, previousDatabaseSha256, cancellationToken);

    private async Task<StorageBackupResult?> CreateCoreAsync(
        StorageBackupRequest request,
        string? previousDatabaseSha256,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        ValidateAppVersion(request.AppVersion);
        ObjectDisposedException.ThrowIf(Volatile.Read(ref disposed) != 0, this);
        await backupGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            ObjectDisposedException.ThrowIf(Volatile.Read(ref disposed) != 0, this);
            RejectLexicalOverlap(dataRoot, request.BackupRoot);
            using var backupRootLease = DataRootLease.Acquire(request.BackupRoot);
            var backupRoot = backupRootLease.CanonicalPath;
            RejectPhysicalOverlap(dataRoot, backupRoot);
            var stagingRoot = CreateOrdinaryDirectory(Path.Combine(backupRoot, StagingDirectoryName));
            var backupId = Guid.NewGuid();
            var createdUtc = timeProvider.GetUtcNow().ToUniversalTime();
            var stagingPath = Path.Combine(stagingRoot, $"{backupId:N}.staging");
            var publishedPath = Path.Combine(
                backupRoot,
                ExpectedBackupDirectoryName(createdUtc, backupId));

            try
            {
                Directory.CreateDirectory(stagingPath);
                RejectReparsePoint(stagingPath, "A backup staging directory must not be a reparse point.");
                var snapshotPath = Path.Combine(stagingPath, DatabaseFileName);
                CreateOnlineSnapshot(snapshotPath);
                FlushExistingFile(snapshotPath);
                progressHook?.Invoke("after_database_snapshot");

                var snapshot = InspectSnapshot(snapshotPath);
                var databaseEntry = await HashExistingFileAsync(
                    DatabaseFileName, snapshotPath, cancellationToken).ConfigureAwait(false);
                if (request.Kind == StorageBackupKind.Regular &&
                    previousDatabaseSha256 is not null &&
                    string.Equals(databaseEntry.Sha256, previousDatabaseSha256, StringComparison.Ordinal))
                {
                    foreach (var blob in snapshot.Blobs)
                    {
                        await VerifySourceBlobAsync(blob, cancellationToken).ConfigureAwait(false);
                    }

                    return null;
                }

                var files = new List<BackupFileEntry>
                {
                    databaseEntry,
                };
                foreach (var blob in snapshot.Blobs)
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    var relativePath = $"attachments/blobs/{blob.Sha256[..2]}/{blob.Sha256}";
                    var sourcePath = Path.Combine(
                        dataRoot,
                        "attachments",
                        "blobs",
                        blob.Sha256[..2],
                        blob.Sha256);
                    var destinationPath = Path.Combine(
                        stagingPath,
                        "attachments",
                        "blobs",
                        blob.Sha256[..2],
                        blob.Sha256);
                    files.Add(await CopyVerifiedAsync(
                        relativePath,
                        sourcePath,
                        destinationPath,
                        blob.SizeBytes,
                        blob.Sha256,
                        cancellationToken).ConfigureAwait(false));
                }

                var manifest = new BackupManifest(
                    ManifestFormat,
                    ProductId,
                    backupId,
                    FormatKind(request.Kind),
                    request.AppVersion,
                    request.PreviousAppVersion,
                    snapshot.SchemaVersion,
                    createdUtc,
                    snapshot.ProjectRevisions,
                    files.OrderBy(file => file.Path, StringComparer.Ordinal).ToArray());
                var manifestBytes = JsonSerializer.SerializeToUtf8Bytes(manifest, JsonOptions);
                var manifestHash = Convert.ToHexStringLower(SHA256.HashData(manifestBytes));
                WriteDurableNewFile(Path.Combine(stagingPath, ManifestFileName), manifestBytes);
                WriteDurableNewFile(
                    Path.Combine(stagingPath, ManifestChecksumFileName),
                    Encoding.ASCII.GetBytes($"{manifestHash}\n"));
                progressHook?.Invoke("before_publish");
                cancellationToken.ThrowIfCancellationRequested();
                var verifiedStaging = ReadVerifiedBackup(stagingPath, requirePublishedName: false);
                if (verifiedStaging.Result.BackupId != backupId)
                {
                    throw new InvalidDataException("The staged backup identity changed during verification.");
                }

                cancellationToken.ThrowIfCancellationRequested();
                StorageGenerationLayout.MoveNewDurably(stagingPath, publishedPath);

                var database = files.Single(file => file.Path == DatabaseFileName);
                return new StorageBackupResult(
                    backupId,
                    publishedPath,
                    request.Kind,
                    createdUtc,
                    snapshot.SchemaVersion,
                    manifestHash,
                    database.Sha256,
                    database.SizeBytes,
                    snapshot.Blobs.Count,
                    snapshot.ProjectRevisions);
            }
            catch (Exception error) when (
                error is not StorageBackupException and not OperationCanceledException)
            {
                throw new StorageBackupException(
                    "backup_failed",
                    "The backup could not be published.",
                    error);
            }
            finally
            {
                TryDeleteOwnedStaging(stagingPath, stagingRoot);
            }
        }
        finally
        {
            backupGate.Release();
        }
    }

    public IReadOnlyList<StorageBackupResult> ApplyRetention(string backupRoot, int maximumBackups)
    {
        if (maximumBackups < 3)
        {
            throw new ArgumentOutOfRangeException(
                nameof(maximumBackups),
                "Retention must preserve the newest successful, pre-update and pre-restore backups.");
        }

        ObjectDisposedException.ThrowIf(Volatile.Read(ref disposed) != 0, this);
        RejectLexicalOverlap(dataRoot, backupRoot);
        backupGate.Wait();
        try
        {
            using var backupRootLease = DataRootLease.Acquire(backupRoot);
            RejectPhysicalOverlap(dataRoot, backupRootLease.CanonicalPath);
            var backups = ReadPublishedBackups(backupRootLease.CanonicalPath)
                .OrderByDescending(backup => backup.CreatedUtc)
                .ThenByDescending(backup => backup.BackupId)
                .ToArray();
            var keep = new HashSet<Guid>();
            if (backups.Length > 0)
            {
                keep.Add(backups[0].BackupId);
            }

            var newestPreUpdate = backups.FirstOrDefault(backup => backup.Kind == StorageBackupKind.PreUpdate);
            if (newestPreUpdate is not null)
            {
                keep.Add(newestPreUpdate.BackupId);
            }

            var newestPreRestore = backups.FirstOrDefault(backup => backup.Kind == StorageBackupKind.PreRestore);
            if (newestPreRestore is not null)
            {
                keep.Add(newestPreRestore.BackupId);
            }

            foreach (var backup in backups)
            {
                if (keep.Count >= maximumBackups)
                {
                    break;
                }

                keep.Add(backup.BackupId);
            }

            foreach (var backup in backups
                         .Where(backup => !keep.Contains(backup.BackupId))
                         .OrderBy(backup => backup.CreatedUtc)
                         .ThenBy(backup => backup.BackupId))
            {
                ValidateGeneratedBackupDirectory(backupRootLease.CanonicalPath, backup.BackupPath);
                ValidateNoReparseEntries(backup.BackupPath);
                Directory.Delete(backup.BackupPath, recursive: true);
            }

            return backups.Where(backup => keep.Contains(backup.BackupId)).ToArray();
        }
        finally
        {
            backupGate.Release();
        }
    }

    public void Dispose()
    {
        if (Interlocked.Exchange(ref disposed, 1) == 0)
        {
            backupGate.Dispose();
        }
    }

    private void CreateOnlineSnapshot(string destinationPath)
    {
        if (!File.Exists(databasePath))
        {
            throw new FileNotFoundException("The active SQLite database does not exist.", databasePath);
        }

        RejectReparsePoint(databasePath, "The active SQLite database must not be a reparse point.");
        using var source = new SqliteConnection(new SqliteConnectionStringBuilder
        {
            DataSource = databasePath,
            Mode = SqliteOpenMode.ReadOnly,
            Cache = SqliteCacheMode.Private,
            Pooling = false,
        }.ToString());
        using var destination = new SqliteConnection(new SqliteConnectionStringBuilder
        {
            DataSource = destinationPath,
            Mode = SqliteOpenMode.ReadWriteCreate,
            Cache = SqliteCacheMode.Private,
            Pooling = false,
        }.ToString());
        source.Open();
        destination.Open();
        source.BackupDatabase(destination);
        using var useDeleteJournal = destination.CreateCommand();
        useDeleteJournal.CommandText = "PRAGMA journal_mode = DELETE;";
        useDeleteJournal.ExecuteNonQuery();
    }

    internal static SnapshotInventory InspectSnapshot(string snapshotPath)
    {
        using var connection = new SqliteConnection(new SqliteConnectionStringBuilder
        {
            DataSource = snapshotPath,
            Mode = SqliteOpenMode.ReadOnly,
            Cache = SqliteCacheMode.Private,
            Pooling = false,
        }.ToString());
        connection.Open();
        using (var integrity = connection.CreateCommand())
        {
            integrity.CommandText = "PRAGMA integrity_check;";
            if (!string.Equals(Convert.ToString(integrity.ExecuteScalar(), CultureInfo.InvariantCulture), "ok", StringComparison.Ordinal))
            {
                throw new InvalidDataException("The SQLite backup failed integrity_check.");
            }
        }

        using (var foreignKeys = connection.CreateCommand())
        {
            foreignKeys.CommandText = "PRAGMA foreign_key_check;";
            using var reader = foreignKeys.ExecuteReader();
            if (reader.Read())
            {
                throw new InvalidDataException("The SQLite backup failed foreign_key_check.");
            }
        }

        var schemaVersion = SqliteStorage.ValidateSchema(connection);
        if (schemaVersion >= 7)
        {
            ValidateReferenceCatalog(connection);
        }

        if (schemaVersion >= 10)
        {
            ValidateComponentTemplates(connection);
        }

        var revisions = new List<StorageBackupProjectRevision>();
        if (schemaVersion >= 2)
        {
            if (!HasTable(connection, "projects"))
            {
                throw new InvalidDataException("The SQLite backup has no projects table.");
            }

            using var projects = connection.CreateCommand();
            projects.CommandText = schemaVersion >= 4
                ? "SELECT project_id, revision FROM projects ORDER BY project_id;"
                : "SELECT project_id, 0 FROM projects ORDER BY project_id;";
            using var reader = projects.ExecuteReader();
            while (reader.Read())
            {
                if (!Guid.TryParseExact(reader.GetString(0), "D", out var projectId) || reader.GetInt64(1) < 0)
                {
                    throw new InvalidDataException("The SQLite backup contains an invalid project revision.");
                }

                revisions.Add(new StorageBackupProjectRevision(
                    projectId, reader.GetInt64(1)));
            }
        }

        var blobs = new List<SnapshotBlob>();
        if (schemaVersion >= 3)
        {
            if (!HasTable(connection, "project_attachments") || !HasTable(connection, "attachment_blobs"))
            {
                throw new InvalidDataException("The SQLite backup has incomplete attachment tables.");
            }

            using var attachments = connection.CreateCommand();
            attachments.CommandText =
                """
                SELECT DISTINCT b.content_sha256, b.size_bytes
                FROM project_attachments pa
                JOIN attachment_blobs b ON b.content_sha256 = pa.content_sha256
                ORDER BY b.content_sha256;
                """;
            using var reader = attachments.ExecuteReader();
            while (reader.Read())
            {
                var sha256 = reader.GetString(0);
                var sizeBytes = reader.GetInt64(1);
                if (!IsSha256(sha256) || sizeBytes < 0)
                {
                    throw new InvalidDataException("The SQLite backup contains an invalid attachment reference.");
                }

                blobs.Add(new SnapshotBlob(sha256, sizeBytes));
            }
        }

        return new SnapshotInventory(schemaVersion, revisions, blobs);
    }

    private static void ValidateComponentTemplates(SqliteConnection connection)
    {
        using (var heads = connection.CreateCommand())
        {
            heads.CommandText =
                """
                SELECT COUNT(*)
                FROM component_templates h
                LEFT JOIN component_template_versions v
                  ON v.template_id = h.template_id AND v.version = h.current_version
                WHERE v.template_id IS NULL
                   OR h.current_version < 1
                   OR h.current_version > 100
                   OR h.current_code <> v.code
                   OR h.current_name <> v.name
                   OR h.updated_utc < h.created_utc
                   OR (h.deleted_utc IS NOT NULL AND h.deleted_utc < h.created_utc);
                """;
            if (Convert.ToInt32(heads.ExecuteScalar(), CultureInfo.InvariantCulture) != 0)
                throw new InvalidDataException("The SQLite backup has an invalid component template head.");
        }

        using (var metadata = connection.CreateCommand())
        {
            metadata.CommandText = "SELECT template_id, current_code, normalized_code FROM component_templates;";
            using var reader = metadata.ExecuteReader();
            while (reader.Read())
            {
                var id = reader.GetString(0);
                var code = reader.GetString(1);
                var normalized = reader.GetString(2);
                if (!string.Equals(normalized, code.ToUpperInvariant(), StringComparison.Ordinal))
                    throw new InvalidDataException($"Component template '{id}' has invalid normalized metadata.");
            }
        }

        using (var limits = connection.CreateCommand())
        {
            limits.CommandText =
                """
                SELECT
                    (SELECT CASE WHEN COUNT(*) > 500 THEN 1 ELSE 0 END
                     FROM component_templates WHERE deleted_utc IS NULL)
                    +
                    (SELECT COUNT(*) FROM component_templates h
                     WHERE h.current_version <> (
                         SELECT COUNT(*) FROM component_template_versions v
                         WHERE v.template_id = h.template_id));
                """;
            if (Convert.ToInt32(limits.ExecuteScalar(), CultureInfo.InvariantCulture) != 0)
                throw new InvalidDataException("The SQLite backup has an invalid component template version sequence.");
        }

        using (var bindings = connection.CreateCommand())
        {
            bindings.CommandText =
                """
                SELECT COUNT(*)
                FROM component_template_versions v
                WHERE (SELECT COUNT(*) FROM component_template_article_bindings b
                       WHERE b.template_id = v.template_id AND b.version = v.version) > 64
                   OR EXISTS (
                       SELECT 1 FROM component_template_article_bindings b
                       WHERE b.template_id = v.template_id AND b.version = v.version
                       GROUP BY b.template_id, b.version
                       HAVING MIN(b.binding_ordinal) <> 0
                          OR MAX(b.binding_ordinal) <> COUNT(*) - 1);
                """;
            if (Convert.ToInt32(bindings.ExecuteScalar(), CultureInfo.InvariantCulture) != 0)
                throw new InvalidDataException("The SQLite backup has invalid component template bindings.");
        }

        var versions = new List<ComponentTemplateBackupHeader>();
        using (var command = connection.CreateCommand())
        {
            command.CommandText =
                """
                SELECT v.template_id, v.version, v.schema_version, v.code, v.name,
                       v.content_json, v.content_sha256, v.version_sha256, v.created_utc,
                       h.created_utc, h.updated_utc, h.deleted_utc
                FROM component_template_versions v
                JOIN component_templates h ON h.template_id = v.template_id
                ORDER BY v.template_id, v.version;
                """;
            using var reader = command.ExecuteReader();
            while (reader.Read())
            {
                versions.Add(new ComponentTemplateBackupHeader(
                    reader.GetString(0), reader.GetInt32(1), reader.GetInt32(2),
                    reader.GetString(3), reader.GetString(4), reader.GetString(5),
                    reader.GetString(6), reader.GetString(7), reader.GetString(8),
                    reader.GetString(9), reader.GetString(10),
                    reader.IsDBNull(11) ? null : reader.GetString(11)));
            }
        }

        foreach (var stored in versions)
        {
            var templateId = stored.TemplateId;
            var version = stored.Version;
            var schemaVersion = stored.SchemaVersion;
            var code = stored.Code;
            var name = stored.Name;
            var content = stored.ContentJson;
            var hash = stored.ContentSha256;
            var versionHash = stored.VersionSha256;
            if (!Guid.TryParseExact(templateId, "D", out var parsedId) || parsedId == Guid.Empty ||
                version is < 1 or > SqliteComponentTemplateStore.MaximumVersionsPerTemplate ||
                schemaVersion != SqliteComponentTemplateStore.CurrentContentSchemaVersion ||
                string.IsNullOrWhiteSpace(code) || code.Length > 128 || code.Any(char.IsControl) ||
                string.IsNullOrWhiteSpace(name) || name.Length > 256 || name.Any(char.IsControl) ||
                !IsSha256(hash) || !IsSha256(versionHash) ||
                !IsCanonicalUtc(stored.VersionCreatedUtc) ||
                !IsCanonicalUtc(stored.TemplateCreatedUtc) ||
                !IsCanonicalUtc(stored.UpdatedUtc) ||
                stored.DeletedUtc is not null && !IsCanonicalUtc(stored.DeletedUtc))
            {
                throw new InvalidDataException($"Component template '{templateId}' has invalid persisted metadata.");
            }

            string canonical;
            try
            {
                canonical = SqliteComponentTemplateStore.ValidateAndCanonicalizeContent(content, schemaVersion);
            }
            catch (ComponentTemplateException error)
            {
                throw new InvalidDataException($"Component template '{templateId}' has invalid content.", error);
            }
            var actualHash = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(content)));
            var persistedBindings = new List<ComponentTemplateArticleBinding>();
            using (var bindingCommand = connection.CreateCommand())
            {
                bindingCommand.CommandText =
                    """
                    SELECT source_id, entity_type, article_key
                    FROM component_template_article_bindings
                    WHERE template_id = $templateId AND version = $version
                    ORDER BY binding_ordinal;
                    """;
                bindingCommand.Parameters.AddWithValue("$templateId", templateId);
                bindingCommand.Parameters.AddWithValue("$version", version);
                using var bindingReader = bindingCommand.ExecuteReader();
                while (bindingReader.Read())
                {
                    persistedBindings.Add(new ComponentTemplateArticleBinding(
                        bindingReader.GetString(0), bindingReader.GetString(1), bindingReader.GetString(2)));
                }
            }
            var actualVersionHash = SqliteComponentTemplateStore.ComputeVersionHash(
                parsedId, version, schemaVersion, code, name, persistedBindings, content);
            if (!string.Equals(content, canonical, StringComparison.Ordinal) ||
                !string.Equals(hash, actualHash, StringComparison.Ordinal) ||
                !string.Equals(versionHash, actualVersionHash, StringComparison.Ordinal))
            {
                throw new InvalidDataException($"Component template '{templateId}' has corrupt canonical content.");
            }
        }
    }

    private static bool IsCanonicalUtc(string value) =>
        DateTimeOffset.TryParseExact(
            value,
            "O",
            CultureInfo.InvariantCulture,
            DateTimeStyles.RoundtripKind,
            out var parsed) &&
        string.Equals(
            parsed.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture),
            value,
            StringComparison.Ordinal);

    private static void ValidateReferenceCatalog(SqliteConnection connection)
    {
        using (var heads = connection.CreateCommand())
        {
            heads.CommandText =
                """
                SELECT COUNT(*)
                FROM reference_source_heads h
                LEFT JOIN reference_snapshots r
                  ON r.source_id = h.source_id AND r.snapshot_id = h.snapshot_id
                WHERE r.snapshot_id IS NULL OR r.lifecycle_status <> 'published';
                """;
            if (Convert.ToInt32(heads.ExecuteScalar(), CultureInfo.InvariantCulture) != 0)
            {
                throw new InvalidDataException("The SQLite backup has an invalid active reference snapshot.");
            }
        }

        var headers = new List<ReferenceSnapshotHeader>();
        using (var command = connection.CreateCommand())
        {
            command.CommandText =
                """
                SELECT r.snapshot_id, s.source_key, s.source_kind, r.snapshot_sequence,
                       r.contract_version, r.source_version, r.source_content_sha256,
                       r.snapshot_metadata_sha256, r.canonical_content_sha256,
                       r.provenance_json, r.lifecycle_status, r.captured_utc
                FROM reference_snapshots r
                JOIN reference_sources s ON s.source_id = r.source_id
                ORDER BY r.snapshot_id;
                """;
            using var reader = command.ExecuteReader();
            while (reader.Read())
            {
                headers.Add(new ReferenceSnapshotHeader(
                    reader.GetString(0),
                    reader.GetString(1),
                    reader.GetString(2),
                    reader.GetInt64(3),
                    reader.GetInt32(4),
                    reader.GetString(5),
                    reader.GetString(6),
                    reader.GetString(7),
                    reader.IsDBNull(8) ? null : reader.GetString(8),
                    reader.GetString(9),
                    reader.GetString(10),
                    reader.GetString(11)));
            }
        }

        foreach (var header in headers)
        {
            if (!Guid.TryParseExact(header.SnapshotId, "D", out var snapshotId) || snapshotId == Guid.Empty ||
                !IsSha256(header.SourceContentSha256) ||
                !IsSha256(header.MetadataSha256) ||
                header.Lifecycle == "draft" && header.CanonicalContentSha256 is not null ||
                header.Lifecycle != "draft" &&
                    (header.CanonicalContentSha256 is null || !IsSha256(header.CanonicalContentSha256)))
            {
                throw new InvalidDataException(
                    $"Reference snapshot '{header.SnapshotId}' has invalid persisted hashes.");
            }

            ReferenceCatalogProvenance provenance;
            try
            {
                provenance = JsonSerializer.Deserialize<ReferenceCatalogProvenance>(header.ProvenanceJson, JsonOptions)
                    ?? throw new JsonException("The reference provenance is null.");
            }
            catch (JsonException error)
            {
                throw new InvalidDataException(
                    $"Reference snapshot '{header.SnapshotId}' has invalid provenance JSON.",
                    error);
            }

            if (!string.Equals(header.SourceKind, provenance.SourceKind, StringComparison.Ordinal) ||
                !string.Equals(header.SourceVersion, provenance.VersionFingerprint, StringComparison.Ordinal) ||
                !string.Equals(
                    header.SourceContentSha256,
                    SqliteReferenceCatalogSnapshotStore.SourceContentHash(provenance.VersionFingerprint),
                    StringComparison.Ordinal) ||
                !string.Equals(
                    header.MetadataSha256,
                    SqliteReferenceCatalogSnapshotStore.HashSnapshotMetadata(
                        new ReferenceCatalogSnapshotIdentity(snapshotId),
                        header.SourceKey,
                        header.Sequence,
                        header.ContractVersion,
                        header.SourceVersion,
                        header.SourceContentSha256,
                        header.ProvenanceJson,
                        header.CapturedUtc),
                    StringComparison.Ordinal))
            {
                throw new InvalidDataException(
                    $"Reference snapshot '{header.SnapshotId}' has corrupt persisted metadata.");
            }

            var records = ReadReferenceRecords(connection, header.SnapshotId);
            var diagnostics = ReadReferenceDiagnostics(connection, header.SnapshotId);
            ReferenceCatalogValidationResult validation;
            try
            {
                var capturedUtc = DateTimeOffset.ParseExact(
                    header.CapturedUtc,
                    "O",
                    CultureInfo.InvariantCulture,
                    DateTimeStyles.RoundtripKind);
                if (!string.Equals(
                        capturedUtc.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture),
                        header.CapturedUtc,
                        StringComparison.Ordinal))
                {
                    throw new FormatException("The reference capture time is not canonical UTC.");
                }

                validation = ReferenceCatalogDraft.Create(
                    new ReferenceCatalogSnapshotIdentity(snapshotId),
                    header.SourceKey,
                    header.ContractVersion,
                    capturedUtc,
                    new ReferenceCatalogProvenanceInput(
                        provenance.SourceKind,
                        provenance.VersionFingerprint,
                        provenance.SourceUri),
                    records,
                    diagnostics).Validate();
            }
            catch (Exception error) when (error is ArgumentException or FormatException or InvalidDataException)
            {
                throw new InvalidDataException(
                    $"Reference snapshot '{header.SnapshotId}' cannot be reconstructed.",
                    error);
            }

            if (header.Lifecycle != "draft" &&
                (validation.Snapshot is null ||
                 !string.Equals(
                     validation.Snapshot.Sha256,
                     header.CanonicalContentSha256,
                     StringComparison.Ordinal)))
            {
                throw new InvalidDataException(
                    $"Reference snapshot '{header.SnapshotId}' has a corrupt canonical envelope.");
            }
        }

        if (HasTable(connection, "reference_search_projections"))
        {
            ValidateReferenceSearchProjection(connection);
        }
    }

    private static void ValidateReferenceSearchProjection(SqliteConnection connection)
    {
        using (var activeProjection = connection.CreateCommand())
        {
            activeProjection.CommandText =
                """
                SELECT
                    (SELECT COUNT(*)
                     FROM reference_source_heads h
                     LEFT JOIN reference_search_projections p
                       ON p.source_id = h.source_id AND p.snapshot_id = h.snapshot_id
                     WHERE p.source_id IS NULL)
                    +
                    (SELECT COUNT(*)
                     FROM reference_search_projections p
                     LEFT JOIN reference_source_heads h
                       ON h.source_id = p.source_id AND h.snapshot_id = p.snapshot_id
                     WHERE h.source_id IS NULL);
                """;
            if (Convert.ToInt32(activeProjection.ExecuteScalar(), CultureInfo.InvariantCulture) != 0)
            {
                throw new InvalidDataException(
                    "The SQLite backup has a search projection that does not match the active reference snapshot.");
            }
        }

        using (var recordCounts = connection.CreateCommand())
        {
            recordCounts.CommandText =
                """
                SELECT COUNT(*)
                FROM reference_search_projections p
                WHERE p.record_count <> (
                          SELECT COUNT(*)
                          FROM reference_search_records r
                          WHERE r.source_id = p.source_id AND r.snapshot_id = p.snapshot_id)
                   OR p.record_count <> (
                          SELECT COUNT(*)
                          FROM reference_snapshot_records d
                          WHERE d.snapshot_id = p.snapshot_id);
                """;
            if (Convert.ToInt32(recordCounts.ExecuteScalar(), CultureInfo.InvariantCulture) != 0)
            {
                throw new InvalidDataException(
                    "The SQLite backup has an incomplete reference search projection.");
            }
        }

        var expectedFields = new Dictionary<long, ProjectionFieldExpectation>();
        using (var recordValues = connection.CreateCommand())
        {
            recordValues.CommandText =
                """
                SELECT r.search_id, r.source_id, r.entity_type, r.source_record_key,
                       r.normalized_source_key, r.search_text, d.canonical_payload
                FROM reference_search_records r
                JOIN reference_snapshot_records d
                  ON d.snapshot_id = r.snapshot_id
                 AND d.entity_type = r.entity_type
                 AND d.source_record_key = r.source_record_key
                ORDER BY r.search_id;
                """;
            using var reader = recordValues.ExecuteReader();
            while (reader.Read())
            {
                var searchId = reader.GetInt64(0);
                var entityType = reader.GetString(2);
                var sourceKey = reader.GetString(3);
                var expected = ReferenceCatalogSearchProjection.BuildExpected(
                    entityType, sourceKey, reader.GetString(6));
                if (!string.Equals(reader.GetString(4), expected.NormalizedSourceKey, StringComparison.Ordinal) ||
                    !string.Equals(reader.GetString(5), expected.SearchText, StringComparison.Ordinal))
                {
                    throw new InvalidDataException(
                        "The SQLite backup has corrupt normalized reference search records.");
                }
                expectedFields.Add(searchId, new ProjectionFieldExpectation(
                    reader.GetString(1), entityType, sourceKey, expected.Fields));
            }
        }

        var observedFieldCounts = expectedFields.Keys.ToDictionary(searchId => searchId, _ => 0);
        using (var fields = connection.CreateCommand())
        {
            fields.CommandText =
                """
                SELECT search_id, field_ordinal, source_id, entity_type, source_record_key,
                       source_field_name, field_name, value_kind, normalized_text
                FROM reference_search_fields
                ORDER BY search_id, field_ordinal;
                """;
            using var reader = fields.ExecuteReader();
            while (reader.Read())
            {
                var searchId = reader.GetInt64(0);
                if (!expectedFields.TryGetValue(searchId, out var record))
                    throw new InvalidDataException("The SQLite backup has an orphaned reference search field.");
                var index = observedFieldCounts[searchId];
                if (index >= record.Fields.Count)
                    throw new InvalidDataException("The SQLite backup has extra reference search fields.");
                var expected = record.Fields[index];
                var fieldName = reader.IsDBNull(6) ? null : reader.GetString(6);
                var normalizedText = reader.IsDBNull(8) ? null : reader.GetString(8);
                if (reader.GetInt32(1) != expected.Ordinal ||
                    !string.Equals(reader.GetString(2), record.SourceDatabaseId, StringComparison.Ordinal) ||
                    !string.Equals(reader.GetString(3), record.EntityType, StringComparison.Ordinal) ||
                    !string.Equals(reader.GetString(4), record.SourceKey, StringComparison.Ordinal) ||
                    !string.Equals(reader.GetString(5), expected.SourceFieldName, StringComparison.Ordinal) ||
                    !string.Equals(fieldName, expected.FieldName, StringComparison.Ordinal) ||
                    !string.Equals(reader.GetString(7), expected.ValueKind, StringComparison.Ordinal) ||
                    !string.Equals(normalizedText, expected.NormalizedText, StringComparison.Ordinal))
                {
                    throw new InvalidDataException(
                        "The SQLite backup has corrupt normalized reference search fields.");
                }
                observedFieldCounts[searchId] = index + 1;
            }
        }
        if (expectedFields.Any(item => observedFieldCounts[item.Key] != item.Value.Fields.Count))
            throw new InvalidDataException("The SQLite backup has incomplete reference search fields.");

        using var ftsRows = connection.CreateCommand();
        ftsRows.CommandText =
            """
            SELECT
                (SELECT COUNT(*) FROM reference_search_records)
                -
                (SELECT COUNT(*) FROM reference_search_fts_docsize);
            """;
        if (Convert.ToInt32(ftsRows.ExecuteScalar(), CultureInfo.InvariantCulture) != 0)
        {
            throw new InvalidDataException(
                "The SQLite backup has an incomplete full-text reference search index.");
        }

        ValidateReferenceSavedFilters(connection);
    }

    private static void ValidateReferenceSavedFilters(SqliteConnection connection)
    {
        using var command = connection.CreateCommand();
        command.CommandText =
            """
            SELECT filter_id, name, normalized_name, query_version, query_json, query_sha256,
                   created_utc, updated_utc
            FROM reference_catalog_saved_filters
            ORDER BY filter_id;
            """;
        using var reader = command.ExecuteReader();
        while (reader.Read())
        {
            try
            {
                if (!Guid.TryParseExact(reader.GetString(0), "D", out var filterId) || filterId == Guid.Empty)
                    throw new InvalidDataException("A saved catalog filter has an invalid identity.");
                var name = reader.GetString(1);
                var normalized = ReferenceCatalogSavedFilterCanonicalizer.NormalizeName(name);
                if (!string.Equals(normalized.DisplayName, name, StringComparison.Ordinal) ||
                    !string.Equals(normalized.NormalizedName, reader.GetString(2), StringComparison.Ordinal) ||
                    reader.GetInt32(3) != ReferenceCatalogSavedFilterCanonicalizer.CurrentVersion)
                    throw new InvalidDataException("A saved catalog filter has invalid normalized metadata.");
                _ = ReferenceCatalogSavedFilterCanonicalizer.ReadCanonical(
                    reader.GetString(4), reader.GetString(5));
                var createdUtc = ParseCanonicalUtc(reader.GetString(6));
                var updatedUtc = ParseCanonicalUtc(reader.GetString(7));
                if (updatedUtc < createdUtc)
                    throw new InvalidDataException("A saved catalog filter has invalid timestamps.");
            }
            catch (Exception error) when (
                error is ArgumentException or FormatException or ReferenceCatalogSavedFilterException)
            {
                throw new InvalidDataException("The SQLite backup has a corrupt saved catalog filter.", error);
            }
        }
    }

    private static DateTimeOffset ParseCanonicalUtc(string value)
    {
        var parsed = DateTimeOffset.ParseExact(
            value, "O", CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind);
        if (parsed.Offset != TimeSpan.Zero ||
            !string.Equals(parsed.ToString("O", CultureInfo.InvariantCulture), value, StringComparison.Ordinal))
            throw new FormatException("The saved catalog filter timestamp is not canonical UTC.");
        return parsed;
    }

    private static IReadOnlyList<ReferenceCatalogRecordInput> ReadReferenceRecords(
        SqliteConnection connection,
        string snapshotId)
    {
        using var command = connection.CreateCommand();
        command.CommandText =
            """
            SELECT entity_type, source_record_key, source_location,
                   canonical_payload, payload_sha256
            FROM reference_snapshot_records
            WHERE snapshot_id = $snapshotId
            ORDER BY entity_type, source_record_key;
            """;
        command.Parameters.AddWithValue("$snapshotId", snapshotId);
        using var reader = command.ExecuteReader();
        var result = new List<ReferenceCatalogRecordInput>();
        while (reader.Read())
        {
            var entityType = reader.GetString(0);
            var sourceKey = reader.GetString(1);
            var sourceLocation = reader.IsDBNull(2) ? null : reader.GetString(2);
            var payload = reader.GetString(3);
            if (!string.Equals(
                    SqliteReferenceCatalogSnapshotStore.HashRecordMetadata(
                        entityType, sourceKey, sourceLocation, payload),
                    reader.GetString(4),
                    StringComparison.Ordinal))
            {
                throw new InvalidDataException(
                    $"Reference snapshot '{snapshotId}' has a corrupt record payload.");
            }

            try
            {
                using var document = JsonDocument.Parse(payload);
                result.Add(new ReferenceCatalogRecordInput(
                    entityType,
                    sourceKey,
                    document.RootElement.Clone(),
                    sourceLocation));
            }
            catch (JsonException error)
            {
                throw new InvalidDataException(
                    $"Reference snapshot '{snapshotId}' has invalid record JSON.",
                    error);
            }
        }

        return result;
    }

    private static IReadOnlyList<ReferenceCatalogDiagnosticInput> ReadReferenceDiagnostics(
        SqliteConnection connection,
        string snapshotId)
    {
        using var command = connection.CreateCommand();
        command.CommandText =
            """
            SELECT severity, code, message, entity_type, source_record_key,
                   field_name, source_location, diagnostic_sha256
            FROM reference_snapshot_diagnostics
            WHERE snapshot_id = $snapshotId
            ORDER BY diagnostic_index;
            """;
        command.Parameters.AddWithValue("$snapshotId", snapshotId);
        using var reader = command.ExecuteReader();
        var result = new List<ReferenceCatalogDiagnosticInput>();
        while (reader.Read())
        {
            var severityText = reader.GetString(0);
            var code = reader.GetString(1);
            var message = reader.GetString(2);
            var entityType = reader.IsDBNull(3) ? null : reader.GetString(3);
            var sourceKey = reader.IsDBNull(4) ? null : reader.GetString(4);
            var field = reader.IsDBNull(5) ? null : reader.GetString(5);
            var sourceLocation = reader.IsDBNull(6) ? null : reader.GetString(6);
            if (!string.Equals(
                    SqliteReferenceCatalogSnapshotStore.HashDiagnosticMetadata(
                        severityText, code, message, entityType, sourceKey, field, sourceLocation),
                    reader.GetString(7),
                    StringComparison.Ordinal))
            {
                throw new InvalidDataException(
                    $"Reference snapshot '{snapshotId}' has corrupt diagnostic metadata.");
            }

            var severity = severityText switch
            {
                "warning" => ReferenceCatalogDiagnosticSeverity.Warning,
                "error" => ReferenceCatalogDiagnosticSeverity.Error,
                _ => throw new InvalidDataException(
                    $"Reference snapshot '{snapshotId}' has an unsupported diagnostic severity."),
            };
            result.Add(new ReferenceCatalogDiagnosticInput(
                severity, code, message, entityType, sourceKey, field, sourceLocation));
        }

        return result;
    }

    private sealed record ReferenceSnapshotHeader(
        string SnapshotId,
        string SourceKey,
        string SourceKind,
        long Sequence,
        int ContractVersion,
        string SourceVersion,
        string SourceContentSha256,
        string MetadataSha256,
        string? CanonicalContentSha256,
        string ProvenanceJson,
        string Lifecycle,
        string CapturedUtc);

    private sealed record ComponentTemplateBackupHeader(
        string TemplateId,
        int Version,
        int SchemaVersion,
        string Code,
        string Name,
        string ContentJson,
        string ContentSha256,
        string VersionSha256,
        string VersionCreatedUtc,
        string TemplateCreatedUtc,
        string UpdatedUtc,
        string? DeletedUtc);

    private static bool HasTable(SqliteConnection connection, string name)
    {
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = $name;";
        command.Parameters.AddWithValue("$name", name);
        return Convert.ToInt32(command.ExecuteScalar(), CultureInfo.InvariantCulture) == 1;
    }

    private async Task<BackupFileEntry> CopyVerifiedAsync(
        string relativePath,
        string sourcePath,
        string destinationPath,
        long expectedSize,
        string expectedHash,
        CancellationToken cancellationToken)
    {
        if (!File.Exists(sourcePath))
        {
            throw new FileNotFoundException("A referenced attachment blob is missing.", sourcePath);
        }

        RejectAttachmentPath(sourcePath);
        Directory.CreateDirectory(Path.GetDirectoryName(destinationPath)!);
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        long size = 0;
        var buffer = new byte[BufferSize];
        await using (var source = new FileStream(
                         sourcePath, FileMode.Open, FileAccess.Read, FileShare.Read, BufferSize,
                         FileOptions.Asynchronous | FileOptions.SequentialScan))
        await using (var destination = new FileStream(
                         destinationPath, FileMode.CreateNew, FileAccess.Write, FileShare.None, BufferSize,
                         FileOptions.Asynchronous | FileOptions.SequentialScan | FileOptions.WriteThrough))
        {
            while (true)
            {
                var count = await source.ReadAsync(buffer, cancellationToken).ConfigureAwait(false);
                if (count == 0)
                {
                    break;
                }

                size = checked(size + count);
                hash.AppendData(buffer, 0, count);
                await destination.WriteAsync(buffer.AsMemory(0, count), cancellationToken).ConfigureAwait(false);
            }

            await destination.FlushAsync(cancellationToken).ConfigureAwait(false);
            destination.Flush(flushToDisk: true);
        }

        var actualHash = Convert.ToHexStringLower(hash.GetHashAndReset());
        if (size != expectedSize || !string.Equals(actualHash, expectedHash, StringComparison.Ordinal))
        {
            throw new InvalidDataException("A referenced attachment blob failed backup validation.");
        }

        return new BackupFileEntry(relativePath, size, actualHash);
    }

    private static async Task<BackupFileEntry> HashExistingFileAsync(
        string relativePath,
        string path,
        CancellationToken cancellationToken)
    {
        await using var stream = new FileStream(
            path, FileMode.Open, FileAccess.Read, FileShare.Read, BufferSize,
            FileOptions.Asynchronous | FileOptions.SequentialScan);
        var hash = Convert.ToHexStringLower(
            await SHA256.HashDataAsync(stream, cancellationToken).ConfigureAwait(false));
        return new BackupFileEntry(relativePath, stream.Length, hash);
    }

    private IReadOnlyList<StorageBackupResult> ReadPublishedBackups(string backupRoot)
    {
        var results = new List<StorageBackupResult>();
        foreach (var directory in Directory.EnumerateDirectories(backupRoot, "backup-*", SearchOption.TopDirectoryOnly))
        {
            if (TryReadPublishedBackup(directory, out var result))
            {
                results.Add(result);
            }
        }

        return results
            .GroupBy(item => item.BackupId)
            .Where(group => group.Count() == 1)
            .Select(group => group.Single())
            .ToArray();
    }

    private static void RejectLexicalOverlap(string sourceDataRoot, string backupRoot)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(backupRoot);
        var candidate = Path.GetFullPath(backupRoot);
        if (IsSameOrDescendant(sourceDataRoot, candidate) || IsSameOrDescendant(candidate, sourceDataRoot))
        {
            throw new StorageBackupException(
                "backup_root_overlaps_data",
                "The backup root and data root must be separate, non-nested directories.");
        }
    }

    internal static string ResolveCanonicalExistingPath(string value, bool expectDirectory)
    {
        var requested = Path.GetFullPath(value);
        if (expectDirectory ? !Directory.Exists(requested) : !File.Exists(requested))
        {
            throw new FileNotFoundException("The storage source path does not exist.", requested);
        }

        RejectReparsePoint(requested, "A storage source path must not be a reparse point.");
        using var handle = CreateFile(
            requested,
            FileReadAttributes,
            FileShare.Read | FileShare.Write | FileShare.Delete,
            0,
            FileMode.Open,
            FileFlagBackupSemantics,
            0);
        if (handle.IsInvalid)
        {
            throw new IOException(
                "The physical data-root path cannot be opened.",
                new Win32Exception(Marshal.GetLastWin32Error()));
        }

        var capacity = 512;
        while (true)
        {
            var buffer = new StringBuilder(capacity);
            var length = GetFinalPathNameByHandle(handle, buffer, (uint)capacity, 0);
            if (length == 0)
            {
                throw new IOException(
                    "The physical data-root path cannot be resolved.",
                    new Win32Exception(Marshal.GetLastWin32Error()));
            }

            if (length < capacity)
            {
                var result = buffer.ToString();
                const string extendedPrefix = @"\\?\";
                return Path.GetFullPath(result.StartsWith(extendedPrefix, StringComparison.Ordinal)
                    ? result[extendedPrefix.Length..]
                    : result);
            }

            capacity = checked((int)length + 1);
        }
    }

    private static void RejectPhysicalOverlap(string canonicalDataRoot, string backupRoot)
    {
        if (IsSameOrDescendant(canonicalDataRoot, backupRoot) || IsSameOrDescendant(backupRoot, canonicalDataRoot))
        {
            throw new StorageBackupException(
                "backup_root_overlaps_data",
                "The backup root resolves to the data root or a nested directory.");
        }
    }

    private static bool IsSameOrDescendant(string parent, string candidate)
    {
        var relative = Path.GetRelativePath(parent, candidate);
        return relative == "." ||
            (!Path.IsPathRooted(relative) &&
             relative != ".." &&
             !relative.StartsWith($"..{Path.DirectorySeparatorChar}", StringComparison.Ordinal));
    }

    private static string CreateOrdinaryDirectory(string path)
    {
        Directory.CreateDirectory(path);
        RejectReparsePoint(path, "A backup directory must not be a reparse point.");
        return path;
    }

    private static void RejectReparsePoint(string path, string message)
    {
        if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0)
        {
            throw new InvalidDataException(message);
        }
    }

    private void RejectAttachmentPath(string blobPath)
    {
        var attachments = Path.Combine(dataRoot, "attachments");
        var blobs = Path.Combine(attachments, "blobs");
        var shard = Path.GetDirectoryName(blobPath)
            ?? throw new InvalidDataException("A referenced attachment path has no shard.");
        foreach (var path in new[] { attachments, blobs, shard, blobPath })
        {
            if (!Directory.Exists(path) && !File.Exists(path))
            {
                throw new FileNotFoundException("A referenced attachment path is missing.", path);
            }

            RejectReparsePoint(path, "A referenced attachment path must not be a reparse point.");
        }
    }

    internal static VerifiedBackupArchive ReadVerifiedBackup(string directory, bool requirePublishedName = true)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(directory);
        directory = ResolveCanonicalExistingPath(directory, expectDirectory: true);
        RejectReparsePoint(directory, "A published backup must not be a reparse point.");
        var manifestPath = Path.Combine(directory, ManifestFileName);
        var checksumPath = Path.Combine(directory, ManifestChecksumFileName);
        if (!File.Exists(manifestPath) || !File.Exists(checksumPath))
        {
            throw new InvalidDataException("The backup manifest or its detached checksum is missing.");
        }

        var manifestLength = new FileInfo(manifestPath).Length;
        var checksumLength = new FileInfo(checksumPath).Length;
        if (manifestLength is <= 0 or > MaximumManifestBytes || checksumLength is <= 0 or > 66)
        {
            throw new InvalidDataException("The backup manifest exceeds its format limits.");
        }

        var bytes = File.ReadAllBytes(manifestPath);
        ValidateManifestJsonShape(bytes);
        var expected = File.ReadAllText(checksumPath, Encoding.ASCII).Trim();
        if (!IsSha256(expected) ||
            !string.Equals(Convert.ToHexStringLower(SHA256.HashData(bytes)), expected, StringComparison.Ordinal))
        {
            throw new InvalidDataException("The backup manifest checksum is invalid.");
        }

        var manifest = JsonSerializer.Deserialize<BackupManifest>(bytes, JsonOptions)
            ?? throw new InvalidDataException("The backup manifest is empty.");
        if (manifest.Files is null || manifest.ProjectRevisions is null ||
            !TryValidateBackupDirectory(directory, manifest, expected, requirePublishedName))
        {
            throw new InvalidDataException("The backup failed complete verification.");
        }

        var database = manifest.Files.Single(file => file.Path == DatabaseFileName);
        var result = new StorageBackupResult(
            manifest.BackupId,
            directory,
            ParseKind(manifest.Kind),
            manifest.CreatedUtc,
            manifest.SchemaVersion,
            expected,
            database.Sha256,
            database.SizeBytes,
            manifest.Files.Count - 1,
            manifest.ProjectRevisions);
        return new VerifiedBackupArchive(
            result,
            manifest.Files.Select(file => new VerifiedBackupFile(file.Path, file.SizeBytes, file.Sha256)).ToArray());
    }

    private static bool TryReadPublishedBackup(string directory, out StorageBackupResult result)
    {
        result = null!;
        try
        {
            result = ReadVerifiedBackup(directory).Result;
            return true;
        }
        catch (Exception error) when (
            error is IOException or UnauthorizedAccessException or InvalidDataException or SqliteException or
                JsonException or InvalidOperationException or ArgumentException or OverflowException)
        {
            return false;
        }
    }

    private static bool TryValidateBackupDirectory(
        string directory,
        BackupManifest manifest,
        string manifestSha256,
        bool requirePublishedName)
    {
        try
        {
            var manifestPath = Path.Combine(directory, ManifestFileName);
            var checksumPath = Path.Combine(directory, ManifestChecksumFileName);
            if (!File.Exists(manifestPath) || !File.Exists(checksumPath))
            {
                return false;
            }

            var manifestLength = new FileInfo(manifestPath).Length;
            var checksumLength = new FileInfo(checksumPath).Length;
            if (manifestLength is <= 0 or > MaximumManifestBytes || checksumLength is <= 0 or > 66)
            {
                return false;
            }

            var manifestBytes = File.ReadAllBytes(manifestPath);
            ValidateManifestJsonShape(manifestBytes);
            var detachedHash = File.ReadAllText(checksumPath, Encoding.ASCII).Trim();
            if (!string.Equals(Convert.ToHexStringLower(SHA256.HashData(manifestBytes)), manifestSha256, StringComparison.Ordinal) ||
                !string.Equals(detachedHash, manifestSha256, StringComparison.Ordinal))
            {
                return false;
            }

            manifest = JsonSerializer.Deserialize<BackupManifest>(manifestBytes, JsonOptions)!;
            if (manifest?.ProjectRevisions is null || manifest.Files is null)
            {
                return false;
            }

            if (manifest.ManifestFormat != ManifestFormat ||
                !string.Equals(manifest.ProductId, ProductId, StringComparison.Ordinal) ||
                manifest.BackupId == Guid.Empty ||
                manifest.SchemaVersion <= 0 ||
                string.IsNullOrWhiteSpace(manifest.AppVersion) ||
                manifest.AppVersion.Length > 128 || manifest.AppVersion.Any(char.IsControl) ||
                manifest.PreviousAppVersion is { Length: > 128 } ||
                manifest.PreviousAppVersion?.Any(char.IsControl) == true ||
                manifest.CreatedUtc.Offset != TimeSpan.Zero ||
                !IsSha256(manifestSha256) ||
                manifest.ProjectRevisions.Any(item => item is null || item.ProjectId == Guid.Empty || item.Revision < 0) ||
                manifest.ProjectRevisions.Select(item => item.ProjectId).Distinct().Count() != manifest.ProjectRevisions.Count ||
                manifest.ProjectRevisions
                    .OrderBy(item => item.ProjectId)
                    .SequenceEqual(manifest.ProjectRevisions) is false ||
                manifest.Files.Count == 0 ||
                manifest.Files.Count > MaximumBackupFileCount ||
                manifest.Files.Any(file => file is null || file.Path is null || file.Sha256 is null) ||
                manifest.Files.Select(file => file.Path).Distinct(StringComparer.Ordinal).Count() != manifest.Files.Count ||
                manifest.Files.Select(file => file.Path).Distinct(StringComparer.OrdinalIgnoreCase).Count() != manifest.Files.Count ||
                !manifest.Files.OrderBy(file => file.Path, StringComparer.Ordinal).SequenceEqual(manifest.Files) ||
                manifest.Kind is not ("regular" or "pre-update" or "pre-restore") ||
                requirePublishedName && !string.Equals(
                    Path.GetFileName(directory),
                    ExpectedBackupDirectoryName(manifest.CreatedUtc, manifest.BackupId),
                    StringComparison.Ordinal))
            {
                return false;
            }

            ValidateNoReparseEntries(directory);

            foreach (var file in manifest.Files)
            {
                if (!IsCanonicalManifestPath(file.Path) ||
                    file.SizeBytes < 0 || file.SizeBytes > MaximumBackupFileBytes ||
                    !IsSha256(file.Sha256) ||
                    file.Path != DatabaseFileName &&
                    !string.Equals(
                        file.Path,
                        $"attachments/blobs/{file.Sha256[..2]}/{file.Sha256}",
                        StringComparison.Ordinal))
                {
                    return false;
                }

                var path = Path.GetFullPath(Path.Combine(directory, file.Path.Replace('/', Path.DirectorySeparatorChar)));
                if (!IsSameOrDescendant(directory, path) || !File.Exists(path))
                {
                    return false;
                }

                RejectReparseAncestors(directory, path);
                RejectReparsePoint(path, "A published backup file must not be a reparse point.");
                using var stream = File.OpenRead(path);
                if (stream.Length != file.SizeBytes ||
                    !string.Equals(Convert.ToHexStringLower(SHA256.HashData(stream)), file.Sha256, StringComparison.Ordinal))
                {
                    return false;
                }
            }

            if (manifest.Files.Aggregate(0L, (total, file) => checked(total + file.SizeBytes)) > MaximumBackupTotalBytes)
            {
                return false;
            }

            var databasePath = Path.Combine(directory, DatabaseFileName);
            var snapshot = InspectSnapshot(databasePath);
            var actualFiles = EnumerateOrdinaryFiles(directory)
                .Select(path => Path.GetRelativePath(directory, path).Replace('\\', '/'))
                .Order(StringComparer.Ordinal)
                .ToArray();
            var expectedFiles = manifest.Files
                .Select(file => file.Path)
                .Append(ManifestFileName)
                .Append(ManifestChecksumFileName)
                .Order(StringComparer.Ordinal)
                .ToArray();
            if (!actualFiles.SequenceEqual(expectedFiles))
            {
                return false;
            }

            var expectedBlobs = snapshot.Blobs
                .Select(blob => $"attachments/blobs/{blob.Sha256[..2]}/{blob.Sha256}")
                .Order(StringComparer.Ordinal)
                .ToArray();
            var manifestBlobs = manifest.Files
                .Where(file => file.Path != DatabaseFileName)
                .Select(file => file.Path)
                .Order(StringComparer.Ordinal)
                .ToArray();
            return snapshot.SchemaVersion == manifest.SchemaVersion &&
                snapshot.ProjectRevisions.SequenceEqual(manifest.ProjectRevisions) &&
                expectedBlobs.SequenceEqual(manifestBlobs);
        }
        catch (Exception error) when (
            error is IOException or UnauthorizedAccessException or InvalidDataException or SqliteException or
                JsonException or InvalidOperationException or ArgumentException or NullReferenceException or OverflowException)
        {
            return false;
        }
    }

    private static IReadOnlyList<string> EnumerateOrdinaryFiles(string root)
    {
        var files = new List<string>();
        var pending = new Stack<string>();
        pending.Push(root);
        while (pending.Count > 0)
        {
            var directory = pending.Pop();
            RejectReparsePoint(directory, "A backup directory must not be a reparse point.");
            foreach (var entry in Directory.EnumerateFileSystemEntries(directory, "*", SearchOption.TopDirectoryOnly))
            {
                RejectReparsePoint(entry, "A backup entry must not be a reparse point.");
                if (Directory.Exists(entry))
                {
                    pending.Push(entry);
                }
                else if (File.Exists(entry))
                {
                    files.Add(entry);
                }
                else
                {
                    throw new InvalidDataException("A backup entry changed during verification.");
                }
            }
        }

        return files;
    }

    private static void ValidateNoReparseEntries(string root) => EnumerateOrdinaryFiles(root);

    private static void RejectReparseAncestors(string root, string path)
    {
        var current = Path.GetDirectoryName(path);
        while (current is not null && IsSameOrDescendant(root, current))
        {
            RejectReparsePoint(current, "A backup ancestor directory must not be a reparse point.");
            if (string.Equals(current, root, StringComparison.OrdinalIgnoreCase))
            {
                return;
            }

            current = Path.GetDirectoryName(current);
        }

        throw new InvalidDataException("A backup file is outside its backup directory.");
    }

    private async Task VerifySourceBlobAsync(SnapshotBlob blob, CancellationToken cancellationToken)
    {
        var sourcePath = Path.Combine(
            dataRoot,
            "attachments",
            "blobs",
            blob.Sha256[..2],
            blob.Sha256);
        if (!File.Exists(sourcePath))
        {
            throw new FileNotFoundException("A referenced attachment blob is missing.", sourcePath);
        }

        RejectAttachmentPath(sourcePath);
        await using var stream = new FileStream(
            sourcePath, FileMode.Open, FileAccess.Read, FileShare.Read, BufferSize,
            FileOptions.Asynchronous | FileOptions.SequentialScan);
        var actualHash = Convert.ToHexStringLower(
            await SHA256.HashDataAsync(stream, cancellationToken).ConfigureAwait(false));
        if (stream.Length != blob.SizeBytes || !string.Equals(actualHash, blob.Sha256, StringComparison.Ordinal))
        {
            throw new InvalidDataException("A referenced attachment blob failed backup validation.");
        }
    }

    private static bool IsCanonicalManifestPath(string? path) =>
        !string.IsNullOrEmpty(path) &&
        path == path.Replace('\\', '/') &&
        !Path.IsPathRooted(path) &&
        !path.Split('/').Any(segment => segment is "" or "." or "..");

    private static void ValidateManifestJsonShape(byte[] bytes)
    {
        using var document = JsonDocument.Parse(bytes, new JsonDocumentOptions
        {
            AllowTrailingCommas = false,
            CommentHandling = JsonCommentHandling.Disallow,
            MaxDepth = 8,
        });
        ValidateObjectProperties(
            document.RootElement,
            "manifestFormat", "productId", "backupId", "kind", "appVersion",
            "previousAppVersion", "schemaVersion", "createdUtc", "projectRevisions", "files");
        if (!document.RootElement.TryGetProperty("projectRevisions", out var revisions) ||
            revisions.ValueKind != JsonValueKind.Array ||
            !document.RootElement.TryGetProperty("files", out var files) ||
            files.ValueKind != JsonValueKind.Array)
        {
            throw new InvalidDataException("The backup manifest collections are invalid.");
        }

        foreach (var revision in revisions.EnumerateArray())
        {
            ValidateObjectProperties(revision, "projectId", "revision");
        }

        foreach (var file in files.EnumerateArray())
        {
            ValidateObjectProperties(file, "path", "sizeBytes", "sha256");
        }
    }

    private static void ValidateObjectProperties(JsonElement element, params string[] expected)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            throw new InvalidDataException("The backup manifest contains a non-object entry.");
        }

        var properties = element.EnumerateObject().Select(property => property.Name).ToArray();
        if (properties.Length != expected.Length ||
            properties.Distinct(StringComparer.Ordinal).Count() != properties.Length ||
            !properties.Order(StringComparer.Ordinal).SequenceEqual(expected.Order(StringComparer.Ordinal)))
        {
            throw new InvalidDataException("The backup manifest has missing, extra or duplicate properties.");
        }
    }

    private static bool IsSha256(string? value) =>
        value is not null &&
        value.Length == 64 &&
        value.All(character => character is >= '0' and <= '9' or >= 'a' and <= 'f');

    private static void ValidateGeneratedBackupDirectory(string backupRoot, string backupPath)
    {
        var full = Path.GetFullPath(backupPath);
        var leaf = Path.GetFileName(full);
        if (!IsSameOrDescendant(backupRoot, full) ||
            !string.Equals(Path.GetDirectoryName(full), backupRoot, StringComparison.OrdinalIgnoreCase) ||
            !IsGeneratedBackupDirectoryName(leaf) ||
            (File.GetAttributes(full) & FileAttributes.ReparsePoint) != 0)
        {
            throw new InvalidDataException("Refusing to delete an untrusted backup directory.");
        }
    }

    private static string ExpectedBackupDirectoryName(DateTimeOffset createdUtc, Guid backupId) =>
        $"backup-{createdUtc.ToUniversalTime():yyyyMMddTHHmmssfffffffZ}-{backupId:N}";

    private static bool IsGeneratedBackupDirectoryName(string value)
    {
        const int timestampLength = 23;
        const int guidLength = 32;
        const string prefix = "backup-";
        if (value.Length != prefix.Length + timestampLength + 1 + guidLength ||
            !value.StartsWith(prefix, StringComparison.Ordinal) ||
            value[prefix.Length + timestampLength] != '-')
        {
            return false;
        }

        return DateTimeOffset.TryParseExact(
                   value.AsSpan(prefix.Length, timestampLength),
                   "yyyyMMdd'T'HHmmssfffffff'Z'",
                   CultureInfo.InvariantCulture,
                   DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
                   out _) &&
            Guid.TryParseExact(value.AsSpan(prefix.Length + timestampLength + 1), "N", out _);
    }

    private static void FlushExistingFile(string path)
    {
        using var stream = new FileStream(path, FileMode.Open, FileAccess.ReadWrite, FileShare.Read);
        stream.Flush(flushToDisk: true);
    }

    private static void WriteDurableNewFile(string path, byte[] bytes)
    {
        using var stream = new FileStream(
            path, FileMode.CreateNew, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough);
        stream.Write(bytes);
        stream.Flush(flushToDisk: true);
    }

    private static void TryDeleteOwnedStaging(string stagingPath, string stagingRoot)
    {
        try
        {
            if (Directory.Exists(stagingPath) &&
                IsSameOrDescendant(stagingRoot, stagingPath) &&
                !string.Equals(stagingRoot, stagingPath, StringComparison.OrdinalIgnoreCase))
            {
                ValidateNoReparseEntries(stagingPath);
                Directory.Delete(stagingPath, recursive: true);
            }
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or InvalidDataException)
        {
            // The failed staging directory is never a published backup. A later cleanup may remove it.
        }
    }

    private static void ValidateAppVersion(string value)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > 128 || value.Any(char.IsControl))
        {
            throw new ArgumentException("The application version is invalid.", nameof(value));
        }
    }

    private static string FormatKind(StorageBackupKind kind) => kind switch
    {
        StorageBackupKind.Regular => "regular",
        StorageBackupKind.PreUpdate => "pre-update",
        StorageBackupKind.PreRestore => "pre-restore",
        _ => throw new ArgumentOutOfRangeException(nameof(kind)),
    };

    private static StorageBackupKind ParseKind(string value) => value switch
    {
        "regular" => StorageBackupKind.Regular,
        "pre-update" => StorageBackupKind.PreUpdate,
        "pre-restore" => StorageBackupKind.PreRestore,
        _ => throw new InvalidDataException("A backup manifest has an unsupported kind."),
    };

    internal sealed record SnapshotBlob(string Sha256, long SizeBytes);

    internal sealed record SnapshotInventory(
        int SchemaVersion,
        IReadOnlyList<StorageBackupProjectRevision> ProjectRevisions,
        IReadOnlyList<SnapshotBlob> Blobs);

    private sealed record ProjectionFieldExpectation(
        string SourceDatabaseId,
        string EntityType,
        string SourceKey,
        IReadOnlyList<ReferenceCatalogSearchProjection.ExpectedField> Fields);

    private sealed record BackupManifest(
        int ManifestFormat,
        string ProductId,
        Guid BackupId,
        string Kind,
        string AppVersion,
        string? PreviousAppVersion,
        int SchemaVersion,
        DateTimeOffset CreatedUtc,
        IReadOnlyList<StorageBackupProjectRevision> ProjectRevisions,
        IReadOnlyList<BackupFileEntry> Files);

    private sealed record BackupFileEntry(string Path, long SizeBytes, string Sha256);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFile(
        string fileName,
        uint desiredAccess,
        FileShare shareMode,
        nint securityAttributes,
        FileMode creationDisposition,
        uint flagsAndAttributes,
        nint templateFile);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetFinalPathNameByHandle(
        SafeFileHandle file,
        [Out] StringBuilder filePath,
        uint filePathLength,
        uint flags);
}

internal sealed record VerifiedBackupFile(string Path, long SizeBytes, string Sha256);

internal sealed record VerifiedBackupArchive(
    StorageBackupResult Result,
    IReadOnlyList<VerifiedBackupFile> Files);
