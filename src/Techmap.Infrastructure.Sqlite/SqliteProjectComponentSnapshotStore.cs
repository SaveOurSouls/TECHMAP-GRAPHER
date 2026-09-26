using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Techmap.Application;
using Techmap.Domain;

namespace Techmap.Infrastructure.Sqlite;

public sealed class SqliteProjectComponentSnapshotStore(
    SqliteStorage storage,
    TimeProvider timeProvider) : IProjectComponentSnapshotStore
{
    public const int MaximumInstanceBytes = 256 * 1024;

    public IReadOnlyList<ProjectComponentSnapshot> ListSnapshots(ProjectIdentity projectId)
    {
        ValidateProjectId(projectId);
        return storage.ExecuteRead(unitOfWork =>
        {
            EnsureProject(unitOfWork, projectId);
            return ReadSnapshots(unitOfWork, projectId);
        });
    }

    public IReadOnlyList<ProjectComponentPlacement> ListPlacements(
        ProjectIdentity projectId,
        HarnessIdentity harnessId)
    {
        ValidateProjectId(projectId);
        ValidateHarnessId(harnessId);
        return storage.ExecuteRead(unitOfWork =>
        {
            EnsureHarness(unitOfWork, projectId, harnessId);
            return ReadPlacements(unitOfWork, harnessId);
        });
    }

    public ComponentPlacementMutation Place(
        ProjectIdentity projectId,
        HarnessIdentity harnessId,
        ProjectCommandEnvelope envelope,
        Guid placementId,
        ComponentTemplateVersion source,
        string? sourceId,
        string? entityType,
        string? articleKey,
        string instanceJson)
    {
        ValidateProjectId(projectId);
        ValidateHarnessId(harnessId);
        if (envelope.CommandId == Guid.Empty)
            throw Invalid("invalid_command_id", "The command ID must be a non-empty UUID.", "commandId");
        if (envelope.ExpectedRevision < 0)
            throw Invalid("invalid_design_expected_revision", "The expected design revision must not be negative.", "expectedRevision");
        if (placementId == Guid.Empty)
            throw Invalid("invalid_component_placement_id", "The placement ID must be a non-empty UUID.", "placementId");
        ArgumentNullException.ThrowIfNull(source);
        ValidateSource(source);
        EnsurePublishedSourceVersion(source);
        var article = ResolveArticle(source, sourceId, entityType, articleKey);
        var canonicalInstance = CanonicalObject(instanceJson, MaximumInstanceBytes, "instance");
        ValidateInstanceBinding(
            canonicalInstance,
            placementId,
            source.TemplateId,
            source.Version,
            source.VersionSha256,
            article);

        return storage.ExecuteInTransaction(unitOfWork =>
        {
            EnsureHarness(unitOfWork, projectId, harnessId);
            var replay = ReadReplay(unitOfWork, envelope.CommandId);
            var request = CanonicalRequest(projectId, harnessId, envelope, placementId, source, article, canonicalInstance);
            var requestHash = Hash(request);
            if (replay is not null)
            {
                if (replay.Value.HarnessId != harnessId.Value ||
                    replay.Value.ExpectedRevision != envelope.ExpectedRevision ||
                    !string.Equals(replay.Value.RequestSha256, requestHash, StringComparison.Ordinal) ||
                    replay.Value.PlacementId != placementId)
                {
                    throw Invalid(
                        "command_id_reused",
                        "The command ID was already used for a different component placement.",
                        currentRevision: ReadRevision(unitOfWork, harnessId));
                }
                var replaySnapshot = ReadSnapshot(unitOfWork, replay.Value.SnapshotId, projectId);
                var replayPlacement = ReadPlacement(unitOfWork, placementId, harnessId);
                return new ComponentPlacementMutation(
                    envelope.CommandId,
                    envelope.ExpectedRevision,
                    replay.Value.ResultingRevision,
                    replaySnapshot,
                    replayPlacement);
            }

            var currentRevision = ReadRevision(unitOfWork, harnessId);
            if (currentRevision != envelope.ExpectedRevision)
            {
                throw Invalid(
                    "design_revision_conflict",
                    "The harness design changed after it was read.",
                    "expectedRevision",
                    currentRevision);
            }
            if (currentRevision == long.MaxValue)
                throw Invalid("design_revision_limit_reached", "The harness design revision cannot be incremented.");

            var now = CanonicalUtc(timeProvider.GetUtcNow());
            var snapshot = ReadMatchingSnapshot(unitOfWork, projectId, source);
            if (snapshot is null)
            {
                snapshot = InsertSnapshot(unitOfWork, projectId, source, now);
            }
            InsertPlacement(unitOfWork, harnessId, placementId, snapshot.SnapshotId, article, canonicalInstance, now);
            var resultingRevision = AppendInstanceToDesign(
                unitOfWork, harnessId, envelope.ExpectedRevision, canonicalInstance, now);
            InsertJournal(
                unitOfWork, envelope.CommandId, harnessId, placementId, snapshot.SnapshotId,
                envelope.ExpectedRevision, resultingRevision, request, requestHash, now);
            return new ComponentPlacementMutation(
                envelope.CommandId,
                envelope.ExpectedRevision,
                resultingRevision,
                snapshot,
                ReadPlacement(unitOfWork, placementId, harnessId));
        });
    }

    private static void ValidateSource(ComponentTemplateVersion source)
    {
        if (source.TemplateId == Guid.Empty || source.Version <= 0 || source.SchemaVersion is not (3 or 4 or 5))
            throw Invalid("component_template_version_invalid", "Only a published component template version 3, 4 or 5 can be placed.", "sourceTemplateId");
        var canonical = SqliteComponentTemplateStore.ValidateAndCanonicalizeContent(source.ContentJson, source.SchemaVersion);
        if (!string.Equals(canonical, source.ContentJson, StringComparison.Ordinal))
            throw Invalid("component_template_version_invalid", "The component template content is not canonical.", "sourceTemplateId");
        SqliteComponentTemplateStore.EnsureV2AssetMetadataMatches(source.ContentJson, source.SchemaVersion, source.Assets);
        var hash = SqliteComponentTemplateStore.ComputeVersionHash(
            source.TemplateId, source.Version, source.SchemaVersion, source.Code, source.Name,
            source.ArticleBindings, source.Assets, source.ContentJson);
        if (!string.Equals(source.VersionSha256, hash, StringComparison.Ordinal))
            throw Invalid("component_template_version_invalid", "The component template version hash is invalid.", "sourceTemplateId");
    }

    private void EnsurePublishedSourceVersion(ComponentTemplateVersion source)
    {
        storage.ExecuteRead(unitOfWork =>
        {
            using var command = unitOfWork.CreateCommand(
                """
                SELECT COUNT(*) FROM component_template_versions
                WHERE template_id = $templateId AND version = $version
                  AND version_sha256 = $versionHash;
                """);
            command.Parameters.AddWithValue("$templateId", Format(source.TemplateId));
            command.Parameters.AddWithValue("$version", source.Version);
            command.Parameters.AddWithValue("$versionHash", source.VersionSha256);
            if (Convert.ToInt32(command.ExecuteScalar(), CultureInfo.InvariantCulture) != 1)
                throw Invalid("component_template_version_not_found", "The component template version does not exist.");
            return true;
        });
    }

    private static ComponentTemplateArticleBinding ResolveArticle(
        ComponentTemplateVersion source,
        string? sourceId,
        string? entityType,
        string? articleKey)
    {
        var normalizedSource = NormalizeKey(sourceId, 128, "sourceId", lower: true);
        var normalizedEntity = NormalizeKey(entityType, 64, "entityType", lower: true);
        var normalizedArticle = NormalizeKey(articleKey, 512, "articleKey", lower: false);
        return source.ArticleBindings.SingleOrDefault(item =>
                   item.SourceId == normalizedSource && item.EntityType == normalizedEntity && item.ArticleKey == normalizedArticle)
               ?? throw Invalid(
                   "component_template_article_not_found",
                   "The selected article is not present in the component template version.",
                   "articleKey");
    }

    internal static void ValidateInstanceBinding(
        string instanceJson,
        Guid placementId,
        Guid sourceTemplateId,
        int sourceVersion,
        string sourceVersionSha256,
        ComponentTemplateArticleBinding article)
    {
        using var document = JsonDocument.Parse(instanceJson);
        var instance = document.RootElement;
        if (!instance.TryGetProperty("id", out var idElement) ||
            idElement.ValueKind != JsonValueKind.String ||
            !Guid.TryParseExact(idElement.GetString(), "D", out var instanceId) ||
            instanceId == Guid.Empty || instanceId != placementId)
        {
            throw Invalid(
                "component_placement_invalid",
                "The component instance ID must be the placement UUID.",
                "instance.id");
        }

        if (!instance.TryGetProperty("libraryBinding", out var binding) ||
            binding.ValueKind != JsonValueKind.Object)
        {
            throw Invalid(
                "component_placement_invalid",
                "The component instance library binding is required.",
                "instance.libraryBinding");
        }
        RequireExactString(binding, "mode", "template", "instance.libraryBinding.mode");
        RequireExactUuid(
            binding, "templateId", sourceTemplateId,
            "instance.libraryBinding.templateId");
        if (!binding.TryGetProperty("templateVersion", out var version) ||
            version.ValueKind != JsonValueKind.Number ||
            !version.TryGetInt32(out var templateVersion) ||
            templateVersion != sourceVersion)
        {
            throw BindingMismatch("instance.libraryBinding.templateVersion");
        }
        RequireExactString(
            binding, "versionSha256", sourceVersionSha256,
            "instance.libraryBinding.versionSha256");

        if (!binding.TryGetProperty("article", out var boundArticle) ||
            boundArticle.ValueKind != JsonValueKind.Object)
        {
            throw BindingMismatch("instance.libraryBinding.article");
        }
        RequireExactString(
            boundArticle, "sourceId", article.SourceId,
            "instance.libraryBinding.article.sourceId");
        RequireExactString(
            boundArticle, "entityType", article.EntityType,
            "instance.libraryBinding.article.entityType");
        RequireExactString(
            boundArticle, "articleKey", article.ArticleKey,
            "instance.libraryBinding.article.articleKey");
        TemplateContactNumberingValidator.ValidateInstance(instance);
    }

    private static void RequireExactUuid(
        JsonElement owner,
        string propertyName,
        Guid expected,
        string field)
    {
        if (!owner.TryGetProperty(propertyName, out var value) ||
            value.ValueKind != JsonValueKind.String ||
            !Guid.TryParseExact(value.GetString(), "D", out var actual) ||
            actual != expected)
        {
            throw BindingMismatch(field);
        }
    }

    private static void RequireExactString(
        JsonElement owner,
        string propertyName,
        string expected,
        string field)
    {
        if (!owner.TryGetProperty(propertyName, out var value) ||
            value.ValueKind != JsonValueKind.String ||
            !string.Equals(value.GetString(), expected, StringComparison.Ordinal))
        {
            throw BindingMismatch(field);
        }
    }

    private static ProjectComponentSnapshotException BindingMismatch(string field) => Invalid(
        "component_placement_binding_mismatch",
        "The component instance library binding does not match the selected template version and article.",
        field);

    private static ProjectComponentSnapshot InsertSnapshot(
        SqliteUnitOfWork unitOfWork,
        ProjectIdentity projectId,
        ComponentTemplateVersion source,
        string now)
    {
        var snapshotId = Guid.NewGuid();
        using (var command = unitOfWork.CreateCommand(
                   """
                   INSERT INTO project_component_snapshots
                       (snapshot_id, project_id, source_template_id, source_version,
                        source_version_sha256, schema_version, code, name, content_json,
                        content_sha256, created_utc, updated_utc)
                   VALUES
                       ($snapshotId, $projectId, $templateId, $version, $versionHash,
                        $schemaVersion, $code, $name, $content, $contentHash, $now, $now);
                   """))
        {
            command.Parameters.AddWithValue("$snapshotId", Format(snapshotId));
            command.Parameters.AddWithValue("$projectId", Format(projectId.Value));
            command.Parameters.AddWithValue("$templateId", Format(source.TemplateId));
            command.Parameters.AddWithValue("$version", source.Version);
            command.Parameters.AddWithValue("$versionHash", source.VersionSha256);
            command.Parameters.AddWithValue("$schemaVersion", source.SchemaVersion);
            command.Parameters.AddWithValue("$code", source.Code);
            command.Parameters.AddWithValue("$name", source.Name);
            command.Parameters.AddWithValue("$content", source.ContentJson);
            command.Parameters.AddWithValue("$contentHash", Hash(source.ContentJson));
            command.Parameters.AddWithValue("$now", now);
            command.ExecuteNonQuery();
        }
        for (var index = 0; index < source.ArticleBindings.Count; index++)
        {
            var binding = source.ArticleBindings[index];
            using var command = unitOfWork.CreateCommand(
                """
                INSERT INTO project_component_snapshot_article_bindings
                    (snapshot_id, binding_ordinal, source_id, entity_type, article_key)
                VALUES ($snapshotId, $ordinal, $sourceId, $entityType, $articleKey);
                """);
            command.Parameters.AddWithValue("$snapshotId", Format(snapshotId));
            command.Parameters.AddWithValue("$ordinal", index);
            command.Parameters.AddWithValue("$sourceId", binding.SourceId);
            command.Parameters.AddWithValue("$entityType", binding.EntityType);
            command.Parameters.AddWithValue("$articleKey", binding.ArticleKey);
            command.ExecuteNonQuery();
        }
        for (var index = 0; index < source.Assets.Count; index++)
        {
            var asset = source.Assets[index];
            using var command = unitOfWork.CreateCommand(
                """
                INSERT INTO project_component_snapshot_asset_refs
                    (snapshot_id, asset_ordinal, asset_id, file_name, media_type, content_sha256)
                VALUES ($snapshotId, $ordinal, $assetId, $fileName, $mediaType, $sha256);
                """);
            command.Parameters.AddWithValue("$snapshotId", Format(snapshotId));
            command.Parameters.AddWithValue("$ordinal", index);
            command.Parameters.AddWithValue("$assetId", Format(asset.AssetId));
            command.Parameters.AddWithValue("$fileName", asset.FileName);
            command.Parameters.AddWithValue("$mediaType", asset.MediaType);
            command.Parameters.AddWithValue("$sha256", asset.Content.Sha256);
            command.ExecuteNonQuery();
        }
        return ReadSnapshot(unitOfWork, snapshotId, projectId);
    }

    private static ProjectComponentSnapshot? ReadMatchingSnapshot(
        SqliteUnitOfWork unitOfWork,
        ProjectIdentity projectId,
        ComponentTemplateVersion source)
    {
        using var command = unitOfWork.CreateCommand(
            """
            SELECT snapshot_id
            FROM project_component_snapshots
            WHERE project_id = $projectId AND source_template_id = $templateId
              AND source_version = $version AND source_version_sha256 = $versionHash;
            """);
        command.Parameters.AddWithValue("$projectId", Format(projectId.Value));
        command.Parameters.AddWithValue("$templateId", Format(source.TemplateId));
        command.Parameters.AddWithValue("$version", source.Version);
        command.Parameters.AddWithValue("$versionHash", source.VersionSha256);
        var value = command.ExecuteScalar();
        return value is null ? null : ReadSnapshot(unitOfWork, ParseGuid(Convert.ToString(value, CultureInfo.InvariantCulture)!), projectId);
    }

    private static IReadOnlyList<ProjectComponentSnapshot> ReadSnapshots(
        SqliteUnitOfWork unitOfWork,
        ProjectIdentity projectId)
    {
        using var command = unitOfWork.CreateCommand(
            "SELECT snapshot_id FROM project_component_snapshots WHERE project_id = $projectId ORDER BY snapshot_id;");
        command.Parameters.AddWithValue("$projectId", Format(projectId.Value));
        using var reader = command.ExecuteReader();
        var ids = new List<Guid>();
        while (reader.Read()) ids.Add(ParseGuid(reader.GetString(0)));
        reader.Close();
        return ids.Select(id => ReadSnapshot(unitOfWork, id, projectId)).ToArray();
    }

    private static ProjectComponentSnapshot ReadSnapshot(
        SqliteUnitOfWork unitOfWork,
        Guid snapshotId,
        ProjectIdentity projectId)
    {
        using var command = unitOfWork.CreateCommand(
            """
            SELECT source_template_id, source_version, source_version_sha256, schema_version,
                   code, name, content_json, content_sha256, created_utc, updated_utc
            FROM project_component_snapshots
            WHERE snapshot_id = $snapshotId AND project_id = $projectId;
            """);
        command.Parameters.AddWithValue("$snapshotId", Format(snapshotId));
        command.Parameters.AddWithValue("$projectId", Format(projectId.Value));
        using var reader = command.ExecuteReader();
        if (!reader.Read()) throw Invalid("component_snapshot_not_found", "The project component snapshot does not exist.");
        var sourceTemplateId = ParseGuid(reader.GetString(0));
        var sourceVersion = reader.GetInt32(1);
        var versionHash = reader.GetString(2);
        var schemaVersion = reader.GetInt32(3);
        var code = reader.GetString(4);
        var name = reader.GetString(5);
        var content = reader.GetString(6);
        var contentHash = reader.GetString(7);
        var created = ParseUtc(reader.GetString(8));
        var updated = ParseUtc(reader.GetString(9));
        reader.Close();
        var bindings = ReadBindings(unitOfWork, snapshotId);
        var assets = ReadAssets(unitOfWork, snapshotId);
        if (!string.Equals(Hash(content), contentHash, StringComparison.Ordinal))
            throw new InvalidDataException("A project component snapshot content hash is invalid.");
        var source = new ComponentTemplateVersion(
            sourceTemplateId, sourceVersion, code, name, bindings, assets,
            schemaVersion, content, created, updated, versionHash);
        ValidateSource(source);
        return new ProjectComponentSnapshot(
            snapshotId, projectId, sourceTemplateId, sourceVersion, versionHash,
            code, name, bindings, assets, schemaVersion, content, created, updated);
    }

    private static IReadOnlyList<ComponentTemplateArticleBinding> ReadBindings(SqliteUnitOfWork unitOfWork, Guid snapshotId)
    {
        using var command = unitOfWork.CreateCommand(
            """
            SELECT source_id, entity_type, article_key
            FROM project_component_snapshot_article_bindings
            WHERE snapshot_id = $snapshotId ORDER BY binding_ordinal;
            """);
        command.Parameters.AddWithValue("$snapshotId", Format(snapshotId));
        using var reader = command.ExecuteReader();
        var result = new List<ComponentTemplateArticleBinding>();
        while (reader.Read()) result.Add(new(reader.GetString(0), reader.GetString(1), reader.GetString(2)));
        return result;
    }

    private static IReadOnlyList<ComponentTemplateAsset> ReadAssets(SqliteUnitOfWork unitOfWork, Guid snapshotId)
    {
        using var command = unitOfWork.CreateCommand(
            """
            SELECT a.asset_id, a.file_name, a.media_type, a.content_sha256, b.size_bytes
            FROM project_component_snapshot_asset_refs a
            INNER JOIN attachment_blobs b ON b.content_sha256 = a.content_sha256
            WHERE a.snapshot_id = $snapshotId ORDER BY a.asset_ordinal;
            """);
        command.Parameters.AddWithValue("$snapshotId", Format(snapshotId));
        using var reader = command.ExecuteReader();
        var result = new List<ComponentTemplateAsset>();
        while (reader.Read()) result.Add(new(
            ParseGuid(reader.GetString(0)), new AttachmentContent(reader.GetString(3), reader.GetInt64(4)),
            reader.GetString(1), reader.GetString(2)));
        return result;
    }

    private static void InsertPlacement(
        SqliteUnitOfWork unitOfWork,
        HarnessIdentity harnessId,
        Guid placementId,
        Guid snapshotId,
        ComponentTemplateArticleBinding article,
        string instanceJson,
        string now)
    {
        using var command = unitOfWork.CreateCommand(
            """
            INSERT INTO harness_component_placements
                (placement_id, harness_id, snapshot_id, source_id, entity_type, article_key,
                 instance_json, created_utc, updated_utc)
            VALUES
                ($placementId, $harnessId, $snapshotId, $sourceId, $entityType, $articleKey,
                 $instance, $now, $now);
            """);
        command.Parameters.AddWithValue("$placementId", Format(placementId));
        command.Parameters.AddWithValue("$harnessId", Format(harnessId.Value));
        command.Parameters.AddWithValue("$snapshotId", Format(snapshotId));
        command.Parameters.AddWithValue("$sourceId", article.SourceId);
        command.Parameters.AddWithValue("$entityType", article.EntityType);
        command.Parameters.AddWithValue("$articleKey", article.ArticleKey);
        command.Parameters.AddWithValue("$instance", instanceJson);
        command.Parameters.AddWithValue("$now", now);
        try { command.ExecuteNonQuery(); }
        catch (Microsoft.Data.Sqlite.SqliteException error) when (error.SqliteErrorCode == 19)
        {
            throw Invalid("component_placement_id_conflict", "The placement ID is already used.", "placementId", innerException: error);
        }
    }

    private static IReadOnlyList<ProjectComponentPlacement> ReadPlacements(
        SqliteUnitOfWork unitOfWork,
        HarnessIdentity harnessId)
    {
        using var command = unitOfWork.CreateCommand(
            """
            SELECT p.placement_id
            FROM harness_component_placements p
            INNER JOIN harness_design_documents d ON d.harness_id = p.harness_id
            WHERE p.harness_id = $harnessId
              AND EXISTS (
                  SELECT 1 FROM json_each(json_extract(d.content_json, '$.connectors')) c
                  WHERE json_extract(c.value, '$.id') = p.placement_id)
            ORDER BY p.placement_id;
            """);
        command.Parameters.AddWithValue("$harnessId", Format(harnessId.Value));
        using var reader = command.ExecuteReader();
        var ids = new List<Guid>();
        while (reader.Read()) ids.Add(ParseGuid(reader.GetString(0)));
        reader.Close();
        return ids.Select(id => ReadPlacement(unitOfWork, id, harnessId)).ToArray();
    }

    private static ProjectComponentPlacement ReadPlacement(
        SqliteUnitOfWork unitOfWork,
        Guid placementId,
        HarnessIdentity harnessId)
    {
        using var command = unitOfWork.CreateCommand(
            """
            SELECT snapshot_id, source_id, entity_type, article_key, instance_json,
                   created_utc, updated_utc
            FROM harness_component_placements
            WHERE placement_id = $placementId AND harness_id = $harnessId;
            """);
        command.Parameters.AddWithValue("$placementId", Format(placementId));
        command.Parameters.AddWithValue("$harnessId", Format(harnessId.Value));
        using var reader = command.ExecuteReader();
        if (!reader.Read()) throw Invalid("component_placement_not_found", "The component placement does not exist.");
        return new ProjectComponentPlacement(
            placementId, harnessId, ParseGuid(reader.GetString(0)), reader.GetString(1), reader.GetString(2),
            reader.GetString(3), CanonicalObject(reader.GetString(4), MaximumInstanceBytes, "instance"),
            ParseUtc(reader.GetString(5)), ParseUtc(reader.GetString(6)));
    }

    private static long AppendInstanceToDesign(
        SqliteUnitOfWork unitOfWork,
        HarnessIdentity harnessId,
        long expectedRevision,
        string instanceJson,
        string now)
    {
        string contentJson;
        using (var read = unitOfWork.CreateCommand(
                   """
                   SELECT content_json FROM harness_design_documents
                   WHERE harness_id = $harnessId AND revision = $expectedRevision;
                   """))
        {
            read.Parameters.AddWithValue("$harnessId", Format(harnessId.Value));
            read.Parameters.AddWithValue("$expectedRevision", expectedRevision);
            contentJson = read.ExecuteScalar() as string
                ?? throw Invalid(
                    "design_revision_conflict",
                    "The harness design changed while placing the component.",
                    "expectedRevision",
                    ReadRevision(unitOfWork, harnessId));
        }
        JsonObject root;
        JsonObject instance;
        try
        {
            root = JsonNode.Parse(contentJson)?.AsObject()
                ?? throw new JsonException("The harness design root is not an object.");
            instance = JsonNode.Parse(instanceJson)?.AsObject()
                ?? throw new JsonException("The component instance is not an object.");
        }
        catch (Exception error) when (error is JsonException or InvalidOperationException)
        {
            throw Invalid("invalid_design_content", "The harness design document is invalid.", "content", innerException: error);
        }
        if (root["schemaVersion"]?.GetValue<int>() != SqliteHarnessDesignDocumentStore.CurrentContentSchemaVersion ||
            root["connectors"] is not JsonArray connectors)
            throw Invalid("invalid_design_content", "The harness design connector collection is invalid.", "content.connectors");
        var instanceId = instance["id"]?.GetValue<string>();
        if (string.IsNullOrWhiteSpace(instanceId))
            throw Invalid("component_placement_invalid", "The component instance ID is required.", "instance.id");
        if (connectors.Any(item => item is JsonObject existing &&
                string.Equals(existing["id"]?.GetValue<string>(), instanceId, StringComparison.Ordinal)))
            throw Invalid("component_instance_id_conflict", "The component instance ID is already used in this harness.", "instance.id");
        connectors.Add(instance.DeepClone());
        var nextContent = CanonicalObject(root.ToJsonString(), SqliteHarnessDesignDocumentStore.MaximumContentBytes, "content");
        using var command = unitOfWork.CreateCommand(
            """
            UPDATE harness_design_documents
            SET revision = revision + 1, content_json = $content, updated_utc = $now
            WHERE harness_id = $harnessId AND revision = $expectedRevision RETURNING revision;
            """);
        command.Parameters.AddWithValue("$content", nextContent);
        command.Parameters.AddWithValue("$now", now);
        command.Parameters.AddWithValue("$harnessId", Format(harnessId.Value));
        command.Parameters.AddWithValue("$expectedRevision", expectedRevision);
        var value = command.ExecuteScalar();
        if (value is null)
            throw Invalid("design_revision_conflict", "The harness design changed while placing the component.", "expectedRevision", ReadRevision(unitOfWork, harnessId));
        return Convert.ToInt64(value, CultureInfo.InvariantCulture);
    }

    private static void InsertJournal(
        SqliteUnitOfWork unitOfWork,
        Guid commandId,
        HarnessIdentity harnessId,
        Guid placementId,
        Guid snapshotId,
        long expectedRevision,
        long resultingRevision,
        string requestJson,
        string requestHash,
        string acceptedUtc)
    {
        using var command = unitOfWork.CreateCommand(
            """
            INSERT INTO component_placement_commands
                (command_id, harness_id, placement_id, snapshot_id, expected_revision,
                 resulting_revision, request_json, request_sha256, accepted_utc)
            VALUES ($commandId, $harnessId, $placementId, $snapshotId, $expectedRevision,
                    $resultingRevision, $requestJson, $requestHash, $acceptedUtc);
            """);
        command.Parameters.AddWithValue("$commandId", Format(commandId));
        command.Parameters.AddWithValue("$harnessId", Format(harnessId.Value));
        command.Parameters.AddWithValue("$placementId", Format(placementId));
        command.Parameters.AddWithValue("$snapshotId", Format(snapshotId));
        command.Parameters.AddWithValue("$expectedRevision", expectedRevision);
        command.Parameters.AddWithValue("$resultingRevision", resultingRevision);
        command.Parameters.AddWithValue("$requestJson", requestJson);
        command.Parameters.AddWithValue("$requestHash", requestHash);
        command.Parameters.AddWithValue("$acceptedUtc", acceptedUtc);
        command.ExecuteNonQuery();
    }

    private static (Guid HarnessId, Guid PlacementId, Guid SnapshotId, long ExpectedRevision, long ResultingRevision, string RequestSha256)?
        ReadReplay(SqliteUnitOfWork unitOfWork, Guid commandId)
    {
        using var command = unitOfWork.CreateCommand(
            """
            SELECT harness_id, placement_id, snapshot_id, expected_revision, resulting_revision,
                   request_json, request_sha256
            FROM component_placement_commands WHERE command_id = $commandId;
            """);
        command.Parameters.AddWithValue("$commandId", Format(commandId));
        using var reader = command.ExecuteReader();
        if (!reader.Read()) return null;
        var request = reader.GetString(5);
        var hash = reader.GetString(6);
        if (!string.Equals(Hash(request), hash, StringComparison.Ordinal))
            throw new InvalidDataException("A component placement command failed integrity validation.");
        return (ParseGuid(reader.GetString(0)), ParseGuid(reader.GetString(1)), ParseGuid(reader.GetString(2)),
            reader.GetInt64(3), reader.GetInt64(4), hash);
    }

    private static string CanonicalRequest(
        ProjectIdentity projectId,
        HarnessIdentity harnessId,
        ProjectCommandEnvelope envelope,
        Guid placementId,
        ComponentTemplateVersion source,
        ComponentTemplateArticleBinding article,
        string instanceJson)
    {
        using var instance = JsonDocument.Parse(instanceJson);
        return JsonSerializer.Serialize(new
        {
            projectId = projectId.Value,
            harnessId = harnessId.Value,
            commandId = envelope.CommandId,
            expectedRevision = envelope.ExpectedRevision,
            placementId,
            sourceTemplateId = source.TemplateId,
            sourceVersion = source.Version,
            sourceVersionSha256 = source.VersionSha256,
            article,
            instance = instance.RootElement,
        });
    }

    private static string CanonicalObject(string json, int maximumBytes, string field)
    {
        if (string.IsNullOrWhiteSpace(json) || Encoding.UTF8.GetByteCount(json) > maximumBytes)
            throw Invalid("component_placement_invalid", "The component placement is empty or too large.", field);
        try
        {
            using var document = JsonDocument.Parse(json, new JsonDocumentOptions
            {
                AllowTrailingCommas = false,
                CommentHandling = JsonCommentHandling.Disallow,
                MaxDepth = 128,
            });
            if (document.RootElement.ValueKind != JsonValueKind.Object)
                throw Invalid("component_placement_invalid", "The component placement must be a JSON object.", field);
            using var buffer = new MemoryStream();
            using (var writer = new Utf8JsonWriter(buffer))
            {
                WriteCanonical(writer, document.RootElement);
            }
            return Encoding.UTF8.GetString(buffer.ToArray());
        }
        catch (JsonException error)
        {
            throw Invalid("component_placement_invalid", "The component placement is invalid JSON.", field, innerException: error);
        }
    }

    private static void WriteCanonical(Utf8JsonWriter writer, JsonElement value)
    {
        switch (value.ValueKind)
        {
            case JsonValueKind.Object:
                writer.WriteStartObject();
                foreach (var property in value.EnumerateObject().OrderBy(item => item.Name, StringComparer.Ordinal))
                {
                    writer.WritePropertyName(property.Name);
                    WriteCanonical(writer, property.Value);
                }
                writer.WriteEndObject();
                break;
            case JsonValueKind.Array:
                writer.WriteStartArray();
                foreach (var item in value.EnumerateArray()) WriteCanonical(writer, item);
                writer.WriteEndArray();
                break;
            case JsonValueKind.String: writer.WriteStringValue(value.GetString()); break;
            case JsonValueKind.Number: writer.WriteRawValue(value.GetRawText(), false); break;
            case JsonValueKind.True: writer.WriteBooleanValue(true); break;
            case JsonValueKind.False: writer.WriteBooleanValue(false); break;
            case JsonValueKind.Null: writer.WriteNullValue(); break;
            default: throw Invalid("component_placement_invalid", "The component placement contains an unsupported JSON value.");
        }
    }

    private static string NormalizeKey(string? value, int maximum, string field, bool lower)
    {
        var result = value?.Trim().Normalize(NormalizationForm.FormC) ?? string.Empty;
        if (result.Length is 0 || result.Length > maximum || result.Any(char.IsControl))
            throw Invalid("component_template_article_invalid", "The selected article identity is invalid.", field);
        return lower ? result.ToLowerInvariant() : result;
    }

    private static void EnsureProject(SqliteUnitOfWork unitOfWork, ProjectIdentity projectId)
    {
        using var command = unitOfWork.CreateCommand("SELECT COUNT(*) FROM projects WHERE project_id = $projectId;");
        command.Parameters.AddWithValue("$projectId", Format(projectId.Value));
        if (Convert.ToInt32(command.ExecuteScalar(), CultureInfo.InvariantCulture) != 1)
            throw Invalid("project_not_found", "The project does not exist.");
    }

    private static void EnsureHarness(SqliteUnitOfWork unitOfWork, ProjectIdentity projectId, HarnessIdentity harnessId)
    {
        EnsureProject(unitOfWork, projectId);
        using var command = unitOfWork.CreateCommand(
            "SELECT COUNT(*) FROM harnesses WHERE project_id = $projectId AND harness_id = $harnessId;");
        command.Parameters.AddWithValue("$projectId", Format(projectId.Value));
        command.Parameters.AddWithValue("$harnessId", Format(harnessId.Value));
        if (Convert.ToInt32(command.ExecuteScalar(), CultureInfo.InvariantCulture) != 1)
            throw Invalid("harness_not_found", "The harness does not exist in this project.");
    }

    private static long ReadRevision(SqliteUnitOfWork unitOfWork, HarnessIdentity harnessId)
    {
        using var command = unitOfWork.CreateCommand(
            "SELECT revision FROM harness_design_documents WHERE harness_id = $harnessId;");
        command.Parameters.AddWithValue("$harnessId", Format(harnessId.Value));
        var value = command.ExecuteScalar();
        if (value is null) throw Invalid("harness_not_found", "The harness design does not exist.");
        return Convert.ToInt64(value, CultureInfo.InvariantCulture);
    }

    private static void ValidateProjectId(ProjectIdentity id)
    {
        if (id.Value == Guid.Empty) throw Invalid("project_not_found", "The project does not exist.");
    }

    private static void ValidateHarnessId(HarnessIdentity id)
    {
        if (id.Value == Guid.Empty) throw Invalid("harness_not_found", "The harness does not exist in this project.");
    }

    private static string Hash(string value) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
    private static string Format(Guid value) => value.ToString("D", CultureInfo.InvariantCulture);
    private static Guid ParseGuid(string value) => Guid.TryParseExact(value, "D", out var parsed) && parsed != Guid.Empty
        ? parsed : throw new InvalidDataException("A UUID is invalid.");
    private static string CanonicalUtc(DateTimeOffset value) => value.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture);
    private static DateTimeOffset ParseUtc(string value) => DateTimeOffset.ParseExact(
        value, "O", CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind).ToUniversalTime();

    private static ProjectComponentSnapshotException Invalid(
        string code,
        string message,
        string? field = null,
        long? currentRevision = null,
        Exception? innerException = null) => new(code, message, field, currentRevision, innerException);
}
