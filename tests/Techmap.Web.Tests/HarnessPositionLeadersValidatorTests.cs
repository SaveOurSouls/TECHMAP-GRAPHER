using System.Text.Json;
using System.Text.Json.Nodes;
using Techmap.Application;
using Techmap.Infrastructure.Sqlite;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class HarnessPositionLeadersValidatorTests
{
    private static JsonObject Fixture() => JsonNode.Parse("""
        {"connectors":[{"id":"XS1"}],"wires":[],"cables":[],"drawingDocuments":{
          "tables":[],"bomOrder":[],"bomText":{"row":{"index":"XS1, XS2","designation":"PART","name":"2 конт. — Розетка"}},
          "leaders":[{"id":"L","objectId":"XS1","rowKey":"row","anchorOffset":{"x":120,"y":20},"anchorLocal":{"x":60,"y":10},"circle":{"x":200,"y":10},"hidden":true}]
        }}
        """)!.AsObject();

    private static void Validate(JsonObject value)
    {
        using var json = JsonDocument.Parse(value.ToJsonString());
        HarnessDrawingDocumentsValidator.Validate(json.RootElement);
    }

    [Fact]
    public void Accepts_local_perimeter_attachment_group_visibility_and_bom_index_with_legacy_compatibility()
    {
        var document = Fixture();
        Validate(document);
        var leader = document["drawingDocuments"]!["leaders"]![0]!.AsObject();
        leader.Remove("anchorLocal");
        leader.Remove("hidden");
        Validate(document);
        // A deleted target remains a diagnosed orphan instead of being rebound.
        document["connectors"] = new JsonArray();
        Validate(document);
    }

    [Theory]
    [InlineData("visibility")]
    [InlineData("local-point")]
    [InlineData("local-range")]
    [InlineData("index")]
    public void Rejects_invalid_persisted_position_fields(string mutation)
    {
        var document = Fixture();
        var leader = document["drawingDocuments"]!["leaders"]![0]!;
        switch (mutation)
        {
            case "visibility": leader["hidden"] = "true"; break;
            case "local-point": leader["anchorLocal"]!["x"] = null; break;
            case "local-range": leader["anchorLocal"]!["x"] = 10000001; break;
            case "index": document["drawingDocuments"]!["bomText"]!["row"]!["index"] = 12; break;
        }
        Assert.Throws<HarnessDesignDocumentException>(() => Validate(document));
    }
}
