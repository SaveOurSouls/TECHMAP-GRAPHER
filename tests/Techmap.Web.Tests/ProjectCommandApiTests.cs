using System.Net;
using System.Net.Http.Json;
using System.Text;
using Techmap.Contracts;
using Techmap.Web;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class ProjectCommandApiTests
{
    [Fact]
    public async Task Duplicate_command_replays_acknowledgment_despite_a_newer_project_revision()
    {
        await using var factory = new TechmapWebApplicationFactory();
        using var client = factory.CreateLocalClient();
        var csrf = await StartSessionAsync(client);
        var project = await CreateProjectAsync(client, csrf);
        var originalRequest = new AddHarnessRequest(Guid.NewGuid(), 0, "Жгут А");
        using var firstResponse = await SendAsync(
            client,
            HttpMethod.Post,
            $"/api/v1/projects/{project.ProjectId:D}/harnesses",
            originalRequest,
            csrf);
        var first = await ReadCommandAsync(firstResponse);
        Assert.Equal(HttpStatusCode.OK, firstResponse.StatusCode);

        using var secondResponse = await SendAsync(
            client,
            HttpMethod.Patch,
            $"/api/v1/projects/{project.ProjectId:D}",
            new UpdateProjectRequest(Guid.NewGuid(), 1, Name: "Новое имя"),
            csrf);
        var second = await ReadCommandAsync(secondResponse);
        Assert.Equal(2, second.ResultingRevision);

        using var replayResponse = await SendAsync(
            client,
            HttpMethod.Post,
            $"/api/v1/projects/{project.ProjectId:D}/harnesses",
            originalRequest,
            csrf);
        var replay = await ReadCommandAsync(replayResponse);

        Assert.Equal(HttpStatusCode.OK, replayResponse.StatusCode);
        Assert.Equal(first.CommandId, replay.CommandId);
        Assert.Equal(first.ExpectedRevision, replay.ExpectedRevision);
        Assert.Equal(first.ResultingRevision, replay.ResultingRevision);
        Assert.Equal(first.Project.Name, replay.Project.Name);
        Assert.Equal(first.Project.Revision, replay.Project.Revision);
        Assert.Equal(
            first.Project.Harnesses.Select(harness => harness.HarnessId),
            replay.Project.Harnesses.Select(harness => harness.HarnessId));

        var current = await client.GetFromJsonAsync<ProjectDetailsResponse>(
            $"/api/v1/projects/{project.ProjectId:D}",
            TestContext.Current.CancellationToken);
        Assert.Equal(2, Assert.IsType<ProjectDetailsResponse>(current).Revision);
        Assert.Equal("Новое имя", current.Name);
        var versions = await client.GetFromJsonAsync<ProjectVersionListResponse>(
            $"/api/v1/projects/{project.ProjectId:D}/versions",
            TestContext.Current.CancellationToken);
        Assert.Equal([1L, 2L], Assert.IsType<ProjectVersionListResponse>(versions).Versions
            .Select(version => version.Revision));
    }

    [Fact]
    public async Task Changed_payload_for_the_same_command_id_is_a_stable_conflict()
    {
        await using var factory = new TechmapWebApplicationFactory();
        using var client = factory.CreateLocalClient();
        var csrf = await StartSessionAsync(client);
        var project = await CreateProjectAsync(client, csrf);
        var commandId = Guid.NewGuid();

        using var accepted = await SendAsync(
            client,
            HttpMethod.Patch,
            $"/api/v1/projects/{project.ProjectId:D}",
            new UpdateProjectRequest(commandId, 0, Name: "Принятое имя"),
            csrf);
        Assert.Equal(HttpStatusCode.OK, accepted.StatusCode);

        using var changed = await SendAsync(
            client,
            HttpMethod.Patch,
            $"/api/v1/projects/{project.ProjectId:D}",
            new UpdateProjectRequest(commandId, 0, Name: "Другое имя"),
            csrf);
        var error = await changed.Content.ReadFromJsonAsync<ApiErrorResponse>(
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.Conflict, changed.StatusCode);
        Assert.Equal("command_id_reused", Assert.IsType<ApiErrorResponse>(error).Error);
        Assert.Equal(1, error.CurrentRevision);
    }

    [Fact]
    public async Task New_command_with_stale_revision_returns_current_revision()
    {
        await using var factory = new TechmapWebApplicationFactory();
        using var client = factory.CreateLocalClient();
        var csrf = await StartSessionAsync(client);
        var project = await CreateProjectAsync(client, csrf);

        using var accepted = await SendAsync(
            client,
            HttpMethod.Post,
            $"/api/v1/projects/{project.ProjectId:D}/harnesses",
            new AddHarnessRequest(Guid.NewGuid(), 0, "Жгут А"),
            csrf);
        Assert.Equal(HttpStatusCode.OK, accepted.StatusCode);

        using var stale = await SendAsync(
            client,
            HttpMethod.Post,
            $"/api/v1/projects/{project.ProjectId:D}/harnesses",
            new AddHarnessRequest(Guid.NewGuid(), 0, "Жгут Б"),
            csrf);
        var error = await stale.Content.ReadFromJsonAsync<ApiErrorResponse>(
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
        Assert.Equal("revision_conflict", Assert.IsType<ApiErrorResponse>(error).Error);
        Assert.Equal("expectedRevision", error.Field);
        Assert.Equal(1, error.CurrentRevision);
    }

    [Fact]
    public async Task Raw_json_property_order_does_not_change_the_command_payload_identity()
    {
        await using var factory = new TechmapWebApplicationFactory();
        using var client = factory.CreateLocalClient();
        var csrf = await StartSessionAsync(client);
        var project = await CreateProjectAsync(client, csrf);
        var commandId = Guid.NewGuid();
        var route = $"/api/v1/projects/{project.ProjectId:D}";
        var firstJson = $"{{\"commandId\":\"{commandId:D}\",\"expectedRevision\":0,\"name\":\"New name\",\"batchQuantity\":17}}";
        var secondJson = $"{{\"batchQuantity\":17,\"name\":\"New name\",\"expectedRevision\":0,\"commandId\":\"{commandId:D}\"}}";

        using var firstResponse = await SendRawAsync(client, HttpMethod.Patch, route, firstJson, csrf);
        var first = await ReadCommandAsync(firstResponse);
        using var replayResponse = await SendRawAsync(client, HttpMethod.Patch, route, secondJson, csrf);
        var replay = await ReadCommandAsync(replayResponse);

        Assert.Equal(HttpStatusCode.OK, replayResponse.StatusCode);
        Assert.Equal(first.CommandId, replay.CommandId);
        Assert.Equal(first.ResultingRevision, replay.ResultingRevision);
        Assert.Equal(1, replay.Project.Revision);
    }

    [Theory]
    [InlineData("PATCH", "/api/v1/projects/{0}", "{\"commandId\":\"{1}\",\"name\":\"Missing revision\"}")]
    [InlineData("POST", "/api/v1/projects/{0}/harnesses", "{\"commandId\":\"{1}\",\"designation\":\"Жгут\"}")]
    public async Task Baseline_project_does_not_accept_a_missing_expected_revision(
        string method,
        string routeTemplate,
        string jsonTemplate)
    {
        await using var factory = new TechmapWebApplicationFactory();
        using var client = factory.CreateLocalClient();
        var csrf = await StartSessionAsync(client);
        var project = await CreateProjectAsync(client, csrf);
        var commandId = Guid.NewGuid();
        var route = routeTemplate.Replace("{0}", project.ProjectId.ToString("D"), StringComparison.Ordinal);
        var json = jsonTemplate.Replace("{1}", commandId.ToString("D"), StringComparison.Ordinal);

        using var response = await SendRawAsync(client, new HttpMethod(method), route, json, csrf);
        var error = await response.Content.ReadFromJsonAsync<ApiErrorResponse>(
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("invalid_expected_revision", Assert.IsType<ApiErrorResponse>(error).Error);
        Assert.Equal(0, (await client.GetFromJsonAsync<ProjectDetailsResponse>(
            $"/api/v1/projects/{project.ProjectId:D}", TestContext.Current.CancellationToken))!.Revision);
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

    private static async Task<ProjectDetailsResponse> CreateProjectAsync(HttpClient client, string csrf)
    {
        using var response = await SendAsync(
            client,
            HttpMethod.Post,
            "/api/v1/projects",
            new CreateProjectRequest("ПР-КОМ-API", "Command API", 10, "draft"),
            csrf);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var project = await response.Content.ReadFromJsonAsync<ProjectDetailsResponse>(
            TestContext.Current.CancellationToken);
        Assert.Equal(0, Assert.IsType<ProjectDetailsResponse>(project).Revision);
        return project;
    }

    private static async Task<ProjectCommandResponse> ReadCommandAsync(HttpResponseMessage response) =>
        Assert.IsType<ProjectCommandResponse>(await response.Content.ReadFromJsonAsync<ProjectCommandResponse>(
            TestContext.Current.CancellationToken));

    private static async Task<HttpResponseMessage> SendAsync(
        HttpClient client,
        HttpMethod method,
        string path,
        object body,
        string csrf)
    {
        using var request = CreateRequest(method, path, csrf);
        request.Content = JsonContent.Create(body);
        return await client.SendAsync(request, TestContext.Current.CancellationToken);
    }

    private static async Task<HttpResponseMessage> SendRawAsync(
        HttpClient client,
        HttpMethod method,
        string path,
        string json,
        string csrf)
    {
        using var request = CreateRequest(method, path, csrf);
        request.Content = new StringContent(json, Encoding.UTF8, "application/json");
        return await client.SendAsync(request, TestContext.Current.CancellationToken);
    }

    private static HttpRequestMessage CreateRequest(HttpMethod method, string path, string csrf)
    {
        var request = new HttpRequestMessage(method, path);
        request.Headers.TryAddWithoutValidation("Origin", "http://127.0.0.1:18762");
        request.Headers.TryAddWithoutValidation(LocalHttpSession.CsrfHeaderName, csrf);
        return request;
    }
}
