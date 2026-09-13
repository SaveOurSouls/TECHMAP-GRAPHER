using Techmap.Web;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class BrowserLifecycleTrackerTests
{
    private static readonly TimeSpan GracePeriod = TimeSpan.FromSeconds(10);

    [Fact]
    public void Lifecycle_activation_is_limited_to_interactive_ipv4_loopback_launch()
    {
        Assert.True(BrowserLauncher.ShouldTrackLifecycle("http://127.0.0.1:8762/", noBrowser: false));
        Assert.False(BrowserLauncher.ShouldTrackLifecycle("http://127.0.0.1:8762/", noBrowser: true));
        Assert.False(BrowserLauncher.ShouldTrackLifecycle("http://localhost:8762/", noBrowser: false));
        Assert.False(BrowserLauncher.ShouldTrackLifecycle("http://192.168.1.10:8762/", noBrowser: false));
        Assert.False(BrowserLauncher.ShouldTrackLifecycle("https://127.0.0.1:8762/", noBrowser: false));
    }

    [Fact]
    public void Disabled_tracker_never_requests_shutdown()
    {
        var time = new MutableTimeProvider();
        var tracker = new BrowserLifecycleTracker(time, GracePeriod);

        time.Advance(TimeSpan.FromHours(1));

        Assert.False(tracker.ShouldStop());
        Assert.Throws<InvalidOperationException>(() => tracker.OpenConnection());
    }

    [Fact]
    public void Enabled_tracker_waits_until_a_browser_has_connected()
    {
        var time = new MutableTimeProvider();
        var tracker = new BrowserLifecycleTracker(time, GracePeriod);
        tracker.Enable();

        time.Advance(TimeSpan.FromHours(1));

        Assert.False(tracker.ShouldStop());
    }

    [Fact]
    public void Requests_shutdown_after_last_page_stays_closed_for_grace_period()
    {
        var time = new MutableTimeProvider();
        var tracker = new BrowserLifecycleTracker(time, GracePeriod);
        tracker.Enable();
        var first = tracker.OpenConnection();
        var second = tracker.OpenConnection();

        first.Dispose();
        time.Advance(GracePeriod);
        Assert.False(tracker.ShouldStop());

        second.Dispose();
        time.Advance(GracePeriod - TimeSpan.FromMilliseconds(1));
        Assert.False(tracker.ShouldStop());

        time.Advance(TimeSpan.FromMilliseconds(1));
        Assert.True(tracker.ShouldStop());
    }

    [Fact]
    public void Reconnection_during_grace_period_cancels_pending_shutdown()
    {
        var time = new MutableTimeProvider();
        var tracker = new BrowserLifecycleTracker(time, GracePeriod);
        tracker.Enable();
        var originalPage = tracker.OpenConnection();

        originalPage.Dispose();
        time.Advance(GracePeriod - TimeSpan.FromSeconds(1));
        using var refreshedPage = tracker.OpenConnection();
        time.Advance(GracePeriod);

        Assert.False(tracker.ShouldStop());
    }

    private sealed class MutableTimeProvider : TimeProvider
    {
        private DateTimeOffset utcNow = new(2026, 9, 13, 12, 0, 0, TimeSpan.Zero);

        public override DateTimeOffset GetUtcNow() => utcNow;

        public void Advance(TimeSpan duration) => utcNow += duration;
    }
}
