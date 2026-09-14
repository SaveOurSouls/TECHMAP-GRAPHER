using Techmap.Application;
using Techmap.Contracts;
using Techmap.Domain;
using Techmap.Infrastructure.GoogleSheets;
using Techmap.Infrastructure.Xlsx;

namespace Techmap.Web;

public static class GoogleSheetsReferenceEndpoints
{
    public static void MapGoogleSheetsReferenceEndpoints(this WebApplication app)
    {
        app.MapPost("/api/v1/reference-sources/{sourceId}/google-sheets-profile-previews", async (
            string sourceId,
            GoogleSheetsProfilePreviewRequest request,
            IGoogleSheetsWorkbookDownloader downloader,
            XlsxPreviewCatalog previews,
            IReferenceCatalogSnapshotStore store,
            CancellationToken cancellationToken) => await ExecuteAsync(async () =>
        {
            var profile = XlsxKnownProfiles.Get(request.ProfileId ?? "");
            if (!string.Equals(sourceId, profile.SourceId, StringComparison.Ordinal))
            {
                throw new GoogleSheetsEndpointException(
                    "google_sheets_profile_source_mismatch",
                    $"Для профиля «{profile.DisplayName}» используйте источник «{profile.SourceId}».");
            }

            using var importLease = previews.TryBeginImport();
            if (importLease is null)
            {
                throw new GoogleSheetsEndpointException(
                    "google_sheets_import_busy",
                    "Дождитесь завершения текущей проверки справочника.");
            }

            var download = await downloader.DownloadAsync(request.Url ?? "", cancellationToken)
                .ConfigureAwait(false);
            var preview = await new XlsxReferenceCatalogReader().PreviewAsync(
                new MemoryStream(download.Content, writable: false),
                download.SafeFileName,
                sourceId,
                profile.Mapping,
                ReferenceCatalogSnapshotIdentity.New(),
                DateTimeOffset.UtcNow,
                cancellationToken).ConfigureAwait(false);
            var active = store.GetActive(sourceId)?.SnapshotId.Value;
            var stored = previews.Add(sourceId, preview, active);
            return Results.Ok(ToResponse(stored.Id, stored.ExpiresUtc, active, sourceId, preview));
        }));
    }

    private static XlsxReferencePreviewResponse ToResponse(
        Guid previewId,
        DateTimeOffset expiresUtc,
        Guid? activeSnapshotId,
        string sourceId,
        XlsxCatalogPreview preview) => new(
        previewId,
        expiresUtc,
        activeSnapshotId,
        preview.Validation.Snapshot?.SnapshotId.Value ?? Guid.Empty,
        sourceId,
        preview.FileName,
        preview.SourceSha256,
        preview.Sheets.Select(sheet => new XlsxSheetResponse(sheet.Name, sheet.Hidden)).ToArray(),
        preview.SelectedSheet,
        checked((int)preview.HeaderRow),
        checked((int)preview.FirstDataRow),
        preview.EntityType,
        preview.KeyColumn,
        preview.Columns.Select(column => new XlsxResolvedColumnResponse(
            column.Header, column.ColumnIndex, column.TargetProperty, column.ValueKind)).ToArray(),
        preview.SourceRowCount,
        preview.RecordCount,
        preview.IsTruncated,
        preview.Validation.Snapshot?.Sha256,
        preview.Validation.IsValid,
        preview.Records.Select(record => new XlsxPreviewRecordResponse(
            checked((int)record.RowNumber), record.SourceKey, record.Payload, record.SourceLocation)).ToArray(),
        preview.Validation.Diagnostics.Select(ToResponse).ToArray());

    private static ReferenceCatalogDiagnosticResponse ToResponse(ReferenceCatalogDiagnostic diagnostic) => new(
        diagnostic.DiagnosticId,
        diagnostic.Severity == ReferenceCatalogDiagnosticSeverity.Warning ? "warning" : "error",
        diagnostic.Code,
        diagnostic.Message,
        diagnostic.EntityType,
        diagnostic.SourceKey,
        diagnostic.Field,
        diagnostic.SourceLocation);

    private static async Task<IResult> ExecuteAsync(Func<Task<IResult>> action)
    {
        try
        {
            return await action().ConfigureAwait(false);
        }
        catch (Exception error)
        {
            return Handled(error);
        }
    }

    private static IResult Handled(Exception error) => error switch
    {
        OperationCanceledException => Error(499, "request_cancelled", "Операция отменена."),
        GoogleSheetsDownloadException download => Error(
            download.Code switch
            {
                "google_sheets_too_large" => StatusCodes.Status413PayloadTooLarge,
                "google_sheets_download_busy" => StatusCodes.Status429TooManyRequests,
                "google_sheets_download_timeout" or "google_sheets_unavailable" => StatusCodes.Status503ServiceUnavailable,
                "google_sheets_access_denied" => StatusCodes.Status403Forbidden,
                "google_sheets_not_found" => StatusCodes.Status404NotFound,
                "google_sheets_address_forbidden" or "google_sheets_content_encoding_forbidden" =>
                    StatusCodes.Status422UnprocessableEntity,
                "google_sheets_redirect_limit" or "google_sheets_redirect_invalid" or
                    "google_sheets_redirect_forbidden" or "google_sheets_not_xlsx" =>
                    StatusCodes.Status422UnprocessableEntity,
                _ => StatusCodes.Status400BadRequest,
            },
            download.Code,
            download.Message),
        XlsxImportException xlsx => Error(
            xlsx.Code is "xlsx_too_large" or "xlsx_part_too_large" or
                "xlsx_expanded_size_limit" or "xlsx_candidate_too_large"
                ? StatusCodes.Status413PayloadTooLarge
                : StatusCodes.Status422UnprocessableEntity,
            xlsx.Code,
            xlsx.Message,
            xlsx.SourceLocation),
        GoogleSheetsEndpointException endpoint => Error(
            endpoint.Code == "google_sheets_import_busy"
                ? StatusCodes.Status429TooManyRequests
                : StatusCodes.Status400BadRequest,
            endpoint.Code,
            endpoint.Message),
        XlsxPreviewCatalogException preview => Error(
            StatusCodes.Status413PayloadTooLarge,
            preview.Code,
            preview.Message),
        ArgumentException argument => Error(
            StatusCodes.Status422UnprocessableEntity,
            "google_sheets_mapping_invalid",
            argument.Message),
        _ => throw error,
    };

    private static IResult Error(int status, string code, string message, string? field = null) =>
        Results.Json(new ApiErrorResponse(code, field, message), statusCode: status);

    private sealed class GoogleSheetsEndpointException(string code, string message) : Exception(message)
    {
        public string Code { get; } = code;
    }
}
