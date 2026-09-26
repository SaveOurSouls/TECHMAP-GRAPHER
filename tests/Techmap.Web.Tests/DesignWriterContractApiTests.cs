using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Techmap.Contracts;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class DesignWriterContractApiTests
{
    [Fact]
    public async Task Protected_document_rejects_old_client_and_preserves_its_revision()
    {
        await using var factory = new TechmapWebApplicationFactory();
        using var client = factory.CreateLocalClient();
        using var page = await client.GetAsync("/", TestContext.Current.CancellationToken);
        var csrf = (await client.GetFromJsonAsync<SessionBootstrapResponse>("/api/v1/session", TestContext.Current.CancellationToken))!.CsrfNonce;
        using var create = await Send(HttpMethod.Post, "/api/v1/projects", new CreateProjectRequest("P", "Writer contract", null, "draft"));
        create.EnsureSuccessStatusCode();
        var project = (await create.Content.ReadFromJsonAsync<ProjectDetailsResponse>(TestContext.Current.CancellationToken))!;
        using var add = await Send(HttpMethod.Post, $"/api/v1/projects/{project.ProjectId:D}/harnesses", new AddHarnessRequest(Guid.NewGuid(), 0, "W1", 1));
        add.EnsureSuccessStatusCode();
        var command = (await add.Content.ReadFromJsonAsync<ProjectCommandResponse>(TestContext.Current.CancellationToken))!;
        var route = $"/api/v1/projects/{project.ProjectId:D}/harnesses/{Assert.Single(command.Project.Harnesses).HarnessId:D}/design";
        var content = JsonSerializer.Deserialize<JsonElement>("""{"schemaVersion":1,"connectors":[],"wires":[]} """);
        using var upgrade = await Send(HttpMethod.Put, route, new PutHarnessDesignRequest(0, 1, content, 1));
        upgrade.EnsureSuccessStatusCode();
        var saved = (await upgrade.Content.ReadFromJsonAsync<HarnessDesignResponse>(TestContext.Current.CancellationToken))!;
        Assert.Equal(1, saved.Content.GetProperty("requiredWriterContractVersion").GetInt32());
        using var old = await Send(HttpMethod.Put, route, new PutHarnessDesignRequest(saved.Revision, 1, content));
        Assert.Equal(HttpStatusCode.Conflict, old.StatusCode);
        var error = (await old.Content.ReadFromJsonAsync<ApiErrorResponse>(TestContext.Current.CancellationToken))!;
        Assert.Equal("design_writer_upgrade_required", error.Error);
        Assert.Equal(saved.Revision, error.CurrentRevision);
        var after = (await client.GetFromJsonAsync<HarnessDesignResponse>(route, TestContext.Current.CancellationToken))!;
        Assert.Equal(saved.Revision, after.Revision);
        Assert.True(JsonElement.DeepEquals(saved.Content, after.Content));
        using var capable = await Send(HttpMethod.Put, route, new PutHarnessDesignRequest(saved.Revision, 1, content, 1));
        capable.EnsureSuccessStatusCode();
        var next = (await capable.Content.ReadFromJsonAsync<HarnessDesignResponse>(TestContext.Current.CancellationToken))!;
        Assert.Equal(1, next.Content.GetProperty("requiredWriterContractVersion").GetInt32());

        async Task<HttpResponseMessage> Send(HttpMethod method, string path, object body)
        {
            using var request = new HttpRequestMessage(method, path) { Content = JsonContent.Create(body) };
            request.Headers.TryAddWithoutValidation("Origin", "http://127.0.0.1:18762");
            request.Headers.TryAddWithoutValidation(LocalHttpSession.CsrfHeaderName, csrf);
            return await client.SendAsync(request, TestContext.Current.CancellationToken);
        }
    }
}
