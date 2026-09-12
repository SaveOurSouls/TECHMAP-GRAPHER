namespace Techmap.Application;

public enum StorageBackupKind
{
    Regular,
    PreUpdate,
    PreRestore,
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

public sealed record StorageDryRunRestoreRequest(
    string BackupPath,
    string RecoveryRoot);

public sealed record StorageDryRunRestoreResult(
    StorageBackupResult SourceBackup,
    string RecoveryRoot,
    string GenerationName,
    string DatabasePath,
    string DatabaseSha256,
    int ReferencedBlobCount);

public sealed record StorageFullRestorePlan(
    Guid PlanId,
    string BackupPath,
    Guid BackupId,
    string BackupManifestSha256,
    string DataRootPath,
    string CurrentGenerationName,
    string CurrentDatabaseSha256,
    string CurrentFingerprint,
    DateTimeOffset CreatedUtc,
    string RequiredConfirmation);

public sealed record StorageFullRestoreRequest(
    StorageFullRestorePlan Plan,
    string Confirmation,
    string PreRestoreBackupRoot,
    string AppVersion);

public sealed record StorageFullRestoreResult(
    StorageBackupResult SourceBackup,
    StorageBackupResult PreRestoreBackup,
    string PreviousGenerationName,
    string RestoredGenerationName,
    string PreviousFingerprint);

public interface IStorageRestoreService
{
    Task<StorageDryRunRestoreResult> DryRunAsync(
        StorageDryRunRestoreRequest request,
        CancellationToken cancellationToken = default);

    Task<StorageFullRestorePlan> PrepareFullRestoreAsync(
        string backupPath,
        CancellationToken cancellationToken = default);

    Task<StorageFullRestoreResult> RestoreAsync(
        StorageFullRestoreRequest request,
        CancellationToken cancellationToken = default);
}

public sealed class StorageRestoreException : Exception
{
    public StorageRestoreException(string code, string message, Exception? innerException = null)
        : base(message, innerException)
    {
        Code = code;
    }

    public string Code { get; }
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
