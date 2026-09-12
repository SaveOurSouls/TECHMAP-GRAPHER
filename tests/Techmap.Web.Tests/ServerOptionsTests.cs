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
        Assert.Null(options.ImportProjectArchive);
        Assert.False(options.CreateBackup);
        Assert.Null(options.DryRunRestoreBackup);
        Assert.Null(options.PrepareFullRestoreBackup);
        Assert.Null(options.ExecuteFullRestorePlan);
    }

    [Fact]
    public void Accepts_offline_project_import_mode()
    {
        var root = Path.GetFullPath("program-root");
        var options = Techmap.Web.ServerOptions.Parse(
            ["--import-project=../source.techmap-project.zip"],
            EmptyConfiguration(),
            root);

        Assert.Equal(
            Path.GetFullPath("../source.techmap-project.zip", root),
            options.ImportProjectArchive);
        Assert.True(options.NoBrowser);
    }

    [Theory]
    [InlineData("--import-project=a.techmap-project.zip", "--verify-package")]
    [InlineData("--import-project=a.techmap-project.zip", "--export-project=11111111-1111-1111-1111-111111111111", "--export-destination=b.techmap-project.zip")]
    public void Rejects_import_mode_conflicts(params string[] arguments)
    {
        Assert.Throws<ArgumentException>(() => Techmap.Web.ServerOptions.Parse(
            arguments,
            EmptyConfiguration(),
            Path.GetFullPath("program-root")));
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

    [Fact]
    public void Accepts_backup_and_restore_maintenance_modes_with_absolute_paths()
    {
        var root = Path.GetFullPath("program-root");
        var backup = Techmap.Web.ServerOptions.Parse(
            ["--create-backup", "--data-root=../data", "--backup-root=../backup"],
            EmptyConfiguration(),
            root);
        Assert.True(backup.CreateBackup);
        Assert.True(backup.HasOfflineMaintenanceMode);
        Assert.True(backup.NoBrowser);

        var dryRun = Techmap.Web.ServerOptions.Parse(
            ["--dry-run-restore=../backup/item", "--recovery-root=../recovery"],
            EmptyConfiguration(),
            root);
        Assert.Equal(Path.GetFullPath("../backup/item", root), dryRun.DryRunRestoreBackup);
        Assert.Equal(Path.GetFullPath("../recovery", root), dryRun.RecoveryRoot);

        var prepare = Techmap.Web.ServerOptions.Parse(
            ["--prepare-full-restore=../backup/item", "--restore-plan=../plan.json"],
            EmptyConfiguration(),
            root);
        Assert.Equal(Path.GetFullPath("../backup/item", root), prepare.PrepareFullRestoreBackup);
        Assert.Equal(Path.GetFullPath("../plan.json", root), prepare.RestorePlanPath);

        var execute = Techmap.Web.ServerOptions.Parse(
            [
                "--execute-full-restore=../plan.json",
                "--confirmation-file=../confirmation.txt",
                "--pre-restore-backup-root=../pre-restore",
            ],
            EmptyConfiguration(),
            root);
        Assert.Equal(Path.GetFullPath("../plan.json", root), execute.ExecuteFullRestorePlan);
        Assert.Equal(Path.GetFullPath("../confirmation.txt", root), execute.ConfirmationFile);
        Assert.Equal(Path.GetFullPath("../pre-restore", root), execute.PreRestoreBackupRoot);
    }

    [Theory]
    [InlineData("--dry-run-restore=backup")]
    [InlineData("--recovery-root=recovery")]
    [InlineData("--prepare-full-restore=backup")]
    [InlineData("--restore-plan=plan.json")]
    [InlineData("--execute-full-restore=plan.json")]
    [InlineData("--execute-full-restore=plan.json", "--confirmation-file=confirmation.txt")]
    [InlineData("--confirmation-file=confirmation.txt", "--pre-restore-backup-root=pre-restore")]
    public void Rejects_incomplete_restore_modes(params string[] arguments)
    {
        Assert.Throws<ArgumentException>(() => Techmap.Web.ServerOptions.Parse(
            arguments,
            EmptyConfiguration(),
            Path.GetFullPath("program-root")));
    }

    [Theory]
    [InlineData("--create-backup", "--verify-package")]
    [InlineData("--create-backup", "--import-project=project.zip")]
    [InlineData("--create-backup", "--export-project=11111111-1111-1111-1111-111111111111", "--export-destination=project.zip")]
    [InlineData("--dry-run-restore=backup", "--recovery-root=recovery", "--create-backup")]
    [InlineData("--prepare-full-restore=backup", "--restore-plan=plan.json", "--execute-full-restore=other-plan.json", "--confirmation-file=confirmation.txt", "--pre-restore-backup-root=pre-restore")]
    public void Rejects_conflicting_maintenance_modes(params string[] arguments)
    {
        Assert.Throws<ArgumentException>(() => Techmap.Web.ServerOptions.Parse(
            arguments,
            EmptyConfiguration(),
            Path.GetFullPath("program-root")));
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
