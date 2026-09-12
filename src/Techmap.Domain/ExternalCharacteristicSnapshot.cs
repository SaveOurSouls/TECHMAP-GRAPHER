using System.Text;
using System.Text.Json;

namespace Techmap.Domain;

public readonly record struct CharacteristicSnapshotIdentity(Guid Value)
{
    public static CharacteristicSnapshotIdentity New() => new(Guid.NewGuid());
}

public sealed class ExternalCharacteristicSnapshot
{
    public const int CanonicalPayloadSchemaVersion = 1;
    public const int MaximumSourceKindLength = 64;
    public const int MaximumSourceRecordKeyLength = 512;
    public const int MaximumSourceVersionFingerprintLength = 512;
    public const int MaximumCharacteristicNameLength = 256;
    public const int MaximumCharacteristicValueLength = 4096;
    public const int MaximumUnitLength = 64;

    private ExternalCharacteristicSnapshot(
        CharacteristicSnapshotIdentity snapshotId,
        string sourceKind,
        string sourceRecordKey,
        string sourceVersionFingerprint,
        string characteristicName,
        string characteristicValue,
        string unit,
        DateTimeOffset capturedUtc,
        string canonicalPayload)
    {
        SnapshotId = snapshotId;
        SourceKind = sourceKind;
        SourceRecordKey = sourceRecordKey;
        SourceVersionFingerprint = sourceVersionFingerprint;
        CharacteristicName = characteristicName;
        CharacteristicValue = characteristicValue;
        Unit = unit;
        CapturedUtc = capturedUtc;
        CanonicalPayload = canonicalPayload;
    }

    public CharacteristicSnapshotIdentity SnapshotId { get; }

    public string SourceKind { get; }

    public string SourceRecordKey { get; }

    public string SourceVersionFingerprint { get; }

    public string CharacteristicName { get; }

    public string CharacteristicValue { get; }

    public string Unit { get; }

    public DateTimeOffset CapturedUtc { get; }

    public string CanonicalPayload { get; }

    public static ExternalCharacteristicSnapshot Capture(
        CharacteristicSnapshotIdentity snapshotId,
        string sourceKind,
        string sourceRecordKey,
        string sourceVersionFingerprint,
        string characteristicName,
        string characteristicValue,
        string? unit,
        DateTimeOffset capturedUtc)
    {
        if (snapshotId.Value == Guid.Empty)
        {
            throw new ArgumentException("The snapshot ID must not be empty.", nameof(snapshotId));
        }

        var normalizedSourceKind = NormalizeSourceKind(sourceKind);
        var normalizedSourceRecordKey = NormalizeRequired(
            sourceRecordKey,
            MaximumSourceRecordKeyLength,
            nameof(sourceRecordKey));
        var normalizedSourceVersionFingerprint = NormalizeRequired(
            sourceVersionFingerprint,
            MaximumSourceVersionFingerprintLength,
            nameof(sourceVersionFingerprint));
        var normalizedCharacteristicName = NormalizeRequired(
            characteristicName,
            MaximumCharacteristicNameLength,
            nameof(characteristicName));
        var normalizedCharacteristicValue = NormalizeRequired(
            characteristicValue,
            MaximumCharacteristicValueLength,
            nameof(characteristicValue));
        var normalizedUnit = NormalizeOptional(unit, MaximumUnitLength, nameof(unit));
        var normalizedCapturedUtc = capturedUtc.ToUniversalTime();
        if (normalizedCapturedUtc == default)
        {
            throw new ArgumentOutOfRangeException(
                nameof(capturedUtc),
                "The capture time must be a real UTC timestamp.");
        }

        return new ExternalCharacteristicSnapshot(
            snapshotId,
            normalizedSourceKind,
            normalizedSourceRecordKey,
            normalizedSourceVersionFingerprint,
            normalizedCharacteristicName,
            normalizedCharacteristicValue,
            normalizedUnit,
            normalizedCapturedUtc,
            CreateCanonicalPayload(
                normalizedSourceKind,
                normalizedSourceRecordKey,
                normalizedSourceVersionFingerprint,
                normalizedCharacteristicName,
                normalizedCharacteristicValue,
                normalizedUnit));
    }

    private static string NormalizeSourceKind(string value)
    {
        var normalized = NormalizeRequired(
            value,
            MaximumSourceKindLength,
            nameof(value)).ToLowerInvariant();
        if (!IsSourceKindToken(normalized))
        {
            throw new ArgumentException(
                "The source kind may contain only lowercase letters, digits, '.', '_' and '-'.",
                nameof(value));
        }

        return normalized;
    }

    private static bool IsSourceKindToken(string value)
    {
        if (value[0] is not (>= 'a' and <= 'z') and not (>= '0' and <= '9'))
        {
            return false;
        }

        return value.All(character =>
            character is >= 'a' and <= 'z' or >= '0' and <= '9' or '.' or '_' or '-');
    }

    private static string NormalizeRequired(string value, int maximumLength, string parameterName)
    {
        ArgumentNullException.ThrowIfNull(value, parameterName);
        var normalized = value.Trim().Normalize(NormalizationForm.FormC);
        if (normalized.Length == 0)
        {
            throw new ArgumentException("The value must not be blank.", parameterName);
        }

        ValidateNormalizedText(normalized, maximumLength, parameterName);
        return normalized;
    }

    private static string NormalizeOptional(string? value, int maximumLength, string parameterName)
    {
        var normalized = (value ?? string.Empty).Trim().Normalize(NormalizationForm.FormC);
        ValidateNormalizedText(normalized, maximumLength, parameterName);
        return normalized;
    }

    private static void ValidateNormalizedText(
        string value,
        int maximumLength,
        string parameterName)
    {
        if (value.Length > maximumLength)
        {
            throw new ArgumentException(
                $"The value must not exceed {maximumLength} characters.",
                parameterName);
        }

        if (value.Any(char.IsControl))
        {
            throw new ArgumentException("The value must not contain control characters.", parameterName);
        }
    }

    private static string CreateCanonicalPayload(
        string sourceKind,
        string sourceRecordKey,
        string sourceVersionFingerprint,
        string characteristicName,
        string characteristicValue,
        string unit)
    {
        using var buffer = new MemoryStream();
        using (var writer = new Utf8JsonWriter(buffer))
        {
            writer.WriteStartObject();
            writer.WriteNumber("schemaVersion", CanonicalPayloadSchemaVersion);
            writer.WriteString("sourceKind", sourceKind);
            writer.WriteString("sourceRecordKey", sourceRecordKey);
            writer.WriteString("sourceVersionFingerprint", sourceVersionFingerprint);
            writer.WriteString("characteristicName", characteristicName);
            writer.WriteString("characteristicValue", characteristicValue);
            writer.WriteString("unit", unit);
            writer.WriteEndObject();
        }

        return Encoding.UTF8.GetString(buffer.ToArray());
    }
}
