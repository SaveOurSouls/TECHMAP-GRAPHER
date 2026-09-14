using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Nodes;
using Techmap.Contracts;
using Techmap.Web;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class ComponentTemplateApiTests
{
    private const string Origin = "http://127.0.0.1:18762";

    [Fact]
    public async Task Api_creates_and_reads_strict_v3_content()
    {
        await using var factory = new TechmapWebApplicationFactory();
        using var client = factory.CreateLocalClient();
        var csrf = await StartSessionAsync(client);
        using var v3Content = JsonDocument.Parse(ComponentTemplateContentV3ValidatorTests.ValidContentJson);

        using var mismatch = await SendAsync(
            client, HttpMethod.Post, "/api/v1/component-templates",
            new CreateComponentTemplateRequest("V3-MISMATCH", "Version 3 mismatch", [], v3Content.RootElement.Clone()), csrf);
        Assert.Equal(HttpStatusCode.BadRequest, mismatch.StatusCode);
        var mismatchError = await mismatch.Content.ReadFromJsonAsync<ApiErrorResponse>(TestContext.Current.CancellationToken);
        Assert.Equal("component_template_bindings_invalid", mismatchError?.Error);
        Assert.Equal("articleBindings", mismatchError?.Field);

        using var create = await SendAsync(
            client, HttpMethod.Post, "/api/v1/component-templates",
            new CreateComponentTemplateRequest(
                "V3", "Version 3",
                [new(" Technology-Database ", " CONNECTOR ", "B2B-XH-A")],
                v3Content.RootElement.Clone()), csrf);

        Assert.Equal(HttpStatusCode.Created, create.StatusCode);
        var created = Assert.IsType<ComponentTemplateResponse>(await create.Content
            .ReadFromJsonAsync<ComponentTemplateResponse>(TestContext.Current.CancellationToken));
        Assert.Equal(3, created.Content.GetProperty("schemaVersion").GetInt32());
        var binding = Assert.Single(created.ArticleBindings);
        Assert.Equal("technology-database", binding.SourceId);
        Assert.Equal("connector", binding.EntityType);
        Assert.Equal("DATA+", created.Content.GetProperty("logicalContacts")[0]
            .GetProperty("circuitText").GetString());
    }

    [Fact]
    public async Task Api_creates_and_reads_v2_content_and_rejects_invalid_v2()
    {
        await using var factory = new TechmapWebApplicationFactory();
        using var client = factory.CreateLocalClient();
        var csrf = await StartSessionAsync(client);
        using var v2Content = JsonDocument.Parse(ComponentTemplateV2StoreTests.V2Content);

        using var create = await SendAsync(
            client,
            HttpMethod.Post,
            "/api/v1/component-templates",
            new CreateComponentTemplateRequest("V2", "Version 2", [], v2Content.RootElement.Clone()),
            csrf);

        Assert.Equal(HttpStatusCode.Created, create.StatusCode);
        var created = Assert.IsType<ComponentTemplateResponse>(await create.Content
            .ReadFromJsonAsync<ComponentTemplateResponse>(TestContext.Current.CancellationToken));
        Assert.Equal(2, created.Content.GetProperty("schemaVersion").GetInt32());
        var read = await client.GetFromJsonAsync<ComponentTemplateResponse>(
            $"/api/v1/component-templates/{created.TemplateId:D}",
            TestContext.Current.CancellationToken);
        Assert.Equal(created.Content.GetRawText(), Assert.IsType<ComponentTemplateResponse>(read).Content.GetRawText());

        using var invalidContent = JsonDocument.Parse(ComponentTemplateV2StoreTests.V2Content.Replace(
            "\"logicalContacts\":[]",
            "\"logicalContacts\":[],\"unexpected\":true",
            StringComparison.Ordinal));
        using var invalid = await SendAsync(
            client,
            HttpMethod.Post,
            "/api/v1/component-templates",
            new CreateComponentTemplateRequest("INVALID-V2", "Invalid", [], invalidContent.RootElement.Clone()),
            csrf);
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
        var error = await invalid.Content.ReadFromJsonAsync<ApiErrorResponse>(TestContext.Current.CancellationToken);
        Assert.Equal("component_template_content_invalid", error?.Error);
        Assert.Equal("content", error?.Field);
    }

    [Fact]
    public async Task Api_v2_asset_metadata_is_atomic_and_in_use_removal_is_a_conflict()
    {
        await using var factory = new TechmapWebApplicationFactory();
        using var client = factory.CreateLocalClient();
        var csrf = await StartSessionAsync(client);
        using var v2Content = JsonDocument.Parse(ComponentTemplateV2StoreTests.V2Content);
        using var create = await SendAsync(
            client, HttpMethod.Post, "/api/v1/component-templates",
            new CreateComponentTemplateRequest("V2-ASSET", "V2 asset", [], v2Content.RootElement.Clone()), csrf);
        var created = Assert.IsType<ComponentTemplateResponse>(await create.Content
            .ReadFromJsonAsync<ComponentTemplateResponse>(TestContext.Current.CancellationToken));

        using var add = await SendAsync(
            client, HttpMethod.Post, $"/api/v1/component-templates/{created.TemplateId:D}/assets",
            new AddComponentTemplateAssetRequest(
                1, "symbol.png", "image/png", Convert.ToBase64String(ComponentTemplateV2StoreTests.Png)), csrf);
        Assert.Equal(HttpStatusCode.OK, add.StatusCode);
        var withAsset = Assert.IsType<ComponentTemplateResponse>(await add.Content
            .ReadFromJsonAsync<ComponentTemplateResponse>(TestContext.Current.CancellationToken));
        var asset = Assert.Single(withAsset.Assets);
        var contentAsset = Assert.Single(withAsset.Content.GetProperty("assets").EnumerateArray());
        Assert.Equal(asset.AssetId, contentAsset.GetProperty("assetId").GetGuid());
        Assert.Equal(asset.Sha256, contentAsset.GetProperty("sha256").GetString());

        var mismatchNode = JsonNode.Parse(withAsset.Content.GetRawText())!.AsObject();
        mismatchNode["assets"]![0]!["fileName"] = "mismatch.png";
        using var mismatchContent = JsonDocument.Parse(mismatchNode.ToJsonString());
        using var mismatch = await SendAsync(
            client, HttpMethod.Put, $"/api/v1/component-templates/{created.TemplateId:D}",
            new UpdateComponentTemplateRequest(
                2, "V2-ASSET", "V2 asset", [], mismatchContent.RootElement.Clone()), csrf);
        Assert.Equal(HttpStatusCode.BadRequest, mismatch.StatusCode);
        var mismatchError = await mismatch.Content
            .ReadFromJsonAsync<ApiErrorResponse>(TestContext.Current.CancellationToken);
        Assert.Equal("component_template_asset_metadata_mismatch", mismatchError?.Error);
        Assert.Equal("content.assets[0]", mismatchError?.Field);

        var referencedNode = JsonNode.Parse(withAsset.Content.GetRawText())!.AsObject();
        referencedNode["views"]![0]!["layers"]![0]!["nodes"]!.AsArray()
            .Add(ComponentTemplateV2StoreTests.ImageNode(asset.AssetId));
        using var referencedContent = JsonDocument.Parse(referencedNode.ToJsonString());
        using var save = await SendAsync(
            client, HttpMethod.Put, $"/api/v1/component-templates/{created.TemplateId:D}",
            new UpdateComponentTemplateRequest(
                2, "V2-ASSET", "V2 asset", [], referencedContent.RootElement.Clone()), csrf);
        Assert.Equal(HttpStatusCode.OK, save.StatusCode);

        using var remove = await SendAsync(
            client, HttpMethod.Delete,
            $"/api/v1/component-templates/{created.TemplateId:D}/assets/{asset.AssetId:D}",
            new RemoveComponentTemplateAssetRequest(3), csrf);
        Assert.Equal(HttpStatusCode.Conflict, remove.StatusCode);
        var removeError = await remove.Content
            .ReadFromJsonAsync<ApiErrorResponse>(TestContext.Current.CancellationToken);
        Assert.Equal("component_template_asset_in_use", removeError?.Error);
        Assert.Equal("content.views[0].layers[0].nodes[0].geometry.assetId", removeError?.Field);
        var current = await client.GetFromJsonAsync<ComponentTemplateResponse>(
            $"/api/v1/component-templates/{created.TemplateId:D}", TestContext.Current.CancellationToken);
        Assert.Equal(3, current?.Version);
        Assert.Single(current!.Assets);
    }

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

    [Fact]
    public async Task Image_assets_are_signature_checked_versioned_and_read_from_immutable_history()
    {
        await using var factory = new TechmapWebApplicationFactory();
        using var client = factory.CreateLocalClient();
        var csrf = await StartSessionAsync(client);
        using var content = Content("line");
        using var create = await SendAsync(
            client,
            HttpMethod.Post,
            "/api/v1/component-templates",
            new CreateComponentTemplateRequest("IMG", "Images", [], content.RootElement.Clone()),
            csrf);
        var created = Assert.IsType<ComponentTemplateResponse>(await create.Content
            .ReadFromJsonAsync<ComponentTemplateResponse>(TestContext.Current.CancellationToken));
        Assert.Empty(created.Assets);

        var png = Convert.FromBase64String(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=");
        using var add = await SendAsync(
            client,
            HttpMethod.Post,
            $"/api/v1/component-templates/{created.TemplateId:D}/assets",
            new AddComponentTemplateAssetRequest(1, "contact.png", "image/png", Convert.ToBase64String(png)),
            csrf);
        Assert.Equal(HttpStatusCode.OK, add.StatusCode);
        var withAsset = Assert.IsType<ComponentTemplateResponse>(await add.Content
            .ReadFromJsonAsync<ComponentTemplateResponse>(TestContext.Current.CancellationToken));
        Assert.Equal(2, withAsset.Version);
        var asset = Assert.Single(withAsset.Assets);
        Assert.Equal("image/png", asset.MediaType);
        Assert.Equal(png.Length, asset.SizeBytes);

        using var read = await client.GetAsync(
            $"/api/v1/component-templates/{created.TemplateId:D}/versions/2/assets/{asset.AssetId:D}/content",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, read.StatusCode);
        Assert.Equal("image/png", read.Content.Headers.ContentType?.MediaType);
        Assert.Equal(png, await read.Content.ReadAsByteArrayAsync(TestContext.Current.CancellationToken));

        using var updateContent = Content("line-updated");
        using var update = await SendAsync(
            client,
            HttpMethod.Put,
            $"/api/v1/component-templates/{created.TemplateId:D}",
            new UpdateComponentTemplateRequest(
                2, "IMG", "Images updated", [], updateContent.RootElement.Clone()),
            csrf);
        var updated = Assert.IsType<ComponentTemplateResponse>(await update.Content
            .ReadFromJsonAsync<ComponentTemplateResponse>(TestContext.Current.CancellationToken));
        Assert.Equal(asset.AssetId, Assert.Single(updated.Assets).AssetId);

        using var remove = await SendAsync(
            client,
            HttpMethod.Delete,
            $"/api/v1/component-templates/{created.TemplateId:D}/assets/{asset.AssetId:D}",
            new RemoveComponentTemplateAssetRequest(3),
            csrf);
        var withoutAsset = Assert.IsType<ComponentTemplateResponse>(await remove.Content
            .ReadFromJsonAsync<ComponentTemplateResponse>(TestContext.Current.CancellationToken));
        Assert.Equal(4, withoutAsset.Version);
        Assert.Empty(withoutAsset.Assets);
        Assert.Single((await client.GetFromJsonAsync<ComponentTemplateResponse>(
            $"/api/v1/component-templates/{created.TemplateId:D}/versions/2",
            TestContext.Current.CancellationToken))!.Assets);

        using var invalid = await SendAsync(
            client,
            HttpMethod.Post,
            $"/api/v1/component-templates/{created.TemplateId:D}/assets",
            new AddComponentTemplateAssetRequest(4, "fake.png", "image/png", Convert.ToBase64String("not png"u8.ToArray())),
            csrf);
        Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
        Assert.Equal("component_template_asset_content_invalid", (await invalid.Content
            .ReadFromJsonAsync<ApiErrorResponse>(TestContext.Current.CancellationToken))?.Error);
    }

    [Fact]
    public async Task Image_assets_reject_truncated_containers_and_oversized_dimensions()
    {
        await using var factory = new TechmapWebApplicationFactory();
        using var client = factory.CreateLocalClient();
        var csrf = await StartSessionAsync(client);
        using var content = Content("image-validation");
        using var create = await SendAsync(
            client, HttpMethod.Post, "/api/v1/component-templates",
            new CreateComponentTemplateRequest("IMG-INVALID", "Invalid images", [], content.RootElement.Clone()),
            csrf);
        var template = Assert.IsType<ComponentTemplateResponse>(await create.Content
            .ReadFromJsonAsync<ComponentTemplateResponse>(TestContext.Current.CancellationToken));

        var validPng = Convert.FromBase64String(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=");
        foreach (var invalidBytes in new[]
                 {
                     validPng[..^8],
                     PngWithDimensions(20_000, 1),
                     PngWithDimensions(11_000, 10_000),
                     PngWithInvalidImageData(),
                     IndexedPngWithoutPalette(),
                 })
        {
            using var response = await SendAsync(
                client,
                HttpMethod.Post,
                $"/api/v1/component-templates/{template.TemplateId:D}/assets",
                new AddComponentTemplateAssetRequest(
                    1, "invalid.png", "image/png", Convert.ToBase64String(invalidBytes)),
                csrf);
            Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
            Assert.Equal("component_template_asset_content_invalid", (await response.Content
                .ReadFromJsonAsync<ApiErrorResponse>(TestContext.Current.CancellationToken))?.Error);
        }

        using var jpeg = await SendAsync(
            client,
            HttpMethod.Post,
            $"/api/v1/component-templates/{template.TemplateId:D}/assets",
            new AddComponentTemplateAssetRequest(
                1, "empty-scan.jpg", "image/jpeg", Convert.ToBase64String(JpegWithoutEntropy())),
            csrf);
        Assert.Equal(HttpStatusCode.BadRequest, jpeg.StatusCode);
        Assert.Equal("component_template_asset_type_unsupported", (await jpeg.Content
            .ReadFromJsonAsync<ApiErrorResponse>(TestContext.Current.CancellationToken))?.Error);

        var current = await client.GetFromJsonAsync<ComponentTemplateResponse>(
            $"/api/v1/component-templates/{template.TemplateId:D}", TestContext.Current.CancellationToken);
        Assert.Equal(1, current?.Version);
        Assert.Empty(current!.Assets);
    }

    private static byte[] PngWithDimensions(int width, int height)
    {
        var bytes = Convert.FromBase64String(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=");
        System.Buffers.Binary.BinaryPrimitives.WriteInt32BigEndian(bytes.AsSpan(16, 4), width);
        System.Buffers.Binary.BinaryPrimitives.WriteInt32BigEndian(bytes.AsSpan(20, 4), height);
        var crc = PngCrc(bytes.AsSpan(12, 17));
        System.Buffers.Binary.BinaryPrimitives.WriteUInt32BigEndian(bytes.AsSpan(29, 4), crc);
        return bytes;
    }

    private static byte[] PngWithInvalidImageData()
    {
        var bytes = Convert.FromBase64String(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=");
        bytes[41] = 0;
        var crc = PngCrc(bytes.AsSpan(37, 15));
        System.Buffers.Binary.BinaryPrimitives.WriteUInt32BigEndian(bytes.AsSpan(52, 4), crc);
        return bytes;
    }

    private static byte[] IndexedPngWithoutPalette()
    {
        var bytes = Convert.FromBase64String(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=");
        bytes[24] = 8;
        bytes[25] = 3;
        var crc = PngCrc(bytes.AsSpan(12, 17));
        System.Buffers.Binary.BinaryPrimitives.WriteUInt32BigEndian(bytes.AsSpan(29, 4), crc);
        return bytes;
    }

    private static byte[] JpegWithoutEntropy() =>
    [
        0xff, 0xd8,
        0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00,
        0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00,
        0xff, 0xd9,
    ];

    private static uint PngCrc(ReadOnlySpan<byte> value)
    {
        var crc = uint.MaxValue;
        foreach (var octet in value)
        {
            crc ^= octet;
            for (var bit = 0; bit < 8; bit++)
                crc = (crc & 1) != 0 ? 0xedb88320U ^ (crc >> 1) : crc >> 1;
        }
        return ~crc;
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
