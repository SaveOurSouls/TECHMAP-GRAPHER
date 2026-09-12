namespace Techmap.Domain;

public enum ProjectStatus
{
    Draft,
    Active,
    Completed,
}

public static class ProjectRules
{
    public const int MaximumHarnesses = 100;
    public const int MaximumDesignationLength = 128;
    public const int MaximumNameLength = 256;

    public static string NormalizeDesignation(string value, string parameterName)
    {
        ArgumentNullException.ThrowIfNull(value, parameterName);
        return NormalizeText(value, MaximumDesignationLength, parameterName);
    }

    public static string NormalizeName(string value, string parameterName)
    {
        ArgumentNullException.ThrowIfNull(value, parameterName);
        return NormalizeText(value, MaximumNameLength, parameterName);
    }

    public static long ValidateBatchQuantity(long value, string parameterName)
    {
        if (value <= 0)
        {
            throw new ArgumentOutOfRangeException(
                parameterName,
                "The project batch quantity must be greater than zero.");
        }

        return value;
    }

    public static string ToCode(ProjectStatus status) => status switch
    {
        ProjectStatus.Draft => "draft",
        ProjectStatus.Active => "active",
        ProjectStatus.Completed => "completed",
        _ => throw new ArgumentOutOfRangeException(nameof(status)),
    };

    public static bool TryParseStatus(string? value, out ProjectStatus status)
    {
        status = value switch
        {
            "draft" => ProjectStatus.Draft,
            "active" => ProjectStatus.Active,
            "completed" => ProjectStatus.Completed,
            _ => default,
        };
        return value is "draft" or "active" or "completed";
    }

    private static string NormalizeText(string value, int maximumLength, string parameterName)
    {
        var normalized = value.Trim();
        if (normalized.Length == 0)
        {
            throw new ArgumentException("The value must not be blank.", parameterName);
        }

        if (normalized.Length > maximumLength)
        {
            throw new ArgumentException(
                $"The value must not exceed {maximumLength} characters.",
                parameterName);
        }

        if (normalized.Any(char.IsControl))
        {
            throw new ArgumentException("The value must not contain control characters.", parameterName);
        }

        return normalized;
    }
}
