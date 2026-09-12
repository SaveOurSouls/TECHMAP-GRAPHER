using Techmap.Application;
using Techmap.Domain;

namespace Techmap.Infrastructure.Sqlite;

public sealed class StorageBoundary : IApplicationBoundary
{
    public ProjectIdentity Normalize(ProjectIdentity projectId) => projectId;
}
