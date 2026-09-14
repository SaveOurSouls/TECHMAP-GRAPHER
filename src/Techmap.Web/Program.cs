using System.Net;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;
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

if (options.ExecuteFullRestorePlan is not null)
{
    var plan = ReadRestorePlan(options.ExecuteFullRestorePlan);
    var offlineDataRoot = RequireExistingDataRoot(options.DataRoot);
    var offlineDatabasePath = ResolveCurrentDatabasePath(offlineDataRoot);
    using var offlineBackupService = new SqliteStorageBackupService(offlineDataRoot, offlineDatabasePath);
    using var offlineRestoreService = new SqliteStorageRestoreService(offlineDataRoot, offlineBackupService);
    var confirmation = ReadSmallTextFile(
        options.ConfirmationFile!,
        maximumBytes: 4 * 1024,
        "The restore confirmation file");
    var restored = await offlineRestoreService.RestoreAsync(
        new StorageFullRestoreRequest(
            plan,
            confirmation,
            options.PreRestoreBackupRoot!,
            productVersion.AppVersion),
        CancellationToken.None);
    Console.WriteLine("TECHMAP_STORAGE_FULL_RESTORE_STATUS=ok");
    Console.WriteLine($"TECHMAP_STORAGE_FULL_RESTORE_PRE_RESTORE_BACKUP_PATH={restored.PreRestoreBackup.BackupPath}");
    Console.WriteLine($"TECHMAP_STORAGE_FULL_RESTORE_RESTORED_GENERATION={restored.RestoredGenerationName}");
    return;
}

if (options.DryRunRestoreBackup is not null || options.PrepareFullRestoreBackup is not null)
{
    var requestedMaintenanceDataRoot = RequireExistingDataRoot(options.DataRoot);
    await using var maintenanceLease = DataRootLease.Acquire(requestedMaintenanceDataRoot);
    var maintenanceDataRoot = RequireExistingDataRoot(maintenanceLease.CanonicalPath);
    var maintenanceDatabasePath = ResolveCurrentDatabasePath(maintenanceDataRoot);
    using var maintenanceBackupService = new SqliteStorageBackupService(
        maintenanceDataRoot,
        maintenanceDatabasePath);
    using var maintenanceRestoreService = new SqliteStorageRestoreService(
        maintenanceDataRoot,
        maintenanceBackupService);
    if (options.DryRunRestoreBackup is not null)
    {
        var dryRun = await maintenanceRestoreService.DryRunAsync(
            new StorageDryRunRestoreRequest(
                options.DryRunRestoreBackup,
                options.RecoveryRoot!),
            CancellationToken.None);
        Console.WriteLine("TECHMAP_STORAGE_DRY_RUN_RESTORE_STATUS=ok");
        Console.WriteLine($"TECHMAP_STORAGE_DRY_RUN_RESTORE_RECOVERY_ROOT={dryRun.RecoveryRoot}");
        Console.WriteLine($"TECHMAP_STORAGE_DRY_RUN_RESTORE_DATABASE_SHA256={dryRun.DatabaseSha256}");
    }
    else
    {
        var plan = await maintenanceRestoreService.PrepareFullRestoreAsync(
            options.PrepareFullRestoreBackup!,
            CancellationToken.None);
        var writtenPlanPath = WriteNewRestorePlan(options.RestorePlanPath!, maintenanceDataRoot, plan);
        Console.WriteLine("TECHMAP_STORAGE_FULL_RESTORE_PREPARE_STATUS=confirmation_required");
        Console.WriteLine($"TECHMAP_STORAGE_FULL_RESTORE_PLAN={writtenPlanPath}");
        Console.WriteLine($"TECHMAP_STORAGE_FULL_RESTORE_REQUIRED_CONFIRMATION={plan.RequiredConfirmation}");
    }

    return;
}

DataRootLease? dataRootLease = null;
try
{
    dataRootLease = DataRootLease.Acquire(options.DataRoot);
}
catch (DataRootLeaseUnavailableException error)
{
    if (options.HasOfflineMaintenanceMode)
    {
        throw new InvalidOperationException(
            "Offline maintenance requires exclusive access to the data root.",
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
_ = SqliteAttachmentGarbageCollector.Prune(storage, TimeProvider.System);
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

if (options.CreateBackup)
{
    var backup = await storageBackupService.CreateAsync(
        new StorageBackupRequest(
            options.BackupRoot,
            productVersion.AppVersion,
            StorageBackupKind.Regular),
        CancellationToken.None);
    Console.WriteLine("TECHMAP_STORAGE_BACKUP_STATUS=ok");
    Console.WriteLine($"TECHMAP_STORAGE_BACKUP_ID={backup.BackupId:D}");
    Console.WriteLine($"TECHMAP_STORAGE_BACKUP_PATH={backup.BackupPath}");
    Console.WriteLine($"TECHMAP_STORAGE_BACKUP_MANIFEST_SHA256={backup.ManifestSha256}");
    Console.WriteLine($"TECHMAP_STORAGE_BACKUP_DATABASE_SHA256={backup.DatabaseSha256}");
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
builder.Services.AddSingleton<IHarnessDesignDocumentStore, SqliteHarnessDesignDocumentStore>();
builder.Services.AddSingleton<IComponentTemplateStore, SqliteComponentTemplateStore>();
builder.Services.AddSingleton<IReferenceCatalogSnapshotStore, SqliteReferenceCatalogSnapshotStore>();
builder.Services.AddSingleton<IReferenceCatalogSearchStore, SqliteReferenceCatalogSearchStore>();
builder.Services.AddSingleton<IReferenceCatalogSavedFilterStore, SqliteReferenceCatalogSavedFilterStore>();
builder.Services.AddSingleton<ReferenceCatalogSearchCursorCodec>();
builder.Services.AddSingleton<XlsxPreviewCatalog>();
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton(storage);
builder.Services.AddSingleton(productVersion);
builder.Services.AddSingleton(storageBackupService);
builder.Services.AddSingleton(backupPolicy);
builder.Services.AddHostedService<StorageBackupHostedService>();
builder.Services.AddSingleton<LocalHttpSession>();
builder.Services.AddSingleton<BrowserLifecycleMonitor>();

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
app.MapPost("/api/v1/browser-lifecycle", async (
    HttpContext context,
    LocalHttpSession session,
    BrowserLifecycleMonitor browserLifecycle) =>
{
    if (!browserLifecycle.Enabled)
    {
        context.Response.StatusCode = StatusCodes.Status404NotFound;
        return;
    }

    if (!session.HasValidCookie(context.Request))
    {
        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
        return;
    }

    context.Response.ContentType = "text/event-stream";
    context.Response.Headers.CacheControl = "no-store";
    using var connection = browserLifecycle.OpenConnection();
    try
    {
        await context.Request.Body.CopyToAsync(Stream.Null, context.RequestAborted);
        while (!context.RequestAborted.IsCancellationRequested)
        {
            await context.Response.WriteAsync("event: keepalive\ndata: ok\n\n", context.RequestAborted);
            await context.Response.Body.FlushAsync(context.RequestAborted);
            await Task.Delay(TimeSpan.FromSeconds(15), context.RequestAborted);
        }
    }
    catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested)
    {
        // The browser page closed, navigated away, or refreshed.
    }
    catch (IOException)
    {
        // Kestrel can report a disconnected browser as a broken response stream.
    }
});
app.MapProjectEndpoints();
app.MapProjectDataEndpoints();
app.MapHarnessDesignEndpoints();
app.MapComponentTemplateEndpoints();
app.MapReferenceCatalogEndpoints();
app.MapReferenceCatalogSavedFilterEndpoints();
app.MapXlsxReferenceEndpoints();
app.Map("/api/{**path}", () => Results.Json(
    new ApiErrorResponse("api_route_not_found"),
    statusCode: StatusCodes.Status404NotFound));

static IResult ServeIndex(
    HttpContext context,
    IWebHostEnvironment environment,
    PathString configuredPathBase,
    LocalHttpSession session,
    BrowserLifecycleMonitor browserLifecycle)
{
    var indexFile = environment.WebRootFileProvider.GetFileInfo("index.html");
    if (!indexFile.Exists)
    {
        return Results.Problem("The web client has not been built.", statusCode: 503);
    }

    var basePath = PathBaseConfiguration.Display(configuredPathBase);
    var escapedBasePath = HtmlEncoder.Default.Encode(basePath);
    using var reader = new StreamReader(indexFile.CreateReadStream());
    var lifecycleScript = browserLifecycle.Enabled
        ? $"<script src=\"{BrowserLifecycleScript.FileName}\" defer></script>"
        : string.Empty;
    var html = reader.ReadToEnd().Replace(
        "<head>",
        $"<head><base href=\"{escapedBasePath}\">{lifecycleScript}",
        StringComparison.Ordinal);
    session.IssueCookie(context.Response, configuredPathBase);
    context.Response.Headers.CacheControl = "no-store";
    return Results.Content(html, "text/html; charset=utf-8");
}

app.MapGet($"/{BrowserLifecycleScript.FileName}", (BrowserLifecycleMonitor browserLifecycle) =>
    browserLifecycle.Enabled
        ? Results.Content(BrowserLifecycleScript.Content, "text/javascript; charset=utf-8")
        : Results.NotFound());
app.MapGet("/", (
    HttpContext context,
    IWebHostEnvironment environment,
    LocalHttpSession session,
    BrowserLifecycleMonitor browserLifecycle) =>
    ServeIndex(context, environment, pathBase, session, browserLifecycle));
app.MapGet("/index.html", (
    HttpContext context,
    IWebHostEnvironment environment,
    LocalHttpSession session,
    BrowserLifecycleMonitor browserLifecycle) =>
    ServeIndex(context, environment, pathBase, session, browserLifecycle));
app.MapFallback((
    HttpContext context,
    IWebHostEnvironment environment,
    LocalHttpSession session,
    BrowserLifecycleMonitor browserLifecycle) =>
    ServeIndex(context, environment, pathBase, session, browserLifecycle));

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
        var browserLifecycle = app.Services.GetRequiredService<BrowserLifecycleMonitor>();
        var browserLifecycleTask = browserLifecycle.Enabled
            ? browserLifecycle.WaitForBrowserClosedAsync(app.Lifetime.ApplicationStopping)
            : Task.CompletedTask;
        await app.WaitForShutdownAsync();
        await browserLifecycleTask;
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

static string RequireExistingDataRoot(string requestedDataRoot)
{
    var dataRoot = DataRootLease.ResolveProspectiveDirectoryPath(requestedDataRoot);
    var markerPath = Path.Combine(dataRoot, DataRootLayout.MarkerFileName);
    if (!Directory.Exists(dataRoot) ||
        !File.Exists(markerPath) ||
        (File.GetAttributes(markerPath) & FileAttributes.ReparsePoint) != 0)
    {
        throw new DirectoryNotFoundException("The TECHMAP data root does not exist.");
    }

    return DataRootLayout.Initialize(dataRoot);
}

static string ResolveCurrentDatabasePath(string dataRoot)
{
    var root = Path.GetFullPath(dataRoot).TrimEnd(Path.DirectorySeparatorChar);
    var currentPath = Path.Combine(root, StorageGenerationLayout.CurrentPointerFileName);
    if (!File.Exists(currentPath) ||
        (File.GetAttributes(currentPath) & FileAttributes.ReparsePoint) != 0)
    {
        throw new InvalidDataException("The CURRENT pointer is missing or invalid.");
    }

    var value = File.ReadAllText(currentPath, Encoding.UTF8);
    if (!value.EndsWith('\n') ||
        value.AsSpan(0, value.Length - 1).IndexOfAny('\r', '\n') >= 0)
    {
        throw new InvalidDataException("The CURRENT pointer has an invalid format.");
    }

    var generationName = value.TrimEnd('\r', '\n');
    if (generationName.Length != "generation-00000000".Length ||
        !generationName.StartsWith("generation-", StringComparison.Ordinal) ||
        generationName.AsSpan("generation-".Length).IndexOfAnyExceptInRange('0', '9') >= 0)
    {
        throw new InvalidDataException("The CURRENT pointer contains an invalid generation name.");
    }

    var generationPath = Path.Combine(root, StorageGenerationLayout.GenerationsDirectoryName, generationName);
    var generationsPath = Path.GetDirectoryName(generationPath)
        ?? throw new InvalidDataException("The generations directory is invalid.");
    var readyPath = Path.Combine(generationPath, StorageGenerationLayout.ReadyMarkerFileName);
    var databasePath = Path.Combine(generationPath, StorageGenerationLayout.DatabaseFileName);
    foreach (var path in new[] { generationsPath, generationPath, readyPath, databasePath })
    {
        if ((!Directory.Exists(path) && !File.Exists(path)) ||
            (File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0)
        {
            throw new InvalidDataException("The active storage generation is incomplete or unsafe.");
        }
    }

    return databasePath;
}

static StorageFullRestorePlan ReadRestorePlan(string planPath)
{
    var plan = JsonSerializer.Deserialize<StorageFullRestorePlan>(
        ReadSmallTextFile(planPath, maximumBytes: 64 * 1024, "The full-restore plan"),
        RestorePlanJsonOptions());
    return plan ?? throw new InvalidDataException("The full-restore plan is empty.");
}

static string ReadSmallTextFile(string path, long maximumBytes, string description)
{
    var fullPath = Path.GetFullPath(path);
    if (!File.Exists(fullPath) ||
        (File.GetAttributes(fullPath) & FileAttributes.ReparsePoint) != 0)
    {
        throw new FileNotFoundException($"{description} is missing or unsafe.", fullPath);
    }

    var length = new FileInfo(fullPath).Length;
    if (length is <= 0 || length > maximumBytes)
    {
        throw new InvalidDataException($"{description} has an invalid size.");
    }

    return File.ReadAllText(fullPath, Encoding.UTF8);
}

static string WriteNewRestorePlan(
    string planPath,
    string dataRoot,
    StorageFullRestorePlan plan)
{
    var requestedPlanPath = Path.GetFullPath(planPath);
    var requestedPlanParent = Path.GetDirectoryName(requestedPlanPath)
        ?? throw new InvalidDataException("The restore plan path has no parent directory.");
    if (!Directory.Exists(requestedPlanParent))
    {
        throw new DirectoryNotFoundException("The restore plan parent directory does not exist.");
    }

    var planParent = DataRootLease.ResolveProspectiveDirectoryPath(requestedPlanParent);
    var fullPlanPath = Path.Combine(planParent, Path.GetFileName(requestedPlanPath));
    var root = Path.GetFullPath(dataRoot).TrimEnd(Path.DirectorySeparatorChar);
    if (string.Equals(fullPlanPath, root, StringComparison.OrdinalIgnoreCase) ||
        fullPlanPath.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
    {
        throw new InvalidDataException("The restore plan must be stored outside the live data root.");
    }

    var bytes = JsonSerializer.SerializeToUtf8Bytes(plan, RestorePlanJsonOptions());
    using var stream = new FileStream(
        fullPlanPath,
        FileMode.CreateNew,
        FileAccess.Write,
        FileShare.None,
        bufferSize: 4096,
        FileOptions.WriteThrough);
    stream.Write(bytes);
    stream.Flush(flushToDisk: true);
    return fullPlanPath;
}

static JsonSerializerOptions RestorePlanJsonOptions() => new(JsonSerializerDefaults.Web)
{
    PropertyNameCaseInsensitive = false,
    UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
    WriteIndented = true,
};

public partial class Program;
