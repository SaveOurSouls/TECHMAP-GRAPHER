using System.Globalization;
using System.Text;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using Techmap.Domain;

namespace Techmap.Infrastructure.Sqlite;

internal static class ReferenceCatalogSearchProjection
{
    private const int MaximumIndexedFieldNameLength = 256;
    private const int MaximumIndexedScalarLength = 32_767;

    public static void Replace(SqliteUnitOfWork unitOfWork, string sourceDatabaseId, ReferenceCatalogSnapshot snapshot)
    {
        var records = snapshot.Records.Select(record => new ProjectionRecord(
            record.EntityType, record.SourceKey, record.Payload.GetRawText())).ToArray();
        Replace(unitOfWork.Connection, unitOfWork.Transaction, sourceDatabaseId,
            snapshot.SnapshotId.Value.ToString("D", CultureInfo.InvariantCulture), records);
    }

    public static void Backfill(SqliteConnection connection, SqliteTransaction transaction)
    {
        var heads = new List<(string SourceId, string SnapshotId)>();
        using (var command = Command(connection, transaction,
                   "SELECT source_id, snapshot_id FROM reference_source_heads ORDER BY source_id;"))
        using (var reader = command.ExecuteReader())
        {
            while (reader.Read()) heads.Add((reader.GetString(0), reader.GetString(1)));
        }

        foreach (var head in heads)
        {
            var records = new List<ProjectionRecord>();
            using (var command = Command(connection, transaction,
                       """
                       SELECT entity_type, source_record_key, canonical_payload
                       FROM reference_snapshot_records
                       WHERE snapshot_id = $snapshotId
                       ORDER BY entity_type, source_record_key;
                       """))
            {
                command.Parameters.AddWithValue("$snapshotId", head.SnapshotId);
                using var reader = command.ExecuteReader();
                while (reader.Read())
                    records.Add(new ProjectionRecord(reader.GetString(0), reader.GetString(1), reader.GetString(2)));
            }
            Replace(connection, transaction, head.SourceId, head.SnapshotId, records);
        }
    }

    private static void Replace(SqliteConnection connection, SqliteTransaction transaction,
        string sourceDatabaseId, string snapshotId, IReadOnlyList<ProjectionRecord> records)
    {
        using (var delete = Command(connection, transaction,
                   "DELETE FROM reference_search_projections WHERE source_id = $sourceId;"))
        {
            delete.Parameters.AddWithValue("$sourceId", sourceDatabaseId);
            delete.ExecuteNonQuery();
        }
        using (var projection = Command(connection, transaction,
                   """
                   INSERT INTO reference_search_projections
                       (source_id, snapshot_id, projection_version, record_count)
                   VALUES ($sourceId, $snapshotId, 1, $recordCount);
                   """))
        {
            projection.Parameters.AddWithValue("$sourceId", sourceDatabaseId);
            projection.Parameters.AddWithValue("$snapshotId", snapshotId);
            projection.Parameters.AddWithValue("$recordCount", records.Count);
            projection.ExecuteNonQuery();
        }

        foreach (var record in records) InsertRecord(connection, transaction, sourceDatabaseId, snapshotId, record);
    }

    private static void InsertRecord(SqliteConnection connection, SqliteTransaction transaction,
        string sourceDatabaseId, string snapshotId, ProjectionRecord record)
    {
        using var document = JsonDocument.Parse(record.Payload);
        var expected = BuildExpected(record.EntityType, record.SourceKey, document.RootElement);
        long searchId;
        using (var insert = Command(connection, transaction,
                   """
                   INSERT INTO reference_search_records
                       (source_id, snapshot_id, entity_type, source_record_key,
                        normalized_source_key, search_text)
                   VALUES ($sourceId, $snapshotId, $entityType, $sourceKey, $normalizedKey, $searchText)
                   RETURNING search_id;
                   """))
        {
            insert.Parameters.AddWithValue("$sourceId", sourceDatabaseId);
            insert.Parameters.AddWithValue("$snapshotId", snapshotId);
            insert.Parameters.AddWithValue("$entityType", record.EntityType);
            insert.Parameters.AddWithValue("$sourceKey", record.SourceKey);
            insert.Parameters.AddWithValue("$normalizedKey", expected.NormalizedSourceKey);
            insert.Parameters.AddWithValue("$searchText", expected.SearchText);
            searchId = Convert.ToInt64(insert.ExecuteScalar(), CultureInfo.InvariantCulture);
        }

        foreach (var projected in expected.Fields)
        {
            using var field = Command(connection, transaction,
                """
                INSERT INTO reference_search_fields
                    (search_id, field_ordinal, source_id, entity_type, source_record_key,
                     source_field_name, field_name, value_kind, normalized_text)
                VALUES ($searchId, $fieldOrdinal, $sourceId, $entityType, $sourceKey,
                        $sourceField, $field, $kind, $text);
                """);
            field.Parameters.AddWithValue("$searchId", searchId);
            field.Parameters.AddWithValue("$fieldOrdinal", projected.Ordinal);
            field.Parameters.AddWithValue("$sourceId", sourceDatabaseId);
            field.Parameters.AddWithValue("$entityType", record.EntityType);
            field.Parameters.AddWithValue("$sourceKey", record.SourceKey);
            field.Parameters.AddWithValue("$sourceField", projected.SourceFieldName);
            field.Parameters.AddWithValue("$field", projected.FieldName is null ? DBNull.Value : projected.FieldName);
            field.Parameters.AddWithValue("$kind", projected.ValueKind);
            field.Parameters.AddWithValue("$text", projected.NormalizedText is null ? DBNull.Value : projected.NormalizedText);
            field.ExecuteNonQuery();
        }
    }

    internal static string NormalizeText(string value)
    {
        var normalized = value.Normalize(NormalizationForm.FormC).Trim();
        var output = new StringBuilder(normalized.Length);
        var pendingSpace = false;
        foreach (var character in normalized)
        {
            if (char.IsWhiteSpace(character)) { pendingSpace = output.Length > 0; continue; }
            if (pendingSpace) output.Append(' ');
            pendingSpace = false;
            output.Append(char.ToUpperInvariant(character));
        }
        return output.ToString();
    }

    internal static string NormalizeSearchKey(string value)
    {
        var normalized = NormalizeText(value);
        return normalized.Length == 0 ? value.Normalize(NormalizationForm.FormC) : normalized;
    }

    internal static IReadOnlyList<string> SearchTokens(string text) =>
        NormalizeText(text).Split(' ', StringSplitOptions.RemoveEmptyEntries)
            .SelectMany(Tokenize).Where(token => token.Length > 0)
            .Distinct(StringComparer.Ordinal).ToArray();

    internal static ExpectedRecord BuildExpected(
        string entityType,
        string sourceKey,
        string canonicalPayload)
    {
        using var document = JsonDocument.Parse(canonicalPayload);
        return BuildExpected(entityType, sourceKey, document.RootElement);
    }

    private static ExpectedRecord BuildExpected(
        string entityType,
        string sourceKey,
        JsonElement payload)
    {
        var fields = new List<ExpectedField>();
        if (payload.ValueKind == JsonValueKind.Object)
        {
            foreach (var property in payload.EnumerateObject())
            {
                var projected = ProjectScalar(property.Value);
                if (projected.Kind is null) continue;
                var normalizedFieldName = NormalizeText(property.Name);
                var indexedFieldName = normalizedFieldName.Length is >= 1 and <= MaximumIndexedFieldNameLength
                    ? normalizedFieldName
                    : null;
                var indexedText = projected.NormalizedText?.Length <= MaximumIndexedScalarLength
                    ? projected.NormalizedText
                    : null;
                fields.Add(new ExpectedField(
                    fields.Count,
                    property.Name,
                    indexedFieldName,
                    projected.Kind,
                    indexedText));
            }
        }
        return new ExpectedRecord(
            NormalizeSearchKey(sourceKey),
            BuildSearchText(entityType, sourceKey, payload),
            fields);
    }

    private static IEnumerable<string> Tokenize(string value)
    {
        var token = new StringBuilder();
        foreach (var character in value)
        {
            if (char.IsLetterOrDigit(character)) token.Append(character);
            else if (token.Length > 0) { yield return token.ToString(); token.Clear(); }
        }
        if (token.Length > 0) yield return token.ToString();
    }

    private static string BuildSearchText(string entityType, string sourceKey, JsonElement payload)
    {
        var values = new List<string> { sourceKey, entityType };
        AppendScalars(payload, values);
        return NormalizeText(string.Join(' ', values));
    }

    private static (string? Kind, string? NormalizedText) ProjectScalar(JsonElement value) =>
        value.ValueKind switch
        {
            JsonValueKind.String when value.GetString()?.Length == 0 => ("blank", ""),
            JsonValueKind.String => ("text", NormalizeText(value.GetString() ?? "")),
            JsonValueKind.Number => ("number", value.GetRawText()),
            JsonValueKind.True => ("boolean", "TRUE"),
            JsonValueKind.False => ("boolean", "FALSE"),
            JsonValueKind.Null => ("null", null),
            _ => (null, null),
        };

    private static void AppendScalars(JsonElement value, ICollection<string> values)
    {
        switch (value.ValueKind)
        {
            case JsonValueKind.Object:
                foreach (var property in value.EnumerateObject()) AppendScalars(property.Value, values);
                break;
            case JsonValueKind.Array:
                foreach (var item in value.EnumerateArray()) AppendScalars(item, values);
                break;
            case JsonValueKind.String:
                values.Add(value.GetString() ?? "");
                break;
            case JsonValueKind.Number:
            case JsonValueKind.True:
            case JsonValueKind.False:
                values.Add(value.GetRawText());
                break;
        }
    }

    private static SqliteCommand Command(SqliteConnection connection, SqliteTransaction transaction, string sql)
    {
        var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = sql;
        return command;
    }

    private sealed record ProjectionRecord(string EntityType, string SourceKey, string Payload);

    internal sealed record ExpectedRecord(
        string NormalizedSourceKey,
        string SearchText,
        IReadOnlyList<ExpectedField> Fields);

    internal sealed record ExpectedField(
        int Ordinal,
        string SourceFieldName,
        string? FieldName,
        string ValueKind,
        string? NormalizedText);
}
