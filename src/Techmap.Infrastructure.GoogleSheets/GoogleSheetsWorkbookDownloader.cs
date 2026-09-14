using System.Buffers;
using System.Net;
using System.Net.Http.Headers;
using Techmap.Infrastructure.Xlsx;

namespace Techmap.Infrastructure.GoogleSheets;

public sealed record GoogleSheetsWorkbookDownload(
    byte[] Content,
    string SafeFileName);

public interface IGoogleSheetsWorkbookDownloader
{
    Task<GoogleSheetsWorkbookDownload> DownloadAsync(
        string publicUrl,
        CancellationToken cancellationToken = default);
}

public sealed class GoogleSheetsDownloadException : IOException
{
    public GoogleSheetsDownloadException(string code, string message, Exception? innerException = null)
        : base(message, innerException) => Code = code;

    public string Code { get; }
}

public sealed class GoogleSheetsWorkbookDownloader : IGoogleSheetsWorkbookDownloader, IDisposable
{
    public const int MaximumRedirects = 3;
    public const int MaximumConcurrentDownloads = 1;
    public static readonly TimeSpan DownloadTimeout = TimeSpan.FromSeconds(30);

    private readonly HttpMessageInvoker http;
    private readonly SemaphoreSlim gate = new(MaximumConcurrentDownloads, MaximumConcurrentDownloads);
    private readonly bool ownsHttp;
    private readonly TimeSpan timeout;

    public GoogleSheetsWorkbookDownloader(
        HttpMessageHandler handler,
        TimeSpan? timeout = null,
        bool disposeHandler = true)
    {
        ArgumentNullException.ThrowIfNull(handler);
        if (timeout is { } duration && (duration <= TimeSpan.Zero || duration > DownloadTimeout))
            throw new ArgumentOutOfRangeException(nameof(timeout));
        http = new HttpMessageInvoker(handler, disposeHandler);
        ownsHttp = true;
        this.timeout = timeout ?? DownloadTimeout;
    }

    private GoogleSheetsWorkbookDownloader(HttpMessageInvoker http)
    {
        this.http = http;
        ownsHttp = true;
        timeout = DownloadTimeout;
    }

    public static GoogleSheetsWorkbookDownloader CreateDefault()
    {
        var handler = new SocketsHttpHandler
        {
            AllowAutoRedirect = false,
            AutomaticDecompression = DecompressionMethods.None,
            UseCookies = false,
            Credentials = null,
            UseProxy = false,
            ConnectCallback = GoogleSheetsNetworkPolicy.ConnectPublicAsync,
        };
        return new GoogleSheetsWorkbookDownloader(new HttpMessageInvoker(handler, disposeHandler: true));
    }

    public async Task<GoogleSheetsWorkbookDownload> DownloadAsync(
        string publicUrl,
        CancellationToken cancellationToken = default)
    {
        var address = GoogleSheetsWorkbookAddressParser.Parse(publicUrl);
        if (!await gate.WaitAsync(0, cancellationToken).ConfigureAwait(false))
        {
            throw new GoogleSheetsDownloadException(
                "google_sheets_download_busy",
                "Дождитесь завершения текущей загрузки Google Sheets.");
        }

        try
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(this.timeout);
            try
            {
                var content = await DownloadCoreAsync(address.ExportUri, timeout.Token).ConfigureAwait(false);
                return new GoogleSheetsWorkbookDownload(content, address.SafeFileName);
            }
            catch (OperationCanceledException error) when (!cancellationToken.IsCancellationRequested)
            {
                throw new GoogleSheetsDownloadException(
                    "google_sheets_download_timeout",
                    "Google Sheets не ответил за отведённое время.",
                    error);
            }
            catch (HttpRequestException error)
            {
                if (FindDownloadException(error) is { } policyError)
                    throw policyError;
                throw new GoogleSheetsDownloadException(
                    "google_sheets_unavailable",
                    "Не удалось получить публичную таблицу Google Sheets.",
                    error);
            }
        }
        finally
        {
            gate.Release();
        }
    }

    private static GoogleSheetsDownloadException? FindDownloadException(Exception error)
    {
        for (Exception? current = error; current is not null; current = current.InnerException)
        {
            if (current is GoogleSheetsDownloadException downloadError)
                return downloadError;
        }
        return null;
    }

    public void Dispose()
    {
        if (ownsHttp)
            http.Dispose();
        gate.Dispose();
    }

    private async Task<byte[]> DownloadCoreAsync(Uri initialUri, CancellationToken cancellationToken)
    {
        var current = initialUri;
        for (var redirectCount = 0; ; redirectCount++)
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, current);
            request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue(
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"));
            request.Headers.UserAgent.ParseAdd("TECHMAP-GRAPHER/1.0");
            using var response = await http.SendAsync(request, cancellationToken).ConfigureAwait(false);

            if (IsRedirect(response.StatusCode))
            {
                if (redirectCount >= MaximumRedirects)
                {
                    throw new GoogleSheetsDownloadException(
                        "google_sheets_redirect_limit",
                        "Google Sheets вернул слишком много перенаправлений.");
                }
                current = ResolveRedirect(current, response.Headers.Location);
                continue;
            }

            if (response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
            {
                throw new GoogleSheetsDownloadException(
                    "google_sheets_access_denied",
                    "Таблица Google Sheets недоступна без авторизации. Опубликуйте её для чтения по ссылке.");
            }
            if (response.StatusCode == HttpStatusCode.NotFound)
            {
                throw new GoogleSheetsDownloadException(
                    "google_sheets_not_found",
                    "Публичная таблица Google Sheets не найдена.");
            }
            if (!response.IsSuccessStatusCode)
            {
                throw new GoogleSheetsDownloadException(
                    "google_sheets_unavailable",
                    $"Google Sheets вернул ошибку HTTP {(int)response.StatusCode}.");
            }

            if (response.Content.Headers.ContentLength is long length &&
                length > XlsxReferenceCatalogReader.MaximumInputBytes)
            {
                throw TooLarge();
            }
            var mediaType = response.Content.Headers.ContentType?.MediaType;
            if (!string.Equals(
                    mediaType,
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    StringComparison.OrdinalIgnoreCase) &&
                !string.Equals(mediaType, "application/octet-stream", StringComparison.OrdinalIgnoreCase))
            {
                throw NotXlsx();
            }
            if (response.Content.Headers.ContentEncoding.Any(encoding =>
                    !string.Equals(encoding, "identity", StringComparison.OrdinalIgnoreCase)))
            {
                throw new GoogleSheetsDownloadException(
                    "google_sheets_content_encoding_forbidden",
                    "Google Sheets вернул сжатое содержимое в неподдерживаемом формате.");
            }

            await using var source = await response.Content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false);
            var bytes = await ReadBoundedAsync(source, cancellationToken).ConfigureAwait(false);
            if (bytes.Length < 4 || bytes[0] != (byte)'P' || bytes[1] != (byte)'K' ||
                bytes[2] != 3 || bytes[3] != 4)
            {
                throw NotXlsx();
            }
            return bytes;
        }
    }

    private static async Task<byte[]> ReadBoundedAsync(Stream source, CancellationToken cancellationToken)
    {
        using var destination = new MemoryStream();
        var buffer = ArrayPool<byte>.Shared.Rent(64 * 1024);
        try
        {
            while (true)
            {
                var read = await source.ReadAsync(buffer.AsMemory(0, buffer.Length), cancellationToken)
                    .ConfigureAwait(false);
                if (read == 0)
                    return destination.ToArray();
                if (destination.Length + read > XlsxReferenceCatalogReader.MaximumInputBytes)
                    throw TooLarge();
                destination.Write(buffer, 0, read);
            }
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(buffer);
        }
    }

    private static Uri ResolveRedirect(Uri current, Uri? location)
    {
        if (location is null)
        {
            throw new GoogleSheetsDownloadException(
                "google_sheets_redirect_invalid",
                "Google Sheets вернул перенаправление без адреса.");
        }
        var resolved = location.IsAbsoluteUri ? location : new Uri(current, location);
        if (!IsAllowedDownloadUri(resolved))
        {
            throw new GoogleSheetsDownloadException(
                "google_sheets_redirect_forbidden",
                "Google Sheets перенаправил загрузку на недопустимый адрес.");
        }
        return resolved;
    }

    private static bool IsAllowedDownloadUri(Uri uri)
    {
        if (!string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.Ordinal) ||
            !string.Equals(uri.Host, uri.IdnHost, StringComparison.Ordinal) ||
            !uri.IsDefaultPort ||
            uri.Host.EndsWith(".", StringComparison.Ordinal) ||
            !string.IsNullOrEmpty(uri.UserInfo))
            return false;
        var host = uri.IdnHost;
        return string.Equals(host, "docs.google.com", StringComparison.Ordinal) ||
               IsGoogleSheetsDownloadHost(host);
    }

    private static bool IsGoogleSheetsDownloadHost(string host)
    {
        const string prefix = "doc-";
        const string suffix = "-sheets.googleusercontent.com";
        if (!host.StartsWith(prefix, StringComparison.Ordinal) ||
            !host.EndsWith(suffix, StringComparison.Ordinal))
            return false;
        var shard = host[prefix.Length..^suffix.Length];
        return shard.Length == 5 && shard[2] == '-' &&
               shard.Where((_, index) => index != 2).All(IsLowerAlphaNumeric);
    }

    private static bool IsLowerAlphaNumeric(char value) =>
        value is >= 'a' and <= 'z' or >= '0' and <= '9';

    private static bool IsRedirect(HttpStatusCode statusCode) => statusCode is
        HttpStatusCode.MovedPermanently or
        HttpStatusCode.Redirect or
        HttpStatusCode.RedirectMethod or
        HttpStatusCode.TemporaryRedirect or
        HttpStatusCode.PermanentRedirect;

    private static GoogleSheetsDownloadException TooLarge() => new(
        "google_sheets_too_large",
        $"Таблица Google Sheets превышает допустимый размер {XlsxReferenceCatalogReader.MaximumInputBytes / 1024 / 1024} МиБ.");

    private static GoogleSheetsDownloadException NotXlsx() => new(
        "google_sheets_not_xlsx",
        "Google Sheets вернул страницу входа или данные не в формате XLSX.");
}
