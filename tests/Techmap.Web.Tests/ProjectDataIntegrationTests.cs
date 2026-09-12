using System.Security.Cryptography;
using System.Text;
using Microsoft.Data.Sqlite;
using Techmap.Application;
using Techmap.Domain;
using Techmap.Infrastructure.Sqlite;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class ProjectDataIntegrationTests
{
    private static readonly DateTimeOffset CapturedUtc =
        new(2026, 9, 12, 12, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task Equal_attachment_content_is_stored_once_while_references_remain_distinct()
    {
        using var fixture = Fixture.Create();
        var bytes = Encoding.UTF8.GetBytes("одинаковое содержимое");
        ProjectIdentity projectId;
        ProjectAttachment first;
        ProjectAttachment second;

        using (var storage = SqliteStorage.Open(fixture.DataRoot))
        {
            projectId = CreateProject(storage);
            var catalog = AttachmentCatalog(storage, fixture.DataRoot);
            first = await catalog.AddAsync(
                projectId,
                new MemoryStream(bytes),
                "рисунок-1.png",
                "image/png",
                "drawing",
                TestContext.Current.CancellationToken);
            second = await catalog.AddAsync(
                projectId,
                new MemoryStream(bytes),
                "рисунок-2.png",
                "image/png",
                "photo",
                TestContext.Current.CancellationToken);

            Assert.NotEqual(first.AttachmentId, second.AttachmentId);
            Assert.Equal(first.Content, second.Content);
            Assert.Equal(1, Count(storage, "attachment_blobs"));
            Assert.Equal(2, Count(storage, "project_attachments"));
        }

        using var reopened = SqliteStorage.Open(fixture.DataRoot);
        var reopenedCatalog = AttachmentCatalog(reopened, fixture.DataRoot);
        var references = reopenedCatalog.List(projectId);
        Assert.Equal(
            new[] { first.AttachmentId, second.AttachmentId }.OrderBy(item => item.Value),
            references.Select(item => item.AttachmentId).OrderBy(item => item.Value));
        await reopenedCatalog.ValidateAsync(
            projectId,
            first.AttachmentId,
            TestContext.Current.CancellationToken);
        await using var content = await reopenedCatalog.OpenReadVerifiedAsync(
            projectId,
            second.AttachmentId,
            TestContext.Current.CancellationToken);
        using var copy = new MemoryStream();
        await content.CopyToAsync(copy, TestContext.Current.CancellationToken);
        Assert.Equal(bytes, copy.ToArray());
    }

    [Fact]
    public async Task Failure_before_database_commit_does_not_publish_a_visible_reference()
    {
        using var fixture = Fixture.Create();
        using var storage = SqliteStorage.Open(fixture.DataRoot);
        var catalog = AttachmentCatalog(storage, fixture.DataRoot);
        var bytes = Encoding.UTF8.GetBytes("safe orphan after interrupted reference transaction");

        var error = await Assert.ThrowsAsync<ProjectCatalogException>(() => catalog.AddAsync(
            ProjectIdentity.New(),
            new MemoryStream(bytes),
            "orphan.bin",
            "application/octet-stream",
            "source",
            TestContext.Current.CancellationToken));

        Assert.Equal("project_not_found", error.Code);
        Assert.Equal(0, Count(storage, "attachment_blobs"));
        Assert.Equal(0, Count(storage, "project_attachments"));
        Assert.Single(Directory.GetFiles(
            Path.Combine(fixture.DataRoot, "attachments", "blobs"),
            "*",
            SearchOption.AllDirectories));
    }

    [Fact]
    public async Task Attachment_command_replays_after_restart_without_a_second_reference_or_revision()
    {
        using var fixture = Fixture.Create();
        var commandId = Guid.NewGuid();
        var bytes = Encoding.UTF8.GetBytes("restart-safe attachment command");
        ProjectIdentity projectId;
        ProjectMutationResult<ProjectAttachment> accepted;

        using (var storage = SqliteStorage.Open(fixture.DataRoot))
        {
            projectId = CreateProject(storage);
            accepted = await AttachmentCatalog(storage, fixture.DataRoot).AddAsync(
                projectId,
                new ProjectCommandEnvelope(commandId, 0),
                new MemoryStream(bytes),
                "evidence.txt",
                "text/plain",
                "note",
                TestContext.Current.CancellationToken);
            Assert.Equal(1, accepted.ResultingRevision);
        }

        using var reopened = SqliteStorage.Open(fixture.DataRoot);
        var replay = await AttachmentCatalog(reopened, fixture.DataRoot).AddAsync(
            projectId,
            new ProjectCommandEnvelope(commandId, 0),
            new MemoryStream(bytes),
            "evidence.txt",
            "text/plain",
            "note",
            TestContext.Current.CancellationToken);

        Assert.Equal(accepted, replay);
        Assert.Equal(1, new SqliteProjectCatalog(reopened).GetProject(projectId).Revision);
        Assert.Equal(1, Count(reopened, "attachment_blobs"));
        Assert.Equal(1, Count(reopened, "project_attachments"));
        Assert.Equal(1, Count(reopened, "project_commands"));
        Assert.Equal(1, Count(reopened, "project_versions"));
    }

    [Fact]
    public async Task Attachment_reference_revision_and_journal_roll_back_together()
    {
        using var fixture = Fixture.Create();
        using var storage = SqliteStorage.Open(fixture.DataRoot);
        var projectId = CreateProject(storage);
        var catalog = new SqliteProjectAttachmentCatalog(
            storage,
            new ContentAddressedAttachmentStore(fixture.DataRoot),
            new FrozenTimeProvider(CapturedUtc),
            progress =>
            {
                if (progress == "after_journal")
                {
                    throw new InvalidOperationException("injected transaction failure");
                }
            });

        await Assert.ThrowsAsync<InvalidOperationException>(() => catalog.AddAsync(
            projectId,
            new ProjectCommandEnvelope(Guid.NewGuid(), 0),
            new MemoryStream([1, 2, 3]),
            "rollback.bin",
            "application/octet-stream",
            "source",
            TestContext.Current.CancellationToken));

        Assert.Equal(0, new SqliteProjectCatalog(storage).GetProject(projectId).Revision);
        Assert.Equal(0, Count(storage, "attachment_blobs"));
        Assert.Equal(0, Count(storage, "project_attachments"));
        Assert.Equal(0, Count(storage, "project_commands"));
        Assert.Equal(0, Count(storage, "project_versions"));
        Assert.Single(Directory.GetFiles(
            Path.Combine(fixture.DataRoot, "attachments", "blobs"),
            "*",
            SearchOption.AllDirectories));
    }

    [Fact]
    public async Task Catalog_detects_missing_and_corrupt_attachment_content()
    {
        using var fixture = Fixture.Create();
        using var storage = SqliteStorage.Open(fixture.DataRoot);
        var projectId = CreateProject(storage);
        var catalog = AttachmentCatalog(storage, fixture.DataRoot);
        var attachment = await catalog.AddAsync(
            projectId,
            new MemoryStream(Encoding.UTF8.GetBytes("original")),
            "original.txt",
            "text/plain",
            "note",
            TestContext.Current.CancellationToken);
        var path = fixture.BlobPath(attachment.Content.Sha256);

        await File.WriteAllTextAsync(path, "corrupt!", TestContext.Current.CancellationToken);
        await Assert.ThrowsAsync<InvalidDataException>(() => catalog.ValidateAsync(
            projectId,
            attachment.AttachmentId,
            TestContext.Current.CancellationToken));

        File.Delete(path);
        await Assert.ThrowsAsync<FileNotFoundException>(() => catalog.ValidateAsync(
            projectId,
            attachment.AttachmentId,
            TestContext.Current.CancellationToken));
        Assert.Single(catalog.List(projectId));
    }

    [Fact]
    public void Pinned_snapshot_survives_source_change_and_restart()
    {
        using var fixture = Fixture.Create();
        ProjectIdentity projectId;
        ExternalCharacteristicSnapshot pinned;
        var source = new MutableSource("rev-1", "Длина зачистки", "4.0", "мм");

        using (var storage = SqliteStorage.Open(fixture.DataRoot))
        {
            projectId = CreateProject(storage);
            var store = new SqlitePinnedCharacteristicStore(storage);
            var service = new PinnedCharacteristicService(
                source,
                store,
                new FrozenTimeProvider(CapturedUtc));
            pinned = service.Pin(projectId, "mock", "terminal:T-01");
            source.Record = new ExternalCharacteristicSourceRecord(
                "rev-2", "Длина зачистки", "5.5", "мм");

            var beforeRepin = Assert.Single(store.List(projectId));
            Assert.Equal("4.0", beforeRepin.CharacteristicValue);
            Assert.Equal("rev-1", beforeRepin.SourceVersionFingerprint);
        }

        using var reopened = SqliteStorage.Open(fixture.DataRoot);
        var stored = Assert.Single(new SqlitePinnedCharacteristicStore(reopened).List(projectId));
        Assert.Equal(pinned.SnapshotId, stored.SnapshotId);
        Assert.Equal(pinned.CanonicalPayload, stored.CanonicalPayload);
        Assert.Equal("4.0", stored.CharacteristicValue);
    }

    [Fact]
    public void Same_source_version_is_idempotent_but_changed_payload_is_rejected()
    {
        using var fixture = Fixture.Create();
        using var storage = SqliteStorage.Open(fixture.DataRoot);
        var projectId = CreateProject(storage);
        var store = new SqlitePinnedCharacteristicStore(storage);
        var source = new MutableSource("rev-1", "Сечение", "0.5", "мм2");
        var service = new PinnedCharacteristicService(
            source,
            store,
            new FrozenTimeProvider(CapturedUtc));

        var first = service.Pin(projectId, "mock", "wire:W-01");
        var repeated = service.Pin(projectId, "mock", "wire:W-01");
        Assert.Equal(first.SnapshotId, repeated.SnapshotId);
        Assert.Single(store.List(projectId));

        source.Record = source.Record with { CharacteristicValue = "0.75" };
        Assert.Throws<InvalidDataException>(() =>
            service.Pin(projectId, "mock", "wire:W-01"));
        Assert.Single(store.List(projectId));
    }

    [Fact]
    public async Task Copy_gets_new_reference_ids_and_keeps_immutable_content_and_snapshot()
    {
        using var fixture = Fixture.Create();
        using var storage = SqliteStorage.Open(fixture.DataRoot);
        var projects = new SqliteProjectCatalog(storage);
        var sourceProject = projects.CreateProject(Command());
        var attachments = AttachmentCatalog(storage, fixture.DataRoot);
        var sourceAttachment = await attachments.AddAsync(
            sourceProject.ProjectId,
            new MemoryStream(Encoding.UTF8.GetBytes("shared blob")),
            "shared.bin",
            "application/octet-stream",
            "source",
            TestContext.Current.CancellationToken);
        var snapshotStore = new SqlitePinnedCharacteristicStore(storage);
        var sourceSnapshot = new PinnedCharacteristicService(
            new MutableSource("rev-4", "AWG от", "20", "AWG"),
            snapshotStore,
            new FrozenTimeProvider(CapturedUtc))
            .Pin(sourceProject.ProjectId, "mock", "terminal:T-99");

        var copy = projects.CopyProject(sourceProject.ProjectId);
        var copiedAttachment = Assert.Single(attachments.List(copy.ProjectId));
        var copiedSnapshot = Assert.Single(snapshotStore.List(copy.ProjectId));

        Assert.NotEqual(sourceAttachment.AttachmentId, copiedAttachment.AttachmentId);
        Assert.Equal(sourceAttachment.Content, copiedAttachment.Content);
        Assert.Equal(sourceAttachment.FileName, copiedAttachment.FileName);
        Assert.NotEqual(sourceSnapshot.SnapshotId, copiedSnapshot.SnapshotId);
        Assert.Equal(sourceSnapshot.CanonicalPayload, copiedSnapshot.CanonicalPayload);
        Assert.Equal(sourceSnapshot.CapturedUtc, copiedSnapshot.CapturedUtc);
        Assert.Equal(1, Count(storage, "attachment_blobs"));
        Assert.Equal(2, Count(storage, "project_attachments"));
        Assert.Equal(2, Count(storage, "pinned_characteristics"));
    }

    [Theory]
    [InlineData("/")]
    [InlineData("text/")]
    [InlineData("/plain")]
    public async Task Invalid_media_type_is_rejected_before_content_publication(string mediaType)
    {
        using var fixture = Fixture.Create();
        using var storage = SqliteStorage.Open(fixture.DataRoot);
        var projectId = CreateProject(storage);
        var catalog = AttachmentCatalog(storage, fixture.DataRoot);

        var error = await Assert.ThrowsAsync<ProjectAttachmentException>(() => catalog.AddAsync(
            projectId,
            new MemoryStream([1, 2, 3]),
            "a.bin",
            mediaType,
            "source",
            TestContext.Current.CancellationToken));

        Assert.Equal("invalid_media_type", error.Code);
        Assert.Empty(Directory.GetFiles(
            Path.Combine(fixture.DataRoot, "attachments"),
            "*",
            SearchOption.AllDirectories));
    }

    private static ProjectIdentity CreateProject(SqliteStorage storage) =>
        new SqliteProjectCatalog(storage).CreateProject(Command()).ProjectId;

    private static CreateProjectCommand Command() =>
        new("ПР-М1-05", "Данные проекта", 10, ProjectStatus.Active);

    private static SqliteProjectAttachmentCatalog AttachmentCatalog(
        SqliteStorage storage,
        string dataRoot) =>
        new(storage, new ContentAddressedAttachmentStore(dataRoot), new FrozenTimeProvider(CapturedUtc));

    private static int Count(SqliteStorage storage, string tableName) =>
        storage.ExecuteRead(unitOfWork =>
        {
            using var command = unitOfWork.CreateCommand($"SELECT COUNT(*) FROM {tableName};");
            return Convert.ToInt32(command.ExecuteScalar(), System.Globalization.CultureInfo.InvariantCulture);
        });

    private sealed class MutableSource(
        string version,
        string name,
        string value,
        string? unit) : IExternalCharacteristicSource
    {
        public ExternalCharacteristicSourceRecord Record { get; set; } =
            new(version, name, value, unit);

        public ExternalCharacteristicSourceRecord Read(string sourceKind, string sourceRecordKey) =>
            Record;
    }

    private sealed class FrozenTimeProvider(DateTimeOffset utcNow) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => utcNow;
    }

    private sealed class Fixture : IDisposable
    {
        private Fixture(string root)
        {
            Root = root;
            DataRoot = Path.Combine(root, "data-root");
        }

        public string Root { get; }

        public string DataRoot { get; }

        public static Fixture Create()
        {
            var root = Path.Combine(Path.GetTempPath(), "techmap-project-data", Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(root);
            return new Fixture(root);
        }

        public string BlobPath(string sha256) =>
            Path.Combine(DataRoot, "attachments", "blobs", sha256[..2], sha256);

        public void Dispose()
        {
            if (Directory.Exists(Root))
            {
                Directory.Delete(Root, recursive: true);
            }
        }
    }
}
