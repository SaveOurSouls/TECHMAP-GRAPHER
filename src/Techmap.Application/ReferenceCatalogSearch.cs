using System.Text.Json;
using Techmap.Domain;

namespace Techmap.Application;

public enum ReferenceCatalogFilterLogic { All, Any }
public enum ReferenceCatalogFilterOperator
{
    TextEquals,
    TextPrefix,
    Exists,
    Missing,
    IsNull,
    IsBlank,
}
public enum ReferenceCatalogSort
{
    Relevance,
    SourceKeyAscending,
    SourceKeyDescending,
    EntityTypeAscending,
}

public sealed record ReferenceCatalogFilterCondition(
    string Field,
    ReferenceCatalogFilterOperator Operator,
    string? Value = null);

public sealed record ReferenceCatalogSearchQuery(
    string? Text,
    string? ExactSourceKey,
    IReadOnlyList<string> EntityTypes,
    IReadOnlyList<ReferenceCatalogFilterCondition> Filters,
    ReferenceCatalogFilterLogic FilterLogic,
    ReferenceCatalogSort Sort,
    int PageSize);

public sealed record ReferenceCatalogSearchPosition(
    int Rank,
    string NormalizedSourceKey,
    string SourceKey,
    string EntityType);

public sealed record ReferenceCatalogSearchRecord(
    string RecordId,
    string EntityType,
    string SourceKey,
    JsonElement Payload,
    string? SourceLocation);

public sealed record ReferenceCatalogSearchPage(
    ReferenceCatalogSnapshotIdentity SnapshotId,
    string SnapshotSha256,
    IReadOnlyList<ReferenceCatalogSearchRecord> Records,
    bool HasMore,
    ReferenceCatalogSearchPosition? NextPosition);

public interface IReferenceCatalogSearchStore
{
    Task<ReferenceCatalogSearchPage> SearchAsync(
        string sourceId,
        ReferenceCatalogSnapshotIdentity? pinnedSnapshotId,
        ReferenceCatalogSearchQuery query,
        ReferenceCatalogSearchPosition? after,
        CancellationToken cancellationToken);
}
