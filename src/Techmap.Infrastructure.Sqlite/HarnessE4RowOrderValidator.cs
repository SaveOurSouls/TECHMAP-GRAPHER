using System.Text.Json;
using Techmap.Application;

namespace Techmap.Infrastructure.Sqlite;

internal static class HarnessE4RowOrderValidator
{
    public static void Validate(JsonElement root)
    {
        if (!root.TryGetProperty("connectors", out var connectors) || connectors.ValueKind != JsonValueKind.Array) return;
        var index = 0;
        foreach (var connector in connectors.EnumerateArray())
        {
            var field = $"content.connectors[{index++}].schematic.rowOrder";
            if (connector.ValueKind != JsonValueKind.Object ||
                !connector.TryGetProperty("schematic", out var schematic) || schematic.ValueKind != JsonValueKind.Object ||
                !schematic.TryGetProperty("rowOrder", out var order)) continue;
            if (order.ValueKind != JsonValueKind.Array ||
                !connector.TryGetProperty("contacts", out var contacts) || contacts.ValueKind != JsonValueKind.Array)
                throw Invalid(field);
            var ids = contacts.EnumerateArray().Where(c => c.ValueKind == JsonValueKind.Object &&
                c.TryGetProperty("id", out var id) && id.ValueKind == JsonValueKind.String)
                .Select(c => c.GetProperty("id").GetString()!).ToHashSet(StringComparer.Ordinal);
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var row in order.EnumerateArray())
            {
                if (row.ValueKind != JsonValueKind.String || string.IsNullOrWhiteSpace(row.GetString()) ||
                    !ids.Contains(row.GetString()!) || !seen.Add(row.GetString()!)) throw Invalid(field);
            }
        }
    }

    private static HarnessDesignDocumentException Invalid(string field) => new(
        "invalid_e4_row_order", "E4 row order must contain unique existing contact IDs.", field);
}
