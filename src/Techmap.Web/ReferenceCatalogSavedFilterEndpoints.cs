using Techmap.Application;
using Techmap.Contracts;

namespace Techmap.Web;

public static class ReferenceCatalogSavedFilterEndpoints
{
    public static void MapReferenceCatalogSavedFilterEndpoints(this WebApplication app)
    {
        app.MapGet("/api/v1/reference-sources/{sourceId}/saved-filters", (
            HttpContext context,
            string sourceId,
            LocalHttpSession session,
            IReferenceCatalogSavedFilterStore store) =>
            session.HasValidCookie(context.Request)
                ? Execute(() => Results.Ok(new ReferenceCatalogSavedFilterListResponse(
                    store.List(sourceId).Select(ToResponse).ToArray())))
                : Results.Json(
                    new ApiErrorResponse("invalid_session"),
                    statusCode: StatusCodes.Status401Unauthorized));

        app.MapPost("/api/v1/reference-sources/{sourceId}/saved-filters", (
            HttpContext context,
            string sourceId,
            CreateReferenceCatalogSavedFilterRequest request,
            IReferenceCatalogSavedFilterStore store) => Execute(() =>
        {
            var saved = store.Create(
                sourceId,
                request.Name ?? throw Invalid("A saved filter name is required."),
                ParseQuery(request.Query));
            return Results.Created(
                $"{context.Request.PathBase}/api/v1/reference-sources/{Uri.EscapeDataString(sourceId)}/saved-filters/{saved.FilterId:D}",
                ToResponse(saved));
        }));

        app.MapPut("/api/v1/reference-sources/{sourceId}/saved-filters/{filterId:guid}", (
            string sourceId,
            Guid filterId,
            UpdateReferenceCatalogSavedFilterRequest request,
            IReferenceCatalogSavedFilterStore store) => Execute(() => Results.Ok(ToResponse(
                store.Update(
                    sourceId,
                    filterId,
                    request.Name ?? throw Invalid("A saved filter name is required."),
                    ParseQuery(request.Query))))));

        app.MapDelete("/api/v1/reference-sources/{sourceId}/saved-filters/{filterId:guid}", (
            string sourceId,
            Guid filterId,
            IReferenceCatalogSavedFilterStore store) => Execute(() =>
        {
            store.Delete(sourceId, filterId);
            return Results.NoContent();
        }));
    }

    private static ReferenceCatalogSavedFilterQuery ParseQuery(
        ReferenceCatalogSavedFilterQueryRequest? request)
    {
        if (request?.EntityTypes is null || request.Filters is null)
            throw Invalid("A saved filter query with entityTypes and filters arrays is required.");
        return new ReferenceCatalogSavedFilterQuery(
            request.Text,
            request.ExactSourceKey,
            request.EntityTypes,
            request.Filters.Select(ParseFilter).ToArray(),
            request.FilterLogic switch
            {
                null or "all" => ReferenceCatalogFilterLogic.All,
                "any" => ReferenceCatalogFilterLogic.Any,
                _ => throw Invalid("The saved filter logic must be all or any."),
            },
            request.Sort switch
            {
                null or "relevance" => ReferenceCatalogSort.Relevance,
                "source-key-asc" => ReferenceCatalogSort.SourceKeyAscending,
                "source-key-desc" => ReferenceCatalogSort.SourceKeyDescending,
                "entity-type-asc" => ReferenceCatalogSort.EntityTypeAscending,
                _ => throw Invalid("The saved filter sort is unsupported."),
            });
    }

    private static ReferenceCatalogFilterCondition ParseFilter(
        ReferenceCatalogSearchFilterRequest? filter)
    {
        if (filter is null) throw Invalid("A saved filter condition is required.");
        return new ReferenceCatalogFilterCondition(
            filter.Field ?? "",
            filter.Operator switch
            {
                "eq" => ReferenceCatalogFilterOperator.TextEquals,
                "prefix" => ReferenceCatalogFilterOperator.TextPrefix,
                "exists" => ReferenceCatalogFilterOperator.Exists,
                "missing" => ReferenceCatalogFilterOperator.Missing,
                "null" => ReferenceCatalogFilterOperator.IsNull,
                "blank" => ReferenceCatalogFilterOperator.IsBlank,
                _ => throw Invalid("A saved filter operator is unsupported."),
            },
            filter.Value);
    }

    private static ReferenceCatalogSavedFilterResponse ToResponse(
        ReferenceCatalogSavedFilter saved)
    {
        var query = saved.Query.Query;
        return new ReferenceCatalogSavedFilterResponse(
            saved.FilterId,
            saved.SourceId,
            saved.Name,
            new ReferenceCatalogSavedFilterQueryResponse(
                saved.Query.Version,
                query.Text,
                query.ExactSourceKey,
                query.EntityTypes,
                query.Filters.Select(filter => new ReferenceCatalogSavedFilterConditionResponse(
                    filter.Field,
                    FormatOperator(filter.Operator),
                    filter.Value)).ToArray(),
                query.FilterLogic == ReferenceCatalogFilterLogic.All ? "all" : "any",
                query.Sort switch
                {
                    ReferenceCatalogSort.Relevance => "relevance",
                    ReferenceCatalogSort.SourceKeyAscending => "source-key-asc",
                    ReferenceCatalogSort.SourceKeyDescending => "source-key-desc",
                    ReferenceCatalogSort.EntityTypeAscending => "entity-type-asc",
                    _ => throw new InvalidDataException("A saved filter has an unsupported sort."),
                }),
            saved.Query.Sha256,
            saved.CreatedUtc,
            saved.UpdatedUtc);
    }

    private static string FormatOperator(ReferenceCatalogFilterOperator value) => value switch
    {
        ReferenceCatalogFilterOperator.TextEquals => "eq",
        ReferenceCatalogFilterOperator.TextPrefix => "prefix",
        ReferenceCatalogFilterOperator.Exists => "exists",
        ReferenceCatalogFilterOperator.Missing => "missing",
        ReferenceCatalogFilterOperator.IsNull => "null",
        ReferenceCatalogFilterOperator.IsBlank => "blank",
        _ => throw new InvalidDataException("A saved filter has an unsupported operator."),
    };

    private static IResult Execute(Func<IResult> operation)
    {
        try
        {
            return operation();
        }
        catch (ReferenceCatalogSavedFilterException error)
        {
            var status = error.Code switch
            {
                "catalog_reference_source_not_found" => StatusCodes.Status404NotFound,
                "catalog_saved_filter_not_found" => StatusCodes.Status404NotFound,
                "catalog_saved_filter_name_conflict" => StatusCodes.Status409Conflict,
                "catalog_saved_filter_corrupt" => StatusCodes.Status500InternalServerError,
                _ => StatusCodes.Status400BadRequest,
            };
            return Results.Json(
                new ApiErrorResponse(error.Code, Message: error.Message),
                statusCode: status);
        }
        catch (ArgumentException error)
        {
            return Results.Json(
                new ApiErrorResponse("catalog_saved_filter_invalid", Message: error.Message),
                statusCode: StatusCodes.Status400BadRequest);
        }
        catch (InvalidDataException)
        {
            return Results.Json(
                new ApiErrorResponse(
                    "catalog_saved_filter_corrupt",
                    Message: "A saved catalog filter is corrupt."),
                statusCode: StatusCodes.Status500InternalServerError);
        }
    }

    private static ReferenceCatalogSavedFilterException Invalid(string message) =>
        new("catalog_saved_filter_invalid", message);
}
