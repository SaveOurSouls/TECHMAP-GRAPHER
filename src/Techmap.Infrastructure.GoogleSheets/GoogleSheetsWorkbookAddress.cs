using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace Techmap.Infrastructure.GoogleSheets;

public sealed record GoogleSheetsWorkbookAddress(
    Uri ExportUri,
    string SafeFileName,
    string StableSourceLabel);

public static partial class GoogleSheetsWorkbookAddressParser
{
    public const int MaximumUrlCharacters = 4_096;

    private static readonly HashSet<string> AllowedQueryKeys = new(StringComparer.Ordinal)
    {
        "gid",
        "format",
        "output",
        "usp",
    };

    public static GoogleSheetsWorkbookAddress Parse(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            throw Invalid("Укажите полную публичную ссылку Google Sheets.");
        }
        var normalized = value.Trim();
        if (normalized.Length > MaximumUrlCharacters ||
            !Uri.TryCreate(normalized, UriKind.Absolute, out var uri))
            throw Invalid("Ссылка Google Sheets имеет недопустимый формат или длину.");

        if (!string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.Ordinal) ||
            !string.Equals(uri.IdnHost, "docs.google.com", StringComparison.Ordinal) ||
            !string.Equals(uri.Host, uri.IdnHost, StringComparison.Ordinal) ||
            !uri.IsDefaultPort ||
            uri.Host.EndsWith(".", StringComparison.Ordinal) ||
            !string.IsNullOrEmpty(uri.UserInfo))
        {
            throw Invalid("Разрешена только HTTPS-ссылка на публичную таблицу docs.google.com.");
        }

        var gid = ValidateQuery(uri.Query);
        ValidateFragment(uri.Fragment);

        var published = PublishedPath().Match(uri.AbsolutePath);
        var ordinary = OrdinaryPath().Match(uri.AbsolutePath);
        var match = published.Success ? published : ordinary;
        if (!match.Success)
        {
            throw Invalid("Ссылка должна вести на /spreadsheets/d/{id} или /spreadsheets/d/e/{publishedId}.");
        }

        var identifier = match.Groups["id"].Value;
        var exportPath = published.Success
            ? $"https://docs.google.com/spreadsheets/d/e/{identifier}/pub?output=xlsx"
            : $"https://docs.google.com/spreadsheets/d/{identifier}/export?format=xlsx";
        if (gid is not null)
            exportPath += $"&gid={gid}";
        var exportUri = new Uri(exportPath);
        var identityHash = Convert.ToHexStringLower(SHA256.HashData(
            Encoding.UTF8.GetBytes($"{(published.Success ? "published" : "workbook")}\n{identifier}\n{gid ?? ""}")));
        var sourceLabel = $"google-sheet:{identityHash}";
        return new GoogleSheetsWorkbookAddress(
            exportUri,
            $"google-sheet-{identityHash}.xlsx",
            sourceLabel);
    }

    private static string? ValidateQuery(string query)
    {
        if (query.Length <= 1)
            return null;

        var seen = new HashSet<string>(StringComparer.Ordinal);
        string? gid = null;
        foreach (var item in query[1..].Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var pair = item.Split('=', 2);
            var key = DecodeQueryPart(pair[0]);
            if (!AllowedQueryKeys.Contains(key) || !seen.Add(key))
                throw Invalid("Ссылка Google Sheets содержит неподдерживаемые параметры.");
            var value = pair.Length == 2 ? DecodeQueryPart(pair[1]) : string.Empty;
            if (value.Any(char.IsControl))
                throw Invalid("Ссылка Google Sheets содержит недопустимый параметр.");
            if (key == "gid")
            {
                if (!Regex.IsMatch(value, "^[0-9]+$", RegexOptions.CultureInvariant) || value.Length > 20)
                    throw Invalid("Параметр gid должен быть неотрицательным номером листа.");
                gid = value;
            }
            else if (key == "format" && value is not ("xlsx" or "csv"))
            {
                throw Invalid("Формат ссылки Google Sheets не поддерживается.");
            }
            else if (key == "output" && value is not ("xlsx" or "csv" or "html"))
            {
                throw Invalid("Формат публикации Google Sheets не поддерживается.");
            }
            else if (key == "usp" && value is not ("sharing" or "drive_link"))
            {
                throw Invalid("Ссылка Google Sheets содержит неподдерживаемый режим доступа.");
            }
        }
        return gid;
    }

    private static string DecodeQueryPart(string value)
    {
        for (var index = 0; index < value.Length; index++)
        {
            if (value[index] != '%')
                continue;
            if (index + 2 >= value.Length ||
                !IsHex(value[index + 1]) ||
                !IsHex(value[index + 2]))
            {
                throw Invalid("Ссылка Google Sheets содержит повреждённый параметр.");
            }
            index += 2;
        }

        return Uri.UnescapeDataString(value);
    }

    private static bool IsHex(char value) =>
        value is >= '0' and <= '9' or >= 'a' and <= 'f' or >= 'A' and <= 'F';

    private static void ValidateFragment(string fragment)
    {
        if (fragment.Length <= 1)
            return;
        if (!Fragment().IsMatch(fragment))
            throw Invalid("Ссылка Google Sheets содержит неподдерживаемый фрагмент.");
    }

    private static GoogleSheetsDownloadException Invalid(string message) =>
        new("google_sheets_url_invalid", message);

    [GeneratedRegex("^/spreadsheets/d/(?<id>[A-Za-z0-9_-]{10,})(?:/(?:edit|view|preview|export))?/?$", RegexOptions.CultureInvariant)]
    private static partial Regex OrdinaryPath();

    [GeneratedRegex("^/spreadsheets/d/e/(?<id>[A-Za-z0-9_-]{10,})(?:/(?:pub|pubhtml|preview))?/?$", RegexOptions.CultureInvariant)]
    private static partial Regex PublishedPath();

    [GeneratedRegex("^#gid=[0-9]+$", RegexOptions.CultureInvariant)]
    private static partial Regex Fragment();
}
