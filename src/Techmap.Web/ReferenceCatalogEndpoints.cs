using Techmap.Application;
using Techmap.Contracts;
using Techmap.Domain;
using Techmap.Infrastructure.Sqlite;

namespace Techmap.Web;

public static class ReferenceCatalogEndpoints
{
    public const int MaximumRecordsPerPublication = 100_000;
    public const int MaximumDiagnosticsPerPublication = 100_000;

    public static void MapReferenceCatalogEndpoints(this WebApplication app)
    {
        app.MapGet("/api/v1/reference-sources", (
            HttpContext context,
            LocalHttpSession session,
            IReferenceCatalogSnapshotStore store) =>
            WithReadSession(context, session, () => Execute(() => Results.Ok(
                store.ListActiveSources().Select(source => new ReferenceCatalogSourceSummaryResponse(
                    source.SourceId,
                    source.DisplayName,
                    source.SourceKind,
                    source.ActiveSnapshotId.Value,
                    source.RecordCount,
                    source.CapturedUtc)).ToArray()))));

        app.MapPost("/api/v1/reference-sources/{sourceId}/catalog-searches", async (
            HttpContext context,
            string sourceId,
            ReferenceCatalogSearchRequest request,
            IReferenceCatalogSearchStore searchStore,
            ReferenceCatalogSearchCursorCodec cursorCodec) => await ExecuteAsync(async () =>
        {
            if (request.EntityTypes is null || request.Filters is null)
                throw new ReferenceCatalogSearchException(
                    "catalog_search_invalid", "Entity types and filters are required arrays.");
            var query = new ReferenceCatalogSearchQuery(
                request.Text,
                request.ExactSourceKey,
                request.EntityTypes,
                request.Filters.Select(ParseFilter).ToArray(),
                request.FilterLogic switch
                {
                    null or "all" => ReferenceCatalogFilterLogic.All,
                    "any" => ReferenceCatalogFilterLogic.Any,
                    _ => throw InvalidSearch("The filter logic must be all or any."),
                },
                request.Sort switch
                {
                    null or "relevance" => ReferenceCatalogSort.Relevance,
                    "source-key-asc" => ReferenceCatalogSort.SourceKeyAscending,
                    "source-key-desc" => ReferenceCatalogSort.SourceKeyDescending,
                    "entity-type-asc" => ReferenceCatalogSort.EntityTypeAscending,
                    _ => throw InvalidSearch("The catalog sort is unsupported."),
                },
                request.PageSize);
            var querySha256 = ReferenceCatalogSearchCursorCodec.QuerySha256(request);
            var decoded = request.Cursor is null
                ? null
                : cursorCodec.Decode(request.Cursor, sourceId, querySha256, request.PageSize);
            var page = await searchStore.SearchAsync(
                sourceId,
                decoded is null ? null : new ReferenceCatalogSnapshotIdentity(decoded.SnapshotId),
                query,
                decoded?.Position,
                context.RequestAborted);
            if (decoded is not null && !string.Equals(
                    decoded.SnapshotSha256, page.SnapshotSha256, StringComparison.Ordinal))
                throw new ReferenceCatalogSearchCursorException(
                    "catalog_cursor_invalid", "The catalog search cursor no longer matches its snapshot.");
            var nextCursor = page.HasMore && page.NextPosition is not null
                ? cursorCodec.Encode(
                    sourceId, page.SnapshotId.Value, page.SnapshotSha256,
                    querySha256, request.PageSize, page.NextPosition)
                : null;
            return Results.Ok(new ReferenceCatalogSearchResponse(
                page.SnapshotId.Value,
                page.SnapshotSha256,
                page.Records.Select(item => new ReferenceCatalogSearchRecordResponse(
                    item.RecordId, item.EntityType, item.SourceKey, item.Payload, item.SourceLocation)).ToArray(),
                nextCursor));
        }));

        app.MapGet("/api/v1/reference-sources/{sourceId}/active", (
            HttpContext context,
            string sourceId,
            LocalHttpSession session,
            IReferenceCatalogSnapshotStore store) =>
            WithReadSession(context, session, () => Execute(() =>
            {
                var snapshot = store.GetActive(sourceId)
                    ?? throw new ReferenceCatalogApiException(
                        "catalog_active_snapshot_not_found",
                        "The reference source does not have an active snapshot.");
                return Results.Ok(ToResponse(snapshot));
            })));

        app.MapGet("/api/v1/reference-sources/{sourceId}/active/records", (
            HttpContext context,
            string sourceId,
            LocalHttpSession session,
            IReferenceCatalogSnapshotStore store) =>
            WithReadSession(context, session, () => Execute(() =>
            {
                var snapshot = store.GetActive(sourceId)
                    ?? throw new ReferenceCatalogApiException(
                        "catalog_active_snapshot_not_found",
                        "The reference source does not have an active snapshot.");
                return Results.Ok(new ReferenceCatalogRecordListResponse(
                    snapshot.SnapshotId.Value,
                    snapshot.Sha256,
                    snapshot.Records.Select(ToResponse).ToArray()));
            })));

        app.MapPost("/api/v1/reference-sources/{sourceId}/validations", (
            string sourceId,
            ValidateReferenceCatalogRequest request) => Execute(() =>
        {
            RejectRequestSize(request.Records, request.Diagnostics, request.SourceKind, request.VersionFingerprint);
            var validation = BuildValidation(
                sourceId,
                request.ContractVersion,
                request.CapturedUtc,
                request.SourceKind!,
                request.VersionFingerprint!,
                request.SourceUri,
                request.Records!,
                request.Diagnostics!,
                request.SnapshotId);
            return validation.IsValid
                ? Results.Ok(ToResponse(validation.Snapshot!))
                : Results.Json(
                    new ApiErrorResponse(
                        "catalog_validation_failed",
                        Message: "The candidate has blocking validation errors.",
                        Diagnostics: validation.Diagnostics.Select(ToResponse).ToArray()),
                    statusCode: StatusCodes.Status422UnprocessableEntity);
        }));

        app.MapPost("/api/v1/reference-sources/{sourceId}/publications", (
            HttpContext context,
            string sourceId,
            PublishReferenceCatalogRequest request,
            IReferenceCatalogSnapshotStore store) => Execute(() =>
        {
            RejectRequestSize(request.Records, request.Diagnostics, request.SourceKind, request.VersionFingerprint);
            if (request.ExpectedValidationSha256 is null || request.AcknowledgedWarningIds is null)
            {
                throw new ReferenceCatalogApiException(
                    "catalog_payload_invalid",
                    "The validation hash and warning acknowledgement set are required.");
            }

            var validation = BuildValidation(
                sourceId,
                request.ContractVersion,
                request.CapturedUtc,
                request.SourceKind!,
                request.VersionFingerprint!,
                request.SourceUri,
                request.Records!,
                request.Diagnostics!,
                request.SnapshotId);
            if (!validation.IsValid)
            {
                return Results.Json(
                    new ApiErrorResponse(
                        "catalog_validation_failed",
                        Message: "The candidate has blocking validation errors.",
                        Diagnostics: validation.Diagnostics.Select(ToResponse).ToArray()),
                    statusCode: StatusCodes.Status422UnprocessableEntity);
            }

            var publication = new ReferenceCatalogPublicationService(store).Publish(
                new ReferenceCatalogPublicationRequest(
                    validation,
                    request.ExpectedActiveSnapshotId is Guid expected
                        ? new ReferenceCatalogSnapshotIdentity(expected)
                        : null,
                    request.ExpectedValidationSha256!,
                    request.AcknowledgedWarningIds!));
            return publication.Status switch
            {
                ReferenceCatalogPublicationStatus.Published => Results.Created(
                    $"{context.Request.PathBase}/api/v1/reference-sources/{Uri.EscapeDataString(sourceId)}/active",
                    ToPublicationResponse(publication)),
                ReferenceCatalogPublicationStatus.Unchanged => Results.Ok(ToPublicationResponse(publication)),
                ReferenceCatalogPublicationStatus.ValidationChanged => Conflict(
                    "catalog_validation_changed",
                    "The candidate validation hash changed."),
                ReferenceCatalogPublicationStatus.WarningAcknowledgementMismatch => Results.Json(
                    new ApiErrorResponse(
                        "catalog_warnings_require_acknowledgement",
                        Message: "The exact current warning set must be acknowledged.",
                        Diagnostics: validation.Diagnostics.Select(ToResponse).ToArray()),
                    statusCode: StatusCodes.Status409Conflict),
                ReferenceCatalogPublicationStatus.ActiveSnapshotConflict => Conflict(
                    "catalog_active_snapshot_changed",
                    "The active reference snapshot changed before publication."),
                _ => Results.Json(
                    new ApiErrorResponse("catalog_validation_failed"),
                    statusCode: StatusCodes.Status422UnprocessableEntity),
            };
        }));
    }

    private static ReferenceCatalogFilterCondition ParseFilter(ReferenceCatalogSearchFilterRequest? filter)
    {
        if (filter is null) throw InvalidSearch("A catalog filter condition is required.");
        return new(filter.Field ?? "", filter.Operator switch
        {
            "eq" => ReferenceCatalogFilterOperator.TextEquals,
            "prefix" => ReferenceCatalogFilterOperator.TextPrefix,
            "exists" => ReferenceCatalogFilterOperator.Exists,
            "missing" => ReferenceCatalogFilterOperator.Missing,
            "null" => ReferenceCatalogFilterOperator.IsNull,
            "blank" => ReferenceCatalogFilterOperator.IsBlank,
            _ => throw InvalidSearch("A catalog filter operator is unsupported."),
        }, filter.Value);
    }

    private static ReferenceCatalogSearchException InvalidSearch(string message) =>
        new("catalog_search_invalid", message);

    private static async Task<IResult> ExecuteAsync(Func<Task<IResult>> operation)
    {
        try { return await operation().ConfigureAwait(false); }
        catch (ReferenceCatalogSearchException error)
        {
            var status = error.Code switch
            {
                "catalog_active_snapshot_not_found" => StatusCodes.Status404NotFound,
                "catalog_cursor_snapshot_changed" => StatusCodes.Status409Conflict,
                _ => StatusCodes.Status400BadRequest,
            };
            return Results.Json(new ApiErrorResponse(error.Code, Message: error.Message), statusCode: status);
        }
        catch (ReferenceCatalogSearchCursorException error)
        {
            return Results.Json(new ApiErrorResponse(error.Code, Message: error.Message),
                statusCode: StatusCodes.Status400BadRequest);
        }
        catch (ArgumentException error)
        {
            return Results.Json(new ApiErrorResponse("catalog_search_invalid", Message: error.Message),
                statusCode: StatusCodes.Status400BadRequest);
        }
        catch (InvalidDataException)
        {
            return Results.Json(new ApiErrorResponse(
                    "catalog_snapshot_corrupt",
                    Message: "The searchable reference snapshot failed integrity validation."),
                statusCode: StatusCodes.Status500InternalServerError);
        }
    }

    private static ReferenceCatalogValidationResult BuildValidation(
        string sourceId,
        int contractVersion,
        DateTimeOffset capturedUtc,
        string sourceKind,
        string versionFingerprint,
        string? sourceUri,
        IReadOnlyList<ReferenceCatalogRecordInputRequest> records,
        IReadOnlyList<ReferenceCatalogDiagnosticInputRequest> diagnostics,
        Guid snapshotId) => ReferenceCatalogDraft.Create(
            new ReferenceCatalogSnapshotIdentity(snapshotId),
            sourceId,
            contractVersion,
            capturedUtc,
            new ReferenceCatalogProvenanceInput(sourceKind, versionFingerprint, sourceUri),
            records.Select(record => new ReferenceCatalogRecordInput(
                record.EntityType!,
                record.SourceKey!,
                record.Payload,
                record.SourceLocation)),
            diagnostics.Select(diagnostic => new ReferenceCatalogDiagnosticInput(
                ParseSeverity(diagnostic.Severity),
                diagnostic.Code!,
                diagnostic.Message!,
                diagnostic.EntityType,
                diagnostic.SourceKey,
                diagnostic.Field,
                diagnostic.SourceLocation))).Validate();

    private static void RejectRequestSize(
        IReadOnlyList<ReferenceCatalogRecordInputRequest>? records,
        IReadOnlyList<ReferenceCatalogDiagnosticInputRequest>? diagnostics,
        string? sourceKind,
        string? versionFingerprint)
    {
        if (records is null || diagnostics is null || sourceKind is null || versionFingerprint is null)
        {
            throw new ReferenceCatalogApiException(
                "catalog_payload_invalid",
                "The reference candidate is incomplete.");
        }

        if (records.Count > MaximumRecordsPerPublication ||
            diagnostics.Count > MaximumDiagnosticsPerPublication)
        {
            throw new ReferenceCatalogApiException(
                "catalog_snapshot_limit_exceeded",
                "The reference candidate exceeds the record or diagnostic limit.");
        }
    }

    private static ReferenceCatalogDiagnosticSeverity ParseSeverity(string? value) => value switch
    {
        "warning" => ReferenceCatalogDiagnosticSeverity.Warning,
        "error" => ReferenceCatalogDiagnosticSeverity.Error,
        _ => throw new ReferenceCatalogApiException(
            "catalog_payload_invalid",
            "A diagnostic severity must be warning or error."),
    };

    private static IResult WithReadSession(
        HttpContext context,
        LocalHttpSession session,
        Func<IResult> operation) =>
        session.HasValidCookie(context.Request)
            ? operation()
            : Results.Json(
                new ApiErrorResponse("invalid_session"),
                statusCode: StatusCodes.Status401Unauthorized);

    private static IResult Execute(Func<IResult> operation)
    {
        try
        {
            return operation();
        }
        catch (ReferenceCatalogApiException error)
        {
            var status = error.Code switch
            {
                "catalog_active_snapshot_not_found" => StatusCodes.Status404NotFound,
                "catalog_snapshot_limit_exceeded" => StatusCodes.Status413PayloadTooLarge,
                _ => StatusCodes.Status400BadRequest,
            };
            return Results.Json(new ApiErrorResponse(error.Code, Message: error.Message), statusCode: status);
        }
        catch (ReferenceCatalogStoreException error)
        {
            var status = error.Code == "catalog_snapshot_limit_exceeded"
                ? StatusCodes.Status413PayloadTooLarge
                : StatusCodes.Status409Conflict;
            return Results.Json(new ApiErrorResponse(error.Code, Message: error.Message), statusCode: status);
        }
        catch (ArgumentException error)
        {
            return Results.Json(
                new ApiErrorResponse("catalog_payload_invalid", Message: error.Message),
                statusCode: StatusCodes.Status422UnprocessableEntity);
        }
        catch (InvalidDataException)
        {
            return Results.Json(
                new ApiErrorResponse(
                    "catalog_snapshot_corrupt",
                    Message: "The active reference snapshot failed integrity validation."),
                statusCode: StatusCodes.Status500InternalServerError);
        }
    }

    private static IResult Conflict(string code, string message) => Results.Json(
        new ApiErrorResponse(code, Message: message),
        statusCode: StatusCodes.Status409Conflict);

    private static ReferenceCatalogPublicationResponse ToPublicationResponse(
        ReferenceCatalogPublicationResult publication) => new(
        publication.Status == ReferenceCatalogPublicationStatus.Unchanged ? "unchanged" : "published",
        publication.PreviousActiveSnapshotId?.Value,
        ToResponse(publication.PublishedSnapshot
            ?? throw new InvalidOperationException("A successful publication has no snapshot.")));

    private static ReferenceCatalogSnapshotResponse ToResponse(ReferenceCatalogSnapshot snapshot) => new(
        snapshot.SnapshotId.Value,
        snapshot.SourceId,
        snapshot.ContractVersion,
        snapshot.CapturedUtc,
        snapshot.Provenance.SourceKind,
        snapshot.Provenance.VersionFingerprint,
        snapshot.Provenance.SourceUri,
        snapshot.Sha256,
        snapshot.Records.Select(ToResponse).ToArray(),
        snapshot.Diagnostics.Select(ToResponse).ToArray());

    private static ReferenceCatalogRecordResponse ToResponse(ReferenceCatalogRecord record) => new(
        record.RecordId.Value,
        record.EntityType,
        record.SourceKey,
        record.Payload,
        record.SourceLocation);

    private static ReferenceCatalogDiagnosticResponse ToResponse(ReferenceCatalogDiagnostic diagnostic) => new(
        diagnostic.DiagnosticId,
        diagnostic.Severity == ReferenceCatalogDiagnosticSeverity.Warning ? "warning" : "error",
        diagnostic.Code,
        diagnostic.Message,
        diagnostic.EntityType,
        diagnostic.SourceKey,
        diagnostic.Field,
        diagnostic.SourceLocation);

    private sealed class ReferenceCatalogApiException(string code, string message) : Exception(message)
    {
        public string Code { get; } = code;
    }
}
