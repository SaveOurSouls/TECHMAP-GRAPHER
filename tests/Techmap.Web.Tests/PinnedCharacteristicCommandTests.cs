using Techmap.Application;
using Techmap.Domain;
using Techmap.Infrastructure.Sqlite;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class PinnedCharacteristicCommandTests
{
    [Fact]
    public void Service_replay_does_not_read_mutable_source_after_original_commit()
    {
        var root = Path.Combine(Path.GetTempPath(), "techmap-pinned-source-tests", Guid.NewGuid().ToString("N"));
        try
        {
            using var storage = SqliteStorage.Open(root);
            var catalog = new SqliteProjectCatalog(storage);
            var projectId = catalog.CreateProject(new CreateProjectCommand(
                "ПР-ИСТ", "Проект источника", 1, ProjectStatus.Draft)).ProjectId;
            var source = new CountingSource();
            var service = new PinnedCharacteristicService(
                source, new SqlitePinnedCharacteristicStore(storage), TimeProvider.System);
            var envelope = new ProjectCommandEnvelope(Guid.NewGuid(), 0);

            var first = service.Pin(projectId, envelope, "mock", "terminal:T-01");
            source.FailReads = true;
            var replay = service.Pin(projectId, envelope, "mock", "terminal:T-01");

            Assert.Equal(1, source.ReadCount);
            Assert.Equal(first.Value.SnapshotId, replay.Value.SnapshotId);
            Assert.Equal(first.Value.CanonicalPayload, replay.Value.CanonicalPayload);
            Assert.Equal(1, catalog.GetProject(projectId).Revision);
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public void Pinned_command_is_durable_and_replays_original_snapshot_after_later_edits()
    {
        var root = Path.Combine(Path.GetTempPath(), "techmap-pinned-command-tests", Guid.NewGuid().ToString("N"));
        try
        {
            ProjectIdentity projectId;
            var envelope = new ProjectCommandEnvelope(Guid.NewGuid(), 0);
            ExternalCharacteristicSnapshot original;
            using (var storage = SqliteStorage.Open(root))
            {
                var catalog = new SqliteProjectCatalog(storage);
                projectId = catalog.CreateProject(new CreateProjectCommand(
                    "ПР-ПИН", "Проект со снимком", 1, ProjectStatus.Draft)).ProjectId;
                var store = new SqlitePinnedCharacteristicStore(storage);
                original = store.AddOrGet(projectId, envelope, Capture("v1", "4")).Value;
                catalog.UpdateProject(projectId,
                    new ProjectCommandEnvelope(Guid.NewGuid(), 1),
                    new UpdateProjectCommand(Name: "После снимка"));
                Assert.Equal(2, catalog.GetProject(projectId).Revision);
            }

            using var reopened = SqliteStorage.Open(root);
            var snapshots = new SqlitePinnedCharacteristicStore(reopened);
            var replay = snapshots.AddOrGet(projectId, envelope, Capture("v1", "4"));
            Assert.Equal(1, replay.ResultingRevision);
            Assert.Equal(original.SnapshotId, replay.Value.SnapshotId);
            Assert.Equal(original.CapturedUtc, replay.Value.CapturedUtc);
            Assert.Equal(original.CanonicalPayload, replay.Value.CanonicalPayload);
            Assert.Equal(2, new SqliteProjectCatalog(reopened).GetProject(projectId).Revision);
            Assert.Single(snapshots.List(projectId));

            var reused = Assert.Throws<ProjectCommandException>(() =>
                snapshots.AddOrGet(projectId, envelope, Capture("v2", "5")));
            Assert.Equal("command_id_reused", reused.Code);
            var stale = Assert.Throws<ProjectCommandException>(() =>
                snapshots.AddOrGet(projectId,
                    new ProjectCommandEnvelope(Guid.NewGuid(), 0), Capture("v2", "5")));
            Assert.Equal("revision_conflict", stale.Code);
            Assert.Equal(2, stale.CurrentRevision);
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }

    private static ExternalCharacteristicSnapshot Capture(string version, string value) =>
        ExternalCharacteristicSnapshot.Capture(
            CharacteristicSnapshotIdentity.New(), "mock", "terminal:T-01", version,
            "Длина зачистки", value, "мм", DateTimeOffset.UtcNow);

    private sealed class CountingSource : IExternalCharacteristicSource
    {
        public int ReadCount { get; private set; }
        public bool FailReads { get; set; }

        public ExternalCharacteristicSourceRecord Read(string sourceKind, string sourceRecordKey)
        {
            ReadCount++;
            if (FailReads) throw new IOException("The external source is offline.");
            return new ExternalCharacteristicSourceRecord("v1", "Длина зачистки", "4", "мм");
        }
    }
}
