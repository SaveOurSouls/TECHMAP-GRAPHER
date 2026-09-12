using System.Reflection;
using System.Text.Json;

namespace Techmap.Web;

public sealed record ProductVersion(string AppVersion, string SchemaVersion)
{
    public static ProductVersion Read(string programRoot)
    {
        var versionPath = Path.Combine(programRoot, "VERSION.json");
        if (!File.Exists(versionPath))
        {
            var fallback = Assembly.GetEntryAssembly()?
                .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?
                .InformationalVersion ?? "0.1.0-dev";
            return new ProductVersion(fallback, "0");
        }

        try
        {
            using var document = JsonDocument.Parse(File.ReadAllText(versionPath));
            var root = document.RootElement;
            var appVersion = root.GetProperty("appVersion").GetString();
            var schemaVersion = root.GetProperty("storage").GetProperty("schema").GetInt32();
            if (string.IsNullOrWhiteSpace(appVersion) || schemaVersion < 0)
            {
                throw new InvalidDataException("VERSION.json contains invalid product versions.");
            }

            return new ProductVersion(appVersion, schemaVersion.ToString(System.Globalization.CultureInfo.InvariantCulture));
        }
        catch (Exception exception) when (
            exception is JsonException or KeyNotFoundException or InvalidOperationException)
        {
            throw new InvalidDataException("VERSION.json is invalid.", exception);
        }
    }
}
