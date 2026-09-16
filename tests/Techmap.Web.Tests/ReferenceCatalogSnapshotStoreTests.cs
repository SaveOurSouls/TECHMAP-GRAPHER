using System.Text.Json;
using Techmap.Application;
using Techmap.Domain;
using Techmap.Infrastructure.Sqlite;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class ReferenceCatalogSnapshotStoreTests
{
    [Fact]
    public void Published_versions_coexist_survive_restart_and_keep_stable_record_identity()
    {
        using var fixture = Fixture.Create();
        ReferenceCatalogSnapshot first;
        ReferenceCatalogSnapshot second;
        using (var storage = SqliteStorage.Open(fixture.DataRoot))
        {
            var store = new SqliteReferenceCatalogSnapshotStore(storage);
            first = Publish(store, Draft("v1", "{\"value\":1}").Validate(), null).PublishedSnapshot!;
            second = Publish(store, Draft("v2", "{\"value\":2}").Validate(), first.SnapshotId).PublishedSnapshot!;

            Assert.Equal(second.SnapshotId, store.GetActive("technology-database")?.SnapshotId);
            Assert.Equal(2, store.List("technology-database").Count);
            Assert.Equal(first.Records[0].RecordId, second.Records[0].RecordId);
        }

        using var reopened = SqliteStorage.Open(fixture.DataRoot);
        var restarted = new SqliteReferenceCatalogSnapshotStore(reopened);
        Assert.Equal(second.Sha256, restarted.GetActive("technology-database")?.Sha256);
        Assert.Equal(first.Sha256, restarted.Get(first.SnapshotId)?.Sha256);
    }

    [Fact]
    public void Active_source_list_reports_only_the_current_snapshot_and_its_row_count()
    {
        using var fixture = Fixture.Create();
        using var storage = SqliteStorage.Open(fixture.DataRoot);
        var store = new SqliteReferenceCatalogSnapshotStore(storage);
        var first = Publish(store, Draft("v1", "{\"value\":1}").Validate(), null).PublishedSnapshot!;
        var second = Publish(store, Draft("v2", "{\"value\":2}").Validate(), first.SnapshotId).PublishedSnapshot!;

        var source = Assert.Single(store.ListActiveSources());

        Assert.Equal("technology-database", source.SourceId);
        Assert.Equal("xlsx", source.SourceKind);
        Assert.Equal(second.SnapshotId, source.ActiveSnapshotId);
        Assert.Equal(1, source.RecordCount);
        Assert.Equal(second.CapturedUtc, source.CapturedUtc);
    }

    [Fact]
    public void Failed_or_stale_publication_keeps_the_previous_active_snapshot()
    {
        using var fixture = Fixture.Create();
        using var storage = SqliteStorage.Open(fixture.DataRoot);
        var store = new SqliteReferenceCatalogSnapshotStore(storage);
        var first = Publish(store, Draft("v1", "{\"value\":1}").Validate(), null).PublishedSnapshot!;
        var secondValidation = Draft("v2", "{\"value\":2}").Validate();

        var stale = Publish(store, secondValidation, null);

        Assert.Equal(ReferenceCatalogPublicationStatus.ActiveSnapshotConflict, stale.Status);
        Assert.Equal(first.SnapshotId, store.GetActive("technology-database")?.SnapshotId);
        Assert.Single(store.List("technology-database"));
    }

    [Fact]
    public void Repeated_identical_source_version_is_idempotent_but_reuse_with_other_content_is_rejected()
    {
        using var fixture = Fixture.Create();
        using var storage = SqliteStorage.Open(fixture.DataRoot);
        var store = new SqliteReferenceCatalogSnapshotStore(storage);
        var firstValidation = Draft("same-version", "{\"value\":1}").Validate();
        var first = Publish(store, firstValidation, null).PublishedSnapshot!;
        var repeated = Publish(store, Draft("same-version", "{\"value\":1}").Validate(), null);

        Assert.Equal(ReferenceCatalogPublicationStatus.Unchanged, repeated.Status);
        Assert.Equal(first.SnapshotId, repeated.PublishedSnapshot?.SnapshotId);
        Assert.Single(store.List("technology-database"));

        var error = Assert.Throws<ReferenceCatalogStoreException>(() =>
            Publish(store, Draft("same-version", "{\"value\":9}").Validate(), first.SnapshotId));
        Assert.Equal("catalog_source_version_reused", error.Code);
        Assert.Equal(first.SnapshotId, store.GetActive("technology-database")?.SnapshotId);
    }

    [Fact]
    public void Source_kind_cannot_change_between_versions_of_one_logical_source()
    {
        using var fixture = Fixture.Create();
        using var storage = SqliteStorage.Open(fixture.DataRoot);
        var store = new SqliteReferenceCatalogSnapshotStore(storage);
        var first = Publish(store, Draft("v1", "{\"value\":1}").Validate(), null).PublishedSnapshot!;
        using var payload = JsonDocument.Parse("{\"value\":2}");
        var changedKind = ReferenceCatalogDraft.Create(
            ReferenceCatalogSnapshotIdentity.New(),
            "technology-database",
            1,
            new DateTimeOffset(2026, 9, 12, 18, 0, 0, TimeSpan.Zero),
            new ReferenceCatalogProvenanceInput("google-sheets", "v2", "sheet"),
            [new ReferenceCatalogRecordInput(
                "terminal", "TER-001", payload.RootElement.Clone(), "БД.ТЕР!2")]).Validate();

        var error = Assert.Throws<ReferenceCatalogStoreException>(() =>
            Publish(store, changedKind, first.SnapshotId));

        Assert.Equal("catalog_source_kind_changed", error.Code);
        Assert.Equal(first.SnapshotId, store.GetActive("technology-database")?.SnapshotId);
    }

    [Fact]
    public void Published_payload_corruption_fails_closed_instead_of_falling_back()
    {
        using var fixture = Fixture.Create();
        using var storage = SqliteStorage.Open(fixture.DataRoot);
        var store = new SqliteReferenceCatalogSnapshotStore(storage);
        var published = Publish(store, Draft("v1", "{\"value\":1}").Validate(), null).PublishedSnapshot!;
        storage.ExecuteInTransaction(unitOfWork =>
        {
            using var command = unitOfWork.CreateCommand(
                "DROP TRIGGER prevent_frozen_reference_snapshot_record_update;");
            command.ExecuteNonQuery();
            using var corrupt = unitOfWork.CreateCommand(
                """
                UPDATE reference_snapshot_records
                SET canonical_payload = '{"value":99}'
                WHERE snapshot_id = $snapshotId;
                """);
            corrupt.Parameters.AddWithValue("$snapshotId", published.SnapshotId.Value.ToString("D"));
            corrupt.ExecuteNonQuery();
        });

        var error = Assert.Throws<InvalidDataException>(() => store.GetActive("technology-database"));
        Assert.Contains("corrupt", error.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Published_capture_time_corruption_fails_closed()
    {
        using var fixture = Fixture.Create();
        using var storage = SqliteStorage.Open(fixture.DataRoot);
        var store = new SqliteReferenceCatalogSnapshotStore(storage);
        var published = Publish(store, Draft("v1", "{\"value\":1}").Validate(), null).PublishedSnapshot!;
        storage.ExecuteInTransaction(unitOfWork =>
        {
            using var command = unitOfWork.CreateCommand(
                "DROP TRIGGER enforce_reference_snapshot_update;");
            command.ExecuteNonQuery();
            using var corrupt = unitOfWork.CreateCommand(
                """
                UPDATE reference_snapshots
                SET captured_utc = '2026-09-12T19:00:00.0000000+00:00'
                WHERE snapshot_id = $snapshotId;
                """);
            corrupt.Parameters.AddWithValue("$snapshotId", published.SnapshotId.Value.ToString("D"));
            corrupt.ExecuteNonQuery();
        });

        var error = Assert.Throws<InvalidDataException>(() => store.GetActive("technology-database"));
        Assert.Contains("metadata", error.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Concurrent_publishers_with_one_expected_head_have_exactly_one_winner()
    {
        using var fixture = Fixture.Create();
        using var storage = SqliteStorage.Open(fixture.DataRoot);
        var store = new SqliteReferenceCatalogSnapshotStore(storage);
        var first = Publish(store, Draft("v1", "{\"value\":1}").Validate(), null).PublishedSnapshot!;
        using var ready = new CountdownEvent(2);
        using var start = new ManualResetEventSlim(false);

        Task<ReferenceCatalogPublicationResult> Attempt(string version, int value) => Task.Run(() =>
        {
            var validation = Draft(version, $"{{\"value\":{value}}}").Validate();
            ready.Signal();
            start.Wait(TestContext.Current.CancellationToken);
            return Publish(store, validation, first.SnapshotId);
        }, TestContext.Current.CancellationToken);

        var left = Attempt("v2-left", 2);
        var right = Attempt("v2-right", 3);
        Assert.True(ready.Wait(TimeSpan.FromSeconds(5), TestContext.Current.CancellationToken));
        start.Set();
        var results = await Task.WhenAll(left, right);

        Assert.Single(results, result => result.Status == ReferenceCatalogPublicationStatus.Published);
        Assert.Single(results, result => result.Status == ReferenceCatalogPublicationStatus.ActiveSnapshotConflict);
        Assert.Equal(2, store.List("technology-database").Count);
    }

    private static ReferenceCatalogPublicationResult Publish(
        IReferenceCatalogSnapshotStore store,
        ReferenceCatalogValidationResult validation,
        ReferenceCatalogSnapshotIdentity? expected) =>
        new ReferenceCatalogPublicationService(store).Publish(new ReferenceCatalogPublicationRequest(
            validation,
            expected,
            validation.Snapshot?.Sha256 ?? "invalid",
            validation.RequiredWarningAcknowledgements));

    private static ReferenceCatalogDraft Draft(string version, string payload)
    {
        using var document = JsonDocument.Parse(payload);
        return ReferenceCatalogDraft.Create(
            ReferenceCatalogSnapshotIdentity.New(),
            "technology-database",
            1,
            new DateTimeOffset(2026, 9, 12, 18, 0, 0, TimeSpan.Zero),
            new ReferenceCatalogProvenanceInput("xlsx", version, "technology-database.xlsx"),
            [new ReferenceCatalogRecordInput("terminal", "TER-001", document.RootElement.Clone(), "БД.ТЕР!2")]);
    }

    private sealed class Fixture : IDisposable
    {
        private Fixture(string root)
        {
            Root = root;
            DataRoot = Path.Combine(root, "data");
        }

        public string Root { get; }
        public string DataRoot { get; }

        public static Fixture Create()
        {
            var root = Path.Combine(Path.GetTempPath(), "techmap-reference-tests", Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(root);
            return new Fixture(root);
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
