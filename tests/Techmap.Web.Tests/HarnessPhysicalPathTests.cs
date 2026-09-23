using System.Text.Json;
using System.Text.Json.Nodes;
using Techmap.Application;
using Techmap.Infrastructure.Sqlite;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class HarnessPhysicalPathTests
{
    private static JsonObject Fixture() => JsonNode.Parse("""
      {"connectors":[{"id":"A","contacts":[{"id":"c1"}]}],"wires":[],"physicalTopology":{
        "snap":true,"nodes":[{"id":"N1","connectorId":"A","position":{"x":0,"y":0},"direction":"right","contactDirections":{"c1":"up"}},
        {"id":"N2","position":{"x":100,"y":0}}],"segments":[{"id":"S","from":"N1","to":"N2","path":{"kind":"polyline","points":[]}}],"routes":[]}}
      """)!.AsObject();
    private static void Validate(JsonObject root)
    {
        using var json = JsonDocument.Parse(root.ToJsonString());
        HarnessPhysicalTopologyValidator.Validate(json.RootElement);
    }

    [Theory]
    [InlineData("routed")]
    [InlineData("polyline")]
    [InlineData("auto")]
    [InlineData("fixed")]
    public void Accepts_current_and_legacy_path_sources(string kind)
    {
        var root = Fixture();
        var segment = root["physicalTopology"]!["segments"]![0]!.AsObject();
        if (kind is "auto" or "fixed") { segment.Remove("path"); segment["bends"] = new JsonArray(); segment["routing"] = kind; }
        else segment["path"]!["kind"] = kind;
        Validate(root);
    }

    [Theory]
    [InlineData("kind")]
    [InlineData("point")]
    [InlineData("mixed")]
    [InlineData("routing")]
    [InlineData("direction")]
    [InlineData("contact")]
    [InlineData("contactDirection")]
    public void Rejects_invalid_sources_and_directions(string mutation)
    {
        var root = Fixture();
        var segment = root["physicalTopology"]!["segments"]![0]!.AsObject();
        var node = root["physicalTopology"]!["nodes"]![0]!;
        switch (mutation)
        {
            case "kind": segment["path"]!["kind"] = "fixed"; break;
            case "point": segment["path"]!["points"] = new JsonArray(new JsonObject { ["x"] = 0, ["y"] = "bad" }); break;
            case "mixed": segment["bends"] = new JsonArray(); break;
            case "routing": segment.Remove("path"); segment["bends"] = new JsonArray(); segment["routing"] = "bad"; break;
            case "direction": node["direction"] = "diagonal"; break;
            case "contact": node["contactDirections"]!["missing"] = "up"; break;
            case "contactDirection": node["contactDirections"]!["c1"] = "bad"; break;
        }
        Assert.Throws<HarnessDesignDocumentException>(() => Validate(root));
    }
}
