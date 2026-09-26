using System.Text.Json;
using System.Text.Json.Nodes;

namespace Techmap.Infrastructure.Sqlite;

internal static class ManufacturingRouteRemapper
{
    internal static string Remap(string sourceJson, string destinationJson, IReadOnlyDictionary<Guid, Guid> placements, long quantity)
    {
        using var source = JsonDocument.Parse(sourceJson);
        ManufacturingRouteValidator.Validate(source.RootElement);
        if (!source.RootElement.TryGetProperty("manufacturingRoute", out var route)) return destinationJson;
        var wasFresh = string.Equals(route.GetProperty("source").GetProperty("sha256").GetString(),
            ManufacturingRouteSourceFingerprint.Compute(source.RootElement, quantity), StringComparison.OrdinalIgnoreCase);
        var destination = JsonNode.Parse(destinationJson)!.AsObject();
        foreach (var row in destination["manufacturingRoute"]!["rows"]!.AsArray())
        {
            foreach (var reference in row!["sourceObjects"]!.AsArray()) RemapReference(reference!);
            foreach (var item in row["presentation"]!["objects"]!.AsArray()) RemapReference(item!["ref"]!);
        }
        if (wasFresh)
        {
            using var candidate = JsonDocument.Parse(destination.ToJsonString());
            ManufacturingRouteValidator.ValidateReferences(candidate.RootElement);
            destination["manufacturingRoute"]!["source"]!["sha256"] = ManufacturingRouteSourceFingerprint.Compute(candidate.RootElement, quantity);
        }
        return destination.ToJsonString();

        void RemapReference(JsonNode reference)
        {
            if (reference["kind"]!.GetValue<string>() == "connector" &&
                Guid.TryParse(reference["id"]!.GetValue<string>(), out var oldId) && placements.TryGetValue(oldId, out var newId))
                reference["id"] = newId.ToString("D");
        }
    }
}
