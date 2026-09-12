using Techmap.Domain;

namespace Techmap.Application;

public interface IApplicationBoundary
{
    ProjectIdentity Normalize(ProjectIdentity projectId);
}
