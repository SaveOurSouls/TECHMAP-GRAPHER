using System.Globalization;
using System.Text;
using System.Text.Json;
using Techmap.Application;
using Techmap.Domain;

namespace Techmap.Infrastructure.Sqlite;

public sealed class SqliteHarnessDesignDocumentStore(
    SqliteStorage storage,
    TimeProvider timeProvider) : IHarnessDesignDocumentStore
{
    public const int CurrentContentSchemaVersion = 1;
    public const int MaximumContentBytes = 1024 * 1024;

    public HarnessDesignDocument Get(ProjectIdentity projectId, HarnessIdentity harnessId)
    {
        ValidateIdentity(projectId, harnessId);
        return storage.ExecuteRead(unitOfWork => Read(unitOfWork, projectId, harnessId));
    }

    public HarnessDesignDocument Put(
        ProjectIdentity projectId,
        HarnessIdentity harnessId,
        long expectedRevision,
        int schemaVersion,
        string contentJson)
    {
        ValidateIdentity(projectId, harnessId);
        if (expectedRevision < 0)
        {
            throw Invalid(
                "invalid_design_expected_revision",
                "The expected design revision must not be negative.",
                "expectedRevision");
        }
        if (schemaVersion != CurrentContentSchemaVersion)
        {
            throw Invalid(
                "unsupported_design_schema_version",
                $"The supported harness design schema version is {CurrentContentSchemaVersion}.",
                "schemaVersion");
        }

        var canonicalJson = ValidateContent(contentJson, schemaVersion);
        var now = CanonicalUtc(timeProvider.GetUtcNow());
        return storage.ExecuteInTransaction(unitOfWork =>
        {
            EnsureHarness(unitOfWork, projectId, harnessId);
            using var update = unitOfWork.CreateCommand(
                """
                UPDATE harness_design_documents
                SET revision = revision + 1,
                    schema_version = $schemaVersion,
                    content_json = $contentJson,
                    updated_utc = $updatedUtc
                WHERE harness_id = $harnessId AND revision = $expectedRevision;
                """);
            update.Parameters.AddWithValue("$schemaVersion", schemaVersion);
            update.Parameters.AddWithValue("$contentJson", canonicalJson);
            update.Parameters.AddWithValue("$updatedUtc", now);
            update.Parameters.AddWithValue("$harnessId", Format(harnessId.Value));
            update.Parameters.AddWithValue("$expectedRevision", expectedRevision);
            if (update.ExecuteNonQuery() != 1)
            {
                var current = Read(unitOfWork, projectId, harnessId);
                // A navigation flush can join an autosave whose response was
                // already accepted, and a lost response can also make the
                // client retry the same PUT with its previous revision. Treat
                // that exact replay as acknowledged while preserving the
                // optimistic conflict for any different document.
                if (current.SchemaVersion == schemaVersion &&
                    string.Equals(current.ContentJson, canonicalJson, StringComparison.Ordinal))
                {
                    return current;
                }
                throw new HarnessDesignDocumentException(
                    "design_revision_conflict",
                    "The harness design changed after it was read.",
                    "expectedRevision",
                    current.Revision);
            }

            // Keep the project-owned component placement index aligned with the
            // design document in the same transaction. A normal editor save can
            // move or remove a template-backed connector without going through
            // the placement command endpoint; stale rows must not leak into the
            // project export or a subsequent list request.
            ReconcileComponentPlacements(unitOfWork, harnessId, canonicalJson, now);

            return Read(unitOfWork, projectId, harnessId);
        });
    }

    private static void ReconcileComponentPlacements(
        SqliteUnitOfWork unitOfWork,
        HarnessIdentity harnessId,
        string designJson,
        string updatedUtc)
    {
        var liveInstances = new Dictionary<Guid, string>();
        using (var document = JsonDocument.Parse(designJson))
        {
            if (!document.RootElement.TryGetProperty("connectors", out var connectors) ||
                connectors.ValueKind != JsonValueKind.Array)
            {
                throw Invalid("invalid_design_content", "The harness design connector collection is invalid.", "content.connectors");
            }
            foreach (var connector in connectors.EnumerateArray())
            {
                if (connector.ValueKind != JsonValueKind.Object ||
                    !connector.TryGetProperty("id", out var idValue) ||
                    !Guid.TryParse(idValue.GetString(), out var id) ||
                    id == Guid.Empty)
                {
                    continue;
                }
                var isTemplate = connector.TryGetProperty("libraryBinding", out var binding) &&
                    binding.ValueKind == JsonValueKind.Object &&
                    binding.TryGetProperty("mode", out var mode) &&
                    mode.ValueKind == JsonValueKind.String &&
                    string.Equals(mode.GetString(), "template", StringComparison.Ordinal);
                if (isTemplate) liveInstances[id] = connector.GetRawText();
            }
        }

        var placements = new List<(Guid Id, Guid SnapshotId, string InstanceJson, Guid SourceTemplateId, int SourceVersion,
            string VersionHash, ComponentTemplateArticleBinding Article)>();
        using (var select = unitOfWork.CreateCommand(
                   """
                   SELECT p.placement_id, p.snapshot_id, p.instance_json, s.source_template_id, s.source_version,
                          s.source_version_sha256, p.source_id, p.entity_type, p.article_key
                   FROM harness_component_placements p
                   INNER JOIN project_component_snapshots s ON s.snapshot_id = p.snapshot_id
                   WHERE p.harness_id = $harnessId;
                   """))
        {
            select.Parameters.AddWithValue("$harnessId", Format(harnessId.Value));
            using var reader = select.ExecuteReader();
            while (reader.Read())
            {
                if (Guid.TryParse(reader.GetString(0), out var placementId))
                    placements.Add((placementId, Guid.Parse(reader.GetString(1)), reader.GetString(2), Guid.Parse(reader.GetString(3)), reader.GetInt32(4),
                        reader.GetString(5), new ComponentTemplateArticleBinding(
                            reader.GetString(6), reader.GetString(7), reader.GetString(8))));
            }
        }

        foreach (var placement in placements)
        {
            var placementId = placement.Id;
            if (liveInstances.TryGetValue(placementId, out var instanceJson))
            {
                var article = ResolveSnapshotArticle(unitOfWork, placement.SnapshotId, instanceJson);
                try
                {
                    SqliteProjectComponentSnapshotStore.ValidateInstanceBinding(
                        instanceJson, placementId, placement.SourceTemplateId, placement.SourceVersion,
                        placement.VersionHash, article);
                }
                catch (ProjectComponentSnapshotException error)
                {
                    throw new HarnessDesignDocumentException(
                        error.Code, error.Message, error.Field, innerException: error);
                }
                liveInstances.Remove(placementId);
                if (string.Equals(placement.InstanceJson, instanceJson, StringComparison.Ordinal) &&
                    placement.Article == article) continue;
                using var update = unitOfWork.CreateCommand(
                    """
                    UPDATE harness_component_placements
                    SET source_id = $sourceId, entity_type = $entityType, article_key = $articleKey,
                        instance_json = $instanceJson, updated_utc = $updatedUtc
                    WHERE placement_id = $placementId AND harness_id = $harnessId;
                    """);
                update.Parameters.AddWithValue("$instanceJson", instanceJson);
                update.Parameters.AddWithValue("$sourceId", article.SourceId);
                update.Parameters.AddWithValue("$entityType", article.EntityType);
                update.Parameters.AddWithValue("$articleKey", article.ArticleKey);
                update.Parameters.AddWithValue("$updatedUtc", updatedUtc);
                update.Parameters.AddWithValue("$placementId", Format(placementId));
                update.Parameters.AddWithValue("$harnessId", Format(harnessId.Value));
                update.ExecuteNonQuery();
                continue;
            }

            // Placement commands are immutable audit records. Rows without a
            // command can be removed; commanded rows remain as history but are
            // filtered from list/export by their absence from the live design.
            using var delete = unitOfWork.CreateCommand(
                """
                DELETE FROM harness_component_placements
                WHERE placement_id = $placementId AND harness_id = $harnessId
                  AND NOT EXISTS (
                      SELECT 1 FROM component_placement_commands
                      WHERE placement_id = $placementId);
                """);
            delete.Parameters.AddWithValue("$placementId", Format(placementId));
            delete.Parameters.AddWithValue("$harnessId", Format(harnessId.Value));
            delete.ExecuteNonQuery();
        }

        if (liveInstances.Count != 0)
        {
            throw Invalid(
                "component_placement_missing",
                "A template-backed connector does not have a project component placement.",
                "content.connectors");
        }
    }

    private static ComponentTemplateArticleBinding ResolveSnapshotArticle(
        SqliteUnitOfWork unitOfWork,
        Guid snapshotId,
        string instanceJson)
    {
        string? sourceId = null;
        string? entityType = null;
        string? articleKey = null;
        try
        {
            using var document = JsonDocument.Parse(instanceJson);
            var binding = document.RootElement.GetProperty("libraryBinding");
            var article = binding.GetProperty("article");
            sourceId = article.GetProperty("sourceId").GetString();
            entityType = article.GetProperty("entityType").GetString();
            articleKey = article.GetProperty("articleKey").GetString();
        }
        catch (Exception error) when (error is JsonException or InvalidOperationException or KeyNotFoundException)
        {
            throw new HarnessDesignDocumentException(
                "component_placement_binding_mismatch",
                "The component instance article binding is invalid.",
                "instance.libraryBinding.article",
                innerException: error);
        }
        using var command = unitOfWork.CreateCommand(
            """
            SELECT source_id, entity_type, article_key
            FROM project_component_snapshot_article_bindings
            WHERE snapshot_id = $snapshotId AND source_id = $sourceId
              AND entity_type = $entityType AND article_key = $articleKey;
            """);
        command.Parameters.AddWithValue("$snapshotId", Format(snapshotId));
        command.Parameters.AddWithValue("$sourceId", sourceId ?? "");
        command.Parameters.AddWithValue("$entityType", entityType ?? "");
        command.Parameters.AddWithValue("$articleKey", articleKey ?? "");
        using var reader = command.ExecuteReader();
        if (!reader.Read())
            throw Invalid(
                "component_template_article_not_found",
                "The selected article is not present in the project component snapshot.",
                "instance.libraryBinding.article.articleKey");
        return new ComponentTemplateArticleBinding(reader.GetString(0), reader.GetString(1), reader.GetString(2));
    }

    private static string ValidateContent(string contentJson, int schemaVersion)
    {
        if (string.IsNullOrWhiteSpace(contentJson))
        {
            throw Invalid("invalid_design_content", "The harness design content is required.", "content");
        }
        if (Encoding.UTF8.GetByteCount(contentJson) > MaximumContentBytes)
        {
            throw Invalid(
                "design_content_too_large",
                $"The harness design content must not exceed {MaximumContentBytes} UTF-8 bytes.",
                "content");
        }

        try
        {
            using var document = JsonDocument.Parse(contentJson, new JsonDocumentOptions
            {
                AllowTrailingCommas = false,
                CommentHandling = JsonCommentHandling.Disallow,
                MaxDepth = 128,
            });
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object ||
                !root.TryGetProperty("schemaVersion", out var contentVersion) ||
                contentVersion.ValueKind != JsonValueKind.Number ||
                !contentVersion.TryGetInt32(out var parsedVersion) ||
                parsedVersion != schemaVersion)
            {
                throw Invalid(
                    "invalid_design_content",
                    "The content schemaVersion must match the request schemaVersion.",
                    "content");
            }

            ValidateCableInstances(root);

            return root.GetRawText();
        }
        catch (JsonException error)
        {
            throw new HarnessDesignDocumentException(
                "invalid_design_content",
                "The harness design content is not valid JSON.",
                "content",
                innerException: error);
        }
    }

    private static void ValidateCableInstances(JsonElement root)
    {
        // `cables` is optional so documents written before the cable model was
        // introduced continue to round-trip unchanged.
        if (!root.TryGetProperty("cables", out var cables)) return;
        if (cables.ValueKind != JsonValueKind.Array)
            throw Invalid("invalid_design_content", "The harness design cable collection must be an array.", "content.cables");
        if (!root.TryGetProperty("wires", out var wires) || wires.ValueKind != JsonValueKind.Array)
            throw Invalid("invalid_design_content", "The harness design wire collection must be an array.", "content.wires");

        var wireIds = new HashSet<string>(StringComparer.Ordinal);
        var wireIndex = 0;
        foreach (var wire in wires.EnumerateArray())
        {
            var path = $"content.wires[{wireIndex}].id";
            if (wire.ValueKind != JsonValueKind.Object)
                throw Invalid("invalid_design_content", "A harness design wire must be an object.", $"content.wires[{wireIndex}]");
            var wireId = RequiredCableString(wire, "id", path, 256);
            if (!wireIds.Add(wireId))
                throw Invalid("invalid_design_content", "Harness design wire IDs must be unique.", path);
            wireIndex++;
        }

        var cableIds = new HashSet<string>(StringComparer.Ordinal);
        var claimedWireIds = new HashSet<string>(StringComparer.Ordinal);
        var cableIndex = 0;
        foreach (var cable in cables.EnumerateArray())
        {
            var path = $"content.cables[{cableIndex}]";
            if (cable.ValueKind != JsonValueKind.Object)
                throw Invalid("invalid_design_content", "A harness design cable must be an object.", path);
            var cableId = RequiredCableString(cable, "id", $"{path}.id", 256);
            if (!cableIds.Add(cableId))
                throw Invalid("invalid_design_content", "Harness design cable IDs must be unique.", $"{path}.id");

            if (!cable.TryGetProperty("memberWireIds", out var members) || members.ValueKind != JsonValueKind.Array)
                throw Invalid("invalid_design_content", "Cable memberWireIds must be an array.", $"{path}.memberWireIds");
            var localMembers = new HashSet<string>(StringComparer.Ordinal);
            var memberIndex = 0;
            foreach (var member in members.EnumerateArray())
            {
                var memberPath = $"{path}.memberWireIds[{memberIndex}]";
                if (member.ValueKind != JsonValueKind.String || string.IsNullOrWhiteSpace(member.GetString()))
                    throw Invalid("invalid_design_content", "A cable member wire ID must be a non-empty string.", memberPath);
                var memberId = member.GetString()!;
                if (!wireIds.Contains(memberId))
                    throw Invalid("invalid_design_content", "A cable references an unknown wire ID.", memberPath);
                if (!localMembers.Add(memberId))
                    throw Invalid("invalid_design_content", "A cable cannot contain the same wire more than once.", memberPath);
                if (!claimedWireIds.Add(memberId))
                    throw Invalid("invalid_design_content", "A wire cannot belong to more than one cable.", memberPath);
                memberIndex++;
            }

            ValidateCableLength(cable, "lengthMm", $"{path}.lengthMm", allowNull: true, defaultValue: null);
            ValidateCableCorrection(cable, "endCorrectionFromMm", $"{path}.endCorrectionFromMm", defaultValue: 0m);
            ValidateCableCorrection(cable, "endCorrectionToMm", $"{path}.endCorrectionToMm", defaultValue: 0m);
            var rounding = ValidateCableLength(cable, "cutRoundingStepMm", $"{path}.cutRoundingStepMm", allowNull: false, defaultValue: 1m);
            if (rounding is not null && rounding.Value.Micrometres == 0)
                throw Invalid("invalid_design_content", "The cable cut rounding step must be greater than zero.", $"{path}.cutRoundingStepMm");
            ValidateCableMaterialBinding(cable, path);
            cableIndex++;
        }
    }

    private static Length? ValidateCableLength(
        JsonElement owner,
        string propertyName,
        string path,
        bool allowNull,
        decimal? defaultValue)
    {
        if (!owner.TryGetProperty(propertyName, out var property))
        {
            if (defaultValue is null) return null;
            property = JsonSerializer.SerializeToElement(defaultValue.Value);
        }
        if (property.ValueKind == JsonValueKind.Null)
        {
            if (allowNull) return null;
            throw Invalid("invalid_design_content", $"Cable {propertyName} must be a number.", path);
        }
        if (property.ValueKind != JsonValueKind.Number || !property.TryGetDecimal(out var value))
            throw Invalid("invalid_design_content", "A cable length must be an exact decimal JSON number.", path);
        try
        {
            return Length.FromMillimetres(value);
        }
        catch (ArgumentException error)
        {
            throw new HarnessDesignDocumentException(
                "invalid_design_content", "The cable length is invalid or more precise than 0.001 mm.", path,
                innerException: error);
        }
        catch (OverflowException error)
        {
            throw new HarnessDesignDocumentException(
                "invalid_design_content", "The cable length exceeds the supported range.", path,
                innerException: error);
        }
    }

    private static void ValidateCableCorrection(
        JsonElement owner,
        string propertyName,
        string path,
        decimal defaultValue)
    {
        var property = owner.TryGetProperty(propertyName, out var present)
            ? present
            : JsonSerializer.SerializeToElement(defaultValue);
        if (property.ValueKind != JsonValueKind.Number ||
            !property.TryGetDecimal(out var value))
        {
            throw Invalid("invalid_design_content", "A cable end correction must be an exact decimal JSON number.", path);
        }
        try
        {
            _ = LengthCorrection.FromMillimetres(value);
        }
        catch (ArgumentException error)
        {
            throw new HarnessDesignDocumentException(
                "invalid_design_content", "The cable end correction is more precise than 0.001 mm.", path,
                innerException: error);
        }
        catch (OverflowException error)
        {
            throw new HarnessDesignDocumentException(
                "invalid_design_content", "The cable end correction exceeds the supported range.", path,
                innerException: error);
        }
    }

    private static void ValidateCableMaterialBinding(JsonElement cable, string cablePath)
    {
        if (!cable.TryGetProperty("materialBinding", out var binding)) return;
        var path = $"{cablePath}.materialBinding";
        if (binding.ValueKind != JsonValueKind.Object)
            throw Invalid("invalid_design_content", "The cable material binding must be an object.", path);
        _ = RequiredCableString(binding, "sourceId", $"{path}.sourceId", 128);
        var snapshotId = RequiredCableString(binding, "snapshotId", $"{path}.snapshotId", 36);
        if (!Guid.TryParseExact(snapshotId, "D", out var parsedSnapshotId) || parsedSnapshotId == Guid.Empty)
            throw Invalid("invalid_design_content", "The cable material snapshotId must be a non-empty UUID.", $"{path}.snapshotId");
        ValidateSha256(binding, "snapshotSha256", $"{path}.snapshotSha256");
        ValidateSha256(binding, "recordId", $"{path}.recordId");
        var entityType = RequiredCableString(binding, "entityType", $"{path}.entityType", 16);
        if (!string.Equals(entityType, "cable", StringComparison.Ordinal))
            throw Invalid("invalid_design_content", "The cable material entityType must be cable.", $"{path}.entityType");
        _ = RequiredCableString(binding, "sourceKey", $"{path}.sourceKey", 512);
        _ = RequiredCableString(binding, "displayName", $"{path}.displayName", 256);
    }

    private static void ValidateSha256(JsonElement owner, string propertyName, string path)
    {
        var value = RequiredCableString(owner, propertyName, path, 64);
        if (value.Length != 64 || value.Any(character => !Uri.IsHexDigit(character)))
            throw Invalid("invalid_design_content", $"Cable material {propertyName} must be a SHA-256 hexadecimal value.", path);
    }

    private static string RequiredCableString(JsonElement owner, string propertyName, string path, int maximumLength)
    {
        if (!owner.TryGetProperty(propertyName, out var value) || value.ValueKind != JsonValueKind.String)
            throw Invalid("invalid_design_content", $"Cable {propertyName} must be a string.", path);
        var result = value.GetString()!;
        if (string.IsNullOrWhiteSpace(result) || result.Length > maximumLength)
            throw Invalid("invalid_design_content", $"Cable {propertyName} is empty or too long.", path);
        return result;
    }

    private static HarnessDesignDocument Read(
        SqliteUnitOfWork unitOfWork,
        ProjectIdentity projectId,
        HarnessIdentity harnessId)
    {
        EnsureHarness(unitOfWork, projectId, harnessId);
        using var command = unitOfWork.CreateCommand(
            """
            SELECT revision, schema_version, content_json, created_utc, updated_utc
            FROM harness_design_documents
            WHERE harness_id = $harnessId;
            """);
        command.Parameters.AddWithValue("$harnessId", Format(harnessId.Value));
        using var reader = command.ExecuteReader();
        if (!reader.Read())
        {
            throw new InvalidDataException("The harness design document is missing.");
        }

        var result = new HarnessDesignDocument(
            harnessId,
            reader.GetInt64(0),
            reader.GetInt32(1),
            reader.GetString(2),
            ParseUtc(reader.GetString(3)),
            ParseUtc(reader.GetString(4)));
        _ = ValidateContent(result.ContentJson, result.SchemaVersion);
        return result;
    }

    private static void EnsureHarness(
        SqliteUnitOfWork unitOfWork,
        ProjectIdentity projectId,
        HarnessIdentity harnessId)
    {
        using var project = unitOfWork.CreateCommand(
            "SELECT COUNT(*) FROM projects WHERE project_id = $projectId;");
        project.Parameters.AddWithValue("$projectId", Format(projectId.Value));
        if (Convert.ToInt32(project.ExecuteScalar(), CultureInfo.InvariantCulture) == 0)
        {
            throw Invalid("project_not_found", "The project does not exist.");
        }

        using var harness = unitOfWork.CreateCommand(
            "SELECT COUNT(*) FROM harnesses WHERE harness_id = $harnessId AND project_id = $projectId;");
        harness.Parameters.AddWithValue("$harnessId", Format(harnessId.Value));
        harness.Parameters.AddWithValue("$projectId", Format(projectId.Value));
        if (Convert.ToInt32(harness.ExecuteScalar(), CultureInfo.InvariantCulture) == 0)
        {
            throw Invalid("harness_not_found", "The harness does not exist in this project.");
        }
    }

    private static void ValidateIdentity(ProjectIdentity projectId, HarnessIdentity harnessId)
    {
        if (projectId.Value == Guid.Empty)
            throw Invalid("project_not_found", "The project does not exist.");
        if (harnessId.Value == Guid.Empty)
            throw Invalid("harness_not_found", "The harness does not exist in this project.");
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
                throw new FormatException();
            return parsed;
        }
        catch (FormatException error)
        {
            throw new InvalidDataException("A harness design timestamp is invalid.", error);
        }
    }

    private static string Format(Guid value) => value.ToString("D", CultureInfo.InvariantCulture);

    private static HarnessDesignDocumentException Invalid(
        string code,
        string message,
        string? field = null) => new(code, message, field);
}
