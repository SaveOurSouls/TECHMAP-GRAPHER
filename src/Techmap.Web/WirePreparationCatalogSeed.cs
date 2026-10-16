using System.Text.Json;
using Techmap.Application;
using Techmap.Domain;

namespace Techmap.Web;

public static class WirePreparationCatalogSeed
{
    public const string SourceId = "technology-wire-preparation-schemes";
    public static void EnsurePublished(IReferenceCatalogSnapshotStore store)
    {
        using var stream = typeof(WirePreparationCatalogSeed).Assembly.GetManifestResourceStream("Techmap.Web.WirePreparationSeed.json")
            ?? throw new InvalidDataException("Wire preparation seed is missing.");
        using var seed = JsonDocument.Parse(stream);
        var introducing = store.GetActive(SourceId) is null;
        if (introducing)
        {
            var records = seed.RootElement.GetProperty("schemes").EnumerateArray().Select(row =>
                new ReferenceCatalogRecordInput("wire-preparation-scheme", row.GetProperty("id").GetString()!, row.Clone())).ToArray();
            Publish(store, SourceId, records, null);
        }
        // Add missing end combinations once; never replace authored rows or defaults.
        var active = store.GetActive(WireBlankCatalogSeed.SourceId);
        if (active is null || !introducing) return;
        var blanks = active.Records.Select(row => new ReferenceCatalogRecordInput(row.EntityType, row.SourceKey, row.Payload.Clone())).ToList();
        string Pair(JsonElement p) => string.Join("|", new[] { p.GetProperty("start").GetString(), p.GetProperty("end").GetString() }.OrderBy(x => x, StringComparer.Ordinal));
        var pairs = blanks.Select(row => Pair(row.Payload)).ToHashSet(StringComparer.Ordinal);
        var keys = blanks.Select(row => row.SourceKey).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var names = blanks.Select(row => row.Payload.GetProperty("title").GetString()).ToHashSet(StringComparer.OrdinalIgnoreCase);
        foreach (var row in seed.RootElement.GetProperty("blanks").EnumerateArray())
        {
            if (pairs.Contains(Pair(row))) continue;
            var key = row.GetProperty("index").GetString()!;
            // An authored collision is retained instead of silently overwritten.
            if (!keys.Add(key) || !names.Add(row.GetProperty("title").GetString())) continue;
            blanks.Add(new ReferenceCatalogRecordInput("wire-blank", key, row.Clone()));
            pairs.Add(Pair(row));
        }
        if (blanks.Count != active.Records.Count) Publish(store, WireBlankCatalogSeed.SourceId, blanks.ToArray(), active.SnapshotId);
    }
    private static void Publish(IReferenceCatalogSnapshotStore store, string sourceId, ReferenceCatalogRecordInput[] records, ReferenceCatalogSnapshotIdentity? expected)
    {
        var validation = ReferenceCatalogDraft.Create(ReferenceCatalogSnapshotIdentity.New(), sourceId, 1, DateTimeOffset.UtcNow,
            new ReferenceCatalogProvenanceInput("editable-table", "bundled:wire-preparation:v1", "bundled:wire-preparation-seed.json"), records).Validate();
        if (!validation.IsValid) throw new InvalidDataException("Wire preparation seed is invalid.");
        var result = new ReferenceCatalogPublicationService(store).Publish(new ReferenceCatalogPublicationRequest(validation, expected, validation.Snapshot!.Sha256, validation.RequiredWarningAcknowledgements));
        if (result.Status is not (ReferenceCatalogPublicationStatus.Published or ReferenceCatalogPublicationStatus.Unchanged))
            throw new InvalidDataException("Could not publish wire preparation seed.");
    }
}
