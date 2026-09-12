using System.IO.Compression;
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

public sealed class ProjectExportIntegrationTests
{
    [Fact]
    public async Task Exports_two_harnesses_pinned_data_and_only_referenced_blobs()
    {
        using var fixture = ExportFixture.Create();
        await using var lease = DataRootLease.Acquire(fixture.DataRoot);
        using var storage = SqliteStorage.Open(lease.CanonicalPath);
        var projects = new SqliteProjectCatalog(storage);
        var project = projects.CreateProject(new CreateProjectCommand(
            "ПР-ЭКСП-01", "Экспорт без локальных данных", 12, ProjectStatus.Active));
        project = projects.AddHarness(project.ProjectId, "ЖГ-01", 3);
        project = projects.AddHarness(project.ProjectId, "ЖГ-02", 17);
        var attachments = new SqliteProjectAttachmentCatalog(
            storage,
            new ContentAddressedAttachmentStore(fixture.DataRoot),
            new FrozenTimeProvider(ExportFixture.Utc));
        var sharedContent = Encoding.UTF8.GetBytes("referenced export attachment");
        var first = await attachments.AddAsync(
            project.ProjectId,
            new MemoryStream(sharedContent),
            "рисунок.png",
            "image/png",
            "drawing",
            TestContext.Current.CancellationToken);
        var second = await attachments.AddAsync(
            project.ProjectId,
            new MemoryStream(sharedContent),
            "тот же рисунок.png",
            "image/png",
            "photo",
            TestContext.Current.CancellationToken);
        var pinned = ExternalCharacteristicSnapshot.Capture(
            CharacteristicSnapshotIdentity.New(),
            "synthetic",
            "terminal:T-01",
            "rev-1",
            "Длина зачистки",
            "4.0",
            "мм",
            ExportFixture.Utc);
        _ = new SqlitePinnedCharacteristicStore(storage).AddOrGet(project.ProjectId, pinned);
        var unusedBytes = Encoding.UTF8.GetBytes("unreferenced local attachment");
        var unusedHash = Convert.ToHexStringLower(SHA256.HashData(unusedBytes));
        var unusedPath = fixture.BlobPath(unusedHash);
        Directory.CreateDirectory(Path.GetDirectoryName(unusedPath)!);
        File.WriteAllBytes(unusedPath, unusedBytes);
        var destination = fixture.Destination("complete.techmap-project.zip");

        var result = await new SqliteProjectExportService(lease, storage).ExportAsync(
            new ProjectExportRequest(project.ProjectId, destination, "0.1.0-m1.13"),
            TestContext.Current.CancellationToken);

        Assert.Equal(project.ProjectId, result.ProjectId);
        Assert.Equal(1, result.AttachmentBlobCount);
        Assert.Equal(2, result.PayloadCount);
        using var archive = ZipFile.OpenRead(destination);
        Assert.Equal(
            [
                $"attachments/blobs/{first.Content.Sha256[..2]}/{first.Content.Sha256}",
                SqliteProjectExportService.ManifestPath,
                SqliteProjectExportService.ManifestChecksumPath,
                SqliteProjectExportService.SnapshotPath,
            ],
            archive.Entries.Select(entry => entry.FullName).ToArray());
        Assert.DoesNotContain(archive.Entries, entry => entry.FullName.Contains(unusedHash, StringComparison.Ordinal));
        using var snapshot = await ReadJsonAsync(archive, SqliteProjectExportService.SnapshotPath);
        Assert.Equal(2, snapshot.RootElement.GetProperty("harnesses").GetArrayLength());
        var exportedHarnesses = snapshot.RootElement.GetProperty("harnesses").EnumerateArray().ToArray();
        Assert.Equal([3L, 17L], exportedHarnesses.Select(item => item.GetProperty("quantity").GetInt64()));
        Assert.All(exportedHarnesses, item =>
        {
            Assert.Equal(3, item.GetProperty("documents").GetArrayLength());
            Assert.All(item.GetProperty("documents").EnumerateArray(), document =>
                Assert.Equal("empty", document.GetProperty("status").GetString()));
        });
        Assert.Equal(6, exportedHarnesses.SelectMany(item => item.GetProperty("documents").EnumerateArray())
            .Select(document => document.GetProperty("documentId").GetString()).Distinct().Count());
        Assert.Equal(2, snapshot.RootElement.GetProperty("attachments").GetArrayLength());
        Assert.Equal(1, snapshot.RootElement.GetProperty("pinnedCharacteristics").GetArrayLength());
        var exportedAttachments = snapshot.RootElement.GetProperty("attachments").EnumerateArray().ToArray();
        Assert.Contains(exportedAttachments, item => item.GetProperty("attachmentId").GetString() ==
            first.AttachmentId.Value.ToString("D"));
        Assert.Contains(exportedAttachments, item => item.GetProperty("attachmentId").GetString() ==
            second.AttachmentId.Value.ToString("D"));
    }

    [Fact]
    public async Task Archive_is_canonical_deterministic_and_contains_no_local_storage_state()
    {
        using var fixture = ExportFixture.Create();
        await using var lease = DataRootLease.Acquire(fixture.DataRoot);
        using var storage = SqliteStorage.Open(lease.CanonicalPath);
        var project = new SqliteProjectCatalog(storage).CreateProject(new CreateProjectCommand(
            "ПР-ЭКСП-02", "Детерминированный экспорт", 1, ProjectStatus.Draft));
        var firstPath = fixture.Destination("first.techmap-project.zip");
        var secondPath = fixture.Destination("second.techmap-project.zip");
        var exporter = new SqliteProjectExportService(lease, storage);

        await exporter.ExportAsync(
            new ProjectExportRequest(project.ProjectId, firstPath, "0.1.0-m1.13"),
            TestContext.Current.CancellationToken);
        await exporter.ExportAsync(
            new ProjectExportRequest(project.ProjectId, secondPath, "0.1.0-m1.13"),
            TestContext.Current.CancellationToken);

        Assert.Equal(HashFile(firstPath), HashFile(secondPath));
        var raw = File.ReadAllBytes(firstPath);
        Assert.False(Contains(raw, Encoding.UTF8.GetBytes(fixture.Root)));
        Assert.False(Contains(raw, Encoding.UTF8.GetBytes("CURRENT")));
        Assert.False(Contains(raw, Encoding.UTF8.GetBytes("project_commands")));
        Assert.False(Contains(raw, Encoding.UTF8.GetBytes("csrf")));
        Assert.False(Contains(raw, Encoding.UTF8.GetBytes("Data Source=")));
        using var archive = ZipFile.OpenRead(firstPath);
        using var manifest = await ReadJsonAsync(archive, SqliteProjectExportService.ManifestPath);
        Assert.False(manifest.RootElement.TryGetProperty("exportedUtc", out _));
        var manifestBytes = await ReadBytesAsync(archive, SqliteProjectExportService.ManifestPath);
        var checksum = Encoding.ASCII.GetString(
            await ReadBytesAsync(archive, SqliteProjectExportService.ManifestChecksumPath));
        Assert.Equal($"{Convert.ToHexStringLower(SHA256.HashData(manifestBytes))}\n", checksum);
        Assert.All(archive.Entries, entry => Assert.Equal(
            new DateTime(1980, 1, 1),
            entry.LastWriteTime.DateTime));
    }

    [Fact]
    public async Task Corrupt_referenced_blob_leaves_no_final_or_staging_archive()
    {
        using var fixture = ExportFixture.Create();
        await using var lease = DataRootLease.Acquire(fixture.DataRoot);
        using var storage = SqliteStorage.Open(lease.CanonicalPath);
        var project = new SqliteProjectCatalog(storage).CreateProject(new CreateProjectCommand(
            "ПР-ЭКСП-03", "Ошибка экспорта", 1, ProjectStatus.Active));
        var attachments = new SqliteProjectAttachmentCatalog(
            storage,
            new ContentAddressedAttachmentStore(fixture.DataRoot),
            new FrozenTimeProvider(ExportFixture.Utc));
        var attachment = await attachments.AddAsync(
            project.ProjectId,
            new MemoryStream(Encoding.UTF8.GetBytes("valid before corruption")),
            "corrupt.bin",
            "application/octet-stream",
            "source",
            TestContext.Current.CancellationToken);
        File.WriteAllText(fixture.BlobPath(attachment.Content.Sha256), "corrupt");
        var destination = fixture.Destination("must-not-exist.techmap-project.zip");

        var error = await Assert.ThrowsAsync<ProjectExportException>(() =>
            new SqliteProjectExportService(lease, storage).ExportAsync(
                new ProjectExportRequest(project.ProjectId, destination, "0.1.0-m1.13"),
                TestContext.Current.CancellationToken));

        Assert.Equal("project_export_failed", error.Code);
        Assert.False(File.Exists(destination));
        Assert.Empty(Directory.GetFiles(fixture.ExportRoot, "*.staging", SearchOption.TopDirectoryOnly));
    }

    [Fact]
    public async Task Existing_destination_is_preserved_and_not_replaced()
    {
        using var fixture = ExportFixture.Create();
        await using var lease = DataRootLease.Acquire(fixture.DataRoot);
        using var storage = SqliteStorage.Open(lease.CanonicalPath);
        var project = new SqliteProjectCatalog(storage).CreateProject(new CreateProjectCommand(
            "ПР-ЭКСП-04", "Коллизия", 1, ProjectStatus.Active));
        var destination = fixture.Destination("existing.techmap-project.zip");
        File.WriteAllText(destination, "existing result");

        var error = await Assert.ThrowsAsync<ProjectExportException>(() =>
            new SqliteProjectExportService(lease, storage).ExportAsync(
                new ProjectExportRequest(project.ProjectId, destination, "0.1.0-m1.13"),
                TestContext.Current.CancellationToken));

        Assert.Equal("export_destination_exists", error.Code);
        Assert.Equal("existing result", File.ReadAllText(destination));
    }

    [Fact]
    public async Task Failure_before_publish_does_not_expose_final_archive()
    {
        using var fixture = ExportFixture.Create();
        await using var lease = DataRootLease.Acquire(fixture.DataRoot);
        using var storage = SqliteStorage.Open(lease.CanonicalPath);
        var project = new SqliteProjectCatalog(storage).CreateProject(new CreateProjectCommand(
            "ПР-ЭКСП-05", "Сбой публикации", 1, ProjectStatus.Active));
        var destination = fixture.Destination("interrupted.techmap-project.zip");
        var exporter = new SqliteProjectExportService(lease, storage, phase =>
        {
            if (phase == "before_publish")
            {
                throw new IOException("simulated export failure");
            }
        });

        var error = await Assert.ThrowsAsync<ProjectExportException>(() => exporter.ExportAsync(
            new ProjectExportRequest(project.ProjectId, destination, "0.1.0-m1.13"),
            TestContext.Current.CancellationToken));

        Assert.Equal("project_export_failed", error.Code);
        Assert.False(File.Exists(destination));
        Assert.Empty(Directory.GetFiles(fixture.ExportRoot, "*.staging", SearchOption.TopDirectoryOnly));
    }

    [Fact]
    public async Task Missing_project_does_not_create_an_archive()
    {
        using var fixture = ExportFixture.Create();
        await using var lease = DataRootLease.Acquire(fixture.DataRoot);
        using var storage = SqliteStorage.Open(lease.CanonicalPath);
        var destination = fixture.Destination("missing.techmap-project.zip");

        var error = await Assert.ThrowsAsync<ProjectExportException>(() =>
            new SqliteProjectExportService(lease, storage).ExportAsync(
                new ProjectExportRequest(ProjectIdentity.New(), destination, "0.1.0-m1.13"),
                TestContext.Current.CancellationToken));

        Assert.Equal("project_not_found", error.Code);
        Assert.False(File.Exists(destination));
        Assert.Empty(Directory.GetFiles(fixture.ExportRoot, "*.staging", SearchOption.TopDirectoryOnly));
    }

    [Fact]
    public async Task Destination_inside_data_root_is_rejected_before_staging()
    {
        using var fixture = ExportFixture.Create();
        await using var lease = DataRootLease.Acquire(fixture.DataRoot);
        using var storage = SqliteStorage.Open(lease.CanonicalPath);
        var project = new SqliteProjectCatalog(storage).CreateProject(new CreateProjectCommand(
            "ПР-ЭКСП-06", "Недопустимый путь", 1, ProjectStatus.Active));
        var destination = Path.Combine(fixture.DataRoot, "inside.techmap-project.zip");

        var error = await Assert.ThrowsAsync<ProjectExportException>(() =>
            new SqliteProjectExportService(lease, storage).ExportAsync(
                new ProjectExportRequest(project.ProjectId, destination, "0.1.0-m1.13"),
                TestContext.Current.CancellationToken));

        Assert.Equal("export_destination_invalid", error.Code);
        Assert.False(File.Exists(destination));
        Assert.Empty(Directory.GetFiles(fixture.DataRoot, "*.staging", SearchOption.TopDirectoryOnly));
    }

    [Fact]
    public async Task Attachment_size_metadata_mismatch_does_not_create_an_archive()
    {
        using var fixture = ExportFixture.Create();
        await using var lease = DataRootLease.Acquire(fixture.DataRoot);
        using var storage = SqliteStorage.Open(lease.CanonicalPath);
        var project = new SqliteProjectCatalog(storage).CreateProject(new CreateProjectCommand(
            "ПР-ЭКСП-07", "Поврежденные метаданные", 1, ProjectStatus.Active));
        var attachments = new SqliteProjectAttachmentCatalog(
            storage,
            new ContentAddressedAttachmentStore(fixture.DataRoot),
            new FrozenTimeProvider(ExportFixture.Utc));
        var attachment = await attachments.AddAsync(
            project.ProjectId,
            new MemoryStream(Encoding.UTF8.GetBytes("content with stable length")),
            "source.bin",
            "application/octet-stream",
            "source",
            TestContext.Current.CancellationToken);
        using (var connection = new SqliteConnection(
                   $"Data Source={storage.Layout.DatabasePath};Pooling=False"))
        {
            connection.Open();
            using var command = connection.CreateCommand();
            command.CommandText =
                "UPDATE attachment_blobs SET size_bytes = size_bytes + 1 WHERE content_sha256 = $sha256;";
            command.Parameters.AddWithValue("$sha256", attachment.Content.Sha256);
            Assert.Equal(1, command.ExecuteNonQuery());
        }

        var destination = fixture.Destination("metadata-mismatch.techmap-project.zip");
        var error = await Assert.ThrowsAsync<ProjectExportException>(() =>
            new SqliteProjectExportService(lease, storage).ExportAsync(
                new ProjectExportRequest(project.ProjectId, destination, "0.1.0-m1.13"),
                TestContext.Current.CancellationToken));

        Assert.Equal("project_export_failed", error.Code);
        Assert.False(File.Exists(destination));
        Assert.Empty(Directory.GetFiles(fixture.ExportRoot, "*.staging", SearchOption.TopDirectoryOnly));
    }

    [Fact]
    public async Task Offline_export_with_a_busy_data_root_fails_without_success_status_or_archive()
    {
        using var fixture = ExportFixture.Create();
        await using var lease = DataRootLease.Acquire(fixture.DataRoot);
        var destination = fixture.Destination("busy.techmap-project.zip");
        var logRoot = Path.Combine(fixture.Root, "startup-logs");
        var executable = Path.Combine(AppContext.BaseDirectory, "Techmap.Server.exe");
        using var process = Process.Start(new ProcessStartInfo
        {
            FileName = executable,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            ArgumentList =
            {
                "--no-error-dialog",
                $"--error-log-root={logRoot}",
                $"--data-root={fixture.DataRoot}",
                $"--export-project={Guid.NewGuid():D}",
                $"--export-destination={destination}",
            },
        }) ?? throw new InvalidOperationException("The export subprocess could not be started.");

        var stdoutTask = process.StandardOutput.ReadToEndAsync(TestContext.Current.CancellationToken);
        var stderrTask = process.StandardError.ReadToEndAsync(TestContext.Current.CancellationToken);
        await process.WaitForExitAsync(TestContext.Current.CancellationToken);
        var stdout = await stdoutTask;
        var stderr = await stderrTask;

        Assert.Equal(1, process.ExitCode);
        Assert.DoesNotContain("TECHMAP_PROJECT_EXPORT_STATUS=ok", stdout, StringComparison.Ordinal);
        Assert.Contains("TECHMAP_STARTUP_ERROR=InvalidOperationException", stderr, StringComparison.Ordinal);
        Assert.False(File.Exists(destination));
        Assert.Single(Directory.GetFiles(logRoot, "startup-error-*.log"));
    }

    [Fact]
    public async Task Destination_parent_replaced_after_validation_is_rejected_before_staging()
    {
        using var fixture = ExportFixture.Create();
        await using var lease = DataRootLease.Acquire(fixture.DataRoot);
        using var storage = SqliteStorage.Open(lease.CanonicalPath);
        var project = new SqliteProjectCatalog(storage).CreateProject(new CreateProjectCommand(
            "ПР-ЭКСП-08", "Подмена каталога", 1, ProjectStatus.Active));
        var destination = fixture.Destination("junction-race.techmap-project.zip");
        var hookReached = false;
        var junctionCreated = false;
        var exporter = new SqliteProjectExportService(lease, storage, phase =>
        {
            if (phase != "after_destination_guard")
            {
                return;
            }

            hookReached = true;
            Directory.Delete(fixture.ExportRoot);
            junctionCreated = TryCreateJunction(fixture.ExportRoot, fixture.DataRoot);
            if (!junctionCreated)
            {
                Directory.CreateDirectory(fixture.ExportRoot);
                throw new JunctionUnavailableException();
            }
        });

        try
        {
            var error = await Assert.ThrowsAnyAsync<Exception>(() => exporter.ExportAsync(
                new ProjectExportRequest(project.ProjectId, destination, "0.1.0-m1.13"),
                TestContext.Current.CancellationToken));
            if (error is ProjectExportException { InnerException: JunctionUnavailableException })
            {
                Assert.Skip("This Windows environment does not allow creation of a test junction.");
            }

            Assert.IsType<ProjectExportException>(error);
            Assert.True(hookReached);
            Assert.True(Directory.Exists(fixture.ExportRoot));
            Assert.False(File.Exists(destination));
            Assert.False(File.Exists(Path.Combine(fixture.DataRoot, Path.GetFileName(destination))));
            Assert.Empty(Directory.GetFiles(fixture.DataRoot, "*.staging", SearchOption.TopDirectoryOnly));
        }
        finally
        {
            if (junctionCreated && Directory.Exists(fixture.ExportRoot))
            {
                Directory.Delete(fixture.ExportRoot);
                Directory.CreateDirectory(fixture.ExportRoot);
            }
        }
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

    private sealed class JunctionUnavailableException : Exception;

    private static async Task<JsonDocument> ReadJsonAsync(ZipArchive archive, string path) =>
        JsonDocument.Parse(await ReadBytesAsync(archive, path));

    private static async Task<byte[]> ReadBytesAsync(ZipArchive archive, string path)
    {
        var entry = Assert.Single(archive.Entries, entry => entry.FullName == path);
        await using var source = entry.Open();
        using var memory = new MemoryStream();
        await source.CopyToAsync(memory, TestContext.Current.CancellationToken);
        return memory.ToArray();
    }

    private static string HashFile(string path)
    {
        using var stream = File.OpenRead(path);
        return Convert.ToHexStringLower(SHA256.HashData(stream));
    }

    private static bool Contains(byte[] haystack, byte[] needle) =>
        haystack.AsSpan().IndexOf(needle) >= 0;

    private sealed class FrozenTimeProvider(DateTimeOffset value) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => value;
    }

    private sealed class ExportFixture : IDisposable
    {
        public static readonly DateTimeOffset Utc =
            new(2026, 9, 12, 12, 0, 0, TimeSpan.Zero);

        private ExportFixture(string root)
        {
            Root = root;
            DataRoot = Path.Combine(root, "data-root-local-secret");
            ExportRoot = Path.Combine(root, "exports");
            Directory.CreateDirectory(DataRoot);
            Directory.CreateDirectory(ExportRoot);
        }

        public string Root { get; }
        public string DataRoot { get; }
        public string ExportRoot { get; }

        public static ExportFixture Create()
        {
            var root = Path.Combine(Path.GetTempPath(), "techmap-project-export", Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(root);
            return new ExportFixture(root);
        }

        public string Destination(string name) => Path.Combine(ExportRoot, name);

        public string BlobPath(string sha256) => Path.Combine(
            DataRoot,
            "attachments",
            "blobs",
            sha256[..2],
            sha256);

        public void Dispose()
        {
            if (Directory.Exists(Root))
            {
                Directory.Delete(Root, recursive: true);
            }
        }
    }
}
