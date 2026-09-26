using System.Globalization;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Techmap.Application;
using Techmap.Domain;

namespace Techmap.Infrastructure.Sqlite;

public sealed class SqliteProjectExportService : IProjectExportService
{
    public const int ArchiveFormat = 1;
    public const int SnapshotFormat = 4;
    public const int MaximumArchiveEntries = 4_096;
    public const long MaximumSnapshotBytes = 64L * 1024 * 1024;
    public const long MaximumTotalPayloadBytes = 4L * 1024 * 1024 * 1024;
    public const long MaximumArchiveBytes = 4L * 1024 * 1024 * 1024;
    public const string ManifestPath = "manifest.json";
    public const string ManifestChecksumPath = "manifest.sha256";
    public const string SnapshotPath = "project/snapshot.json";
    private const long MaximumAttachmentBytes = 25L * 1024 * 1024;

    private const string ProductId = "TECHMAP-GRAPHER";
    private const string ArchiveType = "project-export";
    private const int BufferSize = 128 * 1024;
    private static readonly DateTimeOffset CanonicalZipTimestamp =
        new(1980, 1, 1, 0, 0, 0, TimeSpan.Zero);
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private readonly string dataRoot;
    private readonly SqliteStorage storage;
    private readonly Action<string>? progressHook;
    private readonly SemaphoreSlim exportGate = new(1, 1);

    public SqliteProjectExportService(
        DataRootLease dataRootLease,
        SqliteStorage storage,
        Action<string>? progressHook = null)
    {
        ArgumentNullException.ThrowIfNull(dataRootLease);
        ArgumentNullException.ThrowIfNull(storage);
        dataRoot = dataRootLease.CanonicalPath;
        if (!string.Equals(dataRoot, storage.Layout.DataRootPath, StringComparison.OrdinalIgnoreCase))
        {
            throw new ArgumentException(
                "The storage and held data-root lease must identify the same directory.",
                nameof(storage));
        }

        this.storage = storage;
        this.progressHook = progressHook;
    }

    public async Task<ProjectExportResult> ExportAsync(
        ProjectExportRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        ValidateRequest(request);
        await exportGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            return await ExportCoreAsync(request, cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            exportGate.Release();
        }
    }

    private async Task<ProjectExportResult> ExportCoreAsync(
        ProjectExportRequest request,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var destinationPath = Path.GetFullPath(request.DestinationPath);
        var parent = Path.GetDirectoryName(destinationPath)
            ?? throw new ProjectExportException(
                "export_destination_invalid",
                "The project export destination must have a parent directory.");
        if (!Directory.Exists(parent))
        {
            throw new ProjectExportException(
                "export_destination_missing",
                "The project export destination directory does not exist.");
        }

        ValidateOrdinaryExistingPath(parent);
        using var destinationDirectory = DataRootLease.GuardExistingDirectory(parent);
        var physicalParent = destinationDirectory.CanonicalPath;
        var physicalDestinationPath = Path.Combine(physicalParent, Path.GetFileName(destinationPath));
        if (IsSameOrDescendant(dataRoot, physicalDestinationPath))
        {
            throw new ProjectExportException(
                "export_destination_invalid",
                "A project export must be written outside the application data root.");
        }

        destinationPath = physicalDestinationPath;
        if (File.Exists(destinationPath) || Directory.Exists(destinationPath))
        {
            throw new ProjectExportException(
                "export_destination_exists",
                "The project export destination already exists.");
        }

        var snapshot = ReadSnapshot(request.ProjectId);
        var snapshotBytes = CanonicalJson(snapshot);
        if (snapshotBytes.LongLength > MaximumSnapshotBytes)
        {
            throw new ProjectExportException(
                "export_snapshot_too_large",
                $"The project snapshot exceeds {MaximumSnapshotBytes} bytes.");
        }

        var blobs = snapshot.Attachments
            .Select(item => new BlobPayload(item.ContentSha256, item.SizeBytes))
            .Concat(snapshot.ComponentSnapshots.SelectMany(item => item.Assets)
                .Select(item => new BlobPayload(item.ContentSha256, item.SizeBytes)))
            .GroupBy(item => item.Sha256, StringComparer.Ordinal)
            .Select(group =>
            {
                var sizes = group.Select(item => item.SizeBytes).Distinct().ToArray();
                if (sizes.Length != 1)
                {
                    throw new InvalidDataException(
                        $"Attachment blob '{group.Key}' has conflicting size metadata.");
                }

                return new BlobPayload(group.Key, sizes[0]);
            })
            .OrderBy(item => item.Sha256, StringComparer.Ordinal)
            .ToArray();
        var payloads = new List<ExportPayload>(blobs.Length + 1)
        {
            new(SnapshotPath, snapshotBytes.LongLength, Sha256(snapshotBytes)),
        };
        payloads.AddRange(blobs.Select(blob => new ExportPayload(
            BlobArchivePath(blob.Sha256),
            blob.SizeBytes,
            blob.Sha256)));
        payloads.Sort((left, right) => string.CompareOrdinal(left.Path, right.Path));
        ValidatePayloadBudget(payloads);

        var manifest = new ExportManifest(
            ArchiveFormat,
            ProductId,
            ArchiveType,
            SnapshotFormat,
            storage.Diagnostics.SchemaVersion,
            request.AppVersion,
            Format(request.ProjectId.Value),
            snapshot.Project.Revision,
            payloads);
        var manifestBytes = CanonicalJson(manifest);
        var manifestSha256 = Sha256(manifestBytes);
        var stagingPath = Path.Combine(
            physicalParent,
            $".{Path.GetFileName(destinationPath)}.{Guid.NewGuid():N}.staging");
        try
        {
            progressHook?.Invoke("after_destination_guard");
            ValidateDestinationDirectory(physicalParent, destinationDirectory.Identity);
            await WriteArchiveAsync(
                stagingPath,
                manifestBytes,
                manifestSha256,
                snapshotBytes,
                blobs,
                cancellationToken).ConfigureAwait(false);
            progressHook?.Invoke("after_archive_write");
            var verified = await VerifyArchiveAsync(stagingPath, cancellationToken).ConfigureAwait(false);
            if (!string.Equals(verified.ManifestSha256, manifestSha256, StringComparison.Ordinal) ||
                !string.Equals(verified.ProjectId, Format(request.ProjectId.Value), StringComparison.Ordinal) ||
                verified.ProjectRevision != snapshot.Project.Revision)
            {
                throw new ProjectExportException(
                    "export_validation_failed",
                    "The completed project export does not match its source snapshot.");
            }

            var archiveInfo = new FileInfo(stagingPath);
            if (archiveInfo.Length > MaximumArchiveBytes)
            {
                throw new ProjectExportException(
                    "export_archive_too_large",
                    $"The project export exceeds {MaximumArchiveBytes} bytes.");
            }

            var archiveSha256 = await HashFileAsync(stagingPath, cancellationToken).ConfigureAwait(false);
            progressHook?.Invoke("before_publish");
            cancellationToken.ThrowIfCancellationRequested();
            ValidateDestinationDirectory(physicalParent, destinationDirectory.Identity);
            if (File.Exists(destinationPath) || Directory.Exists(destinationPath))
            {
                throw new ProjectExportException(
                    "export_destination_exists",
                    "The project export destination was occupied before publication.");
            }

            StorageGenerationLayout.MoveNewDurably(stagingPath, destinationPath);
            TryReportProgress("after_publish");
            return new ProjectExportResult(
                request.ProjectId,
                snapshot.Project.Revision,
                destinationPath,
                archiveInfo.Length,
                archiveSha256,
                manifestSha256,
                payloads.Count,
                blobs.Length);
        }
        catch (Exception error) when (
            error is not ProjectExportException and not OperationCanceledException)
        {
            throw new ProjectExportException(
                "project_export_failed",
                "The project export failed before publication.",
                error);
        }
        finally
        {
            TryDeleteStaging(stagingPath);
        }
    }

    private ProjectSnapshot ReadSnapshot(ProjectIdentity projectId) =>
        storage.ExecuteRead(unitOfWork =>
        {
            var project = ReadProject(unitOfWork, projectId);
            var harnesses = ReadHarnesses(unitOfWork, projectId);
            var attachments = ReadAttachments(unitOfWork, projectId);
            var pinned = ReadPinned(unitOfWork, projectId);
            var componentSnapshots = ReadComponentSnapshots(unitOfWork, projectId);
            var componentPlacements = ReadComponentPlacements(unitOfWork, projectId);
            return new ProjectSnapshot(
                SnapshotFormat,
                project,
                harnesses,
                attachments,
                pinned,
                componentSnapshots,
                componentPlacements);
        });

    private static IReadOnlyList<ExportComponentSnapshot> ReadComponentSnapshots(
        SqliteUnitOfWork unitOfWork,
        ProjectIdentity projectId)
    {
        using var command = unitOfWork.CreateCommand(
            """
            SELECT snapshot_id, source_template_id, source_version, source_version_sha256,
                   schema_version, code, name, content_json, content_sha256,
                   created_utc, updated_utc
            FROM project_component_snapshots
            WHERE project_id = $projectId
              AND EXISTS (
                  SELECT 1
                  FROM harness_component_placements p
                  INNER JOIN harnesses h ON h.harness_id = p.harness_id
                  INNER JOIN harness_design_documents d ON d.harness_id = p.harness_id
                  WHERE h.project_id = $projectId
                    AND p.snapshot_id = project_component_snapshots.snapshot_id
                    AND EXISTS (
                        SELECT 1 FROM json_each(json_extract(d.content_json, '$.connectors')) c
                        WHERE json_extract(c.value, '$.id') = p.placement_id))
            ORDER BY snapshot_id;
            """);
        command.Parameters.AddWithValue("$projectId", Format(projectId.Value));
        using var reader = command.ExecuteReader();
        var rows = new List<(string SnapshotId, string TemplateId, int Version, string VersionHash,
            int Schema, string Code, string Name, string Content, string ContentHash,
            string CreatedUtc, string UpdatedUtc)>();
        while (reader.Read()) rows.Add((
            ParseGuid(reader.GetString(0)), ParseGuid(reader.GetString(1)), reader.GetInt32(2),
            reader.GetString(3), reader.GetInt32(4), reader.GetString(5), reader.GetString(6),
            reader.GetString(7), reader.GetString(8), NormalizeUtc(reader.GetString(9)),
            NormalizeUtc(reader.GetString(10))));
        reader.Close();
        var result = new List<ExportComponentSnapshot>(rows.Count);
        foreach (var row in rows)
        {
            var bindings = ReadComponentBindings(unitOfWork, row.SnapshotId);
            var assets = ReadComponentAssets(unitOfWork, row.SnapshotId);
            using var content = JsonDocument.Parse(row.Content);
            if (!string.Equals(Sha256(Encoding.UTF8.GetBytes(row.Content)), row.ContentHash, StringComparison.Ordinal))
                throw new InvalidDataException("A project component snapshot content hash is invalid.");
            result.Add(new ExportComponentSnapshot(
                row.SnapshotId, row.TemplateId, row.Version, row.VersionHash, row.Schema,
                row.Code, row.Name, bindings, assets, content.RootElement.Clone(),
                row.CreatedUtc, row.UpdatedUtc));
        }
        return result;
    }

    private static IReadOnlyList<ExportComponentArticleBinding> ReadComponentBindings(
        SqliteUnitOfWork unitOfWork,
        string snapshotId)
    {
        using var command = unitOfWork.CreateCommand(
            """
            SELECT source_id, entity_type, article_key
            FROM project_component_snapshot_article_bindings
            WHERE snapshot_id = $snapshotId ORDER BY binding_ordinal;
            """);
        command.Parameters.AddWithValue("$snapshotId", snapshotId);
        using var reader = command.ExecuteReader();
        var result = new List<ExportComponentArticleBinding>();
        while (reader.Read()) result.Add(new(reader.GetString(0), reader.GetString(1), reader.GetString(2)));
        return result;
    }

    private static IReadOnlyList<ExportComponentAsset> ReadComponentAssets(
        SqliteUnitOfWork unitOfWork,
        string snapshotId)
    {
        using var command = unitOfWork.CreateCommand(
            """
            SELECT a.asset_id, a.file_name, a.media_type, a.content_sha256, b.size_bytes
            FROM project_component_snapshot_asset_refs a
            INNER JOIN attachment_blobs b ON b.content_sha256 = a.content_sha256
            WHERE a.snapshot_id = $snapshotId ORDER BY a.asset_ordinal;
            """);
        command.Parameters.AddWithValue("$snapshotId", snapshotId);
        using var reader = command.ExecuteReader();
        var result = new List<ExportComponentAsset>();
        while (reader.Read()) result.Add(new(
            ParseGuid(reader.GetString(0)), reader.GetString(1), reader.GetString(2),
            reader.GetString(3), reader.GetInt64(4)));
        return result;
    }

    private static IReadOnlyList<ExportComponentPlacement> ReadComponentPlacements(
        SqliteUnitOfWork unitOfWork,
        ProjectIdentity projectId)
    {
        using var command = unitOfWork.CreateCommand(
            """
            SELECT p.placement_id, p.harness_id, p.snapshot_id, p.source_id,
                   p.entity_type, p.article_key, p.instance_json, p.created_utc, p.updated_utc
            FROM harness_component_placements p
            INNER JOIN harnesses h ON h.harness_id = p.harness_id
            INNER JOIN harness_design_documents d ON d.harness_id = p.harness_id
            WHERE h.project_id = $projectId
              AND EXISTS (
                  SELECT 1 FROM json_each(json_extract(d.content_json, '$.connectors')) c
                  WHERE json_extract(c.value, '$.id') = p.placement_id)
            ORDER BY p.harness_id, p.placement_id;
            """);
        command.Parameters.AddWithValue("$projectId", Format(projectId.Value));
        using var reader = command.ExecuteReader();
        var result = new List<ExportComponentPlacement>();
        while (reader.Read())
        {
            using var instance = JsonDocument.Parse(reader.GetString(6));
            result.Add(new ExportComponentPlacement(
                ParseGuid(reader.GetString(0)), ParseGuid(reader.GetString(1)), ParseGuid(reader.GetString(2)),
                reader.GetString(3), reader.GetString(4), reader.GetString(5), instance.RootElement.Clone(),
                NormalizeUtc(reader.GetString(7)), NormalizeUtc(reader.GetString(8))));
        }
        return result;
    }

    private static ExportProject ReadProject(SqliteUnitOfWork unitOfWork, ProjectIdentity projectId)
    {
        using var command = unitOfWork.CreateCommand(
            """
            SELECT project_id, designation, project_increment, name, batch_quantity,
                   status, revision, created_utc, updated_utc
            FROM projects
            WHERE project_id = $projectId;
            """);
        command.Parameters.AddWithValue("$projectId", Format(projectId.Value));
        using var reader = command.ExecuteReader();
        if (!reader.Read())
        {
            throw new ProjectExportException("project_not_found", "The project does not exist.");
        }

        var status = reader.GetString(5);
        if (!ProjectRules.TryParseStatus(status, out _))
        {
            throw new InvalidDataException("The project status is invalid.");
        }

        return new ExportProject(
            ParseGuid(reader.GetString(0)),
            reader.GetString(1),
            reader.GetInt64(2),
            reader.GetString(3),
            Math.Min(reader.GetInt64(4), ProjectRules.MaximumHarnessQuantity),
            status,
            reader.GetInt64(6),
            NormalizeUtc(reader.GetString(7)),
            NormalizeUtc(reader.GetString(8)));
    }

    private static IReadOnlyList<ExportHarness> ReadHarnesses(
        SqliteUnitOfWork unitOfWork,
        ProjectIdentity projectId)
    {
        using var designsCommand = unitOfWork.CreateCommand(
            """
            SELECT d.harness_id, d.schema_version, d.content_json
            FROM harness_design_documents d
            INNER JOIN harnesses h ON h.harness_id = d.harness_id
            WHERE h.project_id = $projectId
            ORDER BY d.harness_id;
            """);
        designsCommand.Parameters.AddWithValue("$projectId", Format(projectId.Value));
        using var designReader = designsCommand.ExecuteReader();
        var designs = new Dictionary<string, ExportHarnessDesign>(StringComparer.Ordinal);
        while (designReader.Read())
        {
            var harnessId = ParseGuid(designReader.GetString(0));
            var schemaVersion = designReader.GetInt32(1);
            using var content = JsonDocument.Parse(designReader.GetString(2), new JsonDocumentOptions
            {
                AllowTrailingCommas = false,
                CommentHandling = JsonCommentHandling.Disallow,
                MaxDepth = 128,
            });
            var design = new ExportHarnessDesign(schemaVersion, content.RootElement.Clone());
            if (!IsValidHarnessDesign(design) || !designs.TryAdd(harnessId, design))
            {
                throw new InvalidDataException("A harness design document is invalid.");
            }
        }

        using var documentsCommand = unitOfWork.CreateCommand(
            """
            SELECT d.harness_id, d.document_id, d.section_kind, d.status,
                   d.created_utc, d.updated_utc
            FROM harness_documents d
            INNER JOIN harnesses h ON h.harness_id = d.harness_id
            WHERE h.project_id = $projectId
            ORDER BY d.harness_id,
                     CASE d.section_kind WHEN 'e4' THEN 0 WHEN 'drawing' THEN 1 ELSE 2 END;
            """);
        documentsCommand.Parameters.AddWithValue("$projectId", Format(projectId.Value));
        using var documentReader = documentsCommand.ExecuteReader();
        var documents = new Dictionary<string, List<ExportHarnessDocument>>(StringComparer.Ordinal);
        while (documentReader.Read())
        {
            var harnessId = ParseGuid(documentReader.GetString(0));
            if (!documents.TryGetValue(harnessId, out var list))
            {
                list = [];
                documents.Add(harnessId, list);
            }

            list.Add(new ExportHarnessDocument(
                ParseGuid(documentReader.GetString(1)),
                documentReader.GetString(2),
                documentReader.GetString(3),
                NormalizeUtc(documentReader.GetString(4)),
                NormalizeUtc(documentReader.GetString(5))));
        }

        using var command = unitOfWork.CreateCommand(
            """
            SELECT harness_id, designation, quantity, sort_order, created_utc, updated_utc
            FROM harnesses
            WHERE project_id = $projectId
            ORDER BY sort_order, harness_id;
            """);
        command.Parameters.AddWithValue("$projectId", Format(projectId.Value));
        using var reader = command.ExecuteReader();
        var result = new List<ExportHarness>();
        while (reader.Read())
        {
            var harnessId = ParseGuid(reader.GetString(0));
            result.Add(new ExportHarness(
                harnessId,
                reader.GetString(1),
                reader.GetInt64(2),
                reader.GetInt32(3),
                NormalizeUtc(reader.GetString(4)),
                NormalizeUtc(reader.GetString(5)),
                documents.TryGetValue(harnessId, out var harnessDocuments)
                    ? harnessDocuments
                    : throw new InvalidDataException("A harness document workspace is incomplete."),
                designs.TryGetValue(harnessId, out var harnessDesign)
                    ? harnessDesign
                    : throw new InvalidDataException("A harness design document is missing.")));
        }

        if (result.Count > ProjectRules.MaximumHarnesses)
        {
            throw new InvalidDataException("The project exceeds the supported harness limit.");
        }

        return result;
    }

    private static IReadOnlyList<ExportAttachment> ReadAttachments(
        SqliteUnitOfWork unitOfWork,
        ProjectIdentity projectId)
    {
        using var count = unitOfWork.CreateCommand(
            "SELECT COUNT(*) FROM project_attachments WHERE project_id = $projectId;");
        count.Parameters.AddWithValue("$projectId", Format(projectId.Value));
        var expectedCount = Convert.ToInt64(count.ExecuteScalar(), CultureInfo.InvariantCulture);
        if (expectedCount > MaximumArchiveEntries - 2)
        {
            throw new ProjectExportException(
                "export_entry_limit_exceeded",
                $"A project export cannot contain more than {MaximumArchiveEntries} archive entries.");
        }

        using var command = unitOfWork.CreateCommand(
            """
            SELECT a.attachment_id, a.content_sha256, b.size_bytes, a.file_name,
                   a.media_type, a.purpose, a.created_utc
            FROM project_attachments a
            INNER JOIN attachment_blobs b ON b.content_sha256 = a.content_sha256
            WHERE a.project_id = $projectId
            ORDER BY a.created_utc, a.attachment_id;
            """);
        command.Parameters.AddWithValue("$projectId", Format(projectId.Value));
        using var reader = command.ExecuteReader();
        var result = new List<ExportAttachment>();
        while (reader.Read())
        {
            var sha256 = reader.GetString(1);
            var sizeBytes = reader.GetInt64(2);
            ValidateSha256(sha256);
            if (sizeBytes is < 0 or > MaximumAttachmentBytes)
            {
                throw new InvalidDataException("An attachment size is invalid.");
            }

            result.Add(new ExportAttachment(
                ParseGuid(reader.GetString(0)),
                sha256,
                sizeBytes,
                reader.GetString(3),
                reader.GetString(4),
                reader.GetString(5),
                NormalizeUtc(reader.GetString(6))));
        }

        if (result.Count != expectedCount)
        {
            throw new InvalidDataException("An attachment reference has no matching blob metadata.");
        }

        return result;
    }

    private static IReadOnlyList<ExportPinnedCharacteristic> ReadPinned(
        SqliteUnitOfWork unitOfWork,
        ProjectIdentity projectId)
    {
        using var count = unitOfWork.CreateCommand(
            "SELECT COUNT(*) FROM pinned_characteristics WHERE project_id = $projectId;");
        count.Parameters.AddWithValue("$projectId", Format(projectId.Value));
        if (Convert.ToInt64(count.ExecuteScalar(), CultureInfo.InvariantCulture) > MaximumArchiveEntries)
        {
            throw new ProjectExportException(
                "export_record_limit_exceeded",
                $"A project export cannot contain more than {MaximumArchiveEntries} pinned records.");
        }

        using var command = unitOfWork.CreateCommand(
            """
            SELECT snapshot_id, source_kind, source_record_key, source_version,
                   characteristic_name, characteristic_value, unit, canonical_payload,
                   payload_sha256, captured_utc
            FROM pinned_characteristics
            WHERE project_id = $projectId
            ORDER BY captured_utc, snapshot_id;
            """);
        command.Parameters.AddWithValue("$projectId", Format(projectId.Value));
        using var reader = command.ExecuteReader();
        var result = new List<ExportPinnedCharacteristic>();
        while (reader.Read())
        {
            var snapshotId = ParseGuid(reader.GetString(0));
            var canonicalPayload = reader.GetString(7);
            var payloadSha256 = reader.GetString(8);
            ValidateSha256(payloadSha256);
            if (!string.Equals(Sha256(Encoding.UTF8.GetBytes(canonicalPayload)), payloadSha256, StringComparison.Ordinal))
            {
                throw new InvalidDataException($"Pinned characteristic '{snapshotId}' has a corrupt payload hash.");
            }

            var capturedUtc = NormalizeUtc(reader.GetString(9));
            var reconstructed = ExternalCharacteristicSnapshot.Capture(
                new CharacteristicSnapshotIdentity(Guid.ParseExact(snapshotId, "D")),
                reader.GetString(1),
                reader.GetString(2),
                reader.GetString(3),
                reader.GetString(4),
                reader.GetString(5),
                reader.GetString(6),
                DateTimeOffset.ParseExact(capturedUtc, "O", CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind));
            if (!string.Equals(reconstructed.CanonicalPayload, canonicalPayload, StringComparison.Ordinal))
            {
                throw new InvalidDataException($"Pinned characteristic '{snapshotId}' is not canonical.");
            }

            result.Add(new ExportPinnedCharacteristic(
                snapshotId,
                reconstructed.SourceKind,
                reconstructed.SourceRecordKey,
                reconstructed.SourceVersionFingerprint,
                reconstructed.CharacteristicName,
                reconstructed.CharacteristicValue,
                reconstructed.Unit,
                canonicalPayload,
                payloadSha256,
                capturedUtc));
        }

        return result;
    }

    private async Task WriteArchiveAsync(
        string path,
        byte[] manifestBytes,
        string manifestSha256,
        byte[] snapshotBytes,
        IReadOnlyList<BlobPayload> blobs,
        CancellationToken cancellationToken)
    {
        await using var file = new FileStream(
            path,
            FileMode.CreateNew,
            FileAccess.ReadWrite,
            FileShare.None,
            BufferSize,
            FileOptions.Asynchronous | FileOptions.SequentialScan | FileOptions.WriteThrough);
        using (var archive = new ZipArchive(file, ZipArchiveMode.Create, leaveOpen: true, entryNameEncoding: Encoding.UTF8))
        {
            foreach (var blob in blobs)
            {
                await WriteBlobEntryAsync(archive, blob, cancellationToken).ConfigureAwait(false);
            }

            await WriteBytesEntryAsync(archive, ManifestPath, manifestBytes, cancellationToken).ConfigureAwait(false);
            await WriteBytesEntryAsync(
                archive,
                ManifestChecksumPath,
                Encoding.ASCII.GetBytes($"{manifestSha256}\n"),
                cancellationToken).ConfigureAwait(false);
            await WriteBytesEntryAsync(archive, SnapshotPath, snapshotBytes, cancellationToken).ConfigureAwait(false);
        }

        await file.FlushAsync(cancellationToken).ConfigureAwait(false);
        file.Flush(flushToDisk: true);
    }

    private static async Task WriteBytesEntryAsync(
        ZipArchive archive,
        string path,
        byte[] content,
        CancellationToken cancellationToken)
    {
        var entry = CreateEntry(archive, path);
        await using var destination = entry.Open();
        await destination.WriteAsync(content, cancellationToken).ConfigureAwait(false);
    }

    private async Task WriteBlobEntryAsync(
        ZipArchive archive,
        BlobPayload blob,
        CancellationToken cancellationToken)
    {
        var sourcePath = BlobSourcePath(blob.Sha256);
        ValidateBlobPath(sourcePath);
        await using var source = new FileStream(
            sourcePath,
            FileMode.Open,
            FileAccess.Read,
            FileShare.Read,
            BufferSize,
            FileOptions.Asynchronous | FileOptions.SequentialScan);
        if (source.Length != blob.SizeBytes)
        {
            throw new InvalidDataException($"Attachment blob '{blob.Sha256}' has an invalid size.");
        }

        var entry = CreateEntry(archive, BlobArchivePath(blob.Sha256));
        await using var destination = entry.Open();
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        var buffer = new byte[BufferSize];
        long total = 0;
        while (true)
        {
            var count = await source.ReadAsync(buffer, cancellationToken).ConfigureAwait(false);
            if (count == 0)
            {
                break;
            }

            total = checked(total + count);
            hash.AppendData(buffer, 0, count);
            await destination.WriteAsync(buffer.AsMemory(0, count), cancellationToken).ConfigureAwait(false);
        }

        if (total != blob.SizeBytes ||
            !string.Equals(Convert.ToHexStringLower(hash.GetHashAndReset()), blob.Sha256, StringComparison.Ordinal))
        {
            throw new InvalidDataException($"Attachment blob '{blob.Sha256}' failed integrity validation.");
        }
    }

    private static ZipArchiveEntry CreateEntry(ZipArchive archive, string path)
    {
        var entry = archive.CreateEntry(path, CompressionLevel.NoCompression);
        entry.LastWriteTime = CanonicalZipTimestamp;
        entry.ExternalAttributes = 0;
        return entry;
    }

    private static async Task<VerifiedExport> VerifyArchiveAsync(
        string path,
        CancellationToken cancellationToken)
    {
        using var archive = ZipFile.OpenRead(path);
        if (archive.Entries.Count is < 3 or > MaximumArchiveEntries)
        {
            throw new InvalidDataException("The project export archive entry count is invalid.");
        }

        var entries = new Dictionary<string, ZipArchiveEntry>(StringComparer.OrdinalIgnoreCase);
        foreach (var entry in archive.Entries)
        {
            ValidateEntryPath(entry.FullName);
            RejectLinkEntry(entry);
            if (!entries.TryAdd(entry.FullName, entry))
            {
                throw new InvalidDataException("The project export contains duplicate entry names.");
            }
        }

        if (!entries.TryGetValue(ManifestPath, out var manifestEntry) ||
            !string.Equals(manifestEntry.FullName, ManifestPath, StringComparison.Ordinal))
        {
            throw new InvalidDataException("The project export manifest is missing.");
        }

        var manifestBytes = await ReadBoundedAsync(
            manifestEntry,
            MaximumSnapshotBytes,
            cancellationToken).ConfigureAwait(false);
        if (!entries.TryGetValue(ManifestChecksumPath, out var checksumEntry) ||
            !string.Equals(checksumEntry.FullName, ManifestChecksumPath, StringComparison.Ordinal))
        {
            throw new InvalidDataException("The project export manifest checksum is missing.");
        }

        var checksumBytes = await ReadBoundedAsync(checksumEntry, 65, cancellationToken).ConfigureAwait(false);
        var manifestSha256 = Sha256(manifestBytes);
        if (!checksumBytes.AsSpan().SequenceEqual(Encoding.ASCII.GetBytes($"{manifestSha256}\n")))
        {
            throw new InvalidDataException("The project export manifest checksum is invalid.");
        }

        var manifest = ReadCanonicalJson<ExportManifest>(manifestBytes);
        ValidateManifest(manifest);
        var expectedPaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            ManifestPath,
            ManifestChecksumPath,
        };
        foreach (var payload in manifest.Files)
        {
            if (!expectedPaths.Add(payload.Path) ||
                !entries.TryGetValue(payload.Path, out var entry) ||
                !string.Equals(entry.FullName, payload.Path, StringComparison.Ordinal) ||
                entry.Length != payload.SizeBytes)
            {
                throw new InvalidDataException("A project export payload does not match the manifest.");
            }

            var hash = await HashEntryAsync(entry, payload.SizeBytes, cancellationToken).ConfigureAwait(false);
            if (!string.Equals(hash, payload.Sha256, StringComparison.Ordinal))
            {
                throw new InvalidDataException($"Project export payload '{payload.Path}' is corrupt.");
            }
        }

        if (expectedPaths.Count != entries.Count)
        {
            throw new InvalidDataException("The project export contains an unlisted entry.");
        }

        var snapshotPayload = manifest.Files.Single(payload => payload.Path == SnapshotPath);
        var snapshotBytes = await ReadBoundedAsync(
            entries[SnapshotPath],
            MaximumSnapshotBytes,
            cancellationToken).ConfigureAwait(false);
        if (!string.Equals(Sha256(snapshotBytes), snapshotPayload.Sha256, StringComparison.Ordinal))
        {
            throw new InvalidDataException("The project export snapshot is corrupt.");
        }

        var snapshot = ReadCanonicalJson<ProjectSnapshot>(snapshotBytes);
        ValidateSnapshot(manifest, snapshot);
        return new VerifiedExport(
            manifestSha256,
            manifest.SourceProjectId,
            manifest.SourceProjectRevision);
    }

    private static void ValidateManifest(ExportManifest manifest)
    {
        if (manifest.ManifestFormat != ArchiveFormat ||
            manifest.ProductId != ProductId ||
            manifest.ArchiveKind != ArchiveType ||
            manifest.SnapshotFormat != SnapshotFormat ||
            manifest.SourceStorageSchemaVersion != SqliteStorage.CurrentSchemaVersion ||
            string.IsNullOrWhiteSpace(manifest.SourceAppVersion) ||
            manifest.SourceAppVersion.Length > 128 ||
            manifest.SourceAppVersion.Any(char.IsControl) ||
            !manifest.SourceAppVersion.IsNormalized(NormalizationForm.FormC) ||
            manifest.SourceProjectRevision < 0 ||
            ParseGuid(manifest.SourceProjectId) != manifest.SourceProjectId ||
            manifest.Files.Count is < 1 or >= MaximumArchiveEntries)
        {
            throw new InvalidDataException("The project export manifest is invalid.");
        }

        long total = 0;
        string? previous = null;
        var paths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var payload in manifest.Files)
        {
            ValidateEntryPath(payload.Path);
            ValidateSha256(payload.Sha256);
            if (payload.SizeBytes < 0 || !paths.Add(payload.Path) ||
                previous is not null && string.CompareOrdinal(previous, payload.Path) >= 0)
            {
                throw new InvalidDataException("The project export payload index is invalid.");
            }

            if (payload.Path == SnapshotPath)
            {
                if (payload.SizeBytes > MaximumSnapshotBytes)
                {
                    throw new InvalidDataException("The project snapshot payload is invalid.");
                }
            }
            else if (payload.Path != BlobArchivePath(payload.Sha256) ||
                     payload.SizeBytes > MaximumAttachmentBytes)
            {
                throw new InvalidDataException("An attachment payload is invalid.");
            }

            total = checked(total + payload.SizeBytes);
            previous = payload.Path;
        }

        if (!paths.Contains(SnapshotPath) || total > MaximumTotalPayloadBytes)
        {
            throw new InvalidDataException("The project export payload set is invalid.");
        }
    }

    private static void ValidateSnapshot(ExportManifest manifest, ProjectSnapshot snapshot)
    {
        if (snapshot.SnapshotFormat != SnapshotFormat ||
            snapshot.Project.ProjectId != manifest.SourceProjectId ||
            snapshot.Project.Revision != manifest.SourceProjectRevision ||
            snapshot.Project.Increment <= 0 ||
            snapshot.Project.BatchQuantity <= 0 ||
            snapshot.Project.Revision < 0 ||
            !IsCanonicalText(snapshot.Project.Designation, ProjectRules.MaximumDesignationLength, allowEmpty: false) ||
            !IsCanonicalText(snapshot.Project.Name, ProjectRules.MaximumNameLength, allowEmpty: false) ||
            !ProjectRules.TryParseStatus(snapshot.Project.Status, out _) ||
            NormalizeUtc(snapshot.Project.CreatedUtc) != snapshot.Project.CreatedUtc ||
            NormalizeUtc(snapshot.Project.UpdatedUtc) != snapshot.Project.UpdatedUtc)
        {
            throw new InvalidDataException("The project export snapshot identity is invalid.");
        }

        var harnessIds = new HashSet<string>(StringComparer.Ordinal);
        var sortOrders = new HashSet<int>();
        if (snapshot.Harnesses.Count > ProjectRules.MaximumHarnesses)
        {
            throw new InvalidDataException("The project export contains too many harnesses.");
        }

        (int SortOrder, string HarnessId)? previousHarness = null;
        foreach (var harness in snapshot.Harnesses)
        {
            if (ParseGuid(harness.HarnessId) != harness.HarnessId ||
                harness.Quantity is <= 0 or > ProjectRules.MaximumHarnessQuantity ||
                harness.SortOrder < 0 ||
                !IsCanonicalText(harness.Designation, ProjectRules.MaximumDesignationLength, allowEmpty: false) ||
                !harnessIds.Add(harness.HarnessId) ||
                !sortOrders.Add(harness.SortOrder) ||
                previousHarness is { } priorHarness &&
                    Compare(priorHarness.SortOrder, priorHarness.HarnessId, harness.SortOrder, harness.HarnessId) >= 0 ||
                NormalizeUtc(harness.CreatedUtc) != harness.CreatedUtc ||
                NormalizeUtc(harness.UpdatedUtc) != harness.UpdatedUtc ||
                harness.Documents.Count != 3 ||
                !harness.Documents.Select(document => document.Kind)
                    .SequenceEqual(new[] { "e4", "drawing", "route" }) ||
                harness.Documents.Select(document => document.DocumentId).Distinct().Count() != 3 ||
                harness.Documents.Any(document =>
                    ParseGuid(document.DocumentId) != document.DocumentId ||
                    document.Status != "empty" ||
                    NormalizeUtc(document.CreatedUtc) != document.CreatedUtc ||
                    NormalizeUtc(document.UpdatedUtc) != document.UpdatedUtc) ||
                !IsValidHarnessDesign(harness.Design))
            {
                throw new InvalidDataException("A project export harness is invalid.");
            }

            previousHarness = (harness.SortOrder, harness.HarnessId);
        }

        var attachmentIds = new HashSet<string>(StringComparer.Ordinal);
        var referencedBlobs = new Dictionary<string, long>(StringComparer.Ordinal);
        (string CreatedUtc, string AttachmentId)? previousAttachment = null;
        foreach (var attachment in snapshot.Attachments)
        {
            ValidateSha256(attachment.ContentSha256);
            if (ParseGuid(attachment.AttachmentId) != attachment.AttachmentId ||
                attachment.SizeBytes is < 0 or > MaximumAttachmentBytes ||
                !IsCanonicalText(attachment.FileName, 255, allowEmpty: false) ||
                !IsCanonicalText(attachment.MediaType, 127, allowEmpty: false) ||
                !IsCanonicalText(attachment.Purpose, 64, allowEmpty: false) ||
                !attachmentIds.Add(attachment.AttachmentId) ||
                previousAttachment is { } priorAttachment &&
                    Compare(priorAttachment.CreatedUtc, priorAttachment.AttachmentId,
                        attachment.CreatedUtc, attachment.AttachmentId) >= 0 ||
                NormalizeUtc(attachment.CreatedUtc) != attachment.CreatedUtc ||
                referencedBlobs.TryGetValue(attachment.ContentSha256, out var size) && size != attachment.SizeBytes)
            {
                throw new InvalidDataException("A project export attachment reference is invalid.");
            }

            referencedBlobs[attachment.ContentSha256] = attachment.SizeBytes;
            previousAttachment = (attachment.CreatedUtc, attachment.AttachmentId);
        }

        var componentSnapshotIds = new HashSet<string>(StringComparer.Ordinal);
        string? previousComponentSnapshotId = null;
        foreach (var component in snapshot.ComponentSnapshots)
        {
            ValidateSha256(component.SourceVersionSha256);
            if (ParseGuid(component.SnapshotId) != component.SnapshotId ||
                ParseGuid(component.SourceTemplateId) != component.SourceTemplateId ||
                component.SourceVersion <= 0 || component.SchemaVersion is not (3 or 4 or 5) ||
                !componentSnapshotIds.Add(component.SnapshotId) ||
                previousComponentSnapshotId is not null &&
                    string.CompareOrdinal(previousComponentSnapshotId, component.SnapshotId) >= 0 ||
                !IsCanonicalText(component.Code, 128, false) ||
                !IsCanonicalText(component.Name, 256, false) ||
                component.ArticleBindings.Count > SqliteComponentTemplateStore.MaximumArticleBindings ||
                component.Assets.Count > SqliteComponentTemplateStore.MaximumAssets ||
                component.Content.ValueKind != JsonValueKind.Object ||
                NormalizeUtc(component.CreatedUtc) != component.CreatedUtc ||
                NormalizeUtc(component.UpdatedUtc) != component.UpdatedUtc)
            {
                throw new InvalidDataException("A project component snapshot is invalid.");
            }
            var bindings = component.ArticleBindings.Select(item => new ComponentTemplateArticleBinding(
                item.SourceId, item.EntityType, item.ArticleKey)).ToArray();
            var assets = component.Assets.Select(item =>
            {
                ValidateSha256(item.ContentSha256);
                if (ParseGuid(item.AssetId) != item.AssetId ||
                    item.SizeBytes is <= 0 or > SqliteComponentTemplateStore.MaximumAssetBytes)
                    throw new InvalidDataException("A project component snapshot asset is invalid.");
                if (referencedBlobs.TryGetValue(item.ContentSha256, out var size) && size != item.SizeBytes)
                    throw new InvalidDataException("A shared component asset has conflicting size metadata.");
                referencedBlobs[item.ContentSha256] = item.SizeBytes;
                return new ComponentTemplateAsset(
                    Guid.ParseExact(item.AssetId, "D"),
                    new AttachmentContent(item.ContentSha256, item.SizeBytes),
                    item.FileName,
                    item.MediaType);
            }).ToArray();
            var canonical = SqliteComponentTemplateStore.ValidateAndCanonicalizeContent(
                component.Content.GetRawText(), component.SchemaVersion);
            SqliteComponentTemplateStore.EnsureV2AssetMetadataMatches(canonical, component.SchemaVersion, assets);
            var versionHash = SqliteComponentTemplateStore.ComputeVersionHash(
                Guid.ParseExact(component.SourceTemplateId, "D"), component.SourceVersion,
                component.SchemaVersion, component.Code, component.Name, bindings, assets, canonical);
            if (!string.Equals(component.SourceVersionSha256, versionHash, StringComparison.Ordinal))
                throw new InvalidDataException("A project component snapshot version hash is invalid.");
            previousComponentSnapshotId = component.SnapshotId;
        }

        var placementIds = new HashSet<string>(StringComparer.Ordinal);
        var reachableSnapshots = new HashSet<string>(StringComparer.Ordinal);
        (string HarnessId, string PlacementId)? previousPlacement = null;
        foreach (var placement in snapshot.ComponentPlacements)
        {
            if (ParseGuid(placement.PlacementId) != placement.PlacementId ||
                !placementIds.Add(placement.PlacementId) ||
                !harnessIds.Contains(placement.HarnessId) ||
                !componentSnapshotIds.Contains(placement.SnapshotId) ||
                placement.Instance.ValueKind != JsonValueKind.Object ||
                Encoding.UTF8.GetByteCount(placement.Instance.GetRawText()) >
                    SqliteProjectComponentSnapshotStore.MaximumInstanceBytes ||
                !IsCanonicalText(placement.SourceId, 128, false) ||
                !IsCanonicalText(placement.EntityType, 64, false) ||
                !IsCanonicalText(placement.ArticleKey, 512, false) ||
                previousPlacement is { } prior &&
                    Compare(prior.HarnessId, prior.PlacementId, placement.HarnessId, placement.PlacementId) >= 0 ||
                NormalizeUtc(placement.CreatedUtc) != placement.CreatedUtc ||
                NormalizeUtc(placement.UpdatedUtc) != placement.UpdatedUtc)
                throw new InvalidDataException("A project component placement is invalid.");
            var component = snapshot.ComponentSnapshots.Single(item => item.SnapshotId == placement.SnapshotId);
            var article = component.ArticleBindings.SingleOrDefault(item =>
                item.SourceId == placement.SourceId && item.EntityType == placement.EntityType &&
                item.ArticleKey == placement.ArticleKey);
            if (article is null)
                throw new InvalidDataException("A project component placement article is invalid.");
            try
            {
                SqliteProjectComponentSnapshotStore.ValidateInstanceBinding(
                    placement.Instance.GetRawText(),
                    Guid.ParseExact(placement.PlacementId, "D"),
                    Guid.ParseExact(component.SourceTemplateId, "D"),
                    component.SourceVersion,
                    component.SourceVersionSha256,
                    new ComponentTemplateArticleBinding(
                        article.SourceId, article.EntityType, article.ArticleKey));
            }
            catch (ProjectComponentSnapshotException error)
            {
                throw new InvalidDataException("A project component placement binding is invalid.", error);
            }
            reachableSnapshots.Add(placement.SnapshotId);
            previousPlacement = (placement.HarnessId, placement.PlacementId);
        }
        if (!reachableSnapshots.SetEquals(componentSnapshotIds))
            throw new InvalidDataException("The project export contains an unreachable component snapshot.");

        var payloadBlobs = manifest.Files
            .Where(payload => payload.Path != SnapshotPath)
            .ToDictionary(payload => payload.Sha256, payload => payload.SizeBytes, StringComparer.Ordinal);
        if (payloadBlobs.Count != referencedBlobs.Count ||
            referencedBlobs.Any(item => !payloadBlobs.TryGetValue(item.Key, out var size) || size != item.Value))
        {
            throw new InvalidDataException("The project export contains unreferenced or missing attachment blobs.");
        }

        var snapshotIds = new HashSet<string>(StringComparer.Ordinal);
        (string CapturedUtc, string SnapshotId)? previousPinned = null;
        foreach (var pinned in snapshot.PinnedCharacteristics)
        {
            ValidateSha256(pinned.PayloadSha256);
            if (ParseGuid(pinned.SnapshotId) != pinned.SnapshotId ||
                !snapshotIds.Add(pinned.SnapshotId) ||
                previousPinned is { } priorPinned &&
                    Compare(priorPinned.CapturedUtc, priorPinned.SnapshotId,
                        pinned.CapturedUtc, pinned.SnapshotId) >= 0 ||
                NormalizeUtc(pinned.CapturedUtc) != pinned.CapturedUtc ||
                !string.Equals(
                    Sha256(Encoding.UTF8.GetBytes(pinned.CanonicalPayload)),
                    pinned.PayloadSha256,
                    StringComparison.Ordinal))
            {
                throw new InvalidDataException("A pinned project export record is invalid.");
            }

            var reconstructed = ExternalCharacteristicSnapshot.Capture(
                new CharacteristicSnapshotIdentity(Guid.ParseExact(pinned.SnapshotId, "D")),
                pinned.SourceKind,
                pinned.SourceRecordKey,
                pinned.SourceVersion,
                pinned.CharacteristicName,
                pinned.CharacteristicValue,
                pinned.Unit,
                DateTimeOffset.ParseExact(
                    pinned.CapturedUtc,
                    "O",
                    CultureInfo.InvariantCulture,
                    DateTimeStyles.RoundtripKind));
            if (!string.Equals(reconstructed.CanonicalPayload, pinned.CanonicalPayload, StringComparison.Ordinal))
            {
                throw new InvalidDataException("A pinned project export record is not canonical.");
            }

            previousPinned = (pinned.CapturedUtc, pinned.SnapshotId);
        }
    }

    private static bool IsValidHarnessDesign(ExportHarnessDesign design)
    {
        if (design.SchemaVersion != SqliteHarnessDesignDocumentStore.CurrentContentSchemaVersion ||
            design.Content.ValueKind != JsonValueKind.Object ||
            Encoding.UTF8.GetByteCount(design.Content.GetRawText()) >
                SqliteHarnessDesignDocumentStore.MaximumContentBytes ||
            !design.Content.TryGetProperty("schemaVersion", out var contentSchemaVersion) ||
            contentSchemaVersion.ValueKind != JsonValueKind.Number ||
            !contentSchemaVersion.TryGetInt32(out var parsedSchemaVersion))
        {
            return false;
        }

        if (parsedSchemaVersion != design.SchemaVersion) return false;
        try {
            ElectricalGraphValidator.Validate(design.Content);
            ManufacturingRouteValidator.Validate(design.Content);
            HarnessStripProfileValidator.Validate(design.Content);
            SqliteHarnessDesignDocumentStore.ValidateCableInstances(design.Content);
            HarnessE4RowOrderValidator.Validate(design.Content);
        }
        catch (HarnessDesignDocumentException) { return false; }
        return true;
    }

    private static async Task<byte[]> ReadBoundedAsync(
        ZipArchiveEntry entry,
        long maximumBytes,
        CancellationToken cancellationToken)
    {
        if (entry.Length < 0 || entry.Length > maximumBytes || entry.Length > int.MaxValue)
        {
            throw new InvalidDataException($"Archive entry '{entry.FullName}' is too large.");
        }

        await using var source = entry.Open();
        using var memory = new MemoryStream((int)entry.Length);
        await source.CopyToAsync(memory, BufferSize, cancellationToken).ConfigureAwait(false);
        if (memory.Length != entry.Length)
        {
            throw new InvalidDataException($"Archive entry '{entry.FullName}' changed while reading.");
        }

        return memory.ToArray();
    }

    private static async Task<string> HashEntryAsync(
        ZipArchiveEntry entry,
        long expectedBytes,
        CancellationToken cancellationToken)
    {
        await using var source = entry.Open();
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        var buffer = new byte[BufferSize];
        long total = 0;
        while (true)
        {
            var count = await source.ReadAsync(buffer, cancellationToken).ConfigureAwait(false);
            if (count == 0)
            {
                break;
            }

            total = checked(total + count);
            if (total > expectedBytes)
            {
                throw new InvalidDataException($"Archive entry '{entry.FullName}' exceeds its declared size.");
            }

            hash.AppendData(buffer, 0, count);
        }

        if (total != expectedBytes)
        {
            throw new InvalidDataException($"Archive entry '{entry.FullName}' is truncated.");
        }

        return Convert.ToHexStringLower(hash.GetHashAndReset());
    }

    private static async Task<string> HashFileAsync(string path, CancellationToken cancellationToken)
    {
        await using var source = new FileStream(
            path,
            FileMode.Open,
            FileAccess.Read,
            FileShare.Read,
            BufferSize,
            FileOptions.Asynchronous | FileOptions.SequentialScan);
        return Convert.ToHexStringLower(await SHA256.HashDataAsync(source, cancellationToken).ConfigureAwait(false));
    }

    private static T ReadCanonicalJson<T>(byte[] bytes)
    {
        using var document = JsonDocument.Parse(bytes);
        RejectDuplicateJsonProperties(document.RootElement);
        var value = JsonSerializer.Deserialize<T>(bytes, JsonOptions)
            ?? throw new InvalidDataException("A project export JSON payload is empty.");
        if (!bytes.AsSpan().SequenceEqual(CanonicalJson(value)))
        {
            throw new InvalidDataException("A project export JSON payload is not canonical.");
        }

        return value;
    }

    private static byte[] CanonicalJson<T>(T value) => JsonSerializer.SerializeToUtf8Bytes(value, JsonOptions);

    private static void RejectDuplicateJsonProperties(JsonElement element)
    {
        if (element.ValueKind == JsonValueKind.Object)
        {
            var names = new HashSet<string>(StringComparer.Ordinal);
            foreach (var property in element.EnumerateObject())
            {
                if (!names.Add(property.Name))
                {
                    throw new InvalidDataException("A project export JSON payload contains a duplicate property.");
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

    private static void ValidatePayloadBudget(IReadOnlyList<ExportPayload> payloads)
    {
        if (payloads.Count + 2 > MaximumArchiveEntries)
        {
            throw new ProjectExportException(
                "export_entry_limit_exceeded",
                $"A project export cannot contain more than {MaximumArchiveEntries} archive entries.");
        }

        long total = 0;
        foreach (var payload in payloads)
        {
            total = checked(total + payload.SizeBytes);
            if (total > MaximumTotalPayloadBytes)
            {
                throw new ProjectExportException(
                    "export_payload_limit_exceeded",
                    $"Project export payloads cannot exceed {MaximumTotalPayloadBytes} bytes.");
            }
        }
    }

    private void ValidateBlobPath(string path)
    {
        var attachments = Path.Combine(dataRoot, "attachments");
        var blobs = Path.Combine(attachments, "blobs");
        var shard = Path.GetDirectoryName(path)
            ?? throw new InvalidDataException("An attachment blob path has no parent.");
        RejectReparsePoint(attachments, "The attachments directory must not be a reparse point.");
        RejectReparsePoint(blobs, "The attachment blob directory must not be a reparse point.");
        RejectReparsePoint(shard, "The attachment blob shard must not be a reparse point.");
        RejectReparsePoint(path, "An attachment blob must not be a reparse point.");
    }

    private string BlobSourcePath(string sha256) =>
        Path.Combine(dataRoot, "attachments", "blobs", sha256[..2], sha256);

    private static string BlobArchivePath(string sha256) =>
        $"attachments/blobs/{sha256[..2]}/{sha256}";

    private static void ValidateRequest(ProjectExportRequest request)
    {
        if (request.ProjectId.Value == Guid.Empty)
        {
            throw new ArgumentException("The project ID must not be empty.", nameof(request));
        }

        ArgumentException.ThrowIfNullOrWhiteSpace(request.DestinationPath);
        if (!request.DestinationPath.EndsWith(".techmap-project.zip", StringComparison.OrdinalIgnoreCase))
        {
            throw new ArgumentException(
                "The export destination must end with '.techmap-project.zip'.",
                nameof(request));
        }

        if (string.IsNullOrWhiteSpace(request.AppVersion) ||
            request.AppVersion.Length > 128 ||
            request.AppVersion.Any(char.IsControl) ||
            !request.AppVersion.IsNormalized(NormalizationForm.FormC))
        {
            throw new ArgumentException("The application version is invalid.", nameof(request));
        }
    }

    private static void ValidateEntryPath(string path)
    {
        if (string.IsNullOrEmpty(path) ||
            path.Length > 512 ||
            path[0] == '/' ||
            path.EndsWith('/') ||
            path.Contains('\\') ||
            path.Contains(':') ||
            path.Any(char.IsControl) ||
            path.Split('/').Any(segment => segment is "" or "." or ".."))
        {
            throw new InvalidDataException("A project export entry path is unsafe.");
        }
    }

    private static void RejectLinkEntry(ZipArchiveEntry entry)
    {
        var attributes = unchecked((uint)entry.ExternalAttributes);
        var unixType = (attributes >> 16) & 0xF000;
        if (unixType == 0xA000 || (attributes & (uint)FileAttributes.ReparsePoint) != 0)
        {
            throw new InvalidDataException("A project export entry must not be a link or reparse point.");
        }
    }

    private static void ValidateOrdinaryExistingPath(string path)
    {
        var full = Path.GetFullPath(path);
        var root = Path.GetPathRoot(full)
            ?? throw new InvalidDataException("The export destination path has no root.");
        var current = root;
        foreach (var segment in full[root.Length..].Split(
                     Path.DirectorySeparatorChar,
                     StringSplitOptions.RemoveEmptyEntries))
        {
            current = Path.Combine(current, segment);
            if (!Directory.Exists(current))
            {
                throw new DirectoryNotFoundException("The export destination directory does not exist.");
            }

            RejectReparsePoint(current, "The export destination path must not contain a reparse point.");
        }
    }

    private static void ValidateDestinationDirectory(
        string canonicalPath,
        DataRootIdentity expectedIdentity)
    {
        ValidateOrdinaryExistingPath(canonicalPath);
        using var current = DataRootLease.GuardExistingDirectory(canonicalPath);
        if (current.Identity != expectedIdentity ||
            !string.Equals(current.CanonicalPath, canonicalPath, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidDataException("The export destination directory changed during export.");
        }
    }

    private static void RejectReparsePoint(string path, string message)
    {
        if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0)
        {
            throw new InvalidDataException(message);
        }
    }

    private static bool IsSameOrDescendant(string root, string candidate)
    {
        var prefix = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        var full = Path.GetFullPath(candidate);
        return string.Equals(full.TrimEnd(Path.DirectorySeparatorChar), prefix.TrimEnd(Path.DirectorySeparatorChar), StringComparison.OrdinalIgnoreCase) ||
            full.StartsWith(prefix, StringComparison.OrdinalIgnoreCase);
    }

    private static void ValidateSha256(string value)
    {
        if (value.Length != 64 || value.Any(character => character is not (>= '0' and <= '9') and not (>= 'a' and <= 'f')))
        {
            throw new InvalidDataException("A project export SHA-256 value is invalid.");
        }
    }

    private static bool IsCanonicalText(string value, int maximumLength, bool allowEmpty) =>
        value.Length <= maximumLength &&
        (allowEmpty || value.Length > 0) &&
        string.Equals(value, value.Trim(), StringComparison.Ordinal) &&
        value.IsNormalized(NormalizationForm.FormC) &&
        !value.Any(char.IsControl);

    private static int Compare(int leftPrimary, string leftSecondary, int rightPrimary, string rightSecondary)
    {
        var primary = leftPrimary.CompareTo(rightPrimary);
        return primary != 0 ? primary : string.CompareOrdinal(leftSecondary, rightSecondary);
    }

    private static int Compare(string leftPrimary, string leftSecondary, string rightPrimary, string rightSecondary)
    {
        var primary = string.CompareOrdinal(leftPrimary, rightPrimary);
        return primary != 0 ? primary : string.CompareOrdinal(leftSecondary, rightSecondary);
    }

    private static string ParseGuid(string value) =>
        Guid.TryParseExact(value, "D", out var parsed) && parsed != Guid.Empty
            ? Format(parsed)
            : throw new InvalidDataException("A project export UUID is invalid.");

    private static string NormalizeUtc(string value)
    {
        var parsed = DateTimeOffset.ParseExact(
            value,
            "O",
            CultureInfo.InvariantCulture,
            DateTimeStyles.RoundtripKind);
        if (parsed == default)
        {
            throw new InvalidDataException("A project export timestamp is invalid.");
        }

        return FormatUtc(parsed);
    }

    private static string FormatUtc(DateTimeOffset value) =>
        value.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture);

    private static string Format(Guid value) => value.ToString("D", CultureInfo.InvariantCulture);

    private static string Sha256(byte[] value) =>
        Convert.ToHexStringLower(SHA256.HashData(value));

    private void TryReportProgress(string phase)
    {
        try
        {
            progressHook?.Invoke(phase);
        }
        catch
        {
            // The archive has already been atomically published.
        }
    }

    private static void TryDeleteStaging(string path)
    {
        try
        {
            File.Delete(path);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            // A non-published staging file can be removed by maintenance.
        }
    }

    private sealed record BlobPayload(string Sha256, long SizeBytes);
    private sealed record ExportPayload(string Path, long SizeBytes, string Sha256);
    private sealed record ExportManifest(
        int ManifestFormat,
        string ProductId,
        string ArchiveKind,
        int SnapshotFormat,
        int SourceStorageSchemaVersion,
        string SourceAppVersion,
        string SourceProjectId,
        long SourceProjectRevision,
        IReadOnlyList<ExportPayload> Files);
    private sealed record ProjectSnapshot(
        int SnapshotFormat,
        ExportProject Project,
        IReadOnlyList<ExportHarness> Harnesses,
        IReadOnlyList<ExportAttachment> Attachments,
        IReadOnlyList<ExportPinnedCharacteristic> PinnedCharacteristics,
        IReadOnlyList<ExportComponentSnapshot> ComponentSnapshots,
        IReadOnlyList<ExportComponentPlacement> ComponentPlacements);
    private sealed record ExportProject(
        string ProjectId,
        string Designation,
        long Increment,
        string Name,
        long BatchQuantity,
        string Status,
        long Revision,
        string CreatedUtc,
        string UpdatedUtc);
    private sealed record ExportHarness(
        string HarnessId,
        string Designation,
        long Quantity,
        int SortOrder,
        string CreatedUtc,
        string UpdatedUtc,
        IReadOnlyList<ExportHarnessDocument> Documents,
        ExportHarnessDesign Design);
    private sealed record ExportHarnessDesign(
        int SchemaVersion,
        JsonElement Content);
    private sealed record ExportHarnessDocument(
        string DocumentId,
        string Kind,
        string Status,
        string CreatedUtc,
        string UpdatedUtc);
    private sealed record ExportAttachment(
        string AttachmentId,
        string ContentSha256,
        long SizeBytes,
        string FileName,
        string MediaType,
        string Purpose,
        string CreatedUtc);
    private sealed record ExportPinnedCharacteristic(
        string SnapshotId,
        string SourceKind,
        string SourceRecordKey,
        string SourceVersion,
        string CharacteristicName,
        string CharacteristicValue,
        string Unit,
        string CanonicalPayload,
        string PayloadSha256,
        string CapturedUtc);
    private sealed record ExportComponentSnapshot(
        string SnapshotId,
        string SourceTemplateId,
        int SourceVersion,
        string SourceVersionSha256,
        int SchemaVersion,
        string Code,
        string Name,
        IReadOnlyList<ExportComponentArticleBinding> ArticleBindings,
        IReadOnlyList<ExportComponentAsset> Assets,
        JsonElement Content,
        string CreatedUtc,
        string UpdatedUtc);
    private sealed record ExportComponentArticleBinding(string SourceId, string EntityType, string ArticleKey);
    private sealed record ExportComponentAsset(
        string AssetId,
        string FileName,
        string MediaType,
        string ContentSha256,
        long SizeBytes);
    private sealed record ExportComponentPlacement(
        string PlacementId,
        string HarnessId,
        string SnapshotId,
        string SourceId,
        string EntityType,
        string ArticleKey,
        JsonElement Instance,
        string CreatedUtc,
        string UpdatedUtc);
    private sealed record VerifiedExport(string ManifestSha256, string ProjectId, long ProjectRevision);
}
