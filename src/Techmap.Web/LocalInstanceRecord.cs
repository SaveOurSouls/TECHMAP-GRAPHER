using System.ComponentModel;
using System.Diagnostics;
using System.Net.Http.Json;
using System.Security;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using Microsoft.Win32.SafeHandles;
using Techmap.Contracts;
using Techmap.Infrastructure.Sqlite;

namespace Techmap.Web;

public sealed record ExistingLocalInstance(string PageUrl, string InstanceId);

public static class LocalInstanceRecord
{
    private const string StoreDirectoryName = "sessions-v2";
    private const string RecordFileExtension = ".instance.json";
    private const int FormatVersion = 1;
    private const uint GenericRead = 0x80000000;
    private const uint FileFlagOpenReparsePoint = 0x00200000;
    private const uint FileAttributeReparsePoint = 0x00000400;
    private static readonly TimeSpan DiscoveryTimeout = TimeSpan.FromSeconds(3);

    public static void Publish(
        DataRootIdentity dataRootIdentity,
        string pageUrl,
        string instanceId,
        string? recordStoreRoot = null)
    {
        if (!OperatingSystem.IsWindows())
        {
            throw new PlatformNotSupportedException("Windows file permissions are required.");
        }

        _ = ValidatePageUri(pageUrl);
        var storeRoot = OpenRecordStore(recordStoreRoot, create: true);
        var recordPath = RecordPath(storeRoot, dataRootIdentity);
        var temporaryPath = $"{recordPath}.{Guid.NewGuid():N}.tmp";
        var record = new InstanceRecord(
            FormatVersion,
            dataRootIdentity,
            pageUrl,
            instanceId,
            Environment.ProcessId,
            Process.GetCurrentProcess().StartTime.ToUniversalTime());
        var payload = JsonSerializer.SerializeToUtf8Bytes(record);

        try
        {
            var fileSecurity = (FileSecurity)CreateCurrentUserSecurity(isDirectory: false);
            using (var stream = FileSystemAclExtensions.Create(
                new FileInfo(temporaryPath),
                FileMode.CreateNew,
                FileSystemRights.FullControl,
                FileShare.None,
                bufferSize: 4096,
                options: FileOptions.WriteThrough,
                fileSecurity))
            {
                stream.Write(payload);
                stream.Flush(flushToDisk: true);
            }
            File.Move(temporaryPath, recordPath, overwrite: true);
        }
        catch (Exception error) when (error is IOException or
            UnauthorizedAccessException or
            Win32Exception or
            SecurityException)
        {
            throw new IOException("The local instance record could not be published.", error);
        }
        finally
        {
            try
            {
                File.Delete(temporaryPath);
            }
            catch (Exception error) when (error is IOException or
                UnauthorizedAccessException or
                Win32Exception or
                SecurityException)
            {
                // Publication already failed or completed. A uniquely named temp file is inert.
            }
        }
    }

    public static async Task<ExistingLocalInstance> ResolveOwnerAsync(
        DataRootIdentity dataRootIdentity,
        string canonicalDataRoot,
        CancellationToken cancellationToken = default,
        TimeSpan? discoveryTimeout = null,
        string? recordStoreRoot = null)
    {
        var deadline = DateTime.UtcNow + (discoveryTimeout ?? DiscoveryTimeout);
        Exception? lastError = null;
        do
        {
            cancellationToken.ThrowIfCancellationRequested();
            try
            {
                var storeRoot = OpenRecordStore(recordStoreRoot, create: false);
                var recordPath = RecordPath(storeRoot, dataRootIdentity);
                var record = Read(recordPath, dataRootIdentity);
                ValidateOwnerProcess(record);
                var pageUri = ValidatePageUri(record.PageUrl);
                var healthPath = $"{pageUri.AbsolutePath.TrimEnd('/')}/api/v1/health";
                var healthUri = new Uri($"{pageUri.GetLeftPart(UriPartial.Authority)}{healthPath}");

                using var handler = new HttpClientHandler { UseProxy = false };
                using var client = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(1) };
                using var response = await client.GetAsync(healthUri, cancellationToken).ConfigureAwait(false);
                response.EnsureSuccessStatusCode();
                var health = await response.Content.ReadFromJsonAsync<HealthResponse>(
                    cancellationToken: cancellationToken).ConfigureAwait(false);
                if (health is null ||
                    !string.Equals(health.Status, "ok", StringComparison.Ordinal) ||
                    !string.Equals(health.InstanceId, record.InstanceId, StringComparison.Ordinal))
                {
                    throw new InvalidDataException("The local instance identity could not be verified.");
                }

                return new ExistingLocalInstance(record.PageUrl, record.InstanceId);
            }
            catch (Exception error) when (error is IOException or
                UnauthorizedAccessException or
                JsonException or
                InvalidDataException or
                HttpRequestException or
                TaskCanceledException or
                Win32Exception or
                SecurityException)
            {
                lastError = error;
            }

            await Task.Delay(100, cancellationToken).ConfigureAwait(false);
        }
        while (DateTime.UtcNow < deadline);

        throw new LocalInstanceUnavailableException(canonicalDataRoot, lastError);
    }

    public static void DeleteIfOwned(
        DataRootIdentity dataRootIdentity,
        string instanceId,
        string? recordStoreRoot = null)
    {
        try
        {
            var storeRoot = OpenRecordStore(recordStoreRoot, create: false);
            var recordPath = RecordPath(storeRoot, dataRootIdentity);
            if (File.Exists(recordPath) &&
                string.Equals(
                    Read(recordPath, dataRootIdentity).InstanceId,
                    instanceId,
                    StringComparison.Ordinal))
            {
                File.Delete(recordPath);
            }
        }
        catch (Exception error) when (error is IOException or
            UnauthorizedAccessException or
            JsonException or
            InvalidDataException or
            Win32Exception or
            SecurityException)
        {
            // A stale discovery record is safe: the OS-held data-root lease is authoritative.
        }
    }

    private static InstanceRecord Read(string recordPath, DataRootIdentity expectedDataRootIdentity)
    {
        if (!OperatingSystem.IsWindows())
        {
            throw new PlatformNotSupportedException("Windows file permissions are required.");
        }

        using var stream = OpenPinnedRecord(recordPath);
        EnsureCurrentUserOnly(stream.GetAccessControl());
        if (!GetFileInformationByHandle(stream.SafeFileHandle, out var information))
        {
            throw new IOException(
                "The local instance record attributes cannot be verified.",
                new Win32Exception(Marshal.GetLastWin32Error()));
        }

        if ((information.FileAttributes & FileAttributeReparsePoint) != 0)
        {
            throw new InvalidDataException("The local instance record must not be a reparse point.");
        }

        var record = JsonSerializer.Deserialize<InstanceRecord>(stream)
            ?? throw new InvalidDataException("The local instance record is empty.");
        if (record.FormatVersion != FormatVersion ||
            record.DataRootIdentity != expectedDataRootIdentity ||
            string.IsNullOrWhiteSpace(record.InstanceId) ||
            !Guid.TryParseExact(record.InstanceId, "D", out _) ||
            record.ProcessId <= 0)
        {
            throw new InvalidDataException("The local instance record is incompatible.");
        }

        return record;
    }

    private static FileStream OpenPinnedRecord(string recordPath)
    {
        var handle = CreateFile(
            recordPath,
            GenericRead,
            FileShare.Read,
            securityAttributes: 0,
            FileMode.Open,
            FileFlagOpenReparsePoint,
            templateFile: 0);
        if (!handle.IsInvalid)
        {
            return new FileStream(handle, FileAccess.Read, bufferSize: 4096, isAsync: false);
        }

        var error = new Win32Exception(Marshal.GetLastWin32Error());
        handle.Dispose();
        throw new IOException("The local instance record cannot be opened safely.", error);
    }

    private static Uri ValidatePageUri(string pageUrl)
    {
        if (!Uri.TryCreate(pageUrl, UriKind.Absolute, out var uri) ||
            uri.Scheme != Uri.UriSchemeHttp ||
            uri.Host != "127.0.0.1" ||
            uri.IsDefaultPort ||
            !string.IsNullOrEmpty(uri.UserInfo) ||
            !string.IsNullOrEmpty(uri.Query) ||
            !string.IsNullOrEmpty(uri.Fragment) ||
            !uri.AbsolutePath.EndsWith("/", StringComparison.Ordinal) ||
            uri.AbsolutePath.Contains("//", StringComparison.Ordinal) ||
            uri.AbsolutePath.Contains('\\') ||
            Uri.UnescapeDataString(uri.AbsolutePath) != uri.AbsolutePath)
        {
            throw new InvalidDataException("The local instance URL is invalid.");
        }

        return uri;
    }

    private static void ValidateOwnerProcess(InstanceRecord record)
    {
        try
        {
            using var process = Process.GetProcessById(record.ProcessId);
            if (process.HasExited || process.StartTime.ToUniversalTime() != record.ProcessStartedUtc)
            {
                throw new InvalidDataException("The local instance process identity does not match.");
            }
        }
        catch (ArgumentException error)
        {
            throw new InvalidDataException("The local instance process is not running.", error);
        }
        catch (InvalidOperationException error)
        {
            throw new InvalidDataException("The local instance process could not be verified.", error);
        }
    }

    private static string OpenRecordStore(string? configuredRoot, bool create)
    {
        if (!OperatingSystem.IsWindows())
        {
            throw new PlatformNotSupportedException("Windows file permissions are required.");
        }

        var root = configuredRoot;
        if (string.IsNullOrWhiteSpace(root))
        {
            var localApplicationData = Environment.GetFolderPath(
                Environment.SpecialFolder.LocalApplicationData);
            if (string.IsNullOrWhiteSpace(localApplicationData))
            {
                throw new IOException("The current user's LocalApplicationData directory is unavailable.");
            }

            root = Path.Combine(localApplicationData, "TECHMAP-GRAPHER", StoreDirectoryName);
        }

        var resolvedRoot = Path.GetFullPath(root);
        if (create)
        {
            var parent = Path.GetDirectoryName(resolvedRoot)
                ?? throw new IOException("The local instance record store has no parent directory.");
            Directory.CreateDirectory(parent);
            var candidate = new DirectoryInfo(resolvedRoot);
            if (!candidate.Exists)
            {
                try
                {
                    FileSystemAclExtensions.Create(
                        candidate,
                        (DirectorySecurity)CreateCurrentUserSecurity(isDirectory: true));
                }
                catch (IOException) when (Directory.Exists(resolvedRoot))
                {
                    // Another process created the per-user store. Validate it below.
                }
            }
        }
        else if (!Directory.Exists(resolvedRoot))
        {
            throw new DirectoryNotFoundException("The local instance record store does not exist.");
        }

        var directory = new DirectoryInfo(resolvedRoot);
        if ((directory.Attributes & FileAttributes.ReparsePoint) != 0)
        {
            throw new InvalidDataException("The local instance record store must not be a reparse point.");
        }

        EnsureCurrentUserOnly(directory.GetAccessControl(
            AccessControlSections.Owner | AccessControlSections.Access));
        return resolvedRoot;
    }

    private static string RecordPath(string storeRoot, DataRootIdentity dataRootIdentity)
    {
        var digest = SHA256.HashData(Encoding.UTF8.GetBytes(dataRootIdentity.StableKey));
        return Path.Combine(storeRoot, $"{Convert.ToHexStringLower(digest)}{RecordFileExtension}");
    }

    private static FileSystemSecurity CreateCurrentUserSecurity(bool isDirectory)
    {
        if (!OperatingSystem.IsWindows())
        {
            throw new PlatformNotSupportedException("Windows file permissions are required.");
        }

        var currentUser = WindowsIdentity.GetCurrent().User
            ?? throw new InvalidOperationException("The current Windows user SID is unavailable.");
        FileSystemSecurity security = isDirectory ? new DirectorySecurity() : new FileSecurity();
        security.SetOwner(currentUser);
        security.SetAccessRuleProtection(isProtected: true, preserveInheritance: false);
        var inheritance = isDirectory
            ? InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit
            : InheritanceFlags.None;
        security.AddAccessRule(new FileSystemAccessRule(
            currentUser,
            FileSystemRights.FullControl,
            inheritance,
            PropagationFlags.None,
            AccessControlType.Allow));
        return security;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ByHandleFileInformation
    {
        public uint FileAttributes;
        public System.Runtime.InteropServices.ComTypes.FILETIME CreationTime;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastAccessTime;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWriteTime;
        public uint VolumeSerialNumber;
        public uint FileSizeHigh;
        public uint FileSizeLow;
        public uint NumberOfLinks;
        public uint FileIndexHigh;
        public uint FileIndexLow;
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
    private static extern bool GetFileInformationByHandle(
        SafeFileHandle file,
        out ByHandleFileInformation fileInformation);

    private static void EnsureCurrentUserOnly(FileSystemSecurity security)
    {
        if (!OperatingSystem.IsWindows())
        {
            throw new PlatformNotSupportedException("Windows file permissions are required.");
        }

        var currentUser = WindowsIdentity.GetCurrent().User
            ?? throw new InvalidOperationException("The current Windows user SID is unavailable.");
        if (!currentUser.Equals(security.GetOwner(typeof(SecurityIdentifier))))
        {
            throw new UnauthorizedAccessException("The local instance record has another owner.");
        }

        var rules = security.GetAccessRules(includeExplicit: true, includeInherited: true, typeof(SecurityIdentifier));
        foreach (FileSystemAccessRule rule in rules)
        {
            if (rule.AccessControlType == AccessControlType.Allow &&
                !currentUser.Equals(rule.IdentityReference))
            {
                throw new UnauthorizedAccessException("The local instance record is accessible to another user.");
            }
        }
    }

    private sealed record InstanceRecord(
        int FormatVersion,
        DataRootIdentity DataRootIdentity,
        string PageUrl,
        string InstanceId,
        int ProcessId,
        DateTime ProcessStartedUtc);
}

public sealed class LocalInstanceUnavailableException : IOException
{
    public LocalInstanceUnavailableException(string canonicalDataRoot, Exception? innerException)
        : base("Another process owns the data root, but its local session could not be verified.", innerException)
    {
        CanonicalDataRoot = canonicalDataRoot;
    }

    public string CanonicalDataRoot { get; }
}
