using System.Globalization;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using Techmap.Application;
using Techmap.Domain;
using Techmap.Infrastructure.Sqlite;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class ReferenceCatalogSearchProjectionTests
{
    [Fact]
    public async Task Publication_accepts_normalized_field_collisions_and_oversized_lookup_values()
    {
        using var fixture = Fixture.Create();
        using var storage = SqliteStorage.Open(fixture.DataRoot);
        var published = Publish(new SqliteReferenceCatalogSnapshotStore(storage), CreateDraft("v1").Validate());

        Assert.Equal(ReferenceCatalogPublicationStatus.Published, published.Status);
        var fields = storage.ExecuteRead(ReadFields);

        Assert.Equal(7, fields.Count);
        Assert.Equal(2, fields.Count(field => field.FieldName == "A"));
        Assert.Equal(2, fields.Count(field => field.FieldName == "A B"));
        Assert.Contains(fields, field =>
            field.SourceFieldName.Length == 300 && field.FieldName is null && field.NormalizedText == "SHORT");
        Assert.Contains(fields, field =>
            field.SourceFieldName == "   " && field.FieldName is null && field.NormalizedText == "SPACES");
        Assert.Contains(fields, field =>
            field.SourceFieldName == "long" && field.FieldName == "LONG" &&
            field.ValueKind == "text" && field.NormalizedText is null);
        var search = await new SqliteReferenceCatalogSearchStore(storage).SearchAsync(
            "technology-database",
            null,
            new ReferenceCatalogSearchQuery(
                null, "   ", [], [], ReferenceCatalogFilterLogic.All,
                ReferenceCatalogSort.Relevance, 40),
            null,
            TestContext.Current.CancellationToken);
        Assert.Equal("   ", Assert.Single(search.Records).SourceKey);
    }

    [Fact]
    public void Version_eight_backfill_accepts_normalized_field_collisions_and_oversized_lookup_values()
    {
        using var fixture = Fixture.Create();
        string databasePath;
        using (var storage = SqliteStorage.Open(fixture.DataRoot))
        {
            databasePath = storage.Layout.DatabasePath;
            var published = Publish(new SqliteReferenceCatalogSnapshotStore(storage), CreateDraft("v1").Validate());
            Assert.Equal(ReferenceCatalogPublicationStatus.Published, published.Status);
        }

        using var connection = OpenReadWrite(databasePath);
        RemoveVersionEightSchema(connection);

        Assert.Equal(8, SqliteStorage.ApplyNextMigration(connection, 7));
        Assert.Equal(1, ExecuteScalarInt32(connection, "SELECT COUNT(*) FROM reference_search_projections;"));
        Assert.Equal(1, ExecuteScalarInt32(connection, "SELECT COUNT(*) FROM reference_search_records;"));
        Assert.Equal(7, ExecuteScalarInt32(connection, "SELECT COUNT(*) FROM reference_search_fields;"));
        Assert.Equal(2, ExecuteScalarInt32(connection,
            "SELECT COUNT(*) FROM reference_search_fields WHERE field_name = 'A';"));
        Assert.Equal(2, ExecuteScalarInt32(connection,
            "SELECT COUNT(*) FROM reference_search_fields WHERE field_name = 'A B';"));
        Assert.Equal(2, ExecuteScalarInt32(connection,
            "SELECT COUNT(*) FROM reference_search_fields WHERE field_name IS NULL;"));
        Assert.Equal(1, ExecuteScalarInt32(connection,
            "SELECT COUNT(*) FROM reference_search_fields WHERE source_field_name = 'long' AND normalized_text IS NULL;"));
    }

    private static ReferenceCatalogPublicationResult Publish(
        IReferenceCatalogSnapshotStore store,
        ReferenceCatalogValidationResult validation) =>
        new ReferenceCatalogPublicationService(store).Publish(new ReferenceCatalogPublicationRequest(
            validation,
            ExpectedActiveSnapshotId: null,
            validation.Snapshot?.Sha256 ?? "invalid",
            validation.RequiredWarningAcknowledgements));

    private static ReferenceCatalogDraft CreateDraft(string version)
    {
        var longFieldName = new string('N', 300);
        var longValue = new string('Ж', 32_768);
        var payload = JsonSerializer.Serialize(new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["A"] = "one",
            ["a"] = "two",
            ["a b"] = "three",
            ["a   b"] = "four",
            ["   "] = "spaces",
            [longFieldName] = "short",
            ["long"] = longValue,
        });
        using var document = JsonDocument.Parse(payload);
        return ReferenceCatalogDraft.Create(
            ReferenceCatalogSnapshotIdentity.New(),
            "technology-database",
            1,
            new DateTimeOffset(2026, 9, 13, 9, 0, 0, TimeSpan.Zero),
            new ReferenceCatalogProvenanceInput("xlsx", version, "technology-database.xlsx"),
            [new ReferenceCatalogRecordInput(
                "terminal", "   ", document.RootElement.Clone(), "БД.ТЕР!2")]);
    }

    private static IReadOnlyList<FieldRow> ReadFields(SqliteUnitOfWork unitOfWork)
    {
        using var command = unitOfWork.CreateCommand(
            """
            SELECT source_field_name, field_name, value_kind, normalized_text
            FROM reference_search_fields
            ORDER BY source_field_name;
            """);
        using var reader = command.ExecuteReader();
        var fields = new List<FieldRow>();
        while (reader.Read())
        {
            fields.Add(new FieldRow(
                reader.GetString(0),
                reader.IsDBNull(1) ? null : reader.GetString(1),
                reader.GetString(2),
                reader.IsDBNull(3) ? null : reader.GetString(3)));
        }
        return fields;
    }

    private static SqliteConnection OpenReadWrite(string databasePath)
    {
        var connection = new SqliteConnection(new SqliteConnectionStringBuilder
        {
            DataSource = databasePath,
            Mode = SqliteOpenMode.ReadWrite,
            Cache = SqliteCacheMode.Private,
            Pooling = false,
        }.ToString());
        connection.Open();
        using var settings = connection.CreateCommand();
        settings.CommandText = "PRAGMA foreign_keys = ON;";
        settings.ExecuteNonQuery();
        return connection;
    }

    private static void RemoveVersionEightSchema(SqliteConnection connection)
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
            DELETE FROM schema_history WHERE version IN (8, 9, 10, 11);
            PRAGMA user_version = 7;
            """;
        command.ExecuteNonQuery();
    }

    private static int ExecuteScalarInt32(SqliteConnection connection, string sql)
    {
        using var command = connection.CreateCommand();
        command.CommandText = sql;
        return Convert.ToInt32(command.ExecuteScalar(), CultureInfo.InvariantCulture);
    }

    private sealed record FieldRow(
        string SourceFieldName,
        string? FieldName,
        string ValueKind,
        string? NormalizedText);

    private sealed class Fixture : IDisposable
    {
        private Fixture(string root)
        {
            Root = root;
            DataRoot = Path.Combine(root, "data");
        }

        public string Root { get; }
        public string DataRoot { get; }

        public static Fixture Create()
        {
            var root = Path.Combine(Path.GetTempPath(), "techmap-search-projection-tests", Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(root);
            return new Fixture(root);
        }

        public void Dispose()
        {
            if (Directory.Exists(Root)) Directory.Delete(Root, recursive: true);
        }
    }
}
