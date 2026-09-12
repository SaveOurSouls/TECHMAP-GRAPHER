using System.Collections.ObjectModel;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Techmap.Domain;

public readonly record struct ReferenceCatalogSnapshotIdentity(Guid Value)
{
    public static ReferenceCatalogSnapshotIdentity New() => new(Guid.NewGuid());
}

public readonly record struct ReferenceCatalogRecordIdentity(string Value);

public enum ReferenceCatalogDiagnosticSeverity
{
    Warning,
    Error,
}

public enum ReferenceCatalogValidationState
{
    Validated,
    ValidatedWithWarnings,
}

public sealed record ReferenceCatalogProvenanceInput(
    string SourceKind,
    string VersionFingerprint,
    string? SourceUri = null);

public sealed record ReferenceCatalogRecordInput(
    string EntityType,
    string SourceKey,
    JsonElement Payload,
    string? SourceLocation = null);

public sealed record ReferenceCatalogDiagnosticInput(
    ReferenceCatalogDiagnosticSeverity Severity,
    string Code,
    string Message,
    string? EntityType = null,
    string? SourceKey = null,
    string? Field = null,
    string? SourceLocation = null);

public sealed class ReferenceCatalogProvenance(
    string sourceKind,
    string versionFingerprint,
    string? sourceUri)
{
    public string SourceKind { get; } = sourceKind;
    public string VersionFingerprint { get; } = versionFingerprint;
    public string? SourceUri { get; } = sourceUri;
}

public sealed class ReferenceCatalogRecord(
    ReferenceCatalogRecordIdentity recordId,
    ReferenceCatalogSnapshotIdentity snapshotId,
    string sourceId,
    string entityType,
    string sourceKey,
    JsonElement payload,
    string? sourceLocation)
{
    public ReferenceCatalogRecordIdentity RecordId { get; } = recordId;
    public ReferenceCatalogSnapshotIdentity SnapshotId { get; } = snapshotId;
    public string SourceId { get; } = sourceId;
    public string EntityType { get; } = entityType;
    public string SourceKey { get; } = sourceKey;
    public JsonElement Payload { get; } = payload;
    public string? SourceLocation { get; } = sourceLocation;
}

public sealed class ReferenceCatalogDiagnostic(
    string diagnosticId,
    ReferenceCatalogDiagnosticSeverity severity,
    string code,
    string message,
    string? entityType,
    string? sourceKey,
    string? field,
    string? sourceLocation)
{
    public string DiagnosticId { get; } = diagnosticId;
    public ReferenceCatalogDiagnosticSeverity Severity { get; } = severity;
    public string Code { get; } = code;
    public string Message { get; } = message;
    public string? EntityType { get; } = entityType;
    public string? SourceKey { get; } = sourceKey;
    public string? Field { get; } = field;
    public string? SourceLocation { get; } = sourceLocation;
}

public sealed class ReferenceCatalogDraft
{
    private readonly ReadOnlyCollection<ReferenceCatalogRecordInput> records;
    private readonly ReadOnlyCollection<ReferenceCatalogDiagnosticInput> diagnostics;

    private ReferenceCatalogDraft(
        ReferenceCatalogSnapshotIdentity snapshotId,
        string sourceId,
        int contractVersion,
        DateTimeOffset capturedUtc,
        ReferenceCatalogProvenanceInput provenance,
        IEnumerable<ReferenceCatalogRecordInput> records,
        IEnumerable<ReferenceCatalogDiagnosticInput> diagnostics)
    {
        SnapshotId = snapshotId;
        SourceId = sourceId;
        ContractVersion = contractVersion;
        CapturedUtc = capturedUtc;
        Provenance = provenance;
        this.records = Array.AsReadOnly(records.Select(Clone).ToArray());
        this.diagnostics = Array.AsReadOnly(diagnostics.ToArray());
    }

    public ReferenceCatalogSnapshotIdentity SnapshotId { get; }
    public string SourceId { get; }
    public int ContractVersion { get; }
    public DateTimeOffset CapturedUtc { get; }
    public ReferenceCatalogProvenanceInput Provenance { get; }
    public IReadOnlyList<ReferenceCatalogRecordInput> Records => records;
    public IReadOnlyList<ReferenceCatalogDiagnosticInput> Diagnostics => diagnostics;

    public static ReferenceCatalogDraft Create(
        ReferenceCatalogSnapshotIdentity snapshotId,
        string sourceId,
        int contractVersion,
        DateTimeOffset capturedUtc,
        ReferenceCatalogProvenanceInput provenance,
        IEnumerable<ReferenceCatalogRecordInput> records,
        IEnumerable<ReferenceCatalogDiagnosticInput>? diagnostics = null)
    {
        if (snapshotId.Value == Guid.Empty)
            throw new ArgumentException("The snapshot ID must not be empty.", nameof(snapshotId));
        if (contractVersion <= 0)
            throw new ArgumentOutOfRangeException(nameof(contractVersion));
        ArgumentNullException.ThrowIfNull(provenance);
        ArgumentNullException.ThrowIfNull(records);

        var utc = capturedUtc.ToUniversalTime();
        if (utc == default)
            throw new ArgumentOutOfRangeException(nameof(capturedUtc));

        return new ReferenceCatalogDraft(
            snapshotId,
            ReferenceCatalogCanonicalizer.NormalizeRequired(sourceId, nameof(sourceId)),
            contractVersion,
            utc,
            provenance,
            records,
            diagnostics ?? []);
    }

    public ReferenceCatalogValidationResult Validate() => ReferenceCatalogCanonicalizer.Validate(this);

    private static ReferenceCatalogRecordInput Clone(ReferenceCatalogRecordInput value) =>
        value with { Payload = value.Payload.Clone() };
}

public sealed class ReferenceCatalogValidationResult
{
    internal ReferenceCatalogValidationResult(
        ReferenceCatalogSnapshot? snapshot,
        IReadOnlyList<ReferenceCatalogDiagnostic> diagnostics)
    {
        Snapshot = snapshot;
        Diagnostics = diagnostics;
    }

    public bool IsValid => Snapshot is not null;
    public ReferenceCatalogSnapshot? Snapshot { get; }
    public IReadOnlyList<ReferenceCatalogDiagnostic> Diagnostics { get; }
    public IReadOnlyList<string> RequiredWarningAcknowledgements => Diagnostics
        .Where(item => item.Severity == ReferenceCatalogDiagnosticSeverity.Warning)
        .Select(item => item.DiagnosticId)
        .ToArray();
}

public sealed class ReferenceCatalogSnapshot
{
    internal ReferenceCatalogSnapshot(
        ReferenceCatalogSnapshotIdentity snapshotId,
        string sourceId,
        int contractVersion,
        DateTimeOffset capturedUtc,
        ReferenceCatalogProvenance provenance,
        IReadOnlyList<ReferenceCatalogRecord> records,
        IReadOnlyList<ReferenceCatalogDiagnostic> diagnostics,
        ReferenceCatalogValidationState validationState,
        string canonicalJson,
        string sha256)
    {
        SnapshotId = snapshotId;
        SourceId = sourceId;
        ContractVersion = contractVersion;
        CapturedUtc = capturedUtc;
        Provenance = provenance;
        Records = records;
        Diagnostics = diagnostics;
        ValidationState = validationState;
        CanonicalJson = canonicalJson;
        Sha256 = sha256;
    }

    public ReferenceCatalogSnapshotIdentity SnapshotId { get; }
    public string SourceId { get; }
    public int ContractVersion { get; }
    public DateTimeOffset CapturedUtc { get; }
    public ReferenceCatalogProvenance Provenance { get; }
    public IReadOnlyList<ReferenceCatalogRecord> Records { get; }
    public IReadOnlyList<ReferenceCatalogDiagnostic> Diagnostics { get; }
    public ReferenceCatalogValidationState ValidationState { get; }
    public string CanonicalJson { get; }
    public string Sha256 { get; }
}

internal static class ReferenceCatalogCanonicalizer
{
    private const int CanonicalSchemaVersion = 1;

    internal static ReferenceCatalogValidationResult Validate(ReferenceCatalogDraft draft)
    {
        var diagnostics = new List<ReferenceCatalogDiagnostic>();
        foreach (var input in draft.Diagnostics)
            diagnostics.Add(CreateDiagnostic(input));

        var normalizedRecords = new List<ReferenceCatalogRecord>();
        foreach (var input in draft.Records)
        {
            try
            {
                var entityType = NormalizeRequired(input.EntityType, nameof(input.EntityType));
                var sourceKey = NormalizeRequired(input.SourceKey, nameof(input.SourceKey), trim: false);
                var payload = CanonicalizePayload(input.Payload);
                normalizedRecords.Add(new ReferenceCatalogRecord(
                    new ReferenceCatalogRecordIdentity(HashText($"{draft.SourceId}\n{entityType}\n{sourceKey}")),
                    draft.SnapshotId,
                    draft.SourceId,
                    entityType,
                    sourceKey,
                    payload,
                    NormalizeOptional(input.SourceLocation, nameof(input.SourceLocation))));
            }
            catch (Exception exception) when (exception is ArgumentException or InvalidDataException)
            {
                diagnostics.Add(CreateDiagnostic(new ReferenceCatalogDiagnosticInput(
                    ReferenceCatalogDiagnosticSeverity.Error,
                    "invalid-record",
                    exception.Message,
                    input.EntityType,
                    input.SourceKey,
                    SourceLocation: input.SourceLocation)));
            }
        }

        if (normalizedRecords.Count == 0)
        {
            diagnostics.Add(CreateDiagnostic(new ReferenceCatalogDiagnosticInput(
                ReferenceCatalogDiagnosticSeverity.Error,
                "empty-snapshot",
                "A reference snapshot must contain at least one valid record.")));
        }

        foreach (var duplicate in normalizedRecords.GroupBy(
                     item => (item.EntityType, item.SourceKey),
                     StringTupleComparer.Instance).Where(group => group.Count() > 1))
        {
            diagnostics.Add(CreateDiagnostic(new ReferenceCatalogDiagnosticInput(
                ReferenceCatalogDiagnosticSeverity.Error,
                "duplicate-record-key",
                "The source contains more than one record with this entity type and source key.",
                duplicate.Key.EntityType,
                duplicate.Key.SourceKey)));
        }

        var orderedDiagnostics = Array.AsReadOnly(diagnostics
            .DistinctBy(item => item.DiagnosticId, StringComparer.Ordinal)
            .OrderBy(item => item.DiagnosticId, StringComparer.Ordinal)
            .ToArray());
        if (orderedDiagnostics.Any(item => item.Severity == ReferenceCatalogDiagnosticSeverity.Error))
            return new ReferenceCatalogValidationResult(null, orderedDiagnostics);

        var orderedRecords = Array.AsReadOnly(normalizedRecords
            .OrderBy(item => item.EntityType, StringComparer.Ordinal)
            .ThenBy(item => item.SourceKey, StringComparer.Ordinal)
            .ToArray());
        var provenance = new ReferenceCatalogProvenance(
            NormalizeRequired(draft.Provenance.SourceKind, nameof(draft.Provenance.SourceKind)),
            NormalizeRequired(draft.Provenance.VersionFingerprint, nameof(draft.Provenance.VersionFingerprint), trim: false),
            NormalizeOptional(draft.Provenance.SourceUri, nameof(draft.Provenance.SourceUri)));
        var validationState = orderedDiagnostics.Any(item => item.Severity == ReferenceCatalogDiagnosticSeverity.Warning)
            ? ReferenceCatalogValidationState.ValidatedWithWarnings
            : ReferenceCatalogValidationState.Validated;
        var canonicalJson = WriteSnapshot(draft, provenance, orderedRecords, orderedDiagnostics, validationState);
        var snapshot = new ReferenceCatalogSnapshot(
            draft.SnapshotId, draft.SourceId, draft.ContractVersion, draft.CapturedUtc,
            provenance, orderedRecords, orderedDiagnostics, validationState, canonicalJson, HashText(canonicalJson));
        return new ReferenceCatalogValidationResult(snapshot, orderedDiagnostics);
    }

    internal static string NormalizeRequired(string value, string parameterName, bool trim = true)
    {
        ArgumentNullException.ThrowIfNull(value, parameterName);
        var normalized = (trim ? value.Trim() : value).Normalize(NormalizationForm.FormC);
        if (normalized.Length == 0)
            throw new ArgumentException("The value must not be empty.", parameterName);
        RejectControlCharacters(normalized, parameterName);
        return normalized;
    }

    private static string? NormalizeOptional(string? value, string parameterName)
    {
        if (value is null)
            return null;
        var normalized = value.Normalize(NormalizationForm.FormC);
        RejectControlCharacters(normalized, parameterName);
        return normalized;
    }

    private static void RejectControlCharacters(string value, string parameterName)
    {
        if (value.Any(char.IsControl))
            throw new ArgumentException("The value must not contain control characters.", parameterName);
    }

    private static ReferenceCatalogDiagnostic CreateDiagnostic(ReferenceCatalogDiagnosticInput input)
    {
        var code = NormalizeRequired(input.Code, nameof(input.Code));
        var message = NormalizeRequired(input.Message, nameof(input.Message));
        var entityType = NormalizeOptional(input.EntityType, nameof(input.EntityType));
        var sourceKey = NormalizeOptional(input.SourceKey, nameof(input.SourceKey));
        var field = NormalizeOptional(input.Field, nameof(input.Field));
        var stableText = $"{input.Severity}\n{code}\n{message}\n{entityType}\n{sourceKey}\n{field}";
        return new ReferenceCatalogDiagnostic(
            HashText(stableText), input.Severity, code, message, entityType, sourceKey, field,
            NormalizeOptional(input.SourceLocation, nameof(input.SourceLocation)));
    }

    private static JsonElement CanonicalizePayload(JsonElement payload)
    {
        if (payload.ValueKind == JsonValueKind.Undefined)
            throw new InvalidDataException("A record payload must be a JSON value.");
        using var buffer = new MemoryStream();
        using (var writer = new Utf8JsonWriter(buffer))
            WriteCanonicalValue(writer, payload);
        using var document = JsonDocument.Parse(buffer.ToArray());
        return document.RootElement.Clone();
    }

    private static void WriteCanonicalValue(Utf8JsonWriter writer, JsonElement value)
    {
        switch (value.ValueKind)
        {
            case JsonValueKind.Object:
                writer.WriteStartObject();
                var properties = value.EnumerateObject()
                    .Select(property => (Name: NormalizeRequired(property.Name, "propertyName", trim: false), property.Value))
                    .OrderBy(property => property.Name, StringComparer.Ordinal)
                    .ToArray();
                if (properties.GroupBy(property => property.Name, StringComparer.Ordinal).Any(group => group.Count() > 1))
                    throw new InvalidDataException("A payload contains duplicate property names after Unicode normalization.");
                foreach (var property in properties)
                {
                    writer.WritePropertyName(property.Name);
                    WriteCanonicalValue(writer, property.Value);
                }
                writer.WriteEndObject();
                break;
            case JsonValueKind.Array:
                writer.WriteStartArray();
                foreach (var item in value.EnumerateArray())
                    WriteCanonicalValue(writer, item);
                writer.WriteEndArray();
                break;
            case JsonValueKind.String:
                writer.WriteStringValue(NormalizeOptional(value.GetString(), "payloadString"));
                break;
            case JsonValueKind.Number:
                var raw = value.GetRawText();
                if (value.TryGetInt64(out var integer))
                    writer.WriteNumberValue(integer);
                else if (value.TryGetDecimal(out var number))
                {
                    var canonicalNumber = number.ToString("G29", CultureInfo.InvariantCulture);
                    using var canonicalDocument = JsonDocument.Parse(canonicalNumber);
                    if (!JsonElement.DeepEquals(value, canonicalDocument.RootElement))
                        throw new InvalidDataException($"The JSON number '{raw}' cannot be represented exactly as Int64 or Decimal.");
                    writer.WriteRawValue(canonicalNumber, skipInputValidation: true);
                }
                else
                    throw new InvalidDataException($"The JSON number '{raw}' cannot be represented exactly as Int64 or Decimal.");
                break;
            case JsonValueKind.True:
                writer.WriteBooleanValue(true);
                break;
            case JsonValueKind.False:
                writer.WriteBooleanValue(false);
                break;
            case JsonValueKind.Null:
                writer.WriteNullValue();
                break;
            default:
                throw new InvalidDataException("Unsupported JSON value.");
        }
    }

    private static string WriteSnapshot(
        ReferenceCatalogDraft draft,
        ReferenceCatalogProvenance provenance,
        IReadOnlyList<ReferenceCatalogRecord> records,
        IReadOnlyList<ReferenceCatalogDiagnostic> diagnostics,
        ReferenceCatalogValidationState validationState)
    {
        using var buffer = new MemoryStream();
        using (var writer = new Utf8JsonWriter(buffer))
        {
            writer.WriteStartObject();
            writer.WriteNumber("canonicalSchemaVersion", CanonicalSchemaVersion);
            writer.WriteNumber("contractVersion", draft.ContractVersion);
            writer.WritePropertyName("diagnostics");
            writer.WriteStartArray();
            foreach (var diagnostic in diagnostics)
            {
                writer.WriteStartObject();
                writer.WriteString("code", diagnostic.Code);
                writer.WriteString("diagnosticId", diagnostic.DiagnosticId);
                WriteNullable(writer, "entityType", diagnostic.EntityType);
                WriteNullable(writer, "field", diagnostic.Field);
                writer.WriteString("message", diagnostic.Message);
                writer.WriteString("severity", diagnostic.Severity.ToString().ToLowerInvariant());
                WriteNullable(writer, "sourceKey", diagnostic.SourceKey);
                writer.WriteEndObject();
            }
            writer.WriteEndArray();
            writer.WritePropertyName("provenance");
            writer.WriteStartObject();
            writer.WriteString("sourceKind", provenance.SourceKind);
            if (provenance.SourceUri is null) writer.WriteNull("sourceUri"); else writer.WriteString("sourceUri", provenance.SourceUri);
            writer.WriteString("versionFingerprint", provenance.VersionFingerprint);
            writer.WriteEndObject();
            writer.WritePropertyName("records");
            writer.WriteStartArray();
            foreach (var record in records)
            {
                writer.WriteStartObject();
                writer.WriteString("entityType", record.EntityType);
                writer.WritePropertyName("payload");
                record.Payload.WriteTo(writer);
                writer.WriteString("recordId", record.RecordId.Value);
                writer.WriteString("sourceId", record.SourceId);
                writer.WriteString("sourceKey", record.SourceKey);
                writer.WriteEndObject();
            }
            writer.WriteEndArray();
            writer.WriteString("sourceId", draft.SourceId);
            writer.WriteString(
                "validationState",
                validationState == ReferenceCatalogValidationState.Validated
                    ? "validated"
                    : "validated-with-warnings");
            writer.WriteEndObject();
        }
        return Encoding.UTF8.GetString(buffer.ToArray());
    }

    private static void WriteNullable(Utf8JsonWriter writer, string name, string? value)
    {
        if (value is null) writer.WriteNull(name); else writer.WriteString(name, value);
    }

    private static string HashText(string value) =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(value)));

    private sealed class StringTupleComparer : IEqualityComparer<(string EntityType, string SourceKey)>
    {
        internal static readonly StringTupleComparer Instance = new();
        public bool Equals((string EntityType, string SourceKey) x, (string EntityType, string SourceKey) y) =>
            StringComparer.Ordinal.Equals(x.EntityType, y.EntityType) && StringComparer.Ordinal.Equals(x.SourceKey, y.SourceKey);
        public int GetHashCode((string EntityType, string SourceKey) value) =>
            HashCode.Combine(StringComparer.Ordinal.GetHashCode(value.EntityType), StringComparer.Ordinal.GetHashCode(value.SourceKey));
    }
}
