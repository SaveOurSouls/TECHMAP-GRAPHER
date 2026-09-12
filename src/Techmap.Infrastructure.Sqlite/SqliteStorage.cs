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
    public const int CurrentSchemaVersion = 4;
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
    private const string ProjectMigrationId = "M1-04-projects-and-harnesses";
    private const string ProjectSchemaSql =
        """
        CREATE TABLE project_counter (
            counter_id INTEGER NOT NULL PRIMARY KEY CHECK (counter_id = 1),
            next_increment INTEGER NOT NULL CHECK (next_increment > 0)
        ) STRICT;

        INSERT INTO project_counter (counter_id, next_increment) VALUES (1, 1);

        CREATE TABLE projects (
            project_id TEXT NOT NULL PRIMARY KEY CHECK (length(project_id) = 36),
            designation TEXT NOT NULL CHECK (length(designation) BETWEEN 1 AND 128),
            project_increment INTEGER NOT NULL UNIQUE CHECK (project_increment > 0),
            name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 256),
            batch_quantity INTEGER NOT NULL CHECK (batch_quantity > 0),
            status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'completed')),
            created_utc TEXT NOT NULL,
            updated_utc TEXT NOT NULL
        ) STRICT;

        CREATE TABLE harnesses (
            harness_id TEXT NOT NULL PRIMARY KEY CHECK (length(harness_id) = 36),
            project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
            designation TEXT NOT NULL CHECK (length(designation) BETWEEN 1 AND 128),
            sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
            created_utc TEXT NOT NULL,
            updated_utc TEXT NOT NULL,
            UNIQUE (project_id, sort_order)
        ) STRICT;

        CREATE INDEX ix_harnesses_project_order
            ON harnesses (project_id, sort_order, harness_id);

        CREATE TRIGGER enforce_project_harness_limit
        BEFORE INSERT ON harnesses
        WHEN (SELECT COUNT(*) FROM harnesses WHERE project_id = NEW.project_id) >= 100
        BEGIN
            SELECT RAISE(ABORT, 'harness_limit_reached');
        END;
        """;
    private const string ProjectDataMigrationId = "M1-05-attachments-and-pinned-data";
    private const string ProjectDataSchemaSql =
        """
        CREATE TABLE attachment_blobs (
            content_sha256 TEXT NOT NULL PRIMARY KEY
                CHECK (length(content_sha256) = 64)
                CHECK (content_sha256 = lower(content_sha256))
                CHECK (content_sha256 NOT GLOB '*[^0-9a-f]*'),
            size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
            created_utc TEXT NOT NULL
        ) STRICT;

        CREATE TABLE project_attachments (
            attachment_id TEXT NOT NULL PRIMARY KEY CHECK (length(attachment_id) = 36),
            project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
            content_sha256 TEXT NOT NULL
                REFERENCES attachment_blobs(content_sha256) ON DELETE RESTRICT,
            file_name TEXT NOT NULL CHECK (length(file_name) BETWEEN 1 AND 255),
            media_type TEXT NOT NULL CHECK (length(media_type) BETWEEN 1 AND 127),
            purpose TEXT NOT NULL CHECK (length(purpose) BETWEEN 1 AND 64),
            created_utc TEXT NOT NULL
        ) STRICT;

        CREATE INDEX ix_project_attachments_project
            ON project_attachments (project_id, created_utc, attachment_id);
        CREATE INDEX ix_project_attachments_content
            ON project_attachments (content_sha256, attachment_id);

        CREATE TABLE pinned_characteristics (
            snapshot_id TEXT NOT NULL PRIMARY KEY CHECK (length(snapshot_id) = 36),
            project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
            source_kind TEXT NOT NULL CHECK (length(source_kind) BETWEEN 1 AND 64),
            source_record_key TEXT NOT NULL CHECK (length(source_record_key) BETWEEN 1 AND 512),
            source_version TEXT NOT NULL CHECK (length(source_version) BETWEEN 1 AND 512),
            characteristic_name TEXT NOT NULL CHECK (length(characteristic_name) BETWEEN 1 AND 256),
            characteristic_value TEXT NOT NULL CHECK (length(characteristic_value) <= 4096),
            unit TEXT NOT NULL CHECK (length(unit) <= 64),
            canonical_payload TEXT NOT NULL CHECK (length(canonical_payload) BETWEEN 2 AND 65536),
            payload_sha256 TEXT NOT NULL
                CHECK (length(payload_sha256) = 64)
                CHECK (payload_sha256 = lower(payload_sha256))
                CHECK (payload_sha256 NOT GLOB '*[^0-9a-f]*'),
            captured_utc TEXT NOT NULL,
            UNIQUE (
                project_id,
                source_kind,
                source_record_key,
                source_version,
                characteristic_name)
        ) STRICT;

        CREATE INDEX ix_pinned_characteristics_project
            ON pinned_characteristics (project_id, source_kind, source_record_key, characteristic_name);

        CREATE TRIGGER prevent_pinned_characteristic_update
        BEFORE UPDATE ON pinned_characteristics
        BEGIN
            SELECT RAISE(ABORT, 'pinned_characteristic_is_immutable');
        END;
        """;
    private const string ProjectCommandMigrationId = "M1-06-project-command-journal";
    private const string ProjectCommandSchemaSql =
        """
        ALTER TABLE projects
            ADD COLUMN revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0);

        CREATE TABLE project_commands (
            command_id TEXT NOT NULL PRIMARY KEY CHECK (length(command_id) = 36),
            project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
            expected_revision INTEGER NOT NULL CHECK (expected_revision >= 0),
            resulting_revision INTEGER NOT NULL CHECK (resulting_revision = expected_revision + 1),
            command_type TEXT NOT NULL CHECK (length(command_type) BETWEEN 1 AND 64),
            request_schema_version INTEGER NOT NULL CHECK (request_schema_version > 0),
            request_json TEXT NOT NULL CHECK (length(request_json) >= 2),
            request_sha256 TEXT NOT NULL
                CHECK (length(request_sha256) = 64)
                CHECK (request_sha256 = lower(request_sha256))
                CHECK (request_sha256 NOT GLOB '*[^0-9a-f]*'),
            result_schema_version INTEGER NOT NULL CHECK (result_schema_version > 0),
            result_json TEXT NOT NULL CHECK (length(result_json) >= 2),
            result_sha256 TEXT NOT NULL
                CHECK (length(result_sha256) = 64)
                CHECK (result_sha256 = lower(result_sha256))
                CHECK (result_sha256 NOT GLOB '*[^0-9a-f]*'),
            accepted_utc TEXT NOT NULL,
            UNIQUE (project_id, resulting_revision)
        ) STRICT;

        CREATE INDEX ix_project_commands_project_time
            ON project_commands (project_id, accepted_utc, command_id);

        CREATE TABLE project_versions (
            project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
            revision INTEGER NOT NULL CHECK (revision > 0),
            command_id TEXT NOT NULL UNIQUE REFERENCES project_commands(command_id) ON DELETE RESTRICT,
            cause TEXT NOT NULL CHECK (length(cause) BETWEEN 1 AND 64),
            committed_utc TEXT NOT NULL,
            PRIMARY KEY (project_id, revision)
        ) STRICT;

        CREATE TRIGGER prevent_project_command_update
        BEFORE UPDATE ON project_commands
        BEGIN
            SELECT RAISE(ABORT, 'project_command_is_immutable');
        END;

        CREATE TRIGGER prevent_project_command_delete
        BEFORE DELETE ON project_commands
        WHEN EXISTS (SELECT 1 FROM projects WHERE project_id = OLD.project_id)
        BEGIN
            SELECT RAISE(ABORT, 'project_command_is_immutable');
        END;

        CREATE TRIGGER prevent_project_version_update
        BEFORE UPDATE ON project_versions
        BEGIN
            SELECT RAISE(ABORT, 'project_version_is_immutable');
        END;

        CREATE TRIGGER prevent_project_version_delete
        BEFORE DELETE ON project_versions
        WHEN EXISTS (SELECT 1 FROM projects WHERE project_id = OLD.project_id)
        BEGIN
            SELECT RAISE(ABORT, 'project_version_is_immutable');
        END;
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

    public T ExecuteRead<T>(Func<SqliteUnitOfWork, T> operation)
    {
        ArgumentNullException.ThrowIfNull(operation);
        ThrowIfDisposed();
        ThrowIfNestedTransaction();
        transactionScope.Value = true;
        try
        {
            using var connection = OpenConfiguredConnection();
            using var transaction = connection.BeginTransaction(deferred: true);
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
        while (version < CurrentSchemaVersion)
        {
            version = ApplyNextMigration(connection, version);
        }

        version = ValidateSchema(connection);
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
            insertInitial.Parameters.AddWithValue("$version", 1);
            insertInitial.Parameters.AddWithValue("$migrationId", InitialMigrationId);
            insertInitial.Parameters.AddWithValue(
                "$scriptHash",
                HashMigrationSql(InitialSchemaSql));
            insertInitial.Parameters.AddWithValue(
                "$appVersion",
                ApplicationInformationalVersion());
            insertInitial.Parameters.AddWithValue(
                "$appliedUtc",
                DateTimeOffset.UtcNow.ToString("O", CultureInfo.InvariantCulture));
            insertInitial.Parameters.AddWithValue("$description", "Initial storage schema");
            insertInitial.ExecuteNonQuery();

            using var setUserVersion = connection.CreateCommand();
            setUserVersion.Transaction = transaction;
            setUserVersion.CommandText = "PRAGMA user_version = 1;";
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

        var userVersion = ExecuteScalarInt32(connection, "PRAGMA user_version;");
        using var historyCommand = connection.CreateCommand();
        historyCommand.CommandText =
            "SELECT version, migration_id, script_sha256 FROM schema_history ORDER BY version;";
        using var reader = historyCommand.ExecuteReader();
        var rows = new List<(int Version, string MigrationId, string ScriptHash)>();
        while (reader.Read())
        {
            rows.Add((reader.GetInt32(0), reader.GetString(1), reader.GetString(2)));
        }

        if (rows.Count == 0 ||
            userVersion <= 0 ||
            userVersion > CurrentSchemaVersion ||
            rows.Count != userVersion)
        {
            throw new InvalidDataException(
                $"The database schema version is inconsistent or unsupported: " +
                $"rows={rows.Count}, user_version={userVersion}.");
        }

        var expected = new[]
        {
            (Version: 1, MigrationId: InitialMigrationId, Sql: InitialSchemaSql),
            (Version: 2, MigrationId: ProjectMigrationId, Sql: ProjectSchemaSql),
            (Version: 3, MigrationId: ProjectDataMigrationId, Sql: ProjectDataSchemaSql),
            (Version: 4, MigrationId: ProjectCommandMigrationId, Sql: ProjectCommandSchemaSql),
        };
        for (var index = 0; index < rows.Count; index++)
        {
            var row = rows[index];
            var migration = expected[index];
            var expectedHash = HashMigrationSql(migration.Sql);
            if (row.Version != migration.Version ||
                !string.Equals(row.MigrationId, migration.MigrationId, StringComparison.Ordinal) ||
                !string.Equals(row.ScriptHash, expectedHash, StringComparison.Ordinal))
            {
                throw new InvalidDataException(
                    $"The database schema history is inconsistent at version {index + 1}.");
            }
        }

        return userVersion;
    }

    private static int ApplyNextMigration(SqliteConnection connection, int currentVersion)
    {
        var migration = currentVersion switch
        {
            1 => (
                Version: 2,
                MigrationId: ProjectMigrationId,
                Sql: ProjectSchemaSql,
                Description: "Projects and harnesses"),
            2 => (
                Version: 3,
                MigrationId: ProjectDataMigrationId,
                Sql: ProjectDataSchemaSql,
                Description: "Attachments and pinned external data"),
            3 => (
                Version: 4,
                MigrationId: ProjectCommandMigrationId,
                Sql: ProjectCommandSchemaSql,
                Description: "Project revisions and immutable command journal"),
            _ => throw new InvalidDataException(
                $"No supported migration follows storage schema {currentVersion}."),
        };

        if (migration.Version != currentVersion + 1)
        {
            throw new InvalidDataException(
                $"No supported migration follows storage schema {currentVersion}.");
        }

        using var transaction = connection.BeginTransaction(deferred: false);
        try
        {
            using (var migrate = connection.CreateCommand())
            {
                migrate.Transaction = transaction;
                migrate.CommandText = migration.Sql;
                migrate.ExecuteNonQuery();
            }

            using (var appendHistory = connection.CreateCommand())
            {
                appendHistory.Transaction = transaction;
                appendHistory.CommandText =
                    """
                    INSERT INTO schema_history
                        (version, migration_id, script_sha256, app_version, applied_utc, description)
                    VALUES (
                        $version, $migrationId, $scriptHash, $appVersion, $appliedUtc, $description);
                    """;
                appendHistory.Parameters.AddWithValue("$version", migration.Version);
                appendHistory.Parameters.AddWithValue("$migrationId", migration.MigrationId);
                appendHistory.Parameters.AddWithValue(
                    "$scriptHash",
                    HashMigrationSql(migration.Sql));
                appendHistory.Parameters.AddWithValue("$appVersion", ApplicationInformationalVersion());
                appendHistory.Parameters.AddWithValue(
                    "$appliedUtc",
                    DateTimeOffset.UtcNow.ToString("O", CultureInfo.InvariantCulture));
                appendHistory.Parameters.AddWithValue("$description", migration.Description);
                appendHistory.ExecuteNonQuery();
            }

            using (var setUserVersion = connection.CreateCommand())
            {
                setUserVersion.Transaction = transaction;
                setUserVersion.CommandText = $"PRAGMA user_version = {migration.Version};";
                setUserVersion.ExecuteNonQuery();
            }

            transaction.Commit();
            return migration.Version;
        }
        catch
        {
            TryRollback(transaction);
            throw;
        }
    }

    private static string ApplicationInformationalVersion() =>
        typeof(SqliteStorage).Assembly
            .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?
            .InformationalVersion ?? "unknown";

    private static string HashMigrationSql(string sql) =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(
            sql.Replace("\r\n", "\n", StringComparison.Ordinal).Replace('\r', '\n'))));

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
