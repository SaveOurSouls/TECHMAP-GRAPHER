using System.Security.Cryptography;
using System.Diagnostics;
using System.Text;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using Techmap.Application;
using Techmap.Domain;
using Techmap.Infrastructure.Sqlite;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class StorageBackupIntegrationTests
{
    [Fact]
    public async Task Backup_contains_consistent_database_exact_referenced_blobs_and_manifest()
    {
        using var fixture = BackupFixture.Create();
        using var storage = SqliteStorage.Open(fixture.DataRoot);
        var projects = new SqliteProjectCatalog(storage);
        var project = projects.CreateProject(new CreateProjectCommand(
            "БЭК-01", "Резервная копия", 2, ProjectStatus.Active));
        var bytes = Encoding.UTF8.GetBytes("referenced attachment");
        var attachments = new SqliteProjectAttachmentCatalog(
            storage, new ContentAddressedAttachmentStore(fixture.DataRoot), TimeProvider.System);
        var attachment = await attachments.AddAsync(
            project.ProjectId,
            new MemoryStream(bytes),
            "drawing.txt",
            "text/plain",
            "drawing",
            TestContext.Current.CancellationToken);
        await File.WriteAllTextAsync(
            fixture.UnreferencedBlobPath,
            "unreferenced",
            TestContext.Current.CancellationToken);

        using var service = fixture.Service(storage.Layout.DatabasePath);
        var result = await service.CreateAsync(
            new StorageBackupRequest(fixture.BackupRoot, "0.1.0-m1.10"),
            TestContext.Current.CancellationToken);

        Assert.True(Directory.Exists(result.BackupPath));
        Assert.Equal(1, result.ReferencedBlobCount);
        Assert.Equal(project.ProjectId.Value, Assert.Single(result.ProjectRevisions).ProjectId);
        Assert.Equal(1, result.ProjectRevisions[0].Revision);
        Assert.Equal(
            bytes,
            await File.ReadAllBytesAsync(
                Path.Combine(
                    result.BackupPath,
                    "attachments",
                    "blobs",
                    attachment.Content.Sha256[..2],
                    attachment.Content.Sha256),
                TestContext.Current.CancellationToken));
        Assert.False(File.Exists(Path.Combine(
            result.BackupPath, "attachments", "blobs", "aa", new string('a', 64))));
        Assert.Equal(
            result.ManifestSha256,
            (await File.ReadAllTextAsync(
                Path.Combine(result.BackupPath, SqliteStorageBackupService.ManifestChecksumFileName),
                TestContext.Current.CancellationToken)).Trim());
        Assert.Equal(
            result.ManifestSha256,
            Convert.ToHexStringLower(SHA256.HashData(await File.ReadAllBytesAsync(
                Path.Combine(result.BackupPath, SqliteStorageBackupService.ManifestFileName),
                TestContext.Current.CancellationToken))));
        Assert.Equal("ok", Scalar(
            Path.Combine(result.BackupPath, "app.db"),
            "PRAGMA integrity_check;"));
        Assert.Empty(Directory.EnumerateDirectories(
            Path.Combine(fixture.BackupRoot, ".staging")));
    }

    [Fact]
    public async Task Snapshot_reference_set_is_not_changed_by_a_later_attachment_command()
    {
        using var fixture = BackupFixture.Create();
        using var storage = SqliteStorage.Open(fixture.DataRoot);
        var project = new SqliteProjectCatalog(storage).CreateProject(new CreateProjectCommand(
            "БЭК-02", "Гонка", 1, ProjectStatus.Draft));
        var contentStore = new ContentAddressedAttachmentStore(fixture.DataRoot);
        var catalog = new SqliteProjectAttachmentCatalog(storage, contentStore, TimeProvider.System);
        var first = await catalog.AddAsync(
            project.ProjectId,
            new MemoryStream([1]),
            "one.bin",
            "application/octet-stream",
            "source",
            TestContext.Current.CancellationToken);
        var snapshotTaken = new ManualResetEventSlim();
        var continueBackup = new ManualResetEventSlim();
        using var service = fixture.Service(
            storage.Layout.DatabasePath,
            progress =>
            {
                if (progress == "after_database_snapshot")
                {
                    snapshotTaken.Set();
                    Assert.True(continueBackup.Wait(TimeSpan.FromSeconds(10)));
                }
            });

        var backupTask = Task.Run(() => service.CreateAsync(
            new StorageBackupRequest(fixture.BackupRoot, "0.1.0-m1.10"),
            TestContext.Current.CancellationToken),
            TestContext.Current.CancellationToken);
        Assert.True(snapshotTaken.Wait(TimeSpan.FromSeconds(10), TestContext.Current.CancellationToken));
        var second = await catalog.AddAsync(
            project.ProjectId,
            new MemoryStream([2]),
            "two.bin",
            "application/octet-stream",
            "source",
            TestContext.Current.CancellationToken);
        continueBackup.Set();
        var backup = await backupTask;

        Assert.True(File.Exists(BackupBlobPath(backup.BackupPath, first.Content.Sha256)));
        Assert.False(File.Exists(BackupBlobPath(backup.BackupPath, second.Content.Sha256)));
        Assert.Equal(1, backup.ReferencedBlobCount);
        Assert.Equal(1, Assert.Single(backup.ProjectRevisions).Revision);
        Assert.Equal(2, new SqliteProjectCatalog(storage).GetProject(project.ProjectId).Revision);
    }

    [Fact]
    public async Task Failure_never_publishes_partial_backup_or_changes_source()
    {
        using var fixture = BackupFixture.Create();
        using var storage = SqliteStorage.Open(fixture.DataRoot);
        new SqliteProjectCatalog(storage).CreateProject(new CreateProjectCommand(
            "БЭК-03", "Отказ", 1, ProjectStatus.Draft));
        var sourceHash = HashFile(storage.Layout.DatabasePath);
        using var service = fixture.Service(
            storage.Layout.DatabasePath,
            progress =>
            {
                if (progress == "before_publish")
                {
                    throw new IOException("simulated full disk");
                }
            });

        var error = await Assert.ThrowsAsync<StorageBackupException>(() => service.CreateAsync(
            new StorageBackupRequest(fixture.BackupRoot, "0.1.0-m1.10"),
            TestContext.Current.CancellationToken));

        Assert.Equal("backup_failed", error.Code);
        Assert.Empty(Directory.EnumerateDirectories(fixture.BackupRoot, "backup-*"));
        Assert.Empty(Directory.EnumerateDirectories(Path.Combine(fixture.BackupRoot, ".staging")));
        Assert.Equal(sourceHash, HashFile(storage.Layout.DatabasePath));
    }

    [Fact]
    public async Task Mutation_after_manifest_write_is_rejected_before_atomic_publish()
    {
        using var fixture = BackupFixture.Create();
        using var storage = SqliteStorage.Open(fixture.DataRoot);
        new SqliteProjectCatalog(storage).CreateProject(new CreateProjectCommand(
            "БЭК-04", "Подмена", 1, ProjectStatus.Draft));
        using var service = fixture.Service(
            storage.Layout.DatabasePath,
            progress =>
            {
                if (progress != "before_publish")
                {
                    return;
                }

                var staging = Assert.Single(Directory.EnumerateDirectories(
                    Path.Combine(fixture.BackupRoot, ".staging")));
                File.AppendAllText(Path.Combine(staging, "app.db"), "tampered");
            });

        var error = await Assert.ThrowsAsync<StorageBackupException>(() => service.CreateAsync(
            new StorageBackupRequest(fixture.BackupRoot, "0.1.0-m1.10"),
            TestContext.Current.CancellationToken));

        Assert.Equal("backup_failed", error.Code);
        Assert.Empty(Directory.EnumerateDirectories(fixture.BackupRoot, "backup-*"));
        Assert.Empty(Directory.EnumerateDirectories(Path.Combine(fixture.BackupRoot, ".staging")));
    }

    [Fact]
    public async Task Cancellation_after_manifest_write_is_observed_before_verification_and_publish()
    {
        using var fixture = BackupFixture.Create();
        using var storage = SqliteStorage.Open(fixture.DataRoot);
        using var cancellation = new CancellationTokenSource();
        using var service = fixture.Service(
            storage.Layout.DatabasePath,
            progress =>
            {
                if (progress == "before_publish")
                {
                    cancellation.Cancel();
                }
            });

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => service.CreateAsync(
            new StorageBackupRequest(fixture.BackupRoot, "0.1.0-m1.10"),
            cancellation.Token));

        Assert.Empty(Directory.EnumerateDirectories(fixture.BackupRoot, "backup-*"));
        Assert.Empty(Directory.EnumerateDirectories(Path.Combine(fixture.BackupRoot, ".staging")));
    }

    [Fact]
    public async Task Cancellation_is_preserved_and_cleans_staging()
    {
        using var fixture = BackupFixture.Create();
        using var storage = SqliteStorage.Open(fixture.DataRoot);
        using var service = fixture.Service(storage.Layout.DatabasePath);
        using var cancelled = new CancellationTokenSource();
        cancelled.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => service.CreateAsync(
            new StorageBackupRequest(fixture.BackupRoot, "0.1.0-m1.10"), cancelled.Token));

        Assert.Empty(Directory.EnumerateDirectories(fixture.BackupRoot, "backup-*"));
    }

    [Fact]
    public async Task Regular_backup_can_skip_an_unchanged_database_but_preupdate_never_deduplicates()
    {
        using var fixture = BackupFixture.Create();
        using var storage = SqliteStorage.Open(fixture.DataRoot);
        using var service = fixture.Service(storage.Layout.DatabasePath);
        var first = await service.CreateAsync(
            new StorageBackupRequest(fixture.BackupRoot, "A"),
            TestContext.Current.CancellationToken);

        var unchanged = await service.CreateIfChangedAsync(
            new StorageBackupRequest(fixture.BackupRoot, "A"),
            first.DatabaseSha256,
            TestContext.Current.CancellationToken);
        var preUpdate = await service.CreateIfChangedAsync(
            new StorageBackupRequest(fixture.BackupRoot, "B", StorageBackupKind.PreUpdate, "A"),
            first.DatabaseSha256,
            TestContext.Current.CancellationToken);

        Assert.Null(unchanged);
        Assert.NotNull(preUpdate);
        Assert.Equal(2, Directory.EnumerateDirectories(fixture.BackupRoot, "backup-*").Count());
        using var manifest = JsonDocument.Parse(File.ReadAllText(Path.Combine(
            preUpdate.BackupPath, SqliteStorageBackupService.ManifestFileName)));
        Assert.Equal("TECHMAP-GRAPHER", manifest.RootElement.GetProperty("productId").GetString());
        Assert.Equal("A", manifest.RootElement.GetProperty("previousAppVersion").GetString());
    }

    [Fact]
    public async Task Unchanged_regular_check_still_rejects_a_corrupt_referenced_blob()
    {
        using var fixture = BackupFixture.Create();
        using var storage = SqliteStorage.Open(fixture.DataRoot);
        var project = new SqliteProjectCatalog(storage).CreateProject(new CreateProjectCommand(
            "БЭК-05", "Проверка файла", 1, ProjectStatus.Draft));
        var attachment = await new SqliteProjectAttachmentCatalog(
                storage,
                new ContentAddressedAttachmentStore(fixture.DataRoot),
                TimeProvider.System)
            .AddAsync(
                project.ProjectId,
                new MemoryStream([1, 2, 3]),
                "source.bin",
                "application/octet-stream",
                "source",
                TestContext.Current.CancellationToken);
        using var service = fixture.Service(storage.Layout.DatabasePath);
        var first = await service.CreateAsync(
            new StorageBackupRequest(fixture.BackupRoot, "A"),
            TestContext.Current.CancellationToken);
        File.WriteAllText(
            Path.Combine(
                fixture.DataRoot,
                "attachments",
                "blobs",
                attachment.Content.Sha256[..2],
                attachment.Content.Sha256),
            "corrupt");

        var error = await Assert.ThrowsAsync<StorageBackupException>(() => service.CreateIfChangedAsync(
            new StorageBackupRequest(fixture.BackupRoot, "A"),
            first.DatabaseSha256,
            TestContext.Current.CancellationToken));

        Assert.Equal("backup_failed", error.Code);
        Assert.Single(Directory.EnumerateDirectories(fixture.BackupRoot, "backup-*"));
    }

    [Theory]
    [InlineData(1)]
    [InlineData(2)]
    [InlineData(3)]
    public async Task Online_backup_accepts_each_readable_preupdate_schema(int schemaVersion)
    {
        using var fixture = BackupFixture.CreateEmpty();
        var databasePath = fixture.CreateLegacyDatabase(schemaVersion);
        using var service = fixture.Service(databasePath);

        var result = await service.CreateAsync(new StorageBackupRequest(
            fixture.BackupRoot,
            "0.1.0-m1.10",
            StorageBackupKind.PreUpdate,
            "0.1.0-old"),
            TestContext.Current.CancellationToken);

        Assert.Equal(schemaVersion, result.SchemaVersion);
        Assert.Equal(schemaVersion == 1 ? 0 : 1, result.ProjectRevisions.Count);
        if (schemaVersion >= 2)
        {
            Assert.Equal(0, Assert.Single(result.ProjectRevisions).Revision);
        }
    }

    [Fact]
    public async Task Backup_rejects_schema_with_intact_history_but_missing_required_object()
    {
        using var fixture = BackupFixture.Create();
        string databasePath;
        using (var storage = SqliteStorage.Open(fixture.DataRoot))
        {
            databasePath = storage.Layout.DatabasePath;
        }

        using (var connection = new SqliteConnection($"Data Source={databasePath};Pooling=False"))
        {
            connection.Open();
            using var command = connection.CreateCommand();
            command.CommandText = "DROP TRIGGER enforce_project_harness_limit;";
            command.ExecuteNonQuery();
        }

        using var service = fixture.Service(databasePath);
        var error = await Assert.ThrowsAsync<StorageBackupException>(() => service.CreateAsync(
            new StorageBackupRequest(fixture.BackupRoot, "0.1.0-m1.10"),
            TestContext.Current.CancellationToken));

        Assert.Equal("backup_failed", error.Code);
        Assert.Empty(Directory.EnumerateDirectories(fixture.BackupRoot, "backup-*"));
    }

    [Fact]
    public async Task Retention_keeps_newest_success_and_newest_preupdate_and_ignores_invalid_directory()
    {
        using var fixture = BackupFixture.Create();
        using var storage = SqliteStorage.Open(fixture.DataRoot);
        var clock = new MutableTimeProvider(new DateTimeOffset(2026, 9, 12, 1, 0, 0, TimeSpan.Zero));
        using var service = fixture.Service(storage.Layout.DatabasePath, timeProvider: clock);
        var oldPre = await service.CreateAsync(new StorageBackupRequest(
            fixture.BackupRoot, "B", StorageBackupKind.PreUpdate, "A"),
            TestContext.Current.CancellationToken);
        clock.Advance(TimeSpan.FromHours(1));
        var oldRegular = await service.CreateAsync(
            new StorageBackupRequest(fixture.BackupRoot, "B"),
            TestContext.Current.CancellationToken);
        clock.Advance(TimeSpan.FromHours(1));
        var newestPre = await service.CreateAsync(new StorageBackupRequest(
            fixture.BackupRoot, "C", StorageBackupKind.PreUpdate, "B"),
            TestContext.Current.CancellationToken);
        clock.Advance(TimeSpan.FromHours(1));
        var newestPreRestore = await service.CreateAsync(new StorageBackupRequest(
            fixture.BackupRoot, "C", StorageBackupKind.PreRestore),
            TestContext.Current.CancellationToken);
        clock.Advance(TimeSpan.FromHours(1));
        var newest = await service.CreateAsync(
            new StorageBackupRequest(fixture.BackupRoot, "C"),
            TestContext.Current.CancellationToken);
        var invalid = Path.Combine(fixture.BackupRoot, "backup-invalid");
        Directory.CreateDirectory(invalid);
        File.WriteAllText(Path.Combine(invalid, "unknown.txt"), "do not delete");
        var malformed = Path.Combine(fixture.BackupRoot, "backup-malformed");
        Directory.CreateDirectory(malformed);
        var malformedManifest = Encoding.UTF8.GetBytes("{broken");
        File.WriteAllBytes(
            Path.Combine(malformed, SqliteStorageBackupService.ManifestFileName),
            malformedManifest);
        File.WriteAllText(
            Path.Combine(malformed, SqliteStorageBackupService.ManifestChecksumFileName),
            Convert.ToHexStringLower(SHA256.HashData(malformedManifest)));
        var malformedField = Path.Combine(fixture.BackupRoot, "backup-malformed-field");
        Directory.CreateDirectory(malformedField);
        var malformedFieldManifest = Encoding.UTF8.GetBytes(
            """
            {"manifestFormat":1,"productId":"TECHMAP-GRAPHER","backupId":"11111111-1111-1111-1111-111111111111","kind":"regular","appVersion":"A","schemaVersion":4,"createdUtc":"2026-09-12T00:00:00Z","projectRevisions":[],"files":[null]}
            """);
        File.WriteAllBytes(
            Path.Combine(malformedField, SqliteStorageBackupService.ManifestFileName),
            malformedFieldManifest);
        File.WriteAllText(
            Path.Combine(malformedField, SqliteStorageBackupService.ManifestChecksumFileName),
            Convert.ToHexStringLower(SHA256.HashData(malformedFieldManifest)));

        var kept = service.ApplyRetention(fixture.BackupRoot, 3);

        Assert.Equal(
            new[] { newest.BackupId, newestPre.BackupId, newestPreRestore.BackupId }.Order(),
            kept.Select(item => item.BackupId).Order());
        Assert.False(Directory.Exists(oldPre.BackupPath));
        Assert.False(Directory.Exists(oldRegular.BackupPath));
        Assert.True(Directory.Exists(newestPre.BackupPath));
        Assert.True(Directory.Exists(newestPreRestore.BackupPath));
        Assert.True(Directory.Exists(newest.BackupPath));
        Assert.True(Directory.Exists(invalid));
        Assert.True(Directory.Exists(malformed));
        Assert.True(Directory.Exists(malformedField));
    }

    [Fact]
    public async Task Nested_backup_roots_are_rejected_without_publishing()
    {
        using var fixture = BackupFixture.Create();
        using var storage = SqliteStorage.Open(fixture.DataRoot);
        using var service = fixture.Service(storage.Layout.DatabasePath);

        await Assert.ThrowsAsync<StorageBackupException>(() => service.CreateAsync(
            new StorageBackupRequest(Path.Combine(fixture.DataRoot, "backups"), "A"),
            TestContext.Current.CancellationToken));
        await Assert.ThrowsAsync<StorageBackupException>(() => service.CreateAsync(
            new StorageBackupRequest(fixture.Root, "A"),
            TestContext.Current.CancellationToken));
    }

    [Fact]
    public async Task Reparse_aliases_cannot_hide_data_and_backup_root_overlap()
    {
        using var fixture = BackupFixture.Create();
        using var storage = SqliteStorage.Open(fixture.DataRoot);
        var alias = Path.Combine(fixture.Root, "data-alias");
        if (!TryCreateJunction(alias, fixture.DataRoot))
        {
            Assert.Skip("This Windows environment does not allow creation of a test junction.");
        }

        try
        {
            Assert.Throws<InvalidDataException>(() => new SqliteStorageBackupService(
                alias,
                storage.Layout.DatabasePath));
            using var service = fixture.Service(storage.Layout.DatabasePath);
            await Assert.ThrowsAsync<StorageBackupException>(() => service.CreateAsync(
                new StorageBackupRequest(alias, "A"),
                TestContext.Current.CancellationToken));
        }
        finally
        {
            Directory.Delete(alias);
        }
    }

    private static string BackupBlobPath(string root, string hash) =>
        Path.Combine(root, "attachments", "blobs", hash[..2], hash);

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

    private sealed class BackupFixture : IDisposable
    {
        private BackupFixture(string root)
        {
            Root = root;
            DataRoot = Path.Combine(root, "data");
            BackupRoot = Path.Combine(root, "external-backups");
            Directory.CreateDirectory(BackupRoot);
        }

        public string Root { get; }
        public string DataRoot { get; }
        public string BackupRoot { get; }
        public string UnreferencedBlobPath
        {
            get
            {
                var path = Path.Combine(DataRoot, "attachments", "blobs", "aa", new string('a', 64));
                Directory.CreateDirectory(Path.GetDirectoryName(path)!);
                return path;
            }
        }

        public static BackupFixture Create()
        {
            var fixture = CreateEmpty();
            Directory.CreateDirectory(fixture.DataRoot);
            return fixture;
        }

        public static BackupFixture CreateEmpty()
        {
            var root = Path.Combine(Path.GetTempPath(), "techmap-storage-backup", Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(root);
            return new BackupFixture(root);
        }

        public SqliteStorageBackupService Service(
            string databasePath,
            Action<string>? progress = null,
            TimeProvider? timeProvider = null) =>
            new(DataRoot, databasePath, timeProvider, progress);

        public string CreateLegacyDatabase(int schemaVersion)
        {
            Directory.CreateDirectory(DataRoot);
            var path = Path.Combine(DataRoot, "legacy.db");
            using var connection = new SqliteConnection($"Data Source={path};Pooling=False");
            connection.Open();
            SqliteStorage.InitializeSchemaAtVersion(connection, schemaVersion);
            if (schemaVersion >= 2)
            {
                using var project = connection.CreateCommand();
                project.CommandText =
                    """
                    INSERT INTO projects
                        (project_id, designation, project_increment, name, batch_quantity, status, created_utc, updated_utc)
                    VALUES
                        ('11111111-1111-1111-1111-111111111111', 'LEGACY-01', 1, 'Legacy project', 1, 'draft',
                         '2026-09-12T00:00:00.0000000+00:00', '2026-09-12T00:00:00.0000000+00:00');
                    """;
                project.ExecuteNonQuery();
            }

            return path;
        }

        public void Dispose()
        {
            if (Directory.Exists(Root))
            {
                Directory.Delete(Root, recursive: true);
            }
        }
    }

    private sealed class MutableTimeProvider(DateTimeOffset value) : TimeProvider
    {
        public DateTimeOffset Value { get; private set; } = value;
        public override DateTimeOffset GetUtcNow() => Value;
        public void Advance(TimeSpan value) => Value += value;
    }
}
