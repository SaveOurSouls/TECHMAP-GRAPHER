using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Techmap.Contracts;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class ProjectComponentPlacementApiTests
{
    private const string Origin = "http://127.0.0.1:18762";

    [Fact]
    public async Task Read_graph_returns_only_harness_owned_exact_snapshots_and_scoped_assets()
    {
        await using var factory = new TechmapWebApplicationFactory();
        using var client = factory.CreateLocalClient();
        var csrf = await StartSessionAsync(client);
        var (projectId, harnessId) = await CreateHarnessAsync(client, csrf, "P-READ");
        var otherHarnessId = await AddHarnessAsync(client, csrf, projectId, 1, "Другой жгут");
        var article = new ComponentTemplateArticleBindingRequest(
            "technology-database", "connector", "B2B-XH-A");
        using var createTemplate = await SendAsync(
            client,
            HttpMethod.Post,
            "/api/v1/component-templates",
            new CreateComponentTemplateRequest(
                "XH-READ",
                "Закреплённая версия",
                [article],
                Element(ComponentTemplateContentV3ValidatorTests.ValidContent())),
            csrf);
        createTemplate.EnsureSuccessStatusCode();
        var created = Assert.IsType<ComponentTemplateResponse>(await createTemplate.Content
            .ReadFromJsonAsync<ComponentTemplateResponse>(TestContext.Current.CancellationToken));

        var png = ComponentTemplateV2StoreTests.Png;
        using var addAsset = await SendAsync(
            client,
            HttpMethod.Post,
            $"/api/v1/component-templates/{created.TemplateId:D}/assets",
            new AddComponentTemplateAssetRequest(
                created.Version, "exact-version.png", "image/png", Convert.ToBase64String(png)),
            csrf);
        addAsset.EnsureSuccessStatusCode();
        var lockedVersion = Assert.IsType<ComponentTemplateResponse>(await addAsset.Content
            .ReadFromJsonAsync<ComponentTemplateResponse>(TestContext.Current.CancellationToken));
        var asset = Assert.Single(lockedVersion.Assets);

        var placementId = Guid.NewGuid();
        var instance = new JsonObject
        {
            ["id"] = placementId.ToString("D"),
            ["designation"] = "X1",
            ["partNumber"] = "B2B-XH-A",
            ["contacts"] = new JsonArray(),
            ["libraryBinding"] = new JsonObject
            {
                ["mode"] = "template",
                ["templateId"] = lockedVersion.TemplateId.ToString("D"),
                ["templateVersion"] = lockedVersion.Version,
                ["versionSha256"] = lockedVersion.VersionSha256,
                ["article"] = new JsonObject
                {
                    ["sourceId"] = "technology-database",
                    ["entityType"] = "connector",
                    ["articleKey"] = "B2B-XH-A",
                },
            },
        };
        using var place = await SendAsync(
            client,
            HttpMethod.Post,
            Route(projectId, harnessId),
            new PlaceComponentRequest(
                Guid.NewGuid(), 0, placementId, lockedVersion.TemplateId, lockedVersion.Version,
                "technology-database", "connector", "B2B-XH-A", Element(instance)),
            csrf);
        place.EnsureSuccessStatusCode();
        var placed = Assert.IsType<ProjectComponentPlacementCommandResponse>(await place.Content
            .ReadFromJsonAsync<ProjectComponentPlacementCommandResponse>(TestContext.Current.CancellationToken));

        using var publishLaterHead = await SendAsync(
            client,
            HttpMethod.Put,
            $"/api/v1/component-templates/{lockedVersion.TemplateId:D}",
            new UpdateComponentTemplateRequest(
                lockedVersion.Version,
                "XH-READ",
                "Более новая глобальная версия",
                [article],
                lockedVersion.Content),
            csrf);
        publishLaterHead.EnsureSuccessStatusCode();
        var currentHead = Assert.IsType<ComponentTemplateResponse>(await publishLaterHead.Content
            .ReadFromJsonAsync<ComponentTemplateResponse>(TestContext.Current.CancellationToken));
        Assert.True(currentHead.Version > lockedVersion.Version);

        var graph = await client.GetFromJsonAsync<ProjectComponentPlacementListResponse>(
            Route(projectId, harnessId), TestContext.Current.CancellationToken);
        var placement = Assert.Single(Assert.IsType<ProjectComponentPlacementListResponse>(graph).Placements);
        var snapshot = Assert.Single(graph.Snapshots);
        Assert.Equal(placed.Snapshot.SnapshotId, snapshot.SnapshotId);
        Assert.Equal(placement.SnapshotId, snapshot.SnapshotId);
        Assert.Equal(projectId, snapshot.ProjectId);
        Assert.Equal(lockedVersion.Version, snapshot.SourceVersion);
        Assert.Equal(lockedVersion.VersionSha256, snapshot.SourceVersionSha256);
        Assert.Equal("Закреплённая версия", snapshot.Name);
        Assert.True(JsonElement.DeepEquals(lockedVersion.Content, snapshot.Content));
        Assert.Equal(asset.AssetId, Assert.Single(snapshot.Assets).AssetId);

        using var readAsset = await client.GetAsync(
            AssetRoute(projectId, harnessId, snapshot.SnapshotId, asset.AssetId),
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, readAsset.StatusCode);
        Assert.Equal("image/png", readAsset.Content.Headers.ContentType?.MediaType);
        Assert.Equal(png, await readAsset.Content.ReadAsByteArrayAsync(TestContext.Current.CancellationToken));

        var otherGraph = await client.GetFromJsonAsync<ProjectComponentPlacementListResponse>(
            Route(projectId, otherHarnessId), TestContext.Current.CancellationToken);
        Assert.Empty(Assert.IsType<ProjectComponentPlacementListResponse>(otherGraph).Placements);
        Assert.Empty(otherGraph.Snapshots);
        using var crossHarnessAsset = await client.GetAsync(
            AssetRoute(projectId, otherHarnessId, snapshot.SnapshotId, asset.AssetId),
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.NotFound, crossHarnessAsset.StatusCode);
        Assert.Equal("component_snapshot_not_found", (await crossHarnessAsset.Content
            .ReadFromJsonAsync<ApiErrorResponse>(TestContext.Current.CancellationToken))?.Error);
    }

    private static async Task<string> StartSessionAsync(HttpClient client)
    {
        using var page = await client.GetAsync("/", TestContext.Current.CancellationToken);
        page.EnsureSuccessStatusCode();
        return (await client.GetFromJsonAsync<SessionBootstrapResponse>(
            "/api/v1/session", TestContext.Current.CancellationToken))!.CsrfNonce;
    }

    private static async Task<(Guid ProjectId, Guid HarnessId)> CreateHarnessAsync(
        HttpClient client,
        string csrf,
        string designation)
    {
        using var create = await SendAsync(
            client, HttpMethod.Post, "/api/v1/projects",
            new CreateProjectRequest(designation, "Component read API", null, "draft"), csrf);
        create.EnsureSuccessStatusCode();
        var project = Assert.IsType<ProjectDetailsResponse>(await create.Content
            .ReadFromJsonAsync<ProjectDetailsResponse>(TestContext.Current.CancellationToken));
        var harnessId = await AddHarnessAsync(client, csrf, project.ProjectId, project.Revision, "Жгут");
        return (project.ProjectId, harnessId);
    }

    private static async Task<Guid> AddHarnessAsync(
        HttpClient client,
        string csrf,
        Guid projectId,
        long revision,
        string designation)
    {
        using var add = await SendAsync(
            client, HttpMethod.Post, $"/api/v1/projects/{projectId:D}/harnesses",
            new AddHarnessRequest(Guid.NewGuid(), revision, designation, 1), csrf);
        add.EnsureSuccessStatusCode();
        var result = Assert.IsType<ProjectCommandResponse>(await add.Content
            .ReadFromJsonAsync<ProjectCommandResponse>(TestContext.Current.CancellationToken));
        return result.Project.Harnesses.Single(item => item.Designation == designation).HarnessId;
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

    private static JsonElement Element(JsonNode node)
    {
        using var document = JsonDocument.Parse(node.ToJsonString());
        return document.RootElement.Clone();
    }

    private static string Route(Guid projectId, Guid harnessId) =>
        $"/api/v1/projects/{projectId:D}/harnesses/{harnessId:D}/component-placements";

    private static string AssetRoute(Guid projectId, Guid harnessId, Guid snapshotId, Guid assetId) =>
        $"{Route(projectId, harnessId)}/snapshots/{snapshotId:D}/assets/{assetId:D}/content";
}
