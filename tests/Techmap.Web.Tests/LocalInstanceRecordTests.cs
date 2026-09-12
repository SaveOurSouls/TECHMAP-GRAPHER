using System.Net;
using System.Net.Sockets;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Runtime.Versioning;
using System.Text;
using Techmap.Infrastructure.Sqlite;
using Techmap.Web;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class LocalInstanceRecordTests
{
    [Fact]
    public async Task Current_user_record_resolves_only_after_process_and_endpoint_identity_match()
    {
        using var fixture = new InstanceRecordFixture();
        using var server = new IdentityHttpServer(Guid.NewGuid().ToString("D"));
        var pageUrl = $"http://127.0.0.1:{server.Port}/techmap/";

        LocalInstanceRecord.Publish(
            fixture.Identity,
            pageUrl,
            server.InstanceId,
            fixture.RecordStoreRoot);
        var instance = await LocalInstanceRecord.ResolveOwnerAsync(
            fixture.Identity,
            fixture.DataRoot,
            TestContext.Current.CancellationToken,
            TimeSpan.FromSeconds(1),
            fixture.RecordStoreRoot);

        Assert.Equal(pageUrl, instance.PageUrl);
        Assert.Equal(server.InstanceId, instance.InstanceId);
        Assert.False(File.Exists(Path.Combine(fixture.DataRoot, ".techmap-instance.bin")));
        Assert.StartsWith(fixture.RecordStoreRoot, fixture.RecordPath, StringComparison.OrdinalIgnoreCase);
        var payload = File.ReadAllText(fixture.RecordPath);
        Assert.DoesNotContain("csrf", payload, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("token", payload, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(fixture.DataRoot, payload, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Endpoint_with_another_instance_id_is_rejected()
    {
        using var fixture = new InstanceRecordFixture();
        using var server = new IdentityHttpServer(Guid.NewGuid().ToString("D"));
        LocalInstanceRecord.Publish(
            fixture.Identity,
            $"http://127.0.0.1:{server.Port}/",
            Guid.NewGuid().ToString("D"),
            fixture.RecordStoreRoot);

        var error = await Assert.ThrowsAsync<LocalInstanceUnavailableException>(() =>
            LocalInstanceRecord.ResolveOwnerAsync(
                fixture.Identity,
                fixture.DataRoot,
                TestContext.Current.CancellationToken,
                TimeSpan.FromMilliseconds(150),
                fixture.RecordStoreRoot));

        Assert.Equal(fixture.DataRoot, error.CanonicalDataRoot);
    }

    [Fact]
    [SupportedOSPlatform("windows")]
    public void Record_has_protected_acl_and_only_owner_can_delete_it()
    {
        if (!OperatingSystem.IsWindows())
        {
            Assert.Skip("Windows ACL is required.");
        }

        using var fixture = new InstanceRecordFixture();
        var instanceId = Guid.NewGuid().ToString("D");
        LocalInstanceRecord.Publish(
            fixture.Identity,
            "http://127.0.0.1:18762/",
            instanceId,
            fixture.RecordStoreRoot);

        var currentUser = WindowsIdentity.GetCurrent().User;
        var security = new FileInfo(fixture.RecordPath).GetAccessControl(
            AccessControlSections.Owner | AccessControlSections.Access);
        var rules = security.GetAccessRules(true, true, typeof(SecurityIdentifier));

        Assert.NotNull(currentUser);
        Assert.Equal(currentUser, security.GetOwner(typeof(SecurityIdentifier)));
        Assert.DoesNotContain(rules.Cast<FileSystemAccessRule>(), rule =>
            rule.AccessControlType == AccessControlType.Allow &&
            !currentUser.Equals(rule.IdentityReference));

        LocalInstanceRecord.DeleteIfOwned(
            fixture.Identity,
            Guid.NewGuid().ToString("D"),
            fixture.RecordStoreRoot);
        Assert.True(File.Exists(fixture.RecordPath));
        LocalInstanceRecord.DeleteIfOwned(
            fixture.Identity,
            instanceId,
            fixture.RecordStoreRoot);
        Assert.False(File.Exists(fixture.RecordPath));
    }

    [Fact]
    public async Task Recreated_directory_at_the_same_path_does_not_resolve_the_old_owner()
    {
        using var fixture = new InstanceRecordFixture();
        using var server = new IdentityHttpServer(Guid.NewGuid().ToString("D"));
        LocalInstanceRecord.Publish(
            fixture.Identity,
            $"http://127.0.0.1:{server.Port}/",
            server.InstanceId,
            fixture.RecordStoreRoot);

        Directory.Delete(fixture.DataRoot);
        Directory.CreateDirectory(fixture.DataRoot);
        using var replacementLease = DataRootLease.Acquire(fixture.DataRoot);
        Assert.NotEqual(fixture.Identity, replacementLease.Identity);

        await Assert.ThrowsAsync<LocalInstanceUnavailableException>(() =>
            LocalInstanceRecord.ResolveOwnerAsync(
                replacementLease.Identity,
                fixture.DataRoot,
                TestContext.Current.CancellationToken,
                TimeSpan.FromMilliseconds(150),
                fixture.RecordStoreRoot));
    }

    [Theory]
    [InlineData("http://localhost:18762/")]
    [InlineData("http://127.0.0.1:18762//other/")]
    [InlineData("http://127.0.0.1:18762/%2fother/")]
    [InlineData("http://127.0.0.1:18762/techmap")]
    [InlineData("http://127.0.0.1:18762/techmap/?mode=1")]
    [InlineData("http://user@127.0.0.1:18762/")]
    public void Unsafe_or_noncanonical_page_url_is_not_published(string pageUrl)
    {
        using var fixture = new InstanceRecordFixture();

        Assert.Throws<InvalidDataException>(() => LocalInstanceRecord.Publish(
            fixture.Identity,
            pageUrl,
            Guid.NewGuid().ToString("D"),
            fixture.RecordStoreRoot));
        Assert.False(Directory.Exists(fixture.RecordStoreRoot));
    }

    private sealed class InstanceRecordFixture : IDisposable
    {
        private string? recordPath;

        public InstanceRecordFixture()
        {
            Root = Path.Combine(Path.GetTempPath(), $"techmap-instance-record-{Guid.NewGuid():N}");
            DataRoot = Path.Combine(Root, "data-root");
            Directory.CreateDirectory(DataRoot);
            using var lease = DataRootLease.Acquire(DataRoot);
            Identity = lease.Identity;
            RecordStoreRoot = Path.Combine(Root, "closed-record-store");
        }

        public string Root { get; }

        public string DataRoot { get; }

        public DataRootIdentity Identity { get; }

        public string RecordStoreRoot { get; }

        public string RecordPath => recordPath ??= Assert.Single(
            Directory.GetFiles(RecordStoreRoot, "*.instance.json"));

        public void Dispose() => Directory.Delete(Root, recursive: true);
    }

    private sealed class IdentityHttpServer : IDisposable
    {
        private readonly TcpListener listener = new(IPAddress.Loopback, 0);
        private readonly CancellationTokenSource stopping = new();
        private readonly Task runTask;

        public IdentityHttpServer(string instanceId)
        {
            InstanceId = instanceId;
            listener.Start();
            Port = ((IPEndPoint)listener.LocalEndpoint).Port;
            runTask = RunAsync();
        }

        public int Port { get; }

        public string InstanceId { get; }

        public void Dispose()
        {
            stopping.Cancel();
            listener.Stop();
            try
            {
                runTask.GetAwaiter().GetResult();
            }
            catch (OperationCanceledException)
            {
            }
            stopping.Dispose();
        }

        private async Task RunAsync()
        {
            while (!stopping.IsCancellationRequested)
            {
                TcpClient client;
                try
                {
                    client = await listener.AcceptTcpClientAsync(stopping.Token);
                }
                catch (SocketException) when (stopping.IsCancellationRequested)
                {
                    return;
                }

                using (client)
                using (var stream = client.GetStream())
                {
                    var buffer = new byte[4096];
                    _ = await stream.ReadAsync(buffer, stopping.Token);
                    var body = $"{{\"status\":\"ok\",\"apiVersion\":1,\"instanceId\":\"{InstanceId}\"}}";
                    var bodyBytes = Encoding.UTF8.GetBytes(body);
                    var headers = Encoding.ASCII.GetBytes(
                        $"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {bodyBytes.Length}\r\nConnection: close\r\n\r\n");
                    await stream.WriteAsync(headers, stopping.Token);
                    await stream.WriteAsync(bodyBytes, stopping.Token);
                }
            }
        }
    }
}
