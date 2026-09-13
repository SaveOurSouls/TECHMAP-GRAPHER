using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Techmap.Web;

public sealed class BrowserLifecycleMonitor(
    IHostApplicationLifetime applicationLifetime,
    TimeProvider timeProvider,
    ILogger<BrowserLifecycleMonitor> logger)
{
    private readonly BrowserLifecycleTracker tracker = new(timeProvider);

    private static readonly TimeSpan PollInterval = TimeSpan.FromSeconds(1);

    public bool Enabled => tracker.Enabled;

    public void Enable() => tracker.Enable();

    public void Disable() => tracker.Disable();

    public IDisposable OpenConnection() => tracker.OpenConnection();

    public async Task WaitForBrowserClosedAsync(CancellationToken cancellationToken = default)
    {
        using var timer = new PeriodicTimer(PollInterval);
        try
        {
            while (await timer.WaitForNextTickAsync(cancellationToken).ConfigureAwait(false))
            {
                if (!tracker.ShouldStop())
                {
                    continue;
                }

                logger.LogInformation("The local browser session ended; stopping Techmap.Server.");
                applicationLifetime.StopApplication();
                return;
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            // The application was stopped by Ctrl+C, the console window, or the host.
        }
    }
}
