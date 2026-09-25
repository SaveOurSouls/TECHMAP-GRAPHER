using System.Text.Json;
using Techmap.Application;

namespace Techmap.Infrastructure.Sqlite;

internal static class HarnessCoveringStyleValidator
{
    internal static bool ValidTexture(JsonElement texture) => texture.ValueKind == JsonValueKind.String && texture.GetString() is {} value &&
        (value is "auto" or "none" or "Rubber002" or "Fabric061" or "Metal049A" || value.Length == 70 && value.StartsWith("asset:", StringComparison.Ordinal) && value[6..].All(c => c is >= '0' and <= '9' or >= 'a' and <= 'f'));
    private static HarnessDesignDocumentException Invalid() => new("invalid_physical_topology", "Invalid covering style.", "content.physicalTopology.coverings.style");
    public static void Validate(JsonElement style)
    {
        if (style.ValueKind != JsonValueKind.Object) throw Invalid();
        if (style.TryGetProperty("texture", out var texture) && !ValidTexture(texture)) throw Invalid();
        if (style.TryGetProperty("hatch", out var hatch) && (hatch.ValueKind != JsonValueKind.String || hatch.GetString() is not ("none" or "parallel" or "cross" or "dots"))) throw Invalid();
        foreach (var key in new[] { "lineColor", "hatchColor" })
            if (style.TryGetProperty(key, out var value) && (value.ValueKind != JsonValueKind.String || value.GetString() is not { Length: 7 } color || color[0] != '#' || color[1..].Any(c => !Uri.IsHexDigit(c)))) throw Invalid();
        foreach (var (key, min, max) in new[] { ("textureScale", .1, 10d), ("textureRotation", -180d, 180d), ("hatchSpacing", 1d, 100d), ("hatchRotation", -180d, 180d) })
            if (style.TryGetProperty(key, out var value) && (value.ValueKind != JsonValueKind.Number || !value.TryGetDouble(out var n) || !double.IsFinite(n) || n < min || n > max)) throw Invalid();
    }
}
