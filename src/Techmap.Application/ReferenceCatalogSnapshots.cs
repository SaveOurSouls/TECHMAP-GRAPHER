using Techmap.Domain;

namespace Techmap.Application;

public sealed record ReferenceCatalogPublicationRequest(
    ReferenceCatalogValidationResult Validation,
    ReferenceCatalogSnapshotIdentity? ExpectedActiveSnapshotId,
    string ExpectedValidationSha256,
    IReadOnlyCollection<string> AcknowledgedWarningIds);

public enum ReferenceCatalogStorePublishStatus
{
    Published,
    Unchanged,
    ActiveSnapshotConflict,
}

public sealed record ReferenceCatalogStorePublishResult(
    ReferenceCatalogStorePublishStatus Status,
    ReferenceCatalogSnapshotIdentity? PreviousActiveSnapshotId,
    ReferenceCatalogSnapshot? EffectiveSnapshot = null);

public sealed record ReferenceCatalogSourceSummary(
    string SourceId,
    string DisplayName,
    string SourceKind,
    ReferenceCatalogSnapshotIdentity ActiveSnapshotId,
    int RecordCount,
    DateTimeOffset CapturedUtc);

public interface IReferenceCatalogSnapshotStore
{
    ReferenceCatalogSnapshot? GetActive(string sourceId);
    ReferenceCatalogSnapshot? Get(ReferenceCatalogSnapshotIdentity snapshotId);
    IReadOnlyList<ReferenceCatalogSnapshot> List(string sourceId);
    IReadOnlyList<ReferenceCatalogSourceSummary> ListActiveSources();

    // The candidate and active pointer must be committed atomically. A conflict or exception must
    // leave the prior active snapshot and all previously published versions unchanged.
    ReferenceCatalogStorePublishResult TryPublish(
        ReferenceCatalogSnapshot candidate,
        ReferenceCatalogSnapshotIdentity? expectedActiveSnapshotId);
}

public enum ReferenceCatalogPublicationStatus
{
    Published,
    Unchanged,
    ValidationFailed,
    ValidationChanged,
    WarningAcknowledgementMismatch,
    ActiveSnapshotConflict,
}

public sealed record ReferenceCatalogPublicationResult(
    ReferenceCatalogPublicationStatus Status,
    ReferenceCatalogSnapshot? PublishedSnapshot = null,
    ReferenceCatalogSnapshotIdentity? PreviousActiveSnapshotId = null);

public sealed class ReferenceCatalogPublicationService(IReferenceCatalogSnapshotStore store)
{
    public ReferenceCatalogPublicationResult Publish(ReferenceCatalogPublicationRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(request.Validation);
        ArgumentNullException.ThrowIfNull(request.AcknowledgedWarningIds);

        var snapshot = request.Validation.Snapshot;
        if (snapshot is null)
            return new ReferenceCatalogPublicationResult(ReferenceCatalogPublicationStatus.ValidationFailed);

        if (!string.Equals(request.ExpectedValidationSha256, snapshot.Sha256, StringComparison.Ordinal))
            return new ReferenceCatalogPublicationResult(ReferenceCatalogPublicationStatus.ValidationChanged);

        var required = request.Validation.RequiredWarningAcknowledgements.ToHashSet(StringComparer.Ordinal);
        var acknowledged = request.AcknowledgedWarningIds.ToHashSet(StringComparer.Ordinal);
        if (acknowledged.Count != request.AcknowledgedWarningIds.Count || !required.SetEquals(acknowledged))
            return new ReferenceCatalogPublicationResult(ReferenceCatalogPublicationStatus.WarningAcknowledgementMismatch);

        var stored = store.TryPublish(snapshot, request.ExpectedActiveSnapshotId);
        return stored.Status switch
        {
            ReferenceCatalogStorePublishStatus.Published => new ReferenceCatalogPublicationResult(
                ReferenceCatalogPublicationStatus.Published,
                stored.EffectiveSnapshot ?? snapshot,
                stored.PreviousActiveSnapshotId),
            ReferenceCatalogStorePublishStatus.Unchanged => new ReferenceCatalogPublicationResult(
                ReferenceCatalogPublicationStatus.Unchanged,
                stored.EffectiveSnapshot,
                stored.PreviousActiveSnapshotId),
            _ => new ReferenceCatalogPublicationResult(
                ReferenceCatalogPublicationStatus.ActiveSnapshotConflict,
                PreviousActiveSnapshotId: stored.PreviousActiveSnapshotId),
        };
    }
}
