using Techmap.Infrastructure.Sqlite;
using Techmap.Web;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class WireBlankCatalogSeedTests
{
    [Fact]
    public void Publishes_thirteen_editable_wire_blanks_once()
    {
        var root = Path.Combine(Path.GetTempPath(), "techmap-wire-blanks-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            using var storage = SqliteStorage.Open(root);
            var store = new SqliteReferenceCatalogSnapshotStore(storage);
            WireBlankCatalogSeed.EnsurePublished(store);
            var first = store.GetActive(WireBlankCatalogSeed.SourceId)!;
            Assert.Equal(13, first.Records.Count);
            Assert.All(first.Records, row =>
            {
                Assert.Equal("wire-blank", row.EntityType);
                Assert.Equal(row.SourceKey, row.Payload.GetProperty("index").GetString());
                Assert.False(string.IsNullOrWhiteSpace(row.Payload.GetProperty("title").GetString()));
                Assert.False(string.IsNullOrWhiteSpace(row.Payload.GetProperty("templateId").GetString()));
            });
            WireBlankCatalogSeed.EnsurePublished(store);
            Assert.Equal(first.SnapshotId, store.GetActive(WireBlankCatalogSeed.SourceId)!.SnapshotId);
        }
        finally { Directory.Delete(root, recursive: true); }
    }
}
