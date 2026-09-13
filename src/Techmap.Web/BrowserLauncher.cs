using System.Diagnostics;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Techmap.Infrastructure.Sqlite;

namespace Techmap.Web;

public static class BrowserLauncher
{
    public static async Task AnnounceOwnerAsync(
        WebApplication app,
        ServerOptions options,
        DataRootIdentity dataRootIdentity,
        string dataRoot,
        CancellationToken cancellationToken = default)
    {
        var server = app.Services.GetRequiredService<IServer>();
        var address = server.Features.Get<IServerAddressesFeature>()?.Addresses.Single()
            ?? throw new InvalidOperationException("Kestrel did not publish one loopback address.");
        var pageUrl = $"{address.TrimEnd('/')}{PathBaseConfiguration.Display(options.PathBase)}";
        var healthUrl = $"{address.TrimEnd('/')}{options.PathBase}/api/v1/health";

        using var handler = new HttpClientHandler { UseProxy = false };
        using var healthClient = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(3) };
        using var healthResponse = await healthClient.GetAsync(healthUrl, cancellationToken).ConfigureAwait(false);
        healthResponse.EnsureSuccessStatusCode();
        var session = app.Services.GetRequiredService<LocalHttpSession>();
        LocalInstanceRecord.Publish(dataRootIdentity, pageUrl, session.InstanceId);
        Console.WriteLine("TECHMAP_INSTANCE_STATUS=owner");
        Console.WriteLine($"TECHMAP_HOST_URL={pageUrl}");
        Console.WriteLine($"TECHMAP_DATA_ROOT={dataRoot}");
        if (!options.NoBrowser)
        {
            try
            {
                Process.Start(new ProcessStartInfo(pageUrl) { UseShellExecute = true });
                if (ShouldTrackLifecycle(pageUrl, options.NoBrowser))
                {
                    app.Services.GetRequiredService<BrowserLifecycleMonitor>().Enable();
                }
            }
            catch (Exception exception)
            {
                app.Logger.LogWarning(exception, "The browser could not be opened. Use TECHMAP_HOST_URL instead.");
            }
        }
    }

    public static bool ShouldTrackLifecycle(string pageUrl, bool noBrowser) =>
        !noBrowser &&
        Uri.TryCreate(pageUrl, UriKind.Absolute, out var pageUri) &&
        pageUri.Scheme == Uri.UriSchemeHttp &&
        pageUri.Host == "127.0.0.1";

    public static void OpenExisting(ExistingLocalInstance instance, bool noBrowser)
    {
        Console.WriteLine("TECHMAP_INSTANCE_STATUS=existing");
        Console.WriteLine($"TECHMAP_HOST_URL={instance.PageUrl}");
        if (!noBrowser)
        {
            try
            {
                Process.Start(new ProcessStartInfo(instance.PageUrl) { UseShellExecute = true });
            }
            catch (Exception error) when (error is InvalidOperationException or System.ComponentModel.Win32Exception)
            {
                Console.Error.WriteLine("TECHMAP_BROWSER_STATUS=not_opened");
            }
        }
    }
}
