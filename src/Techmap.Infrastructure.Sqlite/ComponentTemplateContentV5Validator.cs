using System.Diagnostics.CodeAnalysis;
using System.Text.Json;
using System.Text.Json.Nodes;
using Techmap.Application;

namespace Techmap.Infrastructure.Sqlite;

/// <summary>
/// Validates schema v5, where terminal compatibility has one root authority
/// and the article/table contact groups only carry contact counts.
/// </summary>
internal static class ComponentTemplateContentV5Validator
{
    private static readonly string[] RootProperties =
    [
        "schemaVersion", "views", "logicalContacts", "parameters", "repeaters", "assets",
        "contactTypeGroups", "articleVariants", "compatibleTerminalArticleKeys", "e4ConnectorTable",
    ];

    internal static void Validate(JsonElement content)
    {
        RequireExactPropertiesWithOptional(content, "content", RootProperties, "terminalContactTypeBindings", "e4Presentation");
        if (content.TryGetProperty("e4Presentation", out var presentation)) ValidatePresentation(presentation);
        if (content.GetProperty("schemaVersion").ValueKind != JsonValueKind.Number ||
            !content.GetProperty("schemaVersion").TryGetInt32(out var version) || version != 5)
            Throw("Only component template schemaVersion 5 is supported.", "content.schemaVersion");

        var compatible = ValidateCompatibleTerminals(content.GetProperty("compatibleTerminalArticleKeys"));
        var terminalBindings = ValidateTerminalBindings(content, compatible);
        ValidateArticleGroupShapes(content.GetProperty("articleVariants"));
        ValidateTableV2Shape(content.GetProperty("e4ConnectorTable"), compatible);

        var projected = JsonNode.Parse(content.GetRawText())!.AsObject();
        projected["schemaVersion"] = 4;
        projected.Remove("compatibleTerminalArticleKeys");
        projected.Remove("terminalContactTypeBindings");
        projected.Remove("e4Presentation");
        var terminalNodes = CompatibleTerminalNodes(content.GetProperty("compatibleTerminalArticleKeys"));
        foreach (var variant in projected["articleVariants"]!.AsArray())
        {
            if (variant!["contactGroups"] is not JsonArray groups) continue;
            foreach (var group in groups)
                group!["allowedTerminalArticleKeys"] = TerminalNodesForGroup(terminalNodes, terminalBindings, group!["contactTypeGroupId"]!.GetValue<string>());
        }
        var table = projected["e4ConnectorTable"]!.AsObject();
        table["modelVersion"] = 1;
        foreach (var article in table["articles"]!.AsArray())
            foreach (var group in article!["contactGroups"]!.AsArray())
                group!["allowedTerminalArticleKeys"] = TerminalNodesForGroup(terminalNodes, terminalBindings, group!["contactTypeGroupId"]!.GetValue<string>());

        using var projectedDocument = JsonDocument.Parse(projected.ToJsonString());
        ComponentTemplateContentV4Validator.Validate(projectedDocument.RootElement, independentE4: true);
    }

    private static void ValidatePresentation(JsonElement value)
    {
        const string path = "content.e4Presentation";
        RequireExactProperties(value, path, "orientation", "baseColumns", "customFields");
        if (RequiredText(value.GetProperty("orientation"), 32, path + ".orientation") is not ("contacts-left" or "contacts-right"))
            Throw("Invalid orientation.", path + ".orientation");
        var columns = value.GetProperty("baseColumns");
        if (columns.ValueKind != JsonValueKind.Array) Throw("An array is required.", path + ".baseColumns");
        var keys = new HashSet<string>(StringComparer.Ordinal);
        foreach (var column in columns.EnumerateArray())
        {
            RequireExactProperties(column, path + ".baseColumns", "key", "visible");
            var key = RequiredText(column.GetProperty("key"), 32, path + ".baseColumns.key");
            if (key is not ("number" or "contactType" or "circuit" or "terminal" or "wire" or "color") || !keys.Add(key) ||
                column.GetProperty("visible").ValueKind is not (JsonValueKind.True or JsonValueKind.False))
                Throw("Invalid or duplicate base column.", path + ".baseColumns");
        }
        var fields = value.GetProperty("customFields");
        if (fields.ValueKind != JsonValueKind.Array) Throw("An array is required.", path + ".customFields");
        keys.Clear();
        foreach (var field in fields.EnumerateArray())
        {
            RequireExactProperties(field, path + ".customFields", "id", "label", "visible");
            var id = RequiredText(field.GetProperty("id"), 128, path + ".customFields.id");
            _ = RequiredText(field.GetProperty("label"), 120, path + ".customFields.label");
            if (!keys.Add(id) || field.GetProperty("visible").ValueKind is not (JsonValueKind.True or JsonValueKind.False))
                Throw("Invalid or duplicate custom field.", path + ".customFields");
        }
    }

    private static Dictionary<string, (string ContactTypeGroupId, bool Standard)>? ValidateTerminalBindings(
        JsonElement content,
        IReadOnlySet<string> compatible)
    {
        if (!content.TryGetProperty("terminalContactTypeBindings", out var values)) return null;
        const string path = "content.terminalContactTypeBindings";
        if (values.ValueKind != JsonValueKind.Array) Throw("An array is required.", path);
        var contactTypes = content.GetProperty("contactTypeGroups").EnumerateArray()
            .Select(group => group.GetProperty("id").GetString()!).ToHashSet(StringComparer.Ordinal);
        var result = new Dictionary<string, (string, bool)>(StringComparer.Ordinal);
        var standards = new HashSet<string>(StringComparer.Ordinal);
        var index = 0;
        foreach (var value in values.EnumerateArray())
        {
            var itemPath = $"{path}[{index++}]";
            RequireExactProperties(value, itemPath, "terminalArticleKey", "contactTypeGroupId", "standard");
            var terminalIdentity = ValidateArticleKey(value.GetProperty("terminalArticleKey"), itemPath + ".terminalArticleKey");
            if (!compatible.Contains(terminalIdentity)) Throw("The bound terminal is absent from compatibleTerminalArticleKeys.", itemPath + ".terminalArticleKey");
            var groupId = RequiredText(value.GetProperty("contactTypeGroupId"), 128, itemPath + ".contactTypeGroupId");
            if (!contactTypes.Contains(groupId)) Throw("The bound contact type is absent from contactTypeGroups.", itemPath + ".contactTypeGroupId");
            var standardValue = value.GetProperty("standard");
            if (standardValue.ValueKind is not JsonValueKind.True and not JsonValueKind.False)
                Throw("A boolean is required.", itemPath + ".standard");
            var standard = standardValue.GetBoolean();
            if (!result.TryAdd(terminalIdentity, (groupId, standard))) Throw("A terminal can be bound only once.", itemPath);
            if (standard && !standards.Add(groupId)) Throw("Only one standard terminal is allowed per contact type.", itemPath);
        }
        return result;
    }

    private static JsonArray TerminalNodesForGroup(
        JsonArray terminals,
        IReadOnlyDictionary<string, (string ContactTypeGroupId, bool Standard)>? bindings,
        string groupId)
    {
        if (bindings is null) return (JsonArray)terminals.DeepClone();
        var result = new JsonArray();
        foreach (var terminal in terminals)
        {
            using var document = JsonDocument.Parse(terminal!.ToJsonString());
            var identity = ValidateArticleKey(document.RootElement, "content.compatibleTerminalArticleKeys");
            if (bindings.TryGetValue(identity, out var binding) && binding.ContactTypeGroupId == groupId)
                result.Add(terminal.DeepClone());
        }
        return result;
    }

    private static HashSet<string> ValidateCompatibleTerminals(JsonElement values)
    {
        const string path = "content.compatibleTerminalArticleKeys";
        if (values.ValueKind != JsonValueKind.Array) Throw("An array is required.", path);
        if (values.GetArrayLength() > ComponentTemplateContentV3Validator.MaximumTerminalArticlesPerGroup)
            Throw($"A template cannot contain more than {ComponentTemplateContentV3Validator.MaximumTerminalArticlesPerGroup} compatible terminal articles.", path);
        var result = new HashSet<string>(StringComparer.Ordinal);
        var index = 0;
        foreach (var value in values.EnumerateArray())
        {
            var itemPath = $"{path}[{index++}]";
            var identity = ValidateArticleKey(value, itemPath);
            if (!result.Add(identity)) Throw("A compatible terminal article cannot be repeated.", itemPath);
        }
        return result;
    }

    private static void ValidateArticleGroupShapes(JsonElement variants)
    {
        var variantIndex = 0;
        foreach (var variant in variants.EnumerateArray())
        {
            var groups = variant.GetProperty("contactGroups");
            if (groups.ValueKind != JsonValueKind.Array)
                Throw("Article contactGroups must be an array in schemaVersion 5.", $"content.articleVariants[{variantIndex}].contactGroups");
            var groupIndex = 0;
            foreach (var group in groups.EnumerateArray())
                RequireExactProperties(group, $"content.articleVariants[{variantIndex}].contactGroups[{groupIndex++}]", "contactTypeGroupId", "contactCount");
            variantIndex++;
        }
    }

    private static void ValidateTableV2Shape(JsonElement table, IReadOnlySet<string> compatible)
    {
        const string path = "content.e4ConnectorTable";
        if (table.ValueKind != JsonValueKind.Object) Throw("An object is required.", path);
        var modelVersion = table.GetProperty("modelVersion");
        if (modelVersion.ValueKind != JsonValueKind.Number || !modelVersion.TryGetInt32(out var parsed) || parsed != 2)
            Throw("Only E4 connector table modelVersion 2 is supported.", path + ".modelVersion");
        var articles = table.GetProperty("articles");
        if (articles.ValueKind != JsonValueKind.Array) Throw("An array is required.", path + ".articles");
        var articleIndex = 0;
        foreach (var article in articles.EnumerateArray())
        {
            var articlePath = $"{path}.articles[{articleIndex++}]";
            var groups = article.GetProperty("contactGroups");
            if (groups.ValueKind != JsonValueKind.Array) Throw("An array is required.", articlePath + ".contactGroups");
            var groupIndex = 0;
            foreach (var group in groups.EnumerateArray())
                RequireExactProperties(group, $"{articlePath}.contactGroups[{groupIndex++}]", "contactTypeGroupId", "contactCount");
            ValidateRowTerminals(article.GetProperty("rows"), articlePath + ".rows", compatible);
        }
        ValidateDefaultTerminals(table.GetProperty("seriesDefaults"), path + ".seriesDefaults", compatible);
    }

    private static void ValidateDefaultTerminals(JsonElement rows, string path, IReadOnlySet<string> compatible)
    {
        if (rows.ValueKind != JsonValueKind.Array) Throw("An array is required.", path);
        var index = 0;
        foreach (var row in rows.EnumerateArray())
            ValidateTerminalValue(row.GetProperty("values"), $"{path}[{index++}].values", compatible);
    }

    private static void ValidateRowTerminals(JsonElement rows, string path, IReadOnlySet<string> compatible)
    {
        if (rows.ValueKind != JsonValueKind.Array) Throw("An array is required.", path);
        var index = 0;
        foreach (var row in rows.EnumerateArray())
            ValidateTerminalValue(row.GetProperty("overrides"), $"{path}[{index++}].overrides", compatible);
    }

    private static void ValidateTerminalValue(JsonElement values, string path, IReadOnlySet<string> compatible)
    {
        if (values.ValueKind != JsonValueKind.Object) Throw("An object is required.", path);
        if (!values.TryGetProperty("standardTerminalArticleKey", out var value) || value.ValueKind == JsonValueKind.Null) return;
        var terminalPath = path + ".standardTerminalArticleKey";
        if (!compatible.Contains(ValidateArticleKey(value, terminalPath)))
            Throw("The standard terminal is absent from compatibleTerminalArticleKeys.", terminalPath);
    }

    private static JsonArray CompatibleTerminalNodes(JsonElement values)
    {
        var result = new JsonArray();
        foreach (var item in values.EnumerateArray()) result.Add(JsonNode.Parse(item.GetRawText()));
        return result;
    }

    private static string ValidateArticleKey(JsonElement value, string path)
    {
        RequireExactProperties(value, path, "sourceId", "entityType", "articleKey");
        return RequiredText(value.GetProperty("sourceId"), 128, path + ".sourceId") + "\0" +
            RequiredText(value.GetProperty("entityType"), 64, path + ".entityType") + "\0" +
            RequiredText(value.GetProperty("articleKey"), 512, path + ".articleKey");
    }

    private static string RequiredText(JsonElement value, int maximum, string path)
    {
        if (value.ValueKind != JsonValueKind.String) Throw("A string is required.", path);
        var text = value.GetString()!;
        if (string.IsNullOrWhiteSpace(text) || text.Length > maximum || text.Any(char.IsControl))
            Throw($"A non-empty string of at most {maximum} characters is required.", path);
        return text;
    }

    private static void RequireExactProperties(JsonElement value, string path, params string[] expected)
    {
        if (value.ValueKind != JsonValueKind.Object) Throw("An object is required.", path);
        var actual = value.EnumerateObject().Select(property => property.Name).ToArray();
        if (actual.Length != expected.Length || actual.Distinct(StringComparer.Ordinal).Count() != actual.Length ||
            !actual.Order(StringComparer.Ordinal).SequenceEqual(expected.Order(StringComparer.Ordinal)))
            Throw("Object has missing, extra, or duplicate properties.", path);
    }

    private static void RequireExactPropertiesWithOptional(JsonElement value, string path, string[] required, params string[] optional)
    {
        if (value.ValueKind != JsonValueKind.Object) Throw("An object is required.", path);
        var actual = value.EnumerateObject().Select(property => property.Name).ToArray();
        var allowed = required.Concat(optional).ToHashSet(StringComparer.Ordinal);
        if (actual.Distinct(StringComparer.Ordinal).Count() != actual.Length || actual.Any(property => !allowed.Contains(property)) ||
            required.Any(property => !actual.Contains(property, StringComparer.Ordinal)))
            Throw("Object has missing, extra, or duplicate properties.", path);
    }

    [DoesNotReturn]
    private static void Throw(string message, string path) =>
        throw new ComponentTemplateException("component_template_content_invalid", message, path);
}
