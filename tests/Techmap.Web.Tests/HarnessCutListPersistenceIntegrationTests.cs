using System.Text.Json;
using Techmap.Application;
using Techmap.Domain;
using Techmap.Infrastructure.Sqlite;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class HarnessCutListPersistenceIntegrationTests
{
    [Fact]
    public void Complete_harness_design_survives_restart_and_builds_a_ready_cut_list()
    {
        var root = Path.Combine(
            Path.GetTempPath(),
            "techmap-cut-list-persistence-tests",
            Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);

        try
        {
            ProjectIdentity projectId;
            HarnessIdentity harnessId;
            var snapshotId = Guid.NewGuid();
            var firstConnectorId = Guid.NewGuid();
            var secondConnectorId = Guid.NewGuid();
            using var content = JsonDocument.Parse(
                """
                {
                  "schemaVersion": 1,
                  "connectors": [
                    {"id":"FIRST_CONNECTOR_ID","designation":"XS1","contacts":[{"id":"XS1:1","number":1}]},
                    {"id":"SECOND_CONNECTOR_ID","designation":"XS2","contacts":[{"id":"XS2:1","number":1}]}
                  ],
                  "wires": [{
                    "id": "W-POWER-1",
                    "circuit": "+24V",
                    "from": {"connectorId":"FIRST_CONNECTOR_ID","contactId":"XS1:1"},
                    "to": {"connectorId":"SECOND_CONNECTOR_ID","contactId":"XS2:1"},
                    "materialBinding": {
                      "sourceId": "technology-wires",
                      "snapshotId": "SNAPSHOT_ID",
                      "snapshotSha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                      "recordId": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                      "entityType": "wire",
                      "sourceKey": "UL1061-24-BK",
                      "displayName": "UL1061 24 AWG, чёрный"
                    },
                    "lengthMm": 125.201,
                    "endCorrectionFromMm": 1.1,
                    "endCorrectionToMm": -0.2,
                    "cutRoundingStepMm": 0.5
                  }],
                  "views": {"e4":{"layers":[]},"drawing":{"layers":[]}}
                }
                """
                .Replace("FIRST_CONNECTOR_ID", firstConnectorId.ToString("D"), StringComparison.Ordinal)
                .Replace("SECOND_CONNECTOR_ID", secondConnectorId.ToString("D"), StringComparison.Ordinal)
                .Replace("SNAPSHOT_ID", snapshotId.ToString("D"), StringComparison.Ordinal));
            var expectedContent = content.RootElement.GetRawText();

            using (var storage = SqliteStorage.Open(root))
            {
                var catalog = new SqliteProjectCatalog(storage);
                var project = catalog.CreateProject(new CreateProjectCommand(
                    "КС-ACCEPTANCE",
                    "Минимальный цикл одного жгута",
                    1,
                    ProjectStatus.Draft));
                project = catalog.AddHarness(project.ProjectId, "Жгут силовой", quantity: 6);
                projectId = project.ProjectId;
                harnessId = Assert.Single(project.Harnesses).HarnessId;

                var saved = new SqliteHarnessDesignDocumentStore(storage, TimeProvider.System).Put(
                    projectId,
                    harnessId,
                    expectedRevision: 0,
                    schemaVersion: 1,
                    expectedContent);

                Assert.Equal(harnessId, saved.HarnessId);
                Assert.Equal(1, saved.Revision);
                Assert.Equal(expectedContent, saved.ContentJson);
            }

            using var reopenedStorage = SqliteStorage.Open(root);
            var reopenedCatalog = new SqliteProjectCatalog(reopenedStorage);
            var reopenedDesignStore = new SqliteHarnessDesignDocumentStore(
                reopenedStorage,
                TimeProvider.System);
            var reopenedProject = reopenedCatalog.GetProject(projectId);
            var reopenedHarness = Assert.Single(reopenedProject.Harnesses);
            var reopenedDesign = reopenedDesignStore.Get(projectId, harnessId);

            Assert.Equal(harnessId, reopenedHarness.HarnessId);
            Assert.Equal(6, reopenedHarness.Quantity);
            Assert.Equal(harnessId, reopenedDesign.HarnessId);
            Assert.Equal(1, reopenedDesign.Revision);
            Assert.Equal(1, reopenedDesign.SchemaVersion);
            Assert.Equal(expectedContent, reopenedDesign.ContentJson);

            using (var reopenedContent = JsonDocument.Parse(reopenedDesign.ContentJson))
            {
                Assert.True(JsonElement.DeepEquals(content.RootElement, reopenedContent.RootElement));
                var connectors = reopenedContent.RootElement.GetProperty("connectors");
                Assert.Equal(firstConnectorId, connectors[0].GetProperty("id").GetGuid());
                Assert.Equal(secondConnectorId, connectors[1].GetProperty("id").GetGuid());
                var wire = Assert.Single(reopenedContent.RootElement.GetProperty("wires").EnumerateArray());
                Assert.Equal(
                    firstConnectorId,
                    wire.GetProperty("from").GetProperty("connectorId").GetGuid());
                Assert.Equal(
                    secondConnectorId,
                    wire.GetProperty("to").GetProperty("connectorId").GetGuid());
                var material = wire.GetProperty("materialBinding");
                Assert.Equal("technology-wires", material.GetProperty("sourceId").GetString());
                Assert.Equal(
                    snapshotId,
                    material.GetProperty("snapshotId").GetGuid());
                Assert.Equal(new string('a', 64), material.GetProperty("snapshotSha256").GetString());
                Assert.Equal(new string('b', 64), material.GetProperty("recordId").GetString());
                Assert.Equal("wire", material.GetProperty("entityType").GetString());
                Assert.Equal("UL1061-24-BK", material.GetProperty("sourceKey").GetString());
            }

            var cutList = new HarnessCutListService(reopenedCatalog, reopenedDesignStore)
                .Get(projectId, harnessId);

            Assert.Equal("ready", cutList.Status);
            Assert.Equal(string.Empty, cutList.Warning);
            Assert.Equal(6, cutList.HarnessQuantity);
            var item = Assert.Single(cutList.Items);
            Assert.Equal("W-POWER-1", item.WireId);
            Assert.Equal("UL1061-24-BK", item.MaterialSourceKey);
            Assert.Equal("UL1061 24 AWG, чёрный", item.MaterialDisplayName);
            Assert.Equal(125.201m, item.SourceLengthMm);
            Assert.Equal(1.1m, item.EndCorrectionFromMm);
            Assert.Equal(-0.2m, item.EndCorrectionToMm);
            Assert.Equal(0.5m, item.RoundingStepMm);
            Assert.Equal(126.5m, item.CutLengthMm);
            Assert.Equal(6, item.Pieces);
            Assert.Equal(0.759m, item.TotalMetres);
            Assert.Equal("ready", item.Status);
            Assert.Empty(item.Warnings);
        }
        finally
        {
            if (Directory.Exists(root))
                Directory.Delete(root, recursive: true);
        }
    }
}
