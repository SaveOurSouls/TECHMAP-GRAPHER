using System.Security.Cryptography;
using System.Text;
using Techmap.Infrastructure.Sqlite;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class ContentAddressedAttachmentStoreTests
{
    [Fact]
    public async Task Writes_outside_sqlite_generation_and_returns_streamed_sha256()
    {
        using var fixture = AttachmentFixture.Create();
        var content = Encoding.UTF8.GetBytes("тестовое вложение");
        var store = new ContentAddressedAttachmentStore(fixture.DataRoot);

        var attachment = await store.WriteAsync(
            new MemoryStream(content),
            TestContext.Current.CancellationToken);

        Assert.Equal(Convert.ToHexStringLower(SHA256.HashData(content)), attachment.Sha256);
        Assert.Equal(content.Length, attachment.Length);
        Assert.Equal(
            content,
            await fixture.ReadBlobAsync(attachment, TestContext.Current.CancellationToken));
        Assert.DoesNotContain(
            Path.DirectorySeparatorChar + "generations" + Path.DirectorySeparatorChar,
            fixture.BlobPath(attachment),
            StringComparison.OrdinalIgnoreCase);
        Assert.Empty(fixture.StagingFiles());
    }

    [Fact]
    public async Task Identical_bytes_are_deduplicated_to_one_immutable_blob()
    {
        using var fixture = AttachmentFixture.Create();
        var store = new ContentAddressedAttachmentStore(fixture.DataRoot);
        var content = RandomNumberGenerator.GetBytes(192_000);

        var first = await store.WriteAsync(
            new MemoryStream(content),
            TestContext.Current.CancellationToken);
        var second = await store.WriteAsync(
            new MemoryStream(content),
            TestContext.Current.CancellationToken);

        Assert.Equal(first, second);
        Assert.Single(fixture.BlobFiles());
        Assert.Empty(fixture.StagingFiles());
        await store.ValidateAsync(first, TestContext.Current.CancellationToken);
    }

    [Fact]
    public async Task Concurrent_identical_writes_publish_one_valid_blob()
    {
        using var fixture = AttachmentFixture.Create();
        var store = new ContentAddressedAttachmentStore(fixture.DataRoot);
        var content = RandomNumberGenerator.GetBytes(256_000);

        var writes = Enumerable.Range(0, 4)
            .Select(_ => store.WriteAsync(
                new MemoryStream(content),
                TestContext.Current.CancellationToken))
            .ToArray();
        var attachments = await Task.WhenAll(writes);

        Assert.Single(attachments.Distinct());
        Assert.Single(fixture.BlobFiles());
        Assert.Empty(fixture.StagingFiles());
        await store.ValidateAsync(attachments[0], TestContext.Current.CancellationToken);
    }

    [Fact]
    public async Task Verified_read_detects_missing_and_corrupt_content()
    {
        using var fixture = AttachmentFixture.Create();
        var store = new ContentAddressedAttachmentStore(fixture.DataRoot);
        var content = Encoding.UTF8.GetBytes("immutable bytes");
        var attachment = await store.WriteAsync(
            new MemoryStream(content),
            TestContext.Current.CancellationToken);

        await using (var stream = await store.OpenReadVerifiedAsync(
                         attachment,
                         TestContext.Current.CancellationToken))
        {
            using var output = new MemoryStream();
            await stream.CopyToAsync(output, TestContext.Current.CancellationToken);
            Assert.Equal(content, output.ToArray());
        }

        await File.WriteAllBytesAsync(
            fixture.BlobPath(attachment),
            Encoding.UTF8.GetBytes("corrupt content"),
            TestContext.Current.CancellationToken);
        await Assert.ThrowsAsync<InvalidDataException>(() =>
            store.ValidateAsync(attachment, TestContext.Current.CancellationToken));
        await Assert.ThrowsAsync<InvalidDataException>(() =>
            store.OpenReadVerifiedAsync(attachment, TestContext.Current.CancellationToken));

        File.Delete(fixture.BlobPath(attachment));
        await Assert.ThrowsAsync<FileNotFoundException>(() =>
            store.ValidateAsync(attachment, TestContext.Current.CancellationToken));
        await Assert.ThrowsAsync<FileNotFoundException>(() =>
            store.OpenReadVerifiedAsync(attachment, TestContext.Current.CancellationToken));
    }

    [Fact]
    public async Task Source_failure_removes_staging_and_publishes_nothing()
    {
        using var fixture = AttachmentFixture.Create();
        var store = new ContentAddressedAttachmentStore(fixture.DataRoot);
        await using var source = new ThrowingReadStream(
            RandomNumberGenerator.GetBytes(32_000),
            throwAfterBytes: 9_000);

        await Assert.ThrowsAsync<IOException>(() =>
            store.WriteAsync(source, TestContext.Current.CancellationToken));

        Assert.Empty(fixture.StagingFiles());
        Assert.Empty(fixture.BlobFiles());
    }

    [Theory]
    [InlineData("")]
    [InlineData("ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789")]
    [InlineData("../../outside")]
    public async Task Rejects_noncanonical_content_references(string sha256)
    {
        using var fixture = AttachmentFixture.Create();
        var store = new ContentAddressedAttachmentStore(fixture.DataRoot);

        await Assert.ThrowsAsync<ArgumentException>(() =>
            store.ValidateAsync(
                new StoredAttachment(sha256, 0),
                TestContext.Current.CancellationToken));
    }

    [Fact]
    public void Startup_removes_only_stale_staging_files()
    {
        using var fixture = AttachmentFixture.Create();
        var staging = Path.Combine(fixture.DataRoot, "attachments", "staging");
        Directory.CreateDirectory(staging);
        var stale = Path.Combine(staging, "stale.staging");
        var recent = Path.Combine(staging, "recent.staging");
        File.WriteAllText(stale, "stale");
        File.WriteAllText(recent, "recent");
        File.SetLastWriteTimeUtc(stale, DateTime.UtcNow.AddDays(-2));

        _ = new ContentAddressedAttachmentStore(fixture.DataRoot);

        Assert.False(File.Exists(stale));
        Assert.True(File.Exists(recent));
    }

    [Fact]
    public void Orphan_cleanup_skips_a_read_only_blob_without_blocking_startup_maintenance()
    {
        using var fixture = AttachmentFixture.Create();
        var hash = new string('a', 64);
        var path = Path.Combine(fixture.DataRoot, "attachments", "blobs", "aa", hash);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, "orphan");
        File.SetLastWriteTimeUtc(path, DateTime.UtcNow.AddDays(-2));
        File.SetAttributes(path, FileAttributes.ReadOnly);
        try
        {
            var store = new ContentAddressedAttachmentStore(fixture.DataRoot);
            var removed = store.PruneUnreferencedBlobs(
                new HashSet<string>(StringComparer.Ordinal),
                DateTimeOffset.UtcNow.AddDays(-1));

            Assert.Equal(0, removed);
            Assert.True(File.Exists(path));
        }
        finally
        {
            if (File.Exists(path)) File.SetAttributes(path, FileAttributes.Normal);
        }
    }

    private sealed class AttachmentFixture : IDisposable
    {
        private AttachmentFixture(string root)
        {
            Root = root;
            DataRoot = Path.Combine(root, "data-root");
            Directory.CreateDirectory(DataRoot);
        }

        public string Root { get; }

        public string DataRoot { get; }

        public static AttachmentFixture Create()
        {
            var root = Path.Combine(
                Path.GetTempPath(),
                "techmap-attachment-tests",
                Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(root);
            return new AttachmentFixture(root);
        }

        public string BlobPath(StoredAttachment attachment) => Path.Combine(
            DataRoot,
            "attachments",
            "blobs",
            attachment.Sha256[..2],
            attachment.Sha256);

        public string[] BlobFiles() => Directory.Exists(Path.Combine(DataRoot, "attachments", "blobs"))
            ? Directory.GetFiles(Path.Combine(DataRoot, "attachments", "blobs"), "*", SearchOption.AllDirectories)
            : [];

        public string[] StagingFiles() => Directory.Exists(Path.Combine(DataRoot, "attachments", "staging"))
            ? Directory.GetFiles(Path.Combine(DataRoot, "attachments", "staging"), "*", SearchOption.AllDirectories)
            : [];

        public Task<byte[]> ReadBlobAsync(
            StoredAttachment attachment,
            CancellationToken cancellationToken) =>
            File.ReadAllBytesAsync(BlobPath(attachment), cancellationToken);

        public void Dispose()
        {
            if (Directory.Exists(Root))
            {
                Directory.Delete(Root, recursive: true);
            }
        }
    }

    private sealed class ThrowingReadStream(byte[] content, int throwAfterBytes) : Stream
    {
        private int position;

        public override bool CanRead => true;

        public override bool CanSeek => false;

        public override bool CanWrite => false;

        public override long Length => content.Length;

        public override long Position
        {
            get => position;
            set => throw new NotSupportedException();
        }

        public override int Read(byte[] buffer, int offset, int count) =>
            throw new NotSupportedException();

        public override ValueTask<int> ReadAsync(
            Memory<byte> buffer,
            CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (position >= throwAfterBytes)
            {
                throw new IOException("Injected source failure.");
            }

            var count = Math.Min(buffer.Length, Math.Min(4096, throwAfterBytes - position));
            content.AsMemory(position, count).CopyTo(buffer);
            position += count;
            return ValueTask.FromResult(count);
        }

        public override void Flush() => throw new NotSupportedException();

        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();

        public override void SetLength(long value) => throw new NotSupportedException();

        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    }
}
