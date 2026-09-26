using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Techmap.Contracts;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class TemplateContactNumberingTests
{
    [Theory]
    [InlineData("unknown-marker")]
    [InlineData("null-marker")]
    [InlineData("snapshot")]
    [InlineData("count")]
    [InlineData("logical-id")]
    [InlineData("duplicate-logical-id")]
    [InlineData("contact-id")]
    [InlineData("number")]
    [InlineData("collision")]
    [InlineData("0")]
    [InlineData("301")]
    [InlineData("-1")]
    [InlineData("1.5")]
    [InlineData("1e1")]
    [InlineData("١٠")]
    [InlineData(" 10")]
    [InlineData("")]
    public async Task Invalid_placement_and_save_preserve_revision_and_live_instance(string mutation)
    {
        await using var factory = new TechmapWebApplicationFactory();
        using var client = factory.CreateLocalClient();
        var setup = await Setup(client);
        var id = Guid.NewGuid();
        var instance = Instance(id, setup.Template);
        var invalid = instance.DeepClone().AsObject();
        Mutate(invalid, mutation);
        using var rejectedPlacement = await Place(client, setup, id, invalid);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, rejectedPlacement.StatusCode);
        Assert.Equal("invalid_template_contact_numbering", (await rejectedPlacement.Content
            .ReadFromJsonAsync<ApiErrorResponse>(TestContext.Current.CancellationToken))!.Error);
        Assert.Equal(0, (await Read(client, setup)).Revision);
        var empty = await client.GetFromJsonAsync<ProjectComponentPlacementListResponse>(setup.Route + "/component-placements", TestContext.Current.CancellationToken);
        Assert.Empty(empty!.Placements);
        Assert.Empty(empty.Snapshots);

        using var placed = await Place(client, setup, id, instance);
        placed.EnsureSuccessStatusCode();
        var before = await Read(client, setup);
        var content = JsonNode.Parse(before.Content.GetRawText())!;
        Mutate(content["connectors"]![0]!.AsObject(), mutation);
        using var rejectedSave = await Send(client, HttpMethod.Put, setup.Route + "/design",
            new PutHarnessDesignRequest(before.Revision, 1, JsonSerializer.SerializeToElement(content)), setup.Csrf);
        Assert.Equal(HttpStatusCode.BadRequest, rejectedSave.StatusCode);
        Assert.Equal("invalid_template_contact_numbering", (await rejectedSave.Content
            .ReadFromJsonAsync<ApiErrorResponse>(TestContext.Current.CancellationToken))!.Error);
        var after = await Read(client, setup);
        Assert.Equal(before.Revision, after.Revision);
        Assert.True(JsonElement.DeepEquals(before.Content, after.Content));
        var graph = await client.GetFromJsonAsync<ProjectComponentPlacementListResponse>(setup.Route + "/component-placements", TestContext.Current.CancellationToken);
        Assert.True(JsonElement.DeepEquals(JsonSerializer.SerializeToElement(instance), Assert.Single(graph!.Placements).Instance));
    }

    [Fact]
    public async Task Source_numbers_round_trip_by_logical_identity_and_legacy_remains_accepted()
    {
        await using var factory = new TechmapWebApplicationFactory();
        using var client = factory.CreateLocalClient();
        var setup = await Setup(client);
        var id = Guid.NewGuid();
        var instance = Instance(id, setup.Template);
        // Snapshot order does not identify electrical contacts.
        var sources = instance["libraryBinding"]!["snapshot"]!["contacts"]!.AsArray();
        var first = sources[0]!.DeepClone();
        sources.RemoveAt(0);
        sources.Add(first);
        using var placed = await Place(client, setup, id, instance);
        placed.EnsureSuccessStatusCode();
        var saved = await Read(client, setup);
        Assert.Equal(new[] { 10, 20 }, saved.Content.GetProperty("connectors")[0].GetProperty("contacts")
            .EnumerateArray().Select(contact => contact.GetProperty("number").GetInt32()));
        using var roundTrip = await Send(client, HttpMethod.Put, setup.Route + "/design",
            new PutHarnessDesignRequest(saved.Revision, 1, saved.Content), setup.Csrf);
        roundTrip.EnsureSuccessStatusCode();
        var legacy = Instance(Guid.NewGuid(), setup.Template);
        legacy["libraryBinding"]!.AsObject().Remove("contactNumbering");
        legacy["libraryBinding"]!.AsObject().Remove("snapshot");
        legacy["contacts"] = new JsonArray();
        var current = await Read(client, setup);
        using var legacyPlacement = await Place(client, setup, Guid.Parse(legacy["id"]!.GetValue<string>()), legacy, current.Revision);
        legacyPlacement.EnsureSuccessStatusCode();
    }

    private static void Mutate(JsonObject instance, string mutation)
    {
        var binding = instance["libraryBinding"]!;
        var sources = binding["snapshot"]!["contacts"]!;
        var contacts = instance["contacts"]!;
        switch (mutation)
        {
            case "unknown-marker": binding["contactNumbering"] = "source-v2"; break;
            case "null-marker": binding["contactNumbering"] = null; break;
            case "snapshot": binding.AsObject().Remove("snapshot"); break;
            case "count": contacts.AsArray().RemoveAt(1); break;
            case "logical-id": contacts[0]!["logicalContactId"] = "other"; break;
            case "duplicate-logical-id": sources[1]!["logicalContactId"] = "a"; break;
            case "contact-id": contacts[0]!["id"] = "other:contact:a"; break;
            case "number": contacts[0]!["number"] = 1; break;
            case "collision": sources[1]!["sourceNumber"] = "010"; break;
            default: sources[0]!["sourceNumber"] = mutation; break;
        }
    }

    private static JsonObject Instance(Guid id, ComponentTemplateResponse template) => new()
    {
        ["id"] = id.ToString("D"),
        ["contacts"] = new JsonArray(
            new JsonObject { ["id"] = $"{id:D}:contact:a", ["logicalContactId"] = "a", ["number"] = 10 },
            new JsonObject { ["id"] = $"{id:D}:contact:b", ["logicalContactId"] = "b", ["number"] = 20 }),
        ["libraryBinding"] = new JsonObject
        {
            ["mode"] = "template", ["contactNumbering"] = "source-v1",
            ["templateId"] = template.TemplateId.ToString("D"), ["templateVersion"] = template.Version,
            ["versionSha256"] = template.VersionSha256,
            ["article"] = new JsonObject { ["sourceId"] = "technology-database", ["entityType"] = "connector", ["articleKey"] = "B2B-XH-A" },
            ["snapshot"] = new JsonObject { ["contacts"] = new JsonArray(
                new JsonObject { ["logicalContactId"] = "a", ["sourceNumber"] = "10" },
                new JsonObject { ["logicalContactId"] = "b", ["sourceNumber"] = "20" }) },
        },
    };

    private sealed record Context(string Csrf, string Route, ComponentTemplateResponse Template);

    private static async Task<Context> Setup(HttpClient client)
    {
        using var page = await client.GetAsync("/", TestContext.Current.CancellationToken);
        page.EnsureSuccessStatusCode();
        var csrf = (await client.GetFromJsonAsync<SessionBootstrapResponse>("/api/v1/session", TestContext.Current.CancellationToken))!.CsrfNonce;
        using var create = await Send(client, HttpMethod.Post, "/api/v1/projects", new CreateProjectRequest("P", "Contact numbering", null, "draft"), csrf);
        create.EnsureSuccessStatusCode();
        var project = (await create.Content.ReadFromJsonAsync<ProjectDetailsResponse>(TestContext.Current.CancellationToken))!;
        using var add = await Send(client, HttpMethod.Post, $"/api/v1/projects/{project.ProjectId:D}/harnesses", new AddHarnessRequest(Guid.NewGuid(), 0, "W1", 1), csrf);
        add.EnsureSuccessStatusCode();
        var result = (await add.Content.ReadFromJsonAsync<ProjectCommandResponse>(TestContext.Current.CancellationToken))!;
        using var templateResponse = await Send(client, HttpMethod.Post, "/api/v1/component-templates", new CreateComponentTemplateRequest(
            "XH", "Contact numbering", [new ComponentTemplateArticleBindingRequest("technology-database", "connector", "B2B-XH-A")],
            JsonSerializer.SerializeToElement(ComponentTemplateContentV3ValidatorTests.ValidContent())), csrf);
        templateResponse.EnsureSuccessStatusCode();
        var template = (await templateResponse.Content.ReadFromJsonAsync<ComponentTemplateResponse>(TestContext.Current.CancellationToken))!;
        return new Context(csrf, $"/api/v1/projects/{project.ProjectId:D}/harnesses/{Assert.Single(result.Project.Harnesses).HarnessId:D}", template);
    }

    private static Task<HttpResponseMessage> Place(HttpClient client, Context setup, Guid id, JsonObject instance, long revision = 0) =>
        Send(client, HttpMethod.Post, setup.Route + "/component-placements", new PlaceComponentRequest(Guid.NewGuid(), revision, id,
            setup.Template.TemplateId, setup.Template.Version, "technology-database", "connector", "B2B-XH-A", JsonSerializer.SerializeToElement(instance)), setup.Csrf);

    private static async Task<HarnessDesignResponse> Read(HttpClient client, Context setup) =>
        (await client.GetFromJsonAsync<HarnessDesignResponse>(setup.Route + "/design", TestContext.Current.CancellationToken))!;

    private static async Task<HttpResponseMessage> Send(HttpClient client, HttpMethod method, string path, object body, string csrf)
    {
        using var request = new HttpRequestMessage(method, path) { Content = JsonContent.Create(body) };
        request.Headers.TryAddWithoutValidation("Origin", "http://127.0.0.1:18762");
        request.Headers.TryAddWithoutValidation(LocalHttpSession.CsrfHeaderName, csrf);
        return await client.SendAsync(request, TestContext.Current.CancellationToken);
    }
}
