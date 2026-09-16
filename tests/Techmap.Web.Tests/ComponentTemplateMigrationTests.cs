using Microsoft.Data.Sqlite;
using Techmap.Application;
using Techmap.Infrastructure.Sqlite;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class ComponentTemplateMigrationTests
{
    [Fact]
    public async Task Schema_twelve_migrates_to_current_without_rewriting_v2_template_versions()
    {
        var root = Path.Combine(Path.GetTempPath(), "techmap-template-v3-migration", Guid.NewGuid().ToString("N"));
        var dataRoot = Path.Combine(root, "data");
        var backupRoot = Path.Combine(root, "backups");
        Directory.CreateDirectory(root);
        try
        {
            var generationName = StorageGenerationLayout.InitialGenerationName;
            var databasePath = Path.Combine(dataRoot, "generations", generationName, "app.db");
            Directory.CreateDirectory(Path.GetDirectoryName(databasePath)!);
            File.WriteAllBytes(databasePath, []);
            var templateId = Guid.NewGuid();
            var canonical = SqliteComponentTemplateStore.ValidateAndCanonicalizeContent(
                ComponentTemplateV2StoreTests.V2Content,
                2);
            var contentHash = Convert.ToHexStringLower(System.Security.Cryptography.SHA256.HashData(
                System.Text.Encoding.UTF8.GetBytes(canonical)));
            var versionHash = SqliteComponentTemplateStore.ComputeVersionHash(
                templateId, 1, 2, "MIG-12", "Existing v2 template", [], canonical);
            var now = DateTimeOffset.UtcNow.ToString("O", System.Globalization.CultureInfo.InvariantCulture);
            using (var connection = Open(databasePath))
            {
                SqliteStorage.InitializeSchemaAtVersion(connection, 12);
                using var command = connection.CreateCommand();
                command.CommandText =
                    """
                    INSERT INTO component_templates
                        (template_id, current_version, current_code, current_name, normalized_code,
                         created_utc, updated_utc, deleted_utc)
                    VALUES ($templateId, 0, 'MIG-12', 'Existing v2 template', 'MIG-12', $now, $now, NULL);
                    INSERT INTO component_template_versions
                        (template_id, version, schema_version, code, name, content_json,
                         content_sha256, version_sha256, created_utc)
                    VALUES ($templateId, 1, 2, 'MIG-12', 'Existing v2 template', $content,
                            $contentHash, $versionHash, $now);
                    UPDATE component_templates
                    SET current_version = 1
                    WHERE template_id = $templateId;
                    """;
                command.Parameters.AddWithValue("$templateId", templateId.ToString("D"));
                command.Parameters.AddWithValue("$now", now);
                command.Parameters.AddWithValue("$content", canonical);
                command.Parameters.AddWithValue("$contentHash", contentHash);
                command.Parameters.AddWithValue("$versionHash", versionHash);
                command.ExecuteNonQuery();
            }

            File.WriteAllText(
                Path.Combine(Path.GetDirectoryName(databasePath)!, StorageGenerationLayout.ReadyMarkerFileName),
                "ready\n");
            File.WriteAllText(Path.Combine(dataRoot, StorageGenerationLayout.CurrentPointerFileName), generationName + "\n");

            await using var lease = DataRootLease.Acquire(dataRoot);
            var migrationService = new SqliteStorageMigrationService(lease);
            var migration = await migrationService.MigrateIfRequiredAsync(
                new StorageMigrationRequest(
                    backupRoot, "0.3.10-m2.07", SqliteStorage.CurrentSchemaVersion),
                TestContext.Current.CancellationToken);
            using var migrated = SqliteStorage.Open(dataRoot);
            var store = new SqliteComponentTemplateStore(migrated, TimeProvider.System);
            var historical = store.GetVersion(templateId, 1);
            var v3 = store.Create(
                "MIG-13", "New v3 template", ComponentTemplateContentV3ValidatorTests.ValidArticleBindings, 3,
                ComponentTemplateContentV3ValidatorTests.ValidContentJson);

            Assert.True(migration.Migrated);
            Assert.Equal(12, migration.SourceSchemaVersion);
            Assert.Equal(SqliteStorage.CurrentSchemaVersion, migration.TargetSchemaVersion);
            Assert.Equal(2, historical.SchemaVersion);
            Assert.Equal(canonical, historical.ContentJson);
            Assert.Equal(3, v3.SchemaVersion);
            migrationService.CompleteSuccessfulStartup(migration);
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public void Schema_thirteen_to_fourteen_preserves_bindings_and_expands_the_ordinal_limit()
    {
        var databasePath = Path.Combine(Path.GetTempPath(), $"techmap-schema-14-{Guid.NewGuid():N}.db");
        try
        {
            File.WriteAllBytes(databasePath, []);
            using var connection = Open(databasePath);
            SqliteStorage.InitializeSchemaAtVersion(connection, 13);
            using (var seed = connection.CreateCommand())
            {
                seed.CommandText =
                    """
                    INSERT INTO component_templates
                        (template_id, current_version, current_code, current_name, normalized_code,
                         created_utc, updated_utc, deleted_utc)
                    VALUES ('10000000-0000-4000-8000-000000000001', 0, 'OLD', 'Old', 'OLD', 'now', 'now', NULL);
                    INSERT INTO component_template_versions
                        (template_id, version, schema_version, code, name, content_json,
                         content_sha256, version_sha256, created_utc)
                    VALUES ('10000000-0000-4000-8000-000000000001', 1, 1, 'OLD', 'Old', '{"schemaVersion":1}',
                            lower(hex(randomblob(32))), lower(hex(randomblob(32))), 'now');
                    INSERT INTO component_template_article_bindings
                        (template_id, version, binding_ordinal, source_id, entity_type, article_key)
                    VALUES ('10000000-0000-4000-8000-000000000001', 1, 63, 'db', 'connector', 'OLD-63');
                    UPDATE component_templates SET current_version = 1
                    WHERE template_id = '10000000-0000-4000-8000-000000000001';
                    """;
                seed.ExecuteNonQuery();
            }

            Assert.Equal(14, SqliteStorage.ApplyNextMigration(connection, 13));

            using var verify = connection.CreateCommand();
            verify.CommandText =
                """
                SELECT COUNT(*) FROM component_template_article_bindings
                WHERE binding_ordinal = 63 AND article_key = 'OLD-63';
                """;
            Assert.Equal(1L, (long)verify.ExecuteScalar()!);

            using var extended = connection.CreateCommand();
            extended.CommandText =
                """
                INSERT INTO component_templates
                    (template_id, current_version, current_code, current_name, normalized_code,
                     created_utc, updated_utc, deleted_utc)
                VALUES ('10000000-0000-4000-8000-000000000002', 0, 'NEW', 'New', 'NEW', 'now', 'now', NULL);
                INSERT INTO component_template_versions
                    (template_id, version, schema_version, code, name, content_json,
                     content_sha256, version_sha256, created_utc)
                VALUES ('10000000-0000-4000-8000-000000000002', 1, 1, 'NEW', 'New', '{"schemaVersion":1}',
                        lower(hex(randomblob(32))), lower(hex(randomblob(32))), 'now');
                INSERT INTO component_template_article_bindings
                    (template_id, version, binding_ordinal, source_id, entity_type, article_key)
                VALUES ('10000000-0000-4000-8000-000000000002', 1, 64, 'db', 'connector', 'NEW-64');
                """;
            extended.ExecuteNonQuery();
        }
        finally
        {
            SqliteConnection.ClearAllPools();
            if (File.Exists(databasePath)) File.Delete(databasePath);
        }
    }

    [Fact]
    public async Task Schema_ten_migrates_existing_v1_template_versions_without_rewriting_them()
    {
        var root = Path.Combine(Path.GetTempPath(), "techmap-template-asset-migration", Guid.NewGuid().ToString("N"));
        var dataRoot = Path.Combine(root, "data");
        var backupRoot = Path.Combine(root, "backups");
        Directory.CreateDirectory(root);
        try
        {
            var generationName = StorageGenerationLayout.InitialGenerationName;
            var databasePath = Path.Combine(dataRoot, "generations", generationName, "app.db");
            Directory.CreateDirectory(Path.GetDirectoryName(databasePath)!);
            File.WriteAllBytes(databasePath, []);
            var templateId = Guid.NewGuid();
            const string content =
                """
                {"schemaVersion":1,"views":[{"id":"e4","name":"E4","kind":"e4","primitives":[],"contactPoints":[]},{"id":"drawing","name":"Drawing","kind":"drawing","primitives":[],"contactPoints":[]}]}
                """;
            var canonical = SqliteComponentTemplateStore.ValidateAndCanonicalizeContent(content, 1);
            var contentHash = Convert.ToHexStringLower(System.Security.Cryptography.SHA256.HashData(
                System.Text.Encoding.UTF8.GetBytes(canonical)));
            var versionHash = SqliteComponentTemplateStore.ComputeVersionHash(
                templateId, 1, 1, "MIG-10", "Existing template", [], canonical);
            var now = DateTimeOffset.UtcNow.ToString("O", System.Globalization.CultureInfo.InvariantCulture);
            using (var connection = Open(databasePath))
            {
                SqliteStorage.InitializeSchemaAtVersion(connection, 10);
                using var command = connection.CreateCommand();
                command.CommandText =
                    """
                    INSERT INTO component_templates
                        (template_id, current_version, current_code, current_name, normalized_code,
                         created_utc, updated_utc, deleted_utc)
                    VALUES ($templateId, 0, 'MIG-10', 'Existing template', 'MIG-10', $now, $now, NULL);
                    INSERT INTO component_template_versions
                        (template_id, version, schema_version, code, name, content_json,
                         content_sha256, version_sha256, created_utc)
                    VALUES ($templateId, 1, 1, 'MIG-10', 'Existing template', $content,
                            $contentHash, $versionHash, $now);
                    UPDATE component_templates
                    SET current_version = 1
                    WHERE template_id = $templateId;
                    """;
                command.Parameters.AddWithValue("$templateId", templateId.ToString("D"));
                command.Parameters.AddWithValue("$now", now);
                command.Parameters.AddWithValue("$content", canonical);
                command.Parameters.AddWithValue("$contentHash", contentHash);
                command.Parameters.AddWithValue("$versionHash", versionHash);
                command.ExecuteNonQuery();
            }

            File.WriteAllText(
                Path.Combine(Path.GetDirectoryName(databasePath)!, StorageGenerationLayout.ReadyMarkerFileName),
                "ready\n");
            File.WriteAllText(Path.Combine(dataRoot, StorageGenerationLayout.CurrentPointerFileName), generationName + "\n");

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
            Assert.Equal(SqliteStorage.CurrentSchemaVersion, migration.TargetSchemaVersion);
            Assert.Equal(1, template.SchemaVersion);
            Assert.Equal(canonical, template.ContentJson);
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
            {
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
                    DROP TABLE component_templates;
                    DELETE FROM schema_history WHERE version IN (10, 11, 12, 13, 14, 15, 16, 17, 18);
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
