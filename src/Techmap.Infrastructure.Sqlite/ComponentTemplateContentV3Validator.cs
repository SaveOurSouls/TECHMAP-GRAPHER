using System.Diagnostics.CodeAnalysis;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Techmap.Application;

namespace Techmap.Infrastructure.Sqlite;

/// <summary>
/// Validates the M2-08 component-template contract. Geometry, parameters, assets and
/// repeat placement deliberately retain their v2 representation; the v2 validator is
/// therefore used as the common structural and materialization gate after the v3-only
/// contact metadata has been projected to its lossless v2 equivalent.
/// </summary>
internal static partial class ComponentTemplateContentV3Validator
{
    internal const int MaximumContactTypeGroups = 128;
    internal const int MaximumArticleVariants = 500;
    internal const int MaximumTerminalArticlesPerGroup = 256;

    private static readonly string[] RootProperties =
        ["schemaVersion", "views", "logicalContacts", "parameters", "repeaters", "assets", "contactTypeGroups", "articleVariants"];

    internal static void Validate(JsonElement content)
    {
        RequireExactProperties(content, "content", RootProperties);
        if (content.GetProperty("schemaVersion").ValueKind != JsonValueKind.Number ||
            !content.GetProperty("schemaVersion").TryGetInt32(out var schemaVersion) || schemaVersion != 3)
        {
            Throw("Only component template schemaVersion 3 is supported.", "content.schemaVersion");
        }

        var groups = RequiredArray(content, "contactTypeGroups", "content.contactTypeGroups");
        var contacts = RequiredArray(content, "logicalContacts", "content.logicalContacts");
        var variants = RequiredArray(content, "articleVariants", "content.articleVariants");
        var repeaters = RequiredArray(content, "repeaters", "content.repeaters");
        if (groups.GetArrayLength() > MaximumContactTypeGroups)
            Throw($"A template cannot contain more than {MaximumContactTypeGroups} contact type groups.", "content.contactTypeGroups");
        if (variants.GetArrayLength() > MaximumArticleVariants)
            Throw($"A template cannot contain more than {MaximumArticleVariants} article variants.", "content.articleVariants");

        var groupNames = ValidateContactTypeGroups(groups);
        var groupIds = groupNames.Keys.ToHashSet(StringComparer.Ordinal);
        var contactGroups = ValidateLogicalContacts(contacts, groupIds);
        ValidateV2CompatibleCore(content, groupNames);
        var materializations = ValidateArticleVariants(repeaters, variants, groupIds, contactGroups);
        ValidateArticleMaterializations(content, groupNames, repeaters, contactGroups, materializations);
        ValidateNewIdsAgainstCore(content);
    }

    private static Dictionary<string, string> ValidateContactTypeGroups(JsonElement groups)
    {
        var result = new Dictionary<string, string>(StringComparer.Ordinal);
        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var index = 0;
        foreach (var group in groups.EnumerateArray())
        {
            var path = $"content.contactTypeGroups[{index++}]";
            RequireExactProperties(group, path, "id", "name");
            var id = RequiredId(group.GetProperty("id"), path + ".id");
            var name = RequiredShortText(group.GetProperty("name"), 128, path + ".name");
            if (!names.Add(name.Trim())) Throw("Contact type group names must be unique.", path + ".name");
            if (!result.TryAdd(id, name)) Throw("Template IDs must be globally unique.", path + ".id");
        }
        return result;
    }

    private static Dictionary<string, string?> ValidateLogicalContacts(
        JsonElement contacts,
        IReadOnlySet<string> validGroupIds)
    {
        var result = new Dictionary<string, string?>(StringComparer.Ordinal);
        var numbers = new HashSet<string>(StringComparer.Ordinal);
        var index = 0;
        foreach (var contact in contacts.EnumerateArray())
        {
            var path = $"content.logicalContacts[{index++}]";
            RequireExactProperties(contact, path, "id", "number", "name", "circuitText", "contactTypeGroupId");
            var id = RequiredId(contact.GetProperty("id"), path + ".id");
            var number = RequiredShortText(contact.GetProperty("number"), 128, path + ".number");
            if (!numbers.Add(number)) Throw("Logical contact numbers must be unique.", path + ".number");
            _ = RequiredShortText(contact.GetProperty("name"), 256, path + ".name");
            ValidateOptionalText(contact.GetProperty("circuitText"), 4_096, path + ".circuitText");
            var groupId = OptionalId(contact.GetProperty("contactTypeGroupId"), path + ".contactTypeGroupId");
            if (groupId is not null && !validGroupIds.Contains(groupId))
                Throw("Referenced contact type group does not exist.", path + ".contactTypeGroupId");
            if (!result.TryAdd(id, groupId)) Throw("Template IDs must be globally unique.", path + ".id");
        }
        return result;
    }

    private static IReadOnlyList<ArticleMaterialization> ValidateArticleVariants(
        JsonElement repeaters,
        JsonElement variants,
        IReadOnlySet<string> validGroupIds,
        IReadOnlyDictionary<string, string?> contactGroups)
    {
        var repeatCountParameterIds = new HashSet<string>(StringComparer.Ordinal);
        var domainsByGroup = new Dictionary<string, List<int>>(StringComparer.Ordinal);
        var repeatDomainByGroup = new Dictionary<string, string>(StringComparer.Ordinal);
        var repeatedContactIds = new HashSet<string>(StringComparer.Ordinal);
        var domainIndex = 0;
        foreach (var domain in repeaters.EnumerateArray())
        {
            var domainPath = $"content.repeaters[{domainIndex++}]";
            var countId = domain.GetProperty("countParameterId");
            var ids = domain.GetProperty("logicalContactIds");
            repeatCountParameterIds.Add(countId.GetString()!);
            string? domainGroup = null;
            var stride = 0;
            var contactIndex = 0;
            foreach (var idValue in ids.EnumerateArray())
            {
                var contactId = idValue.GetString()!;
                repeatedContactIds.Add(contactId);
                var groupId = contactGroups[contactId];
                if (groupId is null)
                    Throw("Every repeated contact must belong to a contact type group.", $"{domainPath}.logicalContactIds[{contactIndex}]");
                if (domainGroup is null) domainGroup = groupId;
                else if (!string.Equals(domainGroup, groupId, StringComparison.Ordinal))
                    Throw("A repeat domain cannot contain contacts from different contact type groups.", domainPath + ".logicalContactIds");
                stride++;
                contactIndex++;
            }
            if (domainGroup is null || stride == 0)
                Throw("A repeat domain must contain at least one contact with a contact type group.", domainPath + ".logicalContactIds");
            if (!domainsByGroup.TryGetValue(domainGroup, out var groupDomains))
                domainsByGroup.Add(domainGroup, groupDomains = []);
            groupDomains.Add(stride);
            repeatDomainByGroup.TryAdd(domainGroup, countId.GetString()!);
        }

        var fixedCounts = validGroupIds.ToDictionary(id => id, _ => 0, StringComparer.Ordinal);
        foreach (var (contactId, groupId) in contactGroups)
        {
            if (groupId is not null && !repeatedContactIds.Contains(contactId)) fixedCounts[groupId]++;
        }

        var identities = new HashSet<string>(StringComparer.Ordinal);
        var materializations = new List<ArticleMaterialization>();
        var variantIndex = 0;
        foreach (var variant in variants.EnumerateArray())
        {
            var path = $"content.articleVariants[{variantIndex++}]";
            RequireExactProperties(variant, path,
                "id", "sourceId", "entityType", "articleKey", "parameterValues", "contactGroups");
            _ = RequiredId(variant.GetProperty("id"), path + ".id");
            var sourceId = RequiredShortText(variant.GetProperty("sourceId"), 128, path + ".sourceId");
            var entityType = RequiredShortText(variant.GetProperty("entityType"), 64, path + ".entityType");
            var articleKey = RequiredShortText(variant.GetProperty("articleKey"), 512, path + ".articleKey");
            if (!identities.Add(sourceId + "\0" + entityType + "\0" + articleKey))
                Throw("An article variant identity cannot be repeated.", path + ".articleKey");

            var parameterValues = RequiredArray(variant, "parameterValues", path + ".parameterValues");
            var overrides = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
            foreach (var parameterValue in parameterValues.EnumerateArray())
            {
                // The baseline v2 projection above already validated the exact
                // entry shape, references and uniqueness. Keep the construction
                // deterministic so malformed input never leaks ArgumentException.
                overrides.TryAdd(
                    parameterValue.GetProperty("parameterId").GetString()!,
                    parameterValue.GetProperty("value").Clone());
            }
            var contactConfiguration = variant.GetProperty("contactGroups");
            if (contactConfiguration.ValueKind == JsonValueKind.Null)
            {
                materializations.Add(new ArticleMaterialization(path, overrides));
                continue;
            }
            if (contactConfiguration.ValueKind != JsonValueKind.Array)
                Throw("Article contactGroups must be null or an array.", path + ".contactGroups");

            foreach (var parameterValue in parameterValues.EnumerateArray())
            {
                if (parameterValue.ValueKind == JsonValueKind.Object &&
                    parameterValue.TryGetProperty("parameterId", out var parameterId) &&
                    parameterId.ValueKind == JsonValueKind.String &&
                    repeatCountParameterIds.Contains(parameterId.GetString()!))
                {
                    Throw(
                        "An explicit article contact-group configuration cannot also override a repeat count parameter.",
                        path + ".parameterValues");
                }
            }

            var configuredCounts = new Dictionary<string, int>(StringComparer.Ordinal);
            var groupIndex = 0;
            foreach (var group in contactConfiguration.EnumerateArray())
            {
                var groupPath = $"{path}.contactGroups[{groupIndex++}]";
                RequireExactProperties(group, groupPath,
                    "contactTypeGroupId", "contactCount", "allowedTerminalArticleKeys");
                var groupId = RequiredId(group.GetProperty("contactTypeGroupId"), groupPath + ".contactTypeGroupId");
                if (!validGroupIds.Contains(groupId))
                    Throw("Referenced contact type group does not exist.", groupPath + ".contactTypeGroupId");
                var countValue = group.GetProperty("contactCount");
                var count = 0;
                if (countValue.ValueKind != JsonValueKind.Number || !countValue.TryGetInt32(out count) ||
                    count is < 0 or > ComponentTemplateContentV2Validator.MaximumLogicalContacts)
                {
                    Throw("Contact count must be an integer between 0 and 2000.", groupPath + ".contactCount");
                }
                if (!configuredCounts.TryAdd(groupId, count))
                    Throw("A contact type group cannot be repeated in one article variant.", groupPath + ".contactTypeGroupId");
                ValidateTerminalArticles(
                    RequiredArray(group, "allowedTerminalArticleKeys", groupPath + ".allowedTerminalArticleKeys"),
                    groupPath + ".allowedTerminalArticleKeys");
            }

            foreach (var groupId in validGroupIds)
            {
                var targetCount = configuredCounts.GetValueOrDefault(groupId);
                var fixedCount = fixedCounts.GetValueOrDefault(groupId);
                var groupDomains = domainsByGroup.GetValueOrDefault(groupId);
                if (groupDomains is null || groupDomains.Count == 0)
                {
                    if (targetCount != fixedCount)
                        Throw("Article contact count cannot be produced by the template.", path + ".contactGroups");
                    continue;
                }
                if (groupDomains.Count != 1)
                    Throw("An explicit article variant requires at most one repeat domain per contact type group.", path + ".contactGroups");
                var repeatedCount = targetCount - fixedCount;
                if (repeatedCount <= 0 || repeatedCount % groupDomains[0] != 0 || repeatedCount / groupDomains[0] > 1_000)
                    Throw("Article contact count cannot be produced by the contact group's repeat domain.", path + ".contactGroups");
                overrides[repeatDomainByGroup[groupId]] =
                    JsonSerializer.SerializeToElement(repeatedCount / groupDomains[0]);
            }
            materializations.Add(new ArticleMaterialization(path, overrides));
        }
        return materializations;
    }

    private static void ValidateArticleMaterializations(
        JsonElement content,
        IReadOnlyDictionary<string, string> groupNames,
        JsonElement repeaters,
        IReadOnlyDictionary<string, string?> contactGroups,
        IReadOnlyList<ArticleMaterialization> materializations)
    {
        var repeatedContactIds = repeaters.EnumerateArray()
            .SelectMany(domain => domain.GetProperty("logicalContactIds").EnumerateArray())
            .Select(value => value.GetString()!)
            .ToHashSet(StringComparer.Ordinal);
        var fixedRows = contactGroups.Keys.Count(id => !repeatedContactIds.Contains(id));
        foreach (var materialization in materializations)
        {
            var repeatCounts = ValidateV2CompatibleCore(content, groupNames, materialization.Overrides, materialization.Path);
            long materializedRows = fixedRows;
            foreach (var domain in repeaters.EnumerateArray())
            {
                var domainId = domain.GetProperty("id").GetString()!;
                materializedRows += checked(
                    repeatCounts[domainId] * domain.GetProperty("logicalContactIds").GetArrayLength());
                if (materializedRows > ComponentTemplateContentV2Validator.MaximumLogicalContacts)
                {
                    Throw(
                        $"An article cannot materialize more than {ComponentTemplateContentV2Validator.MaximumLogicalContacts} contact rows.",
                        materialization.Path + ".contactGroups");
                }
            }
        }
    }

    private static void ValidateTerminalArticles(JsonElement terminals, string path)
    {
        if (terminals.GetArrayLength() > MaximumTerminalArticlesPerGroup)
            Throw($"A group cannot contain more than {MaximumTerminalArticlesPerGroup} terminal articles.", path);
        var identities = new HashSet<string>(StringComparer.Ordinal);
        var index = 0;
        foreach (var terminal in terminals.EnumerateArray())
        {
            var itemPath = $"{path}[{index++}]";
            RequireExactProperties(terminal, itemPath, "sourceId", "entityType", "articleKey");
            var sourceId = RequiredShortText(terminal.GetProperty("sourceId"), 128, itemPath + ".sourceId");
            var entityType = RequiredShortText(terminal.GetProperty("entityType"), 64, itemPath + ".entityType");
            var articleKey = RequiredShortText(terminal.GetProperty("articleKey"), 512, itemPath + ".articleKey");
            if (!identities.Add(sourceId + "\0" + entityType + "\0" + articleKey))
                Throw("A terminal article cannot be repeated in one contact type group.", itemPath);
        }
    }

    private static IReadOnlyDictionary<string, long> ValidateV2CompatibleCore(
        JsonElement content,
        IReadOnlyDictionary<string, string> groupNames,
        IReadOnlyDictionary<string, JsonElement>? parameterOverrides = null,
        string? materializationPath = null)
    {
        var root = JsonNode.Parse(content.GetRawText())!.AsObject();
        root["schemaVersion"] = 2;
        root.Remove("contactTypeGroups");

        var projectedContacts = new JsonArray();
        foreach (var contact in content.GetProperty("logicalContacts").EnumerateArray())
        {
            var groupIdValue = contact.GetProperty("contactTypeGroupId");
            var contactType = groupIdValue.ValueKind == JsonValueKind.String &&
                groupNames.TryGetValue(groupIdValue.GetString()!, out var name) ? name : string.Empty;
            projectedContacts.Add(new JsonObject
            {
                ["id"] = contact.GetProperty("id").GetString(),
                ["number"] = contact.GetProperty("number").GetString(),
                ["name"] = contact.GetProperty("name").GetString(),
                ["contactType"] = contactType,
            });
        }
        root["logicalContacts"] = projectedContacts;

        var presets = new JsonArray();
        foreach (var variant in content.GetProperty("articleVariants").EnumerateArray())
        {
            presets.Add(new JsonObject
            {
                ["id"] = variant.GetProperty("id").GetString(),
                ["sourceId"] = variant.GetProperty("sourceId").GetString(),
                ["entityType"] = variant.GetProperty("entityType").GetString(),
                ["articleKey"] = variant.GetProperty("articleKey").GetString(),
                ["values"] = JsonNode.Parse(variant.GetProperty("parameterValues").GetRawText()),
            });
        }
        root.Remove("articleVariants");
        root["articleParameterPresets"] = presets;

        using var projected = JsonDocument.Parse(root.ToJsonString());
        try
        {
            return ComponentTemplateContentV2Validator.ValidateMaterialized(projected.RootElement, parameterOverrides);
        }
        catch (ComponentTemplateException error)
        {
            var projectedField = error.Field?
                .Replace("content.articleParameterPresets", "content.articleVariants", StringComparison.Ordinal)
                .Replace(".values", ".parameterValues", StringComparison.Ordinal);
            var field = materializationPath is null
                ? projectedField
                : projectedField?.StartsWith("content.articleVariants", StringComparison.Ordinal) == true
                    ? projectedField
                    : materializationPath + ".parameterValues";
            throw new ComponentTemplateException(error.Code, error.Message, field, error.CurrentVersion, error);
        }
    }

    private static void ValidateNewIdsAgainstCore(JsonElement content)
    {
        var ids = new HashSet<string>(StringComparer.Ordinal);
        void Register(string id, string path)
        {
            if (!ids.Add(id)) Throw("Template IDs must be globally unique.", path);
        }
        void RegisterArrayIds(JsonElement array, string path, string property)
        {
            var index = 0;
            foreach (var value in array.EnumerateArray())
            {
                var propertyPath = $"{path}[{index++}].{property}";
                if (value.ValueKind != JsonValueKind.Object || !value.TryGetProperty(property, out var idValue)) continue;
                var id = RequiredId(idValue, propertyPath);
                Register(id, propertyPath);
            }
        }
        RegisterArrayIds(content.GetProperty("parameters"), "content.parameters", "id");
        RegisterArrayIds(content.GetProperty("logicalContacts"), "content.logicalContacts", "id");
        RegisterArrayIds(content.GetProperty("repeaters"), "content.repeaters", "id");
        RegisterArrayIds(content.GetProperty("assets"), "content.assets", "assetId");
        var viewIndex = 0;
        foreach (var view in content.GetProperty("views").EnumerateArray())
        {
            var viewPath = $"content.views[{viewIndex++}]";
            if (view.ValueKind != JsonValueKind.Object) continue;
            if (view.TryGetProperty("id", out var viewId)) Register(RequiredId(viewId, viewPath + ".id"), viewPath + ".id");
            if (view.TryGetProperty("contactPoints", out var points) && points.ValueKind == JsonValueKind.Array)
                RegisterArrayIds(points, viewPath + ".contactPoints", "id");
            if (view.TryGetProperty("bundlePorts", out var ports) && ports.ValueKind == JsonValueKind.Array)
                RegisterArrayIds(ports, viewPath + ".bundlePorts", "id");
            if (!view.TryGetProperty("layers", out var layers) || layers.ValueKind != JsonValueKind.Array) continue;
            var layerIndex = 0;
            foreach (var layer in layers.EnumerateArray())
            {
                var layerPath = $"{viewPath}.layers[{layerIndex++}]";
                if (layer.ValueKind != JsonValueKind.Object) continue;
                if (layer.TryGetProperty("id", out var layerId)) Register(RequiredId(layerId, layerPath + ".id"), layerPath + ".id");
                if (layer.TryGetProperty("nodes", out var nodes) && nodes.ValueKind == JsonValueKind.Array)
                    RegisterArrayIds(nodes, layerPath + ".nodes", "id");
            }
        }
        RegisterArrayIds(content.GetProperty("contactTypeGroups"), "content.contactTypeGroups", "id");
        RegisterArrayIds(content.GetProperty("articleVariants"), "content.articleVariants", "id");
    }

    private sealed record ArticleMaterialization(
        string Path,
        IReadOnlyDictionary<string, JsonElement> Overrides);

    private static JsonElement RequiredArray(JsonElement owner, string property, string path)
    {
        var value = owner.GetProperty(property);
        if (value.ValueKind != JsonValueKind.Array) Throw("An array is required.", path);
        return value;
    }

    private static string RequiredId(JsonElement value, string path)
    {
        if (value.ValueKind != JsonValueKind.String || !UuidRegex().IsMatch(value.GetString()!))
            Throw("A canonical UUID is required.", path);
        return value.GetString()!;
    }

    private static string? OptionalId(JsonElement value, string path)
    {
        if (value.ValueKind == JsonValueKind.Null) return null;
        return RequiredId(value, path);
    }

    private static string RequiredShortText(JsonElement value, int maximum, string path)
    {
        if (value.ValueKind != JsonValueKind.String) Throw("A string is required.", path);
        var text = value.GetString()!;
        if (text.Length > maximum || string.IsNullOrWhiteSpace(text) || text.Any(char.IsControl))
            Throw($"A non-empty string of at most {maximum} characters is required.", path);
        return text;
    }

    private static void ValidateOptionalText(JsonElement value, int maximum, string path)
    {
        if (value.ValueKind == JsonValueKind.Null) return;
            if (value.ValueKind != JsonValueKind.String || value.GetString()!.Length > maximum ||
            value.GetString()!.Any(char.IsControl))
        {
            Throw($"A null or string of at most {maximum} characters is required.", path);
        }
    }

    private static void RequireExactProperties(JsonElement value, string path, params string[] expected)
    {
        if (value.ValueKind != JsonValueKind.Object) Throw("An object is required.", path);
        var actual = value.EnumerateObject().Select(property => property.Name).ToArray();
        if (actual.Length != expected.Length || actual.Distinct(StringComparer.Ordinal).Count() != actual.Length ||
            !actual.Order(StringComparer.Ordinal).SequenceEqual(expected.Order(StringComparer.Ordinal)))
        {
            Throw("Object has missing, extra, or duplicate properties.", path);
        }
    }

    [DoesNotReturn]
    private static void Throw(string message, string path) =>
        throw new ComponentTemplateException("component_template_content_invalid", message, path);

    [GeneratedRegex("^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex UuidRegex();
}
