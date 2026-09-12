using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;

namespace Techmap.Web;

public sealed record ServerOptions(
    int Port,
    PathString PathBase,
    string DataRoot,
    string BackupRoot,
    Guid? ExportProjectId,
    string? ExportDestination,
    string? ImportProjectArchive,
    bool CreateBackup,
    string? DryRunRestoreBackup,
    string? RecoveryRoot,
    string? PrepareFullRestoreBackup,
    string? RestorePlanPath,
    string? ExecuteFullRestorePlan,
    string? ConfirmationFile,
    string? PreRestoreBackupRoot,
    bool NoBrowser,
    bool VerifyPackage)
{
    public static ServerOptions Parse(
        string[] args,
        IConfiguration configuration,
        string programRoot)
    {
        var portValue = ReadSingleValue(args, "--port=") ?? configuration["Port"];
        var port = portValue is null
            ? 0
            : int.TryParse(portValue, out var parsedPort) && parsedPort is > 0 and <= 65535
                ? parsedPort
                : throw new ArgumentException("--port must be an integer from 1 to 65535.");

        var configuredPathBase = configuration["PathBase"];
        var pathBase = PathBaseConfiguration.Parse(
            configuredPathBase is null
                ? args
                : [$"--path-base={configuredPathBase}"]);

        var dataRootValue = ReadSingleValue(args, "--data-root=") ?? configuration["DataRoot"];
        var dataRoot = dataRootValue is null
            ? Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "TECHMAP-GRAPHER",
                "data")
            : Path.GetFullPath(dataRootValue, programRoot);
        dataRoot = Path.GetFullPath(dataRoot);
        var backupRootValue = ReadSingleValue(args, "--backup-root=") ?? configuration["BackupRoot"];
        var dataRootParent = Path.GetDirectoryName(dataRoot)
            ?? throw new InvalidOperationException("The data root must have a parent directory.");
        var backupRoot = backupRootValue is null
            ? Path.Combine(dataRootParent, $"{Path.GetFileName(dataRoot)}-backups")
            : Path.GetFullPath(backupRootValue, programRoot);
        var exportProjectValue = ReadSingleValue(args, "--export-project=") ?? configuration["ExportProject"];
        var exportDestinationValue = ReadSingleValue(args, "--export-destination=") ??
            configuration["ExportDestination"];
        if ((exportProjectValue is null) != (exportDestinationValue is null))
        {
            throw new ArgumentException(
                "--export-project and --export-destination must be specified together.");
        }

        Guid? exportProjectId = null;
        string? exportDestination = null;
        if (exportProjectValue is not null)
        {
            if (!Guid.TryParseExact(exportProjectValue, "D", out var parsedProjectId) ||
                parsedProjectId == Guid.Empty)
            {
                throw new ArgumentException("--export-project must be a non-empty UUID in D format.");
            }

            exportProjectId = parsedProjectId;
            exportDestination = Path.GetFullPath(exportDestinationValue!, programRoot);
        }

        var importProjectValue = ReadSingleValue(args, "--import-project=") ?? configuration["ImportProject"];
        var importProjectArchive = importProjectValue is null
            ? null
            : Path.GetFullPath(importProjectValue, programRoot);

        var createBackup = HasSwitch(args, "--create-backup");
        var dryRunRestoreValue = ReadSingleValue(args, "--dry-run-restore=");
        var recoveryRootValue = ReadSingleValue(args, "--recovery-root=");
        if ((dryRunRestoreValue is null) != (recoveryRootValue is null))
        {
            throw new ArgumentException(
                "--dry-run-restore and --recovery-root must be specified together.");
        }

        var prepareFullRestoreValue = ReadSingleValue(args, "--prepare-full-restore=");
        var restorePlanValue = ReadSingleValue(args, "--restore-plan=");
        if ((prepareFullRestoreValue is null) != (restorePlanValue is null))
        {
            throw new ArgumentException(
                "--prepare-full-restore and --restore-plan must be specified together.");
        }

        var executeFullRestoreValue = ReadSingleValue(args, "--execute-full-restore=");
        var confirmationFileValue = ReadSingleValue(args, "--confirmation-file=");
        var preRestoreBackupRootValue = ReadSingleValue(args, "--pre-restore-backup-root=");
        var executeParts = new[]
        {
            executeFullRestoreValue,
            confirmationFileValue,
            preRestoreBackupRootValue,
        };
        if (executeParts.Any(value => value is not null) && executeParts.Any(value => value is null))
        {
            throw new ArgumentException(
                "--execute-full-restore, --confirmation-file and --pre-restore-backup-root " +
                "must be specified together.");
        }

        var modeCount = new[]
        {
            exportProjectId is not null,
            importProjectArchive is not null,
            createBackup,
            dryRunRestoreValue is not null,
            prepareFullRestoreValue is not null,
            executeFullRestoreValue is not null,
        }.Count(active => active);
        if (modeCount > 1)
        {
            throw new ArgumentException("Offline maintenance modes are mutually exclusive.");
        }

        var noBrowser = HasSwitch(args, "--no-browser") || configuration.GetValue("NoBrowser", false);
        var verifyPackage = HasSwitch(args, "--verify-package");
        if (modeCount > 0 && verifyPackage)
        {
            throw new ArgumentException("An offline maintenance mode cannot be combined with --verify-package.");
        }

        return new ServerOptions(
            port,
            pathBase,
            dataRoot,
            Path.GetFullPath(backupRoot),
            exportProjectId,
            exportDestination,
            importProjectArchive,
            createBackup,
            ResolveOptionalPath(dryRunRestoreValue, programRoot),
            ResolveOptionalPath(recoveryRootValue, programRoot),
            ResolveOptionalPath(prepareFullRestoreValue, programRoot),
            ResolveOptionalPath(restorePlanValue, programRoot),
            ResolveOptionalPath(executeFullRestoreValue, programRoot),
            ResolveOptionalPath(confirmationFileValue, programRoot),
            ResolveOptionalPath(preRestoreBackupRootValue, programRoot),
            modeCount > 0 || noBrowser,
            verifyPackage);
    }

    public bool HasOfflineMaintenanceMode =>
        ExportProjectId is not null ||
        ImportProjectArchive is not null ||
        CreateBackup ||
        DryRunRestoreBackup is not null ||
        PrepareFullRestoreBackup is not null ||
        ExecuteFullRestorePlan is not null;

    private static string? ResolveOptionalPath(string? value, string programRoot) =>
        value is null ? null : Path.GetFullPath(value, programRoot);

    private static string? ReadSingleValue(string[] args, string prefix)
    {
        var values = args
            .Where(value => value.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            .Select(value => value[prefix.Length..])
            .ToArray();
        return values.Length switch
        {
            0 => null,
            1 when !string.IsNullOrWhiteSpace(values[0]) => values[0],
            _ => throw new ArgumentException($"{prefix[..^1]} must be specified once with a value."),
        };
    }

    private static bool HasSwitch(string[] args, string name)
    {
        var count = args.Count(value => value.Equals(name, StringComparison.OrdinalIgnoreCase));
        return count switch
        {
            0 => false,
            1 => true,
            _ => throw new ArgumentException($"{name} can be specified only once."),
        };
    }
}
