using System.Globalization;
using System.Text.Json;
using Techmap.Application;

namespace Techmap.Infrastructure.Sqlite;

/// <summary>Validates the opt-in source-number contract without changing legacy documents.</summary>
internal static class TemplateContactNumberingValidator
{
    internal static void ValidateDesign(JsonElement root)
    {
        if (!root.TryGetProperty("connectors", out var connectors) || connectors.ValueKind != JsonValueKind.Array) return;
        var index = 0;
        foreach (var connector in connectors.EnumerateArray())
        {
            try { ValidateInstance(connector, $"content.connectors[{index++}]"); }
            catch (ProjectComponentSnapshotException error)
            {
                throw new HarnessDesignDocumentException(error.Code, error.Message, error.Field, innerException: error);
            }
        }
    }

    internal static void ValidateInstance(JsonElement instance, string path = "instance")
    {
        if (instance.ValueKind != JsonValueKind.Object ||
            !instance.TryGetProperty("libraryBinding", out var binding) || binding.ValueKind != JsonValueKind.Object ||
            !binding.TryGetProperty("contactNumbering", out var marker)) return;
        if (marker.ValueKind != JsonValueKind.String || marker.GetString() != "source-v1" ||
            !binding.TryGetProperty("mode", out var mode) || mode.ValueKind != JsonValueKind.String || mode.GetString() != "template")
            throw Invalid("Unsupported template contact numbering contract.", path + ".libraryBinding.contactNumbering");
        var connectorId = RequiredText(instance, "id", path);
        if (!binding.TryGetProperty("snapshot", out var snapshot) || snapshot.ValueKind != JsonValueKind.Object ||
            !snapshot.TryGetProperty("contacts", out var sources) || sources.ValueKind != JsonValueKind.Array)
            throw Invalid("Source contact numbering requires materialized snapshot contacts.", path + ".libraryBinding.snapshot.contacts");
        if (!instance.TryGetProperty("contacts", out var contacts) || contacts.ValueKind != JsonValueKind.Array ||
            contacts.GetArrayLength() != sources.GetArrayLength())
            throw Invalid("Instance contacts must match the materialized snapshot.", path + ".contacts");

        var numbersById = new Dictionary<string, int>(StringComparer.Ordinal);
        var numbers = new HashSet<int>();
        var sourceIndex = 0;
        foreach (var source in sources.EnumerateArray())
        {
            var sourcePath = $"{path}.libraryBinding.snapshot.contacts[{sourceIndex++}]";
            var logicalId = RequiredText(source, "logicalContactId", sourcePath);
            var text = RequiredText(source, "sourceNumber", sourcePath);
            if (text.Length > 128 || text.Any(character => character is < '0' or > '9') ||
                !int.TryParse(text, NumberStyles.None, CultureInfo.InvariantCulture, out var number) || number is < 1 or > 300)
                throw Invalid("Source contact numbers must contain ASCII digits representing an integer from 1 to 300.", sourcePath + ".sourceNumber");
            if (!numbers.Add(number))
                throw Invalid("Source contact numbers must be numerically unique.", sourcePath + ".sourceNumber");
            if (!numbersById.TryAdd(logicalId, number))
                throw Invalid("Materialized logical contact IDs must be unique.", sourcePath + ".logicalContactId");
        }

        var seen = new HashSet<string>(StringComparer.Ordinal);
        var contactIndex = 0;
        foreach (var contact in contacts.EnumerateArray())
        {
            var contactPath = $"{path}.contacts[{contactIndex++}]";
            var logicalId = RequiredText(contact, "logicalContactId", contactPath);
            if (!seen.Add(logicalId) || !numbersById.TryGetValue(logicalId, out var expected))
                throw Invalid("Instance logical contact IDs must match the materialized snapshot.", contactPath + ".logicalContactId");
            if (RequiredText(contact, "id", contactPath) != $"{connectorId}:contact:{logicalId}")
                throw Invalid("Contact identity must use its placement and logical contact ID.", contactPath + ".id");
            if (!contact.TryGetProperty("number", out var number) || number.ValueKind != JsonValueKind.Number ||
                !number.TryGetInt32(out var actual) || actual != expected)
                throw Invalid("Contact number must equal its materialized source number.", contactPath + ".number");
        }
    }

    private static string RequiredText(JsonElement owner, string property, string path)
    {
        if (owner.ValueKind != JsonValueKind.Object || !owner.TryGetProperty(property, out var value) ||
            value.ValueKind != JsonValueKind.String || string.IsNullOrWhiteSpace(value.GetString()))
            throw Invalid("A non-empty contact identity or source number is required.", path + "." + property);
        return value.GetString()!;
    }

    private static ProjectComponentSnapshotException Invalid(string message, string field) =>
        new("invalid_template_contact_numbering", message, field);
}
