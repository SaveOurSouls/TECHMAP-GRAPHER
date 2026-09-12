namespace Techmap.Contracts;

public static class ApiContract
{
    public const int MajorVersion = 1;
}

public sealed record HealthResponse(string Status, int ApiVersion, string InstanceId);

public sealed record RuntimeConfigResponse(
    int ConfigVersion,
    string BasePath,
    string ApiBasePath,
    string AppVersion,
    string ApiVersion,
    string SchemaVersion);

public sealed record StorageDiagnosticsResponse(
    string Status,
    int SchemaVersion,
    string SqliteVersion,
    bool ForeignKeysEnabled,
    int BusyTimeoutMilliseconds,
    string JournalMode);

public sealed record ApiErrorResponse(
    string Error,
    string? Field = null,
    string? Message = null);

public sealed record SessionBootstrapResponse(string CsrfNonce, string InstanceId);

public sealed record CreateProjectRequest(
    string? Designation,
    string? Name,
    long BatchQuantity,
    string? Status);

public sealed record UpdateProjectRequest(
    string? Designation = null,
    string? Name = null,
    long? BatchQuantity = null,
    string? Status = null);

public sealed record AddHarnessRequest(string? Designation);

public sealed record ProjectListResponse(IReadOnlyList<ProjectSummaryResponse> Projects);

public sealed record ProjectSummaryResponse(
    Guid ProjectId,
    string Designation,
    long Increment,
    string Name,
    long BatchQuantity,
    string Status,
    int HarnessCount,
    DateTimeOffset CreatedUtc,
    DateTimeOffset UpdatedUtc);

public sealed record HarnessResponse(
    Guid HarnessId,
    string Designation,
    int SortOrder,
    DateTimeOffset CreatedUtc,
    DateTimeOffset UpdatedUtc);

public sealed record ProjectDetailsResponse(
    Guid ProjectId,
    string Designation,
    long Increment,
    string Name,
    long BatchQuantity,
    string Status,
    DateTimeOffset CreatedUtc,
    DateTimeOffset UpdatedUtc,
    IReadOnlyList<HarnessResponse> Harnesses);

public sealed record CreateAttachmentRequest(
    string? FileName,
    string? MediaType,
    string? Purpose,
    string? ContentBase64);

public sealed record ProjectAttachmentResponse(
    Guid AttachmentId,
    Guid ProjectId,
    string Sha256,
    long SizeBytes,
    string FileName,
    string MediaType,
    string Purpose,
    DateTimeOffset CreatedUtc);

public sealed record ProjectAttachmentListResponse(
    IReadOnlyList<ProjectAttachmentResponse> Attachments);

public sealed record AttachmentValidationResponse(Guid AttachmentId, string Status);
