using Techmap.Application;
using Techmap.Domain;
using Techmap.Infrastructure.Sqlite;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class ProjectCatalogIntegrationTests
{
    [Fact]
    public void Two_harnesses_keep_their_ids_and_order_after_restart()
    {
        using var fixture = ProjectCatalogFixture.Create();
        ProjectIdentity projectId;
        HarnessSummary[] expectedHarnesses;
        using (var storage = SqliteStorage.Open(fixture.DataRoot))
        {
            var catalog = new SqliteProjectCatalog(storage);
            var project = catalog.CreateProject(CreateCommand("КС-01", batchQuantity: 24));
            projectId = project.ProjectId;
            catalog.AddHarness(projectId, "Жгут силовой");
            expectedHarnesses = catalog.AddHarness(projectId, "Жгут сигнальный")
                .Harnesses
                .ToArray();
        }

        using var reopenedStorage = SqliteStorage.Open(fixture.DataRoot);
        var reopened = new SqliteProjectCatalog(reopenedStorage).GetProject(projectId);

        Assert.Collection(
            reopened.Harnesses,
            harness => AssertHarnessEqual(expectedHarnesses[0], harness),
            harness => AssertHarnessEqual(expectedHarnesses[1], harness));
        Assert.Equal([0, 1], reopened.Harnesses.Select(harness => harness.SortOrder));
        Assert.Equal(24, reopened.BatchQuantity);
        Assert.Equal(ProjectStatus.Draft, reopened.Status);
    }

    [Fact]
    public void One_hundred_harnesses_are_allowed_and_the_next_command_is_atomic()
    {
        using var fixture = ProjectCatalogFixture.Create();
        using var storage = SqliteStorage.Open(fixture.DataRoot);
        var catalog = new SqliteProjectCatalog(storage);
        var project = catalog.CreateProject(CreateCommand("ПР-100"));

        for (var index = 0; index < ProjectRules.MaximumHarnesses; index++)
        {
            catalog.AddHarness(project.ProjectId, $"Ж{index + 1:000}");
        }

        var before = catalog.GetProject(project.ProjectId);
        var error = Assert.Throws<ProjectCatalogException>(() =>
            catalog.AddHarness(project.ProjectId, "Лишний жгут"));
        var after = catalog.GetProject(project.ProjectId);

        Assert.Equal("harness_limit_reached", error.Code);
        Assert.Equal(ProjectRules.MaximumHarnesses, after.Harnesses.Count);
        Assert.Equal(
            before.Harnesses.Select(HarnessSnapshot),
            after.Harnesses.Select(HarnessSnapshot));
        Assert.Equal(before.UpdatedUtc, after.UpdatedUtc);
    }

    [Fact]
    public async Task Concurrent_adds_at_the_limit_commit_exactly_one_harness()
    {
        using var fixture = ProjectCatalogFixture.Create();
        using var storage = SqliteStorage.Open(fixture.DataRoot);
        var catalog = new SqliteProjectCatalog(storage);
        var project = catalog.CreateProject(CreateCommand("ПР-КОНК"));
        for (var index = 0; index < ProjectRules.MaximumHarnesses - 1; index++)
        {
            catalog.AddHarness(project.ProjectId, $"Ж{index + 1:000}");
        }

        using var start = new ManualResetEventSlim(false);
        var first = Task.Run(() => TryAddHarness(catalog, project.ProjectId, "Ж100-А", start));
        var second = Task.Run(() => TryAddHarness(catalog, project.ProjectId, "Ж100-Б", start));
        start.Set();
        var outcomes = await Task.WhenAll(first, second);

        var stored = catalog.GetProject(project.ProjectId);
        Assert.Single(outcomes, outcome => outcome is null);
        Assert.Single(outcomes, outcome => outcome?.Code == "harness_limit_reached");
        Assert.Equal(ProjectRules.MaximumHarnesses, stored.Harnesses.Count);
        Assert.Equal(
            ProjectRules.MaximumHarnesses,
            stored.Harnesses.Select(harness => harness.HarnessId).Distinct().Count());
        Assert.Equal(
            Enumerable.Range(0, ProjectRules.MaximumHarnesses),
            stored.Harnesses.Select(harness => harness.SortOrder));
    }

    [Fact]
    public async Task Concurrent_project_creation_allocates_distinct_monotonic_increments()
    {
        using var fixture = ProjectCatalogFixture.Create();
        using var storage = SqliteStorage.Open(fixture.DataRoot);
        var catalog = new SqliteProjectCatalog(storage);
        using var start = new ManualResetEventSlim(false);

        var first = Task.Run(() => CreateAfterSignal(catalog, "ПР-А", start));
        var second = Task.Run(() => CreateAfterSignal(catalog, "ПР-Б", start));
        start.Set();
        var created = await Task.WhenAll(first, second);

        Assert.Equal(2, created.Select(project => project.ProjectId).Distinct().Count());
        Assert.Equal([1L, 2L], created.Select(project => project.Increment).Order());
        Assert.Equal(
            [2L, 1L],
            catalog.ListProjects().Select(project => project.Increment));
    }

    [Fact]
    public void Copy_gets_fresh_ids_and_does_not_change_the_source()
    {
        using var fixture = ProjectCatalogFixture.Create();
        using var storage = SqliteStorage.Open(fixture.DataRoot);
        var catalog = new SqliteProjectCatalog(storage);
        var source = catalog.CreateProject(new CreateProjectCommand(
            "ПР-КОП",
            "Повторный выпуск",
            33,
            ProjectStatus.Completed));
        catalog.AddHarness(source.ProjectId, "Жгут А");
        var before = catalog.AddHarness(source.ProjectId, "Жгут Б");

        var copy = catalog.CopyProject(source.ProjectId);
        var sourceAfter = catalog.GetProject(source.ProjectId);

        Assert.NotEqual(before.ProjectId, copy.ProjectId);
        Assert.True(copy.Increment > before.Increment);
        Assert.Equal(ProjectStatus.Active, copy.Status);
        Assert.Equal(before.Designation, copy.Designation);
        Assert.Equal(before.Name, copy.Name);
        Assert.Equal(before.BatchQuantity, copy.BatchQuantity);
        Assert.Equal(
            before.Harnesses.Select(harness => (harness.Designation, harness.SortOrder)),
            copy.Harnesses.Select(harness => (harness.Designation, harness.SortOrder)));
        Assert.Empty(
            before.Harnesses.Select(harness => harness.HarnessId)
                .Intersect(copy.Harnesses.Select(harness => harness.HarnessId)));
        AssertProjectEqual(before, sourceAfter);
    }

    [Fact]
    public void Delete_removes_only_the_selected_harness_and_preserves_order_on_restart()
    {
        using var fixture = ProjectCatalogFixture.Create();
        ProjectIdentity projectId;
        HarnessIdentity deletedId;
        HarnessSummary[] expected;
        using (var storage = SqliteStorage.Open(fixture.DataRoot))
        {
            var catalog = new SqliteProjectCatalog(storage);
            projectId = catalog.CreateProject(CreateCommand("ПР-УД")).ProjectId;
            catalog.AddHarness(projectId, "Жгут 1");
            var all = catalog.AddHarness(projectId, "Жгут 2");
            all = catalog.AddHarness(projectId, "Жгут 3");
            deletedId = all.Harnesses[1].HarnessId;
            expected = [all.Harnesses[0], all.Harnesses[2]];

            var remaining = catalog.DeleteHarness(projectId, deletedId);
            Assert.Equal([0, 2], remaining.Harnesses.Select(harness => harness.SortOrder));

            var repeated = Assert.Throws<ProjectCatalogException>(() =>
                catalog.DeleteHarness(projectId, deletedId));
            Assert.Equal("harness_not_found", repeated.Code);
        }

        using var reopenedStorage = SqliteStorage.Open(fixture.DataRoot);
        var reopened = new SqliteProjectCatalog(reopenedStorage).GetProject(projectId);
        Assert.Equal(expected.Select(HarnessSnapshot), reopened.Harnesses.Select(HarnessSnapshot));
    }

    private static CreateProjectCommand CreateCommand(string designation, long batchQuantity = 1) =>
        new(designation, $"Проект {designation}", batchQuantity, ProjectStatus.Draft);

    private static ProjectDetails CreateAfterSignal(
        IProjectCatalog catalog,
        string designation,
        ManualResetEventSlim start)
    {
        start.Wait(TestContext.Current.CancellationToken);
        return catalog.CreateProject(CreateCommand(designation));
    }

    private static ProjectCatalogException? TryAddHarness(
        IProjectCatalog catalog,
        ProjectIdentity projectId,
        string designation,
        ManualResetEventSlim start)
    {
        start.Wait(TestContext.Current.CancellationToken);
        try
        {
            catalog.AddHarness(projectId, designation);
            return null;
        }
        catch (ProjectCatalogException error)
        {
            return error;
        }
    }

    private static object HarnessSnapshot(HarnessSummary harness) =>
        new
        {
            harness.HarnessId,
            harness.Designation,
            harness.SortOrder,
            harness.CreatedUtc,
            harness.UpdatedUtc,
        };

    private static void AssertHarnessEqual(HarnessSummary expected, HarnessSummary actual)
    {
        Assert.Equal(expected.HarnessId, actual.HarnessId);
        Assert.Equal(expected.Designation, actual.Designation);
        Assert.Equal(expected.SortOrder, actual.SortOrder);
        Assert.Equal(expected.CreatedUtc, actual.CreatedUtc);
        Assert.Equal(expected.UpdatedUtc, actual.UpdatedUtc);
    }

    private static void AssertProjectEqual(ProjectDetails expected, ProjectDetails actual)
    {
        Assert.Equal(expected.ProjectId, actual.ProjectId);
        Assert.Equal(expected.Designation, actual.Designation);
        Assert.Equal(expected.Increment, actual.Increment);
        Assert.Equal(expected.Name, actual.Name);
        Assert.Equal(expected.BatchQuantity, actual.BatchQuantity);
        Assert.Equal(expected.Status, actual.Status);
        Assert.Equal(expected.CreatedUtc, actual.CreatedUtc);
        Assert.Equal(expected.UpdatedUtc, actual.UpdatedUtc);
        Assert.Equal(
            expected.Harnesses.Select(HarnessSnapshot),
            actual.Harnesses.Select(HarnessSnapshot));
    }

    private sealed class ProjectCatalogFixture : IDisposable
    {
        private ProjectCatalogFixture(string root)
        {
            Root = root;
            DataRoot = Path.Combine(root, "data-root");
        }

        public string Root { get; }

        public string DataRoot { get; }

        public static ProjectCatalogFixture Create()
        {
            var root = Path.Combine(
                Path.GetTempPath(),
                "techmap-project-catalog-tests",
                Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(root);
            return new ProjectCatalogFixture(root);
        }

        public void Dispose()
        {
            if (Directory.Exists(Root))
            {
                Directory.Delete(Root, recursive: true);
            }
        }
    }
}
