using System.Globalization;
using Microsoft.Data.Sqlite;
using Techmap.Application;

namespace Techmap.Infrastructure.Sqlite;

public sealed class SqliteReferenceCatalogSavedFilterStore(
    SqliteStorage storage,
    TimeProvider timeProvider) : IReferenceCatalogSavedFilterStore
{
    public ReferenceCatalogSavedFilter Create(
        string sourceId,
        string name,
        ReferenceCatalogSavedFilterQuery query)
    {
        var sourceKey = ReferenceCatalogSavedFilterCanonicalizer.NormalizeSourceId(sourceId);
        var normalizedName = ReferenceCatalogSavedFilterCanonicalizer.NormalizeName(name);
        var canonicalQuery = ReferenceCatalogSavedFilterCanonicalizer.Canonicalize(query);
        var filterId = Guid.NewGuid();
        var now = CanonicalUtc(timeProvider.GetUtcNow());
        return storage.ExecuteInTransaction(unitOfWork =>
        {
            var sourceDatabaseId = ResolveSourceDatabaseId(unitOfWork, sourceKey);
            RejectDuplicateName(unitOfWork, sourceDatabaseId, normalizedName.NormalizedName, null);
            try
            {
                using var command = unitOfWork.CreateCommand(
                    """
                    INSERT INTO reference_catalog_saved_filters (
                        filter_id, source_id, name, normalized_name, query_version,
                        query_json, query_sha256, created_utc, updated_utc)
                    VALUES (
                        $filterId, $sourceId, $name, $normalizedName, $queryVersion,
                        $queryJson, $querySha256, $createdUtc, $updatedUtc);
                    """);
                AddWriteParameters(
                    command,
                    filterId,
                    sourceDatabaseId,
                    normalizedName.DisplayName,
                    normalizedName.NormalizedName,
                    canonicalQuery,
                    now,
                    now);
                command.ExecuteNonQuery();
            }
            catch (SqliteException error) when (error.SqliteErrorCode == 19)
            {
                throw NameConflict(error);
            }

            return new ReferenceCatalogSavedFilter(
                filterId,
                sourceKey,
                normalizedName.DisplayName,
                canonicalQuery,
                ParseUtc(now),
                ParseUtc(now));
        });
    }

    public IReadOnlyList<ReferenceCatalogSavedFilter> List(string sourceId)
    {
        var sourceKey = ReferenceCatalogSavedFilterCanonicalizer.NormalizeSourceId(sourceId);
        return storage.ExecuteRead(unitOfWork =>
        {
            var sourceDatabaseId = ResolveSourceDatabaseId(unitOfWork, sourceKey);
            using var command = unitOfWork.CreateCommand(
                """
                SELECT f.filter_id, f.name, f.normalized_name, f.query_version,
                       f.query_json, f.query_sha256, f.created_utc, f.updated_utc
                FROM reference_catalog_saved_filters f
                WHERE f.source_id = $sourceId
                ORDER BY f.normalized_name, f.filter_id;
                """);
            command.Parameters.AddWithValue("$sourceId", sourceDatabaseId);
            using var reader = command.ExecuteReader();
            var result = new List<ReferenceCatalogSavedFilter>();
            while (reader.Read()) result.Add(Read(reader, sourceKey));
            return result;
        });
    }

    public ReferenceCatalogSavedFilter Update(
        string sourceId,
        Guid filterId,
        string name,
        ReferenceCatalogSavedFilterQuery query)
    {
        ValidateFilterId(filterId);
        var sourceKey = ReferenceCatalogSavedFilterCanonicalizer.NormalizeSourceId(sourceId);
        var normalizedName = ReferenceCatalogSavedFilterCanonicalizer.NormalizeName(name);
        var canonicalQuery = ReferenceCatalogSavedFilterCanonicalizer.Canonicalize(query);
        var now = CanonicalUtc(timeProvider.GetUtcNow());
        return storage.ExecuteInTransaction(unitOfWork =>
        {
            var sourceDatabaseId = ResolveSourceDatabaseId(unitOfWork, sourceKey);
            var existing = ReadOne(unitOfWork, sourceDatabaseId, sourceKey, filterId)
                ?? throw NotFound();
            RejectDuplicateName(
                unitOfWork, sourceDatabaseId, normalizedName.NormalizedName, filterId);
            try
            {
                using var command = unitOfWork.CreateCommand(
                    """
                    UPDATE reference_catalog_saved_filters
                    SET name = $name,
                        normalized_name = $normalizedName,
                        query_version = $queryVersion,
                        query_json = $queryJson,
                        query_sha256 = $querySha256,
                        updated_utc = $updatedUtc
                    WHERE source_id = $sourceId AND filter_id = $filterId;
                    """);
                command.Parameters.AddWithValue("$filterId", Format(filterId));
                command.Parameters.AddWithValue("$sourceId", sourceDatabaseId);
                command.Parameters.AddWithValue("$name", normalizedName.DisplayName);
                command.Parameters.AddWithValue("$normalizedName", normalizedName.NormalizedName);
                command.Parameters.AddWithValue("$queryVersion", canonicalQuery.Version);
                command.Parameters.AddWithValue("$queryJson", canonicalQuery.CanonicalJson);
                command.Parameters.AddWithValue("$querySha256", canonicalQuery.Sha256);
                command.Parameters.AddWithValue("$updatedUtc", now);
                if (command.ExecuteNonQuery() != 1) throw NotFound();
            }
            catch (SqliteException error) when (error.SqliteErrorCode == 19)
            {
                throw NameConflict(error);
            }

            return new ReferenceCatalogSavedFilter(
                filterId,
                sourceKey,
                normalizedName.DisplayName,
                canonicalQuery,
                existing.CreatedUtc,
                ParseUtc(now));
        });
    }

    public void Delete(string sourceId, Guid filterId)
    {
        ValidateFilterId(filterId);
        var sourceKey = ReferenceCatalogSavedFilterCanonicalizer.NormalizeSourceId(sourceId);
        storage.ExecuteInTransaction(unitOfWork =>
        {
            var sourceDatabaseId = ResolveSourceDatabaseId(unitOfWork, sourceKey);
            using var command = unitOfWork.CreateCommand(
                """
                DELETE FROM reference_catalog_saved_filters
                WHERE source_id = $sourceId AND filter_id = $filterId;
                """);
            command.Parameters.AddWithValue("$sourceId", sourceDatabaseId);
            command.Parameters.AddWithValue("$filterId", Format(filterId));
            if (command.ExecuteNonQuery() != 1) throw NotFound();
        });
    }

    private static ReferenceCatalogSavedFilter? ReadOne(
        SqliteUnitOfWork unitOfWork,
        string sourceDatabaseId,
        string sourceKey,
        Guid filterId)
    {
        using var command = unitOfWork.CreateCommand(
            """
            SELECT f.filter_id, f.name, f.normalized_name, f.query_version,
                   f.query_json, f.query_sha256, f.created_utc, f.updated_utc
            FROM reference_catalog_saved_filters f
            WHERE f.source_id = $sourceId AND f.filter_id = $filterId;
            """);
        command.Parameters.AddWithValue("$sourceId", sourceDatabaseId);
        command.Parameters.AddWithValue("$filterId", Format(filterId));
        using var reader = command.ExecuteReader();
        return reader.Read() ? Read(reader, sourceKey) : null;
    }

    private static ReferenceCatalogSavedFilter Read(SqliteDataReader reader, string sourceKey)
    {
        var idText = reader.GetString(0);
        if (!Guid.TryParseExact(idText, "D", out var filterId) || filterId == Guid.Empty)
            throw Corrupt("A saved catalog filter has an invalid identity.");
        var name = reader.GetString(1);
        var normalizedName = ReferenceCatalogSavedFilterCanonicalizer.NormalizeName(name);
        if (!string.Equals(normalizedName.DisplayName, name, StringComparison.Ordinal) ||
            !string.Equals(normalizedName.NormalizedName, reader.GetString(2), StringComparison.Ordinal) ||
            reader.GetInt32(3) != ReferenceCatalogSavedFilterCanonicalizer.CurrentVersion)
            throw Corrupt("A saved catalog filter has invalid normalized metadata.");
        var query = ReferenceCatalogSavedFilterCanonicalizer.ReadCanonical(
            reader.GetString(4), reader.GetString(5));
        var createdUtc = ParseUtc(reader.GetString(6));
        var updatedUtc = ParseUtc(reader.GetString(7));
        if (updatedUtc < createdUtc)
            throw Corrupt("A saved catalog filter has invalid timestamps.");
        return new ReferenceCatalogSavedFilter(
            filterId, sourceKey, name, query, createdUtc, updatedUtc);
    }

    private static string ResolveSourceDatabaseId(SqliteUnitOfWork unitOfWork, string sourceKey)
    {
        using var command = unitOfWork.CreateCommand(
            "SELECT source_id FROM reference_sources WHERE source_key = $sourceKey;");
        command.Parameters.AddWithValue("$sourceKey", sourceKey);
        return command.ExecuteScalar() as string
            ?? throw new ReferenceCatalogSavedFilterException(
                "catalog_reference_source_not_found",
                "The reference source does not exist.");
    }

    private static void RejectDuplicateName(
        SqliteUnitOfWork unitOfWork,
        string sourceDatabaseId,
        string normalizedName,
        Guid? exceptFilterId)
    {
        using var command = unitOfWork.CreateCommand(
            """
            SELECT COUNT(*)
            FROM reference_catalog_saved_filters
            WHERE source_id = $sourceId
              AND normalized_name = $normalizedName
              AND ($exceptFilterId IS NULL OR filter_id <> $exceptFilterId);
            """);
        command.Parameters.AddWithValue("$sourceId", sourceDatabaseId);
        command.Parameters.AddWithValue("$normalizedName", normalizedName);
        command.Parameters.AddWithValue(
            "$exceptFilterId",
            exceptFilterId is Guid value ? Format(value) : DBNull.Value);
        if (Convert.ToInt32(command.ExecuteScalar(), CultureInfo.InvariantCulture) != 0)
            throw NameConflict();
    }

    private static void AddWriteParameters(
        SqliteCommand command,
        Guid filterId,
        string sourceDatabaseId,
        string name,
        string normalizedName,
        CanonicalReferenceCatalogSavedFilterQuery query,
        string createdUtc,
        string updatedUtc)
    {
        command.Parameters.AddWithValue("$filterId", Format(filterId));
        command.Parameters.AddWithValue("$sourceId", sourceDatabaseId);
        command.Parameters.AddWithValue("$name", name);
        command.Parameters.AddWithValue("$normalizedName", normalizedName);
        command.Parameters.AddWithValue("$queryVersion", query.Version);
        command.Parameters.AddWithValue("$queryJson", query.CanonicalJson);
        command.Parameters.AddWithValue("$querySha256", query.Sha256);
        command.Parameters.AddWithValue("$createdUtc", createdUtc);
        command.Parameters.AddWithValue("$updatedUtc", updatedUtc);
    }

    private static void ValidateFilterId(Guid filterId)
    {
        if (filterId == Guid.Empty)
            throw new ReferenceCatalogSavedFilterException(
                "catalog_saved_filter_invalid",
                "The saved filter identity is invalid.");
    }

    private static string CanonicalUtc(DateTimeOffset value) =>
        value.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture);

    private static DateTimeOffset ParseUtc(string value)
    {
        try
        {
            var parsed = DateTimeOffset.ParseExact(
                value, "O", CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind);
            if (!string.Equals(CanonicalUtc(parsed), value, StringComparison.Ordinal))
                throw new FormatException("The timestamp is not canonical UTC.");
            return parsed;
        }
        catch (FormatException error)
        {
            throw Corrupt("A saved catalog filter has an invalid timestamp.", error);
        }
    }

    private static string Format(Guid value) => value.ToString("D", CultureInfo.InvariantCulture);

    private static ReferenceCatalogSavedFilterException NotFound() =>
        new("catalog_saved_filter_not_found", "The saved catalog filter does not exist.");

    private static ReferenceCatalogSavedFilterException NameConflict(Exception? inner = null) =>
        new(
            "catalog_saved_filter_name_conflict",
            "A saved catalog filter with this name already exists for the reference source.",
            inner);

    private static ReferenceCatalogSavedFilterException Corrupt(
        string message,
        Exception? inner = null) =>
        new("catalog_saved_filter_corrupt", message, inner);
}
