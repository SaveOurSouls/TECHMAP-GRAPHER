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
    public void Valid_v5_uses_one_root_terminal_index_and_table_model_2()
    {
        ComponentTemplateContentV5Validator.Validate(Element(ValidContent()));
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
