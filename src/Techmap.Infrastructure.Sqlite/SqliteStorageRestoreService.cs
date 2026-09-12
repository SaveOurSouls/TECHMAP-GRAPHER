using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using Techmap.Application;

namespace Techmap.Infrastructure.Sqlite;

/// <summary>
/// Restores a completely verified storage backup. The caller must keep the live data-root
/// offline and close all SQLite connections. <see cref="RestoreAsync"/> acquires the
/// authoritative data-root writer lease itself.
/// </summary>
public sealed class SqliteStorageRestoreService : IStorageRestoreService, IDisposable
{
    private const int BufferSize = 128 * 1024;
    private const string RestoreMarkerFileName = "RESTORE.json";
    private const string RecoveryOwnerFileName = ".RESTORE-OWNER";
    private const int ErrorAlreadyExists = 183;
    private readonly string dataRoot;
    private readonly IStorageBackupService backupService;
    private readonly TimeProvider clock;
    private readonly Action<string>? progressHook;
    private readonly SemaphoreSlim restoreGate = new(1, 1);
    private int disposed;

    public SqliteStorageRestoreService(
        string dataRoot,
        IStorageBackupService backupService,
        TimeProvider? timeProvider = null,
        Action<string>? progressHook = null)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(dataRoot);
        ArgumentNullException.ThrowIfNull(backupService);
        this.dataRoot = SqliteStorageBackupService.ResolveCanonicalExistingPath(dataRoot, expectDirectory: true);
        if (!Directory.Exists(this.dataRoot))
        {
            throw new DirectoryNotFoundException(this.dataRoot);
        }

        RejectReparsePoint(this.dataRoot, "The live data root must not be a reparse point.");
        this.backupService = backupService;
        clock = timeProvider ?? TimeProvider.System;
        this.progressHook = progressHook;
    }

    public async Task<StorageDryRunRestoreResult> DryRunAsync(
        StorageDryRunRestoreRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        ObjectDisposedException.ThrowIf(Volatile.Read(ref disposed) != 0, this);
        await restoreGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            using var backupRootLease = AcquireBackupRootLease(request.BackupPath);
            var archive = ReadArchive(CanonicalBackupPath(backupRootLease, request.BackupPath));
            var requestedRecoveryRoot = Path.GetFullPath(request.RecoveryRoot);
            var recoveryParent = Path.GetDirectoryName(requestedRecoveryRoot)
                ?? throw new InvalidDataException("The recovery root must have a parent directory.");
            var recoveryLeaf = Path.GetFileName(requestedRecoveryRoot);
            if (string.IsNullOrWhiteSpace(recoveryLeaf))
            {
                throw new InvalidDataException("The recovery root name is invalid.");
            }

            RejectOverlap(
                backupRootLease.CanonicalPath,
                requestedRecoveryRoot,
                "The recovery root must be outside the backup root.");
            using var recoveryParentLease = DataRootLease.Acquire(recoveryParent);
            var recoveryRoot = Path.Combine(recoveryParentLease.CanonicalPath, recoveryLeaf);
            RejectOverlap(dataRoot, recoveryRoot, "The recovery root must be separate from the live data root.");
            RejectOverlap(archive.Result.BackupPath, recoveryRoot, "The recovery root must be separate from the backup.");
            if (Directory.Exists(recoveryRoot) || File.Exists(recoveryRoot))
            {
                throw new StorageRestoreException(
                    "recovery_root_exists",
                    "A dry-run restore requires a new recovery root.");
            }

            var stagingRoot = CreateOwnedStagingDirectory(
                recoveryParentLease.CanonicalPath,
                recoveryLeaf,
                out var ownerToken);
            var ownsStaging = true;
            try
            {
                StorageGenerationLayout.PublishNewDurableFile(
                    Path.Combine(stagingRoot, RecoveryOwnerFileName), $"{ownerToken}\n");
                string generationName;
                using (var recoveryLease = DataRootLease.Acquire(stagingRoot))
                {
                    stagingRoot = recoveryLease.CanonicalPath;
                    RejectOverlap(dataRoot, stagingRoot, "The recovery staging root resolves to the live data root.");
                    RejectOverlap(
                        backupRootLease.CanonicalPath,
                        stagingRoot,
                        "The recovery staging root resolves into the backup root.");
                    var generations = CreateOrdinaryDescendant(
                        stagingRoot,
                        StorageGenerationLayout.GenerationsDirectoryName);
                    generationName = StorageGenerationLayout.InitialGenerationName;
                    var generation = CreateOrdinaryDescendant(stagingRoot,
                        StorageGenerationLayout.GenerationsDirectoryName, generationName);

                    await PublishArchiveBlobsAsync(archive, stagingRoot, cancellationToken).ConfigureAwait(false);
                    progressHook?.Invoke("dry_run_after_blobs");
                    var databasePath = Path.Combine(generation, StorageGenerationLayout.DatabaseFileName);
                    await CopyVerifiedAsync(
                        ArchiveFilePath(archive, StorageGenerationLayout.DatabaseFileName),
                        databasePath,
                        archive.Files.Single(file => file.Path == StorageGenerationLayout.DatabaseFileName),
                        cancellationToken).ConfigureAwait(false);
                    ValidateRestoredDatabase(databasePath, archive);
                    StorageGenerationLayout.PublishNewDurableFile(
                        Path.Combine(generation, StorageGenerationLayout.ReadyMarkerFileName), "ready\n");
                    StorageGenerationLayout.PublishNewDurableFile(
                        Path.Combine(stagingRoot, StorageGenerationLayout.CurrentPointerFileName), $"{generationName}\n");
                    ValidatePublishedGeneration(stagingRoot, generationName, archive);
                    _ = ReadArchive(archive.Result.BackupPath);
                }

                progressHook?.Invoke("dry_run_before_publish");
                StorageGenerationLayout.MoveNewDurably(stagingRoot, recoveryRoot);
                ownsStaging = false;
                TryRemoveRecoveryOwnerMarker(recoveryRoot, ownerToken);
                var result = new StorageDryRunRestoreResult(
                    archive.Result,
                    recoveryRoot,
                    generationName,
                    Path.Combine(
                        recoveryRoot,
                        StorageGenerationLayout.GenerationsDirectoryName,
                        generationName,
                        StorageGenerationLayout.DatabaseFileName),
                    archive.Result.DatabaseSha256,
                    archive.Result.ReferencedBlobCount);
                try
                {
                    progressHook?.Invoke("dry_run_complete");
                }
                catch
                {
                    // Publication is the commit point. An observer cannot undo a valid recovery root.
                }

                return result;
            }
            catch
            {
                if (ownsStaging)
                {
                    TryDeleteOwnedRecoveryRoot(stagingRoot, ownerToken);
                }

                throw;
            }
        }
        catch (Exception error) when (
            error is not StorageRestoreException and not OperationCanceledException)
        {
            throw new StorageRestoreException("restore_dry_run_failed", "The dry-run restore failed.", error);
        }
        finally
        {
            restoreGate.Release();
        }
    }

    public async Task<StorageFullRestorePlan> PrepareFullRestoreAsync(
        string backupPath,
        CancellationToken cancellationToken = default)
    {
        ObjectDisposedException.ThrowIf(Volatile.Read(ref disposed) != 0, this);
        await restoreGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            cancellationToken.ThrowIfCancellationRequested();
            using var backupRootLease = AcquireBackupRootLease(backupPath);
            var archive = ReadArchive(CanonicalBackupPath(backupRootLease, backupPath));
            RejectOverlap(dataRoot, archive.Result.BackupPath, "The backup must be separate from the live data root.");
            if (archive.Result.SchemaVersion != SqliteStorage.CurrentSchemaVersion)
            {
                throw new StorageRestoreException(
                    "restore_schema_not_current",
                    "Full restore can only target the current storage schema. Use dry-run to inspect older backups.");
            }

            var current = await ReadCurrentFingerprintAsync(cancellationToken).ConfigureAwait(false);
            var planId = Guid.NewGuid();
            return new StorageFullRestorePlan(
                planId,
                archive.Result.BackupPath,
                archive.Result.BackupId,
                archive.Result.ManifestSha256,
                dataRoot,
                current.GenerationName,
                current.DatabaseSha256,
                current.Fingerprint,
                clock.GetUtcNow().ToUniversalTime(),
                BuildConfirmation(
                    planId, archive.Result.BackupId, archive.Result.ManifestSha256, dataRoot, current.Fingerprint));
        }
        catch (Exception error) when (
            error is not StorageRestoreException and not OperationCanceledException)
        {
            throw new StorageRestoreException("restore_prepare_failed", "The restore plan could not be prepared.", error);
        }
        finally
        {
            restoreGate.Release();
        }
    }

    public async Task<StorageFullRestoreResult> RestoreAsync(
        StorageFullRestoreRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(request.Plan);
        ValidateAppVersion(request.AppVersion);
        ObjectDisposedException.ThrowIf(Volatile.Read(ref disposed) != 0, this);
        await restoreGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        DataRootLease? acquiredLease = null;
        string? candidatePath = null;
        try
        {
            var plan = request.Plan;
            var expectedConfirmation = BuildConfirmation(
                plan.PlanId, plan.BackupId, plan.BackupManifestSha256, plan.DataRootPath, plan.CurrentFingerprint);
            if (!string.Equals(plan.RequiredConfirmation, expectedConfirmation, StringComparison.Ordinal) ||
                !string.Equals(request.Confirmation, expectedConfirmation, StringComparison.Ordinal) ||
                !string.Equals(Path.GetFullPath(plan.DataRootPath), dataRoot, StringComparison.OrdinalIgnoreCase))
            {
                throw new StorageRestoreException(
                    "restore_confirmation_required",
                    "Full restore requires the exact confirmation from a current restore plan.");
            }

            acquiredLease = DataRootLease.Acquire(dataRoot);

            VerifiedBackupArchive archive;
            using (var sourceLease = AcquireBackupRootLease(plan.BackupPath))
            {
                archive = ReadArchive(CanonicalBackupPath(sourceLease, plan.BackupPath));
            }
            if (archive.Result.BackupId != plan.BackupId ||
                !string.Equals(archive.Result.ManifestSha256, plan.BackupManifestSha256, StringComparison.Ordinal))
            {
                throw new StorageRestoreException("restore_backup_changed", "The selected backup changed after confirmation.");
            }

            if (archive.Result.SchemaVersion != SqliteStorage.CurrentSchemaVersion)
            {
                throw new StorageRestoreException(
                    "restore_schema_not_current",
                    "Full restore can only target the current storage schema.");
            }

            RejectOverlap(dataRoot, archive.Result.BackupPath, "The backup must be separate from the live data root.");
            RejectOverlap(dataRoot, request.PreRestoreBackupRoot, "The pre-restore backup must be outside the live data root.");
            var beforeBackup = await ReadCurrentFingerprintAsync(cancellationToken).ConfigureAwait(false);
            var alreadyCompleted = TryReadCompletedRestore(plan, archive, beforeBackup);
            if (alreadyCompleted is not null)
            {
                return alreadyCompleted;
            }

            EnsurePlanMatchesCurrent(plan, beforeBackup);

            var preRestore = await backupService.CreateAsync(
                new StorageBackupRequest(
                    request.PreRestoreBackupRoot,
                    request.AppVersion,
                    StorageBackupKind.PreRestore),
                cancellationToken).ConfigureAwait(false);
            VerifiedBackupArchive verifiedPreRestore;
            using (var preRestoreRootLease = AcquireBackupRootLease(preRestore.BackupPath))
            {
                verifiedPreRestore = SqliteStorageBackupService.ReadVerifiedBackup(
                    CanonicalBackupPath(preRestoreRootLease, preRestore.BackupPath));
            }
            if (verifiedPreRestore.Result.BackupId != preRestore.BackupId ||
                !string.Equals(verifiedPreRestore.Result.ManifestSha256, preRestore.ManifestSha256, StringComparison.Ordinal) ||
                verifiedPreRestore.Result.Kind != StorageBackupKind.PreRestore ||
                verifiedPreRestore.Result.SchemaVersion != beforeBackup.Inventory.SchemaVersion ||
                !string.Equals(verifiedPreRestore.Result.DatabaseSha256, beforeBackup.DatabaseSha256, StringComparison.Ordinal) ||
                !verifiedPreRestore.Result.ProjectRevisions.SequenceEqual(beforeBackup.Inventory.ProjectRevisions) ||
                !verifiedPreRestore.Files
                    .Where(file => file.Path != StorageGenerationLayout.DatabaseFileName)
                    .Select(file => new SqliteStorageBackupService.SnapshotBlob(file.Sha256, file.SizeBytes))
                    .OrderBy(blob => blob.Sha256, StringComparer.Ordinal)
                    .SequenceEqual(beforeBackup.Inventory.Blobs))
            {
                throw new StorageRestoreException(
                    "pre_restore_backup_invalid",
                    "The required pre-restore backup does not exactly represent the confirmed current database.");
            }
            progressHook?.Invoke("after_pre_restore_backup");

            using var backupRootLease = AcquireBackupRootLease(plan.BackupPath);
            archive = ReadArchive(CanonicalBackupPath(backupRootLease, plan.BackupPath));
            if (archive.Result.BackupId != plan.BackupId ||
                !string.Equals(archive.Result.ManifestSha256, plan.BackupManifestSha256, StringComparison.Ordinal))
            {
                throw new StorageRestoreException("restore_backup_changed", "The selected backup changed after confirmation.");
            }

            var current = await ReadCurrentFingerprintAsync(cancellationToken).ConfigureAwait(false);
            EnsurePlanMatchesCurrent(plan, current);
            var currentDatabasePath = Path.Combine(
                dataRoot,
                StorageGenerationLayout.GenerationsDirectoryName,
                current.GenerationName,
                StorageGenerationLayout.DatabaseFileName);
            await using var offlineLease = new FileStream(
                currentDatabasePath,
                FileMode.Open,
                FileAccess.Read,
                FileShare.None,
                bufferSize: 1,
                FileOptions.None);

            var generationsPath = ValidateOrdinaryDescendant(
                dataRoot, StorageGenerationLayout.GenerationsDirectoryName);
            var candidateName = AllocateNextGenerationName(generationsPath);
            candidatePath = CreateOrdinaryDescendant(
                dataRoot, StorageGenerationLayout.GenerationsDirectoryName, candidateName);

            await PublishArchiveBlobsAsync(archive, dataRoot, cancellationToken).ConfigureAwait(false);
            progressHook?.Invoke("after_restore_blobs");
            var candidateDatabase = Path.Combine(candidatePath, StorageGenerationLayout.DatabaseFileName);
            await CopyVerifiedAsync(
                ArchiveFilePath(archive, StorageGenerationLayout.DatabaseFileName),
                candidateDatabase,
                archive.Files.Single(file => file.Path == StorageGenerationLayout.DatabaseFileName),
                cancellationToken).ConfigureAwait(false);
            ValidateRestoredDatabase(candidateDatabase, archive);
            progressHook?.Invoke("after_restore_database");
            var completion = new CompletedRestoreMarker(
                Format: 1,
                plan.PlanId,
                plan.BackupId,
                plan.BackupManifestSha256,
                current.GenerationName,
                current.Fingerprint,
                preRestore);
            StorageGenerationLayout.PublishNewDurableFile(
                Path.Combine(candidatePath, RestoreMarkerFileName),
                JsonSerializer.Serialize(completion) + "\n");
            StorageGenerationLayout.PublishNewDurableFile(
                Path.Combine(candidatePath, StorageGenerationLayout.ReadyMarkerFileName), "ready\n");
            ValidatePublishedGeneration(dataRoot, candidateName, archive, requireCurrent: false);
            var finalArchive = ReadArchive(archive.Result.BackupPath);
            if (finalArchive.Result.BackupId != plan.BackupId ||
                !string.Equals(finalArchive.Result.ManifestSha256, plan.BackupManifestSha256, StringComparison.Ordinal))
            {
                throw new StorageRestoreException("restore_backup_changed", "The selected backup changed during restore.");
            }

            progressHook?.Invoke("before_current_switch");
            cancellationToken.ThrowIfCancellationRequested();
            StorageGenerationLayout.ReplaceCurrentDurably(
                Path.Combine(dataRoot, StorageGenerationLayout.CurrentPointerFileName),
                candidateName,
                () => progressHook?.Invoke("after_current_rename_before_return"));
            candidatePath = null;
            var result = new StorageFullRestoreResult(
                archive.Result,
                preRestore,
                current.GenerationName,
                candidateName,
                current.Fingerprint);
            try
            {
                progressHook?.Invoke("after_current_switch");
            }
            catch
            {
                // CURRENT is the commit point. Diagnostics cannot turn a committed restore into a failure.
            }

            return result;
        }
        catch (Exception error) when (
            error is not StorageRestoreException and not OperationCanceledException)
        {
            throw new StorageRestoreException("restore_failed", "The full restore failed.", error);
        }
        finally
        {
            if (candidatePath is not null)
            {
                TryDeleteCandidate(dataRoot, candidatePath);
            }

            acquiredLease?.Dispose();

            restoreGate.Release();
        }
    }

    public void Dispose()
    {
        if (Interlocked.Exchange(ref disposed, 1) == 0)
        {
            restoreGate.Dispose();
        }
    }

    private static VerifiedBackupArchive ReadArchive(string backupPath)
    {
        try
        {
            return SqliteStorageBackupService.ReadVerifiedBackup(backupPath);
        }
        catch (Exception error) when (
            error is IOException or UnauthorizedAccessException or InvalidDataException or ArgumentException)
        {
            throw new StorageRestoreException("backup_invalid", "The selected backup is invalid.", error);
        }
    }

    private async Task<CurrentStorageFingerprint> ReadCurrentFingerprintAsync(CancellationToken cancellationToken)
    {
        var currentPath = Path.Combine(dataRoot, StorageGenerationLayout.CurrentPointerFileName);
        var generationName = StorageGenerationLayout.ReadCurrentGeneration(currentPath);
        var generationPath = ValidateOrdinaryDescendant(
            dataRoot, StorageGenerationLayout.GenerationsDirectoryName, generationName);
        var readyPath = Path.Combine(generationPath, StorageGenerationLayout.ReadyMarkerFileName);
        var databasePath = Path.Combine(generationPath, StorageGenerationLayout.DatabaseFileName);
        if (!File.Exists(readyPath) || !File.Exists(databasePath))
        {
            throw new InvalidDataException("The current generation is incomplete.");
        }

        RejectReparsePoint(generationPath, "The current generation must not be a reparse point.");
        RejectReparsePoint(readyPath, "The current READY marker must not be a reparse point.");
        RejectReparsePoint(databasePath, "The current database must not be a reparse point.");
        var fingerprintRoot = Path.Combine(Path.GetTempPath(), "techmap-restore-fingerprint", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(fingerprintRoot);
        var snapshotPath = Path.Combine(fingerprintRoot, StorageGenerationLayout.DatabaseFileName);
        FileHash database;
        SqliteStorageBackupService.SnapshotInventory inventory;
        try
        {
            CreateConsistentSnapshot(databasePath, snapshotPath);
            database = await HashAsync(snapshotPath, cancellationToken).ConfigureAwait(false);
            inventory = SqliteStorageBackupService.InspectSnapshot(snapshotPath);
        }
        finally
        {
            try
            {
                Directory.Delete(fingerprintRoot, recursive: true);
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException)
            {
                // A failed temporary cleanup contains no additional data beyond the already-live database.
            }
        }

        using var fingerprint = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        fingerprint.AppendData(Encoding.UTF8.GetBytes($"current-v1\n{generationName}\n{database.Sha256}\n{database.SizeBytes}\n"));
        foreach (var blob in inventory.Blobs)
        {
            var path = Path.Combine(dataRoot, "attachments", "blobs", blob.Sha256[..2], blob.Sha256);
            ValidateOrdinaryDescendant(
                dataRoot, "attachments", "blobs", blob.Sha256[..2], blob.Sha256);
            var actual = await HashAsync(path, cancellationToken).ConfigureAwait(false);
            if (actual.SizeBytes != blob.SizeBytes || !string.Equals(actual.Sha256, blob.Sha256, StringComparison.Ordinal))
            {
                throw new InvalidDataException("A current referenced attachment is missing or corrupt.");
            }

            fingerprint.AppendData(Encoding.UTF8.GetBytes($"{blob.Sha256}\n{blob.SizeBytes}\n"));
        }

        foreach (var revision in inventory.ProjectRevisions)
        {
            fingerprint.AppendData(Encoding.UTF8.GetBytes($"{revision.ProjectId:D}\n{revision.Revision}\n"));
        }

        return new CurrentStorageFingerprint(
            generationName,
            database.Sha256,
            Convert.ToHexStringLower(fingerprint.GetHashAndReset()),
            inventory);
    }

    private StorageFullRestoreResult? TryReadCompletedRestore(
        StorageFullRestorePlan plan,
        VerifiedBackupArchive archive,
        CurrentStorageFingerprint current)
    {
        if (string.Equals(current.GenerationName, plan.CurrentGenerationName, StringComparison.Ordinal))
        {
            return null;
        }

        var markerPath = Path.Combine(
            dataRoot,
            StorageGenerationLayout.GenerationsDirectoryName,
            current.GenerationName,
            RestoreMarkerFileName);
        if (!File.Exists(markerPath))
        {
            return null;
        }

        RejectReparsePoint(markerPath, "The completed restore marker must not be a reparse point.");
        CompletedRestoreMarker? marker;
        try
        {
            marker = JsonSerializer.Deserialize<CompletedRestoreMarker>(File.ReadAllText(markerPath));
        }
        catch (JsonException error)
        {
            throw new InvalidDataException("The completed restore marker is invalid.", error);
        }

        var currentDatabasePath = Path.Combine(
            dataRoot,
            StorageGenerationLayout.GenerationsDirectoryName,
            current.GenerationName,
            StorageGenerationLayout.DatabaseFileName);
        string exactDatabaseHash;
        using (var currentDatabase = File.OpenRead(currentDatabasePath))
        {
            exactDatabaseHash = Convert.ToHexStringLower(SHA256.HashData(currentDatabase));
        }

        if (marker is null || marker.Format != 1 || marker.PlanId != plan.PlanId ||
            marker.BackupId != plan.BackupId ||
            !string.Equals(marker.BackupManifestSha256, plan.BackupManifestSha256, StringComparison.Ordinal) ||
            !string.Equals(marker.PreviousGenerationName, plan.CurrentGenerationName, StringComparison.Ordinal) ||
            !string.Equals(marker.PreviousFingerprint, plan.CurrentFingerprint, StringComparison.Ordinal) ||
            marker.PreRestoreBackup is null || marker.PreRestoreBackup.Kind != StorageBackupKind.PreRestore ||
            !string.Equals(exactDatabaseHash, archive.Result.DatabaseSha256, StringComparison.Ordinal))
        {
            return null;
        }

        RejectOverlap(
            dataRoot,
            marker.PreRestoreBackup.BackupPath,
            "The recorded pre-restore backup must be outside the live data root.");
        VerifiedBackupArchive verifiedPreRestore;
        using (var preRestoreLease = AcquireBackupRootLease(marker.PreRestoreBackup.BackupPath))
        {
            verifiedPreRestore = ReadArchive(CanonicalBackupPath(
                preRestoreLease,
                marker.PreRestoreBackup.BackupPath));
        }

        if (verifiedPreRestore.Result.BackupId != marker.PreRestoreBackup.BackupId ||
            verifiedPreRestore.Result.Kind != StorageBackupKind.PreRestore ||
            !string.Equals(
                verifiedPreRestore.Result.ManifestSha256,
                marker.PreRestoreBackup.ManifestSha256,
                StringComparison.Ordinal) ||
            !string.Equals(
                verifiedPreRestore.Result.DatabaseSha256,
                marker.PreRestoreBackup.DatabaseSha256,
                StringComparison.Ordinal) ||
            verifiedPreRestore.Result.SchemaVersion != marker.PreRestoreBackup.SchemaVersion ||
            verifiedPreRestore.Result.DatabaseSizeBytes != marker.PreRestoreBackup.DatabaseSizeBytes ||
            verifiedPreRestore.Result.ReferencedBlobCount != marker.PreRestoreBackup.ReferencedBlobCount ||
            !verifiedPreRestore.Result.ProjectRevisions.SequenceEqual(marker.PreRestoreBackup.ProjectRevisions))
        {
            throw new InvalidDataException("The recorded pre-restore backup identity is invalid.");
        }

        ValidatePublishedGeneration(dataRoot, current.GenerationName, archive);
        return new StorageFullRestoreResult(
            archive.Result,
            marker.PreRestoreBackup,
            marker.PreviousGenerationName,
            current.GenerationName,
            marker.PreviousFingerprint);
    }

    private static void CreateConsistentSnapshot(string sourcePath, string destinationPath)
    {
        using var source = new SqliteConnection(new SqliteConnectionStringBuilder
        {
            DataSource = sourcePath,
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
        using var journal = destination.CreateCommand();
        journal.CommandText = "PRAGMA journal_mode = DELETE;";
        journal.ExecuteNonQuery();
    }

    private static void EnsurePlanMatchesCurrent(StorageFullRestorePlan plan, CurrentStorageFingerprint current)
    {
        if (!string.Equals(plan.CurrentGenerationName, current.GenerationName, StringComparison.Ordinal) ||
            !string.Equals(plan.CurrentDatabaseSha256, current.DatabaseSha256, StringComparison.Ordinal) ||
            !string.Equals(plan.CurrentFingerprint, current.Fingerprint, StringComparison.Ordinal))
        {
            throw new StorageRestoreException(
                "restore_plan_stale",
                "The live storage changed after the restore was confirmed.");
        }
    }

    private static string BuildConfirmation(
        Guid planId,
        Guid backupId,
        string manifestHash,
        string dataRootPath,
        string currentFingerprint) =>
        $"RESTORE {backupId:N} {manifestHash} INTO {Path.GetFullPath(dataRootPath)} OVER {currentFingerprint} PLAN {planId:N}";

    private static DataRootLease AcquireBackupRootLease(string backupPath)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(backupPath);
        var full = Path.GetFullPath(backupPath);
        var parent = Path.GetDirectoryName(full)
            ?? throw new InvalidDataException("The backup path has no backup-root parent.");
        return DataRootLease.Acquire(parent);
    }

    private static string CanonicalBackupPath(DataRootLease rootLease, string requestedBackupPath)
    {
        var requested = Path.GetFullPath(requestedBackupPath);
        var leaf = Path.GetFileName(requested);
        if (string.IsNullOrEmpty(leaf))
        {
            throw new InvalidDataException("The backup path is invalid.");
        }

        return Path.Combine(rootLease.CanonicalPath, leaf);
    }

    private static async Task PublishArchiveBlobsAsync(
        VerifiedBackupArchive archive,
        string targetRoot,
        CancellationToken cancellationToken)
    {
        var staging = CreateOrdinaryDescendant(targetRoot, "attachments", "staging");
        var blobsRoot = CreateOrdinaryDescendant(targetRoot, "attachments", "blobs");
        foreach (var file in archive.Files.Where(file => file.Path != StorageGenerationLayout.DatabaseFileName))
        {
            cancellationToken.ThrowIfCancellationRequested();
            var hash = file.Sha256;
            var shard = CreateOrdinaryDescendant(targetRoot, "attachments", "blobs", hash[..2]);
            var destination = Path.Combine(shard, hash);
            if (File.Exists(destination))
            {
                ValidateOrdinaryDescendant(targetRoot, "attachments", "blobs", hash[..2], hash);
                await VerifyFileAsync(destination, file, cancellationToken).ConfigureAwait(false);
                continue;
            }

            var temporary = Path.Combine(staging, $"{Guid.NewGuid():N}.restore");
            try
            {
                await CopyVerifiedAsync(ArchiveFilePath(archive, file.Path), temporary, file, cancellationToken)
                    .ConfigureAwait(false);
                try
                {
                    ValidateOrdinaryDescendant(targetRoot, "attachments", "staging");
                    ValidateOrdinaryDescendant(targetRoot, "attachments", "blobs", hash[..2]);
                    StorageGenerationLayout.MoveNewDurably(temporary, destination);
                }
                catch (IOException) when (File.Exists(destination))
                {
                    await VerifyFileAsync(destination, file, cancellationToken).ConfigureAwait(false);
                }
            }
            finally
            {
                File.Delete(temporary);
            }
        }
    }

    private static string ArchiveFilePath(VerifiedBackupArchive archive, string relativePath)
    {
        var path = Path.GetFullPath(Path.Combine(
            archive.Result.BackupPath,
            relativePath.Replace('/', Path.DirectorySeparatorChar)));
        if (!IsSameOrDescendant(archive.Result.BackupPath, path))
        {
            throw new InvalidDataException("A backup file resolved outside the backup root.");
        }

        ValidateOrdinaryPath(archive.Result.BackupPath, path);

        return path;
    }

    private static async Task CopyVerifiedAsync(
        string sourcePath,
        string destinationPath,
        VerifiedBackupFile expected,
        CancellationToken cancellationToken)
    {
        RejectReparsePoint(sourcePath, "A backup file must not be a reparse point.");
        await using var source = new FileStream(
            sourcePath, FileMode.Open, FileAccess.Read, FileShare.Read, BufferSize,
            FileOptions.Asynchronous | FileOptions.SequentialScan);
        await using var destination = new FileStream(
            destinationPath, FileMode.CreateNew, FileAccess.Write, FileShare.None, BufferSize,
            FileOptions.Asynchronous | FileOptions.SequentialScan | FileOptions.WriteThrough);
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        var buffer = new byte[BufferSize];
        long length = 0;
        while (true)
        {
            var count = await source.ReadAsync(buffer, cancellationToken).ConfigureAwait(false);
            if (count == 0)
            {
                break;
            }

            length = checked(length + count);
            hash.AppendData(buffer, 0, count);
            await destination.WriteAsync(buffer.AsMemory(0, count), cancellationToken).ConfigureAwait(false);
        }

        await destination.FlushAsync(cancellationToken).ConfigureAwait(false);
        destination.Flush(flushToDisk: true);
        var actual = Convert.ToHexStringLower(hash.GetHashAndReset());
        if (length != expected.SizeBytes || !string.Equals(actual, expected.Sha256, StringComparison.Ordinal))
        {
            throw new InvalidDataException("A backup file changed while it was copied.");
        }
    }

    private static async Task VerifyFileAsync(
        string path,
        VerifiedBackupFile expected,
        CancellationToken cancellationToken)
    {
        var actual = await HashAsync(path, cancellationToken).ConfigureAwait(false);
        if (actual.SizeBytes != expected.SizeBytes || !string.Equals(actual.Sha256, expected.Sha256, StringComparison.Ordinal))
        {
            throw new InvalidDataException("An existing restored file conflicts with the backup.");
        }
    }

    private static async Task<FileHash> HashAsync(string path, CancellationToken cancellationToken)
    {
        await using var stream = new FileStream(
            path, FileMode.Open, FileAccess.Read, FileShare.Read, BufferSize,
            FileOptions.Asynchronous | FileOptions.SequentialScan);
        return new FileHash(
            stream.Length,
            Convert.ToHexStringLower(await SHA256.HashDataAsync(stream, cancellationToken).ConfigureAwait(false)));
    }

    private static void ValidateRestoredDatabase(string databasePath, VerifiedBackupArchive archive)
    {
        var inventory = SqliteStorageBackupService.InspectSnapshot(databasePath);
        var expectedBlobs = archive.Files
            .Where(file => file.Path != StorageGenerationLayout.DatabaseFileName)
            .Select(file => new SqliteStorageBackupService.SnapshotBlob(file.Sha256, file.SizeBytes))
            .OrderBy(blob => blob.Sha256, StringComparer.Ordinal)
            .ToArray();
        if (inventory.SchemaVersion != archive.Result.SchemaVersion ||
            !inventory.ProjectRevisions.SequenceEqual(archive.Result.ProjectRevisions) ||
            !inventory.Blobs.SequenceEqual(expectedBlobs))
        {
            throw new InvalidDataException("The restored database does not match the backup manifest.");
        }
    }

    private static void ValidatePublishedGeneration(
        string root,
        string generationName,
        VerifiedBackupArchive archive,
        bool requireCurrent = true)
    {
        var generation = Path.Combine(root, StorageGenerationLayout.GenerationsDirectoryName, generationName);
        var database = Path.Combine(generation, StorageGenerationLayout.DatabaseFileName);
        var ready = Path.Combine(generation, StorageGenerationLayout.ReadyMarkerFileName);
        if (!File.Exists(database) || !File.Exists(ready))
        {
            throw new InvalidDataException("The restored generation is incomplete.");
        }

        ValidateOrdinaryPath(root, generation);
        ValidateOrdinaryPath(root, database);
        ValidateOrdinaryPath(root, ready);
        ValidateRestoredDatabase(database, archive);
        foreach (var file in archive.Files.Where(file => file.Path != StorageGenerationLayout.DatabaseFileName))
        {
            var blob = Path.Combine(root, "attachments", "blobs", file.Sha256[..2], file.Sha256);
            ValidateOrdinaryPath(root, blob);
            using var stream = File.OpenRead(blob);
            if (stream.Length != file.SizeBytes ||
                !string.Equals(Convert.ToHexStringLower(SHA256.HashData(stream)), file.Sha256, StringComparison.Ordinal))
            {
                throw new InvalidDataException("A restored attachment blob failed final validation.");
            }
        }

        if (requireCurrent && StorageGenerationLayout.ReadCurrentGeneration(
                Path.Combine(root, StorageGenerationLayout.CurrentPointerFileName)) != generationName)
        {
            throw new InvalidDataException("The restored generation is not current.");
        }
    }

    private static string AllocateNextGenerationName(string generationsPath)
    {
        var maximum = 0;
        foreach (var entry in Directory.EnumerateFileSystemEntries(generationsPath, "*", SearchOption.TopDirectoryOnly))
        {
            RejectReparsePoint(entry, "A storage generation entry must not be a reparse point.");
            if (!Directory.Exists(entry))
            {
                throw new InvalidDataException("The generations directory contains a non-directory entry.");
            }

            var name = Path.GetFileName(entry);
            StorageGenerationLayout.ValidateGenerationName(name);
            maximum = Math.Max(maximum, int.Parse(name.AsSpan("generation-".Length), System.Globalization.CultureInfo.InvariantCulture));
        }

        if (maximum >= 99_999_999)
        {
            throw new InvalidOperationException("No storage generation number remains available.");
        }

        return $"generation-{maximum + 1:00000000}";
    }

    private static string CreateOrdinaryDescendant(string root, params string[] segments)
    {
        var current = Path.GetFullPath(root);
        RejectReparsePoint(current, "A restore root must not be a reparse point.");
        foreach (var segment in segments)
        {
            if (string.IsNullOrWhiteSpace(segment) ||
                segment.IndexOfAny(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) >= 0 ||
                segment is "." or "..")
            {
                throw new InvalidDataException("A restore path segment is invalid.");
            }

            current = Path.Combine(current, segment);
            Directory.CreateDirectory(current);
            RejectReparsePoint(current, "A restore directory must not be a reparse point.");
        }

        return current;
    }

    private static string CreateOwnedStagingDirectory(string parent, string recoveryLeaf, out string ownerToken)
    {
        for (var attempt = 0; attempt < 32; attempt++)
        {
            ownerToken = Guid.NewGuid().ToString("N");
            var candidate = Path.Combine(parent, $".{recoveryLeaf}.restore-{ownerToken}.tmp");
            if (CreateDirectory(candidate, 0))
            {
                RejectReparsePoint(candidate, "The private recovery staging directory must be ordinary.");
                return candidate;
            }

            var error = Marshal.GetLastWin32Error();
            if (error != ErrorAlreadyExists)
            {
                throw new IOException(
                    "The private recovery staging directory could not be created.",
                    new Win32Exception(error));
            }
        }

        throw new IOException("A unique private recovery staging directory could not be allocated.");
    }

    private static string ValidateOrdinaryDescendant(string root, params string[] segments)
    {
        var path = Path.Combine(new[] { Path.GetFullPath(root) }.Concat(segments).ToArray());
        ValidateOrdinaryPath(root, path);
        return path;
    }

    private static void ValidateOrdinaryPath(string root, string path)
    {
        var canonicalRoot = Path.GetFullPath(root);
        var candidate = Path.GetFullPath(path);
        if (!IsSameOrDescendant(canonicalRoot, candidate))
        {
            throw new InvalidDataException("A restore path is outside its root.");
        }

        RejectReparsePoint(canonicalRoot, "A restore root must not be a reparse point.");
        var relative = Path.GetRelativePath(canonicalRoot, candidate);
        if (relative == ".")
        {
            return;
        }

        var current = canonicalRoot;
        foreach (var segment in relative.Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar))
        {
            current = Path.Combine(current, segment);
            if (!Directory.Exists(current) && !File.Exists(current))
            {
                throw new FileNotFoundException("A restore path is missing.", current);
            }

            RejectReparsePoint(current, "A restore path must not contain a reparse point.");
        }
    }

    private static void RejectOverlap(string first, string second, string message)
    {
        var left = Path.GetFullPath(first);
        var right = Path.GetFullPath(second);
        if (IsSameOrDescendant(left, right) || IsSameOrDescendant(right, left))
        {
            throw new StorageRestoreException("restore_path_overlap", message);
        }
    }

    private static bool IsSameOrDescendant(string parent, string candidate)
    {
        var relative = Path.GetRelativePath(parent, candidate);
        return relative == "." ||
            (!Path.IsPathRooted(relative) && relative != ".." &&
             !relative.StartsWith($"..{Path.DirectorySeparatorChar}", StringComparison.Ordinal));
    }

    private static void RejectReparsePoint(string path, string message)
    {
        if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0)
        {
            throw new InvalidDataException(message);
        }
    }

    private static void TryDeleteCandidate(string root, string path)
    {
        try
        {
            var currentPath = Path.Combine(root, StorageGenerationLayout.CurrentPointerFileName);
            if (!File.Exists(currentPath))
            {
                return;
            }

            var current = StorageGenerationLayout.ReadCurrentGeneration(currentPath);
            if (string.Equals(current, Path.GetFileName(path), StringComparison.Ordinal))
            {
                return;
            }

            if (Directory.Exists(path))
            {
                ValidateOrdinaryPath(root, path);
                ValidateNoReparseEntries(path);
                Directory.Delete(path, recursive: true);
            }
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or InvalidDataException)
        {
            // An incomplete, non-current candidate remains harmless and can be cleaned on maintenance.
        }
    }

    private static void TryDeleteOwnedRecoveryRoot(string path, string ownerToken)
    {
        try
        {
            if (Directory.Exists(path))
            {
                var marker = Path.Combine(path, RecoveryOwnerFileName);
                if (!File.Exists(marker) ||
                    !string.Equals(File.ReadAllText(marker), $"{ownerToken}\n", StringComparison.Ordinal))
                {
                    return;
                }

                ValidateNoReparseEntries(path);
                Directory.Delete(path, recursive: true);
            }
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or InvalidDataException)
        {
            // A failed dry-run root is never published as the live data root.
        }
    }

    private static void TryRemoveRecoveryOwnerMarker(string root, string ownerToken)
    {
        try
        {
            var marker = Path.Combine(root, RecoveryOwnerFileName);
            ValidateOrdinaryPath(root, marker);
            if (string.Equals(File.ReadAllText(marker), $"{ownerToken}\n", StringComparison.Ordinal))
            {
                File.Delete(marker);
            }
        }
        catch (Exception error) when (
            error is IOException or UnauthorizedAccessException or InvalidDataException)
        {
            // The marker is harmless if cleanup fails after the recovery root was committed.
        }
    }

    private static void ValidateAppVersion(string value)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > 128 || value.Any(char.IsControl))
        {
            throw new ArgumentException("The application version is invalid.", nameof(value));
        }
    }

    private static void ValidateNoReparseEntries(string root)
    {
        var pending = new Stack<string>();
        pending.Push(root);
        while (pending.Count > 0)
        {
            var directory = pending.Pop();
            RejectReparsePoint(directory, "A restore cleanup directory must not be a reparse point.");
            foreach (var entry in Directory.EnumerateFileSystemEntries(directory, "*", SearchOption.TopDirectoryOnly))
            {
                RejectReparsePoint(entry, "A restore cleanup entry must not be a reparse point.");
                if (Directory.Exists(entry))
                {
                    pending.Push(entry);
                }
                else if (!File.Exists(entry))
                {
                    throw new InvalidDataException("A restore cleanup entry changed during validation.");
                }
            }
        }
    }

    private sealed record FileHash(long SizeBytes, string Sha256);
    private sealed record CurrentStorageFingerprint(
        string GenerationName,
        string DatabaseSha256,
        string Fingerprint,
        SqliteStorageBackupService.SnapshotInventory Inventory);

    private sealed record CompletedRestoreMarker(
        int Format,
        Guid PlanId,
        Guid BackupId,
        string BackupManifestSha256,
        string PreviousGenerationName,
        string PreviousFingerprint,
        StorageBackupResult PreRestoreBackup);

    [DllImport("kernel32.dll", EntryPoint = "CreateDirectoryW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CreateDirectory(string path, nint securityAttributes);
}
