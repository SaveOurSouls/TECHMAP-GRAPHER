using System.Text.Json;
using Techmap.Domain;

namespace Techmap.Application;

/// <summary>
/// Project-owned, immutable copy of one published component-template version.
/// The source template is provenance only; a project never follows its mutable head.
/// </summary>
public sealed record ProjectComponentSnapshot(
    Guid SnapshotId,
    ProjectIdentity ProjectId,
    Guid SourceTemplateId,
    int SourceVersion,
    string SourceVersionSha256,
    string Code,
    string Name,
    IReadOnlyList<ComponentTemplateArticleBinding> ArticleBindings,
    IReadOnlyList<ComponentTemplateAsset> Assets,
    int SchemaVersion,
    string ContentJson,
    DateTimeOffset CreatedUtc,
    DateTimeOffset UpdatedUtc);

public sealed record ProjectComponentPlacement(
    Guid PlacementId,
    HarnessIdentity HarnessId,
    Guid SnapshotId,
    string SourceId,
    string EntityType,
    string ArticleKey,
    string InstanceJson,
    DateTimeOffset CreatedUtc,
    DateTimeOffset UpdatedUtc);

public sealed record PlaceComponentCommand(
    Guid CommandId,
    long ExpectedRevision,
    Guid PlacementId,
    Guid SourceTemplateId,
    int SourceVersion,
    string? SourceId,
    string? EntityType,
    string? ArticleKey,
    JsonElement Instance);

public sealed record ComponentPlacementMutation(
    Guid CommandId,
    long ExpectedRevision,
    long ResultingRevision,
    ProjectComponentSnapshot Snapshot,
    ProjectComponentPlacement Placement);

public interface IProjectComponentSnapshotStore
{
    IReadOnlyList<ProjectComponentSnapshot> ListSnapshots(ProjectIdentity projectId);
    IReadOnlyList<ProjectComponentPlacement> ListPlacements(ProjectIdentity projectId, HarnessIdentity harnessId);
    ComponentPlacementMutation Place(
        ProjectIdentity projectId,
        HarnessIdentity harnessId,
        ProjectCommandEnvelope envelope,
        Guid placementId,
        ComponentTemplateVersion source,
        string? sourceId,
        string? entityType,
        string? articleKey,
        string instanceJson);
}

public sealed class ProjectComponentSnapshotException : Exception
{
    public ProjectComponentSnapshotException(
        string code,
        string message,
        string? field = null,
        long? currentRevision = null,
        Exception? innerException = null)
        : base(message, innerException)
    {
        Code = code;
        Field = field;
        CurrentRevision = currentRevision;
    }

    public string Code { get; }
    public string? Field { get; }
    public long? CurrentRevision { get; }
}
