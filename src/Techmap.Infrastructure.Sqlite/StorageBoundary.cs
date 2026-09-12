using Techmap.Application;
using Techmap.Domain;

namespace Techmap.Infrastructure.Sqlite;

// M1-01 defines the dependency boundary only. SQLite and EF are introduced in M1-03.
public sealed class StorageBoundary : IApplicationBoundary
{
    public ProjectIdentity Normalize(ProjectIdentity projectId) => projectId;
}
