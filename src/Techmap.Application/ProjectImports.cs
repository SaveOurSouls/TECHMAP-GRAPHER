using Techmap.Domain;

namespace Techmap.Application;

public sealed record ProjectImportRequest(
    string ArchivePath,
    string AppVersion);

public sealed record ProjectImportResult(
    ProjectIdentity ProjectId,
    long ProjectIncrement,
    string ProjectName,
    ProjectIdentity RestoredFromProjectId,
    long RestoredFromRevision,
    string ArchiveSha256,
    string ManifestSha256,
    int HarnessCount,
    int AttachmentCount,
    int PinnedCharacteristicCount,
    bool Recovered);

public interface IProjectImportService
{
    Task<ProjectImportResult> ImportAsync(
        ProjectImportRequest request,
        CancellationToken cancellationToken = default);

    Task<IReadOnlyList<ProjectImportResult>> RecoverPendingAsync(
        CancellationToken cancellationToken = default);
}

public sealed class ProjectImportException : Exception
{
    public ProjectImportException(string code, string message, Exception? innerException = null)
        : base(message, innerException)
    {
        Code = code;
    }

    public string Code { get; }
}
