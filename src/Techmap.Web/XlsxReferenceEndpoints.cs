using Techmap.Application;
using Techmap.Contracts;
using Techmap.Domain;
using Techmap.Infrastructure.Sqlite;
using Techmap.Infrastructure.Xlsx;

namespace Techmap.Web;

public static class XlsxReferenceEndpoints
{
    private const int MaximumEncodedBytes = 35 * 1024 * 1024;
    public static void MapXlsxReferenceEndpoints(this WebApplication app)
    {
        app.MapGet("/api/v1/reference-import/xlsx-profiles", () => Results.Ok(
            XlsxKnownProfiles.All.Select(profile => new XlsxKnownProfileResponse(
                profile.Id,
                profile.DisplayName,
                profile.SourceId,
                profile.SheetName,
                profile.EntityType,
                profile.KeyColumn,
                profile.Description)).ToArray()));

        app.MapPost("/api/v1/reference-sources/{sourceId}/xlsx-profile-previews", async (
            string sourceId,
            XlsxProfilePreviewRequest request,
            XlsxPreviewCatalog previews,
            IReferenceCatalogSnapshotStore store,
            CancellationToken cancellationToken) => await ExecuteAsync(async () =>
        {
            using var importLease = previews.TryBeginImport();
            if (importLease is null)
                throw new XlsxEndpointException("xlsx_import_busy", "Дождитесь завершения текущей проверки XLSX.");
            if (string.IsNullOrWhiteSpace(request.FileName))
                throw new XlsxEndpointException("xlsx_mapping_invalid", "Выберите файл XLSX.");
            var profile = XlsxKnownProfiles.Get(request.ProfileId ?? "");
            if (!string.Equals(sourceId, profile.SourceId, StringComparison.Ordinal))
            {
                throw new XlsxEndpointException(
                    "xlsx_profile_source_mismatch",
                    $"Для профиля «{profile.DisplayName}» используйте источник «{profile.SourceId}».");
            }
            var bytes = Decode(request.ContentBase64);
            var snapshotId = ReferenceCatalogSnapshotIdentity.New();
            var preview = await new XlsxReferenceCatalogReader().PreviewAsync(
                new MemoryStream(bytes, writable: false),
                request.FileName,
                sourceId,
                profile.Mapping,
                snapshotId,
                DateTimeOffset.UtcNow,
                cancellationToken);
            var active = store.GetActive(sourceId)?.SnapshotId.Value;
            var stored = previews.Add(sourceId, preview, active);
            return Results.Ok(ToResponse(stored.Id, stored.ExpiresUtc, active, sourceId, preview));
        }));

        app.MapPost("/api/v1/reference-sources/{sourceId}/xlsx-previews", async (
            string sourceId,
            XlsxReferencePreviewRequest request,
            XlsxPreviewCatalog previews,
            IReferenceCatalogSnapshotStore store,
            CancellationToken cancellationToken) => await ExecuteAsync(async () =>
        {
            using var importLease = previews.TryBeginImport();
            if (importLease is null)
                throw new XlsxEndpointException("xlsx_import_busy", "Дождитесь завершения текущей проверки XLSX.");
            var bytes = Decode(request.ContentBase64);
            var mapping = Mapping(request);
            var snapshotId = ReferenceCatalogSnapshotIdentity.New();
            var preview = await new XlsxReferenceCatalogReader().PreviewAsync(
                new MemoryStream(bytes, writable: false),
                request.FileName!,
                sourceId,
                mapping,
                snapshotId,
                DateTimeOffset.UtcNow,
                cancellationToken);
            var active = store.GetActive(sourceId)?.SnapshotId.Value;
            var stored = previews.Add(sourceId, preview, active);
            return Results.Ok(ToResponse(stored.Id, stored.ExpiresUtc, active, sourceId, preview));
        }));

        app.MapPost("/api/v1/reference-sources/{sourceId}/xlsx-publications", (
            string sourceId,
            PublishXlsxReferencePreviewRequest request,
            XlsxPreviewCatalog previews,
            IReferenceCatalogSnapshotStore store) => Execute(() =>
        {
            if (!previews.TryGet(request.PreviewId, sourceId, out var preview, out var previewActive))
                throw new XlsxEndpointException("xlsx_preview_expired", "Предварительный просмотр истёк. Проверьте файл ещё раз.");
            if (request.ExpectedValidationSha256 is null || request.AcknowledgedWarningIds is null)
                throw new XlsxEndpointException("xlsx_publication_invalid", "Нужны хеш проверки и набор подтверждений.");
            if (request.ExpectedActiveSnapshotId != previewActive)
                throw new XlsxEndpointException("xlsx_preview_active_mismatch", "Активная версия при просмотре не совпадает с запросом публикации.");

            var publication = new ReferenceCatalogPublicationService(store).Publish(
                new ReferenceCatalogPublicationRequest(
                    preview.Validation,
                    previewActive is Guid expected ? new ReferenceCatalogSnapshotIdentity(expected) : null,
                    request.ExpectedValidationSha256,
                    request.AcknowledgedWarningIds));
            return publication.Status switch
            {
                ReferenceCatalogPublicationStatus.Published => Results.Created(
                    $"/api/v1/reference-sources/{Uri.EscapeDataString(sourceId)}/active",
                    ToPublicationResponse(publication)),
                ReferenceCatalogPublicationStatus.Unchanged => Results.Ok(ToPublicationResponse(publication)),
                ReferenceCatalogPublicationStatus.ValidationFailed => Error(
                    StatusCodes.Status422UnprocessableEntity,
                    "catalog_validation_failed",
                    "В файле остались блокирующие ошибки."),
                ReferenceCatalogPublicationStatus.ValidationChanged => Error(
                    StatusCodes.Status409Conflict,
                    "catalog_validation_changed",
                    "Содержимое проверки изменилось."),
                ReferenceCatalogPublicationStatus.WarningAcknowledgementMismatch => Error(
                    StatusCodes.Status409Conflict,
                    "catalog_warnings_require_acknowledgement",
                    "Подтвердите точный текущий набор предупреждений."),
                _ => Error(
                    StatusCodes.Status409Conflict,
                    "catalog_active_snapshot_changed",
                    "Активная версия справочника изменилась. Проверьте файл повторно."),
            };
        }));
    }

    private static XlsxCatalogMapping Mapping(XlsxReferencePreviewRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.FileName) ||
            string.IsNullOrWhiteSpace(request.EntityType) ||
            string.IsNullOrWhiteSpace(request.KeyColumn) ||
            request.HeaderRow is < 1 or > XlsxReferenceCatalogReader.MaximumRows ||
            request.FirstDataRow <= request.HeaderRow ||
            request.FirstDataRow > XlsxReferenceCatalogReader.MaximumRows)
        {
            throw new XlsxEndpointException("xlsx_mapping_invalid", "Проверьте имя файла, строки, тип записи и ключевой столбец.");
        }

        if (request.Fields is { Count: 0 } or { Count: > XlsxReferenceCatalogReader.MaximumMappedFields } ||
            request.Fields?.Any(field => field is null) == true)
            throw new XlsxEndpointException("xlsx_mapping_invalid", "Проверьте список сопоставляемых полей.");

        return new XlsxCatalogMapping(
            string.IsNullOrWhiteSpace(request.SheetName) ? null : request.SheetName,
            (uint)request.HeaderRow,
            (uint)request.FirstDataRow,
            request.EntityType,
            request.KeyColumn,
            request.Fields?.Select(field => new XlsxFieldMapping(
                field.SourceColumn ?? "",
                field.TargetProperty ?? "",
                field.ValueKind switch
                {
                    null or "raw" => XlsxFieldValueKind.RawScalar,
                    "text" => XlsxFieldValueKind.Text,
                    "int64" => XlsxFieldValueKind.Int64,
                    "decimal" => XlsxFieldValueKind.Decimal,
                    "boolean" => XlsxFieldValueKind.Boolean,
                    _ => throw new XlsxEndpointException("xlsx_mapping_invalid", "Неизвестный тип поля XLSX."),
                },
                field.Required,
                field.NotApplicableTokens,
                field.AllowBlank,
                field.AllowNotApplicable)).ToArray());
    }

    private static byte[] Decode(string? encoded)
    {
        if (encoded is null || encoded.Length == 0)
            throw new XlsxEndpointException("xlsx_content_required", "Выберите файл XLSX.");
        if (encoded.Length > MaximumEncodedBytes)
            throw new XlsxEndpointException("xlsx_too_large", "Файл XLSX превышает допустимый размер.");
        try
        {
            var bytes = Convert.FromBase64String(encoded);
            if (bytes.Length > XlsxReferenceCatalogReader.MaximumInputBytes)
                throw new XlsxEndpointException("xlsx_too_large", "Файл XLSX превышает допустимый размер.");
            return bytes;
        }
        catch (FormatException)
        {
            throw new XlsxEndpointException("xlsx_content_invalid", "Содержимое файла XLSX повреждено.");
        }
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

    private static ReferenceCatalogPublicationResponse ToPublicationResponse(
        ReferenceCatalogPublicationResult publication) => new(
        publication.Status == ReferenceCatalogPublicationStatus.Unchanged ? "unchanged" : "published",
        publication.PreviousActiveSnapshotId?.Value,
        ToResponse(publication.PublishedSnapshot
            ?? throw new InvalidOperationException("A successful XLSX publication has no snapshot.")));

    private static ReferenceCatalogSnapshotResponse ToResponse(ReferenceCatalogSnapshot snapshot) => new(
        snapshot.SnapshotId.Value,
        snapshot.SourceId,
        snapshot.ContractVersion,
        snapshot.CapturedUtc,
        snapshot.Provenance.SourceKind,
        snapshot.Provenance.VersionFingerprint,
        snapshot.Provenance.SourceUri,
        snapshot.Sha256,
        snapshot.Records.Select(record => new ReferenceCatalogRecordResponse(
            record.RecordId.Value,
            record.EntityType,
            record.SourceKey,
            record.Payload,
            record.SourceLocation)).ToArray(),
        snapshot.Diagnostics.Select(ToResponse).ToArray());

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
        try { return await action(); }
        catch (Exception error) { return Handled(error); }
    }

    private static IResult Execute(Func<IResult> action)
    {
        try { return action(); }
        catch (Exception error) { return Handled(error); }
    }

    private static IResult Handled(Exception error) => error switch
    {
        OperationCanceledException => Error(499, "request_cancelled", "Операция отменена."),
        XlsxImportException xlsx => Error(
            xlsx.Code is "xlsx_too_large" or "xlsx_part_too_large" or "xlsx_expanded_size_limit" or "xlsx_candidate_too_large"
                ? StatusCodes.Status413PayloadTooLarge
                : StatusCodes.Status422UnprocessableEntity,
            xlsx.Code,
            xlsx.Message,
            xlsx.SourceLocation),
        XlsxEndpointException endpoint => Error(
            endpoint.Code switch
            {
                "xlsx_preview_expired" => StatusCodes.Status410Gone,
                "xlsx_too_large" or "xlsx_preview_too_large" => StatusCodes.Status413PayloadTooLarge,
                "xlsx_import_busy" => StatusCodes.Status429TooManyRequests,
                "xlsx_preview_active_mismatch" => StatusCodes.Status409Conflict,
                "xlsx_content_invalid" => StatusCodes.Status422UnprocessableEntity,
                _ => StatusCodes.Status400BadRequest,
            },
            endpoint.Code,
            endpoint.Message),
        XlsxPreviewCatalogException preview => Error(
            StatusCodes.Status413PayloadTooLarge,
            preview.Code,
            preview.Message),
        ReferenceCatalogStoreException store => Error(StatusCodes.Status409Conflict, store.Code, store.Message),
        ArgumentException argument => Error(StatusCodes.Status422UnprocessableEntity, "xlsx_mapping_invalid", argument.Message),
        _ => throw error,
    };

    private static IResult Error(int status, string code, string message, string? field = null) =>
        Results.Json(new ApiErrorResponse(code, field, message), statusCode: status);

    private sealed class XlsxEndpointException(string code, string message) : Exception(message)
    {
        public string Code { get; } = code;
    }
}
