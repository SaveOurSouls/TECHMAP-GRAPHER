using Techmap.Domain;

namespace Techmap.Application;

public interface IApplicationBoundary
{
    ProjectIdentity Normalize(ProjectIdentity projectId);
}

public sealed record CreateProjectCommand(
    string Designation,
    string Name,
    long BatchQuantity,
    ProjectStatus Status);

public sealed record UpdateProjectCommand(
    string? Designation = null,
    string? Name = null,
    long? BatchQuantity = null,
    ProjectStatus? Status = null);

public sealed record ProjectSummary(
    ProjectIdentity ProjectId,
    string Designation,
    long Increment,
    string Name,
    long BatchQuantity,
    ProjectStatus Status,
    long Revision,
    int HarnessCount,
    DateTimeOffset CreatedUtc,
    DateTimeOffset UpdatedUtc);

public sealed record HarnessSummary(
    HarnessIdentity HarnessId,
    string Designation,
    long Quantity,
    int SortOrder,
    DateTimeOffset CreatedUtc,
    DateTimeOffset UpdatedUtc,
    IReadOnlyList<HarnessDocumentSummary> Documents);

public sealed record HarnessDocumentSummary(
    HarnessDocumentIdentity DocumentId,
    string Kind,
    string Status,
    DateTimeOffset CreatedUtc,
    DateTimeOffset UpdatedUtc);

public sealed record ProjectDetails(
    ProjectIdentity ProjectId,
    string Designation,
    long Increment,
    string Name,
    long BatchQuantity,
    ProjectStatus Status,
    long Revision,
    DateTimeOffset CreatedUtc,
    DateTimeOffset UpdatedUtc,
    IReadOnlyList<HarnessSummary> Harnesses);

public interface IProjectCatalog
{
    IReadOnlyList<ProjectSummary> ListProjects();

    ProjectDetails GetProject(ProjectIdentity projectId);

    void DeleteProject(ProjectIdentity projectId, long expectedRevision);

    ProjectDetails CreateProject(CreateProjectCommand command);

    ProjectDetails UpdateProject(ProjectIdentity projectId, UpdateProjectCommand command);

    ProjectMutationResult<ProjectDetails> UpdateProject(
        ProjectIdentity projectId,
        ProjectCommandEnvelope envelope,
        UpdateProjectCommand command);

    ProjectDetails CopyProject(ProjectIdentity sourceProjectId);

    ProjectDetails AddHarness(ProjectIdentity projectId, string designation, long quantity = 1);

    ProjectMutationResult<ProjectDetails> AddHarness(
        ProjectIdentity projectId,
        ProjectCommandEnvelope envelope,
        string designation,
        long? quantity = 1);

    ProjectDetails UpdateHarnessQuantity(
        ProjectIdentity projectId,
        HarnessIdentity harnessId,
        long quantity);

    ProjectMutationResult<ProjectDetails> UpdateHarnessQuantity(
        ProjectIdentity projectId,
        HarnessIdentity harnessId,
        ProjectCommandEnvelope envelope,
        long quantity);

    ProjectDetails DeleteHarness(ProjectIdentity projectId, HarnessIdentity harnessId);

    ProjectMutationResult<ProjectDetails> DeleteHarness(
        ProjectIdentity projectId,
        ProjectCommandEnvelope envelope,
        HarnessIdentity harnessId);
}

public readonly record struct ProjectCommandEnvelope(Guid CommandId, long ExpectedRevision);

public sealed record ProjectMutationResult<T>(
    Guid CommandId,
    long ExpectedRevision,
    long ResultingRevision,
    T Value);

public sealed record ProjectVersionEntry(
    long Revision,
    Guid CommandId,
    string CommandType,
    DateTimeOffset AcceptedUtc);

public interface IProjectVersionCatalog
{
    IReadOnlyList<ProjectVersionEntry> ListVersions(ProjectIdentity projectId);
}

public sealed class ProjectCommandException : Exception
{
    public ProjectCommandException(
        string code,
        string message,
        long? currentRevision = null,
        string? field = null)
        : base(message)
    {
        Code = code;
        CurrentRevision = currentRevision;
        Field = field;
    }

    public string Code { get; }

    public long? CurrentRevision { get; }

    public string? Field { get; }
}

public sealed class ProjectCatalogException : Exception
{
    public ProjectCatalogException(string code, string message, string? field = null)
        : base(message)
    {
        Code = code;
        Field = field;
    }

    public string Code { get; }

    public string? Field { get; }
}
