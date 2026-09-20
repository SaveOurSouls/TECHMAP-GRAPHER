using System.Text.Json;
using System.Text.Json.Nodes;
using Techmap.Application;
using Techmap.Infrastructure.Sqlite;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class ComponentTemplateContentV5ValidatorTests
{
    internal static string ValidContentJson => ValidContent().ToJsonString();

    [Fact]
    public void Contact_presets_accept_wire_colors_and_custom_values_but_reject_invalid_types()
    {
        var content = ValidContent();
        var values = content["e4ConnectorTable"]!["seriesDefaults"]![0]!["values"]!;
        values["wire"] = "ПВ-3";
        values["color"] = "Красный";
        values["secondaryColor"] = "Белый";
        values["customValues"] = new JsonObject { ["note"] = "Преднастройка" };
        ComponentTemplateContentV5Validator.Validate(Element(content));
        values["color"] = 123;
        Assert.Throws<ComponentTemplateException>(() => ComponentTemplateContentV5Validator.Validate(Element(content)));
    }

    [Fact]
    public void Drawing_selection_and_contact_identity_survive_validation_and_reject_dangling_references()
    {
        var content = ValidContent();
        var drawing = content["views"]!.AsArray().First(view => view!["kind"]!.GetValue<string>() == "drawing")!;
        var nodes = drawing["layers"]![0]!["nodes"]!.AsArray();
        var point = drawing["contactPoints"]![0]!;
        content["articleDrawings"] = new JsonArray(new JsonObject
        {
            ["articleVariantId"] = content["articleVariants"]![0]!["id"]!.DeepClone(),
            ["nodeIds"] = new JsonArray(nodes.Select(node => node!["id"]!.DeepClone()).ToArray()),
            ["contactPointIds"] = new JsonArray(point["id"]!.DeepClone()),
        });
        content["drawingContactBindings"] = new JsonArray(new JsonObject
        {
            ["logicalContactId"] = point["logicalContactId"]!.DeepClone(),
            ["seriesRowId"] = content["e4ConnectorTable"]!["seriesDefaults"]![0]!["rowId"]!.DeepClone(),
        });
        ComponentTemplateContentV5Validator.Validate(Element(content));
        content["drawingContactBindings"]![0]!["seriesRowId"] = "missing";
        Assert.Throws<ComponentTemplateException>(() => ComponentTemplateContentV5Validator.Validate(Element(content)));
        content["drawingContactBindings"]![0]!["seriesRowId"] = content["e4ConnectorTable"]!["seriesDefaults"]![0]!["rowId"]!.DeepClone();
        content["articleDrawings"]![0]!["nodeIds"]!.AsArray().Add("missing");
        Assert.Throws<ComponentTemplateException>(() => ComponentTemplateContentV5Validator.Validate(Element(content)));
    }

    [Fact]
    public void E4_presentation_is_optional_and_validated_before_projection()
    {
        var content = ValidContent();
        content["e4Presentation"] = JsonNode.Parse("""
            {"orientation":"contacts-left","baseColumns":[{"key":"wire","visible":false}],
             "customFields":[{"id":"note","label":"Примечание","visible":true}]}
            """);
        ComponentTemplateContentV5Validator.Validate(Element(content));
        content["e4Presentation"]!["orientation"] = "wrong";
        Assert.Throws<ComponentTemplateException>(() => ComponentTemplateContentV5Validator.Validate(Element(content)));
        content["e4Presentation"]!["orientation"] = "contacts-left";
        content["e4Presentation"]!["baseColumns"]!.AsArray().Add(content["e4Presentation"]!["baseColumns"]![0]!.DeepClone());
        Assert.Throws<ComponentTemplateException>(() => ComponentTemplateContentV5Validator.Validate(Element(content)));
    }

    [Fact]
    public void Valid_v5_uses_one_root_terminal_index_and_table_model_2()
    {
        ComponentTemplateContentV5Validator.Validate(Element(ValidContent()));
    }

    [Fact]
    public void E4_rows_do_not_require_graphical_contact_prototypes_but_counts_must_match()
    {
        var content = ValidContent();
        content["logicalContacts"] = new JsonArray();
        content["repeaters"] = new JsonArray();
        foreach (var view in content["views"]!.AsArray()) view!["contactPoints"] = new JsonArray();
        ComponentTemplateContentV5Validator.Validate(Element(content));

        content["articleVariants"]![0]!["contactGroups"]![0]!["contactCount"] = 2;
        Assert.Throws<ComponentTemplateException>(() => ComponentTemplateContentV5Validator.Validate(Element(content)));
    }

    [Fact]
    public void Legacy_terminal_lists_are_rejected_in_article_and_table_groups()
    {
        var article = ValidContent();
        article["articleVariants"]![0]!["contactGroups"]![0]!["allowedTerminalArticleKeys"] = new JsonArray();
        var error = Assert.Throws<ComponentTemplateException>(() => ComponentTemplateContentV5Validator.Validate(Element(article)));
        Assert.Equal("content.articleVariants[0].contactGroups[0]", error.Field);

        var table = ValidContent();
        table["e4ConnectorTable"]!["articles"]![0]!["contactGroups"]![0]!["allowedTerminalArticleKeys"] = new JsonArray();
        error = Assert.Throws<ComponentTemplateException>(() => ComponentTemplateContentV5Validator.Validate(Element(table)));
        Assert.Equal("content.e4ConnectorTable.articles[0].contactGroups[0]", error.Field);
    }

    [Fact]
    public void Standard_terminal_must_exist_in_the_root_compatibility_index()
    {
        var content = ValidContent();
        content["e4ConnectorTable"]!["articles"]![0]!["rows"]![0]!["overrides"] = new JsonObject
        {
            ["standardTerminalArticleKey"] = new JsonObject
            {
                ["sourceId"] = "technology-database", ["entityType"] = "terminal", ["articleKey"] = "NOT-INDEXED",
            },
        };

        var error = Assert.Throws<ComponentTemplateException>(() => ComponentTemplateContentV5Validator.Validate(Element(content)));
        Assert.Equal("content.e4ConnectorTable.articles[0].rows[0].overrides.standardTerminalArticleKey", error.Field);
    }

    [Fact]
    public void Duplicate_root_terminal_articles_are_rejected()
    {
        var content = ValidContent();
        var terminals = content["compatibleTerminalArticleKeys"]!.AsArray();
        terminals.Add(terminals[0]!.DeepClone());

        var error = Assert.Throws<ComponentTemplateException>(() => ComponentTemplateContentV5Validator.Validate(Element(content)));
        Assert.Equal("content.compatibleTerminalArticleKeys[1]", error.Field);
    }

    [Fact]
    public void Multiple_terminals_can_bind_to_one_contact_type_but_only_one_is_standard()
    {
        var content = ValidContent();
        var first = content["compatibleTerminalArticleKeys"]![0]!.DeepClone();
        var second = first.DeepClone();
        second!["articleKey"] = "SXH-002T-P0.6";
        content["compatibleTerminalArticleKeys"]!.AsArray().Add(second.DeepClone());
        var groupId = content["contactTypeGroups"]![0]!["id"]!.GetValue<string>();
        content["terminalContactTypeBindings"] = new JsonArray(
            new JsonObject { ["terminalArticleKey"] = first, ["contactTypeGroupId"] = groupId, ["standard"] = true },
            new JsonObject { ["terminalArticleKey"] = second, ["contactTypeGroupId"] = groupId, ["standard"] = false });

        ComponentTemplateContentV5Validator.Validate(Element(content));

        content["terminalContactTypeBindings"]![1]!["standard"] = true;
        var error = Assert.Throws<ComponentTemplateException>(() => ComponentTemplateContentV5Validator.Validate(Element(content)));
        Assert.Equal("content.terminalContactTypeBindings[1]", error.Field);
    }

    [Fact]
    public void Terminal_binding_must_reference_the_series_index_and_existing_contact_type()
    {
        var content = ValidContent();
        content["terminalContactTypeBindings"] = new JsonArray(new JsonObject
        {
            ["terminalArticleKey"] = new JsonObject { ["sourceId"] = "technology-database", ["entityType"] = "terminal", ["articleKey"] = "OTHER" },
            ["contactTypeGroupId"] = "missing",
            ["standard"] = false,
        });

        var error = Assert.Throws<ComponentTemplateException>(() => ComponentTemplateContentV5Validator.Validate(Element(content)));
        Assert.Equal("content.terminalContactTypeBindings[0].terminalArticleKey", error.Field);
    }

    internal static JsonObject ValidContent()
    {
        var content = ComponentTemplateContentV4ValidatorTests.ValidContent();
        content["schemaVersion"] = 5;
        var terminals = content["articleVariants"]![0]!["contactGroups"]![0]!["allowedTerminalArticleKeys"]!.DeepClone();
        content["compatibleTerminalArticleKeys"] = terminals;
        foreach (var variant in content["articleVariants"]!.AsArray())
            if (variant!["contactGroups"] is JsonArray groups)
                foreach (var group in groups) group!.AsObject().Remove("allowedTerminalArticleKeys");
        var table = content["e4ConnectorTable"]!.AsObject();
        table["modelVersion"] = 2;
        foreach (var article in table["articles"]!.AsArray())
            foreach (var group in article!["contactGroups"]!.AsArray())
                group!.AsObject().Remove("allowedTerminalArticleKeys");
        return content;
    }

    private static JsonElement Element(JsonNode value)
    {
        using var document = JsonDocument.Parse(value.ToJsonString());
        return document.RootElement.Clone();
    }
}
