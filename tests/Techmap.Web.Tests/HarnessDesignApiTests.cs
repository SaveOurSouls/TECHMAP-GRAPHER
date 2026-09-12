using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Techmap.Contracts;
using Techmap.Domain;
using Techmap.Infrastructure.Sqlite;
using Techmap.Web;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class HarnessDesignApiTests
{
    private const string Origin = "http://127.0.0.1:18762";

    [Fact]
    public async Task Empty_design_is_seeded_and_update_survives_server_restart()
    {
        var root = Path.Combine(Path.GetTempPath(), "techmap-design-api", Guid.NewGuid().ToString("N"));
        try
        {
            Guid projectId;
            Guid harnessId;
            await using (var factory = new TechmapWebApplicationFactory($"--data-root={root}"))
            {
                using var client = factory.CreateLocalClient();
                var csrf = await StartSessionAsync(client);
                (projectId, harnessId) = await CreateHarnessAsync(client, csrf);

                var initial = await client.GetFromJsonAsync<HarnessDesignResponse>(
                    Route(projectId, harnessId), TestContext.Current.CancellationToken);
                Assert.Equal(0, Assert.IsType<HarnessDesignResponse>(initial).Revision);
                Assert.Equal(1, initial.SchemaVersion);
                Assert.Equal(1, initial.Content.GetProperty("schemaVersion").GetInt32());
                Assert.Empty(initial.Content.GetProperty("connectors").EnumerateArray());
                Assert.Equal(3, initial.Content.GetProperty("views").GetProperty("e4")
                    .GetProperty("layers").GetArrayLength());

                using var content = JsonDocument.Parse(
                    """
                    {"schemaVersion":1,"connectors":[{"id":"XS1"}],"wires":[],"views":{"e4":{"layers":[]},"drawing":{"layers":[]}}}
                    """);
                using var savedResponse = await SendAsync(
                    client,
                    HttpMethod.Put,
                    Route(projectId, harnessId),
                    new PutHarnessDesignRequest(0, 1, content.RootElement.Clone()),
                    csrf);
                var saved = await savedResponse.Content.ReadFromJsonAsync<HarnessDesignResponse>(
                    TestContext.Current.CancellationToken);
                Assert.Equal(HttpStatusCode.OK, savedResponse.StatusCode);
                Assert.Equal(1, Assert.IsType<HarnessDesignResponse>(saved).Revision);
                Assert.Equal("XS1", saved.Content.GetProperty("connectors")[0].GetProperty("id").GetString());
            }

            using var reopenedStorage = SqliteStorage.Open(root);
            var reopened = new SqliteHarnessDesignDocumentStore(reopenedStorage, TimeProvider.System)
                .Get(new ProjectIdentity(projectId), new HarnessIdentity(harnessId));
            Assert.Equal(1, reopened.Revision);
            using var reopenedContent = JsonDocument.Parse(reopened.ContentJson);
            Assert.Equal("XS1", reopenedContent.RootElement.GetProperty("connectors")[0]
                .GetProperty("id").GetString());
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public async Task Put_rejects_stale_revision_invalid_content_and_wrong_harness_ownership()
    {
        await using var factory = new TechmapWebApplicationFactory();
        using var client = factory.CreateLocalClient();
        var csrf = await StartSessionAsync(client);
        var first = await CreateHarnessAsync(client, csrf);
        var second = await CreateHarnessAsync(client, csrf, "ПР-ДИЗ-2");
        using var valid = JsonDocument.Parse(
            "{\"schemaVersion\":1,\"connectors\":[],\"wires\":[],\"views\":{\"e4\":{\"layers\":[]},\"drawing\":{\"layers\":[]}}}");

        using (var accepted = await SendAsync(
                   client, HttpMethod.Put, Route(first.ProjectId, first.HarnessId),
                   new PutHarnessDesignRequest(0, 1, valid.RootElement.Clone()), csrf))
        {
            Assert.Equal(HttpStatusCode.OK, accepted.StatusCode);
        }

        using (var stale = await SendAsync(
                   client, HttpMethod.Put, Route(first.ProjectId, first.HarnessId),
                   new PutHarnessDesignRequest(0, 1, valid.RootElement.Clone()), csrf))
        {
            var error = await stale.Content.ReadFromJsonAsync<ApiErrorResponse>(TestContext.Current.CancellationToken);
            Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
            Assert.Equal("design_revision_conflict", Assert.IsType<ApiErrorResponse>(error).Error);
            Assert.Equal(1, error.CurrentRevision);
        }

        using var mismatched = JsonDocument.Parse("{\"schemaVersion\":2}");
        using (var invalid = await SendAsync(
                   client, HttpMethod.Put, Route(first.ProjectId, first.HarnessId),
                   new PutHarnessDesignRequest(1, 1, mismatched.RootElement.Clone()), csrf))
        {
            var error = await invalid.Content.ReadFromJsonAsync<ApiErrorResponse>(TestContext.Current.CancellationToken);
            Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
            Assert.Equal("invalid_design_content", Assert.IsType<ApiErrorResponse>(error).Error);
        }

        using var wrongOwner = await client.GetAsync(
            Route(second.ProjectId, first.HarnessId), TestContext.Current.CancellationToken);
        var ownershipError = await wrongOwner.Content.ReadFromJsonAsync<ApiErrorResponse>(
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.NotFound, wrongOwner.StatusCode);
        Assert.Equal("harness_not_found", Assert.IsType<ApiErrorResponse>(ownershipError).Error);
    }

    [Fact]
    public async Task Design_endpoints_require_session_csrf_json_and_enforce_size_limit()
    {
        await using var factory = new TechmapWebApplicationFactory();
        using var sessionClient = factory.CreateLocalClient();
        var csrf = await StartSessionAsync(sessionClient);
        var ids = await CreateHarnessAsync(sessionClient, csrf);
        using var anonymousClient = factory.CreateLocalClient();

        using var anonymousGet = await anonymousClient.GetAsync(
            Route(ids.ProjectId, ids.HarnessId), TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Unauthorized, anonymousGet.StatusCode);

        using var noCsrf = new HttpRequestMessage(HttpMethod.Put, Route(ids.ProjectId, ids.HarnessId))
        {
            Content = new StringContent(
                "{\"expectedRevision\":0,\"schemaVersion\":1,\"content\":{\"schemaVersion\":1}}",
                Encoding.UTF8,
                "application/json"),
        };
        noCsrf.Headers.TryAddWithoutValidation("Origin", Origin);
        using var noCsrfResponse = await sessionClient.SendAsync(noCsrf, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Forbidden, noCsrfResponse.StatusCode);

        var huge = "x".PadLeft(1_048_577, 'x');
        using var hugeContent = JsonDocument.Parse($"{{\"schemaVersion\":1,\"value\":\"{huge}\"}}");
        using var tooLarge = await SendAsync(
            sessionClient, HttpMethod.Put, Route(ids.ProjectId, ids.HarnessId),
            new PutHarnessDesignRequest(0, 1, hugeContent.RootElement.Clone()), csrf);
        var error = await tooLarge.Content.ReadFromJsonAsync<ApiErrorResponse>(TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, tooLarge.StatusCode);
        Assert.Equal("design_content_too_large", Assert.IsType<ApiErrorResponse>(error).Error);
    }

    private static async Task<string> StartSessionAsync(HttpClient client)
    {
        using var page = await client.GetAsync("/", TestContext.Current.CancellationToken);
        page.EnsureSuccessStatusCode();
        var session = await client.GetFromJsonAsync<SessionBootstrapResponse>(
            "/api/v1/session", TestContext.Current.CancellationToken);
        return Assert.IsType<SessionBootstrapResponse>(session).CsrfNonce;
    }

    private static async Task<(Guid ProjectId, Guid HarnessId)> CreateHarnessAsync(
        HttpClient client,
        string csrf,
        string designation = "ПР-ДИЗ")
    {
        using var create = await SendAsync(
            client, HttpMethod.Post, "/api/v1/projects",
            new CreateProjectRequest(designation, "Design API", null, "draft"), csrf);
        var project = await create.Content.ReadFromJsonAsync<ProjectDetailsResponse>(
            TestContext.Current.CancellationToken);
        using var add = await SendAsync(
            client, HttpMethod.Post, $"/api/v1/projects/{project!.ProjectId:D}/harnesses",
            new AddHarnessRequest(Guid.NewGuid(), 0, "Жгут", 1), csrf);
        var result = await add.Content.ReadFromJsonAsync<ProjectCommandResponse>(
            TestContext.Current.CancellationToken);
        return (project.ProjectId, Assert.Single(result!.Project.Harnesses).HarnessId);
    }

    private static async Task<HttpResponseMessage> SendAsync(
        HttpClient client,
        HttpMethod method,
        string path,
        object body,
        string csrf)
    {
        using var request = new HttpRequestMessage(method, path) { Content = JsonContent.Create(body) };
        request.Headers.TryAddWithoutValidation("Origin", Origin);
        request.Headers.TryAddWithoutValidation(LocalHttpSession.CsrfHeaderName, csrf);
        return await client.SendAsync(request, TestContext.Current.CancellationToken);
    }

    private static string Route(Guid projectId, Guid harnessId) =>
        $"/api/v1/projects/{projectId:D}/harnesses/{harnessId:D}/design";
}
