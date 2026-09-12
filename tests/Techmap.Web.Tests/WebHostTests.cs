using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Techmap.Contracts;
using Techmap.Infrastructure.Sqlite;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class WebHostTests
{
    [Fact]
    public async Task Root_mode_serves_placeholder_and_read_only_api()
    {
        await using var factory = new TechmapWebApplicationFactory();
        using var client = factory.CreateLocalClient();
        var cancellationToken = TestContext.Current.CancellationToken;

        var page = await client.GetAsync("/", cancellationToken);
        var health = await client.GetFromJsonAsync<HealthResponse>("/api/v1/health", cancellationToken);
        var runtime = await client.GetFromJsonAsync<RuntimeConfigResponse>(
            "/runtime-config.json",
            cancellationToken);
        var diagnosticsResponse = await client.GetAsync("/api/v1/diagnostics", cancellationToken);
        var diagnostics = await diagnosticsResponse.Content.ReadFromJsonAsync<StorageDiagnosticsResponse>(
            cancellationToken);

        Assert.Equal(HttpStatusCode.OK, page.StatusCode);
        Assert.Contains(
            "TECHMAP-GRAPHER",
            await page.Content.ReadAsStringAsync(cancellationToken));
        Assert.NotNull(health);
        Assert.Equal("ok", health.Status);
        Assert.Equal(1, health.ApiVersion);
        Assert.True(Guid.TryParseExact(health.InstanceId, "D", out _));
        Assert.NotNull(runtime);
        Assert.Equal(1, runtime.ConfigVersion);
        Assert.Equal("/", runtime.BasePath);
        Assert.Equal("/api/v1/", runtime.ApiBasePath);
        Assert.Equal("1", runtime.ApiVersion);
        Assert.Equal(
            SqliteStorage.CurrentSchemaVersion.ToString(System.Globalization.CultureInfo.InvariantCulture),
            runtime.SchemaVersion);
        Assert.Equal(HttpStatusCode.OK, diagnosticsResponse.StatusCode);
        Assert.NotNull(diagnostics);
        Assert.Equal("ready", diagnostics.Status);
        Assert.Equal(SqliteStorage.CurrentSchemaVersion, diagnostics.SchemaVersion);
        Assert.True(Version.TryParse(diagnostics.SqliteVersion, out _));
        Assert.True(diagnostics.ForeignKeysEnabled);
        Assert.Equal(5_000, diagnostics.BusyTimeoutMilliseconds);
        Assert.Equal("wal", diagnostics.JournalMode, ignoreCase: true);
        Assert.DoesNotContain(
            "dataRoot",
            await diagnosticsResponse.Content.ReadAsStringAsync(cancellationToken),
            StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("programRoot", await page.Content.ReadAsStringAsync(cancellationToken));
        AssertSecurityHeaders(page);
    }

    [Fact]
    public async Task Prefix_mode_serves_only_under_configured_path_base()
    {
        await using var factory = new TechmapWebApplicationFactory("--path-base=/techmap");
        using var client = factory.CreateLocalClient();
        var cancellationToken = TestContext.Current.CancellationToken;

        var prefixedPage = await client.GetAsync("/techmap/", cancellationToken);
        var prefixedRuntime = await client.GetFromJsonAsync<RuntimeConfigResponse>(
            "/techmap/runtime-config.json",
            cancellationToken);
        var outsidePrefix = await client.GetAsync("/", cancellationToken);

        Assert.Equal(HttpStatusCode.OK, prefixedPage.StatusCode);
        Assert.NotNull(prefixedRuntime);
        Assert.Equal("/techmap/", prefixedRuntime.BasePath);
        Assert.Equal("/techmap/api/v1/", prefixedRuntime.ApiBasePath);
        Assert.Contains("<base href=\"/techmap/\">", await prefixedPage.Content.ReadAsStringAsync(cancellationToken));
        Assert.Equal(HttpStatusCode.NotFound, outsidePrefix.StatusCode);

        var unknownApi = await client.GetAsync("/techmap/api/v1/not-present", cancellationToken);
        Assert.Equal(HttpStatusCode.NotFound, unknownApi.StatusCode);
        Assert.Equal("application/json", unknownApi.Content.Headers.ContentType?.MediaType);
    }

    [Fact]
    public async Task Foreign_host_header_is_rejected()
    {
        await using var factory = new TechmapWebApplicationFactory();
        using var client = factory.CreateLocalClient();
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/v1/health");
        request.Headers.Host = "example.invalid";

        using var response = await client.SendAsync(request, TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Diagnostics_requires_the_local_session_cookie()
    {
        await using var factory = new TechmapWebApplicationFactory();
        using var client = factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            BaseAddress = new Uri($"http://127.0.0.1:{TechmapWebApplicationFactory.TestPort}"),
            HandleCookies = false,
        });

        using var response = await client.GetAsync(
            "/api/v1/diagnostics",
            TestContext.Current.CancellationToken);
        var error = await response.Content.ReadFromJsonAsync<ApiErrorResponse>(
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal(new ApiErrorResponse("invalid_session"), error);
    }

    [Fact]
    public async Task Unknown_api_is_json_404_before_spa_fallback()
    {
        await using var factory = new TechmapWebApplicationFactory();
        using var client = factory.CreateLocalClient();
        var cancellationToken = TestContext.Current.CancellationToken;

        var response = await client.GetAsync("/api/v1/not-present", cancellationToken);
        var error = await response.Content.ReadFromJsonAsync<ApiErrorResponse>(cancellationToken);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal("application/json", response.Content.Headers.ContentType?.MediaType);
        Assert.Equal(new ApiErrorResponse("api_route_not_found"), error);
        AssertSecurityHeaders(response);
    }

    [Theory]
    [InlineData("")]
    [InlineData("techmap")]
    [InlineData("/techmap/")]
    [InlineData("/techmap//nested")]
    [InlineData("/../techmap")]
    [InlineData("/techmap?mode=1")]
    public void Bad_path_base_is_rejected(string value)
    {
        var error = Assert.Throws<ArgumentException>(() =>
            Techmap.Web.PathBaseConfiguration.Parse([$"--path-base={value}"]));

        Assert.Contains("--path-base", error.Message);
    }

    private static void AssertSecurityHeaders(HttpResponseMessage response)
    {
        Assert.Equal("no-store", response.Headers.CacheControl?.ToString());
        Assert.Equal("nosniff", response.Headers.GetValues("X-Content-Type-Options").Single());
        Assert.Contains("default-src 'self'", response.Headers.GetValues("Content-Security-Policy").Single());
        Assert.Contains("form-action 'self'", response.Headers.GetValues("Content-Security-Policy").Single());
        Assert.Equal("DENY", response.Headers.GetValues("X-Frame-Options").Single());
        Assert.Equal("no-referrer", response.Headers.GetValues("Referrer-Policy").Single());
    }
}
