using System.Text.Json;
using Techmap.Application;
using Techmap.Domain;

namespace Techmap.Web;

/// <summary>Creates the editable wire semi-finished product catalog from the drawing set.</summary>
public static class WireBlankCatalogSeed
{
    public const string SourceId = "technology-wire-blanks";
    private const string ResourceName = "Techmap.Web.RouteWireIllustrationsManifest.json";

    public static void EnsurePublished(IReferenceCatalogSnapshotStore store)
    {
        ArgumentNullException.ThrowIfNull(store);
        if (store.GetActive(SourceId) is not null) return;

        using var stream = typeof(WireBlankCatalogSeed).Assembly.GetManifestResourceStream(ResourceName)
            ?? throw new InvalidDataException("The wire illustration manifest is missing.");
        using var manifest = JsonDocument.Parse(stream);
        var entries = manifest.RootElement.GetProperty("entries");
        if (entries.ValueKind != JsonValueKind.Array || entries.GetArrayLength() != 13)
            throw new InvalidDataException("The wire illustration manifest has an invalid entry count.");

        var records = entries.EnumerateArray().Select(entry =>
        {
            var id = entry.GetProperty("id").GetString()!;
            var title = entry.GetProperty("title").GetString()!;
            var left = entry.GetProperty("left").GetString()!;
            var right = entry.GetProperty("right").GetString()!;
            var file = entry.GetProperty("file").GetString()!;
            if (!System.Text.RegularExpressions.Regex.IsMatch(id, @"^[a-z0-9-]+$") ||
                file != id + ".svg" ||
                !new[] { "cut", "copper", "tin", "terminal", "sealed", "sealed-pin" }.Contains(left) ||
                !new[] { "cut", "copper", "tin", "terminal", "sealed", "sealed-pin" }.Contains(right) ||
                string.IsNullOrWhiteSpace(title))
                throw new InvalidDataException("The wire illustration manifest contains an invalid entry.");
            var payload = JsonSerializer.SerializeToElement(new
            {
                index = $"ПФП-{id.ToUpperInvariant()}",
                title,
                color = "#26609e",
                start = left,
                end = right,
                templateId = id,
            });
            return new ReferenceCatalogRecordInput("wire-blank", $"ПФП-{id.ToUpperInvariant()}", payload);
        }).ToArray();

        if (records.Select(record => record.SourceKey).Distinct(StringComparer.OrdinalIgnoreCase).Count() != records.Length ||
            records.Select(record => record.Payload.GetProperty("title").GetString()).Distinct(StringComparer.OrdinalIgnoreCase).Count() != records.Length)
            throw new InvalidDataException("The wire illustration manifest contains duplicate entries.");

        var validation = ReferenceCatalogDraft.Create(
            ReferenceCatalogSnapshotIdentity.New(), SourceId, 1, DateTimeOffset.UtcNow,
            new ReferenceCatalogProvenanceInput("editable-table", "bundled:route-wire-illustrations:v1", "bundled:route-wire-illustrations/manifest.json"),
            records).Validate();
        if (!validation.IsValid)
            throw new InvalidDataException("The wire semi-finished product catalog failed validation.");
        var publication = new ReferenceCatalogPublicationService(store).Publish(
            new ReferenceCatalogPublicationRequest(validation, null, validation.Snapshot!.Sha256,
                validation.RequiredWarningAcknowledgements));
        if (publication.Status is not (ReferenceCatalogPublicationStatus.Published or ReferenceCatalogPublicationStatus.Unchanged) &&
            store.GetActive(SourceId) is null)
            throw new InvalidDataException("The wire semi-finished product catalog could not be published.");
    }
}
