using System.Text.Json;
using Techmap.Application;

namespace Techmap.Infrastructure.Sqlite;

internal static class HarnessPhysicalTopologyValidator
{
    private static HarnessDesignDocumentException Invalid() => new("invalid_physical_topology", "Invalid physical nodes, segments or wire route.", "content.physicalTopology");
    private static string Text(JsonElement e, string key) => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.String && v.GetString() is { Length: > 0 and <= 128 } s && !string.IsNullOrWhiteSpace(s) ? s : throw Invalid();
    private static JsonElement Array(JsonElement e, string key, int limit) => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.Array && v.GetArrayLength() <= limit ? v : throw Invalid();
    private static bool Boolean(JsonElement e, string key) => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(key, out var v) && v.ValueKind is JsonValueKind.True or JsonValueKind.False ? v.GetBoolean() : throw Invalid();
    private static void Point(JsonElement e)
    {
        foreach (var axis in new[] { "x", "y" })
            if (e.ValueKind != JsonValueKind.Object || !e.TryGetProperty(axis, out var v) || v.ValueKind != JsonValueKind.Number || !v.TryGetDouble(out var n) || !double.IsFinite(n) || Math.Abs(n) > 1e7) throw Invalid();
    }
    private static string LongText(JsonElement e,string key,int maximum) => e.ValueKind==JsonValueKind.Object && e.TryGetProperty(key,out var v) && v.ValueKind==JsonValueKind.String && v.GetString() is {} s && !string.IsNullOrWhiteSpace(s) && s.Length<=maximum ? s : throw Invalid();
    private static decimal Number(JsonElement e,string key) => e.ValueKind==JsonValueKind.Object && e.TryGetProperty(key,out var v) && v.ValueKind==JsonValueKind.Number && v.TryGetDecimal(out var n) ? n : throw Invalid();
    private static bool Direction(string value) => value is "left" or "right" or "up" or "down";

    // Legacy fields are accepted only at the persistence boundary. New clients write path.
    internal static JsonElement AuthoredPoints(JsonElement segment)
    {
        if (segment.TryGetProperty("path", out var path))
        {
            if (segment.TryGetProperty("bends", out _) || segment.TryGetProperty("routing", out _) ||
                Text(path, "kind") is not ("routed" or "polyline")) throw Invalid();
            return Array(path, "points", 1000);
        }
        if (segment.TryGetProperty("routing", out _) && Text(segment, "routing") is not ("auto" or "fixed")) throw Invalid();
        return Array(segment, "bends", 1000);
    }
    public static void Validate(JsonElement root)
    {
        if (!root.TryGetProperty("physicalTopology", out var t)) return;
        _ = Boolean(t, "snap");
        var connectors = Array(root, "connectors", 100000).EnumerateArray().Select(c => Text(c, "id")).ToHashSet(StringComparer.Ordinal);
        var wires = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
        foreach (var w in Array(root, "wires", 100000).EnumerateArray()) if (!wires.TryAdd(Text(w, "id"), w)) throw Invalid();
        var ids = new HashSet<string>(connectors.Concat(wires.Keys), StringComparer.Ordinal);
        var nodes = new Dictionary<string, string?>(StringComparer.Ordinal);
        var exitWires=new Dictionary<string,HashSet<string>>(StringComparer.Ordinal);

        foreach (var node in Array(t, "nodes", 10000).EnumerateArray())
        {
            var id = Text(node, "id");
            if (!ids.Add(id) || !node.TryGetProperty("position", out var p)) throw Invalid();
            Point(p);
            string? connector = node.TryGetProperty("connectorId", out _) ? Text(node, "connectorId") : null;
            if (connector is not null && !connectors.Contains(connector)) throw Invalid();
            if (node.TryGetProperty("direction", out _) && !Direction(Text(node, "direction"))) throw Invalid();
            if (node.TryGetProperty("contactDirections", out var directions))
            {
                if (connector is null || directions.ValueKind != JsonValueKind.Object) throw Invalid();
                var contacts = root.GetProperty("connectors").EnumerateArray().First(c => Text(c, "id") == connector);
                var contactIds = Array(contacts, "contacts", 100000).EnumerateArray().Select(c => Text(c, "id")).ToHashSet(StringComparer.Ordinal);
                foreach (var direction in directions.EnumerateObject())
                    if (!contactIds.Contains(direction.Name) || direction.Value.ValueKind != JsonValueKind.String || !Direction(direction.Value.GetString()!)) throw Invalid();
            }
            if(node.TryGetProperty("wireIds",out _)){
                var allowed=new HashSet<string>(StringComparer.Ordinal);exitWires[id]=allowed;
                foreach(var item in Array(node,"wireIds",100000).EnumerateArray()){
                    if(connector is null||item.ValueKind!=JsonValueKind.String||item.GetString() is not {} wireId||!allowed.Add(wireId)||!wires.TryGetValue(wireId,out var wire))throw Invalid();
                    if(!new[]{"from","to"}.Any(end=>wire.TryGetProperty(end,out var e)&&e.TryGetProperty("connectorId",out var c)&&c.GetString()==connector))throw Invalid();
                }
            }
            nodes.Add(id, connector);
        }
        var segments = new Dictionary<string, (string From, string To)>(StringComparer.Ordinal);
        foreach (var segment in Array(t, "segments", 20000).EnumerateArray())
        {
            var id = Text(segment, "id"); var from = Text(segment, "from"); var to = Text(segment, "to");
            if (!ids.Add(id) || from == to || !nodes.ContainsKey(from) || !nodes.ContainsKey(to)) throw Invalid();
            foreach (var p in AuthoredPoints(segment).EnumerateArray()) Point(p);
            if(segment.TryGetProperty("width",out _)){var width=Number(segment,"width");if(width<4||width>200)throw Invalid();}
            if(segment.TryGetProperty("color",out _)){var color=Text(segment,"color");if(color.Length!=7||color[0]!='#'||color[1..].Any(c=>!Uri.IsHexDigit(c)))throw Invalid();}
            if(segment.TryGetProperty("showWires",out _))_=Boolean(segment,"showWires");
            if(segment.TryGetProperty("specificationItemId",out _))_=Text(segment,"specificationItemId");
            segments.Add(id, (from, to));
        }
        if (t.TryGetProperty("coverings", out _))
        {
            foreach (var covering in Array(t, "coverings", 10000).EnumerateArray())
            {
                if (!ids.Add(Text(covering, "id"))) throw Invalid();
                _ = LongText(covering, "name", 256);
                if(covering.TryGetProperty("kind",out _)&&Text(covering,"kind") is not ("heat-shrink" or "nylon" or "braid" or "metal-braid" or "tape" or "band"))throw Invalid();
                if(covering.TryGetProperty("lengthMode",out _)&&Text(covering,"lengthMode") is not ("auto" or "manual"))throw Invalid();
                var color = LongText(covering, "color", 7);
                if (color.Length != 7 || color[0] != '#' || color[1..].Any(c => !Uri.IsHexDigit(c))) throw Invalid();
                var width = Number(covering,"width"); if (width < 1 || width > 200) throw Invalid();
                if (!covering.TryGetProperty("lengthMm",out var length)) throw Invalid();
                if (length.ValueKind != JsonValueKind.Null)
                {
                    var mm=Number(covering,"lengthMm"); if(mm<0 || mm>1000000000m || decimal.Round(mm,3)!=mm) throw Invalid();
                }
                var spans=Array(covering,"spans",20000); if(spans.GetArrayLength()==0) throw Invalid();
                var members=new HashSet<string>(StringComparer.Ordinal);
                foreach(var span in spans.EnumerateArray())
                {
                    var id=Text(span,"segmentId"); if(!segments.ContainsKey(id) || !members.Add(id)) throw Invalid();
                    var from=Number(span,"from"); var to=Number(span,"to"); if(from < -10000 || to > 10001 || from>=to) throw Invalid();
                    var count=AuthoredPoints(t.GetProperty("segments").EnumerateArray().First(s=>Text(s,"id")==id)).GetArrayLength()+2;
                    int? startAnchor=null,endAnchor=null;
                    foreach(var key in new[]{"fromAnchor","toAnchor"})if(span.TryGetProperty(key,out var anchor)){
                        if(anchor.ValueKind!=JsonValueKind.Number||!anchor.TryGetInt32(out var index)||index<0||index>=count)throw Invalid();
                        if(key=="fromAnchor")startAnchor=index;else endAnchor=index;
                    }
                    if(startAnchor.HasValue&&endAnchor.HasValue&&startAnchor>=endAnchor)throw Invalid();
                }
                if(covering.TryGetProperty("material",out var material))
                {
                    if(Text(material,"entityType")!="protective-covering") throw Invalid();
                    _=LongText(material,"sourceId",512); _=LongText(material,"sourceKey",512); _=LongText(material,"displayName",512);
                    if(!Guid.TryParseExact(Text(material,"snapshotId"),"D",out var guid) || guid==Guid.Empty) throw Invalid();
                    foreach(var key in new[]{"snapshotSha256","recordId"}) {var hash=Text(material,key); if(hash.Length!=64 || hash.Any(c=>!Uri.IsHexDigit(c))) throw Invalid();}
                }
            }
        }
        var assigned = new HashSet<string>(StringComparer.Ordinal);
        foreach (var route in Array(t, "routes", 20000).EnumerateArray())
        {
            if(route.TryGetProperty("automatic",out _))_=Boolean(route,"automatic");
            var wireId = Text(route, "wireId");
            if (!wires.TryGetValue(wireId, out var wire) || !assigned.Add(wireId)) throw Invalid();
            var visited = new HashSet<string>(StringComparer.Ordinal);
            string? first = null, previous = null;
            var steps = Array(route, "steps", 20000);
            if (steps.GetArrayLength() == 0) throw Invalid();
            foreach (var step in steps.EnumerateArray())
            {
                var segmentId = Text(step, "segmentId");
                if (!segments.TryGetValue(segmentId, out var segment) || !visited.Add(segmentId)) throw Invalid();
                var reverse = Boolean(step, "reverse");
                var from = reverse ? segment.To : segment.From; var to = reverse ? segment.From : segment.To;
                if (previous is not null && from != previous) throw Invalid();
                first ??= from; previous = to;
            }
            foreach(var node in new[]{first!,previous!})if(exitWires.TryGetValue(node,out var allowed)&&!allowed.Contains(wireId))throw Invalid();
            foreach (var (node, end) in new[] { (first!, "from"), (previous!, "to") })
                if (nodes[node] is { } connector && (!wire.TryGetProperty(end, out var endpoint) || Text(endpoint, "connectorId") != connector)) throw Invalid();
        }
    }
}
