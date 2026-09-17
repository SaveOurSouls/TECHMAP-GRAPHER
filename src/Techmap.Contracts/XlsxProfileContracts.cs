using System.Text.Json.Serialization;

namespace Techmap.Contracts;

public sealed record XlsxProfilePreviewRequest(
    string? FileName,
    string? ContentBase64,
    string? ProfileId);

public sealed record XlsxKnownProfileResponse(
    string ProfileId,
    string DisplayName,
    string SourceId,
    string SheetName,
    string EntityType,
    string KeyColumn,
    string Description);

public sealed record GoogleSheetsProfilePreviewRequest(
    [property: JsonPropertyName("url")] string? Url,
    string? ProfileId);

public sealed record GoogleSheetsSyncRequest(
    [property: JsonPropertyName("url")] string? Url);

public sealed record GoogleSheetsSyncProfileResponse(
    string ProfileId,
    string SourceId,
    string Status,
    int RecordCount,
    Guid? SnapshotId,
    IReadOnlyList<ReferenceCatalogDiagnosticResponse> Diagnostics,
    ApiErrorResponse? Error = null);

public sealed record GoogleSheetsSyncResponse(
    string FileName,
    string SourceSha256,
    IReadOnlyList<GoogleSheetsSyncProfileResponse> Profiles);
