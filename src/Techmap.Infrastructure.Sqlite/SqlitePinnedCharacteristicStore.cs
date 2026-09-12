using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using Techmap.Application;
using Techmap.Domain;

namespace Techmap.Infrastructure.Sqlite;

public sealed class SqlitePinnedCharacteristicStore(SqliteStorage storage)
    : IPinnedCharacteristicCommandStore
{
    public ExternalCharacteristicSnapshot AddOrGet(
        ProjectIdentity projectId,
        ExternalCharacteristicSnapshot snapshot)
    {
        while (true)
        {
            var revision = storage.ExecuteRead(unitOfWork => ReadRevision(unitOfWork, projectId));
            try
            {
                return AddOrGet(
                    projectId,
                    new ProjectCommandEnvelope(Guid.NewGuid(), revision),
                    snapshot).Value;
            }
            catch (ProjectCommandException error) when (error.Code == "revision_conflict")
            {
                // Compatibility wrapper for pre-M1-06 in-process callers.
            }
        }
    }

    public ProjectMutationResult<ExternalCharacteristicSnapshot> AddOrGet(
        ProjectIdentity projectId,
        ProjectCommandEnvelope envelope,
        string sourceKind,
        string sourceRecordKey,
        Func<ExternalCharacteristicSnapshot> snapshotFactory)
    {
        ValidateProjectId(projectId);
        ArgumentNullException.ThrowIfNull(snapshotFactory);
        var canonicalRequest = JsonSerializer.Serialize(new
        {
            sourceKind = sourceKind.Trim().Normalize(NormalizationForm.FormC).ToLowerInvariant(),
            sourceRecordKey = sourceRecordKey.Trim().Normalize(NormalizationForm.FormC),
        }, SqliteProjectCommandJournal.JsonOptions);
        return ExecuteCommand(projectId, envelope, canonicalRequest, snapshotFactory);
    }

    public ProjectMutationResult<ExternalCharacteristicSnapshot> AddOrGet(
        ProjectIdentity projectId,
        ProjectCommandEnvelope envelope,
        ExternalCharacteristicSnapshot snapshot)
    {
        ValidateProjectId(projectId);
        ArgumentNullException.ThrowIfNull(snapshot);
        var canonicalRequest = JsonSerializer.Serialize(new
        {
            snapshot.SourceKind,
            snapshot.SourceRecordKey,
            snapshot.SourceVersionFingerprint,
            snapshot.CharacteristicName,
            snapshot.CanonicalPayload,
        }, SqliteProjectCommandJournal.JsonOptions);

        return ExecuteCommand(projectId, envelope, canonicalRequest, () => snapshot);
    }

    private ProjectMutationResult<ExternalCharacteristicSnapshot> ExecuteCommand(
        ProjectIdentity projectId,
        ProjectCommandEnvelope envelope,
        string canonicalRequest,
        Func<ExternalCharacteristicSnapshot> snapshotFactory)
    {
        try
        {
            return SqliteProjectCommandJournal.Execute(
                storage, projectId, envelope, "pin_characteristic", canonicalRequest,
                unitOfWork => AddOrGetInTransaction(unitOfWork, projectId, snapshotFactory()),
                ReadStoredResult, WriteStoredResult);
        }
        catch (SqliteException error) when (error.SqliteErrorCode == 19)
        {
            throw TranslateConstraint(error);
        }
    }

    private static ExternalCharacteristicSnapshot ReadStoredResult(string json)
    {
        var stored = JsonSerializer.Deserialize<StoredSnapshot>(
            json,
            SqliteProjectCommandJournal.JsonOptions)
            ?? throw new InvalidDataException("The stored pinned characteristic result is invalid.");
        return ExternalCharacteristicSnapshot.Capture(
            new CharacteristicSnapshotIdentity(stored.SnapshotId),
            stored.SourceKind,
            stored.SourceRecordKey,
            stored.SourceVersionFingerprint,
            stored.CharacteristicName,
            stored.CharacteristicValue,
            stored.Unit,
            stored.CapturedUtc);
    }

    private static string WriteStoredResult(ExternalCharacteristicSnapshot value) =>
        JsonSerializer.Serialize(
            new StoredSnapshot(
                value.SnapshotId.Value,
                value.SourceKind,
                value.SourceRecordKey,
                value.SourceVersionFingerprint,
                value.CharacteristicName,
                value.CharacteristicValue,
                value.Unit,
                value.CapturedUtc),
            SqliteProjectCommandJournal.JsonOptions);

    private sealed record StoredSnapshot(
        Guid SnapshotId,
        string SourceKind,
        string SourceRecordKey,
        string SourceVersionFingerprint,
        string CharacteristicName,
        string CharacteristicValue,
        string Unit,
        DateTimeOffset CapturedUtc);

    private static ExternalCharacteristicSnapshot AddOrGetInTransaction(
        SqliteUnitOfWork unitOfWork,
        ProjectIdentity projectId,
        ExternalCharacteristicSnapshot snapshot)
    {
        EnsureProjectExists(unitOfWork, projectId);
        var existing = FindExisting(unitOfWork, projectId, snapshot);
        if (existing is not null)
        {
            if (!string.Equals(existing.CanonicalPayload, snapshot.CanonicalPayload, StringComparison.Ordinal))
            {
                throw new InvalidDataException(
                    "The external source reused a version fingerprint for different data.");
            }

            return existing;
        }

        using var command = unitOfWork.CreateCommand(
            """
            INSERT INTO pinned_characteristics (
                snapshot_id, project_id, source_kind, source_record_key, source_version,
                characteristic_name, characteristic_value, unit, canonical_payload,
                payload_sha256, captured_utc)
            VALUES (
                $snapshotId, $projectId, $sourceKind, $sourceRecordKey, $sourceVersion,
                $characteristicName, $characteristicValue, $unit, $canonicalPayload,
                $payloadSha256, $capturedUtc);
            """);
        command.Parameters.AddWithValue("$snapshotId", Format(snapshot.SnapshotId.Value));
        command.Parameters.AddWithValue("$projectId", Format(projectId.Value));
        command.Parameters.AddWithValue("$sourceKind", snapshot.SourceKind);
        command.Parameters.AddWithValue("$sourceRecordKey", snapshot.SourceRecordKey);
        command.Parameters.AddWithValue("$sourceVersion", snapshot.SourceVersionFingerprint);
        command.Parameters.AddWithValue("$characteristicName", snapshot.CharacteristicName);
        command.Parameters.AddWithValue("$characteristicValue", snapshot.CharacteristicValue);
        command.Parameters.AddWithValue("$unit", snapshot.Unit);
        command.Parameters.AddWithValue("$canonicalPayload", snapshot.CanonicalPayload);
        command.Parameters.AddWithValue("$payloadSha256", HashUtf8(snapshot.CanonicalPayload));
        command.Parameters.AddWithValue(
            "$capturedUtc", snapshot.CapturedUtc.ToString("O", CultureInfo.InvariantCulture));
        command.ExecuteNonQuery();
        return snapshot;
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

    private static long ReadRevision(SqliteUnitOfWork unitOfWork, ProjectIdentity projectId)
    {
        using var command = unitOfWork.CreateCommand(
            "SELECT revision FROM projects WHERE project_id = $projectId;");
        command.Parameters.AddWithValue("$projectId", Format(projectId.Value));
        return Convert.ToInt64(
            command.ExecuteScalar()
                ?? throw new ProjectCatalogException("project_not_found", "The project does not exist."),
            CultureInfo.InvariantCulture);
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
