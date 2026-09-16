using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Techmap.Application;
using Techmap.Domain;
using Xunit;

namespace Techmap.Domain.Tests;

public sealed class ReferenceCatalogSnapshotTests
{
    private static readonly ReferenceCatalogSnapshotIdentity SnapshotId = new(Guid.Parse("10000000-0000-0000-0000-000000000001"));
    private static readonly DateTimeOffset CapturedUtc = new(2026, 9, 12, 12, 0, 0, TimeSpan.Zero);

    [Fact]
    public void Canonical_hash_is_independent_of_record_and_object_property_order()
    {
        var first = Draft([
            Record("tool", "002", "{\"z\":0,\"a\":null}"),
            Record("material", "001", "{\"name\":\"steel\",\"values\":[2,1]}")
        ]).Validate().Snapshot!;
        var reordered = Draft([
            Record("material", "001", "{\"values\":[2,1],\"name\":\"steel\"}"),
            Record("tool", "002", "{\"a\":null,\"z\":0}")
        ]).Validate().Snapshot!;

        Assert.Equal(first.CanonicalJson, reordered.CanonicalJson);
        Assert.Equal(first.Sha256, reordered.Sha256);
        Assert.Matches("^[0-9a-f]{64}$", first.Sha256);
        Assert.Equal(
            Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(first.CanonicalJson))),
            first.Sha256);
    }

    [Fact]
    public void Record_identity_ignores_row_location_and_preserves_significant_source_key_characters()
    {
        var first = Draft([Record("tool", "001", "{}", "sheet:4")]).Validate().Snapshot!;
        var moved = Draft([Record("tool", "001", "{}", "sheet:99")]).Validate().Snapshot!;
        var differentKey = Draft([Record("tool", "1", "{}", "sheet:4")]).Validate().Snapshot!;

        Assert.Equal(first.Records[0].RecordId, moved.Records[0].RecordId);
        Assert.NotEqual(first.Records[0].RecordId, differentKey.Records[0].RecordId);
        Assert.Equal(first.Sha256, moved.Sha256);
    }

    [Fact]
    public void Nfc_equivalent_text_has_the_same_canonical_form()
    {
        var decomposed = Draft([Record("material", "A", "{\"name\":\"Cafe\\u0301\"}")]).Validate().Snapshot!;
        var composed = Draft([Record("material", "A", "{\"name\":\"Caf\\u00e9\"}")]).Validate().Snapshot!;

        Assert.Equal(composed.CanonicalJson, decomposed.CanonicalJson);
        Assert.Equal(composed.Sha256, decomposed.Sha256);
    }

    [Fact]
    public void Null_zero_empty_string_and_textual_zero_remain_distinct()
    {
        var snapshot = Draft([Record("value", "A", "{\"empty\":\"\",\"null\":null,\"number\":0,\"text\":\"0\"}")])
            .Validate().Snapshot!;
        var payload = snapshot.Records[0].Payload;

        Assert.Equal(JsonValueKind.Null, payload.GetProperty("null").ValueKind);
        Assert.Equal(0, payload.GetProperty("number").GetInt32());
        Assert.Equal(string.Empty, payload.GetProperty("empty").GetString());
        Assert.Equal("0", payload.GetProperty("text").GetString());
    }

    [Fact]
    public void Duplicate_record_key_is_a_blocking_diagnostic()
    {
        var result = Draft([
            Record("tool", "A", "{\"value\":1}"),
            Record("tool", "A", "{\"value\":2}")
        ]).Validate();

        Assert.False(result.IsValid);
        Assert.Null(result.Snapshot);
        Assert.Contains(result.Diagnostics, item =>
            item.Code == "duplicate-record-key" &&
            item.Severity == ReferenceCatalogDiagnosticSeverity.Error);
    }

    [Fact]
    public void Duplicate_property_after_unicode_normalization_is_rejected()
    {
        var result = Draft([Record("material", "A", "{\"Caf\\u00e9\":1,\"Cafe\\u0301\":2}")]).Validate();

        Assert.False(result.IsValid);
        Assert.Contains(result.Diagnostics, item => item.Code == "invalid-record");
    }

    [Fact]
    public void Diagnostic_id_and_order_ignore_source_row_location()
    {
        var first = Draft([Record("tool", "A", "{}")], [Warning("unit-missing", "Unit is absent.", "row:2"), Warning("name", "Name adjusted.", "row:1")])
            .Validate();
        var second = Draft([Record("tool", "A", "{}")], [Warning("name", "Name adjusted.", "row:55"), Warning("unit-missing", "Unit is absent.", "row:88")])
            .Validate();

        Assert.Equal(first.Diagnostics.Select(item => item.DiagnosticId), second.Diagnostics.Select(item => item.DiagnosticId));
        Assert.True(first.IsValid);
    }

    [Fact]
    public void Empty_candidate_is_blocking_and_cannot_replace_an_active_snapshot()
    {
        var validation = Draft([]).Validate();
        var store = new InMemoryStore();

        Assert.False(validation.IsValid);
        Assert.Contains(validation.Diagnostics, item => item.Code == "empty-snapshot");
        Assert.Equal(
            ReferenceCatalogPublicationStatus.ValidationFailed,
            new ReferenceCatalogPublicationService(store)
                .Publish(new(validation, null, "invalid", [])).Status);
        Assert.Null(store.GetActive("catalog"));
    }

    [Fact]
    public void Snapshot_contract_is_immutable_to_consumers()
    {
        Assert.DoesNotContain(
            typeof(ReferenceCatalogSnapshot).GetProperties(),
            property => property.SetMethod?.IsPublic == true);
        Assert.DoesNotContain(
            typeof(ReferenceCatalogRecord).GetProperties(),
            property => property.SetMethod?.IsPublic == true);
    }

    [Fact]
    public void Publication_requires_the_exact_warning_acknowledgement_set()
    {
        var store = new InMemoryStore();
        var service = new ReferenceCatalogPublicationService(store);
        var validation = Draft([Record("tool", "A", "{}")], [Warning("review", "Review this record.", "row:1")]).Validate();
        var warningId = Assert.Single(validation.RequiredWarningAcknowledgements);
        Assert.Equal(ReferenceCatalogValidationState.ValidatedWithWarnings, validation.Snapshot!.ValidationState);

        Assert.Equal(
            ReferenceCatalogPublicationStatus.WarningAcknowledgementMismatch,
            service.Publish(new(validation, null, validation.Snapshot!.Sha256, [])).Status);
        Assert.Equal(
            ReferenceCatalogPublicationStatus.WarningAcknowledgementMismatch,
            service.Publish(new(validation, null, validation.Snapshot!.Sha256, [warningId, "stale-warning"])).Status);
        Assert.Equal(
            ReferenceCatalogPublicationStatus.Published,
            service.Publish(new(validation, null, validation.Snapshot!.Sha256, [warningId])).Status);
    }

    [Fact]
    public void Unrepresentable_number_is_a_blocking_validation_error()
    {
        var result = Draft([Record("value", "A", "{\"value\":1e1000}")]).Validate();

        Assert.False(result.IsValid);
        Assert.Contains(result.Diagnostics, item => item.Code == "invalid-record");
    }

    [Fact]
    public void Failed_validation_cannot_be_published()
    {
        var store = new InMemoryStore();
        var invalid = Draft([
            Record("tool", "A", "{}"),
            Record("tool", "A", "{}")
        ]).Validate();

        var result = new ReferenceCatalogPublicationService(store).Publish(new(invalid, null, "invalid", []));

        Assert.Equal(ReferenceCatalogPublicationStatus.ValidationFailed, result.Status);
        Assert.Null(store.GetActive("catalog"));
    }

    [Fact]
    public void Two_versions_coexist_and_conflict_does_not_replace_active_snapshot()
    {
        var store = new InMemoryStore();
        var service = new ReferenceCatalogPublicationService(store);
        var first = Draft([Record("tool", "A", "{\"revision\":1}")]).Validate();
        var firstPublish = service.Publish(new(first, null, first.Snapshot!.Sha256, []));
        var firstId = firstPublish.PublishedSnapshot!.SnapshotId;

        var second = Draft(
            [Record("tool", "A", "{\"revision\":2}")],
            snapshotId: new ReferenceCatalogSnapshotIdentity(Guid.Parse("20000000-0000-0000-0000-000000000002"))).Validate();
        var conflict = service.Publish(new(second, null, second.Snapshot!.Sha256, []));

        Assert.Equal(ReferenceCatalogPublicationStatus.ActiveSnapshotConflict, conflict.Status);
        Assert.Equal(firstId, store.GetActive("catalog")!.SnapshotId);

        var published = service.Publish(new(second, firstId, second.Snapshot!.Sha256, []));
        Assert.Equal(ReferenceCatalogPublicationStatus.Published, published.Status);
        Assert.Equal(2, store.List("catalog").Count);
        Assert.Same(first.Snapshot, store.Get(firstId));
        Assert.Equal(second.Snapshot!.SnapshotId, store.GetActive("catalog")!.SnapshotId);
    }

    [Fact]
    public void Store_failure_before_pointer_switch_keeps_old_snapshot_active()
    {
        var store = new InMemoryStore();
        var service = new ReferenceCatalogPublicationService(store);
        var first = Draft([Record("tool", "A", "{\"revision\":1}")]).Validate();
        service.Publish(new(first, null, first.Snapshot!.Sha256, []));
        var original = store.GetActive("catalog")!;
        store.FailNextPublish = true;
        var second = Draft(
            [Record("tool", "A", "{\"revision\":2}")],
            snapshotId: ReferenceCatalogSnapshotIdentity.New()).Validate();

        Assert.Throws<IOException>(() => service.Publish(new(second, original.SnapshotId, second.Snapshot!.Sha256, [])));
        Assert.Same(original, store.GetActive("catalog"));
        Assert.Single(store.List("catalog"));
    }

    private static ReferenceCatalogDraft Draft(
        IEnumerable<ReferenceCatalogRecordInput> records,
        IEnumerable<ReferenceCatalogDiagnosticInput>? diagnostics = null,
        ReferenceCatalogSnapshotIdentity? snapshotId = null) =>
        ReferenceCatalogDraft.Create(
            snapshotId ?? SnapshotId,
            "catalog",
            1,
            CapturedUtc,
            new ReferenceCatalogProvenanceInput("test", "v1", "file:///catalog.json"),
            records,
            diagnostics);

    private static ReferenceCatalogRecordInput Record(
        string entityType,
        string sourceKey,
        string json,
        string? location = null) => new(entityType, sourceKey, Json(json), location);

    private static ReferenceCatalogDiagnosticInput Warning(string code, string message, string location) =>
        new(ReferenceCatalogDiagnosticSeverity.Warning, code, message, SourceLocation: location);

    private static JsonElement Json(string json)
    {
        using var document = JsonDocument.Parse(json);
        return document.RootElement.Clone();
    }

    private sealed class InMemoryStore : IReferenceCatalogSnapshotStore
    {
        private readonly Dictionary<ReferenceCatalogSnapshotIdentity, ReferenceCatalogSnapshot> versions = [];
        private readonly Dictionary<string, ReferenceCatalogSnapshotIdentity> active = new(StringComparer.Ordinal);

        public bool FailNextPublish { get; set; }

        public ReferenceCatalogSnapshot? GetActive(string sourceId) =>
            active.TryGetValue(sourceId, out var id) ? versions[id] : null;

        public ReferenceCatalogSnapshot? Get(ReferenceCatalogSnapshotIdentity snapshotId) =>
            versions.GetValueOrDefault(snapshotId);

        public IReadOnlyList<ReferenceCatalogSnapshot> List(string sourceId) => versions.Values
            .Where(snapshot => snapshot.SourceId == sourceId)
            .OrderBy(snapshot => snapshot.CapturedUtc)
            .ThenBy(snapshot => snapshot.SnapshotId.Value)
            .ToArray();

        public IReadOnlyList<ReferenceCatalogSourceSummary> ListActiveSources() => active
            .Select(item => versions[item.Value])
            .Select(snapshot => new ReferenceCatalogSourceSummary(
                snapshot.SourceId,
                snapshot.SourceId,
                snapshot.Provenance.SourceKind,
                snapshot.SnapshotId,
                snapshot.Records.Count,
                snapshot.CapturedUtc))
            .ToArray();

        public ReferenceCatalogStorePublishResult TryPublish(
            ReferenceCatalogSnapshot candidate,
            ReferenceCatalogSnapshotIdentity? expectedActiveSnapshotId)
        {
            var previous = active.GetValueOrDefault(candidate.SourceId);
            ReferenceCatalogSnapshotIdentity? previousOrNull = previous.Value == Guid.Empty ? null : previous;
            if (previousOrNull != expectedActiveSnapshotId)
                return new(ReferenceCatalogStorePublishStatus.ActiveSnapshotConflict, previousOrNull);
            if (FailNextPublish)
            {
                FailNextPublish = false;
                throw new IOException("Simulated failure before atomic commit.");
            }

            versions.Add(candidate.SnapshotId, candidate);
            active[candidate.SourceId] = candidate.SnapshotId;
            return new(ReferenceCatalogStorePublishStatus.Published, previousOrNull);
        }
    }
}
