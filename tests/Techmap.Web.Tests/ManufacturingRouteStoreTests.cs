using System.Text.Json;
using System.Text.Json.Nodes;
using Techmap.Application;
using Techmap.Domain;
using Techmap.Infrastructure.Sqlite;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class ManufacturingRouteStoreTests
{
    [Fact]
    public async Task Route_photos_require_project_owned_attachment_and_do_not_change_source_fingerprint()
    {
        using var fixture = new Fixture(); var graph = Construction(); var source = fixture.Put(0, graph, 2);
        graph["manufacturingRoute"] = Route(source.SourceFingerprint!);
        var photos = new JsonArray(new JsonObject { ["sha256"] = new string('a', 64), ["name"] = "Stage.png" });
        graph["manufacturingRoute"]!["rows"]![0]!["photos"] = photos;
        Assert.Equal("invalid_manufacturing_route", Assert.Throws<HarnessDesignDocumentException>(() => fixture.Put(source.Revision, graph, 2)).Code);
        Assert.Equal(source, fixture.Get());
        var hash = await fixture.AddPhoto(); photos[0]!["sha256"] = hash;
        var saved = fixture.Put(source.Revision, graph, 2);
        Assert.Equal(source.SourceFingerprint, saved.SourceFingerprint);
        Assert.Equal(hash, JsonNode.Parse(saved.ContentJson)!["manufacturingRoute"]!["rows"]![0]!["photos"]![0]!["sha256"]!.GetValue<string>());
    }

    [Fact]
    public void Route_source_and_writer_protection_are_atomic_and_constructor_edits_remain_possible()
    {
        using var fixture = new Fixture();
        var before = fixture.Get();
        var graph = Construction();
        var construction = fixture.Put(before.Revision, graph, 2);
        Assert.Equal(1, construction.HarnessQuantity);
        Assert.NotNull(construction.SourceFingerprint);
        graph["manufacturingRoute"] = Route(construction.SourceFingerprint!);
        var saved = fixture.Put(construction.Revision, graph, 2);
        var downgrade = Assert.Throws<HarnessDesignDocumentException>(() => fixture.Put(saved.Revision, Construction(), 1));
        Assert.Equal("design_writer_upgrade_required", downgrade.Code);
        Assert.Equal(saved, fixture.Get());
        graph["wires"]![0]!["lengthMm"] = 11;
        var stale = fixture.Put(saved.Revision, graph, 2);
        Assert.NotEqual(saved.SourceFingerprint, stale.SourceFingerprint);
        var edited = graph.DeepClone().AsObject();
        edited["manufacturingRoute"]!["rows"]![0]!["title"] = "Edit while stale";
        Assert.Equal("manufacturing_route_source_stale", Assert.Throws<HarnessDesignDocumentException>(() => fixture.Put(stale.Revision, edited, 2)).Code);
        Assert.Equal(stale, fixture.Get());
        edited["manufacturingRoute"]!["source"]!["sha256"] = stale.SourceFingerprint;
        var refreshed = fixture.Put(stale.Revision, edited, 2);
        Assert.Equal(stale.SourceFingerprint, refreshed.SourceFingerprint);
        var reread = fixture.Get();
        Assert.Equal(refreshed, reread);
    }

    [Fact]
    public void Fresh_route_missing_reference_rejects_but_unchanged_stale_route_preserves_deleted_object()
    {
        using var fixture = new Fixture();
        var graph = Construction();
        var source = fixture.Put(0, graph, 2);
        graph["manufacturingRoute"] = Route(source.SourceFingerprint!);
        graph["manufacturingRoute"]!["rows"]![0]!["sourceObjects"]![0]!["id"] = "missing";
        Assert.Equal("invalid_manufacturing_route", Assert.Throws<HarnessDesignDocumentException>(() => fixture.Put(source.Revision, graph, 2)).Code);
        graph["manufacturingRoute"]!["rows"]![0]!["sourceObjects"]![0]!["id"] = "w";
        var saved = fixture.Put(source.Revision, graph, 2);
        graph["wires"] = new JsonArray();
        var stale = fixture.Put(saved.Revision, graph, 2);
        Assert.Equal("w", JsonNode.Parse(stale.ContentJson)!["manufacturingRoute"]!["rows"]![0]!["sourceObjects"]![0]!["id"]!.GetValue<string>());
    }

    [Fact]
    public void Completed_route_remains_stored_when_source_gains_a_wire_and_requires_refresh_before_recompletion()
    {
        using var fixture = new Fixture(); var graph = Construction(); var source = fixture.Put(0, graph, 2);
        var route = Route(source.SourceFingerprint!); route["status"] = "completed";
        var row = route["rows"]![0]!; row["kind"] = "assembly"; row["prepared"] = true;
        row["operations"] = new JsonArray(new JsonObject
        {
            ["id"] = "op", ["mode"] = "assembly", ["note"] = "",
            ["binding"] = new JsonObject { ["sourceId"] = "ops", ["entityType"] = "operation", ["snapshotId"] = Guid.NewGuid().ToString("D"), ["snapshotSha256"] = new string('a', 64), ["recordId"] = new string('b', 64), ["sourceKey"] = "assembly", ["displayName"] = "Assembly" },
        });
        graph["manufacturingRoute"] = route; var completed = fixture.Put(source.Revision, graph, 2);
        var second = graph["wires"]![0]!.DeepClone(); second["id"] = "w2"; graph["wires"]!.AsArray().Add(second);
        var stale = fixture.Put(completed.Revision, graph, 2);
        Assert.NotEqual(completed.SourceFingerprint, stale.SourceFingerprint);
        route["source"]!["sha256"] = stale.SourceFingerprint;
        Assert.Equal("invalid_manufacturing_route", Assert.Throws<HarnessDesignDocumentException>(() => fixture.Put(stale.Revision, graph, 2)).Code);
        Assert.Equal(stale, fixture.Get());
    }

    [Fact]
    public void Remap_updates_connector_route_refs_and_fresh_hash_but_preserves_stale_hash()
    {
        var from = Guid.NewGuid(); var to = Guid.NewGuid();
        var graph = Construction();
        graph["connectors"]![0]!["id"] = from.ToString("D");
        graph["connectors"]![0]!["contacts"]![0]!["id"] = $"{from:D}:contact:a";
        graph["wires"]![0]!["from"]!["connectorId"] = from.ToString("D");
        graph["wires"]![0]!["from"]!["contactId"] = $"{from:D}:contact:a";
        using var source = JsonDocument.Parse(graph.ToJsonString());
        graph["manufacturingRoute"] = Route(ManufacturingRouteSourceFingerprint.Compute(source.RootElement, 3));
        var row = graph["manufacturingRoute"]!["rows"]![0]!;
        row["sourceObjects"]!.AsArray().Add(new JsonObject { ["kind"] = "connector", ["id"] = from.ToString("D") });
        row["presentation"]!["objects"]!.AsArray().Add(new JsonObject { ["ref"] = new JsonObject { ["kind"] = "connector", ["id"] = from.ToString("D") }, ["points"] = new JsonArray(), ["hidden"] = false });
        var remap = ProjectComponentPlacementRemapper.RemapHarnessDesign(graph.ToJsonString(), new Dictionary<Guid, Guid> { [from] = to }, 3);
        using var actual = JsonDocument.Parse(remap.DesignJson);
        var route = actual.RootElement.GetProperty("manufacturingRoute");
        Assert.Equal(to.ToString("D"), route.GetProperty("rows")[0].GetProperty("sourceObjects")[1].GetProperty("id").GetString());
        Assert.Equal(to.ToString("D"), route.GetProperty("rows")[0].GetProperty("presentation").GetProperty("objects")[0].GetProperty("ref").GetProperty("id").GetString());
        Assert.Equal(ManufacturingRouteSourceFingerprint.Compute(actual.RootElement, 3), route.GetProperty("source").GetProperty("sha256").GetString());
        graph["manufacturingRoute"]!["source"]!["sha256"] = new string('a', 64);
        var stale = ProjectComponentPlacementRemapper.RemapHarnessDesign(graph.ToJsonString(), new Dictionary<Guid, Guid> { [from] = to }, 3);
        Assert.Equal(new string('a', 64), JsonNode.Parse(stale.DesignJson)!["manufacturingRoute"]!["source"]!["sha256"]!.GetValue<string>());
    }

    private static JsonObject Construction() => JsonNode.Parse("""
      {"schemaVersion":1,"connectors":[{"id":"A","contacts":[{"id":"a"}]},{"id":"B","contacts":[{"id":"b"}]}],
      "wires":[{"id":"w","lengthMm":10,"from":{"connectorId":"A","contactId":"a"},"to":{"connectorId":"B","contactId":"b"}}]}
      """)!.AsObject();

    private static JsonObject Route(string hash) => new()
    {
        ["contractVersion"] = 1, ["source"] = new JsonObject { ["fingerprintVersion"] = 1, ["sha256"] = hash }, ["status"] = "draft",
        ["rows"] = new JsonArray(new JsonObject
        {
            ["id"] = "r", ["kind"] = "semiFinished", ["title"] = "Wire", ["comment"] = "", ["sourceObjects"] = new JsonArray(new JsonObject { ["kind"] = "wire", ["id"] = "w" }),
            ["dependsOn"] = new JsonArray(), ["operations"] = new JsonArray(), ["presentation"] = new JsonObject { ["backgroundOpacity"] = .25, ["objects"] = new JsonArray() }, ["prepared"] = false,
        }),
    };

    private sealed class Fixture : IDisposable
    {
        private readonly string root = Path.Combine(Path.GetTempPath(), "manufacturing-route-" + Guid.NewGuid().ToString("N"));
        private readonly SqliteStorage storage;
        private readonly SqliteHarnessDesignDocumentStore store;
        private readonly ProjectIdentity project;
        private readonly HarnessIdentity harness;
        public Fixture()
        {
            Directory.CreateDirectory(root); storage = SqliteStorage.Open(root); var catalog = new SqliteProjectCatalog(storage);
            project = catalog.CreateProject(new CreateProjectCommand("P", "Route", 3, ProjectStatus.Draft)).ProjectId;
            harness = catalog.AddHarness(project, "W1").Harnesses.Single().HarnessId;
            store = new(storage, TimeProvider.System);
        }
        internal HarnessDesignDocument Get() => store.Get(project, harness);
        internal async Task<string> AddPhoto()
        {
            using var bytes = new MemoryStream(ComponentTemplateV2StoreTests.Png);
            var result = await new SqliteProjectAttachmentCatalog(storage, new ContentAddressedAttachmentStore(root), TimeProvider.System)
                .AddAsync(project, bytes, "stage.png", "image/png", "route-photo", TestContext.Current.CancellationToken);
            return result.Content.Sha256;
        }
        internal HarnessDesignDocument Put(long revision, JsonObject content, int writer) => store.Put(project, harness, revision, 1, content.ToJsonString(), writer);
        public void Dispose() { storage.Dispose(); Directory.Delete(root, true); }
    }
}
