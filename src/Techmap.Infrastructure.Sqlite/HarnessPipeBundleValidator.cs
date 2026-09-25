using System.Text.Json;
using Techmap.Application;

namespace Techmap.Infrastructure.Sqlite;

internal static class HarnessPipeBundleValidator
{
    private const int MaximumMembers = 128;
    private const int MaximumDepth = 16;
    private static HarnessDesignDocumentException Invalid() => new("invalid_physical_topology", "Invalid pipe bundle membership or nesting.", "content.physicalTopology.coverings.bundle");
    private static string Text(JsonElement item, string key) => item.ValueKind == JsonValueKind.Object &&
        item.TryGetProperty(key, out var value) && value.ValueKind == JsonValueKind.String &&
        value.GetString() is { Length: > 0 and <= 128 } text && !string.IsNullOrWhiteSpace(text) ? text : throw Invalid();

    internal static void Validate(JsonElement coverings, IReadOnlyDictionary<string, (string From, string To)> segments)
    {
        var byId = coverings.EnumerateArray().ToDictionary(c => Text(c, "id"), StringComparer.Ordinal);
        var resolved = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);
        var heights = new Dictionary<string, int>(StringComparer.Ordinal);
        var active = new HashSet<string>(StringComparer.Ordinal);
        HashSet<string> Visit(string id, int depth)
        {
            if (depth > MaximumDepth || active.Contains(id)) throw Invalid();
            if (resolved.TryGetValue(id, out var cached))
            {
                if (depth + heights[id] - 1 > MaximumDepth) throw Invalid();
                return cached;
            }
            if (!byId.TryGetValue(id, out var covering) || !covering.TryGetProperty("bundle", out var bundle) ||
                Text(bundle, "mode") is not ("flat" or "round") || !bundle.TryGetProperty("members", out var members) ||
                members.ValueKind != JsonValueKind.Array || members.GetArrayLength() is < 2 or > MaximumMembers) throw Invalid();
            active.Add(id);
            var leaves = new HashSet<string>(StringComparer.Ordinal);
            var height = 1;
            foreach (var member in members.EnumerateArray())
            {
                var kind = Text(member, "kind"); var memberId = Text(member, "id");
                if (kind is not ("segment" or "covering") || kind == "segment" && !segments.ContainsKey(memberId)) throw Invalid();
                var chain = new List<string> { memberId };
                if (member.TryGetProperty("continuationIds", out var continuation))
                {
                    if (kind != "segment" || continuation.ValueKind != JsonValueKind.Array || continuation.GetArrayLength() is < 1 or >= MaximumMembers) throw Invalid();
                    var visitedNodes = new HashSet<string>(StringComparer.Ordinal) { segments[memberId].From, segments[memberId].To };
                    foreach (var item in continuation.EnumerateArray())
                    {
                        if (item.ValueKind != JsonValueKind.String || item.GetString() is not { } next ||
                            !segments.TryGetValue(next, out var segment) || segments[chain[^1]].To != segment.From || !visitedNodes.Add(segment.To)) throw Invalid();
                        chain.Add(next);
                    }
                }
                IEnumerable<string> children = kind == "segment" ? chain : Visit(memberId, depth + 1);
                if (kind == "covering") height = Math.Max(height, 1 + heights[memberId]);
                foreach (var leaf in children)
                    if (!leaves.Add(leaf) || leaves.Count > MaximumMembers) throw Invalid();
            }
            foreach (var span in covering.GetProperty("spans").EnumerateArray())
                if (!leaves.Contains(Text(span, "segmentId"))) throw Invalid();
            active.Remove(id); heights[id] = height; resolved[id] = leaves;
            return leaves;
        }
        foreach (var covering in byId.Values)
            if (covering.TryGetProperty("bundle", out _)) Visit(Text(covering, "id"), 1);
    }
}
