using Microsoft.Data.Sqlite;
using Techmap.Application;
using Techmap.Infrastructure.Sqlite;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class ComponentTemplateMigrationTests
{
    [Fact]
    public async Task Schema_ten_migrates_existing_template_versions_to_empty_asset_sets()
    {
        var root = Path.Combine(Path.GetTempPath(), "techmap-template-asset-migration", Guid.NewGuid().ToString("N"));
        var dataRoot = Path.Combine(root, "data");
        var backupRoot = Path.Combine(root, "backups");
        Directory.CreateDirectory(root);
        try
        {
            string databasePath;
            Guid templateId;
            using (var storage = SqliteStorage.Open(dataRoot))
            {
                databasePath = storage.Layout.DatabasePath;
                templateId = new SqliteComponentTemplateStore(storage, TimeProvider.System).Create(
                    "MIG-10", "Existing template", [], 1,
                    """
                    {"schemaVersion":1,"views":[{"id":"e4","name":"E4","kind":"e4","primitives":[],"contactPoints":[]},{"id":"drawing","name":"Drawing","kind":"drawing","primitives":[],"contactPoints":[]}]}
                    """).TemplateId;
            }

            using (var connection = Open(databasePath))
            using (var command = connection.CreateCommand())
            {
                command.CommandText =
                    """
                    DROP TRIGGER prevent_component_template_asset_delete;
                    DROP TRIGGER prevent_component_template_asset_update;
                    DROP TRIGGER prevent_component_template_asset_late_insert;
                    DROP TABLE component_template_asset_refs;
                    DELETE FROM schema_history WHERE version = 11;
                    PRAGMA user_version = 10;
                    """;
                command.ExecuteNonQuery();
            }

            await using var lease = DataRootLease.Acquire(dataRoot);
            var migrationService = new SqliteStorageMigrationService(lease);
            var migration = await migrationService.MigrateIfRequiredAsync(
                new StorageMigrationRequest(
                    backupRoot, "0.3.8-m2.06", SqliteStorage.CurrentSchemaVersion),
                TestContext.Current.CancellationToken);
            using var migrated = SqliteStorage.Open(dataRoot);
            var template = new SqliteComponentTemplateStore(migrated, TimeProvider.System).Get(templateId);

            Assert.True(migration.Migrated);
            Assert.Equal(10, migration.SourceSchemaVersion);
            Assert.Equal(11, migration.TargetSchemaVersion);
            Assert.Empty(template.Assets);
            migrationService.CompleteSuccessfulStartup(migration);
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public async Task Schema_nine_migrates_to_empty_template_library_without_changing_existing_rows()
    {
        var root = Path.Combine(Path.GetTempPath(), "techmap-template-migration", Guid.NewGuid().ToString("N"));
        var dataRoot = Path.Combine(root, "data");
        var backupRoot = Path.Combine(root, "backups");
        Directory.CreateDirectory(root);
        try
        {
            string databasePath;
            Guid projectId;
            using (var storage = SqliteStorage.Open(dataRoot))
            {
                databasePath = storage.Layout.DatabasePath;
                var project = new SqliteProjectCatalog(storage).CreateProject(new CreateProjectCommand(
                    "M2-05", "Preserved project", 3, Techmap.Domain.ProjectStatus.Active));
                projectId = project.ProjectId.Value;
            }

            using (var connection = Open(databasePath))
            using (var command = connection.CreateCommand())
            {
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
                    DELETE FROM schema_history WHERE version IN (10, 11);
                    PRAGMA user_version = 9;
                    """;
                command.ExecuteNonQuery();
            }

            await using var lease = DataRootLease.Acquire(dataRoot);
            var migrationService = new SqliteStorageMigrationService(lease);
            var migration = await migrationService.MigrateIfRequiredAsync(
                new StorageMigrationRequest(
                    backupRoot, "0.3.7-m2.05", SqliteStorage.CurrentSchemaVersion),
                TestContext.Current.CancellationToken);
            using var migrated = SqliteStorage.Open(dataRoot);
            var templates = new SqliteComponentTemplateStore(migrated, TimeProvider.System);

            Assert.True(migration.Migrated);
            Assert.Equal(9, migration.SourceSchemaVersion);
            Assert.Equal(SqliteStorage.CurrentSchemaVersion, migration.TargetSchemaVersion);
            Assert.Empty(templates.List());
            Assert.Equal("Preserved project", new SqliteProjectCatalog(migrated)
                .GetProject(new Techmap.Domain.ProjectIdentity(projectId)).Name);
            migrationService.CompleteSuccessfulStartup(migration);
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }

    private static SqliteConnection Open(string databasePath)
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
}
