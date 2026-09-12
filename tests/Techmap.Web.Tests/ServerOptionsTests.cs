using Microsoft.Extensions.Configuration;
using Xunit;

namespace Techmap.Web.Tests;

public sealed class ServerOptionsTests
{
    [Fact]
    public void Defaults_to_random_port_and_local_application_data()
    {
        var root = Path.GetFullPath("program-root");
        var options = Techmap.Web.ServerOptions.Parse([], EmptyConfiguration(), root);

        Assert.Equal(0, options.Port);
        Assert.EndsWith(
            Path.Combine("TECHMAP-GRAPHER", "data"),
            options.DataRoot,
            StringComparison.OrdinalIgnoreCase);
        Assert.False(options.PathBase.HasValue);
        Assert.False(options.NoBrowser);
    }

    [Fact]
    public void Accepts_explicit_port_data_root_and_switches()
    {
        var root = Path.GetFullPath("program-root");
        var options = Techmap.Web.ServerOptions.Parse(
            ["--port=8762", "--data-root=../данные теста", "--path-base=/techmap", "--no-browser", "--verify-package"],
            EmptyConfiguration(),
            root);

        Assert.Equal(8762, options.Port);
        Assert.Equal(Path.GetFullPath("../данные теста", root), options.DataRoot);
        Assert.Equal("/techmap", options.PathBase.Value);
        Assert.True(options.NoBrowser);
        Assert.True(options.VerifyPackage);
    }

    [Theory]
    [InlineData("0")]
    [InlineData("65536")]
    [InlineData("abc")]
    public void Rejects_invalid_port(string value)
    {
        Assert.Throws<ArgumentException>(() => Techmap.Web.ServerOptions.Parse(
            [$"--port={value}"],
            EmptyConfiguration(),
            Path.GetFullPath("program-root")));
    }

    private static IConfiguration EmptyConfiguration() =>
        new ConfigurationBuilder().Build();
}
