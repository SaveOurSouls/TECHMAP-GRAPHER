using System.Text.Json;
using System.Text.Json.Nodes;
using Techmap.Application;
using Techmap.Infrastructure.Sqlite;
using Xunit;

namespace Techmap.Web.Tests;
public sealed class HarnessDrawingDimensionsValidatorTests
{
    [Fact]
    public void Auxiliary_dimensions_do_not_override_manufacturing_lengths_and_flags_are_validated()
    {
        var root=Fixture();var dimensions=root["drawingDocuments"]!["dimensions"]!.AsArray();
        var auxiliary=dimensions[0]!.DeepClone();auxiliary["id"]="AUX";auxiliary["lengthMm"]=999;auxiliary["auxiliary"]=true;auxiliary["modeOverride"]=false;dimensions.Add(auxiliary);
        root["drawingDocuments"]!["dimensionMode"]="vertical";Validate(root);
        auxiliary["auxiliary"]="true";Assert.Throws<HarnessDesignDocumentException>(()=>Validate(root));
        auxiliary["auxiliary"]=true;root["drawingDocuments"]!["dimensionMode"]="bad";Assert.Throws<HarnessDesignDocumentException>(()=>Validate(root));
    }
    private static JsonObject Fixture()
    {
        var routeKey=JsonSerializer.Serialize(new object[]{"c:A:1","c:B:2",2});
        JsonObject Dimension(string id,int from,int to,decimal length)=>new(){["id"]=id,["wireId"]="W",["from"]=from,["to"]=to,["pointCount"]=4,["routeKey"]=routeKey,["mode"]="aligned",["offset"]=40,["lengthMm"]=length};
        return new JsonObject {
            ["wires"]=new JsonArray(new JsonObject{["id"]="W",["from"]=new JsonObject{["connectorId"]="A",["contactId"]="1"},["to"]=new JsonObject{["connectorId"]="B",["contactId"]="2"},["drawingRoute"]=new JsonArray(new JsonObject{["x"]=100,["y"]=10},new JsonObject{["x"]=200,["y"]=50}),["lengthMm"]=300.25m}),
            ["drawingDocuments"]=new JsonObject{["tables"]=new JsonArray(),["leaders"]=new JsonArray(),["bomOrder"]=new JsonArray(),["dimensions"]=new JsonArray(Dimension("D1",0,1,100.125m),Dimension("D2",1,3,200.125m))}
        };
    }
    private static void Validate(JsonObject root){using var json=JsonDocument.Parse(root.ToJsonString());HarnessDrawingDocumentsValidator.Validate(json.RootElement);}
    [Theory]
    [InlineData("length")][InlineData("overlap")][InlineData("missing")][InlineData("index")][InlineData("type")][InlineData("key")][InlineData("duplicate")]
    public void Accepts_exact_sum_and_rejects_inconsistent_or_stale_measurements(string mutation)
    {
        var root=Fixture();Validate(root);var dims=root["drawingDocuments"]!["dimensions"]!.AsArray();
        switch(mutation){
            case "length":root["wires"]![0]!["lengthMm"]=301;break;
            case "overlap":dims[1]!["from"]=0;dims[1]!["to"]=2;break;
            case "missing":dims.RemoveAt(0);break;
            case "index":dims[1]!["to"]=4;break;
            case "type":dims[1]!["from"]="1";break;
            case "key":dims[1]!["routeKey"]="[]";break;
            case "duplicate":dims[1]!["id"]="D1";break;
        }
        Assert.Throws<HarnessDesignDocumentException>(()=>Validate(root));
    }
    [Fact]
    public void Accepts_unknown_incomplete_path_and_whole_wire_override_without_double_counting()
    {
        var root=Fixture();var dims=root["drawingDocuments"]!["dimensions"]!.AsArray();dims.RemoveAt(1);root["wires"]![0]!["lengthMm"]=null;Validate(root);
        var total=dims[0]!.DeepClone();total["id"]="TOTAL";total["to"]=3;total["lengthMm"]=450.125m;dims.Add(total);root["wires"]![0]!["lengthMm"]=450.125m;Validate(root);
        var duplicate=total.DeepClone();duplicate["id"]="TOTAL2";dims.Add(duplicate);Assert.Throws<HarnessDesignDocumentException>(()=>Validate(root));
    }

    [Fact]
    public void Shared_pipe_lengths_apply_to_all_routes_and_reject_missing_or_forged_totals()
    {
        var root=Fixture();var wire=root["wires"]![0]!.AsObject();wire["lengthMm"]=300.25m;
        var second=wire.DeepClone();second["id"]="W2";root["wires"]!.AsArray().Add(second);
        JsonObject Segment(string id,string from,string to)=>new(){["id"]=id,["from"]=from,["to"]=to,["bends"]=new JsonArray()};
        JsonObject Route(string id)=>new(){["wireId"]=id,["steps"]=new JsonArray(new JsonObject{["segmentId"]="S1",["reverse"]=false},new JsonObject{["segmentId"]="S2",["reverse"]=false})};
        root["physicalTopology"]=new JsonObject{["segments"]=new JsonArray(Segment("S1","A","J"),Segment("S2","J","B")),["routes"]=new JsonArray(Route("W"),Route("W2"))};
        JsonObject Dimension(string id,string from,string to,decimal length)=>new(){["id"]="D"+id,["segmentId"]=id,["from"]=0,["to"]=1,["pointCount"]=2,["routeKey"]=JsonSerializer.Serialize(new object[]{id,from,to,0}),["mode"]="aligned",["offset"]=40,["lengthMm"]=length};
        var dims=new JsonArray(Dimension("S1","A","J",100.125m),Dimension("S2","J","B",200.125m));root["drawingDocuments"]!["dimensions"]=dims;
        Validate(root);
        root["wires"]![1]!["lengthMm"]=300;Assert.Throws<HarnessDesignDocumentException>(()=>Validate(root));
        root["wires"]![1]!["lengthMm"]=300.25m;
        dims.RemoveAt(1);Assert.Throws<HarnessDesignDocumentException>(()=>Validate(root));
        foreach(var w in root["wires"]!.AsArray())w!["lengthMm"]=null;Validate(root);
        dims[0]!["pointCount"]=3;Assert.Throws<HarnessDesignDocumentException>(()=>Validate(root));
    }
}
