using System.Text.Json;
using Microsoft.Data.Sqlite;
using Techmap.Application;
using Techmap.Domain;
using Techmap.Infrastructure.Sqlite;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class ReferenceCatalogSearchMigrationTests
{
    [Fact]
    public async Task Schema_seven_active_snapshot_is_backfilled_and_searchable()
    {
        var root = Path.Combine(Path.GetTempPath(), "techmap-search-migration-tests", Guid.NewGuid().ToString("N"));
        var dataRoot = Path.Combine(root, "data");
        var backupRoot = Path.Combine(root, "backups");
        Directory.CreateDirectory(root);
        try
        {
            string databasePath;
            using (var storage = SqliteStorage.Open(dataRoot))
            {
                databasePath = storage.Layout.DatabasePath;
                Publish(storage,
                [
                    Record("terminal", "T-001", "{\"name\":\"Силовой контакт\",\"series\":\"Alpha\"}"),
                    Record("wire", "W-007", "{\"name\":\"Красный провод\",\"series\":\"Beta\"}"),
                ]);
            }

            DowngradeToSchemaSeven(databasePath);
            await using var lease = DataRootLease.Acquire(dataRoot);
            var migrationService = new SqliteStorageMigrationService(lease);
            var migration = await migrationService.MigrateIfRequiredAsync(
                new StorageMigrationRequest(backupRoot, "0.2.0-m2.03", SqliteStorage.CurrentSchemaVersion),
                TestContext.Current.CancellationToken);
            using var migrated = SqliteStorage.Open(dataRoot);

            Assert.True(migration.Migrated);
            Assert.Equal(7, migration.SourceSchemaVersion);
            Assert.Equal(SqliteStorage.CurrentSchemaVersion, migration.TargetSchemaVersion);
            Assert.Equal(2, migrated.ExecuteRead(unitOfWork =>
            {
                using var command = unitOfWork.CreateCommand(
                    "SELECT record_count FROM reference_search_projections;");
                return Convert.ToInt32(command.ExecuteScalar(), System.Globalization.CultureInfo.InvariantCulture);
            }));

            var search = new SqliteReferenceCatalogSearchStore(migrated);
            var page = await search.SearchAsync(
                "technology-database",
                null,
                new ReferenceCatalogSearchQuery(
                    "конт", null, ["terminal"],
                    [new ReferenceCatalogFilterCondition(
                        "series", ReferenceCatalogFilterOperator.TextEquals, "alpha")],
                    ReferenceCatalogFilterLogic.All,
                    ReferenceCatalogSort.SourceKeyAscending,
                    40),
                null,
                TestContext.Current.CancellationToken);
            Assert.Equal("T-001", Assert.Single(page.Records).SourceKey);
            migrationService.CompleteSuccessfulStartup(migration);
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }

    private static ReferenceCatalogRecordInput Record(string type, string key, string payload)
    {
        using var document = JsonDocument.Parse(payload);
        return new ReferenceCatalogRecordInput(type, key, document.RootElement.Clone(), $"Catalog!{key}");
    }

    private static void Publish(SqliteStorage storage, IReadOnlyList<ReferenceCatalogRecordInput> records)
    {
        var validation = ReferenceCatalogDraft.Create(
            ReferenceCatalogSnapshotIdentity.New(),
            "technology-database",
            1,
            DateTimeOffset.UtcNow,
            new ReferenceCatalogProvenanceInput("test", "schema-7-fixture", "fixture"),
            records).Validate();
        var result = new ReferenceCatalogPublicationService(
            new SqliteReferenceCatalogSnapshotStore(storage)).Publish(
            new ReferenceCatalogPublicationRequest(validation, null, validation.Snapshot!.Sha256, []));
        Assert.Equal(ReferenceCatalogPublicationStatus.Published, result.Status);
    }

    private static void DowngradeToSchemaSeven(string databasePath)
    {
        using var connection = new SqliteConnection(new SqliteConnectionStringBuilder
        {
            DataSource = databasePath,
            Mode = SqliteOpenMode.ReadWrite,
            Cache = SqliteCacheMode.Private,
            Pooling = false,
        }.ToString());
        connection.Open();
        ProjectComponentSnapshotMigrationTestSchema.Drop(connection);
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
            DROP TABLE IF EXISTS component_template_drafts;
                        DROP TABLE IF EXISTS global_materials;
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
                        DROP TABLE IF EXISTS component_template_drafts;
                        DROP TABLE IF EXISTS global_materials;
                        DELETE FROM schema_history WHERE version IN (8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21);
            PRAGMA user_version = 7;
            """;
        command.ExecuteNonQuery();
    }
}
