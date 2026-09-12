using System.Text.Json;

namespace Techmap.Application;

public sealed record StorageBackupPolicyOptions(
    string BackupRoot,
    int RetentionCount = 10,
    TimeSpan? RegularInterval = null,
    TimeSpan? TimerInterval = null)
{
    public TimeSpan EffectiveRegularInterval => RegularInterval ?? TimeSpan.FromDays(1);
    public TimeSpan EffectiveTimerInterval => TimerInterval ?? TimeSpan.FromMinutes(15);

    public void Validate()
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(BackupRoot);
        if (RetentionCount < 3)
        {
            throw new ArgumentOutOfRangeException(
                nameof(RetentionCount),
                "Retention must preserve the newest successful, pre-update and pre-restore backups.");
        }

        if (EffectiveRegularInterval <= TimeSpan.Zero)
        {
            throw new ArgumentOutOfRangeException(nameof(RegularInterval));
        }

        if (EffectiveTimerInterval <= TimeSpan.Zero)
        {
            throw new ArgumentOutOfRangeException(nameof(TimerInterval));
        }
    }
}

public sealed record StorageBackupPolicyState(
    int Format,
    string LastRunAppVersion,
    DateTimeOffset? LastRegularCheckUtc,
    DateTimeOffset? LastSuccessfulRegularBackupUtc,
    string? LastSuccessfulDatabaseSha256);

public sealed class StorageBackupPolicy
{
    public const int StateFormat = 1;
    private readonly IStorageBackupService backupService;
    private readonly StorageBackupPolicyOptions options;
    private readonly string statePath;
    private readonly TimeProvider clock;
    private readonly Action<Exception>? failureSink;
    private readonly SemaphoreSlim policyGate = new(1, 1);

    public StorageBackupPolicy(
        IStorageBackupService backupService,
        StorageBackupPolicyOptions options,
        string statePath,
        TimeProvider? timeProvider = null,
        Action<Exception>? failureSink = null)
    {
        ArgumentNullException.ThrowIfNull(backupService);
        ArgumentNullException.ThrowIfNull(options);
        ArgumentException.ThrowIfNullOrWhiteSpace(statePath);
        options.Validate();
        this.backupService = backupService;
        this.options = options;
        this.statePath = Path.GetFullPath(statePath);
        clock = timeProvider ?? TimeProvider.System;
        this.failureSink = failureSink;
    }

    public StorageBackupPolicyState ReadState()
    {
        if (!File.Exists(statePath))
        {
            return new StorageBackupPolicyState(StateFormat, string.Empty, null, null, null);
        }

        try
        {
            var state = JsonSerializer.Deserialize<StorageBackupPolicyState>(File.ReadAllText(statePath));
            if (state is null || state.Format != StateFormat || state.LastRunAppVersion is null)
            {
                throw new InvalidDataException("The backup policy state is invalid.");
            }

            ValidateState(state);

            return state;
        }
        catch (JsonException error)
        {
            throw new InvalidDataException("The backup policy state is invalid.", error);
        }
    }

    public async Task<StorageBackupPolicyState> EnsurePreUpdateAsync(
        string currentAppVersion,
        bool existingDatabase,
        CancellationToken cancellationToken = default)
    {
        ValidateAppVersion(currentAppVersion);
        await policyGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var state = ReadState();
            var versionChanged = !string.Equals(
                state.LastRunAppVersion,
                currentAppVersion,
                StringComparison.Ordinal);
            if (existingDatabase && (versionChanged || string.IsNullOrEmpty(state.LastRunAppVersion)))
            {
                var backup = await backupService.CreateAsync(
                    new StorageBackupRequest(
                        options.BackupRoot,
                        currentAppVersion,
                        StorageBackupKind.PreUpdate,
                        string.IsNullOrEmpty(state.LastRunAppVersion) ? null : state.LastRunAppVersion),
                    cancellationToken).ConfigureAwait(false);
                state = state with { LastSuccessfulDatabaseSha256 = backup.DatabaseSha256 };
            }

            if (versionChanged)
            {
                state = state with { LastRunAppVersion = currentAppVersion };
                WriteState(state);
            }

            backupService.ApplyRetention(options.BackupRoot, options.RetentionCount);
            return state;
        }
        finally
        {
            policyGate.Release();
        }
    }

    public async Task<StorageBackupPolicyState> RunRegularIfDueAsync(
        string currentAppVersion,
        CancellationToken cancellationToken = default)
    {
        ValidateAppVersion(currentAppVersion);
        await policyGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            var state = ReadState();
            var now = clock.GetUtcNow();
            if (state.LastRegularCheckUtc is not null &&
                now >= state.LastRegularCheckUtc.Value &&
                now - state.LastRegularCheckUtc.Value < options.EffectiveRegularInterval)
            {
                return state;
            }

            var backup = await backupService.CreateIfChangedAsync(
                new StorageBackupRequest(options.BackupRoot, currentAppVersion),
                state.LastSuccessfulDatabaseSha256,
                cancellationToken).ConfigureAwait(false);
            if (backup is null)
            {
                state = state with { LastRegularCheckUtc = now };
                WriteState(state);
                backupService.ApplyRetention(options.BackupRoot, options.RetentionCount);
                return state;
            }

            state = state with
            {
                LastRegularCheckUtc = now,
                LastSuccessfulRegularBackupUtc = backup.CreatedUtc,
                LastSuccessfulDatabaseSha256 = backup.DatabaseSha256,
            };
            WriteState(state);
            backupService.ApplyRetention(options.BackupRoot, options.RetentionCount);
            return state;
        }
        finally
        {
            policyGate.Release();
        }
    }

    public async Task RunTimerAsync(string currentAppVersion, CancellationToken cancellationToken)
    {
        await TryRunRegularAsync(currentAppVersion, cancellationToken).ConfigureAwait(false);
        using var timer = new PeriodicTimer(
            options.EffectiveTimerInterval,
            clock);
        while (await timer.WaitForNextTickAsync(cancellationToken).ConfigureAwait(false))
        {
            await TryRunRegularAsync(currentAppVersion, cancellationToken).ConfigureAwait(false);
        }
    }

    private async Task TryRunRegularAsync(string currentAppVersion, CancellationToken cancellationToken)
    {
        try
        {
            await RunRegularIfDueAsync(currentAppVersion, cancellationToken).ConfigureAwait(false);
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            failureSink?.Invoke(error);
        }
    }

    private void WriteState(StorageBackupPolicyState state)
    {
        var parent = Path.GetDirectoryName(statePath)
            ?? throw new InvalidOperationException("The backup policy state must have a parent directory.");
        Directory.CreateDirectory(parent);
        RejectReparsePoint(parent);
        if (File.Exists(statePath))
        {
            RejectReparsePoint(statePath);
        }

        var temporary = Path.Combine(parent, $".{Path.GetFileName(statePath)}.{Guid.NewGuid():N}.tmp");
        try
        {
            var bytes = JsonSerializer.SerializeToUtf8Bytes(state, new JsonSerializerOptions { WriteIndented = true });
            using (var stream = new FileStream(
                       temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough))
            {
                stream.Write(bytes);
                stream.Flush(flushToDisk: true);
            }

            File.Move(temporary, statePath, overwrite: true);
        }
        finally
        {
            File.Delete(temporary);
        }
    }

    private static void RejectReparsePoint(string path)
    {
        if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0)
        {
            throw new InvalidDataException("The backup policy state path must not be a reparse point.");
        }
    }

    private static void ValidateState(StorageBackupPolicyState state)
    {
        if (state.LastRunAppVersion.Length > 128 || state.LastRunAppVersion.Any(char.IsControl) ||
            state.LastSuccessfulDatabaseSha256 is not null && !IsSha256(state.LastSuccessfulDatabaseSha256) ||
            state.LastRegularCheckUtc is not null && state.LastRegularCheckUtc.Value.Offset != TimeSpan.Zero ||
            state.LastSuccessfulRegularBackupUtc is not null &&
                (state.LastSuccessfulRegularBackupUtc.Value.Offset != TimeSpan.Zero ||
                 state.LastRegularCheckUtc is null ||
                 state.LastSuccessfulDatabaseSha256 is null))
        {
            throw new InvalidDataException("The backup policy state is invalid.");
        }
    }

    private static bool IsSha256(string value) =>
        value.Length == 64 &&
        value.All(character => character is >= '0' and <= '9' or >= 'a' and <= 'f');

    private static void ValidateAppVersion(string value)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > 128 || value.Any(char.IsControl))
        {
            throw new ArgumentException("The application version is invalid.", nameof(value));
        }
    }
}
