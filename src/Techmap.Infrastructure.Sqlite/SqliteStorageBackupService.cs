using System.Globalization;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using Microsoft.Win32.SafeHandles;
using Techmap.Application;

namespace Techmap.Infrastructure.Sqlite;

public sealed class SqliteStorageBackupService : IStorageBackupService, IDisposable
{
    public const int ManifestFormat = 1;
    public const string ManifestFileName = "manifest.json";
    public const string ManifestChecksumFileName = "manifest.sha256";
    public const string ProductId = "TECHMAP-GRAPHER";
    private const string StagingDirectoryName = ".staging";
    private const string DatabaseFileName = "app.db";
    private const int BufferSize = 128 * 1024;
    private const uint FileFlagBackupSemantics = 0x02000000;
    private const uint FileReadAttributes = 0x0080;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true,
    };

    private readonly string dataRoot;
    private readonly string databasePath;
    private readonly TimeProvider timeProvider;
    private readonly Action<string>? progressHook;
    private readonly SemaphoreSlim backupGate = new(1, 1);
    private int disposed;

    public SqliteStorageBackupService(
        string dataRoot,
        string databasePath,
        TimeProvider? timeProvider = null,
        Action<string>? progressHook = null)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(dataRoot);
        ArgumentException.ThrowIfNullOrWhiteSpace(databasePath);
        this.dataRoot = ResolveCanonicalExistingPath(dataRoot, expectDirectory: true);
        this.databasePath = ResolveCanonicalExistingPath(databasePath, expectDirectory: false);
        if (!IsSameOrDescendant(this.dataRoot, this.databasePath))
        {
            throw new ArgumentException("The SQLite database must be inside the data root.", nameof(databasePath));
        }

        this.timeProvider = timeProvider ?? TimeProvider.System;
        this.progressHook = progressHook;
    }

    public async Task<StorageBackupResult> CreateAsync(
        StorageBackupRequest request,
        CancellationToken cancellationToken = default) =>
        await CreateCoreAsync(request, null, cancellationToken).ConfigureAwait(false)
        ?? throw new InvalidOperationException("An unconditional backup was unexpectedly skipped.");

    public Task<StorageBackupResult?> CreateIfChangedAsync(
        StorageBackupRequest request,
        string? previousDatabaseSha256,
        CancellationToken cancellationToken = default) =>
        CreateCoreAsync(request, previousDatabaseSha256, cancellationToken);

    private async Task<StorageBackupResult?> CreateCoreAsync(
        StorageBackupRequest request,
        string? previousDatabaseSha256,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        ValidateAppVersion(request.AppVersion);
        ObjectDisposedException.ThrowIf(Volatile.Read(ref disposed) != 0, this);
        await backupGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            ObjectDisposedException.ThrowIf(Volatile.Read(ref disposed) != 0, this);
            RejectLexicalOverlap(dataRoot, request.BackupRoot);
            using var backupRootLease = DataRootLease.Acquire(request.BackupRoot);
            var backupRoot = backupRootLease.CanonicalPath;
            RejectPhysicalOverlap(dataRoot, backupRoot);
            var stagingRoot = CreateOrdinaryDirectory(Path.Combine(backupRoot, StagingDirectoryName));
            var backupId = Guid.NewGuid();
            var createdUtc = timeProvider.GetUtcNow().ToUniversalTime();
            var stagingPath = Path.Combine(stagingRoot, $"{backupId:N}.staging");
            var publishedPath = Path.Combine(
                backupRoot,
                ExpectedBackupDirectoryName(createdUtc, backupId));

            try
            {
                Directory.CreateDirectory(stagingPath);
                RejectReparsePoint(stagingPath, "A backup staging directory must not be a reparse point.");
                var snapshotPath = Path.Combine(stagingPath, DatabaseFileName);
                CreateOnlineSnapshot(snapshotPath);
                FlushExistingFile(snapshotPath);
                progressHook?.Invoke("after_database_snapshot");

                var snapshot = InspectSnapshot(snapshotPath);
                var databaseEntry = await HashExistingFileAsync(
                    DatabaseFileName, snapshotPath, cancellationToken).ConfigureAwait(false);
                if (request.Kind == StorageBackupKind.Regular &&
                    previousDatabaseSha256 is not null &&
                    string.Equals(databaseEntry.Sha256, previousDatabaseSha256, StringComparison.Ordinal))
                {
                    foreach (var blob in snapshot.Blobs)
                    {
                        await VerifySourceBlobAsync(blob, cancellationToken).ConfigureAwait(false);
                    }

                    return null;
                }

                var files = new List<BackupFileEntry>
                {
                    databaseEntry,
                };
                foreach (var blob in snapshot.Blobs)
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    var relativePath = $"attachments/blobs/{blob.Sha256[..2]}/{blob.Sha256}";
                    var sourcePath = Path.Combine(
                        dataRoot,
                        "attachments",
                        "blobs",
                        blob.Sha256[..2],
                        blob.Sha256);
                    var destinationPath = Path.Combine(
                        stagingPath,
                        "attachments",
                        "blobs",
                        blob.Sha256[..2],
                        blob.Sha256);
                    files.Add(await CopyVerifiedAsync(
                        relativePath,
                        sourcePath,
                        destinationPath,
                        blob.SizeBytes,
                        blob.Sha256,
                        cancellationToken).ConfigureAwait(false));
                }

                var manifest = new BackupManifest(
                    ManifestFormat,
                    ProductId,
                    backupId,
                    FormatKind(request.Kind),
                    request.AppVersion,
                    request.PreviousAppVersion,
                    snapshot.SchemaVersion,
                    createdUtc,
                    snapshot.ProjectRevisions,
                    files.OrderBy(file => file.Path, StringComparer.Ordinal).ToArray());
                var manifestBytes = JsonSerializer.SerializeToUtf8Bytes(manifest, JsonOptions);
                var manifestHash = Convert.ToHexStringLower(SHA256.HashData(manifestBytes));
                WriteDurableNewFile(Path.Combine(stagingPath, ManifestFileName), manifestBytes);
                WriteDurableNewFile(
                    Path.Combine(stagingPath, ManifestChecksumFileName),
                    Encoding.ASCII.GetBytes($"{manifestHash}\n"));
                progressHook?.Invoke("before_publish");
                cancellationToken.ThrowIfCancellationRequested();
                if (!TryValidateBackupDirectory(stagingPath, manifest, manifestHash, requirePublishedName: false))
                {
                    throw new InvalidDataException("The staged backup failed complete verification.");
                }

                cancellationToken.ThrowIfCancellationRequested();
                Directory.Move(stagingPath, publishedPath);

                var database = files.Single(file => file.Path == DatabaseFileName);
                return new StorageBackupResult(
                    backupId,
                    publishedPath,
                    request.Kind,
                    createdUtc,
                    snapshot.SchemaVersion,
                    manifestHash,
                    database.Sha256,
                    database.SizeBytes,
                    snapshot.Blobs.Count,
                    snapshot.ProjectRevisions);
            }
            catch (Exception error) when (
                error is not StorageBackupException and not OperationCanceledException)
            {
                throw new StorageBackupException(
                    "backup_failed",
                    "The backup could not be published.",
                    error);
            }
            finally
            {
                TryDeleteOwnedStaging(stagingPath, stagingRoot);
            }
        }
        finally
        {
            backupGate.Release();
        }
    }

    public IReadOnlyList<StorageBackupResult> ApplyRetention(string backupRoot, int maximumBackups)
    {
        if (maximumBackups < 2)
        {
            throw new ArgumentOutOfRangeException(
                nameof(maximumBackups),
                "Retention must preserve at least the newest successful and newest pre-update backups.");
        }

        ObjectDisposedException.ThrowIf(Volatile.Read(ref disposed) != 0, this);
        RejectLexicalOverlap(dataRoot, backupRoot);
        backupGate.Wait();
        try
        {
            using var backupRootLease = DataRootLease.Acquire(backupRoot);
            RejectPhysicalOverlap(dataRoot, backupRootLease.CanonicalPath);
            var backups = ReadPublishedBackups(backupRootLease.CanonicalPath)
                .OrderByDescending(backup => backup.CreatedUtc)
                .ThenByDescending(backup => backup.BackupId)
                .ToArray();
            var keep = new HashSet<Guid>();
            if (backups.Length > 0)
            {
                keep.Add(backups[0].BackupId);
            }

            var newestPreUpdate = backups.FirstOrDefault(backup => backup.Kind == StorageBackupKind.PreUpdate);
            if (newestPreUpdate is not null)
            {
                keep.Add(newestPreUpdate.BackupId);
            }

            foreach (var backup in backups)
            {
                if (keep.Count >= maximumBackups)
                {
                    break;
                }

                keep.Add(backup.BackupId);
            }

            foreach (var backup in backups
                         .Where(backup => !keep.Contains(backup.BackupId))
                         .OrderBy(backup => backup.CreatedUtc)
                         .ThenBy(backup => backup.BackupId))
            {
                ValidateGeneratedBackupDirectory(backupRootLease.CanonicalPath, backup.BackupPath);
                ValidateNoReparseEntries(backup.BackupPath);
                Directory.Delete(backup.BackupPath, recursive: true);
            }

            return backups.Where(backup => keep.Contains(backup.BackupId)).ToArray();
        }
        finally
        {
            backupGate.Release();
        }
    }

    public void Dispose()
    {
        if (Interlocked.Exchange(ref disposed, 1) == 0)
        {
            backupGate.Dispose();
        }
    }

    private void CreateOnlineSnapshot(string destinationPath)
    {
        if (!File.Exists(databasePath))
        {
            throw new FileNotFoundException("The active SQLite database does not exist.", databasePath);
        }

        RejectReparsePoint(databasePath, "The active SQLite database must not be a reparse point.");
        using var source = new SqliteConnection(new SqliteConnectionStringBuilder
        {
            DataSource = databasePath,
            Mode = SqliteOpenMode.ReadOnly,
            Cache = SqliteCacheMode.Private,
            Pooling = false,
        }.ToString());
        using var destination = new SqliteConnection(new SqliteConnectionStringBuilder
        {
            DataSource = destinationPath,
            Mode = SqliteOpenMode.ReadWriteCreate,
            Cache = SqliteCacheMode.Private,
            Pooling = false,
        }.ToString());
        source.Open();
        destination.Open();
        source.BackupDatabase(destination);
        using var useDeleteJournal = destination.CreateCommand();
        useDeleteJournal.CommandText = "PRAGMA journal_mode = DELETE;";
        useDeleteJournal.ExecuteNonQuery();
    }

    private static SnapshotInventory InspectSnapshot(string snapshotPath)
    {
        using var connection = new SqliteConnection(new SqliteConnectionStringBuilder
        {
            DataSource = snapshotPath,
            Mode = SqliteOpenMode.ReadOnly,
            Cache = SqliteCacheMode.Private,
            Pooling = false,
        }.ToString());
        connection.Open();
        using (var integrity = connection.CreateCommand())
        {
            integrity.CommandText = "PRAGMA integrity_check;";
            if (!string.Equals(Convert.ToString(integrity.ExecuteScalar(), CultureInfo.InvariantCulture), "ok", StringComparison.Ordinal))
            {
                throw new InvalidDataException("The SQLite backup failed integrity_check.");
            }
        }

        using (var foreignKeys = connection.CreateCommand())
        {
            foreignKeys.CommandText = "PRAGMA foreign_key_check;";
            using var reader = foreignKeys.ExecuteReader();
            if (reader.Read())
            {
                throw new InvalidDataException("The SQLite backup failed foreign_key_check.");
            }
        }

        var schemaVersion = SqliteStorage.ValidateSchema(connection);

        var revisions = new List<StorageBackupProjectRevision>();
        if (schemaVersion >= 2)
        {
            if (!HasTable(connection, "projects"))
            {
                throw new InvalidDataException("The SQLite backup has no projects table.");
            }

            using var projects = connection.CreateCommand();
            projects.CommandText = schemaVersion >= 4
                ? "SELECT project_id, revision FROM projects ORDER BY project_id;"
                : "SELECT project_id, 0 FROM projects ORDER BY project_id;";
            using var reader = projects.ExecuteReader();
            while (reader.Read())
            {
                if (!Guid.TryParseExact(reader.GetString(0), "D", out var projectId) || reader.GetInt64(1) < 0)
                {
                    throw new InvalidDataException("The SQLite backup contains an invalid project revision.");
                }

                revisions.Add(new StorageBackupProjectRevision(
                    projectId, reader.GetInt64(1)));
            }
        }

        var blobs = new List<SnapshotBlob>();
        if (schemaVersion >= 3)
        {
            if (!HasTable(connection, "project_attachments") || !HasTable(connection, "attachment_blobs"))
            {
                throw new InvalidDataException("The SQLite backup has incomplete attachment tables.");
            }

            using var attachments = connection.CreateCommand();
            attachments.CommandText =
                """
                SELECT DISTINCT b.content_sha256, b.size_bytes
                FROM project_attachments pa
                JOIN attachment_blobs b ON b.content_sha256 = pa.content_sha256
                ORDER BY b.content_sha256;
                """;
            using var reader = attachments.ExecuteReader();
            while (reader.Read())
            {
                var sha256 = reader.GetString(0);
                var sizeBytes = reader.GetInt64(1);
                if (!IsSha256(sha256) || sizeBytes < 0)
                {
                    throw new InvalidDataException("The SQLite backup contains an invalid attachment reference.");
                }

                blobs.Add(new SnapshotBlob(sha256, sizeBytes));
            }
        }

        return new SnapshotInventory(schemaVersion, revisions, blobs);
    }

    private static bool HasTable(SqliteConnection connection, string name)
    {
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = $name;";
        command.Parameters.AddWithValue("$name", name);
        return Convert.ToInt32(command.ExecuteScalar(), CultureInfo.InvariantCulture) == 1;
    }

    private async Task<BackupFileEntry> CopyVerifiedAsync(
        string relativePath,
        string sourcePath,
        string destinationPath,
        long expectedSize,
        string expectedHash,
        CancellationToken cancellationToken)
    {
        if (!File.Exists(sourcePath))
        {
            throw new FileNotFoundException("A referenced attachment blob is missing.", sourcePath);
        }

        RejectAttachmentPath(sourcePath);
        Directory.CreateDirectory(Path.GetDirectoryName(destinationPath)!);
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        long size = 0;
        var buffer = new byte[BufferSize];
        await using (var source = new FileStream(
                         sourcePath, FileMode.Open, FileAccess.Read, FileShare.Read, BufferSize,
                         FileOptions.Asynchronous | FileOptions.SequentialScan))
        await using (var destination = new FileStream(
                         destinationPath, FileMode.CreateNew, FileAccess.Write, FileShare.None, BufferSize,
                         FileOptions.Asynchronous | FileOptions.SequentialScan | FileOptions.WriteThrough))
        {
            while (true)
            {
                var count = await source.ReadAsync(buffer, cancellationToken).ConfigureAwait(false);
                if (count == 0)
                {
                    break;
                }

                size = checked(size + count);
                hash.AppendData(buffer, 0, count);
                await destination.WriteAsync(buffer.AsMemory(0, count), cancellationToken).ConfigureAwait(false);
            }

            await destination.FlushAsync(cancellationToken).ConfigureAwait(false);
            destination.Flush(flushToDisk: true);
        }

        var actualHash = Convert.ToHexStringLower(hash.GetHashAndReset());
        if (size != expectedSize || !string.Equals(actualHash, expectedHash, StringComparison.Ordinal))
        {
            throw new InvalidDataException("A referenced attachment blob failed backup validation.");
        }

        return new BackupFileEntry(relativePath, size, actualHash);
    }

    private static async Task<BackupFileEntry> HashExistingFileAsync(
        string relativePath,
        string path,
        CancellationToken cancellationToken)
    {
        await using var stream = new FileStream(
            path, FileMode.Open, FileAccess.Read, FileShare.Read, BufferSize,
            FileOptions.Asynchronous | FileOptions.SequentialScan);
        var hash = Convert.ToHexStringLower(
            await SHA256.HashDataAsync(stream, cancellationToken).ConfigureAwait(false));
        return new BackupFileEntry(relativePath, stream.Length, hash);
    }

    private IReadOnlyList<StorageBackupResult> ReadPublishedBackups(string backupRoot)
    {
        var results = new List<StorageBackupResult>();
        foreach (var directory in Directory.EnumerateDirectories(backupRoot, "backup-*", SearchOption.TopDirectoryOnly))
        {
            if (TryReadPublishedBackup(directory, out var result))
            {
                results.Add(result);
            }
        }

        return results
            .GroupBy(item => item.BackupId)
            .Where(group => group.Count() == 1)
            .Select(group => group.Single())
            .ToArray();
    }

    private static void RejectLexicalOverlap(string sourceDataRoot, string backupRoot)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(backupRoot);
        var candidate = Path.GetFullPath(backupRoot);
        if (IsSameOrDescendant(sourceDataRoot, candidate) || IsSameOrDescendant(candidate, sourceDataRoot))
        {
            throw new StorageBackupException(
                "backup_root_overlaps_data",
                "The backup root and data root must be separate, non-nested directories.");
        }
    }

    private static string ResolveCanonicalExistingPath(string value, bool expectDirectory)
    {
        var requested = Path.GetFullPath(value);
        if (expectDirectory ? !Directory.Exists(requested) : !File.Exists(requested))
        {
            throw new FileNotFoundException("The storage source path does not exist.", requested);
        }

        RejectReparsePoint(requested, "A storage source path must not be a reparse point.");
        using var handle = CreateFile(
            requested,
            FileReadAttributes,
            FileShare.Read | FileShare.Write | FileShare.Delete,
            0,
            FileMode.Open,
            FileFlagBackupSemantics,
            0);
        if (handle.IsInvalid)
        {
            throw new IOException(
                "The physical data-root path cannot be opened.",
                new Win32Exception(Marshal.GetLastWin32Error()));
        }

        var capacity = 512;
        while (true)
        {
            var buffer = new StringBuilder(capacity);
            var length = GetFinalPathNameByHandle(handle, buffer, (uint)capacity, 0);
            if (length == 0)
            {
                throw new IOException(
                    "The physical data-root path cannot be resolved.",
                    new Win32Exception(Marshal.GetLastWin32Error()));
            }

            if (length < capacity)
            {
                var result = buffer.ToString();
                const string extendedPrefix = @"\\?\";
                return Path.GetFullPath(result.StartsWith(extendedPrefix, StringComparison.Ordinal)
                    ? result[extendedPrefix.Length..]
                    : result);
            }

            capacity = checked((int)length + 1);
        }
    }

    private static void RejectPhysicalOverlap(string canonicalDataRoot, string backupRoot)
    {
        if (IsSameOrDescendant(canonicalDataRoot, backupRoot) || IsSameOrDescendant(backupRoot, canonicalDataRoot))
        {
            throw new StorageBackupException(
                "backup_root_overlaps_data",
                "The backup root resolves to the data root or a nested directory.");
        }
    }

    private static bool IsSameOrDescendant(string parent, string candidate)
    {
        var relative = Path.GetRelativePath(parent, candidate);
        return relative == "." ||
            (!Path.IsPathRooted(relative) &&
             relative != ".." &&
             !relative.StartsWith($"..{Path.DirectorySeparatorChar}", StringComparison.Ordinal));
    }

    private static string CreateOrdinaryDirectory(string path)
    {
        Directory.CreateDirectory(path);
        RejectReparsePoint(path, "A backup directory must not be a reparse point.");
        return path;
    }

    private static void RejectReparsePoint(string path, string message)
    {
        if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0)
        {
            throw new InvalidDataException(message);
        }
    }

    private void RejectAttachmentPath(string blobPath)
    {
        var attachments = Path.Combine(dataRoot, "attachments");
        var blobs = Path.Combine(attachments, "blobs");
        var shard = Path.GetDirectoryName(blobPath)
            ?? throw new InvalidDataException("A referenced attachment path has no shard.");
        foreach (var path in new[] { attachments, blobs, shard, blobPath })
        {
            if (!Directory.Exists(path) && !File.Exists(path))
            {
                throw new FileNotFoundException("A referenced attachment path is missing.", path);
            }

            RejectReparsePoint(path, "A referenced attachment path must not be a reparse point.");
        }
    }

    private static bool TryReadPublishedBackup(string directory, out StorageBackupResult result)
    {
        result = null!;
        try
        {
            RejectReparsePoint(directory, "A published backup must not be a reparse point.");
            var manifestPath = Path.Combine(directory, ManifestFileName);
            var checksumPath = Path.Combine(directory, ManifestChecksumFileName);
            if (!File.Exists(manifestPath) || !File.Exists(checksumPath))
            {
                return false;
            }

            var bytes = File.ReadAllBytes(manifestPath);
            var expected = File.ReadAllText(checksumPath, Encoding.ASCII).Trim();
            if (!IsSha256(expected) ||
                !string.Equals(Convert.ToHexStringLower(SHA256.HashData(bytes)), expected, StringComparison.Ordinal))
            {
                return false;
            }

            var manifest = JsonSerializer.Deserialize<BackupManifest>(bytes, JsonOptions);
            if (manifest?.Files is null || manifest.ProjectRevisions is null ||
                !TryValidateBackupDirectory(directory, manifest, expected, requirePublishedName: true))
            {
                return false;
            }

            var database = manifest.Files.SingleOrDefault(file => file.Path == DatabaseFileName);
            if (database is null)
            {
                return false;
            }

            result = new StorageBackupResult(
                manifest.BackupId,
                directory,
                ParseKind(manifest.Kind),
                manifest.CreatedUtc,
                manifest.SchemaVersion,
                expected,
                database.Sha256,
                database.SizeBytes,
                manifest.Files.Count - 1,
                manifest.ProjectRevisions);
            return true;
        }
        catch (Exception error) when (
            error is IOException or UnauthorizedAccessException or InvalidDataException or SqliteException or
                JsonException or InvalidOperationException or ArgumentException)
        {
            return false;
        }
    }

    private static bool TryValidateBackupDirectory(
        string directory,
        BackupManifest manifest,
        string manifestSha256,
        bool requirePublishedName)
    {
        try
        {
            var manifestPath = Path.Combine(directory, ManifestFileName);
            var checksumPath = Path.Combine(directory, ManifestChecksumFileName);
            if (!File.Exists(manifestPath) || !File.Exists(checksumPath))
            {
                return false;
            }

            var manifestBytes = File.ReadAllBytes(manifestPath);
            var detachedHash = File.ReadAllText(checksumPath, Encoding.ASCII).Trim();
            if (!string.Equals(Convert.ToHexStringLower(SHA256.HashData(manifestBytes)), manifestSha256, StringComparison.Ordinal) ||
                !string.Equals(detachedHash, manifestSha256, StringComparison.Ordinal))
            {
                return false;
            }

            manifest = JsonSerializer.Deserialize<BackupManifest>(manifestBytes, JsonOptions)!;
            if (manifest?.ProjectRevisions is null || manifest.Files is null)
            {
                return false;
            }

            if (manifest.ManifestFormat != ManifestFormat ||
                !string.Equals(manifest.ProductId, ProductId, StringComparison.Ordinal) ||
                manifest.BackupId == Guid.Empty ||
                manifest.SchemaVersion <= 0 ||
                string.IsNullOrWhiteSpace(manifest.AppVersion) ||
                !IsSha256(manifestSha256) ||
                manifest.ProjectRevisions.Any(item => item is null || item.ProjectId == Guid.Empty || item.Revision < 0) ||
                manifest.ProjectRevisions.Select(item => item.ProjectId).Distinct().Count() != manifest.ProjectRevisions.Count ||
                manifest.ProjectRevisions
                    .OrderBy(item => item.ProjectId)
                    .SequenceEqual(manifest.ProjectRevisions) is false ||
                manifest.Files.Count == 0 ||
                manifest.Files.Any(file => file is null || file.Path is null || file.Sha256 is null) ||
                manifest.Files.Select(file => file.Path).Distinct(StringComparer.Ordinal).Count() != manifest.Files.Count ||
                !manifest.Files.OrderBy(file => file.Path, StringComparer.Ordinal).SequenceEqual(manifest.Files) ||
                manifest.Kind is not ("regular" or "pre-update") ||
                requirePublishedName && !string.Equals(
                    Path.GetFileName(directory),
                    ExpectedBackupDirectoryName(manifest.CreatedUtc, manifest.BackupId),
                    StringComparison.Ordinal))
            {
                return false;
            }

            ValidateNoReparseEntries(directory);

            foreach (var file in manifest.Files)
            {
                if (!IsCanonicalManifestPath(file.Path) ||
                    file.SizeBytes < 0 ||
                    !IsSha256(file.Sha256))
                {
                    return false;
                }

                var path = Path.GetFullPath(Path.Combine(directory, file.Path.Replace('/', Path.DirectorySeparatorChar)));
                if (!IsSameOrDescendant(directory, path) || !File.Exists(path))
                {
                    return false;
                }

                RejectReparseAncestors(directory, path);
                RejectReparsePoint(path, "A published backup file must not be a reparse point.");
                using var stream = File.OpenRead(path);
                if (stream.Length != file.SizeBytes ||
                    !string.Equals(Convert.ToHexStringLower(SHA256.HashData(stream)), file.Sha256, StringComparison.Ordinal))
                {
                    return false;
                }
            }

            var databasePath = Path.Combine(directory, DatabaseFileName);
            var snapshot = InspectSnapshot(databasePath);
            var actualFiles = EnumerateOrdinaryFiles(directory)
                .Select(path => Path.GetRelativePath(directory, path).Replace('\\', '/'))
                .Order(StringComparer.Ordinal)
                .ToArray();
            var expectedFiles = manifest.Files
                .Select(file => file.Path)
                .Append(ManifestFileName)
                .Append(ManifestChecksumFileName)
                .Order(StringComparer.Ordinal)
                .ToArray();
            if (!actualFiles.SequenceEqual(expectedFiles))
            {
                return false;
            }

            var expectedBlobs = snapshot.Blobs
                .Select(blob => $"attachments/blobs/{blob.Sha256[..2]}/{blob.Sha256}")
                .Order(StringComparer.Ordinal)
                .ToArray();
            var manifestBlobs = manifest.Files
                .Where(file => file.Path != DatabaseFileName)
                .Select(file => file.Path)
                .Order(StringComparer.Ordinal)
                .ToArray();
            return snapshot.SchemaVersion == manifest.SchemaVersion &&
                snapshot.ProjectRevisions.SequenceEqual(manifest.ProjectRevisions) &&
                expectedBlobs.SequenceEqual(manifestBlobs);
        }
        catch (Exception error) when (
            error is IOException or UnauthorizedAccessException or InvalidDataException or SqliteException or
                JsonException or InvalidOperationException or ArgumentException or NullReferenceException)
        {
            return false;
        }
    }

    private static IReadOnlyList<string> EnumerateOrdinaryFiles(string root)
    {
        var files = new List<string>();
        var pending = new Stack<string>();
        pending.Push(root);
        while (pending.Count > 0)
        {
            var directory = pending.Pop();
            RejectReparsePoint(directory, "A backup directory must not be a reparse point.");
            foreach (var entry in Directory.EnumerateFileSystemEntries(directory, "*", SearchOption.TopDirectoryOnly))
            {
                RejectReparsePoint(entry, "A backup entry must not be a reparse point.");
                if (Directory.Exists(entry))
                {
                    pending.Push(entry);
                }
                else if (File.Exists(entry))
                {
                    files.Add(entry);
                }
                else
                {
                    throw new InvalidDataException("A backup entry changed during verification.");
                }
            }
        }

        return files;
    }

    private static void ValidateNoReparseEntries(string root) => EnumerateOrdinaryFiles(root);

    private static void RejectReparseAncestors(string root, string path)
    {
        var current = Path.GetDirectoryName(path);
        while (current is not null && IsSameOrDescendant(root, current))
        {
            RejectReparsePoint(current, "A backup ancestor directory must not be a reparse point.");
            if (string.Equals(current, root, StringComparison.OrdinalIgnoreCase))
            {
                return;
            }

            current = Path.GetDirectoryName(current);
        }

        throw new InvalidDataException("A backup file is outside its backup directory.");
    }

    private async Task VerifySourceBlobAsync(SnapshotBlob blob, CancellationToken cancellationToken)
    {
        var sourcePath = Path.Combine(
            dataRoot,
            "attachments",
            "blobs",
            blob.Sha256[..2],
            blob.Sha256);
        if (!File.Exists(sourcePath))
        {
            throw new FileNotFoundException("A referenced attachment blob is missing.", sourcePath);
        }

        RejectAttachmentPath(sourcePath);
        await using var stream = new FileStream(
            sourcePath, FileMode.Open, FileAccess.Read, FileShare.Read, BufferSize,
            FileOptions.Asynchronous | FileOptions.SequentialScan);
        var actualHash = Convert.ToHexStringLower(
            await SHA256.HashDataAsync(stream, cancellationToken).ConfigureAwait(false));
        if (stream.Length != blob.SizeBytes || !string.Equals(actualHash, blob.Sha256, StringComparison.Ordinal))
        {
            throw new InvalidDataException("A referenced attachment blob failed backup validation.");
        }
    }

    private static bool IsCanonicalManifestPath(string? path) =>
        !string.IsNullOrEmpty(path) &&
        path == path.Replace('\\', '/') &&
        !Path.IsPathRooted(path) &&
        !path.Split('/').Any(segment => segment is "" or "." or "..");

    private static bool IsSha256(string? value) =>
        value is not null &&
        value.Length == 64 &&
        value.All(character => character is >= '0' and <= '9' or >= 'a' and <= 'f');

    private static void ValidateGeneratedBackupDirectory(string backupRoot, string backupPath)
    {
        var full = Path.GetFullPath(backupPath);
        var leaf = Path.GetFileName(full);
        if (!IsSameOrDescendant(backupRoot, full) ||
            !string.Equals(Path.GetDirectoryName(full), backupRoot, StringComparison.OrdinalIgnoreCase) ||
            !IsGeneratedBackupDirectoryName(leaf) ||
            (File.GetAttributes(full) & FileAttributes.ReparsePoint) != 0)
        {
            throw new InvalidDataException("Refusing to delete an untrusted backup directory.");
        }
    }

    private static string ExpectedBackupDirectoryName(DateTimeOffset createdUtc, Guid backupId) =>
        $"backup-{createdUtc.ToUniversalTime():yyyyMMddTHHmmssfffffffZ}-{backupId:N}";

    private static bool IsGeneratedBackupDirectoryName(string value)
    {
        const int timestampLength = 23;
        const int guidLength = 32;
        const string prefix = "backup-";
        if (value.Length != prefix.Length + timestampLength + 1 + guidLength ||
            !value.StartsWith(prefix, StringComparison.Ordinal) ||
            value[prefix.Length + timestampLength] != '-')
        {
            return false;
        }

        return DateTimeOffset.TryParseExact(
                   value.AsSpan(prefix.Length, timestampLength),
                   "yyyyMMdd'T'HHmmssfffffff'Z'",
                   CultureInfo.InvariantCulture,
                   DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
                   out _) &&
            Guid.TryParseExact(value.AsSpan(prefix.Length + timestampLength + 1), "N", out _);
    }

    private static void FlushExistingFile(string path)
    {
        using var stream = new FileStream(path, FileMode.Open, FileAccess.ReadWrite, FileShare.Read);
        stream.Flush(flushToDisk: true);
    }

    private static void WriteDurableNewFile(string path, byte[] bytes)
    {
        using var stream = new FileStream(
            path, FileMode.CreateNew, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough);
        stream.Write(bytes);
        stream.Flush(flushToDisk: true);
    }

    private static void TryDeleteOwnedStaging(string stagingPath, string stagingRoot)
    {
        try
        {
            if (Directory.Exists(stagingPath) &&
                IsSameOrDescendant(stagingRoot, stagingPath) &&
                !string.Equals(stagingRoot, stagingPath, StringComparison.OrdinalIgnoreCase))
            {
                ValidateNoReparseEntries(stagingPath);
                Directory.Delete(stagingPath, recursive: true);
            }
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or InvalidDataException)
        {
            // The failed staging directory is never a published backup. A later cleanup may remove it.
        }
    }

    private static void ValidateAppVersion(string value)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > 128 || value.Any(char.IsControl))
        {
            throw new ArgumentException("The application version is invalid.", nameof(value));
        }
    }

    private static string FormatKind(StorageBackupKind kind) => kind switch
    {
        StorageBackupKind.Regular => "regular",
        StorageBackupKind.PreUpdate => "pre-update",
        _ => throw new ArgumentOutOfRangeException(nameof(kind)),
    };

    private static StorageBackupKind ParseKind(string value) => value switch
    {
        "regular" => StorageBackupKind.Regular,
        "pre-update" => StorageBackupKind.PreUpdate,
        _ => throw new InvalidDataException("A backup manifest has an unsupported kind."),
    };

    private sealed record SnapshotBlob(string Sha256, long SizeBytes);

    private sealed record SnapshotInventory(
        int SchemaVersion,
        IReadOnlyList<StorageBackupProjectRevision> ProjectRevisions,
        IReadOnlyList<SnapshotBlob> Blobs);

    private sealed record BackupManifest(
        int ManifestFormat,
        string ProductId,
        Guid BackupId,
        string Kind,
        string AppVersion,
        string? PreviousAppVersion,
        int SchemaVersion,
        DateTimeOffset CreatedUtc,
        IReadOnlyList<StorageBackupProjectRevision> ProjectRevisions,
        IReadOnlyList<BackupFileEntry> Files);

    private sealed record BackupFileEntry(string Path, long SizeBytes, string Sha256);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFile(
        string fileName,
        uint desiredAccess,
        FileShare shareMode,
        nint securityAttributes,
        FileMode creationDisposition,
        uint flagsAndAttributes,
        nint templateFile);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetFinalPathNameByHandle(
        SafeFileHandle file,
        [Out] StringBuilder filePath,
        uint filePathLength,
        uint flags);
}
