using System.Net;
using System.Text.Encodings.Web;
using Techmap.Application;
using Techmap.Contracts;
using Techmap.Infrastructure.Sqlite;
using Techmap.Web;

var programRoot = Path.GetFullPath(AppContext.BaseDirectory);
var builder = WebApplication.CreateBuilder(new WebApplicationOptions
{
    Args = args,
    ContentRootPath = programRoot,
    WebRootPath = Path.Combine(programRoot, "wwwroot"),
});

builder.Logging.ClearProviders();
builder.Logging.AddSimpleConsole(options => options.SingleLine = true);
var options = ServerOptions.Parse(args, builder.Configuration, programRoot);
var manifestPath = Path.Combine(programRoot, "PACKAGE-MANIFEST.json");
if (File.Exists(manifestPath))
{
    PackageIntegrityVerifier.Verify(programRoot);
}
#if PACKAGED_BUILD
else
#else
else if (options.VerifyPackage)
#endif
{
    throw new InvalidDataException("PACKAGE-MANIFEST.json is missing.");
}

if (options.VerifyPackage)
{
    Console.WriteLine("TECHMAP_PACKAGE_STATUS=ok");
    return;
}

var dataRoot = DataRootLayout.Initialize(options.DataRoot);
var productVersion = ProductVersion.Read(programRoot);

builder.WebHost.ConfigureKestrel(kestrel => kestrel.Listen(IPAddress.Loopback, options.Port));
builder.Services.AddSingleton<IApplicationBoundary, StorageBoundary>();

var app = builder.Build();
var pathBase = options.PathBase;

app.Use(async (context, next) =>
{
    if (context.Request.Host.Host is not ("127.0.0.1" or "localhost" or "::1"))
    {
        context.Response.StatusCode = StatusCodes.Status400BadRequest;
        return;
    }

    context.Response.Headers.ContentSecurityPolicy =
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
        "connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'";
    context.Response.Headers.XContentTypeOptions = "nosniff";
    context.Response.Headers.CacheControl = "no-store";
    await next();
});

if (pathBase.HasValue)
{
    app.Use(async (context, next) =>
    {
        if (!context.Request.Path.StartsWithSegments(pathBase))
        {
            context.Response.StatusCode = StatusCodes.Status404NotFound;
            return;
        }

        await next();
    });
    app.UsePathBase(pathBase);
}

app.UseRouting();
app.UseStaticFiles(new StaticFileOptions
{
    OnPrepareResponse = context =>
    {
        if (context.Context.Request.Path.StartsWithSegments("/assets"))
        {
            context.Context.Response.Headers.CacheControl = "public,max-age=31536000,immutable";
        }
    },
});

var runtimeConfig = new RuntimeConfigResponse(
    ConfigVersion: 1,
    BasePath: PathBaseConfiguration.Display(pathBase),
    ApiBasePath: PathBaseConfiguration.ApiBase(pathBase),
    AppVersion: productVersion.AppVersion,
    ApiVersion: ApiContract.MajorVersion.ToString(System.Globalization.CultureInfo.InvariantCulture),
    SchemaVersion: productVersion.SchemaVersion);

app.MapGet("/runtime-config.json", () => Results.Json(runtimeConfig));
app.MapGet("/api/v1/health", () => Results.Ok(
    new HealthResponse("ok", ApiContract.MajorVersion)));
app.MapGet("/api/v1/runtime-config", () => Results.Json(runtimeConfig));
app.Map("/api/{**path}", () => Results.Json(
    new ApiErrorResponse("api_route_not_found"),
    statusCode: StatusCodes.Status404NotFound));

static IResult ServeIndex(HttpContext context, IWebHostEnvironment environment, PathString configuredPathBase)
{
    var indexFile = environment.WebRootFileProvider.GetFileInfo("index.html");
    if (!indexFile.Exists)
    {
        return Results.Problem("The web client has not been built.", statusCode: 503);
    }

    var basePath = PathBaseConfiguration.Display(configuredPathBase);
    var escapedBasePath = HtmlEncoder.Default.Encode(basePath);
    using var reader = new StreamReader(indexFile.CreateReadStream());
    var html = reader.ReadToEnd()
        .Replace("<head>", $"<head><base href=\"{escapedBasePath}\">", StringComparison.Ordinal);
    context.Response.Headers.CacheControl = "no-store";
    return Results.Content(html, "text/html; charset=utf-8");
}

app.MapGet("/", (HttpContext context, IWebHostEnvironment environment) =>
    ServeIndex(context, environment, pathBase));
app.MapFallback((HttpContext context, IWebHostEnvironment environment) =>
    ServeIndex(context, environment, pathBase));

BrowserLauncher.Register(app, options);
await app.RunAsync();

public partial class Program;
