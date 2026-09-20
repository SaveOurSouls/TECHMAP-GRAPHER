using System.Text.Json;
using System.Text.Json.Nodes;
using Techmap.Application;

namespace Techmap.Infrastructure.Sqlite;

internal static class HarnessDrawingDimensionsValidator
{
    private static HarnessDesignDocumentException Invalid() => new("invalid_drawing_dimensions", "Invalid bound drawing dimensions or measured wire length.", "content.drawingDocuments.dimensions");
    private static string Text(JsonElement e,string key,int max=128) => e.TryGetProperty(key,out var v)&&v.ValueKind==JsonValueKind.String&&v.GetString() is {} s&&!string.IsNullOrWhiteSpace(s)&&s.Length<=max?s:throw Invalid();
    private static int Integer(JsonElement e,string key) => e.TryGetProperty(key,out var v)&&v.ValueKind==JsonValueKind.Number&&v.TryGetInt32(out var n)?n:throw Invalid();
    private static decimal? Length(JsonElement e,string key)
    {
        if(!e.TryGetProperty(key,out var v))throw Invalid();
        if(v.ValueKind==JsonValueKind.Null)return null;
        return v.ValueKind==JsonValueKind.Number&&v.TryGetDecimal(out var n)&&n>=0&&n<=10_000_000&&decimal.Round(n,3)==n?n:throw Invalid();
    }
    private sealed record Measurement(string Wire,int From,int To,int Count,decimal? Length);
    public static void Validate(JsonElement root,JsonElement documents,HashSet<string> ids)
    {
        if(!documents.TryGetProperty("dimensions",out var list))return;
        if(list.ValueKind!=JsonValueKind.Array||list.GetArrayLength()>10000)throw Invalid();
        var wires=root.GetProperty("wires").EnumerateArray().ToDictionary(w=>Text(w,"id"));
        var items=new List<Measurement>();
        foreach(var d in list.EnumerateArray())
        {
            if(d.ValueKind!=JsonValueKind.Object||!ids.Add(Text(d,"id")))throw Invalid();
            var wireId=Text(d,"wireId");if(!wires.TryGetValue(wireId,out var wire))throw Invalid();
            var from=Integer(d,"from");var to=Integer(d,"to");var count=Integer(d,"pointCount");
            if(count<2||count>50000||from<0||to<=from||to>=count||Text(d,"mode") is not ("horizontal" or "vertical" or "aligned"))throw Invalid();
            if(!d.TryGetProperty("offset",out var offset)||offset.ValueKind!=JsonValueKind.Number||!offset.TryGetDouble(out var n)||!double.IsFinite(n)||Math.Abs(n)>1e7)throw Invalid();
            var key=Text(d,"routeKey",65536);
            JsonNode? actual;try{actual=JsonNode.Parse(key);}catch(JsonException){throw Invalid();}
            var expected=RouteKey(root,wire,out var directCount);
            if(!JsonNode.DeepEquals(actual,expected)||directCount.HasValue&&count!=directCount.Value)throw Invalid();
            items.Add(new(wireId,from,to,count,Length(d,"lengthMm")));
        }
        foreach(var group in items.GroupBy(i=>i.Wire))
        {
            var end=group.First().Count-1;if(group.Any(i=>i.Count!=end+1))throw Invalid();
            var totals=group.Where(i=>i.From==0&&i.To==end).ToArray();if(totals.Length>1)throw Invalid();
            decimal? length;
            if(totals.Length==1)length=totals[0].Length;
            else
            {
                var next=0;var complete=true;var sum=0m;
                foreach(var item in group.OrderBy(i=>i.From))
                {
                    if(item.From<next)throw Invalid();
                    if(item.From!=next||item.Length is null)complete=false;
                    sum+=item.Length??0;next=item.To;
                }
                length=complete&&next==end?sum:null;
            }
            if(length!=Length(wires[group.Key],"lengthMm"))throw Invalid();
        }
    }
    private static JsonArray RouteKey(JsonElement root,JsonElement wire,out int? directCount)
    {
        static string Endpoint(JsonElement e)=>e.TryGetProperty("junctionId",out var j)?$"j:{j.GetString()}":e.TryGetProperty("screenId",out var s)?$"s:{s.GetString()}":$"c:{e.GetProperty("connectorId").GetString()}:{e.GetProperty("contactId").GetString()}";
        var key=new JsonArray(Endpoint(wire.GetProperty("from")),Endpoint(wire.GetProperty("to")));
        if(root.TryGetProperty("physicalTopology",out var topology))
        {
            var route=topology.GetProperty("routes").EnumerateArray().FirstOrDefault(r=>r.GetProperty("wireId").GetString()==wire.GetProperty("id").GetString());
            if(route.ValueKind==JsonValueKind.Object&&route.GetProperty("steps").GetArrayLength()>0)
            {
                var steps=new JsonArray();
                foreach(var step in route.GetProperty("steps").EnumerateArray())
                {
                    var segment=topology.GetProperty("segments").EnumerateArray().First(s=>s.GetProperty("id").GetString()==step.GetProperty("segmentId").GetString());
                    steps.Add(new JsonArray(segment.GetProperty("id").GetString(),step.GetProperty("reverse").GetBoolean(),segment.GetProperty("from").GetString(),segment.GetProperty("to").GetString(),segment.GetProperty("bends").GetArrayLength()));
                }
                key.Add(steps);directCount=null;return key;
            }
        }
        var bends=wire.GetProperty("drawingRoute").GetArrayLength();key.Add(bends);directCount=bends+2;return key;
    }
}
