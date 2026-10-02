using System.Text.Json;
using System.Text.Json.Nodes;
using Techmap.Application;
using Techmap.Infrastructure.Sqlite;
using Xunit;

namespace Techmap.Web.Tests;
public sealed class HarnessJoiningPipeTests
{
    internal static JsonObject Fixture()=>JsonNode.Parse("""
    {"schemaVersion":1,"connectors":[],"wires":[],"physicalTopology":{"snap":false,
      "nodes":[{"id":"a","position":{"x":0,"y":0}},{"id":"b","position":{"x":600,"y":0}}],
      "segments":[{"id":"p0","from":"a","to":"b","path":{"kind":"polyline","points":[]}},{"id":"p1","from":"a","to":"b","path":{"kind":"polyline","points":[]}}],"routes":[],
      "joiningPipes":[{"id":"op","start":{"x":180,"y":70},"end":{"x":420,"y":70},"path":{"kind":"polyline","points":[{"x":300,"y":140}]},"mode":"flat","members":[{"segmentIds":["p0"],"from":0.3,"to":0.7,"reverse":false},{"segmentIds":["p1"],"from":0.3,"to":0.7,"reverse":true}]}],
      "coverings":[{"id":"coat","name":"Термоусадка","width":0,"color":"#334455","lengthMm":200,"spans":[{"segmentId":"op","from":0,"to":1,"fromAnchor":0,"toAnchor":2}]}]}}
    """)!.AsObject();
    private static void Validate(JsonObject value){using var json=JsonDocument.Parse(value.ToJsonString());HarnessPhysicalTopologyValidator.Validate(json.RootElement);}
    [Fact] public void Accepts_independent_axis_and_coating(){Validate(Fixture());}
    [Fact] public void Accepts_authored_bend_regions_on_owned_fragments()
    {
        var root=Fixture();var topology=root["physicalTopology"]!;
        topology["segments"]![0]!["path"]!["points"]=JsonNode.Parse("[{\"x\":120,\"y\":15},{\"x\":430,\"y\":25}]");
        topology["segments"]![1]!["path"]!["points"]=JsonNode.Parse("[{\"x\":160,\"y\":50}]");
        topology["joiningPipes"]![0]!["members"]![0]!["authoredBendRegions"]=JsonNode.Parse("""
          [{"segmentId":"p0","bendIndex":0,"region":"before-enter","displayPoint":{"x":120,"y":20}},
           {"segmentId":"p0","bendIndex":1,"region":"after-exit","displayPoint":{"x":430,"y":30}}]
          """);
        topology["joiningPipes"]![0]!["members"]![1]!["authoredBendRegions"]=JsonNode.Parse("""
          [{"segmentId":"p1","bendIndex":0,"region":"axis"}]
          """);
        Validate(root);
    }
    [Theory]
    [InlineData("null")][InlineData("{}")]
    [InlineData("[{\"segmentId\":\"p1\",\"bendIndex\":0,\"region\":\"enter\"}]")]
    [InlineData("[{\"segmentId\":\"p0\",\"bendIndex\":-1,\"region\":\"enter\"}]")]
    [InlineData("[{\"segmentId\":\"p0\",\"bendIndex\":0.5,\"region\":\"enter\"}]")]
    [InlineData("[{\"segmentId\":\"p0\",\"bendIndex\":1,\"region\":\"enter\"}]")]
    [InlineData("[{\"segmentId\":\"p0\",\"bendIndex\":0,\"region\":\"other\"}]")]
    [InlineData("[{\"segmentId\":\"p0\",\"bendIndex\":0,\"region\":\"enter\",\"displayPoint\":null}]")]
    [InlineData("[{\"segmentId\":\"p0\",\"bendIndex\":0,\"region\":\"enter\",\"displayPoint\":{}}]")]
    [InlineData("[{\"segmentId\":\"p0\",\"bendIndex\":0,\"region\":\"enter\",\"displayPoint\":{\"x\":10000001,\"y\":0}}]")]
    [InlineData("[{\"segmentId\":\"p0\",\"bendIndex\":0,\"region\":null}]")]
    [InlineData("[{\"segmentId\":\"p0\",\"bendIndex\":0,\"region\":{}}]")]
    [InlineData("[null]")][InlineData("[{}]")]
    [InlineData("[{\"segmentId\":\"p0\",\"bendIndex\":0,\"region\":\"enter\"},{\"segmentId\":\"p0\",\"bendIndex\":0,\"region\":\"exit\"}]")]
    public void Rejects_invalid_authored_bend_regions(string value)
    {
        var root=Fixture();var topology=root["physicalTopology"]!;
        topology["segments"]![0]!["path"]!["points"]=JsonNode.Parse("[{\"x\":120,\"y\":15}]");
        topology["segments"]![1]!["path"]!["points"]=JsonNode.Parse("[{\"x\":160,\"y\":50}]");
        topology["joiningPipes"]![0]!["members"]![0]!["authoredBendRegions"]=JsonNode.Parse(value);
        Assert.Throws<HarnessDesignDocumentException>(()=>Validate(root));
    }
    [Fact] public void Accepts_removed_transition_bends_and_authored_outer_stations()
    {
        var root=Fixture();var member=root["physicalTopology"]!["joiningPipes"]![0]!["members"]![0]!;
        member["enterBend"]=null;
        member["exitBend"]=null;
        member["enterOuter"]=new JsonObject{["x"]=120,["y"]=20};
        member["exitOuter"]=new JsonObject{["x"]=500,["y"]=40};
        Validate(root);
    }
    [Theory]
    [InlineData("enterOuter")][InlineData("exitOuter")]
    public void Rejects_invalid_outer_station(string key)
    {
        var root=Fixture();root["physicalTopology"]!["joiningPipes"]![0]!["members"]![0]![key]=JsonNode.Parse("null");
        Assert.Throws<HarnessDesignDocumentException>(()=>Validate(root));
    }
    [Theory]
    [InlineData(0, 1)][InlineData(1, 0)][InlineData(.35, .8)]
    public void Accepts_independent_pipe_and_joining_pipe_opacity(double pipeOpacity,double joiningOpacity)
    {
        var root=Fixture();var topology=root["physicalTopology"]!;
        topology["segments"]![0]!["opacity"]=pipeOpacity;
        topology["joiningPipes"]![0]!["opacity"]=joiningOpacity;
        Validate(root);
    }
    [Theory]
    [InlineData("null")][InlineData("\"0.5\"")][InlineData("-0.1")][InlineData("1.1")]
    public void Rejects_invalid_opacity_on_either_pipe_kind(string value)
    {
        foreach(var collection in new[]{"segments","joiningPipes"})
        {
            var root=Fixture();root["physicalTopology"]![collection]![0]!["opacity"]=JsonNode.Parse(value);
            Assert.Throws<HarnessDesignDocumentException>(()=>Validate(root));
        }
    }
    [Theory]
    [InlineData("duplicate")][InlineData("missing")][InlineData("owner")][InlineData("range")][InlineData("axis")][InlineData("id")][InlineData("endpointId")][InlineData("anchor")][InlineData("wireRoute")]
    [InlineData("collapsed")][InlineData("legacy")][InlineData("cycle")]
    public void Rejects_invalid_joining_pipe(string mutation)
    {
        var root=Fixture();var t=root["physicalTopology"]!;var pipe=t["joiningPipes"]![0]!;
        switch(mutation){
            case "duplicate":pipe["members"]![1]!["segmentIds"]=new JsonArray("p0");break;
            case "missing":pipe["members"]![1]!["segmentIds"]=new JsonArray("absent");break;
            case "owner":var copy=pipe.DeepClone();copy["id"]="another";t["joiningPipes"]!.AsArray().Add(copy);break;
            case "range":pipe["members"]![0]!["from"]=1;break;
            case "axis":pipe["path"]!["points"]![0]!["x"]="bad";break;
            case "id":pipe["id"]="a";break;
            case "endpointId":t["nodes"]![0]!["id"]="op:from";t["segments"]![0]!["from"]="op:from";t["segments"]![1]!["from"]="op:from";break;
            case "anchor":t["coverings"]![0]!["spans"]![0]!["toAnchor"]=3;break;
            case "wireRoute":root["wires"]=new JsonArray(new JsonObject{["id"]="w"});t["routes"]=new JsonArray(new JsonObject{["wireId"]="w",["steps"]=new JsonArray(new JsonObject{["segmentId"]="op",["reverse"]=false})});break;
            case "collapsed":pipe["end"]=pipe["start"]!.DeepClone();pipe["path"]!["points"]=new JsonArray();break;
            case "legacy":pipe["bends"]=new JsonArray();break;
            case "cycle":var loop=t["segments"]![0]!.DeepClone();loop["id"]="loop";loop["from"]="b";loop["to"]="a";t["segments"]!.AsArray().Add(loop);pipe["members"]![0]!["segmentIds"]!.AsArray().Add("loop");break;
        }
        Assert.Throws<HarnessDesignDocumentException>(()=>Validate(root));
    }
}
