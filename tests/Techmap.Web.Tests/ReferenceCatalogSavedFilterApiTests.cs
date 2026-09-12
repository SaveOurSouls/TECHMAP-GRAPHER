using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Techmap.Application;
using Techmap.Contracts;
using Techmap.Domain;
using Techmap.Infrastructure.Sqlite;
using Techmap.Web;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class ReferenceCatalogSavedFilterApiTests
{
    private const string Origin = "http://127.0.0.1:18762";

    [Fact]
    public async Task Crud_is_source_scoped_and_canonicalizes_conditions_without_transient_search_state()
    {
        await using var factory = new TechmapWebApplicationFactory();
        using var client = factory.CreateLocalClient();
        var csrf = await StartSessionAsync(client);
        await PublishSourceAsync(client, csrf, "technology-database", "v1");
        await PublishSourceAsync(client, csrf, "wire-database", "v1");

        var request = new CreateReferenceCatalogSavedFilterRequest(
            "  Силовые   выводы  ",
            new ReferenceCatalogSavedFilterQueryRequest(
                "  контакт   силовой ",
                " ter-001 ",
                ["wire", "terminal", "wire"],
                [
                    new ReferenceCatalogSearchFilterRequest("series", "prefix", " alpha "),
                    new ReferenceCatalogSearchFilterRequest("empty", "blank"),
                    new ReferenceCatalogSearchFilterRequest("series", "prefix", " alpha "),
                ],
                "any",
                "source-key-desc"));

        using var createdResponse = await SendAsync(
            client,
            HttpMethod.Post,
            "/api/v1/reference-sources/technology-database/saved-filters",
            request,
            csrf);
        Assert.Equal(HttpStatusCode.Created, createdResponse.StatusCode);
        var created = Assert.IsType<ReferenceCatalogSavedFilterResponse>(
            await createdResponse.Content.ReadFromJsonAsync<ReferenceCatalogSavedFilterResponse>(
                TestContext.Current.CancellationToken));
        Assert.Equal("technology-database", created.SourceId);
        Assert.Equal("Силовые выводы", created.Name);
        Assert.Equal(1, created.Query.Version);
        Assert.Equal("КОНТАКТ СИЛОВОЙ", created.Query.Text);
        Assert.Equal("TER-001", created.Query.ExactSourceKey);
        Assert.Equal(["terminal", "wire"], created.Query.EntityTypes);
        Assert.Equal(["EMPTY", "SERIES"], created.Query.Filters.Select(filter => filter.Field));
        Assert.Equal(["blank", "prefix"], created.Query.Filters.Select(filter => filter.Operator));
        Assert.Null(created.Query.Filters[0].Value);
        Assert.Equal("ALPHA", created.Query.Filters[1].Value);
        Assert.Equal("any", created.Query.FilterLogic);
        Assert.Equal("source-key-desc", created.Query.Sort);
        Assert.Equal(64, created.QuerySha256.Length);

        using var conflict = await SendAsync(
            client,
            HttpMethod.Post,
            "/api/v1/reference-sources/technology-database/saved-filters",
            request with { Name = "силовые выводы" },
            csrf);
        Assert.Equal(HttpStatusCode.Conflict, conflict.StatusCode);
        Assert.Equal(
            "catalog_saved_filter_name_conflict",
            (await conflict.Content.ReadFromJsonAsync<ApiErrorResponse>(
                TestContext.Current.CancellationToken))?.Error);

        using var otherSource = await SendAsync(
            client,
            HttpMethod.Post,
            "/api/v1/reference-sources/wire-database/saved-filters",
            request with { Name = "силовые выводы" },
            csrf);
        Assert.Equal(HttpStatusCode.Created, otherSource.StatusCode);

        var listed = await ListAsync(client, "technology-database");
        Assert.Equal(created.FilterId, Assert.Single(listed.Items).FilterId);

        var updatedRequest = new UpdateReferenceCatalogSavedFilterRequest(
            "Сигнальные",
            new ReferenceCatalogSavedFilterQueryRequest(
                null,
                null,
                ["terminal"],
                [new ReferenceCatalogSearchFilterRequest("series", "eq", "beta")],
                "all",
                "entity-type-asc"));
        using var updatedResponse = await SendAsync(
            client,
            HttpMethod.Put,
            $"/api/v1/reference-sources/technology-database/saved-filters/{created.FilterId:D}",
            updatedRequest,
            csrf);
        Assert.Equal(HttpStatusCode.OK, updatedResponse.StatusCode);
        var updated = Assert.IsType<ReferenceCatalogSavedFilterResponse>(
            await updatedResponse.Content.ReadFromJsonAsync<ReferenceCatalogSavedFilterResponse>(
                TestContext.Current.CancellationToken));
        Assert.Equal(created.FilterId, updated.FilterId);
        Assert.Equal(created.CreatedUtc, updated.CreatedUtc);
        Assert.True(updated.UpdatedUtc >= updated.CreatedUtc);
        Assert.Equal("Сигнальные", updated.Name);
        Assert.Equal("BETA", Assert.Single(updated.Query.Filters).Value);
        Assert.NotEqual(created.QuerySha256, updated.QuerySha256);

        using var wrongSource = await SendAsync(
            client,
            HttpMethod.Put,
            $"/api/v1/reference-sources/wire-database/saved-filters/{created.FilterId:D}",
            updatedRequest,
            csrf);
        Assert.Equal(HttpStatusCode.NotFound, wrongSource.StatusCode);
        Assert.Equal(
            "catalog_saved_filter_not_found",
            (await wrongSource.Content.ReadFromJsonAsync<ApiErrorResponse>(
                TestContext.Current.CancellationToken))?.Error);

        using var deleted = await SendAsync(
            client,
            HttpMethod.Delete,
            $"/api/v1/reference-sources/technology-database/saved-filters/{created.FilterId:D}",
            null,
            csrf);
        Assert.Equal(HttpStatusCode.NoContent, deleted.StatusCode);
        Assert.Empty((await ListAsync(client, "technology-database")).Items);
        Assert.Single((await ListAsync(client, "wire-database")).Items);
    }

    [Fact]
    public async Task Saved_filter_survives_server_restart_with_stable_identity_hash_and_timestamps()
    {
        var root = Path.Combine(
            Path.GetTempPath(), "techmap-saved-filter-restart", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        ReferenceCatalogSavedFilter created;
        try
        {
            using (var firstStorage = SqliteStorage.Open(root))
            {
                using var document = JsonDocument.Parse("{\"name\":\"Fixture\"}");
                var validation = ReferenceCatalogDraft.Create(
                    ReferenceCatalogSnapshotIdentity.New(),
                    "technology-database",
                    1,
                    DateTimeOffset.UtcNow,
                    new ReferenceCatalogProvenanceInput("test", "restart-v1", "fixture"),
                    [new ReferenceCatalogRecordInput(
                        "terminal", "TER-001", document.RootElement.Clone(), "Fixture!2")])
                    .Validate();
                var publication = new ReferenceCatalogPublicationService(
                    new SqliteReferenceCatalogSnapshotStore(firstStorage)).Publish(
                    new ReferenceCatalogPublicationRequest(
                        validation, null, validation.Snapshot!.Sha256, []));
                Assert.Equal(ReferenceCatalogPublicationStatus.Published, publication.Status);
                created = new SqliteReferenceCatalogSavedFilterStore(
                    firstStorage, TimeProvider.System).Create(
                    "technology-database",
                    "После перезапуска",
                    new ReferenceCatalogSavedFilterQuery(
                        "wire", null, ["wire"], [],
                        ReferenceCatalogFilterLogic.All,
                        ReferenceCatalogSort.Relevance));
            }

            using var secondStorage = SqliteStorage.Open(root);
            var restored = Assert.Single(new SqliteReferenceCatalogSavedFilterStore(
                secondStorage, TimeProvider.System).List("technology-database"));
            Assert.Equal(created.FilterId, restored.FilterId);
            Assert.Equal(created.Query.Sha256, restored.Query.Sha256);
            Assert.Equal(created.CreatedUtc, restored.CreatedUtc);
            Assert.Equal(created.UpdatedUtc, restored.UpdatedUtc);
            Assert.Equal(created.Query.CanonicalJson, restored.Query.CanonicalJson);
            Assert.Equal(created.Query.Query.Text, restored.Query.Query.Text);
            Assert.Equal(created.Query.Query.EntityTypes, restored.Query.Query.EntityTypes);
            Assert.Equal(created.Query.Query.Filters, restored.Query.Query.Filters);
        }
        finally
        {
            try { Directory.Delete(root, recursive: true); }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }
    }

    [Fact]
    public async Task Invalid_saved_filter_requests_fail_without_persisting_rows()
    {
        await using var factory = new TechmapWebApplicationFactory();
        using var client = factory.CreateLocalClient();
        var csrf = await StartSessionAsync(client);
        var validQuery = new ReferenceCatalogSavedFilterQueryRequest(
            null, null, [], [], "all", "relevance");

        using var missingSource = await SendAsync(
            client,
            HttpMethod.Post,
            "/api/v1/reference-sources/missing/saved-filters",
            new CreateReferenceCatalogSavedFilterRequest("Filter", validQuery),
            csrf);
        Assert.Equal(HttpStatusCode.NotFound, missingSource.StatusCode);
        Assert.Equal(
            "catalog_reference_source_not_found",
            (await missingSource.Content.ReadFromJsonAsync<ApiErrorResponse>(
                TestContext.Current.CancellationToken))?.Error);

        await PublishSourceAsync(client, csrf, "technology-database", "v1");
        var invalidRequests = new object[]
        {
            new CreateReferenceCatalogSavedFilterRequest("   ", validQuery),
            new CreateReferenceCatalogSavedFilterRequest(
                "Too many",
                validQuery with
                {
                    Filters = Enumerable.Range(0, 9)
                        .Select(index => new ReferenceCatalogSearchFilterRequest($"f{index}", "exists"))
                        .ToArray(),
                }),
            new CreateReferenceCatalogSavedFilterRequest(
                "Value forbidden",
                validQuery with
                {
                    Filters = [new ReferenceCatalogSearchFilterRequest("field", "exists", "value")],
                }),
            new CreateReferenceCatalogSavedFilterRequest(
                "Unknown operator",
                validQuery with
                {
                    Filters = [new ReferenceCatalogSearchFilterRequest("field", "contains")],
                }),
            new CreateReferenceCatalogSavedFilterRequest(
                "Too many words",
                validQuery with { Text = "one two three four five six seven eight nine" }),
            new CreateReferenceCatalogSavedFilterRequest(
                "No words",
                validQuery with { Text = "---" }),
            new CreateReferenceCatalogSavedFilterRequest(
                "Canonical payload too large",
                validQuery with
                {
                    Filters = Enumerable.Range(0, 8)
                        .Select(index => new ReferenceCatalogSearchFilterRequest(
                            new string('Ж', 255) + index,
                            "eq",
                            new string('Я', 512)))
                        .ToArray(),
                }),
        };
        foreach (var invalid in invalidRequests)
        {
            using var response = await SendAsync(
                client,
                HttpMethod.Post,
                "/api/v1/reference-sources/technology-database/saved-filters",
                invalid,
                csrf);
            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
            Assert.Equal(
                "catalog_saved_filter_invalid",
                (await response.Content.ReadFromJsonAsync<ApiErrorResponse>(
                    TestContext.Current.CancellationToken))?.Error);
        }
        Assert.Empty((await ListAsync(client, "technology-database")).Items);
    }

    private static async Task<ReferenceCatalogSavedFilterListResponse> ListAsync(
        HttpClient client,
        string sourceId)
    {
        using var response = await client.GetAsync(
            $"/api/v1/reference-sources/{sourceId}/saved-filters",
            TestContext.Current.CancellationToken);
        response.EnsureSuccessStatusCode();
        return Assert.IsType<ReferenceCatalogSavedFilterListResponse>(
            await response.Content.ReadFromJsonAsync<ReferenceCatalogSavedFilterListResponse>(
                TestContext.Current.CancellationToken));
    }

    private static async Task PublishSourceAsync(
        HttpClient client,
        string csrf,
        string sourceId,
        string version)
    {
        using var document = JsonDocument.Parse("{\"name\":\"Fixture\"}");
        var candidate = new ValidateReferenceCatalogRequest(
            Guid.NewGuid(),
            1,
            DateTimeOffset.UtcNow,
            "test",
            version,
            "fixture",
            [new ReferenceCatalogRecordInputRequest(
                "terminal", "TER-001", document.RootElement.Clone(), "Fixture!2")],
            []);
        using var validationResponse = await SendAsync(
            client,
            HttpMethod.Post,
            $"/api/v1/reference-sources/{sourceId}/validations",
            candidate,
            csrf);
        validationResponse.EnsureSuccessStatusCode();
        var validation = Assert.IsType<ReferenceCatalogSnapshotResponse>(
            await validationResponse.Content.ReadFromJsonAsync<ReferenceCatalogSnapshotResponse>(
                TestContext.Current.CancellationToken));
        using var publicationResponse = await SendAsync(
            client,
            HttpMethod.Post,
            $"/api/v1/reference-sources/{sourceId}/publications",
            new PublishReferenceCatalogRequest(
                candidate.SnapshotId,
                candidate.ContractVersion,
                candidate.CapturedUtc,
                candidate.SourceKind,
                candidate.VersionFingerprint,
                candidate.SourceUri,
                candidate.Records,
                candidate.Diagnostics,
                null,
                validation.Sha256,
                []),
            csrf);
        publicationResponse.EnsureSuccessStatusCode();
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
        HttpClient client,
        HttpMethod method,
        string path,
        object? body,
        string csrf)
    {
        using var request = new HttpRequestMessage(method, path);
        request.Content = body is null
            ? JsonContent.Create(new { })
            : JsonContent.Create(body);
        request.Headers.TryAddWithoutValidation("Origin", Origin);
        request.Headers.TryAddWithoutValidation(LocalHttpSession.CsrfHeaderName, csrf);
        return await client.SendAsync(request, TestContext.Current.CancellationToken);
    }
}
