using System.Diagnostics;
using System.Globalization;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Techmap.Infrastructure.Sqlite;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class SqliteStorageIntegrationTests
{
    [Fact]
    public void Bootstrap_publishes_one_generation_with_schema_history_and_diagnostics()
    {
        using var fixture = StorageFixture.Create();
        const int busyTimeoutMilliseconds = 731;

        using var storage = SqliteStorage.Open(fixture.DataRoot, busyTimeoutMilliseconds);

        var layout = storage.Layout;
        Assert.Equal(Path.GetFullPath(fixture.DataRoot), layout.DataRootPath);
        Assert.Equal(
            Path.Combine(layout.DataRootPath, StorageGenerationLayout.CurrentPointerFileName),
            layout.CurrentPointerPath);
        Assert.Equal(
            Path.Combine(layout.DataRootPath, StorageGenerationLayout.GenerationsDirectoryName),
            layout.GenerationsPath);
        Assert.Equal(StorageGenerationLayout.InitialGenerationName, layout.GenerationName);
        Assert.Equal(
            Path.Combine(layout.GenerationsPath, layout.GenerationName),
            layout.GenerationPath);
        Assert.Equal(
            Path.Combine(layout.GenerationPath, StorageGenerationLayout.DatabaseFileName),
            layout.DatabasePath);
        Assert.Equal(
            Path.Combine(layout.GenerationPath, StorageGenerationLayout.ReadyMarkerFileName),
            layout.ReadyMarkerPath);
        Assert.Equal($"{layout.GenerationName}\n", File.ReadAllText(layout.CurrentPointerPath));
        Assert.Equal("ready\n", File.ReadAllText(layout.ReadyMarkerPath));
        Assert.Equal(
            new[] { layout.DatabasePath },
            Directory.GetFiles(layout.DataRootPath, StorageGenerationLayout.DatabaseFileName, SearchOption.AllDirectories));
        Assert.False(File.Exists(Path.Combine(layout.DataRootPath, StorageGenerationLayout.DatabaseFileName)));

        var history = storage.ExecuteRead(ReadSchemaHistory);
        Assert.Equal([1, 2], history.Select(row => row.Version));
        Assert.Equal(
            ["M1-03-initial-storage", "M1-04-projects-and-harnesses"],
            history.Select(row => row.MigrationId));
        Assert.Equal(
            "06cd209eb54cb85cfbe7d0682917044b0dd15f1990c1963c2dac41544ec87fb8",
            history[0].ScriptSha256);
        foreach (var row in history)
        {
            Assert.Equal(32, Convert.FromHexString(row.ScriptSha256).Length);
            Assert.Equal(row.ScriptSha256.ToLowerInvariant(), row.ScriptSha256);
            Assert.StartsWith("0.1.0-", row.AppVersion, StringComparison.Ordinal);
            Assert.True(DateTimeOffset.TryParseExact(
                row.AppliedUtc,
                "O",
                CultureInfo.InvariantCulture,
                DateTimeStyles.RoundtripKind,
                out _));
            Assert.False(string.IsNullOrWhiteSpace(row.Description));
        }
        Assert.Equal(SqliteStorage.CurrentSchemaVersion, ExecuteScalarInt32(storage, "PRAGMA user_version;"));

        Assert.Equal(SqliteStorage.CurrentSchemaVersion, storage.Diagnostics.SchemaVersion);
        Assert.Equal(
            storage.ExecuteInTransaction(unitOfWork =>
                ExecuteScalarString(unitOfWork, "SELECT sqlite_version();")),
            storage.Diagnostics.SqliteVersion);
        Assert.True(Version.TryParse(storage.Diagnostics.SqliteVersion, out _));
        Assert.True(storage.Diagnostics.ForeignKeysEnabled);
        Assert.Equal(busyTimeoutMilliseconds, storage.Diagnostics.BusyTimeoutMilliseconds);
        Assert.Equal("wal", storage.Diagnostics.JournalMode, ignoreCase: true);
        Assert.DoesNotContain(
            typeof(SqliteStorageDiagnostics).GetProperties(),
            property => property.Name.Contains("Path", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void Committed_data_survives_storage_close_and_reopen()
    {
        using var fixture = StorageFixture.Create();
        string databasePath;

        using (var storage = SqliteStorage.Open(fixture.DataRoot))
        {
            databasePath = storage.Layout.DatabasePath;
            storage.ExecuteInTransaction(unitOfWork =>
            {
                ExecuteNonQuery(
                    unitOfWork,
                    "CREATE TABLE integration_items (id INTEGER PRIMARY KEY, value TEXT NOT NULL) STRICT;");
                using var insert = unitOfWork.CreateCommand(
                    "INSERT INTO integration_items (id, value) VALUES (1, $value);");
                insert.Parameters.AddWithValue("$value", "survives-reopen");
                insert.ExecuteNonQuery();
            });
        }

        using var reopened = SqliteStorage.Open(fixture.DataRoot);
        Assert.Equal(databasePath, reopened.Layout.DatabasePath);
        Assert.Equal(
            "survives-reopen",
            reopened.ExecuteInTransaction(unitOfWork =>
            {
                using var command = unitOfWork.CreateCommand(
                    "SELECT value FROM integration_items WHERE id = 1;");
                return Assert.IsType<string>(command.ExecuteScalar());
            }));
        Assert.Equal(
            [1, 2],
            reopened.ExecuteRead(ReadSchemaHistory).Select(row => row.Version));
    }

    [Fact]
    public void Version_one_database_is_migrated_without_rewriting_its_history_row()
    {
        using var fixture = StorageFixture.Create();
        SchemaHistoryRow originalVersionOne;
        string databasePath;
        using (var storage = SqliteStorage.Open(fixture.DataRoot))
        {
            databasePath = storage.Layout.DatabasePath;
            originalVersionOne = storage.ExecuteRead(ReadSchemaHistory).Single(row => row.Version == 1);
        }

        using (var connection = OpenIndependentConnection(databasePath))
        {
            using var command = connection.CreateCommand();
            command.CommandText =
                """
                DROP TRIGGER enforce_project_harness_limit;
                DROP TABLE harnesses;
                DROP TABLE projects;
                DROP TABLE project_counter;
                DELETE FROM schema_history WHERE version = 2;
                PRAGMA user_version = 1;
                """;
            command.ExecuteNonQuery();
        }

        using var migrated = SqliteStorage.Open(fixture.DataRoot);
        var history = migrated.ExecuteRead(ReadSchemaHistory);

        Assert.Equal(2, migrated.Diagnostics.SchemaVersion);
        Assert.Equal(originalVersionOne, history[0]);
        Assert.Equal(2, history[1].Version);
        Assert.Equal("M1-04-projects-and-harnesses", history[1].MigrationId);
        Assert.Equal(
            1,
            migrated.ExecuteRead(unitOfWork => ExecuteScalarInt32(
                unitOfWork,
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='projects';")));
    }

    [Fact]
    public void Exception_rolls_back_every_write_in_the_unit_of_work()
    {
        using var fixture = StorageFixture.Create();
        using var storage = SqliteStorage.Open(fixture.DataRoot);
        storage.ExecuteInTransaction(unitOfWork =>
            ExecuteNonQuery(
                unitOfWork,
                "CREATE TABLE atomic_items (id INTEGER PRIMARY KEY, value TEXT NOT NULL) STRICT;"));
        var expected = new InvalidOperationException("forced integration-test failure");

        var actual = Assert.Throws<InvalidOperationException>(() =>
            storage.ExecuteInTransaction(unitOfWork =>
            {
                unitOfWork.Context.Database.ExecuteSqlRaw(
                    "INSERT INTO atomic_items VALUES (1, 'first');");
                ExecuteNonQuery(unitOfWork, "INSERT INTO atomic_items VALUES (2, 'second');");
                throw expected;
            }));

        Assert.Same(expected, actual);
        Assert.Equal(0, ExecuteScalarInt32(storage, "SELECT COUNT(*) FROM atomic_items;"));
    }

    [Fact]
    public async Task Async_exception_rolls_back_and_invalidates_the_unit_of_work()
    {
        using var fixture = StorageFixture.Create();
        var storage = SqliteStorage.Open(fixture.DataRoot);
        storage.ExecuteInTransaction(unitOfWork =>
            ExecuteNonQuery(
                unitOfWork,
                "CREATE TABLE async_items (id INTEGER PRIMARY KEY, value TEXT NOT NULL) STRICT;"));
        SqliteUnitOfWork? capturedUnitOfWork = null;
        var expected = new InvalidOperationException("forced async integration-test failure");

        var actual = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            storage.ExecuteInTransactionAsync(
                async (unitOfWork, cancellationToken) =>
                {
                    capturedUnitOfWork = unitOfWork;
                    await using var command = unitOfWork.CreateCommand(
                        "INSERT INTO async_items VALUES (1, 'must-roll-back');");
                    await command.ExecuteNonQueryAsync(cancellationToken);
                    throw expected;
                },
                TestContext.Current.CancellationToken));

        Assert.Same(expected, actual);
        Assert.Equal(0, ExecuteScalarInt32(storage, "SELECT COUNT(*) FROM async_items;"));
        Assert.Throws<ObjectDisposedException>(() => capturedUnitOfWork!.CreateCommand("SELECT 1;"));

        await storage.DisposeAsync();
        await Assert.ThrowsAsync<ObjectDisposedException>(() =>
            storage.ExecuteInTransactionAsync(
                (_, _) => Task.CompletedTask,
                TestContext.Current.CancellationToken));
    }

    [Fact]
    public void Foreign_key_enforcement_rejects_an_orphan_and_rolls_back_the_transaction()
    {
        using var fixture = StorageFixture.Create();
        using var storage = SqliteStorage.Open(fixture.DataRoot);
        storage.ExecuteInTransaction(unitOfWork =>
        {
            ExecuteNonQuery(unitOfWork, "CREATE TABLE parents (id INTEGER PRIMARY KEY) STRICT;");
            ExecuteNonQuery(
                unitOfWork,
                "CREATE TABLE children (id INTEGER PRIMARY KEY, parent_id INTEGER NOT NULL REFERENCES parents(id)) STRICT;");
        });

        var error = Assert.Throws<SqliteException>(() =>
            storage.ExecuteInTransaction(unitOfWork =>
                ExecuteNonQuery(unitOfWork, "INSERT INTO children VALUES (1, 404);")));

        Assert.Equal(19, error.SqliteErrorCode);
        Assert.Equal(0, ExecuteScalarInt32(storage, "SELECT COUNT(*) FROM children;"));
    }

    [Fact]
    public void Failed_independent_writer_causes_the_first_half_of_the_command_to_roll_back()
    {
        using var fixture = StorageFixture.Create();
        using var storage = SqliteStorage.Open(fixture.DataRoot);
        storage.ExecuteInTransaction(unitOfWork =>
            ExecuteNonQuery(
                unitOfWork,
                "CREATE TABLE writer_items (id INTEGER PRIMARY KEY, source TEXT NOT NULL) STRICT;"));

        var error = Assert.Throws<SqliteException>(() =>
            storage.ExecuteInTransaction(unitOfWork =>
            {
                ExecuteNonQuery(unitOfWork, "INSERT INTO writer_items VALUES (1, 'first-half');");
                using var competingConnection = OpenIndependentConnection(storage.Layout.DatabasePath);
                using var competingCommand = competingConnection.CreateCommand();
                competingCommand.CommandTimeout = 1;
                competingCommand.CommandText = "INSERT INTO writer_items VALUES (2, 'second-writer');";
                competingCommand.ExecuteNonQuery();
            }));

        Assert.Equal(5, error.SqliteErrorCode);
        Assert.Equal(0, ExecuteScalarInt32(storage, "SELECT COUNT(*) FROM writer_items;"));
    }

    [Fact]
    public void External_writer_is_bounded_by_the_configured_busy_timeout()
    {
        using var fixture = StorageFixture.Create();
        const int busyTimeoutMilliseconds = 1_000;
        using var storage = SqliteStorage.Open(fixture.DataRoot, busyTimeoutMilliseconds);
        storage.ExecuteInTransaction(unitOfWork =>
            ExecuteNonQuery(
                unitOfWork,
                "CREATE TABLE busy_items (id INTEGER PRIMARY KEY, source TEXT NOT NULL) STRICT;"));
        using var holder = OpenIndependentConnection(storage.Layout.DatabasePath);
        using var heldTransaction = holder.BeginTransaction(deferred: false);
        using (var command = holder.CreateCommand())
        {
            command.Transaction = heldTransaction;
            command.CommandText = "INSERT INTO busy_items VALUES (1, 'lock-holder');";
            command.ExecuteNonQuery();
        }

        var callbackStarted = false;
        var stopwatch = Stopwatch.StartNew();
        var error = Assert.Throws<SqliteException>(() =>
            storage.ExecuteInTransaction(_ => callbackStarted = true));
        stopwatch.Stop();

        Assert.Equal(5, error.SqliteErrorCode);
        Assert.False(callbackStarted);
        Assert.InRange(
            stopwatch.Elapsed,
            TimeSpan.FromMilliseconds(700),
            TimeSpan.FromSeconds(3));
        heldTransaction.Rollback();
        Assert.Equal(0, ExecuteScalarInt32(storage, "SELECT COUNT(*) FROM busy_items;"));
    }

    [Fact]
    public void Every_transaction_uses_a_new_connection_with_the_required_pragmas()
    {
        using var fixture = StorageFixture.Create();
        const int busyTimeoutMilliseconds = 913;
        using var storage = SqliteStorage.Open(fixture.DataRoot, busyTimeoutMilliseconds);

        var first = storage.ExecuteInTransaction(ReadConnectionSettings);
        var second = storage.ExecuteInTransaction(ReadConnectionSettings);

        Assert.NotSame(first.Connection, second.Connection);
        AssertConnectionSettings(first, busyTimeoutMilliseconds);
        AssertConnectionSettings(second, busyTimeoutMilliseconds);
    }

    [Fact]
    public void Nested_unit_of_work_is_rejected_before_waiting_for_the_writer_gate()
    {
        using var fixture = StorageFixture.Create();
        using var storage = SqliteStorage.Open(fixture.DataRoot);

        storage.ExecuteInTransaction(_ =>
        {
            var error = Assert.Throws<InvalidOperationException>(() =>
                storage.ExecuteInTransaction(_ => { }));
            Assert.Contains("nested", error.Message, StringComparison.OrdinalIgnoreCase);
        });
    }

    [Fact]
    public void Unit_of_work_connection_and_transaction_cannot_be_reused_after_callback()
    {
        using var fixture = StorageFixture.Create();
        var storage = SqliteStorage.Open(fixture.DataRoot);
        SqliteUnitOfWork? capturedUnitOfWork = null;
        SqliteConnection? capturedConnection = null;
        SqliteTransaction? capturedTransaction = null;
        storage.ExecuteInTransaction(unitOfWork =>
        {
            capturedUnitOfWork = unitOfWork;
            capturedConnection = unitOfWork.Connection;
            capturedTransaction = unitOfWork.Transaction;
        });

        Assert.Throws<ObjectDisposedException>(() => capturedUnitOfWork!.Connection);
        Assert.Throws<ObjectDisposedException>(() => capturedUnitOfWork!.Transaction);
        Assert.Throws<ObjectDisposedException>(() => capturedUnitOfWork!.Context);
        Assert.Throws<ObjectDisposedException>(() => capturedUnitOfWork!.CreateCommand("SELECT 1;"));
        Assert.Equal(System.Data.ConnectionState.Closed, capturedConnection!.State);
        Assert.ThrowsAny<InvalidOperationException>(() => capturedTransaction!.Commit());

        var generationPath = storage.Layout.GenerationPath;
        var movedPath = $"{generationPath}-moved";
        storage.Dispose();
        Assert.Throws<ObjectDisposedException>(() => storage.ExecuteInTransaction(_ => { }));

        Directory.Move(generationPath, movedPath);
        Assert.True(Directory.Exists(movedPath));
        Directory.Move(movedPath, generationPath);
    }

    [Fact]
    public void Existing_current_pointer_with_missing_database_fails_without_recreating_it()
    {
        using var fixture = StorageFixture.Create();
        string databasePath;
        using (var storage = SqliteStorage.Open(fixture.DataRoot))
        {
            databasePath = storage.Layout.DatabasePath;
        }

        File.Delete(databasePath);

        Assert.Throws<InvalidDataException>(() => SqliteStorage.Open(fixture.DataRoot));
        Assert.False(File.Exists(databasePath));
    }

    [Theory]
    [InlineData("../generation-00000001")]
    [InlineData("generation-00000001/..")]
    [InlineData(" generation-00000001")]
    [InlineData("generation-00000001 ")]
    [InlineData("generation-00000001\nsecond-generation")]
    public void Current_pointer_rejects_noncanonical_or_traversing_generation_names(string pointer)
    {
        using var fixture = StorageFixture.Create();
        Directory.CreateDirectory(fixture.DataRoot);
        Directory.CreateDirectory(Path.Combine(
            fixture.DataRoot,
            StorageGenerationLayout.GenerationsDirectoryName));
        var currentPath = Path.Combine(
            fixture.DataRoot,
            StorageGenerationLayout.CurrentPointerFileName);
        File.WriteAllText(currentPath, pointer);

        Assert.Throws<InvalidDataException>(() => SqliteStorage.Open(fixture.DataRoot));
        Assert.Empty(Directory.GetFiles(
            fixture.DataRoot,
            StorageGenerationLayout.DatabaseFileName,
            SearchOption.AllDirectories));
    }

    private static IReadOnlyList<SchemaHistoryRow> ReadSchemaHistory(SqliteUnitOfWork unitOfWork)
    {
        using var command = unitOfWork.CreateCommand(
            """
            SELECT version, migration_id, script_sha256, app_version, applied_utc, description
            FROM schema_history
            ORDER BY version;
            """);
        using var reader = command.ExecuteReader();
        var rows = new List<SchemaHistoryRow>();
        while (reader.Read())
        {
            rows.Add(new SchemaHistoryRow(
                reader.GetInt32(0),
                reader.GetString(1),
                reader.GetString(2),
                reader.GetString(3),
                reader.GetString(4),
                reader.GetString(5)));
        }

        return rows;
    }

    private static ConnectionSettings ReadConnectionSettings(SqliteUnitOfWork unitOfWork) =>
        new(
            unitOfWork.Connection,
            ExecuteScalarInt32(unitOfWork, "PRAGMA foreign_keys;"),
            ExecuteScalarInt32(unitOfWork, "PRAGMA busy_timeout;"),
            ExecuteScalarInt32(unitOfWork, "PRAGMA synchronous;"),
            ExecuteScalarString(unitOfWork, "PRAGMA journal_mode;"));

    private static void AssertConnectionSettings(
        ConnectionSettings settings,
        int busyTimeoutMilliseconds)
    {
        Assert.Equal(1, settings.ForeignKeys);
        Assert.Equal(busyTimeoutMilliseconds, settings.BusyTimeoutMilliseconds);
        Assert.Equal(2, settings.Synchronous);
        Assert.Equal("wal", settings.JournalMode, ignoreCase: true);
    }

    private static int ExecuteScalarInt32(SqliteStorage storage, string commandText) =>
        storage.ExecuteInTransaction(unitOfWork => ExecuteScalarInt32(unitOfWork, commandText));

    private static int ExecuteScalarInt32(SqliteUnitOfWork unitOfWork, string commandText)
    {
        using var command = unitOfWork.CreateCommand(commandText);
        return Convert.ToInt32(command.ExecuteScalar(), CultureInfo.InvariantCulture);
    }

    private static string ExecuteScalarString(SqliteUnitOfWork unitOfWork, string commandText)
    {
        using var command = unitOfWork.CreateCommand(commandText);
        return Convert.ToString(command.ExecuteScalar(), CultureInfo.InvariantCulture)
            ?? throw new InvalidDataException($"SQLite returned null for '{commandText}'.");
    }

    private static void ExecuteNonQuery(SqliteUnitOfWork unitOfWork, string commandText)
    {
        using var command = unitOfWork.CreateCommand(commandText);
        command.ExecuteNonQuery();
    }

    private static SqliteConnection OpenIndependentConnection(string databasePath)
    {
        var connection = new SqliteConnection(new SqliteConnectionStringBuilder
        {
            DataSource = databasePath,
            Mode = SqliteOpenMode.ReadWrite,
            Cache = SqliteCacheMode.Private,
            Pooling = false,
        }.ToString());
        connection.Open();
        return connection;
    }

    private sealed record SchemaHistoryRow(
        int Version,
        string MigrationId,
        string ScriptSha256,
        string AppVersion,
        string AppliedUtc,
        string Description);

    private sealed record ConnectionSettings(
        SqliteConnection Connection,
        int ForeignKeys,
        int BusyTimeoutMilliseconds,
        int Synchronous,
        string JournalMode);

    private sealed class StorageFixture : IDisposable
    {
        private StorageFixture(string root)
        {
            Root = root;
            DataRoot = Path.Combine(root, "data-root");
        }

        public string Root { get; }

        public string DataRoot { get; }

        public static StorageFixture Create()
        {
            var root = Path.Combine(
                Path.GetTempPath(),
                "techmap-sqlite-storage-tests",
                Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(root);
            return new StorageFixture(root);
        }

        public void Dispose()
        {
            if (Directory.Exists(Root))
            {
                Directory.Delete(Root, recursive: true);
            }
        }
    }
}
