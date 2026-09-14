using System.Text.Json;
using System.Text.Json.Nodes;
using Techmap.Application;
using Techmap.Infrastructure.Sqlite;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class ComponentTemplateContentV3ValidatorTests
{
    [Fact]
    public void Valid_v3_links_one_logical_contact_across_views_and_configures_an_article_group()
    {
        var content = ValidContent();

        ComponentTemplateContentV3Validator.Validate(Element(content));

        Assert.Equal(
            ContactId,
            content["views"]![0]!["contactPoints"]![0]!["logicalContactId"]!.GetValue<string>());
        Assert.Equal(
            ContactId,
            content["views"]![1]!["contactPoints"]![0]!["logicalContactId"]!.GetValue<string>());
    }

    [Fact]
    public void V3_is_strict_and_does_not_change_the_v2_contract()
    {
        var extra = ValidContent();
        extra["surprise"] = true;
        var extraError = Assert.Throws<ComponentTemplateException>(() =>
            ComponentTemplateContentV3Validator.Validate(Element(extra)));
        Assert.Equal("content", extraError.Field);

        using var v2 = JsonDocument.Parse(ComponentTemplateV2StoreTests.V2Content);
        ComponentTemplateContentV2Validator.Validate(v2.RootElement);
    }

    [Fact]
    public void V3_rejects_missing_groups_duplicate_terminal_articles_and_unproducible_counts()
    {
        var missingGroup = ValidContent();
        missingGroup["logicalContacts"]![0]!["contactTypeGroupId"] = OtherGroupId;
        var missingError = Assert.Throws<ComponentTemplateException>(() =>
            ComponentTemplateContentV3Validator.Validate(Element(missingGroup)));
        Assert.Equal("content.logicalContacts[0].contactTypeGroupId", missingError.Field);

        var duplicateTerminal = ValidContent();
        var terminals = duplicateTerminal["articleVariants"]![0]!["contactGroups"]![0]!["allowedTerminalArticleKeys"]!.AsArray();
        terminals.Add(terminals[0]!.DeepClone());
        var terminalError = Assert.Throws<ComponentTemplateException>(() =>
            ComponentTemplateContentV3Validator.Validate(Element(duplicateTerminal)));
        Assert.Equal(
            "content.articleVariants[0].contactGroups[0].allowedTerminalArticleKeys[1]",
            terminalError.Field);

        var wrongCount = ValidContent();
        wrongCount["articleVariants"]![0]!["contactGroups"]![0]!["contactCount"] = 2;
        var countError = Assert.Throws<ComponentTemplateException>(() =>
            ComponentTemplateContentV3Validator.Validate(Element(wrongCount)));
        Assert.Equal("content.articleVariants[0].contactGroups", countError.Field);
    }

    [Fact]
    public void Null_contact_groups_preserve_a_legacy_parameter_preset()
    {
        var content = ValidContent();
        content["articleVariants"]![0]!["contactGroups"] = null;
        content["articleVariants"]![0]!["parameterValues"] = new JsonArray();

        ComponentTemplateContentV3Validator.Validate(Element(content));
    }

    [Fact]
    public void New_group_and_variant_ids_share_the_global_template_id_namespace()
    {
        var content = ValidContent();
        content["contactTypeGroups"]![0]!["id"] = ContactId;
        content["logicalContacts"]![0]!["contactTypeGroupId"] = ContactId;
        content["articleVariants"]![0]!["contactGroups"]![0]!["contactTypeGroupId"] = ContactId;

        var error = Assert.Throws<ComponentTemplateException>(() =>
            ComponentTemplateContentV3Validator.Validate(Element(content)));

        Assert.Equal("content.contactTypeGroups[0].id", error.Field);
    }

    [Fact]
    public void V3_reports_invalid_repeat_shape_and_duplicate_ids_as_contract_errors()
    {
        var invalidRepeaters = ValidContent();
        invalidRepeaters["repeaters"] = new JsonObject();
        var repeaterError = Assert.Throws<ComponentTemplateException>(() =>
            ComponentTemplateContentV3Validator.Validate(Element(invalidRepeaters)));
        Assert.Equal("content.repeaters", repeaterError.Field);

        var duplicateContacts = ValidContent();
        duplicateContacts["logicalContacts"]!.AsArray().Add(
            duplicateContacts["logicalContacts"]![0]!.DeepClone());
        duplicateContacts["logicalContacts"]![1]!["number"] = "2";
        var contactError = Assert.Throws<ComponentTemplateException>(() =>
            ComponentTemplateContentV3Validator.Validate(Element(duplicateContacts)));
        Assert.Equal("content.logicalContacts[1].id", contactError.Field);
    }

    [Fact]
    public void Explicit_article_cannot_request_zero_occurrences_from_a_repeat_domain()
    {
        var content = ValidContent();
        var parameterId = "10000000-0000-4000-8000-000000000007";
        content["parameters"]!.AsArray().Add(new JsonObject
        {
            ["id"] = parameterId,
            ["name"] = "Контакты",
            ["type"] = "integer",
            ["unit"] = "шт",
            ["defaultValue"] = 1,
            ["minimum"] = 1,
            ["maximum"] = 1_000,
            ["formula"] = null,
        });
        content["repeaters"]!.AsArray().Add(new JsonObject
        {
            ["id"] = "10000000-0000-4000-8000-000000000008",
            ["countParameterId"] = parameterId,
            ["logicalContactIds"] = new JsonArray(ContactId),
        });
        content["articleVariants"]![0]!["contactGroups"]![0]!["contactCount"] = 0;

        var error = Assert.Throws<ComponentTemplateException>(() =>
            ComponentTemplateContentV3Validator.Validate(Element(content)));

        Assert.Equal("content.articleVariants[0].contactGroups", error.Field);
    }

    [Fact]
    public void Repeat_domains_require_one_explicit_contact_type_group()
    {
        var missing = ValidContent();
        AddCountParameter(missing, "10000000-0000-4000-8000-000000000007");
        missing["logicalContacts"]![0]!["contactTypeGroupId"] = null;
        missing["repeaters"]!.AsArray().Add(new JsonObject
        {
            ["id"] = "10000000-0000-4000-8000-000000000008",
            ["countParameterId"] = "10000000-0000-4000-8000-000000000007",
            ["logicalContactIds"] = new JsonArray(ContactId),
        });
        var missingError = Assert.Throws<ComponentTemplateException>(() =>
            ComponentTemplateContentV3Validator.Validate(Element(missing)));
        Assert.Equal("content.repeaters[0].logicalContactIds[0]", missingError.Field);

        var mixed = ValidContent();
        AddCountParameter(mixed, "10000000-0000-4000-8000-000000000007");
        mixed["contactTypeGroups"]!.AsArray().Add(new JsonObject { ["id"] = OtherGroupId, ["name"] = "Силовой" });
        mixed["logicalContacts"]!.AsArray().Add(new JsonObject
        {
            ["id"] = "10000000-0000-4000-8000-000000000008", ["number"] = "2", ["name"] = "Контакт 2",
            ["circuitText"] = null, ["contactTypeGroupId"] = OtherGroupId,
        });
        mixed["repeaters"]!.AsArray().Add(new JsonObject
        {
            ["id"] = "10000000-0000-4000-8000-000000000009",
            ["countParameterId"] = "10000000-0000-4000-8000-000000000007",
            ["logicalContactIds"] = new JsonArray(ContactId, "10000000-0000-4000-8000-000000000008"),
        });
        var mixedError = Assert.Throws<ComponentTemplateException>(() =>
            ComponentTemplateContentV3Validator.Validate(Element(mixed)));
        Assert.Equal("content.repeaters[0].logicalContactIds", mixedError.Field);
    }

    [Fact]
    public void Article_materialization_validates_overrides_and_the_aggregate_contact_budget()
    {
        var invalidOverride = ValidContent();
        AddCountParameter(invalidOverride, "10000000-0000-4000-8000-000000000007", maximum: 10);
        invalidOverride["articleVariants"]![0]!["parameterValues"] = new JsonArray(new JsonObject
        {
            ["parameterId"] = "10000000-0000-4000-8000-000000000007", ["value"] = 11,
        });
        var overrideError = Assert.Throws<ComponentTemplateException>(() =>
            ComponentTemplateContentV3Validator.Validate(Element(invalidOverride)));
        Assert.Equal("content.articleVariants[0].parameterValues", overrideError.Field);

        var budget = ValidContent();
        const string secondContactId = "10000000-0000-4000-8000-000000000007";
        const string fixedContactId = "10000000-0000-4000-8000-000000000008";
        const string signalCountId = "10000000-0000-4000-8000-000000000009";
        const string powerCountId = "10000000-0000-4000-8000-00000000000a";
        budget["contactTypeGroups"]!.AsArray().Add(new JsonObject { ["id"] = OtherGroupId, ["name"] = "Силовой" });
        budget["logicalContacts"]!.AsArray().Add(new JsonObject
        {
            ["id"] = secondContactId, ["number"] = "2", ["name"] = "Контакт 2", ["circuitText"] = null,
            ["contactTypeGroupId"] = OtherGroupId,
        });
        budget["logicalContacts"]!.AsArray().Add(new JsonObject
        {
            ["id"] = fixedContactId, ["number"] = "3", ["name"] = "Служебный", ["circuitText"] = null,
            ["contactTypeGroupId"] = null,
        });
        AddCountParameter(budget, signalCountId);
        AddCountParameter(budget, powerCountId);
        budget["repeaters"] = new JsonArray(
            new JsonObject { ["id"] = "10000000-0000-4000-8000-00000000000b", ["countParameterId"] = signalCountId, ["logicalContactIds"] = new JsonArray(ContactId) },
            new JsonObject { ["id"] = "10000000-0000-4000-8000-00000000000c", ["countParameterId"] = powerCountId, ["logicalContactIds"] = new JsonArray(secondContactId) });
        budget["articleVariants"]![0]!["contactGroups"] = new JsonArray(
            new JsonObject { ["contactTypeGroupId"] = SignalGroupId, ["contactCount"] = 1_000, ["allowedTerminalArticleKeys"] = new JsonArray() },
            new JsonObject { ["contactTypeGroupId"] = OtherGroupId, ["contactCount"] = 1_000, ["allowedTerminalArticleKeys"] = new JsonArray() });
        var budgetError = Assert.Throws<ComponentTemplateException>(() =>
            ComponentTemplateContentV3Validator.Validate(Element(budget)));
        Assert.Equal("content.articleVariants[0].contactGroups", budgetError.Field);
    }

    internal static JsonObject ValidContent()
    {
        var content = JsonNode.Parse(ComponentTemplateV2StoreTests.V2Content)!.AsObject();
        content["schemaVersion"] = 3;
        content.Remove("articleParameterPresets");
        content["contactTypeGroups"] = new JsonArray(new JsonObject
        {
            ["id"] = SignalGroupId,
            ["name"] = "Сигнальный",
        });
        content["logicalContacts"] = new JsonArray(new JsonObject
        {
            ["id"] = ContactId,
            ["number"] = "1",
            ["name"] = "Контакт 1",
            ["circuitText"] = "DATA+",
            ["contactTypeGroupId"] = SignalGroupId,
        });
        foreach (var view in content["views"]!.AsArray())
        {
            view!["contactPoints"] = new JsonArray(new JsonObject
            {
                ["id"] = view!["kind"]!.GetValue<string>() == "e4" ? E4PointId : DrawingPointId,
                ["logicalContactId"] = ContactId,
                ["x"] = Constant(10),
                ["y"] = Constant(20),
                ["direction"] = "right",
            });
        }
        content["articleVariants"] = new JsonArray(new JsonObject
        {
            ["id"] = VariantId,
            ["sourceId"] = "technology-database",
            ["entityType"] = "connector",
            ["articleKey"] = "B2B-XH-A",
            ["parameterValues"] = new JsonArray(),
            ["contactGroups"] = new JsonArray(new JsonObject
            {
                ["contactTypeGroupId"] = SignalGroupId,
                ["contactCount"] = 1,
                ["allowedTerminalArticleKeys"] = new JsonArray(new JsonObject
                {
                    ["sourceId"] = "technology-database",
                    ["entityType"] = "terminal",
                    ["articleKey"] = "SXH-001T-P0.6",
                }),
            }),
        });
        return content;
    }

    internal static string ValidContentJson => ValidContent().ToJsonString();

    internal static IReadOnlyList<ComponentTemplateArticleBinding> ValidArticleBindings =>
        [new("technology-database", "connector", "B2B-XH-A")];

    private static JsonObject Constant(double value) => new()
    {
        ["kind"] = "constant",
        ["value"] = value,
    };

    private static void AddCountParameter(JsonObject content, string id, int maximum = 1_000) =>
        content["parameters"]!.AsArray().Add(new JsonObject
        {
            ["id"] = id, ["name"] = "Количество", ["type"] = "integer", ["unit"] = "шт",
            ["defaultValue"] = 1, ["minimum"] = 1, ["maximum"] = maximum, ["formula"] = null,
        });

    private static JsonElement Element(JsonNode value)
    {
        using var document = JsonDocument.Parse(value.ToJsonString());
        return document.RootElement.Clone();
    }

    private const string ContactId = "10000000-0000-4000-8000-000000000001";
    private const string SignalGroupId = "10000000-0000-4000-8000-000000000002";
    private const string OtherGroupId = "10000000-0000-4000-8000-000000000003";
    private const string VariantId = "10000000-0000-4000-8000-000000000004";
    private const string E4PointId = "10000000-0000-4000-8000-000000000005";
    private const string DrawingPointId = "10000000-0000-4000-8000-000000000006";
}
