using System.Globalization;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

namespace Techmap.Infrastructure.Sqlite;

public sealed record SqliteStorageDiagnostics(
    int SchemaVersion,
    string SqliteVersion,
    bool ForeignKeysEnabled,
    int BusyTimeoutMilliseconds,
    string JournalMode);

public sealed class SqliteStorage : IDisposable, IAsyncDisposable
{
    public const int CurrentSchemaVersion = 1;
    public const int DefaultBusyTimeoutMilliseconds = 5_000;

    private const string InitialMigrationId = "M1-03-initial-storage";
    private const string InitialSchemaSql =
        """
        CREATE TABLE schema_history (
            version INTEGER NOT NULL PRIMARY KEY CHECK (version > 0),
            migration_id TEXT NOT NULL UNIQUE,
            script_sha256 TEXT NOT NULL,
            app_version TEXT NOT NULL,
            applied_utc TEXT NOT NULL,
            description TEXT NOT NULL CHECK (length(description) > 0)
        ) STRICT;
        """;

    private readonly string connectionString;
    private readonly int busyTimeoutMilliseconds;
    private readonly SemaphoreSlim writerGate = new(initialCount: 1, maxCount: 1);
    private readonly AsyncLocal<bool> transactionScope = new();
    private int disposed;

    private SqliteStorage(
        StorageGenerationLayout layout,
        string connectionString,
        int busyTimeoutMilliseconds,
        SqliteStorageDiagnostics diagnostics)
    {
        Layout = layout;
        this.connectionString = connectionString;
        this.busyTimeoutMilliseconds = busyTimeoutMilliseconds;
        Diagnostics = diagnostics;
    }

    public StorageGenerationLayout Layout { get; }

    public SqliteStorageDiagnostics Diagnostics { get; }

    public static SqliteStorage Open(
        string dataRoot,
        int busyTimeoutMilliseconds = DefaultBusyTimeoutMilliseconds)
    {
        if (busyTimeoutMilliseconds < 0)
        {
            throw new ArgumentOutOfRangeException(
                nameof(busyTimeoutMilliseconds),
                "The SQLite busy timeout must not be negative.");
        }

        var prepared = StorageGenerationLayout.Prepare(dataRoot);
        var initializationConnectionString = CreateConnectionString(
            prepared.Layout.DatabasePath,
            prepared.Initialize,
            busyTimeoutMilliseconds);
        var diagnostics = InitializeOrValidateDatabase(
            initializationConnectionString,
            prepared.Initialize,
            busyTimeoutMilliseconds);
        StorageGenerationLayout.PublishReadyAndCurrent(prepared);
        var connectionString = CreateConnectionString(
            prepared.Layout.DatabasePath,
            initialize: false,
            busyTimeoutMilliseconds);
        return new SqliteStorage(prepared.Layout, connectionString, busyTimeoutMilliseconds, diagnostics);
    }

    public void ExecuteInTransaction(Action<SqliteUnitOfWork> operation)
    {
        ArgumentNullException.ThrowIfNull(operation);
        ExecuteInTransaction(unitOfWork =>
        {
            operation(unitOfWork);
            return true;
        });
    }

    public T ExecuteInTransaction<T>(Func<SqliteUnitOfWork, T> operation)
    {
        ArgumentNullException.ThrowIfNull(operation);
        ThrowIfDisposed();
        ThrowIfNestedTransaction();
        writerGate.Wait();
        try
        {
            ThrowIfDisposed();
            transactionScope.Value = true;
            using var connection = OpenConfiguredConnection();
            using var transaction = connection.BeginTransaction(deferred: false);
            using var context = CreateDbContext(connection, transaction);
            var unitOfWork = new SqliteUnitOfWork(connection, transaction, context);
            try
            {
                var result = operation(unitOfWork);
                transaction.Commit();
                return result;
            }
            catch
            {
                TryRollback(transaction);
                throw;
            }
            finally
            {
                unitOfWork.Complete();
            }
        }
        finally
        {
            transactionScope.Value = false;
            writerGate.Release();
        }
    }

    public Task ExecuteInTransactionAsync(
        Func<SqliteUnitOfWork, CancellationToken, Task> operation,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(operation);
        return ExecuteInTransactionAsync(
            async (unitOfWork, token) =>
            {
                await operation(unitOfWork, token).ConfigureAwait(false);
                return true;
            },
            cancellationToken);
    }

    public async Task<T> ExecuteInTransactionAsync<T>(
        Func<SqliteUnitOfWork, CancellationToken, Task<T>> operation,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(operation);
        ThrowIfDisposed();
        ThrowIfNestedTransaction();
        await writerGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            ThrowIfDisposed();
            transactionScope.Value = true;
            await using var connection = await OpenConfiguredConnectionAsync(cancellationToken)
                .ConfigureAwait(false);
            await using var transaction = connection.BeginTransaction(deferred: false);
            await using var context = CreateDbContext(connection, transaction);
            var unitOfWork = new SqliteUnitOfWork(connection, transaction, context);
            try
            {
                var result = await operation(unitOfWork, cancellationToken).ConfigureAwait(false);
                await transaction.CommitAsync(cancellationToken).ConfigureAwait(false);
                return result;
            }
            catch
            {
                await TryRollbackAsync(transaction).ConfigureAwait(false);
                throw;
            }
            finally
            {
                unitOfWork.Complete();
            }
        }
        finally
        {
            transactionScope.Value = false;
            writerGate.Release();
        }
    }

    public void Dispose()
    {
        Interlocked.Exchange(ref disposed, 1);
        GC.SuppressFinalize(this);
    }

    public ValueTask DisposeAsync()
    {
        Dispose();
        return ValueTask.CompletedTask;
    }

    private static string CreateConnectionString(
        string databasePath,
        bool initialize,
        int busyTimeoutMilliseconds) =>
        new SqliteConnectionStringBuilder
        {
            DataSource = databasePath,
            Mode = initialize ? SqliteOpenMode.ReadWriteCreate : SqliteOpenMode.ReadWrite,
            Cache = SqliteCacheMode.Private,
            Pooling = false,
            DefaultTimeout = Math.Max(1, (busyTimeoutMilliseconds + 999) / 1000),
        }.ToString();

    private static SqliteStorageDiagnostics InitializeOrValidateDatabase(
        string connectionString,
        bool initialize,
        int busyTimeoutMilliseconds)
    {
        using var connection = new SqliteConnection(connectionString);
        connection.Open();
        ConfigureConnection(connection, busyTimeoutMilliseconds);
        if (initialize)
        {
            InitializeSchema(connection);
        }

        var version = ValidateSchema(connection);
        var foreignKeysEnabled = ExecuteScalarInt32(connection, "PRAGMA foreign_keys;") == 1;
        var effectiveBusyTimeout = ExecuteScalarInt32(connection, "PRAGMA busy_timeout;");
        var journalMode = ExecuteScalarString(connection, "PRAGMA journal_mode;");
        var synchronous = ExecuteScalarInt32(connection, "PRAGMA synchronous;");
        if (!foreignKeysEnabled ||
            effectiveBusyTimeout != busyTimeoutMilliseconds ||
            !string.Equals(journalMode, "wal", StringComparison.OrdinalIgnoreCase) ||
            synchronous != 2)
        {
            throw new InvalidOperationException("The required SQLite connection settings were not applied.");
        }

        var sqliteVersion = ExecuteScalarString(connection, "SELECT sqlite_version();");
        if (string.IsNullOrWhiteSpace(sqliteVersion))
        {
            throw new InvalidOperationException("The SQLite runtime version is unavailable.");
        }

        return new SqliteStorageDiagnostics(
            version,
            sqliteVersion,
            foreignKeysEnabled,
            effectiveBusyTimeout,
            journalMode);
    }

    private static void InitializeSchema(SqliteConnection connection)
    {
        using var transaction = connection.BeginTransaction(deferred: false);
        try
        {
            using var createHistory = connection.CreateCommand();
            createHistory.Transaction = transaction;
            createHistory.CommandText = InitialSchemaSql;
            createHistory.ExecuteNonQuery();

            using var insertInitial = connection.CreateCommand();
            insertInitial.Transaction = transaction;
            insertInitial.CommandText =
                """
                INSERT INTO schema_history
                    (version, migration_id, script_sha256, app_version, applied_utc, description)
                VALUES (
                    $version, $migrationId, $scriptHash, $appVersion, $appliedUtc, $description);
                """;
            insertInitial.Parameters.AddWithValue("$version", CurrentSchemaVersion);
            insertInitial.Parameters.AddWithValue("$migrationId", InitialMigrationId);
            insertInitial.Parameters.AddWithValue(
                "$scriptHash",
                Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(InitialSchemaSql))));
            insertInitial.Parameters.AddWithValue(
                "$appVersion",
                typeof(SqliteStorage).Assembly
                    .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?
                    .InformationalVersion ?? "unknown");
            insertInitial.Parameters.AddWithValue(
                "$appliedUtc",
                DateTimeOffset.UtcNow.ToString("O", CultureInfo.InvariantCulture));
            insertInitial.Parameters.AddWithValue("$description", "Initial storage schema");
            insertInitial.ExecuteNonQuery();

            using var setUserVersion = connection.CreateCommand();
            setUserVersion.Transaction = transaction;
            setUserVersion.CommandText = $"PRAGMA user_version = {CurrentSchemaVersion};";
            setUserVersion.ExecuteNonQuery();
            transaction.Commit();
        }
        catch
        {
            TryRollback(transaction);
            throw;
        }
    }

    private static int ValidateSchema(SqliteConnection connection)
    {
        var history = ExecuteScalarInt32(
            connection,
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='schema_history';");
        if (history != 1)
        {
            throw new InvalidDataException("The SQLite schema history is missing.");
        }

        var count = ExecuteScalarInt32(connection, "SELECT COUNT(*) FROM schema_history;");
        var userVersion = ExecuteScalarInt32(connection, "PRAGMA user_version;");
        using var historyCommand = connection.CreateCommand();
        historyCommand.CommandText =
            "SELECT version, migration_id, script_sha256 FROM schema_history;";
        using var reader = historyCommand.ExecuteReader();
        if (!reader.Read())
        {
            throw new InvalidDataException("The SQLite schema history is empty.");
        }

        var version = reader.GetInt32(0);
        var migrationId = reader.GetString(1);
        var scriptHash = reader.GetString(2);
        var expectedScriptHash = Convert.ToHexStringLower(
            SHA256.HashData(Encoding.UTF8.GetBytes(InitialSchemaSql)));
        if (version != CurrentSchemaVersion ||
            count != 1 ||
            userVersion != version ||
            !string.Equals(migrationId, InitialMigrationId, StringComparison.Ordinal) ||
            !string.Equals(scriptHash, expectedScriptHash, StringComparison.Ordinal))
        {
            throw new InvalidDataException(
                $"The database schema version is inconsistent or unsupported: " +
                $"history={version}, rows={count}, user_version={userVersion}.");
        }

        return version;
    }

    private SqliteConnection OpenConfiguredConnection()
    {
        var connection = new SqliteConnection(connectionString);
        try
        {
            connection.Open();
            ConfigureConnection(connection, busyTimeoutMilliseconds);
            return connection;
        }
        catch
        {
            connection.Dispose();
            throw;
        }
    }

    private static TechmapDbContext CreateDbContext(
        SqliteConnection connection,
        SqliteTransaction transaction)
    {
        var options = new DbContextOptionsBuilder<TechmapDbContext>()
            .UseSqlite(connection)
            .Options;
        var context = new TechmapDbContext(options);
        context.Database.UseTransaction(transaction);
        return context;
    }

    private async Task<SqliteConnection> OpenConfiguredConnectionAsync(
        CancellationToken cancellationToken)
    {
        var connection = new SqliteConnection(connectionString);
        try
        {
            await connection.OpenAsync(cancellationToken).ConfigureAwait(false);
            ConfigureConnection(connection, busyTimeoutMilliseconds);
            return connection;
        }
        catch
        {
            await connection.DisposeAsync().ConfigureAwait(false);
            throw;
        }
    }

    private static void ConfigureConnection(
        SqliteConnection connection,
        int busyTimeoutMilliseconds)
    {
        using (var pragmas = connection.CreateCommand())
        {
            pragmas.CommandText = $"""
                PRAGMA foreign_keys = ON;
                PRAGMA busy_timeout = {busyTimeoutMilliseconds};
                PRAGMA synchronous = FULL;
                """;
            pragmas.ExecuteNonQuery();
        }

        using var journal = connection.CreateCommand();
        journal.CommandText = "PRAGMA journal_mode = WAL;";
        var journalMode = Convert.ToString(journal.ExecuteScalar(), CultureInfo.InvariantCulture);
        if (!string.Equals(journalMode, "wal", StringComparison.OrdinalIgnoreCase) ||
            ExecuteScalarInt32(connection, "PRAGMA foreign_keys;") != 1 ||
            ExecuteScalarInt32(connection, "PRAGMA busy_timeout;") != busyTimeoutMilliseconds ||
            ExecuteScalarInt32(connection, "PRAGMA synchronous;") != 2)
        {
            throw new InvalidOperationException("The required SQLite connection settings were not applied.");
        }
    }

    private static int ExecuteScalarInt32(SqliteConnection connection, string commandText) =>
        Convert.ToInt32(ExecuteScalar(connection, commandText), CultureInfo.InvariantCulture);

    private static string ExecuteScalarString(SqliteConnection connection, string commandText) =>
        Convert.ToString(ExecuteScalar(connection, commandText), CultureInfo.InvariantCulture)
            ?? throw new InvalidDataException("A required SQLite value is missing.");

    private static object? ExecuteScalar(SqliteConnection connection, string commandText)
    {
        using var command = connection.CreateCommand();
        command.CommandText = commandText;
        return command.ExecuteScalar();
    }

    private static void TryRollback(SqliteTransaction transaction)
    {
        try
        {
            transaction.Rollback();
        }
        catch (Exception error) when (error is SqliteException or InvalidOperationException)
        {
            // Preserve the original operation or commit exception.
        }
    }

    private static async Task TryRollbackAsync(SqliteTransaction transaction)
    {
        try
        {
            await transaction.RollbackAsync(CancellationToken.None).ConfigureAwait(false);
        }
        catch (Exception error) when (error is SqliteException or InvalidOperationException)
        {
            // Preserve the original operation or commit exception.
        }
    }

    private void ThrowIfDisposed()
    {
        ObjectDisposedException.ThrowIf(Volatile.Read(ref disposed) != 0, this);
    }

    private void ThrowIfNestedTransaction()
    {
        if (transactionScope.Value)
        {
            throw new InvalidOperationException(
                "A nested SQLite unit of work is not supported on the same execution context.");
        }
    }
}
