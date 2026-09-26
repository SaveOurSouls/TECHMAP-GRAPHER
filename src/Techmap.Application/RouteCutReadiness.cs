using System.Text.Json;

namespace Techmap.Application;

public static class RouteCutReadiness
{
    public const string NotPreparedMessage = "Карта резки недоступна: подготовьте в маршруте все заготовки и назначьте закреплённую операцию резки.";
    public const string StaleMessage = "Карта резки недоступна: конструкция или количество жгутов изменились. Проверьте и актуализируйте маршрут.";
    public static void Require(JsonElement root, string? sourceFingerprint)
    {
        if (!root.TryGetProperty("manufacturingRoute", out var route) || route.ValueKind != JsonValueKind.Object)
            throw NotPrepared();
        if (sourceFingerprint is null || !route.TryGetProperty("source", out var source) ||
            !source.TryGetProperty("sha256", out var hash) || !string.Equals(hash.GetString(), sourceFingerprint, StringComparison.OrdinalIgnoreCase))
            throw new HarnessCutListException("route_source_stale", StaleMessage);
        var ready = new HashSet<(string, string)>();
        if (!route.TryGetProperty("rows", out var rows) || rows.ValueKind != JsonValueKind.Array) throw NotPrepared();
        foreach (var row in rows.EnumerateArray())
        {
            if (row.GetProperty("kind").GetString() != "semiFinished" || !row.GetProperty("prepared").GetBoolean()) continue;
            if (!row.GetProperty("operations").EnumerateArray().Any(op =>
                op.GetProperty("binding").ValueKind == JsonValueKind.Object &&
                op.GetProperty("mode").GetString() is "cut" or "cut-strip-from" or "cut-strip-to" or "cut-strip-both" or "cut-crimp")) continue;
            foreach (var item in row.GetProperty("sourceObjects").EnumerateArray()) ready.Add((item.GetProperty("kind").GetString()!, item.GetProperty("id").GetString()!));
        }
        var members = new HashSet<string>();
        if (root.TryGetProperty("cables", out var cables)) foreach (var cable in cables.EnumerateArray())
        {
            if (!ready.Contains(("cable", cable.GetProperty("id").GetString()!))) throw NotPrepared();
            foreach (var member in cable.GetProperty("memberWireIds").EnumerateArray()) members.Add(member.GetString()!);
        }
        foreach (var wire in root.GetProperty("wires").EnumerateArray())
        {
            var id = wire.GetProperty("id").GetString()!;
            if (!members.Contains(id) && !ready.Contains(("wire", id))) throw NotPrepared();
        }
        if (root.TryGetProperty("physicalTopology", out var topology) && topology.ValueKind == JsonValueKind.Object && topology.TryGetProperty("coverings", out var coverings))
            foreach (var covering in coverings.EnumerateArray()) if (!ready.Contains(("covering", covering.GetProperty("id").GetString()!))) throw NotPrepared();
    }
    private static HarnessCutListException NotPrepared() => new("route_cut_not_prepared", NotPreparedMessage);
}
