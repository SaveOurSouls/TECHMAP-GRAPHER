using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using Techmap.Application;
using Techmap.Domain;

namespace Techmap.Infrastructure.Sqlite;

public sealed class SqliteReferenceCatalogSearchStore(SqliteStorage storage) : IReferenceCatalogSearchStore
{
    public const int MaximumTextLength = 256;
    public const int MaximumEntityTypes = 8;
    public const int MaximumFilters = 8;
    public const int MaximumFieldLength = 256;
    public const int MaximumFilterValueLength = 512;
    public const int MaximumPageSize = 100;

    public Task<ReferenceCatalogSearchPage> SearchAsync(
        string sourceId,
        ReferenceCatalogSnapshotIdentity? pinnedSnapshotId,
        ReferenceCatalogSearchQuery query,
        ReferenceCatalogSearchPosition? after,
        CancellationToken cancellationToken)
    {
        var normalizedSourceId = NormalizeIdentifier(sourceId, 256, nameof(sourceId), trim: false);
        var validated = Validate(query);
        return storage.ExecuteReadAsync(
            (unitOfWork, token) => SearchCoreAsync(
                unitOfWork, normalizedSourceId, pinnedSnapshotId, validated, after, token),
            cancellationToken);
    }

    private static async Task<ReferenceCatalogSearchPage> SearchCoreAsync(
        SqliteUnitOfWork unitOfWork,
        string sourceKey,
        ReferenceCatalogSnapshotIdentity? pinnedSnapshotId,
        ValidatedQuery query,
        ReferenceCatalogSearchPosition? after,
        CancellationToken cancellationToken)
    {
        string sourceDatabaseId;
        string snapshotRaw;
        string snapshotSha256;
        using (var head = unitOfWork.CreateCommand(
                   """
                   SELECT s.source_id, h.snapshot_id, r.canonical_content_sha256
                   FROM reference_sources s
                   JOIN reference_source_heads h ON h.source_id = s.source_id
                   JOIN reference_snapshots r ON r.snapshot_id = h.snapshot_id
                   JOIN reference_search_projections p
                     ON p.source_id = h.source_id AND p.snapshot_id = h.snapshot_id
                   WHERE s.source_key = $sourceKey
                     AND r.lifecycle_status = 'published';
                   """))
        {
            head.Parameters.AddWithValue("$sourceKey", sourceKey);
            await using var reader = await head.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
            if (!await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
                throw new ReferenceCatalogSearchException(
                    "catalog_active_snapshot_not_found",
                    "The reference source does not have a searchable active snapshot.");
            sourceDatabaseId = reader.GetString(0);
            snapshotRaw = reader.GetString(1);
            snapshotSha256 = reader.GetString(2);
        }

        var snapshotId = new ReferenceCatalogSnapshotIdentity(ParseGuid(snapshotRaw));
        if (pinnedSnapshotId is { } pinned && pinned != snapshotId)
            throw new ReferenceCatalogSearchException(
                "catalog_cursor_snapshot_changed",
                "The active reference snapshot changed. Start the search again.");

        var sql = new StringBuilder(
            """
            SELECT r.entity_type, r.source_record_key, d.source_location,
                   d.canonical_payload, d.payload_sha256, r.normalized_source_key,
            """);
        sql.Append(query.RankSql).AppendLine(" AS result_rank");
        sql.AppendLine(
            """
            FROM reference_search_records r
            JOIN reference_snapshot_records d
              ON d.snapshot_id = r.snapshot_id
             AND d.entity_type = r.entity_type
             AND d.source_record_key = r.source_record_key
            """);
        if (query.FtsExpression is not null)
            sql.AppendLine("JOIN reference_search_fts ON reference_search_fts.rowid = r.search_id");
        sql.AppendLine("WHERE r.source_id = $sourceId");
        if (query.FtsExpression is not null)
            sql.AppendLine("  AND reference_search_fts MATCH $fts");
        if (query.ExactSourceKey is not null)
            sql.AppendLine("  AND r.normalized_source_key = $exactSourceKey");
        if (query.EntityTypes.Count > 0)
            sql.Append("  AND r.entity_type IN (").Append(string.Join(", ",
                query.EntityTypes.Select((_, index) => $"$entity{index}"))).AppendLine(")");
        AppendFilters(sql, query);
        AppendPosition(sql, query.Sort, query.RankSql, after);
        sql.Append("ORDER BY ").Append(OrderBy(query.Sort)).AppendLine();
        sql.AppendLine("LIMIT $limit;");

        using var command = unitOfWork.CreateCommand(sql.ToString());
        command.Parameters.AddWithValue("$sourceId", sourceDatabaseId);
        command.Parameters.AddWithValue("$limit", query.PageSize + 1);
        if (query.FtsExpression is not null) command.Parameters.AddWithValue("$fts", query.FtsExpression);
        if (query.NormalizedText is not null) command.Parameters.AddWithValue("$searchText", query.NormalizedText);
        if (query.KeyPrefix is not null) command.Parameters.AddWithValue("$keyPrefix", query.KeyPrefix + "%");
        if (query.ExactSourceKey is not null) command.Parameters.AddWithValue("$exactSourceKey", query.ExactSourceKey);
        for (var index = 0; index < query.EntityTypes.Count; index++)
            command.Parameters.AddWithValue($"$entity{index}", query.EntityTypes[index]);
        AddFilterParameters(command, query);
        AddPositionParameters(command, after);

        var records = new List<(ReferenceCatalogSearchRecord Record, ReferenceCatalogSearchPosition Position)>();
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false))
        {
            while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            {
                var entityType = reader.GetString(0);
                var recordKey = reader.GetString(1);
                var location = reader.IsDBNull(2) ? null : reader.GetString(2);
                var payloadText = reader.GetString(3);
                if (!string.Equals(
                        SqliteReferenceCatalogSnapshotStore.HashRecordMetadata(
                            entityType, recordKey, location, payloadText),
                        reader.GetString(4), StringComparison.Ordinal))
                    throw new InvalidDataException("A searchable reference record has corrupt persisted metadata.");
                using var document = JsonDocument.Parse(payloadText);
                var recordId = Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(
                    $"{sourceKey}\n{entityType}\n{recordKey}")));
                records.Add((new ReferenceCatalogSearchRecord(
                        recordId, entityType, recordKey, document.RootElement.Clone(), location),
                    new ReferenceCatalogSearchPosition(reader.GetInt32(6), reader.GetString(5), recordKey, entityType)));
            }
        }

        var hasMore = records.Count > query.PageSize;
        if (hasMore) records.RemoveAt(records.Count - 1);
        return new ReferenceCatalogSearchPage(
            snapshotId,
            snapshotSha256,
            records.Select(item => item.Record).ToArray(),
            hasMore,
            hasMore && records.Count > 0 ? records[^1].Position : null);
    }

    private static void AppendFilters(StringBuilder sql, ValidatedQuery query)
    {
        if (query.Filters.Count == 0) return;
        var parts = query.Filters.Select((filter, index) => FilterSql(filter, index)).ToArray();
        sql.Append("  AND (").Append(string.Join(
            query.FilterLogic == ReferenceCatalogFilterLogic.All ? " AND " : " OR ", parts)).AppendLine(")");
    }

    private static string FilterSql(ValidatedFilter filter, int index)
    {
        var core = $"SELECT 1 FROM reference_search_fields f{index} WHERE f{index}.search_id = r.search_id AND f{index}.field_name = $field{index}";
        return filter.Operator switch
        {
            ReferenceCatalogFilterOperator.Missing => $"NOT EXISTS ({core})",
            ReferenceCatalogFilterOperator.Exists => $"EXISTS ({core})",
            ReferenceCatalogFilterOperator.IsNull => $"EXISTS ({core} AND f{index}.value_kind = 'null')",
            ReferenceCatalogFilterOperator.IsBlank => $"EXISTS ({core} AND f{index}.value_kind = 'blank')",
            ReferenceCatalogFilterOperator.TextEquals => $"EXISTS ({core} AND f{index}.normalized_text = $value{index})",
            ReferenceCatalogFilterOperator.TextPrefix => $"EXISTS ({core} AND f{index}.normalized_text >= $value{index} AND f{index}.normalized_text < $upper{index})",
            _ => throw new InvalidOperationException("Unsupported reference filter operator."),
        };
    }

    private static void AddFilterParameters(SqliteCommand command, ValidatedQuery query)
    {
        for (var index = 0; index < query.Filters.Count; index++)
        {
            var filter = query.Filters[index];
            command.Parameters.AddWithValue($"$field{index}", filter.Field);
            if (filter.Value is null) continue;
            command.Parameters.AddWithValue($"$value{index}", filter.Value);
            if (filter.Operator == ReferenceCatalogFilterOperator.TextPrefix)
                command.Parameters.AddWithValue(
                    $"$upper{index}", filter.Value + char.ConvertFromUtf32(0x10ffff));
        }
    }

    private static void AppendPosition(
        StringBuilder sql,
        ReferenceCatalogSort sort,
        string rankSql,
        ReferenceCatalogSearchPosition? after)
    {
        if (after is null) return;
        sql.AppendLine(sort switch
        {
            ReferenceCatalogSort.Relevance =>
                $"  AND (({rankSql}) > $afterRank OR (({rankSql}) = $afterRank AND (r.normalized_source_key > $afterNormalizedKey OR (r.normalized_source_key = $afterNormalizedKey AND (r.source_record_key > $afterSourceKey OR (r.source_record_key = $afterSourceKey AND r.entity_type > $afterEntityType))))))",
            ReferenceCatalogSort.SourceKeyAscending =>
                "  AND (r.normalized_source_key > $afterNormalizedKey OR (r.normalized_source_key = $afterNormalizedKey AND (r.source_record_key > $afterSourceKey OR (r.source_record_key = $afterSourceKey AND r.entity_type > $afterEntityType))))",
            ReferenceCatalogSort.SourceKeyDescending =>
                "  AND (r.normalized_source_key < $afterNormalizedKey OR (r.normalized_source_key = $afterNormalizedKey AND (r.source_record_key < $afterSourceKey OR (r.source_record_key = $afterSourceKey AND r.entity_type < $afterEntityType))))",
            ReferenceCatalogSort.EntityTypeAscending =>
                "  AND (r.entity_type > $afterEntityType OR (r.entity_type = $afterEntityType AND (r.normalized_source_key > $afterNormalizedKey OR (r.normalized_source_key = $afterNormalizedKey AND r.source_record_key > $afterSourceKey))))",
            _ => throw new InvalidOperationException("Unsupported search sort."),
        });
    }

    private static void AddPositionParameters(SqliteCommand command, ReferenceCatalogSearchPosition? after)
    {
        if (after is null) return;
        command.Parameters.AddWithValue("$afterRank", after.Rank);
        command.Parameters.AddWithValue("$afterNormalizedKey", after.NormalizedSourceKey);
        command.Parameters.AddWithValue("$afterSourceKey", after.SourceKey);
        command.Parameters.AddWithValue("$afterEntityType", after.EntityType);
    }

    private static string OrderBy(ReferenceCatalogSort sort) => sort switch
    {
        ReferenceCatalogSort.Relevance =>
            "result_rank, r.normalized_source_key, r.source_record_key, r.entity_type",
        ReferenceCatalogSort.SourceKeyAscending =>
            "r.normalized_source_key, r.source_record_key, r.entity_type",
        ReferenceCatalogSort.SourceKeyDescending =>
            "r.normalized_source_key DESC, r.source_record_key DESC, r.entity_type DESC",
        ReferenceCatalogSort.EntityTypeAscending =>
            "r.entity_type, r.normalized_source_key, r.source_record_key",
        _ => throw new InvalidOperationException("Unsupported search sort."),
    };

    private static ValidatedQuery Validate(ReferenceCatalogSearchQuery query)
    {
        ArgumentNullException.ThrowIfNull(query);
        ArgumentNullException.ThrowIfNull(query.EntityTypes);
        ArgumentNullException.ThrowIfNull(query.Filters);
        if (query.PageSize is < 1 or > MaximumPageSize || query.EntityTypes.Count > MaximumEntityTypes ||
            query.Filters.Count > MaximumFilters)
            throw Invalid("The reference search exceeds its configured limits.");
        var normalizedText = Optional(query.Text, MaximumTextLength, "search text");
        var tokens = normalizedText is null ? [] : ReferenceCatalogSearchProjection.SearchTokens(normalizedText);
        if (normalizedText is not null && (tokens.Count == 0 || tokens.Count > 8))
            throw Invalid("Search text must contain between one and eight words or numbers.");
        var exact = NormalizeOptionalExactKey(query.ExactSourceKey);
        var entityTypes = query.EntityTypes.Select(value => NormalizeIdentifier(value, 64, "entity type"))
            .Distinct(StringComparer.Ordinal).ToArray();
        var filters = query.Filters.Select(filter =>
        {
            var field = NormalizeRequired(filter.Field, MaximumFieldLength, "filter field");
            var requiresValue = filter.Operator is ReferenceCatalogFilterOperator.TextEquals or ReferenceCatalogFilterOperator.TextPrefix;
            var value = requiresValue
                ? NormalizeRequired(filter.Value ?? "", MaximumFilterValueLength, "filter value")
                : null;
            if (!requiresValue && filter.Value is not null)
                throw Invalid("This filter operator does not accept a value.");
            return new ValidatedFilter(field, filter.Operator, value);
        }).ToArray();
        var keyTerm = normalizedText is not null && tokens.Count == 1 ? tokens[0] : null;
        var rankSql = query.Sort == ReferenceCatalogSort.Relevance && keyTerm is not null
            ? "CASE WHEN r.normalized_source_key = $searchText THEN 0 WHEN r.normalized_source_key LIKE $keyPrefix THEN 1 ELSE 2 END"
            : "0";
        var fts = tokens.Count == 0 ? null : string.Join(" AND ", tokens.Select(token => $"\"{token}\"*"));
        return new ValidatedQuery(normalizedText, exact, entityTypes, filters, query.FilterLogic,
            query.Sort, query.PageSize, fts, keyTerm, rankSql);
    }

    private static string? Optional(string? value, int maximum, string name) =>
        string.IsNullOrWhiteSpace(value) ? null : NormalizeRequired(value, maximum, name);

    private static string? NormalizeOptionalExactKey(string? value)
    {
        if (value is null) return null;
        var canonical = value.Normalize(NormalizationForm.FormC);
        if (canonical.Length is 0 or > 512 || canonical.Any(char.IsControl))
            throw Invalid("The exact source key is invalid.");
        return ReferenceCatalogSearchProjection.NormalizeSearchKey(canonical);
    }

    private static string NormalizeRequired(string value, int maximum, string name)
    {
        var normalized = ReferenceCatalogSearchProjection.NormalizeText(value);
        if (normalized.Length is 0 || normalized.Length > maximum || normalized.Any(char.IsControl))
            throw Invalid($"The {name} is invalid.");
        return normalized;
    }

    private static string NormalizeIdentifier(string value, int maximum, string name, bool trim = true)
    {
        ArgumentNullException.ThrowIfNull(value);
        var normalized = (trim ? value.Trim() : value).Normalize(NormalizationForm.FormC);
        if (normalized.Length is 0 || normalized.Length > maximum || normalized.Any(char.IsControl))
            throw Invalid($"The {name} is invalid.");
        return normalized;
    }

    private static Guid ParseGuid(string value) =>
        Guid.TryParseExact(value, "D", out var parsed) && parsed != Guid.Empty
            ? parsed : throw new InvalidDataException("A search projection has an invalid snapshot ID.");

    private static ReferenceCatalogSearchException Invalid(string message) =>
        new("catalog_search_invalid", message);

    private sealed record ValidatedFilter(
        string Field, ReferenceCatalogFilterOperator Operator, string? Value);
    private sealed record ValidatedQuery(
        string? NormalizedText,
        string? ExactSourceKey,
        IReadOnlyList<string> EntityTypes,
        IReadOnlyList<ValidatedFilter> Filters,
        ReferenceCatalogFilterLogic FilterLogic,
        ReferenceCatalogSort Sort,
        int PageSize,
        string? FtsExpression,
        string? KeyPrefix,
        string RankSql);
}

public sealed class ReferenceCatalogSearchException(string code, string message) : Exception(message)
{
    public string Code { get; } = code;
}
