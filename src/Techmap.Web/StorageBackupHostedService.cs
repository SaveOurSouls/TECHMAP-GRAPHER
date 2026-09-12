using Techmap.Application;

namespace Techmap.Web;

internal sealed class StorageBackupHostedService(
    StorageBackupPolicy policy,
    ProductVersion productVersion,
    ILogger<StorageBackupHostedService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            await policy.RunTimerAsync(productVersion.AppVersion, stoppingToken).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
        }
        catch (Exception error)
        {
            logger.LogError(error, "The storage backup timer stopped unexpectedly.");
        }
    }
}
