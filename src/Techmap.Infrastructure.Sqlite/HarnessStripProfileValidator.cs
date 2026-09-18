using System.Text.Json;
using Techmap.Application;

namespace Techmap.Infrastructure.Sqlite;

/// <summary>Validates pinned end treatments without consulting a mutable catalog.</summary>
internal static class HarnessStripProfileValidator
{
    public static void Validate(JsonElement content)
    {
        // Old documents without wires/profiles remain valid for this extension.
        if (!content.TryGetProperty("wires", out var wires)) return;
        if (wires.ValueKind != JsonValueKind.Array) throw Invalid("content.wires");
        var wireIndex = 0;
        foreach (var wire in wires.EnumerateArray())
        {
            var path = $"content.wires[{wireIndex++}]";
            if (wire.ValueKind != JsonValueKind.Object) throw Invalid(path);
            if (!wire.TryGetProperty("stripProfiles", out var profiles)) continue;
            path += ".stripProfiles";
            if (profiles.ValueKind != JsonValueKind.Object) throw Invalid(path);
            foreach (var end in new[] { "from", "to" })
                if (profiles.TryGetProperty(end, out var profile)) ValidateProfile(profile, $"{path}.{end}");
        }
    }

    private static void ValidateProfile(JsonElement profile, string path)
    {
        if (profile.ValueKind != JsonValueKind.Object) throw Invalid(path);
        _ = Text(profile, "sourceId", path, 128);
        var id = Text(profile, "snapshotId", path, 36);
        if (!Guid.TryParseExact(id, "D", out var guid) || guid == Guid.Empty)
            throw Invalid($"{path}.snapshotId");
        foreach (var name in new[] { "snapshotSha256", "recordId" })
        {
            var hash = Text(profile, name, path, 64);
            if (hash.Length != 64 || hash.Any(character => !Uri.IsHexDigit(character)))
                throw Invalid($"{path}.{name}");
        }
        if (Text(profile, "entityType", path, 16) != "coax-termination")
            throw Invalid($"{path}.entityType");
        _ = Text(profile, "sourceKey", path, 512);
        _ = Text(profile, "displayName", path, 256);
        if (!profile.TryGetProperty("layers", out var layers) || layers.ValueKind != JsonValueKind.Array ||
            layers.GetArrayLength() is < 1 or > 64) throw Invalid($"{path}.layers");

        decimal previousIndex = 0, previousDiameter = 0, previousLength = 0;
        var layerIndex = 0;
        foreach (var layer in layers.EnumerateArray())
        {
            var layerPath = $"{path}.layers[{layerIndex++}]";
            if (layer.ValueKind != JsonValueKind.Object) throw Invalid(layerPath);
            var index = Number(layer, "index", layerPath);
            if (index <= previousIndex || index > 9_007_199_254_740_991m || decimal.Truncate(index) != index)
                throw Invalid($"{layerPath}.index");
            var diameter = Measurement(layer, "diameterMm", layerPath);
            var length = Measurement(layer, "stripLengthMm", layerPath);
            if (diameter <= previousDiameter) throw Invalid($"{layerPath}.diameterMm");
            if (length <= previousLength) throw Invalid($"{layerPath}.stripLengthMm");
            (previousIndex, previousDiameter, previousLength) = (index, diameter, length);
        }
    }

    private static decimal Measurement(JsonElement owner, string name, string path)
    {
        var value = Number(owner, name, path);
        if (value <= 0 || value > 1_000_000_000m || value * 1000 != decimal.Truncate(value * 1000))
            throw Invalid($"{path}.{name}");
        return value;
    }

    private static decimal Number(JsonElement owner, string name, string path)
    {
        if (!owner.TryGetProperty(name, out var value) || value.ValueKind != JsonValueKind.Number ||
            !value.TryGetDecimal(out var number)) throw Invalid($"{path}.{name}");
        return number;
    }

    private static string Text(JsonElement owner, string name, string path, int maximumLength)
    {
        if (!owner.TryGetProperty(name, out var value) || value.ValueKind != JsonValueKind.String ||
            string.IsNullOrWhiteSpace(value.GetString()) || value.GetString()!.Length > maximumLength)
            throw Invalid($"{path}.{name}");
        return value.GetString()!;
    }

    private static HarnessDesignDocumentException Invalid(string path) => new(
        "invalid_design_content", "Некорректный профиль разделки: проверьте привязку и возрастающие слои D/L с точностью 0,001 мм.", path);
}
