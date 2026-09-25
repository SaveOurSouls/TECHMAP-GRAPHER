using System.Text.Json;
using System.Text.Json.Nodes;
using Techmap.Application;
using Techmap.Infrastructure.Sqlite;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class HarnessPipeBundleTests
{
    private static JsonObject Member(string id, string kind = "segment") => new() { ["kind"] = kind, ["id"] = id };
    private static JsonObject Cover(string id, params JsonObject[] members) => new()
    {
        ["id"] = id, ["name"] = id, ["width"] = 0, ["color"] = "#8899aa", ["lengthMm"] = null,
        ["spans"] = new JsonArray(new JsonObject { ["segmentId"] = "s0", ["from"] = .2, ["to"] = .8 }),
        ["bundle"] = new JsonObject { ["mode"] = "round", ["members"] = new JsonArray(members.Cast<JsonNode?>().ToArray()) }
    };
    private static JsonObject Fixture() => JsonNode.Parse("""
    {"connectors":[],"wires":[],"physicalTopology":{"snap":false,
     "nodes":[{"id":"a","position":{"x":0,"y":0}},{"id":"b","position":{"x":200,"y":0}}],
     "segments":[{"id":"s0","from":"a","to":"b","path":{"kind":"routed","points":[]}},
                 {"id":"s1","from":"a","to":"b","path":{"kind":"routed","points":[]}},
                 {"id":"s2","from":"a","to":"b","path":{"kind":"routed","points":[]}}],"routes":[]}}
    """)!.AsObject();
    private static void Validate(JsonObject root)
    { using var json = JsonDocument.Parse(root.ToJsonString()); HarnessPhysicalTopologyValidator.Validate(json.RootElement); }
    [Fact] public void Accepts_nested_groups_independent_of_paint_order()
    {
        var root = Fixture(); root["physicalTopology"]!["coverings"] = new JsonArray(
            Cover("outer", Member("inner", "covering"), Member("s2")), Cover("inner", Member("s0"), Member("s1")));
        Validate(root);
    }
    [Fact] public void Accepts_longitudinal_fragments_as_one_member()
    {
        var root = Fixture();
        root["physicalTopology"]!["nodes"]!.AsArray().Add(new JsonObject { ["id"] = "mid", ["position"] = new JsonObject { ["x"] = 100, ["y"] = 0 } });
        root["physicalTopology"]!["segments"]![0]!["to"] = "mid";
        root["physicalTopology"]!["segments"]![1]!["from"] = "mid";
        var chain = Member("s0"); chain["continuationIds"] = new JsonArray("s1");
        var inner = Cover("inner", chain, Member("s2"));
        inner["spans"]!.AsArray().Add(new JsonObject { ["segmentId"] = "s1", ["from"] = 0, ["to"] = .5 });
        root["physicalTopology"]!["coverings"] = new JsonArray(inner);
        Validate(root);
    }
    [Theory]
    [InlineData("null")][InlineData("[]")][InlineData("[\"missing\"]")]
    [InlineData("[\"s0\"]")][InlineData("[\"s1\"]")][InlineData("[12]")]
    public void Rejects_invalid_or_disconnected_continuations(string value)
    {
        var root = Fixture(); var chain = Member("s0"); chain["continuationIds"] = JsonNode.Parse(value);
        root["physicalTopology"]!["coverings"] = new JsonArray(Cover("c", chain, Member("s2")));
        Assert.Throws<HarnessDesignDocumentException>(() => Validate(root));
    }
    [Fact] public void Rejects_continuations_on_group_reference()
    {
        var root = Fixture(); var member = Member("inner", "covering"); member["continuationIds"] = new JsonArray("s1");
        root["physicalTopology"]!["coverings"] = new JsonArray(Cover("inner", Member("s0"), Member("s1")), Cover("outer", member, Member("s2")));
        Assert.Throws<HarnessDesignDocumentException>(() => Validate(root));
    }
    [Theory]
    [InlineData("null")][InlineData("[]")][InlineData("{}")]
    [InlineData("{\"mode\":\"wrong\",\"members\":[]}")]
    [InlineData("{\"mode\":\"flat\",\"members\":[{\"kind\":\"segment\",\"id\":\"s0\"}]}")]
    [InlineData("{\"mode\":\"flat\",\"members\":[{\"kind\":\"segment\",\"id\":\"s0\"},null]}")]
    [InlineData("{\"mode\":\"round\",\"members\":[{\"kind\":\"segment\",\"id\":\"s0\"},{\"kind\":\"segment\",\"id\":\"s0\"}]}")]
    [InlineData("{\"mode\":\"flat\",\"members\":[{\"kind\":\"segment\",\"id\":\"s0\"},{\"kind\":\"covering\",\"id\":\"missing\"}]}")]
    public void Rejects_malformed_bundle(string value)
    {
        var root = Fixture(); var c = Cover("c"); c["bundle"] = JsonNode.Parse(value);
        root["physicalTopology"]!["coverings"] = new JsonArray(c);
        Assert.Throws<HarnessDesignDocumentException>(() => Validate(root));
    }
    [Fact] public void Rejects_cycles_and_duplicate_nested_leaves()
    {
        var root = Fixture(); root["physicalTopology"]!["coverings"] = new JsonArray(
            Cover("a", Member("s0"), Member("b", "covering")), Cover("b", Member("s1"), Member("a", "covering")));
        Assert.Throws<HarnessDesignDocumentException>(() => Validate(root));
        root["physicalTopology"]!["coverings"] = new JsonArray(
            Cover("a", Member("s0"), Member("s1")), Cover("b", Member("a", "covering"), Member("s0")));
        Assert.Throws<HarnessDesignDocumentException>(() => Validate(root));
    }
    [Fact] public void Rejects_unrelated_axis_and_plain_covering_reference()
    {
        var root = Fixture(); root["physicalTopology"]!["coverings"] = new JsonArray(Cover("c", Member("s1"), Member("s2")));
        Assert.Throws<HarnessDesignDocumentException>(() => Validate(root));
        var plain = Cover("plain"); plain.Remove("bundle");
        root["physicalTopology"]!["coverings"] = new JsonArray(plain, Cover("outer", Member("plain", "covering"), Member("s0")));
        Assert.Throws<HarnessDesignDocumentException>(() => Validate(root));
    }
}
