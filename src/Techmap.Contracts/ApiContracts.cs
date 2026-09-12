using System.Text.Json;

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
    string? Message = null,
    long? CurrentRevision = null,
    IReadOnlyList<ReferenceCatalogDiagnosticResponse>? Diagnostics = null);

public sealed record SessionBootstrapResponse(string CsrfNonce, string InstanceId);

public sealed record CreateProjectRequest(
    string? Designation,
    string? Name,
    long? BatchQuantity = null,
    string? Status = null);

public sealed record UpdateProjectRequest(
    Guid CommandId,
    long? ExpectedRevision,
    string? Designation = null,
    string? Name = null,
    long? BatchQuantity = null,
    string? Status = null);

public sealed record AddHarnessRequest(
    Guid CommandId,
    long? ExpectedRevision,
    string? Designation,
    long? Quantity = null);

public sealed record UpdateHarnessQuantityRequest(
    Guid CommandId,
    long? ExpectedRevision,
    long? Quantity);

public sealed record DeleteHarnessRequest(Guid CommandId, long? ExpectedRevision);

public sealed record ProjectListResponse(IReadOnlyList<ProjectSummaryResponse> Projects);

public sealed record ProjectSummaryResponse(
    Guid ProjectId,
    string Designation,
    long Increment,
    string Name,
    long BatchQuantity,
    string Status,
    long Revision,
    int HarnessCount,
    DateTimeOffset CreatedUtc,
    DateTimeOffset UpdatedUtc);

public sealed record HarnessResponse(
    Guid HarnessId,
    string Designation,
    long Quantity,
    int SortOrder,
    DateTimeOffset CreatedUtc,
    DateTimeOffset UpdatedUtc,
    IReadOnlyList<HarnessDocumentResponse> Documents);

public sealed record HarnessDocumentResponse(
    Guid DocumentId,
    string Kind,
    string Status,
    DateTimeOffset CreatedUtc,
    DateTimeOffset UpdatedUtc);

public sealed record ProjectDetailsResponse(
    Guid ProjectId,
    string Designation,
    long Increment,
    string Name,
    long BatchQuantity,
    string Status,
    long Revision,
    DateTimeOffset CreatedUtc,
    DateTimeOffset UpdatedUtc,
    IReadOnlyList<HarnessResponse> Harnesses);

public sealed record ProjectCommandResponse(
    Guid CommandId,
    long ExpectedRevision,
    long ResultingRevision,
    ProjectDetailsResponse Project);

public sealed record ProjectVersionResponse(
    long Revision,
    Guid CommandId,
    string CommandType,
    DateTimeOffset AcceptedUtc);

public sealed record ProjectVersionListResponse(
    IReadOnlyList<ProjectVersionResponse> Versions);

public sealed record CreateAttachmentRequest(
    Guid CommandId,
    long? ExpectedRevision,
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

public sealed record ProjectAttachmentCommandResponse(
    Guid CommandId,
    long ExpectedRevision,
    long ResultingRevision,
    ProjectAttachmentResponse Attachment);

public sealed record ProjectAttachmentListResponse(
    IReadOnlyList<ProjectAttachmentResponse> Attachments);

public sealed record AttachmentValidationResponse(Guid AttachmentId, string Status);

public sealed record PutHarnessDesignRequest(
    long? ExpectedRevision,
    int SchemaVersion,
    JsonElement Content);

public sealed record HarnessDesignResponse(
    Guid HarnessId,
    int SchemaVersion,
    long Revision,
    JsonElement Content,
    DateTimeOffset CreatedUtc,
    DateTimeOffset UpdatedUtc);

public sealed record ReferenceCatalogRecordInputRequest(
    string? EntityType,
    string? SourceKey,
    JsonElement Payload,
    string? SourceLocation = null);

public sealed record ReferenceCatalogDiagnosticInputRequest(
    string? Severity,
    string? Code,
    string? Message,
    string? EntityType = null,
    string? SourceKey = null,
    string? Field = null,
    string? SourceLocation = null);

public sealed record PublishReferenceCatalogRequest(
    Guid SnapshotId,
    int ContractVersion,
    DateTimeOffset CapturedUtc,
    string? SourceKind,
    string? VersionFingerprint,
    string? SourceUri,
    IReadOnlyList<ReferenceCatalogRecordInputRequest>? Records,
    IReadOnlyList<ReferenceCatalogDiagnosticInputRequest>? Diagnostics,
    Guid? ExpectedActiveSnapshotId,
    string? ExpectedValidationSha256,
    IReadOnlyList<string>? AcknowledgedWarningIds);

public sealed record ValidateReferenceCatalogRequest(
    Guid SnapshotId,
    int ContractVersion,
    DateTimeOffset CapturedUtc,
    string? SourceKind,
    string? VersionFingerprint,
    string? SourceUri,
    IReadOnlyList<ReferenceCatalogRecordInputRequest>? Records,
    IReadOnlyList<ReferenceCatalogDiagnosticInputRequest>? Diagnostics);

public sealed record ReferenceCatalogRecordResponse(
    string RecordId,
    string EntityType,
    string SourceKey,
    JsonElement Payload,
    string? SourceLocation);

public sealed record ReferenceCatalogDiagnosticResponse(
    string DiagnosticId,
    string Severity,
    string Code,
    string Message,
    string? EntityType,
    string? SourceKey,
    string? Field,
    string? SourceLocation);

public sealed record ReferenceCatalogSnapshotResponse(
    Guid SnapshotId,
    string SourceId,
    int ContractVersion,
    DateTimeOffset CapturedUtc,
    string SourceKind,
    string VersionFingerprint,
    string? SourceUri,
    string Sha256,
    IReadOnlyList<ReferenceCatalogRecordResponse> Records,
    IReadOnlyList<ReferenceCatalogDiagnosticResponse> Diagnostics);

public sealed record ReferenceCatalogPublicationResponse(
    string Status,
    Guid? PreviousActiveSnapshotId,
    ReferenceCatalogSnapshotResponse Snapshot);

public sealed record ReferenceCatalogRecordListResponse(
    Guid SnapshotId,
    string SnapshotSha256,
    IReadOnlyList<ReferenceCatalogRecordResponse> Records);

public sealed record ReferenceCatalogSearchFilterRequest(
    string? Field,
    string? Operator,
    string? Value = null);

public sealed record ReferenceCatalogSearchRequest(
    string? Text,
    string? ExactSourceKey,
    IReadOnlyList<string>? EntityTypes,
    IReadOnlyList<ReferenceCatalogSearchFilterRequest>? Filters,
    string? FilterLogic,
    string? Sort,
    int PageSize = 40,
    string? Cursor = null);

public sealed record ReferenceCatalogSearchRecordResponse(
    string RecordId,
    string EntityType,
    string SourceKey,
    JsonElement Payload,
    string? SourceLocation);

public sealed record ReferenceCatalogSearchResponse(
    Guid SnapshotId,
    string SnapshotSha256,
    IReadOnlyList<ReferenceCatalogSearchRecordResponse> Items,
    string? NextCursor);

public sealed record ReferenceCatalogSavedFilterQueryRequest(
    string? Text,
    string? ExactSourceKey,
    IReadOnlyList<string>? EntityTypes,
    IReadOnlyList<ReferenceCatalogSearchFilterRequest>? Filters,
    string? FilterLogic,
    string? Sort);

public sealed record CreateReferenceCatalogSavedFilterRequest(
    string? Name,
    ReferenceCatalogSavedFilterQueryRequest? Query);

public sealed record UpdateReferenceCatalogSavedFilterRequest(
    string? Name,
    ReferenceCatalogSavedFilterQueryRequest? Query);

public sealed record ReferenceCatalogSavedFilterConditionResponse(
    string Field,
    string Operator,
    string? Value);

public sealed record ReferenceCatalogSavedFilterQueryResponse(
    int Version,
    string? Text,
    string? ExactSourceKey,
    IReadOnlyList<string> EntityTypes,
    IReadOnlyList<ReferenceCatalogSavedFilterConditionResponse> Filters,
    string FilterLogic,
    string Sort);

public sealed record ReferenceCatalogSavedFilterResponse(
    Guid FilterId,
    string SourceId,
    string Name,
    ReferenceCatalogSavedFilterQueryResponse Query,
    string QuerySha256,
    DateTimeOffset CreatedUtc,
    DateTimeOffset UpdatedUtc);

public sealed record ReferenceCatalogSavedFilterListResponse(
    IReadOnlyList<ReferenceCatalogSavedFilterResponse> Items);

public sealed record XlsxSheetResponse(string Name, bool Hidden);

public sealed record XlsxResolvedColumnResponse(
    string Header,
    int ColumnIndex,
    string TargetProperty,
    string ValueKind);

public sealed record XlsxPreviewRecordResponse(
    int RowNumber,
    string SourceKey,
    JsonElement Payload,
    string SourceLocation);

public sealed record XlsxReferencePreviewResponse(
    Guid PreviewId,
    DateTimeOffset ExpiresUtc,
    Guid? ActiveSnapshotId,
    Guid SnapshotId,
    string SourceId,
    string FileName,
    string SourceSha256,
    IReadOnlyList<XlsxSheetResponse> Sheets,
    string SelectedSheet,
    int HeaderRow,
    int FirstDataRow,
    string EntityType,
    string KeyColumn,
    IReadOnlyList<XlsxResolvedColumnResponse> Columns,
    int SourceRowCount,
    int RecordCount,
    bool IsTruncated,
    string? ValidationSha256,
    bool CanPublish,
    IReadOnlyList<XlsxPreviewRecordResponse> Records,
    IReadOnlyList<ReferenceCatalogDiagnosticResponse> Diagnostics);

public sealed record PublishXlsxReferencePreviewRequest(
    Guid PreviewId,
    string? ExpectedValidationSha256,
    Guid? ExpectedActiveSnapshotId,
    IReadOnlyList<string>? AcknowledgedWarningIds);

public sealed record XlsxFieldMappingRequest(
    string? SourceColumn,
    string? TargetProperty,
    string? ValueKind,
    bool Required = false,
    IReadOnlyList<string>? NotApplicableTokens = null,
    bool AllowBlank = false,
    bool AllowNotApplicable = false);

public sealed record XlsxReferencePreviewRequest(
    string? FileName,
    string? ContentBase64,
    string? SheetName,
    int HeaderRow,
    int FirstDataRow,
    string? EntityType,
    string? KeyColumn,
    IReadOnlyList<XlsxFieldMappingRequest>? Fields);
