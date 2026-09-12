using System.Net;
using System.Net.Http.Headers;
using Techmap.Contracts;

namespace Techmap.Web;

public static class LocalRequestSecurity
{
    private static readonly string[] MutationMethods =
        [HttpMethods.Post, HttpMethods.Put, HttpMethods.Patch, HttpMethods.Delete];

    public static bool HasExactLoopbackAuthority(HttpContext context, int? testTransportPort = null)
    {
        var localAddress = context.Connection.LocalIpAddress;
        if ((testTransportPort is null || localAddress is not null) &&
            (localAddress is null || !IPAddress.IsLoopback(localAddress)))
        {
            return false;
        }

        var localPort = context.Connection.LocalPort;
        if (testTransportPort is not null && localPort == 0)
        {
            localPort = testTransportPort.Value;
        }

        return context.Request.Scheme.Equals(Uri.UriSchemeHttp, StringComparison.Ordinal) &&
            context.Request.Host.Host.Equals("127.0.0.1", StringComparison.Ordinal) &&
            context.Request.Host.Port == localPort;
    }

    public static string CanonicalOrigin(HttpContext context, int? testTransportPort = null)
    {
        var localPort = context.Connection.LocalPort;
        if (testTransportPort is not null && localPort == 0)
        {
            localPort = testTransportPort.Value;
        }

        return $"http://127.0.0.1:{localPort}";
    }

    public static bool IsApiMutation(HttpRequest request) =>
        request.Path.StartsWithSegments("/api") &&
        MutationMethods.Contains(request.Method, StringComparer.Ordinal);

    public static async Task EnforceApiMutationAsync(
        HttpContext context,
        LocalHttpSession session,
        int? testTransportPort,
        RequestDelegate next)
    {
        if (!IsApiMutation(context.Request))
        {
            await next(context);
            return;
        }

        var expectedOrigin = CanonicalOrigin(context, testTransportPort);
        if (!context.Request.Headers.TryGetValue("Origin", out var origins) ||
            origins.Count != 1 ||
            !string.Equals(origins[0], expectedOrigin, StringComparison.Ordinal))
        {
            await WriteErrorAsync(context, StatusCodes.Status403Forbidden, "invalid_origin");
            return;
        }

        if (!session.HasValidCookie(context.Request))
        {
            await WriteErrorAsync(context, StatusCodes.Status401Unauthorized, "invalid_session");
            return;
        }

        if (!session.HasValidCsrfNonce(context.Request))
        {
            await WriteErrorAsync(context, StatusCodes.Status403Forbidden, "invalid_csrf_nonce");
            return;
        }

        if (!MediaTypeHeaderValue.TryParse(context.Request.ContentType, out var contentType) ||
            !string.Equals(contentType.MediaType, "application/json", StringComparison.OrdinalIgnoreCase))
        {
            await WriteErrorAsync(
                context,
                StatusCodes.Status415UnsupportedMediaType,
                "json_content_type_required");
            return;
        }

        await next(context);
    }

    public static void ApplyResponseHeaders(HttpResponse response)
    {
        response.Headers.ContentSecurityPolicy =
            "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
            "connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; " +
            "form-action 'self'";
        response.Headers.XContentTypeOptions = "nosniff";
        response.Headers.XFrameOptions = "DENY";
        response.Headers["Referrer-Policy"] = "no-referrer";
        response.Headers["Permissions-Policy"] =
            "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=()";
        response.Headers.CacheControl = "no-store";
    }

    private static async Task WriteErrorAsync(HttpContext context, int statusCode, string error)
    {
        context.Response.StatusCode = statusCode;
        await context.Response.WriteAsJsonAsync(new ApiErrorResponse(error));
    }
}
