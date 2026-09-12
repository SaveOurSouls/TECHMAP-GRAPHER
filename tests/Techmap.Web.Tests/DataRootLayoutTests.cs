using System.Text.Json;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class DataRootLayoutTests : IDisposable
{
    private readonly string root = Path.Combine(Path.GetTempPath(), "techmap-data-root-tests", Guid.NewGuid().ToString("N"));

    [Fact]
    public void Creates_and_reuses_a_product_marker()
    {
        var resolved = Techmap.Web.DataRootLayout.Initialize(root);
        var markerPath = Path.Combine(resolved, Techmap.Web.DataRootLayout.MarkerFileName);

        Assert.True(File.Exists(markerPath));
        using var marker = JsonDocument.Parse(File.ReadAllText(markerPath));
        Assert.Equal("TECHMAP-GRAPHER", marker.RootElement.GetProperty("ProductId").GetString());
        Assert.Equal(resolved, Techmap.Web.DataRootLayout.Initialize(root));
    }

    [Fact]
    public void Rejects_an_incompatible_existing_marker()
    {
        Directory.CreateDirectory(root);
        File.WriteAllText(Path.Combine(root, Techmap.Web.DataRootLayout.MarkerFileName), "{}");

        Assert.Throws<InvalidDataException>(() => Techmap.Web.DataRootLayout.Initialize(root));
    }

    public void Dispose()
    {
        if (Directory.Exists(root))
        {
            Directory.Delete(root, recursive: true);
        }
    }
}
