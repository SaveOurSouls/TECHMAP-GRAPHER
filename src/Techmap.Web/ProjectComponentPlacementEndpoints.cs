using System.Text.Json;
using Techmap.Application;
using Techmap.Contracts;
using Techmap.Domain;

namespace Techmap.Web;

public static class ProjectComponentPlacementEndpoints
{
    public static void MapProjectComponentPlacementEndpoints(this WebApplication app)
    {
        const string route =
            "/api/v1/projects/{projectId:guid}/harnesses/{harnessId:guid}/component-placements";

        app.MapGet(route, (
            HttpContext context,
            Guid projectId,
            Guid harnessId,
            LocalHttpSession session,
            IProjectComponentSnapshotStore store) =>
            session.HasValidCookie(context.Request)
                ? Execute(() => ReadHarnessComponents(projectId, harnessId, store))
                : Results.Json(new ApiErrorResponse("invalid_session"),
                    statusCode: StatusCodes.Status401Unauthorized));

        app.MapGet(route + "/snapshots/{snapshotId:guid}/assets/{assetId:guid}/content", async (
            HttpContext context,
            Guid projectId,
            Guid harnessId,
            Guid snapshotId,
            Guid assetId,
            LocalHttpSession session,
            IProjectComponentSnapshotStore store,
            IAttachmentContentStore contentStore,
            CancellationToken cancellationToken) =>
        {
            if (!session.HasValidCookie(context.Request))
                return Results.Json(new ApiErrorResponse("invalid_session"),
                    statusCode: StatusCodes.Status401Unauthorized);
            return await ExecuteAsync(async () =>
            {
                var graph = ReadActiveGraph(projectId, harnessId, store);
                var snapshot = graph.Snapshots.SingleOrDefault(item => item.SnapshotId == snapshotId)
                    ?? throw Invalid(
                        "component_snapshot_not_found",
                        "The component snapshot is not used by this harness.",
                        "snapshotId");
                var asset = snapshot.Assets.SingleOrDefault(item => item.AssetId == assetId)
                    ?? throw Invalid(
                        "component_snapshot_asset_not_found",
                        "The component snapshot image does not exist.",
                        "assetId");
                var stream = await contentStore.OpenReadVerifiedAsync(asset.Content, cancellationToken);
                return Results.Stream(stream, asset.MediaType, enableRangeProcessing: false);
            });
        });

        app.MapPost(route, (
            Guid projectId,
            Guid harnessId,
            PlaceComponentRequest request,
            IComponentTemplateStore templates,
            IProjectComponentSnapshotStore snapshots) => Execute(() =>
        {
            if (request.ExpectedRevision is null)
                throw Invalid("invalid_design_expected_revision", "The expected design revision is required.", "expectedRevision");
            if (request.Instance.ValueKind is JsonValueKind.Undefined or JsonValueKind.Null)
                throw Invalid("component_placement_invalid", "The component instance is required.", "instance");
            var source = templates.GetVersion(request.SourceTemplateId, request.SourceVersion);
            var result = snapshots.Place(
                new ProjectIdentity(projectId),
                new HarnessIdentity(harnessId),
                new ProjectCommandEnvelope(request.CommandId, request.ExpectedRevision.Value),
                request.PlacementId,
                source,
                request.SourceId,
                request.EntityType,
                request.ArticleKey,
                request.Instance.GetRawText());
            return Results.Ok(new ProjectComponentPlacementCommandResponse(
                result.CommandId,
                result.ExpectedRevision,
                result.ResultingRevision,
                ToResponse(result.Snapshot),
                ToResponse(result.Placement)));
        }));
    }

    private static IResult ReadHarnessComponents(
        Guid projectId,
        Guid harnessId,
        IProjectComponentSnapshotStore store)
    {
        var graph = ReadActiveGraph(projectId, harnessId, store);
        return Results.Ok(new ProjectComponentPlacementListResponse(
            graph.Placements.Select(ToResponse).ToArray(),
            graph.Snapshots.Select(ToResponse).ToArray()));
    }

    private static ActiveComponentGraph ReadActiveGraph(
        Guid projectId,
        Guid harnessId,
        IProjectComponentSnapshotStore store)
    {
        var project = new ProjectIdentity(projectId);
        var harness = new HarnessIdentity(harnessId);
        var placements = store.ListPlacements(project, harness);
        var snapshotIds = placements.Select(item => item.SnapshotId).ToHashSet();
        var snapshots = store.ListSnapshots(project)
            .Where(item => snapshotIds.Contains(item.SnapshotId))
            .ToArray();
        if (snapshots.Length != snapshotIds.Count)
            throw new InvalidDataException("An active component placement references a missing project snapshot.");
        return new ActiveComponentGraph(placements, snapshots);
    }

    private static ProjectComponentSnapshotResponse ToResponse(ProjectComponentSnapshot value)
    {
        using var content = JsonDocument.Parse(value.ContentJson);
        return new ProjectComponentSnapshotResponse(
            value.SnapshotId,
            value.ProjectId.Value,
            value.SourceTemplateId,
            value.SourceVersion,
            value.SourceVersionSha256,
            value.Code,
            value.Name,
            value.ArticleBindings.Select(item => new ComponentTemplateArticleBindingResponse(
                item.SourceId, item.EntityType, item.ArticleKey)).ToArray(),
            value.Assets.Select(item => new ComponentTemplateAssetResponse(
                item.AssetId, item.Content.Sha256, item.Content.SizeBytes, item.FileName, item.MediaType)).ToArray(),
            value.SchemaVersion,
            content.RootElement.Clone(),
            value.CreatedUtc,
            value.UpdatedUtc);
    }

    private static ProjectComponentPlacementResponse ToResponse(ProjectComponentPlacement value)
    {
        using var instance = JsonDocument.Parse(value.InstanceJson);
        return new ProjectComponentPlacementResponse(
            value.PlacementId,
            value.HarnessId.Value,
            value.SnapshotId,
            value.SourceId,
            value.EntityType,
            value.ArticleKey,
            instance.RootElement.Clone(),
            value.CreatedUtc,
            value.UpdatedUtc);
    }

    private static IResult Execute(Func<IResult> operation)
    {
        try { return operation(); }
        catch (Exception error) when (IsHandled(error)) { return Error(error); }
    }

    private static async Task<IResult> ExecuteAsync(Func<Task<IResult>> operation)
    {
        try { return await operation(); }
        catch (Exception error) when (IsHandled(error)) { return Error(error); }
    }

    private static bool IsHandled(Exception error) => error is
        ProjectComponentSnapshotException or ComponentTemplateException or
        FileNotFoundException or InvalidDataException;

    private static IResult Error(Exception error)
    {
        var (code, field, message, currentRevision, status) = error switch
        {
            ProjectComponentSnapshotException snapshot => (
                snapshot.Code, snapshot.Field, snapshot.Message, snapshot.CurrentRevision,
                snapshot.Code switch
                {
                    "project_not_found" or "harness_not_found" or "component_snapshot_not_found" or
                        "component_snapshot_asset_not_found" => StatusCodes.Status404NotFound,
                    "design_revision_conflict" or "command_id_reused" or "component_placement_id_conflict" => StatusCodes.Status409Conflict,
                    _ => StatusCodes.Status422UnprocessableEntity,
                }),
            ComponentTemplateException template => (
                template.Code, template.Field, template.Message, (long?)null,
                template.Code is "component_template_not_found" or "component_template_version_not_found"
                    ? StatusCodes.Status404NotFound
                    : StatusCodes.Status422UnprocessableEntity),
            FileNotFoundException => (
                "component_template_asset_content_missing", (string?)null,
                "The component template image is missing.", (long?)null, StatusCodes.Status409Conflict),
            _ => (
                "component_template_asset_content_corrupt", (string?)null,
                "The component template image failed integrity validation.", (long?)null, StatusCodes.Status409Conflict),
        };
        return Results.Json(new ApiErrorResponse(code, field, message, currentRevision), statusCode: status);
    }

    private static ProjectComponentSnapshotException Invalid(string code, string message, string field) =>
        new(code, message, field);

    private sealed record ActiveComponentGraph(
        IReadOnlyList<ProjectComponentPlacement> Placements,
        IReadOnlyList<ProjectComponentSnapshot> Snapshots);
}
