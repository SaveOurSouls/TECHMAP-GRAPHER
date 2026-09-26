using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Techmap.Infrastructure.Sqlite;

/// <summary>Calculates the server-owned fingerprint of the physical construction.</summary>
internal static class ManufacturingRouteSourceFingerprint
{
    internal const int CurrentFingerprintVersion = 1;

    internal static string Compute(JsonElement design, long harnessQuantity)
    {
        if (harnessQuantity < 1) throw new ArgumentOutOfRangeException(nameof(harnessQuantity));
        var source = new JsonObject
        {
            ["fingerprintVersion"] = CurrentFingerprintVersion,
            ["harnessQuantity"] = harnessQuantity,
            ["construction"] = SourceObject(design),
        };
        var canonical = Canonical(source);
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(canonical))).ToLowerInvariant();
    }

    private static JsonObject SourceObject(JsonElement design)
    {
        var result = new JsonObject();
        result["connectors"] = Collection(design, "connectors", item =>
        {
            var connector = Pick(item, "id", "designation", "libraryCode", "partNumber", "terminalCatalog");
            connector["contacts"] = Collection(item, "contacts", contact => Pick(contact, "id", "logicalContactId", "number", "nameOverride", "contactType", "circuit", "terminalArticle", "wire", "wireSection", "wireDiameterMm", "color", "secondaryColor", "customValues"));
            if (item.TryGetProperty("libraryBinding", out var binding)) connector["libraryBinding"] = Pick(binding, "mode", "templateId", "templateVersion", "versionSha256", "articleVariantId", "article", "seriesId", "partNumber");
            return connector;
        });
        result["wires"] = Collection(design, "wires", item => Pick(item, "id", "from", "to", "circuit", "color", "colorSource", "materialBinding", "stripProfiles", "lengthMm", "endCorrectionFromMm", "endCorrectionToMm", "cutRoundingStepMm"));
        result["cables"] = Collection(design, "cables", item => Pick(item, "id", "memberWireIds", "materialBinding", "lengthMm", "endCorrectionFromMm", "endCorrectionToMm", "cutRoundingStepMm", "sheathStrip"));
        result["junctions"] = Collection(design, "junctions", item => Pick(item, "id", "wireIds"));
        result["screens"] = Collection(design, "screens", item => Pick(item, "id", "wireIds", "terminalSide", "label"));
        result["diffPairs"] = Collection(design, "diffPairs", item => Pick(item, "id", "wireIds"));
        if (design.TryGetProperty("physicalTopology", out var topology) && topology.ValueKind == JsonValueKind.Object)
        {
            // Authored topology/anchors can change which measured dimension interval a
            // covering occupies. The coordinates themselves are never treated as mm.
            result["physicalTopology"] = new JsonObject
            {
                ["nodes"] = Collection(topology, "nodes", item => Pick(item, "id", "position", "connectorId", "wireIds")),
                ["segments"] = Collection(topology, "segments", item => Pick(item, "id", "from", "to", "path", "bends", "routing", "specificationItemId")),
                ["routes"] = Collection(topology, "routes", item => Pick(item, "wireId", "steps"), "wireId"),
                ["coverings"] = Collection(topology, "coverings", item => Pick(item, "id", "name", "kind", "color", "lengthMode", "lengthMm", "material", "spans", "bundle")),
            };
        }
        result["dimensions"] = design.TryGetProperty("drawingDocuments", out var drawings) && drawings.ValueKind == JsonValueKind.Object
            ? Collection(drawings, "dimensions", item => Pick(item, "id", "wireId", "segmentId", "from", "to", "pointCount", "routeKey", "lengthMm", "auxiliary"))
            : new JsonArray();
        return result;
    }

    private static JsonObject Pick(JsonElement owner, params string[] keys)
    {
        var result = new JsonObject();
        if (owner.ValueKind != JsonValueKind.Object) return result;
        foreach (var key in keys) if (owner.TryGetProperty(key, out var value)) result[key] = JsonNode.Parse(value.GetRawText());
        return result;
    }

    private static JsonArray Collection(JsonElement owner, string key, Func<JsonElement, JsonNode> select, string identity = "id")
    {
        if (!owner.TryGetProperty(key, out var value) || value.ValueKind != JsonValueKind.Array) return new JsonArray();
        return new JsonArray(value.EnumerateArray().OrderBy(item => item.TryGetProperty(identity, out var id) ? id.GetString() : "", StringComparer.Ordinal).Select(select).ToArray());
    }

    private static string Canonical(JsonNode value)
    {
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream, new JsonWriterOptions { Indented = false })) Write(writer, value);
        return Encoding.UTF8.GetString(stream.ToArray());
    }

    private static void Write(Utf8JsonWriter writer, JsonNode? value)
    {
        if (value is null) { writer.WriteNullValue(); return; }
        if (value is JsonObject obj)
        {
            writer.WriteStartObject();
            foreach (var property in obj.OrderBy(pair => pair.Key, StringComparer.Ordinal))
            {
                writer.WritePropertyName(property.Key);
                Write(writer, property.Value);
            }
            writer.WriteEndObject();
            return;
        }
        if (value is JsonArray array)
        {
            writer.WriteStartArray(); foreach (var item in array) Write(writer, item); writer.WriteEndArray(); return;
        }
        using var primitive = JsonDocument.Parse(value.ToJsonString());
        if (primitive.RootElement.ValueKind == JsonValueKind.Number && primitive.RootElement.TryGetDecimal(out var number))
            writer.WriteRawValue(number.ToString("G29", System.Globalization.CultureInfo.InvariantCulture));
        else value.WriteTo(writer);
    }
}
