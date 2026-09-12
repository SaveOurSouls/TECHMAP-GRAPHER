using System.IO.Compression;
using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Data.Sqlite;
using Techmap.Application;
using Techmap.Domain;
using Techmap.Infrastructure.Sqlite;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class ProjectImportIntegrationTests
{
    [Fact]
    public async Task Version_one_archive_uses_legacy_project_quantity_for_each_harness()
    {
        using var fixture = ImportFixture.Create();
        var archive = await fixture.CreateMinimalArchiveAsync();
        ConvertArchiveToSnapshotVersionOne(archive);
        await using var lease = DataRootLease.Acquire(fixture.DestinationDataRoot);
        using var storage = SqliteStorage.Open(lease.CanonicalPath);

        var result = await new SqliteProjectImportService(lease, storage).ImportAsync(
            new ProjectImportRequest(archive, "0.1.0-m1.15"),
            TestContext.Current.CancellationToken);

        var imported = new SqliteProjectCatalog(storage).GetProject(result.ProjectId);
        var harness = Assert.Single(imported.Harnesses);
        Assert.Equal(3, harness.Quantity);
        Assert.Equal(["e4", "drawing", "route"], harness.Documents.Select(document => document.Kind));
        Assert.Equal(3, harness.Documents.Select(document => document.DocumentId).Distinct().Count());
        var design = new SqliteHarnessDesignDocumentStore(storage, TimeProvider.System)
            .Get(imported.ProjectId, harness.HarnessId);
        Assert.Equal(0, design.Revision);
        Assert.Equal(SqliteHarnessDesignDocumentStore.CurrentContentSchemaVersion, design.SchemaVersion);
        using var content = JsonDocument.Parse(design.ContentJson);
        Assert.Empty(content.RootElement.GetProperty("connectors").EnumerateArray());
        Assert.Equal(3, content.RootElement.GetProperty("views").GetProperty("drawing")
            .GetProperty("layers").GetArrayLength());
    }

    [Fact]
    public async Task Version_two_archive_gets_a_valid_empty_harness_design()
    {
        using var fixture = ImportFixture.Create();
        var archive = await fixture.CreateMinimalArchiveAsync();
        ConvertArchiveToSnapshotVersionTwo(archive);
        await using var lease = DataRootLease.Acquire(fixture.DestinationDataRoot);
        using var storage = SqliteStorage.Open(lease.CanonicalPath);

        var result = await new SqliteProjectImportService(lease, storage).ImportAsync(
            new ProjectImportRequest(archive, "0.1.0-m1.15"),
            TestContext.Current.CancellationToken);

        var imported = new SqliteProjectCatalog(storage).GetProject(result.ProjectId);
        var harness = Assert.Single(imported.Harnesses);
        var design = new SqliteHarnessDesignDocumentStore(storage, TimeProvider.System)
            .Get(imported.ProjectId, harness.HarnessId);
        Assert.Equal(0, design.Revision);
        Assert.Equal(SqliteHarnessDesignDocumentStore.CurrentContentSchemaVersion, design.SchemaVersion);
        using var content = JsonDocument.Parse(design.ContentJson);
        Assert.Empty(content.RootElement.GetProperty("wires").EnumerateArray());
        Assert.Equal(3, content.RootElement.GetProperty("views").GetProperty("e4")
            .GetProperty("layers").GetArrayLength());
    }

    [Fact]
    public async Task Valid_archive_imports_independent_project_and_remaps_owned_ids()
    {
        using var fixture = ImportFixture.Create();
        await using var sourceLease = DataRootLease.Acquire(fixture.SourceDataRoot);
        using var sourceStorage = SqliteStorage.Open(sourceLease.CanonicalPath);
        var sourceProjects = new SqliteProjectCatalog(sourceStorage);
        var source = sourceProjects.CreateProject(new CreateProjectCommand(
            "ПР-ИМП-01", "Переносимый проект", 12, ProjectStatus.Active));
        source = sourceProjects.AddHarness(source.ProjectId, "ЖГ-01", 6);
        source = sourceProjects.AddHarness(source.ProjectId, "ЖГ-02", 21);
        var sourceDesignStore = new SqliteHarnessDesignDocumentStore(sourceStorage, TimeProvider.System);
        var sourceDesigns = source.Harnesses.ToDictionary(
            harness => harness.Designation,
            harness => sourceDesignStore.Put(
                source.ProjectId,
                harness.HarnessId,
                0,
                SqliteHarnessDesignDocumentStore.CurrentContentSchemaVersion,
                "{\"schemaVersion\":1,\"connectors\":[{\"id\":\"" + harness.Designation +
                "\"}],\"wires\":[{\"id\":\"W-" + harness.SortOrder +
                "\"}],\"views\":{\"e4\":{\"layers\":[]},\"drawing\":{\"layers\":[]}}}"));
        var sourceHarnessIds = source.Harnesses.Select(item => item.HarnessId.Value).ToHashSet();
        var sourceDocumentIds = source.Harnesses.SelectMany(item => item.Documents)
            .Select(item => item.DocumentId.Value).ToHashSet();
        var attachments = new SqliteProjectAttachmentCatalog(
            sourceStorage,
            new ContentAddressedAttachmentStore(fixture.SourceDataRoot),
            new FrozenTimeProvider(ImportFixture.Utc));
        var attachment = await attachments.AddAsync(
            source.ProjectId,
            new MemoryStream(Encoding.UTF8.GetBytes("imported attachment")),
            "рисунок.png",
            "image/png",
            "drawing",
            TestContext.Current.CancellationToken);
        var pinned = ExternalCharacteristicSnapshot.Capture(
            CharacteristicSnapshotIdentity.New(),
            "synthetic",
            "terminal:T-01",
            "v1",
            "Длина зачистки",
            "4.0",
            "мм",
            ImportFixture.Utc);
        _ = new SqlitePinnedCharacteristicStore(sourceStorage).AddOrGet(source.ProjectId, pinned);
        var archive = fixture.Archive("valid.techmap-project.zip");
        await new SqliteProjectExportService(sourceLease, sourceStorage).ExportAsync(
            new ProjectExportRequest(source.ProjectId, archive, "0.1.0-m1.13"),
            TestContext.Current.CancellationToken);
        source = sourceProjects.GetProject(source.ProjectId);
        sourceStorage.Dispose();
        await sourceLease.DisposeAsync();

        await using var destinationLease = DataRootLease.Acquire(fixture.DestinationDataRoot);
        using var destinationStorage = SqliteStorage.Open(destinationLease.CanonicalPath);
        var importer = new SqliteProjectImportService(
            destinationLease,
            destinationStorage,
            new FrozenTimeProvider(ImportFixture.Utc.AddHours(1)));

        var result = await importer.ImportAsync(
            new ProjectImportRequest(archive, "0.1.0-m1.14"),
            TestContext.Current.CancellationToken);
        var imported = new SqliteProjectCatalog(destinationStorage).GetProject(result.ProjectId);
        var importedPinned = new SqlitePinnedCharacteristicStore(destinationStorage).List(result.ProjectId);

        Assert.NotEqual(source.ProjectId, result.ProjectId);
        Assert.Equal(source.ProjectId, result.RestoredFromProjectId);
        Assert.Equal(source.Revision, result.RestoredFromRevision);
        Assert.Equal(0, imported.Revision);
        Assert.Equal(2, imported.Harnesses.Count);
        Assert.Equal([6L, 21L], imported.Harnesses.Select(item => item.Quantity));
        Assert.DoesNotContain(imported.Harnesses, item => sourceHarnessIds.Contains(item.HarnessId.Value));
        Assert.DoesNotContain(imported.Harnesses.SelectMany(item => item.Documents),
            item => sourceDocumentIds.Contains(item.DocumentId.Value));
        Assert.Equal(6, imported.Harnesses.SelectMany(item => item.Documents)
            .Select(item => item.DocumentId).Distinct().Count());
        var importedDesignStore = new SqliteHarnessDesignDocumentStore(destinationStorage, TimeProvider.System);
        foreach (var importedHarness in imported.Harnesses)
        {
            var importedDesign = importedDesignStore.Get(imported.ProjectId, importedHarness.HarnessId);
            var sourceDesign = sourceDesigns[importedHarness.Designation];
            Assert.Equal(0, importedDesign.Revision);
            Assert.Equal(sourceDesign.SchemaVersion, importedDesign.SchemaVersion);
            using var sourceContent = JsonDocument.Parse(sourceDesign.ContentJson);
            using var importedContent = JsonDocument.Parse(importedDesign.ContentJson);
            Assert.True(JsonElement.DeepEquals(sourceContent.RootElement, importedContent.RootElement));
        }
        Assert.Single(importedPinned);
        Assert.NotEqual(pinned.SnapshotId, importedPinned[0].SnapshotId);
        var ids = QueryStrings(destinationStorage, "SELECT attachment_id FROM project_attachments;");
        Assert.Single(ids);
        Assert.NotEqual(attachment.AttachmentId.Value.ToString("D"), ids[0]);
        Assert.Equal("imported attachment", await ReadAttachmentAsync(destinationStorage, fixture.DestinationDataRoot, ids[0]));
        Assert.Empty(QueryStrings(destinationStorage, "SELECT command_id FROM project_commands;"));
        Assert.Empty(QueryStrings(destinationStorage, "SELECT command_id FROM project_versions;"));
        Assert.Equal(source.ProjectId.Value.ToString("D"), QueryStrings(
            destinationStorage,
            "SELECT source_project_id FROM project_imports;").Single());
        Assert.Equal("0.1.0-m1.14", QueryStrings(
            destinationStorage,
            "SELECT import_app_version FROM project_imports;").Single());
    }

    [Fact]
    public async Task Repeated_import_creates_a_second_independent_project_and_reuses_CAS()
    {
        using var fixture = ImportFixture.Create();
        var archive = await fixture.CreateMinimalArchiveAsync();
        await using var lease = DataRootLease.Acquire(fixture.DestinationDataRoot);
        using var storage = SqliteStorage.Open(lease.CanonicalPath);
        var importer = new SqliteProjectImportService(lease, storage);

        var first = await importer.ImportAsync(
            new ProjectImportRequest(archive, "0.1.0-m1.14"), TestContext.Current.CancellationToken);
        var second = await importer.ImportAsync(
            new ProjectImportRequest(archive, "0.1.0-m1.14"), TestContext.Current.CancellationToken);

        Assert.NotEqual(first.ProjectId, second.ProjectId);
        Assert.NotEqual(first.ProjectIncrement, second.ProjectIncrement);
        Assert.NotEqual(first.ProjectName, second.ProjectName);
        Assert.Equal(2, new SqliteProjectCatalog(storage).ListProjects().Count);
        Assert.Single(Directory.GetFiles(
            Path.Combine(fixture.DestinationDataRoot, "attachments", "blobs"),
            "*",
            SearchOption.AllDirectories));
    }

    [Theory]
    [InlineData(ArchiveMutation.BadManifestChecksum, "import_manifest_checksum_invalid")]
    [InlineData(ArchiveMutation.MissingSnapshot, "import_payload_mismatch")]
    [InlineData(ArchiveMutation.ExtraEntry, "import_unlisted_entry")]
    [InlineData(ArchiveMutation.BackslashEntry, "import_entry_path_unsafe")]
    [InlineData(ArchiveMutation.CaseDuplicate, "import_duplicate_entry")]
    [InlineData(ArchiveMutation.BadManifestFormat, "import_manifest_incompatible")]
    [InlineData(ArchiveMutation.NonCanonicalManifest, "import_manifest_invalid")]
    [InlineData(ArchiveMutation.DuplicateManifestProperty, "import_manifest_invalid")]
    [InlineData(ArchiveMutation.TraversalEntry, "import_entry_path_unsafe")]
    [InlineData(ArchiveMutation.AbsoluteEntry, "import_entry_path_unsafe")]
    [InlineData(ArchiveMutation.DriveEntry, "import_entry_path_unsafe")]
    [InlineData(ArchiveMutation.MissingBlob, "import_payload_mismatch")]
    [InlineData(ArchiveMutation.CorruptBlob, "import_payload_hash_invalid")]
    public async Task Invalid_archive_never_creates_a_visible_project(
        ArchiveMutation mutation,
        string expectedCode)
    {
        using var fixture = ImportFixture.Create();
        var archive = await fixture.CreateMinimalArchiveAsync();
        MutateArchive(archive, mutation);
        await using var lease = DataRootLease.Acquire(fixture.DestinationDataRoot);
        using var storage = SqliteStorage.Open(lease.CanonicalPath);

        var error = await Assert.ThrowsAsync<ProjectImportException>(() =>
            new SqliteProjectImportService(lease, storage).ImportAsync(
                new ProjectImportRequest(archive, "0.1.0-m1.14"),
                TestContext.Current.CancellationToken));

        Assert.Equal(expectedCode, error.Code);
        Assert.Empty(new SqliteProjectCatalog(storage).ListProjects());
        Assert.Empty(QueryStrings(storage, "SELECT project_id FROM project_imports;"));
    }

    [Fact]
    public async Task Excessive_compression_ratio_is_rejected_before_publication()
    {
        using var fixture = ImportFixture.Create();
        var archive = await fixture.CreateMinimalArchiveAsync();
        var entries = ReadArchive(archive);
        File.Delete(archive);
        using (var zip = ZipFile.Open(archive, ZipArchiveMode.Create))
        {
            foreach (var item in entries)
            {
                var entry = zip.CreateEntry(item.Key, CompressionLevel.NoCompression);
                entry.ExternalAttributes = 0;
                using var output = entry.Open();
                output.Write(item.Value);
            }

            var bomb = zip.CreateEntry("bomb.bin", CompressionLevel.SmallestSize);
            bomb.ExternalAttributes = 0;
            using var bombOutput = bomb.Open();
            bombOutput.Write(new byte[1024 * 1024]);
        }

        await using var lease = DataRootLease.Acquire(fixture.DestinationDataRoot);
        using var storage = SqliteStorage.Open(lease.CanonicalPath);
        var error = await Assert.ThrowsAsync<ProjectImportException>(() =>
            new SqliteProjectImportService(lease, storage).ImportAsync(
                new ProjectImportRequest(archive, "0.1.0-m1.14"),
                TestContext.Current.CancellationToken));

        Assert.Equal("import_compression_ratio_exceeded", error.Code);
        Assert.Empty(new SqliteProjectCatalog(storage).ListProjects());
    }

    [Fact]
    public async Task Symlink_entry_is_rejected_before_publication()
    {
        using var fixture = ImportFixture.Create();
        var archive = await fixture.CreateMinimalArchiveAsync();
        var entries = ReadArchive(archive);
        File.Delete(archive);
        using (var zip = ZipFile.Open(archive, ZipArchiveMode.Create))
        {
            foreach (var item in entries)
            {
                var entry = zip.CreateEntry(item.Key, CompressionLevel.NoCompression);
                entry.ExternalAttributes = 0;
                using var output = entry.Open();
                output.Write(item.Value);
            }

            var link = zip.CreateEntry("link", CompressionLevel.NoCompression);
            link.ExternalAttributes = unchecked((int)0xA0000000);
            using var linkOutput = link.Open();
            linkOutput.Write(Encoding.UTF8.GetBytes("target"));
        }

        await using var lease = DataRootLease.Acquire(fixture.DestinationDataRoot);
        using var storage = SqliteStorage.Open(lease.CanonicalPath);
        var error = await Assert.ThrowsAsync<ProjectImportException>(() =>
            new SqliteProjectImportService(lease, storage).ImportAsync(
                new ProjectImportRequest(archive, "0.1.0-m1.14"),
                TestContext.Current.CancellationToken));

        Assert.Equal("import_link_entry", error.Code);
        Assert.Empty(new SqliteProjectCatalog(storage).ListProjects());
    }

    [Fact]
    public async Task Failure_before_database_commit_rolls_back_project_and_owned_blob()
    {
        using var fixture = ImportFixture.Create();
        var archive = await fixture.CreateMinimalArchiveAsync();
        await using var lease = DataRootLease.Acquire(fixture.DestinationDataRoot);
        using var storage = SqliteStorage.Open(lease.CanonicalPath);
        var importer = new SqliteProjectImportService(lease, storage, progressHook: phase =>
        {
            if (phase == "before_database_commit")
            {
                throw new IOException("simulated failure");
            }
        });

        var error = await Assert.ThrowsAsync<ProjectImportException>(() => importer.ImportAsync(
            new ProjectImportRequest(archive, "0.1.0-m1.14"), TestContext.Current.CancellationToken));

        Assert.Equal("project_import_failed", error.Code);
        Assert.Empty(new SqliteProjectCatalog(storage).ListProjects());
        Assert.Empty(QueryStrings(storage, "SELECT content_sha256 FROM attachment_blobs;"));
        Assert.Empty(Directory.GetFiles(
            Path.Combine(fixture.DestinationDataRoot, "attachments", "blobs"),
            "*",
            SearchOption.AllDirectories));
    }

    [Fact]
    public async Task Concurrent_imports_receive_unique_ids_and_increments()
    {
        using var fixture = ImportFixture.Create();
        var archive = await fixture.CreateMinimalArchiveAsync();
        await using var lease = DataRootLease.Acquire(fixture.DestinationDataRoot);
        using var storage = SqliteStorage.Open(lease.CanonicalPath);
        var firstImporter = new SqliteProjectImportService(lease, storage);
        var secondImporter = new SqliteProjectImportService(lease, storage);

        var results = await Task.WhenAll(
            firstImporter.ImportAsync(new ProjectImportRequest(archive, "0.1.0-m1.14"), TestContext.Current.CancellationToken),
            secondImporter.ImportAsync(new ProjectImportRequest(archive, "0.1.0-m1.14"), TestContext.Current.CancellationToken));

        Assert.Equal(2, results.Select(item => item.ProjectId).Distinct().Count());
        Assert.Equal(2, results.Select(item => item.ProjectIncrement).Distinct().Count());
    }

    [Fact]
    public async Task Format_one_archive_from_storage_schema_four_remains_importable()
    {
        using var fixture = ImportFixture.Create();
        var archive = await fixture.CreateMinimalArchiveAsync();
        var entries = ReadArchive(archive);
        ReplaceManifest(entries, text => text.Replace(
            $"\"sourceStorageSchemaVersion\":{SqliteStorage.CurrentSchemaVersion}",
            "\"sourceStorageSchemaVersion\":4",
            StringComparison.Ordinal));
        WriteArchive(archive, entries);
        await using var lease = DataRootLease.Acquire(fixture.DestinationDataRoot);
        using var storage = SqliteStorage.Open(lease.CanonicalPath);

        var result = await new SqliteProjectImportService(lease, storage).ImportAsync(
            new ProjectImportRequest(archive, "0.1.0-m1.14"),
            TestContext.Current.CancellationToken);

        Assert.NotEqual(Guid.Empty, result.ProjectId.Value);
        Assert.Equal("4", QueryStrings(
            storage,
            "SELECT CAST(source_storage_schema_version AS TEXT) FROM project_imports;").Single());
    }

    [Fact]
    public async Task Startup_recovery_removes_durable_uncommitted_journal_stage_and_orphan_blob()
    {
        using var fixture = ImportFixture.Create();
        var archive = await fixture.CreateMinimalArchiveAsync();
        await using var lease = DataRootLease.Acquire(fixture.DestinationDataRoot);
        using var storage = SqliteStorage.Open(lease.CanonicalPath);
        var interrupted = new SqliteProjectImportService(lease, storage, progressHook: phase =>
        {
            if (phase == "after_first_blob")
            {
                throw new IOException("simulated process interruption");
            }
        });

        var error = await Assert.ThrowsAsync<ProjectImportException>(() => interrupted.ImportAsync(
            new ProjectImportRequest(archive, "0.1.0-m1.14"), TestContext.Current.CancellationToken));
        Assert.Equal("project_import_failed", error.Code);
        Assert.Empty(new SqliteProjectCatalog(storage).ListProjects());
        Assert.Single(Directory.GetFiles(
            Path.Combine(fixture.DestinationDataRoot, "imports", "journals"),
            "*.project-import.json"));
        Assert.Single(Directory.GetFiles(
            Path.Combine(fixture.DestinationDataRoot, "attachments", "blobs"),
            "*",
            SearchOption.AllDirectories));

        var recovered = await new SqliteProjectImportService(lease, storage).RecoverPendingAsync(
            TestContext.Current.CancellationToken);

        Assert.Empty(recovered);
        Assert.Empty(new SqliteProjectCatalog(storage).ListProjects());
        Assert.Empty(Directory.GetFiles(
            Path.Combine(fixture.DestinationDataRoot, "imports", "journals"),
            "*.project-import.json"));
        Assert.Empty(Directory.GetDirectories(
            Path.Combine(fixture.DestinationDataRoot, "imports", "staging"),
            "import-*"));
        Assert.Empty(Directory.GetFiles(
            Path.Combine(fixture.DestinationDataRoot, "attachments", "blobs"),
            "*",
            SearchOption.AllDirectories));
    }

    [Fact]
    public async Task Startup_recovery_recognizes_committed_import_and_finishes_deferred_cleanup()
    {
        using var fixture = ImportFixture.Create();
        var archive = await fixture.CreateMinimalArchiveAsync();
        await using var lease = DataRootLease.Acquire(fixture.DestinationDataRoot);
        using var storage = SqliteStorage.Open(lease.CanonicalPath);
        FileStream? journalLock = null;
        var importer = new SqliteProjectImportService(lease, storage, progressHook: phase =>
        {
            if (phase == "after_database_commit")
            {
                var journal = Directory.GetFiles(
                    Path.Combine(fixture.DestinationDataRoot, "imports", "journals"),
                    "*.project-import.json").Single();
                journalLock = new FileStream(journal, FileMode.Open, FileAccess.Read, FileShare.Read);
            }
        });

        var imported = await importer.ImportAsync(
            new ProjectImportRequest(archive, "0.1.0-m1.14"), TestContext.Current.CancellationToken);
        Assert.NotNull(journalLock);
        Assert.Single(Directory.GetFiles(
            Path.Combine(fixture.DestinationDataRoot, "imports", "journals"),
            "*.project-import.json"));
        journalLock.Dispose();

        var recovered = await new SqliteProjectImportService(lease, storage).RecoverPendingAsync(
            TestContext.Current.CancellationToken);

        var result = Assert.Single(recovered);
        Assert.Equal(imported.ProjectId, result.ProjectId);
        Assert.True(result.Recovered);
        Assert.Single(new SqliteProjectCatalog(storage).ListProjects());
        Assert.Empty(Directory.GetFiles(
            Path.Combine(fixture.DestinationDataRoot, "imports", "journals"),
            "*.project-import.json"));
    }

    [Fact]
    public async Task Startup_recovery_rejects_same_count_owned_row_substitution()
    {
        using var fixture = ImportFixture.Create();
        var archive = await fixture.CreateMinimalArchiveAsync();
        await using var lease = DataRootLease.Acquire(fixture.DestinationDataRoot);
        using var storage = SqliteStorage.Open(lease.CanonicalPath);
        FileStream? journalLock = null;
        var importer = new SqliteProjectImportService(lease, storage, progressHook: phase =>
        {
            if (phase == "after_database_commit")
            {
                var journal = Directory.GetFiles(
                    Path.Combine(fixture.DestinationDataRoot, "imports", "journals"),
                    "*.project-import.json").Single();
                journalLock = new FileStream(journal, FileMode.Open, FileAccess.Read, FileShare.Read);
            }
        });

        var imported = await importer.ImportAsync(
            new ProjectImportRequest(archive, "0.1.0-m1.14"), TestContext.Current.CancellationToken);
        Assert.NotNull(journalLock);
        journalLock.Dispose();
        storage.ExecuteInTransaction(unitOfWork =>
        {
            using var command = unitOfWork.CreateCommand(
                "UPDATE harnesses SET harness_id = $replacement WHERE project_id = $projectId;");
            command.Parameters.AddWithValue("$replacement", Guid.NewGuid().ToString("D"));
            command.Parameters.AddWithValue("$projectId", imported.ProjectId.Value.ToString("D"));
            Assert.Equal(1, command.ExecuteNonQuery());
            return true;
        });

        var error = Assert.Throws<ProjectImportException>(() =>
            new SqliteProjectImportService(lease, storage).RecoverPendingAsync(
                TestContext.Current.CancellationToken).GetAwaiter().GetResult());

        Assert.Equal("import_recovery_conflict", error.Code);
        Assert.Single(Directory.GetFiles(
            Path.Combine(fixture.DestinationDataRoot, "imports", "journals"),
            "*.project-import.json"));
    }

    [Fact]
    public async Task Startup_recovery_rejects_oversized_journal_before_reading_it()
    {
        using var fixture = ImportFixture.Create();
        await using var lease = DataRootLease.Acquire(fixture.DestinationDataRoot);
        using var storage = SqliteStorage.Open(lease.CanonicalPath);
        _ = new SqliteProjectImportService(lease, storage);
        var journal = Path.Combine(
            fixture.DestinationDataRoot,
            "imports",
            "journals",
            $"{Guid.NewGuid():D}.project-import.json");
        await using (var stream = new FileStream(journal, FileMode.CreateNew, FileAccess.Write, FileShare.None))
        {
            stream.SetLength(SqliteProjectImportService.MaximumManifestBytes + 1);
        }

        var error = await Assert.ThrowsAsync<ProjectImportException>(() =>
            new SqliteProjectImportService(lease, storage).RecoverPendingAsync(
                TestContext.Current.CancellationToken));

        Assert.Equal("import_journal_invalid", error.Code);
    }

    [Fact]
    public async Task Archive_inside_data_root_is_rejected_before_staging()
    {
        using var fixture = ImportFixture.Create();
        var source = await fixture.CreateMinimalArchiveAsync();
        var inside = Path.Combine(fixture.DestinationDataRoot, "inside.techmap-project.zip");
        File.Copy(source, inside);
        await using var lease = DataRootLease.Acquire(fixture.DestinationDataRoot);
        using var storage = SqliteStorage.Open(lease.CanonicalPath);

        var error = await Assert.ThrowsAsync<ProjectImportException>(() =>
            new SqliteProjectImportService(lease, storage).ImportAsync(
                new ProjectImportRequest(inside, "0.1.0-m1.14"),
                TestContext.Current.CancellationToken));

        Assert.Equal("import_archive_path_invalid", error.Code);
        Assert.False(Directory.Exists(Path.Combine(fixture.DestinationDataRoot, "imports", "staging")) &&
            Directory.EnumerateDirectories(
                Path.Combine(fixture.DestinationDataRoot, "imports", "staging"), "import-*").Any());
    }

    [Fact]
    public async Task Packaged_cli_imports_offline_without_browser_or_success_on_failure()
    {
        using var fixture = ImportFixture.Create();
        var archive = await fixture.CreateMinimalArchiveAsync();
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
                $"--data-root={fixture.DestinationDataRoot}",
                $"--import-project={archive}",
            },
        }) ?? throw new InvalidOperationException("The import subprocess could not be started.");
        var stdoutTask = process.StandardOutput.ReadToEndAsync(TestContext.Current.CancellationToken);
        var stderrTask = process.StandardError.ReadToEndAsync(TestContext.Current.CancellationToken);
        await process.WaitForExitAsync(TestContext.Current.CancellationToken);
        var stdout = await stdoutTask;
        var stderr = await stderrTask;

        Assert.Equal(0, process.ExitCode);
        Assert.Contains("TECHMAP_PROJECT_IMPORT_STATUS=ok", stdout, StringComparison.Ordinal);
        Assert.DoesNotContain("TECHMAP_STARTUP_ERROR", stderr, StringComparison.Ordinal);
        await using var lease = DataRootLease.Acquire(fixture.DestinationDataRoot);
        using var storage = SqliteStorage.Open(lease.CanonicalPath);
        Assert.Single(new SqliteProjectCatalog(storage).ListProjects());
    }

    private static async Task<string> ReadAttachmentAsync(SqliteStorage storage, string dataRoot, string id)
    {
        string hash = string.Empty;
        long size = 0;
        storage.ExecuteRead(unitOfWork =>
        {
            using var command = unitOfWork.CreateCommand(
                "SELECT content_sha256 FROM project_attachments WHERE attachment_id = $id;");
            command.Parameters.AddWithValue("$id", id);
            hash = (string)command.ExecuteScalar()!;
            using var sizeCommand = unitOfWork.CreateCommand(
                "SELECT size_bytes FROM attachment_blobs WHERE content_sha256 = $hash;");
            sizeCommand.Parameters.AddWithValue("$hash", hash);
            size = Convert.ToInt64(sizeCommand.ExecuteScalar());
            return true;
        });
        await using var stream = await new ContentAddressedAttachmentStore(dataRoot).OpenReadVerifiedAsync(
            new StoredAttachment(hash, size), TestContext.Current.CancellationToken);
        using var reader = new StreamReader(stream, Encoding.UTF8);
        return await reader.ReadToEndAsync(TestContext.Current.CancellationToken);
    }

    private static IReadOnlyList<string> QueryStrings(SqliteStorage storage, string sql) =>
        storage.ExecuteRead(unitOfWork =>
        {
            using var command = unitOfWork.CreateCommand(sql);
            using var reader = command.ExecuteReader();
            var values = new List<string>();
            while (reader.Read())
            {
                values.Add(reader.GetString(0));
            }

            return values;
        });

    private static void MutateArchive(string path, ArchiveMutation mutation)
    {
        var entries = ReadArchive(path);
        switch (mutation)
        {
            case ArchiveMutation.BadManifestChecksum:
                entries[SqliteProjectExportService.ManifestChecksumPath] = Encoding.ASCII.GetBytes(new string('0', 64) + "\n");
                break;
            case ArchiveMutation.MissingSnapshot:
                entries.Remove(SqliteProjectExportService.SnapshotPath);
                break;
            case ArchiveMutation.ExtraEntry:
                entries["extra.txt"] = [1];
                break;
            case ArchiveMutation.BackslashEntry:
                entries["bad\\path"] = [1];
                break;
            case ArchiveMutation.CaseDuplicate:
                entries["MANIFEST.JSON"] = entries[SqliteProjectExportService.ManifestPath];
                break;
            case ArchiveMutation.BadManifestFormat:
                ReplaceManifest(entries, text => text.Replace("\"manifestFormat\":1", "\"manifestFormat\":2", StringComparison.Ordinal));
                break;
            case ArchiveMutation.NonCanonicalManifest:
                ReplaceManifest(entries, text => text.Replace("{\"manifestFormat\"", "{ \"manifestFormat\"", StringComparison.Ordinal));
                break;
            case ArchiveMutation.DuplicateManifestProperty:
                ReplaceManifest(entries, text => text.Replace(
                    "{\"manifestFormat\":1,",
                    "{\"manifestFormat\":1,\"manifestFormat\":1,",
                    StringComparison.Ordinal));
                break;
            case ArchiveMutation.TraversalEntry:
                entries["../bad"] = [1];
                break;
            case ArchiveMutation.AbsoluteEntry:
                entries["/bad"] = [1];
                break;
            case ArchiveMutation.DriveEntry:
                entries["C:/bad"] = [1];
                break;
            case ArchiveMutation.MissingBlob:
                entries.Remove(entries.Keys.Single(item => item.StartsWith("attachments/blobs/", StringComparison.Ordinal)));
                break;
            case ArchiveMutation.CorruptBlob:
                entries[entries.Keys.Single(item => item.StartsWith("attachments/blobs/", StringComparison.Ordinal))] =
                    Encoding.UTF8.GetBytes("evil");
                break;
        }

        WriteArchive(path, entries);
    }

    private static void ConvertArchiveToSnapshotVersionOne(string path)
    {
        var entries = ReadArchive(path);
        var snapshot = JsonNode.Parse(entries[SqliteProjectExportService.SnapshotPath])!.AsObject();
        snapshot["snapshotFormat"] = 1;
        foreach (var harness in snapshot["harnesses"]!.AsArray())
        {
            harness!.AsObject().Remove("quantity");
            harness.AsObject().Remove("documents");
            harness.AsObject().Remove("design");
        }

        var snapshotBytes = Encoding.UTF8.GetBytes(snapshot.ToJsonString());
        entries[SqliteProjectExportService.SnapshotPath] = snapshotBytes;
        var manifest = JsonNode.Parse(entries[SqliteProjectExportService.ManifestPath])!.AsObject();
        manifest["snapshotFormat"] = 1;
        var payload = manifest["files"]!.AsArray()
            .Select(item => item!.AsObject())
            .Single(item => item["path"]!.GetValue<string>() == SqliteProjectExportService.SnapshotPath);
        payload["sizeBytes"] = snapshotBytes.LongLength;
        payload["sha256"] = Convert.ToHexStringLower(SHA256.HashData(snapshotBytes));
        var manifestBytes = Encoding.UTF8.GetBytes(manifest.ToJsonString());
        entries[SqliteProjectExportService.ManifestPath] = manifestBytes;
        entries[SqliteProjectExportService.ManifestChecksumPath] = Encoding.ASCII.GetBytes(
            Convert.ToHexStringLower(SHA256.HashData(manifestBytes)) + "\n");
        WriteArchive(path, entries);
    }

    private static void ConvertArchiveToSnapshotVersionTwo(string path)
    {
        var entries = ReadArchive(path);
        var snapshot = JsonNode.Parse(entries[SqliteProjectExportService.SnapshotPath])!.AsObject();
        snapshot["snapshotFormat"] = 2;
        foreach (var harness in snapshot["harnesses"]!.AsArray())
        {
            harness!.AsObject().Remove("design");
        }

        var snapshotBytes = Encoding.UTF8.GetBytes(snapshot.ToJsonString());
        entries[SqliteProjectExportService.SnapshotPath] = snapshotBytes;
        var manifest = JsonNode.Parse(entries[SqliteProjectExportService.ManifestPath])!.AsObject();
        manifest["snapshotFormat"] = 2;
        var payload = manifest["files"]!.AsArray()
            .Select(item => item!.AsObject())
            .Single(item => item["path"]!.GetValue<string>() == SqliteProjectExportService.SnapshotPath);
        payload["sizeBytes"] = snapshotBytes.LongLength;
        payload["sha256"] = Convert.ToHexStringLower(SHA256.HashData(snapshotBytes));
        var manifestBytes = Encoding.UTF8.GetBytes(manifest.ToJsonString());
        entries[SqliteProjectExportService.ManifestPath] = manifestBytes;
        entries[SqliteProjectExportService.ManifestChecksumPath] = Encoding.ASCII.GetBytes(
            Convert.ToHexStringLower(SHA256.HashData(manifestBytes)) + "\n");
        WriteArchive(path, entries);
    }

    private static void ReplaceManifest(IDictionary<string, byte[]> entries, Func<string, string> mutate)
    {
        var changed = Encoding.UTF8.GetBytes(mutate(Encoding.UTF8.GetString(entries[SqliteProjectExportService.ManifestPath])));
        entries[SqliteProjectExportService.ManifestPath] = changed;
        entries[SqliteProjectExportService.ManifestChecksumPath] = Encoding.ASCII.GetBytes(
            Convert.ToHexStringLower(SHA256.HashData(changed)) + "\n");
    }

    private static Dictionary<string, byte[]> ReadArchive(string path)
    {
        using var archive = ZipFile.OpenRead(path);
        return archive.Entries.ToDictionary(
            item => item.FullName,
            item =>
            {
                using var stream = item.Open();
                using var memory = new MemoryStream();
                stream.CopyTo(memory);
                return memory.ToArray();
            },
            StringComparer.Ordinal);
    }

    private static void WriteArchive(string path, IReadOnlyDictionary<string, byte[]> entries)
    {
        File.Delete(path);
        using var archive = ZipFile.Open(path, ZipArchiveMode.Create);
        foreach (var item in entries)
        {
            var entry = archive.CreateEntry(item.Key, CompressionLevel.NoCompression);
            entry.ExternalAttributes = 0;
            using var stream = entry.Open();
            stream.Write(item.Value);
        }
    }

    public enum ArchiveMutation
    {
        BadManifestChecksum,
        MissingSnapshot,
        ExtraEntry,
        BackslashEntry,
        CaseDuplicate,
        BadManifestFormat,
        NonCanonicalManifest,
        DuplicateManifestProperty,
        TraversalEntry,
        AbsoluteEntry,
        DriveEntry,
        MissingBlob,
        CorruptBlob,
    }

    private sealed class FrozenTimeProvider(DateTimeOffset utc) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => utc;
    }

    private sealed class ImportFixture : IDisposable
    {
        public static readonly DateTimeOffset Utc = new(2026, 9, 12, 10, 0, 0, TimeSpan.Zero);

        private ImportFixture(string root)
        {
            Root = root;
            SourceDataRoot = Path.Combine(root, "source-data");
            DestinationDataRoot = Path.Combine(root, "destination-data");
            ArchiveRoot = Path.Combine(root, "archives");
            Directory.CreateDirectory(SourceDataRoot);
            Directory.CreateDirectory(DestinationDataRoot);
            Directory.CreateDirectory(ArchiveRoot);
        }

        public string Root { get; }
        public string SourceDataRoot { get; }
        public string DestinationDataRoot { get; }
        public string ArchiveRoot { get; }

        public static ImportFixture Create()
        {
            var root = Path.Combine(Path.GetTempPath(), "techmap-project-import", Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(root);
            return new ImportFixture(root);
        }

        public string Archive(string name) => Path.Combine(ArchiveRoot, name);

        public async Task<string> CreateMinimalArchiveAsync()
        {
            await using var lease = DataRootLease.Acquire(SourceDataRoot);
            using var storage = SqliteStorage.Open(lease.CanonicalPath);
            var project = new SqliteProjectCatalog(storage).CreateProject(new CreateProjectCommand(
                "ПР-МИН", "Минимальный импорт", 3, ProjectStatus.Draft));
            project = new SqliteProjectCatalog(storage).AddHarness(project.ProjectId, "ЖГ-01");
            _ = await new SqliteProjectAttachmentCatalog(
                storage,
                new ContentAddressedAttachmentStore(SourceDataRoot),
                new FrozenTimeProvider(Utc)).AddAsync(
                project.ProjectId,
                new MemoryStream(Encoding.UTF8.GetBytes("blob")),
                "blob.bin",
                "application/octet-stream",
                "source",
                TestContext.Current.CancellationToken);
            var archive = Archive($"minimal-{Guid.NewGuid():N}.techmap-project.zip");
            await new SqliteProjectExportService(lease, storage).ExportAsync(
                new ProjectExportRequest(project.ProjectId, archive, "0.1.0-m1.13"),
                TestContext.Current.CancellationToken);
            return archive;
        }

        public void Dispose()
        {
            if (Directory.Exists(Root))
            {
                Directory.Delete(Root, recursive: true);
            }
        }
    }
}
