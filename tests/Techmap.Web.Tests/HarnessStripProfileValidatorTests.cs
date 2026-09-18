using System.Text.Json;
using System.Text.Json.Nodes;
using Techmap.Application;
using Techmap.Infrastructure.Sqlite;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class HarnessStripProfileValidatorTests
{
    [Theory]
    [InlineData("{}")]
    [InlineData("{\"wires\":[]}")]
    [InlineData("{\"wires\":[{\"id\":\"legacy\"}]}")]
    [InlineData("{\"wires\":[{\"stripProfiles\":{}}]}")]
    public void Optional_profiles_do_not_change_legacy_documents(string json)
    {
        using var document = JsonDocument.Parse(json);
        HarnessStripProfileValidator.Validate(document.RootElement);
    }

    [Theory]
    [InlineData("{\"wires\":[{\"stripProfiles\":null}]}", "content.wires[0].stripProfiles")]
    [InlineData("{\"wires\":[{\"stripProfiles\":{\"to\":null}}]}", "content.wires[0].stripProfiles.to")]
    [InlineData("{\"wires\":[{\"stripProfiles\":{\"from\":[]}}]}", "content.wires[0].stripProfiles.from")]
    public void Malformed_profile_containers_are_rejected(string json, string field)
    {
        using var document = JsonDocument.Parse(json);
        var error = Assert.Throws<HarnessDesignDocumentException>(() => HarnessStripProfileValidator.Validate(document.RootElement));
        Assert.Equal(field, error.Field);
    }

    [Fact]
    public void Sixty_four_layers_and_gaps_are_preserved_but_a_sixty_fifth_is_rejected()
    {
        var layers = new JsonArray(Enumerable.Range(1, 64).Select(index => (JsonNode)new JsonObject {
            ["index"] = index * 2, ["diameterMm"] = index * 0.001m, ["stripLengthMm"] = index * 2.5m
        }).ToArray());
        var profile = new JsonObject {
            ["sourceId"] = "test", ["snapshotId"] = Guid.NewGuid().ToString("D"),
            ["snapshotSha256"] = new string('a', 64), ["recordId"] = new string('b', 64),
            ["entityType"] = "coax-termination", ["sourceKey"] = "strip", ["displayName"] = "strip", ["layers"] = layers
        };
        var content = new JsonObject { ["wires"] = new JsonArray(new JsonObject {
            ["stripProfiles"] = new JsonObject { ["from"] = profile, ["to"] = profile.DeepClone() }
        }) };
        var before = content.ToJsonString();
        HarnessStripProfileValidator.Validate(JsonSerializer.SerializeToElement(content));
        Assert.Equal(before, content.ToJsonString());
        layers.Add(new JsonObject { ["index"] = 130, ["diameterMm"] = 1, ["stripLengthMm"] = 200 });
        var error = Assert.Throws<HarnessDesignDocumentException>(() =>
            HarnessStripProfileValidator.Validate(JsonSerializer.SerializeToElement(content)));
        Assert.Equal("content.wires[0].stripProfiles.from.layers", error.Field);
    }
}
