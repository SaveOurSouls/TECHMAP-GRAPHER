using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Techmap.Contracts;
using Techmap.Web;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class ReferenceCatalogSearchApiTests
{
    private const string Origin = "http://127.0.0.1:18762";
    private const string SourceId = "technology-database";

    [Fact]
    public async Task Search_supports_text_fields_types_and_cursor_pages_without_loading_the_snapshot()
    {
        await using var factory = new TechmapWebApplicationFactory();
        using var client = factory.CreateLocalClient();
        var csrf = await StartSessionAsync(client);
        var active = await PublishAsync(client, csrf, "v1", null,
        [
            Record("terminal", "T-010", "{\"name\":\"Силовой контакт\",\"series\":\"Alpha\",\"empty\":\"\",\"nullable\":null}"),
            Record("wire", "W-002", "{\"name\":\"Красный провод\",\"series\":\"Alpha\"}"),
            Record("terminal", "T-002", "{\"name\":\"Сигнальный контакт\",\"series\":\"Alpha\"}"),
            Record("terminal", "T-001", "{\"name\":\"Силовой контакт мини\",\"series\":\"Beta\"}"),
        ]);
        var request = new ReferenceCatalogSearchRequest(
            Text: "конт",
            ExactSourceKey: null,
            EntityTypes: ["terminal"],
            Filters: [new ReferenceCatalogSearchFilterRequest("series", "eq", "Alpha")],
            FilterLogic: "all",
            Sort: "source-key-asc",
            PageSize: 1);

        var first = await SearchAsync(client, csrf, request);
        var second = await SearchAsync(client, csrf, request with { Cursor = first.NextCursor });

        Assert.Equal(active.SnapshotId, first.SnapshotId);
        Assert.Equal(active.Sha256, first.SnapshotSha256);
        Assert.Equal("T-002", Assert.Single(first.Items).SourceKey);
        Assert.Equal("T-010", Assert.Single(second.Items).SourceKey);
        Assert.NotNull(first.NextCursor);
        Assert.Null(second.NextCursor);
        Assert.DoesNotContain(first.Items[0].SourceKey, second.Items.Select(item => item.SourceKey));
    }

    [Fact]
    public async Task Exact_key_and_missing_null_blank_filters_remain_distinct()
    {
        await using var factory = new TechmapWebApplicationFactory();
        using var client = factory.CreateLocalClient();
        var csrf = await StartSessionAsync(client);
        await PublishAsync(client, csrf, "v1", null,
        [
            Record("terminal", "T-001", "{\"name\":\"Один\",\"blank\":\"\",\"nullable\":null}"),
            Record("terminal", "T-002", "{\"name\":\"Два\"}"),
        ]);

        async Task<IReadOnlyList<string>> Keys(ReferenceCatalogSearchFilterRequest filter) =>
            (await SearchAsync(client, csrf, new ReferenceCatalogSearchRequest(
                null, null, [], [filter], "all", "source-key-asc", 40)))
            .Items.Select(item => item.SourceKey).ToArray();

        Assert.Equal(["T-001"], await Keys(new("blank", "blank")));
        Assert.Equal(["T-001"], await Keys(new("nullable", "null")));
        Assert.Equal(["T-002"], await Keys(new("nullable", "missing")));
        var exact = await SearchAsync(client, csrf, new ReferenceCatalogSearchRequest(
            null, "t-002", [], [], "all", "relevance", 40));
        Assert.Equal("T-002", Assert.Single(exact.Items).SourceKey);
    }

    [Fact]
    public async Task Cursor_is_bound_to_query_and_active_snapshot()
    {
        await using var factory = new TechmapWebApplicationFactory();
        using var client = factory.CreateLocalClient();
        var csrf = await StartSessionAsync(client);
        var firstSnapshot = await PublishAsync(client, csrf, "v1", null,
            [Record("terminal", "T-001", "{\"name\":\"Первый\"}"), Record("terminal", "T-002", "{\"name\":\"Второй\"}")]);
        var request = new ReferenceCatalogSearchRequest(null, null, [], [], "all", "source-key-asc", 1);
        var first = await SearchAsync(client, csrf, request);

        using var changedQuery = await SendAsync(client,
            $"/api/v1/reference-sources/{SourceId}/catalog-searches",
            request with { Text = "другой", Cursor = first.NextCursor }, csrf);
        Assert.Equal(HttpStatusCode.BadRequest, changedQuery.StatusCode);
        Assert.Equal("catalog_cursor_invalid",
            (await changedQuery.Content.ReadFromJsonAsync<ApiErrorResponse>(TestContext.Current.CancellationToken))?.Error);

        await PublishAsync(client, csrf, "v2", firstSnapshot.SnapshotId,
            [Record("terminal", "T-003", "{\"name\":\"Третий\"}")]);
        using var stale = await SendAsync(client,
            $"/api/v1/reference-sources/{SourceId}/catalog-searches",
            request with { Cursor = first.NextCursor }, csrf);
        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
        Assert.Equal("catalog_cursor_snapshot_changed",
            (await stale.Content.ReadFromJsonAsync<ApiErrorResponse>(TestContext.Current.CancellationToken))?.Error);
    }

    [Fact]
    public async Task Search_normalizes_unicode_preserves_leading_zeroes_and_does_not_accept_fts_grammar()
    {
        await using var factory = new TechmapWebApplicationFactory();
        using var client = factory.CreateLocalClient();
        var csrf = await StartSessionAsync(client);
        await PublishAsync(client, csrf, "unicode-v1", null,
        [
            Record("wire", "0007", "{\"name\":\"Жёлтый провод\",\"code\":\"A-0007\"}"),
            Record("wire", "7", "{\"name\":\"Синий провод\",\"code\":\"A-7\",\"symbol\":\"A😀\"}"),
            Record("wire", "SAFE", "{\"name\":\"OR AND NOT\"}"),
        ]);

        var unicode = await SearchAsync(client, csrf, new ReferenceCatalogSearchRequest(
            "ЖЕ\u0308ЛТЫЙ", null, [], [], "all", "source-key-asc", 40));
        Assert.Equal("0007", Assert.Single(unicode.Items).SourceKey);

        var exact = await SearchAsync(client, csrf, new ReferenceCatalogSearchRequest(
            null, "0007", [], [], "all", "relevance", 40));
        Assert.Equal("0007", Assert.Single(exact.Items).SourceKey);

        var unicodePrefix = await SearchAsync(client, csrf, new ReferenceCatalogSearchRequest(
            null, null, [], [new("symbol", "prefix", "A")], "all", "relevance", 40));
        Assert.Equal("7", Assert.Single(unicodePrefix.Items).SourceKey);

        var grammarShaped = await SearchAsync(client, csrf, new ReferenceCatalogSearchRequest(
            "OR \"AND\" NOT*", null, [], [], "all", "relevance", 40));
        Assert.Equal("SAFE", Assert.Single(grammarShaped.Items).SourceKey);
    }

    [Fact]
    public async Task Invalid_limits_and_tampered_or_oversized_cursors_are_rejected()
    {
        await using var factory = new TechmapWebApplicationFactory();
        using var client = factory.CreateLocalClient();
        var csrf = await StartSessionAsync(client);
        await PublishAsync(client, csrf, "cursor-v1", null,
        [
            Record("wire", "W-001", "{\"name\":\"Первый\"}"),
            Record("wire", "W-002", "{\"name\":\"Второй\"}"),
        ]);
        var request = new ReferenceCatalogSearchRequest(null, null, [], [], "all", "source-key-asc", 1);
        var first = await SearchAsync(client, csrf, request);
        Assert.NotNull(first.NextCursor);

        var cursor = first.NextCursor!;
        var replacement = cursor[^1] == 'A' ? 'B' : 'A';
        using var tampered = await SendAsync(client,
            $"/api/v1/reference-sources/{SourceId}/catalog-searches",
            request with { Cursor = cursor[..^1] + replacement }, csrf);
        Assert.Equal(HttpStatusCode.BadRequest, tampered.StatusCode);
        Assert.Equal("catalog_cursor_invalid", await ErrorCodeAsync(tampered));

        using var oversized = await SendAsync(client,
            $"/api/v1/reference-sources/{SourceId}/catalog-searches",
            request with { Cursor = new string('a', ReferenceCatalogSearchCursorCodec.MaximumCursorLength + 1) }, csrf);
        Assert.Equal(HttpStatusCode.BadRequest, oversized.StatusCode);
        Assert.Equal("catalog_cursor_invalid", await ErrorCodeAsync(oversized));

        using var invalidLimit = await SendAsync(client,
            $"/api/v1/reference-sources/{SourceId}/catalog-searches",
            request with { PageSize = 101, Cursor = null }, csrf);
        Assert.Equal(HttpStatusCode.BadRequest, invalidLimit.StatusCode);
        Assert.Equal("catalog_search_invalid", await ErrorCodeAsync(invalidLimit));
    }

    [Fact]
    public async Task Cursor_pages_cover_equal_normalized_keys_once_in_every_supported_order()
    {
        await using var factory = new TechmapWebApplicationFactory();
        using var client = factory.CreateLocalClient();
        var csrf = await StartSessionAsync(client);
        await PublishAsync(client, csrf, "orders-v1", null,
        [
            Record("wire", "a", "{\"name\":\"Одинаковый\"}"),
            Record("terminal", "A", "{\"name\":\"Одинаковый\"}"),
            Record("wire", "A", "{\"name\":\"Одинаковый\"}"),
            Record("terminal", "b", "{\"name\":\"Одинаковый\"}"),
        ]);

        foreach (var sort in new[] { "relevance", "source-key-asc", "source-key-desc", "entity-type-asc" })
        {
            var request = new ReferenceCatalogSearchRequest(
                "одинаковый", null, [], [], "all", sort, 1);
            var seen = new List<string>();
            string? cursor = null;
            do
            {
                var page = await SearchAsync(client, csrf, request with { Cursor = cursor });
                seen.AddRange(page.Items.Select(item => $"{item.EntityType}:{item.SourceKey}"));
                cursor = page.NextCursor;
            } while (cursor is not null);

            Assert.Equal(4, seen.Count);
            Assert.Equal(4, seen.Distinct(StringComparer.Ordinal).Count());
        }
    }

    [Fact]
    public async Task Filters_support_exists_prefix_and_any_logic()
    {
        await using var factory = new TechmapWebApplicationFactory();
        using var client = factory.CreateLocalClient();
        var csrf = await StartSessionAsync(client);
        await PublishAsync(client, csrf, "filters-v1", null,
        [
            Record("wire", "W-001", "{\"series\":\"Alpha 10\",\"color\":\"red\"}"),
            Record("wire", "W-002", "{\"series\":\"Beta\"}"),
            Record("wire", "W-003", "{\"series\":null,\"color\":\"blue\"}"),
        ]);

        var exists = await SearchAsync(client, csrf, new ReferenceCatalogSearchRequest(
            null, null, [], [new("color", "exists")], "all", "source-key-asc", 40));
        Assert.Equal(["W-001", "W-003"], exists.Items.Select(item => item.SourceKey));

        var prefix = await SearchAsync(client, csrf, new ReferenceCatalogSearchRequest(
            null, null, [], [new("series", "prefix", "alpha")], "all", "source-key-asc", 40));
        Assert.Equal("W-001", Assert.Single(prefix.Items).SourceKey);

        var any = await SearchAsync(client, csrf, new ReferenceCatalogSearchRequest(
            null, null, [],
            [new("color", "eq", "red"), new("series", "eq", "beta")],
            "any", "source-key-asc", 40));
        Assert.Equal(["W-001", "W-002"], any.Items.Select(item => item.SourceKey));
    }

    [Fact]
    public async Task Search_rejects_excessive_terms_types_filters_and_values()
    {
        await using var factory = new TechmapWebApplicationFactory();
        using var client = factory.CreateLocalClient();
        var csrf = await StartSessionAsync(client);
        await PublishAsync(client, csrf, "limits-v1", null,
            [Record("wire", "W-001", "{\"name\":\"Провод\"}")]);
        var requests = new[]
        {
            new ReferenceCatalogSearchRequest(
                "1 2 3 4 5 6 7 8 9", null, [], [], "all", "relevance", 40),
            new ReferenceCatalogSearchRequest(
                null, null, Enumerable.Range(0, 9).Select(index => $"type-{index}").ToArray(),
                [], "all", "relevance", 40),
            new ReferenceCatalogSearchRequest(
                null, null, [], Enumerable.Range(0, 9)
                    .Select(index => new ReferenceCatalogSearchFilterRequest($"f{index}", "exists")).ToArray(),
                "all", "relevance", 40),
            new ReferenceCatalogSearchRequest(
                null, null, [], [new("name", "eq", new string('x', 513))],
                "all", "relevance", 40),
        };

        foreach (var request in requests)
        {
            using var response = await SendAsync(client,
                $"/api/v1/reference-sources/{SourceId}/catalog-searches", request, csrf);
            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
            Assert.Equal("catalog_search_invalid", await ErrorCodeAsync(response));
        }

        using var nullFilter = await SendAsync(
            client,
            $"/api/v1/reference-sources/{SourceId}/catalog-searches",
            new
            {
                text = (string?)null,
                exactSourceKey = (string?)null,
                entityTypes = Array.Empty<string>(),
                filters = new object?[] { null },
                filterLogic = "all",
                sort = "relevance",
                pageSize = 40,
            },
            csrf);
        Assert.Equal(HttpStatusCode.BadRequest, nullFilter.StatusCode);
        Assert.Equal("catalog_search_invalid", await ErrorCodeAsync(nullFilter));
    }

    private static ReferenceCatalogRecordInputRequest Record(string type, string key, string payload)
    {
        using var document = JsonDocument.Parse(payload);
        return new ReferenceCatalogRecordInputRequest(type, key, document.RootElement.Clone(), $"Catalog!{key}");
    }

    private static async Task<ReferenceCatalogSnapshotResponse> PublishAsync(
        HttpClient client,
        string csrf,
        string version,
        Guid? expectedActive,
        IReadOnlyList<ReferenceCatalogRecordInputRequest> records)
    {
        var candidate = new ValidateReferenceCatalogRequest(
            Guid.NewGuid(), 1, DateTimeOffset.UtcNow, "test", version, "fixture", records, []);
        using var validationResponse = await SendAsync(client,
            $"/api/v1/reference-sources/{SourceId}/validations", candidate, csrf);
        validationResponse.EnsureSuccessStatusCode();
        var validation = Assert.IsType<ReferenceCatalogSnapshotResponse>(
            await validationResponse.Content.ReadFromJsonAsync<ReferenceCatalogSnapshotResponse>(
                TestContext.Current.CancellationToken));
        var publication = new PublishReferenceCatalogRequest(
            candidate.SnapshotId, candidate.ContractVersion, candidate.CapturedUtc,
            candidate.SourceKind, candidate.VersionFingerprint, candidate.SourceUri,
            records, [], expectedActive, validation.Sha256, []);
        using var response = await SendAsync(client,
            $"/api/v1/reference-sources/{SourceId}/publications", publication, csrf);
        response.EnsureSuccessStatusCode();
        return Assert.IsType<ReferenceCatalogPublicationResponse>(
            await response.Content.ReadFromJsonAsync<ReferenceCatalogPublicationResponse>(
                TestContext.Current.CancellationToken)).Snapshot;
    }

    private static async Task<ReferenceCatalogSearchResponse> SearchAsync(
        HttpClient client, string csrf, ReferenceCatalogSearchRequest request)
    {
        using var response = await SendAsync(client,
            $"/api/v1/reference-sources/{SourceId}/catalog-searches", request, csrf);
        response.EnsureSuccessStatusCode();
        return Assert.IsType<ReferenceCatalogSearchResponse>(
            await response.Content.ReadFromJsonAsync<ReferenceCatalogSearchResponse>(
                TestContext.Current.CancellationToken));
    }

    private static async Task<string> StartSessionAsync(HttpClient client)
    {
        using var page = await client.GetAsync("/", TestContext.Current.CancellationToken);
        page.EnsureSuccessStatusCode();
        var session = await client.GetFromJsonAsync<SessionBootstrapResponse>(
            "/api/v1/session", TestContext.Current.CancellationToken);
        return Assert.IsType<SessionBootstrapResponse>(session).CsrfNonce;
    }

    private static async Task<HttpResponseMessage> SendAsync(
        HttpClient client, string path, object body, string csrf)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, path) { Content = JsonContent.Create(body) };
        request.Headers.TryAddWithoutValidation("Origin", Origin);
        request.Headers.TryAddWithoutValidation(LocalHttpSession.CsrfHeaderName, csrf);
        return await client.SendAsync(request, TestContext.Current.CancellationToken);
    }

    private static async Task<string?> ErrorCodeAsync(HttpResponseMessage response) =>
        (await response.Content.ReadFromJsonAsync<ApiErrorResponse>(
            TestContext.Current.CancellationToken))?.Error;
}
