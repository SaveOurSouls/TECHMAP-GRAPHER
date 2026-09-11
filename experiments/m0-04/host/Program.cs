using System.Diagnostics;
using System.Net;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;

var portArgument = args.FirstOrDefault(value =>
    value.StartsWith("--port=", StringComparison.OrdinalIgnoreCase));
var port = portArgument is null
    ? 0
    : int.TryParse(portArgument["--port=".Length..], out var parsedPort) && parsedPort is > 0 and <= 65535
        ? parsedPort
        : throw new ArgumentException("--port must be an integer from 1 to 65535");

var builder = WebApplication.CreateBuilder(new WebApplicationOptions
{
    Args = args,
    ContentRootPath = AppContext.BaseDirectory,
    WebRootPath = Path.Combine(AppContext.BaseDirectory, "wwwroot")
});
builder.Logging.ClearProviders();
builder.Logging.AddSimpleConsole(options => options.SingleLine = true);
builder.WebHost.ConfigureKestrel(options => options.Listen(IPAddress.Loopback, port));

var app = builder.Build();
var dataRootArgument = args.FirstOrDefault(value =>
    value.StartsWith("--data-root=", StringComparison.OrdinalIgnoreCase));
var dataRoot = dataRootArgument is null
    ? Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "TechmapGrapher")
    : Path.GetFullPath(
        dataRootArgument["--data-root=".Length..],
        AppContext.BaseDirectory);
Directory.CreateDirectory(dataRoot);

static bool IsInsideDirectory(string candidatePath, string directoryPath)
{
    var relative = Path.GetRelativePath(
        Path.GetFullPath(directoryPath),
        Path.GetFullPath(candidatePath));
    return relative == "." ||
        (!Path.IsPathRooted(relative) &&
         relative != ".." &&
         !relative.StartsWith($"..{Path.DirectorySeparatorChar}", StringComparison.Ordinal));
}

app.Use(async (context, next) =>
{
    var host = context.Request.Host.Host;
    if (host is not ("127.0.0.1" or "localhost" or "::1"))
    {
        context.Response.StatusCode = StatusCodes.Status400BadRequest;
        return;
    }
    context.Response.Headers.ContentSecurityPolicy =
        "default-src 'self'; script-src 'self'; style-src 'self'; " +
        "img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'";
    context.Response.Headers.XContentTypeOptions = "nosniff";
    await next();
});

app.UseDefaultFiles();
app.UseStaticFiles();
app.MapGet("/api/v1/health", () => Results.Ok(new { status = "ok", api = 1 }));
app.MapGet("/api/v1/runtime-info", () => Results.Ok(new
{
    delivery = "portable-web",
    programRoot = AppContext.BaseDirectory,
    dataRoot,
    separated = !IsInsideDirectory(dataRoot, AppContext.BaseDirectory)
}));
app.Map("/api/{**path}", () => Results.NotFound(new
{
    error = "api_route_not_found"
}));
app.MapFallbackToFile("index.html");

await app.StartAsync();
var server = app.Services.GetRequiredService<IServer>();
var address = server.Features.Get<IServerAddressesFeature>()?.Addresses.Single()
    ?? throw new InvalidOperationException("Kestrel did not publish its loopback address.");

Console.WriteLine($"TECHMAP_HOST_URL={address}");
Console.WriteLine($"TECHMAP_DATA_ROOT={dataRoot}");

if (!args.Contains("--no-browser", StringComparer.OrdinalIgnoreCase))
{
    using var healthClient = new HttpClient();
    using var healthResponse = await healthClient.GetAsync($"{address}/api/v1/health");
    healthResponse.EnsureSuccessStatusCode();
    Process.Start(new ProcessStartInfo(address) { UseShellExecute = true });
}

await app.WaitForShutdownAsync();
