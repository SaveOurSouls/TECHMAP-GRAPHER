using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Techmap.Contracts;
using Techmap.Infrastructure.Sqlite;
using Techmap.Web;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class WirePreparationCatalogTests
{
    [Fact]
    public void Seeds_schemes_and_missing_end_combinations_once_without_replacing_existing_rows()
    {
        var root = Path.Combine(Path.GetTempPath(), "wire-preparation-117-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            using var storage = SqliteStorage.Open(root);
            var store = new SqliteReferenceCatalogSnapshotStore(storage);
            WireBlankCatalogSeed.EnsurePublished(store);
            var originals = store.GetActive(WireBlankCatalogSeed.SourceId)!.Records.ToArray();
            WirePreparationCatalogSeed.EnsurePublished(store);
            var schemes = store.GetActive(WirePreparationCatalogSeed.SourceId)!;
            var blanks = store.GetActive(WireBlankCatalogSeed.SourceId)!;
            Assert.Equal(24, schemes.Records.Count);
            Assert.All(schemes.Records, r => Assert.True(r.Payload.GetProperty("operations").GetArrayLength() > 0));
            Assert.True(blanks.Records.Count > originals.Length);
            Assert.All(originals, original => Assert.Contains(blanks.Records, r => r.SourceKey == original.SourceKey && r.Payload.GetRawText() == original.Payload.GetRawText()));
            foreach (var end in new[] { "cut", "copper", "tin", "terminal", "terminal-pin", "lug-pin", "lug-socket", "sealed", "sealed-pin" })
                Assert.Contains(blanks.Records, r => r.Payload.GetProperty("start").GetString() == end || r.Payload.GetProperty("end").GetString() == end);
            WirePreparationCatalogSeed.EnsurePublished(store);
            Assert.Equal(schemes.SnapshotId, store.GetActive(WirePreparationCatalogSeed.SourceId)!.SnapshotId);
            Assert.Equal(blanks.SnapshotId, store.GetActive(WireBlankCatalogSeed.SourceId)!.SnapshotId);
        }
        finally { Directory.Delete(root, recursive: true); }
    }

    [Fact]
    public async Task Api_validates_schemes_and_extended_blank_defaults()
    {
        await using var factory = new TechmapWebApplicationFactory();
        using var client = factory.CreateLocalClient();
        using var page = await client.GetAsync("/", TestContext.Current.CancellationToken);
        var session = await client.GetFromJsonAsync<SessionBootstrapResponse>("/api/v1/session", TestContext.Current.CancellationToken);
        async Task<HttpResponseMessage> Validate(string source, string entity, object payload)
        {
            var candidate = new ValidateReferenceCatalogRequest(Guid.NewGuid(), 1, DateTimeOffset.UtcNow, "editable-table", "test-117", null,
                [new ReferenceCatalogRecordInputRequest(entity, "test", JsonSerializer.SerializeToElement(payload), null)], []);
            using var request = new HttpRequestMessage(HttpMethod.Post, $"/api/v1/reference-sources/{source}/validations") { Content = JsonContent.Create(candidate) };
            request.Headers.TryAddWithoutValidation("Origin", "http://127.0.0.1:18762");
            request.Headers.TryAddWithoutValidation(LocalHttpSession.CsrfHeaderName, session!.CsrfNonce);
            return await client.SendAsync(request, TestContext.Current.CancellationToken);
        }
        using var valid = await Validate(WirePreparationCatalogSeed.SourceId, "wire-preparation-scheme", new { name = "Схема", description = "Черновик", operations = new object?[] { null, null } });
        Assert.Equal(HttpStatusCode.OK, valid.StatusCode);
        using var empty = await Validate(WirePreparationCatalogSeed.SourceId, "wire-preparation-scheme", new { name = "Схема", description = "", operations = Array.Empty<object>() });
        Assert.Equal(HttpStatusCode.BadRequest, empty.StatusCode);
        using var malformed = await Validate(WirePreparationCatalogSeed.SourceId, "wire-preparation-scheme", new { name = "Схема", description = "", operations = new[] { "oops" } });
        Assert.Equal(HttpStatusCode.BadRequest, malformed.StatusCode);
        using var blank = await Validate(WireBlankCatalogSeed.SourceId, "wire-blank", new { index = "test", title = "ПФ", color = "#112233", start = "lug-pin", end = "terminal-pin", defaultSchemeId = "scheme-01" });
        Assert.Equal(HttpStatusCode.OK, blank.StatusCode);
        using var badDefault = await Validate(WireBlankCatalogSeed.SourceId, "wire-blank", new { index = "test", title = "ПФ", color = "#112233", start = "lug-pin", end = "terminal-pin", defaultSchemeId = 42 });
        Assert.Equal(HttpStatusCode.BadRequest, badDefault.StatusCode);
    }
}
