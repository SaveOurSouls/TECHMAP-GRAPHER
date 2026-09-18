using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Techmap.Contracts;
using Techmap.Domain;
using Techmap.Infrastructure.Sqlite;
using Techmap.Web;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class HarnessDesignApiTests
{
    private const string Origin = "http://127.0.0.1:18762";

    [Theory]
    [InlineData("layers", "[]")]
    [InlineData("layers", "null")]
    [InlineData("layers", "[{\"index\":1,\"diameterMm\":1,\"stripLengthMm\":0}]")]
    [InlineData("layers", "[{\"index\":1,\"diameterMm\":0.0001,\"stripLengthMm\":2}]")]
    [InlineData("layers", "[{\"index\":1,\"diameterMm\":1000000001,\"stripLengthMm\":2}]")]
    [InlineData("layers", "[{\"index\":1.5,\"diameterMm\":1,\"stripLengthMm\":2}]")]
    [InlineData("layers", "[{\"index\":9007199254740992,\"diameterMm\":1,\"stripLengthMm\":2}]")]
    [InlineData("layers", "[{\"index\":1,\"diameterMm\":1,\"stripLengthMm\":2},{\"index\":1,\"diameterMm\":2,\"stripLengthMm\":3}]")]
    [InlineData("layers", "[{\"index\":1,\"diameterMm\":2,\"stripLengthMm\":2},{\"index\":3,\"diameterMm\":1,\"stripLengthMm\":3}]")]
    [InlineData("layers", "[{\"index\":1,\"diameterMm\":1,\"stripLengthMm\":3},{\"index\":3,\"diameterMm\":2,\"stripLengthMm\":2}]")]
    [InlineData("sourceId", "\" \"")]
    [InlineData("snapshotId", "\"00000000-0000-0000-0000-000000000000\"")]
    [InlineData("snapshotSha256", "\"bad-hash\"")]
    [InlineData("recordId", "null")]
    [InlineData("entityType", "\"wire\"")]
    public async Task Invalid_strip_profile_cannot_replace_a_saved_document(string property, string valueJson)
    {
        await using var factory = new TechmapWebApplicationFactory();
        using var client = factory.CreateLocalClient();
        var csrf = await StartSessionAsync(client);
        var ids = await CreateHarnessAsync(client, csrf);
        var profile = JsonSerializer.SerializeToNode(new {
            sourceId = "test-coax", snapshotId = Guid.NewGuid().ToString("D"),
            snapshotSha256 = new string('a', 64), recordId = new string('b', 64),
            entityType = "coax-termination", sourceKey = "TEST-STRIP", displayName = "Test strip",
            layers = new[] { new { index = 1, diameterMm = 1m, stripLengthMm = 2.5m },
                new { index = 3, diameterMm = 3m, stripLengthMm = 7.5m } }
        })!;
        var content = new JsonObject { ["schemaVersion"] = 1, ["connectors"] = new JsonArray(), ["wires"] = new JsonArray(
            new JsonObject { ["id"] = "W1", ["stripProfiles"] = new JsonObject {
                ["from"] = profile, ["to"] = profile.DeepClone() } }) };
        var initialJson = content.ToJsonString();
        using var accepted = await SendAsync(client, HttpMethod.Put, Route(ids.ProjectId, ids.HarnessId),
            new PutHarnessDesignRequest(0, 1, JsonSerializer.SerializeToElement(content)), csrf);
        Assert.Equal(HttpStatusCode.OK, accepted.StatusCode);

        profile[property] = JsonNode.Parse(valueJson);
        using var rejected = await SendAsync(client, HttpMethod.Put, Route(ids.ProjectId, ids.HarnessId),
            new PutHarnessDesignRequest(1, 1, JsonSerializer.SerializeToElement(content)), csrf);
        Assert.Equal(HttpStatusCode.BadRequest, rejected.StatusCode);
        var error = await rejected.Content.ReadFromJsonAsync<ApiErrorResponse>(TestContext.Current.CancellationToken);
        Assert.Equal("invalid_design_content", error!.Error);
        Assert.StartsWith($"content.wires[0].stripProfiles.from.{property}", error.Field);
        var saved = await client.GetFromJsonAsync<HarnessDesignResponse>(Route(ids.ProjectId, ids.HarnessId),
            TestContext.Current.CancellationToken);
        Assert.Equal(1, saved!.Revision);
        Assert.True(JsonElement.DeepEquals(JsonSerializer.SerializeToElement(JsonNode.Parse(initialJson)), saved.Content));
    }

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
    public async Task Put_acknowledges_an_identical_retry_but_rejects_a_divergent_stale_revision()
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

        using (var replay = await SendAsync(
                   client, HttpMethod.Put, Route(first.ProjectId, first.HarnessId),
                   new PutHarnessDesignRequest(0, 1, valid.RootElement.Clone()), csrf))
        {
            var acknowledged = await replay.Content.ReadFromJsonAsync<HarnessDesignResponse>(
                TestContext.Current.CancellationToken);
            Assert.Equal(HttpStatusCode.OK, replay.StatusCode);
            Assert.Equal(1, Assert.IsType<HarnessDesignResponse>(acknowledged).Revision);
        }

        using var divergent = JsonDocument.Parse(
            "{\"schemaVersion\":1,\"connectors\":[{\"id\":\"XS1\"}],\"wires\":[],\"views\":{\"e4\":{\"layers\":[]},\"drawing\":{\"layers\":[]}}}");
        using (var stale = await SendAsync(
                   client, HttpMethod.Put, Route(first.ProjectId, first.HarnessId),
                   new PutHarnessDesignRequest(0, 1, divergent.RootElement.Clone()), csrf))
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

    [Fact]
    public async Task Cable_instances_round_trip_while_legacy_documents_remain_supported()
    {
        await using var factory = new TechmapWebApplicationFactory();
        using var client = factory.CreateLocalClient();
        var csrf = await StartSessionAsync(client);
        var ids = await CreateHarnessAsync(client, csrf);
        var snapshotId = Guid.NewGuid();
        using var content = JsonDocument.Parse(
            $$$$"""
            {"schemaVersion":1,"connectors":[],"wires":[{"id":"W-1"},{"id":"W-2"}],
             "cables":[{"id":"C-1","memberWireIds":["W-1","W-2"],
               "materialBinding":{"sourceId":"technology-cables","snapshotId":"{{{{snapshotId:D}}}}",
                 "snapshotSha256":"{{{{new string('a', 64)}}}}","recordId":"{{{{new string('b', 64)}}}}",
                 "entityType":"cable","sourceKey":"CABLE-2X","displayName":"Кабель 2x0,2"},
               "lengthMm":125.5,"endCorrectionFromMm":-1.25,"endCorrectionToMm":2,
               "cutRoundingStepMm":0.5}],
             "views":{"e4":{"layers":[]},"drawing":{"layers":[]}}}
            """);
        using var savedResponse = await SendAsync(
            client, HttpMethod.Put, Route(ids.ProjectId, ids.HarnessId),
            new PutHarnessDesignRequest(0, 1, content.RootElement.Clone()), csrf);
        var saved = await savedResponse.Content.ReadFromJsonAsync<HarnessDesignResponse>(
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.OK, savedResponse.StatusCode);
        var cable = Assert.IsType<HarnessDesignResponse>(saved).Content.GetProperty("cables")[0];
        Assert.Equal("C-1", cable.GetProperty("id").GetString());
        Assert.Equal(["W-1", "W-2"], cable.GetProperty("memberWireIds").EnumerateArray()
            .Select(value => value.GetString()).ToArray());
        Assert.Equal("cable", cable.GetProperty("materialBinding").GetProperty("entityType").GetString());
        Assert.Equal(125.5m, cable.GetProperty("lengthMm").GetDecimal());

        // Absence of the optional top-level collection is the legacy schema-1 representation.
        using var legacy = JsonDocument.Parse(
            "{\"schemaVersion\":1,\"connectors\":[],\"wires\":[],\"views\":{\"e4\":{\"layers\":[]},\"drawing\":{\"layers\":[]}}}");
        using var legacyResponse = await SendAsync(
            client, HttpMethod.Put, Route(ids.ProjectId, ids.HarnessId),
            new PutHarnessDesignRequest(1, 1, legacy.RootElement.Clone()), csrf);
        Assert.Equal(HttpStatusCode.OK, legacyResponse.StatusCode);
    }

    [Theory]
    [InlineData("duplicate cable ID", "[{\"id\":\"C-1\",\"memberWireIds\":[\"W-1\"],\"lengthMm\":1,\"endCorrectionFromMm\":0,\"endCorrectionToMm\":0,\"cutRoundingStepMm\":1},{\"id\":\"C-1\",\"memberWireIds\":[\"W-2\"],\"lengthMm\":1,\"endCorrectionFromMm\":0,\"endCorrectionToMm\":0,\"cutRoundingStepMm\":1}]", "content.cables[1].id")]
    [InlineData("unknown member", "[{\"id\":\"C-1\",\"memberWireIds\":[\"W-X\"],\"lengthMm\":1,\"endCorrectionFromMm\":0,\"endCorrectionToMm\":0,\"cutRoundingStepMm\":1}]", "content.cables[0].memberWireIds[0]")]
    [InlineData("member of two cables", "[{\"id\":\"C-1\",\"memberWireIds\":[\"W-1\"],\"lengthMm\":1,\"endCorrectionFromMm\":0,\"endCorrectionToMm\":0,\"cutRoundingStepMm\":1},{\"id\":\"C-2\",\"memberWireIds\":[\"W-1\"],\"lengthMm\":1,\"endCorrectionFromMm\":0,\"endCorrectionToMm\":0,\"cutRoundingStepMm\":1}]", "content.cables[1].memberWireIds[0]")]
    [InlineData("invalid precision", "[{\"id\":\"C-1\",\"memberWireIds\":[\"W-1\"],\"lengthMm\":1.0001,\"endCorrectionFromMm\":0,\"endCorrectionToMm\":0,\"cutRoundingStepMm\":1}]", "content.cables[0].lengthMm")]
    [InlineData("zero rounding", "[{\"id\":\"C-1\",\"memberWireIds\":[\"W-1\"],\"lengthMm\":1,\"endCorrectionFromMm\":0,\"endCorrectionToMm\":0,\"cutRoundingStepMm\":0}]", "content.cables[0].cutRoundingStepMm")]
    public async Task Cable_instances_reject_invalid_identity_membership_and_lengths(
        string reason,
        string cablesJson,
        string expectedField)
    {
        _ = reason;
        await using var factory = new TechmapWebApplicationFactory();
        using var client = factory.CreateLocalClient();
        var csrf = await StartSessionAsync(client);
        var ids = await CreateHarnessAsync(client, csrf);
        using var content = JsonDocument.Parse(
            $"{{\"schemaVersion\":1,\"connectors\":[],\"wires\":[{{\"id\":\"W-1\"}},{{\"id\":\"W-2\"}}],\"cables\":{cablesJson},\"views\":{{\"e4\":{{\"layers\":[]}},\"drawing\":{{\"layers\":[]}}}}}}");

        using var response = await SendAsync(
            client, HttpMethod.Put, Route(ids.ProjectId, ids.HarnessId),
            new PutHarnessDesignRequest(0, 1, content.RootElement.Clone()), csrf);
        var error = await response.Content.ReadFromJsonAsync<ApiErrorResponse>(TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("invalid_design_content", Assert.IsType<ApiErrorResponse>(error).Error);
        Assert.Equal(expectedField, error.Field);
    }

    [Fact]
    public async Task Cable_instances_require_unique_member_wire_ids()
    {
        await using var factory = new TechmapWebApplicationFactory();
        using var client = factory.CreateLocalClient();
        var csrf = await StartSessionAsync(client);
        var ids = await CreateHarnessAsync(client, csrf);
        using var content = JsonDocument.Parse(
            """
            {"schemaVersion":1,"connectors":[],"wires":[{"id":"W-1"},{"id":"W-1"}],
             "cables":[],"views":{"e4":{"layers":[]},"drawing":{"layers":[]}}}
            """);

        using var response = await SendAsync(
            client, HttpMethod.Put, Route(ids.ProjectId, ids.HarnessId),
            new PutHarnessDesignRequest(0, 1, content.RootElement.Clone()), csrf);
        var error = await response.Content.ReadFromJsonAsync<ApiErrorResponse>(TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("invalid_design_content", Assert.IsType<ApiErrorResponse>(error).Error);
        Assert.Equal("content.wires[1].id", error.Field);
    }

    [Fact]
    public async Task Cable_material_binding_requires_the_cable_entity_type()
    {
        await using var factory = new TechmapWebApplicationFactory();
        using var client = factory.CreateLocalClient();
        var csrf = await StartSessionAsync(client);
        var ids = await CreateHarnessAsync(client, csrf);
        using var content = JsonDocument.Parse(
            $$$$"""
            {"schemaVersion":1,"connectors":[],"wires":[{"id":"W-1"}],
             "cables":[{"id":"C-1","memberWireIds":["W-1"],
               "materialBinding":{"sourceId":"technology-wires","snapshotId":"{{{{Guid.NewGuid():D}}}}",
                 "snapshotSha256":"{{{{new string('a', 64)}}}}","recordId":"{{{{new string('b', 64)}}}}",
                 "entityType":"wire","sourceKey":"WIRE-1","displayName":"Провод"},
               "lengthMm":null,"endCorrectionFromMm":0,"endCorrectionToMm":0,"cutRoundingStepMm":1}],
             "views":{"e4":{"layers":[]},"drawing":{"layers":[]}}}
            """);
        using var response = await SendAsync(
            client, HttpMethod.Put, Route(ids.ProjectId, ids.HarnessId),
            new PutHarnessDesignRequest(0, 1, content.RootElement.Clone()), csrf);
        var error = await response.Content.ReadFromJsonAsync<ApiErrorResponse>(TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("invalid_design_content", Assert.IsType<ApiErrorResponse>(error).Error);
        Assert.Equal("content.cables[0].materialBinding.entityType", error.Field);
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
