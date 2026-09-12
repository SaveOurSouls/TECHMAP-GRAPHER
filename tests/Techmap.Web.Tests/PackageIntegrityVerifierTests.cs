using System.Security.Cryptography;
using System.Text.Json;
using Techmap.Web;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class PackageIntegrityVerifierTests
{
    [Fact]
    public void Valid_exact_inventory_passes_and_excludes_manifest_itself()
    {
        using var package = PackageFixture.Create();

        var result = PackageIntegrityVerifier.Verify(package.Root);

        Assert.Equal(2, result.FilesVerified);
    }

    [Fact]
    public void Missing_manifest_is_reported_as_invalid_data()
    {
        using var package = PackageFixture.Create();
        File.Delete(Path.Combine(package.Root, PackageIntegrityVerifier.ManifestFileName));

        Assert.Throws<InvalidDataException>(() => PackageIntegrityVerifier.Verify(package.Root));
    }

    [Fact]
    public void Malformed_manifest_is_reported_as_invalid_data()
    {
        using var package = PackageFixture.Create();
        File.WriteAllText(
            Path.Combine(package.Root, PackageIntegrityVerifier.ManifestFileName),
            "{ invalid");

        Assert.Throws<InvalidDataException>(() => PackageIntegrityVerifier.Verify(package.Root));
    }

    [Theory]
    [InlineData(2, "SHA-256")]
    [InlineData(1, "SHA256")]
    [InlineData(1, "sha-256")]
    public void Unsupported_header_is_rejected(int format, string algorithm)
    {
        using var package = PackageFixture.Create();
        package.WriteManifest(format: format, algorithm: algorithm);

        Assert.Throws<InvalidDataException>(() => PackageIntegrityVerifier.Verify(package.Root));
    }

    [Fact]
    public void Product_manifest_checksum_mismatch_is_rejected()
    {
        using var package = PackageFixture.Create();
        package.WriteManifest(productManifestSha256: new string('0', 64));

        var error = Assert.Throws<InvalidDataException>(() =>
            PackageIntegrityVerifier.Verify(package.Root));

        Assert.Contains("VERSION.json checksum mismatch", error.Message);
    }

    [Fact]
    public void Missing_file_is_rejected()
    {
        using var package = PackageFixture.Create();
        File.Delete(Path.Combine(package.Root, "bin", "Techmap.Server.exe"));

        Assert.Throws<InvalidDataException>(() => PackageIntegrityVerifier.Verify(package.Root));
    }

    [Fact]
    public void Extra_file_is_rejected()
    {
        using var package = PackageFixture.Create();
        File.WriteAllText(Path.Combine(package.Root, "unexpected.txt"), "extra");

        var error = Assert.Throws<InvalidDataException>(() =>
            PackageIntegrityVerifier.Verify(package.Root));

        Assert.Contains("inventory count mismatch", error.Message);
    }

    [Fact]
    public void Changed_file_with_same_size_is_rejected_by_checksum()
    {
        using var package = PackageFixture.Create();
        File.WriteAllBytes(Path.Combine(package.Root, "bin", "Techmap.Server.exe"), [9, 8, 7, 6]);

        var error = Assert.Throws<InvalidDataException>(() =>
            PackageIntegrityVerifier.Verify(package.Root));

        Assert.Contains("checksum mismatch", error.Message);
    }

    [Fact]
    public void Incorrect_byte_count_is_rejected()
    {
        using var package = PackageFixture.Create();
        var entries = package.Inventory();
        entries[1] = entries[1] with { Bytes = entries[1].Bytes + 1 };
        package.WriteManifest(files: entries);

        var error = Assert.Throws<InvalidDataException>(() =>
            PackageIntegrityVerifier.Verify(package.Root));

        Assert.Contains("size mismatch", error.Message);
    }

    [Theory]
    [InlineData("C:/outside.txt")]
    [InlineData("/absolute.txt")]
    [InlineData("../outside.txt")]
    [InlineData("bin/../outside.txt")]
    [InlineData("bin/./Techmap.Server.exe")]
    [InlineData("bin\\Techmap.Server.exe")]
    [InlineData("bin//Techmap.Server.exe")]
    [InlineData("bin/Techmap.Server.exe/")]
    [InlineData("cafe\u0301.txt")]
    public void Noncanonical_or_unsafe_manifest_path_is_rejected(string unsafePath)
    {
        using var package = PackageFixture.Create();
        var entries = package.Inventory();
        entries[1] = entries[1] with { Path = unsafePath };
        package.WriteManifest(files: entries);

        var error = Assert.Throws<InvalidDataException>(() =>
            PackageIntegrityVerifier.Verify(package.Root));

        Assert.Contains("not canonical", error.Message);
    }

    [Theory]
    [InlineData("VERSION.json")]
    [InlineData("version.JSON")]
    public void Duplicate_or_case_colliding_inventory_path_is_rejected(string duplicatePath)
    {
        using var package = PackageFixture.Create();
        var entries = package.Inventory();
        entries[1] = entries[0] with { Path = duplicatePath };
        package.WriteManifest(files: entries);

        var error = Assert.Throws<InvalidDataException>(() =>
            PackageIntegrityVerifier.Verify(package.Root));

        Assert.Contains("Duplicate or case-colliding", error.Message);
    }

    [Fact]
    public void Manifest_cannot_include_itself()
    {
        using var package = PackageFixture.Create();
        var entries = package.Inventory();
        entries[1] = entries[1] with { Path = PackageIntegrityVerifier.ManifestFileName };
        package.WriteManifest(files: entries);

        var error = Assert.Throws<InvalidDataException>(() =>
            PackageIntegrityVerifier.Verify(package.Root));

        Assert.Contains("exclude itself", error.Message);
    }

    private sealed class PackageFixture : IDisposable
    {
        private readonly FileEntry[] initialInventory;

        private PackageFixture(string root)
        {
            Root = root;
            Directory.CreateDirectory(Path.Combine(root, "bin"));
            File.WriteAllText(
                Path.Combine(root, PackageIntegrityVerifier.ProductManifestFileName),
                "{\"productId\":\"TECHMAP-GRAPHER\"}\n");
            File.WriteAllBytes(Path.Combine(root, "bin", "Techmap.Server.exe"), [1, 2, 3, 4]);
            initialInventory =
            [
                Describe(PackageIntegrityVerifier.ProductManifestFileName),
                Describe("bin/Techmap.Server.exe"),
            ];
            WriteManifest();
        }

        public string Root { get; }

        public static PackageFixture Create()
        {
            var root = Path.Combine(
                Path.GetTempPath(),
                $"techmap-package-verifier-{Guid.NewGuid():N}");
            Directory.CreateDirectory(root);
            return new PackageFixture(root);
        }

        public FileEntry[] Inventory() => [.. initialInventory];

        public void WriteManifest(
            int format = 1,
            string algorithm = "SHA-256",
            string? productManifestSha256 = null,
            FileEntry[]? files = null)
        {
            var manifest = new
            {
                format,
                algorithm,
                productManifestSha256 = productManifestSha256 ??
                    initialInventory.Single(entry =>
                        entry.Path == PackageIntegrityVerifier.ProductManifestFileName).Sha256,
                files = files ?? initialInventory,
            };
            File.WriteAllText(
                Path.Combine(Root, PackageIntegrityVerifier.ManifestFileName),
                JsonSerializer.Serialize(manifest, new JsonSerializerOptions
                {
                    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
                }));
        }

        public void Dispose()
        {
            Directory.Delete(Root, recursive: true);
        }

        private FileEntry Describe(string relativePath)
        {
            var fullPath = Path.Combine(Root, relativePath.Replace('/', Path.DirectorySeparatorChar));
            var bytes = File.ReadAllBytes(fullPath);
            return new FileEntry(
                relativePath,
                bytes.LongLength,
                Convert.ToHexStringLower(SHA256.HashData(bytes)));
        }
    }

    private sealed record FileEntry(string Path, long Bytes, string Sha256);
}
