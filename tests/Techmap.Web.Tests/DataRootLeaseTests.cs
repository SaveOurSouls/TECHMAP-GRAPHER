using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using Techmap.Infrastructure.Sqlite;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class DataRootLeaseTests
{
    [Fact]
    public void Same_root_has_one_writer_and_is_reusable_after_dispose()
    {
        using var fixture = LeaseFixture.Create();
        DataRootIdentity identity;

        using (var lease = DataRootLease.Acquire(fixture.DataRoot))
        {
            identity = lease.Identity;
            var error = Assert.Throws<DataRootLeaseUnavailableException>(() =>
                DataRootLease.Acquire(fixture.DataRoot));
            Assert.Equal(lease.CanonicalPath, error.CanonicalPath, StringComparer.OrdinalIgnoreCase);
            Assert.Equal(identity, error.Identity);
        }

        using var reacquired = DataRootLease.Acquire(fixture.DataRoot);
        Assert.Equal(identity, reacquired.Identity);
    }

    [Fact]
    public void Existing_root_takeover_changes_no_files_and_waits_for_the_previous_lease()
    {
        using var fixture = LeaseFixture.Create();
        using var first = DataRootLease.Acquire(fixture.DataRoot);
        var contention = Assert.Throws<DataRootLeaseUnavailableException>(() =>
            DataRootLease.Acquire(fixture.DataRoot));
        var entriesBefore = Directory.GetFileSystemEntries(fixture.DataRoot);

        Assert.Null(DataRootLease.TryAcquireExisting(contention));
        Assert.Equal(entriesBefore, Directory.GetFileSystemEntries(fixture.DataRoot));

        first.Dispose();
        using var takeover = DataRootLease.TryAcquireExisting(contention);
        Assert.NotNull(takeover);
        Assert.Equal(first.CanonicalPath, takeover.CanonicalPath, StringComparer.OrdinalIgnoreCase);
        Assert.Equal(first.Identity, takeover.Identity);
        Assert.Equal(entriesBefore, Directory.GetFileSystemEntries(fixture.DataRoot));
    }

    [Fact]
    public void Takeover_rejects_a_replacement_directory_at_the_same_path()
    {
        using var fixture = LeaseFixture.Create();
        using var first = DataRootLease.Acquire(fixture.DataRoot);
        var contention = Assert.Throws<DataRootLeaseUnavailableException>(() =>
            DataRootLease.Acquire(fixture.DataRoot));

        first.Dispose();
        Directory.Move(fixture.DataRoot, Path.Combine(fixture.Root, "original-data-root"));
        Directory.CreateDirectory(fixture.DataRoot);

        Assert.Null(DataRootLease.TryAcquireExisting(contention));
        using var replacement = DataRootLease.Acquire(fixture.DataRoot);
        Assert.NotEqual(contention.Identity, replacement.Identity);
    }

    [Fact]
    public void A_user_controlled_lock_file_is_not_part_of_the_lease_protocol()
    {
        using var fixture = LeaseFixture.Create();
        Directory.CreateDirectory(fixture.DataRoot);
        var lockPath = Path.Combine(fixture.DataRoot, ".techmap-writer.lock");
        using var hostileFile = new FileStream(
            lockPath,
            FileMode.CreateNew,
            FileAccess.ReadWrite,
            FileShare.None);

        using var lease = DataRootLease.Acquire(fixture.DataRoot);

        Assert.Equal(new[] { lockPath }, Directory.GetFileSystemEntries(fixture.DataRoot));
    }

    [Fact]
    public void Relative_and_case_changed_paths_share_the_same_lease()
    {
        using var fixture = LeaseFixture.Create("MixedCaseDataRoot");
        Directory.CreateDirectory(fixture.DataRoot);
        var parent = Path.GetDirectoryName(fixture.DataRoot)!;
        var caseChanged = Path.Combine(parent, Path.GetFileName(fixture.DataRoot).ToUpperInvariant());
        var relative = Path.GetRelativePath(Environment.CurrentDirectory, caseChanged);

        using var lease = DataRootLease.Acquire(fixture.DataRoot);
        var error = Assert.Throws<DataRootLeaseUnavailableException>(() =>
            DataRootLease.Acquire(relative));

        Assert.Equal(lease.Identity, error.Identity);
    }

    [Fact]
    public void Different_local_roots_can_be_owned_together()
    {
        using var fixture = LeaseFixture.Create();
        var otherRoot = Path.Combine(fixture.Root, "other-data-root");

        using var first = DataRootLease.Acquire(fixture.DataRoot);
        using var second = DataRootLease.Acquire(otherRoot);

        Assert.NotEqual(first.Identity, second.Identity);
    }

    [Fact]
    public void Extended_dos_path_resolves_to_the_same_lease()
    {
        using var fixture = LeaseFixture.Create();
        Directory.CreateDirectory(fixture.DataRoot);
        var extendedPath = @"\\?\" + fixture.DataRoot;

        using var lease = DataRootLease.Acquire(fixture.DataRoot);
        var error = Assert.Throws<DataRootLeaseUnavailableException>(() =>
            DataRootLease.Acquire(extendedPath));

        Assert.Equal(lease.Identity, error.Identity);
        Assert.Equal(lease.CanonicalPath, error.CanonicalPath, StringComparer.OrdinalIgnoreCase);
    }

    [Fact]
    public void Junction_alias_resolves_to_the_same_lease()
    {
        using var fixture = LeaseFixture.Create();
        Directory.CreateDirectory(fixture.DataRoot);
        var junction = Path.Combine(fixture.Root, "junction-alias");
        if (!TryCreateJunction(junction, fixture.DataRoot))
        {
            Assert.Skip("This Windows environment does not allow creation of a test junction.");
        }

        try
        {
            using var lease = DataRootLease.Acquire(fixture.DataRoot);
            var error = Assert.Throws<DataRootLeaseUnavailableException>(() =>
                DataRootLease.Acquire(junction));

            Assert.Equal(lease.Identity, error.Identity);
            Assert.Equal(lease.CanonicalPath, error.CanonicalPath, StringComparer.OrdinalIgnoreCase);
        }
        finally
        {
            Directory.Delete(junction);
        }
    }

    [Fact]
    public void Short_path_alias_resolves_to_the_same_lease_when_available()
    {
        using var fixture = LeaseFixture.Create("Directory With Long Name");
        Directory.CreateDirectory(fixture.DataRoot);
        var shortPath = TryGetShortPath(fixture.DataRoot);
        if (shortPath is null || string.Equals(shortPath, fixture.DataRoot, StringComparison.OrdinalIgnoreCase))
        {
            Assert.Skip("8.3 names are disabled on this test volume.");
        }

        using var lease = DataRootLease.Acquire(fixture.DataRoot);
        var error = Assert.Throws<DataRootLeaseUnavailableException>(() =>
            DataRootLease.Acquire(shortPath));

        Assert.Equal(lease.Identity, error.Identity);
    }

    [Fact]
    public void Unc_root_is_rejected_before_it_is_accessed()
    {
        var path = $@"\\127.0.0.1\missing-share-{Guid.NewGuid():N}\data";

        var error = Assert.Throws<DataRootPathException>(() => DataRootLease.Acquire(path));

        Assert.Equal(path, error.Path);
        Assert.Contains("network", error.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Operating_system_releases_the_named_mutex_when_holder_is_killed()
    {
        using var fixture = LeaseFixture.Create();
        string mutexName;
        using (var seed = DataRootLease.Acquire(fixture.DataRoot))
        {
            mutexName = seed.MutexName;
        }

        var readyPath = Path.Combine(fixture.Root, "child-ready");
        var scriptPath = Path.Combine(fixture.Root, "hold-mutex.ps1");
        File.WriteAllText(
            scriptPath,
            "param([string]$MutexName,[string]$ReadyPath)\r\n" +
            "$mutex=[Threading.Mutex]::new($false,$MutexName)\r\n" +
            "$owned=$false\r\n" +
            "try {\r\n" +
            "  try { $owned=$mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $owned=$true }\r\n" +
            "  if (!$owned) { exit 2 }\r\n" +
            "  [IO.File]::WriteAllText($ReadyPath,'ready')\r\n" +
            "  [Threading.Thread]::Sleep(60000)\r\n" +
            "} finally {\r\n" +
            "  if ($owned) { $mutex.ReleaseMutex() }\r\n" +
            "  $mutex.Dispose()\r\n" +
            "}\r\n",
            new UTF8Encoding(encoderShouldEmitUTF8Identifier: true));

        using var child = Process.Start(new ProcessStartInfo
        {
            FileName = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.Windows),
                "System32",
                "WindowsPowerShell",
                "v1.0",
                "powershell.exe"),
            UseShellExecute = false,
            CreateNoWindow = true,
            ArgumentList =
            {
                "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath,
                "-MutexName", mutexName, "-ReadyPath", readyPath,
            },
        }) ?? throw new InvalidOperationException("The mutex-holder process did not start.");

        try
        {
            Assert.True(
                SpinWait.SpinUntil(() => File.Exists(readyPath) || child.HasExited, TimeSpan.FromSeconds(10)),
                "The mutex-holder process did not become ready.");
            Assert.False(child.HasExited, "The mutex-holder process exited before the lease check.");
            Assert.Throws<DataRootLeaseUnavailableException>(() =>
                DataRootLease.Acquire(fixture.DataRoot));

            child.Kill(entireProcessTree: true);
            Assert.True(child.WaitForExit(10_000));

            using var lease = DataRootLease.Acquire(fixture.DataRoot);
            Assert.Equal(mutexName, lease.MutexName);
        }
        finally
        {
            if (!child.HasExited)
            {
                child.Kill(entireProcessTree: true);
                child.WaitForExit();
            }
        }
    }

    private static bool TryCreateJunction(string junction, string target)
    {
        using var process = Process.Start(new ProcessStartInfo
        {
            FileName = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "cmd.exe"),
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            ArgumentList = { "/d", "/c", "mklink", "/J", junction, target },
        });
        if (process is null)
        {
            return false;
        }

        process.WaitForExit();
        return process.ExitCode == 0 && Directory.Exists(junction);
    }

    private static string? TryGetShortPath(string path)
    {
        var capacity = GetShortPathName(path, null, 0);
        if (capacity == 0)
        {
            return null;
        }

        var buffer = new StringBuilder((int)capacity);
        return GetShortPathName(path, buffer, capacity) == 0 ? null : buffer.ToString();
    }

    [DllImport("kernel32.dll", EntryPoint = "GetShortPathNameW", CharSet = CharSet.Unicode)]
    private static extern uint GetShortPathName(string longPath, StringBuilder? shortPath, uint bufferLength);

    private sealed class LeaseFixture : IDisposable
    {
        private LeaseFixture(string root, string dataRoot)
        {
            Root = root;
            DataRoot = dataRoot;
        }

        public string Root { get; }

        public string DataRoot { get; }

        public static LeaseFixture Create(string dataRootName = "data-root")
        {
            var root = Path.Combine(Path.GetTempPath(), $"techmap-data-root-lease-{Guid.NewGuid():N}");
            Directory.CreateDirectory(root);
            return new LeaseFixture(root, Path.Combine(root, dataRootName));
        }

        public void Dispose()
        {
            Directory.Delete(Root, recursive: true);
        }
    }
}
