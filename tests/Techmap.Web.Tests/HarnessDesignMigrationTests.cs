using Microsoft.Data.Sqlite;
using Techmap.Application;
using Techmap.Domain;
using Techmap.Infrastructure.Sqlite;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class HarnessDesignMigrationTests
{
    [Fact]
    public async Task Schema_eight_harnesses_receive_valid_empty_design_documents()
    {
        var root = Path.Combine(Path.GetTempPath(), "techmap-design-migration", Guid.NewGuid().ToString("N"));
        var dataRoot = Path.Combine(root, "data");
        var backupRoot = Path.Combine(root, "backups");
        Directory.CreateDirectory(root);
        try
        {
            string databasePath;
            ProjectIdentity projectId;
            HarnessIdentity harnessId;
            using (var storage = SqliteStorage.Open(dataRoot))
            {
                databasePath = storage.Layout.DatabasePath;
                var catalog = new SqliteProjectCatalog(storage);
                var project = catalog.CreateProject(new CreateProjectCommand(
                    "ПР-E01", "Migration", 1, ProjectStatus.Draft));
                projectId = project.ProjectId;
                harnessId = catalog.AddHarness(projectId, "Жгут", 1).Harnesses.Single().HarnessId;
            }

            using (var connection = Open(databasePath))
            using (var downgrade = connection.CreateCommand())
            {
                downgrade.CommandText =
                    """
                    DROP TRIGGER create_harness_design_document;
                    DROP TABLE harness_design_documents;
                    DELETE FROM schema_history WHERE version = 9;
                    PRAGMA user_version = 8;
                    """;
                downgrade.ExecuteNonQuery();
            }

            await using var lease = DataRootLease.Acquire(dataRoot);
            var migrationService = new SqliteStorageMigrationService(lease);
            var migration = await migrationService.MigrateIfRequiredAsync(
                new StorageMigrationRequest(backupRoot, "0.3.0-e01", SqliteStorage.CurrentSchemaVersion),
                TestContext.Current.CancellationToken);
            using var migrated = SqliteStorage.Open(dataRoot);
            var design = new SqliteHarnessDesignDocumentStore(migrated, TimeProvider.System)
                .Get(projectId, harnessId);

            Assert.True(migration.Migrated);
            Assert.Equal(8, migration.SourceSchemaVersion);
            Assert.Equal(9, migration.TargetSchemaVersion);
            Assert.Equal(0, design.Revision);
            Assert.Equal(1, design.SchemaVersion);
            Assert.Equal(SqliteStorage.EmptyHarnessDesignJson, design.ContentJson);
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
