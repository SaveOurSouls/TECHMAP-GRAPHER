using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Data.Sqlite;
using Techmap.Application;
using Techmap.Domain;

namespace Techmap.Infrastructure.Sqlite;

public sealed class SqlitePinnedCharacteristicStore(SqliteStorage storage)
    : IPinnedCharacteristicStore
{
    public ExternalCharacteristicSnapshot AddOrGet(
        ProjectIdentity projectId,
        ExternalCharacteristicSnapshot snapshot)
    {
        ValidateProjectId(projectId);
        ArgumentNullException.ThrowIfNull(snapshot);

        try
        {
            return storage.ExecuteInTransaction(unitOfWork =>
            {
                EnsureProjectExists(unitOfWork, projectId);
                var existing = FindExisting(unitOfWork, projectId, snapshot);
                if (existing is not null)
                {
                    if (!string.Equals(
                            existing.CanonicalPayload,
                            snapshot.CanonicalPayload,
                            StringComparison.Ordinal))
                    {
                        throw new InvalidDataException(
                            "The external source reused a version fingerprint for different data.");
                    }

                    return existing;
                }

                using var command = unitOfWork.CreateCommand(
                    """
                    INSERT INTO pinned_characteristics (
                        snapshot_id,
                        project_id,
                        source_kind,
                        source_record_key,
                        source_version,
                        characteristic_name,
                        characteristic_value,
                        unit,
                        canonical_payload,
                        payload_sha256,
                        captured_utc)
                    VALUES (
                        $snapshotId,
                        $projectId,
                        $sourceKind,
                        $sourceRecordKey,
                        $sourceVersion,
                        $characteristicName,
                        $characteristicValue,
                        $unit,
                        $canonicalPayload,
                        $payloadSha256,
                        $capturedUtc);
                    """);
                command.Parameters.AddWithValue("$snapshotId", Format(snapshot.SnapshotId.Value));
                command.Parameters.AddWithValue("$projectId", Format(projectId.Value));
                command.Parameters.AddWithValue("$sourceKind", snapshot.SourceKind);
                command.Parameters.AddWithValue("$sourceRecordKey", snapshot.SourceRecordKey);
                command.Parameters.AddWithValue(
                    "$sourceVersion",
                    snapshot.SourceVersionFingerprint);
                command.Parameters.AddWithValue("$characteristicName", snapshot.CharacteristicName);
                command.Parameters.AddWithValue("$characteristicValue", snapshot.CharacteristicValue);
                command.Parameters.AddWithValue("$unit", snapshot.Unit);
                command.Parameters.AddWithValue("$canonicalPayload", snapshot.CanonicalPayload);
                command.Parameters.AddWithValue(
                    "$payloadSha256",
                    HashUtf8(snapshot.CanonicalPayload));
                command.Parameters.AddWithValue(
                    "$capturedUtc",
                    snapshot.CapturedUtc.ToString("O", CultureInfo.InvariantCulture));
                command.ExecuteNonQuery();
                TouchProject(unitOfWork, projectId, snapshot.CapturedUtc);
                return snapshot;
            });
        }
        catch (SqliteException error) when (error.SqliteErrorCode == 19)
        {
            throw TranslateConstraint(error);
        }
    }

    private static ExternalCharacteristicSnapshot? FindExisting(
        SqliteUnitOfWork unitOfWork,
        ProjectIdentity projectId,
        ExternalCharacteristicSnapshot candidate)
    {
        using var command = unitOfWork.CreateCommand(
            """
            SELECT snapshot_id,
                   characteristic_value,
                   unit,
                   canonical_payload,
                   payload_sha256,
                   captured_utc
            FROM pinned_characteristics
            WHERE project_id = $projectId
              AND source_kind = $sourceKind
              AND source_record_key = $sourceRecordKey
              AND source_version = $sourceVersion
              AND characteristic_name = $characteristicName;
            """);
        command.Parameters.AddWithValue("$projectId", Format(projectId.Value));
        command.Parameters.AddWithValue("$sourceKind", candidate.SourceKind);
        command.Parameters.AddWithValue("$sourceRecordKey", candidate.SourceRecordKey);
        command.Parameters.AddWithValue("$sourceVersion", candidate.SourceVersionFingerprint);
        command.Parameters.AddWithValue("$characteristicName", candidate.CharacteristicName);
        using var reader = command.ExecuteReader();
        if (!reader.Read())
        {
            return null;
        }

        var payload = reader.GetString(3);
        if (!string.Equals(reader.GetString(4), HashUtf8(payload), StringComparison.Ordinal))
        {
            throw new InvalidDataException("A pinned characteristic has a corrupt payload hash.");
        }

        var existing = ExternalCharacteristicSnapshot.Capture(
            new CharacteristicSnapshotIdentity(Guid.ParseExact(reader.GetString(0), "D")),
            candidate.SourceKind,
            candidate.SourceRecordKey,
            candidate.SourceVersionFingerprint,
            candidate.CharacteristicName,
            reader.GetString(1),
            reader.GetString(2),
            DateTimeOffset.ParseExact(
                reader.GetString(5),
                "O",
                CultureInfo.InvariantCulture,
                DateTimeStyles.RoundtripKind));
        if (!string.Equals(existing.CanonicalPayload, payload, StringComparison.Ordinal))
        {
            throw new InvalidDataException("A pinned characteristic has a noncanonical payload.");
        }

        return existing;
    }

    public IReadOnlyList<ExternalCharacteristicSnapshot> List(ProjectIdentity projectId)
    {
        ValidateProjectId(projectId);
        return storage.ExecuteRead(unitOfWork =>
        {
            EnsureProjectExists(unitOfWork, projectId);
            using var command = unitOfWork.CreateCommand(
                """
                SELECT snapshot_id,
                       source_kind,
                       source_record_key,
                       source_version,
                       characteristic_name,
                       characteristic_value,
                       unit,
                       canonical_payload,
                       payload_sha256,
                       captured_utc
                FROM pinned_characteristics
                WHERE project_id = $projectId
                ORDER BY captured_utc, snapshot_id;
                """);
            command.Parameters.AddWithValue("$projectId", Format(projectId.Value));
            using var reader = command.ExecuteReader();
            var snapshots = new List<ExternalCharacteristicSnapshot>();
            while (reader.Read())
            {
                var canonicalPayload = reader.GetString(7);
                var storedHash = reader.GetString(8);
                if (!string.Equals(storedHash, HashUtf8(canonicalPayload), StringComparison.Ordinal))
                {
                    throw new InvalidDataException(
                        $"Pinned characteristic '{reader.GetString(0)}' has a corrupt payload hash.");
                }

                var snapshot = ExternalCharacteristicSnapshot.Capture(
                    new CharacteristicSnapshotIdentity(Guid.ParseExact(reader.GetString(0), "D")),
                    reader.GetString(1),
                    reader.GetString(2),
                    reader.GetString(3),
                    reader.GetString(4),
                    reader.GetString(5),
                    reader.GetString(6),
                    DateTimeOffset.ParseExact(
                        reader.GetString(9),
                        "O",
                        CultureInfo.InvariantCulture,
                        DateTimeStyles.RoundtripKind));
                if (!string.Equals(
                        snapshot.CanonicalPayload,
                        canonicalPayload,
                        StringComparison.Ordinal))
                {
                    throw new InvalidDataException(
                        $"Pinned characteristic '{reader.GetString(0)}' has a noncanonical payload.");
                }

                snapshots.Add(snapshot);
            }

            return snapshots;
        });
    }

    private static void EnsureProjectExists(SqliteUnitOfWork unitOfWork, ProjectIdentity projectId)
    {
        using var command = unitOfWork.CreateCommand(
            "SELECT COUNT(*) FROM projects WHERE project_id = $projectId;");
        command.Parameters.AddWithValue("$projectId", Format(projectId.Value));
        if (Convert.ToInt32(command.ExecuteScalar(), CultureInfo.InvariantCulture) != 1)
        {
            throw new ProjectCatalogException("project_not_found", "The project does not exist.");
        }
    }

    private static void TouchProject(
        SqliteUnitOfWork unitOfWork,
        ProjectIdentity projectId,
        DateTimeOffset updatedUtc)
    {
        using var command = unitOfWork.CreateCommand(
            "UPDATE projects SET updated_utc = $updatedUtc WHERE project_id = $projectId;");
        command.Parameters.AddWithValue(
            "$updatedUtc",
            updatedUtc.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture));
        command.Parameters.AddWithValue("$projectId", Format(projectId.Value));
        command.ExecuteNonQuery();
    }

    private static Exception TranslateConstraint(SqliteException error) =>
        error.Message.Contains("FOREIGN KEY", StringComparison.OrdinalIgnoreCase)
            ? new ProjectCatalogException("project_not_found", "The project does not exist.")
            : new ProjectCatalogException(
                "pinned_characteristic_conflict",
                "This characteristic version is already pinned for the project.");

    private static void ValidateProjectId(ProjectIdentity projectId)
    {
        if (projectId.Value == Guid.Empty)
        {
            throw new ArgumentException("The project ID must not be empty.", nameof(projectId));
        }
    }

    private static string Format(Guid value) => value.ToString("D", CultureInfo.InvariantCulture);

    private static string HashUtf8(string value) =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
}
