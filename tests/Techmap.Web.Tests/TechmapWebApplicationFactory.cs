using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Techmap.Web.Tests;

public sealed class TechmapWebApplicationFactory(params string[] arguments)
    : WebApplicationFactory<Program>
{
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.UseSetting("NoBrowser", "true");
        builder.UseSetting("DataRoot", Path.Combine(Path.GetTempPath(), "techmap-web-tests", Guid.NewGuid().ToString("N")));
        var pathBaseArgument = arguments.SingleOrDefault(argument =>
            argument.StartsWith("--path-base=", StringComparison.OrdinalIgnoreCase));
        if (pathBaseArgument is not null)
        {
            builder.UseSetting("PathBase", pathBaseArgument["--path-base=".Length..]);
        }
    }

}
