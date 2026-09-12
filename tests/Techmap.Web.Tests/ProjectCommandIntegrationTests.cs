using Microsoft.Data.Sqlite;
using Techmap.Application;
using Techmap.Domain;
using Techmap.Infrastructure.Sqlite;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class ProjectCommandIntegrationTests
{
    [Fact]
    public void Maximum_revision_is_rejected_before_the_project_mutation()
    {
        using var fixture = CommandFixture.Create();
        using var storage = SqliteStorage.Open(fixture.DataRoot);
        var catalog = new SqliteProjectCatalog(storage);
        var project = CreateProject(catalog);
        storage.ExecuteInTransaction(unitOfWork =>
        {
            using var update = unitOfWork.CreateCommand(
                "UPDATE projects SET revision = $revision WHERE project_id = $projectId;");
            update.Parameters.AddWithValue("$revision", long.MaxValue);
            update.Parameters.AddWithValue("$projectId", project.ProjectId.Value.ToString("D"));
            update.ExecuteNonQuery();
        });

        var error = Assert.Throws<ProjectCommandException>(() => catalog.AddHarness(
            project.ProjectId,
            new ProjectCommandEnvelope(Guid.NewGuid(), long.MaxValue),
            "Не сохранится"));

        Assert.Equal("revision_limit_reached", error.Code);
        Assert.Equal(long.MaxValue, error.CurrentRevision);
        Assert.Empty(catalog.GetProject(project.ProjectId).Harnesses);
        Assert.Empty(catalog.ListVersions(project.ProjectId));
        Assert.Equal(0, CountCommandRows(storage, project.ProjectId));
    }

    [Fact]
    public void Same_command_id_and_payload_replays_the_original_ack_before_stale_check()
    {
        using var fixture = CommandFixture.Create();
        using var storage = SqliteStorage.Open(fixture.DataRoot);
        var catalog = new SqliteProjectCatalog(storage);
        var project = CreateProject(catalog);
        var commandId = Guid.NewGuid();
        var envelope = new ProjectCommandEnvelope(commandId, 0);

        var first = catalog.AddHarness(project.ProjectId, envelope, "Жгут 1");
        var replay = catalog.AddHarness(project.ProjectId, envelope, " Жгут 1 ");

        AssertAckEqual(first, replay);
        Assert.Equal(1, first.ResultingRevision);
        Assert.Single(first.Value.Harnesses);
        Assert.Single(catalog.GetProject(project.ProjectId).Harnesses);
        Assert.Collection(
            catalog.ListVersions(project.ProjectId),
            version =>
            {
                Assert.Equal(1, version.Revision);
                Assert.Equal(commandId, version.CommandId);
                Assert.Equal("add_harness", version.CommandType);
            });
    }

    [Fact]
    public void Canonically_equivalent_unicode_replays_the_same_command()
    {
        using var fixture = CommandFixture.Create();
        using var storage = SqliteStorage.Open(fixture.DataRoot);
        var catalog = new SqliteProjectCatalog(storage);
        var project = CreateProject(catalog);
        var envelope = new ProjectCommandEnvelope(Guid.NewGuid(), 0);
        const string composed = "Жгут ёлка";
        const string decomposed = "Жгут е\u0308лка";

        var first = catalog.AddHarness(project.ProjectId, envelope, decomposed);
        var replay = catalog.AddHarness(project.ProjectId, envelope, composed);

        AssertAckEqual(first, replay);
        Assert.Equal(composed, Assert.Single(replay.Value.Harnesses).Designation);
    }

    [Fact]
    public void Reusing_a_command_id_with_changed_payload_does_not_mutate_project()
    {
        using var fixture = CommandFixture.Create();
        using var storage = SqliteStorage.Open(fixture.DataRoot);
        var catalog = new SqliteProjectCatalog(storage);
        var project = CreateProject(catalog);
        var envelope = new ProjectCommandEnvelope(Guid.NewGuid(), 0);
        catalog.UpdateProject(project.ProjectId, envelope, new UpdateProjectCommand(Name: "Первое имя"));

        var error = Assert.Throws<ProjectCommandException>(() =>
            catalog.UpdateProject(project.ProjectId, envelope, new UpdateProjectCommand(Name: "Другое имя")));

        Assert.Equal("command_id_reused", error.Code);
        Assert.Equal(1, catalog.GetProject(project.ProjectId).Revision);
        Assert.Equal("Первое имя", catalog.GetProject(project.ProjectId).Name);
        Assert.Single(catalog.ListVersions(project.ProjectId));
    }

    [Fact]
    public void Reusing_a_command_id_with_a_different_expected_revision_is_conflict()
    {
        using var fixture = CommandFixture.Create();
        using var storage = SqliteStorage.Open(fixture.DataRoot);
        var catalog = new SqliteProjectCatalog(storage);
        var project = CreateProject(catalog);
        var commandId = Guid.NewGuid();
        catalog.AddHarness(project.ProjectId, new ProjectCommandEnvelope(commandId, 0), "Жгут 1");

        var error = Assert.Throws<ProjectCommandException>(() =>
            catalog.AddHarness(project.ProjectId, new ProjectCommandEnvelope(commandId, 1), "Жгут 1"));

        Assert.Equal("command_id_reused", error.Code);
        Assert.Equal(1, catalog.GetProject(project.ProjectId).Revision);
        Assert.Single(catalog.GetProject(project.ProjectId).Harnesses);
    }

    [Fact]
    public void Stale_new_command_id_returns_current_revision_without_writing_journal()
    {
        using var fixture = CommandFixture.Create();
        using var storage = SqliteStorage.Open(fixture.DataRoot);
        var catalog = new SqliteProjectCatalog(storage);
        var project = CreateProject(catalog);
        catalog.UpdateProject(
            project.ProjectId,
            new ProjectCommandEnvelope(Guid.NewGuid(), 0),
            new UpdateProjectCommand(Name: "Актуальное имя"));

        var error = Assert.Throws<ProjectCommandException>(() =>
            catalog.UpdateProject(
                project.ProjectId,
                new ProjectCommandEnvelope(Guid.NewGuid(), 0),
                new UpdateProjectCommand(Name: "Устаревшее имя")));

        Assert.Equal("revision_conflict", error.Code);
        Assert.Equal(1, error.CurrentRevision);
        Assert.Equal("Актуальное имя", catalog.GetProject(project.ProjectId).Name);
        Assert.Single(catalog.ListVersions(project.ProjectId));
    }

    [Fact]
    public void Failure_during_version_insert_rolls_back_model_revision_and_command_journal()
    {
        using var fixture = CommandFixture.Create();
        using var storage = SqliteStorage.Open(fixture.DataRoot);
        var catalog = new SqliteProjectCatalog(storage);
        var original = CreateProject(catalog);
        storage.ExecuteInTransaction(unitOfWork =>
        {
            using var trigger = unitOfWork.CreateCommand(
                """
                CREATE TRIGGER fail_project_version_integration_test
                BEFORE INSERT ON project_versions
                BEGIN
                    SELECT RAISE(ABORT, 'forced_version_failure');
                END;
                """);
            trigger.ExecuteNonQuery();
        });

        var commandId = Guid.NewGuid();
        var error = Assert.Throws<SqliteException>(() =>
            catalog.AddHarness(
                original.ProjectId,
                new ProjectCommandEnvelope(commandId, 0),
                "Не должен сохраниться"));

        Assert.Contains("forced_version_failure", error.Message, StringComparison.Ordinal);
        Assert.Equal(0, catalog.GetProject(original.ProjectId).Revision);
        Assert.Empty(catalog.GetProject(original.ProjectId).Harnesses);
        Assert.Empty(catalog.ListVersions(original.ProjectId));
        Assert.Equal(0, CountCommandRows(storage, original.ProjectId));
    }

    [Fact]
    public void Accepted_commands_have_strictly_ordered_revisions_and_versions()
    {
        using var fixture = CommandFixture.Create();
        using var storage = SqliteStorage.Open(fixture.DataRoot);
        var catalog = new SqliteProjectCatalog(storage);
        var project = CreateProject(catalog);
        Assert.Equal(0, project.Revision);
        Assert.Empty(catalog.ListVersions(project.ProjectId));

        var firstId = Guid.NewGuid();
        var first = catalog.AddHarness(
            project.ProjectId,
            new ProjectCommandEnvelope(firstId, 0),
            "Жгут А");
        var secondId = Guid.NewGuid();
        var second = catalog.UpdateProject(
            project.ProjectId,
            new ProjectCommandEnvelope(secondId, 1),
            new UpdateProjectCommand(BatchQuantity: 17));
        var thirdId = Guid.NewGuid();
        var third = catalog.DeleteHarness(
            project.ProjectId,
            new ProjectCommandEnvelope(thirdId, 2),
            first.Value.Harnesses[0].HarnessId);

        Assert.Equal([1L, 2L, 3L], new[]
        {
            first.ResultingRevision,
            second.ResultingRevision,
            third.ResultingRevision,
        });
        Assert.Equal(3, catalog.GetProject(project.ProjectId).Revision);
        Assert.Equal(17, catalog.GetProject(project.ProjectId).BatchQuantity);
        Assert.Empty(catalog.GetProject(project.ProjectId).Harnesses);
        Assert.Equal(
            [(1L, firstId, "add_harness"),
             (2L, secondId, "update_project"),
             (3L, thirdId, "delete_harness")],
            catalog.ListVersions(project.ProjectId).Select(version =>
                (version.Revision, version.CommandId, version.CommandType)));
    }

    [Fact]
    public void Acknowledged_result_replays_after_storage_restart()
    {
        using var fixture = CommandFixture.Create();
        ProjectIdentity projectId;
        ProjectMutationResult<ProjectDetails> acknowledged;
        using (var storage = SqliteStorage.Open(fixture.DataRoot))
        {
            var catalog = new SqliteProjectCatalog(storage);
            projectId = CreateProject(catalog).ProjectId;
            acknowledged = catalog.AddHarness(
                projectId,
                new ProjectCommandEnvelope(Guid.NewGuid(), 0),
                "Жгут после рестарта");
        }

        using var reopenedStorage = SqliteStorage.Open(fixture.DataRoot);
        var reopened = new SqliteProjectCatalog(reopenedStorage);
        var loaded = reopened.GetProject(projectId);
        var replay = reopened.AddHarness(
            projectId,
            new ProjectCommandEnvelope(acknowledged.CommandId, acknowledged.ExpectedRevision),
            "Жгут после рестарта");

        Assert.Equal(1, loaded.Revision);
        AssertAckEqual(acknowledged, replay);
        Assert.Single(reopened.ListVersions(projectId));
        Assert.Equal(1, CountCommandRows(reopenedStorage, projectId));
    }

    [Fact]
    public async Task Concurrent_writers_at_one_expected_revision_allow_exactly_one_commit()
    {
        using var fixture = CommandFixture.Create();
        using var storage = SqliteStorage.Open(fixture.DataRoot);
        var catalog = new SqliteProjectCatalog(storage);
        var projectId = CreateProject(catalog).ProjectId;
        using var start = new ManualResetEventSlim(false);

        var first = Task.Run(() => TryAdd(catalog, projectId, "А", start));
        var second = Task.Run(() => TryAdd(catalog, projectId, "Б", start));
        start.Set();
        var outcomes = await Task.WhenAll(first, second);

        Assert.Single(outcomes, outcome => outcome.Result is not null);
        var conflict = Assert.Single(outcomes, outcome => outcome.Error is not null).Error!;
        Assert.Equal("revision_conflict", conflict.Code);
        Assert.Equal(1, conflict.CurrentRevision);
        Assert.Equal(1, catalog.GetProject(projectId).Revision);
        Assert.Single(catalog.GetProject(projectId).Harnesses);
        Assert.Single(catalog.ListVersions(projectId));
        Assert.Equal(1, CountCommandRows(storage, projectId));
    }

    private static ProjectDetails CreateProject(IProjectCatalog catalog) => catalog.CreateProject(
        new CreateProjectCommand("ПР-КОМ", "Командный проект", 10, ProjectStatus.Draft));

    private static (ProjectMutationResult<ProjectDetails>? Result, ProjectCommandException? Error) TryAdd(
        IProjectCatalog catalog,
        ProjectIdentity projectId,
        string designation,
        ManualResetEventSlim start)
    {
        start.Wait(TestContext.Current.CancellationToken);
        try
        {
            return (catalog.AddHarness(
                projectId,
                new ProjectCommandEnvelope(Guid.NewGuid(), 0),
                designation), null);
        }
        catch (ProjectCommandException error)
        {
            return (null, error);
        }
    }

    private static int CountCommandRows(SqliteStorage storage, ProjectIdentity projectId) =>
        storage.ExecuteRead(unitOfWork =>
        {
            using var command = unitOfWork.CreateCommand(
                "SELECT COUNT(*) FROM project_commands WHERE project_id = $projectId;");
            command.Parameters.AddWithValue("$projectId", projectId.Value.ToString("D"));
            return Convert.ToInt32(command.ExecuteScalar(), System.Globalization.CultureInfo.InvariantCulture);
        });

    private static void AssertAckEqual(
        ProjectMutationResult<ProjectDetails> expected,
        ProjectMutationResult<ProjectDetails> actual)
    {
        Assert.Equal(expected.CommandId, actual.CommandId);
        Assert.Equal(expected.ExpectedRevision, actual.ExpectedRevision);
        Assert.Equal(expected.ResultingRevision, actual.ResultingRevision);
        Assert.Equal(expected.Value.ProjectId, actual.Value.ProjectId);
        Assert.Equal(expected.Value.Revision, actual.Value.Revision);
        Assert.Equal(expected.Value.Name, actual.Value.Name);
        Assert.Equal(expected.Value.BatchQuantity, actual.Value.BatchQuantity);
        Assert.Equal(expected.Value.UpdatedUtc, actual.Value.UpdatedUtc);
        Assert.Equal(
            expected.Value.Harnesses.Select(harness => new
            {
                harness.HarnessId,
                harness.Designation,
                harness.SortOrder,
                harness.CreatedUtc,
                harness.UpdatedUtc,
            }),
            actual.Value.Harnesses.Select(harness => new
            {
                harness.HarnessId,
                harness.Designation,
                harness.SortOrder,
                harness.CreatedUtc,
                harness.UpdatedUtc,
            }));
    }

    private sealed class CommandFixture : IDisposable
    {
        private CommandFixture(string root)
        {
            Root = root;
            DataRoot = Path.Combine(root, "data-root");
        }

        public string Root { get; }

        public string DataRoot { get; }

        public static CommandFixture Create()
        {
            var root = Path.Combine(
                Path.GetTempPath(),
                "techmap-project-command-tests",
                Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(root);
            return new CommandFixture(root);
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
