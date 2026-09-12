namespace Techmap.Web;

internal static class StartupTestHooks
{
    private const string LeaseReadyFileVariable = "TECHMAP_TEST_LEASE_READY_FILE";
    private const string LeaseReleaseFileVariable = "TECHMAP_TEST_LEASE_RELEASE_FILE";
    private const string LeaseContendedFileVariable = "TECHMAP_TEST_LEASE_CONTENDED_FILE";
    public static void MarkLeaseContended()
    {
        var path = Environment.GetEnvironmentVariable(LeaseContendedFileVariable);
        if (!string.IsNullOrWhiteSpace(path))
        {
            File.WriteAllText(path, Environment.ProcessId.ToString(System.Globalization.CultureInfo.InvariantCulture));
        }
    }

    public static void PauseFirstOwnerAfterLease()
    {
        var readyPath = Environment.GetEnvironmentVariable(LeaseReadyFileVariable);
        var releasePath = Environment.GetEnvironmentVariable(LeaseReleaseFileVariable);
        if (string.IsNullOrWhiteSpace(readyPath) ||
            string.IsNullOrWhiteSpace(releasePath) ||
            File.Exists(readyPath))
        {
            return;
        }

        try
        {
            using var ready = new FileStream(
                readyPath,
                FileMode.CreateNew,
                FileAccess.Write,
                FileShare.Read,
                bufferSize: 1,
                FileOptions.WriteThrough);
            ready.WriteByte(1);
            ready.Flush(flushToDisk: true);
        }
        catch (IOException) when (File.Exists(readyPath))
        {
            return;
        }

        while (!File.Exists(releasePath))
        {
            Thread.Sleep(25);
        }
    }
}
