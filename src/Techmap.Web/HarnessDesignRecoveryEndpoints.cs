using System.Text.Json;
using Techmap.Application;
using Techmap.Contracts;

namespace Techmap.Web;

public static class HarnessDesignRecoveryEndpoints
{
    public static void MapHarnessDesignRecoveryEndpoints(this WebApplication app)
    {
        const string route = "/api/v1/projects/{projectId:guid}/harnesses/{harnessId:guid}/design/recovery";
        app.MapGet(route, (HttpContext context, Guid projectId, Guid harnessId,
            LocalHttpSession session, HarnessDesignRecoveryJournal journal) =>
            session.HasValidCookie(context.Request)
                ? Execute(() => Results.Ok(journal.List(projectId, harnessId)))
                : Results.Json(new ApiErrorResponse("invalid_session"), statusCode: 401));
        app.MapPut(route + "/{draftId:guid}", async (HttpContext context, Guid projectId, Guid harnessId,
            Guid draftId, LocalHttpSession session, HarnessDesignRecoveryJournal journal, CancellationToken cancellationToken) =>
        {
            if (!session.HasValidCookie(context.Request)) return Results.Json(new ApiErrorResponse("invalid_session"), statusCode: 401);
            try
            {
                const int maximum = HarnessDesignRecoveryJournal.MaximumContentBytes + 4096;
                using var buffer = new MemoryStream();
                var bytes = new byte[16384];
                int read;
                while ((read = await context.Request.Body.ReadAsync(bytes, cancellationToken)) > 0)
                {
                    if (buffer.Length + read > maximum)
                        return Results.Json(new ApiErrorResponse("recovery_too_large"), statusCode: 413);
                    buffer.Write(bytes, 0, read);
                }
                var request = JsonSerializer.Deserialize<PutHarnessDesignRecoveryRequest>(buffer.ToArray(), new JsonSerializerOptions(JsonSerializerDefaults.Web));
                return request is null ? Results.BadRequest() : Execute(() => Results.Ok(journal.Put(projectId, harnessId, draftId, request)));
            }
            catch (JsonException) { return Results.Json(new ApiErrorResponse("invalid_recovery_draft"), statusCode: 400); }
        });
        app.MapDelete(route + "/{draftId:guid}", (HttpContext context, Guid projectId, Guid harnessId, Guid draftId,
            long sequence, LocalHttpSession session, HarnessDesignRecoveryJournal journal) =>
        {
            if (!session.HasValidCookie(context.Request)) return Results.Json(new ApiErrorResponse("invalid_session"), statusCode: 401);
            return Execute(() =>
        {
            journal.Delete(projectId, harnessId, draftId, sequence);
            return Results.NoContent();
        });
        });
    }

    private static IResult Execute(Func<IResult> action)
    {
        try { return action(); }
        catch (HarnessDesignDocumentException error)
        {
            var status = error.Code switch {
                "project_not_found" or "harness_not_found" => 404,
                "recovery_sequence_conflict" or "recovery_limit" => 409,
                "recovery_too_large" => 413, _ => 400 };
            return Results.Json(new ApiErrorResponse(error.Code, Message: error.Message), statusCode: status);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException)
        {
            return Results.Json(new ApiErrorResponse("recovery_unavailable", Message: "Аварийный журнал недоступен. Сохраните копию документа."), statusCode: 503);
        }
    }
}
