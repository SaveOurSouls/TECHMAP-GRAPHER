using System.Security.Cryptography;
using System.Diagnostics;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using Techmap.Application;
using Techmap.Infrastructure.Sqlite;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class StorageMigrationIntegrationTests
{
    [Fact]
    public void Open_rejects_legacy_current_without_mutating_it()
    {
        using var fixture = MigrationFixture.Create(schemaVersion: 1);
        var before = HashFile(fixture.DatabasePath);

        var error = Assert.Throws<StorageMigrationRequiredException>(() =>
            SqliteStorage.Open(fixture.DataRoot));

        Assert.Equal(1, error.FoundSchemaVersion);
        Assert.Equal(SqliteStorage.CurrentSchemaVersion, error.RequiredSchemaVersion);
        Assert.Equal(before, HashFile(fixture.DatabasePath));
        Assert.Equal(StorageGenerationLayout.InitialGenerationName, fixture.CurrentGeneration());
    }

    [Fact]
    public async Task Migrates_verified_backup_into_new_generation_and_preserves_source()
    {
        using var fixture = MigrationFixture.Create(schemaVersion: 1);
        var sourceHash = HashFile(fixture.DatabasePath);
        await using var lease = DataRootLease.Acquire(fixture.DataRoot);

        var service = new SqliteStorageMigrationService(lease);
        var result = await service.MigrateIfRequiredAsync(
            fixture.Request(), TestContext.Current.CancellationToken);

        Assert.True(result.Migrated);
        Assert.False(result.Recovered);
        Assert.NotNull(result.PreUpdateBackup);
        Assert.Equal(StorageBackupKind.PreUpdate, result.PreUpdateBackup.Kind);
        Assert.Equal(1, result.PreUpdateBackup.SchemaVersion);
        Assert.NotEqual(result.SourceGenerationName, result.CurrentGenerationName);
        Assert.Equal(sourceHash, HashFile(fixture.DatabasePath));
        Assert.Equal(result.CurrentGenerationName, fixture.CurrentGeneration());
        Assert.True(File.Exists(fixture.JournalPath));
        using var opened = SqliteStorage.Open(fixture.DataRoot);
        Assert.Equal(result.CurrentGenerationName, opened.Layout.GenerationName);
        Assert.Equal(SqliteStorage.CurrentSchemaVersion, opened.Diagnostics.SchemaVersion);
        service.CompleteSuccessfulStartup(result);
        Assert.False(File.Exists(fixture.JournalPath));
    }

    [Fact]
    public async Task Backup_failure_does_not_create_journal_or_candidate()
    {
        using var fixture = MigrationFixture.Create(schemaVersion: 1);
        await using var lease = DataRootLease.Acquire(fixture.DataRoot);
        var request = fixture.Request() with { BackupRoot = Path.Combine(fixture.DataRoot, "inside") };

        var error = await Assert.ThrowsAsync<StorageMigrationException>(() =>
            new SqliteStorageMigrationService(lease).MigrateIfRequiredAsync(
                request, TestContext.Current.CancellationToken));

        Assert.Equal("migration_failed", error.Code);
        Assert.False(File.Exists(fixture.JournalPath));
        Assert.Equal([StorageGenerationLayout.InitialGenerationName], fixture.GenerationNames());
        Assert.Equal(StorageGenerationLayout.InitialGenerationName, fixture.CurrentGeneration());
    }

    [Fact]
    public async Task Crash_after_journal_restarts_with_a_new_verified_attempt()
    {
        using var fixture = MigrationFixture.Create(schemaVersion: 1);
        await using var lease = DataRootLease.Acquire(fixture.DataRoot);
        var service = new SqliteStorageMigrationService(lease, phase =>
        {
            if (phase == "after_journal")
            {
                throw new SimulatedCrashException();
            }
        });

        await Assert.ThrowsAsync<StorageMigrationException>(() => service.MigrateIfRequiredAsync(
            fixture.Request(), TestContext.Current.CancellationToken));
        Assert.True(File.Exists(fixture.JournalPath));
        Assert.Single(fixture.GenerationNames());

        var recoveryService = new SqliteStorageMigrationService(lease);
        var recovered = await recoveryService.MigrateIfRequiredAsync(
            fixture.Request(), TestContext.Current.CancellationToken);

        Assert.True(recovered.Migrated);
        Assert.True(File.Exists(fixture.JournalPath));
        recoveryService.CompleteSuccessfulStartup(recovered);
        Assert.False(File.Exists(fixture.JournalPath));
        Assert.Equal(2, Directory.GetDirectories(fixture.BackupRoot).Count(path =>
            !Path.GetFileName(path).StartsWith(".", StringComparison.Ordinal)));
    }

    [Fact]
    public async Task Crash_after_ready_recovers_same_candidate_and_switches_current()
    {
        using var fixture = MigrationFixture.Create(schemaVersion: 2);
        await using var lease = DataRootLease.Acquire(fixture.DataRoot);
        var service = new SqliteStorageMigrationService(lease, phase =>
        {
            if (phase == "after_ready")
            {
                throw new SimulatedCrashException();
            }
        });

        await Assert.ThrowsAsync<StorageMigrationException>(() => service.MigrateIfRequiredAsync(
            fixture.Request(), TestContext.Current.CancellationToken));
        Assert.Equal(StorageGenerationLayout.InitialGenerationName, fixture.CurrentGeneration());
        Assert.True(File.Exists(fixture.JournalPath));
        Assert.Equal(2, fixture.GenerationNames().Length);

        var recoveryService = new SqliteStorageMigrationService(lease);
        var recovered = await recoveryService.MigrateIfRequiredAsync(
            fixture.Request(), TestContext.Current.CancellationToken);

        Assert.True(recovered.Recovered);
        Assert.NotEqual(StorageGenerationLayout.InitialGenerationName, fixture.CurrentGeneration());
        Assert.True(File.Exists(fixture.JournalPath));
        recoveryService.CompleteSuccessfulStartup(recovered);
        Assert.False(File.Exists(fixture.JournalPath));
        Assert.Single(
            Directory.GetDirectories(fixture.BackupRoot),
            path => !Path.GetFileName(path).StartsWith(".", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Missing_current_with_ready_candidate_finishes_recorded_switch()
    {
        using var fixture = MigrationFixture.Create(schemaVersion: 2);
        await using var lease = DataRootLease.Acquire(fixture.DataRoot);
        var interrupted = new SqliteStorageMigrationService(lease, phase =>
        {
            if (phase == "after_ready")
            {
                throw new SimulatedCrashException();
            }
        });
        await Assert.ThrowsAsync<StorageMigrationException>(() => interrupted.MigrateIfRequiredAsync(
            fixture.Request(), TestContext.Current.CancellationToken));
        File.Delete(fixture.CurrentPath);

        var recovery = new SqliteStorageMigrationService(lease);
        var result = await recovery.MigrateIfRequiredAsync(
            fixture.Request(), TestContext.Current.CancellationToken);

        Assert.True(result.Recovered);
        Assert.Equal(result.CurrentGenerationName, fixture.CurrentGeneration());
        Assert.NotEqual(StorageGenerationLayout.InitialGenerationName, result.CurrentGenerationName);
        using var opened = SqliteStorage.Open(fixture.DataRoot);
        Assert.Equal(SqliteStorage.CurrentSchemaVersion, opened.Diagnostics.SchemaVersion);
        recovery.CompleteSuccessfulStartup(result);
    }

    [Fact]
    public async Task Missing_current_with_incomplete_candidate_restores_verified_source()
    {
        using var fixture = MigrationFixture.Create(schemaVersion: 2);
        await using var lease = DataRootLease.Acquire(fixture.DataRoot);
        var interrupted = new SqliteStorageMigrationService(lease, phase =>
        {
            if (phase == "after_candidate_created")
            {
                throw new SimulatedCrashException();
            }
        });
        await Assert.ThrowsAsync<StorageMigrationException>(() => interrupted.MigrateIfRequiredAsync(
            fixture.Request(), TestContext.Current.CancellationToken));
        File.Delete(fixture.CurrentPath);
        var fallbackObserved = false;
        var recovery = new SqliteStorageMigrationService(lease, phase =>
        {
            if (phase == "recovered_incomplete_candidate")
            {
                fallbackObserved = true;
                Assert.Equal(StorageGenerationLayout.InitialGenerationName, fixture.CurrentGeneration());
                throw new SimulatedCrashException();
            }
        });

        await Assert.ThrowsAsync<StorageMigrationException>(() => recovery.MigrateIfRequiredAsync(
            fixture.Request(), TestContext.Current.CancellationToken));

        Assert.True(fallbackObserved);
        Assert.Equal(StorageGenerationLayout.InitialGenerationName, fixture.CurrentGeneration());
        Assert.Single(fixture.GenerationNames());
    }

    [Fact]
    public async Task Invalid_current_with_ready_candidate_is_replaced_from_journal()
    {
        using var fixture = MigrationFixture.Create(schemaVersion: 3);
        await using var lease = DataRootLease.Acquire(fixture.DataRoot);
        var interrupted = new SqliteStorageMigrationService(lease, phase =>
        {
            if (phase == "after_ready")
            {
                throw new SimulatedCrashException();
            }
        });
        await Assert.ThrowsAsync<StorageMigrationException>(() => interrupted.MigrateIfRequiredAsync(
            fixture.Request(), TestContext.Current.CancellationToken));
        File.WriteAllText(fixture.CurrentPath, "damaged pointer\nsecond line\n");

        var recovery = new SqliteStorageMigrationService(lease);
        var result = await recovery.MigrateIfRequiredAsync(
            fixture.Request(), TestContext.Current.CancellationToken);

        Assert.True(result.Recovered);
        Assert.Equal(result.CurrentGenerationName, fixture.CurrentGeneration());
        recovery.CompleteSuccessfulStartup(result);
    }

    [Fact]
    public async Task Current_candidate_without_ready_marker_fails_closed_and_preserves_candidate()
    {
        using var fixture = MigrationFixture.Create(schemaVersion: 2);
        await using var lease = DataRootLease.Acquire(fixture.DataRoot);
        var interrupted = new SqliteStorageMigrationService(lease, phase =>
        {
            if (phase == "after_ready")
            {
                throw new SimulatedCrashException();
            }
        });
        await Assert.ThrowsAsync<StorageMigrationException>(() => interrupted.MigrateIfRequiredAsync(
            fixture.Request(), TestContext.Current.CancellationToken));
        var candidateName = fixture.GenerationNames().Single(name =>
            name != StorageGenerationLayout.InitialGenerationName);
        var candidatePath = fixture.GenerationPath(candidateName);
        File.WriteAllText(fixture.CurrentPath, $"{candidateName}\n");
        File.Delete(Path.Combine(candidatePath, StorageGenerationLayout.ReadyMarkerFileName));

        var error = await Assert.ThrowsAsync<StorageMigrationException>(() =>
            new SqliteStorageMigrationService(lease).MigrateIfRequiredAsync(
                fixture.Request(), TestContext.Current.CancellationToken));

        Assert.Equal("active_candidate_incomplete", error.Code);
        Assert.Equal(candidateName, fixture.CurrentGeneration());
        Assert.True(Directory.Exists(candidatePath));
        Assert.True(File.Exists(fixture.JournalPath));
    }

    [Fact]
    public async Task Incomplete_candidate_with_junction_fails_closed_and_preserves_candidate()
    {
        using var fixture = MigrationFixture.Create(schemaVersion: 2);
        await using var lease = DataRootLease.Acquire(fixture.DataRoot);
        var interrupted = new SqliteStorageMigrationService(lease, phase =>
        {
            if (phase == "after_candidate_created")
            {
                throw new SimulatedCrashException();
            }
        });
        await Assert.ThrowsAsync<StorageMigrationException>(() => interrupted.MigrateIfRequiredAsync(
            fixture.Request(), TestContext.Current.CancellationToken));
        var candidateName = fixture.GenerationNames().Single(name =>
            name != StorageGenerationLayout.InitialGenerationName);
        var candidatePath = fixture.GenerationPath(candidateName);
        var outside = Path.Combine(fixture.Root, "outside");
        var junction = Path.Combine(candidatePath, "unsafe-junction");
        Directory.CreateDirectory(outside);
        if (!TryCreateJunction(junction, outside))
        {
            Assert.Skip("This Windows environment does not allow creation of a test junction.");
        }

        try
        {
            var error = await Assert.ThrowsAsync<StorageMigrationException>(() =>
                new SqliteStorageMigrationService(lease).MigrateIfRequiredAsync(
                    fixture.Request(), TestContext.Current.CancellationToken));

            Assert.Equal("migration_failed", error.Code);
            Assert.Equal(StorageGenerationLayout.InitialGenerationName, fixture.CurrentGeneration());
            Assert.True(Directory.Exists(candidatePath));
            Assert.True(Directory.Exists(junction));
            Assert.True(File.Exists(fixture.JournalPath));
        }
        finally
        {
            if (Directory.Exists(junction))
            {
                Directory.Delete(junction);
            }
        }
    }

    [Fact]
    public async Task Exception_inside_schema_step_rolls_back_candidate_and_keeps_current()
    {
        using var fixture = MigrationFixture.Create(schemaVersion: 2);
        await using var lease = DataRootLease.Acquire(fixture.DataRoot);
        var service = new SqliteStorageMigrationService(lease, phase =>
        {
            if (phase == "inside_migration_step_2_to_3")
            {
                throw new SimulatedCrashException();
            }
        });

        await Assert.ThrowsAsync<StorageMigrationException>(() => service.MigrateIfRequiredAsync(
            fixture.Request(), TestContext.Current.CancellationToken));

        Assert.Equal(StorageGenerationLayout.InitialGenerationName, fixture.CurrentGeneration());
        var candidateDatabase = Directory.GetFiles(
            Path.Combine(fixture.DataRoot, StorageGenerationLayout.GenerationsDirectoryName),
            StorageGenerationLayout.DatabaseFileName,
            SearchOption.AllDirectories).Single(path => !string.Equals(path, fixture.DatabasePath, StringComparison.Ordinal));
        using var connection = new SqliteConnection(new SqliteConnectionStringBuilder
        {
            DataSource = candidateDatabase,
            Mode = SqliteOpenMode.ReadOnly,
            Pooling = false,
        }.ToString());
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "PRAGMA user_version;";
        Assert.Equal(2L, command.ExecuteScalar());
    }

    [Fact]
    public async Task Migration_runs_even_when_policy_already_records_current_version()
    {
        using var fixture = MigrationFixture.Create(schemaVersion: 1);
        await using var lease = DataRootLease.Acquire(fixture.DataRoot);
        var fake = new PolicyBackupService();
        var policy = new StorageBackupPolicy(
            fake,
            new StorageBackupPolicyOptions(Path.Combine(fixture.Root, "policy-backups")),
            Path.Combine(fixture.Root, "policy", "state.json"));
        await policy.CommitSuccessfulStartupAsync(
            "0.1.0-m1.12", null, TestContext.Current.CancellationToken);

        var result = await new SqliteStorageMigrationService(lease).MigrateIfRequiredAsync(
            fixture.Request(), TestContext.Current.CancellationToken);

        Assert.True(result.Migrated);
        Assert.NotNull(result.PreUpdateBackup);
        Assert.Equal(StorageBackupKind.PreUpdate, result.PreUpdateBackup.Kind);
    }

    [Fact]
    public async Task Known_policy_version_is_recorded_in_migration_backup_without_committing_startup()
    {
        using var fixture = MigrationFixture.Create(schemaVersion: 1);
        var policy = new StorageBackupPolicy(
            new PolicyBackupService(),
            new StorageBackupPolicyOptions(Path.Combine(fixture.Root, "policy-backups")),
            fixture.PolicyStatePath);
        await policy.CommitSuccessfulStartupAsync(
            "0.1.0-m1.11", null, TestContext.Current.CancellationToken);
        var stateBeforeStartup = StorageBackupPolicy.ReadStateFile(fixture.PolicyStatePath);
        await using var lease = DataRootLease.Acquire(fixture.DataRoot);

        var result = await new SqliteStorageMigrationService(lease).MigrateIfRequiredAsync(
            fixture.Request() with { PreviousAppVersion = stateBeforeStartup.LastRunAppVersion },
            TestContext.Current.CancellationToken);

        Assert.NotNull(result.PreUpdateBackup);
        using var manifest = JsonDocument.Parse(File.ReadAllText(Path.Combine(
            result.PreUpdateBackup.BackupPath,
            SqliteStorageBackupService.ManifestFileName)));
        Assert.Equal(
            "0.1.0-m1.11",
            manifest.RootElement.GetProperty("previousAppVersion").GetString());
        Assert.Equal("0.1.0-m1.11", StorageBackupPolicy.ReadStateFile(
            fixture.PolicyStatePath).LastRunAppVersion);
    }

    [Fact]
    public async Task Corrupt_journal_fails_closed_without_deleting_data()
    {
        using var fixture = MigrationFixture.Create(schemaVersion: 1);
        var before = HashFile(fixture.DatabasePath);
        File.WriteAllText(fixture.JournalPath, "{broken");
        await using var lease = DataRootLease.Acquire(fixture.DataRoot);

        var error = await Assert.ThrowsAsync<StorageMigrationException>(() =>
            new SqliteStorageMigrationService(lease).MigrateIfRequiredAsync(
                fixture.Request(), TestContext.Current.CancellationToken));

        Assert.Equal("migration_journal_invalid", error.Code);
        Assert.Equal(before, HashFile(fixture.DatabasePath));
        Assert.True(File.Exists(fixture.JournalPath));
        Assert.Single(fixture.GenerationNames());
    }

    [Fact]
    public async Task Package_schema_mismatch_is_rejected_before_any_write()
    {
        using var fixture = MigrationFixture.Create(schemaVersion: 1);
        await using var lease = DataRootLease.Acquire(fixture.DataRoot);

        var error = await Assert.ThrowsAsync<StorageMigrationException>(() =>
            new SqliteStorageMigrationService(lease).MigrateIfRequiredAsync(
                fixture.Request() with { PackageSchemaVersion = 3 },
                TestContext.Current.CancellationToken));

        Assert.Equal("package_schema_mismatch", error.Code);
        Assert.False(Directory.Exists(fixture.BackupRoot));
        Assert.False(File.Exists(fixture.JournalPath));
        Assert.Single(fixture.GenerationNames());
    }

    [Fact]
    public async Task Newer_database_is_rejected_as_downgrade_before_backup()
    {
        using var fixture = MigrationFixture.Create(schemaVersion: 1);
        using (var connection = OpenReadWrite(fixture.DatabasePath))
        using (var command = connection.CreateCommand())
        {
            command.CommandText = "PRAGMA user_version = 99;";
            command.ExecuteNonQuery();
        }
        await using var lease = DataRootLease.Acquire(fixture.DataRoot);

        var error = await Assert.ThrowsAsync<StorageMigrationException>(() =>
            new SqliteStorageMigrationService(lease).MigrateIfRequiredAsync(
                fixture.Request(), TestContext.Current.CancellationToken));

        Assert.Equal("downgrade_not_supported", error.Code);
        Assert.False(Directory.Exists(fixture.BackupRoot));
        Assert.False(File.Exists(fixture.JournalPath));
    }

    private static SqliteConnection OpenReadWrite(string path)
    {
        var connection = new SqliteConnection(new SqliteConnectionStringBuilder
        {
            DataSource = path,
            Mode = SqliteOpenMode.ReadWrite,
            Pooling = false,
        }.ToString());
        connection.Open();
        return connection;
    }

    private static string HashFile(string path)
    {
        using var stream = File.OpenRead(path);
        return Convert.ToHexStringLower(SHA256.HashData(stream));
    }

    private static bool TryCreateJunction(string junction, string target)
    {
        if (!OperatingSystem.IsWindows())
        {
            return false;
        }

        using var process = Process.Start(new ProcessStartInfo
        {
            FileName = "cmd.exe",
            UseShellExecute = false,
            CreateNoWindow = true,
            ArgumentList = { "/d", "/c", "mklink", "/J", junction, target },
        });
        process?.WaitForExit();
        return process?.ExitCode == 0 && Directory.Exists(junction);
    }

    private sealed class SimulatedCrashException : Exception;

    private sealed class PolicyBackupService : IStorageBackupService
    {
        public Task<StorageBackupResult> CreateAsync(
            StorageBackupRequest request,
            CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task<StorageBackupResult?> CreateIfChangedAsync(
            StorageBackupRequest request,
            string? previousDatabaseSha256,
            CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public IReadOnlyList<StorageBackupResult> ApplyRetention(string backupRoot, int maximumBackups) => [];
    }

    private sealed class MigrationFixture : IDisposable
    {
        private MigrationFixture(string root, string dataRoot, string databasePath)
        {
            Root = root;
            DataRoot = dataRoot;
            DatabasePath = databasePath;
        }

        public string Root { get; }
        public string DataRoot { get; }
        public string DatabasePath { get; }
        public string BackupRoot => Path.Combine(Root, "backups");
        public string JournalPath => Path.Combine(DataRoot, SqliteStorageMigrationService.JournalFileName);
        public string CurrentPath => Path.Combine(DataRoot, StorageGenerationLayout.CurrentPointerFileName);
        public string PolicyStatePath => Path.Combine(DataRoot, "bootstrap", "backup-policy.json");

        public static MigrationFixture Create(int schemaVersion)
        {
            var root = Path.Combine(Path.GetTempPath(), "techmap-migration-tests", Guid.NewGuid().ToString("N"));
            var dataRoot = Path.Combine(root, "data");
            var generation = Path.Combine(
                dataRoot,
                StorageGenerationLayout.GenerationsDirectoryName,
                StorageGenerationLayout.InitialGenerationName);
            Directory.CreateDirectory(generation);
            var database = Path.Combine(generation, StorageGenerationLayout.DatabaseFileName);
            using (var connection = OpenReadWriteCreate(database))
            {
                SqliteStorage.InitializeSchemaAtVersion(connection, schemaVersion);
            }

            File.WriteAllText(Path.Combine(generation, StorageGenerationLayout.ReadyMarkerFileName), "ready\n");
            File.WriteAllText(
                Path.Combine(dataRoot, StorageGenerationLayout.CurrentPointerFileName),
                $"{StorageGenerationLayout.InitialGenerationName}\n");
            return new MigrationFixture(root, dataRoot, database);
        }

        public StorageMigrationRequest Request() =>
            new(BackupRoot, "0.1.0-m1.12", SqliteStorage.CurrentSchemaVersion, "0.1.0-m1.11");

        public string CurrentGeneration() => StorageGenerationLayout.ReadCurrentGeneration(
            Path.Combine(DataRoot, StorageGenerationLayout.CurrentPointerFileName));

        public string[] GenerationNames() => Directory.GetDirectories(
                Path.Combine(DataRoot, StorageGenerationLayout.GenerationsDirectoryName))
            .Select(Path.GetFileName)
            .OfType<string>()
            .Order(StringComparer.Ordinal)
            .ToArray();

        public string GenerationPath(string generationName) => Path.Combine(
            DataRoot,
            StorageGenerationLayout.GenerationsDirectoryName,
            generationName);

        public void Dispose()
        {
            if (Directory.Exists(Root))
            {
                Directory.Delete(Root, recursive: true);
            }
        }

        private static SqliteConnection OpenReadWriteCreate(string path)
        {
            var connection = new SqliteConnection(new SqliteConnectionStringBuilder
            {
                DataSource = path,
                Mode = SqliteOpenMode.ReadWriteCreate,
                Pooling = false,
            }.ToString());
            connection.Open();
            return connection;
        }
    }
}
