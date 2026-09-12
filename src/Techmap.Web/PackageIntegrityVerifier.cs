using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Techmap.Web;

public static class PackageIntegrityVerifier
{
    public const string ManifestFileName = "PACKAGE-MANIFEST.json";
    public const string ProductManifestFileName = "VERSION.json";

    private static readonly JsonSerializerOptions SerializerOptions = new()
    {
        PropertyNameCaseInsensitive = false,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
    };

    public static PackageVerificationResult Verify(string programRoot)
    {
        try
        {
            return VerifyCore(programRoot);
        }
        catch (InvalidDataException)
        {
            throw;
        }
        catch (Exception error) when (error is not OutOfMemoryException)
        {
            throw new InvalidDataException("Package integrity verification failed.", error);
        }
    }

    private static PackageVerificationResult VerifyCore(string programRoot)
    {
        if (string.IsNullOrWhiteSpace(programRoot))
        {
            throw new InvalidDataException("Package root must be specified.");
        }

        var root = Path.GetFullPath(programRoot);
        if (!Directory.Exists(root))
        {
            throw new InvalidDataException($"Package root does not exist: {root}");
        }

        var manifestPath = Path.Combine(root, ManifestFileName);
        PackageManifest manifest;
        try
        {
            var json = File.ReadAllText(manifestPath, Encoding.UTF8);
            manifest = JsonSerializer.Deserialize<PackageManifest>(json, SerializerOptions)
                ?? throw new InvalidDataException("Package manifest is empty.");
        }
        catch (InvalidDataException)
        {
            throw;
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException)
        {
            throw new InvalidDataException("Package manifest cannot be read.", error);
        }

        ValidateManifestHeader(manifest);
        var expected = ValidateExpectedInventory(manifest.Files);
        ValidateProductManifest(root, manifest.ProductManifestSha256, expected);

        var actual = ReadActualInventory(root, manifestPath);
        if (actual.Count != expected.Count)
        {
            throw new InvalidDataException(
                $"Package inventory count mismatch: expected {expected.Count}, found {actual.Count}.");
        }

        foreach (var (key, actualFile) in actual)
        {
            if (!expected.TryGetValue(key, out var expectedFile))
            {
                throw new InvalidDataException($"Unexpected package file: {actualFile.RelativePath}");
            }

            VerifyFile(actualFile.FullPath, actualFile.RelativePath, expectedFile);
        }

        foreach (var (key, expectedFile) in expected)
        {
            if (!actual.ContainsKey(key))
            {
                throw new InvalidDataException($"Package file is missing: {expectedFile.Path}");
            }
        }

        return new PackageVerificationResult(expected.Count);
    }

    private static void ValidateManifestHeader(PackageManifest manifest)
    {
        if (manifest.Format != 1)
        {
            throw new InvalidDataException(
                $"Unsupported package manifest format: {manifest.Format}");
        }

        if (!string.Equals(manifest.Algorithm, "SHA-256", StringComparison.Ordinal))
        {
            throw new InvalidDataException(
                $"Unsupported package checksum algorithm: {manifest.Algorithm}");
        }

        ValidateSha256(manifest.ProductManifestSha256, "productManifestSha256");
    }

    private static Dictionary<string, PackageFileEntry> ValidateExpectedInventory(
        PackageFileEntry[]? files)
    {
        if (files is null)
        {
            throw new InvalidDataException("Package manifest files must be an array.");
        }

        var result = new Dictionary<string, PackageFileEntry>(StringComparer.OrdinalIgnoreCase);
        foreach (var entry in files)
        {
            if (entry is null)
            {
                throw new InvalidDataException(
                    "Package manifest contains an empty file entry.");
            }

            var canonicalPath = ValidateCanonicalRelativePath(entry.Path);
            if (string.Equals(canonicalPath, ManifestFileName, StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidDataException(
                    "Package manifest must exclude itself from inventory.");
            }

            if (entry.Bytes < 0)
            {
                throw new InvalidDataException(
                    $"Package file has a negative size: {canonicalPath}");
            }

            ValidateSha256(entry.Sha256, $"files[{canonicalPath}].sha256");
            if (!result.TryAdd(canonicalPath, entry))
            {
                throw new InvalidDataException(
                    $"Duplicate or case-colliding package path: {canonicalPath}");
            }
        }

        return result;
    }

    private static void ValidateProductManifest(
        string root,
        string? expectedSha256,
        IReadOnlyDictionary<string, PackageFileEntry> expected)
    {
        if (!expected.ContainsKey(ProductManifestFileName))
        {
            throw new InvalidDataException(
                $"Package inventory must contain {ProductManifestFileName}.");
        }

        var versionPath = Path.Combine(root, ProductManifestFileName);
        if (!File.Exists(versionPath))
        {
            throw new InvalidDataException(
                $"Package file is missing: {ProductManifestFileName}");
        }

        var actualSha256 = ComputeSha256(versionPath);
        if (!string.Equals(actualSha256, expectedSha256, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidDataException(
                $"{ProductManifestFileName} checksum mismatch.");
        }
    }

    private static Dictionary<string, ActualPackageFile> ReadActualInventory(
        string root,
        string manifestPath)
    {
        var result = new Dictionary<string, ActualPackageFile>(StringComparer.OrdinalIgnoreCase);
        var pending = new Stack<string>();
        pending.Push(root);

        while (pending.TryPop(out var directory))
        {
            IEnumerable<string> entries;
            try
            {
                entries = Directory.EnumerateFileSystemEntries(directory);
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException)
            {
                throw new InvalidDataException(
                    $"Package directory cannot be read: {directory}",
                    error);
            }

            foreach (var fullPath in entries)
            {
                var attributes = File.GetAttributes(fullPath);
                if ((attributes & FileAttributes.ReparsePoint) != 0)
                {
                    throw new InvalidDataException(
                        $"Package cannot contain a reparse point: {Path.GetRelativePath(root, fullPath)}");
                }

                if ((attributes & FileAttributes.Directory) != 0)
                {
                    pending.Push(fullPath);
                    continue;
                }

                if (string.Equals(
                    Path.GetFullPath(fullPath),
                    Path.GetFullPath(manifestPath),
                    StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                var relativePath = Path.GetRelativePath(root, fullPath)
                    .Replace(Path.DirectorySeparatorChar, '/');
                relativePath = ValidateCanonicalRelativePath(relativePath);
                if (!result.TryAdd(relativePath, new ActualPackageFile(relativePath, fullPath)))
                {
                    throw new InvalidDataException(
                        $"Actual package contains duplicate or case-colliding paths: {relativePath}");
                }
            }
        }

        return result;
    }

    private static string ValidateCanonicalRelativePath(string? value)
    {
        if (string.IsNullOrWhiteSpace(value) ||
            !string.Equals(value, value.Normalize(NormalizationForm.FormC), StringComparison.Ordinal) ||
            Path.IsPathRooted(value) ||
            value.StartsWith("/", StringComparison.Ordinal) ||
            value.EndsWith("/", StringComparison.Ordinal) ||
            value.Contains('\\') ||
            value.Contains("//", StringComparison.Ordinal))
        {
            throw new InvalidDataException($"Package path is not canonical: {value}");
        }

        var segments = value.Split('/');
        if (segments.Any(segment =>
            segment.Length == 0 ||
            segment is "." or ".." ||
            segment.EndsWith(' ') ||
            segment.EndsWith('.') ||
            segment.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0))
        {
            throw new InvalidDataException($"Package path is not canonical: {value}");
        }

        return value;
    }

    private static void VerifyFile(
        string fullPath,
        string relativePath,
        PackageFileEntry expected)
    {
        try
        {
            using var stream = OpenRead(fullPath);
            if (stream.Length != expected.Bytes)
            {
                throw new InvalidDataException(
                    $"Package file size mismatch: {relativePath}");
            }

            var actualSha256 = Convert.ToHexStringLower(SHA256.HashData(stream));
            if (!string.Equals(actualSha256, expected.Sha256, StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidDataException(
                    $"Package file checksum mismatch: {relativePath}");
            }
        }
        catch (InvalidDataException)
        {
            throw;
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            throw new InvalidDataException($"Package file cannot be read: {fullPath}", error);
        }
    }

    private static string ComputeSha256(string path)
    {
        try
        {
            using var stream = OpenRead(path);
            return Convert.ToHexStringLower(SHA256.HashData(stream));
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            throw new InvalidDataException($"Package file cannot be read: {path}", error);
        }
    }

    private static FileStream OpenRead(string path) => new(
        path,
        FileMode.Open,
        FileAccess.Read,
        FileShare.Read,
        bufferSize: 128 * 1024,
        FileOptions.SequentialScan);

    private static void ValidateSha256(string? value, string field)
    {
        if (value is null || value.Length != 64 || !value.All(Uri.IsHexDigit))
        {
            throw new InvalidDataException(
                $"{field} must be a 64-character SHA-256 value.");
        }
    }

    private sealed record ActualPackageFile(string RelativePath, string FullPath);

    private sealed class PackageManifest
    {
        [JsonPropertyName("format")]
        public int Format { get; init; }

        [JsonPropertyName("algorithm")]
        public string? Algorithm { get; init; }

        [JsonPropertyName("productManifestSha256")]
        public string? ProductManifestSha256 { get; init; }

        [JsonPropertyName("files")]
        public PackageFileEntry[]? Files { get; init; }
    }

    private sealed class PackageFileEntry
    {
        [JsonPropertyName("path")]
        public string? Path { get; init; }

        [JsonPropertyName("bytes")]
        public long Bytes { get; init; }

        [JsonPropertyName("sha256")]
        public string? Sha256 { get; init; }
    }
}

public sealed record PackageVerificationResult(int FilesVerified);
