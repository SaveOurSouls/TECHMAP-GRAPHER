using System.Text.Json;
using System.Text.Json.Nodes;
using Techmap.Application;
using Techmap.Infrastructure.Sqlite;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class HarnessTerminationValidatorTests
{
    [Fact]
    public void Validates_shared_contact_groups_operations_and_free_end_preparations()
    {
        using var json = JsonDocument.Parse(ValidDocument().ToJsonString());
        HarnessTerminationValidator.Validate(json.RootElement);
    }

    [Theory]
    [InlineData("wrong-member")]
    [InlineData("missing-artifact")]
    [InlineData("duplicate-end")]
    [InlineData("operation-cycle")]
    [InlineData("unknown-operation-target")]
    [InlineData("invalid-port-set")]
    public void Rejects_broken_termination_references_and_operation_graph(string mutation)
    {
        var design = ValidDocument();
        switch (mutation)
        {
            case "wrong-member": design["terminations"]!["groups"]![0]!["memberEnds"]![0]!["end"] = "from"; break;
            case "missing-artifact": design["terminations"]!["groups"]![0]!["artifactId"] = "missing"; break;
            case "duplicate-end": design["terminations"]!["groups"]![0]!["memberEnds"]!.AsArray().Add(new JsonObject { ["wireId"] = "w", ["end"] = "to" }); break;
            case "operation-cycle":
                design["terminations"]!["operations"]![0]!["dependsOn"] = new JsonArray("op2");
                design["terminations"]!["operations"]![1]!["dependsOn"] = new JsonArray("op1");
                break;
            case "unknown-operation-target": design["terminations"]!["operations"]![1]!["target"]!["groupId"] = "missing"; break;
            case "invalid-port-set":
                design["terminations"]!["operations"]!.AsArray().Add(new JsonObject
                {
                    ["id"] = "op3", ["kind"] = "crimp", ["executionCount"] = 1,
                    ["target"] = new JsonObject { ["kind"] = "portSet", ["connectorId"] = "A", ["contactIds"] = new JsonArray("a") },
                });
                break;
        }
        using var json = JsonDocument.Parse(design.ToJsonString());
        var error = Assert.Throws<HarnessDesignDocumentException>(() => HarnessTerminationValidator.Validate(json.RootElement));
        Assert.Equal("invalid_harness_termination", error.Code);
    }

    [Fact]
    public void Twist_requires_existing_common_physical_route_segments()
    {
        var design = ValidDocument();
        design["wires"]!.AsArray().Add(new JsonObject
        {
            ["id"] = "w2", ["from"] = new JsonObject { ["connectorId"] = "A", ["contactId"] = "a" },
            ["to"] = new JsonObject { ["connectorId"] = "B", ["contactId"] = "b" },
        });
        design["physicalTopology"] = new JsonObject
        {
            ["segments"] = new JsonArray(new JsonObject { ["id"] = "s1" }),
            ["routes"] = new JsonArray(
                new JsonObject { ["wireId"] = "w", ["steps"] = new JsonArray(new JsonObject { ["segmentId"] = "s1" }) },
                new JsonObject { ["wireId"] = "w2", ["steps"] = new JsonArray() }),
        };
        design["terminations"]!["twists"] = new JsonArray(new JsonObject
        {
            ["id"] = "tw", ["memberWireIds"] = new JsonArray("w", "w2"), ["segmentIds"] = new JsonArray("s1"), ["pitchMm"] = null, ["direction"] = "left",
        });
        using var json = JsonDocument.Parse(design.ToJsonString());
        var error = Assert.Throws<HarnessDesignDocumentException>(() => HarnessTerminationValidator.Validate(json.RootElement));
        Assert.Equal("invalid_harness_termination", error.Code);
    }

    [Fact]
    public void Terminal_artifact_cannot_be_reused_at_a_second_contact()
    {
        var design = ValidDocument();
        design["terminations"]!["groups"]!.AsArray().Add(new JsonObject
        {
            ["id"] = "second-group", ["target"] = new JsonObject { ["connectorId"] = "A", ["contactId"] = "a" },
            ["artifactId"] = "terminal", ["memberEnds"] = new JsonArray(new JsonObject { ["wireId"] = "w", ["end"] = "from" }),
        });
        using var json = JsonDocument.Parse(design.ToJsonString());
        var error = Assert.Throws<HarnessDesignDocumentException>(() => HarnessTerminationValidator.Validate(json.RootElement));
        Assert.Equal("invalid_harness_termination", error.Code);
    }

    [Fact]
    public void Physical_segment_cannot_be_claimed_by_two_twist_groups()
    {
        var design = ValidDocument();
        design["wires"]!.AsArray().Add(new JsonObject
        {
            ["id"] = "w2", ["from"] = new JsonObject { ["connectorId"] = "A", ["contactId"] = "a" },
            ["to"] = new JsonObject { ["connectorId"] = "B", ["contactId"] = "b" },
        });
        design["physicalTopology"] = new JsonObject
        {
            ["segments"] = new JsonArray(new JsonObject { ["id"] = "s1" }),
            ["routes"] = new JsonArray(
                new JsonObject { ["wireId"] = "w", ["steps"] = new JsonArray(new JsonObject { ["segmentId"] = "s1" }) },
                new JsonObject { ["wireId"] = "w2", ["steps"] = new JsonArray(new JsonObject { ["segmentId"] = "s1" }) }),
        };
        design["terminations"]!["twists"] = new JsonArray(
            new JsonObject { ["id"] = "tw1", ["memberWireIds"] = new JsonArray("w", "w2"), ["segmentIds"] = new JsonArray("s1"), ["pitchMm"] = null, ["direction"] = "left" },
            new JsonObject { ["id"] = "tw2", ["memberWireIds"] = new JsonArray("w", "w2"), ["segmentIds"] = new JsonArray("s1"), ["pitchMm"] = null, ["direction"] = "right" });
        using var json = JsonDocument.Parse(design.ToJsonString());
        var error = Assert.Throws<HarnessDesignDocumentException>(() => HarnessTerminationValidator.Validate(json.RootElement));
        Assert.Equal("invalid_harness_termination", error.Code);
    }

    [Fact]
    public void End_preparation_reuses_group_or_component_terminal_and_keeps_seal_separate()
    {
        var matching = ValidDocument();
        matching["terminations"]!["artifacts"]!.AsArray().Add(new JsonObject { ["id"] = "seal", ["kind"] = "seal", ["article"] = "S1", ["symbolId"] = "seal" });
        matching["connectors"]![1]!["terminationComponent"] = new JsonObject { ["kind"] = "terminal", ["symbolId"] = "terminal", ["artifactId"] = "terminal" };
        matching["terminations"]!["endPreparations"]!.AsArray().Add(new JsonObject
        {
            ["id"] = "prepared-end", ["wireId"] = "w", ["end"] = "to", ["mode"] = "pin-sealed",
            ["artifactId"] = "terminal", ["sealArtifactId"] = "seal",
        });
        using (var json = JsonDocument.Parse(matching.ToJsonString())) HarnessTerminationValidator.Validate(json.RootElement);

        var conflictingGroup = matching.DeepClone().AsObject();
        conflictingGroup["terminations"]!["artifacts"]!.AsArray().Add(new JsonObject { ["id"] = "terminal2", ["kind"] = "terminal", ["article"] = "T2", ["symbolId"] = "terminal" });
        conflictingGroup["terminations"]!["endPreparations"]![1]!["artifactId"] = "terminal2";
        using (var json = JsonDocument.Parse(conflictingGroup.ToJsonString()))
            Assert.Throws<HarnessDesignDocumentException>(() => HarnessTerminationValidator.Validate(json.RootElement));

        var conflictingGroupComponent = matching.DeepClone().AsObject();
        conflictingGroupComponent["terminations"]!["artifacts"]!.AsArray().Add(new JsonObject { ["id"] = "terminal2", ["kind"] = "terminal", ["article"] = "T2", ["symbolId"] = "terminal" });
        conflictingGroupComponent["connectors"]![1]!["terminationComponent"]!["artifactId"] = "terminal2";
        using (var json = JsonDocument.Parse(conflictingGroupComponent.ToJsonString()))
            Assert.Throws<HarnessDesignDocumentException>(() => HarnessTerminationValidator.Validate(json.RootElement));

        var conflictingComponent = matching.DeepClone().AsObject();
        conflictingComponent["terminations"]!["groups"] = new JsonArray();
        conflictingComponent["terminations"]!["artifacts"]!.AsArray().Add(new JsonObject { ["id"] = "terminal2", ["kind"] = "terminal", ["article"] = "T2", ["symbolId"] = "terminal" });
        conflictingComponent["terminations"]!["endPreparations"]![1]!["artifactId"] = "terminal2";
        using var componentJson = JsonDocument.Parse(conflictingComponent.ToJsonString());
        Assert.Throws<HarnessDesignDocumentException>(() => HarnessTerminationValidator.Validate(componentJson.RootElement));
    }

    private static JsonObject ValidDocument() => JsonNode.Parse("""
    {
      "schemaVersion":1,
      "connectors":[
        {"id":"A","contacts":[{"id":"a"}]},
        {"id":"B","contacts":[{"id":"b"}]},
        {"id":"SL","contacts":[{"id":"left"},{"id":"right"}],"terminationComponent":{"kind":"sleeve","symbolId":"sleeve"}}
      ],
      "wires":[{"id":"w","from":{"connectorId":"A","contactId":"a"},"to":{"connectorId":"B","contactId":"b"}}],
      "terminations":{
        "version":1,
        "artifacts":[{"id":"terminal","kind":"terminal","article":"T1","symbolId":"terminal"}],
        "groups":[{"id":"group","target":{"connectorId":"B","contactId":"b"},"artifactId":"terminal","memberEnds":[{"wireId":"w","end":"to"}]}],
        "endPreparations":[{"id":"prep","wireId":"w","end":"from","mode":"cut"}],
        "operations":[
          {"id":"op1","kind":"strip","target":{"kind":"wireEnd","wireId":"w","end":"from"},"executionCount":1},
          {"id":"op2","kind":"crimp","target":{"kind":"group","groupId":"group"},"executionCount":1,"dependsOn":["op1"]},
          {"id":"op3","kind":"ultrasonic-weld","target":{"kind":"portSet","connectorId":"SL","contactIds":["left","right"]},"executionCount":1}
        ],
        "twists":[]
      }
    }
    """)!.AsObject();
}
