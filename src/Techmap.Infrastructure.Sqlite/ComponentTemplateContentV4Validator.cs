using System.Diagnostics.CodeAnalysis;
using System.Text.Json;
using System.Text.Json.Nodes;
using Techmap.Application;

namespace Techmap.Infrastructure.Sqlite;

/// <summary>Validates the persisted connector-series E4 table introduced by schema v4.</summary>
internal static class ComponentTemplateContentV4Validator
{
    internal const int MaximumSeriesRows = ComponentTemplateContentV2Validator.MaximumLogicalContacts;

    private static readonly string[] RootProperties =
        ["schemaVersion", "views", "logicalContacts", "parameters", "repeaters", "assets", "contactTypeGroups", "articleVariants", "e4ConnectorTable"];
    private static readonly IReadOnlyDictionary<string, string> RequiredColumns = new Dictionary<string, string>(StringComparer.Ordinal)
    {
        ["number"] = "№",
        ["name"] = "Назначение",
        ["circuitText"] = "Цепь",
        ["contactTypeGroupId"] = "Тип",
        ["standardTerminalArticleKey"] = "Стандартный контакт",
    };

    internal static void Validate(JsonElement content)
    {
        RequireExactProperties(content, "content", RootProperties);
        if (content.GetProperty("schemaVersion").ValueKind != JsonValueKind.Number ||
            !content.GetProperty("schemaVersion").TryGetInt32(out var version) || version != 4)
            Throw("Only component template schemaVersion 4 is supported.", "content.schemaVersion");

        ValidateV3Core(content);
        var authoritativeGroups = ReadAuthoritativeGroups(content.GetProperty("contactTypeGroups"));
        var authoritativeArticles = ReadAuthoritativeArticles(content, authoritativeGroups);
        ValidateTable(content.GetProperty("e4ConnectorTable"), authoritativeGroups, authoritativeArticles);
    }

    private static void ValidateV3Core(JsonElement content)
    {
        var projected = JsonNode.Parse(content.GetRawText())!.AsObject();
        projected["schemaVersion"] = 3;
        projected.Remove("e4ConnectorTable");
        using var document = JsonDocument.Parse(projected.ToJsonString());
        ComponentTemplateContentV3Validator.Validate(document.RootElement);
    }

    private static Dictionary<string, string> ReadAuthoritativeGroups(JsonElement groups) =>
        groups.EnumerateArray().ToDictionary(
            item => item.GetProperty("id").GetString()!,
            item => item.GetProperty("name").GetString()!,
            StringComparer.Ordinal);

    private static Dictionary<string, AuthoritativeArticle> ReadAuthoritativeArticles(
        JsonElement content, IReadOnlyDictionary<string, string> groupNames)
    {
        var result = new Dictionary<string, AuthoritativeArticle>(StringComparer.Ordinal);
        foreach (var variant in content.GetProperty("articleVariants").EnumerateArray())
        {
            var configurations = new Dictionary<string, AuthoritativeGroup>(StringComparer.Ordinal);
            var groups = variant.GetProperty("contactGroups");
            if (groups.ValueKind == JsonValueKind.Array)
            {
                foreach (var group in groups.EnumerateArray())
                {
                    configurations.Add(
                        group.GetProperty("contactTypeGroupId").GetString()!,
                        new AuthoritativeGroup(
                            group.GetProperty("contactCount").GetInt32(),
                            ReadArticleKeySet(group.GetProperty("allowedTerminalArticleKeys"))));
                }
            }
            else
            {
                foreach (var (groupId, count) in MaterializedLegacyCounts(content, variant, groupNames))
                    configurations.Add(groupId, new AuthoritativeGroup(count, []));
            }
            result.Add(variant.GetProperty("id").GetString()!, new AuthoritativeArticle(
                variant.GetProperty("sourceId").GetString()!,
                variant.GetProperty("entityType").GetString()!,
                variant.GetProperty("articleKey").GetString()!,
                configurations));
        }
        return result;
    }

    private static IReadOnlyDictionary<string, int> MaterializedLegacyCounts(
        JsonElement content, JsonElement variant, IReadOnlyDictionary<string, string> groupNames)
    {
        var projected = JsonNode.Parse(content.GetRawText())!.AsObject();
        projected["schemaVersion"] = 2;
        projected.Remove("e4ConnectorTable");
        projected.Remove("contactTypeGroups");
        projected.Remove("articleVariants");
        projected["articleParameterPresets"] = new JsonArray();
        var contacts = new JsonArray();
        var contactGroups = new Dictionary<string, string?>(StringComparer.Ordinal);
        foreach (var contact in content.GetProperty("logicalContacts").EnumerateArray())
        {
            var groupId = contact.GetProperty("contactTypeGroupId").GetString();
            contactGroups.Add(contact.GetProperty("id").GetString()!, groupId);
            contacts.Add(new JsonObject
            {
                ["id"] = contact.GetProperty("id").GetString(),
                ["number"] = contact.GetProperty("number").GetString(),
                ["name"] = contact.GetProperty("name").GetString(),
                ["contactType"] = groupId is null ? string.Empty : groupNames[groupId],
            });
        }
        projected["logicalContacts"] = contacts;
        var overrides = variant.GetProperty("parameterValues").EnumerateArray().ToDictionary(
            value => value.GetProperty("parameterId").GetString()!,
            value => value.GetProperty("value").Clone(), StringComparer.Ordinal);
        using var document = JsonDocument.Parse(projected.ToJsonString());
        var repeatCounts = ComponentTemplateContentV2Validator.ValidateMaterialized(document.RootElement, overrides);
        var counts = groupNames.Keys.ToDictionary(id => id, _ => 0, StringComparer.Ordinal);
        var repeated = new HashSet<string>(StringComparer.Ordinal);
        foreach (var domain in content.GetProperty("repeaters").EnumerateArray())
        {
            var repeatCount = repeatCounts[domain.GetProperty("id").GetString()!];
            foreach (var contactId in domain.GetProperty("logicalContactIds").EnumerateArray())
            {
                var id = contactId.GetString()!;
                repeated.Add(id);
                var groupId = contactGroups[id];
                if (groupId is not null) counts[groupId] = checked(counts[groupId] + (int)repeatCount);
            }
        }
        foreach (var (id, groupId) in contactGroups)
            if (groupId is not null && !repeated.Contains(id)) counts[groupId]++;
        return counts;
    }

    private static void ValidateTable(
        JsonElement table,
        IReadOnlyDictionary<string, string> authoritativeGroups,
        IReadOnlyDictionary<string, AuthoritativeArticle> authoritativeArticles)
    {
        const string path = "content.e4ConnectorTable";
        RequireExactProperties(table, path, "modelVersion", "columns", "contactTypeGroups", "seriesDefaults", "articles");
        if (table.GetProperty("modelVersion").ValueKind != JsonValueKind.Number ||
            !table.GetProperty("modelVersion").TryGetInt32(out var modelVersion) || modelVersion != 1)
            Throw("Only E4 connector table modelVersion 1 is supported.", path + ".modelVersion");

        ValidateColumns(RequiredArray(table, "columns", path + ".columns"));
        ValidateTableGroups(RequiredArray(table, "contactTypeGroups", path + ".contactTypeGroups"), authoritativeGroups);
        var defaults = ValidateSeriesDefaults(
            RequiredArray(table, "seriesDefaults", path + ".seriesDefaults"), authoritativeGroups.Keys.ToHashSet(StringComparer.Ordinal));
        ValidateArticles(
            RequiredArray(table, "articles", path + ".articles"), authoritativeGroups.Keys.ToHashSet(StringComparer.Ordinal),
            authoritativeArticles, defaults);
    }

    private static void ValidateColumns(JsonElement columns)
    {
        const string path = "content.e4ConnectorTable.columns";
        if (columns.GetArrayLength() != RequiredColumns.Count)
            Throw("The E4 table must contain every base column exactly once.", path);
        var found = new HashSet<string>(StringComparer.Ordinal);
        var index = 0;
        foreach (var column in columns.EnumerateArray())
        {
            var itemPath = $"{path}[{index++}]";
            RequireExactProperties(column, itemPath, "id", "label", "visible");
            var id = RequiredText(column.GetProperty("id"), 64, itemPath + ".id");
            _ = RequiredText(column.GetProperty("label"), 128, itemPath + ".label");
            if (!RequiredColumns.ContainsKey(id)) Throw("Unknown E4 base column.", itemPath + ".id");
            if (!found.Add(id)) Throw("An E4 base column cannot be repeated.", itemPath + ".id");
            if (column.GetProperty("visible").ValueKind is not (JsonValueKind.True or JsonValueKind.False))
                Throw("Column visibility must be a boolean.", itemPath + ".visible");
        }
    }

    private static void ValidateTableGroups(JsonElement groups, IReadOnlyDictionary<string, string> authoritative)
    {
        const string path = "content.e4ConnectorTable.contactTypeGroups";
        if (groups.GetArrayLength() != authoritative.Count)
            Throw("The E4 table contact types must match the template contact types.", path);
        var found = new HashSet<string>(StringComparer.Ordinal);
        var index = 0;
        foreach (var group in groups.EnumerateArray())
        {
            var itemPath = $"{path}[{index++}]";
            RequireExactProperties(group, itemPath, "id", "name");
            var id = RequiredText(group.GetProperty("id"), 128, itemPath + ".id");
            var name = RequiredText(group.GetProperty("name"), 128, itemPath + ".name");
            if (!authoritative.TryGetValue(id, out var expectedName)) Throw("E4 table contact type does not exist in the template.", itemPath + ".id");
            if (!found.Add(id)) Throw("An E4 table contact type cannot be repeated.", itemPath + ".id");
            if (!string.Equals(name, expectedName, StringComparison.Ordinal)) Throw("E4 table contact type name must match the template.", itemPath + ".name");
        }
    }

    private static Dictionary<string, RowValues> ValidateSeriesDefaults(JsonElement rows, IReadOnlySet<string> groupIds)
    {
        const string path = "content.e4ConnectorTable.seriesDefaults";
        if (rows.GetArrayLength() > MaximumSeriesRows) Throw($"An E4 table cannot contain more than {MaximumSeriesRows} series rows.", path);
        var result = new Dictionary<string, RowValues>(StringComparer.Ordinal);
        var index = 0;
        foreach (var row in rows.EnumerateArray())
        {
            var itemPath = $"{path}[{index++}]";
            RequireExactProperties(row, itemPath, "rowId", "values");
            var rowId = RequiredText(row.GetProperty("rowId"), 512, itemPath + ".rowId");
            var values = ValidateRowValues(row.GetProperty("values"), itemPath + ".values", groupIds, false);
            if (!result.TryAdd(rowId, values)) Throw("A series row cannot be repeated.", itemPath + ".rowId");
        }
        return result;
    }

    private static void ValidateArticles(
        JsonElement articles,
        IReadOnlySet<string> groupIds,
        IReadOnlyDictionary<string, AuthoritativeArticle> authoritative,
        IReadOnlyDictionary<string, RowValues> defaults)
    {
        const string path = "content.e4ConnectorTable.articles";
        if (articles.GetArrayLength() != authoritative.Count)
            Throw("The E4 table articles must match the template article variants.", path);
        var found = new HashSet<string>(StringComparer.Ordinal);
        var articleIndex = 0;
        foreach (var article in articles.EnumerateArray())
        {
            var articlePath = $"{path}[{articleIndex++}]";
            RequireExactProperties(article, articlePath,
                "articleVariantId", "sourceId", "entityType", "articleKey", "contactGroups", "rows");
            var variantId = RequiredText(article.GetProperty("articleVariantId"), 128, articlePath + ".articleVariantId");
            if (!authoritative.TryGetValue(variantId, out var source)) Throw("E4 table article does not exist in articleVariants.", articlePath + ".articleVariantId");
            if (!found.Add(variantId)) Throw("An E4 table article cannot be repeated.", articlePath + ".articleVariantId");
            RequireEqualText(article, "sourceId", source.SourceId, 128, articlePath);
            RequireEqualText(article, "entityType", source.EntityType, 64, articlePath);
            RequireEqualText(article, "articleKey", source.ArticleKey, 512, articlePath);

            var configured = ValidateArticleGroups(
                RequiredArray(article, "contactGroups", articlePath + ".contactGroups"), groupIds, source, articlePath + ".contactGroups");
            ValidateArticleRows(
                RequiredArray(article, "rows", articlePath + ".rows"), groupIds, defaults, configured, articlePath + ".rows");
        }
    }

    private static Dictionary<string, ArticleGroup> ValidateArticleGroups(
        JsonElement groups, IReadOnlySet<string> groupIds, AuthoritativeArticle source, string path)
    {
        if (groups.GetArrayLength() != groupIds.Count) Throw("Every contact type must have one article configuration.", path);
        var result = new Dictionary<string, ArticleGroup>(StringComparer.Ordinal);
        var index = 0;
        foreach (var group in groups.EnumerateArray())
        {
            var groupPath = $"{path}[{index++}]";
            RequireExactProperties(group, groupPath, "contactTypeGroupId", "contactCount", "allowedTerminalArticleKeys");
            var groupId = RequiredText(group.GetProperty("contactTypeGroupId"), 128, groupPath + ".contactTypeGroupId");
            if (!groupIds.Contains(groupId)) Throw("Referenced contact type group does not exist.", groupPath + ".contactTypeGroupId");
            var countValue = group.GetProperty("contactCount");
            var count = -1;
            if (countValue.ValueKind != JsonValueKind.Number || !countValue.TryGetInt32(out count) || count is < 0 or > MaximumSeriesRows)
                Throw("Contact count must be an integer between 0 and 2000.", groupPath + ".contactCount");
            var terminals = ValidateArticleKeys(
                RequiredArray(group, "allowedTerminalArticleKeys", groupPath + ".allowedTerminalArticleKeys"),
                groupPath + ".allowedTerminalArticleKeys");
            if (!result.TryAdd(groupId, new ArticleGroup(count, terminals)))
                Throw("A contact type group cannot be repeated in one E4 article.", groupPath + ".contactTypeGroupId");
            var expected = source.Groups.GetValueOrDefault(groupId) ?? new AuthoritativeGroup(0, []);
            if (count != expected.Count) Throw("E4 contact count must match articleVariants.", groupPath + ".contactCount");
            if (!terminals.SetEquals(expected.Terminals)) Throw("E4 allowed terminals must match articleVariants.", groupPath + ".allowedTerminalArticleKeys");
        }
        return result;
    }

    private static void ValidateArticleRows(
        JsonElement rows, IReadOnlySet<string> groupIds, IReadOnlyDictionary<string, RowValues> defaults,
        IReadOnlyDictionary<string, ArticleGroup> configurations, string path)
    {
        if (rows.GetArrayLength() > MaximumSeriesRows) Throw($"An article cannot contain more than {MaximumSeriesRows} E4 rows.", path);
        var references = new HashSet<string>(StringComparer.Ordinal);
        var numbers = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var actualCounts = groupIds.ToDictionary(id => id, _ => 0, StringComparer.Ordinal);
        var index = 0;
        foreach (var row in rows.EnumerateArray())
        {
            var rowPath = $"{path}[{index++}]";
            RequireExactProperties(row, rowPath, "seriesRowId", "overrides");
            var rowId = RequiredText(row.GetProperty("seriesRowId"), 512, rowPath + ".seriesRowId");
            if (!defaults.TryGetValue(rowId, out var baseValues)) Throw("Referenced series row does not exist.", rowPath + ".seriesRowId");
            if (!references.Add(rowId)) Throw("A series row cannot be repeated in one article.", rowPath + ".seriesRowId");
            var materialized = ApplyOverrides(baseValues, ValidateRowValues(row.GetProperty("overrides"), rowPath + ".overrides", groupIds, true));
            if (materialized.Number is null) Throw("Contact number is required.", rowPath + ".overrides.number");
            if (!numbers.Add(materialized.Number.Trim())) Throw("Contact numbers must be unique in one E4 article.", rowPath + ".overrides.number");
            if (materialized.GroupId is null)
            {
                if (materialized.Terminal is not null) Throw("A standard terminal requires a contact type.", rowPath + ".overrides.standardTerminalArticleKey");
                continue;
            }
            actualCounts[materialized.GroupId]++;
            if (materialized.Terminal is not null && !configurations[materialized.GroupId].Terminals.Contains(materialized.Terminal))
                Throw("The standard terminal is not allowed for this contact type.", rowPath + ".overrides.standardTerminalArticleKey");
        }
        foreach (var groupId in groupIds)
            if (actualCounts[groupId] != configurations[groupId].Count)
                Throw("Materialized E4 rows must match the declared contact count.", path);
    }

    private static RowValues ValidateRowValues(JsonElement value, string path, IReadOnlySet<string> groupIds, bool partial)
    {
        string[] all = ["number", "name", "circuitText", "contactTypeGroupId", "standardTerminalArticleKey"];
        if (value.ValueKind != JsonValueKind.Object) Throw("An object is required.", path);
        var actual = value.EnumerateObject().Select(property => property.Name).ToArray();
        if (actual.Distinct(StringComparer.Ordinal).Count() != actual.Length || actual.Any(name => !all.Contains(name, StringComparer.Ordinal)) ||
            !partial && actual.Length != all.Length)
            Throw("Object has missing, extra, or duplicate properties.", path);
        if (!partial && all.Any(name => !value.TryGetProperty(name, out _))) Throw("Object has missing, extra, or duplicate properties.", path);

        string? number = null, name = null, circuit = null, groupId = null, terminal = null;
        if (value.TryGetProperty("number", out var numberValue)) number = RequiredText(numberValue, 128, path + ".number");
        if (value.TryGetProperty("name", out var nameValue)) name = RequiredText(nameValue, 256, path + ".name");
        if (value.TryGetProperty("circuitText", out var circuitValue)) circuit = OptionalText(circuitValue, 4_096, path + ".circuitText");
        if (value.TryGetProperty("contactTypeGroupId", out var groupValue))
        {
            groupId = OptionalText(groupValue, 128, path + ".contactTypeGroupId");
            if (groupId is not null && !groupIds.Contains(groupId)) Throw("Referenced contact type group does not exist.", path + ".contactTypeGroupId");
        }
        if (value.TryGetProperty("standardTerminalArticleKey", out var terminalValue) && terminalValue.ValueKind != JsonValueKind.Null)
            terminal = ValidateArticleKey(terminalValue, path + ".standardTerminalArticleKey");
        return new RowValues(
            number, value.TryGetProperty("number", out _),
            name, value.TryGetProperty("name", out _),
            circuit, value.TryGetProperty("circuitText", out _),
            groupId, value.TryGetProperty("contactTypeGroupId", out _),
            terminal, value.TryGetProperty("standardTerminalArticleKey", out _));
    }

    private static RowValues ApplyOverrides(RowValues baseline, RowValues changes) => new(
        changes.HasNumber ? changes.Number : baseline.Number, true,
        changes.HasName ? changes.Name : baseline.Name, true,
        changes.HasCircuitText ? changes.CircuitText : baseline.CircuitText, true,
        changes.HasGroupId ? changes.GroupId : baseline.GroupId, true,
        changes.HasTerminal ? changes.Terminal : baseline.Terminal, true);

    private static HashSet<string> ValidateArticleKeys(JsonElement values, string path)
    {
        if (values.GetArrayLength() > ComponentTemplateContentV3Validator.MaximumTerminalArticlesPerGroup)
            Throw($"A group cannot contain more than {ComponentTemplateContentV3Validator.MaximumTerminalArticlesPerGroup} terminal articles.", path);
        var result = new HashSet<string>(StringComparer.Ordinal);
        var index = 0;
        foreach (var value in values.EnumerateArray())
        {
            var itemPath = $"{path}[{index++}]";
            var identity = ValidateArticleKey(value, itemPath);
            if (!result.Add(identity)) Throw("A terminal article cannot be repeated in one contact type group.", itemPath);
        }
        return result;
    }

    private static HashSet<string> ReadArticleKeySet(JsonElement values) => values.EnumerateArray()
        .Select(value => ArticleIdentity(value.GetProperty("sourceId").GetString()!, value.GetProperty("entityType").GetString()!, value.GetProperty("articleKey").GetString()!))
        .ToHashSet(StringComparer.Ordinal);

    private static string ValidateArticleKey(JsonElement value, string path)
    {
        RequireExactProperties(value, path, "sourceId", "entityType", "articleKey");
        return ArticleIdentity(
            RequiredText(value.GetProperty("sourceId"), 128, path + ".sourceId"),
            RequiredText(value.GetProperty("entityType"), 64, path + ".entityType"),
            RequiredText(value.GetProperty("articleKey"), 512, path + ".articleKey"));
    }

    private static string ArticleIdentity(string sourceId, string entityType, string articleKey) => sourceId + "\0" + entityType + "\0" + articleKey;

    private static void RequireEqualText(JsonElement owner, string property, string expected, int maximum, string path)
    {
        var actual = RequiredText(owner.GetProperty(property), maximum, path + "." + property);
        if (!string.Equals(actual, expected, StringComparison.Ordinal)) Throw("E4 article identity must match articleVariants.", path + "." + property);
    }

    private static JsonElement RequiredArray(JsonElement owner, string property, string path)
    {
        var value = owner.GetProperty(property);
        if (value.ValueKind != JsonValueKind.Array) Throw("An array is required.", path);
        return value;
    }

    private static string RequiredText(JsonElement value, int maximum, string path)
    {
        if (value.ValueKind != JsonValueKind.String) Throw("A string is required.", path);
        var text = value.GetString()!;
        if (string.IsNullOrWhiteSpace(text) || text.Length > maximum || text.Any(char.IsControl))
            Throw($"A non-empty string of at most {maximum} characters is required.", path);
        return text;
    }

    private static string? OptionalText(JsonElement value, int maximum, string path)
    {
        if (value.ValueKind == JsonValueKind.Null) return null;
        if (value.ValueKind != JsonValueKind.String || value.GetString()!.Length > maximum || value.GetString()!.Any(char.IsControl))
            Throw($"A null or string of at most {maximum} characters is required.", path);
        return value.GetString();
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

    private sealed record AuthoritativeArticle(string SourceId, string EntityType, string ArticleKey, IReadOnlyDictionary<string, AuthoritativeGroup> Groups);
    private sealed record AuthoritativeGroup(int Count, HashSet<string> Terminals);
    private sealed record ArticleGroup(int Count, HashSet<string> Terminals);
    private sealed record RowValues(
        string? Number, bool HasNumber,
        string? Name, bool HasName,
        string? CircuitText, bool HasCircuitText,
        string? GroupId, bool HasGroupId,
        string? Terminal, bool HasTerminal);
}
