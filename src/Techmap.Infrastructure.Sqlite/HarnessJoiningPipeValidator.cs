using System.Text.Json;
using Techmap.Application;

namespace Techmap.Infrastructure.Sqlite;

internal static class HarnessJoiningPipeValidator
{
    private static HarnessDesignDocumentException Invalid() => new("invalid_physical_topology", "Invalid joining pipe axis or membership.", "content.physicalTopology.joiningPipes");
    private static string Text(JsonElement e,string key) => e.ValueKind==JsonValueKind.Object&&e.TryGetProperty(key,out var v)&&v.ValueKind==JsonValueKind.String&&v.GetString() is {Length:>0 and <=120} s&&!string.IsNullOrWhiteSpace(s)?s:throw Invalid();
    private static double Number(JsonElement e,string key) => e.ValueKind==JsonValueKind.Object&&e.TryGetProperty(key,out var v)&&v.ValueKind==JsonValueKind.Number&&v.TryGetDouble(out var n)&&double.IsFinite(n)?n:throw Invalid();
    private static (double X,double Y) Point(JsonElement e) {var x=Number(e,"x");var y=Number(e,"y");if(Math.Abs(x)>1e7||Math.Abs(y)>1e7)throw Invalid();return (x,y);}
    internal static Dictionary<string,JsonElement> Validate(JsonElement topology,Dictionary<string,(string From,string To)> segments,HashSet<string> ids)
    {
        var result=new Dictionary<string,JsonElement>(StringComparer.Ordinal);
        if(!topology.TryGetProperty("joiningPipes",out var pipes))return result;
        if(pipes.ValueKind!=JsonValueKind.Array||pipes.GetArrayLength()>10000)throw Invalid();
        var owned=new HashSet<string>(StringComparer.Ordinal);
        foreach(var pipe in pipes.EnumerateArray())
        {
            var id=Text(pipe,"id");
            if(!ids.Add(id)||!ids.Add($"{id}:from")||!ids.Add($"{id}:to"))throw Invalid();
            if(!pipe.TryGetProperty("start",out var start)||!pipe.TryGetProperty("end",out var end)||!pipe.TryGetProperty("path",out var path)||Text(path,"kind")!="polyline")throw Invalid();
            var previousPoint=Point(start);var b=Point(end);var distinct=false;
            foreach(var point in HarnessPhysicalTopologyValidator.AuthoredPoints(pipe).EnumerateArray())
            {
                var next=Point(point);if(double.Hypot(next.X-previousPoint.X,next.Y-previousPoint.Y)>=1e-7)distinct=true;previousPoint=next;
            }
            if(double.Hypot(b.X-previousPoint.X,b.Y-previousPoint.Y)>=1e-7)distinct=true;
            if(!distinct)throw Invalid();
            if(Text(pipe,"mode") is not ("flat" or "round"))throw Invalid();
            if(pipe.TryGetProperty("width",out _)){var width=Number(pipe,"width");if(width<0||width>1e7)throw Invalid();}
            if(pipe.TryGetProperty("color",out _)){var c=Text(pipe,"color");if(c.Length!=7||c[0]!='#'||c[1..].Any(ch=>!Uri.IsHexDigit(ch)))throw Invalid();}
            if(pipe.TryGetProperty("volumeShading",out var shade)&&shade.ValueKind is not (JsonValueKind.True or JsonValueKind.False))throw Invalid();
            if(!pipe.TryGetProperty("members",out var members)||members.ValueKind!=JsonValueKind.Array||members.GetArrayLength() is <2 or >128)throw Invalid();
            foreach(var member in members.EnumerateArray())
            {
                var from=Number(member,"from");var to=Number(member,"to");
                if(from<=0||to>=1||from>=to||!member.TryGetProperty("reverse",out var reverse)||reverse.ValueKind is not (JsonValueKind.True or JsonValueKind.False))throw Invalid();
                if(!member.TryGetProperty("segmentIds",out var leaves)||leaves.ValueKind!=JsonValueKind.Array||leaves.GetArrayLength() is <1 or >128)throw Invalid();
                string? previous=null;var visited=new HashSet<string>(StringComparer.Ordinal);
                foreach(var leaf in leaves.EnumerateArray())
                {
                    if(leaf.ValueKind!=JsonValueKind.String||leaf.GetString() is not {} key||!segments.TryGetValue(key,out var segment)||!owned.Add(key)||previous is not null&&previous!=segment.From)throw Invalid();
                    if(previous is null)visited.Add(segment.From);
                    if(!visited.Add(segment.To))throw Invalid();
                    previous=segment.To;
                }
            }
            result.Add(id,pipe);
        }
        return result;
    }
}
