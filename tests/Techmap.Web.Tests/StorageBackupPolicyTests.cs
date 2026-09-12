using System.Collections.Concurrent;
using Techmap.Application;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class StorageBackupPolicyTests
{
    [Fact]
    public async Task Existing_database_without_state_creates_preupdate_before_recording_version()
    {
        using var fixture = PolicyFixture.Create();
        var service = new FakeBackupService();
        var policy = fixture.Policy(service);

        var state = await policy.EnsurePreUpdateAsync(
            "B", existingDatabase: true, TestContext.Current.CancellationToken);

        var request = Assert.Single(service.CreateRequests);
        Assert.Equal(StorageBackupKind.PreUpdate, request.Kind);
        Assert.Null(request.PreviousAppVersion);
        Assert.Equal("B", state.LastRunAppVersion);
        Assert.Equal("B", policy.ReadState().LastRunAppVersion);
        Assert.Equal(1, service.RetentionCalls);
    }

    [Fact]
    public async Task Same_version_skips_preupdate_while_upgrade_and_downgrade_create_it()
    {
        using var fixture = PolicyFixture.Create();
        var service = new FakeBackupService();
        var policy = fixture.Policy(service);
        await policy.EnsurePreUpdateAsync("A", true, TestContext.Current.CancellationToken);
        service.CreateRequests.Clear();

        await policy.EnsurePreUpdateAsync("A", true, TestContext.Current.CancellationToken);
        await policy.EnsurePreUpdateAsync("B", true, TestContext.Current.CancellationToken);
        await policy.EnsurePreUpdateAsync("A", true, TestContext.Current.CancellationToken);

        Assert.Equal(2, service.CreateRequests.Count);
        Assert.Equal("A", service.CreateRequests[0].PreviousAppVersion);
        Assert.Equal("B", service.CreateRequests[1].PreviousAppVersion);
    }

    [Fact]
    public async Task Failed_preupdate_leaves_state_unchanged_and_next_call_retries()
    {
        using var fixture = PolicyFixture.Create();
        var service = new FakeBackupService { CreateFailuresRemaining = 1 };
        var policy = fixture.Policy(service);

        await Assert.ThrowsAsync<IOException>(() => policy.EnsurePreUpdateAsync(
            "B", true, TestContext.Current.CancellationToken));
        Assert.Equal(string.Empty, policy.ReadState().LastRunAppVersion);

        var state = await policy.EnsurePreUpdateAsync(
            "B", true, TestContext.Current.CancellationToken);

        Assert.Equal("B", state.LastRunAppVersion);
        Assert.Equal(2, service.CreateCallCount);
    }

    [Fact]
    public async Task Regular_policy_checks_due_changes_and_retention()
    {
        using var fixture = PolicyFixture.Create();
        var clock = new MutableTimeProvider(new DateTimeOffset(2026, 9, 12, 1, 0, 0, TimeSpan.Zero));
        var service = new FakeBackupService();
        var policy = fixture.Policy(service, clock, regularInterval: TimeSpan.FromHours(1));

        var first = await policy.RunRegularIfDueAsync("A", TestContext.Current.CancellationToken);
        Assert.Equal(1, service.IfChangedCallCount);
        Assert.NotNull(first.LastSuccessfulRegularBackupUtc);
        Assert.Equal(1, service.RetentionCalls);

        await policy.RunRegularIfDueAsync("A", TestContext.Current.CancellationToken);
        Assert.Equal(1, service.IfChangedCallCount);

        clock.Advance(TimeSpan.FromHours(1));
        service.SkipIfUnchanged = true;
        var unchanged = await policy.RunRegularIfDueAsync("A", TestContext.Current.CancellationToken);

        Assert.Equal(2, service.IfChangedCallCount);
        Assert.Equal(clock.GetUtcNow(), unchanged.LastRegularCheckUtc);
        Assert.Equal(2, service.RetentionCalls);
    }

    [Fact]
    public async Task Clock_rollback_makes_regular_check_due()
    {
        using var fixture = PolicyFixture.Create();
        var clock = new MutableTimeProvider(new DateTimeOffset(2026, 9, 12, 2, 0, 0, TimeSpan.Zero));
        var service = new FakeBackupService();
        var policy = fixture.Policy(service, clock, regularInterval: TimeSpan.FromHours(1));
        await policy.RunRegularIfDueAsync("A", TestContext.Current.CancellationToken);
        clock.Advance(TimeSpan.FromHours(-1));

        await policy.RunRegularIfDueAsync("A", TestContext.Current.CancellationToken);

        Assert.Equal(2, service.IfChangedCallCount);
    }

    [Fact]
    public async Task Concurrent_policy_commands_are_serialized()
    {
        using var fixture = PolicyFixture.Create();
        var service = new FakeBackupService { Delay = TimeSpan.FromMilliseconds(50) };
        var policy = fixture.Policy(service);

        await Task.WhenAll(
            policy.EnsurePreUpdateAsync("A", true, TestContext.Current.CancellationToken),
            policy.EnsurePreUpdateAsync("B", true, TestContext.Current.CancellationToken));

        Assert.Equal(1, service.MaximumConcurrency);
    }

    [Fact]
    public async Task Timer_reports_transient_failure_then_continues_until_cancelled()
    {
        using var fixture = PolicyFixture.Create();
        var service = new FakeBackupService { IfChangedFailuresRemaining = 1 };
        var failures = new ConcurrentQueue<Exception>();
        var policy = fixture.Policy(
            service,
            TimeProvider.System,
            regularInterval: TimeSpan.FromTicks(1),
            timerInterval: TimeSpan.FromMilliseconds(25),
            failures.Enqueue);
        using var cancellation = new CancellationTokenSource(TimeSpan.FromSeconds(2));

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            policy.RunTimerAsync("A", cancellation.Token));

        Assert.Single(failures);
        Assert.True(service.IfChangedCallCount >= 2);
    }

    [Fact]
    public void Corrupt_state_and_invalid_options_are_rejected()
    {
        using var fixture = PolicyFixture.Create();
        File.WriteAllText(fixture.StatePath, "{broken");
        var service = new FakeBackupService();
        var policy = fixture.Policy(service);

        Assert.Throws<InvalidDataException>(() => policy.ReadState());
        Assert.Throws<ArgumentOutOfRangeException>(() => new StorageBackupPolicy(
            service,
            new StorageBackupPolicyOptions(fixture.BackupRoot, RetentionCount: 1),
            fixture.StatePath));
        Assert.Throws<ArgumentOutOfRangeException>(() => new StorageBackupPolicy(
            service,
            new StorageBackupPolicyOptions(fixture.BackupRoot, RegularInterval: TimeSpan.Zero),
            fixture.StatePath));

        File.WriteAllText(
            fixture.StatePath,
            """
            {"format":1,"lastRunAppVersion":"A","lastRegularCheckUtc":"2026-09-12T00:00:00Z","lastSuccessfulRegularBackupUtc":null,"lastSuccessfulDatabaseSha256":"INVALID"}
            """);
        Assert.Throws<InvalidDataException>(() => policy.ReadState());
    }

    [Fact]
    public async Task Invalid_app_version_is_rejected_even_when_policy_would_skip_backup()
    {
        using var fixture = PolicyFixture.Create();
        var service = new FakeBackupService();
        var policy = fixture.Policy(service);

        await Assert.ThrowsAsync<ArgumentException>(() => policy.EnsurePreUpdateAsync(
            " ", existingDatabase: false, TestContext.Current.CancellationToken));
        await Assert.ThrowsAsync<ArgumentException>(() => policy.RunRegularIfDueAsync(
            new string('a', 129), TestContext.Current.CancellationToken));

        Assert.Equal(0, service.CreateCallCount);
        Assert.Equal(0, service.IfChangedCallCount);
    }

    private sealed class PolicyFixture : IDisposable
    {
        private PolicyFixture(string root)
        {
            Root = root;
            BackupRoot = Path.Combine(root, "backups");
            StatePath = Path.Combine(root, "bootstrap", "backup-policy.json");
            Directory.CreateDirectory(Path.GetDirectoryName(StatePath)!);
        }

        public string Root { get; }
        public string BackupRoot { get; }
        public string StatePath { get; }

        public static PolicyFixture Create()
        {
            var root = Path.Combine(Path.GetTempPath(), "techmap-backup-policy", Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(root);
            return new PolicyFixture(root);
        }

        public StorageBackupPolicy Policy(
            FakeBackupService service,
            TimeProvider? clock = null,
            TimeSpan? regularInterval = null,
            TimeSpan? timerInterval = null,
            Action<Exception>? failures = null) =>
            new(
                service,
                new StorageBackupPolicyOptions(BackupRoot, 10, regularInterval, timerInterval),
                StatePath,
                clock,
                failures);

        public void Dispose()
        {
            if (Directory.Exists(Root))
            {
                Directory.Delete(Root, recursive: true);
            }
        }
    }

    private sealed class FakeBackupService : IStorageBackupService
    {
        private int active;
        private int maximumConcurrency;
        private int createCallCount;
        private int ifChangedCallCount;
        private int retentionCalls;
        private int createFailuresRemaining;
        private int ifChangedFailuresRemaining;

        public List<StorageBackupRequest> CreateRequests { get; } = [];
        public int CreateFailuresRemaining
        {
            get => Volatile.Read(ref createFailuresRemaining);
            set => Volatile.Write(ref createFailuresRemaining, value);
        }

        public int IfChangedFailuresRemaining
        {
            get => Volatile.Read(ref ifChangedFailuresRemaining);
            set => Volatile.Write(ref ifChangedFailuresRemaining, value);
        }
        public bool SkipIfUnchanged { get; set; }
        public TimeSpan Delay { get; set; }
        public int MaximumConcurrency => Volatile.Read(ref maximumConcurrency);
        public int CreateCallCount => Volatile.Read(ref createCallCount);
        public int IfChangedCallCount => Volatile.Read(ref ifChangedCallCount);
        public int RetentionCalls => Volatile.Read(ref retentionCalls);

        public async Task<StorageBackupResult> CreateAsync(
            StorageBackupRequest request,
            CancellationToken cancellationToken = default)
        {
            Interlocked.Increment(ref createCallCount);
            CreateRequests.Add(request);
            await EnterAsync(cancellationToken);
            try
            {
                if (InterlockedExtensions.TryDecrementPositive(ref createFailuresRemaining))
                {
                    throw new IOException("simulated backup failure");
                }

                return Result(request);
            }
            finally
            {
                Interlocked.Decrement(ref active);
            }
        }

        public async Task<StorageBackupResult?> CreateIfChangedAsync(
            StorageBackupRequest request,
            string? previousDatabaseSha256,
            CancellationToken cancellationToken = default)
        {
            Interlocked.Increment(ref ifChangedCallCount);
            await EnterAsync(cancellationToken);
            try
            {
                if (InterlockedExtensions.TryDecrementPositive(ref ifChangedFailuresRemaining))
                {
                    throw new IOException("simulated regular failure");
                }

                return SkipIfUnchanged ? null : Result(request);
            }
            finally
            {
                Interlocked.Decrement(ref active);
            }
        }

        public IReadOnlyList<StorageBackupResult> ApplyRetention(string backupRoot, int maximumBackups)
        {
            Interlocked.Increment(ref retentionCalls);
            return [];
        }

        private async Task EnterAsync(CancellationToken cancellationToken)
        {
            var concurrent = Interlocked.Increment(ref active);
            int observed;
            while (concurrent > (observed = Volatile.Read(ref maximumConcurrency)))
            {
                Interlocked.CompareExchange(ref maximumConcurrency, concurrent, observed);
            }

            if (Delay > TimeSpan.Zero)
            {
                await Task.Delay(Delay, cancellationToken);
            }
        }

        private static StorageBackupResult Result(StorageBackupRequest request) => new(
            Guid.NewGuid(),
            Path.Combine(request.BackupRoot, "backup"),
            request.Kind,
            DateTimeOffset.UtcNow,
            4,
            new string('a', 64),
            new string('b', 64),
            1,
            0,
            []);
    }

    private static class InterlockedExtensions
    {
        public static bool TryDecrementPositive(ref int value)
        {
            while (true)
            {
                var current = Volatile.Read(ref value);
                if (current <= 0)
                {
                    return false;
                }

                if (Interlocked.CompareExchange(ref value, current - 1, current) == current)
                {
                    return true;
                }
            }
        }
    }

    private sealed class MutableTimeProvider(DateTimeOffset value) : TimeProvider
    {
        private DateTimeOffset value = value;
        public override DateTimeOffset GetUtcNow() => value;
        public void Advance(TimeSpan amount) => value += amount;
    }
}
