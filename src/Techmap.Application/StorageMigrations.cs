namespace Techmap.Application;

public sealed record StorageMigrationRequest(
    string BackupRoot,
    string AppVersion,
    int PackageSchemaVersion,
    string? PreviousAppVersion = null);

public sealed record StorageMigrationResult(
    bool Migrated,
    bool Recovered,
    int SourceSchemaVersion,
    int TargetSchemaVersion,
    string SourceGenerationName,
    string CurrentGenerationName,
    StorageBackupResult? PreUpdateBackup);

public interface IStorageMigrationService
{
    Task<StorageMigrationResult> MigrateIfRequiredAsync(
        StorageMigrationRequest request,
        CancellationToken cancellationToken = default);

    void CompleteSuccessfulStartup(StorageMigrationResult migration);
}

public sealed class StorageMigrationException : Exception
{
    public StorageMigrationException(string code, string message, Exception? innerException = null)
        : base(message, innerException)
    {
        Code = code;
    }

    public string Code { get; }
}
