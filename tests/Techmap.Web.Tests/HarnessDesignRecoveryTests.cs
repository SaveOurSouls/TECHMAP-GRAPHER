using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Techmap.Application;
using Techmap.Contracts;
using Techmap.Domain;
using Techmap.Web;
using Techmap.Infrastructure.Sqlite;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class HarnessDesignRecoveryTests
{
    private static JsonElement Content(string name) => JsonSerializer.SerializeToElement(new { schemaVersion = 1, connectors = Array.Empty<object>(), wires = Array.Empty<object>(), name });

    [Fact]
    public void Sequence_and_conditional_delete_preserve_newer_and_conflicting_copies()
    {
        var root = Path.Combine(Path.GetTempPath(), "techmap-recovery-tests", Guid.NewGuid().ToString("N"));
        var designs = new StubDesignStore();
        var journal = new HarnessDesignRecoveryJournal(root, designs);
        var project = Guid.NewGuid(); var harness = Guid.NewGuid(); var id = Guid.NewGuid();
        var first = journal.Put(project, harness, id, new(1, 3, Content("local")));
        designs.Revision = 5;
        journal.Put(project, harness, id, new(2, 3, Content("newer-local")));
        Assert.Equal("recovery_sequence_conflict", Assert.Throws<HarnessDesignDocumentException>(() => journal.Put(project, harness, id, new(1, 3, Content("late")))).Code);
        Assert.Throws<HarnessDesignDocumentException>(() => journal.Delete(project, harness, id, 1));
        var another = journal.Put(project, harness, Guid.NewGuid(), new(1, 5, Content("other-tab")));
        var restarted = new HarnessDesignRecoveryJournal(root, designs);
        Assert.Equal(2, restarted.List(project, harness).Count);
        var saved = restarted.List(project, harness).Single(d => d.DraftId == id);
        Assert.Equal("newer-local", saved.Content.GetProperty("name").GetString());
        Assert.Equal(first.ServerRevision, saved.ServerRevision);
        Assert.Equal(5, another.ServerRevision);
        restarted.Delete(project, harness, id, 2);
        Assert.Equal(another.DraftId, Assert.Single(restarted.List(project, harness)).DraftId);
    }

    [Fact]
    public void Limits_and_io_failure_do_not_discard_existing_journals()
    {
        var root = Path.Combine(Path.GetTempPath(), "techmap-recovery-tests", Guid.NewGuid().ToString("N"));
        var journal = new HarnessDesignRecoveryJournal(root, new StubDesignStore());
        var project = Guid.NewGuid(); var harness = Guid.NewGuid();
        Assert.Equal("recovery_too_large", Assert.Throws<HarnessDesignDocumentException>(() => journal.Put(project, harness, Guid.NewGuid(), new(1, 0, Content(new string('x', HarnessDesignRecoveryJournal.MaximumContentBytes))))).Code);
        for (var i = 0; i < HarnessDesignRecoveryJournal.MaximumDrafts; i++) journal.Put(project, harness, Guid.NewGuid(), new(1, 0, Content("draft")));
        Assert.Equal("recovery_limit", Assert.Throws<HarnessDesignDocumentException>(() => journal.Put(project, harness, Guid.NewGuid(), new(1, 0, Content("extra")))).Code);
        Assert.Equal(HarnessDesignRecoveryJournal.MaximumDrafts, journal.List(project, harness).Count);
        var unavailable = Path.Combine(root, "file-as-directory"); File.WriteAllText(unavailable, "unchanged");
        Assert.ThrowsAny<IOException>(() => new HarnessDesignRecoveryJournal(unavailable, new StubDesignStore()).Put(project, harness, Guid.NewGuid(), new(1, 0, Content("draft"))));
        Assert.Equal("unchanged", File.ReadAllText(unavailable));
    }

    [Fact]
    public async Task Restart_on_different_port_recovers_both_versions_without_changing_live_document()
    {
        var root = Path.Combine(Path.GetTempPath(), "techmap-recovery-tests", Guid.NewGuid().ToString("N"));
        Guid projectId; Guid harnessId; var id = Guid.NewGuid();
        await using (var first = new RecoveryHost(root, 18821))
        {
            using var client = first.Client(); var csrf = await Session(client);
            using var created = await Send(client, HttpMethod.Post, "/api/v1/projects", new CreateProjectRequest("REC", "Recovery", null, "draft"), csrf);
            var project = (await created.Content.ReadFromJsonAsync<ProjectDetailsResponse>(TestContext.Current.CancellationToken))!;
            projectId = project.ProjectId;
            using var added = await Send(client, HttpMethod.Post, $"/api/v1/projects/{projectId}/harnesses", new AddHarnessRequest(Guid.NewGuid(), 0, "Harness", 1), csrf);
            var command = (await added.Content.ReadFromJsonAsync<ProjectCommandResponse>(TestContext.Current.CancellationToken))!;
            harnessId = Assert.Single(command.Project.Harnesses).HarnessId;
            using var written = await Send(client, HttpMethod.Put, Route(projectId, harnessId) + $"/recovery/{id}", new PutHarnessDesignRecoveryRequest(1, 0, Content("local-draft")), csrf);
            Assert.Equal(HttpStatusCode.OK, written.StatusCode);
        }
        // WebApplicationFactory.DisposeAsync stops the host; the top-level entry point
        // releases its data-root lease in its final continuation. Wait for that release.
        var released = false;
        for (var attempt = 0; attempt < 100 && !released; attempt++)
        {
            try { await using var lease = DataRootLease.Acquire(root); released = true; }
            catch (DataRootLeaseUnavailableException) { await Task.Delay(20, TestContext.Current.CancellationToken); }
        }
        Assert.True(released, "Previous host did not release its data-root lease.");
        await using (var second = new RecoveryHost(root, 18822))
        {
            using var client = second.Client(); var csrf = await Session(client);
            var copies = await client.GetFromJsonAsync<HarnessDesignRecoveryResponse[]>(Route(projectId, harnessId) + "/recovery", TestContext.Current.CancellationToken);
            var copy = Assert.Single(copies!);
            Assert.Equal(id, copy.DraftId); Assert.Equal("local-draft", copy.Content.GetProperty("name").GetString());
            var live = (await client.GetFromJsonAsync<HarnessDesignResponse>(Route(projectId, harnessId), TestContext.Current.CancellationToken))!;
            Assert.Equal(0, live.Revision); Assert.True(JsonElement.DeepEquals(live.Content, copy.ServerContent));
            using var missingCsrf = await client.PutAsJsonAsync(Route(projectId, harnessId) + $"/recovery/{Guid.NewGuid()}", new PutHarnessDesignRecoveryRequest(1, 0, Content("denied")), TestContext.Current.CancellationToken);
            Assert.False(missingCsrf.IsSuccessStatusCode);
            var directory = Path.Combine(root, "recovery", projectId.ToString("D"), harnessId.ToString("D"));
            File.WriteAllText(Path.Combine(directory, "broken.json"), "{");
            using var failure = await client.GetAsync(Route(projectId, harnessId) + "/recovery", TestContext.Current.CancellationToken);
            Assert.Equal(HttpStatusCode.ServiceUnavailable, failure.StatusCode);
            Assert.True(File.Exists(Path.Combine(directory, id.ToString("D") + ".json")));
        }
    }

    private static string Route(Guid project, Guid harness) => $"/api/v1/projects/{project}/harnesses/{harness}/design";
    private static async Task<string> Session(HttpClient client)
    {
        using var page = await client.GetAsync("/", TestContext.Current.CancellationToken);
        return (await client.GetFromJsonAsync<SessionBootstrapResponse>("/api/v1/session", TestContext.Current.CancellationToken))!.CsrfNonce;
    }
    private static Task<HttpResponseMessage> Send(HttpClient client, HttpMethod method, string path, object body, string csrf)
    {
        var request = new HttpRequestMessage(method, path) { Content = JsonContent.Create(body) };
        request.Headers.TryAddWithoutValidation("Origin", client.BaseAddress!.GetLeftPart(UriPartial.Authority));
        request.Headers.TryAddWithoutValidation(LocalHttpSession.CsrfHeaderName, csrf);
        return client.SendAsync(request, TestContext.Current.CancellationToken);
    }
    private sealed class RecoveryHost(string root, int port) : WebApplicationFactory<Program>
    {
        public HttpClient Client() => CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri($"http://127.0.0.1:{port}") });
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Testing"); builder.UseSetting("NoBrowser", "true"); builder.UseSetting("Port", port.ToString()); builder.UseSetting("DataRoot", root);
        }
    }
    private sealed class StubDesignStore : IHarnessDesignDocumentStore
    {
        public long Revision { get; set; } = 3;
        public HarnessDesignDocument Get(ProjectIdentity projectId, HarnessIdentity harnessId) => new(harnessId, Revision, 1, Content("server").GetRawText(), DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
        public HarnessDesignDocument Put(ProjectIdentity projectId, HarnessIdentity harnessId, long expectedRevision, int schemaVersion, string contentJson, int? writerContractVersion = null) => throw new NotSupportedException();
    }
}
