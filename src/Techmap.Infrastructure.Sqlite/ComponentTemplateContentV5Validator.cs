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
        RequireExactProperties(content, "content", RootProperties);
        if (content.GetProperty("schemaVersion").ValueKind != JsonValueKind.Number ||
            !content.GetProperty("schemaVersion").TryGetInt32(out var version) || version != 5)
            Throw("Only component template schemaVersion 5 is supported.", "content.schemaVersion");

        var compatible = ValidateCompatibleTerminals(content.GetProperty("compatibleTerminalArticleKeys"));
        ValidateArticleGroupShapes(content.GetProperty("articleVariants"));
        ValidateTableV2Shape(content.GetProperty("e4ConnectorTable"), compatible);

        var projected = JsonNode.Parse(content.GetRawText())!.AsObject();
        projected["schemaVersion"] = 4;
        projected.Remove("compatibleTerminalArticleKeys");
        var terminalNodes = CompatibleTerminalNodes(content.GetProperty("compatibleTerminalArticleKeys"));
        foreach (var variant in projected["articleVariants"]!.AsArray())
        {
            if (variant!["contactGroups"] is not JsonArray groups) continue;
            foreach (var group in groups)
                group!["allowedTerminalArticleKeys"] = terminalNodes.DeepClone();
        }
        var table = projected["e4ConnectorTable"]!.AsObject();
        table["modelVersion"] = 1;
        foreach (var article in table["articles"]!.AsArray())
            foreach (var group in article!["contactGroups"]!.AsArray())
                group!["allowedTerminalArticleKeys"] = terminalNodes.DeepClone();

        using var projectedDocument = JsonDocument.Parse(projected.ToJsonString());
        ComponentTemplateContentV4Validator.Validate(projectedDocument.RootElement);
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

    [DoesNotReturn]
    private static void Throw(string message, string path) =>
        throw new ComponentTemplateException("component_template_content_invalid", message, path);
}
