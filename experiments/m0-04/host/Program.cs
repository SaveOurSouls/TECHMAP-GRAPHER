using System.Diagnostics;
using System.Net;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;

var builder = WebApplication.CreateBuilder(new WebApplicationOptions
{
    Args = args,
    ContentRootPath = AppContext.BaseDirectory,
    WebRootPath = Path.Combine(AppContext.BaseDirectory, "wwwroot")
});
builder.Logging.ClearProviders();
builder.Logging.AddSimpleConsole(options => options.SingleLine = true);
builder.WebHost.ConfigureKestrel(options => options.Listen(IPAddress.Loopback, 0));

var app = builder.Build();
var dataRootArgument = args.FirstOrDefault(value =>
    value.StartsWith("--data-root=", StringComparison.OrdinalIgnoreCase));
var dataRoot = dataRootArgument is null
    ? Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "TechmapGrapher")
    : Path.GetFullPath(dataRootArgument["--data-root=".Length..]);
Directory.CreateDirectory(dataRoot);

app.UseDefaultFiles();
app.UseStaticFiles();
app.MapGet("/health", () => Results.Ok(new { status = "ok" }));
app.MapGet("/runtime-info", () => Results.Ok(new
{
    programRoot = AppContext.BaseDirectory,
    dataRoot,
    separated = !Path.GetFullPath(dataRoot).StartsWith(
        Path.GetFullPath(AppContext.BaseDirectory),
        StringComparison.OrdinalIgnoreCase)
}));

await app.StartAsync();
var server = app.Services.GetRequiredService<IServer>();
var address = server.Features.Get<IServerAddressesFeature>()?.Addresses.Single()
    ?? throw new InvalidOperationException("Kestrel did not publish its loopback address.");

Console.WriteLine($"TECHMAP_HOST_URL={address}");
Console.WriteLine($"TECHMAP_DATA_ROOT={dataRoot}");

if (!args.Contains("--no-browser", StringComparer.OrdinalIgnoreCase))
{
    Process.Start(new ProcessStartInfo(address) { UseShellExecute = true });
}

await app.WaitForShutdownAsync();
