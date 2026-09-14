using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Techmap.Contracts;
using Techmap.Web;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class ComponentTemplateApiTests
{
    private const string Origin = "http://127.0.0.1:18762";

    [Fact]
    public async Task Crud_preserves_immutable_versions_and_multiple_article_bindings()
    {
        await using var factory = new TechmapWebApplicationFactory();
        using var client = factory.CreateLocalClient();
        var csrf = await StartSessionAsync(client);
        using var firstContent = Content("line-1");
        var bindings = new[]
        {
            new ComponentTemplateArticleBindingRequest("technology-database", "connector", "B2B-XH-A"),
            new ComponentTemplateArticleBindingRequest("technology-database", "connector", "B3B-XH-A"),
        };

        using var create = await SendAsync(
            client, HttpMethod.Post, "/api/v1/component-templates",
            new CreateComponentTemplateRequest(
                "  JST   XH ", " Серия   JST XH ", bindings, firstContent.RootElement.Clone()), csrf);
        Assert.Equal(HttpStatusCode.Created, create.StatusCode);
        var created = Assert.IsType<ComponentTemplateResponse>(
            await create.Content.ReadFromJsonAsync<ComponentTemplateResponse>(TestContext.Current.CancellationToken));
        Assert.Equal(1, created.Version);
        Assert.Equal("JST XH", created.Code);
        Assert.Equal(2, created.ArticleBindings.Count);

        using var secondContent = Content("line-2");
        using var update = await SendAsync(
            client, HttpMethod.Put, $"/api/v1/component-templates/{created.TemplateId:D}",
            new UpdateComponentTemplateRequest(
                1, "JST XH", "Серия JST XH, версия 2", bindings, secondContent.RootElement.Clone()), csrf);
        Assert.Equal(HttpStatusCode.OK, update.StatusCode);
        var current = Assert.IsType<ComponentTemplateResponse>(
            await update.Content.ReadFromJsonAsync<ComponentTemplateResponse>(TestContext.Current.CancellationToken));
        Assert.Equal(2, current.Version);
        Assert.Equal("line-2", current.Content.GetProperty("views")[0]
            .GetProperty("primitives")[0].GetProperty("id").GetString());

        var historical = await client.GetFromJsonAsync<ComponentTemplateResponse>(
            $"/api/v1/component-templates/{created.TemplateId:D}/versions/1",
            TestContext.Current.CancellationToken);
        Assert.Equal("line-1", Assert.IsType<ComponentTemplateResponse>(historical).Content
            .GetProperty("views")[0].GetProperty("primitives")[0].GetProperty("id").GetString());
        Assert.Equal("Серия JST XH", historical.Name);

        var versions = await client.GetFromJsonAsync<ComponentTemplateVersionListResponse>(
            $"/api/v1/component-templates/{created.TemplateId:D}/versions",
            TestContext.Current.CancellationToken);
        Assert.Equal([2, 1], Assert.IsType<ComponentTemplateVersionListResponse>(versions)
            .Items.Select(item => item.Version));
        var list = await client.GetFromJsonAsync<ComponentTemplateListResponse>(
            "/api/v1/component-templates", TestContext.Current.CancellationToken);
        Assert.Equal(2, Assert.Single(Assert.IsType<ComponentTemplateListResponse>(list).Items).Version);

        using var stale = await SendAsync(
            client, HttpMethod.Put, $"/api/v1/component-templates/{created.TemplateId:D}",
            new UpdateComponentTemplateRequest(
                1, "JST XH", "Stale", bindings, secondContent.RootElement.Clone()), csrf);
        var staleError = await stale.Content.ReadFromJsonAsync<ApiErrorResponse>(TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
        Assert.Equal("component_template_version_conflict", staleError?.Error);
        Assert.Equal(2, staleError?.CurrentVersion);

        using var deleted = await SendAsync(
            client, HttpMethod.Delete, $"/api/v1/component-templates/{created.TemplateId:D}",
            new DeleteComponentTemplateRequest(2), csrf);
        Assert.Equal(HttpStatusCode.NoContent, deleted.StatusCode);
        Assert.Empty((await client.GetFromJsonAsync<ComponentTemplateListResponse>(
            "/api/v1/component-templates", TestContext.Current.CancellationToken))!.Items);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync(
            $"/api/v1/component-templates/{created.TemplateId:D}", TestContext.Current.CancellationToken)).StatusCode);
        Assert.NotNull(await client.GetFromJsonAsync<ComponentTemplateResponse>(
            $"/api/v1/component-templates/{created.TemplateId:D}/versions/1",
            TestContext.Current.CancellationToken));
    }

    [Fact]
    public async Task Invalid_envelope_duplicate_code_and_missing_concurrency_token_are_rejected()
    {
        await using var factory = new TechmapWebApplicationFactory();
        using var client = factory.CreateLocalClient();
        var csrf = await StartSessionAsync(client);
        using var valid = Content("shape");
        var request = new CreateComponentTemplateRequest("SERIES", "Series", [], valid.RootElement.Clone());
        using var accepted = await SendAsync(client, HttpMethod.Post, "/api/v1/component-templates", request, csrf);
        var created = await accepted.Content.ReadFromJsonAsync<ComponentTemplateResponse>(TestContext.Current.CancellationToken);

        using var duplicate = await SendAsync(
            client, HttpMethod.Post, "/api/v1/component-templates", request with { Code = " series " }, csrf);
        Assert.Equal(HttpStatusCode.Conflict, duplicate.StatusCode);
        Assert.Equal("component_template_code_conflict", (await duplicate.Content
            .ReadFromJsonAsync<ApiErrorResponse>(TestContext.Current.CancellationToken))?.Error);

        using var badContent = JsonDocument.Parse(
            """
            {"schemaVersion":1,"views":[
              {"id":"e4","name":"E4","kind":"e4","primitives":[],"contactPoints":[]},
              {"id":"other","name":"Other","kind":"additional","primitives":[],"contactPoints":[]}]}
            """);
        using var invalid = await SendAsync(
            client, HttpMethod.Put, $"/api/v1/component-templates/{created!.TemplateId:D}",
            new UpdateComponentTemplateRequest(
                1, "SERIES", "Series", [], badContent.RootElement.Clone()), csrf);
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
        Assert.Equal("component_template_content_invalid", (await invalid.Content
            .ReadFromJsonAsync<ApiErrorResponse>(TestContext.Current.CancellationToken))?.Error);

        using var missing = await SendAsync(
            client, HttpMethod.Delete, $"/api/v1/component-templates/{created.TemplateId:D}",
            new DeleteComponentTemplateRequest(null), csrf);
        Assert.Equal(HttpStatusCode.BadRequest, missing.StatusCode);
        var current = await client.GetFromJsonAsync<ComponentTemplateResponse>(
            $"/api/v1/component-templates/{created.TemplateId:D}", TestContext.Current.CancellationToken);
        Assert.Equal(1, current?.Version);
    }

    [Theory]
    [InlineData("{\"id\":\"p\",\"kind\":\"path\",\"x\":0,\"y\":0,\"width\":1,\"height\":1,\"color\":\"#000000\",\"text\":\"\"}")]
    [InlineData("{\"id\":\"p\",\"kind\":\"line\",\"x\":1e999,\"y\":0,\"width\":1,\"height\":1,\"color\":\"#000000\",\"text\":\"\"}")]
    [InlineData("{\"id\":\"p\",\"kind\":\"line\",\"x\":0,\"y\":0,\"width\":1,\"height\":1,\"color\":\"red\",\"text\":\"\"}")]
    [InlineData("{\"id\":\"p\",\"kind\":\"line\",\"x\":0,\"y\":0,\"width\":1,\"height\":1,\"color\":\"#000000\",\"text\":\"\",\"extra\":true}")]
    public async Task Primitive_shape_that_the_client_cannot_render_is_rejected(string primitiveJson)
    {
        await using var factory = new TechmapWebApplicationFactory();
        using var client = factory.CreateLocalClient();
        var csrf = await StartSessionAsync(client);
        using var content = JsonDocument.Parse(
            $$"""
            {"schemaVersion":1,"views":[
              {"id":"e4","name":"E4","kind":"e4","primitives":[{{primitiveJson}}],"contactPoints":[]},
              {"id":"drawing","name":"Drawing","kind":"drawing","primitives":[],"contactPoints":[]}]}
            """);

        using var response = await SendAsync(
            client,
            HttpMethod.Post,
            "/api/v1/component-templates",
            new CreateComponentTemplateRequest("BAD", "Invalid", [], content.RootElement.Clone()),
            csrf);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("component_template_content_invalid", (await response.Content
            .ReadFromJsonAsync<ApiErrorResponse>(TestContext.Current.CancellationToken))?.Error);
        Assert.Empty((await client.GetFromJsonAsync<ComponentTemplateListResponse>(
            "/api/v1/component-templates", TestContext.Current.CancellationToken))!.Items);
    }

    [Fact]
    public async Task Contact_shape_and_global_ids_are_strictly_validated()
    {
        await using var factory = new TechmapWebApplicationFactory();
        using var client = factory.CreateLocalClient();
        var csrf = await StartSessionAsync(client);
        using var content = JsonDocument.Parse(
            """
            {"schemaVersion":1,"views":[
              {"id":"shared","name":"E4","kind":"e4","primitives":[],"contactPoints":[{"id":"shared","name":"Pin","contactNumber":"1","direction":"diagonal","x":0,"y":0}]},
              {"id":"drawing","name":"Drawing","kind":"drawing","primitives":[],"contactPoints":[]}]}
            """);

        using var response = await SendAsync(
            client,
            HttpMethod.Post,
            "/api/v1/component-templates",
            new CreateComponentTemplateRequest("BAD", "Invalid", [], content.RootElement.Clone()),
            csrf);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("component_template_content_invalid", (await response.Content
            .ReadFromJsonAsync<ApiErrorResponse>(TestContext.Current.CancellationToken))?.Error);
    }

    private static JsonDocument Content(string primitiveId) => JsonDocument.Parse(
        $$"""
        {"schemaVersion":1,"views":[
          {"id":"e4","name":"Схема Э4","kind":"e4","primitives":[{"id":"{{primitiveId}}","kind":"line","x":10,"y":20,"width":100,"height":0,"color":"#27445a","text":""}],"contactPoints":[]},
          {"id":"drawing","name":"Чертеж","kind":"drawing","primitives":[],"contactPoints":[]},
          {"id":"pinout","name":"Контакты","kind":"additional","primitives":[],"contactPoints":[]}]}
        """);

    private static async Task<string> StartSessionAsync(HttpClient client)
    {
        using var page = await client.GetAsync("/", TestContext.Current.CancellationToken);
        page.EnsureSuccessStatusCode();
        return (await client.GetFromJsonAsync<SessionBootstrapResponse>(
            "/api/v1/session", TestContext.Current.CancellationToken))!.CsrfNonce;
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
}
