using System.Text.Json;
using System.Text.Json.Nodes;
using Techmap.Application;
using Techmap.Infrastructure.Sqlite;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class ComponentTemplateContentV4ValidatorTests
{
    internal static string ValidContentJson => ValidContent().ToJsonString();

    [Fact]
    public void Valid_v4_table_matches_authoritative_groups_and_article()
    {
        var content = ValidContent();
        ComponentTemplateContentV4Validator.Validate(Element(content));
    }

    [Fact]
    public void Root_and_table_are_strictly_exact()
    {
        var root = ValidContent();
        root["e4ConnectorTable"]!["unexpected"] = true;
        var error = Assert.Throws<ComponentTemplateException>(() => ComponentTemplateContentV4Validator.Validate(Element(root)));
        Assert.Equal("content.e4ConnectorTable", error.Field);
    }

    [Fact]
    public void Table_article_identity_and_contact_count_must_match_authoritative_variant()
    {
        var content = ValidContent();
        content["e4ConnectorTable"]!["articles"]![0]!["articleKey"] = "OTHER";
        var error = Assert.Throws<ComponentTemplateException>(() => ComponentTemplateContentV4Validator.Validate(Element(content)));
        Assert.Equal("content.e4ConnectorTable.articles[0].articleKey", error.Field);

        content = ValidContent();
        content["e4ConnectorTable"]!["articles"]![0]!["contactGroups"]![0]!["contactCount"] = 2;
        error = Assert.Throws<ComponentTemplateException>(() => ComponentTemplateContentV4Validator.Validate(Element(content)));
        Assert.Equal("content.e4ConnectorTable.articles[0].contactGroups[0].contactCount", error.Field);
    }

    [Fact]
    public void Table_contact_types_must_match_authoritative_groups_exactly()
    {
        var content = ValidContent();
        content["e4ConnectorTable"]!["contactTypeGroups"]![0]!["name"] = "Переименованный";

        var error = Assert.Throws<ComponentTemplateException>(() =>
            ComponentTemplateContentV4Validator.Validate(Element(content)));

        Assert.Equal("content.e4ConnectorTable.contactTypeGroups[0].name", error.Field);
    }

    [Fact]
    public void Standard_terminal_must_be_allowed_for_the_materialized_contact_type()
    {
        var content = ValidContent();
        content["e4ConnectorTable"]!["articles"]![0]!["rows"]![0]!["overrides"] = new JsonObject
        {
            ["standardTerminalArticleKey"] = new JsonObject
            {
                ["sourceId"] = "technology-database",
                ["entityType"] = "terminal",
                ["articleKey"] = "NOT-ALLOWED",
            },
        };

        var error = Assert.Throws<ComponentTemplateException>(() =>
            ComponentTemplateContentV4Validator.Validate(Element(content)));

        Assert.Equal(
            "content.e4ConnectorTable.articles[0].rows[0].overrides.standardTerminalArticleKey",
            error.Field);
    }

    [Fact]
    public void Explicit_null_override_clears_a_series_terminal()
    {
        var content = ValidContent();
        content["e4ConnectorTable"]!["seriesDefaults"]![0]!["values"]!["standardTerminalArticleKey"] = new JsonObject
        {
            ["sourceId"] = "technology-database", ["entityType"] = "terminal", ["articleKey"] = "INCOMPATIBLE-DEFAULT",
        };
        content["e4ConnectorTable"]!["articles"]![0]!["rows"]![0]!["overrides"] = new JsonObject
        {
            ["standardTerminalArticleKey"] = null,
        };

        ComponentTemplateContentV4Validator.Validate(Element(content));
    }

    [Fact]
    public void Null_legacy_contact_groups_use_materialized_core_counts_and_no_terminals()
    {
        var content = ValidContent();
        content["articleVariants"]![0]!["contactGroups"] = null;
        content["e4ConnectorTable"]!["articles"]![0]!["contactGroups"]![0]!["allowedTerminalArticleKeys"] = new JsonArray();

        ComponentTemplateContentV4Validator.Validate(Element(content));

        content["e4ConnectorTable"]!["articles"]![0]!["contactGroups"]![0]!["contactCount"] = 0;
        var error = Assert.Throws<ComponentTemplateException>(() =>
            ComponentTemplateContentV4Validator.Validate(Element(content)));
        Assert.Equal("content.e4ConnectorTable.articles[0].contactGroups[0].contactCount", error.Field);
    }

    [Fact]
    public void Duplicate_properties_are_rejected_even_for_partial_overrides()
    {
        var json = ValidContent().ToJsonString().Replace("\"overrides\":{}", "\"overrides\":{\"number\":\"1\",\"number\":\"2\"}", StringComparison.Ordinal);
        using var document = JsonDocument.Parse(json);

        var error = Assert.Throws<ComponentTemplateException>(() =>
            ComponentTemplateContentV4Validator.Validate(document.RootElement));

        Assert.Equal("content.e4ConnectorTable.articles[0].rows[0].overrides", error.Field);
    }

    internal static JsonObject ValidContent()
    {
        var content = JsonNode.Parse(ComponentTemplateContentV3ValidatorTests.ValidContentJson)!.AsObject();
        content["schemaVersion"] = 4;
        content["e4ConnectorTable"] = new JsonObject
        {
            ["modelVersion"] = 1,
            ["columns"] = new JsonArray(
                new JsonObject { ["id"] = "number", ["label"] = "№", ["visible"] = true },
                new JsonObject { ["id"] = "name", ["label"] = "Назначение", ["visible"] = true },
                new JsonObject { ["id"] = "circuitText", ["label"] = "Цепь", ["visible"] = true },
                new JsonObject { ["id"] = "contactTypeGroupId", ["label"] = "Тип", ["visible"] = true },
                new JsonObject { ["id"] = "standardTerminalArticleKey", ["label"] = "Стандартный контакт", ["visible"] = true }),
            ["contactTypeGroups"] = new JsonArray(new JsonObject { ["id"] = "10000000-0000-4000-8000-000000000002", ["name"] = "Сигнальный" }),
            ["seriesDefaults"] = new JsonArray(new JsonObject
            {
                ["rowId"] = "contact-group:10000000-0000-4000-8000-000000000002:1",
                ["values"] = new JsonObject { ["number"] = "1", ["name"] = "Контакт 1", ["circuitText"] = "DATA+", ["contactTypeGroupId"] = "10000000-0000-4000-8000-000000000002", ["standardTerminalArticleKey"] = null },
            }),
            ["articles"] = new JsonArray(new JsonObject
            {
                ["articleVariantId"] = "10000000-0000-4000-8000-000000000004",
                ["sourceId"] = "technology-database", ["entityType"] = "connector", ["articleKey"] = "B2B-XH-A",
                ["contactGroups"] = new JsonArray(new JsonObject { ["contactTypeGroupId"] = "10000000-0000-4000-8000-000000000002", ["contactCount"] = 1, ["allowedTerminalArticleKeys"] = new JsonArray(new JsonObject { ["sourceId"] = "technology-database", ["entityType"] = "terminal", ["articleKey"] = "SXH-001T-P0.6" }) }),
                ["rows"] = new JsonArray(new JsonObject { ["seriesRowId"] = "contact-group:10000000-0000-4000-8000-000000000002:1", ["overrides"] = new JsonObject() }),
            }),
        };
        return content;
    }

    private static JsonElement Element(JsonNode value)
    {
        using var document = JsonDocument.Parse(value.ToJsonString());
        return document.RootElement.Clone();
    }
}
