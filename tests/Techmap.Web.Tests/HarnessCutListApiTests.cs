using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Techmap.Contracts;
using Techmap.Web;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class HarnessCutListApiTests
{
    private const string Origin = "http://127.0.0.1:18762";

    [Fact]
    public async Task Cut_list_uses_exact_decimal_lengths_defaults_and_harness_quantity()
    {
        await using var factory = new TechmapWebApplicationFactory();
        using var client = factory.CreateLocalClient();
        var csrf = await StartSessionAsync(client);
        var ids = await CreateHarnessAsync(client, csrf, quantity: 3);
        using var content = JsonDocument.Parse(
            """
            {
              "schemaVersion": 1,
              "connectors": [],
              "wires": [
                {
                  "id": "W-1",
                  "circuit": "DATA+",
                  "lengthMm": 20.001,
                  "endCorrectionFromMm": -0.001,
                  "endCorrectionToMm": 0.002,
                  "cutRoundingStepMm": 0.005
                },
                {
                  "id": "W-2",
                  "circuit": "SPARE",
                  "lengthMm": null
                }
              ],
              "views": {"e4":{"layers":[]},"drawing":{"layers":[]}}
            }
            """);
        using (var save = await SendAsync(
                   client, HttpMethod.Put, DesignRoute(ids.ProjectId, ids.HarnessId),
                   new PutHarnessDesignRequest(0, 1, content.RootElement.Clone()), csrf))
        {
            Assert.Equal(HttpStatusCode.OK, save.StatusCode);
        }

        using var response = await client.GetAsync(
            CutListRoute(ids.ProjectId, ids.HarnessId), TestContext.Current.CancellationToken);
        var rawJson = await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken);
        var result = JsonSerializer.Deserialize<HarnessCutListResponse>(
            rawJson,
            new JsonSerializerOptions(JsonSerializerDefaults.Web));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("\"sourceLengthMm\":20.001", rawJson, StringComparison.Ordinal);
        Assert.Contains("\"roundingStepMm\":0.005", rawJson, StringComparison.Ordinal);
        Assert.Equal(ids.ProjectId, Assert.IsType<HarnessCutListResponse>(result).ProjectId);
        Assert.Equal(ids.HarnessId, result.HarnessId);
        Assert.Equal(3, result.HarnessQuantity);
        Assert.Equal("limited", result.Status);
        Assert.Contains("не закреплён", result.Warning, StringComparison.OrdinalIgnoreCase);

        var ready = result.Items[0];
        Assert.Equal("W-1", ready.WireId);
        Assert.Equal("DATA+", ready.Circuit);
        Assert.Equal("not-pinned", ready.Material);
        Assert.Equal(20.001m, ready.SourceLengthMm);
        Assert.Equal(-0.001m, ready.EndCorrectionFromMm);
        Assert.Equal(0.002m, ready.EndCorrectionToMm);
        Assert.Equal(0.005m, ready.RoundingStepMm);
        Assert.Equal(20.005m, ready.CutLengthMm);
        Assert.Equal(3, ready.Pieces);
        Assert.Equal(0.060015m, ready.TotalMetres);
        Assert.Equal("ready", ready.Status);

        var incomplete = result.Items[1];
        Assert.Equal("W-2", incomplete.WireId);
        Assert.Null(incomplete.SourceLengthMm);
        Assert.Equal(0m, incomplete.EndCorrectionFromMm);
        Assert.Equal(0m, incomplete.EndCorrectionToMm);
        Assert.Equal(1m, incomplete.RoundingStepMm);
        Assert.Null(incomplete.CutLengthMm);
        Assert.Equal(3, incomplete.Pieces);
        Assert.Null(incomplete.TotalMetres);
        Assert.Equal("incomplete", incomplete.Status);
    }

    [Fact]
    public async Task Cut_list_requires_session_and_rejects_a_harness_from_another_project()
    {
        await using var factory = new TechmapWebApplicationFactory();
        using var client = factory.CreateLocalClient();
        var csrf = await StartSessionAsync(client);
        var first = await CreateHarnessAsync(client, csrf, "CUT-1", 1);
        var second = await CreateHarnessAsync(client, csrf, "CUT-2", 1);

        using var wrongOwner = await client.GetAsync(
            CutListRoute(second.ProjectId, first.HarnessId), TestContext.Current.CancellationToken);
        var error = await wrongOwner.Content.ReadFromJsonAsync<ApiErrorResponse>(
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.NotFound, wrongOwner.StatusCode);
        Assert.Equal("harness_not_found", Assert.IsType<ApiErrorResponse>(error).Error);

        using var anonymous = factory.CreateLocalClient();
        using var anonymousResponse = await anonymous.GetAsync(
            CutListRoute(first.ProjectId, first.HarnessId), TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Unauthorized, anonymousResponse.StatusCode);
    }

    [Fact]
    public async Task Cut_list_rejects_invalid_precision_instead_of_rounding_input_silently()
    {
        await using var factory = new TechmapWebApplicationFactory();
        using var client = factory.CreateLocalClient();
        var csrf = await StartSessionAsync(client);
        var ids = await CreateHarnessAsync(client, csrf, quantity: 1);
        using var content = JsonDocument.Parse(
            """
            {"schemaVersion":1,"connectors":[],"wires":[{"id":"W-1","circuit":"","lengthMm":1.0001}],"views":{"e4":{"layers":[]},"drawing":{"layers":[]}}}
            """);
        using (var save = await SendAsync(
                   client, HttpMethod.Put, DesignRoute(ids.ProjectId, ids.HarnessId),
                   new PutHarnessDesignRequest(0, 1, content.RootElement.Clone()), csrf))
        {
            Assert.Equal(HttpStatusCode.OK, save.StatusCode);
        }

        using var response = await client.GetAsync(
            CutListRoute(ids.ProjectId, ids.HarnessId), TestContext.Current.CancellationToken);
        var error = await response.Content.ReadFromJsonAsync<ApiErrorResponse>(TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("invalid_cut_list_design", Assert.IsType<ApiErrorResponse>(error).Error);
        Assert.Equal("content.wires[0].lengthMm", error.Field);
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
        string designation = "CUT",
        long quantity = 1)
    {
        using var create = await SendAsync(
            client, HttpMethod.Post, "/api/v1/projects",
            new CreateProjectRequest(designation, "Cut list", null, "draft"), csrf);
        var project = await create.Content.ReadFromJsonAsync<ProjectDetailsResponse>(
            TestContext.Current.CancellationToken);
        using var add = await SendAsync(
            client, HttpMethod.Post, $"/api/v1/projects/{project!.ProjectId:D}/harnesses",
            new AddHarnessRequest(Guid.NewGuid(), 0, "Жгут", quantity), csrf);
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

    private static string DesignRoute(Guid projectId, Guid harnessId) =>
        $"/api/v1/projects/{projectId:D}/harnesses/{harnessId:D}/design";

    private static string CutListRoute(Guid projectId, Guid harnessId) =>
        $"/api/v1/projects/{projectId:D}/harnesses/{harnessId:D}/cut-list";
}
