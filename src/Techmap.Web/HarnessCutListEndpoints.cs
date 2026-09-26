using Techmap.Application;
using Techmap.Contracts;
using Techmap.Domain;

namespace Techmap.Web;

public static class HarnessCutListEndpoints
{
    public static void MapHarnessCutListEndpoints(this WebApplication app)
    {
        app.MapGet(
            "/api/v1/projects/{projectId:guid}/harnesses/{harnessId:guid}/cut-list",
            (HttpContext context,
                Guid projectId,
                Guid harnessId,
                LocalHttpSession session,
                IHarnessCutListService service) =>
                session.HasValidCookie(context.Request)
                    ? Execute(() => Results.Ok(ToResponse(service.Get(
                        new ProjectIdentity(projectId),
                        new HarnessIdentity(harnessId)))))
                    : Results.Json(
                        new ApiErrorResponse("invalid_session"),
                        statusCode: StatusCodes.Status401Unauthorized));
    }

    private static HarnessCutListResponse ToResponse(HarnessCutList cutList) => new(
        cutList.ProjectId.Value,
        cutList.HarnessId.Value,
        cutList.HarnessQuantity,
        cutList.Status,
        cutList.Warning,
        cutList.Items.Select(item => new HarnessCutListItemResponse(
            item.WireId,
            item.Circuit,
            item.Material,
            item.MaterialSourceKey,
            item.MaterialDisplayName,
            item.SourceLengthMm,
            item.EndCorrectionFromMm,
            item.EndCorrectionToMm,
            item.RoundingStepMm,
            item.CutLengthMm,
            item.Pieces,
            item.TotalMetres,
            item.Status,
            item.Warnings,
            item.SourceKind)).ToArray());

    private static IResult Execute(Func<IResult> operation)
    {
        try
        {
            return operation();
        }
        catch (HarnessCutListException error)
        {
            var status = error.Code is "project_not_found" or "harness_not_found"
                ? StatusCodes.Status404NotFound
                : StatusCodes.Status400BadRequest;
            return Results.Json(
                new ApiErrorResponse(error.Code, error.Field, error.Message),
                statusCode: status);
        }
    }
}
