using System.Text.Json;
using System.Text.Json.Nodes;
using Techmap.Application;
using Techmap.Infrastructure.Sqlite;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class ComponentTemplateContentV2ValidatorTests
{
    [Fact]
    public void Complete_contract_with_distinct_view_repeat_placements_is_valid()
    {
        var content = ValidContent();

        ComponentTemplateContentV2Validator.Validate(Element(content));
    }

    [Fact]
    public void Exact_keys_and_png_asset_policy_are_enforced()
    {
        var content = ValidContent();
        content["surprise"] = true;
        var exact = Assert.Throws<ComponentTemplateException>(() =>
            ComponentTemplateContentV2Validator.Validate(Element(content)));
        Assert.Equal("content", exact.Field);

        content = ValidContent();
        content["assets"]![0]!["mediaType"] = "image/jpeg";
        var media = Assert.Throws<ComponentTemplateException>(() =>
            ComponentTemplateContentV2Validator.Validate(Element(content)));
        Assert.Equal("content.assets[0].mediaType", media.Field);

        content = ValidContent();
        content["assets"]![0]!["sizeBytes"] = ComponentTemplateContentV2Validator.MaximumAssetBytes + 1;
        var size = Assert.Throws<ComponentTemplateException>(() =>
            ComponentTemplateContentV2Validator.Validate(Element(content)));
        Assert.Equal("content.assets[0].sizeBytes", size.Field);
    }

    [Fact]
    public void Repeat_placement_must_use_a_group_and_points_from_its_own_view_and_domain()
    {
        var content = ValidContent();
        content["views"]![0]!["repeatPlacements"]![0]!["prototypeGroupId"] = Ids.DrawingGroup;
        var crossView = Assert.Throws<ComponentTemplateException>(() =>
            ComponentTemplateContentV2Validator.Validate(Element(content)));
        Assert.Equal("content.views[0].repeatPlacements[0].prototypeGroupId", crossView.Field);

        content = ValidContent();
        content["repeaters"]![0]!["logicalContactIds"] = new JsonArray();
        var mismatch = Assert.Throws<ComponentTemplateException>(() =>
            ComponentTemplateContentV2Validator.Validate(Element(content)));
        Assert.Equal("content.views[0].repeatPlacements[0].contactPointIds[0]", mismatch.Field);
    }

    [Fact]
    public void Nested_repeat_groups_and_group_cycles_are_rejected()
    {
        var content = ValidContent();
        var e4Nodes = content["views"]![0]!["layers"]![0]!["nodes"]!.AsArray();
        e4Nodes.Add(GroupNode(Ids.SecondGroup, Ids.E4Layer, Ids.Group));
        content["repeaters"]!.AsArray().Add(new JsonObject
        {
            ["id"] = Ids.SecondRepeater,
            ["countParameterId"] = Ids.Count,
            ["logicalContactIds"] = new JsonArray(Ids.Contact),
        });
        content["views"]![0]!["repeatPlacements"]!.AsArray().Add(new JsonObject
        {
            ["repeatDomainId"] = Ids.SecondRepeater,
            ["prototypeGroupId"] = Ids.SecondGroup,
            ["step"] = Point(Constant(0), Constant(5)),
            ["contactPointIds"] = new JsonArray(Ids.E4Point),
        });
        var nested = Assert.Throws<ComponentTemplateException>(() =>
            ComponentTemplateContentV2Validator.Validate(Element(content)));
        Assert.Contains("group:", nested.Field, StringComparison.Ordinal);

        content = ValidContent();
        ((JsonArray)content["views"]![0]!["layers"]![0]!["nodes"]![1]!["geometry"]!["childIds"]!).Add(Ids.Group);
        var cycle = Assert.Throws<ComponentTemplateException>(() =>
            ComponentTemplateContentV2Validator.Validate(Element(content)));
        Assert.Equal($"group:{Ids.Group}", cycle.Field);
    }

    [Fact]
    public void Formula_cycles_unknown_references_and_expression_limits_are_rejected()
    {
        var content = ValidContent();
        content["parameters"]![0]!["formula"] = Parameter(Ids.Size);
        var cycle = Assert.Throws<ComponentTemplateException>(() =>
            ComponentTemplateContentV2Validator.Validate(Element(content)));
        Assert.Equal("content.parameters", cycle.Field);

        content = ValidContent();
        content["parameters"]![1]!["formula"] = Parameter(Ids.Asset);
        var missing = Assert.Throws<ComponentTemplateException>(() =>
            ComponentTemplateContentV2Validator.Validate(Element(content)));
        Assert.Equal("content.parameters[1].formula.parameterId", missing.Field);

        content = ValidContent();
        JsonNode expression = Constant(1);
        for (var index = 0; index < ComponentTemplateContentV2Validator.MaximumExpressionDepth; index++)
            expression = new JsonObject { ["kind"] = "negate", ["operand"] = expression };
        content["parameters"]![1]!["formula"] = expression;
        var limit = Assert.Throws<ComponentTemplateException>(() =>
            ComponentTemplateContentV2Validator.Validate(Element(content)));
        Assert.Contains("formula", limit.Field, StringComparison.Ordinal);
    }

    [Fact]
    public void Presets_keep_parameter_types_and_all_ids_are_globally_unique()
    {
        var content = ValidContent();
        content["articleParameterPresets"]![0]!["values"]![0]!["value"] = 2.5;
        var type = Assert.Throws<ComponentTemplateException>(() =>
            ComponentTemplateContentV2Validator.Validate(Element(content)));
        Assert.Equal("content.articleParameterPresets[0].values[0].value", type.Field);

        content = ValidContent();
        content["assets"]![0]!["assetId"] = Ids.Contact;
        var duplicate = Assert.Throws<ComponentTemplateException>(() =>
            ComponentTemplateContentV2Validator.Validate(Element(content)));
        Assert.Equal("content.logicalContacts[0].id", duplicate.Field);
    }

    [Theory]
    [InlineData("line", "{\"points\":[{\"x\":{\"kind\":\"constant\",\"value\":0},\"y\":{\"kind\":\"constant\",\"value\":0}},{\"x\":{\"kind\":\"constant\",\"value\":2},\"y\":{\"kind\":\"constant\",\"value\":2}}],\"bendRadius\":{\"kind\":\"constant\",\"value\":0}}")]
    [InlineData("polyline", "{\"points\":[{\"x\":{\"kind\":\"constant\",\"value\":0},\"y\":{\"kind\":\"constant\",\"value\":0}},{\"x\":{\"kind\":\"constant\",\"value\":2},\"y\":{\"kind\":\"constant\",\"value\":2}}],\"bendRadius\":{\"kind\":\"constant\",\"value\":0}}")]
    [InlineData("bezier", "{\"points\":[{\"x\":{\"kind\":\"constant\",\"value\":0},\"y\":{\"kind\":\"constant\",\"value\":0}},{\"x\":{\"kind\":\"constant\",\"value\":1},\"y\":{\"kind\":\"constant\",\"value\":1}},{\"x\":{\"kind\":\"constant\",\"value\":2},\"y\":{\"kind\":\"constant\",\"value\":2}},{\"x\":{\"kind\":\"constant\",\"value\":3},\"y\":{\"kind\":\"constant\",\"value\":3}}],\"closed\":false}")]
    [InlineData("closedContour", "{\"points\":[{\"x\":{\"kind\":\"constant\",\"value\":0},\"y\":{\"kind\":\"constant\",\"value\":0}},{\"x\":{\"kind\":\"constant\",\"value\":2},\"y\":{\"kind\":\"constant\",\"value\":0}},{\"x\":{\"kind\":\"constant\",\"value\":1},\"y\":{\"kind\":\"constant\",\"value\":2}}]}")]
    [InlineData("text", "{\"x\":{\"kind\":\"constant\",\"value\":0},\"y\":{\"kind\":\"constant\",\"value\":0},\"text\":\"X1\",\"fontSize\":{\"kind\":\"constant\",\"value\":12}}")]
    [InlineData("image", "{\"assetId\":\"00000000-0000-4000-8000-00000000000d\",\"x\":{\"kind\":\"constant\",\"value\":0},\"y\":{\"kind\":\"constant\",\"value\":0},\"width\":{\"kind\":\"constant\",\"value\":20},\"height\":{\"kind\":\"constant\",\"value\":10},\"cropX\":0,\"cropY\":0,\"cropWidth\":1,\"cropHeight\":1,\"underlay\":true}")]
    public void Additional_node_geometries_follow_the_client_contract(string kind, string geometryJson)
    {
        var content = ValidContent();
        var node = content["views"]![0]!["layers"]![0]!["nodes"]![0]!.AsObject();
        node["kind"] = kind;
        node["geometry"] = JsonNode.Parse(geometryJson);

        ComponentTemplateContentV2Validator.Validate(Element(content));
    }

    private static JsonObject ValidContent()
    {
        var e4Primitive = RectangleNode(Ids.Primitive, Ids.E4Layer);
        var e4Group = GroupNode(Ids.Group, Ids.E4Layer, Ids.Primitive);
        var drawingPrimitive = EllipseNode(Ids.DrawingPrimitive, Ids.DrawingLayer);
        var drawingGroup = GroupNode(Ids.DrawingGroup, Ids.DrawingLayer, Ids.DrawingPrimitive);
        return new JsonObject
        {
            ["schemaVersion"] = 2,
            ["views"] = new JsonArray(
                View(Ids.E4, "e4", Ids.E4Layer, e4Primitive, e4Group, Ids.E4Point, Ids.Group, 10, 0),
                View(Ids.Drawing, "drawing", Ids.DrawingLayer, drawingPrimitive, drawingGroup, Ids.DrawingPoint, Ids.DrawingGroup, 0, 12)),
            ["logicalContacts"] = new JsonArray(new JsonObject
            {
                ["id"] = Ids.Contact, ["number"] = "1", ["name"] = "Signal 1", ["contactType"] = "signal",
            }),
            ["parameters"] = new JsonArray(
                new JsonObject
                {
                    ["id"] = Ids.Count, ["name"] = "Count", ["type"] = "integer", ["unit"] = "pcs",
                    ["defaultValue"] = 2, ["minimum"] = 1, ["maximum"] = 100, ["formula"] = null,
                },
                new JsonObject
                {
                    ["id"] = Ids.Size, ["name"] = "Width", ["type"] = "number", ["unit"] = "px",
                    ["defaultValue"] = 50, ["minimum"] = 1, ["maximum"] = 500,
                    ["formula"] = new JsonObject
                    {
                        ["kind"] = "binary", ["operator"] = "multiply",
                        ["left"] = Parameter(Ids.Count), ["right"] = Constant(25),
                    },
                }),
            ["repeaters"] = new JsonArray(new JsonObject
            {
                ["id"] = Ids.Repeater,
                ["countParameterId"] = Ids.Count,
                ["logicalContactIds"] = new JsonArray(Ids.Contact),
            }),
            ["assets"] = new JsonArray(new JsonObject
            {
                ["assetId"] = Ids.Asset, ["fileName"] = "connector.png", ["mediaType"] = "image/png",
                ["sha256"] = new string('a', 64), ["sizeBytes"] = 1024,
            }),
            ["articleParameterPresets"] = new JsonArray(new JsonObject
            {
                ["id"] = Ids.Preset, ["sourceId"] = "technology", ["entityType"] = "connector", ["articleKey"] = "B2B-XH-A",
                ["values"] = new JsonArray(
                    new JsonObject { ["parameterId"] = Ids.Count, ["value"] = 2 },
                    new JsonObject { ["parameterId"] = Ids.Size, ["value"] = 50 }),
            }),
        };
    }

    private static JsonObject View(
        string id,
        string kind,
        string layerId,
        JsonObject primitive,
        JsonObject group,
        string pointId,
        string prototypeId,
        int stepX,
        int stepY) => new()
    {
        ["id"] = id,
        ["name"] = kind,
        ["kind"] = kind,
        ["layers"] = new JsonArray(new JsonObject
        {
            ["id"] = layerId, ["name"] = "Main", ["visible"] = true, ["locked"] = false,
            ["nodes"] = new JsonArray(primitive, group),
        }),
        ["contactPoints"] = new JsonArray(new JsonObject
        {
            ["id"] = pointId, ["logicalContactId"] = Ids.Contact,
            ["x"] = Constant(12), ["y"] = Constant(22), ["direction"] = "right",
        }),
        ["bundlePorts"] = new JsonArray(),
        ["repeatPlacements"] = new JsonArray(new JsonObject
        {
            ["repeatDomainId"] = Ids.Repeater, ["prototypeGroupId"] = prototypeId,
            ["step"] = Point(Constant(stepX), Constant(stepY)), ["contactPointIds"] = new JsonArray(pointId),
        }),
    };

    private static JsonObject Node(string id, string layerId, string kind, JsonObject geometry) => new()
    {
        ["id"] = id, ["kind"] = kind, ["layerId"] = layerId, ["visible"] = true, ["locked"] = false,
        ["opacity"] = 1, ["transform"] = new JsonObject
        {
            ["translateX"] = Constant(0), ["translateY"] = Constant(0), ["rotationDegrees"] = Constant(0),
            ["scaleX"] = Constant(1), ["scaleY"] = Constant(1),
        },
        ["stroke"] = new JsonObject { ["color"] = "#112233", ["width"] = Constant(2) },
        ["fill"] = new JsonObject { ["color"] = null }, ["geometry"] = geometry,
    };

    private static JsonObject RectangleNode(string id, string layerId) => Node(id, layerId, "rectangle", new JsonObject
    {
        ["x"] = Constant(10), ["y"] = Constant(20), ["width"] = Parameter(Ids.Size), ["height"] = Constant(40),
        ["cornerRadii"] = new JsonArray(Constant(0), Constant(4), Constant(4), Constant(0)),
    });

    private static JsonObject EllipseNode(string id, string layerId) => Node(id, layerId, "ellipse", new JsonObject
    {
        ["centerX"] = Constant(10), ["centerY"] = Constant(20), ["radiusX"] = Constant(5), ["radiusY"] = Constant(8),
    });

    private static JsonObject GroupNode(string id, string layerId, string childId) => Node(id, layerId, "group", new JsonObject
    {
        ["childIds"] = new JsonArray(childId),
    });

    private static JsonObject Constant(double value) => new() { ["kind"] = "constant", ["value"] = value };
    private static JsonObject Parameter(string id) => new() { ["kind"] = "parameter", ["parameterId"] = id };
    private static JsonObject Point(JsonNode x, JsonNode y) => new() { ["x"] = x, ["y"] = y };

    private static JsonElement Element(JsonNode node) => JsonSerializer.SerializeToElement(node);

    private static class Ids
    {
        internal const string E4 = "00000000-0000-4000-8000-000000000001";
        internal const string Drawing = "00000000-0000-4000-8000-000000000002";
        internal const string E4Layer = "00000000-0000-4000-8000-000000000003";
        internal const string DrawingLayer = "00000000-0000-4000-8000-000000000004";
        internal const string Contact = "00000000-0000-4000-8000-000000000005";
        internal const string E4Point = "00000000-0000-4000-8000-000000000006";
        internal const string DrawingPoint = "00000000-0000-4000-8000-000000000007";
        internal const string Primitive = "00000000-0000-4000-8000-000000000008";
        internal const string Group = "00000000-0000-4000-8000-000000000009";
        internal const string Count = "00000000-0000-4000-8000-00000000000a";
        internal const string Size = "00000000-0000-4000-8000-00000000000b";
        internal const string Repeater = "00000000-0000-4000-8000-00000000000c";
        internal const string Asset = "00000000-0000-4000-8000-00000000000d";
        internal const string Preset = "00000000-0000-4000-8000-00000000000e";
        internal const string DrawingPrimitive = "00000000-0000-4000-8000-00000000000f";
        internal const string DrawingGroup = "00000000-0000-4000-8000-000000000010";
        internal const string SecondGroup = "00000000-0000-4000-8000-000000000011";
        internal const string SecondRepeater = "00000000-0000-4000-8000-000000000012";
    }
}
