using System.Globalization;
using System.Collections.Concurrent;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Techmap.Application;
using Techmap.Domain;

namespace Techmap.Infrastructure.Sqlite;

public sealed class SqliteProjectImportService : IProjectImportService
{
    public const int MaximumArchiveEntries = SqliteProjectExportService.MaximumArchiveEntries;
    public const long MaximumArchiveBytes = SqliteProjectExportService.MaximumArchiveBytes;
    public const long MaximumSnapshotBytes = SqliteProjectExportService.MaximumSnapshotBytes;
    public const long MaximumTotalPayloadBytes = SqliteProjectExportService.MaximumTotalPayloadBytes;
    public const long MaximumManifestBytes = 1024L * 1024;
    public const int MaximumCompressionRatio = 100;

    private const int JournalFormat = 1;
    private const long MaximumAttachmentBytes = 25L * 1024 * 1024;
    private const int BufferSize = 128 * 1024;
    private const string ProductId = "TECHMAP-GRAPHER";
    private const string ArchiveKind = "project-export";
    private const string ManifestPath = SqliteProjectExportService.ManifestPath;
    private const string ManifestChecksumPath = SqliteProjectExportService.ManifestChecksumPath;
    private const string SnapshotPath = SqliteProjectExportService.SnapshotPath;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };
    private static readonly ConcurrentDictionary<string, SemaphoreSlim> ImportGates =
        new(StringComparer.OrdinalIgnoreCase);

    private readonly string dataRoot;
    private readonly string importsRoot;
    private readonly string stagingRoot;
    private readonly string journalsRoot;
    private readonly SqliteStorage storage;
    private readonly ContentAddressedAttachmentStore attachmentStore;
    private readonly TimeProvider timeProvider;
    private readonly Action<string>? progressHook;
    private readonly SemaphoreSlim importGate;

    public SqliteProjectImportService(
        DataRootLease dataRootLease,
        SqliteStorage storage,
        TimeProvider? timeProvider = null,
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
        this.timeProvider = timeProvider ?? TimeProvider.System;
        this.progressHook = progressHook;
        importGate = ImportGates.GetOrAdd(dataRoot, _ => new SemaphoreSlim(1, 1));
        attachmentStore = new ContentAddressedAttachmentStore(dataRoot);
        importsRoot = CreateOrdinaryDirectory(Path.Combine(dataRoot, "imports"));
        stagingRoot = CreateOrdinaryDirectory(Path.Combine(importsRoot, "staging"));
        journalsRoot = CreateOrdinaryDirectory(Path.Combine(importsRoot, "journals"));
    }

    public async Task<ProjectImportResult> ImportAsync(
        ProjectImportRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        ValidateRequest(request);
        await importGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            return await ImportCoreAsync(request, cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            importGate.Release();
        }
    }

    public async Task<IReadOnlyList<ProjectImportResult>> RecoverPendingAsync(
        CancellationToken cancellationToken = default)
    {
        await importGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            return await RecoverAllCoreAsync(null, cancellationToken).ConfigureAwait(false);
        }
        finally
        {
            importGate.Release();
        }
    }

    private async Task<ProjectImportResult> ImportCoreAsync(
        ProjectImportRequest request,
        CancellationToken cancellationToken)
    {
        var archivePath = Path.GetFullPath(request.ArchivePath);
        ValidateSourcePath(archivePath);
        await using var source = new FileStream(
            archivePath,
            FileMode.Open,
            FileAccess.Read,
            FileShare.Read,
            BufferSize,
            FileOptions.Asynchronous | FileOptions.SequentialScan);
        if (source.Length is <= 0 or > MaximumArchiveBytes)
        {
            throw Invalid("import_archive_size_invalid", "The project archive size is invalid.");
        }

        var archiveSha256 = await HashStreamAsync(source, cancellationToken).ConfigureAwait(false);
        var recovered = await RecoverAllCoreAsync(archiveSha256, cancellationToken).ConfigureAwait(false);
        if (recovered.Count > 0)
        {
            return recovered.OrderByDescending(item => item.ProjectIncrement).First();
        }

        source.Position = 0;
        var operationId = Guid.NewGuid();
        var destinationProjectId = DeterministicGuid(operationId, "project", string.Empty);
        var stagePath = Path.Combine(stagingRoot, $"import-{operationId:D}");
        Directory.CreateDirectory(stagePath);
        RejectReparsePoint(stagePath, "The project import staging directory must be ordinary.");
        StorageGenerationLayout.PublishNewDurableFile(
            Path.Combine(stagePath, "OWNER"),
            $"{operationId:D}\n");
        ImportJournal? journal = null;
        var journalPath = JournalPath(operationId);
        try
        {
            var stagedArchivePath = Path.Combine(stagePath, "source.techmap-project.zip");
            var stagedHash = await CopyStreamToDurableFileAsync(
                source,
                stagedArchivePath,
                source.Length,
                cancellationToken).ConfigureAwait(false);
            if (stagedHash != archiveSha256)
            {
                throw Invalid("import_archive_changed", "The project archive changed while it was staged.");
            }

            await using var stagedArchive = OpenOrdinaryRead(stagedArchivePath);
            var verified = await VerifyAndStageAsync(
                stagedArchive,
                archiveSha256,
                operationId,
                destinationProjectId,
                stagePath,
                request.AppVersion,
                cancellationToken).ConfigureAwait(false);
            journal = verified.Journal;
            StorageGenerationLayout.PublishNewDurableFile(
                journalPath,
                Encoding.UTF8.GetString(CanonicalJson(journal)));
            progressHook?.Invoke("after_journal");
            return await ResumeJournalAsync(journalPath, journal, recovered: false, cancellationToken)
                .ConfigureAwait(false);
        }
        catch (ProjectImportException)
        {
            if (journal is null || !File.Exists(journalPath))
            {
                TryDeleteOwnedStage(stagePath);
            }

            throw;
        }
        catch (OperationCanceledException)
        {
            if (journal is null || !File.Exists(journalPath))
            {
                TryDeleteOwnedStage(stagePath);
            }

            throw;
        }
        catch (Exception error)
        {
            if (journal is null || !File.Exists(journalPath))
            {
                TryDeleteOwnedStage(stagePath);
            }

            throw Invalid(
                "project_import_failed",
                "The project import failed before the project became visible.",
                error);
        }
    }

    private async Task<IReadOnlyList<ProjectImportResult>> RecoverAllCoreAsync(
        string? matchingArchiveSha256,
        CancellationToken cancellationToken)
    {
        ValidateImportDirectories();
        SweepAbandonedStages();
        var matching = new List<ProjectImportResult>();
        foreach (var journalPath in Directory.EnumerateFiles(
                     journalsRoot,
                     "*.project-import.json",
                     SearchOption.TopDirectoryOnly).Order(StringComparer.Ordinal))
        {
            cancellationToken.ThrowIfCancellationRequested();
            RejectReparsePoint(journalPath, "A project import journal must be ordinary.");
            var bytes = await ReadBoundedFileAsync(
                journalPath, MaximumManifestBytes, "import_journal_invalid", cancellationToken)
                .ConfigureAwait(false);

            ImportJournal journal;
            try
            {
                journal = ReadCanonicalJson<ImportJournal>(bytes);
                ValidateJournal(journal, journalPath);
            }
            catch (Exception error) when (error is not ProjectImportException)
            {
                throw Invalid("import_journal_invalid", "A project import recovery journal is invalid.", error);
            }

            var result = TryReadCommittedResult(journal, recovered: true);
            if (result is null)
            {
                await RollBackUncommittedAsync(journalPath, journal, cancellationToken).ConfigureAwait(false);
                continue;
            }

            ValidateCommittedCounts(journal, result);
            CleanupCommitted(journalPath, StagePath(journal));
            if (matchingArchiveSha256 is null ||
                string.Equals(journal.ArchiveSha256, matchingArchiveSha256, StringComparison.Ordinal))
            {
                matching.Add(result);
            }
        }

        return matching;
    }

    private async Task<ProjectImportResult> ResumeJournalAsync(
        string journalPath,
        ImportJournal journal,
        bool recovered,
        CancellationToken cancellationToken)
    {
        var committed = TryReadCommittedResult(journal, recovered);
        if (committed is not null)
        {
            ValidateCommittedCounts(journal, committed);
            CleanupCommitted(journalPath, StagePath(journal));
            return committed;
        }

        var stagePath = StagePath(journal);
        ValidateStage(journal, stagePath);
        var snapshot = await ReadStagedSnapshotAsync(journal, stagePath, cancellationToken)
            .ConfigureAwait(false);
        var firstBlob = true;
        foreach (var blob in journal.Blobs)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var stagedBlob = StagedBlobPath(stagePath, blob.Sha256);
            await using var stream = OpenOrdinaryRead(stagedBlob);
            var stored = await attachmentStore.WriteAsync(stream, cancellationToken).ConfigureAwait(false);
            if (stored.Sha256 != blob.Sha256 || stored.Length != blob.SizeBytes)
            {
                throw Invalid("import_staging_invalid", "A staged attachment changed before publication.");
            }

            if (firstBlob)
            {
                progressHook?.Invoke("after_first_blob");
                firstBlob = false;
            }
        }

        cancellationToken.ThrowIfCancellationRequested();
        ProjectImportResult result;
        try
        {
            result = storage.ExecuteInTransaction(unitOfWork =>
            {
                var existing = TryReadCommittedResult(unitOfWork, journal, recovered);
                if (existing is not null)
                {
                    return existing;
                }

                var published = PublishDatabase(unitOfWork, journal, snapshot, recovered);
                progressHook?.Invoke("before_database_commit");
                return published;
            });
        }
        catch (Exception error) when (error is not ProjectImportException)
        {
            var committedAfterError = TryReadCommittedResult(journal, recovered: true);
            if (committedAfterError is not null)
            {
                ValidateCommittedCounts(journal, committedAfterError);
                CleanupCommitted(journalPath, stagePath);
                return committedAfterError;
            }

            await RollBackUncommittedAsync(journalPath, journal, CancellationToken.None)
                .ConfigureAwait(false);
            throw Invalid(
                "project_import_failed",
                "The project import database transaction was rolled back.",
                error);
        }

        TryReportAfterCommit();
        CleanupCommitted(journalPath, stagePath);
        return result;
    }

    private async Task RollBackUncommittedAsync(
        string journalPath,
        ImportJournal journal,
        CancellationToken cancellationToken)
    {
        if (TryReadCommittedResult(journal, recovered: true) is not null)
        {
            throw Invalid("import_recovery_conflict", "A committed project import cannot be rolled back.");
        }

        foreach (var blob in journal.Blobs.Where(item => !item.ExistedBefore))
        {
            cancellationToken.ThrowIfCancellationRequested();
            var referenced = storage.ExecuteRead(unitOfWork =>
            {
                using var command = unitOfWork.CreateCommand(
                    "SELECT COUNT(*) FROM attachment_blobs WHERE content_sha256 = $sha256;");
                command.Parameters.AddWithValue("$sha256", blob.Sha256);
                return Convert.ToInt64(command.ExecuteScalar(), CultureInfo.InvariantCulture) != 0;
            });
            if (referenced || OtherJournalOwnsBlob(journal.ImportOperationId, blob.Sha256))
            {
                continue;
            }

            var path = FinalBlobPath(blob.Sha256);
            if (!File.Exists(path))
            {
                continue;
            }

            await attachmentStore.ValidateAsync(
                new StoredAttachment(blob.Sha256, blob.SizeBytes),
                cancellationToken).ConfigureAwait(false);
            RejectReparsePoint(path, "An orphan attachment blob must be ordinary.");
            File.Delete(path);
        }

        TryDeleteOwnedStage(StagePath(journal));
        if (File.Exists(journalPath))
        {
            RejectReparsePoint(journalPath, "A project import journal must be ordinary.");
            File.Delete(journalPath);
        }
    }

    private bool OtherJournalOwnsBlob(string operationId, string sha256)
    {
        foreach (var path in Directory.EnumerateFiles(journalsRoot, "*.project-import.json", SearchOption.TopDirectoryOnly))
        {
            var bytes = ReadBoundedFile(path, MaximumManifestBytes, "import_journal_invalid");
            var other = ReadCanonicalJson<ImportJournal>(bytes);
            if (other.ImportOperationId != operationId && other.Blobs.Any(item => item.Sha256 == sha256))
            {
                return true;
            }
        }

        return false;
    }

    private ProjectImportResult PublishDatabase(
        SqliteUnitOfWork unitOfWork,
        ImportJournal journal,
        ProjectSnapshot snapshot,
        bool recovered)
    {
        var increment = AllocateIncrement(unitOfWork);
        var name = AllocateName(unitOfWork, snapshot.Project.Name, increment);
        var componentPlacements = snapshot.ComponentPlacements ?? [];
        var placementIdMap = componentPlacements.ToDictionary(
            placement => Guid.ParseExact(placement.PlacementId, "D"),
            placement => DeterministicGuid(
                journal.OperationGuid, "component-placement", placement.PlacementId));
        var remappedDesigns = snapshot.Harnesses.ToDictionary(
            harness => harness.HarnessId,
            harness => ProjectComponentPlacementRemapper.RemapHarnessDesign(
                harness.Design!.Content.GetRawText(),
                componentPlacements
                    .Where(placement => placement.HarnessId == harness.HarnessId)
                    .ToDictionary(
                        placement => Guid.ParseExact(placement.PlacementId, "D"),
                        placement => placementIdMap[Guid.ParseExact(placement.PlacementId, "D")])),
            StringComparer.Ordinal);
        using (var insert = unitOfWork.CreateCommand(
                   """
                   INSERT INTO projects
                       (project_id, designation, project_increment, name, batch_quantity,
                        status, created_utc, updated_utc, revision)
                   VALUES
                       ($projectId, $designation, $increment, $name, $batchQuantity,
                        $status, $utc, $utc, 0);
                   """))
        {
            insert.Parameters.AddWithValue("$projectId", journal.DestinationProjectId);
            insert.Parameters.AddWithValue("$designation", snapshot.Project.Designation);
            insert.Parameters.AddWithValue("$increment", increment);
            insert.Parameters.AddWithValue("$name", name);
            insert.Parameters.AddWithValue("$batchQuantity", snapshot.Project.BatchQuantity);
            insert.Parameters.AddWithValue("$status", snapshot.Project.Status);
            insert.Parameters.AddWithValue("$utc", journal.ImportedUtc);
            RequireSingle(insert.ExecuteNonQuery(), "project");
        }

        foreach (var harness in snapshot.Harnesses)
        {
            using var insert = unitOfWork.CreateCommand(
                """
                INSERT INTO harnesses
                    (harness_id, project_id, designation, quantity, sort_order, created_utc, updated_utc)
                VALUES ($harnessId, $projectId, $designation, $quantity, $sortOrder, $utc, $utc);
                """);
            insert.Parameters.AddWithValue(
                "$harnessId",
                Format(DeterministicGuid(journal.OperationGuid, "harness", harness.HarnessId)));
            insert.Parameters.AddWithValue("$projectId", journal.DestinationProjectId);
            insert.Parameters.AddWithValue("$designation", harness.Designation);
            insert.Parameters.AddWithValue("$quantity", harness.Quantity!.Value);
            insert.Parameters.AddWithValue("$sortOrder", harness.SortOrder);
            insert.Parameters.AddWithValue("$utc", journal.ImportedUtc);
            RequireSingle(insert.ExecuteNonQuery(), "harness");

            using (var updateDesign = unitOfWork.CreateCommand(
                       """
                       UPDATE harness_design_documents
                       SET revision = 0,
                           schema_version = $schemaVersion,
                           content_json = $contentJson,
                           created_utc = $utc,
                           updated_utc = $utc
                       WHERE harness_id = $harnessId;
                       """))
            {
                updateDesign.Parameters.AddWithValue("$schemaVersion", harness.Design!.SchemaVersion);
                updateDesign.Parameters.AddWithValue("$contentJson", remappedDesigns[harness.HarnessId].DesignJson);
                updateDesign.Parameters.AddWithValue("$utc", journal.ImportedUtc);
                updateDesign.Parameters.AddWithValue(
                    "$harnessId",
                    Format(DeterministicGuid(journal.OperationGuid, "harness", harness.HarnessId)));
                RequireSingle(updateDesign.ExecuteNonQuery(), "harness design document");
            }

            foreach (var document in harness.Documents!)
            {
                using var insertDocument = unitOfWork.CreateCommand(
                    """
                    INSERT INTO harness_documents
                        (document_id, harness_id, section_kind, status, created_utc, updated_utc)
                    VALUES ($documentId, $harnessId, $kind, $status, $utc, $utc);
                    """);
                insertDocument.Parameters.AddWithValue(
                    "$documentId",
                    Format(DeterministicGuid(journal.OperationGuid, "document", document.DocumentId)));
                insertDocument.Parameters.AddWithValue(
                    "$harnessId",
                    Format(DeterministicGuid(journal.OperationGuid, "harness", harness.HarnessId)));
                insertDocument.Parameters.AddWithValue("$kind", document.Kind);
                insertDocument.Parameters.AddWithValue("$status", document.Status);
                insertDocument.Parameters.AddWithValue("$utc", journal.ImportedUtc);
                RequireSingle(insertDocument.ExecuteNonQuery(), "harness document");
            }
        }

        foreach (var blob in journal.Blobs)
        {
            using var insert = unitOfWork.CreateCommand(
                """
                INSERT INTO attachment_blobs (content_sha256, size_bytes, created_utc)
                VALUES ($sha256, $sizeBytes, $utc)
                ON CONFLICT(content_sha256) DO NOTHING;
                """);
            insert.Parameters.AddWithValue("$sha256", blob.Sha256);
            insert.Parameters.AddWithValue("$sizeBytes", blob.SizeBytes);
            insert.Parameters.AddWithValue("$utc", journal.ImportedUtc);
            _ = insert.ExecuteNonQuery();
            using var verify = unitOfWork.CreateCommand(
                "SELECT size_bytes FROM attachment_blobs WHERE content_sha256 = $sha256;");
            verify.Parameters.AddWithValue("$sha256", blob.Sha256);
            if (Convert.ToInt64(verify.ExecuteScalar(), CultureInfo.InvariantCulture) != blob.SizeBytes)
            {
                throw new InvalidDataException("Existing attachment metadata conflicts with the import.");
            }
        }

        foreach (var attachment in snapshot.Attachments)
        {
            using var insert = unitOfWork.CreateCommand(
                """
                INSERT INTO project_attachments
                    (attachment_id, project_id, content_sha256, file_name,
                     media_type, purpose, created_utc)
                VALUES
                    ($attachmentId, $projectId, $sha256, $fileName,
                     $mediaType, $purpose, $utc);
                """);
            insert.Parameters.AddWithValue(
                "$attachmentId",
                Format(DeterministicGuid(journal.OperationGuid, "attachment", attachment.AttachmentId)));
            insert.Parameters.AddWithValue("$projectId", journal.DestinationProjectId);
            insert.Parameters.AddWithValue("$sha256", attachment.ContentSha256);
            insert.Parameters.AddWithValue("$fileName", attachment.FileName);
            insert.Parameters.AddWithValue("$mediaType", attachment.MediaType);
            insert.Parameters.AddWithValue("$purpose", attachment.Purpose);
            insert.Parameters.AddWithValue("$utc", journal.ImportedUtc);
            RequireSingle(insert.ExecuteNonQuery(), "attachment");
        }

        foreach (var pinned in snapshot.PinnedCharacteristics)
        {
            using var insert = unitOfWork.CreateCommand(
                """
                INSERT INTO pinned_characteristics
                    (snapshot_id, project_id, source_kind, source_record_key, source_version,
                     characteristic_name, characteristic_value, unit, canonical_payload,
                     payload_sha256, captured_utc)
                VALUES
                    ($snapshotId, $projectId, $sourceKind, $sourceRecordKey, $sourceVersion,
                     $name, $value, $unit, $payload, $sha256, $capturedUtc);
                """);
            insert.Parameters.AddWithValue(
                "$snapshotId",
                Format(DeterministicGuid(journal.OperationGuid, "pinned", pinned.SnapshotId)));
            insert.Parameters.AddWithValue("$projectId", journal.DestinationProjectId);
            insert.Parameters.AddWithValue("$sourceKind", pinned.SourceKind);
            insert.Parameters.AddWithValue("$sourceRecordKey", pinned.SourceRecordKey);
            insert.Parameters.AddWithValue("$sourceVersion", pinned.SourceVersion);
            insert.Parameters.AddWithValue("$name", pinned.CharacteristicName);
            insert.Parameters.AddWithValue("$value", pinned.CharacteristicValue);
            insert.Parameters.AddWithValue("$unit", pinned.Unit);
            insert.Parameters.AddWithValue("$payload", pinned.CanonicalPayload);
            insert.Parameters.AddWithValue("$sha256", pinned.PayloadSha256);
            insert.Parameters.AddWithValue("$capturedUtc", pinned.CapturedUtc);
            RequireSingle(insert.ExecuteNonQuery(), "pinned characteristic");
        }

        var snapshotIdMap = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var component in snapshot.ComponentSnapshots ?? [])
        {
            var destinationSnapshotId = Format(DeterministicGuid(journal.OperationGuid, "component-snapshot", component.SnapshotId));
            snapshotIdMap.Add(component.SnapshotId, destinationSnapshotId);
            using var insert = unitOfWork.CreateCommand(
                """
                INSERT INTO project_component_snapshots
                    (snapshot_id, project_id, source_template_id, source_version, source_version_sha256,
                     schema_version, code, name, content_json, content_sha256, created_utc, updated_utc)
                VALUES ($snapshotId, $projectId, $templateId, $version, $versionHash, $schema,
                        $code, $name, $content, $contentHash, $createdUtc, $updatedUtc);
                """);
            insert.Parameters.AddWithValue("$snapshotId", destinationSnapshotId);
            insert.Parameters.AddWithValue("$projectId", journal.DestinationProjectId);
            insert.Parameters.AddWithValue("$templateId", component.SourceTemplateId);
            insert.Parameters.AddWithValue("$version", component.SourceVersion);
            insert.Parameters.AddWithValue("$versionHash", component.SourceVersionSha256);
            insert.Parameters.AddWithValue("$schema", component.SchemaVersion);
            insert.Parameters.AddWithValue("$code", component.Code);
            insert.Parameters.AddWithValue("$name", component.Name);
            insert.Parameters.AddWithValue("$content", component.Content.GetRawText());
            insert.Parameters.AddWithValue("$contentHash", Sha256(Encoding.UTF8.GetBytes(component.Content.GetRawText())));
            insert.Parameters.AddWithValue("$createdUtc", component.CreatedUtc);
            insert.Parameters.AddWithValue("$updatedUtc", component.UpdatedUtc);
            RequireSingle(insert.ExecuteNonQuery(), "component snapshot");
            for (var index = 0; index < component.ArticleBindings.Count; index++)
            {
                var binding = component.ArticleBindings[index];
                using var bindingInsert = unitOfWork.CreateCommand(
                    """
                    INSERT INTO project_component_snapshot_article_bindings
                        (snapshot_id, binding_ordinal, source_id, entity_type, article_key)
                    VALUES ($snapshotId, $ordinal, $sourceId, $entityType, $articleKey);
                    """);
                bindingInsert.Parameters.AddWithValue("$snapshotId", destinationSnapshotId);
                bindingInsert.Parameters.AddWithValue("$ordinal", index);
                bindingInsert.Parameters.AddWithValue("$sourceId", binding.SourceId);
                bindingInsert.Parameters.AddWithValue("$entityType", binding.EntityType);
                bindingInsert.Parameters.AddWithValue("$articleKey", binding.ArticleKey);
                RequireSingle(bindingInsert.ExecuteNonQuery(), "component snapshot binding");
            }
            for (var index = 0; index < component.Assets.Count; index++)
            {
                var asset = component.Assets[index];
                using var assetInsert = unitOfWork.CreateCommand(
                    """
                    INSERT INTO project_component_snapshot_asset_refs
                        (snapshot_id, asset_ordinal, asset_id, file_name, media_type, content_sha256)
                    VALUES ($snapshotId, $ordinal, $assetId, $fileName, $mediaType, $sha256);
                    """);
                assetInsert.Parameters.AddWithValue("$snapshotId", destinationSnapshotId);
                assetInsert.Parameters.AddWithValue("$ordinal", index);
                assetInsert.Parameters.AddWithValue("$assetId", asset.AssetId);
                assetInsert.Parameters.AddWithValue("$fileName", asset.FileName);
                assetInsert.Parameters.AddWithValue("$mediaType", asset.MediaType);
                assetInsert.Parameters.AddWithValue("$sha256", asset.ContentSha256);
                RequireSingle(assetInsert.ExecuteNonQuery(), "component snapshot asset");
            }
        }
        foreach (var placement in componentPlacements)
        {
            var sourcePlacementId = Guid.ParseExact(placement.PlacementId, "D");
            using var insert = unitOfWork.CreateCommand(
                """
                INSERT INTO harness_component_placements
                    (placement_id, harness_id, snapshot_id, source_id, entity_type, article_key,
                     instance_json, created_utc, updated_utc)
                VALUES ($placementId, $harnessId, $snapshotId, $sourceId, $entityType, $articleKey,
                        $instance, $createdUtc, $updatedUtc);
                """);
            insert.Parameters.AddWithValue("$placementId", Format(placementIdMap[sourcePlacementId]));
            insert.Parameters.AddWithValue("$harnessId", Format(DeterministicGuid(journal.OperationGuid, "harness", placement.HarnessId)));
            insert.Parameters.AddWithValue("$snapshotId", snapshotIdMap[placement.SnapshotId]);
            insert.Parameters.AddWithValue("$sourceId", placement.SourceId);
            insert.Parameters.AddWithValue("$entityType", placement.EntityType);
            insert.Parameters.AddWithValue("$articleKey", placement.ArticleKey);
            insert.Parameters.AddWithValue(
                "$instance",
                remappedDesigns[placement.HarnessId].InstancesBySourcePlacementId[sourcePlacementId]);
            insert.Parameters.AddWithValue("$createdUtc", placement.CreatedUtc);
            insert.Parameters.AddWithValue("$updatedUtc", placement.UpdatedUtc);
            RequireSingle(insert.ExecuteNonQuery(), "component placement");
        }

        using (var insert = unitOfWork.CreateCommand(
                   """
                   INSERT INTO project_imports
                       (project_id, import_operation_id, source_manifest_sha256,
                        source_archive_sha256, source_project_id, source_project_revision,
                        source_project_increment, source_storage_schema_version,
                        source_app_version, import_app_version, imported_utc)
                   VALUES
                       ($projectId, $operationId, $manifestSha256, $archiveSha256,
                        $sourceProjectId, $sourceRevision, $sourceIncrement,
                        $sourceSchema, $sourceAppVersion, $importAppVersion, $importedUtc);
                   """))
        {
            insert.Parameters.AddWithValue("$projectId", journal.DestinationProjectId);
            insert.Parameters.AddWithValue("$operationId", journal.ImportOperationId);
            insert.Parameters.AddWithValue("$manifestSha256", journal.ManifestSha256);
            insert.Parameters.AddWithValue("$archiveSha256", journal.ArchiveSha256);
            insert.Parameters.AddWithValue("$sourceProjectId", journal.SourceProjectId);
            insert.Parameters.AddWithValue("$sourceRevision", journal.SourceProjectRevision);
            insert.Parameters.AddWithValue("$sourceIncrement", journal.SourceProjectIncrement);
            insert.Parameters.AddWithValue("$sourceSchema", journal.SourceStorageSchemaVersion);
            insert.Parameters.AddWithValue("$sourceAppVersion", journal.SourceAppVersion);
            insert.Parameters.AddWithValue("$importAppVersion", journal.ImportAppVersion);
            insert.Parameters.AddWithValue("$importedUtc", journal.ImportedUtc);
            RequireSingle(insert.ExecuteNonQuery(), "import provenance");
        }

        return CreateResult(journal, increment, name, recovered);
    }

    private ProjectImportResult? TryReadCommittedResult(ImportJournal journal, bool recovered) =>
        storage.ExecuteRead(unitOfWork => TryReadCommittedResult(unitOfWork, journal, recovered));

    private static ProjectImportResult? TryReadCommittedResult(
        SqliteUnitOfWork unitOfWork,
        ImportJournal journal,
        bool recovered)
    {
        using var command = unitOfWork.CreateCommand(
            """
            SELECT p.project_id, p.project_increment, p.name, p.revision,
                   i.source_manifest_sha256,
                   i.source_archive_sha256, i.source_project_id, i.source_project_revision,
                   i.source_project_increment, i.source_storage_schema_version,
                   i.source_app_version, i.import_app_version, i.imported_utc,
                   (SELECT COUNT(*) FROM harnesses h WHERE h.project_id = p.project_id),
                   (SELECT COUNT(*) FROM project_attachments a WHERE a.project_id = p.project_id),
                   (SELECT COUNT(*) FROM pinned_characteristics c WHERE c.project_id = p.project_id)
            FROM project_imports i
            INNER JOIN projects p ON p.project_id = i.project_id
            WHERE i.import_operation_id = $operationId;
            """);
        command.Parameters.AddWithValue("$operationId", journal.ImportOperationId);
        using var reader = command.ExecuteReader();
        if (!reader.Read())
        {
            return null;
        }

        if (reader.GetString(0) != journal.DestinationProjectId ||
            reader.GetInt64(3) != 0 ||
            reader.GetString(4) != journal.ManifestSha256 ||
            reader.GetString(5) != journal.ArchiveSha256 ||
            reader.GetString(6) != journal.SourceProjectId ||
            reader.GetInt64(7) != journal.SourceProjectRevision ||
            reader.GetInt64(8) != journal.SourceProjectIncrement ||
            reader.GetInt32(9) != journal.SourceStorageSchemaVersion ||
            reader.GetString(10) != journal.SourceAppVersion ||
            reader.GetString(11) != journal.ImportAppVersion ||
            reader.GetString(12) != journal.ImportedUtc)
        {
            throw Invalid("import_recovery_conflict", "The committed import conflicts with its journal.");
        }

        return new ProjectImportResult(
            new ProjectIdentity(Guid.ParseExact(journal.DestinationProjectId, "D")),
            reader.GetInt64(1),
            reader.GetString(2),
            new ProjectIdentity(Guid.ParseExact(journal.SourceProjectId, "D")),
            journal.SourceProjectRevision,
            journal.ArchiveSha256,
            journal.ManifestSha256,
            reader.GetInt32(13),
            reader.GetInt32(14),
            reader.GetInt32(15),
            recovered);
    }

    private async Task<VerifiedStage> VerifyAndStageAsync(
        Stream source,
        string archiveSha256,
        Guid operationId,
        Guid destinationProjectId,
        string stagePath,
        string appVersion,
        CancellationToken cancellationToken)
    {
        using var archive = new ZipArchive(source, ZipArchiveMode.Read, leaveOpen: true);
        if (archive.Entries.Count is < 3 or > MaximumArchiveEntries)
        {
            throw Invalid("import_entry_count_invalid", "The project archive entry count is invalid.");
        }

        var entries = new Dictionary<string, ZipArchiveEntry>(StringComparer.OrdinalIgnoreCase);
        long declaredTotal = 0;
        long compressedTotal = 0;
        foreach (var entry in archive.Entries)
        {
            ValidateEntry(entry);
            if (!entries.TryAdd(entry.FullName, entry))
            {
                throw Invalid("import_duplicate_entry", "The project archive contains duplicate entry names.");
            }

            declaredTotal = CheckedAdd(declaredTotal, entry.Length, "import_payload_limit_exceeded");
            compressedTotal = CheckedAdd(compressedTotal, entry.CompressedLength, "import_archive_size_invalid");
            ValidateCompressionRatio(entry.Length, entry.CompressedLength);
        }

        if (declaredTotal > MaximumTotalPayloadBytes + MaximumManifestBytes + 65 ||
            declaredTotal > Math.Max(1L, compressedTotal) * MaximumCompressionRatio)
        {
            throw Invalid("import_compression_ratio_exceeded", "The project archive expansion ratio is unsafe.");
        }

        var manifestEntry = ExactEntry(entries, ManifestPath, "import_manifest_missing");
        var checksumEntry = ExactEntry(entries, ManifestChecksumPath, "import_manifest_checksum_missing");
        var manifestBytes = await ReadBoundedAsync(manifestEntry, MaximumManifestBytes, cancellationToken)
            .ConfigureAwait(false);
        var checksumBytes = await ReadBoundedAsync(checksumEntry, 65, cancellationToken).ConfigureAwait(false);
        var manifestSha256 = Sha256(manifestBytes);
        if (!checksumBytes.AsSpan().SequenceEqual(Encoding.ASCII.GetBytes($"{manifestSha256}\n")))
        {
            throw Invalid("import_manifest_checksum_invalid", "The project archive manifest checksum is invalid.");
        }

        ExportManifest manifest;
        try
        {
            manifest = ReadCanonicalJson<ExportManifest>(manifestBytes);
            ValidateManifest(manifest);
        }
        catch (ProjectImportException)
        {
            throw;
        }
        catch (Exception error)
        {
            throw Invalid("import_manifest_invalid", "The project archive manifest is invalid.", error);
        }

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
                throw Invalid("import_payload_mismatch", "A project archive payload does not match the manifest.");
            }
        }

        if (expectedPaths.Count != entries.Count)
        {
            throw Invalid("import_unlisted_entry", "The project archive contains an unlisted entry.");
        }

        var snapshotPayload = manifest.Files.Single(item => item.Path == SnapshotPath);
        var snapshotBytes = await ReadBoundedAsync(
            entries[SnapshotPath],
            MaximumSnapshotBytes,
            cancellationToken).ConfigureAwait(false);
        if (Sha256(snapshotBytes) != snapshotPayload.Sha256)
        {
            throw Invalid("import_payload_hash_invalid", "The project snapshot hash is invalid.");
        }

        ProjectSnapshot snapshot;
        try
        {
            snapshot = ReadCanonicalJson<ProjectSnapshot>(snapshotBytes);
            ValidateSnapshot(manifest, snapshot);
            snapshot = MigrateSnapshotToCurrent(snapshot);
        }
        catch (ProjectImportException)
        {
            throw;
        }
        catch (Exception error)
        {
            throw Invalid("import_snapshot_invalid", "The project snapshot is invalid.", error);
        }

        await WriteDurableFileAsync(
            Path.Combine(stagePath, "snapshot.json"),
            snapshotBytes,
            cancellationToken).ConfigureAwait(false);
        await WriteDurableFileAsync(
            Path.Combine(stagePath, "manifest.json"),
            manifestBytes,
            cancellationToken).ConfigureAwait(false);
        var blobs = new List<ImportBlob>();
        foreach (var payload in manifest.Files.Where(item => item.Path != SnapshotPath))
        {
            var entry = entries[payload.Path];
            var stagedPath = StagedBlobPath(stagePath, payload.Sha256);
            Directory.CreateDirectory(Path.GetDirectoryName(stagedPath)!);
            var hash = await CopyEntryToDurableFileAsync(
                entry,
                stagedPath,
                payload.SizeBytes,
                cancellationToken).ConfigureAwait(false);
            if (hash != payload.Sha256)
            {
                throw Invalid("import_payload_hash_invalid", $"Attachment '{payload.Sha256}' is corrupt.");
            }

            var existedBefore = await BlobExistsAndIsValidAsync(payload, cancellationToken).ConfigureAwait(false);
            blobs.Add(new ImportBlob(payload.Sha256, payload.SizeBytes, existedBefore));
        }

        blobs.Sort((left, right) => string.CompareOrdinal(left.Sha256, right.Sha256));
        var importedUtc = timeProvider.GetUtcNow().ToUniversalTime().ToString("O", CultureInfo.InvariantCulture);
        var journal = new ImportJournal(
            JournalFormat,
            Format(operationId),
            archiveSha256,
            manifestSha256,
            manifest.SourceProjectId,
            manifest.SourceProjectRevision,
            snapshot.Project.Increment,
            manifest.SourceStorageSchemaVersion,
            manifest.SourceAppVersion,
            appVersion,
            Format(destinationProjectId),
            Path.GetRelativePath(importsRoot, stagePath).Replace('\\', '/'),
            snapshotPayload.Sha256,
            importedUtc,
            manifest.SnapshotFormat,
            snapshot.Harnesses.Count,
            snapshot.Attachments.Count,
            snapshot.PinnedCharacteristics.Count,
            HashExpectedHarnesses(operationId, snapshot.Harnesses),
            HashExpectedAttachments(operationId, snapshot.Attachments),
            HashExpectedPinnedCharacteristics(operationId, snapshot.PinnedCharacteristics),
            blobs);
        await WriteDurableFileAsync(
            Path.Combine(stagePath, "COMPLETE.json"),
            CanonicalJson(journal),
            cancellationToken).ConfigureAwait(false);
        return new VerifiedStage(journal);
    }

    private static void ValidateManifest(ExportManifest manifest)
    {
        if (manifest.ManifestFormat != SqliteProjectExportService.ArchiveFormat ||
            manifest.ProductId != ProductId ||
            manifest.ArchiveKind != ArchiveKind ||
            manifest.SnapshotFormat is not (1 or 2 or 3 or SqliteProjectExportService.SnapshotFormat) ||
            manifest.SourceStorageSchemaVersion is <= 0 or > 1_000_000 ||
            !IsCanonicalText(manifest.SourceAppVersion, 128, allowEmpty: false) ||
            ParseGuid(manifest.SourceProjectId) != manifest.SourceProjectId ||
            manifest.SourceProjectRevision < 0 ||
            manifest.Files.Count is < 1 or >= MaximumArchiveEntries)
        {
            throw Invalid("import_manifest_incompatible", "The project archive format or version is unsupported.");
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
                throw Invalid("import_manifest_invalid", "The project archive payload index is invalid.");
            }

            if (payload.Path == SnapshotPath)
            {
                if (payload.SizeBytes > MaximumSnapshotBytes)
                {
                    throw Invalid("import_entry_too_large", "The project snapshot is too large.");
                }
            }
            else if (payload.Path != BlobArchivePath(payload.Sha256) || payload.SizeBytes > MaximumAttachmentBytes)
            {
                throw Invalid("import_manifest_invalid", "An attachment payload is invalid.");
            }

            total = CheckedAdd(total, payload.SizeBytes, "import_payload_limit_exceeded");
            previous = payload.Path;
        }

        if (!paths.Contains(SnapshotPath) || total > MaximumTotalPayloadBytes)
        {
            throw Invalid("import_payload_limit_exceeded", "The project archive payload set is invalid.");
        }
    }

    private static void ValidateSnapshot(ExportManifest manifest, ProjectSnapshot snapshot)
    {
        if (snapshot.SnapshotFormat != manifest.SnapshotFormat ||
            snapshot.Project.ProjectId != manifest.SourceProjectId ||
            snapshot.Project.Revision != manifest.SourceProjectRevision ||
            snapshot.Project.Increment <= 0 || snapshot.Project.BatchQuantity <= 0 ||
            snapshot.SnapshotFormat == 1 && snapshot.Harnesses.Count > 0 &&
                snapshot.Project.BatchQuantity > ProjectRules.MaximumHarnessQuantity ||
            snapshot.Project.Revision < 0 ||
            !IsCanonicalText(snapshot.Project.Designation, ProjectRules.MaximumDesignationLength, false) ||
            !IsCanonicalText(snapshot.Project.Name, ProjectRules.MaximumNameLength, false) ||
            !ProjectRules.TryParseStatus(snapshot.Project.Status, out _) ||
            NormalizeUtc(snapshot.Project.CreatedUtc) != snapshot.Project.CreatedUtc ||
            NormalizeUtc(snapshot.Project.UpdatedUtc) != snapshot.Project.UpdatedUtc)
        {
            throw Invalid("import_snapshot_invalid", "The project snapshot identity is invalid.");
        }

        if (snapshot.Harnesses.Count > ProjectRules.MaximumHarnesses)
        {
            throw Invalid("import_snapshot_limit_exceeded", "The project contains too many harnesses.");
        }


        if (snapshot.Attachments.Count > MaximumArchiveEntries - 2 ||
            snapshot.PinnedCharacteristics.Count > MaximumArchiveEntries)
        {
            throw Invalid("import_snapshot_limit_exceeded", "The project snapshot contains too many records.");
        }

        var harnessIds = new HashSet<string>(StringComparer.Ordinal);
        var orders = new HashSet<int>();
        (int, string)? previousHarness = null;
        foreach (var item in snapshot.Harnesses)
        {
            if (ParseGuid(item.HarnessId) != item.HarnessId || item.SortOrder < 0 ||
                (snapshot.SnapshotFormat is 2 or SqliteProjectExportService.SnapshotFormat &&
                    (item.Quantity is null or <= 0 or > ProjectRules.MaximumHarnessQuantity ||
                     item.Documents is null || item.Documents.Count != 3)) ||
                (snapshot.SnapshotFormat == 1 &&
                    (item.Quantity is not null || item.Documents is not null || item.Design is not null)) ||
                (snapshot.SnapshotFormat == 2 && item.Design is not null) ||
                (snapshot.SnapshotFormat == SqliteProjectExportService.SnapshotFormat &&
                    (item.Design is null || !IsValidHarnessDesign(item.Design))) ||
                !IsCanonicalText(item.Designation, ProjectRules.MaximumDesignationLength, false) ||
                !harnessIds.Add(item.HarnessId) || !orders.Add(item.SortOrder) ||
                previousHarness is { } previous && Compare(previous.Item1, previous.Item2, item.SortOrder, item.HarnessId) >= 0 ||
                NormalizeUtc(item.CreatedUtc) != item.CreatedUtc || NormalizeUtc(item.UpdatedUtc) != item.UpdatedUtc)
            {
                throw Invalid("import_snapshot_invalid", "A project harness is invalid.");
            }

            if (item.Documents is not null &&
                (!item.Documents.Select(document => document.Kind)
                    .SequenceEqual(new[] { "e4", "drawing", "route" }) ||
                 item.Documents.Select(document => document.DocumentId).Distinct().Count() != 3 ||
                 item.Documents.Any(document =>
                     ParseGuid(document.DocumentId) != document.DocumentId ||
                     document.Status != "empty" ||
                     NormalizeUtc(document.CreatedUtc) != document.CreatedUtc ||
                     NormalizeUtc(document.UpdatedUtc) != document.UpdatedUtc)))
            {
                throw Invalid("import_snapshot_invalid", "A harness document workspace is invalid.");
            }

            previousHarness = (item.SortOrder, item.HarnessId);
        }

        var attachmentIds = new HashSet<string>(StringComparer.Ordinal);
        var referenced = new Dictionary<string, long>(StringComparer.Ordinal);
        (string, string)? previousAttachment = null;
        foreach (var item in snapshot.Attachments)
        {
            ValidateSha256(item.ContentSha256);
            if (ParseGuid(item.AttachmentId) != item.AttachmentId ||
                item.SizeBytes is < 0 or > MaximumAttachmentBytes ||
                !IsCanonicalText(item.FileName, 255, false) ||
                !IsCanonicalText(item.MediaType, 127, false) ||
                !IsCanonicalText(item.Purpose, 64, false) ||
                !IsValidFileName(item.FileName) ||
                !IsValidToken(item.MediaType, allowSlash: true) ||
                !IsValidToken(item.Purpose, allowSlash: false) ||
                !attachmentIds.Add(item.AttachmentId) ||
                previousAttachment is { } previous && Compare(previous.Item1, previous.Item2, item.CreatedUtc, item.AttachmentId) >= 0 ||
                NormalizeUtc(item.CreatedUtc) != item.CreatedUtc ||
                referenced.TryGetValue(item.ContentSha256, out var priorSize) && priorSize != item.SizeBytes)
            {
                throw Invalid("import_snapshot_invalid", "A project attachment reference is invalid.");
            }

            referenced[item.ContentSha256] = item.SizeBytes;
            previousAttachment = (item.CreatedUtc, item.AttachmentId);
        }

        var pinnedIds = new HashSet<string>(StringComparer.Ordinal);
        (string, string)? previousPinned = null;
        foreach (var item in snapshot.PinnedCharacteristics)
        {
            ValidateSha256(item.PayloadSha256);
            if (ParseGuid(item.SnapshotId) != item.SnapshotId || !pinnedIds.Add(item.SnapshotId) ||
                previousPinned is { } previous && Compare(previous.Item1, previous.Item2, item.CapturedUtc, item.SnapshotId) >= 0 ||
                NormalizeUtc(item.CapturedUtc) != item.CapturedUtc ||
                Sha256(Encoding.UTF8.GetBytes(item.CanonicalPayload)) != item.PayloadSha256)
            {
                throw Invalid("import_snapshot_invalid", "A pinned characteristic is invalid.");
            }

            var reconstructed = ExternalCharacteristicSnapshot.Capture(
                new CharacteristicSnapshotIdentity(Guid.ParseExact(item.SnapshotId, "D")),
                item.SourceKind,
                item.SourceRecordKey,
                item.SourceVersion,
                item.CharacteristicName,
                item.CharacteristicValue,
                item.Unit,
                DateTimeOffset.ParseExact(item.CapturedUtc, "O", CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind));
            if (reconstructed.CanonicalPayload != item.CanonicalPayload)
            {
                throw Invalid("import_snapshot_invalid", "A pinned characteristic payload is not canonical.");
            }

            previousPinned = (item.CapturedUtc, item.SnapshotId);
        }

        var componentSnapshots = snapshot.ComponentSnapshots ?? [];
        var componentPlacements = snapshot.ComponentPlacements ?? [];
        if (snapshot.SnapshotFormat == SqliteProjectExportService.SnapshotFormat)
        {
            var componentSnapshotIds = new HashSet<string>(StringComparer.Ordinal);
            foreach (var component in componentSnapshots)
            {
                ValidateSha256(component.SourceVersionSha256);
                if (ParseGuid(component.SnapshotId) != component.SnapshotId ||
                    ParseGuid(component.SourceTemplateId) != component.SourceTemplateId ||
                    component.SourceVersion <= 0 || component.SchemaVersion is not (3 or 4) ||
                    !componentSnapshotIds.Add(component.SnapshotId) ||
                    !IsCanonicalText(component.Code, 128, false) ||
                    !IsCanonicalText(component.Name, 256, false) ||
                    component.ArticleBindings.Count > SqliteComponentTemplateStore.MaximumArticleBindings ||
                    component.Assets.Count > SqliteComponentTemplateStore.MaximumAssets ||
                    component.Content.ValueKind != JsonValueKind.Object ||
                    NormalizeUtc(component.CreatedUtc) != component.CreatedUtc ||
                    NormalizeUtc(component.UpdatedUtc) != component.UpdatedUtc)
                    throw Invalid("import_snapshot_invalid", "A project component snapshot is invalid.");

                var bindings = component.ArticleBindings.Select(item => new ComponentTemplateArticleBinding(
                    item.SourceId, item.EntityType, item.ArticleKey)).ToArray();
                var assets = component.Assets.Select(item =>
                {
                    ValidateSha256(item.ContentSha256);
                    if (ParseGuid(item.AssetId) != item.AssetId ||
                        item.SizeBytes is <= 0 or > SqliteComponentTemplateStore.MaximumAssetBytes)
                        throw Invalid("import_snapshot_invalid", "A project component asset is invalid.");
                    if (referenced.TryGetValue(item.ContentSha256, out var priorSize) && priorSize != item.SizeBytes)
                        throw Invalid("import_snapshot_invalid", "A shared component asset has conflicting size metadata.");
                    referenced[item.ContentSha256] = item.SizeBytes;
                    return new ComponentTemplateAsset(
                        Guid.ParseExact(item.AssetId, "D"),
                        new AttachmentContent(item.ContentSha256, item.SizeBytes), item.FileName, item.MediaType);
                }).ToArray();
                var canonical = SqliteComponentTemplateStore.ValidateAndCanonicalizeContent(
                    component.Content.GetRawText(), component.SchemaVersion);
                SqliteComponentTemplateStore.EnsureV2AssetMetadataMatches(canonical, component.SchemaVersion, assets);
                var versionHash = SqliteComponentTemplateStore.ComputeVersionHash(
                    Guid.ParseExact(component.SourceTemplateId, "D"), component.SourceVersion,
                    component.SchemaVersion, component.Code, component.Name, bindings, assets, canonical);
                if (!string.Equals(versionHash, component.SourceVersionSha256, StringComparison.Ordinal))
                    throw Invalid("import_snapshot_invalid", "A project component snapshot hash is invalid.");
            }

            var reachable = new HashSet<string>(StringComparer.Ordinal);
            var placementIds = new HashSet<string>(StringComparer.Ordinal);
            foreach (var placement in componentPlacements)
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
                    !IsCanonicalText(placement.ArticleKey, 512, false))
                    throw Invalid("import_snapshot_invalid", "A project component placement is invalid.");
                var component = componentSnapshots.Single(item => item.SnapshotId == placement.SnapshotId);
                var article = component.ArticleBindings.SingleOrDefault(item =>
                    item.SourceId == placement.SourceId && item.EntityType == placement.EntityType &&
                    item.ArticleKey == placement.ArticleKey);
                if (article is null)
                    throw Invalid("import_snapshot_invalid", "A project component placement article is invalid.");
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
                    throw Invalid(
                        "import_snapshot_invalid",
                        "A project component placement binding is invalid.",
                        inner: error);
                }
                reachable.Add(placement.SnapshotId);
            }
            if (!reachable.SetEquals(componentSnapshotIds))
                throw Invalid("import_snapshot_invalid", "The archive contains an unreachable component snapshot.");
        }
        else if (componentSnapshots.Count != 0 || componentPlacements.Count != 0)
        {
            throw Invalid("import_snapshot_invalid", "A legacy archive cannot contain component snapshots.");
        }

        var payloadBlobs = manifest.Files.Where(item => item.Path != SnapshotPath)
            .ToDictionary(item => item.Sha256, item => item.SizeBytes, StringComparer.Ordinal);
        if (payloadBlobs.Count != referenced.Count ||
            referenced.Any(item => !payloadBlobs.TryGetValue(item.Key, out var size) || size != item.Value))
        {
            throw Invalid("import_blob_reference_invalid", "The archive has missing or unreferenced attachment blobs.");
        }
    }

    private static ProjectSnapshot MigrateSnapshotToCurrent(ProjectSnapshot snapshot)
    {
        if (snapshot.SnapshotFormat == SqliteProjectExportService.SnapshotFormat)
        {
            return snapshot;
        }

        if (snapshot.SnapshotFormat is not (1 or 2 or 3))
        {
            throw Invalid("import_snapshot_version_unsupported", "The project snapshot version is unsupported.");
        }

        var legacyFormat = snapshot.SnapshotFormat;
        return snapshot with
        {
            SnapshotFormat = SqliteProjectExportService.SnapshotFormat,
            Harnesses = snapshot.Harnesses.Select(harness => harness with
            {
                Quantity = legacyFormat == 1 ? snapshot.Project.BatchQuantity : harness.Quantity,
                Documents = legacyFormat == 1
                    ? new[] { "e4", "drawing", "route" }.Select(kind =>
                        new ExportHarnessDocument(
                            Format(DeterministicGuid(Guid.ParseExact(harness.HarnessId, "D"), "document", kind)),
                            kind,
                            "empty",
                            harness.CreatedUtc,
                            harness.UpdatedUtc)).ToArray()
                    : harness.Documents,
                Design = legacyFormat is 1 or 2 ? CreateEmptyHarnessDesign() : harness.Design,
            }).ToArray(),
            ComponentSnapshots = [],
            ComponentPlacements = [],
        };
    }

    private static ExportHarnessDesign CreateEmptyHarnessDesign()
    {
        using var content = JsonDocument.Parse(
            """
            {"schemaVersion":1,"connectors":[],"wires":[],"views":{"e4":{"layers":[{"id":"dimensions","name":"Размеры","order":2,"visible":true,"locked":false},{"id":"connectors","name":"Соединители","order":1,"visible":true,"locked":false},{"id":"wires","name":"Провода","order":0,"visible":true,"locked":false}]},"drawing":{"layers":[{"id":"dimensions","name":"Размеры","order":2,"visible":true,"locked":false},{"id":"connectors","name":"Соединители","order":1,"visible":true,"locked":false},{"id":"wires","name":"Провода","order":0,"visible":true,"locked":false}]}}}
            """);
        return new ExportHarnessDesign(
            SqliteHarnessDesignDocumentStore.CurrentContentSchemaVersion,
            content.RootElement.Clone());
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

        return parsedSchemaVersion == design.SchemaVersion;
    }

    private async Task<ProjectSnapshot> ReadStagedSnapshotAsync(
        ImportJournal journal,
        string stagePath,
        CancellationToken cancellationToken)
    {
        var path = Path.Combine(stagePath, "snapshot.json");
        RejectOrdinaryPathToRoot(stagePath, path, "The staged project snapshot must be ordinary.");
        var bytes = await ReadBoundedFileAsync(
            path, MaximumSnapshotBytes, "import_staging_invalid", cancellationToken).ConfigureAwait(false);
        if (Sha256(bytes) != journal.SnapshotSha256)
        {
            throw Invalid("import_staging_invalid", "The staged project snapshot is corrupt.");
        }

        var manifestPath = Path.Combine(stagePath, "manifest.json");
        RejectOrdinaryPathToRoot(stagePath, manifestPath, "The staged project manifest must be ordinary.");
        var manifestBytes = await ReadBoundedFileAsync(
            manifestPath, MaximumManifestBytes, "import_staging_invalid", cancellationToken).ConfigureAwait(false);
        if (Sha256(manifestBytes) != journal.ManifestSha256)
        {
            throw Invalid("import_staging_invalid", "The staged project manifest is corrupt.");
        }

        var manifest = ReadCanonicalJson<ExportManifest>(manifestBytes);
        ValidateManifest(manifest);
        var snapshot = ReadCanonicalJson<ProjectSnapshot>(bytes);
        ValidateSnapshot(manifest, snapshot);
        snapshot = MigrateSnapshotToCurrent(snapshot);
        var manifestBlobs = manifest.Files
            .Where(item => item.Path != SnapshotPath)
            .Select(item => (item.Sha256, item.SizeBytes))
            .OrderBy(item => item.Sha256, StringComparer.Ordinal)
            .ToArray();
        var journalBlobs = journal.Blobs.Select(item => (item.Sha256, item.SizeBytes)).ToArray();
        if (!manifestBlobs.SequenceEqual(journalBlobs))
        {
            throw Invalid("import_staging_invalid", "The staged payload index conflicts with its journal.");
        }
        if (snapshot.Project.ProjectId != journal.SourceProjectId ||
            snapshot.Project.Revision != journal.SourceProjectRevision ||
            snapshot.Project.Increment != journal.SourceProjectIncrement ||
            snapshot.Harnesses.Count != journal.HarnessCount ||
            snapshot.Attachments.Count != journal.AttachmentCount ||
            snapshot.PinnedCharacteristics.Count != journal.PinnedCharacteristicCount)
        {
            throw Invalid("import_staging_invalid", "The staged snapshot conflicts with its journal.");
        }

        return snapshot;
    }

    private void ValidateJournal(ImportJournal journal, string path)
    {
        var operationId = ParseGuid(journal.ImportOperationId);
        if (journal.JournalFormat != JournalFormat ||
            Path.GetFileName(path) != $"{operationId}.project-import.json" ||
            ParseGuid(journal.DestinationProjectId) != journal.DestinationProjectId ||
            ParseGuid(journal.SourceProjectId) != journal.SourceProjectId ||
            Format(DeterministicGuid(Guid.ParseExact(operationId, "D"), "project", string.Empty)) != journal.DestinationProjectId ||
            journal.SourceProjectRevision < 0 || journal.SourceProjectIncrement <= 0 ||
            journal.SourceStorageSchemaVersion is <= 0 or > 1_000_000 ||
            !IsCanonicalText(journal.SourceAppVersion, 128, false) ||
            !IsCanonicalText(journal.ImportAppVersion, 128, false) ||
            NormalizeUtc(journal.ImportedUtc) != journal.ImportedUtc ||
            journal.SnapshotFormat is not (1 or 2 or 3 or SqliteProjectExportService.SnapshotFormat) ||
            journal.HarnessCount is < 0 or > ProjectRules.MaximumHarnesses ||
            journal.AttachmentCount is < 0 or > MaximumArchiveEntries - 2 ||
            journal.PinnedCharacteristicCount is < 0 or > MaximumArchiveEntries ||
            journal.StagingRelativePath != $"staging/import-{operationId}" ||
            journal.Blobs.Count + 1 >= MaximumArchiveEntries)
        {
            throw new InvalidDataException("The import journal shape is invalid.");
        }

        ValidateSha256(journal.ArchiveSha256);
        ValidateSha256(journal.ManifestSha256);
        ValidateSha256(journal.SnapshotSha256);
        ValidateSha256(journal.HarnessSetSha256);
        ValidateSha256(journal.AttachmentSetSha256);
        ValidateSha256(journal.PinnedCharacteristicSetSha256);
        string? previous = null;
        foreach (var blob in journal.Blobs)
        {
            ValidateSha256(blob.Sha256);
            if (blob.SizeBytes is < 0 or > MaximumAttachmentBytes ||
                previous is not null && string.CompareOrdinal(previous, blob.Sha256) >= 0)
            {
                throw new InvalidDataException("The import journal blob index is invalid.");
            }

            previous = blob.Sha256;
        }
    }

    private void ValidateStage(ImportJournal journal, string stagePath)
    {
        ValidateImportDirectories();
        if (!Directory.Exists(stagePath))
        {
            throw Invalid("import_staging_missing", "The recoverable project import staging directory is missing.");
        }

        RejectReparsePoint(stagePath, "The project import staging directory must be ordinary.");
        var allowed = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            Path.GetFullPath(Path.Combine(stagePath, "snapshot.json")),
            Path.GetFullPath(Path.Combine(stagePath, "manifest.json")),
            Path.GetFullPath(Path.Combine(stagePath, "COMPLETE.json")),
            Path.GetFullPath(Path.Combine(stagePath, "source.techmap-project.zip")),
            Path.GetFullPath(Path.Combine(stagePath, "OWNER")),
        };
        foreach (var blob in journal.Blobs)
        {
            allowed.Add(Path.GetFullPath(StagedBlobPath(stagePath, blob.Sha256)));
        }

        ValidateStageOwner(stagePath, journal.OperationGuid);
        foreach (var file in EnumerateOrdinaryFilesTopDown(stagePath))
        {
            RejectReparsePoint(file, "A staged project import file must be ordinary.");
            if (!allowed.Remove(Path.GetFullPath(file)))
            {
                throw Invalid("import_staging_invalid", "The project import staging directory has an unexpected file.");
            }
        }

        if (allowed.Count != 0)
        {
            throw Invalid("import_staging_missing", "A staged project import file is missing.");
        }

        var completion = ReadBoundedFile(
            Path.Combine(stagePath, "COMPLETE.json"), MaximumManifestBytes, "import_staging_invalid");
        if (!completion.AsSpan().SequenceEqual(CanonicalJson(journal)))
        {
            throw Invalid("import_staging_invalid", "The project import completion marker is invalid.");
        }
    }

    private async Task<bool> BlobExistsAndIsValidAsync(
        ExportPayload payload,
        CancellationToken cancellationToken)
    {
        try
        {
            await attachmentStore.ValidateAsync(
                new StoredAttachment(payload.Sha256, payload.SizeBytes),
                cancellationToken).ConfigureAwait(false);
            return true;
        }
        catch (FileNotFoundException)
        {
            return false;
        }
    }

    private static long AllocateIncrement(SqliteUnitOfWork unitOfWork)
    {
        using var command = unitOfWork.CreateCommand(
            """
            UPDATE project_counter
            SET next_increment = next_increment + 1
            WHERE counter_id = 1
            RETURNING next_increment - 1;
            """);
        return Convert.ToInt64(command.ExecuteScalar(), CultureInfo.InvariantCulture);
    }

    private static string AllocateName(SqliteUnitOfWork unitOfWork, string sourceName, long increment)
    {
        using var command = unitOfWork.CreateCommand("SELECT name FROM projects;");
        using var reader = command.ExecuteReader();
        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        while (reader.Read())
        {
            names.Add(reader.GetString(0).Normalize(NormalizationForm.FormC));
        }

        if (!names.Contains(sourceName))
        {
            return sourceName;
        }

        var suffix = $" (импорт {increment})";
        var prefix = TruncateUtf16(sourceName, ProjectRules.MaximumNameLength - suffix.Length);
        var candidate = prefix + suffix;
        for (var index = 2; names.Contains(candidate); index++)
        {
            suffix = $" (импорт {increment}-{index})";
            prefix = TruncateUtf16(sourceName, ProjectRules.MaximumNameLength - suffix.Length);
            candidate = prefix + suffix;
        }

        return ProjectRules.NormalizeName(candidate, nameof(sourceName));
    }

    private static string TruncateUtf16(string value, int maximumLength)
    {
        var length = Math.Min(value.Length, maximumLength);
        if (length > 0 && length < value.Length && char.IsHighSurrogate(value[length - 1]))
        {
            length--;
        }

        return value[..length];
    }

    private static ProjectImportResult CreateResult(
        ImportJournal journal,
        long increment,
        string name,
        bool recovered) =>
        new(
            new ProjectIdentity(Guid.ParseExact(journal.DestinationProjectId, "D")),
            increment,
            name,
            new ProjectIdentity(Guid.ParseExact(journal.SourceProjectId, "D")),
            journal.SourceProjectRevision,
            journal.ArchiveSha256,
            journal.ManifestSha256,
            journal.HarnessCount,
            journal.AttachmentCount,
            journal.PinnedCharacteristicCount,
            recovered);

    private void ValidateCommittedCounts(ImportJournal journal, ProjectImportResult result)
    {
        if (result.HarnessCount != journal.HarnessCount ||
            result.AttachmentCount != journal.AttachmentCount ||
            result.PinnedCharacteristicCount != journal.PinnedCharacteristicCount)
        {
            throw Invalid("import_recovery_conflict", "The committed imported project is incomplete.");
        }

        var hashes = storage.ExecuteRead(unitOfWork =>
        {
            var harnesses = ReadOwnedRows(
                unitOfWork,
                "SELECT harness_id, '' FROM harnesses WHERE project_id = $projectId;",
                journal.DestinationProjectId);
            var attachments = ReadOwnedRows(
                unitOfWork,
                "SELECT attachment_id, content_sha256 FROM project_attachments WHERE project_id = $projectId;",
                journal.DestinationProjectId);
            var pinned = ReadOwnedRows(
                unitOfWork,
                "SELECT snapshot_id, payload_sha256 FROM pinned_characteristics WHERE project_id = $projectId;",
                journal.DestinationProjectId);
            return (HashOwnedRows(harnesses), HashOwnedRows(attachments), HashOwnedRows(pinned));
        });
        if (hashes.Item1 != journal.HarnessSetSha256 ||
            hashes.Item2 != journal.AttachmentSetSha256 ||
            hashes.Item3 != journal.PinnedCharacteristicSetSha256)
        {
            throw Invalid(
                "import_recovery_conflict",
                "The committed imported project ownership graph conflicts with its journal.");
        }
    }

    private static IReadOnlyList<OwnedRow> ReadOwnedRows(
        SqliteUnitOfWork unitOfWork,
        string sql,
        string projectId)
    {
        using var command = unitOfWork.CreateCommand(sql);
        command.Parameters.AddWithValue("$projectId", projectId);
        using var reader = command.ExecuteReader();
        var rows = new List<OwnedRow>();
        while (reader.Read())
        {
            rows.Add(new OwnedRow(reader.GetString(0), reader.GetString(1)));
        }

        return rows;
    }

    private void CleanupCommitted(string journalPath, string stagePath)
    {
        TryDeleteOwnedStage(stagePath);
        try
        {
            RejectReparsePoint(journalPath, "A project import journal must be ordinary.");
            File.Delete(journalPath);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            // A committed import remains valid; cleanup is retried on the next startup.
        }
    }

    private void TryDeleteOwnedStage(string stagePath)
    {
        try
        {
            var full = Path.GetFullPath(stagePath);
            var prefix = Path.GetFullPath(stagingRoot).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            if (!full.StartsWith(prefix, StringComparison.OrdinalIgnoreCase) || !Directory.Exists(full))
            {
                return;
            }

            var operationText = Path.GetFileName(full)["import-".Length..];
            if (!Guid.TryParseExact(operationText, "D", out var operationId))
            {
                return;
            }

            ValidateStageOwner(full, operationId);
            _ = EnumerateOrdinaryFilesTopDown(full).ToArray();

            Directory.Delete(full, recursive: true);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or InvalidDataException)
        {
            // Never follow or force-delete a suspicious path. A later recovery can retry safe cleanup.
        }
    }

    private void ValidateImportDirectories()
    {
        RejectReparsePoint(importsRoot, "The project import directory must be ordinary.");
        RejectReparsePoint(stagingRoot, "The project import staging root must be ordinary.");
        RejectReparsePoint(journalsRoot, "The project import journal root must be ordinary.");
    }

    private void SweepAbandonedStages()
    {
        var journalOperations = Directory.EnumerateFiles(
                journalsRoot,
                "*.project-import.json",
                SearchOption.TopDirectoryOnly)
            .Select(path => Path.GetFileNameWithoutExtension(path) ?? string.Empty)
            .Select(value => value.EndsWith(".project-import", StringComparison.Ordinal)
                ? value[..^".project-import".Length]
                : value)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        foreach (var directory in Directory.EnumerateDirectories(stagingRoot, "import-*", SearchOption.TopDirectoryOnly))
        {
            RejectReparsePoint(directory, "A project import staging directory must be ordinary.");
            var operationText = Path.GetFileName(directory)["import-".Length..];
            if (!Guid.TryParseExact(operationText, "D", out var operationId) || journalOperations.Contains(operationText))
            {
                continue;
            }

            TryDeleteAbandonedStage(directory);
        }
    }

    private void TryDeleteAbandonedStage(string stagePath)
    {
        try
        {
            var full = Path.GetFullPath(stagePath);
            var prefix = Path.GetFullPath(stagingRoot).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            if (!full.StartsWith(prefix, StringComparison.OrdinalIgnoreCase) ||
                !Path.GetFileName(full).StartsWith("import-", StringComparison.Ordinal) ||
                !Guid.TryParseExact(Path.GetFileName(full)["import-".Length..], "D", out _) ||
                !Directory.Exists(full))
            {
                return;
            }

            _ = EnumerateOrdinaryFilesTopDown(full).ToArray();
            Directory.Delete(full, recursive: true);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or InvalidDataException)
        {
            // A suspicious or concurrently changed directory is left for manual recovery.
        }
    }

    private static IEnumerable<string> EnumerateOrdinaryFilesTopDown(string root)
    {
        var pending = new Stack<string>();
        pending.Push(root);
        while (pending.Count > 0)
        {
            var current = pending.Pop();
            RejectReparsePoint(current, "A project import staging directory must be ordinary.");
            foreach (var file in Directory.EnumerateFiles(current, "*", SearchOption.TopDirectoryOnly))
            {
                RejectReparsePoint(file, "A project import staging file must be ordinary.");
                yield return file;
            }

            foreach (var directory in Directory.EnumerateDirectories(current, "*", SearchOption.TopDirectoryOnly))
            {
                RejectReparsePoint(directory, "A project import staging directory must be ordinary.");
                pending.Push(directory);
            }
        }
    }

    private static void ValidateStageOwner(string stagePath, Guid operationId)
    {
        var ownerPath = Path.Combine(stagePath, "OWNER");
        RejectOrdinaryPathToRoot(stagePath, ownerPath, "The project import owner marker must be ordinary.");
        if (File.ReadAllText(ownerPath, Encoding.ASCII) != $"{operationId:D}\n")
        {
            throw Invalid("import_staging_invalid", "The project import staging owner is invalid.");
        }
    }

    private static void RejectOrdinaryPathToRoot(string root, string path, string message)
    {
        var fullRoot = Path.GetFullPath(root);
        var fullPath = Path.GetFullPath(path);
        if (!fullPath.StartsWith(fullRoot.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar,
                StringComparison.OrdinalIgnoreCase))
        {
            throw Invalid("import_staging_invalid", message);
        }

        var current = fullRoot;
        RejectReparsePoint(current, message);
        foreach (var segment in fullPath[(fullRoot.Length + 1)..]
                     .Split(Path.DirectorySeparatorChar, StringSplitOptions.RemoveEmptyEntries))
        {
            current = Path.Combine(current, segment);
            RejectReparsePoint(current, message);
        }
    }

    private string StagePath(ImportJournal journal)
    {
        var path = Path.GetFullPath(Path.Combine(importsRoot, journal.StagingRelativePath.Replace('/', Path.DirectorySeparatorChar)));
        var prefix = Path.GetFullPath(stagingRoot).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        if (!path.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
        {
            throw Invalid("import_journal_invalid", "The project import staging path escapes its root.");
        }

        return path;
    }

    private string JournalPath(Guid operationId) =>
        Path.Combine(journalsRoot, $"{operationId:D}.project-import.json");

    private static string StagedBlobPath(string stagePath, string sha256) =>
        Path.Combine(stagePath, "blobs", sha256[..2], sha256);

    private string FinalBlobPath(string sha256) =>
        Path.Combine(dataRoot, "attachments", "blobs", sha256[..2], sha256);

    private static async Task<string> CopyEntryToDurableFileAsync(
        ZipArchiveEntry entry,
        string destinationPath,
        long expectedBytes,
        CancellationToken cancellationToken)
    {
        await using var source = entry.Open();
        await using var destination = new FileStream(
            destinationPath,
            FileMode.CreateNew,
            FileAccess.Write,
            FileShare.None,
            BufferSize,
            FileOptions.Asynchronous | FileOptions.SequentialScan | FileOptions.WriteThrough);
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

            total = CheckedAdd(total, count, "import_entry_too_large");
            if (total > expectedBytes)
            {
                throw Invalid("import_payload_mismatch", "An archive entry exceeds its declared size.");
            }

            hash.AppendData(buffer, 0, count);
            await destination.WriteAsync(buffer.AsMemory(0, count), cancellationToken).ConfigureAwait(false);
        }

        if (total != expectedBytes)
        {
            throw Invalid("import_payload_mismatch", "An archive entry is truncated.");
        }

        await destination.FlushAsync(cancellationToken).ConfigureAwait(false);
        destination.Flush(flushToDisk: true);
        return Convert.ToHexStringLower(hash.GetHashAndReset());
    }

    private static async Task<string> CopyStreamToDurableFileAsync(
        Stream source,
        string destinationPath,
        long expectedBytes,
        CancellationToken cancellationToken)
    {
        source.Position = 0;
        await using var destination = new FileStream(
            destinationPath,
            FileMode.CreateNew,
            FileAccess.Write,
            FileShare.None,
            BufferSize,
            FileOptions.Asynchronous | FileOptions.SequentialScan | FileOptions.WriteThrough);
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

            total = CheckedAdd(total, count, "import_archive_size_invalid");
            if (total > expectedBytes)
            {
                throw Invalid("import_archive_changed", "The project archive grew while it was staged.");
            }

            hash.AppendData(buffer, 0, count);
            await destination.WriteAsync(buffer.AsMemory(0, count), cancellationToken).ConfigureAwait(false);
        }

        if (total != expectedBytes)
        {
            throw Invalid("import_archive_changed", "The project archive shrank while it was staged.");
        }

        await destination.FlushAsync(cancellationToken).ConfigureAwait(false);
        destination.Flush(flushToDisk: true);
        return Convert.ToHexStringLower(hash.GetHashAndReset());
    }

    private static async Task WriteDurableFileAsync(
        string path,
        byte[] bytes,
        CancellationToken cancellationToken)
    {
        await using var stream = new FileStream(
            path,
            FileMode.CreateNew,
            FileAccess.Write,
            FileShare.None,
            BufferSize,
            FileOptions.Asynchronous | FileOptions.SequentialScan | FileOptions.WriteThrough);
        await stream.WriteAsync(bytes, cancellationToken).ConfigureAwait(false);
        await stream.FlushAsync(cancellationToken).ConfigureAwait(false);
        stream.Flush(flushToDisk: true);
    }

    private static async Task<byte[]> ReadBoundedAsync(
        ZipArchiveEntry entry,
        long maximumBytes,
        CancellationToken cancellationToken)
    {
        if (entry.Length < 0 || entry.Length > maximumBytes || entry.Length > int.MaxValue)
        {
            throw Invalid("import_entry_too_large", $"Archive entry '{entry.FullName}' is too large.");
        }

        await using var stream = entry.Open();
        using var memory = new MemoryStream((int)entry.Length);
        var buffer = new byte[BufferSize];
        while (true)
        {
            var count = await stream.ReadAsync(buffer, cancellationToken).ConfigureAwait(false);
            if (count == 0)
            {
                break;
            }

            if (memory.Length + count > maximumBytes || memory.Length + count > entry.Length)
            {
                throw Invalid("import_entry_too_large", $"Archive entry '{entry.FullName}' expanded beyond its limit.");
            }

            await memory.WriteAsync(buffer.AsMemory(0, count), cancellationToken).ConfigureAwait(false);
        }

        if (memory.Length != entry.Length)
        {
            throw Invalid("import_payload_mismatch", $"Archive entry '{entry.FullName}' is truncated.");
        }

        return memory.ToArray();
    }

    private static async Task<string> HashStreamAsync(Stream stream, CancellationToken cancellationToken)
    {
        stream.Position = 0;
        var hash = Convert.ToHexStringLower(await SHA256.HashDataAsync(stream, cancellationToken).ConfigureAwait(false));
        stream.Position = 0;
        return hash;
    }

    private static FileStream OpenOrdinaryRead(string path)
    {
        RejectReparsePoint(path, "A staged attachment must be ordinary.");
        return new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, BufferSize, FileOptions.SequentialScan);
    }

    private static void ValidateEntry(ZipArchiveEntry entry)
    {
        ValidateEntryPath(entry.FullName);
        var attributes = unchecked((uint)entry.ExternalAttributes);
        var unixType = (attributes >> 16) & 0xF000;
        if (unixType == 0xA000 || (attributes & (uint)FileAttributes.ReparsePoint) != 0)
        {
            throw Invalid("import_link_entry", "Archive links and reparse points are forbidden.");
        }

        if (entry.Length < 0 || entry.CompressedLength < 0)
        {
            throw Invalid("import_entry_size_invalid", "An archive entry has an invalid size.");
        }
    }

    private static void ValidateCompressionRatio(long length, long compressedLength)
    {
        if (length > Math.Max(1L, compressedLength) * MaximumCompressionRatio)
        {
            throw Invalid("import_compression_ratio_exceeded", "An archive entry expansion ratio is unsafe.");
        }
    }

    private static ZipArchiveEntry ExactEntry(
        IReadOnlyDictionary<string, ZipArchiveEntry> entries,
        string name,
        string errorCode)
    {
        if (!entries.TryGetValue(name, out var entry) || entry.FullName != name)
        {
            throw Invalid(errorCode, $"Required archive entry '{name}' is missing.");
        }

        return entry;
    }

    private static void ValidateEntryPath(string path)
    {
        if (string.IsNullOrEmpty(path) || path.Length > 512 || path[0] == '/' || path.EndsWith('/') ||
            path.Contains('\\') || path.Contains(':') || path.Any(char.IsControl) ||
            !path.IsNormalized(NormalizationForm.FormC) ||
            path.Split('/').Any(segment => segment is "" or "." or ".."))
        {
            throw Invalid("import_entry_path_unsafe", "An archive entry path is unsafe.");
        }
    }

    private void ValidateSourcePath(string path)
    {
        if (!path.EndsWith(".techmap-project.zip", StringComparison.OrdinalIgnoreCase) || !File.Exists(path))
        {
            throw Invalid("import_archive_missing", "The project archive does not exist or has the wrong extension.");
        }

        var root = Path.GetPathRoot(path) ?? throw Invalid("import_archive_path_invalid", "The archive path has no root.");
        var current = root;
        foreach (var segment in path[root.Length..].Split(Path.DirectorySeparatorChar, StringSplitOptions.RemoveEmptyEntries))
        {
            current = Path.Combine(current, segment);
            RejectReparsePoint(current, "The project archive path must not contain a reparse point.");
        }

        var parent = Path.GetDirectoryName(path)
            ?? throw Invalid("import_archive_path_invalid", "The archive path has no parent directory.");
        using var parentGuard = DataRootLease.GuardExistingDirectory(parent);
        var physicalPath = Path.Combine(parentGuard.CanonicalPath, Path.GetFileName(path));
        var dataPrefix = Path.GetFullPath(dataRoot).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        if (physicalPath.StartsWith(dataPrefix, StringComparison.OrdinalIgnoreCase))
        {
            throw Invalid("import_archive_path_invalid", "A project archive must be outside the application data root.");
        }
    }

    private static void ValidateRequest(ProjectImportRequest request)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(request.ArchivePath);
        if (!IsCanonicalText(request.AppVersion, 128, false))
        {
            throw new ArgumentException("The application version is invalid.", nameof(request));
        }
    }

    private static T ReadCanonicalJson<T>(byte[] bytes)
    {
        using var document = JsonDocument.Parse(bytes);
        RejectDuplicateJsonProperties(document.RootElement);
        var result = JsonSerializer.Deserialize<T>(bytes, JsonOptions)
            ?? throw new InvalidDataException("A project archive JSON payload is empty.");
        if (!bytes.AsSpan().SequenceEqual(CanonicalJson(result)))
        {
            throw new InvalidDataException("A project archive JSON payload is not canonical.");
        }

        return result;
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
                    throw new InvalidDataException("A JSON object contains a duplicate property.");
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

    private static byte[] CanonicalJson<T>(T value) => JsonSerializer.SerializeToUtf8Bytes(value, JsonOptions);

    private static string HashExpectedHarnesses(Guid operationId, IReadOnlyList<ExportHarness> rows) =>
        HashOwnedRows(rows.Select(row => new OwnedRow(
            Format(DeterministicGuid(operationId, "harness", row.HarnessId)),
            string.Empty)));

    private static string HashExpectedAttachments(Guid operationId, IReadOnlyList<ExportAttachment> rows) =>
        HashOwnedRows(rows.Select(row => new OwnedRow(
            Format(DeterministicGuid(operationId, "attachment", row.AttachmentId)),
            row.ContentSha256)));

    private static string HashExpectedPinnedCharacteristics(
        Guid operationId,
        IReadOnlyList<ExportPinnedCharacteristic> rows) =>
        HashOwnedRows(rows.Select(row => new OwnedRow(
            Format(DeterministicGuid(operationId, "pinned", row.SnapshotId)),
            row.PayloadSha256)));

    private static string HashOwnedRows(IEnumerable<OwnedRow> rows) =>
        Sha256(CanonicalJson(rows
            .OrderBy(row => row.Id, StringComparer.Ordinal)
            .ThenBy(row => row.Relation, StringComparer.Ordinal)
            .ToArray()));

    private static async Task<byte[]> ReadBoundedFileAsync(
        string path,
        long maximumBytes,
        string errorCode,
        CancellationToken cancellationToken)
    {
        var length = new FileInfo(path).Length;
        if (length < 0 || length > maximumBytes || length > int.MaxValue)
        {
            throw Invalid(errorCode, "A project import recovery file is too large.");
        }

        await using var stream = new FileStream(
            path, FileMode.Open, FileAccess.Read, FileShare.Read, BufferSize,
            FileOptions.Asynchronous | FileOptions.SequentialScan);
        var bytes = new byte[(int)length];
        await stream.ReadExactlyAsync(bytes, cancellationToken).ConfigureAwait(false);
        if (stream.ReadByte() != -1)
        {
            throw Invalid(errorCode, "A project import recovery file grew while it was read.");
        }

        return bytes;
    }

    private static byte[] ReadBoundedFile(string path, long maximumBytes, string errorCode)
    {
        var length = new FileInfo(path).Length;
        if (length < 0 || length > maximumBytes || length > int.MaxValue)
        {
            throw Invalid(errorCode, "A project import recovery file is too large.");
        }

        using var stream = new FileStream(
            path, FileMode.Open, FileAccess.Read, FileShare.Read, BufferSize, FileOptions.SequentialScan);
        var bytes = new byte[(int)length];
        stream.ReadExactly(bytes);
        if (stream.ReadByte() != -1)
        {
            throw Invalid(errorCode, "A project import recovery file grew while it was read.");
        }

        return bytes;
    }

    private static Guid DeterministicGuid(Guid operationId, string kind, string sourceId)
    {
        Span<byte> namespaceBytes = stackalloc byte[16];
        operationId.TryWriteBytes(namespaceBytes, bigEndian: true, out _);
        var nameBytes = Encoding.UTF8.GetBytes($"{kind}/{sourceId}");
        var input = new byte[namespaceBytes.Length + nameBytes.Length];
        namespaceBytes.CopyTo(input);
        nameBytes.CopyTo(input.AsSpan(namespaceBytes.Length));
        var bytes = SHA1.HashData(input)[..16];
        bytes[6] = (byte)((bytes[6] & 0x0F) | 0x50);
        bytes[8] = (byte)((bytes[8] & 0x3F) | 0x80);
        return new Guid(bytes, bigEndian: true);
    }

    private static string BlobArchivePath(string sha256) => $"attachments/blobs/{sha256[..2]}/{sha256}";
    private static string Format(Guid value) => value.ToString("D", CultureInfo.InvariantCulture);
    private static string Sha256(byte[] bytes) => Convert.ToHexStringLower(SHA256.HashData(bytes));

    private static string ParseGuid(string value) =>
        Guid.TryParseExact(value, "D", out var parsed) && parsed != Guid.Empty
            ? Format(parsed)
            : throw new InvalidDataException("A UUID is invalid.");

    private static void ValidateSha256(string value)
    {
        if (value.Length != 64 || value.Any(character => character is not (>= '0' and <= '9') and not (>= 'a' and <= 'f')))
        {
            throw new InvalidDataException("A SHA-256 value is invalid.");
        }
    }

    private static string NormalizeUtc(string value)
    {
        var parsed = DateTimeOffset.ParseExact(value, "O", CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind);
        if (parsed == default)
        {
            throw new InvalidDataException("A timestamp is invalid.");
        }

        return parsed.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture);
    }

    private static bool IsCanonicalText(string value, int maximumLength, bool allowEmpty) =>
        value is not null && value.Length <= maximumLength && (allowEmpty || value.Length > 0) &&
        value == value.Trim() && value.IsNormalized(NormalizationForm.FormC) && !value.Any(char.IsControl);

    private static bool IsValidFileName(string value) =>
        string.Equals(Path.GetFileName(value), value, StringComparison.Ordinal) &&
        value is not "." and not ".." &&
        value.IndexOfAny(Path.GetInvalidFileNameChars()) < 0;

    private static bool IsValidToken(string value, bool allowSlash)
    {
        if (value != value.ToLowerInvariant())
        {
            return false;
        }

        var slashCount = value.Count(character => character == '/');
        var slashIndex = value.IndexOf('/');
        return (!allowSlash && slashCount == 0 ||
                allowSlash && slashCount == 1 && slashIndex > 0 && slashIndex < value.Length - 1) &&
            value.All(character =>
                character is >= 'a' and <= 'z' or >= '0' and <= '9' or '.' or '_' or '-' or '+' or '/');
    }

    private static int Compare(int left, string leftId, int right, string rightId) =>
        left != right ? left.CompareTo(right) : string.CompareOrdinal(leftId, rightId);

    private static int Compare(string left, string leftId, string right, string rightId) =>
        left != right ? string.CompareOrdinal(left, right) : string.CompareOrdinal(leftId, rightId);

    private static long CheckedAdd(long left, long right, string code)
    {
        try
        {
            return checked(left + right);
        }
        catch (OverflowException error)
        {
            throw Invalid(code, "An archive size total overflowed.", error);
        }
    }

    private static string CreateOrdinaryDirectory(string path)
    {
        Directory.CreateDirectory(path);
        RejectReparsePoint(path, "A project import directory must be ordinary.");
        return path;
    }

    private static void RejectReparsePoint(string path, string message)
    {
        if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0)
        {
            throw new InvalidDataException(message);
        }
    }

    private static void RequireSingle(int changed, string subject)
    {
        if (changed != 1)
        {
            throw new InvalidDataException($"The imported {subject} could not be published.");
        }
    }

    private void TryReportAfterCommit()
    {
        try
        {
            progressHook?.Invoke("after_database_commit");
        }
        catch
        {
            // The project is already atomically visible.
        }
    }

    private static ProjectImportException Invalid(string code, string message, Exception? inner = null) =>
        new(code, message, inner);

    private sealed record VerifiedStage(ImportJournal Journal);
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
        IReadOnlyList<ExportComponentSnapshot>? ComponentSnapshots = null,
        IReadOnlyList<ExportComponentPlacement>? ComponentPlacements = null);
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
        long? Quantity,
        int SortOrder,
        string CreatedUtc,
        string UpdatedUtc,
        IReadOnlyList<ExportHarnessDocument>? Documents,
        ExportHarnessDesign? Design);
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
    private sealed record ImportBlob(string Sha256, long SizeBytes, bool ExistedBefore);
    private sealed record OwnedRow(string Id, string Relation);
    private sealed record ImportJournal(
        int JournalFormat,
        string ImportOperationId,
        string ArchiveSha256,
        string ManifestSha256,
        string SourceProjectId,
        long SourceProjectRevision,
        long SourceProjectIncrement,
        int SourceStorageSchemaVersion,
        string SourceAppVersion,
        string ImportAppVersion,
        string DestinationProjectId,
        string StagingRelativePath,
        string SnapshotSha256,
        string ImportedUtc,
        int SnapshotFormat,
        int HarnessCount,
        int AttachmentCount,
        int PinnedCharacteristicCount,
        string HarnessSetSha256,
        string AttachmentSetSha256,
        string PinnedCharacteristicSetSha256,
        IReadOnlyList<ImportBlob> Blobs)
    {
        [JsonIgnore]
        public Guid OperationGuid => Guid.ParseExact(ImportOperationId, "D");
    }
}
