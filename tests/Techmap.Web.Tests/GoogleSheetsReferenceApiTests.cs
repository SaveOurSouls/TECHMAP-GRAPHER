using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Techmap.Contracts;
using Techmap.Infrastructure.GoogleSheets;
using Techmap.Web;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class GoogleSheetsReferenceApiTests
{
    private const string Origin = "http://127.0.0.1:18762";
    private const string SourcePath = "/api/v1/reference-sources/technology-coax-cables";
    private const string PublicUrl =
        "https://docs.google.com/spreadsheets/d/abcdefghijklmnop/edit?gid=0#gid=0";
    private const string SafeFileName =
        "google-sheet-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.xlsx";

    [Fact]
    public async Task Google_preview_uses_xlsx_pipeline_and_existing_publication_endpoint()
    {
        var bytes = CoaxWorkbook();
        var downloader = new QueueDownloader(new GoogleSheetsWorkbookDownload(bytes, SafeFileName));
        await using var factory = CreateFactory(downloader);
        using var client = CreateLocalClient(factory);
        var csrf = await StartSessionAsync(client);

        using var xlsxResponse = await SendAsync(
            client,
            SourcePath + "/xlsx-profile-previews",
            new XlsxProfilePreviewRequest(
                "technology.xlsx",
                Convert.ToBase64String(bytes),
                "technology.coax-cables"),
            csrf);
        xlsxResponse.EnsureSuccessStatusCode();
        var xlsx = Assert.IsType<XlsxReferencePreviewResponse>(
            await xlsxResponse.Content.ReadFromJsonAsync<XlsxReferencePreviewResponse>(
                TestContext.Current.CancellationToken));

        var google = await PreviewGoogleAsync(client, csrf);

        Assert.Equal(xlsx.RecordCount, google.RecordCount);
        Assert.Equal(xlsx.Records[0].SourceKey, google.Records[0].SourceKey);
        Assert.Equal(xlsx.Records[0].Payload.GetRawText(), google.Records[0].Payload.GetRawText());
        Assert.Equal(xlsx.Diagnostics.Select(item => item.Code), google.Diagnostics.Select(item => item.Code));
        Assert.Equal(PublicUrl, downloader.RequestedUrls.Single());

        using var publish = await SendAsync(
            client,
            SourcePath + "/xlsx-publications",
            new PublishXlsxReferencePreviewRequest(
                google.PreviewId,
                google.ValidationSha256,
                google.ActiveSnapshotId,
                google.Diagnostics
                    .Where(item => item.Severity == "warning")
                    .Select(item => item.DiagnosticId)
                    .ToArray()),
            csrf);
        publish.EnsureSuccessStatusCode();

        var active = await client.GetFromJsonAsync<ReferenceCatalogSnapshotResponse>(
            SourcePath + "/active",
            TestContext.Current.CancellationToken);
        Assert.Equal(google.SnapshotId, active?.SnapshotId);
        Assert.Equal("xlsx", active?.SourceKind);
        Assert.Equal(SafeFileName, active?.SourceUri);
        Assert.DoesNotContain("abcdefghijklmnop", active?.SourceUri, StringComparison.Ordinal);
    }

    [Fact]
    public async Task Failed_google_refresh_leaves_previous_active_snapshot_unchanged()
    {
        var downloader = new QueueDownloader(
            new GoogleSheetsWorkbookDownload(CoaxWorkbook(), SafeFileName),
            new GoogleSheetsDownloadException(
                "google_sheets_unavailable",
                "Не удалось получить публичную таблицу Google Sheets."));
        await using var factory = CreateFactory(downloader);
        using var client = CreateLocalClient(factory);
        var csrf = await StartSessionAsync(client);
        var first = await PreviewGoogleAsync(client, csrf);
        using (var publish = await SendAsync(
                   client,
                   SourcePath + "/xlsx-publications",
                   new PublishXlsxReferencePreviewRequest(
                       first.PreviewId,
                       first.ValidationSha256,
                       first.ActiveSnapshotId,
                       first.Diagnostics.Where(item => item.Severity == "warning")
                           .Select(item => item.DiagnosticId).ToArray()),
                   csrf))
        {
            publish.EnsureSuccessStatusCode();
        }

        using var failed = await SendAsync(
            client,
            SourcePath + "/google-sheets-profile-previews",
            new GoogleSheetsProfilePreviewRequest(PublicUrl, "technology.coax-cables"),
            csrf);

        Assert.Equal(HttpStatusCode.ServiceUnavailable, failed.StatusCode);
        var error = await failed.Content.ReadFromJsonAsync<ApiErrorResponse>(
            TestContext.Current.CancellationToken);
        Assert.Equal("google_sheets_unavailable", error?.Error);
        var active = await client.GetFromJsonAsync<ReferenceCatalogSnapshotResponse>(
            SourcePath + "/active",
            TestContext.Current.CancellationToken);
        Assert.Equal(first.SnapshotId, active?.SnapshotId);
    }

    [Fact]
    public async Task Google_preview_requires_local_mutation_security_before_download()
    {
        var downloader = new QueueDownloader(
            new GoogleSheetsWorkbookDownload(CoaxWorkbook(), SafeFileName));
        await using var factory = CreateFactory(downloader);
        using var client = CreateLocalClient(factory);

        using var response = await client.PostAsJsonAsync(
            SourcePath + "/google-sheets-profile-previews",
            new GoogleSheetsProfilePreviewRequest(PublicUrl, "technology.coax-cables"),
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Empty(downloader.RequestedUrls);
    }

    [Fact]
    public async Task Profile_source_mismatch_is_rejected_before_download_without_url_disclosure()
    {
        var downloader = new QueueDownloader(
            new GoogleSheetsWorkbookDownload(CoaxWorkbook(), SafeFileName));
        await using var factory = CreateFactory(downloader);
        using var client = CreateLocalClient(factory);
        var csrf = await StartSessionAsync(client);

        using var response = await SendAsync(
            client,
            "/api/v1/reference-sources/wrong-source/google-sheets-profile-previews",
            new GoogleSheetsProfilePreviewRequest(PublicUrl, "technology.coax-cables"),
            csrf);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Empty(downloader.RequestedUrls);
        var body = await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken);
        Assert.DoesNotContain(PublicUrl, body, StringComparison.Ordinal);
        Assert.DoesNotContain("abcdefghijklmnop", body, StringComparison.Ordinal);
    }

    private static byte[] CoaxWorkbook() => new XlsxTestFixtureBuilder()
        .WithWorksheetName("СПР.КАБ")
        .WithHeaders("Кабель", "D1", "D2", "D3")
        .AddRow("RG-58", "0.9", "3.0", "5.0")
        .Build();

    private static WebApplicationFactory<Program> CreateFactory(IGoogleSheetsWorkbookDownloader downloader)
    {
        var factory = new TechmapWebApplicationFactory();
        return factory.WithWebHostBuilder(builder => builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<IGoogleSheetsWorkbookDownloader>();
            services.AddSingleton(downloader);
        }));
    }

    private static HttpClient CreateLocalClient(WebApplicationFactory<Program> factory) =>
        factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            BaseAddress = new Uri(Origin),
        });

    private static async Task<XlsxReferencePreviewResponse> PreviewGoogleAsync(
        HttpClient client,
        string csrf)
    {
        using var response = await SendAsync(
            client,
            SourcePath + "/google-sheets-profile-previews",
            new GoogleSheetsProfilePreviewRequest(PublicUrl, "technology.coax-cables"),
            csrf);
        response.EnsureSuccessStatusCode();
        return Assert.IsType<XlsxReferencePreviewResponse>(
            await response.Content.ReadFromJsonAsync<XlsxReferencePreviewResponse>(
                TestContext.Current.CancellationToken));
    }

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

    private sealed class QueueDownloader : IGoogleSheetsWorkbookDownloader
    {
        private readonly Queue<object> outcomes;

        public QueueDownloader(params object[] outcomes) => this.outcomes = new Queue<object>(outcomes);

        public List<string> RequestedUrls { get; } = [];

        public Task<GoogleSheetsWorkbookDownload> DownloadAsync(
            string publicUrl,
            CancellationToken cancellationToken = default)
        {
            RequestedUrls.Add(publicUrl);
            var outcome = outcomes.Dequeue();
            return outcome is Exception error
                ? Task.FromException<GoogleSheetsWorkbookDownload>(error)
                : Task.FromResult((GoogleSheetsWorkbookDownload)outcome);
        }
    }
}
