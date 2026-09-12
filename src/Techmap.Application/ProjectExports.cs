using Techmap.Domain;

namespace Techmap.Application;

public sealed record ProjectExportRequest(
    ProjectIdentity ProjectId,
    string DestinationPath,
    string AppVersion);

public sealed record ProjectExportResult(
    ProjectIdentity ProjectId,
    long ProjectRevision,
    string ArchivePath,
    long ArchiveSizeBytes,
    string ArchiveSha256,
    string ManifestSha256,
    int PayloadCount,
    int AttachmentBlobCount);

public interface IProjectExportService
{
    Task<ProjectExportResult> ExportAsync(
        ProjectExportRequest request,
        CancellationToken cancellationToken = default);
}

public sealed class ProjectExportException : Exception
{
    public ProjectExportException(string code, string message, Exception? innerException = null)
        : base(message, innerException)
    {
        Code = code;
    }

    public string Code { get; }
}
