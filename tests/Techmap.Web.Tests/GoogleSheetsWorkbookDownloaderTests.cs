using System.Net;
using System.Net.Http.Headers;
using Techmap.Infrastructure.GoogleSheets;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class GoogleSheetsWorkbookDownloaderTests
{
    [Fact]
    public void Browser_tab_parameters_do_not_limit_the_workbook_or_change_its_identity()
    {
        var whole = GoogleSheetsWorkbookAddressParser.Parse("https://docs.google.com/spreadsheets/d/abcdefghijklmnop/edit");
        foreach (var suffix in new[] { "?gid=0#gid=0", "?gid=123", "#gid=456" })
            Assert.Equal(whole, GoogleSheetsWorkbookAddressParser.Parse(
                "https://docs.google.com/spreadsheets/d/abcdefghijklmnop/edit" + suffix));
        Assert.DoesNotContain("gid", whole.ExportUri.Query);
    }

    private static readonly byte[] XlsxHeader = [0x50, 0x4b, 0x03, 0x04, 0x14, 0x00];

    [Theory]
    [InlineData("https://docs.google.com/spreadsheets/d/abcdefghijklmnop/edit?gid=123#gid=123")]
    [InlineData("https://docs.google.com/spreadsheets/d/e/abcdefghijklmnop/pub?output=xlsx#gid=7")]
    public void Public_workbook_urls_are_reduced_to_safe_export_and_label(string url)
    {
        var address = GoogleSheetsWorkbookAddressParser.Parse(url);

        Assert.Equal(Uri.UriSchemeHttps, address.ExportUri.Scheme);
        Assert.Equal("docs.google.com", address.ExportUri.Host);
        Assert.True(
            address.ExportUri.Query.Contains("format=xlsx", StringComparison.Ordinal) ||
            address.ExportUri.Query.Contains("output=xlsx", StringComparison.Ordinal));
        Assert.DoesNotContain("abcdefghijklmnop", address.SafeFileName, StringComparison.Ordinal);
        Assert.Matches("^google-sheet:[0-9a-f]{64}$", address.StableSourceLabel);
    }

    [Theory]
    [InlineData("http://docs.google.com/spreadsheets/d/abcdefghijklmnop")]
    [InlineData("https://evil.example/spreadsheets/d/abcdefghijklmnop")]
    [InlineData("https://docs。google.com/spreadsheets/d/abcdefghijklmnop")]
    [InlineData("https://ｄｏｃｓ.google.com/spreadsheets/d/abcdefghijklmnop")]
    [InlineData("https://docs.google.com/spreadsheets/d/abcdefghijklmnop?foo=bar")]
    [InlineData("https://docs.google.com/spreadsheets/d/abcdefghijklmnop#gid=abc")]
    [InlineData("https://docs.google.com/spreadsheets/d/abcdefghijklmnop?gid=%ZZ")]
    [InlineData("https://docs.google.com/spreadsheets/d/abcdefghijklmnop?%ZZ=1")]
    [InlineData("https://docs.google.com/spreadsheets/d/short")]
    [InlineData("https://docs.google.com/spreadsheets/d/abcdefghijklmnop?gid=%")]
    public void Non_public_or_ambiguous_urls_are_rejected(string url)
    {
        var error = Assert.Throws<GoogleSheetsDownloadException>(() =>
            GoogleSheetsWorkbookAddressParser.Parse(url));

        Assert.Equal("google_sheets_url_invalid", error.Code);
    }

    [Fact]
    public void Oversized_url_is_rejected_before_parsing()
    {
        var error = Assert.Throws<GoogleSheetsDownloadException>(() =>
            GoogleSheetsWorkbookAddressParser.Parse(
                "https://docs.google.com/spreadsheets/d/" +
                new string('a', GoogleSheetsWorkbookAddressParser.MaximumUrlCharacters)));

        Assert.Equal("google_sheets_url_invalid", error.Code);
    }

    [Theory]
    [InlineData("0.0.0.0")]
    [InlineData("10.0.0.1")]
    [InlineData("100.64.0.1")]
    [InlineData("127.0.0.1")]
    [InlineData("168.63.129.16")]
    [InlineData("169.254.169.254")]
    [InlineData("172.16.0.1")]
    [InlineData("192.168.0.1")]
    [InlineData("198.18.0.1")]
    [InlineData("224.0.0.1")]
    [InlineData("255.255.255.255")]
    [InlineData("::")]
    [InlineData("::1")]
    [InlineData("fe80::1")]
    [InlineData("fc00::1")]
    [InlineData("ff02::1")]
    [InlineData("2001:db8::1")]
    [InlineData("2001:2::1")]
    [InlineData("2001:10::1")]
    [InlineData("2002::1")]
    [InlineData("3fff::1")]
    public void Local_metadata_and_special_addresses_are_rejected(string address)
    {
        Assert.False(GoogleSheetsNetworkPolicy.IsPublicAddress(IPAddress.Parse(address)));
    }

    [Theory]
    [InlineData("8.8.8.8")]
    [InlineData("2001:4860:4860::8888")]
    public void Public_addresses_are_accepted(string address)
    {
        Assert.True(GoogleSheetsNetworkPolicy.IsPublicAddress(IPAddress.Parse(address)));
    }

    [Fact]
    public async Task Downloader_does_not_send_cookies_or_follow_forbidden_redirects()
    {
        var handler = new StubHandler((request, _) =>
        {
            Assert.False(request.Headers.Contains("Cookie"));
            Assert.Null(request.Headers.Authorization);
            Assert.Equal("docs.google.com", request.RequestUri?.Host);
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.Redirect)
            {
                Headers = { Location = new Uri("https://evil.example/export.xlsx") },
            });
        });
        using var downloader = new GoogleSheetsWorkbookDownloader(handler);

        var error = await Assert.ThrowsAsync<GoogleSheetsDownloadException>(() =>
            downloader.DownloadAsync(
                "https://docs.google.com/spreadsheets/d/abcdefghijklmnop",
                TestContext.Current.CancellationToken));

        Assert.Equal("google_sheets_redirect_forbidden", error.Code);
    }

    [Fact]
    public async Task Downloader_accepts_only_a_bounded_xlsx_payload()
    {
        var handler = new StubHandler((_, _) => Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new ByteArrayContent(XlsxHeader)
            {
                Headers = { ContentType = new MediaTypeHeaderValue(
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") },
            },
        }));
        using var downloader = new GoogleSheetsWorkbookDownloader(handler);

        var result = await downloader.DownloadAsync(
            "https://docs.google.com/spreadsheets/d/abcdefghijklmnop",
            TestContext.Current.CancellationToken);

        Assert.Equal(XlsxHeader, result.Content);
        Assert.Matches(@"^google-sheet-[0-9a-f]{64}\.xlsx$", result.SafeFileName);
    }

    [Theory]
    [InlineData("https://docs.google.com.evil.example/file")]
    [InlineData("https://docs.google.com./file")]
    [InlineData("https://docs.googlé.com/file")]
    [InlineData("https://doc-aa-bb-sheets。googleusercontent.com/file")]
    [InlineData("https://ｄｏｃ-aa-bb-sheets.googleusercontent.com/file")]
    [InlineData("https://docs.googleusercontent.com/file")]
    [InlineData("https://evil-sheets.googleusercontent.com/file")]
    [InlineData("https://doc-aa-bb-sheets.googleusercontent.com.evil.example/file")]
    [InlineData("http://doc-aa-bb-sheets.googleusercontent.com/file")]
    [InlineData("https://doc-aa-bb-sheets.googleusercontent.com:444/file")]
    [InlineData("https://user@doc-aa-bb-sheets.googleusercontent.com/file")]
    [InlineData("//evil.example/export.xlsx")]
    public async Task Downloader_rejects_lookalike_redirect_hosts(string redirect)
    {
        var handler = RedirectHandler(redirect);
        using var downloader = new GoogleSheetsWorkbookDownloader(handler);

        var error = await Assert.ThrowsAsync<GoogleSheetsDownloadException>(() =>
            downloader.DownloadAsync(
                "https://docs.google.com/spreadsheets/d/abcdefghijklmnop",
                TestContext.Current.CancellationToken));

        Assert.Equal("google_sheets_redirect_forbidden", error.Code);
    }

    [Fact]
    public async Task Downloader_accepts_exact_google_sheets_download_redirect_host()
    {
        var calls = 0;
        var handler = new StubHandler((_, _) => Task.FromResult(++calls == 1
            ? new HttpResponseMessage(HttpStatusCode.Redirect)
            {
                Headers = { Location = new Uri("https://doc-aa-bb-sheets.googleusercontent.com/export/file") },
            }
            : XlsxResponse()));
        using var downloader = new GoogleSheetsWorkbookDownloader(handler);

        var result = await downloader.DownloadAsync(
            "https://docs.google.com/spreadsheets/d/abcdefghijklmnop",
            TestContext.Current.CancellationToken);

        Assert.Equal(XlsxHeader, result.Content);
        Assert.Equal(2, calls);
    }

    [Theory]
    [InlineData("text/html", null)]
    [InlineData("application/json", null)]
    [InlineData(null, null)]
    [InlineData("application/octet-stream", "gzip")]
    [InlineData("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "br")]
    public async Task Downloader_rejects_unexpected_media_type_or_content_encoding(
        string? mediaType,
        string? contentEncoding)
    {
        var response = new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new ByteArrayContent(XlsxHeader),
        };
        if (mediaType is not null)
            response.Content.Headers.ContentType = new MediaTypeHeaderValue(mediaType);
        if (contentEncoding is not null)
            response.Content.Headers.ContentEncoding.Add(contentEncoding);
        var handler = new StubHandler((_, _) => Task.FromResult(response));
        using var downloader = new GoogleSheetsWorkbookDownloader(handler);

        var error = await Assert.ThrowsAsync<GoogleSheetsDownloadException>(() =>
            downloader.DownloadAsync(
                "https://docs.google.com/spreadsheets/d/abcdefghijklmnop",
                TestContext.Current.CancellationToken));

        Assert.Equal(
            contentEncoding is null ? "google_sheets_not_xlsx" : "google_sheets_content_encoding_forbidden",
            error.Code);
    }

    [Fact]
    public async Task Downloader_rejects_declared_oversize_before_reading_body()
    {
        var response = XlsxResponse();
        response.Content.Headers.ContentLength = 25L * 1024 * 1024 + 1;
        var handler = new StubHandler((_, _) => Task.FromResult(response));
        using var downloader = new GoogleSheetsWorkbookDownloader(handler);

        var error = await Assert.ThrowsAsync<GoogleSheetsDownloadException>(() =>
            downloader.DownloadAsync(
                "https://docs.google.com/spreadsheets/d/abcdefghijklmnop",
                TestContext.Current.CancellationToken));

        Assert.Equal("google_sheets_too_large", error.Code);
    }

    [Fact]
    public async Task Downloader_bounds_the_request_duration()
    {
        var handler = new StubHandler(async (_, cancellationToken) =>
        {
            await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
            throw new InvalidOperationException();
        });
        using var downloader = new GoogleSheetsWorkbookDownloader(
            handler,
            TimeSpan.FromMilliseconds(20));

        var error = await Assert.ThrowsAsync<GoogleSheetsDownloadException>(() =>
            downloader.DownloadAsync(
                "https://docs.google.com/spreadsheets/d/abcdefghijklmnop",
                TestContext.Current.CancellationToken));

        Assert.Equal("google_sheets_download_timeout", error.Code);
    }

    [Fact]
    public async Task Downloader_releases_gate_after_caller_cancellation()
    {
        var calls = 0;
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var handler = new StubHandler(async (_, cancellationToken) =>
        {
            if (++calls == 1)
            {
                entered.SetResult();
                await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken);
                throw new InvalidOperationException();
            }
            return XlsxResponse();
        });
        using var downloader = new GoogleSheetsWorkbookDownloader(handler);
        using var cancellation = new CancellationTokenSource();
        var first = downloader.DownloadAsync(
            "https://docs.google.com/spreadsheets/d/abcdefghijklmnop",
            cancellation.Token);
        await entered.Task.WaitAsync(TestContext.Current.CancellationToken);
        cancellation.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => first);
        var result = await downloader.DownloadAsync(
            "https://docs.google.com/spreadsheets/d/abcdefghijklmnop",
            TestContext.Current.CancellationToken);

        Assert.Equal(XlsxHeader, result.Content);
    }

    [Fact]
    public async Task Downloader_rejects_html_login_pages_even_when_status_is_success()
    {
        var handler = new StubHandler((_, _) => Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent("<html>Sign in</html>"),
        }));
        using var downloader = new GoogleSheetsWorkbookDownloader(handler);

        var error = await Assert.ThrowsAsync<GoogleSheetsDownloadException>(() =>
            downloader.DownloadAsync(
                "https://docs.google.com/spreadsheets/d/abcdefghijklmnop",
                TestContext.Current.CancellationToken));

        Assert.Equal("google_sheets_not_xlsx", error.Code);
    }

    [Fact]
    public async Task Downloader_preserves_network_policy_error_wrapped_by_http_handler()
    {
        using var handler = new SocketsHttpHandler
        {
            AllowAutoRedirect = false,
            ConnectCallback = (_, _) => ValueTask.FromException<Stream>(
                new GoogleSheetsDownloadException(
                    "google_sheets_address_forbidden",
                    "Адрес Google Sheets разрешился в локальную или служебную сеть.")),
        };
        using var downloader = new GoogleSheetsWorkbookDownloader(handler);

        var error = await Assert.ThrowsAsync<GoogleSheetsDownloadException>(() =>
            downloader.DownloadAsync(
                "https://docs.google.com/spreadsheets/d/abcdefghijklmnop",
                TestContext.Current.CancellationToken));

        Assert.Equal("google_sheets_address_forbidden", error.Code);
    }

    private sealed class StubHandler(
        Func<HttpRequestMessage, CancellationToken, Task<HttpResponseMessage>> send)
        : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken) => send(request, cancellationToken);
    }

    private static StubHandler RedirectHandler(string location) => new((_, _) =>
        Task.FromResult(new HttpResponseMessage(HttpStatusCode.Redirect)
        {
            Headers = { Location = new Uri(location, UriKind.RelativeOrAbsolute) },
        }));

    private static HttpResponseMessage XlsxResponse()
    {
        var response = new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new ByteArrayContent(XlsxHeader),
        };
        response.Content.Headers.ContentType = new MediaTypeHeaderValue(
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        return response;
    }
}
