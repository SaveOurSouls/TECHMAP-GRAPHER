using System.Text.Json;

namespace Techmap.Application;

/// <summary>Parity with coveringMeasuredLength: only explicit millimetre dimensions, never canvas distance.</summary>
public static class CoveringManufacturingLength
{
    public static decimal? Measure(JsonElement root, JsonElement covering)
    {
        var length = covering.TryGetProperty("lengthMm", out var value) && value.ValueKind == JsonValueKind.Number ? value.GetDecimal() : (decimal?)null;
        var hasMode = covering.TryGetProperty("lengthMode", out var mode);
        if (hasMode && mode.GetString() == "manual" || !hasMode && length is not null) return length;
        var dimensions = root.TryGetProperty("drawingDocuments", out var docs) && docs.TryGetProperty("dimensions", out var dims)
            ? dims.EnumerateArray().ToArray() : [];
        decimal sumMicrometres = 0;
        foreach (var span in covering.GetProperty("spans").EnumerateArray())
        {
            if (!span.TryGetProperty("fromAnchor", out var from) || !span.TryGetProperty("toAnchor", out var to)) return null;
            var start = from.GetInt32(); var end = to.GetInt32(); var segment = span.GetProperty("segmentId").GetString();
            var candidates = dimensions.Where(d => d.TryGetProperty("segmentId", out var s) && s.GetString() == segment &&
                (!d.TryGetProperty("auxiliary", out var a) || !a.GetBoolean())).ToArray();
            var exact = candidates.FirstOrDefault(d => d.GetProperty("from").GetInt32() == start && d.GetProperty("to").GetInt32() == end);
            if (exact.ValueKind != JsonValueKind.Undefined)
            {
                if (exact.GetProperty("lengthMm").ValueKind == JsonValueKind.Null) return null;
                sumMicrometres += RoundMicrometres(exact.GetProperty("lengthMm").GetDecimal()); continue;
            }
            var next = start;
            foreach (var part in candidates.Where(d => d.GetProperty("from").GetInt32() >= start && d.GetProperty("to").GetInt32() <= end).OrderBy(d => d.GetProperty("from").GetInt32()))
            {
                if (part.GetProperty("from").GetInt32() != next || part.GetProperty("lengthMm").ValueKind == JsonValueKind.Null) return null;
                sumMicrometres += RoundMicrometres(part.GetProperty("lengthMm").GetDecimal()); next = part.GetProperty("to").GetInt32();
            }
            if (next != end) return null;
        }
        return sumMicrometres / 1000;
    }
    private static decimal RoundMicrometres(decimal value) => decimal.Floor(value * 1000 + .5m);
}
