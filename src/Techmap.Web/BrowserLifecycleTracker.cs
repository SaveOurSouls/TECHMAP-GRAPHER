namespace Techmap.Web;

/// <summary>
/// Tracks browser pages connected to an interactively launched local server.
/// A short empty-session grace period lets a refreshed page reconnect before
/// the server decides that the browser was closed.
/// </summary>
public sealed class BrowserLifecycleTracker
{
    public static readonly TimeSpan DefaultReconnectGracePeriod = TimeSpan.FromSeconds(10);

    private readonly object gate = new();
    private readonly TimeProvider timeProvider;
    private readonly TimeSpan reconnectGracePeriod;
    private readonly HashSet<Guid> connections = [];
    private DateTimeOffset? disconnectedAt;
    private bool enabled;
    private bool hasObservedConnection;

    public BrowserLifecycleTracker(
        TimeProvider? timeProvider = null,
        TimeSpan? reconnectGracePeriod = null)
    {
        this.timeProvider = timeProvider ?? TimeProvider.System;
        this.reconnectGracePeriod = reconnectGracePeriod ?? DefaultReconnectGracePeriod;
        if (this.reconnectGracePeriod <= TimeSpan.Zero)
        {
            throw new ArgumentOutOfRangeException(nameof(reconnectGracePeriod));
        }
    }

    public bool Enabled
    {
        get
        {
            lock (gate)
            {
                return enabled;
            }
        }
    }

    public void Enable()
    {
        lock (gate)
        {
            enabled = true;
        }
    }

    public void Disable()
    {
        lock (gate)
        {
            enabled = false;
            connections.Clear();
            disconnectedAt = null;
            hasObservedConnection = false;
        }
    }

    public IDisposable OpenConnection()
    {
        lock (gate)
        {
            if (!enabled)
            {
                throw new InvalidOperationException("Browser lifecycle tracking is not enabled.");
            }

            var id = Guid.NewGuid();
            connections.Add(id);
            hasObservedConnection = true;
            disconnectedAt = null;
            return new Connection(this, id);
        }
    }

    public void ObservePageActivity()
    {
        lock (gate)
        {
            if (enabled && hasObservedConnection && connections.Count == 0)
            {
                disconnectedAt = timeProvider.GetUtcNow();
            }
        }
    }

    /// <summary>
    /// Returns true only after a page connected and the final connection has
    /// remained closed for the entire grace period. A browser launch failure
    /// or slow initial load therefore cannot terminate the server.
    /// </summary>
    public bool ShouldStop()
    {
        lock (gate)
        {
            return enabled &&
                hasObservedConnection &&
                connections.Count == 0 &&
                disconnectedAt is DateTimeOffset emptySince &&
                timeProvider.GetUtcNow() - emptySince >= reconnectGracePeriod;
        }
    }

    private void CloseConnection(Guid id)
    {
        lock (gate)
        {
            if (connections.Remove(id) && connections.Count == 0)
            {
                disconnectedAt = timeProvider.GetUtcNow();
            }
        }
    }

    private sealed class Connection(BrowserLifecycleTracker owner, Guid id) : IDisposable
    {
        private BrowserLifecycleTracker? owner = owner;

        public void Dispose() => Interlocked.Exchange(ref owner, null)?.CloseConnection(id);
    }
}
