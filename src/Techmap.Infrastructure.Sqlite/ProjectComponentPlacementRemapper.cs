using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Techmap.Infrastructure.Sqlite;

internal sealed record ProjectComponentPlacementRemap(
    string DesignJson,
    IReadOnlyDictionary<Guid, string> InstancesBySourcePlacementId);

internal static class ProjectComponentPlacementRemapper
{
    internal static ProjectComponentPlacementRemap RemapHarnessDesign(
        string designJson,
        IReadOnlyDictionary<Guid, Guid> placementIds)
    {
        ArgumentNullException.ThrowIfNull(designJson);
        ArgumentNullException.ThrowIfNull(placementIds);
        if (placementIds.Count == 0)
            return new ProjectComponentPlacementRemap(
                designJson,
                new Dictionary<Guid, string>());
        JsonObject root;
        try
        {
            root = JsonNode.Parse(designJson)?.AsObject()
                ?? throw new JsonException("The harness design root is not an object.");
        }
        catch (Exception error) when (error is JsonException or InvalidOperationException)
        {
            throw new InvalidDataException("The harness design document is invalid.", error);
        }

        if (root["connectors"] is not JsonArray connectors || root["wires"] is not JsonArray wires)
            throw new InvalidDataException("The harness design connector or wire collection is invalid.");

        var destinationIds = placementIds.Values.ToHashSet();
        if (destinationIds.Count != placementIds.Count ||
            placementIds.Any(pair => pair.Key == Guid.Empty || pair.Value == Guid.Empty))
            throw new InvalidDataException("A component placement remap is invalid.");

        var contactIds = new Dictionary<(Guid PlacementId, string ContactId), string>();
        var instances = new Dictionary<Guid, string>();
        foreach (var item in connectors)
        {
            if (item is not JsonObject connector ||
                connector["id"]?.GetValueKind() != JsonValueKind.String)
                continue;
            var sourceIdText = connector["id"]!.GetValue<string>();
            if (!Guid.TryParseExact(sourceIdText, "D", out var sourceId) ||
                !placementIds.TryGetValue(sourceId, out var destinationId))
                continue;
            if (instances.ContainsKey(sourceId))
                throw new InvalidDataException("A component placement occurs more than once in a harness design.");

            var destinationIdText = destinationId.ToString("D", CultureInfo.InvariantCulture);
            if (connectors.Any(candidate => candidate is JsonObject other && !ReferenceEquals(other, connector) &&
                    string.Equals(other["id"]?.GetValue<string>(), destinationIdText, StringComparison.Ordinal)))
                throw new InvalidDataException("A remapped component placement ID conflicts with a connector ID.");

            if (connector["contacts"] is JsonArray contacts)
            {
                foreach (var contactItem in contacts)
                {
                    if (contactItem is not JsonObject contact ||
                        contact["id"]?.GetValueKind() != JsonValueKind.String)
                        throw new InvalidDataException("A template component contact ID is missing.");
                    var sourceContactId = contact["id"]!.GetValue<string>();
                    var expectedPrefix = sourceIdText + ":contact:";
                    if (!sourceContactId.StartsWith(expectedPrefix, StringComparison.Ordinal) ||
                        sourceContactId.Length == expectedPrefix.Length)
                        throw new InvalidDataException("A template component contact ID is inconsistent with its placement.");
                    var destinationContactId = destinationIdText + sourceContactId[sourceIdText.Length..];
                    if (!contactIds.TryAdd((sourceId, sourceContactId), destinationContactId))
                        throw new InvalidDataException("A template component contact ID is duplicated.");
                    contact["id"] = destinationContactId;
                }
            }

            connector["id"] = destinationIdText;
            instances.Add(sourceId, connector.ToJsonString());
        }

        if (instances.Count != placementIds.Count)
            throw new InvalidDataException("A component placement is missing from its harness design.");

        foreach (var item in wires)
        {
            if (item is not JsonObject wire) continue;
            RemapEndpoint(wire["from"], placementIds, contactIds);
            RemapEndpoint(wire["to"], placementIds, contactIds);
        }

        // Re-read the connector nodes after wire updates to guarantee that the
        // placement row is byte-for-byte the same object stored in the design.
        foreach (var item in connectors)
        {
            if (item is not JsonObject connector ||
                connector["id"]?.GetValueKind() != JsonValueKind.String ||
                !Guid.TryParseExact(connector["id"]!.GetValue<string>(), "D", out var destinationId))
                continue;
            var source = placementIds.SingleOrDefault(pair => pair.Value == destinationId).Key;
            if (source != Guid.Empty) instances[source] = connector.ToJsonString();
        }

        return new ProjectComponentPlacementRemap(root.ToJsonString(), instances);
    }

    private static void RemapEndpoint(
        JsonNode? node,
        IReadOnlyDictionary<Guid, Guid> placementIds,
        IReadOnlyDictionary<(Guid PlacementId, string ContactId), string> contactIds)
    {
        if (node is not JsonObject endpoint ||
            endpoint["connectorId"]?.GetValueKind() != JsonValueKind.String)
            return;
        var sourceIdText = endpoint["connectorId"]!.GetValue<string>();
        if (!Guid.TryParseExact(sourceIdText, "D", out var sourceId) ||
            !placementIds.TryGetValue(sourceId, out var destinationId))
            return;
        if (endpoint["contactId"]?.GetValueKind() != JsonValueKind.String)
            throw new InvalidDataException("A wire endpoint contact ID is missing.");
        var sourceContactId = endpoint["contactId"]!.GetValue<string>();
        if (!contactIds.TryGetValue((sourceId, sourceContactId), out var destinationContactId))
            throw new InvalidDataException("A wire endpoint references an unknown template component contact.");
        endpoint["connectorId"] = destinationId.ToString("D", CultureInfo.InvariantCulture);
        endpoint["contactId"] = destinationContactId;
    }
}
