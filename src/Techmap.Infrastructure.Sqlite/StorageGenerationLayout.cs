using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;

namespace Techmap.Infrastructure.Sqlite;

public sealed record StorageGenerationLayout(
    string DataRootPath,
    string CurrentPointerPath,
    string GenerationsPath,
    string GenerationName,
    string GenerationPath,
    string DatabasePath,
    string ReadyMarkerPath)
{
    public const string CurrentPointerFileName = "CURRENT";
    public const string GenerationsDirectoryName = "generations";
    public const string InitialGenerationName = "generation-00000001";
    public const string DatabaseFileName = "app.db";
    public const string ReadyMarkerFileName = "READY";
    private const uint MoveFileReplaceExisting = 0x00000001;
    private const uint MoveFileWriteThrough = 0x00000008;

    private static readonly Regex GenerationNamePattern = new(
        @"\Ageneration-[0-9]{8}\z",
        RegexOptions.CultureInvariant | RegexOptions.NonBacktracking);

    internal static PreparedStorageGeneration Prepare(string dataRoot)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(dataRoot);
        var resolvedRoot = Path.GetFullPath(dataRoot);
        Directory.CreateDirectory(resolvedRoot);
        RejectReparsePoint(resolvedRoot, "The data root must not be a reparse point.");

        var generationsPath = Path.Combine(resolvedRoot, GenerationsDirectoryName);
        Directory.CreateDirectory(generationsPath);
        RejectReparsePoint(generationsPath, "The generations directory must not be a reparse point.");

        var currentPointerPath = Path.Combine(resolvedRoot, CurrentPointerFileName);
        var initialize = !File.Exists(currentPointerPath);
        if (initialize)
        {
            var existingEntries = Directory.GetFileSystemEntries(generationsPath);
            if (existingEntries.Any(entry =>
                    !string.Equals(
                        Path.GetFileName(entry),
                        InitialGenerationName,
                        StringComparison.Ordinal) ||
                    !Directory.Exists(entry)) ||
                existingEntries.Length > 1)
            {
                throw new InvalidDataException(
                    "Storage generations exist without an unambiguous CURRENT pointer.");
            }
        }

        var generationName = initialize
            ? InitialGenerationName
            : ReadCurrentGeneration(currentPointerPath);
        ValidateGenerationName(generationName);

        var generationPath = Path.Combine(generationsPath, generationName);
        var databasePath = Path.Combine(generationPath, DatabaseFileName);
        var readyMarkerPath = Path.Combine(generationPath, ReadyMarkerFileName);
        if (initialize)
        {
            Directory.CreateDirectory(generationPath);
            RejectReparsePoint(generationPath, "The initial generation must not be a reparse point.");

            if (File.Exists(readyMarkerPath) && File.Exists(databasePath))
            {
                // A prior process completed the initial generation and crashed before CURRENT publish.
                initialize = false;
            }
            else
            {
                DeleteIncompleteInitialFiles(databasePath, readyMarkerPath);
            }
        }
        else if (!Directory.Exists(generationPath))
        {
            throw new InvalidDataException(
                $"The active storage generation '{generationName}' does not exist.");
        }

        RejectReparsePoint(generationPath, "The active generation must not be a reparse point.");
        if (!initialize && (!File.Exists(databasePath) || !File.Exists(readyMarkerPath)))
        {
            throw new InvalidDataException("The active storage generation is incomplete.");
        }

        if (File.Exists(databasePath))
        {
            RejectReparsePoint(databasePath, "The active SQLite database must not be a reparse point.");
        }

        if (File.Exists(readyMarkerPath))
        {
            RejectReparsePoint(readyMarkerPath, "The READY marker must not be a reparse point.");
        }

        return new PreparedStorageGeneration(
            new StorageGenerationLayout(
                resolvedRoot,
                currentPointerPath,
                generationsPath,
                generationName,
                generationPath,
                databasePath,
                readyMarkerPath),
            initialize,
            PublishCurrent: !File.Exists(currentPointerPath));
    }

    internal static void PublishReadyAndCurrent(PreparedStorageGeneration prepared)
    {
        var layout = prepared.Layout;
        if (prepared.Initialize)
        {
            PublishNewDurableFile(layout.ReadyMarkerPath, "ready\n");
        }

        if (prepared.PublishCurrent)
        {
            try
            {
                PublishNewDurableFile(layout.CurrentPointerPath, $"{layout.GenerationName}\n");
            }
            catch (IOException) when (File.Exists(layout.CurrentPointerPath) &&
                                      ReadCurrentGeneration(layout.CurrentPointerPath) == layout.GenerationName)
            {
                // A concurrent initializer published the same completed generation.
            }
        }
    }

    internal static void PublishNewDurableFile(string destinationPath, string content)
    {
        var temporaryPath = Path.Combine(
            Path.GetDirectoryName(destinationPath)
                ?? throw new InvalidOperationException("A storage marker must have a parent directory."),
            $".{Path.GetFileName(destinationPath)}.{Environment.ProcessId}.{Guid.NewGuid():N}.tmp");
        try
        {
            var bytes = Encoding.UTF8.GetBytes(content);
            using (var stream = new FileStream(
                       temporaryPath,
                       FileMode.CreateNew,
                       FileAccess.Write,
                       FileShare.None,
                       bufferSize: 4096,
                       FileOptions.WriteThrough))
            {
                stream.Write(bytes);
                stream.Flush(flushToDisk: true);
            }

            MoveNewDurably(temporaryPath, destinationPath);
        }
        finally
        {
            TryDeleteTemporary(temporaryPath);
        }
    }

    internal static void ReplaceCurrentDurably(
        string currentPointerPath,
        string generationName,
        Action? afterReplacement = null)
    {
        ValidateGenerationName(generationName);
        var temporaryPath = Path.Combine(
            Path.GetDirectoryName(currentPointerPath)
                ?? throw new InvalidOperationException("The CURRENT pointer must have a parent directory."),
            $".{CurrentPointerFileName}.{Environment.ProcessId}.{Guid.NewGuid():N}.tmp");
        try
        {
            var bytes = Encoding.UTF8.GetBytes($"{generationName}\n");
            using (var stream = new FileStream(
                       temporaryPath,
                       FileMode.CreateNew,
                       FileAccess.Write,
                       FileShare.None,
                       bufferSize: 4096,
                       FileOptions.WriteThrough))
            {
                stream.Write(bytes);
                stream.Flush(flushToDisk: true);
            }

            try
            {
                MoveReplaceDurably(temporaryPath, currentPointerPath);
                afterReplacement?.Invoke();
            }
            catch (Exception) when (TryReadExpectedCurrent(currentPointerPath, generationName))
            {
                // A rename is the commit point. If a wrapper or later managed operation
                // failed after the namespace change, report success and never let a caller
                // delete the generation that CURRENT already names.
            }
        }
        finally
        {
            TryDeleteTemporary(temporaryPath);
        }
    }

    internal static void ReplaceDurableFile(string destinationPath, string content)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(destinationPath);
        var parent = Path.GetDirectoryName(destinationPath)
            ?? throw new InvalidOperationException("A durable file must have a parent directory.");
        var temporaryPath = Path.Combine(
            parent,
            $".{Path.GetFileName(destinationPath)}.{Environment.ProcessId}.{Guid.NewGuid():N}.tmp");
        try
        {
            var bytes = Encoding.UTF8.GetBytes(content);
            using (var stream = new FileStream(
                       temporaryPath,
                       FileMode.CreateNew,
                       FileAccess.Write,
                       FileShare.None,
                       bufferSize: 4096,
                       FileOptions.WriteThrough))
            {
                stream.Write(bytes);
                stream.Flush(flushToDisk: true);
            }

            MoveReplaceDurably(temporaryPath, destinationPath);
        }
        finally
        {
            TryDeleteTemporary(temporaryPath);
        }
    }

    internal static void MoveNewDurably(string sourcePath, string destinationPath)
    {
        if (!MoveFileEx(sourcePath, destinationPath, MoveFileWriteThrough))
        {
            throw new IOException(
                "A durable storage item publication failed.",
                new Win32Exception(Marshal.GetLastWin32Error()));
        }
    }

    private static void MoveReplaceDurably(string sourcePath, string destinationPath)
    {
        if (!MoveFileEx(
                sourcePath,
                destinationPath,
                MoveFileReplaceExisting | MoveFileWriteThrough))
        {
            throw new IOException(
                "The durable CURRENT replacement failed.",
                new Win32Exception(Marshal.GetLastWin32Error()));
        }
    }

    private static bool TryReadExpectedCurrent(string currentPointerPath, string generationName)
    {
        try
        {
            return string.Equals(
                ReadCurrentGeneration(currentPointerPath),
                generationName,
                StringComparison.Ordinal);
        }
        catch (Exception error) when (
            error is IOException or UnauthorizedAccessException or InvalidDataException)
        {
            return false;
        }
    }

    private static void TryDeleteTemporary(string temporaryPath)
    {
        try
        {
            File.Delete(temporaryPath);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            // A fully written orphan temporary file is ignored and can be removed by maintenance.
        }
    }

    internal static string ReadCurrentGeneration(string currentPointerPath)
    {
        RejectReparsePoint(currentPointerPath, "The CURRENT pointer must not be a reparse point.");
        var value = File.ReadAllText(currentPointerPath, Encoding.UTF8);
        if (!value.EndsWith('\n') || value.AsSpan(0, value.Length - 1).IndexOfAny('\r', '\n') >= 0)
        {
            throw new InvalidDataException("The CURRENT pointer has an invalid format.");
        }

        return value.TrimEnd('\r', '\n');
    }

    internal static void ValidateGenerationName(string generationName)
    {
        if (!GenerationNamePattern.IsMatch(generationName))
        {
            throw new InvalidDataException("The CURRENT pointer contains an invalid generation name.");
        }
    }

    private static void DeleteIncompleteInitialFiles(string databasePath, string readyMarkerPath)
    {
        File.Delete(readyMarkerPath);
        File.Delete(databasePath);
        File.Delete($"{databasePath}-wal");
        File.Delete($"{databasePath}-shm");
        File.Delete($"{databasePath}-journal");
    }

    private static void RejectReparsePoint(string path, string message)
    {
        if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0)
        {
            throw new InvalidDataException(message);
        }
    }

    [DllImport("kernel32.dll", EntryPoint = "MoveFileExW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool MoveFileEx(string existingFileName, string? newFileName, uint flags);
}

internal sealed record PreparedStorageGeneration(
    StorageGenerationLayout Layout,
    bool Initialize,
    bool PublishCurrent);
