using System.Text;
using System.Text.Json;
using Techmap.Application;
using Techmap.Contracts;
using Techmap.Domain;
using Techmap.Infrastructure.Sqlite;

namespace Techmap.Web;

public static class HarnessDesignEndpoints
{
    public const long MaximumRequestBytes = SqliteHarnessDesignDocumentStore.MaximumContentBytes + 4096L;

    public static void MapHarnessDesignEndpoints(this WebApplication app)
    {
        const string route =
            "/api/v1/projects/{projectId:guid}/harnesses/{harnessId:guid}/design";

        app.MapGet(route, (
            HttpContext context,
            Guid projectId,
            Guid harnessId,
            LocalHttpSession session,
            IHarnessDesignDocumentStore store) =>
            session.HasValidCookie(context.Request)
                ? Execute(() => Results.Ok(ToResponse(store.Get(
                    new ProjectIdentity(projectId),
                    new HarnessIdentity(harnessId)))))
                : Results.Json(
                    new ApiErrorResponse("invalid_session"),
                    statusCode: StatusCodes.Status401Unauthorized));

        app.MapPut(route, async (
            HttpContext context,
            Guid projectId,
            Guid harnessId,
            IHarnessDesignDocumentStore store,
            CancellationToken cancellationToken) =>
            await ExecuteAsync(async () =>
            {
                if (context.Request.ContentLength is > MaximumRequestBytes)
                {
                    throw new HarnessDesignDocumentException(
                        "design_content_too_large",
                        $"The harness design request must not exceed {MaximumRequestBytes} bytes.",
                        "content");
                }

                PutHarnessDesignRequest? request;
                try
                {
                    request = await ReadRequestAsync(context.Request, cancellationToken);
                }
                catch (JsonException error)
                {
                    throw new HarnessDesignDocumentException(
                        "invalid_design_content",
                        "The harness design request is not valid JSON.",
                        "content",
                        innerException: error);
                }

                if (request?.ExpectedRevision is null)
                {
                    throw new HarnessDesignDocumentException(
                        "invalid_design_expected_revision",
                        "The expected design revision is required.",
                        "expectedRevision");
                }
                if (request.Content.ValueKind == JsonValueKind.Undefined)
                {
                    throw new HarnessDesignDocumentException(
                        "invalid_design_content",
                        "The harness design content is required.",
                        "content");
                }

                var contentJson = request.Content.GetRawText();
                if (Encoding.UTF8.GetByteCount(contentJson) >
                    SqliteHarnessDesignDocumentStore.MaximumContentBytes)
                {
                    throw new HarnessDesignDocumentException(
                        "design_content_too_large",
                        $"The harness design content must not exceed " +
                        $"{SqliteHarnessDesignDocumentStore.MaximumContentBytes} UTF-8 bytes.",
                        "content");
                }

                return Results.Ok(ToResponse(store.Put(
                    new ProjectIdentity(projectId),
                    new HarnessIdentity(harnessId),
                    request.ExpectedRevision.Value,
                    request.SchemaVersion,
                    contentJson,
                    request.WriterContractVersion)));
            }));
    }

    private static HarnessDesignResponse ToResponse(HarnessDesignDocument document)
    {
        using var content = JsonDocument.Parse(document.ContentJson);
        return new HarnessDesignResponse(
            document.HarnessId.Value,
            document.SchemaVersion,
            document.Revision,
            content.RootElement.Clone(),
            document.CreatedUtc,
            document.UpdatedUtc,
            document.SourceFingerprint,
            document.HarnessQuantity);
    }

    private static async Task<PutHarnessDesignRequest?> ReadRequestAsync(
        HttpRequest request,
        CancellationToken cancellationToken)
    {
        using var buffer = new MemoryStream();
        var bytes = new byte[16 * 1024];
        while (true)
        {
            var count = await request.Body.ReadAsync(bytes, cancellationToken);
            if (count == 0) break;
            if (buffer.Length + count > MaximumRequestBytes)
            {
                throw new HarnessDesignDocumentException(
                    "design_content_too_large",
                    $"The harness design request must not exceed {MaximumRequestBytes} bytes.",
                    "content");
            }
            buffer.Write(bytes, 0, count);
        }
        return JsonSerializer.Deserialize<PutHarnessDesignRequest>(
            buffer.ToArray(),
            new JsonSerializerOptions(JsonSerializerDefaults.Web));
    }

    private static IResult Execute(Func<IResult> operation)
    {
        try
        {
            return operation();
        }
        catch (HarnessDesignDocumentException error)
        {
            return Error(error);
        }
    }

    private static async Task<IResult> ExecuteAsync(Func<Task<IResult>> operation)
    {
        try
        {
            return await operation();
        }
        catch (HarnessDesignDocumentException error)
        {
            return Error(error);
        }
    }

    private static IResult Error(HarnessDesignDocumentException error)
    {
        var status = error.Code switch
        {
            "project_not_found" or "harness_not_found" => StatusCodes.Status404NotFound,
            "design_revision_conflict" or "design_writer_upgrade_required" or "manufacturing_route_source_stale" => StatusCodes.Status409Conflict,
            "design_content_too_large" => StatusCodes.Status413PayloadTooLarge,
            _ => StatusCodes.Status400BadRequest,
        };
        return Results.Json(
            new ApiErrorResponse(error.Code, error.Field, error.Message, error.CurrentRevision),
            statusCode: status);
    }
}
