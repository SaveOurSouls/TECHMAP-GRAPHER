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
    public static void Validate(JsonElement root)
    {
        if (!root.TryGetProperty("physicalTopology", out var t)) return;
        _ = Boolean(t, "snap");
        var connectors = Array(root, "connectors", 100000).EnumerateArray().Select(c => Text(c, "id")).ToHashSet(StringComparer.Ordinal);
        var wires = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
        foreach (var w in Array(root, "wires", 100000).EnumerateArray()) if (!wires.TryAdd(Text(w, "id"), w)) throw Invalid();
        var ids = new HashSet<string>(connectors.Concat(wires.Keys), StringComparer.Ordinal);
        var nodes = new Dictionary<string, string?>(StringComparer.Ordinal);
        var anchored = new HashSet<string>(StringComparer.Ordinal);
        foreach (var node in Array(t, "nodes", 10000).EnumerateArray())
        {
            var id = Text(node, "id");
            if (!ids.Add(id) || !node.TryGetProperty("position", out var p)) throw Invalid();
            Point(p);
            string? connector = node.TryGetProperty("connectorId", out _) ? Text(node, "connectorId") : null;
            if (connector is not null && (!connectors.Contains(connector) || !anchored.Add(connector))) throw Invalid();
            nodes.Add(id, connector);
        }
        var segments = new Dictionary<string, (string From, string To)>(StringComparer.Ordinal);
        foreach (var segment in Array(t, "segments", 20000).EnumerateArray())
        {
            var id = Text(segment, "id"); var from = Text(segment, "from"); var to = Text(segment, "to");
            if (!ids.Add(id) || from == to || !nodes.ContainsKey(from) || !nodes.ContainsKey(to)) throw Invalid();
            foreach (var p in Array(segment, "bends", 1000).EnumerateArray()) Point(p);
            segments.Add(id, (from, to));
        }
        var assigned = new HashSet<string>(StringComparer.Ordinal);
        foreach (var route in Array(t, "routes", 20000).EnumerateArray())
        {
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
            foreach (var (node, end) in new[] { (first!, "from"), (previous!, "to") })
                if (nodes[node] is { } connector && (!wire.TryGetProperty(end, out var endpoint) || Text(endpoint, "connectorId") != connector)) throw Invalid();
        }
    }
}
