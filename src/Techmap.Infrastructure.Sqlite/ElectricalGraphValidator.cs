using System.Text.Json;
using Techmap.Application;

namespace Techmap.Infrastructure.Sqlite;

/// <summary>Checks electrical identity and references, independently of derived drawing geometry.</summary>
internal static class ElectricalGraphValidator
{
    internal static int RequiredWriterContract(JsonElement root)
    {
        if (!root.TryGetProperty("requiredWriterContractVersion", out var version)) return 0;
        if (version.ValueKind != JsonValueKind.Number || !version.TryGetInt32(out var number) || number != 1)
            throw new HarnessDesignDocumentException("unsupported_design_writer_contract",
                "The document requires an unsupported design writer contract.", "content.requiredWriterContractVersion");
        return number;
    }

    internal static void Validate(JsonElement root)
    {
        var strict = RequiredWriterContract(root) == 1;
        if (strict)
            foreach (var property in new[] { "connectors", "wires" })
                if (!root.TryGetProperty(property, out _)) throw Invalid("A protected document requires its electrical collections.", "content." + property);
        var connectors = Index(root, "connectors");
        var wires = Index(root, "wires");
        var junctions = Index(root, "junctions");
        var screens = Index(root, "screens");
        var pairs = Index(root, "diffPairs");
        var contacts = new Dictionary<string, HashSet<string>?>(StringComparer.Ordinal);
        foreach (var (id, entry) in connectors)
        {
            if (strict && !entry.Value.TryGetProperty("contacts", out _))
                throw Invalid("A protected connector requires its contacts.", entry.Path + ".contacts");
            // Historical server documents may have connector shells without contacts.
            contacts[id] = entry.Value.TryGetProperty("contacts", out _)
                ? Index(entry.Value, "contacts", entry.Path).Keys.ToHashSet(StringComparer.Ordinal) : null;
        }

        var junctionMembers = Members(junctions, wires, 2);
        var screenMembers = Members(screens, wires, 1);
        var pairMembers = Members(pairs, wires, 2, 2);
        var paired = new HashSet<string>(StringComparer.Ordinal);
        foreach (var (id, members) in pairMembers)
            foreach (var wire in members)
                if (!paired.Add(wire)) throw Invalid("A wire cannot belong to multiple differential pairs.", pairs[id].Path + ".wireIds");

        foreach (var (wireId, wire) in wires)
        {
            foreach (var end in new[] { "from", "to" })
            {
                // Endpoint-less legacy records remain round-trippable. Presence opts into
                // validation; requiring endpoints needs a separately versioned write contract.
                if (!wire.Value.TryGetProperty(end, out var endpoint))
                {
                    if (strict) throw Invalid("A protected wire requires both endpoints.", wire.Path + "." + end);
                    continue;
                }
                var path = wire.Path + "." + end;
                if (endpoint.ValueKind != JsonValueKind.Object) throw Invalid("A wire endpoint must be an object.", path);
                var isJunction = endpoint.TryGetProperty("junctionId", out _);
                var isScreen = endpoint.TryGetProperty("screenId", out _);
                if (isJunction && isScreen) throw Invalid("A wire endpoint cannot reference both a junction and a screen.", path);
                if (isJunction || isScreen)
                {
                    foreach (var property in new[] { "connectorId", "contactId" })
                        if (endpoint.TryGetProperty(property, out var placeholder) &&
                            (placeholder.ValueKind != JsonValueKind.String || placeholder.GetString() != ""))
                            throw Invalid("A junction or screen endpoint cannot also reference a contact.", path + "." + property);
                }
                if (isJunction)
                {
                    var id = Text(endpoint, "junctionId", path);
                    if (!junctionMembers.TryGetValue(id, out var members) || !members.Contains(wireId))
                        throw Invalid("The endpoint junction must exist and include its terminating wire.", path + ".junctionId");
                }
                else if (isScreen)
                {
                    var id = Text(endpoint, "screenId", path);
                    if (!screenMembers.TryGetValue(id, out var members)) throw Invalid("The endpoint screen does not exist.", path + ".screenId");
                    if (members.Contains(wireId)) throw Invalid("A wire cannot terminate on its own enclosing screen.", path + ".screenId");
                    var configuredSide = screens[id].Value.TryGetProperty("terminalSide", out var side)
                        ? String(side, screens[id].Path + ".terminalSide") : "above";
                    if (configuredSide is not ("above" or "below" or "both"))
                        throw Invalid("Invalid screen terminal side.", screens[id].Path + ".terminalSide");
                    if (endpoint.TryGetProperty("screenTerminalSide", out var requestedSide))
                    {
                        var requested = String(requestedSide, path + ".screenTerminalSide");
                        if (requested is not ("above" or "below") || (configuredSide != "both" && requested != configuredSide))
                            throw Invalid("The requested screen terminal does not exist.", path + ".screenTerminalSide");
                    }
                }
                else
                {
                    var connectorId = Text(endpoint, "connectorId", path);
                    if (!contacts.TryGetValue(connectorId, out var contactIds)) throw Invalid("The endpoint connector does not exist.", path + ".connectorId");
                    if (contactIds is null && !endpoint.TryGetProperty("contactId", out _)) continue;
                    var contactId = Text(endpoint, "contactId", path);
                    if (contactIds is null || !contactIds.Contains(contactId)) throw Invalid("The endpoint contact does not exist on its connector.", path + ".contactId");
                }
            }
        }
    }

    private sealed record Entry(JsonElement Value, string Path);

    private static Dictionary<string, Entry> Index(JsonElement owner, string property, string path = "content")
    {
        var result = new Dictionary<string, Entry>(StringComparer.Ordinal);
        if (!owner.TryGetProperty(property, out var array)) return result;
        if (array.ValueKind != JsonValueKind.Array) throw Invalid("An electrical graph collection must be an array.", path + "." + property);
        var index = 0;
        foreach (var item in array.EnumerateArray())
        {
            var itemPath = $"{path}.{property}[{index++}]";
            var id = Text(item, "id", itemPath);
            if (!result.TryAdd(id, new Entry(item, itemPath))) throw Invalid("Electrical object IDs must be unique within their collection.", itemPath + ".id");
        }
        return result;
    }

    private static Dictionary<string, HashSet<string>> Members(Dictionary<string, Entry> groups,
        Dictionary<string, Entry> wires, int minimum, int maximum = int.MaxValue)
    {
        var result = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);
        foreach (var (id, group) in groups)
        {
            var path = group.Path + ".wireIds";
            if (!group.Value.TryGetProperty("wireIds", out var array) || array.ValueKind != JsonValueKind.Array ||
                array.GetArrayLength() < minimum || array.GetArrayLength() > maximum)
                throw Invalid("The electrical group has an invalid number of member wires.", path);
            var members = new HashSet<string>(StringComparer.Ordinal);
            foreach (var item in array.EnumerateArray())
            {
                var wire = String(item, path);
                if (!wires.ContainsKey(wire) || !members.Add(wire))
                    throw Invalid("Electrical groups must reference unique existing wires.", path);
            }
            result[id] = members;
        }
        return result;
    }

    private static string Text(JsonElement owner, string property, string path) =>
        owner.ValueKind == JsonValueKind.Object && owner.TryGetProperty(property, out var value)
            ? String(value, path + "." + property) : throw Invalid("An electrical object ID is required.", path + "." + property);

    private static string String(JsonElement value, string path) =>
        value.ValueKind == JsonValueKind.String && value.GetString() is { Length: <= 1024 } text && !string.IsNullOrWhiteSpace(text)
            ? text : throw Invalid("An electrical object ID must be non-empty text.", path);

    private static HarnessDesignDocumentException Invalid(string message, string field) =>
        new("invalid_electrical_graph", message, field);
}
