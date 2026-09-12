using Techmap.Application;
using Techmap.Contracts;
using Techmap.Domain;

namespace Techmap.Web;

public static class ProjectEndpoints
{
    public static void MapProjectEndpoints(this WebApplication app)
    {
        app.MapGet("/api/v1/projects", (
            HttpContext context,
            LocalHttpSession session,
            IProjectCatalog catalog) =>
            WithReadSession(context, session, () =>
                Results.Ok(new ProjectListResponse(
                    catalog.ListProjects().Select(ToResponse).ToArray()))));

        app.MapPost("/api/v1/projects", (
            HttpContext context,
            CreateProjectRequest request,
            IProjectCatalog catalog) =>
            Execute(() =>
            {
                var status = request.Status is null
                    ? ProjectStatus.Draft
                    : ParseStatus(request.Status);
                var project = catalog.CreateProject(new CreateProjectCommand(
                    request.Designation!,
                    request.Name!,
                    request.BatchQuantity,
                    status));
                return Results.Created(ProjectLocation(context, project.ProjectId), ToResponse(project));
            }));

        app.MapGet("/api/v1/projects/{projectId:guid}", (
            HttpContext context,
            Guid projectId,
            LocalHttpSession session,
            IProjectCatalog catalog) =>
            WithReadSession(context, session, () =>
                Execute(() => Results.Ok(ToResponse(
                    catalog.GetProject(new ProjectIdentity(projectId)))))));

        app.MapMethods(
            "/api/v1/projects/{projectId:guid}",
            [HttpMethods.Patch],
            (HttpContext context, Guid projectId, UpdateProjectRequest request, IProjectCatalog catalog) =>
                Execute(() =>
                {
                    ProjectStatus? status = request.Status is null
                        ? null
                        : ParseStatus(request.Status);
                    var project = catalog.UpdateProject(
                        new ProjectIdentity(projectId),
                        new UpdateProjectCommand(
                            request.Designation,
                            request.Name,
                            request.BatchQuantity,
                            status));
                    return Results.Ok(ToResponse(project));
                }));

        app.MapPost("/api/v1/projects/{projectId:guid}/copies", (
            HttpContext context,
            Guid projectId,
            IProjectCatalog catalog) =>
            Execute(() =>
            {
                var copy = catalog.CopyProject(new ProjectIdentity(projectId));
                return Results.Created(ProjectLocation(context, copy.ProjectId), ToResponse(copy));
            }));

        app.MapPost("/api/v1/projects/{projectId:guid}/harnesses", (
            Guid projectId,
            AddHarnessRequest request,
            IProjectCatalog catalog) =>
            Execute(() => Results.Ok(ToResponse(
                catalog.AddHarness(new ProjectIdentity(projectId), request.Designation!)))));

        app.MapDelete("/api/v1/projects/{projectId:guid}/harnesses/{harnessId:guid}", (
            Guid projectId,
            Guid harnessId,
            IProjectCatalog catalog) =>
            Execute(() => Results.Ok(ToResponse(catalog.DeleteHarness(
                new ProjectIdentity(projectId),
                new HarnessIdentity(harnessId))))));
    }

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
        catch (ProjectCatalogException error)
        {
            var statusCode = error.Code switch
            {
                "project_not_found" or "harness_not_found" => StatusCodes.Status404NotFound,
                "harness_limit_reached" => StatusCodes.Status409Conflict,
                _ => StatusCodes.Status400BadRequest,
            };
            return Results.Json(
                new ApiErrorResponse(error.Code, error.Field, error.Message),
                statusCode: statusCode);
        }
    }

    private static ProjectStatus ParseStatus(string value)
    {
        if (!ProjectRules.TryParseStatus(value, out var status))
        {
            throw new ProjectCatalogException(
                "invalid_status",
                "The project status must be draft, active or completed.",
                "status");
        }

        return status;
    }

    private static string ProjectLocation(HttpContext context, ProjectIdentity projectId) =>
        $"{context.Request.PathBase}/api/v1/projects/{projectId.Value:D}";

    private static ProjectSummaryResponse ToResponse(ProjectSummary project) => new(
        project.ProjectId.Value,
        project.Designation,
        project.Increment,
        project.Name,
        project.BatchQuantity,
        ProjectRules.ToCode(project.Status),
        project.HarnessCount,
        project.CreatedUtc,
        project.UpdatedUtc);

    private static ProjectDetailsResponse ToResponse(ProjectDetails project) => new(
        project.ProjectId.Value,
        project.Designation,
        project.Increment,
        project.Name,
        project.BatchQuantity,
        ProjectRules.ToCode(project.Status),
        project.CreatedUtc,
        project.UpdatedUtc,
        project.Harnesses.Select(harness => new HarnessResponse(
            harness.HarnessId.Value,
            harness.Designation,
            harness.SortOrder,
            harness.CreatedUtc,
            harness.UpdatedUtc)).ToArray());
}
