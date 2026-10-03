using System.Text.Json;
using System.Net.Http.Json;
using Techmap.Application;
using Techmap.Contracts;
using Techmap.Domain;
using Techmap.Infrastructure.Sqlite;
using Techmap.Infrastructure.Xlsx;
using Techmap.Web;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class TechnologyDatabaseSeedTests
{
    [Fact]
    public async Task New_host_exposes_bundled_terminal_catalog()
    {
        await using var factory = new TechmapWebApplicationFactory();
        using var client = factory.CreateLocalClient();
        using var page = await client.GetAsync("/", TestContext.Current.CancellationToken);
        page.EnsureSuccessStatusCode();
        var sources = await client.GetFromJsonAsync<ReferenceCatalogSourceSummaryResponse[]>(
            "/api/v1/reference-sources", TestContext.Current.CancellationToken);
        var terminals = Assert.Single(sources!, source => source.SourceId == "technology-terminals");
        Assert.Equal(279, terminals.RecordCount);
    }

    [Fact]
    public async Task Bundled_workbook_publishes_all_supported_technology_catalogs()
    {
        await WithStore(async store =>
        {
            await TechnologyDatabaseSeed.EnsurePublishedAsync(store);
            var expected = new Dictionary<string, int>
            {
                ["technology-operations"] = 139,
                ["technology-equipment"] = 189,
                ["technology-terminals"] = 279,
                ["technology-coax-terminations"] = 59,
                ["technology-coax-cables"] = 24,
            };
            foreach (var (sourceId, count) in expected)
            {
                var active = Assert.IsType<ReferenceCatalogSnapshot>(store.GetActive(sourceId));
                Assert.Equal(count, active.Records.Count);
                Assert.Single(store.List(sourceId));
            }
            var terminals = store.GetActive("technology-terminals")!;
            Assert.Contains(terminals.Records, record =>
                record.Payload.TryGetProperty("bagArticle", out var bag) &&
                bag.GetString() == "1/02506-02" &&
                record.Payload.GetProperty("reelArticle").GetString() == "");
            Assert.Contains(terminals.Records, record =>
                record.Payload.TryGetProperty("pullForceN", out var force) &&
                force.ValueKind == JsonValueKind.String &&
                force.GetString()!.Contains('\u2028'));

            var firstId = terminals.SnapshotId;
            await TechnologyDatabaseSeed.EnsurePublishedAsync(store);
            Assert.Equal(firstId, store.GetActive("technology-terminals")!.SnapshotId);
            Assert.Single(store.List("technology-terminals"));
        });
    }

    [Fact]
    public async Task Existing_user_terminal_catalog_is_preserved()
    {
        await WithStore(async store =>
        {
            using var payload = JsonDocument.Parse("""{"reelArticle":"OWN"}""");
            var validation = ReferenceCatalogDraft.Create(
                ReferenceCatalogSnapshotIdentity.New(), "technology-terminals", 1, DateTimeOffset.UtcNow,
                new ReferenceCatalogProvenanceInput("xlsx", "user-import", "user.xlsx"),
                [new ReferenceCatalogRecordInput("terminal", "own", payload.RootElement.Clone())]).Validate();
            var published = new ReferenceCatalogPublicationService(store).Publish(
                new ReferenceCatalogPublicationRequest(validation, null, validation.Snapshot!.Sha256,
                    validation.RequiredWarningAcknowledgements));
            await TechnologyDatabaseSeed.EnsurePublishedAsync(store);
            Assert.Equal(published.PublishedSnapshot!.SnapshotId, store.GetActive("technology-terminals")!.SnapshotId);
            Assert.Single(store.GetActive("technology-terminals")!.Records);
        });
    }

    private static async Task WithStore(Func<SqliteReferenceCatalogSnapshotStore, Task> action)
    {
        var root = Path.Combine(Path.GetTempPath(), "techmap-technology-seed-tests", Guid.NewGuid().ToString("N"));
        try
        {
            using var storage = SqliteStorage.Open(root);
            await action(new SqliteReferenceCatalogSnapshotStore(storage));
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }
}
