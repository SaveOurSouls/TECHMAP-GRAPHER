namespace Techmap.Contracts;

public static class ApiContract
{
    public const int MajorVersion = 1;
}

public sealed record HealthResponse(string Status, int ApiVersion, string InstanceId);

public sealed record RuntimeConfigResponse(
    int ConfigVersion,
    string BasePath,
    string ApiBasePath,
    string AppVersion,
    string ApiVersion,
    string SchemaVersion);

public sealed record ApiErrorResponse(string Error);

public sealed record SessionBootstrapResponse(string CsrfNonce, string InstanceId);
