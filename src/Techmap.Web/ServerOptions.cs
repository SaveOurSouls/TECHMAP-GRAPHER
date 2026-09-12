using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;

namespace Techmap.Web;

public sealed record ServerOptions(
    int Port,
    PathString PathBase,
    string DataRoot,
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

        return new ServerOptions(
            port,
            pathBase,
            Path.GetFullPath(dataRoot),
            HasSwitch(args, "--no-browser") || configuration.GetValue("NoBrowser", false),
            HasSwitch(args, "--verify-package"));
    }

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
