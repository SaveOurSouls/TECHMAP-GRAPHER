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
        Assert.Equal(
            Path.Combine(Path.GetDirectoryName(options.DataRoot)!, "data-backups"),
            options.BackupRoot);
        Assert.False(options.PathBase.HasValue);
        Assert.False(options.NoBrowser);
        Assert.Null(options.ExportProjectId);
        Assert.Null(options.ExportDestination);
    }

    [Fact]
    public void Accepts_offline_project_export_mode()
    {
        var root = Path.GetFullPath("program-root");
        var projectId = Guid.NewGuid();
        var options = Techmap.Web.ServerOptions.Parse(
            [
                $"--export-project={projectId:D}",
                "--export-destination=../result.techmap-project.zip",
            ],
            EmptyConfiguration(),
            root);

        Assert.Equal(projectId, options.ExportProjectId);
        Assert.Equal(
            Path.GetFullPath("../result.techmap-project.zip", root),
            options.ExportDestination);
        Assert.True(options.NoBrowser);
    }

    [Theory]
    [InlineData("--export-project=11111111-1111-1111-1111-111111111111")]
    [InlineData("--export-destination=result.techmap-project.zip")]
    [InlineData("--export-project=invalid", "--export-destination=result.techmap-project.zip")]
    public void Rejects_incomplete_or_invalid_export_mode(params string[] arguments)
    {
        Assert.Throws<ArgumentException>(() => Techmap.Web.ServerOptions.Parse(
            arguments,
            EmptyConfiguration(),
            Path.GetFullPath("program-root")));
    }

    [Fact]
    public void Accepts_explicit_port_data_root_and_switches()
    {
        var root = Path.GetFullPath("program-root");
        var options = Techmap.Web.ServerOptions.Parse(
            ["--port=8762", "--data-root=../данные теста", "--backup-root=../резерв", "--path-base=/techmap", "--no-browser", "--verify-package"],
            EmptyConfiguration(),
            root);

        Assert.Equal(8762, options.Port);
        Assert.Equal(Path.GetFullPath("../данные теста", root), options.DataRoot);
        Assert.Equal(Path.GetFullPath("../резерв", root), options.BackupRoot);
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
