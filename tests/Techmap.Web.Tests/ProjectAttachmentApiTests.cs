using System.Net;
using System.Net.Http.Json;
using System.Text;
using Techmap.Contracts;
using Techmap.Web;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class ProjectAttachmentApiTests
{
    private const string Origin = "http://127.0.0.1:18762";

    [Fact]
    public void Configured_request_limit_can_carry_the_advertised_base64_attachment()
    {
        var encodedLength = ((ProjectDataEndpoints.MaximumAttachmentBytes + 2L) / 3L) * 4L;
        Assert.True(ProjectDataEndpoints.MaximumAttachmentRequestBytes > encodedLength + 4096);
    }

    [Fact]
    public async Task Attachment_api_creates_lists_validates_and_reads_content()
    {
        await using var fixture = new ApiFixture();
        using var client = fixture.Factory.CreateLocalClient();
        var csrf = await StartSessionAsync(client);
        var project = await CreateProjectAsync(client, csrf);
        var bytes = Encoding.UTF8.GetBytes("фото этапа");

        var (createResponse, attachment) = await SendAsync<ProjectAttachmentResponse>(
            client,
            HttpMethod.Post,
            $"/api/v1/projects/{project.ProjectId:D}/attachments",
            new CreateAttachmentRequest(
                "этап.txt",
                "text/plain",
                "route-photo",
                Convert.ToBase64String(bytes)),
            csrf);
        using (createResponse)
        {
            Assert.Equal(HttpStatusCode.Created, createResponse.StatusCode);
            Assert.Equal(
                $"/api/v1/projects/{project.ProjectId:D}/attachments/{attachment.AttachmentId:D}",
                createResponse.Headers.Location?.OriginalString);
        }

        using var listResponse = await client.GetAsync(
            $"/api/v1/projects/{project.ProjectId:D}/attachments",
            TestContext.Current.CancellationToken);
        var list = await listResponse.Content.ReadFromJsonAsync<ProjectAttachmentListResponse>(
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, listResponse.StatusCode);
        Assert.Equal(attachment, Assert.Single(Assert.IsType<ProjectAttachmentListResponse>(list).Attachments));

        var (validationResponse, validation) = await SendAsync<AttachmentValidationResponse>(
            client,
            HttpMethod.Post,
            $"/api/v1/projects/{project.ProjectId:D}/attachments/" +
            $"{attachment.AttachmentId:D}/validations",
            new { },
            csrf);
        using (validationResponse)
        {
            Assert.Equal(HttpStatusCode.OK, validationResponse.StatusCode);
            Assert.Equal("valid", validation.Status);
        }

        using var contentResponse = await client.GetAsync(
            $"/api/v1/projects/{project.ProjectId:D}/attachments/" +
            $"{attachment.AttachmentId:D}/content",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, contentResponse.StatusCode);
        Assert.Equal("text/plain", contentResponse.Content.Headers.ContentType?.MediaType);
        Assert.Equal(bytes, await contentResponse.Content.ReadAsByteArrayAsync(
            TestContext.Current.CancellationToken));
    }

    [Fact]
    public async Task Attachment_mutation_keeps_json_session_origin_and_csrf_protection()
    {
        await using var fixture = new ApiFixture();
        using var client = fixture.Factory.CreateLocalClient();
        var csrf = await StartSessionAsync(client);
        var project = await CreateProjectAsync(client, csrf);
        var path = $"/api/v1/projects/{project.ProjectId:D}/attachments";
        var body = new CreateAttachmentRequest(
            "a.txt", "text/plain", "note", Convert.ToBase64String([1, 2, 3]));

        using var missingCsrf = await client.PostAsJsonAsync(
            path,
            body,
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Forbidden, missingCsrf.StatusCode);

        using var wrongOriginRequest = new HttpRequestMessage(HttpMethod.Post, path)
        {
            Content = JsonContent.Create(body),
        };
        wrongOriginRequest.Headers.TryAddWithoutValidation("Origin", "http://localhost:18762");
        wrongOriginRequest.Headers.TryAddWithoutValidation(LocalHttpSession.CsrfHeaderName, csrf);
        using var wrongOrigin = await client.SendAsync(
            wrongOriginRequest,
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Forbidden, wrongOrigin.StatusCode);

        using var wrongTypeRequest = new HttpRequestMessage(HttpMethod.Post, path)
        {
            Content = new StringContent("{}", Encoding.UTF8, "text/plain"),
        };
        wrongTypeRequest.Headers.TryAddWithoutValidation("Origin", Origin);
        wrongTypeRequest.Headers.TryAddWithoutValidation(LocalHttpSession.CsrfHeaderName, csrf);
        using var wrongType = await client.SendAsync(
            wrongTypeRequest,
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.UnsupportedMediaType, wrongType.StatusCode);
    }

    [Fact]
    public async Task Missing_or_invalid_content_returns_stable_error_without_a_reference()
    {
        await using var fixture = new ApiFixture();
        using var client = fixture.Factory.CreateLocalClient();
        var csrf = await StartSessionAsync(client);
        var project = await CreateProjectAsync(client, csrf);
        var path = $"/api/v1/projects/{project.ProjectId:D}/attachments";

        var (response, error) = await SendAsync<ApiErrorResponse>(
            client,
            HttpMethod.Post,
            path,
            new CreateAttachmentRequest("a.txt", "text/plain", "note", "%%%"),
            csrf);
        using (response)
        {
            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
            Assert.Equal("invalid_attachment_content", error.Error);
            Assert.Equal("contentBase64", error.Field);
        }

        var list = await client.GetFromJsonAsync<ProjectAttachmentListResponse>(
            path,
            TestContext.Current.CancellationToken);
        Assert.Empty(Assert.IsType<ProjectAttachmentListResponse>(list).Attachments);
    }

    [Fact]
    public async Task Attachment_location_respects_path_base()
    {
        await using var fixture = new ApiFixture("--path-base=/techmap");
        using var client = fixture.Factory.CreateLocalClient();
        var csrf = await StartSessionAsync(client, "/techmap");
        var project = await CreateProjectAsync(client, csrf, "/techmap");

        var (response, attachment) = await SendAsync<ProjectAttachmentResponse>(
            client,
            HttpMethod.Post,
            $"/techmap/api/v1/projects/{project.ProjectId:D}/attachments",
            new CreateAttachmentRequest("a.bin", "application/octet-stream", "source", "AA=="),
            csrf);
        using (response)
        {
            Assert.Equal(
                $"/techmap/api/v1/projects/{project.ProjectId:D}/attachments/" +
                $"{attachment.AttachmentId:D}",
                response.Headers.Location?.OriginalString);
        }
    }

    private static async Task<string> StartSessionAsync(HttpClient client, string pathBase = "")
    {
        using var page = await client.GetAsync($"{pathBase}/", TestContext.Current.CancellationToken);
        page.EnsureSuccessStatusCode();
        var session = await client.GetFromJsonAsync<SessionBootstrapResponse>(
            $"{pathBase}/api/v1/session",
            TestContext.Current.CancellationToken);
        return Assert.IsType<SessionBootstrapResponse>(session).CsrfNonce;
    }

    private static async Task<ProjectDetailsResponse> CreateProjectAsync(
        HttpClient client,
        string csrf,
        string pathBase = "")
    {
        var (_, project) = await SendAsync<ProjectDetailsResponse>(
            client,
            HttpMethod.Post,
            $"{pathBase}/api/v1/projects",
            new CreateProjectRequest("ПР-ATT", "Вложения", 1, null),
            csrf);
        return project;
    }

    private static async Task<(HttpResponseMessage Response, T Body)> SendAsync<T>(
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
        request.Headers.TryAddWithoutValidation("Origin", Origin);
        request.Headers.TryAddWithoutValidation(LocalHttpSession.CsrfHeaderName, csrf);
        var response = await client.SendAsync(request, TestContext.Current.CancellationToken);
        var result = await response.Content.ReadFromJsonAsync<T>(TestContext.Current.CancellationToken);
        return (response, Assert.IsType<T>(result));
    }

    private sealed class ApiFixture : IAsyncDisposable
    {
        private readonly string root = Path.Combine(
            Path.GetTempPath(),
            "techmap-attachment-api-tests",
            Guid.NewGuid().ToString("N"));

        public ApiFixture(params string[] extraArguments)
        {
            Directory.CreateDirectory(root);
            Factory = new TechmapWebApplicationFactory(
                [$"--data-root={Path.Combine(root, "data")}", .. extraArguments]);
        }

        public TechmapWebApplicationFactory Factory { get; }

        public async ValueTask DisposeAsync()
        {
            await Factory.DisposeAsync();
            if (Directory.Exists(root))
            {
                Directory.Delete(root, recursive: true);
            }
        }
    }
}
