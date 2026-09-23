using System.Text.Json;
using System.Text.Json.Nodes;
using Techmap.Application;
using Techmap.Infrastructure.Sqlite;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class ComponentTemplateContentV5ValidatorTests
{
    internal static string ValidContentJson => ValidContent().ToJsonString();

    [Theory]
    [InlineData("e4")]
    [InlineData("drawing")]
    [InlineData("route")]
    public void Generator_contract_round_trips_and_rejects_ambiguous_ownership_and_partial_rows(string target)
    {
        var content=ValidContent();
        var view=content["views"]!.AsArray().First(v=>v!["kind"]!.GetValue<string>()=="drawing")!;
        view["repeatPlacements"]=new JsonArray();
        var nodes=view["layers"]![0]!["nodes"]!.AsArray();
        nodes.Add(JsonNode.Parse("""
        {"id":"90000000-0000-4000-8000-000000000001","layerId":"00000000-0000-4000-8000-000000000004","kind":"rectangle","visible":true,"locked":false,"opacity":1,
         "transform":{"translateX":{"kind":"constant","value":0},"translateY":{"kind":"constant","value":0},"rotationDegrees":{"kind":"constant","value":0},"scaleX":{"kind":"constant","value":1},"scaleY":{"kind":"constant","value":1}},
         "stroke":{"color":"#000000","width":{"kind":"constant","value":1}},"fill":{"color":null},
         "geometry":{"x":{"kind":"constant","value":0},"y":{"kind":"constant","value":0},"width":{"kind":"constant","value":10},"height":{"kind":"constant","value":10},"cornerRadii":[{"kind":"constant","value":0},{"kind":"constant","value":0},{"kind":"constant","value":0},{"kind":"constant","value":0}]}}
        """));
        var owned=nodes.Where(n=>n!["kind"]!.GetValue<string>()=="group").SelectMany(n=>n!["geometry"]!["childIds"]!.AsArray()).Select(n=>n!.GetValue<string>()).ToHashSet();
        var roots=nodes.Where(n=>!owned.Contains(n!["id"]!.GetValue<string>())).Select(n=>n!["id"]!.DeepClone()).ToArray();
        var g=new JsonObject {
            ["id"]=Guid.NewGuid().ToString(),["viewId"]=view["id"]!.DeepClone(),["target"]=target,
            ["axis"]="horizontal",["pitch"]=40,["rowPitch"]=30,["rows"]=1,["baseColumns"]=1,
            ["traversal"]="along",["numbering"]="snake",["reverse"]=false,["corner"]="top-left",["endPointIds"]=new JsonArray(),
            ["roles"]=new JsonObject{["start"]=new JsonArray(),["period"]=new JsonArray(roots),["end"]=new JsonArray(),["static"]=new JsonArray()},
            ["periodPointIds"]=new JsonArray(view["contactPoints"]![0]!["id"]!.DeepClone()),["fixedPointIds"]=new JsonArray(),
            ["articles"]=new JsonArray(new JsonObject{["articleId"]=content["articleVariants"]![0]!["id"]!.DeepClone(),["nodeIds"]=new JsonArray()})
        };
        content["drawingGenerators"]=new JsonArray(g);
        var shapePoint=view["contactPoints"]![0]!;
        shapePoint["shape"]=new JsonObject { ["nodeId"]="90000000-0000-4000-8000-000000000001", ["fillFromWire"]=true };
        ComponentTemplateContentV5Validator.Validate(Element(content));
        shapePoint["shape"]!["nodeId"]=Guid.NewGuid().ToString();
        Assert.Throws<ComponentTemplateException>(()=>ComponentTemplateContentV5Validator.Validate(Element(content)));
        shapePoint["shape"]!["nodeId"]="90000000-0000-4000-8000-000000000001";
        shapePoint["shape"]!["fillFromWire"]="yes";
        Assert.Throws<ComponentTemplateException>(()=>ComponentTemplateContentV5Validator.Validate(Element(content)));
        shapePoint["shape"]!["fillFromWire"]=true;
        ComponentTemplateContentV5Validator.Validate(Element(content));
        ComponentTemplateContentV5Validator.Validate(Element(JsonNode.Parse(content.ToJsonString())!));
        g["rows"]=2;
        Assert.Throws<ComponentTemplateException>(()=>ComponentTemplateContentV5Validator.Validate(Element(content)));
        g["rows"]=1;g["articles"]![0]!["nodeIds"]!.AsArray().Add(roots[0]!.DeepClone());
        Assert.Throws<ComponentTemplateException>(()=>ComponentTemplateContentV5Validator.Validate(Element(content)));
        g["articles"]![0]!["nodeIds"]=new JsonArray();g["pitch"]=0;
        Assert.Throws<ComponentTemplateException>(()=>ComponentTemplateContentV5Validator.Validate(Element(content)));
        g["pitch"]=40;g["roles"]!["end"]!.AsArray().Add("missing");
        Assert.Throws<ComponentTemplateException>(()=>ComponentTemplateContentV5Validator.Validate(Element(content)));
    }

    [Fact]
    public void Empty_drawings_and_replacement_illustrations_preserve_the_electrical_table()
    {
        var content = ValidContent();
        var table = content["e4ConnectorTable"]!.ToJsonString();
        var view = content["views"]!.AsArray().First(v => v!["kind"]!.GetValue<string>() == "drawing")!;
        view["repeatPlacements"] = new JsonArray();
        view["contactPoints"] = new JsonArray();
        foreach (var target in new[] { "e4", "drawing", "route" })
        {
            var drawing = new JsonObject {
                ["articleVariantId"] = content["articleVariants"]![0]!["id"]!.DeepClone(),
                ["target"] = target, ["viewId"] = view["id"]!.DeepClone(),
                ["nodeIds"] = new JsonArray(), ["contactPointIds"] = new JsonArray(), ["bundlePortIds"] = new JsonArray()
            };
            content["drawingGenerators"] = new JsonArray();
            content["articleDrawings"] = new JsonArray(drawing);
            ComponentTemplateContentV5Validator.Validate(Element(JsonNode.Parse(content.ToJsonString())!));
            drawing["nodeIds"] = new JsonArray(view["layers"]![0]!["nodes"]!.AsArray().Select(n => n!["id"]!.DeepClone()).ToArray());
            ComponentTemplateContentV5Validator.Validate(Element(JsonNode.Parse(content.ToJsonString())!));
            Assert.Equal(table, content["e4ConnectorTable"]!.ToJsonString());
        }
    }

    [Fact]
    public void Drawing_rejects_missing_contacts_and_allows_one_common_point_only_for_drawing()
    {
        var content=ValidContent();
        var view=content["views"]!.AsArray().First(v=>v!["kind"]!.GetValue<string>()=="drawing")!;
        var portId=Guid.NewGuid().ToString();
        view["bundlePorts"]=new JsonArray(new JsonObject { ["id"]=portId,["name"]="Bundle",["direction"]="right",["x"]=new JsonObject{["kind"]="constant",["value"]=10},["y"]=new JsonObject{["kind"]="constant",["value"]=20} });
        var drawing=new JsonObject {
            ["articleVariantId"]=content["articleVariants"]![0]!["id"]!.DeepClone(),["target"]="drawing",["viewId"]=view["id"]!.DeepClone(),
            ["nodeIds"]=new JsonArray(view["layers"]![0]!["nodes"]!.AsArray().Select(n=>n!["id"]!.DeepClone()).ToArray()),
            ["contactPointIds"]=new JsonArray(),["bundlePortIds"]=new JsonArray(portId)
        };
        content["articleDrawings"]=new JsonArray(drawing);
        ComponentTemplateContentV5Validator.Validate(Element(content));
        drawing["target"]="e4";
        Assert.Throws<ComponentTemplateException>(()=>ComponentTemplateContentV5Validator.Validate(Element(content)));
        drawing["target"]="drawing";drawing["bundlePortIds"]=new JsonArray();drawing["contactPointIds"]=new JsonArray(view["contactPoints"]![0]!["id"]!.DeepClone());
        content["articleVariants"]![0]!["contactGroups"]![0]!["contactCount"]=2;
        content["e4ConnectorTable"]!["articles"]![0]!["contactGroups"]![0]!["contactCount"]=2;
        var row=content["e4ConnectorTable"]!["seriesDefaults"]![0]!.DeepClone();row["rowId"]="second";row["values"]!["number"]="2";
        content["e4ConnectorTable"]!["seriesDefaults"]!.AsArray().Add(row);
        content["e4ConnectorTable"]!["articles"]![0]!["rows"]!.AsArray().Add(new JsonObject{["seriesRowId"]="second",["overrides"]=new JsonObject()});
        Assert.Throws<ComponentTemplateException>(()=>ComponentTemplateContentV5Validator.Validate(Element(content)));
    }

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
    public void Drawing_targets_allow_one_set_per_section_and_reject_unknown_sections()
    {
        var content=ValidContent();
        var view=content["views"]!.AsArray().First(v=>v!["kind"]!.GetValue<string>()=="drawing")!;
        var sets=new JsonArray();
        foreach(var target in new[]{"e4","drawing","route"}) sets.Add(new JsonObject {
            ["articleVariantId"]=content["articleVariants"]![0]!["id"]!.DeepClone(),
            ["target"]=target,["viewId"]=view["id"]!.DeepClone(),
            ["nodeIds"]=new JsonArray(),["contactPointIds"]=new JsonArray()
        });
        content["articleDrawings"]=sets;
        ComponentTemplateContentV5Validator.Validate(Element(content));
        sets[2]!["target"]="unknown";
        Assert.Throws<ComponentTemplateException>(()=>ComponentTemplateContentV5Validator.Validate(Element(content)));
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
