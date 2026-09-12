using System.Text.Json;
using Techmap.Application;
using Techmap.Domain;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class PinnedCharacteristicSnapshotTests
{
    private static readonly DateTimeOffset CapturedAt =
        new(2026, 9, 12, 12, 30, 0, TimeSpan.FromHours(3));

    [Fact]
    public void Capture_normalizes_provenance_and_builds_a_stable_canonical_payload()
    {
        var first = Capture(
            sourceKind: "  MOCK-XLSX  ",
            sourceRecordKey: "  БД.ТЕР|ABC-01  ",
            fingerprint: " revision-7 ",
            name: " Диаметр изоляции до ",
            value: " 2,40 ",
            unit: " мм ");
        var second = Capture(
            sourceKind: "mock-xlsx",
            sourceRecordKey: "БД.ТЕР|ABC-01",
            fingerprint: "revision-7",
            name: "Диаметр изоляции до",
            value: "2,40",
            unit: "мм");

        Assert.Equal("mock-xlsx", first.SourceKind);
        Assert.Equal("БД.ТЕР|ABC-01", first.SourceRecordKey);
        Assert.Equal("revision-7", first.SourceVersionFingerprint);
        Assert.Equal("Диаметр изоляции до", first.CharacteristicName);
        Assert.Equal("2,40", first.CharacteristicValue);
        Assert.Equal("мм", first.Unit);
        Assert.Equal(new DateTimeOffset(2026, 9, 12, 9, 30, 0, TimeSpan.Zero), first.CapturedUtc);
        Assert.Equal(first.CanonicalPayload, second.CanonicalPayload);

        using var payload = JsonDocument.Parse(first.CanonicalPayload);
        var root = payload.RootElement;
        Assert.Equal(ExternalCharacteristicSnapshot.CanonicalPayloadSchemaVersion,
            root.GetProperty("schemaVersion").GetInt32());
        Assert.Equal(first.SourceKind, root.GetProperty("sourceKind").GetString());
        Assert.Equal(first.SourceRecordKey, root.GetProperty("sourceRecordKey").GetString());
        Assert.Equal(
            first.SourceVersionFingerprint,
            root.GetProperty("sourceVersionFingerprint").GetString());
        Assert.Equal(first.CharacteristicName, root.GetProperty("characteristicName").GetString());
        Assert.Equal(first.CharacteristicValue, root.GetProperty("characteristicValue").GetString());
        Assert.Equal(first.Unit, root.GetProperty("unit").GetString());
    }

    [Fact]
    public void Missing_unit_is_preserved_canonically_as_an_empty_unit()
    {
        var snapshot = Capture(unit: null);

        Assert.Equal(string.Empty, snapshot.Unit);
        using var payload = JsonDocument.Parse(snapshot.CanonicalPayload);
        Assert.Equal(string.Empty, payload.RootElement.GetProperty("unit").GetString());
    }

    [Theory]
    [InlineData("sourceKind", "")]
    [InlineData("sourceKind", "bad kind")]
    [InlineData("sourceRecordKey", "   ")]
    [InlineData("fingerprint", "")]
    [InlineData("name", "\u001F")]
    [InlineData("value", "")]
    public void Invalid_required_snapshot_data_is_rejected(string field, string invalidValue)
    {
        var values = new Dictionary<string, string?>
        {
            ["sourceKind"] = "mock",
            ["sourceRecordKey"] = "record-1",
            ["fingerprint"] = "v1",
            ["name"] = "Диаметр",
            ["value"] = "2.4",
            ["unit"] = "мм",
        };
        values[field] = invalidValue;

        Assert.Throws<ArgumentException>(() => Capture(
            values["sourceKind"]!,
            values["sourceRecordKey"]!,
            values["fingerprint"]!,
            values["name"]!,
            values["value"]!,
            values["unit"]));
    }

    [Fact]
    public void Empty_snapshot_id_and_default_capture_time_are_rejected()
    {
        Assert.Throws<ArgumentException>(() => ExternalCharacteristicSnapshot.Capture(
            new CharacteristicSnapshotIdentity(Guid.Empty),
            "mock",
            "record-1",
            "v1",
            "Диаметр",
            "2.4",
            "мм",
            CapturedAt));
        Assert.Throws<ArgumentOutOfRangeException>(() => ExternalCharacteristicSnapshot.Capture(
            CharacteristicSnapshotIdentity.New(),
            "mock",
            "record-1",
            "v1",
            "Диаметр",
            "2.4",
            "мм",
            default));
    }

    [Fact]
    public void Snapshot_has_no_publicly_writable_properties()
    {
        Assert.True(typeof(ExternalCharacteristicSnapshot).IsSealed);
        Assert.DoesNotContain(
            typeof(ExternalCharacteristicSnapshot).GetProperties(),
            property => property.SetMethod?.IsPublic == true);
    }

    [Fact]
    public void Changing_the_mock_source_does_not_change_an_existing_project_snapshot()
    {
        var projectId = ProjectIdentity.New();
        var source = new MutableSource
        {
            Current = new ExternalCharacteristicSourceRecord(
                "source-revision-1",
                "Длина зачистки",
                "4.0",
                "мм"),
        };
        var store = new InMemoryStore();
        var service = new PinnedCharacteristicService(
            source,
            store,
            new FrozenTimeProvider(CapturedAt));

        var original = service.Pin(projectId, "mock", "terminal:T-01");
        var originalPayload = original.CanonicalPayload;
        source.Current = new ExternalCharacteristicSourceRecord(
            "source-revision-2",
            "Длина зачистки",
            "5.5",
            "мм");

        var storedBeforeExplicitRepin = Assert.Single(store.List(projectId));
        Assert.Same(original, storedBeforeExplicitRepin);
        Assert.Equal("4.0", storedBeforeExplicitRepin.CharacteristicValue);
        Assert.Equal("source-revision-1", storedBeforeExplicitRepin.SourceVersionFingerprint);
        Assert.Equal(originalPayload, storedBeforeExplicitRepin.CanonicalPayload);

        var updated = service.Pin(projectId, "mock", "terminal:T-01");
        Assert.Equal("5.5", updated.CharacteristicValue);
        Assert.Equal("source-revision-2", updated.SourceVersionFingerprint);
        Assert.NotEqual(original.SnapshotId, updated.SnapshotId);
        Assert.NotEqual(original.CanonicalPayload, updated.CanonicalPayload);
        Assert.Collection(
            store.List(projectId),
            snapshot => Assert.Same(original, snapshot),
            snapshot => Assert.Same(updated, snapshot));
    }

    [Fact]
    public void Source_failure_does_not_publish_a_project_snapshot()
    {
        var projectId = ProjectIdentity.New();
        var store = new InMemoryStore();
        var service = new PinnedCharacteristicService(
            new ThrowingSource(),
            store,
            new FrozenTimeProvider(CapturedAt));

        Assert.Throws<InvalidOperationException>(() =>
            service.Pin(projectId, "mock", "terminal:T-01"));
        Assert.Empty(store.List(projectId));
    }

    private static ExternalCharacteristicSnapshot Capture(
        string sourceKind = "mock",
        string sourceRecordKey = "record-1",
        string fingerprint = "v1",
        string name = "Диаметр",
        string value = "2.4",
        string? unit = "мм") =>
        ExternalCharacteristicSnapshot.Capture(
            CharacteristicSnapshotIdentity.New(),
            sourceKind,
            sourceRecordKey,
            fingerprint,
            name,
            value,
            unit,
            CapturedAt);

    private sealed class MutableSource : IExternalCharacteristicSource
    {
        public required ExternalCharacteristicSourceRecord Current { get; set; }

        public ExternalCharacteristicSourceRecord Read(string sourceKind, string sourceRecordKey) =>
            Current;
    }

    private sealed class ThrowingSource : IExternalCharacteristicSource
    {
        public ExternalCharacteristicSourceRecord Read(string sourceKind, string sourceRecordKey) =>
            throw new InvalidOperationException("Mock source unavailable.");
    }

    private sealed class InMemoryStore : IPinnedCharacteristicStore
    {
        private readonly Dictionary<ProjectIdentity, List<ExternalCharacteristicSnapshot>> snapshots = [];

        public ExternalCharacteristicSnapshot AddOrGet(
            ProjectIdentity projectId,
            ExternalCharacteristicSnapshot snapshot)
        {
            if (!snapshots.TryGetValue(projectId, out var projectSnapshots))
            {
                projectSnapshots = [];
                snapshots.Add(projectId, projectSnapshots);
            }

            projectSnapshots.Add(snapshot);
            return snapshot;
        }

        public IReadOnlyList<ExternalCharacteristicSnapshot> List(ProjectIdentity projectId) =>
            snapshots.TryGetValue(projectId, out var projectSnapshots)
                ? projectSnapshots.ToArray()
                : [];
    }

    private sealed class FrozenTimeProvider(DateTimeOffset utcNow) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => utcNow;
    }
}
