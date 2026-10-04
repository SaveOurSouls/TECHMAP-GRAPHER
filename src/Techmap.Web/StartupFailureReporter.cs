using System.Runtime.InteropServices;
using System.Text;
using Techmap.Infrastructure.Sqlite;

namespace Techmap.Web;

public static class StartupFailureReporter
{
    private const string NoDialogSwitch = "--no-error-dialog";
    private const string LogRootPrefix = "--error-log-root=";
    private const uint MessageBoxError = 0x00000010;

    public static int Report(
        Exception exception,
        IReadOnlyCollection<string> arguments,
        string? logRootOverride = null,
        Action<string>? dialog = null)
    {
        ArgumentNullException.ThrowIfNull(exception);
        ArgumentNullException.ThrowIfNull(arguments);

        string? logPath = null;
        try
        {
            logPath = TryWriteLog(exception, SafeLogRoots(arguments, logRootOverride));
        }
        catch
        {
            // The original startup error remains the useful failure.
        }

        var message = BuildUserMessage(exception, logPath);
        try
        {
            Console.Error.WriteLine($"TECHMAP_STARTUP_ERROR={exception.GetType().Name}");
            Console.Error.WriteLine(message);
        }
        catch
        {
            // The log and optional dialog can still explain the failure.
        }

        if (ShouldShowDialog(arguments))
        {
            TryShowDialog(message, dialog);
        }

        return 1;
    }

    public static string BuildUserMessage(Exception exception, string? logPath)
    {
        ArgumentNullException.ThrowIfNull(exception);
        var action = exception switch
        {
            InvalidDataException when Contains(exception.Message, "package") ||
                Contains(exception.Message, "manifest") ||
                Contains(exception.Message, "version.json") =>
                "Файлы приложения повреждены или распакованы не полностью. " +
                "Распакуйте исходный ZIP заново в новую пустую папку.",
            UnauthorizedAccessException =>
                "Windows запретила доступ к файлам приложения или каталогу данных.",
            IOException =>
                "Не удалось прочитать или записать необходимые файлы.",
            ArgumentException =>
                "Параметры запуска указаны неверно.",
            _ =>
                "Во время запуска произошла внутренняя ошибка.",
        };
        var logMessage = logPath is null
            ? "Журнал создать не удалось."
            : $"Журнал: {logPath}";
        return $"TECHMAP-GRAPHER не запущен.\n\n{action}\n\n" +
            $"Техническая причина: {Normalize(exception.Message)}\n\n{logMessage}";
    }

    internal static bool ShouldShowDialog(IReadOnlyCollection<string> arguments) =>
        OperatingSystem.IsWindows() &&
        Environment.UserInteractive &&
        !arguments.Any(argument =>
            argument.Equals(NoDialogSwitch, StringComparison.OrdinalIgnoreCase) ||
                argument.Equals("--no-browser", StringComparison.OrdinalIgnoreCase) ||
                argument.Equals("--verify-package", StringComparison.OrdinalIgnoreCase) ||
                argument.Equals("--create-backup", StringComparison.OrdinalIgnoreCase) ||
                argument.StartsWith("--export-project=", StringComparison.OrdinalIgnoreCase) ||
                argument.StartsWith("--import-project=", StringComparison.OrdinalIgnoreCase) ||
                argument.StartsWith("--dry-run-restore=", StringComparison.OrdinalIgnoreCase) ||
                argument.StartsWith("--prepare-full-restore=", StringComparison.OrdinalIgnoreCase) ||
                argument.StartsWith("--execute-full-restore=", StringComparison.OrdinalIgnoreCase));

    internal static IReadOnlyList<string> SafeLogRoots(
        IReadOnlyCollection<string> arguments,
        string? logRootOverride = null)
    {
        var programRoot = Path.GetFullPath(AppContext.BaseDirectory);
        var configuredDataRoots = arguments
            .Where(value => value.StartsWith("--data-root=", StringComparison.OrdinalIgnoreCase))
            .Select(value => value["--data-root=".Length..])
            .ToArray();
        string? dataRoot;
        try
        {
            dataRoot = configuredDataRoots.Length switch
            {
                0 => Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "TECHMAP-GRAPHER",
                    "data"),
                1 when !string.IsNullOrWhiteSpace(configuredDataRoots[0]) =>
                    Path.GetFullPath(configuredDataRoots[0], programRoot),
                _ => null,
            };
        }
        catch (Exception error) when (
            error is ArgumentException or NotSupportedException or PathTooLongException)
        {
            dataRoot = null;
        }

        var configuredLogRoot = logRootOverride ?? ReadLogRoot(arguments);
        var candidates = new List<string>();
        string? physicalDataRoot = null;
        string? lexicalDataRoot = null;
        if (dataRoot is not null)
        {
            TryResolvePhysicalPath(dataRoot, out physicalDataRoot);
            try
            {
                lexicalDataRoot = Path.GetFullPath(dataRoot, programRoot);
            }
            catch (Exception error) when (
                error is ArgumentException or NotSupportedException or PathTooLongException)
            {
                // Invalid untrusted paths are never used for logging.
            }
        }

        if (dataRoot is not null && !string.IsNullOrWhiteSpace(configuredLogRoot))
        {
            try
            {
                var fullLogRoot = Path.GetFullPath(configuredLogRoot, programRoot);
                if (physicalDataRoot is not null &&
                    TryResolvePhysicalPath(fullLogRoot, out var physicalLogRoot) &&
                    !PathsOverlap(physicalDataRoot, physicalLogRoot))
                {
                    candidates.Add(physicalLogRoot);
                }
                else if (physicalDataRoot is null && lexicalDataRoot is not null &&
                    !PathsOverlap(lexicalDataRoot, fullLogRoot))
                {
                    candidates.Add(fullLogRoot);
                }
            }
            catch (Exception error) when (
                error is ArgumentException or NotSupportedException or PathTooLongException)
            {
                // Invalid untrusted paths are never used for logging.
            }
        }

        if (dataRoot is not null)
        {
            var fallbackRoots = new List<string>();
            if (physicalDataRoot is not null)
            {
                fallbackRoots.Add(
                    $"{Path.TrimEndingDirectorySeparator(physicalDataRoot)}-startup-errors");
            }
            else if (lexicalDataRoot is not null)
            {
                fallbackRoots.Add(
                    $"{Path.TrimEndingDirectorySeparator(lexicalDataRoot)}-startup-errors");
            }

            fallbackRoots.AddRange(
                [
                    Path.Combine(
                        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                        "TECHMAP-GRAPHER",
                        "logs"),
                    Path.Combine(Path.GetTempPath(), "TECHMAP-GRAPHER", "logs"),
                ]);

            foreach (var fallback in fallbackRoots)
            {
                if (physicalDataRoot is not null)
                {
                    if (TryResolvePhysicalPath(fallback, out var physicalFallback))
                    {
                        if (PathsOverlap(physicalDataRoot, physicalFallback))
                        {
                            continue;
                        }

                        if (!candidates.Contains(physicalFallback, StringComparer.OrdinalIgnoreCase))
                        {
                            candidates.Add(physicalFallback);
                        }
                        continue;
                    }

                    // A fallback may itself have an ACL-restricted ancestor.
                    // Its lexical path is still safe to use for these fixed,
                    // independent locations after the physical overlap check
                    // could not be performed.
                    try
                    {
                        if (!PathsOverlap(physicalDataRoot, fallback) &&
                            !candidates.Contains(fallback, StringComparer.OrdinalIgnoreCase))
                        {
                            candidates.Add(fallback);
                        }
                    }
                    catch (Exception error) when (
                        error is ArgumentException or NotSupportedException or PathTooLongException)
                    {
                        // Invalid environment paths are skipped.
                    }
                    continue;
                }

                // ACL-restricted data roots cannot be canonicalised. Keep the
                // fallback independent by checking the lexical paths and let
                // TryWriteLog perform the final writability check.
                try
                {
                    if (!PathsOverlap(dataRoot, fallback) &&
                        !candidates.Contains(fallback, StringComparer.OrdinalIgnoreCase))
                    {
                        candidates.Add(fallback);
                    }
                }
                catch (Exception error) when (
                    error is ArgumentException or NotSupportedException or PathTooLongException)
                {
                    // Invalid environment paths are skipped.
                }
            }
        }

        return candidates;
    }

    private static bool TryResolvePhysicalPath(string path, out string resolved)
    {
        try
        {
            resolved = DataRootLease.ResolveProspectiveDirectoryPath(path);
            return true;
        }
        catch (Exception error) when (
            error is IOException or UnauthorizedAccessException or
                ArgumentException or NotSupportedException or PathTooLongException)
        {
            resolved = string.Empty;
            return false;
        }
    }

    private static string? TryWriteLog(Exception exception, IReadOnlyList<string> candidates)
    {
        foreach (var candidate in candidates)
        {
            try
            {
                Directory.CreateDirectory(candidate);
                var path = Path.Combine(
                    candidate,
                    $"startup-error-{DateTime.UtcNow:yyyyMMdd-HHmmss}-{Environment.ProcessId}.log");
                var content = new StringBuilder()
                    .AppendLine("TECHMAP-GRAPHER startup failure")
                    .AppendLine($"UTC: {DateTime.UtcNow:O}")
                    .AppendLine($"OS: {Environment.OSVersion}")
                    .AppendLine($"Runtime: {Environment.Version}")
                    .AppendLine()
                    .AppendLine(exception.ToString())
                    .ToString();
                File.WriteAllText(path, content, new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
                return path;
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException)
            {
                // Try the next user-writable location.
            }
        }

        return null;
    }

    private static bool PathsOverlap(string left, string right)
    {
        var leftFull = Path.GetFullPath(left).TrimEnd(Path.DirectorySeparatorChar);
        var rightFull = Path.GetFullPath(right).TrimEnd(Path.DirectorySeparatorChar);
        return IsSameOrDescendant(leftFull, rightFull) || IsSameOrDescendant(rightFull, leftFull);
    }

    private static bool IsSameOrDescendant(string root, string candidate)
    {
        var prefix = root + Path.DirectorySeparatorChar;
        return string.Equals(root, candidate, StringComparison.OrdinalIgnoreCase) ||
            candidate.StartsWith(prefix, StringComparison.OrdinalIgnoreCase);
    }

    private static void TryShowDialog(string message, Action<string>? dialog)
    {
        try
        {
            if (dialog is not null)
            {
                dialog(message);
            }
            else
            {
                _ = MessageBoxW(
                    IntPtr.Zero,
                    message,
                    "TECHMAP-GRAPHER — ошибка запуска",
                    MessageBoxError);
            }
        }
        catch
        {
            // stderr and the log remain available.
        }
    }

    private static string? ReadLogRoot(IReadOnlyCollection<string> arguments)
    {
        var values = arguments
            .Where(value => value.StartsWith(LogRootPrefix, StringComparison.OrdinalIgnoreCase))
            .Select(value => value[LogRootPrefix.Length..])
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .ToArray();
        return values.Length == 1 ? values[0] : null;
    }

    private static bool Contains(string value, string fragment) =>
        value.Contains(fragment, StringComparison.OrdinalIgnoreCase);

    private static string Normalize(string value)
    {
        var normalized = value.Replace('\r', ' ').Replace('\n', ' ').Trim();
        return normalized.Length <= 500 ? normalized : normalized[..500] + "…";
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int MessageBoxW(IntPtr window, string text, string caption, uint type);
}
