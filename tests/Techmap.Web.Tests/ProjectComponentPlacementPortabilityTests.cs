using System.Text.Json;
using System.Text.Json.Nodes;
using Techmap.Application;
using Techmap.Domain;
using Techmap.Infrastructure.Sqlite;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class ProjectComponentPlacementPortabilityTests
{
    [Fact]
    public async Task Export_import_remaps_component_and_wire_ids_but_preserves_template_identity()
    {
        using var fixture = Fixture.Create();
        SourceGraph source;
        await using (var sourceLease = DataRootLease.Acquire(fixture.SourceDataRoot))
        {
            using var sourceStorage = SqliteStorage.Open(sourceLease.CanonicalPath);
            source = CreateSourceGraph(sourceStorage);
            await new SqliteProjectExportService(sourceLease, sourceStorage).ExportAsync(
                new ProjectExportRequest(source.ProjectId, fixture.ArchivePath, "0.4.0-m3.01"),
                TestContext.Current.CancellationToken);
        }

        await using var destinationLease = DataRootLease.Acquire(fixture.DestinationDataRoot);
        using var destinationStorage = SqliteStorage.Open(destinationLease.CanonicalPath);
        var imported = await new SqliteProjectImportService(destinationLease, destinationStorage).ImportAsync(
            new ProjectImportRequest(fixture.ArchivePath, "0.4.0-m3.01"),
            TestContext.Current.CancellationToken);
        var importedProject = new SqliteProjectCatalog(destinationStorage).GetProject(imported.ProjectId);
        var importedHarness = Assert.Single(importedProject.Harnesses);

        AssertPortableGraph(destinationStorage, importedProject.ProjectId, importedHarness.HarnessId, source);
    }

    [Fact]
    public void Copy_remaps_component_and_wire_ids_but_preserves_template_identity()
    {
        using var fixture = Fixture.Create();
        using var storage = SqliteStorage.Open(fixture.SourceDataRoot);
        var source = CreateSourceGraph(storage);

        var copy = new SqliteProjectCatalog(storage).CopyProject(source.ProjectId);
        var copiedHarness = Assert.Single(copy.Harnesses);

        AssertPortableGraph(storage, copy.ProjectId, copiedHarness.HarnessId, source);
        var sourcePlacements = new SqliteProjectComponentSnapshotStore(storage, TimeProvider.System)
            .ListPlacements(source.ProjectId, source.HarnessId);
        Assert.Equal(source.PlacementIds.Order(), sourcePlacements.Select(item => item.PlacementId).Order());
    }

    [Fact]
    public void Copy_ignores_commanded_placement_removed_from_live_design_and_its_snapshot()
    {
        using var fixture = Fixture.Create();
        using var storage = SqliteStorage.Open(fixture.SourceDataRoot);
        var source = CreateSourceGraph(storage);
        var designStore = new SqliteHarnessDesignDocumentStore(storage, TimeProvider.System);
        var current = designStore.Get(source.ProjectId, source.HarnessId);
        var content = JsonNode.Parse(current.ContentJson)!.AsObject();
        content["connectors"] = new JsonArray();
        content["wires"] = new JsonArray();

        _ = designStore.Put(
            source.ProjectId,
            source.HarnessId,
            current.Revision,
            SqliteHarnessDesignDocumentStore.CurrentContentSchemaVersion,
            content.ToJsonString());

        var sourceStore = new SqliteProjectComponentSnapshotStore(storage, TimeProvider.System);
        Assert.Empty(sourceStore.ListPlacements(source.ProjectId, source.HarnessId));
        Assert.Single(sourceStore.ListSnapshots(source.ProjectId));
        var auditRows = storage.ExecuteRead(unitOfWork =>
        {
            using var command = unitOfWork.CreateCommand(
                "SELECT COUNT(*) FROM harness_component_placements WHERE harness_id = $harnessId;");
            command.Parameters.AddWithValue("$harnessId", source.HarnessId.Value.ToString("D"));
            return Convert.ToInt32(command.ExecuteScalar());
        });
        Assert.Equal(2, auditRows);

        var copy = new SqliteProjectCatalog(storage).CopyProject(source.ProjectId);
        var copiedHarness = Assert.Single(copy.Harnesses);
        var copiedStore = new SqliteProjectComponentSnapshotStore(storage, TimeProvider.System);
        Assert.Empty(copiedStore.ListPlacements(copy.ProjectId, copiedHarness.HarnessId));
        Assert.Empty(copiedStore.ListSnapshots(copy.ProjectId));
        using var copiedDesign = JsonDocument.Parse(
            designStore.Get(copy.ProjectId, copiedHarness.HarnessId).ContentJson);
        Assert.Empty(copiedDesign.RootElement.GetProperty("connectors").EnumerateArray());
        Assert.Empty(copiedDesign.RootElement.GetProperty("wires").EnumerateArray());
    }

    private static SourceGraph CreateSourceGraph(SqliteStorage storage)
    {
        var projects = new SqliteProjectCatalog(storage);
        var project = projects.CreateProject(new CreateProjectCommand(
            "P-PORTABLE", "Portable component graph", 1, ProjectStatus.Active));
        var harness = projects.AddHarness(project.ProjectId, "W1").Harnesses.Single();
        var article = ComponentTemplateContentV3ValidatorTests.ValidArticleBindings.Single();
        var template = new SqliteComponentTemplateStore(storage, TimeProvider.System).Create(
            "XH", "XH series", [article], 3, ComponentTemplateContentV3ValidatorTests.ValidContentJson);
        var store = new SqliteProjectComponentSnapshotStore(storage, TimeProvider.System);
        var firstId = Guid.NewGuid();
        var secondId = Guid.NewGuid();
        var firstLogicalId = Guid.NewGuid();
        var secondLogicalId = Guid.NewGuid();
        var articleVariantId = Guid.NewGuid();
        var first = BoundInstance(firstId, firstLogicalId, articleVariantId, "X1", template, article);
        var second = BoundInstance(secondId, secondLogicalId, articleVariantId, "X2", template, article);

        _ = store.Place(project.ProjectId, harness.HarnessId, new ProjectCommandEnvelope(Guid.NewGuid(), 0),
            firstId, template, article.SourceId, article.EntityType, article.ArticleKey, first);
        _ = store.Place(project.ProjectId, harness.HarnessId, new ProjectCommandEnvelope(Guid.NewGuid(), 1),
            secondId, template, article.SourceId, article.EntityType, article.ArticleKey, second);

        var designs = new SqliteHarnessDesignDocumentStore(storage, TimeProvider.System);
        var design = designs.Get(project.ProjectId, harness.HarnessId);
        var content = JsonNode.Parse(design.ContentJson)!.AsObject();
        content["wires"]!.AsArray().Add(new JsonObject
        {
            ["id"] = "wire-1",
            ["from"] = new JsonObject
            {
                ["connectorId"] = firstId.ToString("D"),
                ["contactId"] = ContactId(firstId, firstLogicalId),
            },
            ["to"] = new JsonObject
            {
                ["connectorId"] = secondId.ToString("D"),
                ["contactId"] = ContactId(secondId, secondLogicalId),
            },
        });
        _ = designs.Put(project.ProjectId, harness.HarnessId, 2,
            SqliteHarnessDesignDocumentStore.CurrentContentSchemaVersion, content.ToJsonString());

        return new SourceGraph(
            project.ProjectId, harness.HarnessId, [firstId, secondId],
            template.TemplateId, template.Version, template.VersionSha256,
            articleVariantId, [firstLogicalId, secondLogicalId]);
    }

    private static string BoundInstance(
        Guid placementId,
        Guid logicalContactId,
        Guid articleVariantId,
        string designation,
        ComponentTemplateVersion template,
        ComponentTemplateArticleBinding article) => new JsonObject
    {
        ["id"] = placementId.ToString("D"),
        ["designation"] = designation,
        ["partNumber"] = article.ArticleKey,
        ["contacts"] = new JsonArray(new JsonObject
        {
            ["id"] = ContactId(placementId, logicalContactId),
            ["logicalContactId"] = logicalContactId.ToString("D"),
            ["number"] = 1,
        }),
        ["libraryBinding"] = new JsonObject
        {
            ["mode"] = "template",
            ["templateId"] = template.TemplateId.ToString("D"),
            ["templateVersion"] = template.Version,
            ["versionSha256"] = template.VersionSha256,
            ["articleVariantId"] = articleVariantId.ToString("D"),
            ["article"] = Article(article),
            ["snapshot"] = new JsonObject
            {
                ["templateId"] = template.TemplateId.ToString("D"),
                ["templateVersion"] = template.Version,
                ["versionSha256"] = template.VersionSha256,
                ["articleVariantId"] = articleVariantId.ToString("D"),
                ["article"] = Article(article),
                ["logicalContactId"] = logicalContactId.ToString("D"),
            },
        },
    }.ToJsonString();

    private static JsonObject Article(ComponentTemplateArticleBinding article) => new()
    {
        ["sourceId"] = article.SourceId,
        ["entityType"] = article.EntityType,
        ["articleKey"] = article.ArticleKey,
    };

    private static void AssertPortableGraph(
        SqliteStorage storage,
        ProjectIdentity projectId,
        HarnessIdentity harnessId,
        SourceGraph source)
    {
        var snapshotStore = new SqliteProjectComponentSnapshotStore(storage, TimeProvider.System);
        var placements = snapshotStore.ListPlacements(projectId, harnessId);
        Assert.Equal(2, placements.Count);
        Assert.Empty(placements.Select(item => item.PlacementId).Intersect(source.PlacementIds));
        Assert.All(placements, placement => Assert.NotEqual(Guid.Empty, placement.PlacementId));

        var snapshots = snapshotStore.ListSnapshots(projectId);
        var snapshot = Assert.Single(snapshots);
        Assert.Equal(source.TemplateId, snapshot.SourceTemplateId);
        Assert.Equal(source.TemplateVersion, snapshot.SourceVersion);
        Assert.Equal(source.VersionSha256, snapshot.SourceVersionSha256);

        var design = new SqliteHarnessDesignDocumentStore(storage, TimeProvider.System)
            .Get(projectId, harnessId);
        using var document = JsonDocument.Parse(design.ContentJson);
        var connectors = document.RootElement.GetProperty("connectors").EnumerateArray().ToArray();
        var wires = document.RootElement.GetProperty("wires").EnumerateArray().ToArray();
        var wire = Assert.Single(wires);
        var destinationIds = placements.Select(item => item.PlacementId.ToString("D")).ToHashSet(StringComparer.Ordinal);
        Assert.Equal(destinationIds, connectors.Select(item => item.GetProperty("id").GetString()!).ToHashSet(StringComparer.Ordinal));

        foreach (var placement in placements)
        {
            var connector = connectors.Single(item =>
                item.GetProperty("id").GetString() == placement.PlacementId.ToString("D"));
            using var instance = JsonDocument.Parse(placement.InstanceJson);
            Assert.True(JsonElement.DeepEquals(connector, instance.RootElement));
            var binding = connector.GetProperty("libraryBinding");
            Assert.Equal(source.TemplateId.ToString("D"), binding.GetProperty("templateId").GetString());
            Assert.Equal(source.VersionSha256, binding.GetProperty("versionSha256").GetString());
            Assert.Equal(source.ArticleVariantId.ToString("D"), binding.GetProperty("articleVariantId").GetString());
            var logicalId = connector.GetProperty("contacts")[0].GetProperty("logicalContactId").GetString();
            Assert.Contains(Guid.Parse(logicalId!), source.LogicalContactIds);
            Assert.Equal(
                ContactId(placement.PlacementId, Guid.Parse(logicalId!)),
                connector.GetProperty("contacts")[0].GetProperty("id").GetString());
        }

        foreach (var endName in new[] { "from", "to" })
        {
            var endpoint = wire.GetProperty(endName);
            var connectorId = endpoint.GetProperty("connectorId").GetString()!;
            Assert.Contains(connectorId, destinationIds);
            Assert.StartsWith(connectorId + ":contact:", endpoint.GetProperty("contactId").GetString());
        }
    }

    private static string ContactId(Guid placementId, Guid logicalContactId) =>
        $"{placementId:D}:contact:{logicalContactId:D}";

    private sealed record SourceGraph(
        ProjectIdentity ProjectId,
        HarnessIdentity HarnessId,
        IReadOnlyList<Guid> PlacementIds,
        Guid TemplateId,
        int TemplateVersion,
        string VersionSha256,
        Guid ArticleVariantId,
        IReadOnlyList<Guid> LogicalContactIds);

    private sealed class Fixture : IDisposable
    {
        private Fixture(string root)
        {
            Root = root;
            SourceDataRoot = Path.Combine(root, "source");
            DestinationDataRoot = Path.Combine(root, "destination");
            ArchivePath = Path.Combine(root, "portable.techmap-project.zip");
            Directory.CreateDirectory(root);
        }

        public string Root { get; }
        public string SourceDataRoot { get; }
        public string DestinationDataRoot { get; }
        public string ArchivePath { get; }

        public static Fixture Create() => new(Path.Combine(
            Path.GetTempPath(), "techmap-m3-portability-" + Guid.NewGuid().ToString("N")));

        public void Dispose()
        {
            if (Directory.Exists(Root)) Directory.Delete(Root, true);
        }
    }
}
