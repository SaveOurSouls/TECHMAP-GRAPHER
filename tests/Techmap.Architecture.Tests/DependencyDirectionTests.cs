using System.Reflection;
using Xunit;

namespace Techmap.Architecture.Tests;

public sealed class DependencyDirectionTests
{
    [Fact]
    public void Domain_and_contracts_do_not_reference_other_product_layers()
    {
        AssertOnlyProductReferences<Techmap.Domain.ProjectIdentity>();
        AssertOnlyProductReferences<Techmap.Contracts.HealthResponse>();
    }

    [Fact]
    public void Application_references_only_domain_and_contracts()
    {
        AssertOnlyProductReferences<Techmap.Application.IApplicationBoundary>(
            "Techmap.Contracts",
            "Techmap.Domain");
    }

    [Fact]
    public void Infrastructure_references_application_but_not_web()
    {
        AssertOnlyProductReferences<Techmap.Infrastructure.Sqlite.StorageBoundary>(
            "Techmap.Application",
            "Techmap.Domain");
    }

    private static void AssertOnlyProductReferences<T>(params string[] allowed)
    {
        var actual = typeof(T).Assembly
            .GetReferencedAssemblies()
            .Select(reference => reference.Name!)
            .Where(name => name.StartsWith("Techmap.", StringComparison.Ordinal))
            .Order(StringComparer.Ordinal)
            .ToArray();

        Assert.Empty(actual.Except(allowed, StringComparer.Ordinal));
    }
}
