using System.Text.Json;
using System.Text.Json.Nodes;
using Techmap.Application;
using Techmap.Domain;
using Techmap.Infrastructure.Sqlite;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class ElectricalGraphValidatorTests
{
    [Fact]
    public void Writer_contract_upgrade_is_monotonic_and_rejects_legacy_writes_atomically()
    {
        using var fixture = new Fixture();
        var graph = Graph(fixture.PlacementId, fixture.Template);
        var saved = fixture.Designs.Put(fixture.ProjectId, fixture.HarnessId, 1, 1, graph.ToJsonString(), 1);
        Assert.Equal(1, JsonNode.Parse(saved.ContentJson)!["requiredWriterContractVersion"]!.GetValue<int>());
        var placement = Assert.Single(fixture.Snapshots.ListPlacements(fixture.ProjectId, fixture.HarnessId));
        // Simulate an old client dropping the marker and a known optional field.
        graph.Remove("screens");
        graph["wires"]!.AsArray().RemoveAt(2);
        var error = Assert.Throws<HarnessDesignDocumentException>(() => fixture.Designs.Put(
            fixture.ProjectId, fixture.HarnessId, saved.Revision, 1, graph.ToJsonString()));
        Assert.Equal("design_writer_upgrade_required", error.Code);
        Assert.Equal(saved.Revision, error.CurrentRevision);
        Assert.Equal(saved, fixture.Designs.Get(fixture.ProjectId, fixture.HarnessId));
        Assert.Equal(placement, Assert.Single(fixture.Snapshots.ListPlacements(fixture.ProjectId, fixture.HarnessId)));
        // A capable writer may intentionally remove data, but cannot downgrade the marker.
        var next = fixture.Designs.Put(fixture.ProjectId, fixture.HarnessId, saved.Revision, 1, graph.ToJsonString(), 1);
        Assert.Equal(1, JsonNode.Parse(next.ContentJson)!["requiredWriterContractVersion"]!.GetValue<int>());
        var replay = fixture.Designs.Put(fixture.ProjectId, fixture.HarnessId, saved.Revision, 1, graph.ToJsonString(), 1);
        Assert.Equal(next, replay);
    }

    [Fact]
    public void Placement_command_cannot_bypass_the_protected_graph_contract()
    {
        using var fixture = new Fixture();
        var graph = Graph(fixture.PlacementId, fixture.Template);
        var saved = fixture.Designs.Put(fixture.ProjectId, fixture.HarnessId, 1, 1, graph.ToJsonString(), 1);
        var placementId = Guid.NewGuid();
        var instance = JsonNode.Parse(Fixture.BoundInstance(placementId, fixture.Template))!;
        instance.AsObject().Remove("contacts");
        var article = ComponentTemplateContentV3ValidatorTests.ValidArticleBindings.Single();
        var error = Assert.Throws<ProjectComponentSnapshotException>(() => fixture.Snapshots.Place(
            fixture.ProjectId, fixture.HarnessId, new ProjectCommandEnvelope(Guid.NewGuid(), saved.Revision),
            placementId, fixture.Template, article.SourceId, article.EntityType, article.ArticleKey, instance.ToJsonString()));
        Assert.Equal("invalid_electrical_graph", error.Code);
        Assert.Equal(saved, fixture.Designs.Get(fixture.ProjectId, fixture.HarnessId));
        Assert.Equal(fixture.PlacementId, Assert.Single(fixture.Snapshots.ListPlacements(fixture.ProjectId, fixture.HarnessId)).PlacementId);
    }

    [Theory]
    [InlineData("contacts")]
    [InlineData("from")]
    [InlineData("to")]
    [InlineData("marker-zero")]
    [InlineData("marker-future")]
    [InlineData("marker-null")]
    [InlineData("writer-zero")]
    [InlineData("writer-future")]
    public void Strict_writer_rejects_missing_graph_fields_and_unknown_versions(string mutation)
    {
        using var fixture = new Fixture();
        var graph = Graph(fixture.PlacementId, fixture.Template);
        var before = fixture.Designs.Get(fixture.ProjectId, fixture.HarnessId);
        int writer = 1;
        switch (mutation)
        {
            case "contacts": graph["connectors"]![0]!.AsObject().Remove("contacts"); break;
            case "from": graph["wires"]![0]!.AsObject().Remove("from"); break;
            case "to": graph["wires"]![0]!.AsObject().Remove("to"); break;
            case "marker-zero": graph["requiredWriterContractVersion"] = 0; break;
            case "marker-future": graph["requiredWriterContractVersion"] = 2; break;
            case "marker-null": graph["requiredWriterContractVersion"] = null; break;
            case "writer-zero": writer = 0; break;
            case "writer-future": writer = 2; break;
        }
        var error = Assert.Throws<HarnessDesignDocumentException>(() => fixture.Designs.Put(
            fixture.ProjectId, fixture.HarnessId, before.Revision, 1, graph.ToJsonString(), writer));
        Assert.Equal(mutation.Contains('-') ? "unsupported_design_writer_contract" : "invalid_electrical_graph", error.Code);
        Assert.Equal(before, fixture.Designs.Get(fixture.ProjectId, fixture.HarnessId));
    }

    [Theory]
    [InlineData("duplicate-connector")]
    [InlineData("duplicate-contact")]
    [InlineData("duplicate-wire")]
    [InlineData("duplicate-junction")]
    [InlineData("duplicate-screen")]
    [InlineData("duplicate-pair")]
    [InlineData("connector")]
    [InlineData("contact")]
    [InlineData("missing-contact")]
    [InlineData("endpoint-type")]
    [InlineData("junction")]
    [InlineData("junction-members")]
    [InlineData("screen")]
    [InlineData("screen-side")]
    [InlineData("screen-self")]
    [InlineData("mixed-endpoint")]
    [InlineData("pair-wire")]
    [InlineData("pair-duplicate-wire")]
    [InlineData("pair-exclusivity")]
    [InlineData("screen-wire")]
    [InlineData("junction-wire")]
    public void Invalid_graph_save_preserves_revision_and_placement_index(string mutation)
    {
        using var fixture = new Fixture();
        var initial = fixture.Designs.Get(fixture.ProjectId, fixture.HarnessId);
        var graph = Graph(fixture.PlacementId, fixture.Template);
        var saved = fixture.Designs.Put(fixture.ProjectId, fixture.HarnessId, initial.Revision, 1, graph.ToJsonString());
        var placements = fixture.Snapshots.ListPlacements(fixture.ProjectId, fixture.HarnessId);
        Mutate(graph, mutation);
        var error = Assert.Throws<HarnessDesignDocumentException>(() => fixture.Designs.Put(
            fixture.ProjectId, fixture.HarnessId, saved.Revision, 1, graph.ToJsonString()));
        Assert.Equal("invalid_electrical_graph", error.Code);
        Assert.StartsWith("content.", error.Field);
        var after = fixture.Designs.Get(fixture.ProjectId, fixture.HarnessId);
        Assert.Equal(saved.Revision, after.Revision);
        Assert.Equal(saved.ContentJson, after.ContentJson);
        Assert.Equal(placements, fixture.Snapshots.ListPlacements(fixture.ProjectId, fixture.HarnessId));
    }

    [Fact]
    public void Valid_legacy_shells_round_trip_and_contact_ids_are_scoped_to_connector()
    {
        using var fixture = new Fixture();
        var initial = fixture.Designs.Get(fixture.ProjectId, fixture.HarnessId);
        var legacy = JsonNode.Parse("""
        {"schemaVersion":1,"connectors":[{"id":"A"},{"id":"B"}],
        "wires":[{"id":"W","from":{"connectorId":"A"},"to":{"connectorId":"B"}},{"id":"old-wire"}]}
        """)!;
        var saved = fixture.Designs.Put(fixture.ProjectId, fixture.HarnessId, initial.Revision, 1, legacy.ToJsonString());
        Assert.True(JsonElement.DeepEquals(JsonSerializer.SerializeToElement(legacy), JsonSerializer.Deserialize<JsonElement>(saved.ContentJson)));
        legacy["connectors"]![0]!["contacts"] = new JsonArray(new JsonObject { ["id"] = "same" });
        legacy["connectors"]![1]!["contacts"] = new JsonArray(new JsonObject { ["id"] = "same" });
        legacy["wires"]![0]!["from"]!["contactId"] = "same";
        legacy["wires"]![0]!["to"]!["contactId"] = "same";
        _ = fixture.Designs.Put(fixture.ProjectId, fixture.HarnessId, saved.Revision, 1, legacy.ToJsonString());
    }

    private static JsonObject Graph(Guid placementId, ComponentTemplateVersion template)
    {
        var graph = JsonNode.Parse("""
        {"schemaVersion":1,"connectors":[{"id":"A","contacts":[{"id":"a"}]},{"id":"B","contacts":[{"id":"b"}]}],
        "wires":[
          {"id":"w1","from":{"connectorId":"A","contactId":"a"},"to":{"junctionId":"j","connectorId":"","contactId":""}},
          {"id":"w2","from":{"junctionId":"j"},"to":{"connectorId":"B","contactId":"b"}},
          {"id":"ground","from":{"screenId":"s","screenTerminalSide":"above"},"to":{"connectorId":"A","contactId":"a"}}],
        "junctions":[{"id":"j","wireIds":["w1","w2"]}],
        "diffPairs":[{"id":"pair","wireIds":["w1","w2"]}],
        "screens":[{"id":"s","wireIds":["w1","w2"],"terminalSide":"above"}]}
        """)!.AsObject();
        // Keep the actual template placement in the document throughout failed saves.
        graph["connectors"]!.AsArray().Add(JsonNode.Parse(Fixture.BoundInstance(placementId, template)));
        return graph;
    }

    private static void Mutate(JsonObject graph, string mutation)
    {
        var wires = graph["wires"]!;
        switch (mutation)
        {
            case "duplicate-connector": Duplicate("connectors"); break;
            case "duplicate-contact": graph["connectors"]![0]!["contacts"]!.AsArray().Add(new JsonObject { ["id"] = "a" }); break;
            case "duplicate-wire": Duplicate("wires"); break;
            case "duplicate-junction": Duplicate("junctions"); break;
            case "duplicate-screen": Duplicate("screens"); break;
            case "duplicate-pair": Duplicate("diffPairs"); break;
            case "connector": wires[0]!["from"]!["connectorId"] = "missing"; break;
            case "contact": wires[0]!["from"]!["contactId"] = "b"; break;
            case "missing-contact": wires[0]!["from"]!.AsObject().Remove("contactId"); break;
            case "endpoint-type": wires[0]!["from"] = null; break;
            case "junction": wires[0]!["to"]!["junctionId"] = "missing"; break;
            case "junction-members": graph["junctions"]![0]!["wireIds"] = new JsonArray("w2", "ground"); break;
            case "screen": wires[2]!["from"]!["screenId"] = "missing"; break;
            case "screen-side": wires[2]!["from"]!["screenTerminalSide"] = "below"; break;
            case "screen-self": graph["screens"]![0]!["wireIds"] = new JsonArray("ground"); break;
            case "mixed-endpoint": wires[2]!["from"]!["junctionId"] = "j"; break;
            case "pair-wire": graph["diffPairs"]![0]!["wireIds"] = new JsonArray("w1", "missing"); break;
            case "pair-duplicate-wire": graph["diffPairs"]![0]!["wireIds"] = new JsonArray("w1", "w1"); break;
            case "pair-exclusivity": graph["diffPairs"]!.AsArray().Add(new JsonObject { ["id"] = "pair2", ["wireIds"] = new JsonArray("w1", "ground") }); break;
            case "screen-wire": graph["screens"]![0]!["wireIds"] = new JsonArray("missing"); break;
            case "junction-wire": graph["junctions"]![0]!["wireIds"] = new JsonArray("w1", "missing"); break;
        }
        void Duplicate(string property) => graph[property]!.AsArray().Add(graph[property]![0]!.DeepClone());
    }

    private sealed class Fixture : IDisposable
    {
        private readonly string root = Path.Combine(Path.GetTempPath(), "techmap-electrical-" + Guid.NewGuid().ToString("N"));
        private readonly SqliteStorage storage;
        public ProjectIdentity ProjectId { get; }
        public HarnessIdentity HarnessId { get; }
        public Guid PlacementId { get; } = Guid.NewGuid();
        public ComponentTemplateVersion Template { get; }
        public SqliteHarnessDesignDocumentStore Designs { get; }
        public SqliteProjectComponentSnapshotStore Snapshots { get; }

        public Fixture()
        {
            Directory.CreateDirectory(root);
            storage = SqliteStorage.Open(root);
            var catalog = new SqliteProjectCatalog(storage);
            var project = catalog.CreateProject(new CreateProjectCommand("P", "Electrical graph", 1, ProjectStatus.Draft));
            ProjectId = project.ProjectId;
            HarnessId = catalog.AddHarness(ProjectId, "W1").Harnesses.Single().HarnessId;
            var article = ComponentTemplateContentV3ValidatorTests.ValidArticleBindings.Single();
            Template = new SqliteComponentTemplateStore(storage, TimeProvider.System).Create("XH", "Series", [article], 3, ComponentTemplateContentV3ValidatorTests.ValidContentJson);
            Designs = new(storage, TimeProvider.System);
            Snapshots = new(storage, TimeProvider.System);
            _ = Snapshots.Place(ProjectId, HarnessId, new ProjectCommandEnvelope(Guid.NewGuid(), 0), PlacementId, Template,
                article.SourceId, article.EntityType, article.ArticleKey, BoundInstance(PlacementId, Template));
        }

        public static string BoundInstance(Guid id, ComponentTemplateVersion template) => new JsonObject
        {
            ["id"] = id.ToString("D"), ["contacts"] = new JsonArray(),
            ["libraryBinding"] = new JsonObject
            {
                ["mode"] = "template", ["templateId"] = template.TemplateId.ToString("D"), ["templateVersion"] = template.Version,
                ["versionSha256"] = template.VersionSha256,
                ["article"] = new JsonObject { ["sourceId"] = "technology-database", ["entityType"] = "connector", ["articleKey"] = "B2B-XH-A" },
            },
        }.ToJsonString();

        public void Dispose()
        {
            storage.Dispose();
            Directory.Delete(root, recursive: true);
        }
    }
}
