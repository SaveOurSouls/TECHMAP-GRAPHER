using System.Net.Http.Json;
using System.Text.Json;
using Techmap.Application;
using Techmap.Contracts;
using Techmap.Domain;
using Techmap.Infrastructure.Sqlite;
using Techmap.Web;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class WireCatalogSeedTests
{
    [Fact]
    public async Task New_host_exposes_bundled_wire_catalog_to_directory_and_editor_apis()
    {
        await using var factory = new TechmapWebApplicationFactory();
        using var client = factory.CreateLocalClient();
        using var page = await client.GetAsync("/", TestContext.Current.CancellationToken);
        page.EnsureSuccessStatusCode();
        var sources = await client.GetFromJsonAsync<ReferenceCatalogSourceSummaryResponse[]>(
            "/api/v1/reference-sources", TestContext.Current.CancellationToken);
        var source = Assert.Single(sources!, item => item.SourceId == "technology-wires");
        Assert.Equal(260, source.RecordCount);
        var catalog = await client.GetFromJsonAsync<ReferenceCatalogRecordListResponse>(
            "/api/v1/reference-sources/technology-wires/active/records", TestContext.Current.CancellationToken);
        Assert.Equal(source.ActiveSnapshotId, catalog!.SnapshotId);
        Assert.Equal(260, catalog.Records.Count);
        Assert.All(catalog.Records, row =>
        {
            Assert.Equal("wire", row.EntityType);
            Assert.False(string.IsNullOrWhiteSpace(row.Payload.GetProperty("Марка").GetString()));
            foreach (var field in new[] { "Core", "Сечение C", "Pair", "Сечение P" })
                Assert.True(row.Payload.TryGetProperty(field, out _), field);
        });
    }

    [Fact]
    public void Repeated_startup_preserves_snapshot_identity_and_does_not_add_versions()
    {
        WithStore(store =>
        {
            WireCatalogSeed.EnsurePublished(store);
            var first = store.GetActive("technology-wires")!;
            WireCatalogSeed.EnsurePublished(store);
            Assert.Equal(first.SnapshotId, store.GetActive("technology-wires")!.SnapshotId);
            Assert.Single(store.List("technology-wires"));
        });
    }

    [Fact]
    public void Existing_user_catalog_is_preserved()
    {
        WithStore(store =>
        {
            using var payload = JsonDocument.Parse("""{"Марка":"User wire","Сечение C":"0.5"}""");
            var validation = ReferenceCatalogDraft.Create(
                ReferenceCatalogSnapshotIdentity.New(), "technology-wires", 1, DateTimeOffset.UtcNow,
                new ReferenceCatalogProvenanceInput("xlsx", "user-import", "user.xlsx"),
                [new ReferenceCatalogRecordInput("wire", "user-wire", payload.RootElement.Clone(), "Провода!E4:AJ4")]).Validate();
            var publication = new ReferenceCatalogPublicationService(store).Publish(
                new ReferenceCatalogPublicationRequest(validation, null, validation.Snapshot!.Sha256,
                    validation.RequiredWarningAcknowledgements));
            Assert.Equal(ReferenceCatalogPublicationStatus.Published, publication.Status);
            WireCatalogSeed.EnsurePublished(store);
            Assert.Equal(publication.PublishedSnapshot!.SnapshotId, store.GetActive("technology-wires")!.SnapshotId);
            Assert.Single(store.GetActive("technology-wires")!.Records);
            Assert.Single(store.List("technology-wires"));
        });
    }

    private static void WithStore(Action<SqliteReferenceCatalogSnapshotStore> action)
    {
        var root = Path.Combine(Path.GetTempPath(), "techmap-wire-seed-tests", Guid.NewGuid().ToString("N"));
        try
        {
            using var storage = SqliteStorage.Open(root);
            action(new SqliteReferenceCatalogSnapshotStore(storage));
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }
}
