using System.ComponentModel;
using System.Runtime.ExceptionServices;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace Techmap.Infrastructure.Sqlite;

public readonly record struct DataRootIdentity(
    ulong VolumeSerialNumber,
    ulong FileIdHigh,
    ulong FileIdLow)
{
    public string StableKey => $"{VolumeSerialNumber:x16}-{FileIdHigh:x16}{FileIdLow:x16}";
}

/// <summary>
/// Holds a physical-directory writer lease until it is disposed or the process exits.
/// </summary>
public sealed class DataRootLease : IDisposable, IAsyncDisposable
{
    private const uint FileFlagBackupSemantics = 0x02000000;
    private const uint FileReadAttributes = 0x0080;
    private const uint FileNameNormalized = 0x0;
    private const uint VolumeNameDos = 0x0;
    private const uint DriveUnknown = 0;
    private const uint DriveNoRootDirectory = 1;
    private const uint DriveRemovable = 2;
    private const uint DriveFixed = 3;
    private const uint DriveRemote = 4;
    private const uint DriveRamDisk = 6;

    private SafeFileHandle? directoryHandle;
    private NamedMutexLease? writerMutex;

    private DataRootLease(
        string canonicalPath,
        DataRootIdentity identity,
        SafeFileHandle directoryHandle,
        NamedMutexLease writerMutex)
    {
        CanonicalPath = canonicalPath;
        Identity = identity;
        this.directoryHandle = directoryHandle;
        this.writerMutex = writerMutex;
    }

    public string CanonicalPath { get; }

    public DataRootIdentity Identity { get; }

    public string MutexName => BuildMutexName(Identity);

    public static string ResolveProspectiveDirectoryPath(string path)
    {
        EnsureWindows();
        var fullPath = Path.GetFullPath(path);
        var existing = fullPath;
        var missingSegments = new Stack<string>();
        while (!Directory.Exists(existing))
        {
            var leaf = Path.GetFileName(existing);
            if (string.IsNullOrEmpty(leaf))
            {
                throw new DirectoryNotFoundException("An existing directory ancestor cannot be found.");
            }

            missingSegments.Push(leaf);
            existing = Path.GetDirectoryName(existing)
                ?? throw new DirectoryNotFoundException("An existing directory ancestor cannot be found.");
        }

        using var directory = OpenDirectory(existing);
        var result = ResolveFinalPath(directory);
        while (missingSegments.TryPop(out var segment))
        {
            result = Path.Combine(result, segment);
        }

        return Path.GetFullPath(result);
    }

    internal static ExistingDirectoryGuard GuardExistingDirectory(string path)
    {
        EnsureWindows();
        var directory = OpenDirectory(Path.GetFullPath(path));
        try
        {
            var canonicalPath = ResolveFinalPath(directory);
            return new ExistingDirectoryGuard(
                canonicalPath,
                ReadIdentity(directory, canonicalPath),
                directory);
        }
        catch
        {
            directory.Dispose();
            throw;
        }
    }

    public static DataRootLease Acquire(string dataRoot)
    {
        EnsureWindows();
        if (string.IsNullOrWhiteSpace(dataRoot))
        {
            throw new ArgumentException("A data-root path must be specified.", nameof(dataRoot));
        }

        string requestedPath;
        try
        {
            requestedPath = NormalizeFinalPath(Path.GetFullPath(dataRoot));
        }
        catch (Exception error) when (error is ArgumentException or NotSupportedException or PathTooLongException)
        {
            throw new DataRootPathException("The data-root path is invalid.", dataRoot, error);
        }

        RejectNetworkPath(requestedPath);
        EnsureLocalDrive(requestedPath);
        EnsureExistingAncestorIsLocal(requestedPath);

        try
        {
            Directory.CreateDirectory(requestedPath);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            throw new DataRootPathException("The data-root directory cannot be created.", requestedPath, error);
        }

        return AcquireOpenedRoot(requestedPath, expectedIdentity: null, unavailableIsNull: false)
            ?? throw new InvalidOperationException("The data-root lease could not be acquired.");
    }

    public static DataRootLease? TryAcquireExisting(DataRootLeaseUnavailableException contention)
    {
        ArgumentNullException.ThrowIfNull(contention);
        EnsureWindows();
        if (!Directory.Exists(contention.CanonicalPath))
        {
            return null;
        }

        return AcquireOpenedRoot(contention.CanonicalPath, contention.Identity, unavailableIsNull: true);
    }

    public void Dispose()
    {
        Interlocked.Exchange(ref writerMutex, null)?.Dispose();
        Interlocked.Exchange(ref directoryHandle, null)?.Dispose();
        GC.SuppressFinalize(this);
    }

    public ValueTask DisposeAsync()
    {
        Dispose();
        return ValueTask.CompletedTask;
    }

    private static DataRootLease? AcquireOpenedRoot(
        string path,
        DataRootIdentity? expectedIdentity,
        bool unavailableIsNull)
    {
        SafeFileHandle? directory = null;
        NamedMutexLease? mutex = null;
        try
        {
            directory = OpenDirectory(path);
            var canonicalPath = ResolveFinalPath(directory);
            RejectNetworkPath(canonicalPath);
            EnsureLocalDrive(canonicalPath);
            var identity = ReadIdentity(directory, canonicalPath);
            if (expectedIdentity is not null && identity != expectedIdentity.Value)
            {
                return null;
            }

            mutex = NamedMutexLease.TryAcquire(BuildMutexName(identity));
            if (mutex is null)
            {
                if (unavailableIsNull)
                {
                    return null;
                }

                throw new DataRootLeaseUnavailableException(canonicalPath, identity);
            }

            var result = new DataRootLease(canonicalPath, identity, directory, mutex);
            directory = null;
            mutex = null;
            return result;
        }
        catch (DataRootPathException) when (unavailableIsNull)
        {
            return null;
        }
        catch (DataRootPathException)
        {
            throw;
        }
        catch (DataRootLeaseUnavailableException)
        {
            throw;
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or Win32Exception)
        {
            throw new DataRootPathException(
                "The data-root identity or writer lease cannot be verified.",
                path,
                error);
        }
        finally
        {
            mutex?.Dispose();
            directory?.Dispose();
        }
    }

    private static SafeFileHandle OpenDirectory(string path)
    {
        var handle = CreateFile(
            path,
            desiredAccess: FileReadAttributes,
            FileShare.Read | FileShare.Write,
            securityAttributes: 0,
            FileMode.Open,
            FileFlagBackupSemantics,
            templateFile: 0);
        if (!handle.IsInvalid)
        {
            return handle;
        }

        var error = new Win32Exception(Marshal.GetLastWin32Error());
        handle.Dispose();
        throw new DataRootPathException(
            "The data-root directory cannot be opened for identity resolution.",
            path,
            error);
    }

    private static DataRootIdentity ReadIdentity(SafeFileHandle directory, string path)
    {
        if (!GetFileInformationByHandleEx(
                directory,
                FileInfoByHandleClass.FileIdInfo,
                out var information,
                (uint)Marshal.SizeOf<WindowsFileIdInfo>()))
        {
            throw new DataRootPathException(
                "The physical data-root identity cannot be read.",
                path,
                new Win32Exception(Marshal.GetLastWin32Error()));
        }

        return new DataRootIdentity(
            information.VolumeSerialNumber,
            information.FileId.High,
            information.FileId.Low);
    }

    private static string BuildMutexName(DataRootIdentity identity)
    {
        return $@"Global\TECHMAP-GRAPHER.DataRoot.v2.{identity.StableKey}";
    }

    private static string ResolveFinalPath(SafeFileHandle directory)
    {
        var capacity = 512;
        while (true)
        {
            var buffer = new StringBuilder(capacity);
            var length = GetFinalPathNameByHandle(
                directory,
                buffer,
                (uint)buffer.Capacity,
                FileNameNormalized | VolumeNameDos);
            if (length == 0)
            {
                throw new DataRootPathException(
                    "The final data-root path cannot be resolved.",
                    string.Empty,
                    new Win32Exception(Marshal.GetLastWin32Error()));
            }

            if (length < buffer.Capacity)
            {
                return NormalizeFinalPath(buffer.ToString());
            }

            capacity = checked((int)length + 1);
        }
    }

    private static string NormalizeFinalPath(string path)
    {
        const string extendedUncPrefix = @"\\?\UNC\";
        const string extendedPrefix = @"\\?\";
        if (path.StartsWith(extendedUncPrefix, StringComparison.OrdinalIgnoreCase))
        {
            return @"\\" + path[extendedUncPrefix.Length..];
        }

        if (path.StartsWith(extendedPrefix, StringComparison.OrdinalIgnoreCase) &&
            path.Length >= extendedPrefix.Length + 3 &&
            char.IsAsciiLetter(path[extendedPrefix.Length]) &&
            path[extendedPrefix.Length + 1] == ':')
        {
            path = path[extendedPrefix.Length..];
        }

        return Path.TrimEndingDirectorySeparator(path);
    }

    private static void RejectNetworkPath(string path)
    {
        const string extendedPrefix = @"\\?\";
        const string extendedUncPrefix = @"\\?\UNC\";
        const string devicePrefix = @"\\.\";
        if (path.StartsWith(extendedUncPrefix, StringComparison.OrdinalIgnoreCase) ||
            path.StartsWith(devicePrefix, StringComparison.OrdinalIgnoreCase) ||
            (path.StartsWith(@"\\", StringComparison.Ordinal) &&
             !path.StartsWith(extendedPrefix, StringComparison.OrdinalIgnoreCase)))
        {
            throw new DataRootPathException("A data root must not be placed on a network path.", path);
        }
    }

    private static void EnsureLocalDrive(string path)
    {
        var root = Path.GetPathRoot(path);
        if (string.IsNullOrEmpty(root))
        {
            throw new DataRootPathException("The data-root drive cannot be determined.", path);
        }

        var driveType = GetDriveType(root);
        if (driveType is DriveFixed or DriveRemovable or DriveRamDisk)
        {
            return;
        }

        var reason = driveType switch
        {
            DriveRemote => "Network drives cannot contain a data root.",
            DriveUnknown or DriveNoRootDirectory => "The data-root drive is not available.",
            _ => "The selected drive cannot contain a writable data root.",
        };
        throw new DataRootPathException(reason, path);
    }

    private static void EnsureExistingAncestorIsLocal(string path)
    {
        var candidate = path;
        while (!Directory.Exists(candidate))
        {
            candidate = Path.GetDirectoryName(candidate)
                ?? throw new DataRootPathException("An existing data-root ancestor cannot be found.", path);
        }

        using var ancestor = OpenDirectory(candidate);
        var canonicalAncestor = ResolveFinalPath(ancestor);
        RejectNetworkPath(canonicalAncestor);
        EnsureLocalDrive(canonicalAncestor);
    }

    private static void EnsureWindows()
    {
        if (!OperatingSystem.IsWindows())
        {
            throw new PlatformNotSupportedException("The data-root lease requires Windows.");
        }
    }

    private enum FileInfoByHandleClass
    {
        FileIdInfo = 18,
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct WindowsFileIdInfo
    {
        public ulong VolumeSerialNumber;
        public WindowsFileId FileId;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct WindowsFileId
    {
        public ulong Low;
        public ulong High;
    }

    [DllImport("kernel32.dll", EntryPoint = "CreateFileW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFile(
        string fileName,
        uint desiredAccess,
        FileShare shareMode,
        nint securityAttributes,
        FileMode creationDisposition,
        uint flagsAndAttributes,
        nint templateFile);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetFileInformationByHandleEx(
        SafeFileHandle file,
        FileInfoByHandleClass fileInformationClass,
        out WindowsFileIdInfo fileInformation,
        uint bufferSize);

    [DllImport("kernel32.dll", EntryPoint = "GetFinalPathNameByHandleW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetFinalPathNameByHandle(
        SafeFileHandle file,
        StringBuilder filePath,
        uint filePathSize,
        uint flags);

    [DllImport("kernel32.dll", EntryPoint = "GetDriveTypeW", CharSet = CharSet.Unicode)]
    private static extern uint GetDriveType(string rootPathName);

    private sealed class NamedMutexLease : IDisposable
    {
        private readonly ManualResetEventSlim release = new(initialState: false);
        private readonly Thread ownerThread;
        private readonly TaskCompletionSource<bool> acquisition = new(
            TaskCreationOptions.RunContinuationsAsynchronously);
        private int disposed;

        private NamedMutexLease(string name)
        {
            ownerThread = new Thread(() => OwnMutex(name))
            {
                IsBackground = true,
                Name = "TECHMAP data-root lease",
            };
            ownerThread.Start();
        }

        public static NamedMutexLease? TryAcquire(string name)
        {
            var candidate = new NamedMutexLease(name);
            try
            {
                if (candidate.acquisition.Task.GetAwaiter().GetResult())
                {
                    return candidate;
                }
            }
            catch (Exception error) when (
                error is UnauthorizedAccessException or WaitHandleCannotBeOpenedException)
            {
                candidate.Dispose();
                return null;
            }
            catch
            {
                candidate.Dispose();
                throw;
            }

            candidate.Dispose();
            return null;
        }

        public void Dispose()
        {
            if (Interlocked.Exchange(ref disposed, 1) != 0)
            {
                return;
            }

            release.Set();
            ownerThread.Join();
            release.Dispose();
        }

        private void OwnMutex(string name)
        {
            try
            {
                using var mutex = new Mutex(initiallyOwned: false, name);
                var ownsMutex = false;
                try
                {
                    try
                    {
                        ownsMutex = mutex.WaitOne(millisecondsTimeout: 0);
                    }
                    catch (AbandonedMutexException)
                    {
                        ownsMutex = true;
                    }

                    acquisition.SetResult(ownsMutex);
                    if (ownsMutex)
                    {
                        release.Wait();
                    }
                }
                finally
                {
                    if (ownsMutex)
                    {
                        mutex.ReleaseMutex();
                    }
                }
            }
            catch (Exception error)
            {
                acquisition.TrySetException(ExceptionDispatchInfo.Capture(error).SourceException);
            }
        }
    }

    internal sealed class ExistingDirectoryGuard(
        string canonicalPath,
        DataRootIdentity identity,
        SafeFileHandle handle) : IDisposable
    {
        public string CanonicalPath { get; } = canonicalPath;

        public DataRootIdentity Identity { get; } = identity;

        public void Dispose() => handle.Dispose();
    }
}

public sealed class DataRootLeaseUnavailableException : IOException
{
    public DataRootLeaseUnavailableException(string canonicalPath, DataRootIdentity identity)
        : base($"The data root already has a writer: {canonicalPath}")
    {
        CanonicalPath = canonicalPath;
        Identity = identity;
    }

    public string CanonicalPath { get; }

    public DataRootIdentity Identity { get; }
}

public sealed class DataRootPathException : IOException
{
    public DataRootPathException(string message, string path, Exception? innerException = null)
        : base(message, innerException)
    {
        Path = path;
    }

    public string Path { get; }
}
