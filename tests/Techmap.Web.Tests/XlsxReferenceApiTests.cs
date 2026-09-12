using System.Net;
using System.Net.Http.Json;
using Techmap.Contracts;
using Techmap.Web;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class XlsxReferenceApiTests
{
    private const string Origin = "http://127.0.0.1:18762";
    private const string SourcePath = "/api/v1/reference-sources/technology-database";

    [Fact]
    public async Task Preview_then_publication_uses_verified_server_candidate_and_exposes_active_records()
    {
        await using var factory = new TechmapWebApplicationFactory();
        using var client = factory.CreateLocalClient();
        var csrf = await StartSessionAsync(client);
        var preview = await PreviewAsync(client, csrf, XlsxTestFixtureBuilder.MinimalValidWorkbook());

        Assert.True(preview.CanPublish);
        Assert.NotEqual(Guid.Empty, preview.PreviewId);
        Assert.Equal(1, preview.RecordCount);
        Assert.Null(preview.ActiveSnapshotId);
        Assert.Equal("TER-001", Assert.Single(preview.Records).SourceKey);
        Assert.NotNull(preview.ValidationSha256);

        using var publishedResponse = await SendAsync(
            client,
            SourcePath + "/xlsx-publications",
            new PublishXlsxReferencePreviewRequest(
                preview.PreviewId,
                preview.ValidationSha256,
                ExpectedActiveSnapshotId: null,
                AcknowledgedWarningIds: []),
            csrf);
        Assert.Equal(HttpStatusCode.Created, publishedResponse.StatusCode);
        var publication = await publishedResponse.Content.ReadFromJsonAsync<ReferenceCatalogPublicationResponse>(
            TestContext.Current.CancellationToken);
        Assert.Equal("published", publication?.Status);
        Assert.Equal(preview.SnapshotId, publication?.Snapshot.SnapshotId);

        var active = await client.GetFromJsonAsync<ReferenceCatalogRecordListResponse>(
            SourcePath + "/active/records",
            TestContext.Current.CancellationToken);
        Assert.Equal("TER-001", Assert.Single(active!.Records).SourceKey);
        Assert.Equal("0", active.Records[0].Payload.GetProperty("Value").GetString());
    }

    [Fact]
    public async Task Blocking_formula_preview_cannot_replace_previous_active_snapshot()
    {
        await using var factory = new TechmapWebApplicationFactory();
        using var client = factory.CreateLocalClient();
        var csrf = await StartSessionAsync(client);
        var valid = await PreviewAsync(client, csrf, XlsxTestFixtureBuilder.MinimalValidWorkbook());
        using (var response = await SendAsync(
                   client,
                   SourcePath + "/xlsx-publications",
                   new PublishXlsxReferencePreviewRequest(
                       valid.PreviewId, valid.ValidationSha256, null, []),
                   csrf))
        {
            response.EnsureSuccessStatusCode();
        }

        var invalid = await PreviewAsync(client, csrf, XlsxTestFixtureBuilder.FormulaWorkbook());
        Assert.False(invalid.CanPublish);
        Assert.Contains(invalid.Diagnostics, item => item.Code == "xlsx_formula_not_allowed");
        using var rejected = await SendAsync(
            client,
            SourcePath + "/xlsx-publications",
            new PublishXlsxReferencePreviewRequest(invalid.PreviewId, "invalid", valid.SnapshotId, []),
            csrf);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, rejected.StatusCode);

        var active = await client.GetFromJsonAsync<ReferenceCatalogSnapshotResponse>(
            SourcePath + "/active",
            TestContext.Current.CancellationToken);
        Assert.Equal(valid.SnapshotId, active?.SnapshotId);
    }

    [Fact]
    public async Task Update_preview_returns_exact_active_baseline_and_can_replace_it()
    {
        await using var factory = new TechmapWebApplicationFactory();
        using var client = factory.CreateLocalClient();
        var csrf = await StartSessionAsync(client);
        var first = await PreviewAsync(client, csrf, XlsxTestFixtureBuilder.MinimalValidWorkbook());
        using (var response = await SendAsync(client, SourcePath + "/xlsx-publications",
                   new PublishXlsxReferencePreviewRequest(first.PreviewId, first.ValidationSha256, null, []), csrf))
            response.EnsureSuccessStatusCode();

        var updatedBytes = new XlsxTestFixtureBuilder()
            .AddRow("TER-002", "Terminal 2", "1", "mm")
            .Build();
        var updated = await PreviewAsync(client, csrf, updatedBytes);
        Assert.Equal(first.SnapshotId, updated.ActiveSnapshotId);
        using var published = await SendAsync(client, SourcePath + "/xlsx-publications",
            new PublishXlsxReferencePreviewRequest(
                updated.PreviewId, updated.ValidationSha256, updated.ActiveSnapshotId, []), csrf);

        Assert.Equal(HttpStatusCode.Created, published.StatusCode);
        var result = await published.Content.ReadFromJsonAsync<ReferenceCatalogPublicationResponse>(
            TestContext.Current.CancellationToken);
        Assert.Equal(updated.SnapshotId, result?.Snapshot.SnapshotId);
        Assert.Equal(first.SnapshotId, result?.PreviousActiveSnapshotId);
    }

    [Fact]
    public async Task Empty_or_null_field_mapping_is_rejected_without_server_error()
    {
        await using var factory = new TechmapWebApplicationFactory();
        using var client = factory.CreateLocalClient();
        var csrf = await StartSessionAsync(client);
        var bytes = XlsxTestFixtureBuilder.MinimalValidWorkbook();
        var empty = Request(bytes) with { Fields = [] };
        var invalid = Request(bytes) with { Fields = [null!] };

        using var emptyResponse = await SendAsync(client, SourcePath + "/xlsx-previews", empty, csrf);
        using var nullResponse = await SendAsync(client, SourcePath + "/xlsx-previews", invalid, csrf);

        Assert.Equal(HttpStatusCode.BadRequest, emptyResponse.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, nullResponse.StatusCode);
    }

    [Fact]
    public async Task Preview_rejects_external_relationship_and_requires_local_security_context()
    {
        await using var factory = new TechmapWebApplicationFactory();
        using var client = factory.CreateLocalClient();
        var csrf = await StartSessionAsync(client);
        using var forbidden = await SendAsync(
            client,
            SourcePath + "/xlsx-previews",
            Request(XlsxTestFixtureBuilder.ExternalReferenceWorkbook()),
            csrf);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, forbidden.StatusCode);
        Assert.Equal(
            "xlsx_active_content_not_allowed",
            (await forbidden.Content.ReadFromJsonAsync<ApiErrorResponse>(TestContext.Current.CancellationToken))?.Error);

        using var noSecurity = factory.CreateClient(new Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactoryClientOptions
        {
            BaseAddress = new Uri(Origin),
        });
        using var unauthenticated = await noSecurity.PostAsJsonAsync(
            SourcePath + "/xlsx-previews",
            Request(XlsxTestFixtureBuilder.MinimalValidWorkbook()),
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Forbidden, unauthenticated.StatusCode);
    }

    [Fact]
    public async Task Preview_accepts_passive_https_hyperlink()
    {
        await using var factory = new TechmapWebApplicationFactory();
        using var client = factory.CreateLocalClient();
        var csrf = await StartSessionAsync(client);
        var bytes = new XlsxTestFixtureBuilder()
            .AddRow("TER-001", "Terminal 1", "0", "mm")
            .WithWorksheetHyperlink("B2", new Uri("https://example.test/terminals/TER-001"))
            .Build();

        var preview = await PreviewAsync(client, csrf, bytes);

        Assert.True(preview.CanPublish);
        Assert.Equal("TER-001", Assert.Single(preview.Records).SourceKey);
    }

    private static async Task<XlsxReferencePreviewResponse> PreviewAsync(
        HttpClient client,
        string csrf,
        byte[] bytes)
    {
        using var response = await SendAsync(client, SourcePath + "/xlsx-previews", Request(bytes), csrf);
        response.EnsureSuccessStatusCode();
        return Assert.IsType<XlsxReferencePreviewResponse>(
            await response.Content.ReadFromJsonAsync<XlsxReferencePreviewResponse>(
                TestContext.Current.CancellationToken));
    }

    private static XlsxReferencePreviewRequest Request(byte[] bytes) => new(
        "catalog.xlsx",
        Convert.ToBase64String(bytes),
        "Catalog",
        HeaderRow: 1,
        FirstDataRow: 2,
        EntityType: "terminal",
        KeyColumn: "RecordKey",
        Fields: null);

    private static async Task<string> StartSessionAsync(HttpClient client)
    {
        using var page = await client.GetAsync("/", TestContext.Current.CancellationToken);
        page.EnsureSuccessStatusCode();
        var session = await client.GetFromJsonAsync<SessionBootstrapResponse>(
            "/api/v1/session",
            TestContext.Current.CancellationToken);
        return Assert.IsType<SessionBootstrapResponse>(session).CsrfNonce;
    }

    private static async Task<HttpResponseMessage> SendAsync(
        HttpClient client,
        string path,
        object body,
        string csrf)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, path)
        {
            Content = JsonContent.Create(body),
        };
        request.Headers.TryAddWithoutValidation("Origin", Origin);
        request.Headers.TryAddWithoutValidation(LocalHttpSession.CsrfHeaderName, csrf);
        return await client.SendAsync(request, TestContext.Current.CancellationToken);
    }
}
