namespace Techmap.Application;

public enum StorageBackupKind
{
    Regular,
    PreUpdate,
}

public sealed record StorageBackupRequest(
    string BackupRoot,
    string AppVersion,
    StorageBackupKind Kind = StorageBackupKind.Regular,
    string? PreviousAppVersion = null);

public sealed record StorageBackupProjectRevision(Guid ProjectId, long Revision);

public sealed record StorageBackupResult(
    Guid BackupId,
    string BackupPath,
    StorageBackupKind Kind,
    DateTimeOffset CreatedUtc,
    int SchemaVersion,
    string ManifestSha256,
    string DatabaseSha256,
    long DatabaseSizeBytes,
    int ReferencedBlobCount,
    IReadOnlyList<StorageBackupProjectRevision> ProjectRevisions);

public interface IStorageBackupService
{
    Task<StorageBackupResult> CreateAsync(
        StorageBackupRequest request,
        CancellationToken cancellationToken = default);

    Task<StorageBackupResult?> CreateIfChangedAsync(
        StorageBackupRequest request,
        string? previousDatabaseSha256,
        CancellationToken cancellationToken = default);

    IReadOnlyList<StorageBackupResult> ApplyRetention(string backupRoot, int maximumBackups);
}

public sealed class StorageBackupException : Exception
{
    public StorageBackupException(string code, string message, Exception? innerException = null)
        : base(message, innerException)
    {
        Code = code;
    }

    public string Code { get; }
}
