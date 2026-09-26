using System.Text.Json;
using System.Text.Json.Nodes;
using Techmap.Infrastructure.Sqlite;

namespace Techmap.Web.Tests;

internal static class PreparedCutRouteFixture
{
    internal static JsonElement Add(JsonElement content, long quantity, string? fingerprint = null)
    {
        var root = JsonNode.Parse(content.GetRawText())!;
        var changedGraph = false;
        var wires = root["wires"]!.AsArray();
        foreach (var end in new[] { "from", "to" })
        {
            var missing = wires.Where(wire => wire![end] is null).ToArray();
            if (missing.Length == 0) continue;
            changedGraph = true;
            var connectorId = "cut-fixture-" + end;
            var contacts = new JsonArray();
            foreach (var wire in missing)
            {
                var contactId = connectorId + "-" + (contacts.Count + 1);
                contacts.Add(JsonSerializer.SerializeToNode(new { id = contactId, number = contacts.Count + 1 }));
                wire![end] = JsonSerializer.SerializeToNode(new { connectorId, contactId });
            }
            root["connectors"]!.AsArray().Add(JsonSerializer.SerializeToNode(new { id = connectorId, designation = connectorId, contacts }));
        }
        var rows = new JsonArray();
        var refs = new List<(string Kind, string Id)>();
        foreach (var kind in new[] { ("wire", "wires"), ("cable", "cables") })
            foreach (var item in root[kind.Item2]?.AsArray() ?? []) refs.Add((kind.Item1, item!["id"]!.GetValue<string>()));
        foreach (var item in root["physicalTopology"]?["coverings"]?.AsArray() ?? []) refs.Add(("covering", item!["id"]!.GetValue<string>()));
        foreach (var (kind, id) in refs)
            rows.Add(JsonSerializer.SerializeToNode(new {
                id = "row-" + rows.Count, kind = "semiFinished", title = id, comment = "", sourceObjects = new[] { new { kind, id } }, dependsOn = Array.Empty<string>(), prepared = true,
                operations = new[] { new { id = "cut-" + rows.Count, mode = "cut", note = "", binding = new { sourceId = "operations", entityType = "operation", snapshotId = "11111111-1111-4111-8111-111111111111", snapshotSha256 = new string('a', 64), recordId = new string('b', 64), sourceKey = "cut", displayName = "Резка" } } },
                presentation = new { backgroundOpacity = .25, objects = Array.Empty<object>() }
            }));
        root["manufacturingRoute"] = JsonSerializer.SerializeToNode(new { contractVersion = 1, status = "draft", source = new { fingerprintVersion = 1, sha256 = !changedGraph && fingerprint is not null ? fingerprint : ManufacturingRouteSourceFingerprint.Compute(JsonSerializer.SerializeToElement(root), quantity) }, rows });
        root["requiredWriterContractVersion"] = 2;
        return JsonSerializer.SerializeToElement(root);
    }
}
