using System.Text.Json;

namespace Techmap.Web;

public static class DataRootLayout
{
    public const string MarkerFileName = ".techmap-data-root.json";
    private const string ProductId = "TECHMAP-GRAPHER";
    private const int FormatVersion = 1;

    public static string Initialize(string dataRoot)
    {
        var resolvedRoot = Path.GetFullPath(dataRoot);
        Directory.CreateDirectory(resolvedRoot);
        var markerPath = Path.Combine(resolvedRoot, MarkerFileName);

        if (File.Exists(markerPath))
        {
            ValidateMarker(markerPath);
            return resolvedRoot;
        }

        var temporaryPath = Path.Combine(
            resolvedRoot,
            $"{MarkerFileName}.{Guid.NewGuid():N}.tmp");
        try
        {
            var json = JsonSerializer.Serialize(
                new DataRootMarker(ProductId, FormatVersion),
                new JsonSerializerOptions { WriteIndented = true });
            File.WriteAllText(temporaryPath, json);
            try
            {
                File.Move(temporaryPath, markerPath);
            }
            catch (IOException) when (File.Exists(markerPath))
            {
                ValidateMarker(markerPath);
            }
        }
        finally
        {
            File.Delete(temporaryPath);
        }

        return resolvedRoot;
    }

    private static void ValidateMarker(string markerPath)
    {
        DataRootMarker? marker;
        try
        {
            marker = JsonSerializer.Deserialize<DataRootMarker>(File.ReadAllText(markerPath));
        }
        catch (JsonException exception)
        {
            throw new InvalidDataException("The data-root marker is not valid JSON.", exception);
        }

        if (marker is null ||
            marker.ProductId != ProductId ||
            marker.FormatVersion != FormatVersion)
        {
            throw new InvalidDataException("The directory is not a compatible TECHMAP-GRAPHER data root.");
        }
    }

    private sealed record DataRootMarker(string ProductId, int FormatVersion);
}
