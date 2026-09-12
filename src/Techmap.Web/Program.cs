using System.Net;
using System.Text.Encodings.Web;
using Techmap.Application;
using Techmap.Contracts;
using Techmap.Infrastructure.Sqlite;
using Techmap.Web;

WindowsProcessErrorMode.Apply();
try
{
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

var productVersion = ProductVersion.Read(programRoot, SqliteStorage.CurrentSchemaVersion);
if (!int.TryParse(
        productVersion.SchemaVersion,
        System.Globalization.NumberStyles.None,
        System.Globalization.CultureInfo.InvariantCulture,
        out var packagedSchemaVersion) ||
    packagedSchemaVersion != SqliteStorage.CurrentSchemaVersion)
{
    throw new InvalidDataException("The packaged and application storage schema versions do not match.");
}

DataRootLease? dataRootLease = null;
try
{
    dataRootLease = DataRootLease.Acquire(options.DataRoot);
}
catch (DataRootLeaseUnavailableException error)
{
    if (options.ExportProjectId is not null || options.ImportProjectArchive is not null)
    {
        throw new InvalidOperationException(
            "Offline project export/import requires exclusive access to the data root.",
            error);
    }

    StartupTestHooks.MarkLeaseContended();
    var ownerResolutionDeadline = DateTime.UtcNow.AddSeconds(10);
    while (dataRootLease is null)
    {
        var remaining = ownerResolutionDeadline - DateTime.UtcNow;
        if (remaining <= TimeSpan.Zero)
        {
            Console.Error.WriteLine("TECHMAP_STARTUP_ERROR=instance_owner_unverifiable");
            Environment.ExitCode = 3;
            return;
        }

        try
        {
            var existingInstance = await LocalInstanceRecord.ResolveOwnerAsync(
                error.Identity,
                error.CanonicalPath,
                discoveryTimeout: TimeSpan.FromMilliseconds(Math.Min(750, remaining.TotalMilliseconds)));
            BrowserLauncher.OpenExisting(existingInstance, options.NoBrowser);
            return;
        }
        catch (LocalInstanceUnavailableException)
        {
            dataRootLease = DataRootLease.TryAcquireExisting(error);
        }
    }
}
await using var heldDataRootLease = dataRootLease
    ?? throw new InvalidOperationException("The data-root lease was not acquired.");
StartupTestHooks.PauseFirstOwnerAfterLease();
var dataRoot = DataRootLayout.Initialize(heldDataRootLease.CanonicalPath);
var existingDatabase = File.Exists(Path.Combine(dataRoot, StorageGenerationLayout.CurrentPointerFileName));
var backupPolicyStatePath = Path.Combine(dataRoot, "bootstrap", "backup-policy.json");
var stateBeforeStartup = StorageBackupPolicy.ReadStateFile(backupPolicyStatePath);
var previousAppVersion = string.IsNullOrEmpty(stateBeforeStartup.LastRunAppVersion)
    ? null
    : stateBeforeStartup.LastRunAppVersion;
var migrationService = new SqliteStorageMigrationService(heldDataRootLease);
var migration = await migrationService.MigrateIfRequiredAsync(
    new StorageMigrationRequest(
        options.BackupRoot,
        productVersion.AppVersion,
        packagedSchemaVersion,
        previousAppVersion),
    CancellationToken.None);
StorageBackupResult? startupBackup = migration.PreUpdateBackup;
if (startupBackup is null && existingDatabase)
{
    var preOpenDatabasePath = Path.Combine(
        dataRoot,
        StorageGenerationLayout.GenerationsDirectoryName,
        migration.CurrentGenerationName,
        StorageGenerationLayout.DatabaseFileName);
    using var preOpenBackupService = new SqliteStorageBackupService(dataRoot, preOpenDatabasePath);
    var preOpenPolicy = new StorageBackupPolicy(
        preOpenBackupService,
        new StorageBackupPolicyOptions(options.BackupRoot),
        backupPolicyStatePath);
    var preparation = await preOpenPolicy.PreparePreUpdateAsync(
        productVersion.AppVersion,
        existingDatabase: true,
        CancellationToken.None);
    startupBackup = preparation.PreUpdateBackup;
}

using var storage = SqliteStorage.Open(dataRoot);
if (packagedSchemaVersion != storage.Diagnostics.SchemaVersion)
{
    throw new InvalidDataException("The packaged and live storage schema versions do not match.");
}

var storageBackupService = new SqliteStorageBackupService(dataRoot, storage.Layout.DatabasePath);
var backupPolicy = new StorageBackupPolicy(
    storageBackupService,
    new StorageBackupPolicyOptions(options.BackupRoot),
    backupPolicyStatePath,
    failureSink: error => Console.Error.WriteLine($"TECHMAP_BACKUP_ERROR={error.GetType().Name}"));
await backupPolicy.CommitSuccessfulStartupAsync(
    productVersion.AppVersion,
    startupBackup,
    CancellationToken.None);
migrationService.CompleteSuccessfulStartup(migration);

var projectImportService = new SqliteProjectImportService(heldDataRootLease, storage);
if (options.ImportProjectArchive is null)
{
    _ = await projectImportService.RecoverPendingAsync(CancellationToken.None);
}

if (options.ExportProjectId is Guid exportProjectId)
{
    var projectExport = await new SqliteProjectExportService(heldDataRootLease, storage).ExportAsync(
        new ProjectExportRequest(
            new Techmap.Domain.ProjectIdentity(exportProjectId),
            options.ExportDestination!,
            productVersion.AppVersion),
        CancellationToken.None);
    Console.WriteLine("TECHMAP_PROJECT_EXPORT_STATUS=ok");
    Console.WriteLine($"TECHMAP_PROJECT_EXPORT_SHA256={projectExport.ArchiveSha256}");
    return;
}

if (options.ImportProjectArchive is not null)
{
    var projectImport = await projectImportService.ImportAsync(
        new ProjectImportRequest(options.ImportProjectArchive, productVersion.AppVersion),
        CancellationToken.None);
    Console.WriteLine("TECHMAP_PROJECT_IMPORT_STATUS=ok");
    Console.WriteLine($"TECHMAP_PROJECT_IMPORT_PROJECT_ID={projectImport.ProjectId.Value:D}");
    Console.WriteLine($"TECHMAP_PROJECT_IMPORT_INCREMENT={projectImport.ProjectIncrement}");
    Console.WriteLine($"TECHMAP_PROJECT_IMPORT_SHA256={projectImport.ArchiveSha256}");
    return;
}

builder.WebHost.ConfigureKestrel(kestrel =>
{
    kestrel.Limits.MaxRequestBodySize = ProjectDataEndpoints.MaximumAttachmentRequestBytes;
    kestrel.Listen(IPAddress.Loopback, options.Port);
});
builder.Services.AddSingleton<IApplicationBoundary, StorageBoundary>();
builder.Services.AddSingleton<SqliteProjectCatalog>();
builder.Services.AddSingleton<IProjectCatalog>(services =>
    services.GetRequiredService<SqliteProjectCatalog>());
builder.Services.AddSingleton<IProjectVersionCatalog>(services =>
    services.GetRequiredService<SqliteProjectCatalog>());
builder.Services.AddSingleton<IAttachmentContentStore>(_ =>
    new ContentAddressedAttachmentStore(dataRoot));
builder.Services.AddSingleton<IProjectAttachmentCatalog, SqliteProjectAttachmentCatalog>();
builder.Services.AddSingleton<IPinnedCharacteristicStore, SqlitePinnedCharacteristicStore>();
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton(storage);
builder.Services.AddSingleton(productVersion);
builder.Services.AddSingleton(storageBackupService);
builder.Services.AddSingleton(backupPolicy);
builder.Services.AddHostedService<StorageBackupHostedService>();
builder.Services.AddSingleton<LocalHttpSession>();

var app = builder.Build();
var pathBase = options.PathBase;
var testTransportPort = app.Environment.IsEnvironment("Testing") ? options.Port : (int?)null;

app.Use(async (context, next) =>
{
    if (!LocalRequestSecurity.HasExactLoopbackAuthority(context, testTransportPort))
    {
        context.Response.StatusCode = StatusCodes.Status400BadRequest;
        return;
    }

    LocalRequestSecurity.ApplyResponseHeaders(context.Response);
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

app.Use((context, next) => LocalRequestSecurity.EnforceApiMutationAsync(
    context,
    app.Services.GetRequiredService<LocalHttpSession>(),
    testTransportPort,
    next));
app.UseRouting();
var assetPath = Path.Combine(app.Environment.WebRootPath, "assets");
if (Directory.Exists(assetPath))
{
    app.UseStaticFiles(new StaticFileOptions
    {
        FileProvider = new Microsoft.Extensions.FileProviders.PhysicalFileProvider(assetPath),
        RequestPath = "/assets",
        OnPrepareResponse = context =>
        {
            context.Context.Response.Headers.CacheControl = "public,max-age=31536000,immutable";
        },
    });
}

var runtimeConfig = new RuntimeConfigResponse(
    ConfigVersion: 1,
    BasePath: PathBaseConfiguration.Display(pathBase),
    ApiBasePath: PathBaseConfiguration.ApiBase(pathBase),
    AppVersion: productVersion.AppVersion,
    ApiVersion: ApiContract.MajorVersion.ToString(System.Globalization.CultureInfo.InvariantCulture),
    SchemaVersion: productVersion.SchemaVersion);

app.MapGet("/runtime-config.json", () => Results.Json(runtimeConfig));
app.MapGet("/api/v1/health", (LocalHttpSession session) => Results.Ok(
    new HealthResponse("ok", ApiContract.MajorVersion, session.InstanceId)));
app.MapGet("/api/v1/runtime-config", () => Results.Json(runtimeConfig));
app.MapGet("/api/v1/diagnostics", (
    HttpContext context,
    LocalHttpSession session,
    SqliteStorage sqliteStorage) =>
{
    if (!session.HasValidCookie(context.Request))
    {
        return Results.Json(
            new ApiErrorResponse("invalid_session"),
            statusCode: StatusCodes.Status401Unauthorized);
    }

    var diagnostics = sqliteStorage.Diagnostics;
    return Results.Ok(new StorageDiagnosticsResponse(
        "ready",
        diagnostics.SchemaVersion,
        diagnostics.SqliteVersion,
        diagnostics.ForeignKeysEnabled,
        diagnostics.BusyTimeoutMilliseconds,
        diagnostics.JournalMode));
});
app.MapGet("/api/v1/session", (HttpContext context, LocalHttpSession session) =>
    session.HasValidCookie(context.Request)
        ? Results.Ok(new SessionBootstrapResponse(session.EncodedCsrfNonce, session.InstanceId))
        : Results.Json(
            new ApiErrorResponse("invalid_session"),
            statusCode: StatusCodes.Status401Unauthorized));
app.MapProjectEndpoints();
app.MapProjectDataEndpoints();
app.Map("/api/{**path}", () => Results.Json(
    new ApiErrorResponse("api_route_not_found"),
    statusCode: StatusCodes.Status404NotFound));

static IResult ServeIndex(
    HttpContext context,
    IWebHostEnvironment environment,
    PathString configuredPathBase,
    LocalHttpSession session)
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
    session.IssueCookie(context.Response, configuredPathBase);
    context.Response.Headers.CacheControl = "no-store";
    return Results.Content(html, "text/html; charset=utf-8");
}

app.MapGet("/", (HttpContext context, IWebHostEnvironment environment, LocalHttpSession session) =>
    ServeIndex(context, environment, pathBase, session));
app.MapGet("/index.html", (HttpContext context, IWebHostEnvironment environment, LocalHttpSession session) =>
    ServeIndex(context, environment, pathBase, session));
app.MapFallback((HttpContext context, IWebHostEnvironment environment, LocalHttpSession session) =>
    ServeIndex(context, environment, pathBase, session));

if (app.Environment.IsEnvironment("Testing"))
{
    await app.RunAsync();
}
else
{
    var instanceId = app.Services.GetRequiredService<LocalHttpSession>().InstanceId;
    await app.StartAsync();
    try
    {
        await BrowserLauncher.AnnounceOwnerAsync(
            app,
            options,
            dataRootLease.Identity,
            dataRoot);
        await app.WaitForShutdownAsync();
    }
    finally
    {
        LocalInstanceRecord.DeleteIfOwned(dataRootLease.Identity, instanceId);
        await app.StopAsync();
    }
}
}
catch (Exception exception)
{
    Environment.ExitCode = StartupFailureReporter.Report(exception, args);
}

public partial class Program;
