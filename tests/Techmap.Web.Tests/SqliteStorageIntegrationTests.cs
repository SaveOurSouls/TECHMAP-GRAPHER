using System.Diagnostics;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Techmap.Infrastructure.Sqlite;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class SqliteStorageIntegrationTests
{
    [Theory]
    [InlineData(23L, 23L)]
    [InlineData(long.MaxValue, 9_007_199_254_740_991L)]
    public async Task Version_five_migration_copies_or_clamps_legacy_quantity_and_seeds_documents(
        long legacyQuantity,
        long expectedQuantity)
    {
        using var fixture = StorageFixture.Create();
        Techmap.Domain.ProjectIdentity projectId;
        string databasePath;
        using (var storage = SqliteStorage.Open(fixture.DataRoot))
        {
            databasePath = storage.Layout.DatabasePath;
            var catalog = new SqliteProjectCatalog(storage);
            var project = catalog.CreateProject(new Techmap.Application.CreateProjectCommand(
                "ПР-V5", "Проект v5", legacyQuantity, Techmap.Domain.ProjectStatus.Draft));
            projectId = project.ProjectId;
            catalog.AddHarness(projectId, "Жгут А", 4);
            catalog.AddHarness(projectId, "Жгут Б", 8);
        }

        using (var connection = OpenIndependentConnection(databasePath))
        {
            DropReferenceSnapshotSchema(connection);
            using var command = connection.CreateCommand();
            command.CommandText =
                """
                DROP TABLE harness_documents;
                ALTER TABLE harnesses DROP COLUMN quantity;
                DELETE FROM schema_history WHERE version IN (6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16);
                PRAGMA user_version = 5;
                """;
            command.ExecuteNonQuery();
        }

        await using var lease = DataRootLease.Acquire(fixture.DataRoot);
        var migration = await new SqliteStorageMigrationService(lease).MigrateIfRequiredAsync(
            new Techmap.Application.StorageMigrationRequest(
                fixture.BackupRoot, "0.1.0-m1.15", SqliteStorage.CurrentSchemaVersion),
            TestContext.Current.CancellationToken);

        using var migrated = SqliteStorage.Open(fixture.DataRoot);
        var restored = new SqliteProjectCatalog(migrated).GetProject(projectId);
        Assert.True(migration.Migrated);
        Assert.Equal(expectedQuantity, restored.BatchQuantity);
        Assert.Equal([expectedQuantity, expectedQuantity],
            restored.Harnesses.Select(harness => harness.Quantity));
        Assert.All(restored.Harnesses, harness =>
            Assert.Equal(["e4", "drawing", "route"], harness.Documents.Select(document => document.Kind)));
        Assert.Equal(6, restored.Harnesses.SelectMany(harness => harness.Documents)
            .Select(document => document.DocumentId).Distinct().Count());
    }

    [Fact]
    public void Bootstrap_publishes_one_generation_with_schema_history_and_diagnostics()
    {
        using var fixture = StorageFixture.Create();
        const int busyTimeoutMilliseconds = 731;

        using var storage = SqliteStorage.Open(fixture.DataRoot, busyTimeoutMilliseconds);

        var layout = storage.Layout;
        Assert.Equal(Path.GetFullPath(fixture.DataRoot), layout.DataRootPath);
        Assert.Equal(
            Path.Combine(layout.DataRootPath, StorageGenerationLayout.CurrentPointerFileName),
            layout.CurrentPointerPath);
        Assert.Equal(
            Path.Combine(layout.DataRootPath, StorageGenerationLayout.GenerationsDirectoryName),
            layout.GenerationsPath);
        Assert.Equal(StorageGenerationLayout.InitialGenerationName, layout.GenerationName);
        Assert.Equal(
            Path.Combine(layout.GenerationsPath, layout.GenerationName),
            layout.GenerationPath);
        Assert.Equal(
            Path.Combine(layout.GenerationPath, StorageGenerationLayout.DatabaseFileName),
            layout.DatabasePath);
        Assert.Equal(
            Path.Combine(layout.GenerationPath, StorageGenerationLayout.ReadyMarkerFileName),
            layout.ReadyMarkerPath);
        Assert.Equal($"{layout.GenerationName}\n", File.ReadAllText(layout.CurrentPointerPath));
        Assert.Equal("ready\n", File.ReadAllText(layout.ReadyMarkerPath));
        Assert.Equal(
            new[] { layout.DatabasePath },
            Directory.GetFiles(layout.DataRootPath, StorageGenerationLayout.DatabaseFileName, SearchOption.AllDirectories));
        Assert.False(File.Exists(Path.Combine(layout.DataRootPath, StorageGenerationLayout.DatabaseFileName)));

        var history = storage.ExecuteRead(ReadSchemaHistory);
        Assert.Equal(Enumerable.Range(1, SqliteStorage.CurrentSchemaVersion), history.Select(row => row.Version));
        Assert.Equal(
            [
                "M1-03-initial-storage",
                "M1-04-projects-and-harnesses",
                "M1-05-attachments-and-pinned-data",
                "M1-06-project-command-journal",
                "M1-14-project-import-provenance",
                "M1-04R-harness-workspaces",
                "M2-01-versioned-reference-snapshots",
                "M2-03-reference-catalog-search",
                "E-01-harness-design-documents",
                "M2-05-component-template-library",
                "M2-06A-component-template-assets",
                "M2-06D-component-template-content-v2",
                "M2-08-component-template-content-v3",
                "M2-08-component-template-article-index-v2",
                "M3-01-project-component-snapshots",
                "M3-03-component-template-content-v4",
            ],
            history.Select(row => row.MigrationId));
        Assert.Equal(
            "06cd209eb54cb85cfbe7d0682917044b0dd15f1990c1963c2dac41544ec87fb8",
            history[0].ScriptSha256);
        foreach (var row in history)
        {
            Assert.Equal(32, Convert.FromHexString(row.ScriptSha256).Length);
            Assert.Equal(row.ScriptSha256.ToLowerInvariant(), row.ScriptSha256);
            Assert.Matches("^0\\.[1-9][0-9]*\\.[0-9]+-", row.AppVersion);
            Assert.True(DateTimeOffset.TryParseExact(
                row.AppliedUtc,
                "O",
                CultureInfo.InvariantCulture,
                DateTimeStyles.RoundtripKind,
                out _));
            Assert.False(string.IsNullOrWhiteSpace(row.Description));
        }
        Assert.Equal(SqliteStorage.CurrentSchemaVersion, ExecuteScalarInt32(storage, "PRAGMA user_version;"));

        Assert.Equal(SqliteStorage.CurrentSchemaVersion, storage.Diagnostics.SchemaVersion);
        Assert.Equal(
            storage.ExecuteInTransaction(unitOfWork =>
                ExecuteScalarString(unitOfWork, "SELECT sqlite_version();")),
            storage.Diagnostics.SqliteVersion);
        Assert.True(Version.TryParse(storage.Diagnostics.SqliteVersion, out _));
        Assert.True(storage.Diagnostics.ForeignKeysEnabled);
        Assert.Equal(busyTimeoutMilliseconds, storage.Diagnostics.BusyTimeoutMilliseconds);
        Assert.Equal("wal", storage.Diagnostics.JournalMode, ignoreCase: true);
        Assert.DoesNotContain(
            typeof(SqliteStorageDiagnostics).GetProperties(),
            property => property.Name.Contains("Path", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void Committed_data_survives_storage_close_and_reopen()
    {
        using var fixture = StorageFixture.Create();
        string databasePath;
        var projectId = Guid.NewGuid().ToString("D");

        using (var storage = SqliteStorage.Open(fixture.DataRoot))
        {
            databasePath = storage.Layout.DatabasePath;
            storage.ExecuteInTransaction(unitOfWork =>
            {
                using var insert = unitOfWork.CreateCommand(
                    """
                    INSERT INTO projects
                        (project_id, designation, project_increment, name, batch_quantity, status,
                         created_utc, updated_utc, revision)
                    VALUES
                        ($projectId, 'ПР-REOPEN', 1, $name, 1, 'draft', $now, $now, 0);
                    """);
                insert.Parameters.AddWithValue("$projectId", projectId);
                insert.Parameters.AddWithValue("$name", "survives-reopen");
                insert.Parameters.AddWithValue("$now", DateTimeOffset.UtcNow.ToString("O"));
                insert.ExecuteNonQuery();
            });
        }

        using var reopened = SqliteStorage.Open(fixture.DataRoot);
        Assert.Equal(databasePath, reopened.Layout.DatabasePath);
        Assert.Equal(
            "survives-reopen",
            reopened.ExecuteInTransaction(unitOfWork =>
            {
                using var command = unitOfWork.CreateCommand(
                    "SELECT name FROM projects WHERE project_id = $projectId;");
                command.Parameters.AddWithValue("$projectId", projectId);
                return Assert.IsType<string>(command.ExecuteScalar());
            }));
        Assert.Equal(
            Enumerable.Range(1, SqliteStorage.CurrentSchemaVersion),
            reopened.ExecuteRead(ReadSchemaHistory).Select(row => row.Version));
    }

    [Fact]
    public async Task Version_one_database_is_migrated_without_rewriting_its_history_row()
    {
        using var fixture = StorageFixture.Create();
        SchemaHistoryRow originalVersionOne;
        string databasePath;
        using (var storage = SqliteStorage.Open(fixture.DataRoot))
        {
            databasePath = storage.Layout.DatabasePath;
            originalVersionOne = storage.ExecuteRead(ReadSchemaHistory).Single(row => row.Version == 1);
        }

        using (var connection = OpenIndependentConnection(databasePath))
        {
            DropReferenceSnapshotSchema(connection);
            using var command = connection.CreateCommand();
            command.CommandText =
                """
                DROP TRIGGER prevent_project_version_delete;
                DROP TRIGGER prevent_project_version_update;
                DROP TRIGGER prevent_project_command_delete;
                DROP TRIGGER prevent_project_command_update;
                DROP TABLE project_versions;
                DROP TABLE project_commands;
                DROP TRIGGER prevent_project_import_delete;
                DROP TRIGGER prevent_project_import_update;
                DROP TABLE project_imports;
                DROP TABLE harness_documents;
                ALTER TABLE projects DROP COLUMN revision;
                DROP TRIGGER prevent_pinned_characteristic_update;
                DROP TABLE pinned_characteristics;
                DROP TABLE project_attachments;
                DROP TABLE attachment_blobs;
                DROP TRIGGER enforce_project_harness_limit;
                DROP TABLE harnesses;
                DROP TABLE projects;
                DROP TABLE project_counter;
                DELETE FROM schema_history WHERE version IN (2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16);
                PRAGMA user_version = 1;
                """;
            command.ExecuteNonQuery();
        }

        var sourceHash = HashFile(databasePath);
        await using var lease = DataRootLease.Acquire(fixture.DataRoot);
        var migration = await new SqliteStorageMigrationService(lease).MigrateIfRequiredAsync(
            new Techmap.Application.StorageMigrationRequest(
                fixture.BackupRoot, "0.1.0-m1.12", SqliteStorage.CurrentSchemaVersion),
            TestContext.Current.CancellationToken);
        using var migrated = SqliteStorage.Open(fixture.DataRoot);
        var history = migrated.ExecuteRead(ReadSchemaHistory);

        Assert.True(migration.Migrated);
        Assert.NotEqual(databasePath, migrated.Layout.DatabasePath);
        Assert.Equal(sourceHash, HashFile(databasePath));
        Assert.Equal(SqliteStorage.CurrentSchemaVersion, migrated.Diagnostics.SchemaVersion);
        Assert.Equal(originalVersionOne, history[0]);
        Assert.Equal(2, history[1].Version);
        Assert.Equal("M1-04-projects-and-harnesses", history[1].MigrationId);
        Assert.Equal(3, history[2].Version);
        Assert.Equal("M1-05-attachments-and-pinned-data", history[2].MigrationId);
        Assert.Equal(4, history[3].Version);
        Assert.Equal("M1-06-project-command-journal", history[3].MigrationId);
        Assert.Equal(5, history[4].Version);
        Assert.Equal("M1-14-project-import-provenance", history[4].MigrationId);
        Assert.Equal(6, history[5].Version);
        Assert.Equal("M1-04R-harness-workspaces", history[5].MigrationId);
        Assert.Equal(7, history[6].Version);
        Assert.Equal("M2-01-versioned-reference-snapshots", history[6].MigrationId);
        Assert.Equal(8, history[7].Version);
        Assert.Equal("M2-03-reference-catalog-search", history[7].MigrationId);
        Assert.Equal(
            1,
            migrated.ExecuteRead(unitOfWork => ExecuteScalarInt32(
                unitOfWork,
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='projects';")));
    }

    [Fact]
    public async Task Version_two_database_is_migrated_without_rewriting_existing_history()
    {
        using var fixture = StorageFixture.Create();
        IReadOnlyList<SchemaHistoryRow> originalHistory;
        string databasePath;
        using (var storage = SqliteStorage.Open(fixture.DataRoot))
        {
            databasePath = storage.Layout.DatabasePath;
            originalHistory = storage.ExecuteRead(ReadSchemaHistory).Take(2).ToArray();
        }

        using (var connection = OpenIndependentConnection(databasePath))
        {
            DropReferenceSnapshotSchema(connection);
            using var command = connection.CreateCommand();
            command.CommandText =
                """
                DROP TRIGGER prevent_project_version_delete;
                DROP TRIGGER prevent_project_version_update;
                DROP TRIGGER prevent_project_command_delete;
                DROP TRIGGER prevent_project_command_update;
                DROP TABLE project_versions;
                DROP TABLE project_commands;
                DROP TRIGGER prevent_project_import_delete;
                DROP TRIGGER prevent_project_import_update;
                DROP TABLE project_imports;
                DROP TABLE harness_documents;
                ALTER TABLE harnesses DROP COLUMN quantity;
                ALTER TABLE projects DROP COLUMN revision;
                DROP TRIGGER prevent_pinned_characteristic_update;
                DROP TABLE pinned_characteristics;
                DROP TABLE project_attachments;
                DROP TABLE attachment_blobs;
                DELETE FROM schema_history WHERE version IN (3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16);
                PRAGMA user_version = 2;
                """;
            command.ExecuteNonQuery();
        }

        await using var lease = DataRootLease.Acquire(fixture.DataRoot);
        var migration = await new SqliteStorageMigrationService(lease).MigrateIfRequiredAsync(
            new Techmap.Application.StorageMigrationRequest(
                fixture.BackupRoot, "0.1.0-m1.12", SqliteStorage.CurrentSchemaVersion),
            TestContext.Current.CancellationToken);
        using var migrated = SqliteStorage.Open(fixture.DataRoot);
        var history = migrated.ExecuteRead(ReadSchemaHistory);

        Assert.True(migration.Migrated);
        Assert.NotEqual(databasePath, migrated.Layout.DatabasePath);
        Assert.Equal(SqliteStorage.CurrentSchemaVersion, migrated.Diagnostics.SchemaVersion);
        Assert.Equal(originalHistory, history.Take(2));
        Assert.Equal(3, history[2].Version);
        Assert.Equal("M1-05-attachments-and-pinned-data", history[2].MigrationId);
        Assert.Equal(4, history[3].Version);
        Assert.Equal("M1-06-project-command-journal", history[3].MigrationId);
        Assert.Equal(5, history[4].Version);
        Assert.Equal("M1-14-project-import-provenance", history[4].MigrationId);
        Assert.Equal(6, history[5].Version);
        Assert.Equal("M1-04R-harness-workspaces", history[5].MigrationId);
        Assert.Equal(7, history[6].Version);
        Assert.Equal("M2-01-versioned-reference-snapshots", history[6].MigrationId);
        Assert.Equal(8, history[7].Version);
        Assert.Equal("M2-03-reference-catalog-search", history[7].MigrationId);
        Assert.Equal(
            3,
            migrated.ExecuteRead(unitOfWork => ExecuteScalarInt32(
                unitOfWork,
                """
                SELECT COUNT(*) FROM sqlite_master
                WHERE type = 'table'
                  AND name IN ('attachment_blobs', 'project_attachments', 'pinned_characteristics');
                """)));
    }

    [Fact]
    public async Task Version_three_project_data_is_preserved_and_receives_revision_zero()
    {
        using var fixture = StorageFixture.Create();
        Guid projectId;
        Guid harnessId;
        Guid attachmentId;
        Guid snapshotId;
        var blobBytes = Encoding.UTF8.GetBytes("M1-12 referenced attachment");
        var hash = Convert.ToHexStringLower(SHA256.HashData(blobBytes));
        string databasePath;
        using (var storage = SqliteStorage.Open(fixture.DataRoot))
        {
            databasePath = storage.Layout.DatabasePath;
            projectId = Guid.NewGuid();
            harnessId = Guid.NewGuid();
            attachmentId = Guid.NewGuid();
            snapshotId = Guid.NewGuid();
            storage.ExecuteInTransaction(unitOfWork =>
            {
                var now = DateTimeOffset.UtcNow.ToString("O", CultureInfo.InvariantCulture);
                const string payload = "{}";
                var payloadHash = Convert.ToHexStringLower(
                    SHA256.HashData(Encoding.UTF8.GetBytes(payload)));
                using var insert = unitOfWork.CreateCommand(
                    """
                    INSERT INTO projects VALUES ($projectId, 'ПР-V3', 1, 'Проект v3', 2, 'draft', $now, $now, 0);
                    INSERT INTO harnesses
                        (harness_id, project_id, designation, quantity, sort_order, created_utc, updated_utc)
                    VALUES ($harnessId, $projectId, 'ЖГУТ-V3', 2, 0, $now, $now);
                    INSERT INTO attachment_blobs VALUES ($hash, 0, $now);
                    INSERT INTO project_attachments VALUES ($attachmentId, $projectId, $hash, 'v3.txt', 'text/plain', 'test', $now);
                    INSERT INTO pinned_characteristics VALUES (
                        $snapshotId, $projectId, 'mock', 'terminal:T-V3', 'v3',
                        'Длина зачистки', '4', 'мм', $payload, $payloadHash, $now);
                    """);
                insert.Parameters.AddWithValue("$projectId", projectId.ToString("D"));
                insert.Parameters.AddWithValue("$harnessId", harnessId.ToString("D"));
                insert.Parameters.AddWithValue("$attachmentId", attachmentId.ToString("D"));
                insert.Parameters.AddWithValue("$snapshotId", snapshotId.ToString("D"));
                insert.Parameters.AddWithValue("$hash", hash);
                insert.Parameters.AddWithValue("$payload", payload);
                insert.Parameters.AddWithValue("$payloadHash", payloadHash);
                insert.Parameters.AddWithValue("$now", now);
                insert.ExecuteNonQuery();
            });
        }

        using (var connection = OpenIndependentConnection(databasePath))
        {
            DropReferenceSnapshotSchema(connection);
            using var command = connection.CreateCommand();
            command.CommandText =
                """
                DROP TRIGGER prevent_project_version_delete;
                DROP TRIGGER prevent_project_version_update;
                DROP TRIGGER prevent_project_command_delete;
                DROP TRIGGER prevent_project_command_update;
                DROP TABLE project_versions;
                DROP TABLE project_commands;
                DROP TRIGGER prevent_project_import_delete;
                DROP TRIGGER prevent_project_import_update;
                DROP TABLE project_imports;
                DROP TABLE harness_documents;
                ALTER TABLE harnesses DROP COLUMN quantity;
                ALTER TABLE projects DROP COLUMN revision;
                DELETE FROM schema_history WHERE version IN (4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16);
                PRAGMA user_version = 3;
                """;
            command.ExecuteNonQuery();
        }

        var blobPath = Path.Combine(fixture.DataRoot, "attachments", "blobs", hash[..2], hash);
        Directory.CreateDirectory(Path.GetDirectoryName(blobPath)!);
        await File.WriteAllBytesAsync(blobPath, blobBytes, TestContext.Current.CancellationToken);
        using (var connection = OpenIndependentConnection(databasePath))
        {
            using var updateSize = connection.CreateCommand();
            updateSize.CommandText = "UPDATE attachment_blobs SET size_bytes = $size WHERE content_sha256 = $hash;";
            updateSize.Parameters.AddWithValue("$size", blobBytes.Length);
            updateSize.Parameters.AddWithValue("$hash", hash);
            updateSize.ExecuteNonQuery();
        }

        await using var lease = DataRootLease.Acquire(fixture.DataRoot);
        var migration = await new SqliteStorageMigrationService(lease).MigrateIfRequiredAsync(
            new Techmap.Application.StorageMigrationRequest(
                fixture.BackupRoot, "0.1.0-m1.12", SqliteStorage.CurrentSchemaVersion),
            TestContext.Current.CancellationToken);
        using var migrated = SqliteStorage.Open(fixture.DataRoot);
        Assert.True(migration.Migrated);
        Assert.NotEqual(databasePath, migrated.Layout.DatabasePath);
        Assert.Equal(Enumerable.Range(1, SqliteStorage.CurrentSchemaVersion),
            migrated.ExecuteRead(ReadSchemaHistory).Select(row => row.Version));
        var catalog = new SqliteProjectCatalog(migrated);
        var project = catalog.GetProject(new Techmap.Domain.ProjectIdentity(projectId));
        Assert.Equal(0, project.Revision);
        Assert.Equal(harnessId, Assert.Single(project.Harnesses).HarnessId.Value);
        var blob = migrated.ExecuteRead(unitOfWork =>
            ExecuteScalarString(unitOfWork,
                $"SELECT content_sha256 FROM project_attachments WHERE attachment_id = '{attachmentId:D}';"));
        Assert.Equal(hash, blob);
        var pinned = migrated.ExecuteRead(unitOfWork =>
            ExecuteScalarString(unitOfWork,
                $"SELECT snapshot_id FROM pinned_characteristics WHERE project_id = '{projectId:D}';"));
        Assert.Equal(snapshotId.ToString("D"), pinned);
        Assert.Empty(catalog.ListVersions(project.ProjectId));
        await Task.CompletedTask;
    }

    [Fact]
    public async Task Version_four_database_receives_import_provenance_without_rewriting_history()
    {
        using var fixture = StorageFixture.Create();
        IReadOnlyList<SchemaHistoryRow> originalHistory;
        string databasePath;
        using (var storage = SqliteStorage.Open(fixture.DataRoot))
        {
            databasePath = storage.Layout.DatabasePath;
            originalHistory = storage.ExecuteRead(ReadSchemaHistory).Take(4).ToArray();
        }

        using (var connection = OpenIndependentConnection(databasePath))
        {
            DropReferenceSnapshotSchema(connection);
            using var command = connection.CreateCommand();
            command.CommandText =
                """
                DROP TRIGGER prevent_project_import_delete;
                DROP TRIGGER prevent_project_import_update;
                DROP TABLE project_imports;
                DROP TABLE harness_documents;
                ALTER TABLE harnesses DROP COLUMN quantity;
                DELETE FROM schema_history WHERE version IN (5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16);
                PRAGMA user_version = 4;
                """;
            command.ExecuteNonQuery();
        }

        await using var lease = DataRootLease.Acquire(fixture.DataRoot);
        var migration = await new SqliteStorageMigrationService(lease).MigrateIfRequiredAsync(
            new Techmap.Application.StorageMigrationRequest(
                fixture.BackupRoot, "0.1.0-m1.14", SqliteStorage.CurrentSchemaVersion),
            TestContext.Current.CancellationToken);
        using var migrated = SqliteStorage.Open(fixture.DataRoot);
        var history = migrated.ExecuteRead(ReadSchemaHistory);

        Assert.True(migration.Migrated);
        Assert.NotEqual(databasePath, migrated.Layout.DatabasePath);
        Assert.Equal(originalHistory, history.Take(4));
        Assert.Equal(5, history[4].Version);
        Assert.Equal("M1-14-project-import-provenance", history[4].MigrationId);
        Assert.Equal(6, history[5].Version);
        Assert.Equal("M1-04R-harness-workspaces", history[5].MigrationId);
        Assert.Equal(7, history[6].Version);
        Assert.Equal("M2-01-versioned-reference-snapshots", history[6].MigrationId);
        Assert.Equal(8, history[7].Version);
        Assert.Equal("M2-03-reference-catalog-search", history[7].MigrationId);
        Assert.Equal(
            1,
            migrated.ExecuteRead(unitOfWork => ExecuteScalarInt32(
                unitOfWork,
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='project_imports';")));
    }

    [Fact]
    public async Task Version_six_database_receives_reference_snapshot_schema_without_rewriting_history()
    {
        using var fixture = StorageFixture.Create();
        IReadOnlyList<SchemaHistoryRow> originalHistory;
        string databasePath;
        using (var storage = SqliteStorage.Open(fixture.DataRoot))
        {
            databasePath = storage.Layout.DatabasePath;
            originalHistory = storage.ExecuteRead(ReadSchemaHistory).Take(6).ToArray();
        }

        using (var connection = OpenIndependentConnection(databasePath))
        {
            DropReferenceSnapshotSchema(connection);
            using var command = connection.CreateCommand();
            command.CommandText =
                """
                DELETE FROM schema_history WHERE version IN (7, 8, 9, 10, 11, 12, 13, 14, 15, 16);
                PRAGMA user_version = 6;
                """;
            command.ExecuteNonQuery();
        }

        var sourceHash = HashFile(databasePath);
        await using var lease = DataRootLease.Acquire(fixture.DataRoot);
        var migration = await new SqliteStorageMigrationService(lease).MigrateIfRequiredAsync(
            new Techmap.Application.StorageMigrationRequest(
                fixture.BackupRoot, "0.2.0-m2.01", SqliteStorage.CurrentSchemaVersion),
            TestContext.Current.CancellationToken);
        using var migrated = SqliteStorage.Open(fixture.DataRoot);
        var history = migrated.ExecuteRead(ReadSchemaHistory);

        Assert.True(migration.Migrated);
        Assert.Equal(6, migration.SourceSchemaVersion);
        Assert.Equal(SqliteStorage.CurrentSchemaVersion, migration.TargetSchemaVersion);
        Assert.NotEqual(databasePath, migrated.Layout.DatabasePath);
        Assert.Equal(sourceHash, HashFile(databasePath));
        Assert.Equal(originalHistory, history.Take(6));
        Assert.Equal(7, history[6].Version);
        Assert.Equal("M2-01-versioned-reference-snapshots", history[6].MigrationId);
        Assert.Equal(8, history[7].Version);
        Assert.Equal("M2-03-reference-catalog-search", history[7].MigrationId);
        Assert.Equal(
            [
                "reference_catalog_saved_filters",
                "reference_search_fields",
                "reference_search_fts",
                "reference_search_fts_config",
                "reference_search_fts_data",
                "reference_search_fts_docsize",
                "reference_search_fts_idx",
                "reference_search_projections",
                "reference_search_records",
                "reference_snapshot_diagnostics",
                "reference_snapshot_records",
                "reference_snapshots",
                "reference_source_heads",
                "reference_sources",
            ],
            migrated.ExecuteRead(unitOfWork => ReadNames(
                unitOfWork,
                "SELECT name FROM sqlite_schema WHERE type = 'table' AND name LIKE 'reference_%' ORDER BY name;")));
        Assert.Equal(0, ExecuteScalarInt32(migrated, "SELECT COUNT(*) FROM reference_sources;"));
    }

    [Fact]
    public void Reference_snapshot_schema_enforces_draft_validated_published_lifecycle()
    {
        using var fixture = StorageFixture.Create();
        using var storage = SqliteStorage.Open(fixture.DataRoot);
        var sourceId = Guid.NewGuid().ToString("D");
        var otherSourceId = Guid.NewGuid().ToString("D");
        var firstSnapshotId = Guid.NewGuid().ToString("D");
        var secondSnapshotId = Guid.NewGuid().ToString("D");
        var otherSnapshotId = Guid.NewGuid().ToString("D");
        var sourceHash = new string('1', 64);
        var firstCanonicalHash = new string('2', 64);
        var secondCanonicalHash = new string('3', 64);
        var otherCanonicalHash = new string('4', 64);
        const string captured = "2026-09-12T12:00:00.0000000+00:00";
        const string validated = "2026-09-12T12:01:00.0000000+00:00";
        const string published = "2026-09-12T12:02:00.0000000+00:00";

        storage.ExecuteInTransaction(unitOfWork =>
        {
            using var command = unitOfWork.CreateCommand(
                """
                INSERT INTO reference_sources
                    (source_id, source_key, source_kind, display_name, created_utc)
                VALUES
                    ($sourceId, 'technology-db', 'xlsx', 'База технологии', $captured),
                    ($otherSourceId, 'connector-db', 'xlsx', 'База соединителей', $captured);

                INSERT INTO reference_snapshots
                    (snapshot_id, source_id, snapshot_sequence, contract_version, source_version,
                     source_content_sha256, snapshot_metadata_sha256, canonical_content_sha256, provenance_json,
                     lifecycle_status, captured_utc, validated_utc, published_utc)
                VALUES
                    ($firstSnapshotId, $sourceId, 1, 1, 'rev-1', $sourceHash, $sourceHash, NULL,
                     '{"kind":"xlsx"}', 'draft', $captured, NULL, NULL),
                    ($secondSnapshotId, $sourceId, 2, 1, 'rev-2', $sourceHash, $sourceHash, NULL,
                     '{"kind":"xlsx"}', 'draft', $captured, NULL, NULL),
                    ($otherSnapshotId, $otherSourceId, 1, 1, 'rev-1', $sourceHash, $sourceHash, NULL,
                     '{"kind":"xlsx"}', 'draft', $captured, NULL, NULL);

                INSERT INTO reference_snapshot_records
                    (snapshot_id, entity_type, source_record_key, source_location,
                     canonical_payload, payload_sha256)
                VALUES
                    ($firstSnapshotId, 'terminal', 'T-001', 'БД.ТЕР!2', '{}', $sourceHash);

                INSERT INTO reference_snapshot_diagnostics
                    (snapshot_id, diagnostic_index, severity, code, entity_type,
                     source_record_key, source_location, field_name, message, diagnostic_sha256)
                VALUES
                    ($firstSnapshotId, 0, 'error', 'required_value_missing', 'terminal',
                     'T-001', 'БД.ТЕР!2', 'stripLength', 'Не указана длина зачистки.', $sourceHash);
                """);
            command.Parameters.AddWithValue("$sourceId", sourceId);
            command.Parameters.AddWithValue("$otherSourceId", otherSourceId);
            command.Parameters.AddWithValue("$firstSnapshotId", firstSnapshotId);
            command.Parameters.AddWithValue("$secondSnapshotId", secondSnapshotId);
            command.Parameters.AddWithValue("$otherSnapshotId", otherSnapshotId);
            command.Parameters.AddWithValue("$sourceHash", sourceHash);
            command.Parameters.AddWithValue("$captured", captured);
            command.ExecuteNonQuery();
        });

        AssertSqliteConstraint(storage,
            $"INSERT INTO reference_source_heads VALUES ('{sourceId}', '{firstSnapshotId}');");
        AssertSqliteConstraint(storage,
            $"UPDATE reference_snapshots SET lifecycle_status = 'validated', " +
            $"canonical_content_sha256 = '{firstCanonicalHash}', validated_utc = '{validated}' " +
            $"WHERE snapshot_id = '{firstSnapshotId}';");

        storage.ExecuteInTransaction(unitOfWork =>
        {
            using var command = unitOfWork.CreateCommand(
                """
                DELETE FROM reference_snapshot_diagnostics
                WHERE snapshot_id = $snapshotId AND diagnostic_index = 0;
                UPDATE reference_snapshot_records
                SET canonical_payload = '{"stripLength":4}', payload_sha256 = $canonicalHash
                WHERE snapshot_id = $snapshotId;
                UPDATE reference_snapshots
                SET lifecycle_status = 'validated', canonical_content_sha256 = $canonicalHash,
                    validated_utc = $validated
                WHERE snapshot_id = $snapshotId;
                """);
            command.Parameters.AddWithValue("$snapshotId", firstSnapshotId);
            command.Parameters.AddWithValue("$canonicalHash", firstCanonicalHash);
            command.Parameters.AddWithValue("$validated", validated);
            command.ExecuteNonQuery();
        });

        AssertSqliteConstraint(storage,
            $"UPDATE reference_snapshot_records SET canonical_payload = '{{}}' " +
            $"WHERE snapshot_id = '{firstSnapshotId}';");
        AssertSqliteConstraint(storage,
            $"INSERT INTO reference_snapshot_diagnostics " +
            $"(snapshot_id, diagnostic_index, severity, code, message, diagnostic_sha256) " +
            $"VALUES ('{firstSnapshotId}', 1, 'warning', 'late', 'late', '{sourceHash}');");
        AssertSqliteConstraint(storage,
            $"UPDATE reference_snapshots SET lifecycle_status = 'published', " +
            $"published_utc = '{published}', source_version = 'changed' " +
            $"WHERE snapshot_id = '{firstSnapshotId}';");

        storage.ExecuteInTransaction(unitOfWork => ExecuteNonQuery(
            unitOfWork,
            $"UPDATE reference_snapshots SET lifecycle_status = 'published', " +
            $"published_utc = '{published}' WHERE snapshot_id = '{firstSnapshotId}';"));
        storage.ExecuteInTransaction(unitOfWork => ExecuteNonQuery(
            unitOfWork,
            $"INSERT INTO reference_source_heads VALUES ('{sourceId}', '{firstSnapshotId}');"));
        Assert.Equal(
            firstSnapshotId,
            ExecuteScalarString(storage,
                $"SELECT snapshot_id FROM reference_source_heads WHERE source_id = '{sourceId}';"));

        PublishSnapshot(storage, secondSnapshotId, secondCanonicalHash, validated, published);
        storage.ExecuteInTransaction(unitOfWork => ExecuteNonQuery(
            unitOfWork,
            $"UPDATE reference_source_heads SET snapshot_id = '{secondSnapshotId}' " +
            $"WHERE source_id = '{sourceId}';"));
        Assert.Equal(
            secondSnapshotId,
            ExecuteScalarString(storage,
                $"SELECT snapshot_id FROM reference_source_heads WHERE source_id = '{sourceId}';"));

        PublishSnapshot(storage, otherSnapshotId, otherCanonicalHash, validated, published);
        AssertSqliteConstraint(storage,
            $"UPDATE reference_source_heads SET snapshot_id = '{otherSnapshotId}' " +
            $"WHERE source_id = '{sourceId}';");
        AssertSqliteConstraint(storage,
            $"DELETE FROM reference_snapshots WHERE snapshot_id = '{firstSnapshotId}';");
        Assert.Equal(3, ExecuteScalarInt32(storage, "SELECT COUNT(*) FROM reference_snapshots;"));
    }

    [Fact]
    public void Exception_rolls_back_every_write_in_the_unit_of_work()
    {
        using var fixture = StorageFixture.Create();
        using var storage = SqliteStorage.Open(fixture.DataRoot);
        storage.ExecuteInTransaction(unitOfWork =>
            ExecuteNonQuery(
                unitOfWork,
                "CREATE TABLE atomic_items (id INTEGER PRIMARY KEY, value TEXT NOT NULL) STRICT;"));
        var expected = new InvalidOperationException("forced integration-test failure");

        var actual = Assert.Throws<InvalidOperationException>(() =>
            storage.ExecuteInTransaction(unitOfWork =>
            {
                unitOfWork.Context.Database.ExecuteSqlRaw(
                    "INSERT INTO atomic_items VALUES (1, 'first');");
                ExecuteNonQuery(unitOfWork, "INSERT INTO atomic_items VALUES (2, 'second');");
                throw expected;
            }));

        Assert.Same(expected, actual);
        Assert.Equal(0, ExecuteScalarInt32(storage, "SELECT COUNT(*) FROM atomic_items;"));
    }

    [Fact]
    public async Task Async_exception_rolls_back_and_invalidates_the_unit_of_work()
    {
        using var fixture = StorageFixture.Create();
        var storage = SqliteStorage.Open(fixture.DataRoot);
        storage.ExecuteInTransaction(unitOfWork =>
            ExecuteNonQuery(
                unitOfWork,
                "CREATE TABLE async_items (id INTEGER PRIMARY KEY, value TEXT NOT NULL) STRICT;"));
        SqliteUnitOfWork? capturedUnitOfWork = null;
        var expected = new InvalidOperationException("forced async integration-test failure");

        var actual = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            storage.ExecuteInTransactionAsync(
                async (unitOfWork, cancellationToken) =>
                {
                    capturedUnitOfWork = unitOfWork;
                    await using var command = unitOfWork.CreateCommand(
                        "INSERT INTO async_items VALUES (1, 'must-roll-back');");
                    await command.ExecuteNonQueryAsync(cancellationToken);
                    throw expected;
                },
                TestContext.Current.CancellationToken));

        Assert.Same(expected, actual);
        Assert.Equal(0, ExecuteScalarInt32(storage, "SELECT COUNT(*) FROM async_items;"));
        Assert.Throws<ObjectDisposedException>(() => capturedUnitOfWork!.CreateCommand("SELECT 1;"));

        await storage.DisposeAsync();
        await Assert.ThrowsAsync<ObjectDisposedException>(() =>
            storage.ExecuteInTransactionAsync(
                (_, _) => Task.CompletedTask,
                TestContext.Current.CancellationToken));
    }

    [Fact]
    public void Foreign_key_enforcement_rejects_an_orphan_and_rolls_back_the_transaction()
    {
        using var fixture = StorageFixture.Create();
        using var storage = SqliteStorage.Open(fixture.DataRoot);
        storage.ExecuteInTransaction(unitOfWork =>
        {
            ExecuteNonQuery(unitOfWork, "CREATE TABLE parents (id INTEGER PRIMARY KEY) STRICT;");
            ExecuteNonQuery(
                unitOfWork,
                "CREATE TABLE children (id INTEGER PRIMARY KEY, parent_id INTEGER NOT NULL REFERENCES parents(id)) STRICT;");
        });

        var error = Assert.Throws<SqliteException>(() =>
            storage.ExecuteInTransaction(unitOfWork =>
                ExecuteNonQuery(unitOfWork, "INSERT INTO children VALUES (1, 404);")));

        Assert.Equal(19, error.SqliteErrorCode);
        Assert.Equal(0, ExecuteScalarInt32(storage, "SELECT COUNT(*) FROM children;"));
    }

    [Fact]
    public void Failed_independent_writer_causes_the_first_half_of_the_command_to_roll_back()
    {
        using var fixture = StorageFixture.Create();
        using var storage = SqliteStorage.Open(fixture.DataRoot);
        storage.ExecuteInTransaction(unitOfWork =>
            ExecuteNonQuery(
                unitOfWork,
                "CREATE TABLE writer_items (id INTEGER PRIMARY KEY, source TEXT NOT NULL) STRICT;"));

        var error = Assert.Throws<SqliteException>(() =>
            storage.ExecuteInTransaction(unitOfWork =>
            {
                ExecuteNonQuery(unitOfWork, "INSERT INTO writer_items VALUES (1, 'first-half');");
                using var competingConnection = OpenIndependentConnection(storage.Layout.DatabasePath);
                using var competingCommand = competingConnection.CreateCommand();
                competingCommand.CommandTimeout = 1;
                competingCommand.CommandText = "INSERT INTO writer_items VALUES (2, 'second-writer');";
                competingCommand.ExecuteNonQuery();
            }));

        Assert.Equal(5, error.SqliteErrorCode);
        Assert.Equal(0, ExecuteScalarInt32(storage, "SELECT COUNT(*) FROM writer_items;"));
    }

    [Fact]
    public void External_writer_is_bounded_by_the_configured_busy_timeout()
    {
        using var fixture = StorageFixture.Create();
        const int busyTimeoutMilliseconds = 1_000;
        using var storage = SqliteStorage.Open(fixture.DataRoot, busyTimeoutMilliseconds);
        storage.ExecuteInTransaction(unitOfWork =>
            ExecuteNonQuery(
                unitOfWork,
                "CREATE TABLE busy_items (id INTEGER PRIMARY KEY, source TEXT NOT NULL) STRICT;"));
        using var holder = OpenIndependentConnection(storage.Layout.DatabasePath);
        using var heldTransaction = holder.BeginTransaction(deferred: false);
        using (var command = holder.CreateCommand())
        {
            command.Transaction = heldTransaction;
            command.CommandText = "INSERT INTO busy_items VALUES (1, 'lock-holder');";
            command.ExecuteNonQuery();
        }

        var callbackStarted = false;
        var stopwatch = Stopwatch.StartNew();
        var error = Assert.Throws<SqliteException>(() =>
            storage.ExecuteInTransaction(_ => callbackStarted = true));
        stopwatch.Stop();

        Assert.Equal(5, error.SqliteErrorCode);
        Assert.False(callbackStarted);
        Assert.InRange(
            stopwatch.Elapsed,
            TimeSpan.FromMilliseconds(700),
            TimeSpan.FromSeconds(3));
        heldTransaction.Rollback();
        Assert.Equal(0, ExecuteScalarInt32(storage, "SELECT COUNT(*) FROM busy_items;"));
    }

    [Fact]
    public void Every_transaction_uses_a_new_connection_with_the_required_pragmas()
    {
        using var fixture = StorageFixture.Create();
        const int busyTimeoutMilliseconds = 913;
        using var storage = SqliteStorage.Open(fixture.DataRoot, busyTimeoutMilliseconds);

        var first = storage.ExecuteInTransaction(ReadConnectionSettings);
        var second = storage.ExecuteInTransaction(ReadConnectionSettings);

        Assert.NotSame(first.Connection, second.Connection);
        AssertConnectionSettings(first, busyTimeoutMilliseconds);
        AssertConnectionSettings(second, busyTimeoutMilliseconds);
    }

    [Fact]
    public void Nested_unit_of_work_is_rejected_before_waiting_for_the_writer_gate()
    {
        using var fixture = StorageFixture.Create();
        using var storage = SqliteStorage.Open(fixture.DataRoot);

        storage.ExecuteInTransaction(_ =>
        {
            var error = Assert.Throws<InvalidOperationException>(() =>
                storage.ExecuteInTransaction(_ => { }));
            Assert.Contains("nested", error.Message, StringComparison.OrdinalIgnoreCase);
        });
    }

    [Fact]
    public void Unit_of_work_connection_and_transaction_cannot_be_reused_after_callback()
    {
        using var fixture = StorageFixture.Create();
        var storage = SqliteStorage.Open(fixture.DataRoot);
        SqliteUnitOfWork? capturedUnitOfWork = null;
        SqliteConnection? capturedConnection = null;
        SqliteTransaction? capturedTransaction = null;
        storage.ExecuteInTransaction(unitOfWork =>
        {
            capturedUnitOfWork = unitOfWork;
            capturedConnection = unitOfWork.Connection;
            capturedTransaction = unitOfWork.Transaction;
        });

        Assert.Throws<ObjectDisposedException>(() => capturedUnitOfWork!.Connection);
        Assert.Throws<ObjectDisposedException>(() => capturedUnitOfWork!.Transaction);
        Assert.Throws<ObjectDisposedException>(() => capturedUnitOfWork!.Context);
        Assert.Throws<ObjectDisposedException>(() => capturedUnitOfWork!.CreateCommand("SELECT 1;"));
        Assert.Equal(System.Data.ConnectionState.Closed, capturedConnection!.State);
        Assert.ThrowsAny<InvalidOperationException>(() => capturedTransaction!.Commit());

        var generationPath = storage.Layout.GenerationPath;
        var movedPath = $"{generationPath}-moved";
        storage.Dispose();
        Assert.Throws<ObjectDisposedException>(() => storage.ExecuteInTransaction(_ => { }));

        Directory.Move(generationPath, movedPath);
        Assert.True(Directory.Exists(movedPath));
        Directory.Move(movedPath, generationPath);
    }

    [Fact]
    public void Existing_current_pointer_with_missing_database_fails_without_recreating_it()
    {
        using var fixture = StorageFixture.Create();
        string databasePath;
        using (var storage = SqliteStorage.Open(fixture.DataRoot))
        {
            databasePath = storage.Layout.DatabasePath;
        }

        File.Delete(databasePath);

        Assert.Throws<InvalidDataException>(() => SqliteStorage.Open(fixture.DataRoot));
        Assert.False(File.Exists(databasePath));
    }

    [Theory]
    [InlineData("../generation-00000001")]
    [InlineData("generation-00000001/..")]
    [InlineData(" generation-00000001")]
    [InlineData("generation-00000001 ")]
    [InlineData("generation-00000001\nsecond-generation")]
    public void Current_pointer_rejects_noncanonical_or_traversing_generation_names(string pointer)
    {
        using var fixture = StorageFixture.Create();
        Directory.CreateDirectory(fixture.DataRoot);
        Directory.CreateDirectory(Path.Combine(
            fixture.DataRoot,
            StorageGenerationLayout.GenerationsDirectoryName));
        var currentPath = Path.Combine(
            fixture.DataRoot,
            StorageGenerationLayout.CurrentPointerFileName);
        File.WriteAllText(currentPath, pointer);

        Assert.Throws<InvalidDataException>(() => SqliteStorage.Open(fixture.DataRoot));
        Assert.Empty(Directory.GetFiles(
            fixture.DataRoot,
            StorageGenerationLayout.DatabaseFileName,
            SearchOption.AllDirectories));
    }

    private static IReadOnlyList<SchemaHistoryRow> ReadSchemaHistory(SqliteUnitOfWork unitOfWork)
    {
        using var command = unitOfWork.CreateCommand(
            """
            SELECT version, migration_id, script_sha256, app_version, applied_utc, description
            FROM schema_history
            ORDER BY version;
            """);
        using var reader = command.ExecuteReader();
        var rows = new List<SchemaHistoryRow>();
        while (reader.Read())
        {
            rows.Add(new SchemaHistoryRow(
                reader.GetInt32(0),
                reader.GetString(1),
                reader.GetString(2),
                reader.GetString(3),
                reader.GetString(4),
                reader.GetString(5)));
        }

        return rows;
    }

    private static ConnectionSettings ReadConnectionSettings(SqliteUnitOfWork unitOfWork) =>
        new(
            unitOfWork.Connection,
            ExecuteScalarInt32(unitOfWork, "PRAGMA foreign_keys;"),
            ExecuteScalarInt32(unitOfWork, "PRAGMA busy_timeout;"),
            ExecuteScalarInt32(unitOfWork, "PRAGMA synchronous;"),
            ExecuteScalarString(unitOfWork, "PRAGMA journal_mode;"));

    private static void AssertConnectionSettings(
        ConnectionSettings settings,
        int busyTimeoutMilliseconds)
    {
        Assert.Equal(1, settings.ForeignKeys);
        Assert.Equal(busyTimeoutMilliseconds, settings.BusyTimeoutMilliseconds);
        Assert.Equal(2, settings.Synchronous);
        Assert.Equal("wal", settings.JournalMode, ignoreCase: true);
    }

    private static int ExecuteScalarInt32(SqliteStorage storage, string commandText) =>
        storage.ExecuteInTransaction(unitOfWork => ExecuteScalarInt32(unitOfWork, commandText));

    private static int ExecuteScalarInt32(SqliteUnitOfWork unitOfWork, string commandText)
    {
        using var command = unitOfWork.CreateCommand(commandText);
        return Convert.ToInt32(command.ExecuteScalar(), CultureInfo.InvariantCulture);
    }

    private static string ExecuteScalarString(SqliteUnitOfWork unitOfWork, string commandText)
    {
        using var command = unitOfWork.CreateCommand(commandText);
        return Convert.ToString(command.ExecuteScalar(), CultureInfo.InvariantCulture)
            ?? throw new InvalidDataException($"SQLite returned null for '{commandText}'.");
    }

    private static string ExecuteScalarString(SqliteStorage storage, string commandText) =>
        storage.ExecuteRead(unitOfWork => ExecuteScalarString(unitOfWork, commandText));

    private static string[] ReadNames(SqliteUnitOfWork unitOfWork, string commandText)
    {
        using var command = unitOfWork.CreateCommand(commandText);
        using var reader = command.ExecuteReader();
        var result = new List<string>();
        while (reader.Read())
        {
            result.Add(reader.GetString(0));
        }

        return result.ToArray();
    }

    private static void AssertSqliteConstraint(SqliteStorage storage, string commandText)
    {
        var error = Assert.Throws<SqliteException>(() =>
            storage.ExecuteInTransaction(unitOfWork => ExecuteNonQuery(unitOfWork, commandText)));
        Assert.Equal(19, error.SqliteErrorCode);
    }

    private static void PublishSnapshot(
        SqliteStorage storage,
        string snapshotId,
        string canonicalHash,
        string validatedUtc,
        string publishedUtc)
    {
        storage.ExecuteInTransaction(unitOfWork =>
        {
            using var command = unitOfWork.CreateCommand(
                """
                UPDATE reference_snapshots
                SET lifecycle_status = 'validated', canonical_content_sha256 = $canonicalHash,
                    validated_utc = $validatedUtc
                WHERE snapshot_id = $snapshotId;
                UPDATE reference_snapshots
                SET lifecycle_status = 'published', published_utc = $publishedUtc
                WHERE snapshot_id = $snapshotId;
                """);
            command.Parameters.AddWithValue("$snapshotId", snapshotId);
            command.Parameters.AddWithValue("$canonicalHash", canonicalHash);
            command.Parameters.AddWithValue("$validatedUtc", validatedUtc);
            command.Parameters.AddWithValue("$publishedUtc", publishedUtc);
            command.ExecuteNonQuery();
        });
    }

    private static void DropReferenceSnapshotSchema(SqliteConnection connection)
    {
        ProjectComponentSnapshotMigrationTestSchema.Drop(connection);
        DropReferenceSearchSchema(connection);
        using var command = connection.CreateCommand();
        command.CommandText =
            """
            DROP TRIGGER enforce_published_reference_source_head_update;
            DROP TRIGGER enforce_published_reference_source_head_insert;
            DROP TRIGGER prevent_diagnostic_insert_into_frozen_snapshot;
            DROP TRIGGER prevent_reference_snapshot_diagnostic_reassignment;
            DROP TRIGGER prevent_frozen_reference_snapshot_diagnostic_delete;
            DROP TRIGGER prevent_frozen_reference_snapshot_diagnostic_update;
            DROP TRIGGER prevent_reference_snapshot_record_reassignment;
            DROP TRIGGER prevent_frozen_reference_snapshot_record_delete;
            DROP TRIGGER prevent_frozen_reference_snapshot_record_update;
            DROP TRIGGER prevent_record_insert_into_frozen_snapshot;
            DROP TRIGGER enforce_reference_snapshot_validation;
            DROP TRIGGER prevent_reference_snapshot_delete;
            DROP TRIGGER enforce_reference_snapshot_update;
            DROP TABLE reference_source_heads;
            DROP TABLE reference_snapshot_diagnostics;
            DROP TABLE reference_snapshot_records;
            DROP TABLE reference_snapshots;
            DROP TABLE reference_sources;
            """;
        command.ExecuteNonQuery();
    }

    private static void DropReferenceSearchSchema(SqliteConnection connection)
    {
        using var command = connection.CreateCommand();
        command.CommandText =
            """
            DROP TRIGGER prevent_component_template_asset_delete;
            DROP TRIGGER prevent_component_template_asset_update;
            DROP TRIGGER prevent_component_template_asset_late_insert;
            DROP TABLE component_template_asset_refs;
            DROP TRIGGER prevent_component_template_binding_delete;
            DROP TRIGGER prevent_component_template_binding_late_insert;
            DROP TRIGGER enforce_component_template_head_publish;
            DROP TRIGGER enforce_component_template_version_append;
            DROP TRIGGER prevent_component_template_binding_update;
            DROP TRIGGER prevent_component_template_version_delete;
            DROP TRIGGER prevent_component_template_version_update;
            DROP TABLE component_template_article_bindings;
            DROP TABLE component_template_versions;
            DROP TABLE component_templates;
            DROP TRIGGER create_harness_design_document;
            DROP TABLE harness_design_documents;
            DROP TRIGGER reference_search_records_au;
            DROP TRIGGER reference_search_records_ad;
            DROP TRIGGER reference_search_records_ai;
            DROP TABLE reference_search_fts;
            DROP TABLE reference_search_fields;
            DROP TABLE reference_search_records;
            DROP TABLE reference_search_projections;
            DROP TABLE reference_catalog_saved_filters;
            """;
        command.ExecuteNonQuery();
    }

    private static void ExecuteNonQuery(SqliteUnitOfWork unitOfWork, string commandText)
    {
        using var command = unitOfWork.CreateCommand(commandText);
        command.ExecuteNonQuery();
    }

    private static SqliteConnection OpenIndependentConnection(string databasePath)
    {
        var connection = new SqliteConnection(new SqliteConnectionStringBuilder
        {
            DataSource = databasePath,
            Mode = SqliteOpenMode.ReadWrite,
            Cache = SqliteCacheMode.Private,
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

    private sealed record SchemaHistoryRow(
        int Version,
        string MigrationId,
        string ScriptSha256,
        string AppVersion,
        string AppliedUtc,
        string Description);

    private sealed record ConnectionSettings(
        SqliteConnection Connection,
        int ForeignKeys,
        int BusyTimeoutMilliseconds,
        int Synchronous,
        string JournalMode);

    private sealed class StorageFixture : IDisposable
    {
        private StorageFixture(string root)
        {
            Root = root;
            DataRoot = Path.Combine(root, "data-root");
        }

        public string Root { get; }

        public string DataRoot { get; }

        public string BackupRoot => Path.Combine(Root, "backups");

        public static StorageFixture Create()
        {
            var root = Path.Combine(
                Path.GetTempPath(),
                "techmap-sqlite-storage-tests",
                Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(root);
            return new StorageFixture(root);
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
