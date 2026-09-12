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
    int HarnessCount,
    DateTimeOffset CreatedUtc,
    DateTimeOffset UpdatedUtc);

public sealed record HarnessSummary(
    HarnessIdentity HarnessId,
    string Designation,
    int SortOrder,
    DateTimeOffset CreatedUtc,
    DateTimeOffset UpdatedUtc);

public sealed record ProjectDetails(
    ProjectIdentity ProjectId,
    string Designation,
    long Increment,
    string Name,
    long BatchQuantity,
    ProjectStatus Status,
    DateTimeOffset CreatedUtc,
    DateTimeOffset UpdatedUtc,
    IReadOnlyList<HarnessSummary> Harnesses);

public interface IProjectCatalog
{
    IReadOnlyList<ProjectSummary> ListProjects();

    ProjectDetails GetProject(ProjectIdentity projectId);

    ProjectDetails CreateProject(CreateProjectCommand command);

    ProjectDetails UpdateProject(ProjectIdentity projectId, UpdateProjectCommand command);

    ProjectDetails CopyProject(ProjectIdentity sourceProjectId);

    ProjectDetails AddHarness(ProjectIdentity projectId, string designation);

    ProjectDetails DeleteHarness(ProjectIdentity projectId, HarnessIdentity harnessId);
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
