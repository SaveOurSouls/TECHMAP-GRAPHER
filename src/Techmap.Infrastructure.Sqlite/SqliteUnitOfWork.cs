using Microsoft.Data.Sqlite;

namespace Techmap.Infrastructure.Sqlite;

public sealed class SqliteUnitOfWork
{
    private SqliteConnection? connection;
    private SqliteTransaction? transaction;
    private TechmapDbContext? context;

    internal SqliteUnitOfWork(
        SqliteConnection connection,
        SqliteTransaction transaction,
        TechmapDbContext context)
    {
        this.connection = connection;
        this.transaction = transaction;
        this.context = context;
    }

    public SqliteConnection Connection => connection
        ?? throw new ObjectDisposedException(nameof(SqliteUnitOfWork));

    public SqliteTransaction Transaction => transaction
        ?? throw new ObjectDisposedException(nameof(SqliteUnitOfWork));

    public TechmapDbContext Context => context
        ?? throw new ObjectDisposedException(nameof(SqliteUnitOfWork));

    public SqliteCommand CreateCommand(string commandText)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(commandText);
        var command = Connection.CreateCommand();
        command.Transaction = Transaction;
        command.CommandText = commandText;
        return command;
    }

    internal void Complete()
    {
        transaction = null;
        connection = null;
        context = null;
    }
}
