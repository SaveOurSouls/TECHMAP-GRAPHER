using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Techmap.Application;

public sealed record ReferenceCatalogSavedFilterQuery(
    string? Text,
    string? ExactSourceKey,
    IReadOnlyList<string> EntityTypes,
    IReadOnlyList<ReferenceCatalogFilterCondition> Filters,
    ReferenceCatalogFilterLogic FilterLogic,
    ReferenceCatalogSort Sort);

public sealed record CanonicalReferenceCatalogSavedFilterQuery(
    int Version,
    ReferenceCatalogSavedFilterQuery Query,
    string CanonicalJson,
    string Sha256);

public sealed record ReferenceCatalogSavedFilter(
    Guid FilterId,
    string SourceId,
    string Name,
    CanonicalReferenceCatalogSavedFilterQuery Query,
    DateTimeOffset CreatedUtc,
    DateTimeOffset UpdatedUtc);

public interface IReferenceCatalogSavedFilterStore
{
    ReferenceCatalogSavedFilter Create(
        string sourceId,
        string name,
        ReferenceCatalogSavedFilterQuery query);

    IReadOnlyList<ReferenceCatalogSavedFilter> List(string sourceId);

    ReferenceCatalogSavedFilter Update(
        string sourceId,
        Guid filterId,
        string name,
        ReferenceCatalogSavedFilterQuery query);

    void Delete(string sourceId, Guid filterId);
}

public static class ReferenceCatalogSavedFilterCanonicalizer
{
    public const int CurrentVersion = 1;
    public const int MaximumNameLength = 128;
    public const int MaximumTextLength = 256;
    public const int MaximumEntityTypes = 8;
    public const int MaximumFilters = 8;
    public const int MaximumFieldLength = 256;
    public const int MaximumFilterValueLength = 512;
    public const int MaximumCanonicalJsonLength = 16_384;

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public static CanonicalReferenceCatalogSavedFilterQuery Canonicalize(
        ReferenceCatalogSavedFilterQuery query)
    {
        ArgumentNullException.ThrowIfNull(query);
        ArgumentNullException.ThrowIfNull(query.EntityTypes);
        ArgumentNullException.ThrowIfNull(query.Filters);
        if (query.EntityTypes.Count > MaximumEntityTypes || query.Filters.Count > MaximumFilters)
            throw Invalid("The saved filter exceeds its configured limits.");

        var text = NormalizeOptionalSearchText(query.Text, MaximumTextLength, "search text");
        if (text is not null)
        {
            var tokens = SearchTokens(text);
            if (tokens.Count is 0 or > 8)
                throw Invalid("Saved filter search text must contain between one and eight words or numbers.");
        }
        var exactSourceKey = NormalizeOptionalExactSourceKey(query.ExactSourceKey);
        var entityTypes = query.EntityTypes
            .Select(value => NormalizeIdentifier(value, 64, "entity type"))
            .Distinct(StringComparer.Ordinal)
            .Order(StringComparer.Ordinal)
            .ToArray();
        var filters = query.Filters.Select(NormalizeFilter)
            .Distinct()
            .OrderBy(filter => filter.Field, StringComparer.Ordinal)
            .ThenBy(filter => FormatOperator(filter.Operator), StringComparer.Ordinal)
            .ThenBy(filter => filter.Value, StringComparer.Ordinal)
            .ToArray();
        var normalized = new ReferenceCatalogSavedFilterQuery(
            text,
            exactSourceKey,
            entityTypes,
            filters,
            query.FilterLogic,
            query.Sort);
        var canonicalJson = WriteCanonical(normalized);
        if (canonicalJson.Length > MaximumCanonicalJsonLength)
            throw Invalid("The saved filter canonical query exceeds its configured limit.");
        var sha256 = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(canonicalJson)));
        return new CanonicalReferenceCatalogSavedFilterQuery(
            CurrentVersion, normalized, canonicalJson, sha256);
    }

    public static CanonicalReferenceCatalogSavedFilterQuery ReadCanonical(
        string canonicalJson,
        string expectedSha256)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(canonicalJson);
        ArgumentException.ThrowIfNullOrWhiteSpace(expectedSha256);
        try
        {
            var persisted = JsonSerializer.Deserialize<PersistedQuery>(canonicalJson, JsonOptions)
                ?? throw new JsonException("The saved query is null.");
            if (persisted.Version != CurrentVersion || persisted.EntityTypes is null ||
                persisted.Filters is null)
                throw new JsonException("The saved query version or arrays are invalid.");
            var query = new ReferenceCatalogSavedFilterQuery(
                persisted.Text,
                persisted.ExactSourceKey,
                persisted.EntityTypes,
                persisted.Filters.Select(filter => new ReferenceCatalogFilterCondition(
                    filter.Field ?? "",
                    ParseOperator(filter.Operator),
                    filter.Value)).ToArray(),
                ParseLogic(persisted.FilterLogic),
                ParseSort(persisted.Sort));
            var result = Canonicalize(query);
            if (!string.Equals(result.CanonicalJson, canonicalJson, StringComparison.Ordinal) ||
                !string.Equals(result.Sha256, expectedSha256, StringComparison.Ordinal))
                throw new JsonException("The saved query is not canonical or its hash changed.");
            return result;
        }
        catch (Exception error) when (
            error is JsonException or ArgumentException or ReferenceCatalogSavedFilterException)
        {
            throw new ReferenceCatalogSavedFilterException(
                "catalog_saved_filter_corrupt",
                "A saved catalog filter is corrupt.",
                error);
        }
    }

    public static (string DisplayName, string NormalizedName) NormalizeName(string name)
    {
        var displayName = CollapseWhitespace(name, MaximumNameLength, "saved filter name");
        return (displayName, displayName.ToUpperInvariant());
    }

    public static string NormalizeSourceId(string sourceId) =>
        NormalizeIdentifier(sourceId, 256, "reference source", trim: false);

    private static ReferenceCatalogFilterCondition NormalizeFilter(
        ReferenceCatalogFilterCondition filter)
    {
        ArgumentNullException.ThrowIfNull(filter);
        var field = NormalizeSearchText(filter.Field, MaximumFieldLength, "filter field");
        var requiresValue = filter.Operator is
            ReferenceCatalogFilterOperator.TextEquals or
            ReferenceCatalogFilterOperator.TextPrefix;
        if (!requiresValue && filter.Value is not null)
            throw Invalid("This saved filter operator does not accept a value.");
        var value = requiresValue
            ? NormalizeSearchText(
                filter.Value ?? "", MaximumFilterValueLength, "filter value")
            : null;
        return new ReferenceCatalogFilterCondition(field, filter.Operator, value);
    }

    private static string WriteCanonical(ReferenceCatalogSavedFilterQuery query)
    {
        using var buffer = new MemoryStream();
        using (var writer = new Utf8JsonWriter(buffer))
        {
            writer.WriteStartObject();
            writer.WriteNumber("version", CurrentVersion);
            WriteNullable(writer, "text", query.Text);
            WriteNullable(writer, "exactSourceKey", query.ExactSourceKey);
            writer.WritePropertyName("entityTypes");
            writer.WriteStartArray();
            foreach (var entityType in query.EntityTypes) writer.WriteStringValue(entityType);
            writer.WriteEndArray();
            writer.WriteString("filterLogic", FormatLogic(query.FilterLogic));
            writer.WritePropertyName("filters");
            writer.WriteStartArray();
            foreach (var filter in query.Filters)
            {
                writer.WriteStartObject();
                writer.WriteString("field", filter.Field);
                writer.WriteString("operator", FormatOperator(filter.Operator));
                WriteNullable(writer, "value", filter.Value);
                writer.WriteEndObject();
            }
            writer.WriteEndArray();
            writer.WriteString("sort", FormatSort(query.Sort));
            writer.WriteEndObject();
        }
        return Encoding.UTF8.GetString(buffer.ToArray());
    }

    private static void WriteNullable(Utf8JsonWriter writer, string name, string? value)
    {
        if (value is null) writer.WriteNull(name);
        else writer.WriteString(name, value);
    }

    private static string? NormalizeOptionalSearchText(string? value, int maximum, string name) =>
        string.IsNullOrWhiteSpace(value) ? null : NormalizeSearchText(value, maximum, name);

    private static string? NormalizeOptionalExactSourceKey(string? value)
    {
        if (value is null) return null;
        var canonical = value.Normalize(NormalizationForm.FormC);
        if (canonical.Length is 0 or > 512 || canonical.Any(char.IsControl))
            throw Invalid("The exact source key is invalid.");
        return string.IsNullOrWhiteSpace(canonical)
            ? canonical
            : NormalizeSearchText(canonical, 512, "exact source key");
    }

    private static string NormalizeSearchText(string value, int maximum, string name) =>
        CollapseWhitespace(value, maximum, name).ToUpperInvariant();

    private static IReadOnlyList<string> SearchTokens(string text) =>
        text.Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .SelectMany(Tokenize)
            .Where(token => token.Length > 0)
            .Distinct(StringComparer.Ordinal)
            .ToArray();

    private static IEnumerable<string> Tokenize(string value)
    {
        var token = new StringBuilder();
        foreach (var character in value)
        {
            if (char.IsLetterOrDigit(character)) token.Append(character);
            else if (token.Length > 0)
            {
                yield return token.ToString();
                token.Clear();
            }
        }
        if (token.Length > 0) yield return token.ToString();
    }

    private static string CollapseWhitespace(string value, int maximum, string name)
    {
        ArgumentNullException.ThrowIfNull(value);
        var normalized = value.Normalize(NormalizationForm.FormC).Trim();
        var output = new StringBuilder(normalized.Length);
        var pendingSpace = false;
        foreach (var character in normalized)
        {
            if (char.IsControl(character)) throw Invalid($"The {name} is invalid.");
            if (char.IsWhiteSpace(character))
            {
                pendingSpace = output.Length > 0;
                continue;
            }
            if (pendingSpace) output.Append(' ');
            pendingSpace = false;
            output.Append(character);
        }
        if (output.Length is 0 || output.Length > maximum)
            throw Invalid($"The {name} is invalid.");
        return output.ToString();
    }

    private static string NormalizeIdentifier(
        string value,
        int maximum,
        string name,
        bool trim = true)
    {
        ArgumentNullException.ThrowIfNull(value);
        var normalized = (trim ? value.Trim() : value).Normalize(NormalizationForm.FormC);
        if (normalized.Length is 0 || normalized.Length > maximum || normalized.Any(char.IsControl))
            throw Invalid($"The {name} is invalid.");
        return normalized;
    }

    private static string FormatLogic(ReferenceCatalogFilterLogic value) => value switch
    {
        ReferenceCatalogFilterLogic.All => "all",
        ReferenceCatalogFilterLogic.Any => "any",
        _ => throw Invalid("The saved filter logic is unsupported."),
    };

    private static ReferenceCatalogFilterLogic ParseLogic(string? value) => value switch
    {
        "all" => ReferenceCatalogFilterLogic.All,
        "any" => ReferenceCatalogFilterLogic.Any,
        _ => throw new JsonException("The saved filter logic is invalid."),
    };

    private static string FormatOperator(ReferenceCatalogFilterOperator value) => value switch
    {
        ReferenceCatalogFilterOperator.TextEquals => "eq",
        ReferenceCatalogFilterOperator.TextPrefix => "prefix",
        ReferenceCatalogFilterOperator.Exists => "exists",
        ReferenceCatalogFilterOperator.Missing => "missing",
        ReferenceCatalogFilterOperator.IsNull => "null",
        ReferenceCatalogFilterOperator.IsBlank => "blank",
        _ => throw Invalid("The saved filter operator is unsupported."),
    };

    private static ReferenceCatalogFilterOperator ParseOperator(string? value) => value switch
    {
        "eq" => ReferenceCatalogFilterOperator.TextEquals,
        "prefix" => ReferenceCatalogFilterOperator.TextPrefix,
        "exists" => ReferenceCatalogFilterOperator.Exists,
        "missing" => ReferenceCatalogFilterOperator.Missing,
        "null" => ReferenceCatalogFilterOperator.IsNull,
        "blank" => ReferenceCatalogFilterOperator.IsBlank,
        _ => throw new JsonException("The saved filter operator is invalid."),
    };

    private static string FormatSort(ReferenceCatalogSort value) => value switch
    {
        ReferenceCatalogSort.Relevance => "relevance",
        ReferenceCatalogSort.SourceKeyAscending => "source-key-asc",
        ReferenceCatalogSort.SourceKeyDescending => "source-key-desc",
        ReferenceCatalogSort.EntityTypeAscending => "entity-type-asc",
        _ => throw Invalid("The saved filter sort is unsupported."),
    };

    private static ReferenceCatalogSort ParseSort(string? value) => value switch
    {
        "relevance" => ReferenceCatalogSort.Relevance,
        "source-key-asc" => ReferenceCatalogSort.SourceKeyAscending,
        "source-key-desc" => ReferenceCatalogSort.SourceKeyDescending,
        "entity-type-asc" => ReferenceCatalogSort.EntityTypeAscending,
        _ => throw new JsonException("The saved filter sort is invalid."),
    };

    private static ReferenceCatalogSavedFilterException Invalid(string message) =>
        new("catalog_saved_filter_invalid", message);

    private sealed record PersistedQuery(
        int Version,
        string? Text,
        string? ExactSourceKey,
        IReadOnlyList<string>? EntityTypes,
        string? FilterLogic,
        IReadOnlyList<PersistedFilter>? Filters,
        string? Sort);

    private sealed record PersistedFilter(string? Field, string? Operator, string? Value);
}

public sealed class ReferenceCatalogSavedFilterException : Exception
{
    public ReferenceCatalogSavedFilterException(
        string code,
        string message,
        Exception? innerException = null)
        : base(message, innerException) => Code = code;

    public string Code { get; }
}
