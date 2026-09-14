using System.Buffers.Binary;
using System.IO.Compression;
using Techmap.Application;
using Techmap.Infrastructure.Sqlite;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class ComponentTemplateAssetStoreTests
{
    [Fact]
    public async Task Startup_garbage_collection_removes_only_old_unreferenced_blobs()
    {
        var root = Path.Combine(Path.GetTempPath(), "techmap-template-gc", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            using var storage = SqliteStorage.Open(root);
            var cas = new ContentAddressedAttachmentStore(root);
            var orphan = await cas.WriteAsync(
                new MemoryStream("unreferenced"u8.ToArray()), TestContext.Current.CancellationToken);
            var orphanPath = Path.Combine(root, "attachments", "blobs", orphan.Sha256[..2], orphan.Sha256);
            File.SetLastWriteTimeUtc(orphanPath, DateTime.UtcNow.AddDays(-2));

            var templates = new SqliteComponentTemplateStore(storage, TimeProvider.System, cas);
            var template = templates.Create("KEEP", "Keep", [], 1, Content);
            var asset = Assert.Single((await templates.AddAssetAsync(
                template.TemplateId, 1, new MemoryStream(Png(1, 1)), "keep.png", "image/png",
                TestContext.Current.CancellationToken)).Assets);
            var assetPath = Path.Combine(root, "attachments", "blobs", asset.Content.Sha256[..2], asset.Content.Sha256);
            File.SetLastWriteTimeUtc(assetPath, DateTime.UtcNow.AddDays(-2));

            var removed = SqliteAttachmentGarbageCollector.Prune(storage, TimeProvider.System);

            Assert.Equal(1, removed);
            Assert.False(File.Exists(orphanPath));
            Assert.True(File.Exists(assetPath));
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public async Task Stale_asset_addition_is_rejected_before_publishing_a_cas_blob()
    {
        var root = Path.Combine(Path.GetTempPath(), "techmap-template-asset", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            using var storage = SqliteStorage.Open(root);
            var store = new SqliteComponentTemplateStore(storage, TimeProvider.System);
            var template = store.Create("CAS", "CAS", [], 1, Content);
            var first = await store.AddAssetAsync(
                template.TemplateId, 1, new MemoryStream(Png(1, 1)), "first.png", "image/png",
                TestContext.Current.CancellationToken);
            Assert.Equal(2, first.Version);
            Assert.Single(BlobFiles(root));

            var error = await Assert.ThrowsAsync<ComponentTemplateException>(() => store.AddAssetAsync(
                template.TemplateId, 1, new MemoryStream(Png(2, 1)), "stale.png", "image/png",
                TestContext.Current.CancellationToken));

            Assert.Equal("component_template_version_conflict", error.Code);
            Assert.Equal(2, error.CurrentVersion);
            Assert.Single(BlobFiles(root));
            Assert.Equal(2, store.Get(template.TemplateId).Version);
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }

    private static string[] BlobFiles(string root) => Directory.GetFiles(
        Path.Combine(root, "attachments", "blobs"), "*", SearchOption.AllDirectories);

    private static byte[] Png(int width, int height)
    {
        using var result = new MemoryStream();
        result.Write(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 });
        var header = new byte[13];
        BinaryPrimitives.WriteInt32BigEndian(header.AsSpan(0, 4), width);
        BinaryPrimitives.WriteInt32BigEndian(header.AsSpan(4, 4), height);
        header[8] = 8;
        header[9] = 0;
        WriteChunk(result, "IHDR"u8, header);
        using var raw = new MemoryStream();
        for (var y = 0; y < height; y++)
        {
            raw.WriteByte(0);
            for (var x = 0; x < width; x++) raw.WriteByte((byte)(x + y));
        }
        using var compressed = new MemoryStream();
        using (var zlib = new ZLibStream(compressed, CompressionLevel.SmallestSize, leaveOpen: true))
            zlib.Write(raw.ToArray());
        WriteChunk(result, "IDAT"u8, compressed.ToArray());
        WriteChunk(result, "IEND"u8, []);
        return result.ToArray();
    }

    private static void WriteChunk(Stream destination, ReadOnlySpan<byte> type, ReadOnlySpan<byte> data)
    {
        Span<byte> length = stackalloc byte[4];
        BinaryPrimitives.WriteInt32BigEndian(length, data.Length);
        destination.Write(length);
        destination.Write(type);
        destination.Write(data);
        var crcInput = new byte[type.Length + data.Length];
        type.CopyTo(crcInput);
        data.CopyTo(crcInput.AsSpan(type.Length));
        BinaryPrimitives.WriteUInt32BigEndian(length, PngCrc(crcInput));
        destination.Write(length);
    }

    private static uint PngCrc(ReadOnlySpan<byte> value)
    {
        var crc = uint.MaxValue;
        foreach (var octet in value)
        {
            crc ^= octet;
            for (var bit = 0; bit < 8; bit++)
                crc = (crc & 1) != 0 ? 0xedb88320U ^ (crc >> 1) : crc >> 1;
        }
        return ~crc;
    }

    private const string Content =
        """
        {"schemaVersion":1,"views":[{"id":"e4","name":"E4","kind":"e4","primitives":[],"contactPoints":[]},{"id":"drawing","name":"Drawing","kind":"drawing","primitives":[],"contactPoints":[]}]}
        """;
}
