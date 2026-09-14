using System.Text.Json;
using Techmap.Application;
using Techmap.Contracts;
using Techmap.Infrastructure.Sqlite;

namespace Techmap.Web;

public static class ComponentTemplateEndpoints
{
    public const long MaximumRequestBytes = SqliteComponentTemplateStore.MaximumContentBytes + 128 * 1024L;

    public static void MapComponentTemplateEndpoints(this WebApplication app)
    {
        const string route = "/api/v1/component-templates";

        app.MapGet(route, (
            HttpContext context,
            LocalHttpSession session,
            IComponentTemplateStore store) =>
            HasSession(context, session, () => Results.Ok(new ComponentTemplateListResponse(
                store.List().Select(ToSummaryResponse).ToArray()))));

        app.MapGet(route + "/{templateId:guid}", (
            HttpContext context,
            Guid templateId,
            LocalHttpSession session,
            IComponentTemplateStore store) =>
            HasSession(context, session, () => Results.Ok(ToResponse(store.Get(templateId)))));

        app.MapGet(route + "/{templateId:guid}/versions", (
            HttpContext context,
            Guid templateId,
            LocalHttpSession session,
            IComponentTemplateStore store) =>
            HasSession(context, session, () => Results.Ok(new ComponentTemplateVersionListResponse(
                store.ListVersions(templateId).Select(ToResponse).ToArray()))));

        app.MapGet(route + "/{templateId:guid}/versions/{version:int}", (
            HttpContext context,
            Guid templateId,
            int version,
            LocalHttpSession session,
            IComponentTemplateStore store) =>
            HasSession(context, session, () => Results.Ok(ToResponse(store.GetVersion(templateId, version)))));

        app.MapPost(route, async (
            HttpContext context,
            IComponentTemplateStore store,
            CancellationToken cancellationToken) => await ExecuteAsync(async () =>
        {
            var request = await ReadRequestAsync<CreateComponentTemplateRequest>(context.Request, cancellationToken);
            var result = store.Create(
                Required(request?.Code, "code"),
                Required(request?.Name, "name"),
                Bindings(request?.ArticleBindings),
                ContentSchemaVersion(request?.Content ?? default),
                ContentJson(request?.Content ?? default));
            return Results.Created(
                $"{context.Request.PathBase}{route}/{result.TemplateId:D}",
                ToResponse(result));
        }));

        app.MapPut(route + "/{templateId:guid}", async (
            HttpContext context,
            Guid templateId,
            IComponentTemplateStore store,
            CancellationToken cancellationToken) => await ExecuteAsync(async () =>
        {
            var request = await ReadRequestAsync<UpdateComponentTemplateRequest>(context.Request, cancellationToken);
            if (request?.ExpectedVersion is null)
                throw Invalid("component_template_expected_version_invalid", "Expected version is required.", "expectedVersion");
            var result = store.Update(
                templateId,
                request.ExpectedVersion.Value,
                Required(request.Code, "code"),
                Required(request.Name, "name"),
                Bindings(request.ArticleBindings),
                ContentSchemaVersion(request.Content),
                ContentJson(request.Content));
            return Results.Ok(ToResponse(result));
        }));

        app.MapDelete(route + "/{templateId:guid}", async (
            HttpContext context,
            Guid templateId,
            IComponentTemplateStore store,
            CancellationToken cancellationToken) => await ExecuteAsync(async () =>
        {
            var request = await ReadRequestAsync<DeleteComponentTemplateRequest>(context.Request, cancellationToken);
            if (request?.ExpectedVersion is null)
                throw Invalid("component_template_expected_version_invalid", "Expected version is required.", "expectedVersion");
            store.Delete(templateId, request.ExpectedVersion.Value);
            return Results.NoContent();
        }));
    }

    private static IResult HasSession(
        HttpContext context,
        LocalHttpSession session,
        Func<IResult> operation) =>
        session.HasValidCookie(context.Request)
            ? Execute(operation)
            : Results.Json(
                new ApiErrorResponse("invalid_session"),
                statusCode: StatusCodes.Status401Unauthorized);

    private static async Task<T?> ReadRequestAsync<T>(HttpRequest request, CancellationToken cancellationToken)
    {
        if (request.ContentLength is > MaximumRequestBytes)
            throw Invalid("component_template_content_too_large", "The component template request is too large.", "content");
        using var buffer = new MemoryStream();
        var bytes = new byte[16 * 1024];
        while (true)
        {
            var count = await request.Body.ReadAsync(bytes, cancellationToken);
            if (count == 0) break;
            if (buffer.Length + count > MaximumRequestBytes)
                throw Invalid("component_template_content_too_large", "The component template request is too large.", "content");
            buffer.Write(bytes, 0, count);
        }

        try
        {
            return JsonSerializer.Deserialize<T>(buffer.ToArray(), new JsonSerializerOptions(JsonSerializerDefaults.Web));
        }
        catch (JsonException error)
        {
            throw new ComponentTemplateException(
                "component_template_request_invalid",
                "The component template request is not valid JSON.",
                innerException: error);
        }
    }

    private static IReadOnlyList<ComponentTemplateArticleBinding> Bindings(
        IReadOnlyList<ComponentTemplateArticleBindingRequest>? bindings)
    {
        if (bindings is null)
            throw Invalid("component_template_bindings_invalid", "Article bindings are required.", "articleBindings");
        return bindings.Select(binding => binding is null
            ? throw Invalid("component_template_bindings_invalid", "An article binding is required.", "articleBindings")
            : new ComponentTemplateArticleBinding(
                Required(binding.SourceId, "articleBindings.sourceId"),
                Required(binding.EntityType, "articleBindings.entityType"),
                Required(binding.ArticleKey, "articleBindings.articleKey"))).ToArray();
    }

    private static int ContentSchemaVersion(JsonElement content)
    {
        if (content.ValueKind != JsonValueKind.Object ||
            !content.TryGetProperty("schemaVersion", out var version) ||
            version.ValueKind != JsonValueKind.Number ||
            !version.TryGetInt32(out var result))
        {
            throw Invalid(
                "component_template_content_invalid",
                "Content must contain an integer schemaVersion.",
                "content.schemaVersion");
        }
        return result;
    }

    private static string ContentJson(JsonElement content)
    {
        if (content.ValueKind == JsonValueKind.Undefined)
            throw Invalid("component_template_content_invalid", "Content is required.", "content");
        return content.GetRawText();
    }

    private static string Required(string? value, string field) =>
        value ?? throw Invalid("component_template_invalid", $"{field} is required.", field);

    private static ComponentTemplateSummaryResponse ToSummaryResponse(ComponentTemplateSummary value) => new(
        value.TemplateId,
        value.Version,
        value.Code,
        value.Name,
        value.ArticleBindings.Select(ToResponse).ToArray(),
        value.CreatedUtc,
        value.UpdatedUtc);

    private static ComponentTemplateResponse ToResponse(ComponentTemplateVersion value)
    {
        using var content = JsonDocument.Parse(value.ContentJson);
        return new ComponentTemplateResponse(
            value.TemplateId,
            value.Version,
            value.Code,
            value.Name,
            value.ArticleBindings.Select(ToResponse).ToArray(),
            content.RootElement.Clone(),
            value.CreatedUtc,
            value.UpdatedUtc);
    }

    private static ComponentTemplateArticleBindingResponse ToResponse(ComponentTemplateArticleBinding value) =>
        new(value.SourceId, value.EntityType, value.ArticleKey);

    private static IResult Execute(Func<IResult> operation)
    {
        try { return operation(); }
        catch (ComponentTemplateException error) { return Error(error); }
    }

    private static async Task<IResult> ExecuteAsync(Func<Task<IResult>> operation)
    {
        try { return await operation(); }
        catch (ComponentTemplateException error) { return Error(error); }
    }

    private static IResult Error(ComponentTemplateException error)
    {
        var status = error.Code switch
        {
            "component_template_not_found" or "component_template_version_not_found" => StatusCodes.Status404NotFound,
            "component_template_version_conflict" or "component_template_code_conflict" => StatusCodes.Status409Conflict,
            "component_template_content_too_large" => StatusCodes.Status413PayloadTooLarge,
            "component_template_corrupt" => StatusCodes.Status500InternalServerError,
            _ => StatusCodes.Status400BadRequest,
        };
        return Results.Json(
            new ApiErrorResponse(
                error.Code,
                error.Field,
                error.Message,
                CurrentVersion: error.CurrentVersion),
            statusCode: status);
    }

    private static ComponentTemplateException Invalid(string code, string message, string? field = null) =>
        new(code, message, field);
}
