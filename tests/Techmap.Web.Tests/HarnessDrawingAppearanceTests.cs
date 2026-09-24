using System.Text.Json;
using System.Text.Json.Nodes;
using Techmap.Application;
using Techmap.Infrastructure.Sqlite;
using Xunit;

namespace Techmap.Web.Tests;
public sealed class HarnessDrawingAppearanceTests
{
    private static JsonObject Fixture()=>JsonNode.Parse("""
      {"connectors":[{"id":"A","contacts":[{"wireDiameterMm":1.2}]}],"wires":[],"drawingDocuments":{"tables":[],"leaders":[],"bomOrder":[],"physicalScale":1.5,"showDimensions":true,
       "dimensions":[{"id":"D","segmentId":"S","from":0,"to":1,"pointCount":2,"routeKey":"[\"S\",\"N1\",\"N2\",0]","mode":"path","offset":40,"lengthMm":150}]},
       "physicalTopology":{"snap":false,"nodes":[{"id":"N1","position":{"x":0,"y":0}},{"id":"N2","position":{"x":200,"y":0}}],"segments":[{"id":"S","from":"N1","to":"N2","bends":[]}],"routes":[],
       "coverings":[{"id":"C","name":"Heat shrink","kind":"heat-shrink","lengthMode":"auto","width":20,"color":"#334455","lengthMm":null,"spans":[{"segmentId":"S","from":-0.2,"to":1,"toAnchor":1}]}]}}
      """)!.AsObject();
    private static void Validate(JsonObject root){using var json=JsonDocument.Parse(root.ToJsonString());HarnessPhysicalTopologyValidator.Validate(json.RootElement);HarnessDrawingDocumentsValidator.Validate(json.RootElement);}
    [Fact] public void Accepts_relative_scale_path_dimension_and_extended_surface(){Validate(Fixture());}
    [Theory]
    [InlineData(0)][InlineData(.25)][InlineData(24)][InlineData(200)]
    public void Accepts_bend_radius(double radius)
    {
        var root=Fixture();root["drawingDocuments"]!["bendRadius"]=radius;Validate(root);
    }
    [Theory]
    [InlineData("-1")][InlineData("200.01")][InlineData("null")][InlineData("\"24\"")][InlineData("false")]
    public void Rejects_invalid_bend_radius(string value)
    {
        var root=Fixture();root["drawingDocuments"]!["bendRadius"]=JsonNode.Parse(value);
        Assert.Throws<HarnessDesignDocumentException>(()=>Validate(root));
    }
    [Theory]
    [InlineData(.25)][InlineData(1)][InlineData(2.5)][InlineData(4)]
    public void Accepts_leader_scale(double scale)
    {
        var root=Fixture();root["drawingDocuments"]!["leaderScale"]=scale;Validate(root);
    }
    [Theory]
    [InlineData("0")][InlineData("0.249")][InlineData("4.01")][InlineData("null")][InlineData("\"2\"")][InlineData("true")]
    public void Rejects_invalid_leader_scale(string value)
    {
        var root=Fixture();root["drawingDocuments"]!["leaderScale"]=JsonNode.Parse(value);
        Assert.Throws<HarnessDesignDocumentException>(()=>Validate(root));
    }
    [Theory]
    [InlineData(0)][InlineData(0.01)][InlineData(3.5)][InlineData(250.25)][InlineData(10000000)]
    public void Accepts_automatic_fractional_and_large_widths(double width)
    {
        var root=Fixture();
        root["physicalTopology"]!["segments"]![0]!["width"]=width;
        root["physicalTopology"]!["coverings"]![0]!["width"]=width;
        Validate(root);
    }
    [Theory]
    [InlineData("segments",-1)][InlineData("segments",10000001)]
    [InlineData("coverings",-1)][InlineData("coverings",10000001)]
    public void Rejects_invalid_widths(string collection,double width)
    {
        var root=Fixture();
        root["physicalTopology"]![collection]![0]!["width"]=width;
        Assert.Throws<HarnessDesignDocumentException>(()=>Validate(root));
    }
    [Theory]
    [InlineData("scale")][InlineData("visible")][InlineData("diameter")][InlineData("kind")][InlineData("mode")][InlineData("anchor")][InlineData("fraction")]
    public void Rejects_invalid_appearance_fields(string mutation){
        var root=Fixture();var docs=root["drawingDocuments"]!;var cover=root["physicalTopology"]!["coverings"]![0]!;
        switch(mutation){case "scale":docs["physicalScale"]=0;break;case "visible":docs["showDimensions"]="yes";break;case "diameter":root["connectors"]![0]!["contacts"]![0]!["wireDiameterMm"]=-1;break;case "kind":cover["kind"]="unknown";break;case "mode":cover["lengthMode"]="pixels";break;case "anchor":cover["spans"]![0]!["toAnchor"]=2;break;case "fraction":cover["spans"]![0]!["from"]=-10001;break;}
        Assert.Throws<HarnessDesignDocumentException>(()=>Validate(root));
    }
}
