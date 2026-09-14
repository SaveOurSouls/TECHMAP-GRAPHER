using Microsoft.Data.Sqlite;
using Techmap.Application;
using Techmap.Infrastructure.Sqlite;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class ComponentTemplateMigrationTests
{
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
                    DELETE FROM schema_history WHERE version = 10;
                    PRAGMA user_version = 9;
                    """;
                command.ExecuteNonQuery();
            }

            await using var lease = DataRootLease.Acquire(dataRoot);
            var migrationService = new SqliteStorageMigrationService(lease);
            var migration = await migrationService.MigrateIfRequiredAsync(
                new StorageMigrationRequest(backupRoot, "0.3.7-m2.05", 10),
                TestContext.Current.CancellationToken);
            using var migrated = SqliteStorage.Open(dataRoot);
            var templates = new SqliteComponentTemplateStore(migrated, TimeProvider.System);

            Assert.True(migration.Migrated);
            Assert.Equal(9, migration.SourceSchemaVersion);
            Assert.Equal(10, migration.TargetSchemaVersion);
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
