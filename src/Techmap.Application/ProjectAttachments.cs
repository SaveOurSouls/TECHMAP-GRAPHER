using Techmap.Domain;

namespace Techmap.Application;

public readonly record struct AttachmentIdentity(Guid Value)
{
    public static AttachmentIdentity New() => new(Guid.NewGuid());
}

public sealed record AttachmentContent(string Sha256, long SizeBytes);

public sealed record ProjectAttachment(
    AttachmentIdentity AttachmentId,
    ProjectIdentity ProjectId,
    AttachmentContent Content,
    string FileName,
    string MediaType,
    string Purpose,
    DateTimeOffset CreatedUtc);

public interface IAttachmentContentStore
{
    Task<AttachmentContent> WriteAsync(
        Stream source,
        CancellationToken cancellationToken = default);

    Task ValidateAsync(
        AttachmentContent content,
        CancellationToken cancellationToken = default);

    Task<Stream> OpenReadVerifiedAsync(
        AttachmentContent content,
        CancellationToken cancellationToken = default);
}

public interface IProjectAttachmentCatalog
{
    Task<ProjectAttachment> AddAsync(
        ProjectIdentity projectId,
        Stream source,
        string fileName,
        string mediaType,
        string purpose,
        CancellationToken cancellationToken = default);

    IReadOnlyList<ProjectAttachment> List(ProjectIdentity projectId);

    Task ValidateAsync(
        ProjectIdentity projectId,
        AttachmentIdentity attachmentId,
        CancellationToken cancellationToken = default);

    Task<Stream> OpenReadVerifiedAsync(
        ProjectIdentity projectId,
        AttachmentIdentity attachmentId,
        CancellationToken cancellationToken = default);
}

public sealed class ProjectAttachmentException : Exception
{
    public ProjectAttachmentException(string code, string message, string? field = null)
        : base(message)
    {
        Code = code;
        Field = field;
    }

    public string Code { get; }

    public string? Field { get; }
}
