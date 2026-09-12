using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using Techmap.Application;
using Techmap.Domain;
using Techmap.Infrastructure.Sqlite;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class StorageRestoreIntegrationTests
{
    [Fact]
    public async Task Dry_run_restores_verified_backup_to_new_root_without_changing_live_root()
    {
        using var fixture = RestoreFixture.Create();
        string liveDatabase;
        StorageBackupResult backup;
        Guid archivedProjectId;
        string blobHash;
        using (var storage = SqliteStorage.Open(fixture.DataRoot))
        {
            liveDatabase = storage.Layout.DatabasePath;
            var project = new SqliteProjectCatalog(storage).CreateProject(new CreateProjectCommand(
                "ARC-01", "Archived", 2, ProjectStatus.Active));
            archivedProjectId = project.ProjectId.Value;
            var attachment = await new SqliteProjectAttachmentCatalog(
                    storage,
                    new ContentAddressedAttachmentStore(fixture.DataRoot),
                    TimeProvider.System)
                .AddAsync(
                    project.ProjectId,
                    new MemoryStream(Encoding.UTF8.GetBytes("archive attachment")),
                    "drawing.txt",
                    "text/plain",
                    "drawing",
                    TestContext.Current.CancellationToken);
            blobHash = attachment.Content.Sha256;
            using var backupService = new SqliteStorageBackupService(fixture.DataRoot, liveDatabase);
            backup = await backupService.CreateAsync(
                new StorageBackupRequest(fixture.BackupRoot, "0.1.0-m1.11"),
                TestContext.Current.CancellationToken);
            new SqliteProjectCatalog(storage).CreateProject(new CreateProjectCommand(
                "LIVE-02", "Live only", 1, ProjectStatus.Draft));
        }

        var liveHash = HashFile(liveDatabase);
        var liveCurrent = File.ReadAllText(Path.Combine(fixture.DataRoot, "CURRENT"));
        using var dormantBackupService = new SqliteStorageBackupService(fixture.DataRoot, liveDatabase);
        using var restore = new SqliteStorageRestoreService(fixture.DataRoot, dormantBackupService);

        var result = await restore.DryRunAsync(
            new StorageDryRunRestoreRequest(backup.BackupPath, fixture.RecoveryRoot),
            TestContext.Current.CancellationToken);

        Assert.Equal(backup.BackupId, result.SourceBackup.BackupId);
        Assert.Equal(backup.DatabaseSha256, result.DatabaseSha256);
        Assert.Equal(liveHash, HashFile(liveDatabase));
        Assert.Equal(liveCurrent, File.ReadAllText(Path.Combine(fixture.DataRoot, "CURRENT")));
        Assert.True(File.Exists(Path.Combine(
            fixture.RecoveryRoot, "attachments", "blobs", blobHash[..2], blobHash)));
        using var recovered = SqliteStorage.Open(fixture.RecoveryRoot);
        Assert.Equal(archivedProjectId, Assert.Single(new SqliteProjectCatalog(recovered).ListProjects()).ProjectId.Value);
    }

    [Fact]
    public async Task Corrupt_backup_is_rejected_and_dry_run_root_is_not_published()
    {
        using var fixture = RestoreFixture.Create();
        StorageBackupResult backup;
        string databasePath;
        using (var storage = SqliteStorage.Open(fixture.DataRoot))
        {
            databasePath = storage.Layout.DatabasePath;
            using var backupService = new SqliteStorageBackupService(fixture.DataRoot, databasePath);
            backup = await backupService.CreateAsync(
                new StorageBackupRequest(fixture.BackupRoot, "0.1.0-m1.11"),
                TestContext.Current.CancellationToken);
        }

        await File.AppendAllTextAsync(
            Path.Combine(backup.BackupPath, "app.db"),
            "corrupt",
            TestContext.Current.CancellationToken);
        using var service = new SqliteStorageBackupService(fixture.DataRoot, databasePath);
        using var restore = new SqliteStorageRestoreService(fixture.DataRoot, service);

        var error = await Assert.ThrowsAsync<StorageRestoreException>(() => restore.DryRunAsync(
            new StorageDryRunRestoreRequest(backup.BackupPath, fixture.RecoveryRoot),
            TestContext.Current.CancellationToken));

        Assert.Equal("backup_invalid", error.Code);
        Assert.False(Directory.Exists(fixture.RecoveryRoot));
    }

    [Fact]
    public async Task Dry_run_publish_race_preserves_the_other_actors_recovery_root()
    {
        using var fixture = RestoreFixture.Create();
        StorageBackupResult backup;
        string databasePath;
        using (var storage = SqliteStorage.Open(fixture.DataRoot))
        {
            databasePath = storage.Layout.DatabasePath;
            using var backupService = new SqliteStorageBackupService(fixture.DataRoot, databasePath);
            backup = await backupService.CreateAsync(
                new StorageBackupRequest(fixture.BackupRoot, "0.1.0-m1.11"),
                TestContext.Current.CancellationToken);
        }

        var sentinel = Path.Combine(fixture.RecoveryRoot, "other-actor.txt");
        using var service = new SqliteStorageBackupService(fixture.DataRoot, databasePath);
        using var restore = new SqliteStorageRestoreService(
            fixture.DataRoot,
            service,
            progressHook: point =>
            {
                if (point == "dry_run_before_publish")
                {
                    Directory.CreateDirectory(fixture.RecoveryRoot);
                    File.WriteAllText(sentinel, "belongs to another actor");
                }
            });

        await Assert.ThrowsAsync<StorageRestoreException>(() => restore.DryRunAsync(
            new StorageDryRunRestoreRequest(backup.BackupPath, fixture.RecoveryRoot),
            TestContext.Current.CancellationToken));

        Assert.Equal("belongs to another actor", File.ReadAllText(sentinel));
        Assert.DoesNotContain(
            Directory.EnumerateDirectories(fixture.Root),
            path => Path.GetFileName(path).Contains(".restore-", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Dry_run_failure_after_blob_copy_removes_only_owned_staging()
    {
        using var fixture = RestoreFixture.Create();
        StorageBackupResult backup;
        string databasePath;
        using (var storage = SqliteStorage.Open(fixture.DataRoot))
        {
            databasePath = storage.Layout.DatabasePath;
            using var backupService = new SqliteStorageBackupService(fixture.DataRoot, databasePath);
            backup = await backupService.CreateAsync(
                new StorageBackupRequest(fixture.BackupRoot, "0.1.0-m1.11"),
                TestContext.Current.CancellationToken);
        }

        using var service = new SqliteStorageBackupService(fixture.DataRoot, databasePath);
        using var restore = new SqliteStorageRestoreService(
            fixture.DataRoot,
            service,
            progressHook: point =>
            {
                if (point == "dry_run_after_blobs")
                {
                    throw new IOException("simulated dry-run failure");
                }
            });

        await Assert.ThrowsAsync<StorageRestoreException>(() => restore.DryRunAsync(
            new StorageDryRunRestoreRequest(backup.BackupPath, fixture.RecoveryRoot),
            TestContext.Current.CancellationToken));

        Assert.False(Directory.Exists(fixture.RecoveryRoot));
        Assert.DoesNotContain(
            Directory.EnumerateDirectories(fixture.Root),
            path => Path.GetFileName(path).Contains(".restore-", StringComparison.Ordinal));
    }

    [Theory]
    [InlineData(1)]
    [InlineData(2)]
    [InlineData(3)]
    public async Task Older_readable_schema_can_be_dry_run_but_not_prepared_for_full_restore(int schemaVersion)
    {
        using var fixture = RestoreFixture.Create();
        string currentDatabase;
        using (var current = SqliteStorage.Open(fixture.DataRoot))
        {
            currentDatabase = current.Layout.DatabasePath;
        }

        var legacyRoot = Path.Combine(fixture.Root, $"legacy-{schemaVersion}");
        Directory.CreateDirectory(legacyRoot);
        var legacyDatabase = Path.Combine(legacyRoot, "legacy.db");
        using (var connection = new SqliteConnection($"Data Source={legacyDatabase};Pooling=False"))
        {
            connection.Open();
            SqliteStorage.InitializeSchemaAtVersion(connection, schemaVersion);
        }

        StorageBackupResult backup;
        using (var legacyBackup = new SqliteStorageBackupService(legacyRoot, legacyDatabase))
        {
            backup = await legacyBackup.CreateAsync(
                new StorageBackupRequest(fixture.BackupRoot, "legacy"),
                TestContext.Current.CancellationToken);
        }

        using var currentBackup = new SqliteStorageBackupService(fixture.DataRoot, currentDatabase);
        using var restore = new SqliteStorageRestoreService(fixture.DataRoot, currentBackup);
        var recovery = Path.Combine(fixture.Root, $"recovery-{schemaVersion}");

        var dryRun = await restore.DryRunAsync(
            new StorageDryRunRestoreRequest(backup.BackupPath, recovery),
            TestContext.Current.CancellationToken);
        Assert.Equal(schemaVersion, dryRun.SourceBackup.SchemaVersion);
        var error = await Assert.ThrowsAsync<StorageRestoreException>(() => restore.PrepareFullRestoreAsync(
            backup.BackupPath,
            TestContext.Current.CancellationToken));
        Assert.Equal("restore_schema_not_current", error.Code);
    }

    [Fact]
    public async Task Full_restore_requires_exact_confirmation_and_does_not_start_backup_without_it()
    {
        using var fixture = RestoreFixture.Create();
        StorageBackupResult backup;
        string databasePath;
        using (var storage = SqliteStorage.Open(fixture.DataRoot))
        {
            databasePath = storage.Layout.DatabasePath;
            using var backupService = new SqliteStorageBackupService(fixture.DataRoot, databasePath);
            backup = await backupService.CreateAsync(
                new StorageBackupRequest(fixture.BackupRoot, "0.1.0-m1.11"),
                TestContext.Current.CancellationToken);
        }

        var tracking = new TrackingBackupService();
        using var restore = new SqliteStorageRestoreService(fixture.DataRoot, tracking);
        var plan = await restore.PrepareFullRestoreAsync(
            backup.BackupPath,
            TestContext.Current.CancellationToken);

        var error = await Assert.ThrowsAsync<StorageRestoreException>(() => restore.RestoreAsync(
            new StorageFullRestoreRequest(plan, "yes", fixture.PreRestoreRoot, "0.1.0-m1.11"),
            TestContext.Current.CancellationToken));

        Assert.Equal("restore_confirmation_required", error.Code);
        Assert.Equal(0, tracking.CreateCount);
        Assert.Equal("generation-00000001\n", File.ReadAllText(Path.Combine(fixture.DataRoot, "CURRENT")));
    }

    [Fact]
    public async Task Full_restore_refuses_a_busy_live_data_root()
    {
        using var fixture = RestoreFixture.Create();
        StorageBackupResult backup;
        StorageFullRestorePlan plan;
        string databasePath;
        using (var storage = SqliteStorage.Open(fixture.DataRoot))
        {
            databasePath = storage.Layout.DatabasePath;
            using var backupService = new SqliteStorageBackupService(fixture.DataRoot, databasePath);
            backup = await backupService.CreateAsync(
                new StorageBackupRequest(fixture.BackupRoot, "0.1.0-m1.11"),
                TestContext.Current.CancellationToken);
            using var restore = new SqliteStorageRestoreService(fixture.DataRoot, backupService);
            plan = await restore.PrepareFullRestoreAsync(backup.BackupPath, TestContext.Current.CancellationToken);
        }

        using var owner = DataRootLease.Acquire(fixture.DataRoot);
        using var service = new SqliteStorageBackupService(fixture.DataRoot, databasePath);
        using var offlineRestore = new SqliteStorageRestoreService(fixture.DataRoot, service);

        var error = await Assert.ThrowsAsync<StorageRestoreException>(() => offlineRestore.RestoreAsync(
            new StorageFullRestoreRequest(
                plan, plan.RequiredConfirmation, fixture.PreRestoreRoot, "0.1.0-m1.11"),
            TestContext.Current.CancellationToken));

        Assert.IsType<DataRootLeaseUnavailableException>(error.InnerException);
        Assert.Equal("generation-00000001\n", File.ReadAllText(Path.Combine(fixture.DataRoot, "CURRENT")));
        Assert.Empty(Directory.EnumerateDirectories(fixture.PreRestoreRoot, "backup-*"));
    }

    [Fact]
    public async Task Cancellation_before_switch_keeps_old_generation_and_a_retry_succeeds()
    {
        using var fixture = RestoreFixture.Create();
        var scenario = await fixture.PrepareChangedLiveAndBackupAsync();
        using var cancelled = new CancellationTokenSource();
        using var backupService = new SqliteStorageBackupService(fixture.DataRoot, scenario.DatabasePath);
        using (var restore = new SqliteStorageRestoreService(
                   fixture.DataRoot,
                   backupService,
                   progressHook: point =>
                   {
                       if (point == "before_current_switch")
                       {
                           cancelled.Cancel();
                       }
                   }))
        {
            await Assert.ThrowsAnyAsync<OperationCanceledException>(() => restore.RestoreAsync(
                new StorageFullRestoreRequest(
                    scenario.Plan,
                    scenario.Plan.RequiredConfirmation,
                    fixture.PreRestoreRoot,
                    "0.1.0-m1.11"),
                cancelled.Token));
        }

        Assert.Equal("generation-00000001\n", File.ReadAllText(Path.Combine(fixture.DataRoot, "CURRENT")));
        Assert.False(Directory.Exists(Path.Combine(fixture.DataRoot, "generations", "generation-00000002")));

        using var retry = new SqliteStorageRestoreService(fixture.DataRoot, backupService);
        var result = await retry.RestoreAsync(
            new StorageFullRestoreRequest(
                scenario.Plan,
                scenario.Plan.RequiredConfirmation,
                fixture.PreRestoreRoot,
                "0.1.0-m1.11"),
            TestContext.Current.CancellationToken);
        Assert.Equal("generation-00000002", result.RestoredGenerationName);
    }

    [Fact]
    public async Task Existing_conflicting_blob_aborts_before_database_or_current_publish()
    {
        using var fixture = RestoreFixture.Create();
        StorageBackupResult backup;
        StorageFullRestorePlan plan;
        string databasePath;
        string hash;
        using (var storage = SqliteStorage.Open(fixture.DataRoot))
        {
            databasePath = storage.Layout.DatabasePath;
            var project = new SqliteProjectCatalog(storage).CreateProject(new CreateProjectCommand(
                "BLOB-01", "Blob", 1, ProjectStatus.Active));
            var attachment = await new SqliteProjectAttachmentCatalog(
                    storage,
                    new ContentAddressedAttachmentStore(fixture.DataRoot),
                    TimeProvider.System)
                .AddAsync(
                    project.ProjectId,
                    new MemoryStream(Encoding.UTF8.GetBytes("valid blob")),
                    "blob.txt",
                    "text/plain",
                    "source",
                    TestContext.Current.CancellationToken);
            hash = attachment.Content.Sha256;
            using var sourceBackup = new SqliteStorageBackupService(fixture.DataRoot, databasePath);
            backup = await sourceBackup.CreateAsync(
                new StorageBackupRequest(fixture.BackupRoot, "0.1.0-m1.11"),
                TestContext.Current.CancellationToken);
            using var restore = new SqliteStorageRestoreService(fixture.DataRoot, sourceBackup);
            plan = await restore.PrepareFullRestoreAsync(backup.BackupPath, TestContext.Current.CancellationToken);
        }

        File.WriteAllText(Path.Combine(fixture.DataRoot, "attachments", "blobs", hash[..2], hash), "bad");
        using var service = new SqliteStorageBackupService(fixture.DataRoot, databasePath);
        using var offlineRestore = new SqliteStorageRestoreService(fixture.DataRoot, service);

        var error = await Assert.ThrowsAsync<StorageRestoreException>(() => offlineRestore.RestoreAsync(
            new StorageFullRestoreRequest(
                plan, plan.RequiredConfirmation, fixture.PreRestoreRoot, "0.1.0-m1.11"),
            TestContext.Current.CancellationToken));

        Assert.Equal("restore_failed", error.Code);
        Assert.Equal("generation-00000001\n", File.ReadAllText(Path.Combine(fixture.DataRoot, "CURRENT")));
        Assert.False(Directory.Exists(Path.Combine(fixture.DataRoot, "generations", "generation-00000002")));
    }

    [Fact]
    public async Task Full_restore_publishes_verified_pre_restore_backup_and_switches_candidate_last()
    {
        using var fixture = RestoreFixture.Create();
        StorageBackupResult backup;
        StorageFullRestorePlan plan;
        string databasePath;
        Guid archivedProjectId;
        Guid liveOnlyProjectId;
        using (var storage = SqliteStorage.Open(fixture.DataRoot))
        {
            databasePath = storage.Layout.DatabasePath;
            archivedProjectId = new SqliteProjectCatalog(storage).CreateProject(new CreateProjectCommand(
                "ARC-02", "Restore me", 1, ProjectStatus.Active)).ProjectId.Value;
            using var backupService = new SqliteStorageBackupService(fixture.DataRoot, databasePath);
            backup = await backupService.CreateAsync(
                new StorageBackupRequest(fixture.BackupRoot, "0.1.0-m1.11"),
                TestContext.Current.CancellationToken);
            liveOnlyProjectId = new SqliteProjectCatalog(storage).CreateProject(new CreateProjectCommand(
                "LIVE-03", "Preserve before restore", 1, ProjectStatus.Draft)).ProjectId.Value;
            using var restore = new SqliteStorageRestoreService(fixture.DataRoot, backupService);
            plan = await restore.PrepareFullRestoreAsync(backup.BackupPath, TestContext.Current.CancellationToken);
        }

        using var offlineBackupService = new SqliteStorageBackupService(fixture.DataRoot, databasePath);
        using var offlineRestore = new SqliteStorageRestoreService(fixture.DataRoot, offlineBackupService);
        var result = await offlineRestore.RestoreAsync(
            new StorageFullRestoreRequest(
                plan,
                plan.RequiredConfirmation,
                fixture.PreRestoreRoot,
                "0.1.0-m1.11"),
            TestContext.Current.CancellationToken);

        Assert.Equal(StorageBackupKind.PreRestore, result.PreRestoreBackup.Kind);
        Assert.Equal("generation-00000001", result.PreviousGenerationName);
        Assert.Equal("generation-00000002", result.RestoredGenerationName);
        Assert.Equal("generation-00000002\n", File.ReadAllText(Path.Combine(fixture.DataRoot, "CURRENT")));
        Assert.True(File.Exists(Path.Combine(
            fixture.DataRoot, "generations", "generation-00000002", "READY")));
        using (var restored = SqliteStorage.Open(fixture.DataRoot))
        {
            Assert.Equal(archivedProjectId, Assert.Single(new SqliteProjectCatalog(restored).ListProjects()).ProjectId.Value);
        }

        Assert.Equal(liveOnlyProjectId.ToString("D"), Scalar(
            Path.Combine(result.PreRestoreBackup.BackupPath, "app.db"),
            "SELECT project_id FROM projects WHERE designation = 'LIVE-03';"));
    }

    [Fact]
    public async Task Full_restore_preserves_published_reference_catalog_snapshot_and_active_records()
    {
        using var fixture = RestoreFixture.Create();
        StorageBackupResult backup;
        StorageFullRestorePlan plan;
        string databasePath;
        ReferenceCatalogSnapshot expectedSnapshot;
        using (var storage = SqliteStorage.Open(fixture.DataRoot))
        {
            databasePath = storage.Layout.DatabasePath;
            var store = new SqliteReferenceCatalogSnapshotStore(storage);
            using var payload = JsonDocument.Parse("""{"manufacturer":"Acme","value":17}""");
            var validation = ReferenceCatalogDraft.Create(
                ReferenceCatalogSnapshotIdentity.New(),
                "technology-database",
                1,
                new DateTimeOffset(2026, 9, 12, 18, 0, 0, TimeSpan.Zero),
                new ReferenceCatalogProvenanceInput("xlsx", "catalog-v1", "technology-database.xlsx"),
                [new ReferenceCatalogRecordInput(
                    "terminal",
                    "TER-001",
                    payload.RootElement.Clone(),
                    "БД.ТЕР!2")])
                .Validate();
            expectedSnapshot = Assert.IsType<ReferenceCatalogSnapshot>(
                new ReferenceCatalogPublicationService(store).Publish(new ReferenceCatalogPublicationRequest(
                    validation,
                    null,
                    validation.Snapshot!.Sha256,
                    validation.RequiredWarningAcknowledgements)).PublishedSnapshot);

            using var backupService = new SqliteStorageBackupService(fixture.DataRoot, databasePath);
            backup = await backupService.CreateAsync(
                new StorageBackupRequest(fixture.BackupRoot, "0.1.0-m2.01"),
                TestContext.Current.CancellationToken);

            using var changedPayload = JsonDocument.Parse("""{"manufacturer":"Acme","value":99}""");
            var changedValidation = ReferenceCatalogDraft.Create(
                ReferenceCatalogSnapshotIdentity.New(),
                "technology-database",
                1,
                new DateTimeOffset(2026, 9, 12, 19, 0, 0, TimeSpan.Zero),
                new ReferenceCatalogProvenanceInput("xlsx", "catalog-v2", "technology-database.xlsx"),
                [new ReferenceCatalogRecordInput(
                    "terminal",
                    "TER-001",
                    changedPayload.RootElement.Clone(),
                    "БД.ТЕР!2")])
                .Validate();
            var changed = new ReferenceCatalogPublicationService(store).Publish(
                new ReferenceCatalogPublicationRequest(
                    changedValidation,
                    expectedSnapshot.SnapshotId,
                    changedValidation.Snapshot!.Sha256,
                    changedValidation.RequiredWarningAcknowledgements));
            Assert.Equal(ReferenceCatalogPublicationStatus.Published, changed.Status);

            using var restore = new SqliteStorageRestoreService(fixture.DataRoot, backupService);
            plan = await restore.PrepareFullRestoreAsync(
                backup.BackupPath,
                TestContext.Current.CancellationToken);
        }

        using var offlineBackupService = new SqliteStorageBackupService(fixture.DataRoot, databasePath);
        using var offlineRestore = new SqliteStorageRestoreService(fixture.DataRoot, offlineBackupService);
        await offlineRestore.RestoreAsync(
            new StorageFullRestoreRequest(
                plan,
                plan.RequiredConfirmation,
                fixture.PreRestoreRoot,
                "0.1.0-m2.01"),
            TestContext.Current.CancellationToken);

        using var restored = SqliteStorage.Open(fixture.DataRoot);
        var restoredStore = new SqliteReferenceCatalogSnapshotStore(restored);
        var actualSnapshot = Assert.IsType<ReferenceCatalogSnapshot>(
            restoredStore.GetActive("technology-database"));
        Assert.Equal(expectedSnapshot.SnapshotId, actualSnapshot.SnapshotId);
        Assert.Equal(expectedSnapshot.Sha256, actualSnapshot.Sha256);
        Assert.Equal(expectedSnapshot.CanonicalJson, actualSnapshot.CanonicalJson);
        var expectedRecord = Assert.Single(expectedSnapshot.Records);
        var actualRecord = Assert.Single(actualSnapshot.Records);
        Assert.Equal(expectedRecord.RecordId, actualRecord.RecordId);
        Assert.Equal(expectedRecord.SnapshotId, actualRecord.SnapshotId);
        Assert.Equal(expectedRecord.EntityType, actualRecord.EntityType);
        Assert.Equal(expectedRecord.SourceKey, actualRecord.SourceKey);
        Assert.Equal(expectedRecord.Payload.GetRawText(), actualRecord.Payload.GetRawText());
        Assert.Single(restoredStore.List("technology-database"));
    }

    [Fact]
    public async Task Stale_plan_is_rejected_before_pre_restore_backup()
    {
        using var fixture = RestoreFixture.Create();
        StorageBackupResult backup;
        StorageFullRestorePlan plan;
        string databasePath;
        using (var storage = SqliteStorage.Open(fixture.DataRoot))
        {
            databasePath = storage.Layout.DatabasePath;
            using var sourceBackup = new SqliteStorageBackupService(fixture.DataRoot, databasePath);
            backup = await sourceBackup.CreateAsync(
                new StorageBackupRequest(fixture.BackupRoot, "0.1.0-m1.11"),
                TestContext.Current.CancellationToken);
            using var restore = new SqliteStorageRestoreService(fixture.DataRoot, sourceBackup);
            plan = await restore.PrepareFullRestoreAsync(backup.BackupPath, TestContext.Current.CancellationToken);
            new SqliteProjectCatalog(storage).CreateProject(new CreateProjectCommand(
                "CHANGE-01", "Changed after approval", 1, ProjectStatus.Draft));
        }

        var tracking = new TrackingBackupService();
        using var offlineRestore = new SqliteStorageRestoreService(fixture.DataRoot, tracking);
        var error = await Assert.ThrowsAsync<StorageRestoreException>(() => offlineRestore.RestoreAsync(
            new StorageFullRestoreRequest(
                plan, plan.RequiredConfirmation, fixture.PreRestoreRoot, "0.1.0-m1.11"),
            TestContext.Current.CancellationToken));

        Assert.Equal("restore_plan_stale", error.Code);
        Assert.Equal(0, tracking.CreateCount);
        Assert.Equal("generation-00000001\n", File.ReadAllText(Path.Combine(fixture.DataRoot, "CURRENT")));
    }

    [Fact]
    public async Task Failure_before_current_switch_keeps_previous_generation_current()
    {
        using var fixture = RestoreFixture.Create();
        var scenario = await fixture.PrepareChangedLiveAndBackupAsync();
        using var backupService = new SqliteStorageBackupService(fixture.DataRoot, scenario.DatabasePath);
        using var restore = new SqliteStorageRestoreService(
            fixture.DataRoot,
            backupService,
            progressHook: point =>
            {
                if (point == "before_current_switch")
                {
                    throw new IOException("simulated crash point");
                }
            });

        var error = await Assert.ThrowsAsync<StorageRestoreException>(() => restore.RestoreAsync(
            new StorageFullRestoreRequest(
                scenario.Plan,
                scenario.Plan.RequiredConfirmation,
                fixture.PreRestoreRoot,
                "0.1.0-m1.11"),
            TestContext.Current.CancellationToken));

        Assert.Equal("restore_failed", error.Code);
        Assert.Equal("generation-00000001\n", File.ReadAllText(Path.Combine(fixture.DataRoot, "CURRENT")));
        Assert.False(Directory.Exists(Path.Combine(
            fixture.DataRoot, "generations", "generation-00000002")));
        using var live = SqliteStorage.Open(fixture.DataRoot);
        Assert.Equal(2, new SqliteProjectCatalog(live).ListProjects().Count);
    }

    [Fact]
    public async Task Observer_failure_after_current_switch_returns_success_and_retry_is_idempotent()
    {
        using var fixture = RestoreFixture.Create();
        var scenario = await fixture.PrepareChangedLiveAndBackupAsync();
        using var backupService = new SqliteStorageBackupService(fixture.DataRoot, scenario.DatabasePath);
        using var restore = new SqliteStorageRestoreService(
            fixture.DataRoot,
            backupService,
            progressHook: point =>
            {
                if (point == "after_current_switch")
                {
                    throw new IOException("simulated process failure after switch");
                }
            });

        var request = new StorageFullRestoreRequest(
            scenario.Plan,
            scenario.Plan.RequiredConfirmation,
            fixture.PreRestoreRoot,
            "0.1.0-m1.11");
        var result = await restore.RestoreAsync(
            request,
            TestContext.Current.CancellationToken);

        Assert.Equal("generation-00000002", result.RestoredGenerationName);
        Assert.Equal("generation-00000002\n", File.ReadAllText(Path.Combine(fixture.DataRoot, "CURRENT")));
        var preRestoreCount = Directory.EnumerateDirectories(fixture.PreRestoreRoot, "backup-*").Count();
        using var retry = new SqliteStorageRestoreService(fixture.DataRoot, backupService);
        var retryResult = await retry.RestoreAsync(
            request,
            TestContext.Current.CancellationToken);

        Assert.Equal(result.SourceBackup.BackupId, retryResult.SourceBackup.BackupId);
        Assert.Equal(result.PreRestoreBackup.BackupId, retryResult.PreRestoreBackup.BackupId);
        Assert.Equal(result.PreviousGenerationName, retryResult.PreviousGenerationName);
        Assert.Equal(result.RestoredGenerationName, retryResult.RestoredGenerationName);
        Assert.Equal(result.PreviousFingerprint, retryResult.PreviousFingerprint);
        Assert.Equal(preRestoreCount, Directory.EnumerateDirectories(fixture.PreRestoreRoot, "backup-*").Count());
        using var restored = SqliteStorage.Open(fixture.DataRoot);
        Assert.Single(new SqliteProjectCatalog(restored).ListProjects());
    }

    [Fact]
    public async Task Failure_reported_immediately_after_current_rename_never_deletes_active_generation()
    {
        using var fixture = RestoreFixture.Create();
        var scenario = await fixture.PrepareChangedLiveAndBackupAsync();
        using var backupService = new SqliteStorageBackupService(fixture.DataRoot, scenario.DatabasePath);
        using var restore = new SqliteStorageRestoreService(
            fixture.DataRoot,
            backupService,
            progressHook: point =>
            {
                if (point == "after_current_rename_before_return")
                {
                    throw new InvalidOperationException("simulated post-rename observer failure");
                }
            });

        var result = await restore.RestoreAsync(
            new StorageFullRestoreRequest(
                scenario.Plan,
                scenario.Plan.RequiredConfirmation,
                fixture.PreRestoreRoot,
                "0.1.0-m1.11"),
            TestContext.Current.CancellationToken);

        Assert.Equal("generation-00000002", result.RestoredGenerationName);
        Assert.Equal("generation-00000002\n", File.ReadAllText(Path.Combine(fixture.DataRoot, "CURRENT")));
        Assert.True(File.Exists(Path.Combine(
            fixture.DataRoot, "generations", "generation-00000002", "app.db")));
        using var live = SqliteStorage.Open(fixture.DataRoot);
        Assert.Single(new SqliteProjectCatalog(live).ListProjects());
    }

    [Fact]
    public async Task Attachment_junction_is_rejected_before_restore_writes_outside_data_root()
    {
        using var fixture = RestoreFixture.Create();
        var scenario = await fixture.PrepareChangedLiveAndBackupAsync();
        var attachments = Path.Combine(fixture.DataRoot, "attachments");
        var outside = Path.Combine(fixture.Root, "outside-attachments");
        Directory.CreateDirectory(outside);
        if (!TryCreateJunction(attachments, outside))
        {
            Assert.Skip("This Windows environment does not allow creation of a test junction.");
        }

        try
        {
            using var backupService = new SqliteStorageBackupService(fixture.DataRoot, scenario.DatabasePath);
            using var restore = new SqliteStorageRestoreService(fixture.DataRoot, backupService);
            var error = await Assert.ThrowsAsync<StorageRestoreException>(() => restore.RestoreAsync(
                new StorageFullRestoreRequest(
                    scenario.Plan,
                    scenario.Plan.RequiredConfirmation,
                    fixture.PreRestoreRoot,
                    "0.1.0-m1.11"),
                TestContext.Current.CancellationToken));

            Assert.Equal("restore_failed", error.Code);
            Assert.Empty(Directory.EnumerateFileSystemEntries(outside));
            Assert.Equal("generation-00000001\n", File.ReadAllText(Path.Combine(fixture.DataRoot, "CURRENT")));
        }
        finally
        {
            Directory.Delete(attachments);
        }
    }

    [Fact]
    public async Task Pre_restore_backup_failure_aborts_before_candidate_creation()
    {
        using var fixture = RestoreFixture.Create();
        var scenario = await fixture.PrepareChangedLiveAndBackupAsync();
        var failing = new TrackingBackupService(fail: true);
        using var restore = new SqliteStorageRestoreService(fixture.DataRoot, failing);

        var error = await Assert.ThrowsAsync<StorageRestoreException>(() => restore.RestoreAsync(
            new StorageFullRestoreRequest(
                scenario.Plan,
                scenario.Plan.RequiredConfirmation,
                fixture.PreRestoreRoot,
                "0.1.0-m1.11"),
            TestContext.Current.CancellationToken));

        Assert.IsType<StorageBackupException>(error.InnerException);
        Assert.Equal(1, failing.CreateCount);
        Assert.Equal("generation-00000001\n", File.ReadAllText(Path.Combine(fixture.DataRoot, "CURRENT")));
        Assert.False(Directory.Exists(Path.Combine(
            fixture.DataRoot, "generations", "generation-00000002")));
    }

    private static string HashFile(string path) =>
        Convert.ToHexStringLower(SHA256.HashData(File.ReadAllBytes(path)));

    private static string Scalar(string databasePath, string sql)
    {
        using var connection = new SqliteConnection($"Data Source={databasePath};Mode=ReadOnly;Pooling=False");
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = sql;
        return Convert.ToString(command.ExecuteScalar(), System.Globalization.CultureInfo.InvariantCulture)!;
    }

    private static bool TryCreateJunction(string junction, string target)
    {
        using var process = Process.Start(new ProcessStartInfo
        {
            FileName = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "cmd.exe"),
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            ArgumentList = { "/d", "/c", "mklink", "/J", junction, target },
        });
        if (process is null)
        {
            return false;
        }

        process.WaitForExit();
        return process.ExitCode == 0 && Directory.Exists(junction);
    }

    private sealed class TrackingBackupService(bool fail = false) : IStorageBackupService
    {
        public int CreateCount { get; private set; }

        public Task<StorageBackupResult> CreateAsync(
            StorageBackupRequest request,
            CancellationToken cancellationToken = default)
        {
            CreateCount++;
            if (fail)
            {
                throw new StorageBackupException("backup_failed", "simulated pre-restore failure");
            }

            throw new InvalidOperationException("This test does not expect a successful backup.");
        }

        public Task<StorageBackupResult?> CreateIfChangedAsync(
            StorageBackupRequest request,
            string? previousDatabaseSha256,
            CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public IReadOnlyList<StorageBackupResult> ApplyRetention(string backupRoot, int maximumBackups) =>
            throw new NotSupportedException();
    }

    private sealed class RestoreFixture : IDisposable
    {
        private RestoreFixture(string root)
        {
            Root = root;
            DataRoot = Path.Combine(root, "data");
            BackupRoot = Path.Combine(root, "backups");
            PreRestoreRoot = Path.Combine(root, "pre-restore");
            RecoveryRoot = Path.Combine(root, "recovery");
            Directory.CreateDirectory(DataRoot);
            Directory.CreateDirectory(BackupRoot);
            Directory.CreateDirectory(PreRestoreRoot);
        }

        public string Root { get; }
        public string DataRoot { get; }
        public string BackupRoot { get; }
        public string PreRestoreRoot { get; }
        public string RecoveryRoot { get; }

        public static RestoreFixture Create()
        {
            var root = Path.Combine(Path.GetTempPath(), "techmap-storage-restore", Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(root);
            return new RestoreFixture(root);
        }

        public async Task<RestoreScenario> PrepareChangedLiveAndBackupAsync()
        {
            StorageBackupResult backup;
            StorageFullRestorePlan plan;
            string databasePath;
            using (var storage = SqliteStorage.Open(DataRoot))
            {
                databasePath = storage.Layout.DatabasePath;
                var catalog = new SqliteProjectCatalog(storage);
                catalog.CreateProject(new CreateProjectCommand("ARC-03", "Archived", 1, ProjectStatus.Active));
                using var backupService = new SqliteStorageBackupService(DataRoot, databasePath);
                backup = await backupService.CreateAsync(
                    new StorageBackupRequest(BackupRoot, "0.1.0-m1.11"),
                    TestContext.Current.CancellationToken);
                catalog.CreateProject(new CreateProjectCommand("LIVE-04", "Live only", 1, ProjectStatus.Draft));
                using var restore = new SqliteStorageRestoreService(DataRoot, backupService);
                plan = await restore.PrepareFullRestoreAsync(backup.BackupPath, TestContext.Current.CancellationToken);
            }

            return new RestoreScenario(databasePath, backup, plan);
        }

        public void Dispose()
        {
            if (Directory.Exists(Root))
            {
                Directory.Delete(Root, recursive: true);
            }
        }
    }

    private sealed record RestoreScenario(
        string DatabasePath,
        StorageBackupResult Backup,
        StorageFullRestorePlan Plan);
}
