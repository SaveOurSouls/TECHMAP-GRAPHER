namespace Techmap.Contracts;

public static class ApiContract
{
    public const int MajorVersion = 1;
}

public sealed record HealthResponse(string Status, int ApiVersion);

public sealed record RuntimeConfigResponse(
    int ConfigVersion,
    string BasePath,
    string ApiBasePath,
    string AppVersion,
    string ApiVersion,
    string SchemaVersion);

public sealed record ApiErrorResponse(string Error);
