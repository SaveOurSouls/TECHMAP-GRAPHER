using System.Security.Cryptography;
using Microsoft.AspNetCore.WebUtilities;

namespace Techmap.Web;

public sealed class LocalHttpSession
{
    public const string CookieName = "Techmap.Session";
    public const string CsrfHeaderName = "X-Techmap-CSRF";
    private const int SecretSize = 32;

    private readonly byte[] sessionToken = RandomNumberGenerator.GetBytes(SecretSize);
    private readonly byte[] csrfNonce = RandomNumberGenerator.GetBytes(SecretSize);

    public string InstanceId { get; } = Guid.NewGuid().ToString("D");

    public string EncodedCsrfNonce => WebEncoders.Base64UrlEncode(csrfNonce);

    public void IssueCookie(HttpResponse response, PathString configuredPathBase)
    {
        response.Cookies.Append(
            CookieName,
            WebEncoders.Base64UrlEncode(sessionToken),
            new CookieOptions
            {
                HttpOnly = true,
                SameSite = SameSiteMode.Strict,
                Secure = false,
                IsEssential = true,
                Path = PathBaseConfiguration.Display(configuredPathBase),
            });
    }

    public bool HasValidCookie(HttpRequest request) =>
        request.Cookies.TryGetValue(CookieName, out var value) &&
        HasFixedTimeValue(value, sessionToken);

    public bool HasValidCsrfNonce(HttpRequest request) =>
        request.Headers.TryGetValue(CsrfHeaderName, out var values) &&
        values.Count == 1 &&
        HasFixedTimeValue(values[0], csrfNonce);

    private static bool HasFixedTimeValue(string? encodedValue, ReadOnlySpan<byte> expected)
    {
        if (string.IsNullOrEmpty(encodedValue))
        {
            return false;
        }

        byte[] supplied;
        try
        {
            supplied = WebEncoders.Base64UrlDecode(encodedValue);
        }
        catch (FormatException)
        {
            return false;
        }

        return supplied.Length == expected.Length &&
            CryptographicOperations.FixedTimeEquals(supplied, expected);
    }
}
