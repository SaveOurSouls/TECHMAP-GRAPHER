using Microsoft.AspNetCore.Http;

namespace Techmap.Web;

public static class PathBaseConfiguration
{
    public static PathString Parse(string[] args)
    {
        const string prefix = "--path-base=";
        var values = args
            .Where(argument => argument.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            .Select(argument => argument[prefix.Length..])
            .ToArray();

        if (values.Length > 1)
        {
            throw new ArgumentException("--path-base can be specified only once.");
        }

        var value = values.SingleOrDefault() ?? "/";
        if (value == "/")
        {
            return PathString.Empty;
        }

        if (string.IsNullOrWhiteSpace(value) ||
            !value.StartsWith("/", StringComparison.Ordinal) ||
            value.EndsWith("/", StringComparison.Ordinal) ||
            value.Contains("//", StringComparison.Ordinal) ||
            value.Contains('\\') ||
            value.Contains('?') ||
            value.Contains('#') ||
            value.Split('/').Any(segment => segment is "." or ".."))
        {
            throw new ArgumentException(
                "--path-base must be '/' or a canonical path such as '/techmap'.");
        }

        return new PathString(value);
    }

    public static string Display(PathString pathBase) => pathBase.HasValue ? $"{pathBase}/" : "/";

    public static string ApiBase(PathString pathBase) => $"{pathBase}/api/v1/";
}
