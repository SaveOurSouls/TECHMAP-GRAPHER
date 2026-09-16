using System.Text.Json;
using System.Text.Json.Nodes;
using Techmap.Application;
using Techmap.Domain;
using Techmap.Infrastructure.Sqlite;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class ProjectComponentSnapshotStoreTests
{
    [Fact]
    public void Published_v4_template_is_placed_and_snapshotted_without_downgrade()
    {
        using var fixture = Fixture.Create();
        using var storage = SqliteStorage.Open(fixture.DataRoot);
        var catalog = new SqliteProjectCatalog(storage);
        var project = catalog.CreateProject(new CreateProjectCommand("P", "Project", 1, ProjectStatus.Draft));
        var harness = catalog.AddHarness(project.ProjectId, "W1").Harnesses.Single();
        var article = ComponentTemplateContentV3ValidatorTests.ValidArticleBindings.Single();
        var template = new SqliteComponentTemplateStore(storage, TimeProvider.System).Create(
            "XH", "XH series", [article], 4, ComponentTemplateContentV4ValidatorTests.ValidContentJson);
        var placementId = Guid.NewGuid();
        var store = new SqliteProjectComponentSnapshotStore(storage, TimeProvider.System);

        var result = store.Place(
            project.ProjectId, harness.HarnessId, new ProjectCommandEnvelope(Guid.NewGuid(), 0),
            placementId, template, article.SourceId, article.EntityType, article.ArticleKey,
            BoundInstance(placementId, template, article, "X1"));

        Assert.Equal(4, result.Snapshot.SchemaVersion);
        using var content = JsonDocument.Parse(result.Snapshot.ContentJson);
        Assert.Equal(4, content.RootElement.GetProperty("schemaVersion").GetInt32());
        Assert.True(content.RootElement.TryGetProperty("e4ConnectorTable", out _));
    }

    [Fact]
    public void Place_is_atomic_deduplicates_snapshot_and_replays_command()
    {
        using var fixture = Fixture.Create();
        using var storage = SqliteStorage.Open(fixture.DataRoot);
        var catalog = new SqliteProjectCatalog(storage);
        var project = catalog.CreateProject(new CreateProjectCommand("P", "Project", 1, ProjectStatus.Draft));
        var harness = catalog.AddHarness(project.ProjectId, "W1").Harnesses.Single();
        var templates = new SqliteComponentTemplateStore(storage, TimeProvider.System);
        var content = ComponentTemplateContentV3ValidatorTests.ValidContentJson;
        var article = ComponentTemplateContentV3ValidatorTests.ValidArticleBindings.Single();
        var template = templates.Create("XH", "XH series", [article], 3, content);
        var store = new SqliteProjectComponentSnapshotStore(storage, TimeProvider.System);
        var commandId = Guid.NewGuid();
        var placementId = Guid.NewGuid();
        var instance = BoundInstance(placementId, template, article, "X1");

        var first = store.Place(
            project.ProjectId, harness.HarnessId, new ProjectCommandEnvelope(commandId, 0),
            placementId, template, article.SourceId, article.EntityType, article.ArticleKey, instance);
        var replay = store.Place(
            project.ProjectId, harness.HarnessId, new ProjectCommandEnvelope(commandId, 0),
            placementId, template, article.SourceId, article.EntityType, article.ArticleKey, instance);

        Assert.Equal(1, first.ResultingRevision);
        Assert.Equal(first.CommandId, replay.CommandId);
        Assert.Equal(first.ResultingRevision, replay.ResultingRevision);
        Assert.Equal(first.Snapshot.SnapshotId, replay.Snapshot.SnapshotId);
        Assert.Equal(first.Placement.PlacementId, replay.Placement.PlacementId);
        Assert.Equal(first.Placement.InstanceJson, replay.Placement.InstanceJson);
        Assert.Single(store.ListSnapshots(project.ProjectId));
        Assert.Single(store.ListPlacements(project.ProjectId, harness.HarnessId));
        var design = new SqliteHarnessDesignDocumentStore(storage, TimeProvider.System)
            .Get(project.ProjectId, harness.HarnessId);
        Assert.Equal(1, design.Revision);
        using var document = JsonDocument.Parse(design.ContentJson);
        Assert.Equal(placementId.ToString("D"), document.RootElement.GetProperty("connectors")[0].GetProperty("id").GetString());

        var secondPlacementId = Guid.NewGuid();
        var secondInstance = BoundInstance(secondPlacementId, template, article, "X2");
        _ = store.Place(
            project.ProjectId, harness.HarnessId, new ProjectCommandEnvelope(Guid.NewGuid(), 1),
            secondPlacementId, template, article.SourceId, article.EntityType, article.ArticleKey, secondInstance);
        Assert.Single(store.ListSnapshots(project.ProjectId));
        Assert.Equal(2, store.ListPlacements(project.ProjectId, harness.HarnessId).Count);
    }

    [Fact]
    public void Stale_revision_and_duplicate_placement_roll_back_snapshot_and_placement()
    {
        using var fixture = Fixture.Create();
        using var storage = SqliteStorage.Open(fixture.DataRoot);
        var catalog = new SqliteProjectCatalog(storage);
        var project = catalog.CreateProject(new CreateProjectCommand("P", "Project", 1, ProjectStatus.Draft));
        var harness = catalog.AddHarness(project.ProjectId, "W1").Harnesses.Single();
        var content = ComponentTemplateContentV3ValidatorTests.ValidContentJson;
        var article = ComponentTemplateContentV3ValidatorTests.ValidArticleBindings.Single();
        var template = new SqliteComponentTemplateStore(storage, TimeProvider.System)
            .Create("XH", "XH series", [article], 3, content);
        var store = new SqliteProjectComponentSnapshotStore(storage, TimeProvider.System);
        var placementId = Guid.NewGuid();
        var instance = BoundInstance(placementId, template, article, "X1");

        var stale = Assert.Throws<ProjectComponentSnapshotException>(() => store.Place(
            project.ProjectId, harness.HarnessId, new ProjectCommandEnvelope(Guid.NewGuid(), 1),
            placementId, template, article.SourceId, article.EntityType, article.ArticleKey, instance));
        Assert.Equal("design_revision_conflict", stale.Code);
        Assert.Empty(store.ListSnapshots(project.ProjectId));
        Assert.Empty(store.ListPlacements(project.ProjectId, harness.HarnessId));

        _ = store.Place(project.ProjectId, harness.HarnessId, new ProjectCommandEnvelope(Guid.NewGuid(), 0),
            placementId, template, article.SourceId, article.EntityType, article.ArticleKey, instance);
        var duplicate = Assert.Throws<ProjectComponentSnapshotException>(() => store.Place(
            project.ProjectId, harness.HarnessId, new ProjectCommandEnvelope(Guid.NewGuid(), 1),
            placementId, template, article.SourceId, article.EntityType, article.ArticleKey, instance));
        Assert.Equal("component_placement_id_conflict", duplicate.Code);
        Assert.Single(store.ListPlacements(project.ProjectId, harness.HarnessId));
        Assert.Equal(1, new SqliteHarnessDesignDocumentStore(storage, TimeProvider.System)
            .Get(project.ProjectId, harness.HarnessId).Revision);
    }

    [Fact]
    public void Placement_id_must_equal_instance_uuid_and_failure_does_not_mutate_project()
    {
        using var fixture = PlacementFixture.Create();
        var placementId = Guid.NewGuid();
        var tampered = JsonNode.Parse(BoundInstance(
            Guid.NewGuid(), fixture.Template, fixture.Article, "X1"))!.AsObject();

        var error = Assert.Throws<ProjectComponentSnapshotException>(() => fixture.Store.Place(
            fixture.Project.ProjectId,
            fixture.Harness.HarnessId,
            new ProjectCommandEnvelope(Guid.NewGuid(), 0),
            placementId,
            fixture.Template,
            fixture.Article.SourceId,
            fixture.Article.EntityType,
            fixture.Article.ArticleKey,
            tampered.ToJsonString()));

        Assert.Equal("component_placement_invalid", error.Code);
        Assert.Equal("instance.id", error.Field);
        fixture.AssertUnchanged();
    }

    [Fact]
    public void Placement_rejects_tampered_library_version_hash_and_does_not_mutate_project()
    {
        using var fixture = PlacementFixture.Create();
        var placementId = Guid.NewGuid();
        var tampered = JsonNode.Parse(BoundInstance(
            placementId, fixture.Template, fixture.Article, "X1"))!.AsObject();
        tampered["libraryBinding"]!["versionSha256"] = new string('0', 64);

        var error = Assert.Throws<ProjectComponentSnapshotException>(() => fixture.Store.Place(
            fixture.Project.ProjectId,
            fixture.Harness.HarnessId,
            new ProjectCommandEnvelope(Guid.NewGuid(), 0),
            placementId,
            fixture.Template,
            fixture.Article.SourceId,
            fixture.Article.EntityType,
            fixture.Article.ArticleKey,
            tampered.ToJsonString()));

        Assert.Equal("component_placement_binding_mismatch", error.Code);
        Assert.Equal("instance.libraryBinding.versionSha256", error.Field);
        fixture.AssertUnchanged();
    }

    [Fact]
    public void Placement_rejects_tampered_bound_article_and_does_not_mutate_project()
    {
        using var fixture = PlacementFixture.Create();
        var placementId = Guid.NewGuid();
        var tampered = JsonNode.Parse(BoundInstance(
            placementId, fixture.Template, fixture.Article, "X1"))!.AsObject();
        tampered["libraryBinding"]!["article"]!["articleKey"] = "ANOTHER-ARTICLE";

        var error = Assert.Throws<ProjectComponentSnapshotException>(() => fixture.Store.Place(
            fixture.Project.ProjectId,
            fixture.Harness.HarnessId,
            new ProjectCommandEnvelope(Guid.NewGuid(), 0),
            placementId,
            fixture.Template,
            fixture.Article.SourceId,
            fixture.Article.EntityType,
            fixture.Article.ArticleKey,
            tampered.ToJsonString()));

        Assert.Equal("component_placement_binding_mismatch", error.Code);
        Assert.Equal("instance.libraryBinding.article.articleKey", error.Field);
        fixture.AssertUnchanged();
    }

    [Fact]
    public void Ordinary_design_save_updates_and_removes_live_placement_without_stale_list_rows()
    {
        using var fixture = PlacementFixture.Create();
        var placementId = Guid.NewGuid();
        var instance = BoundInstance(placementId, fixture.Template, fixture.Article, "X1");
        _ = fixture.Store.Place(
            fixture.Project.ProjectId,
            fixture.Harness.HarnessId,
            new ProjectCommandEnvelope(Guid.NewGuid(), 0),
            placementId,
            fixture.Template,
            fixture.Article.SourceId,
            fixture.Article.EntityType,
            fixture.Article.ArticleKey,
            instance);
        var designs = new SqliteHarnessDesignDocumentStore(fixture.Storage, TimeProvider.System);
        var placed = designs.Get(fixture.Project.ProjectId, fixture.Harness.HarnessId);
        var moved = JsonNode.Parse(placed.ContentJson)!.AsObject();
        moved["connectors"]![0]!["designation"] = "X1-MOVED";

        var updated = designs.Put(
            fixture.Project.ProjectId,
            fixture.Harness.HarnessId,
            placed.Revision,
            placed.SchemaVersion,
            moved.ToJsonString());

        var listed = Assert.Single(fixture.Store.ListPlacements(
            fixture.Project.ProjectId, fixture.Harness.HarnessId));
        using (var stored = JsonDocument.Parse(listed.InstanceJson))
            Assert.Equal("X1-MOVED", stored.RootElement.GetProperty("designation").GetString());

        var withoutConnector = JsonNode.Parse(updated.ContentJson)!.AsObject();
        withoutConnector["connectors"] = new JsonArray();
        _ = designs.Put(
            fixture.Project.ProjectId,
            fixture.Harness.HarnessId,
            updated.Revision,
            updated.SchemaVersion,
            withoutConnector.ToJsonString());

        Assert.Empty(fixture.Store.ListPlacements(
            fixture.Project.ProjectId, fixture.Harness.HarnessId));
    }

    [Fact]
    public void Ordinary_design_save_remaps_article_within_the_same_snapshot()
    {
        using var files = Fixture.Create();
        using var storage = SqliteStorage.Open(files.DataRoot);
        var catalog = new SqliteProjectCatalog(storage);
        var project = catalog.CreateProject(new CreateProjectCommand("P", "Project", 1, ProjectStatus.Draft));
        var harness = catalog.AddHarness(project.ProjectId, "W1").Harnesses.Single();
        var content = JsonNode.Parse(ComponentTemplateContentV3ValidatorTests.ValidContentJson)!.AsObject();
        var first = ComponentTemplateContentV3ValidatorTests.ValidArticleBindings.Single();
        var second = new ComponentTemplateArticleBinding(first.SourceId, first.EntityType, "B3B-XH-A");
        var secondVariant = content["articleVariants"]![0]!.DeepClone().AsObject();
        secondVariant["id"] = "20000000-0000-4000-8000-000000000004";
        secondVariant["articleKey"] = second.ArticleKey;
        content["articleVariants"]!.AsArray().Add(secondVariant);
        var template = new SqliteComponentTemplateStore(storage, TimeProvider.System).Create(
            "XH", "XH series", [first, second], 3, content.ToJsonString());
        var snapshots = new SqliteProjectComponentSnapshotStore(storage, TimeProvider.System);
        var placementId = Guid.NewGuid();
        _ = snapshots.Place(
            project.ProjectId, harness.HarnessId, new ProjectCommandEnvelope(Guid.NewGuid(), 0),
            placementId, template, first.SourceId, first.EntityType, first.ArticleKey,
            BoundInstance(placementId, template, first, "X1"));
        var designs = new SqliteHarnessDesignDocumentStore(storage, TimeProvider.System);
        var before = designs.Get(project.ProjectId, harness.HarnessId);
        var changed = JsonNode.Parse(before.ContentJson)!.AsObject();
        changed["connectors"]![0]!["partNumber"] = second.ArticleKey;
        changed["connectors"]![0]!["libraryBinding"]!["article"] = new JsonObject
        {
            ["sourceId"] = second.SourceId,
            ["entityType"] = second.EntityType,
            ["articleKey"] = second.ArticleKey,
        };

        _ = designs.Put(project.ProjectId, harness.HarnessId, before.Revision, before.SchemaVersion, changed.ToJsonString());

        var remapped = Assert.Single(snapshots.ListPlacements(project.ProjectId, harness.HarnessId));
        Assert.Equal(second.ArticleKey, remapped.ArticleKey);
        using var stored = JsonDocument.Parse(remapped.InstanceJson);
        Assert.Equal(second.ArticleKey, stored.RootElement.GetProperty("partNumber").GetString());
    }

    [Fact]
    public void Ordinary_design_save_rejects_tampered_or_unregistered_template_binding_atomically()
    {
        using var fixture = PlacementFixture.Create();
        var placementId = Guid.NewGuid();
        var instance = BoundInstance(placementId, fixture.Template, fixture.Article, "X1");
        _ = fixture.Store.Place(
            fixture.Project.ProjectId,
            fixture.Harness.HarnessId,
            new ProjectCommandEnvelope(Guid.NewGuid(), 0),
            placementId,
            fixture.Template,
            fixture.Article.SourceId,
            fixture.Article.EntityType,
            fixture.Article.ArticleKey,
            instance);
        var designs = new SqliteHarnessDesignDocumentStore(fixture.Storage, TimeProvider.System);
        var before = designs.Get(fixture.Project.ProjectId, fixture.Harness.HarnessId);
        var tampered = JsonNode.Parse(before.ContentJson)!.AsObject();
        tampered["connectors"]![0]!["libraryBinding"]!["versionSha256"] = new string('0', 64);

        var error = Assert.Throws<HarnessDesignDocumentException>(() => designs.Put(
            fixture.Project.ProjectId,
            fixture.Harness.HarnessId,
            before.Revision,
            before.SchemaVersion,
            tampered.ToJsonString()));

        Assert.Equal("component_placement_binding_mismatch", error.Code);
        var after = designs.Get(fixture.Project.ProjectId, fixture.Harness.HarnessId);
        Assert.Equal(before.Revision, after.Revision);
        Assert.Equal(before.ContentJson, after.ContentJson);
    }

    private static string BoundInstance(
        Guid placementId,
        ComponentTemplateVersion template,
        ComponentTemplateArticleBinding article,
        string designation) => new JsonObject
    {
        ["id"] = placementId.ToString("D"),
        ["designation"] = designation,
        ["partNumber"] = article.ArticleKey,
        ["contacts"] = new JsonArray(),
        ["libraryBinding"] = new JsonObject
        {
            ["mode"] = "template",
            ["templateId"] = template.TemplateId.ToString("D"),
            ["templateVersion"] = template.Version,
            ["versionSha256"] = template.VersionSha256,
            ["article"] = new JsonObject
            {
                ["sourceId"] = article.SourceId,
                ["entityType"] = article.EntityType,
                ["articleKey"] = article.ArticleKey,
            },
        },
    }.ToJsonString();

    private sealed class PlacementFixture : IDisposable
    {
        private PlacementFixture(
            Fixture files,
            SqliteStorage storage,
            ProjectDetails project,
            HarnessSummary harness,
            ComponentTemplateVersion template,
            ComponentTemplateArticleBinding article,
            SqliteProjectComponentSnapshotStore store)
        {
            Files = files;
            Storage = storage;
            Project = project;
            Harness = harness;
            Template = template;
            Article = article;
            Store = store;
        }

        public Fixture Files { get; }
        public SqliteStorage Storage { get; }
        public ProjectDetails Project { get; }
        public HarnessSummary Harness { get; }
        public ComponentTemplateVersion Template { get; }
        public ComponentTemplateArticleBinding Article { get; }
        public SqliteProjectComponentSnapshotStore Store { get; }

        public static PlacementFixture Create()
        {
            var files = Fixture.Create();
            var storage = SqliteStorage.Open(files.DataRoot);
            var catalog = new SqliteProjectCatalog(storage);
            var project = catalog.CreateProject(new CreateProjectCommand("P", "Project", 1, ProjectStatus.Draft));
            var harness = catalog.AddHarness(project.ProjectId, "W1").Harnesses.Single();
            var article = ComponentTemplateContentV3ValidatorTests.ValidArticleBindings.Single();
            var template = new SqliteComponentTemplateStore(storage, TimeProvider.System).Create(
                "XH", "XH series", [article], 3, ComponentTemplateContentV3ValidatorTests.ValidContentJson);
            return new PlacementFixture(
                files, storage, project, harness, template, article,
                new SqliteProjectComponentSnapshotStore(storage, TimeProvider.System));
        }

        public void AssertUnchanged()
        {
            Assert.Empty(Store.ListSnapshots(Project.ProjectId));
            Assert.Empty(Store.ListPlacements(Project.ProjectId, Harness.HarnessId));
            Assert.Equal(0, new SqliteHarnessDesignDocumentStore(Storage, TimeProvider.System)
                .Get(Project.ProjectId, Harness.HarnessId).Revision);
        }

        public void Dispose()
        {
            Storage.Dispose();
            Files.Dispose();
        }
    }

    private sealed class Fixture : IDisposable
    {
        private Fixture(string root) { Root = root; DataRoot = Path.Combine(root, "data"); }
        public string Root { get; }
        public string DataRoot { get; }
        public static Fixture Create() => new(Path.Combine(Path.GetTempPath(), "techmap-m3-snapshot-" + Guid.NewGuid().ToString("N")));
        public void Dispose() { if (Directory.Exists(Root)) Directory.Delete(Root, true); }
    }
}
