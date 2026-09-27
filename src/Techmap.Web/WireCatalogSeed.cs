using System.IO.Compression;
using System.Security.Cryptography;
using System.Text.Json;
using Techmap.Application;
using Techmap.Domain;

namespace Techmap.Web;

/// <summary>Publishes the E3:AJ wire catalog once for a new local data root.</summary>
public static class WireCatalogSeed
{
    private const string SourceId = "technology-wires";
    private const string ResourceName = "Techmap.Web.WireCatalogE3Aj.json.gz";

    public static void EnsurePublished(IReferenceCatalogSnapshotStore store)
    {
        ArgumentNullException.ThrowIfNull(store);
        if (store.GetActive(SourceId) is not null) return;

        using var resource = typeof(WireCatalogSeed).Assembly.GetManifestResourceStream(ResourceName)
            ?? throw new InvalidDataException("The bundled E3:AJ wire catalog is missing.");
        using var compressed = new GZipStream(resource, CompressionMode.Decompress);
        using var buffer = new MemoryStream();
        compressed.CopyTo(buffer);
        if (buffer.Length is < 1 or > 4_000_000)
            throw new InvalidDataException("The bundled E3:AJ wire catalog has an invalid size.");
        var content = buffer.ToArray();
        using var json = JsonDocument.Parse(content);
        var root = json.RootElement;
        if (root.GetProperty("sourceId").GetString() != SourceId)
            throw new InvalidDataException("The bundled wire catalog has the wrong source ID.");
        var rows = root.GetProperty("records");
        if (rows.ValueKind != JsonValueKind.Array || rows.GetArrayLength() != 260)
            throw new InvalidDataException("The bundled E3:AJ wire catalog has an invalid row count.");
        var records = rows.EnumerateArray().Select(row => new ReferenceCatalogRecordInput(
            row.GetProperty("entityType").GetString()!,
            row.GetProperty("sourceKey").GetString()!,
            row.GetProperty("payload").Clone(),
            row.GetProperty("sourceLocation").GetString())).ToArray();
        if (records.Any(record => record.EntityType != "wire" ||
            !record.Payload.TryGetProperty("Марка", out var mark) ||
            mark.ValueKind != JsonValueKind.String || string.IsNullOrWhiteSpace(mark.GetString())))
            throw new InvalidDataException("The bundled E3:AJ wire catalog contains invalid rows.");

        var fingerprint = "sha256:" + Convert.ToHexStringLower(SHA256.HashData(content)) + ";profile:technology.wires";
        var validation = ReferenceCatalogDraft.Create(
            ReferenceCatalogSnapshotIdentity.New(), SourceId, 1, DateTimeOffset.UtcNow,
            new ReferenceCatalogProvenanceInput("xlsx", fingerprint, "bundled:wire-catalog-E3-AJ"),
            records).Validate();
        if (!validation.IsValid)
            throw new InvalidDataException("The bundled E3:AJ wire catalog failed validation.");
        var publication = new ReferenceCatalogPublicationService(store).Publish(
            new ReferenceCatalogPublicationRequest(validation, null, validation.Snapshot!.Sha256,
                validation.RequiredWarningAcknowledgements));
        if (publication.Status != ReferenceCatalogPublicationStatus.Published &&
            publication.Status != ReferenceCatalogPublicationStatus.Unchanged &&
            store.GetActive(SourceId) is null)
            throw new InvalidDataException("The bundled E3:AJ wire catalog could not be published.");
    }
}
