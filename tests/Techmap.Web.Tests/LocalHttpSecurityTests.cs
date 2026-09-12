using System.Net;
using System.Net.Http.Json;
using System.Text;
using Techmap.Contracts;
using Techmap.Web;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class LocalHttpSecurityTests
{
    private const string CanonicalOrigin = "http://127.0.0.1:18762";

    [Theory]
    [InlineData("localhost:18762")]
    [InlineData("127.0.0.1")]
    [InlineData("127.0.0.1:18763")]
    [InlineData("[::1]:18762")]
    [InlineData("example.invalid:18762")]
    public async Task Authority_must_match_exact_ipv4_loopback_and_listener_port(string host)
    {
        await using var factory = new TechmapWebApplicationFactory();
        using var client = factory.CreateLocalClient();
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/v1/health");
        request.Headers.Host = host;

        using var response = await client.SendAsync(request, TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Theory]
    [InlineData("/")]
    [InlineData("/index.html")]
    public async Task Index_issues_process_session_cookie_and_session_endpoint_returns_only_csrf_nonce(
        string pagePath)
    {
        await using var factory = new TechmapWebApplicationFactory();
        using var client = factory.CreateLocalClient();
        var cancellationToken = TestContext.Current.CancellationToken;

        using var page = await client.GetAsync(pagePath, cancellationToken);
        var html = await page.Content.ReadAsStringAsync(cancellationToken);
        var setCookie = Assert.Single(page.Headers.GetValues("Set-Cookie"));
        var cookieValue = ReadCookieValue(setCookie);

        Assert.Contains($"{LocalHttpSession.CookieName}=", setCookie, StringComparison.Ordinal);
        Assert.Contains("path=/", setCookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("httponly", setCookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("samesite=strict", setCookie, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("domain=", setCookie, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("expires=", setCookie, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("max-age=", setCookie, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(cookieValue, html, StringComparison.Ordinal);

        using var sessionResponse = await client.GetAsync("/api/v1/session", cancellationToken);
        var session = await sessionResponse.Content.ReadFromJsonAsync<SessionBootstrapResponse>(cancellationToken);
        using var repeatedSessionResponse = await client.GetAsync("/api/v1/session", cancellationToken);
        var repeatedSession = await repeatedSessionResponse.Content.ReadFromJsonAsync<SessionBootstrapResponse>(
            cancellationToken);

        Assert.Equal(HttpStatusCode.OK, sessionResponse.StatusCode);
        Assert.NotNull(session);
        Assert.Matches("^[A-Za-z0-9_-]{43}$", session.CsrfNonce);
        Assert.Matches("^[0-9a-f-]{36}$", session.InstanceId);
        Assert.Equal(session, repeatedSession);
        Assert.DoesNotContain(session.CsrfNonce, html, StringComparison.Ordinal);
        Assert.DoesNotContain(cookieValue, await sessionResponse.Content.ReadAsStringAsync(cancellationToken));
        AssertNoCorsHeaders(sessionResponse);
    }

    [Fact]
    public async Task Prefix_session_cookie_is_scoped_to_application()
    {
        await using var factory = new TechmapWebApplicationFactory("--path-base=/techmap");
        using var client = factory.CreateLocalClient();
        var cancellationToken = TestContext.Current.CancellationToken;

        using var page = await client.GetAsync("/techmap/route/deep", cancellationToken);
        var setCookie = Assert.Single(page.Headers.GetValues("Set-Cookie"));
        using var sessionResponse = await client.GetAsync("/techmap/api/v1/session", cancellationToken);

        Assert.Contains("path=/techmap/", setCookie, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(HttpStatusCode.OK, sessionResponse.StatusCode);
    }

    [Fact]
    public async Task Session_endpoint_rejects_missing_and_malformed_cookie()
    {
        await using var factory = new TechmapWebApplicationFactory();
        using var client = factory.CreateLocalClient();
        var cancellationToken = TestContext.Current.CancellationToken;

        using var missing = await client.GetAsync("/api/v1/session", cancellationToken);
        using var malformedRequest = new HttpRequestMessage(HttpMethod.Get, "/api/v1/session");
        malformedRequest.Headers.TryAddWithoutValidation("Cookie", $"{LocalHttpSession.CookieName}=not_base64url!");
        using var malformed = await client.SendAsync(malformedRequest, cancellationToken);

        Assert.Equal(HttpStatusCode.Unauthorized, missing.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, malformed.StatusCode);
    }

    [Theory]
    [InlineData("POST")]
    [InlineData("PUT")]
    [InlineData("PATCH")]
    [InlineData("DELETE")]
    public async Task Authorized_mutation_reaches_routing_for_each_allowed_verb(string method)
    {
        await using var factory = new TechmapWebApplicationFactory();
        using var client = factory.CreateLocalClient();
        var csrf = await StartSessionAsync(client);
        using var request = CreateMutation(new HttpMethod(method), csrf);

        using var response = await client.SendAsync(request, TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal("application/json", response.Content.Headers.ContentType?.MediaType);
        AssertNoCorsHeaders(response);
    }

    [Fact]
    public async Task Mutation_requires_origin_session_csrf_and_json_before_routing()
    {
        await using var factory = new TechmapWebApplicationFactory();
        using var client = factory.CreateLocalClient();
        var cancellationToken = TestContext.Current.CancellationToken;
        var csrf = await StartSessionAsync(client);

        using var missingOrigin = CreateMutation(HttpMethod.Post, csrf, origin: null);
        using var wrongOrigin = CreateMutation(HttpMethod.Post, csrf, origin: "http://127.0.0.1:18763");
        using var missingCsrf = CreateMutation(HttpMethod.Post, csrf: null);
        using var badContentType = CreateMutation(HttpMethod.Post, csrf, contentType: "text/plain");

        Assert.Equal(HttpStatusCode.Forbidden, (await client.SendAsync(missingOrigin, cancellationToken)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.SendAsync(wrongOrigin, cancellationToken)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.SendAsync(missingCsrf, cancellationToken)).StatusCode);
        Assert.Equal(
            HttpStatusCode.UnsupportedMediaType,
            (await client.SendAsync(badContentType, cancellationToken)).StatusCode);

        using var noCookieClient = factory.CreateLocalClient();
        using var noCookie = CreateMutation(HttpMethod.Post, csrf);
        Assert.Equal(HttpStatusCode.Unauthorized, (await noCookieClient.SendAsync(noCookie, cancellationToken)).StatusCode);
    }

    [Fact]
    public async Task Cross_origin_preflight_is_not_enabled()
    {
        await using var factory = new TechmapWebApplicationFactory();
        using var client = factory.CreateLocalClient();
        using var request = new HttpRequestMessage(HttpMethod.Options, "/api/v1/not-present");
        request.Headers.TryAddWithoutValidation("Origin", "https://example.invalid");
        request.Headers.TryAddWithoutValidation("Access-Control-Request-Method", "POST");

        using var response = await client.SendAsync(request, TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        AssertNoCorsHeaders(response);
    }

    private static async Task<string> StartSessionAsync(HttpClient client)
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        using var page = await client.GetAsync("/", cancellationToken);
        page.EnsureSuccessStatusCode();
        var session = await client.GetFromJsonAsync<SessionBootstrapResponse>(
            "/api/v1/session",
            cancellationToken);
        return Assert.IsType<SessionBootstrapResponse>(session).CsrfNonce;
    }

    private static HttpRequestMessage CreateMutation(
        HttpMethod method,
        string? csrf,
        string? origin = CanonicalOrigin,
        string contentType = "application/json")
    {
        var request = new HttpRequestMessage(method, "/api/v1/not-present")
        {
            Content = new StringContent("{}", Encoding.UTF8, contentType),
        };
        if (origin is not null)
        {
            request.Headers.TryAddWithoutValidation("Origin", origin);
        }
        if (csrf is not null)
        {
            request.Headers.TryAddWithoutValidation(LocalHttpSession.CsrfHeaderName, csrf);
        }
        return request;
    }

    private static string ReadCookieValue(string setCookie)
    {
        var pair = setCookie.Split(';', 2)[0];
        return pair[(pair.IndexOf('=') + 1)..];
    }

    private static void AssertNoCorsHeaders(HttpResponseMessage response)
    {
        Assert.DoesNotContain(response.Headers, header =>
            header.Key.StartsWith("Access-Control-Allow-", StringComparison.OrdinalIgnoreCase));
    }
}
