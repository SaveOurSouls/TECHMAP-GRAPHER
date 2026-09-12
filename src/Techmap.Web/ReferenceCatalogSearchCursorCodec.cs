using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.WebUtilities;
using Techmap.Application;
using Techmap.Contracts;

namespace Techmap.Web;

public sealed class ReferenceCatalogSearchCursorCodec
{
    public const int MaximumCursorLength = 4096;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly byte[] key = RandomNumberGenerator.GetBytes(32);

    public string Encode(
        string sourceId,
        Guid snapshotId,
        string snapshotSha256,
        string querySha256,
        int pageSize,
        ReferenceCatalogSearchPosition position)
    {
        var payload = new CursorPayload(
            1, sourceId, snapshotId, snapshotSha256, querySha256, pageSize,
            position, DateTimeOffset.UtcNow.AddMinutes(30));
        var bytes = JsonSerializer.SerializeToUtf8Bytes(payload, JsonOptions);
        var signature = HMACSHA256.HashData(key, bytes);
        return $"{WebEncoders.Base64UrlEncode(bytes)}.{WebEncoders.Base64UrlEncode(signature)}";
    }

    public DecodedReferenceCatalogCursor Decode(
        string cursor,
        string expectedSourceId,
        string expectedQuerySha256,
        int expectedPageSize)
    {
        if (string.IsNullOrWhiteSpace(cursor) || cursor.Length > MaximumCursorLength)
            throw Invalid();
        var separator = cursor.IndexOf('.');
        if (separator <= 0 || separator != cursor.LastIndexOf('.') || separator == cursor.Length - 1)
            throw Invalid();
        byte[] payloadBytes;
        byte[] signature;
        try
        {
            payloadBytes = WebEncoders.Base64UrlDecode(cursor[..separator]);
            signature = WebEncoders.Base64UrlDecode(cursor[(separator + 1)..]);
        }
        catch (FormatException) { throw Invalid(); }
        var expected = HMACSHA256.HashData(key, payloadBytes);
        if (signature.Length != expected.Length || !CryptographicOperations.FixedTimeEquals(signature, expected))
            throw Invalid();
        CursorPayload? payload;
        try { payload = JsonSerializer.Deserialize<CursorPayload>(payloadBytes, JsonOptions); }
        catch (JsonException) { throw Invalid(); }
        if (payload is null || payload.Version != 1 || payload.SnapshotId == Guid.Empty ||
            payload.Position is null || payload.ExpiresUtc <= DateTimeOffset.UtcNow ||
            payload.PageSize != expectedPageSize ||
            !string.Equals(payload.SourceId, expectedSourceId, StringComparison.Ordinal) ||
            !string.Equals(payload.QuerySha256, expectedQuerySha256, StringComparison.Ordinal) ||
            !IsSha256(payload.SnapshotSha256))
            throw Invalid();
        return new DecodedReferenceCatalogCursor(
            payload.SnapshotId, payload.SnapshotSha256, payload.Position);
    }

    public static string QuerySha256(ReferenceCatalogSearchRequest request)
    {
        var normalized = request with { Cursor = null };
        return Convert.ToHexStringLower(SHA256.HashData(
            JsonSerializer.SerializeToUtf8Bytes(normalized, JsonOptions)));
    }

    private static bool IsSha256(string value) =>
        value.Length == 64 && value.All(character => character is >= '0' and <= '9' or >= 'a' and <= 'f');

    private static ReferenceCatalogSearchCursorException Invalid() => new(
        "catalog_cursor_invalid", "The catalog search cursor is invalid or expired.");

    private sealed record CursorPayload(
        int Version,
        string SourceId,
        Guid SnapshotId,
        string SnapshotSha256,
        string QuerySha256,
        int PageSize,
        ReferenceCatalogSearchPosition Position,
        DateTimeOffset ExpiresUtc);
}

public sealed record DecodedReferenceCatalogCursor(
    Guid SnapshotId,
    string SnapshotSha256,
    ReferenceCatalogSearchPosition Position);

public sealed class ReferenceCatalogSearchCursorException(string code, string message) : Exception(message)
{
    public string Code { get; } = code;
}
