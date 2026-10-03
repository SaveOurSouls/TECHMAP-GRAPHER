using Techmap.Application;
using System.Text.Json;
using System.Text.Json.Nodes;
using Techmap.Infrastructure.Sqlite;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class ManufacturingRouteValidatorTests
{
    [Fact]
    public void Shared_operation_role_is_limited_to_assembly_rows()
    {
        var graph = BaseRoute();
        graph["manufacturingRoute"]!["rows"]![1]!["role"] = "sharedOperation";
        Validate(graph);
        graph["manufacturingRoute"]!["rows"]![0]!["role"] = "sharedOperation";
        Assert.Throws<HarnessDesignDocumentException>(() => Validate(graph));
    }
    [Fact]
    public void Components_accept_metrics_and_reject_extra_fields_or_mismatched_refs()
    {
        var graph = BaseRoute();
        graph["manufacturingRoute"]!["rows"]![0]!["components"] = new JsonArray(new JsonObject { ["ref"] = new JsonObject { ["kind"] = "wire", ["id"] = "w" }, ["index"] = "ПФ-01", ["title"] = "Wire", ["quantity"] = 2, ["reserve"] = 1, ["operationTimeMinutes"] = 3 });
        Validate(graph);
        graph["manufacturingRoute"]!["rows"]![0]!["components"]![0]!["extra"] = true;
        Assert.Throws<HarnessDesignDocumentException>(() => Validate(graph));
        graph = BaseRoute();
        graph["manufacturingRoute"]!["rows"]![0]!["components"] = new JsonArray(new JsonObject { ["ref"] = new JsonObject { ["kind"] = "wire", ["id"] = "missing" }, ["title"] = "Wire" });
        Assert.Throws<HarnessDesignDocumentException>(() => Validate(graph));
    }
    [Fact]
    public void Drawing_copy_accepts_design_and_rejects_nested_route()
    {
        var graph = BaseRoute();
        var copy = JsonNode.Parse("""{"schemaVersion":1,"connectors":[],"wires":[],"cables":[],"junctions":[],"diffPairs":[],"screens":[],"views":{"drawing":{"layers":[],"wireCrossingStyle":"none"},"e4":{"layers":[],"wireCrossingStyle":"none"}}}""")!.AsObject();
        graph["manufacturingRoute"]!["rows"]![1]!["presentation"]!["drawingCopy"] =
            new JsonObject { ["document"] = copy, ["hiddenObjectIds"] = new JsonArray("w") };
        Validate(graph);
        graph["manufacturingRoute"]!["rows"]![1]!["presentation"]!["drawingCopy"]!["document"]!["manufacturingRoute"] =
            new JsonObject();
        Assert.Throws<HarnessDesignDocumentException>(() => Validate(graph));
    }

    [Fact]
    public void Semi_finished_row_accepts_an_independent_drawing_copy()
    {
        var graph = BaseRoute();
        var copy = JsonNode.Parse("""{"schemaVersion":1,"connectors":[],"wires":[],"cables":[],"junctions":[],"diffPairs":[],"screens":[],"views":{"drawing":{"layers":[],"wireCrossingStyle":"none"},"e4":{"layers":[],"wireCrossingStyle":"none"}}}""")!;
        copy["drawingDocuments"] = JsonNode.Parse("""{"tables":[],"leaders":[],"bomOrder":[],"graphics":[{"id":"semi-graphic","view":"drawing","kind":"line","points":[{"x":0,"y":0},{"x":30,"y":0}]}]}""");
        graph["manufacturingRoute"]!["rows"]![0]!["presentation"]!["drawingCopy"] =
            new JsonObject { ["document"] = copy, ["hiddenObjectIds"] = new JsonArray() };

        Validate(graph);
    }

    [Fact]
    public void Drawing_copy_rejects_missing_design_collections_and_duplicate_hidden_ids()
    {
        var graph = BaseRoute();
        var copy = JsonNode.Parse("""{"schemaVersion":1,"connectors":[],"wires":[],"cables":[],"junctions":[],"diffPairs":[],"screens":[],"views":{"drawing":{},"e4":{}}}""")!;
        graph["manufacturingRoute"]!["rows"]![1]!["presentation"]!["drawingCopy"] =
            new JsonObject { ["document"] = copy, ["hiddenObjectIds"] = new JsonArray("a", "a") };
        Assert.Throws<HarnessDesignDocumentException>(() => Validate(graph));
        graph["manufacturingRoute"]!["rows"]![1]!["presentation"]!["drawingCopy"]!["hiddenObjectIds"] = new JsonArray();
        copy.AsObject().Remove("wires");
        Assert.Throws<HarnessDesignDocumentException>(() => Validate(graph));
    }

    [Fact]
    public void Fingerprint_tracks_measured_dimensions_and_quantity_but_not_drawing_scale_or_order()
    {
        var graph = JsonNode.Parse("""{"connectors":[],"wires":[{"id":"b","lengthMm":10.0},{"id":"a","lengthMm":12}],"drawingDocuments":{"dimensions":[{"id":"d","segmentId":"s","from":0,"to":1,"lengthMm":300,"auxiliary":false}],"scale":1}}""")!;
        string Hash(JsonNode value, long quantity = 1) { using var d = JsonDocument.Parse(value.ToJsonString()); return ManufacturingRouteSourceFingerprint.Compute(d.RootElement, quantity); }
        var original = Hash(graph);
        graph["drawingDocuments"]!["scale"] = 8;
        var first = graph["wires"]![0]!.DeepClone(); graph["wires"]!.AsArray().RemoveAt(0); graph["wires"]!.AsArray().Add(first);
        Assert.Equal(original, Hash(graph));
        Assert.NotEqual(original, Hash(graph, 2));
        graph["drawingDocuments"]!["dimensions"]![0]!["lengthMm"] = 301;
        Assert.NotEqual(original, Hash(graph));
    }

    [Theory]
    [InlineData("missing-dependency")]
    [InlineData("duplicate-dependency")]
    [InlineData("unknown-kind")]
    [InlineData("invalid-binding")]
    [InlineData("opacity")]
    [InlineData("extra-field")]
    public void Invalid_structural_route_is_rejected(string mutation)
    {
        var graph = BaseRoute(); var row = graph["manufacturingRoute"]!["rows"]![1]!;
        switch (mutation)
        {
            case "missing-dependency": row["dependsOn"] = new JsonArray("missing"); break;
            case "duplicate-dependency": row["dependsOn"] = new JsonArray("a", "a"); break;
            case "unknown-kind": row["kind"] = "other"; break;
            case "invalid-binding": row["operations"]![0]!["binding"] = new JsonObject(); break;
            case "opacity": row["presentation"]!["backgroundOpacity"] = 1.1; break;
            case "extra-field": row["oops"] = true; break;
        }
        Assert.Throws<HarnessDesignDocumentException>(() => Validate(graph));
    }

    [Theory]
    [InlineData(0.0)]
    [InlineData(0.5)]
    [InlineData(1.0)]
    public void Background_opacity_accepts_full_percent_range(double opacity)
    {
        var graph = BaseRoute();
        graph["manufacturingRoute"]!["rows"]![1]!["presentation"]!["backgroundOpacity"] = opacity;
        Validate(graph);
    }

    [Fact]
    public void Assembly_input_lines_accept_empty_and_dependency_backed_rows()
    {
        var graph = BaseRoute(); var row = graph["manufacturingRoute"]!["rows"]![1]!;
        row["dependsOn"] = new JsonArray(); row["assemblyInputs"] = new JsonArray();
        Validate(graph);
        row["dependsOn"] = new JsonArray("a");
        row["assemblyInputs"] = new JsonArray(new JsonObject { ["id"] = "input-a", ["kind"] = "row", ["rowId"] = "a" });
        Validate(graph);
    }

    [Theory]
    [InlineData("missing-line")]
    [InlineData("duplicate-line")]
    [InlineData("wrong-row")]
    [InlineData("extra-field")]
    public void Assembly_input_lines_reject_drift_and_malformed_entries(string mutation)
    {
        var graph = BaseRoute(); var row = graph["manufacturingRoute"]!["rows"]![1]!;
        var input = new JsonObject { ["id"] = "input-a", ["kind"] = "row", ["rowId"] = "a" };
        var inputs = new JsonArray(input);
        switch (mutation)
        {
            case "missing-line": inputs.Clear(); break;
            case "duplicate-line": inputs.Add(input.DeepClone()); break;
            case "wrong-row": input["rowId"] = "missing"; break;
            case "extra-field": input["extra"] = true; break;
        }
        row["assemblyInputs"] = inputs;
        Assert.Throws<HarnessDesignDocumentException>(() => Validate(graph));
    }

    [Fact]
    public void Wire_blank_selection_and_drawing_scene_are_validated_and_pinned()
    {
        var graph = BaseRoute();
        var row = graph["manufacturingRoute"]!["rows"]![0]!;
        row["wireBlankSelections"] = new JsonArray(new JsonObject
        {
            ["wireId"] = "w",
            ["binding"] = new JsonObject
            {
                ["sourceId"] = "technology-wire-blanks", ["entityType"] = "wire-blank",
                ["snapshotId"] = Guid.NewGuid().ToString("D"), ["snapshotSha256"] = new string('a', 64),
                ["recordId"] = new string('b', 64), ["sourceKey"] = "ПФП-01", ["displayName"] = "Провод нарезан",
                ["visual"] = new JsonObject { ["start"] = "cut", ["end"] = "cut", ["color"] = "#26609e", ["templateId"] = "01-cut", ["photoDataUrl"] = null },
            },
        });
        row["presentation"]!["drawingObjects"] = new JsonArray(new JsonObject
        {
            ["id"] = "pipe-1", ["kind"] = "physical-pipe", ["layerId"] = "pipes",
            ["points"] = new JsonArray(new JsonObject { ["x"] = 1, ["y"] = 2 }), ["hidden"] = true,
        });
        Validate(graph);
        row["wireBlankSelections"]!.AsArray().Add(row["wireBlankSelections"]![0]!.DeepClone());
        Assert.Throws<HarnessDesignDocumentException>(() => Validate(graph));
    }

    [Fact]
    public void Wire_blank_selection_rejects_wrong_source_and_orphan_wire()
    {
        var graph = BaseRoute();
        var row = graph["manufacturingRoute"]!["rows"]![0]!;
        row["wireBlankSelections"] = new JsonArray(new JsonObject
        {
            ["wireId"] = "missing",
            ["binding"] = new JsonObject
            {
                ["sourceId"] = "other", ["entityType"] = "wire-blank", ["snapshotId"] = Guid.NewGuid().ToString("D"),
                ["snapshotSha256"] = new string('a', 64), ["recordId"] = new string('b', 64), ["sourceKey"] = "x", ["displayName"] = "x",
                ["visual"] = new JsonObject { ["start"] = "cut", ["end"] = "cut", ["color"] = "#26609e", ["templateId"] = "01-cut", ["photoDataUrl"] = null },
            },
        });
        Assert.Throws<HarnessDesignDocumentException>(() => Validate(graph));
    }

    [Fact]
    public void Fingerprint_ignores_derived_routes_and_route_root_but_tracks_source()
    {
        using var baseDocument = JsonDocument.Parse("""{"schemaVersion":1,"connectors":[],"wires":[{"id":"w","lengthMm":10}],"physicalTopology":{"nodes":[],"segments":[]}}""");
        using var derivedDocument = JsonDocument.Parse("""{"schemaVersion":1,"connectors":[],"wires":[{"id":"w","lengthMm":10,"e4Route":[{"x":1,"y":2}]}],"physicalTopology":{"nodes":[],"segments":[]},"manufacturingRoute":{"status":"draft"}}""");
        Assert.Equal(ManufacturingRouteSourceFingerprint.Compute(baseDocument.RootElement, 2), ManufacturingRouteSourceFingerprint.Compute(derivedDocument.RootElement, 2));
        using var changed = JsonDocument.Parse("""{"schemaVersion":1,"connectors":[],"wires":[{"id":"w","lengthMm":11}],"physicalTopology":{"nodes":[],"segments":[]}}""");
        Assert.NotEqual(ManufacturingRouteSourceFingerprint.Compute(baseDocument.RootElement, 2), ManufacturingRouteSourceFingerprint.Compute(changed.RootElement, 2));
    }

    [Fact]
    public void Route_contract_accepts_draft_and_rejects_cycle_duplicate_and_incomplete_completion()
    {
        var route = BaseRoute();
        Validate(route);
        route["manufacturingRoute"]!["rows"]![0]!["dependsOn"] = new JsonArray("final");
        Assert.Throws<HarnessDesignDocumentException>(() => Validate(route));
        route = BaseRoute(); route["manufacturingRoute"]!["rows"]![1]!["sourceObjects"]!.AsArray().Add(new JsonObject { ["kind"] = "wire", ["id"] = "w" });
        Assert.Throws<HarnessDesignDocumentException>(() => Validate(route));
        route = BaseRoute(); route["manufacturingRoute"]!["status"] = "completed";
        Assert.Throws<HarnessDesignDocumentException>(() => Validate(route));
    }

    [Fact]
    public void Completed_route_requires_bound_prepared_rows_and_reaches_all_rows()
    {
        var route = BaseRoute();
        route["manufacturingRoute"]!["status"] = "completed";
        route["manufacturingRoute"]!["rows"]![0]!["prepared"] = true;
        route["manufacturingRoute"]!["rows"]![1]!["prepared"] = true;
        var binding = new JsonObject { ["sourceId"] = "ops", ["entityType"] = "operation", ["snapshotId"] = Guid.NewGuid().ToString("D"), ["snapshotSha256"] = new string('a', 64), ["recordId"] = new string('b', 64), ["sourceKey"] = "cut", ["displayName"] = "Cut" };
        route["manufacturingRoute"]!["rows"]![0]!["operations"]![0]!["binding"] = binding.DeepClone();
        route["manufacturingRoute"]!["rows"]![1]!["operations"]![0]!["binding"] = binding;
        Validate(route);
    }

    [Fact]
    public void Completed_route_detects_incomparable_parent_presentation_conflict_and_explicit_resolution()
    {
        var graph = BaseRoute(); var route = graph["manufacturingRoute"]!; var rows = route["rows"]!.AsArray();
        var source = rows[0]!;
        JsonNode Branch(string id, bool hidden)
        {
            var branch = rows[1]!.DeepClone(); branch["id"] = id; branch["kind"] = "semiFinished";
            branch["operations"]![0]!["id"] = "op-" + id;
            branch["presentation"]!["objects"] = source["presentation"]!["objects"]!.DeepClone();
            branch["presentation"]!["objects"]![0]!["hidden"] = hidden;
            return branch;
        }
        rows.Add(Branch("left", true)); rows.Add(Branch("right", false));
        rows[1]!["dependsOn"] = new JsonArray("left", "right");
        var binding = new JsonObject { ["sourceId"] = "ops", ["entityType"] = "operation", ["snapshotId"] = Guid.NewGuid().ToString("D"), ["snapshotSha256"] = new string('a', 64), ["recordId"] = new string('b', 64), ["sourceKey"] = "cut", ["displayName"] = "Cut" };
        foreach (var row in rows) { row!["prepared"] = true; row["operations"]![0]!["binding"] = binding.DeepClone(); }
        route["status"] = "completed";
        Assert.Contains("conflict", Assert.Throws<HarnessDesignDocumentException>(() => Validate(graph)).Message);
        rows[1]!["presentation"]!["objects"] = source["presentation"]!["objects"]!.DeepClone();
        Validate(graph);
    }

    private static void Validate(JsonObject route)
    {
        using var document = JsonDocument.Parse(route.ToJsonString());
        ManufacturingRouteValidator.Validate(document.RootElement);
    }

    [Theory]
    [InlineData("valid")]
    [InlineData("unknown")]
    [InlineData("unknown-length")]
    [InlineData("zero")]
    public void Terminal_requirement_preserves_pinned_norm_and_explicit_unknown(string mode)
    {
        var graph = BaseRoute(); var requirement = TerminalRequirement();
        if (mode is "unknown" or "unknown-length") requirement["stripLengthMm"] = null;
        if (mode == "unknown") requirement["binding"] = null;
        if (mode == "zero") requirement["stripLengthMm"] = 0;
        graph["manufacturingRoute"]!["rows"]![0]!["terminalRequirements"] = new JsonArray(requirement);
        Validate(graph);
    }

    [Theory]
    [InlineData("duplicate")]
    [InlineData("other-wire")]
    [InlineData("end")]
    [InlineData("negative")]
    [InlineData("precision")]
    [InlineData("too-large")]
    [InlineData("unbound-length")]
    [InlineData("wrong-key")]
    [InlineData("wrong-type")]
    [InlineData("bad-hash")]
    [InlineData("empty-uuid")]
    [InlineData("extra-field")]
    public void Terminal_requirement_rejects_invalid_or_unowned_norm(string mutation)
    {
        var graph = BaseRoute(); var requirement = TerminalRequirement();
        switch (mutation)
        {
            case "other-wire": requirement["wireId"] = "other"; break;
            case "end": requirement["end"] = "middle"; break;
            case "negative": requirement["stripLengthMm"] = -1; break;
            case "precision": requirement["stripLengthMm"] = 4.1234; break;
            case "too-large": requirement["stripLengthMm"] = 1_000_000_001; break;
            case "unbound-length": requirement["binding"] = null; break;
            case "wrong-key": requirement["binding"]!["sourceKey"] = "OTHER"; break;
            case "wrong-type": requirement["binding"]!["entityType"] = "coax-termination"; break;
            case "bad-hash": requirement["binding"]!["recordId"] = "record"; break;
            case "empty-uuid": requirement["binding"]!["snapshotId"] = Guid.Empty.ToString("D"); break;
            case "extra-field": requirement["diameterMm"] = 1; break;
        }
        var requirements = new JsonArray(requirement);
        if (mutation == "duplicate") requirements.Add(requirement.DeepClone());
        graph["manufacturingRoute"]!["rows"]![0]!["terminalRequirements"] = requirements;
        Assert.Throws<HarnessDesignDocumentException>(() => Validate(graph));
    }

    private static JsonObject TerminalRequirement() => new()
    {
        ["wireId"] = "w", ["end"] = "from", ["terminalArticle"] = "TERM", ["stripLengthMm"] = 4.125,
        ["binding"] = new JsonObject { ["sourceId"] = "technology-terminals", ["entityType"] = "terminal", ["snapshotId"] = Guid.NewGuid().ToString("D"),
            ["snapshotSha256"] = new string('a', 64), ["recordId"] = new string('b', 64), ["sourceKey"] = "TERM", ["displayName"] = "Terminal" },
    };

    private static JsonObject BaseRoute() => JsonNode.Parse("""
    {"schemaVersion":1,"connectors":[],"wires":[{"id":"w"}],"cables":[],"physicalTopology":{"coverings":[]},
     "manufacturingRoute":{"contractVersion":1,"source":{"fingerprintVersion":1,"sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},"status":"draft","rows":[
      {"id":"a","kind":"semiFinished","title":"Wire","comment":"","sourceObjects":[{"kind":"wire","id":"w"}],"dependsOn":[],"operations":[{"id":"op-a","binding":null,"mode":"cut","note":""}],"presentation":{"backgroundOpacity":0.25,"objects":[{"ref":{"kind":"wire","id":"w"},"points":[],"hidden":false}]},"prepared":false},
      {"id":"final","kind":"assembly","title":"Assembly","comment":"","sourceObjects":[],"dependsOn":["a"],"operations":[{"id":"op-final","binding":null,"mode":"assembly","note":""}],"presentation":{"backgroundOpacity":0.25,"objects":[]},"prepared":false}
     ]}}
    """)!.AsObject();
}
