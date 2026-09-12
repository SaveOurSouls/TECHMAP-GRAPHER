using Techmap.Application;
using Techmap.Contracts;
using Techmap.Domain;

namespace Techmap.Web;

public static class ProjectDataEndpoints
{
    public const int MaximumAttachmentBytes = 25 * 1024 * 1024;
    public const long MaximumAttachmentRequestBytes = 36L * 1024 * 1024;

    public static void MapProjectDataEndpoints(this WebApplication app)
    {
        app.MapGet("/api/v1/projects/{projectId:guid}/attachments", (
            HttpContext context,
            Guid projectId,
            LocalHttpSession session,
            IProjectAttachmentCatalog catalog) =>
            WithReadSession(context, session, () => Execute(() =>
                Results.Ok(new ProjectAttachmentListResponse(
                    catalog.List(new ProjectIdentity(projectId)).Select(ToResponse).ToArray())))));

        app.MapPost("/api/v1/projects/{projectId:guid}/attachments", async (
            HttpContext context,
            Guid projectId,
            CreateAttachmentRequest request,
            IProjectAttachmentCatalog catalog,
            CancellationToken cancellationToken) =>
            await ExecuteAsync(async () =>
            {
                var content = DecodeContent(request.ContentBase64);
                await using var source = new MemoryStream(content, writable: false);
                var attachment = await catalog.AddAsync(
                    new ProjectIdentity(projectId),
                    source,
                    request.FileName!,
                    request.MediaType!,
                    request.Purpose!,
                    cancellationToken);
                return Results.Created(
                    $"{context.Request.PathBase}/api/v1/projects/{projectId:D}/attachments/" +
                    $"{attachment.AttachmentId.Value:D}",
                    ToResponse(attachment));
            }));

        app.MapPost(
            "/api/v1/projects/{projectId:guid}/attachments/{attachmentId:guid}/validations",
            async (
                Guid projectId,
                Guid attachmentId,
                IProjectAttachmentCatalog catalog,
                CancellationToken cancellationToken) =>
                await ExecuteAsync(async () =>
                {
                    await catalog.ValidateAsync(
                        new ProjectIdentity(projectId),
                        new AttachmentIdentity(attachmentId),
                        cancellationToken);
                    return Results.Ok(new AttachmentValidationResponse(attachmentId, "valid"));
                }));

        app.MapGet(
            "/api/v1/projects/{projectId:guid}/attachments/{attachmentId:guid}/content",
            async (
                HttpContext context,
                Guid projectId,
                Guid attachmentId,
                LocalHttpSession session,
                IProjectAttachmentCatalog catalog,
                CancellationToken cancellationToken) =>
            {
                if (!session.HasValidCookie(context.Request))
                {
                    return Results.Json(
                        new ApiErrorResponse("invalid_session"),
                        statusCode: StatusCodes.Status401Unauthorized);
                }

                try
                {
                    var attachment = catalog.List(new ProjectIdentity(projectId))
                        .SingleOrDefault(item => item.AttachmentId.Value == attachmentId)
                        ?? throw new ProjectAttachmentException(
                            "attachment_not_found",
                            "The attachment does not exist in this project.");
                    var stream = await catalog.OpenReadVerifiedAsync(
                        new ProjectIdentity(projectId),
                        attachment.AttachmentId,
                        cancellationToken);
                    return Results.Stream(
                        stream,
                        attachment.MediaType,
                        attachment.FileName,
                        enableRangeProcessing: false);
                }
                catch (Exception error) when (IsHandled(error))
                {
                    return Error(error);
                }
            });
    }

    private static byte[] DecodeContent(string? encoded)
    {
        if (encoded is null)
        {
            throw new ProjectAttachmentException(
                "invalid_attachment_content",
                "The attachment content is required.",
                "contentBase64");
        }

        var maximumEncodedLength = ((MaximumAttachmentBytes + 2L) / 3L) * 4L;
        if (encoded.Length > maximumEncodedLength)
        {
            throw new ProjectAttachmentException(
                "attachment_too_large",
                $"An attachment must not exceed {MaximumAttachmentBytes} bytes.",
                "contentBase64");
        }

        try
        {
            var content = Convert.FromBase64String(encoded);
            if (content.Length > MaximumAttachmentBytes)
            {
                throw new ProjectAttachmentException(
                    "attachment_too_large",
                    $"An attachment must not exceed {MaximumAttachmentBytes} bytes.",
                    "contentBase64");
            }

            return content;
        }
        catch (FormatException)
        {
            throw new ProjectAttachmentException(
                "invalid_attachment_content",
                "The attachment content is not valid Base64.",
                "contentBase64");
        }
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
        catch (Exception error) when (IsHandled(error))
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
        catch (Exception error) when (IsHandled(error))
        {
            return Error(error);
        }
    }

    private static bool IsHandled(Exception error) =>
        error is ProjectAttachmentException or ProjectCatalogException or
            FileNotFoundException or InvalidDataException;

    private static IResult Error(Exception error)
    {
        var (code, field, message, status) = error switch
        {
            ProjectAttachmentException attachment => (
                attachment.Code,
                attachment.Field,
                attachment.Message,
                attachment.Code switch
                {
                    "attachment_not_found" => StatusCodes.Status404NotFound,
                    "attachment_too_large" => StatusCodes.Status413PayloadTooLarge,
                    _ => StatusCodes.Status400BadRequest,
                }),
            ProjectCatalogException project => (
                project.Code,
                project.Field,
                project.Message,
                project.Code == "project_not_found"
                    ? StatusCodes.Status404NotFound
                    : StatusCodes.Status400BadRequest),
            FileNotFoundException => (
                "attachment_content_missing",
                (string?)null,
                "The attachment content is missing.",
                StatusCodes.Status409Conflict),
            _ => (
                "attachment_content_corrupt",
                (string?)null,
                "The attachment content failed integrity validation.",
                StatusCodes.Status409Conflict),
        };
        return Results.Json(new ApiErrorResponse(code, field, message), statusCode: status);
    }

    private static ProjectAttachmentResponse ToResponse(ProjectAttachment attachment) => new(
        attachment.AttachmentId.Value,
        attachment.ProjectId.Value,
        attachment.Content.Sha256,
        attachment.Content.SizeBytes,
        attachment.FileName,
        attachment.MediaType,
        attachment.Purpose,
        attachment.CreatedUtc);
}
