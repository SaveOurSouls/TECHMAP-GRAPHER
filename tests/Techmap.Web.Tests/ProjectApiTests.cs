using System.Net;
using System.Net.Http.Json;
using Techmap.Contracts;
using Techmap.Web;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class ProjectApiTests
{
    private const string CanonicalOrigin = "http://127.0.0.1:18762";

    [Fact]
    public async Task Project_api_supports_create_update_copy_harnesses_and_list()
    {
        await using var factory = new TechmapWebApplicationFactory();
        using var client = factory.CreateLocalClient();
        var csrf = await StartSessionAsync(client);
        var cancellationToken = TestContext.Current.CancellationToken;

        using var emptyResponse = await client.GetAsync("/api/v1/projects", cancellationToken);
        var empty = await emptyResponse.Content.ReadFromJsonAsync<ProjectListResponse>(cancellationToken);
        Assert.Equal(HttpStatusCode.OK, emptyResponse.StatusCode);
        Assert.Empty(Assert.IsType<ProjectListResponse>(empty).Projects);

        var (createResponse, created) = await SendProjectCommandAsync<ProjectDetailsResponse>(
            client,
            HttpMethod.Post,
            "/api/v1/projects",
            new CreateProjectRequest("ПР-HTTP", "Проект через API", null, "draft"),
            csrf);
        using (createResponse)
        {
            Assert.Equal(HttpStatusCode.Created, createResponse.StatusCode);
            Assert.Equal($"/api/v1/projects/{created.ProjectId:D}", createResponse.Headers.Location?.OriginalString);
            Assert.Equal(1, created.BatchQuantity);
        }

        var firstCommandId = Guid.NewGuid();
        var (_, firstHarnessCommand) = await SendProjectCommandAsync<ProjectCommandResponse>(
            client,
            HttpMethod.Post,
            $"/api/v1/projects/{created.ProjectId:D}/harnesses",
            new AddHarnessRequest(firstCommandId, 0, "Жгут А", 5),
            csrf);
        Assert.Equal(firstCommandId, firstHarnessCommand.CommandId);
        Assert.Equal(1, firstHarnessCommand.ResultingRevision);
        var firstHarness = Assert.Single(firstHarnessCommand.Project.Harnesses);
        Assert.Equal(5, firstHarness.Quantity);
        Assert.Equal(["e4", "drawing", "route"], firstHarness.Documents.Select(document => document.Kind));
        Assert.All(firstHarness.Documents, document => Assert.Equal("empty", document.Status));
        var (_, secondHarnessCommand) = await SendProjectCommandAsync<ProjectCommandResponse>(
            client,
            HttpMethod.Post,
            $"/api/v1/projects/{created.ProjectId:D}/harnesses",
            new AddHarnessRequest(Guid.NewGuid(), 1, "Жгут Б", 7),
            csrf);
        var withTwoHarnesses = secondHarnessCommand.Project;
        Assert.Equal(2, secondHarnessCommand.ResultingRevision);
        Assert.Equal([0, 1], withTwoHarnesses.Harnesses.Select(harness => harness.SortOrder));
        Assert.Equal([5L, 7L], withTwoHarnesses.Harnesses.Select(harness => harness.Quantity));

        var (_, quantityCommand) = await SendProjectCommandAsync<ProjectCommandResponse>(
            client,
            HttpMethod.Patch,
            $"/api/v1/projects/{created.ProjectId:D}/harnesses/{firstHarness.HarnessId:D}",
            new UpdateHarnessQuantityRequest(Guid.NewGuid(), 2, 11),
            csrf);
        Assert.Equal([11L, 7L], quantityCommand.Project.Harnesses.Select(harness => harness.Quantity));

        var (_, updateCommand) = await SendProjectCommandAsync<ProjectCommandResponse>(
            client,
            HttpMethod.Patch,
            $"/api/v1/projects/{created.ProjectId:D}",
            new UpdateProjectRequest(
                Guid.NewGuid(),
                3,
                Name: "Проект обновлён",
                Status: "completed"),
            csrf);
        var updated = updateCommand.Project;
        Assert.Equal(4, updateCommand.ResultingRevision);
        Assert.Equal("Проект обновлён", updated.Name);
        Assert.Equal(1, updated.BatchQuantity);
        Assert.Equal("completed", updated.Status);

        var (copyResponse, copy) = await SendProjectCommandAsync<ProjectDetailsResponse>(
            client,
            HttpMethod.Post,
            $"/api/v1/projects/{created.ProjectId:D}/copies",
            new { },
            csrf);
        using (copyResponse)
        {
            Assert.Equal(HttpStatusCode.Created, copyResponse.StatusCode);
            Assert.NotEqual(created.ProjectId, copy.ProjectId);
            Assert.Equal("active", copy.Status);
            Assert.Equal(2, copy.Harnesses.Count);
            Assert.Empty(copy.Harnesses.Select(harness => harness.HarnessId)
                .Intersect(withTwoHarnesses.Harnesses.Select(harness => harness.HarnessId)));
        }

        var (_, deleteCommand) = await SendProjectCommandAsync<ProjectCommandResponse>(
            client,
            HttpMethod.Delete,
            $"/api/v1/projects/{created.ProjectId:D}/harnesses/{firstHarness.HarnessId:D}",
            new DeleteHarnessRequest(Guid.NewGuid(), 4),
            csrf);
        var afterDelete = deleteCommand.Project;
        Assert.Equal(5, deleteCommand.ResultingRevision);
        var remaining = Assert.Single(afterDelete.Harnesses);
        Assert.Equal("Жгут Б", remaining.Designation);
        Assert.Equal(1, remaining.SortOrder);

        using var listResponse = await client.GetAsync("/api/v1/projects", cancellationToken);
        var list = await listResponse.Content.ReadFromJsonAsync<ProjectListResponse>(cancellationToken);
        Assert.Equal(HttpStatusCode.OK, listResponse.StatusCode);
        Assert.Equal(2, Assert.IsType<ProjectListResponse>(list).Projects.Count);
        Assert.Equal(
            [copy.ProjectId, created.ProjectId],
            list.Projects.Select(project => project.ProjectId));
        Assert.Equal([2, 1], list.Projects.Select(project => project.HarnessCount));

        using var getResponse = await client.GetAsync(
            $"/api/v1/projects/{created.ProjectId:D}",
            cancellationToken);
        var loaded = await getResponse.Content.ReadFromJsonAsync<ProjectDetailsResponse>(cancellationToken);
        Assert.Equal(HttpStatusCode.OK, getResponse.StatusCode);
        AssertProjectResponseEqual(afterDelete, Assert.IsType<ProjectDetailsResponse>(loaded));
    }

    [Theory]
    [MemberData(nameof(InvalidCreateRequests))]
    public async Task Create_rejects_invalid_fields(CreateProjectRequest request, string expectedError)
    {
        await using var factory = new TechmapWebApplicationFactory();
        using var client = factory.CreateLocalClient();
        var csrf = await StartSessionAsync(client);

        using var response = await SendCommandAsync(
            client,
            HttpMethod.Post,
            "/api/v1/projects",
            request,
            csrf);
        var error = await response.Content.ReadFromJsonAsync<ApiErrorResponse>(
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(expectedError, Assert.IsType<ApiErrorResponse>(error).Error);

        var projects = await client.GetFromJsonAsync<ProjectListResponse>(
            "/api/v1/projects",
            TestContext.Current.CancellationToken);
        Assert.Empty(Assert.IsType<ProjectListResponse>(projects).Projects);
    }

    [Fact]
    public async Task Missing_and_malformed_project_ids_have_stable_json_errors()
    {
        await using var factory = new TechmapWebApplicationFactory();
        using var client = factory.CreateLocalClient();
        await StartSessionAsync(client);
        var cancellationToken = TestContext.Current.CancellationToken;

        using var missing = await client.GetAsync(
            $"/api/v1/projects/{Guid.NewGuid():D}",
            cancellationToken);
        var missingError = await missing.Content.ReadFromJsonAsync<ApiErrorResponse>(cancellationToken);
        using var malformed = await client.GetAsync("/api/v1/projects/not-a-guid", cancellationToken);
        var malformedError = await malformed.Content.ReadFromJsonAsync<ApiErrorResponse>(cancellationToken);

        Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);
        Assert.Equal("project_not_found", Assert.IsType<ApiErrorResponse>(missingError).Error);
        Assert.Equal(HttpStatusCode.NotFound, malformed.StatusCode);
        Assert.Equal("api_route_not_found", Assert.IsType<ApiErrorResponse>(malformedError).Error);
    }

    [Fact]
    public async Task Obsolete_project_quantity_is_rejected_without_creating_or_revising_a_project()
    {
        await using var factory = new TechmapWebApplicationFactory();
        using var client = factory.CreateLocalClient();
        var csrf = await StartSessionAsync(client);

        using var create = await SendCommandAsync(
            client,
            HttpMethod.Post,
            "/api/v1/projects",
            new CreateProjectRequest("ПР-OLD", "Старый клиент", 12, "draft"),
            csrf);
        var createError = await create.Content.ReadFromJsonAsync<ApiErrorResponse>(
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, create.StatusCode);
        Assert.Equal("project_quantity_obsolete", createError?.Error);

        var project = (await SendProjectCommandAsync<ProjectDetailsResponse>(
            client,
            HttpMethod.Post,
            "/api/v1/projects",
            new CreateProjectRequest("ПР-NEW", "Новый клиент", null, "draft"),
            csrf)).Body;
        using var update = await SendCommandAsync(
            client,
            HttpMethod.Patch,
            $"/api/v1/projects/{project.ProjectId:D}",
            new UpdateProjectRequest(Guid.NewGuid(), 0, BatchQuantity: 12),
            csrf);
        var updateError = await update.Content.ReadFromJsonAsync<ApiErrorResponse>(
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, update.StatusCode);
        Assert.Equal("project_quantity_obsolete", updateError?.Error);
        var unchanged = await client.GetFromJsonAsync<ProjectDetailsResponse>(
            $"/api/v1/projects/{project.ProjectId:D}", TestContext.Current.CancellationToken);
        Assert.Equal(0, unchanged?.Revision);
        Assert.Equal(1, unchanged?.BatchQuantity);
    }

    [Theory]
    [InlineData("/api/v1/projects")]
    [InlineData("/api/v1/projects/ef9b26e0-daa6-4f2e-9cee-cb7bb95fb0dc")]
    public async Task Project_reads_require_the_local_session_cookie(string path)
    {
        await using var factory = new TechmapWebApplicationFactory();
        using var client = factory.CreateLocalClient();

        using var response = await client.GetAsync(path, TestContext.Current.CancellationToken);
        var error = await response.Content.ReadFromJsonAsync<ApiErrorResponse>(
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal("invalid_session", Assert.IsType<ApiErrorResponse>(error).Error);
    }

    [Fact]
    public async Task Project_mutations_require_the_local_session_cookie()
    {
        await using var factory = new TechmapWebApplicationFactory();
        using var client = factory.CreateLocalClient();
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/projects")
        {
            Content = JsonContent.Create(new CreateProjectRequest("ПР", "Проект", null, null)),
        };
        request.Headers.TryAddWithoutValidation("Origin", CanonicalOrigin);
        request.Headers.TryAddWithoutValidation(LocalHttpSession.CsrfHeaderName, "missing-session");

        using var response = await client.SendAsync(request, TestContext.Current.CancellationToken);
        var error = await response.Content.ReadFromJsonAsync<ApiErrorResponse>(
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal("invalid_session", Assert.IsType<ApiErrorResponse>(error).Error);
    }

    [Fact]
    public async Task Prefixed_project_location_and_reads_include_the_path_base()
    {
        await using var factory = new TechmapWebApplicationFactory("--path-base=/techmap");
        using var client = factory.CreateLocalClient();
        var csrf = await StartSessionAsync(client, "/techmap");

        var (response, created) = await SendProjectCommandAsync<ProjectDetailsResponse>(
            client,
            HttpMethod.Post,
            "/techmap/api/v1/projects",
            new CreateProjectRequest("ПР-PREFIX", "Префикс", null, null),
            csrf);
        using (response)
        {
            Assert.Equal(
                $"/techmap/api/v1/projects/{created.ProjectId:D}",
                response.Headers.Location?.OriginalString);
        }

        using var get = await client.GetAsync(
            $"/techmap/api/v1/projects/{created.ProjectId:D}",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, get.StatusCode);
    }

    public static TheoryData<CreateProjectRequest, string> InvalidCreateRequests => new()
    {
        { new CreateProjectRequest(null, "Имя", null, null), "invalid_designation" },
        { new CreateProjectRequest("   ", "Имя", null, null), "invalid_designation" },
        {
            new CreateProjectRequest(
                new string('D', Techmap.Domain.ProjectRules.MaximumDesignationLength + 1),
                "Имя",
                null,
                null),
            "invalid_designation"
        },
        { new CreateProjectRequest("ПР", null, null, null), "invalid_name" },
        { new CreateProjectRequest("ПР", "Имя", null, "archived"), "invalid_status" },
    };

    private static async Task<string> StartSessionAsync(HttpClient client, string pathBase = "")
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        using var page = await client.GetAsync($"{pathBase}/", cancellationToken);
        page.EnsureSuccessStatusCode();
        var session = await client.GetFromJsonAsync<SessionBootstrapResponse>(
            $"{pathBase}/api/v1/session",
            cancellationToken);
        return Assert.IsType<SessionBootstrapResponse>(session).CsrfNonce;
    }

    private static async Task<(HttpResponseMessage Response, T Body)> SendProjectCommandAsync<T>(
        HttpClient client,
        HttpMethod method,
        string path,
        object body,
        string csrf)
    {
        var response = await SendCommandAsync(client, method, path, body, csrf);
        var content = await response.Content.ReadFromJsonAsync<T>(TestContext.Current.CancellationToken);
        return (response, Assert.IsType<T>(content));
    }

    private static async Task<HttpResponseMessage> SendCommandAsync(
        HttpClient client,
        HttpMethod method,
        string path,
        object body,
        string csrf)
    {
        using var request = new HttpRequestMessage(method, path)
        {
            Content = JsonContent.Create(body),
        };
        request.Headers.TryAddWithoutValidation("Origin", CanonicalOrigin);
        request.Headers.TryAddWithoutValidation(LocalHttpSession.CsrfHeaderName, csrf);
        return await client.SendAsync(request, TestContext.Current.CancellationToken);
    }

    private static void AssertProjectResponseEqual(
        ProjectDetailsResponse expected,
        ProjectDetailsResponse actual)
    {
        Assert.Equal(expected.ProjectId, actual.ProjectId);
        Assert.Equal(expected.Designation, actual.Designation);
        Assert.Equal(expected.Increment, actual.Increment);
        Assert.Equal(expected.Name, actual.Name);
        Assert.Equal(expected.BatchQuantity, actual.BatchQuantity);
        Assert.Equal(expected.Status, actual.Status);
        Assert.Equal(expected.CreatedUtc, actual.CreatedUtc);
        Assert.Equal(expected.UpdatedUtc, actual.UpdatedUtc);
        Assert.Equal(
            expected.Harnesses.Select(harness => new
            {
                harness.HarnessId,
                harness.Designation,
                harness.SortOrder,
                harness.CreatedUtc,
                harness.UpdatedUtc,
            }),
            actual.Harnesses.Select(harness => new
            {
                harness.HarnessId,
                harness.Designation,
                harness.SortOrder,
                harness.CreatedUtc,
                harness.UpdatedUtc,
            }));
    }
}
