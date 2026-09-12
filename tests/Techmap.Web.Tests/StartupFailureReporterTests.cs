using Techmap.Web;
using Xunit;
using System.Diagnostics;
using Techmap.Infrastructure.Sqlite;

namespace Techmap.Web.Tests;

public sealed class StartupFailureReporterTests : IDisposable
{
    private readonly string logRoot = Path.Combine(
        Path.GetTempPath(),
        "techmap-startup-reporter-tests",
        Guid.NewGuid().ToString("N"));

    [Fact]
    public void Package_failure_returns_one_and_produces_an_actionable_utf8_log()
    {
        var exception = new InvalidDataException("Package file hash mismatch: README-START.html");

        var exitCode = StartupFailureReporter.Report(
            exception,
            ["--no-browser"],
            logRoot,
            _ => throw new InvalidOperationException("Dialog must be suppressed."));

        Assert.Equal(1, exitCode);
        var log = Assert.Single(Directory.GetFiles(logRoot, "startup-error-*.log"));
        Assert.Contains("Package file hash mismatch", File.ReadAllText(log));
        var message = StartupFailureReporter.BuildUserMessage(exception, log);
        Assert.Contains("Распакуйте исходный ZIP заново", message);
        Assert.Contains(log, message);
    }

    [Theory]
    [InlineData("--no-error-dialog")]
    [InlineData("--no-browser")]
    [InlineData("--verify-package")]
    [InlineData("--create-backup")]
    [InlineData("--export-project=11111111-1111-1111-1111-111111111111")]
    [InlineData("--import-project=source.techmap-project.zip")]
    [InlineData("--dry-run-restore=backup")]
    [InlineData("--prepare-full-restore=backup")]
    [InlineData("--execute-full-restore=plan.json")]
    public void Automated_modes_suppress_the_dialog(string argument)
    {
        Assert.False(StartupFailureReporter.ShouldShowDialog([argument]));
    }

    [Fact]
    public void Unexpected_failure_message_is_bounded()
    {
        var message = StartupFailureReporter.BuildUserMessage(
            new InvalidOperationException(new string('x', 700)),
            null);

        Assert.Contains("внутренняя ошибка", message);
        Assert.Contains("Журнал создать не удалось", message);
        Assert.True(message.Length < 800);
    }

    [Fact]
    public void Log_root_that_overlaps_data_root_is_replaced_with_a_safe_sibling()
    {
        var dataRoot = Path.Combine(logRoot, "data");

        var roots = StartupFailureReporter.SafeLogRoots(
            [$"--data-root={dataRoot}", $"--error-log-root={dataRoot}"]);

        Assert.DoesNotContain(roots, root =>
            root.Equals(dataRoot, StringComparison.OrdinalIgnoreCase) ||
            root.StartsWith(dataRoot + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase));
        var expectedSibling = DataRootLease.ResolveProspectiveDirectoryPath($"{dataRoot}-startup-errors");
        Assert.Equal(expectedSibling, roots[0], StringComparer.OrdinalIgnoreCase);
    }

    [Fact]
    public void Log_root_junction_to_data_root_is_rejected_before_writing()
    {
        var dataRoot = Path.Combine(logRoot, "data");
        var alias = Path.Combine(logRoot, "log-alias");
        Directory.CreateDirectory(dataRoot);
        if (!TryCreateJunction(alias, dataRoot))
        {
            Assert.Skip("This Windows environment does not allow creation of a test junction.");
        }

        try
        {
            var exitCode = StartupFailureReporter.Report(
                new InvalidDataException("Package file size mismatch: README-START.html"),
                [$"--data-root={dataRoot}", $"--error-log-root={alias}", "--no-browser"]);

            Assert.Equal(1, exitCode);
            Assert.Empty(Directory.GetFiles(dataRoot, "startup-error-*.log", SearchOption.AllDirectories));
            Assert.Single(Directory.GetFiles(
                $"{dataRoot}-startup-errors",
                "startup-error-*.log",
                SearchOption.TopDirectoryOnly));
        }
        finally
        {
            if (Directory.Exists(alias))
            {
                Directory.Delete(alias);
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

    public void Dispose()
    {
        if (Directory.Exists(logRoot))
        {
            Directory.Delete(logRoot, recursive: true);
        }
    }
}
