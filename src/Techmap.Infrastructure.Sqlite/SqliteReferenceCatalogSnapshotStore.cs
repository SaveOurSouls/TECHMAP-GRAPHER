using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using Techmap.Application;
using Techmap.Domain;

namespace Techmap.Infrastructure.Sqlite;

public sealed class SqliteReferenceCatalogSnapshotStore(SqliteStorage storage)
    : IReferenceCatalogSnapshotStore
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    public ReferenceCatalogSnapshot? GetActive(string sourceId)
    {
        var normalized = NormalizeSourceId(sourceId);
        return storage.ExecuteRead(unitOfWork =>
        {
            using var command = unitOfWork.CreateCommand(
                """
                SELECT h.snapshot_id
                FROM reference_source_heads h
                JOIN reference_sources s ON s.source_id = h.source_id
                WHERE s.source_key = $sourceKey;
                """);
            command.Parameters.AddWithValue("$sourceKey", normalized);
            var raw = command.ExecuteScalar() as string;
            return raw is null
                ? null
                : ReadSnapshot(unitOfWork, new ReferenceCatalogSnapshotIdentity(ParseGuid(raw)));
        });
    }

    public ReferenceCatalogSnapshot? Get(ReferenceCatalogSnapshotIdentity snapshotId)
    {
        ValidateSnapshotId(snapshotId);
        return storage.ExecuteRead(unitOfWork => ReadSnapshot(unitOfWork, snapshotId));
    }

    public IReadOnlyList<ReferenceCatalogSnapshot> List(string sourceId)
    {
        var normalized = NormalizeSourceId(sourceId);
        return storage.ExecuteRead(unitOfWork =>
        {
            using var command = unitOfWork.CreateCommand(
                """
                SELECT r.snapshot_id
                FROM reference_snapshots r
                JOIN reference_sources s ON s.source_id = r.source_id
                WHERE s.source_key = $sourceKey
                  AND r.lifecycle_status = 'published'
                ORDER BY r.snapshot_sequence, r.snapshot_id;
                """);
            command.Parameters.AddWithValue("$sourceKey", normalized);
            using var reader = command.ExecuteReader();
            var ids = new List<ReferenceCatalogSnapshotIdentity>();
            while (reader.Read())
            {
                ids.Add(new ReferenceCatalogSnapshotIdentity(ParseGuid(reader.GetString(0))));
            }

            return ids.Select(id => ReadSnapshot(unitOfWork, id)
                    ?? throw Corrupt("A published reference snapshot disappeared while it was read."))
                .ToArray();
        });
    }

    public IReadOnlyList<ReferenceCatalogSourceSummary> ListActiveSources()
    {
        return storage.ExecuteRead(unitOfWork =>
        {
            using var command = unitOfWork.CreateCommand(
                """
                SELECT s.source_key, s.display_name, s.source_kind, h.snapshot_id,
                       COUNT(rr.source_record_key), r.captured_utc
                FROM reference_sources s
                JOIN reference_source_heads h ON h.source_id = s.source_id
                JOIN reference_snapshots r ON r.snapshot_id = h.snapshot_id
                LEFT JOIN reference_snapshot_records rr ON rr.snapshot_id = h.snapshot_id
                WHERE r.lifecycle_status = 'published'
                GROUP BY s.source_id, s.source_key, s.display_name, s.source_kind,
                         h.snapshot_id, r.captured_utc
                ORDER BY s.display_name, s.source_key;
                """);
            using var reader = command.ExecuteReader();
            var result = new List<ReferenceCatalogSourceSummary>();
            while (reader.Read())
            {
                result.Add(new ReferenceCatalogSourceSummary(
                    reader.GetString(0),
                    reader.GetString(1),
                    reader.GetString(2),
                    new ReferenceCatalogSnapshotIdentity(ParseGuid(reader.GetString(3))),
                    checked((int)reader.GetInt64(4)),
                    ParseDate(reader.GetString(5))));
            }

            return result;
        });
    }

    public ReferenceCatalogStorePublishResult TryPublish(
        ReferenceCatalogSnapshot candidate,
        ReferenceCatalogSnapshotIdentity? expectedActiveSnapshotId)
    {
        ArgumentNullException.ThrowIfNull(candidate);
        ValidateSnapshotId(candidate.SnapshotId);
        if (expectedActiveSnapshotId is { } expected)
        {
            ValidateSnapshotId(expected);
        }

        try
        {
            return storage.ExecuteInTransaction(unitOfWork =>
            {
                var sourceKey = NormalizeSourceId(candidate.SourceId);
                var sourceDatabaseId = GetOrCreateSource(unitOfWork, sourceKey, candidate);
                var previous = ReadActiveId(unitOfWork, sourceDatabaseId);
                var alreadyStored = ReadSnapshot(unitOfWork, candidate.SnapshotId);
                if (alreadyStored is not null)
                {
                    if (!string.Equals(alreadyStored.Sha256, candidate.Sha256, StringComparison.Ordinal))
                    {
                        throw new ReferenceCatalogStoreException(
                            "catalog_snapshot_id_reused",
                            "The snapshot ID is already used for different content.");
                    }

                    if (previous == candidate.SnapshotId)
                    {
                        return new ReferenceCatalogStorePublishResult(
                            ReferenceCatalogStorePublishStatus.Unchanged,
                            previous,
                            alreadyStored);
                    }

                    throw new ReferenceCatalogStoreException(
                        "catalog_snapshot_state_conflict",
                        "The snapshot was already published and is not the active version.");
                }

                var sameSourceVersion = FindBySourceVersion(unitOfWork, sourceDatabaseId, candidate);
                if (sameSourceVersion is not null)
                {
                    if (previous == sameSourceVersion.SnapshotId)
                    {
                        return new ReferenceCatalogStorePublishResult(
                            ReferenceCatalogStorePublishStatus.Unchanged,
                            previous,
                            sameSourceVersion);
                    }

                    throw new ReferenceCatalogStoreException(
                        "catalog_snapshot_state_conflict",
                        "This source version already exists as a historical snapshot.");
                }

                if (previous != expectedActiveSnapshotId)
                {
                    return new ReferenceCatalogStorePublishResult(
                        ReferenceCatalogStorePublishStatus.ActiveSnapshotConflict,
                        previous);
                }
                var now = DateTimeOffset.UtcNow;
                var sequence = ReadNextSequence(unitOfWork, sourceDatabaseId);
                var provenanceJson = JsonSerializer.Serialize(candidate.Provenance, JsonOptions);
                var sourceContentHash = SourceContentHash(candidate.Provenance.VersionFingerprint);
                var capturedUtc = candidate.CapturedUtc.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture);
                var metadataHash = HashSnapshotMetadata(
                    candidate.SnapshotId,
                    sourceKey,
                    sequence,
                    candidate.ContractVersion,
                    candidate.Provenance.VersionFingerprint,
                    sourceContentHash,
                    provenanceJson,
                    capturedUtc);

                InsertDraft(
                    unitOfWork, sourceDatabaseId, sequence, candidate,
                    sourceContentHash, metadataHash, provenanceJson, capturedUtc);
                InsertRecords(unitOfWork, candidate);
                InsertDiagnostics(unitOfWork, candidate);
                AdvanceLifecycle(unitOfWork, candidate, "validated", now);
                AdvanceLifecycle(unitOfWork, candidate, "published", now);
                ReferenceCatalogSearchProjection.Replace(unitOfWork, sourceDatabaseId, candidate);
                SwitchHead(unitOfWork, sourceDatabaseId, candidate.SnapshotId);

                return new ReferenceCatalogStorePublishResult(
                    ReferenceCatalogStorePublishStatus.Published,
                    previous);
            });
        }
        catch (SqliteException error) when (error.SqliteErrorCode == 19)
        {
            throw new ReferenceCatalogStoreException(
                "catalog_snapshot_state_conflict",
                "The reference snapshot could not be published because its persisted state conflicted.",
                error);
        }
    }

    private static string GetOrCreateSource(
        SqliteUnitOfWork unitOfWork,
        string sourceKey,
        ReferenceCatalogSnapshot candidate)
    {
        using (var read = unitOfWork.CreateCommand(
                   "SELECT source_id, source_kind FROM reference_sources WHERE source_key = $sourceKey;"))
        {
            read.Parameters.AddWithValue("$sourceKey", sourceKey);
            using var reader = read.ExecuteReader();
            if (reader.Read())
            {
                if (!string.Equals(reader.GetString(1), candidate.Provenance.SourceKind, StringComparison.Ordinal))
                {
                    throw new ReferenceCatalogStoreException(
                        "catalog_source_kind_changed",
                        "The reference source kind cannot change between published versions.");
                }

                return reader.GetString(0);
            }
        }

        var sourceDatabaseId = Guid.NewGuid().ToString("D", CultureInfo.InvariantCulture);
        using var insert = unitOfWork.CreateCommand(
            """
            INSERT INTO reference_sources
                (source_id, source_key, source_kind, display_name, created_utc)
            VALUES
                ($sourceId, $sourceKey, $sourceKind, $displayName, $createdUtc);
            """);
        insert.Parameters.AddWithValue("$sourceId", sourceDatabaseId);
        insert.Parameters.AddWithValue("$sourceKey", sourceKey);
        insert.Parameters.AddWithValue("$sourceKind", Bounded(candidate.Provenance.SourceKind, 64, "source kind"));
        insert.Parameters.AddWithValue("$displayName", sourceKey);
        insert.Parameters.AddWithValue(
            "$createdUtc",
            candidate.CapturedUtc.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture));
        insert.ExecuteNonQuery();
        return sourceDatabaseId;
    }

    private static ReferenceCatalogSnapshotIdentity? ReadActiveId(
        SqliteUnitOfWork unitOfWork,
        string sourceDatabaseId)
    {
        using var command = unitOfWork.CreateCommand(
            "SELECT snapshot_id FROM reference_source_heads WHERE source_id = $sourceId;");
        command.Parameters.AddWithValue("$sourceId", sourceDatabaseId);
        return command.ExecuteScalar() is string raw
            ? new ReferenceCatalogSnapshotIdentity(ParseGuid(raw))
            : null;
    }

    private static long ReadNextSequence(SqliteUnitOfWork unitOfWork, string sourceDatabaseId)
    {
        using var command = unitOfWork.CreateCommand(
            """
            SELECT COALESCE(MAX(snapshot_sequence), 0) + 1
            FROM reference_snapshots
            WHERE source_id = $sourceId;
            """);
        command.Parameters.AddWithValue("$sourceId", sourceDatabaseId);
        return Convert.ToInt64(command.ExecuteScalar(), CultureInfo.InvariantCulture);
    }

    private static ReferenceCatalogSnapshot? FindBySourceVersion(
        SqliteUnitOfWork unitOfWork,
        string sourceDatabaseId,
        ReferenceCatalogSnapshot candidate)
    {
        using var command = unitOfWork.CreateCommand(
            """
            SELECT snapshot_id, canonical_content_sha256
            FROM reference_snapshots
            WHERE source_id = $sourceId
              AND source_version = $sourceVersion
              AND lifecycle_status = 'published'
            LIMIT 1;
            """);
        command.Parameters.AddWithValue("$sourceId", sourceDatabaseId);
        command.Parameters.AddWithValue("$sourceVersion", candidate.Provenance.VersionFingerprint);
        using var reader = command.ExecuteReader();
        if (!reader.Read())
        {
            return null;
        }

        var existingId = new ReferenceCatalogSnapshotIdentity(ParseGuid(reader.GetString(0)));
        var existingHash = reader.GetString(1);
        reader.Close();
        if (!string.Equals(existingHash, candidate.Sha256, StringComparison.Ordinal))
        {
            throw new ReferenceCatalogStoreException(
                "catalog_source_version_reused",
                "The external source reused one version fingerprint for different content.");
        }

        return ReadSnapshot(unitOfWork, existingId)
            ?? throw Corrupt("The matching published reference snapshot cannot be read.");
    }

    private static void InsertDraft(
        SqliteUnitOfWork unitOfWork,
        string sourceDatabaseId,
        long sequence,
        ReferenceCatalogSnapshot candidate,
        string sourceContentHash,
        string metadataHash,
        string provenanceJson,
        string capturedUtc)
    {
        using var command = unitOfWork.CreateCommand(
            """
            INSERT INTO reference_snapshots (
                snapshot_id, source_id, snapshot_sequence, contract_version,
                source_version, source_content_sha256, snapshot_metadata_sha256,
                canonical_content_sha256,
                provenance_json, lifecycle_status, captured_utc,
                validated_utc, published_utc)
            VALUES (
                $snapshotId, $sourceId, $sequence, $contractVersion,
                $sourceVersion, $sourceContentHash, $metadataHash, NULL,
                $provenanceJson, 'draft', $capturedUtc,
                NULL, NULL);
            """);
        command.Parameters.AddWithValue("$snapshotId", Format(candidate.SnapshotId));
        command.Parameters.AddWithValue("$sourceId", sourceDatabaseId);
        command.Parameters.AddWithValue("$sequence", sequence);
        command.Parameters.AddWithValue("$contractVersion", candidate.ContractVersion);
        command.Parameters.AddWithValue(
            "$sourceVersion",
            Bounded(candidate.Provenance.VersionFingerprint, 512, "source version"));
        command.Parameters.AddWithValue("$sourceContentHash", sourceContentHash);
        command.Parameters.AddWithValue("$metadataHash", metadataHash);
        command.Parameters.AddWithValue("$provenanceJson", provenanceJson);
        command.Parameters.AddWithValue("$capturedUtc", capturedUtc);
        command.ExecuteNonQuery();
    }

    private static void InsertRecords(SqliteUnitOfWork unitOfWork, ReferenceCatalogSnapshot candidate)
    {
        foreach (var record in candidate.Records)
        {
            var payload = record.Payload.GetRawText();
            using var command = unitOfWork.CreateCommand(
                """
                INSERT INTO reference_snapshot_records (
                    snapshot_id, entity_type, source_record_key, source_location,
                    canonical_payload, payload_sha256)
                VALUES (
                    $snapshotId, $entityType, $sourceKey, $sourceLocation,
                    $payload, $payloadSha256);
                """);
            command.Parameters.AddWithValue("$snapshotId", Format(candidate.SnapshotId));
            command.Parameters.AddWithValue("$entityType", Bounded(record.EntityType, 64, "entity type"));
            command.Parameters.AddWithValue("$sourceKey", Bounded(record.SourceKey, 512, "source key"));
            command.Parameters.AddWithValue("$sourceLocation", Db(record.SourceLocation));
            command.Parameters.AddWithValue("$payload", payload);
            command.Parameters.AddWithValue("$payloadSha256", HashRecordMetadata(
                record.EntityType,
                record.SourceKey,
                record.SourceLocation,
                payload));
            command.ExecuteNonQuery();
        }
    }

    private static void InsertDiagnostics(SqliteUnitOfWork unitOfWork, ReferenceCatalogSnapshot candidate)
    {
        for (var index = 0; index < candidate.Diagnostics.Count; index++)
        {
            var diagnostic = candidate.Diagnostics[index];
            using var command = unitOfWork.CreateCommand(
                """
                INSERT INTO reference_snapshot_diagnostics (
                    snapshot_id, diagnostic_index, severity, code, entity_type,
                    source_record_key, source_location, field_name, message, diagnostic_sha256)
                VALUES (
                    $snapshotId, $index, $severity, $code, $entityType,
                    $sourceKey, $sourceLocation, $field, $message, $diagnosticSha256);
                """);
            command.Parameters.AddWithValue("$snapshotId", Format(candidate.SnapshotId));
            command.Parameters.AddWithValue("$index", index);
            command.Parameters.AddWithValue(
                "$severity",
                diagnostic.Severity == ReferenceCatalogDiagnosticSeverity.Warning ? "warning" : "error");
            command.Parameters.AddWithValue("$code", Bounded(diagnostic.Code, 64, "diagnostic code"));
            command.Parameters.AddWithValue("$entityType", Db(diagnostic.EntityType));
            command.Parameters.AddWithValue("$sourceKey", Db(diagnostic.SourceKey));
            command.Parameters.AddWithValue("$sourceLocation", Db(diagnostic.SourceLocation));
            command.Parameters.AddWithValue("$field", Db(diagnostic.Field));
            command.Parameters.AddWithValue("$message", Bounded(diagnostic.Message, 4096, "diagnostic message"));
            command.Parameters.AddWithValue("$diagnosticSha256", HashDiagnosticMetadata(diagnostic));
            command.ExecuteNonQuery();
        }
    }

    private static void AdvanceLifecycle(
        SqliteUnitOfWork unitOfWork,
        ReferenceCatalogSnapshot candidate,
        string lifecycle,
        DateTimeOffset now)
    {
        using var command = unitOfWork.CreateCommand(lifecycle == "validated"
            ? """
              UPDATE reference_snapshots
              SET lifecycle_status = 'validated',
                  canonical_content_sha256 = $sha256,
                  validated_utc = $utc
              WHERE snapshot_id = $snapshotId AND lifecycle_status = 'draft';
              """
            : """
              UPDATE reference_snapshots
              SET lifecycle_status = 'published', published_utc = $utc
              WHERE snapshot_id = $snapshotId AND lifecycle_status = 'validated';
              """);
        command.Parameters.AddWithValue("$snapshotId", Format(candidate.SnapshotId));
        command.Parameters.AddWithValue("$utc", now.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture));
        if (lifecycle == "validated")
        {
            command.Parameters.AddWithValue("$sha256", candidate.Sha256);
        }

        if (command.ExecuteNonQuery() != 1)
        {
            throw Corrupt("The reference snapshot lifecycle did not advance exactly once.");
        }
    }

    private static void SwitchHead(
        SqliteUnitOfWork unitOfWork,
        string sourceDatabaseId,
        ReferenceCatalogSnapshotIdentity snapshotId)
    {
        using var command = unitOfWork.CreateCommand(
            """
            INSERT INTO reference_source_heads (source_id, snapshot_id)
            VALUES ($sourceId, $snapshotId)
            ON CONFLICT(source_id) DO UPDATE SET snapshot_id = excluded.snapshot_id;
            """);
        command.Parameters.AddWithValue("$sourceId", sourceDatabaseId);
        command.Parameters.AddWithValue("$snapshotId", Format(snapshotId));
        command.ExecuteNonQuery();
    }

    private static ReferenceCatalogSnapshot? ReadSnapshot(
        SqliteUnitOfWork unitOfWork,
        ReferenceCatalogSnapshotIdentity snapshotId)
    {
        using var header = unitOfWork.CreateCommand(
            """
            SELECT s.source_key, r.contract_version, r.provenance_json,
                   r.captured_utc, r.canonical_content_sha256, r.lifecycle_status,
                   r.source_content_sha256, r.snapshot_sequence, r.source_version,
                   r.snapshot_metadata_sha256
            FROM reference_snapshots r
            JOIN reference_sources s ON s.source_id = r.source_id
            WHERE r.snapshot_id = $snapshotId;
            """);
        header.Parameters.AddWithValue("$snapshotId", Format(snapshotId));
        using var reader = header.ExecuteReader();
        if (!reader.Read())
        {
            return null;
        }

        if (!string.Equals(reader.GetString(5), "published", StringComparison.Ordinal))
        {
            return null;
        }

        var sourceId = reader.GetString(0);
        var contractVersion = reader.GetInt32(1);
        var provenanceJson = reader.GetString(2);
        var capturedUtc = ParseDate(reader.GetString(3));
        var expectedSnapshotHash = reader.GetString(4);
        var sourceContentHash = reader.GetString(6);
        var sequence = reader.GetInt64(7);
        var sourceVersion = reader.GetString(8);
        var expectedMetadataHash = reader.GetString(9);
        reader.Close();

        var provenance = JsonSerializer.Deserialize<ReferenceCatalogProvenance>(provenanceJson, JsonOptions)
            ?? throw Corrupt("A reference snapshot has invalid provenance.");
        if (!string.Equals(sourceContentHash, SourceContentHash(provenance.VersionFingerprint), StringComparison.Ordinal))
        {
            throw Corrupt("A reference snapshot has a corrupt source fingerprint.");
        }
        if (!string.Equals(sourceVersion, provenance.VersionFingerprint, StringComparison.Ordinal) ||
            !string.Equals(
                expectedMetadataHash,
                HashSnapshotMetadata(
                    snapshotId,
                    sourceId,
                    sequence,
                    contractVersion,
                    sourceVersion,
                    sourceContentHash,
                    provenanceJson,
                    capturedUtc.ToString("O", CultureInfo.InvariantCulture)),
                StringComparison.Ordinal))
        {
            throw Corrupt("A reference snapshot has corrupt persisted metadata.");
        }

        var records = ReadRecords(unitOfWork, snapshotId);
        var diagnostics = ReadDiagnostics(unitOfWork, snapshotId);
        var draft = ReferenceCatalogDraft.Create(
            snapshotId,
            sourceId,
            contractVersion,
            capturedUtc,
            new ReferenceCatalogProvenanceInput(
                provenance.SourceKind,
                provenance.VersionFingerprint,
                provenance.SourceUri),
            records,
            diagnostics);
        var validation = draft.Validate();
        var snapshot = validation.Snapshot
            ?? throw Corrupt("A published reference snapshot no longer passes canonical validation.");
        if (!string.Equals(snapshot.Sha256, expectedSnapshotHash, StringComparison.Ordinal))
        {
            throw Corrupt("A published reference snapshot has a corrupt canonical hash.");
        }

        return snapshot;
    }

    private static IReadOnlyList<ReferenceCatalogRecordInput> ReadRecords(
        SqliteUnitOfWork unitOfWork,
        ReferenceCatalogSnapshotIdentity snapshotId)
    {
        using var command = unitOfWork.CreateCommand(
            """
            SELECT entity_type, source_record_key, source_location,
                   canonical_payload, payload_sha256
            FROM reference_snapshot_records
            WHERE snapshot_id = $snapshotId
            ORDER BY entity_type, source_record_key;
            """);
        command.Parameters.AddWithValue("$snapshotId", Format(snapshotId));
        using var reader = command.ExecuteReader();
        var result = new List<ReferenceCatalogRecordInput>();
        while (reader.Read())
        {
            var payload = reader.GetString(3);
            var entityType = reader.GetString(0);
            var sourceKey = reader.GetString(1);
            var sourceLocation = reader.IsDBNull(2) ? null : reader.GetString(2);
            if (!string.Equals(
                    HashRecordMetadata(entityType, sourceKey, sourceLocation, payload),
                    reader.GetString(4),
                    StringComparison.Ordinal))
            {
                throw Corrupt("A reference record has a corrupt payload hash.");
            }

            using var document = JsonDocument.Parse(payload);
            result.Add(new ReferenceCatalogRecordInput(
                entityType,
                sourceKey,
                document.RootElement.Clone(),
                sourceLocation));
        }

        return result;
    }

    private static IReadOnlyList<ReferenceCatalogDiagnosticInput> ReadDiagnostics(
        SqliteUnitOfWork unitOfWork,
        ReferenceCatalogSnapshotIdentity snapshotId)
    {
        using var command = unitOfWork.CreateCommand(
            """
            SELECT severity, code, message, entity_type, source_record_key,
                   field_name, source_location, diagnostic_sha256
            FROM reference_snapshot_diagnostics
            WHERE snapshot_id = $snapshotId
            ORDER BY diagnostic_index;
            """);
        command.Parameters.AddWithValue("$snapshotId", Format(snapshotId));
        using var reader = command.ExecuteReader();
        var result = new List<ReferenceCatalogDiagnosticInput>();
        while (reader.Read())
        {
            var severity = reader.GetString(0);
            var code = reader.GetString(1);
            var message = reader.GetString(2);
            var entityType = reader.IsDBNull(3) ? null : reader.GetString(3);
            var sourceKey = reader.IsDBNull(4) ? null : reader.GetString(4);
            var field = reader.IsDBNull(5) ? null : reader.GetString(5);
            var sourceLocation = reader.IsDBNull(6) ? null : reader.GetString(6);
            if (!string.Equals(
                    HashDiagnosticMetadata(
                        severity, code, message, entityType, sourceKey, field, sourceLocation),
                    reader.GetString(7),
                    StringComparison.Ordinal))
            {
                throw Corrupt("A reference diagnostic has corrupt persisted metadata.");
            }

            result.Add(new ReferenceCatalogDiagnosticInput(
                severity switch
                {
                    "warning" => ReferenceCatalogDiagnosticSeverity.Warning,
                    "error" => ReferenceCatalogDiagnosticSeverity.Error,
                    _ => throw Corrupt("A reference diagnostic has an unsupported severity."),
                },
                code,
                message,
                entityType,
                sourceKey,
                field,
                sourceLocation));
        }

        return result;
    }

    private static string NormalizeSourceId(string sourceId)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(sourceId);
        var normalized = sourceId.Normalize(NormalizationForm.FormC);
        if (normalized.Length > 256 || normalized.Any(char.IsControl))
        {
            throw new ArgumentException("The reference source ID is invalid.", nameof(sourceId));
        }

        return normalized;
    }

    private static void ValidateSnapshotId(ReferenceCatalogSnapshotIdentity snapshotId)
    {
        if (snapshotId.Value == Guid.Empty)
        {
            throw new ArgumentException("The reference snapshot ID must not be empty.", nameof(snapshotId));
        }
    }

    private static string Bounded(string value, int maximumLength, string name)
    {
        if (value.Length == 0 || value.Length > maximumLength)
        {
            throw new ReferenceCatalogStoreException(
                "catalog_snapshot_limit_exceeded",
                $"The {name} exceeds its storage limit.");
        }

        return value;
    }

    private static object Db(string? value) => value is null ? DBNull.Value : value;

    private static string Format(ReferenceCatalogSnapshotIdentity value) =>
        value.Value.ToString("D", CultureInfo.InvariantCulture);

    private static Guid ParseGuid(string value) =>
        Guid.TryParseExact(value, "D", out var parsed) && parsed != Guid.Empty
            ? parsed
            : throw Corrupt("A persisted reference identifier is invalid.");

    private static DateTimeOffset ParseDate(string value) =>
        DateTimeOffset.TryParseExact(
            value,
            "O",
            CultureInfo.InvariantCulture,
            DateTimeStyles.RoundtripKind,
            out var parsed)
            ? parsed.ToUniversalTime()
            : throw Corrupt("A persisted reference timestamp is invalid.");

    internal static string SourceContentHash(string versionFingerprint)
    {
        const string prefix = "sha256:";
        if (versionFingerprint.StartsWith(prefix, StringComparison.Ordinal))
        {
            var separator = versionFingerprint.IndexOf(';', prefix.Length);
            var sourceHash = separator < 0
                ? versionFingerprint[prefix.Length..]
                : versionFingerprint[prefix.Length..separator];
            if (IsHash(sourceHash)) return sourceHash;
        }

        return Hash(versionFingerprint);
    }

    private static bool IsHash(string value) =>
        value.Length == 64 && value.All(character => character is >= '0' and <= '9' or >= 'a' and <= 'f');

    private static string Hash(string value) =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(value)));

    internal static string HashSnapshotMetadata(
        ReferenceCatalogSnapshotIdentity snapshotId,
        string sourceKey,
        long sequence,
        int contractVersion,
        string sourceVersion,
        string sourceContentHash,
        string provenanceJson,
        string capturedUtc) => Hash(string.Join('\n',
            Format(snapshotId),
            sourceKey,
            sequence.ToString(CultureInfo.InvariantCulture),
            contractVersion.ToString(CultureInfo.InvariantCulture),
            sourceVersion,
            sourceContentHash,
            provenanceJson,
            capturedUtc));

    internal static string HashRecordMetadata(
        string entityType,
        string sourceKey,
        string? sourceLocation,
        string canonicalPayload) => Hash(string.Join('\n',
            entityType,
            sourceKey,
            sourceLocation ?? "",
            canonicalPayload));

    private static string HashDiagnosticMetadata(ReferenceCatalogDiagnostic diagnostic) =>
        HashDiagnosticMetadata(
            diagnostic.Severity == ReferenceCatalogDiagnosticSeverity.Warning ? "warning" : "error",
            diagnostic.Code,
            diagnostic.Message,
            diagnostic.EntityType,
            diagnostic.SourceKey,
            diagnostic.Field,
            diagnostic.SourceLocation);

    internal static string HashDiagnosticMetadata(
        string severity,
        string code,
        string message,
        string? entityType,
        string? sourceKey,
        string? field,
        string? sourceLocation) => Hash(string.Join('\n',
            severity,
            code,
            message,
            entityType ?? "",
            sourceKey ?? "",
            field ?? "",
            sourceLocation ?? ""));

    private static InvalidDataException Corrupt(string message) => new(message);
}

public sealed class ReferenceCatalogStoreException : Exception
{
    public ReferenceCatalogStoreException(string code, string message, Exception? innerException = null)
        : base(message, innerException) => Code = code;

    public string Code { get; }
}
