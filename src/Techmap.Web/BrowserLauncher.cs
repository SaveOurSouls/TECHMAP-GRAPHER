using System.Diagnostics;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;

namespace Techmap.Web;

public static class BrowserLauncher
{
    public static void Register(WebApplication app, ServerOptions options)
    {
        if (app.Environment.IsEnvironment("Testing"))
        {
            return;
        }

        app.Lifetime.ApplicationStarted.Register(() =>
        {
            _ = Task.Run(async () =>
            {
                try
                {
                    var server = app.Services.GetRequiredService<IServer>();
                    var address = server.Features.Get<IServerAddressesFeature>()?.Addresses.Single()
                        ?? throw new InvalidOperationException("Kestrel did not publish one loopback address.");
                    var pageUrl = $"{address.TrimEnd('/')}{PathBaseConfiguration.Display(options.PathBase)}";
                    var healthUrl = $"{address.TrimEnd('/')}{options.PathBase}/api/v1/health";

                    using var healthClient = new HttpClient();
                    using var healthResponse = await healthClient.GetAsync(healthUrl).ConfigureAwait(false);
                    healthResponse.EnsureSuccessStatusCode();
                    Console.WriteLine($"TECHMAP_HOST_URL={pageUrl}");
                    Console.WriteLine($"TECHMAP_DATA_ROOT={options.DataRoot}");
                    if (!options.NoBrowser)
                    {
                        Process.Start(new ProcessStartInfo(pageUrl) { UseShellExecute = true });
                    }
                }
                catch (Exception exception)
                {
                    app.Logger.LogError(exception, "The browser could not be opened after the health check.");
                }
            });
        });
    }
}
