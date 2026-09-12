using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using Techmap.Application;

namespace Techmap.Infrastructure.Sqlite;

/// <summary>
/// Migrates an offline storage generation by publishing and switching to a separately verified candidate.
/// The caller must hold the data-root lease for the complete call and until the returned generation is opened.
/// </summary>
public sealed class SqliteStorageMigrationService : IStorageMigrationService
{
    internal const string JournalFileName = "MIGRATION.json";
    internal const string CandidateMarkerFileName = "MIGRATION-COMPLETE.json";
    internal const string CandidateOwnerFileName = ".MIGRATION-OWNER";
    internal const int JournalFormat = 1;

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true,
    };

    private readonly string dataRoot;
    private readonly Action<string>? progressHook;
    private readonly SemaphoreSlim migrationGate = new(1, 1);

    public SqliteStorageMigrationService(DataRootLease dataRootLease, Action<string>? progressHook = null)
    {
        ArgumentNullException.ThrowIfNull(dataRootLease);
        dataRoot = dataRootLease.CanonicalPath;
        this.progressHook = progressHook;
    }

    public async Task<StorageMigrationResult> MigrateIfRequiredAsync(
        StorageMigrationRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        ValidateRequest(request);
        if (request.PackageSchemaVersion != SqliteStorage.CurrentSchemaVersion)
        {
            throw new StorageMigrationException(
                "package_schema_mismatch",
                $"Package schema {request.PackageSchemaVersion} does not match application schema " +
                $"{SqliteStorage.CurrentSchemaVersion}.");
        }

        await migrationGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            cancellationToken.ThrowIfCancellationRequested();
            try
            {
                var journalPath = Path.Combine(dataRoot, JournalFileName);
                if (File.Exists(journalPath))
                {
                    return await RecoverAsync(request, journalPath, cancellationToken).ConfigureAwait(false);
                }

                if (!File.Exists(Path.Combine(dataRoot, StorageGenerationLayout.CurrentPointerFileName)))
                {
                    var generationsPath = Path.Combine(dataRoot, StorageGenerationLayout.GenerationsDirectoryName);
                    if (Directory.Exists(generationsPath) &&
                        Directory.EnumerateFileSystemEntries(generationsPath).Any())
                    {
                        throw new StorageMigrationException(
                            "current_missing",
                            "CURRENT is missing while storage generations exist and no recovery journal is available.");
                    }

                    return new StorageMigrationResult(
                        Migrated: false,
                        Recovered: false,
                        SourceSchemaVersion: 0,
                        TargetSchemaVersion: SqliteStorage.CurrentSchemaVersion,
                        SourceGenerationName: string.Empty,
                        CurrentGenerationName: string.Empty,
                        PreUpdateBackup: null);
                }

                return await StartAsync(request, journalPath, cancellationToken).ConfigureAwait(false);
            }
            catch (Exception error) when (
                error is not StorageMigrationException and not OperationCanceledException)
            {
                throw new StorageMigrationException(
                    "migration_failed",
                    "The offline storage migration failed.",
                    error);
            }
        }
        finally
        {
            migrationGate.Release();
        }
    }

    public void CompleteSuccessfulStartup(StorageMigrationResult migration)
    {
        ArgumentNullException.ThrowIfNull(migration);
        if (!migration.Migrated)
        {
            return;
        }

        var journalPath = Path.Combine(dataRoot, JournalFileName);
        if (!File.Exists(journalPath))
        {
            return;
        }

        var (journal, _) = ReadJournal(journalPath);
        var current = StorageGenerationLayout.ReadCurrentGeneration(
            Path.Combine(dataRoot, StorageGenerationLayout.CurrentPointerFileName));
        if (!string.Equals(current, journal.CandidateGenerationName, StringComparison.Ordinal) ||
            !string.Equals(current, migration.CurrentGenerationName, StringComparison.Ordinal) ||
            !string.Equals(journal.SourceGenerationName, migration.SourceGenerationName, StringComparison.Ordinal) ||
            journal.SourceSchemaVersion != migration.SourceSchemaVersion ||
            journal.TargetSchemaVersion != migration.TargetSchemaVersion)
        {
            throw new StorageMigrationException(
                "migration_completion_conflict",
                "The successful startup does not match the pending migration journal.");
        }

        TryDeleteJournal(journalPath);
    }

    private async Task<StorageMigrationResult> StartAsync(
        StorageMigrationRequest request,
        string journalPath,
        CancellationToken cancellationToken)
    {
        var currentName = StorageGenerationLayout.ReadCurrentGeneration(
            Path.Combine(dataRoot, StorageGenerationLayout.CurrentPointerFileName));
        StorageGenerationLayout.ValidateGenerationName(currentName);
        var currentPath = CandidatePath(currentName);
        var currentDatabasePath = Path.Combine(currentPath, StorageGenerationLayout.DatabaseFileName);
        var currentReadyPath = Path.Combine(currentPath, StorageGenerationLayout.ReadyMarkerFileName);
        if (!Directory.Exists(currentPath) ||
            !File.Exists(currentDatabasePath) ||
            !File.Exists(currentReadyPath))
        {
            throw new StorageMigrationException("current_invalid", "The active storage generation is incomplete.");
        }
        RejectReparsePoint(currentPath, "The active generation must not be a reparse point.");
        RejectReparsePoint(currentDatabasePath, "The active database must not be a reparse point.");
        RejectReparsePoint(currentReadyPath, "The active READY marker must not be a reparse point.");
        var rawSchemaVersion = ReadRawUserVersion(currentDatabasePath);
        if (rawSchemaVersion > SqliteStorage.CurrentSchemaVersion)
        {
            throw new StorageMigrationException(
                "downgrade_not_supported",
                $"Storage schema {rawSchemaVersion} is newer than supported schema " +
                $"{SqliteStorage.CurrentSchemaVersion}.");
        }

        if (rawSchemaVersion <= 0)
        {
            throw new StorageMigrationException(
                "unknown_schema",
                $"Storage schema {rawSchemaVersion} is not recognized.");
        }

        var source = ReadCurrent();

        if (source.Inventory.SchemaVersion == SqliteStorage.CurrentSchemaVersion)
        {
            ValidateLiveBlobs(source.Inventory);
            return Result(false, false, source, source.GenerationName, null);
        }

        if (!SqliteStorage.HasCompleteMigrationPath(
                source.Inventory.SchemaVersion,
                SqliteStorage.CurrentSchemaVersion))
        {
            throw new StorageMigrationException(
                "migration_step_missing",
                $"No complete migration path exists from schema {source.Inventory.SchemaVersion} to " +
                $"{SqliteStorage.CurrentSchemaVersion}.");
        }

        ValidateLiveBlobs(source.Inventory);
        progressHook?.Invoke("before_pre_update_backup");
        using var backupService = new SqliteStorageBackupService(dataRoot, source.DatabasePath);
        var backup = await backupService.CreateAsync(
            new StorageBackupRequest(
                request.BackupRoot,
                request.AppVersion,
                StorageBackupKind.PreUpdate,
                request.PreviousAppVersion),
            cancellationToken).ConfigureAwait(false);
        using var backupRootLease = DataRootLease.Acquire(request.BackupRoot);
        var verifiedBackup = VerifyPreUpdateBackup(backup, source, backupRootLease.CanonicalPath);
        progressHook?.Invoke("after_pre_update_backup");
        request = request with { BackupRoot = backupRootLease.CanonicalPath };

        var generationsPath = Path.Combine(dataRoot, StorageGenerationLayout.GenerationsDirectoryName);
        var candidateName = AllocateNextGenerationName(generationsPath);
        var operationId = Guid.NewGuid();
        var journal = new MigrationJournal(
            JournalFormat,
            operationId,
            source.GenerationName,
            source.Inventory.SchemaVersion,
            candidateName,
            SqliteStorage.CurrentSchemaVersion,
            request.AppVersion,
            backup);
        var journalJson = SerializeJournal(journal);
        StorageGenerationLayout.PublishNewDurableFile(journalPath, journalJson);
        progressHook?.Invoke("after_journal");

        return await BuildAndSwitchAsync(
            request,
            journalPath,
            journal,
            journalJson,
            verifiedBackup,
            source,
            recovered: false,
            cancellationToken).ConfigureAwait(false);
    }

    private async Task<StorageMigrationResult> RecoverAsync(
        StorageMigrationRequest request,
        string journalPath,
        CancellationToken cancellationToken)
    {
        var (journal, journalJson) = ReadJournal(journalPath);
        if (!string.Equals(journal.AppVersion, request.AppVersion, StringComparison.Ordinal) ||
            journal.TargetSchemaVersion != request.PackageSchemaVersion)
        {
            throw new StorageMigrationException(
                "migration_journal_conflict",
                "The pending migration belongs to a different application package.");
        }

        var currentPointerState = TryReadCurrentPointer(out var currentName);
        if (currentPointerState == CurrentPointerState.Valid &&
            !string.Equals(currentName, journal.SourceGenerationName, StringComparison.Ordinal) &&
            !string.Equals(currentName, journal.CandidateGenerationName, StringComparison.Ordinal))
        {
            throw new StorageMigrationException(
                "migration_journal_conflict",
                "CURRENT names a third generation that is not recorded by the migration journal.");
        }

        using var backupRootLease = DataRootLease.Acquire(request.BackupRoot);
        var verified = VerifyJournalBackup(journal, backupRootLease.CanonicalPath);
        var candidatePath = CandidatePath(journal.CandidateGenerationName);
        var candidateExists = Directory.Exists(candidatePath);
        if (candidateExists)
        {
            EnsureOwnedCandidate(candidatePath, journal.OperationId);
        }

        var candidateComplete = candidateExists &&
            File.Exists(Path.Combine(candidatePath, CandidateMarkerFileName)) &&
            File.Exists(Path.Combine(candidatePath, StorageGenerationLayout.ReadyMarkerFileName));
        if (candidateComplete)
        {
            var candidate = ReadGeneration(journal.CandidateGenerationName);
            ValidateCompletedCandidate(journal, journalJson, verified, candidate);
            if (currentPointerState == CurrentPointerState.Valid &&
                string.Equals(currentName, journal.CandidateGenerationName, StringComparison.Ordinal))
            {
                TryReportProgress("recovered_after_current_switch");
            }
            else
            {
                progressHook?.Invoke("before_current_switch");
                StorageGenerationLayout.ReplaceCurrentDurably(
                    Path.Combine(dataRoot, StorageGenerationLayout.CurrentPointerFileName),
                    journal.CandidateGenerationName);
                TryReportProgress("recovered_candidate_switch");
            }

            return new StorageMigrationResult(
                true,
                true,
                journal.SourceSchemaVersion,
                journal.TargetSchemaVersion,
                journal.SourceGenerationName,
                candidate.GenerationName,
                verified.Result);
        }

        if (currentPointerState == CurrentPointerState.Valid &&
            string.Equals(currentName, journal.CandidateGenerationName, StringComparison.Ordinal))
        {
            throw new StorageMigrationException(
                "active_candidate_incomplete",
                "CURRENT names the migration candidate, but that candidate is incomplete. " +
                "The active generation was preserved for manual recovery.");
        }

        var source = ReadGeneration(journal.SourceGenerationName);
        if (source.Inventory.SchemaVersion != journal.SourceSchemaVersion)
        {
            throw new StorageMigrationException(
                "migration_source_changed",
                "The source generation schema no longer matches the recovery journal.");
        }
        ValidatePreservedData(verified.Result.BackupPath, source.DatabasePath);
        ValidateLiveBlobs(source.Inventory);

        if (currentPointerState != CurrentPointerState.Valid)
        {
            StorageGenerationLayout.ReplaceCurrentDurably(
                Path.Combine(dataRoot, StorageGenerationLayout.CurrentPointerFileName),
                journal.SourceGenerationName);
        }

        backupRootLease.Dispose();
        if (candidateExists)
        {
            DeleteOwnedCandidate(candidatePath, journal.OperationId);
            progressHook?.Invoke("recovered_incomplete_candidate");
        }
        else
        {
            progressHook?.Invoke("recovered_before_candidate");
        }

        DeleteJournal(journalPath);
        return await StartAsync(request, journalPath, cancellationToken).ConfigureAwait(false);
    }

    private async Task<StorageMigrationResult> BuildAndSwitchAsync(
        StorageMigrationRequest request,
        string journalPath,
        MigrationJournal journal,
        string journalJson,
        VerifiedBackupArchive verifiedBackup,
        GenerationSnapshot source,
        bool recovered,
        CancellationToken cancellationToken)
    {
        _ = request;
        _ = await Task.FromResult(true).ConfigureAwait(false);
        var candidatePath = CandidatePath(journal.CandidateGenerationName);
        Directory.CreateDirectory(candidatePath);
        RejectReparsePoint(candidatePath, "The migration candidate must not be a reparse point.");
        StorageGenerationLayout.PublishNewDurableFile(
            Path.Combine(candidatePath, CandidateOwnerFileName),
            $"{journal.OperationId:D}\n");
        progressHook?.Invoke("after_candidate_created");

        try
        {
            cancellationToken.ThrowIfCancellationRequested();
            var candidateDatabase = Path.Combine(candidatePath, StorageGenerationLayout.DatabaseFileName);
            var sourceDatabaseEntry = verifiedBackup.Files.Single(file =>
                file.Path == StorageGenerationLayout.DatabaseFileName);
            CopyDurablyNew(
                Path.Combine(verifiedBackup.Result.BackupPath, StorageGenerationLayout.DatabaseFileName),
                candidateDatabase,
                sourceDatabaseEntry.SizeBytes,
                sourceDatabaseEntry.Sha256);
            progressHook?.Invoke("after_candidate_copy");

            ApplyMigrations(candidateDatabase, journal.SourceSchemaVersion, journal.TargetSchemaVersion);
            FinalizeCandidateDatabase(candidateDatabase);
            progressHook?.Invoke("after_migration_steps");
            var candidate = ReadGeneration(journal.CandidateGenerationName, requireReady: false);
            ValidateCandidateInventory(verifiedBackup, candidate.Inventory, journal.TargetSchemaVersion);
            ValidatePreservedData(verifiedBackup.Result.BackupPath, candidateDatabase);
            ValidateLiveBlobs(candidate.Inventory);

            var journalSha256 = Convert.ToHexStringLower(
                SHA256.HashData(Encoding.UTF8.GetBytes(journalJson)));
            var marker = new CandidateCompletionMarker(
                JournalFormat,
                journal.OperationId,
                journalSha256,
                journal.SourceGenerationName,
                journal.CandidateGenerationName,
                journal.TargetSchemaVersion,
                verifiedBackup.Result.BackupId,
                verifiedBackup.Result.ManifestSha256);
            StorageGenerationLayout.PublishNewDurableFile(
                Path.Combine(candidatePath, CandidateMarkerFileName),
                JsonSerializer.Serialize(marker, JsonOptions) + "\n");
            progressHook?.Invoke("after_completion_marker");
            StorageGenerationLayout.PublishNewDurableFile(
                Path.Combine(candidatePath, StorageGenerationLayout.ReadyMarkerFileName),
                "ready\n");
            progressHook?.Invoke("after_ready");

            // The backup and candidate are re-read immediately before the irreversible namespace switch.
            var reverifiedBackup = VerifyJournalBackup(journal, request.BackupRoot);
            candidate = ReadGeneration(journal.CandidateGenerationName);
            ValidateCompletedCandidate(journal, journalJson, reverifiedBackup, candidate);
            progressHook?.Invoke("before_current_switch");
            StorageGenerationLayout.ReplaceCurrentDurably(
                Path.Combine(dataRoot, StorageGenerationLayout.CurrentPointerFileName),
                journal.CandidateGenerationName);
            TryReportProgress("after_current_switch");
            return Result(true, recovered, source, candidate.GenerationName, reverifiedBackup.Result);
        }
        catch
        {
            // Keep the immutable journal and exact candidate artifacts for deterministic recovery.
            throw;
        }
    }

    private GenerationSnapshot ReadCurrent()
    {
        var name = StorageGenerationLayout.ReadCurrentGeneration(
            Path.Combine(dataRoot, StorageGenerationLayout.CurrentPointerFileName));
        return ReadGeneration(name);
    }

    private CurrentPointerState TryReadCurrentPointer(out string generationName)
    {
        var path = Path.Combine(dataRoot, StorageGenerationLayout.CurrentPointerFileName);
        generationName = string.Empty;
        if (!File.Exists(path))
        {
            return CurrentPointerState.Missing;
        }

        RejectReparsePoint(path, "The CURRENT pointer must not be a reparse point.");
        try
        {
            generationName = StorageGenerationLayout.ReadCurrentGeneration(path);
            StorageGenerationLayout.ValidateGenerationName(generationName);
            return CurrentPointerState.Valid;
        }
        catch (InvalidDataException)
        {
            generationName = string.Empty;
            return CurrentPointerState.Invalid;
        }
    }

    private GenerationSnapshot ReadGeneration(string name, bool requireReady = true)
    {
        StorageGenerationLayout.ValidateGenerationName(name);
        RejectReparsePoint(dataRoot, "The data root must not be a reparse point.");
        RejectReparsePoint(
            Path.Combine(dataRoot, StorageGenerationLayout.GenerationsDirectoryName),
            "The generations directory must not be a reparse point.");
        var path = CandidatePath(name);
        if (!Directory.Exists(path) ||
            requireReady && !File.Exists(Path.Combine(path, StorageGenerationLayout.ReadyMarkerFileName)))
        {
            throw new InvalidDataException($"Storage generation '{name}' is incomplete.");
        }
        RejectReparsePoint(path, "A storage generation must not be a reparse point.");

        var databasePath = Path.Combine(path, StorageGenerationLayout.DatabaseFileName);
        if (!File.Exists(databasePath))
        {
            throw new InvalidDataException($"Storage generation '{name}' has no database.");
        }
        RejectReparsePoint(databasePath, "A storage database must not be a reparse point.");

        if (requireReady)
        {
            RejectReparsePoint(
                Path.Combine(path, StorageGenerationLayout.ReadyMarkerFileName),
                "A storage READY marker must not be a reparse point.");
        }

        return new GenerationSnapshot(
            name,
            databasePath,
            SqliteStorageBackupService.InspectSnapshot(databasePath));
    }

    private VerifiedBackupArchive VerifyPreUpdateBackup(
        StorageBackupResult backup,
        GenerationSnapshot source,
        string expectedBackupRoot)
    {
        if (!string.Equals(
                Path.GetDirectoryName(Path.GetFullPath(backup.BackupPath)),
                expectedBackupRoot,
                StringComparison.OrdinalIgnoreCase))
        {
            throw new StorageMigrationException(
                "pre_update_backup_path_invalid",
                "The mandatory pre-update backup is outside the configured backup root.");
        }

        var verified = SqliteStorageBackupService.ReadVerifiedBackup(backup.BackupPath);
        if (verified.Result.BackupId != backup.BackupId ||
            verified.Result.Kind != StorageBackupKind.PreUpdate ||
            verified.Result.SchemaVersion != source.Inventory.SchemaVersion ||
            !string.Equals(verified.Result.ManifestSha256, backup.ManifestSha256, StringComparison.Ordinal) ||
            !verified.Result.ProjectRevisions.SequenceEqual(source.Inventory.ProjectRevisions) ||
            !BlobInventory(verified).SequenceEqual(source.Inventory.Blobs))
        {
            throw new StorageMigrationException(
                "pre_update_backup_invalid",
                "The mandatory pre-update backup does not match the source generation.");
        }

        ValidatePreservedData(verified.Result.BackupPath, source.DatabasePath);

        return verified;
    }

    private static VerifiedBackupArchive VerifyJournalBackup(
        MigrationJournal journal,
        string expectedBackupRoot)
    {
        var backupPath = Path.GetFullPath(journal.PreUpdateBackup.BackupPath);
        if (!string.Equals(
                Path.GetDirectoryName(backupPath),
                Path.GetFullPath(expectedBackupRoot),
                StringComparison.OrdinalIgnoreCase))
        {
            throw new StorageMigrationException(
                "pre_update_backup_path_invalid",
                "The pre-update backup is outside the configured backup root.");
        }

        var verified = SqliteStorageBackupService.ReadVerifiedBackup(backupPath);
        var actual = verified.Result;
        var expected = journal.PreUpdateBackup;
        if (actual.BackupId != expected.BackupId ||
            actual.Kind != StorageBackupKind.PreUpdate ||
            actual.SchemaVersion != journal.SourceSchemaVersion ||
            !string.Equals(actual.ManifestSha256, expected.ManifestSha256, StringComparison.Ordinal) ||
            !string.Equals(actual.DatabaseSha256, expected.DatabaseSha256, StringComparison.Ordinal) ||
            actual.DatabaseSizeBytes != expected.DatabaseSizeBytes ||
            actual.ReferencedBlobCount != expected.ReferencedBlobCount ||
            !actual.ProjectRevisions.SequenceEqual(expected.ProjectRevisions))
        {
            throw new StorageMigrationException(
                "pre_update_backup_changed",
                "The pre-update backup recorded by the migration journal changed.");
        }

        return verified;
    }

    private void ValidateCompletedCandidate(
        MigrationJournal journal,
        string journalJson,
        VerifiedBackupArchive backup,
        GenerationSnapshot candidate)
    {
        if (!string.Equals(candidate.GenerationName, journal.CandidateGenerationName, StringComparison.Ordinal))
        {
            throw new StorageMigrationException("candidate_invalid", "The migration candidate identity is invalid.");
        }

        EnsureOwnedCandidate(CandidatePath(candidate.GenerationName), journal.OperationId);
        var candidatePath = CandidatePath(candidate.GenerationName);
        RejectReparsePoint(
            Path.Combine(candidatePath, StorageGenerationLayout.ReadyMarkerFileName),
            "The migration candidate READY marker must not be a reparse point.");
        var markerPath = Path.Combine(candidatePath, CandidateMarkerFileName);
        var marker = ReadCompletionMarker(markerPath);
        var journalSha256 = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(journalJson)));
        if (marker.Format != JournalFormat ||
            marker.OperationId != journal.OperationId ||
            !string.Equals(marker.JournalSha256, journalSha256, StringComparison.Ordinal) ||
            !string.Equals(marker.SourceGenerationName, journal.SourceGenerationName, StringComparison.Ordinal) ||
            !string.Equals(marker.CandidateGenerationName, journal.CandidateGenerationName, StringComparison.Ordinal) ||
            marker.TargetSchemaVersion != journal.TargetSchemaVersion ||
            marker.PreUpdateBackupId != backup.Result.BackupId ||
            !string.Equals(marker.PreUpdateManifestSha256, backup.Result.ManifestSha256, StringComparison.Ordinal))
        {
            throw new StorageMigrationException("candidate_invalid", "The migration completion marker is invalid.");
        }

        ValidateCandidateInventory(backup, candidate.Inventory, journal.TargetSchemaVersion);
        ValidatePreservedData(backup.Result.BackupPath, candidate.DatabasePath);
        ValidateLiveBlobs(candidate.Inventory);
    }

    private static void ValidateCandidateInventory(
        VerifiedBackupArchive backup,
        SqliteStorageBackupService.SnapshotInventory candidate,
        int targetSchemaVersion)
    {
        if (candidate.SchemaVersion != targetSchemaVersion ||
            !candidate.ProjectRevisions.SequenceEqual(backup.Result.ProjectRevisions) ||
            !candidate.Blobs.SequenceEqual(BlobInventory(backup)))
        {
            throw new StorageMigrationException(
                "candidate_invalid",
                "The migrated candidate does not preserve the verified source inventory.");
        }
    }

    private void ValidateLiveBlobs(SqliteStorageBackupService.SnapshotInventory inventory)
    {
        foreach (var blob in inventory.Blobs)
        {
            var path = Path.Combine(dataRoot, "attachments", "blobs", blob.Sha256[..2], blob.Sha256);
            if (!File.Exists(path))
            {
                throw new StorageMigrationException(
                    "referenced_blob_missing",
                    $"Referenced attachment blob '{blob.Sha256}' is missing.");
            }

            var attachmentRoot = Path.Combine(dataRoot, "attachments");
            var blobsRoot = Path.Combine(attachmentRoot, "blobs");
            var shard = Path.Combine(blobsRoot, blob.Sha256[..2]);
            RejectReparsePoint(attachmentRoot, "The attachments directory must not be a reparse point.");
            RejectReparsePoint(blobsRoot, "The attachment blob directory must not be a reparse point.");
            RejectReparsePoint(shard, "The attachment shard must not be a reparse point.");
            RejectReparsePoint(path, "An attachment blob must not be a reparse point.");

            using var stream = File.OpenRead(path);
            if (stream.Length != blob.SizeBytes ||
                !string.Equals(
                    Convert.ToHexStringLower(SHA256.HashData(stream)),
                    blob.Sha256,
                    StringComparison.Ordinal))
            {
                throw new StorageMigrationException(
                    "referenced_blob_corrupt",
                    $"Referenced attachment blob '{blob.Sha256}' is corrupt.");
            }
        }
    }

    private void ApplyMigrations(string databasePath, int sourceVersion, int targetVersion)
    {
        using var connection = new SqliteConnection(new SqliteConnectionStringBuilder
        {
            DataSource = databasePath,
            Mode = SqliteOpenMode.ReadWrite,
            Cache = SqliteCacheMode.Private,
            Pooling = false,
        }.ToString());
        connection.Open();
        using (var settings = connection.CreateCommand())
        {
            settings.CommandText = "PRAGMA foreign_keys = ON; PRAGMA synchronous = FULL; PRAGMA journal_mode = DELETE;";
            settings.ExecuteNonQuery();
        }

        var version = SqliteStorage.ValidateSchema(connection);
        if (version != sourceVersion)
        {
            throw new InvalidDataException("The candidate source schema changed before migration.");
        }

        while (version < targetVersion)
        {
            var previous = version;
            version = SqliteStorage.ApplyNextMigration(
                connection,
                version,
                () => progressHook?.Invoke($"inside_migration_step_{previous}_to_{previous + 1}"));
            if (version != previous + 1)
            {
                throw new InvalidDataException("A schema migration did not advance exactly one version.");
            }

            if (SqliteStorage.ValidateSchema(connection) != version)
            {
                throw new InvalidDataException($"Schema migration {previous} to {version} failed validation.");
            }
        }

        if (version != targetVersion)
        {
            throw new InvalidDataException("The schema migration did not reach its exact target.");
        }
    }

    private static void FinalizeCandidateDatabase(string databasePath)
    {
        foreach (var suffix in new[] { "-wal", "-shm", "-journal" })
        {
            if (File.Exists($"{databasePath}{suffix}"))
            {
                throw new StorageMigrationException(
                    "candidate_sqlite_sidecar_present",
                    $"The migrated candidate retained an unexpected SQLite '{suffix}' sidecar.");
            }
        }

        using var stream = new FileStream(
            databasePath,
            FileMode.Open,
            FileAccess.ReadWrite,
            FileShare.None,
            bufferSize: 4096,
            FileOptions.WriteThrough);
        stream.Flush(flushToDisk: true);
    }

    private static IReadOnlyList<SqliteStorageBackupService.SnapshotBlob> BlobInventory(
        VerifiedBackupArchive backup) =>
        backup.Files
            .Where(file => file.Path != StorageGenerationLayout.DatabaseFileName)
            .Select(file => new SqliteStorageBackupService.SnapshotBlob(file.Sha256, file.SizeBytes))
            .OrderBy(blob => blob.Sha256, StringComparer.Ordinal)
            .ToArray();

    private string CandidatePath(string generationName) =>
        Path.Combine(dataRoot, StorageGenerationLayout.GenerationsDirectoryName, generationName);

    private static string AllocateNextGenerationName(string generationsPath)
    {
        Directory.CreateDirectory(generationsPath);
        RejectReparsePoint(generationsPath, "The generations directory must not be a reparse point.");
        var maximum = 0;
        foreach (var directory in Directory.EnumerateFileSystemEntries(generationsPath))
        {
            var name = Path.GetFileName(directory);
            try
            {
                if (!Directory.Exists(directory))
                {
                    throw new InvalidDataException("Every generation entry must be a directory.");
                }
                RejectReparsePoint(directory, "A storage generation must not be a reparse point.");
                StorageGenerationLayout.ValidateGenerationName(name);
                maximum = Math.Max(
                    maximum,
                    int.Parse(name.AsSpan("generation-".Length), CultureInfo.InvariantCulture));
            }
            catch (Exception error) when (error is InvalidDataException or FormatException or OverflowException)
            {
                throw new InvalidDataException("The generations directory contains an invalid generation name.", error);
            }
        }

        if (maximum == 99_999_999)
        {
            throw new InvalidOperationException("No storage generation names remain.");
        }

        return $"generation-{maximum + 1:00000000}";
    }

    private static void CopyDurablyNew(
        string sourcePath,
        string destinationPath,
        long expectedSize,
        string expectedSha256)
    {
        var temporary = Path.Combine(
            Path.GetDirectoryName(destinationPath)!,
            $".{Path.GetFileName(destinationPath)}.{Guid.NewGuid():N}.tmp");
        try
        {
            using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
            long size = 0;
            using (var source = new FileStream(sourcePath, FileMode.Open, FileAccess.Read, FileShare.Read))
            using (var destination = new FileStream(
                       temporary,
                       FileMode.CreateNew,
                       FileAccess.Write,
                       FileShare.None,
                       128 * 1024,
                       FileOptions.WriteThrough))
            {
                var buffer = new byte[128 * 1024];
                int count;
                while ((count = source.Read(buffer, 0, buffer.Length)) != 0)
                {
                    size = checked(size + count);
                    hash.AppendData(buffer, 0, count);
                    destination.Write(buffer, 0, count);
                }

                destination.Flush(flushToDisk: true);
            }

            if (size != expectedSize ||
                !string.Equals(Convert.ToHexStringLower(hash.GetHashAndReset()), expectedSha256, StringComparison.Ordinal))
            {
                throw new StorageMigrationException(
                    "pre_update_backup_changed",
                    "The pre-update database changed while the migration candidate was copied.");
            }

            StorageGenerationLayout.MoveNewDurably(temporary, destinationPath);
        }
        finally
        {
            try
            {
                File.Delete(temporary);
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException)
            {
            }
        }
    }

    private static string SerializeJournal(MigrationJournal journal) =>
        JsonSerializer.Serialize(journal, JsonOptions) + "\n";

    private static (MigrationJournal Journal, string Json) ReadJournal(string path)
    {
        string json;
        try
        {
            RejectReparsePoint(path, "The migration journal must not be a reparse point.");
            json = File.ReadAllText(path, Encoding.UTF8);
            using var document = JsonDocument.Parse(json);
            RejectDuplicateJsonProperties(document.RootElement);
            var allowed = new HashSet<string>(StringComparer.Ordinal)
            {
                "format", "operationId", "sourceGenerationName", "sourceSchemaVersion",
                "candidateGenerationName", "targetSchemaVersion", "appVersion", "preUpdateBackup",
            };
            var properties = document.RootElement.ValueKind == JsonValueKind.Object
                ? document.RootElement.EnumerateObject().ToArray()
                : [];
            if (properties.Length != allowed.Count ||
                properties.Select(property => property.Name).ToHashSet(StringComparer.Ordinal)
                    .SetEquals(allowed) is false)
            {
                throw new InvalidDataException("The migration journal shape is invalid.");
            }
            var backup = document.RootElement.GetProperty("preUpdateBackup");
            var allowedBackup = new HashSet<string>(StringComparer.Ordinal)
            {
                "backupId", "backupPath", "kind", "createdUtc", "schemaVersion", "manifestSha256",
                "databaseSha256", "databaseSizeBytes", "referencedBlobCount", "projectRevisions",
            };
            if (backup.ValueKind != JsonValueKind.Object ||
                backup.EnumerateObject().Count() != allowedBackup.Count ||
                !backup.EnumerateObject().Select(property => property.Name).ToHashSet(StringComparer.Ordinal)
                    .SetEquals(allowedBackup))
            {
                throw new InvalidDataException("The migration backup identity shape is invalid.");
            }
            foreach (var revision in backup.GetProperty("projectRevisions").EnumerateArray())
            {
                var names = revision.EnumerateObject().Select(property => property.Name).ToArray();
                if (names.Length != 2 || !names.ToHashSet(StringComparer.Ordinal).SetEquals(["projectId", "revision"]))
                {
                    throw new InvalidDataException("A migration project revision shape is invalid.");
                }
            }

            var journal = JsonSerializer.Deserialize<MigrationJournal>(json, JsonOptions)
                ?? throw new InvalidDataException("The migration journal is empty.");
            ValidateJournal(journal);
            return (journal, json);
        }
        catch (Exception error) when (error is IOException or JsonException or InvalidDataException or ArgumentException)
        {
            throw new StorageMigrationException(
                "migration_journal_invalid",
                "The migration journal is invalid.",
                error);
        }
    }

    private static void ValidateJournal(MigrationJournal journal)
    {
        if (journal.Format != JournalFormat ||
            journal.OperationId == Guid.Empty ||
            journal.SourceSchemaVersion <= 0 ||
            journal.TargetSchemaVersion != SqliteStorage.CurrentSchemaVersion ||
            journal.SourceSchemaVersion >= journal.TargetSchemaVersion ||
            !SqliteStorage.HasCompleteMigrationPath(journal.SourceSchemaVersion, journal.TargetSchemaVersion) ||
            journal.PreUpdateBackup is null ||
            journal.PreUpdateBackup.Kind != StorageBackupKind.PreUpdate ||
            journal.PreUpdateBackup.SchemaVersion != journal.SourceSchemaVersion ||
            string.IsNullOrWhiteSpace(journal.AppVersion) || journal.AppVersion.Length > 128 ||
            journal.AppVersion.Any(char.IsControl))
        {
            throw new InvalidDataException("The migration journal values are invalid.");
        }

        StorageGenerationLayout.ValidateGenerationName(journal.SourceGenerationName);
        StorageGenerationLayout.ValidateGenerationName(journal.CandidateGenerationName);
        if (string.Equals(
                journal.SourceGenerationName,
                journal.CandidateGenerationName,
                StringComparison.Ordinal))
        {
            throw new InvalidDataException("The source and candidate generation names must differ.");
        }
    }

    private static CandidateCompletionMarker ReadCompletionMarker(string path)
    {
        try
        {
            RejectReparsePoint(path, "The migration completion marker must not be a reparse point.");
            var json = File.ReadAllText(path);
            using var document = JsonDocument.Parse(json);
            RejectDuplicateJsonProperties(document.RootElement);
            var allowed = new HashSet<string>(StringComparer.Ordinal)
            {
                "format", "operationId", "journalSha256", "sourceGenerationName",
                "candidateGenerationName", "targetSchemaVersion", "preUpdateBackupId",
                "preUpdateManifestSha256",
            };
            var properties = document.RootElement.ValueKind == JsonValueKind.Object
                ? document.RootElement.EnumerateObject().ToArray()
                : [];
            if (properties.Length != allowed.Count ||
                !properties.Select(property => property.Name).ToHashSet(StringComparer.Ordinal).SetEquals(allowed))
            {
                throw new InvalidDataException("The migration completion marker shape is invalid.");
            }

            return JsonSerializer.Deserialize<CandidateCompletionMarker>(json, JsonOptions)
                ?? throw new InvalidDataException("The migration completion marker is empty.");
        }
        catch (Exception error) when (error is IOException or JsonException or InvalidDataException)
        {
            throw new StorageMigrationException(
                "candidate_invalid",
                "The migration completion marker is invalid.",
                error);
        }
    }

    private static void EnsureOwnedCandidate(string path, Guid operationId)
    {
        RejectReparsePoint(path, "The migration candidate must not be a reparse point.");
        var owner = Path.Combine(path, CandidateOwnerFileName);
        if (File.Exists(owner))
        {
            RejectReparsePoint(owner, "The migration candidate owner marker must not be a reparse point.");
        }

        if (!File.Exists(owner) ||
            !string.Equals(File.ReadAllText(owner, Encoding.UTF8), $"{operationId:D}\n", StringComparison.Ordinal))
        {
            throw new StorageMigrationException(
                "candidate_owner_invalid",
                "The migration candidate is not owned by the recorded operation.");
        }
    }

    private static void DeleteOwnedCandidate(string path, Guid operationId)
    {
        EnsureOwnedCandidate(path, operationId);
        ValidateNoReparseEntries(path);
        Directory.Delete(path, recursive: true);
    }

    private static void ValidateNoReparseEntries(string root)
    {
        var pending = new Stack<string>();
        pending.Push(root);
        while (pending.Count > 0)
        {
            var directory = pending.Pop();
            RejectReparsePoint(directory, "A migration cleanup directory must not be a reparse point.");
            foreach (var entry in Directory.EnumerateFileSystemEntries(directory, "*", SearchOption.TopDirectoryOnly))
            {
                RejectReparsePoint(entry, "A migration cleanup entry must not be a reparse point.");
                if (Directory.Exists(entry))
                {
                    pending.Push(entry);
                }
                else if (!File.Exists(entry))
                {
                    throw new InvalidDataException("A migration cleanup entry changed during validation.");
                }
            }
        }
    }

    private static void DeleteJournal(string path)
    {
        File.Delete(path);
    }

    private static void TryDeleteJournal(string path)
    {
        try
        {
            DeleteJournal(path);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            // CURRENT is already the commit point. A remaining journal is verified on the next startup.
        }
    }

    private void TryReportProgress(string phase)
    {
        try
        {
            progressHook?.Invoke(phase);
        }
        catch
        {
            // Observers cannot roll back or fail a migration after CURRENT was replaced.
        }
    }

    private static int ReadRawUserVersion(string databasePath)
    {
        using var connection = new SqliteConnection(new SqliteConnectionStringBuilder
        {
            DataSource = databasePath,
            Mode = SqliteOpenMode.ReadOnly,
            Cache = SqliteCacheMode.Private,
            Pooling = false,
        }.ToString());
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "PRAGMA user_version;";
        return Convert.ToInt32(command.ExecuteScalar(), CultureInfo.InvariantCulture);
    }

    private static void ValidatePreservedData(string backupPath, string candidateDatabasePath)
    {
        var sourceDatabasePath = Path.Combine(backupPath, StorageGenerationLayout.DatabaseFileName);
        var tableColumns = ReadDataTableColumns(sourceDatabasePath);
        var expected = ComputeDataFingerprint(sourceDatabasePath, tableColumns);
        var actual = ComputeDataFingerprint(candidateDatabasePath, tableColumns);
        if (!string.Equals(expected, actual, StringComparison.Ordinal))
        {
            throw new StorageMigrationException(
                "candidate_data_changed",
                "The migration candidate did not preserve all pre-existing domain rows.");
        }
    }

    private static IReadOnlyDictionary<string, IReadOnlyList<string>> ReadDataTableColumns(string databasePath)
    {
        using var connection = OpenReadOnly(databasePath);
        using var tables = connection.CreateCommand();
        tables.CommandText =
            "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' " +
            "AND name <> 'schema_history' ORDER BY name;";
        var names = new List<string>();
        using (var reader = tables.ExecuteReader())
        {
            while (reader.Read())
            {
                names.Add(reader.GetString(0));
            }
        }

        var result = new SortedDictionary<string, IReadOnlyList<string>>(StringComparer.Ordinal);
        foreach (var name in names)
        {
            using var columns = connection.CreateCommand();
            columns.CommandText = $"PRAGMA table_info({QuoteIdentifier(name)});";
            var values = new List<string>();
            using var reader = columns.ExecuteReader();
            while (reader.Read())
            {
                values.Add(reader.GetString(1));
            }

            if (values.Count == 0)
            {
                throw new InvalidDataException($"Data table '{name}' has no columns.");
            }

            result.Add(name, values);
        }

        return result;
    }

    private static string ComputeDataFingerprint(
        string databasePath,
        IReadOnlyDictionary<string, IReadOnlyList<string>> tableColumns)
    {
        using var connection = OpenReadOnly(databasePath);
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        foreach (var (table, columns) in tableColumns)
        {
            AppendHash(hash, table);
            foreach (var column in columns)
            {
                AppendHash(hash, column);
            }

            using var command = connection.CreateCommand();
            var projection = string.Join(",", columns.Select(QuoteIdentifier));
            var ordering = string.Join(",", columns.Select(QuoteIdentifier));
            command.CommandText = $"SELECT {projection} FROM {QuoteIdentifier(table)} ORDER BY {ordering};";
            using var reader = command.ExecuteReader();
            while (reader.Read())
            {
                for (var index = 0; index < reader.FieldCount; index++)
                {
                    if (reader.IsDBNull(index))
                    {
                        AppendHash(hash, "N");
                        continue;
                    }

                    var value = reader.GetValue(index);
                    switch (value)
                    {
                        case byte[] bytes:
                            AppendHash(hash, "B");
                            AppendHash(hash, bytes);
                            break;
                        default:
                            AppendHash(hash, $"{value.GetType().Name}:{Convert.ToString(value, CultureInfo.InvariantCulture)}");
                            break;
                    }
                }
            }
        }

        return Convert.ToHexStringLower(hash.GetHashAndReset());
    }

    private static SqliteConnection OpenReadOnly(string path)
    {
        var connection = new SqliteConnection(new SqliteConnectionStringBuilder
        {
            DataSource = path,
            Mode = SqliteOpenMode.ReadOnly,
            Cache = SqliteCacheMode.Private,
            Pooling = false,
        }.ToString());
        connection.Open();
        return connection;
    }

    private static string QuoteIdentifier(string value) => $"\"{value.Replace("\"", "\"\"", StringComparison.Ordinal)}\"";

    private static void AppendHash(IncrementalHash hash, string value) =>
        AppendHash(hash, Encoding.UTF8.GetBytes(value));

    private static void AppendHash(IncrementalHash hash, byte[] bytes)
    {
        Span<byte> length = stackalloc byte[sizeof(int)];
        System.Buffers.Binary.BinaryPrimitives.WriteInt32LittleEndian(length, bytes.Length);
        hash.AppendData(length);
        hash.AppendData(bytes);
    }

    private static void ValidateRequest(StorageMigrationRequest request)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(request.BackupRoot);
        if (string.IsNullOrWhiteSpace(request.AppVersion) ||
            request.AppVersion.Length > 128 ||
            request.AppVersion.Any(char.IsControl) ||
            request.PreviousAppVersion is { Length: > 128 } ||
            request.PreviousAppVersion?.Any(char.IsControl) == true)
        {
            throw new ArgumentException("The application version is invalid.", nameof(request));
        }
    }

    private static void RejectReparsePoint(string path, string message)
    {
        if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0)
        {
            throw new InvalidDataException(message);
        }
    }

    private static void RejectDuplicateJsonProperties(JsonElement element)
    {
        if (element.ValueKind == JsonValueKind.Object)
        {
            var names = new HashSet<string>(StringComparer.Ordinal);
            foreach (var property in element.EnumerateObject())
            {
                if (!names.Add(property.Name))
                {
                    throw new InvalidDataException("A migration artifact contains a duplicate JSON property.");
                }

                RejectDuplicateJsonProperties(property.Value);
            }
        }
        else if (element.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in element.EnumerateArray())
            {
                RejectDuplicateJsonProperties(item);
            }
        }
    }

    private static StorageMigrationResult Result(
        bool migrated,
        bool recovered,
        GenerationSnapshot source,
        string currentGenerationName,
        StorageBackupResult? backup) =>
        new(
            migrated,
            recovered,
            source.Inventory.SchemaVersion,
            SqliteStorage.CurrentSchemaVersion,
            source.GenerationName,
            currentGenerationName,
            backup);

    private sealed record GenerationSnapshot(
        string GenerationName,
        string DatabasePath,
        SqliteStorageBackupService.SnapshotInventory Inventory);

    private sealed record MigrationJournal(
        int Format,
        Guid OperationId,
        string SourceGenerationName,
        int SourceSchemaVersion,
        string CandidateGenerationName,
        int TargetSchemaVersion,
        string AppVersion,
        StorageBackupResult PreUpdateBackup);

    private sealed record CandidateCompletionMarker(
        int Format,
        Guid OperationId,
        string JournalSha256,
        string SourceGenerationName,
        string CandidateGenerationName,
        int TargetSchemaVersion,
        Guid PreUpdateBackupId,
        string PreUpdateManifestSha256);

    private enum CurrentPointerState
    {
        Missing,
        Invalid,
        Valid,
    }
}
