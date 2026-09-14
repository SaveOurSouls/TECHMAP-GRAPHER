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
