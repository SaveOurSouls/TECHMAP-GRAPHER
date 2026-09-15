using System.Globalization;
using System.Buffers.Binary;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Data.Sqlite;
using Techmap.Application;

namespace Techmap.Infrastructure.Sqlite;

public sealed class SqliteComponentTemplateStore(
    SqliteStorage storage,
    TimeProvider timeProvider,
    IAttachmentContentStore? attachmentContentStore = null) : IComponentTemplateStore
{
    public const int CurrentContentSchemaVersion = 4;
    public const int MinimumSupportedContentSchemaVersion = 1;
    public const int MaximumContentBytes = 1024 * 1024;
    public const int MaximumTemplates = 500;
    public const int MaximumVersionsPerTemplate = 100;
    public const int MaximumArticleBindings = 500;
    public const int MaximumViews = 34;
    public const int MaximumPrimitives = 5_000;
    public const int MaximumContactPoints = 2_000;
    public const int MaximumAssets = 64;
    public const int MaximumAssetBytes = 10 * 1024 * 1024;
    public const int MaximumImageDimension = 16_384;
    public const long MaximumImagePixels = 100_000_000;
    public const long MaximumDecodedImageBytes = 256L * 1024 * 1024;
    public const double MaximumCoordinateMagnitude = 1_000_000;
    private readonly IAttachmentContentStore contentStore = attachmentContentStore
        ?? new ContentAddressedAttachmentStore(storage.Layout.DataRootPath);

    public IReadOnlyList<ComponentTemplateSummary> List() => storage.ExecuteRead(unitOfWork =>
    {
        using var command = unitOfWork.CreateCommand(
            """
            SELECT template_id, current_version, current_code, current_name, created_utc, updated_utc
            FROM component_templates
            WHERE deleted_utc IS NULL
            ORDER BY normalized_code, template_id;
            """);
        using var reader = command.ExecuteReader();
        var rows = new List<(Guid Id, int Version, string Code, string Name, DateTimeOffset Created, DateTimeOffset Updated)>();
        while (reader.Read())
        {
            rows.Add((
                ParseGuid(reader.GetString(0)),
                reader.GetInt32(1),
                reader.GetString(2),
                reader.GetString(3),
                ParseUtc(reader.GetString(4)),
                ParseUtc(reader.GetString(5))));
        }

        return rows.Select(row => new ComponentTemplateSummary(
            row.Id,
            row.Version,
            row.Code,
            row.Name,
            ReadBindings(unitOfWork, row.Id, row.Version),
            row.Created,
            row.Updated)).ToArray();
    });

    public ComponentTemplateVersion Get(Guid templateId)
    {
        ValidateTemplateId(templateId);
        return storage.ExecuteRead(unitOfWork =>
        {
            using var command = unitOfWork.CreateCommand(
                """
                SELECT current_version, created_utc, updated_utc
                FROM component_templates
                WHERE template_id = $templateId AND deleted_utc IS NULL;
                """);
            command.Parameters.AddWithValue("$templateId", Format(templateId));
            using var reader = command.ExecuteReader();
            if (!reader.Read()) throw NotFound();
            var version = reader.GetInt32(0);
            var created = ParseUtc(reader.GetString(1));
            var updated = ParseUtc(reader.GetString(2));
            reader.Close();
            return ReadVersion(unitOfWork, templateId, version, created, updated);
        });
    }

    public IReadOnlyList<ComponentTemplateVersion> ListVersions(Guid templateId)
    {
        ValidateTemplateId(templateId);
        return storage.ExecuteRead(unitOfWork =>
        {
            var head = ReadHead(unitOfWork, templateId, includeDeleted: true);
            using var command = unitOfWork.CreateCommand(
                """
                SELECT version
                FROM component_template_versions
                WHERE template_id = $templateId
                ORDER BY version DESC;
                """);
            command.Parameters.AddWithValue("$templateId", Format(templateId));
            using var reader = command.ExecuteReader();
            var versions = new List<int>();
            while (reader.Read()) versions.Add(reader.GetInt32(0));
            reader.Close();
            return versions.Select(version => ReadVersion(
                unitOfWork, templateId, version, head.CreatedUtc,
                version == head.CurrentVersion ? head.UpdatedUtc : null)).ToArray();
        });
    }

    public ComponentTemplateVersion GetVersion(Guid templateId, int version)
    {
        ValidateTemplateId(templateId);
        if (version <= 0) throw Invalid("component_template_version_invalid", "Version must be positive.", "version");
        return storage.ExecuteRead(unitOfWork =>
        {
            var head = ReadHead(unitOfWork, templateId, includeDeleted: true);
            return ReadVersion(
                unitOfWork, templateId, version, head.CreatedUtc,
                version == head.CurrentVersion ? head.UpdatedUtc : null);
        });
    }

    public ComponentTemplateVersion Create(
        string code,
        string name,
        IReadOnlyCollection<ComponentTemplateArticleBinding> articleBindings,
        int schemaVersion,
        string contentJson)
    {
        var input = ValidateInput(code, name, articleBindings, schemaVersion, contentJson);
        var templateId = Guid.NewGuid();
        var now = CanonicalUtc(timeProvider.GetUtcNow());
        try
        {
            return storage.ExecuteInTransaction(unitOfWork =>
            {
                using (var count = unitOfWork.CreateCommand(
                           "SELECT COUNT(*) FROM component_templates WHERE deleted_utc IS NULL;"))
                {
                    if (Convert.ToInt32(count.ExecuteScalar(), CultureInfo.InvariantCulture) >= MaximumTemplates)
                    {
                        throw Invalid(
                            "component_template_limit_reached",
                            $"The component template library cannot exceed {MaximumTemplates} active templates.");
                    }
                }

                using (var head = unitOfWork.CreateCommand(
                           """
                           INSERT INTO component_templates
                               (template_id, current_version, current_code, current_name,
                                normalized_code, created_utc, updated_utc, deleted_utc)
                           VALUES
                               ($templateId, 0, $code, $name, $normalizedCode, $now, $now, NULL);
                           """))
                {
                    head.Parameters.AddWithValue("$templateId", Format(templateId));
                    head.Parameters.AddWithValue("$code", input.Code);
                    head.Parameters.AddWithValue("$name", input.Name);
                    head.Parameters.AddWithValue("$normalizedCode", input.NormalizedCode);
                    head.Parameters.AddWithValue("$now", now);
                    head.ExecuteNonQuery();
                }

                InsertVersion(unitOfWork, templateId, 1, input, [], now);
                using (var publish = unitOfWork.CreateCommand(
                           "UPDATE component_templates SET current_version = 1 WHERE template_id = $templateId;"))
                {
                    publish.Parameters.AddWithValue("$templateId", Format(templateId));
                    publish.ExecuteNonQuery();
                }

                return ReadVersion(unitOfWork, templateId, 1, ParseUtc(now), ParseUtc(now));
            });
        }
        catch (SqliteException error) when (IsConstraint(error))
        {
            throw CodeConflict(error);
        }
    }

    public ComponentTemplateVersion Update(
        Guid templateId,
        int expectedVersion,
        string code,
        string name,
        IReadOnlyCollection<ComponentTemplateArticleBinding> articleBindings,
        int schemaVersion,
        string contentJson)
    {
        ValidateTemplateId(templateId);
        if (expectedVersion <= 0)
            throw Invalid("component_template_expected_version_invalid", "Expected version must be positive.", "expectedVersion");
        var input = ValidateInput(code, name, articleBindings, schemaVersion, contentJson);
        var now = CanonicalUtc(timeProvider.GetUtcNow());
        try
        {
            return storage.ExecuteInTransaction(unitOfWork =>
            {
                var head = ReadHead(unitOfWork, templateId, includeDeleted: false);
                if (head.CurrentVersion != expectedVersion)
                {
                    throw Conflict(head.CurrentVersion);
                }
                if (expectedVersion >= MaximumVersionsPerTemplate)
                {
                    throw Invalid(
                        "component_template_version_limit_reached",
                        $"A component template cannot exceed {MaximumVersionsPerTemplate} versions.");
                }

                var nextVersion = checked(expectedVersion + 1);
                var assets = ReadAssets(unitOfWork, templateId, expectedVersion);
                InsertVersion(unitOfWork, templateId, nextVersion, input, assets, now);
                using var update = unitOfWork.CreateCommand(
                    """
                    UPDATE component_templates
                    SET current_version = $nextVersion,
                        current_code = $code,
                        current_name = $name,
                        normalized_code = $normalizedCode,
                        updated_utc = $now
                    WHERE template_id = $templateId
                      AND current_version = $expectedVersion
                      AND deleted_utc IS NULL;
                    """);
                update.Parameters.AddWithValue("$nextVersion", nextVersion);
                update.Parameters.AddWithValue("$code", input.Code);
                update.Parameters.AddWithValue("$name", input.Name);
                update.Parameters.AddWithValue("$normalizedCode", input.NormalizedCode);
                update.Parameters.AddWithValue("$now", now);
                update.Parameters.AddWithValue("$templateId", Format(templateId));
                update.Parameters.AddWithValue("$expectedVersion", expectedVersion);
                if (update.ExecuteNonQuery() != 1) throw Conflict(ReadHead(unitOfWork, templateId, false).CurrentVersion);
                return ReadVersion(unitOfWork, templateId, nextVersion, head.CreatedUtc, ParseUtc(now));
            });
        }
        catch (SqliteException error) when (IsConstraint(error))
        {
            throw CodeConflict(error);
        }
    }

    public void Delete(Guid templateId, int expectedVersion)
    {
        ValidateTemplateId(templateId);
        if (expectedVersion <= 0)
            throw Invalid("component_template_expected_version_invalid", "Expected version must be positive.", "expectedVersion");
        var now = CanonicalUtc(timeProvider.GetUtcNow());
        storage.ExecuteInTransaction(unitOfWork =>
        {
            var head = ReadHead(unitOfWork, templateId, includeDeleted: false);
            if (head.CurrentVersion != expectedVersion) throw Conflict(head.CurrentVersion);
            using var command = unitOfWork.CreateCommand(
                """
                UPDATE component_templates
                SET deleted_utc = $now, updated_utc = $now
                WHERE template_id = $templateId
                  AND current_version = $expectedVersion
                  AND deleted_utc IS NULL;
                """);
            command.Parameters.AddWithValue("$now", now);
            command.Parameters.AddWithValue("$templateId", Format(templateId));
            command.Parameters.AddWithValue("$expectedVersion", expectedVersion);
            if (command.ExecuteNonQuery() != 1) throw Conflict(ReadHead(unitOfWork, templateId, false).CurrentVersion);
        });
    }

    public async Task<ComponentTemplateVersion> AddAssetAsync(
        Guid templateId,
        int expectedVersion,
        Stream source,
        string fileName,
        string mediaType,
        CancellationToken cancellationToken = default)
    {
        ValidateTemplateId(templateId);
        ValidateExpectedVersion(expectedVersion);
        ArgumentNullException.ThrowIfNull(source);
        var normalizedFileName = NormalizeFileName(fileName);
        var normalizedMediaType = NormalizeMediaType(mediaType);
        var imageBytes = await ReadAndValidateImageAsync(source, normalizedMediaType, cancellationToken)
            .ConfigureAwait(false);
        var now = CanonicalUtc(timeProvider.GetUtcNow());

        try
        {
            return await storage.ExecuteInTransactionAsync(async (unitOfWork, token) =>
            {
                var head = ReadHead(unitOfWork, templateId, includeDeleted: false);
                EnsureExpectedVersion(head, expectedVersion);
                var current = ReadVersion(unitOfWork, templateId, expectedVersion, head.CreatedUtc, head.UpdatedUtc);
                if (current.Assets.Count >= MaximumAssets)
                {
                    throw Invalid(
                        "component_template_asset_limit_reached",
                        $"A component template version cannot have more than {MaximumAssets} image assets.");
                }

                var expectedContent = new AttachmentContent(
                    Convert.ToHexStringLower(SHA256.HashData(imageBytes)),
                    imageBytes.LongLength);
                var asset = new ComponentTemplateAsset(
                    Guid.NewGuid(), expectedContent, normalizedFileName, normalizedMediaType);
                var assets = current.Assets.Append(asset).ToArray();
                var nextContent = current.SchemaVersion >= 2
                    ? RewriteV2ContentAssets(current.ContentJson, assets)
                    : current.ContentJson;
                var input = ValidateInput(
                    current.Code, current.Name, current.ArticleBindings,
                    current.SchemaVersion, nextContent);
                var nextVersion = checked(expectedVersion + 1);
                await using var image = new MemoryStream(imageBytes, writable: false);
                var storedContent = await contentStore.WriteAsync(image, token).ConfigureAwait(false);
                if (storedContent != expectedContent) throw Corrupt();
                InsertOrValidateBlob(unitOfWork, storedContent, now);
                InsertVersion(unitOfWork, templateId, nextVersion, input, assets, now);
                PublishVersion(unitOfWork, templateId, expectedVersion, nextVersion, input, now);
                return ReadVersion(unitOfWork, templateId, nextVersion, head.CreatedUtc, ParseUtc(now));
            }, cancellationToken).ConfigureAwait(false);
        }
        catch (SqliteException error) when (IsConstraint(error))
        {
            throw new ComponentTemplateException(
                "component_template_asset_conflict",
                "The image asset could not be attached to the component template.",
                "asset",
                innerException: error);
        }
    }

    public ComponentTemplateVersion RemoveAsset(Guid templateId, int expectedVersion, Guid assetId)
    {
        ValidateTemplateId(templateId);
        ValidateExpectedVersion(expectedVersion);
        if (assetId == Guid.Empty)
            throw Invalid("component_template_asset_not_found", "The image asset does not exist.", "assetId");
        var now = CanonicalUtc(timeProvider.GetUtcNow());
        return storage.ExecuteInTransaction(unitOfWork =>
        {
            var head = ReadHead(unitOfWork, templateId, includeDeleted: false);
            EnsureExpectedVersion(head, expectedVersion);
            var current = ReadVersion(unitOfWork, templateId, expectedVersion, head.CreatedUtc, head.UpdatedUtc);
            var assets = current.Assets.Where(item => item.AssetId != assetId).ToArray();
            if (assets.Length == current.Assets.Count)
                throw Invalid("component_template_asset_not_found", "The image asset does not exist.", "assetId");
            if (current.SchemaVersion >= 2 && FindV2ImageReferencePath(current.ContentJson, assetId) is { } referencePath)
            {
                throw Invalid(
                    "component_template_asset_in_use",
                    "The image asset is still referenced by a template image node.",
                    referencePath);
            }
            var nextContent = current.SchemaVersion >= 2
                ? RewriteV2ContentAssets(current.ContentJson, assets)
                : current.ContentJson;
            var input = ValidateInput(
                current.Code, current.Name, current.ArticleBindings,
                current.SchemaVersion, nextContent);
            var nextVersion = checked(expectedVersion + 1);
            InsertVersion(unitOfWork, templateId, nextVersion, input, assets, now);
            PublishVersion(unitOfWork, templateId, expectedVersion, nextVersion, input, now);
            return ReadVersion(unitOfWork, templateId, nextVersion, head.CreatedUtc, ParseUtc(now));
        });
    }

    public async Task<Stream> OpenAssetAsync(
        Guid templateId,
        int version,
        Guid assetId,
        CancellationToken cancellationToken = default)
    {
        ValidateTemplateId(templateId);
        if (version <= 0 || assetId == Guid.Empty)
            throw Invalid("component_template_asset_not_found", "The image asset does not exist.", "assetId");
        var asset = storage.ExecuteRead(unitOfWork =>
        {
            _ = ReadHead(unitOfWork, templateId, includeDeleted: true);
            return ReadAssets(unitOfWork, templateId, version)
                .SingleOrDefault(item => item.AssetId == assetId)
                ?? throw Invalid("component_template_asset_not_found", "The image asset does not exist.", "assetId");
        });
        return await contentStore.OpenReadVerifiedAsync(asset.Content, cancellationToken).ConfigureAwait(false);
    }

    private static ValidatedInput ValidateInput(
        string code,
        string name,
        IReadOnlyCollection<ComponentTemplateArticleBinding> bindings,
        int schemaVersion,
        string contentJson)
    {
        var normalizedCode = NormalizeText(code, 128, "code");
        var normalizedName = NormalizeText(name, 256, "name");
        if (!IsSupportedContentSchemaVersion(schemaVersion))
        {
            throw Invalid(
                "component_template_schema_version_unsupported",
                $"Supported component template schema versions are {MinimumSupportedContentSchemaVersion} and {CurrentContentSchemaVersion}.",
                "schemaVersion");
        }
        ArgumentNullException.ThrowIfNull(bindings);
        if (bindings.Count > MaximumArticleBindings)
        {
            throw Invalid(
                "component_template_bindings_invalid",
                $"A component template version cannot have more than {MaximumArticleBindings} article bindings.",
                "articleBindings");
        }

        var normalizedBindings = bindings.Select(binding =>
        {
            if (binding is null)
                throw Invalid("component_template_bindings_invalid", "An article binding is required.", "articleBindings");
            return new ComponentTemplateArticleBinding(
                NormalizeKey(binding.SourceId, 128, "articleBindings.sourceId", lower: true),
                NormalizeKey(binding.EntityType, 64, "articleBindings.entityType", lower: true),
                NormalizeKey(binding.ArticleKey, 512, "articleBindings.articleKey", lower: false));
        }).ToArray();
        if (normalizedBindings.Distinct().Count() != normalizedBindings.Length)
        {
            throw Invalid(
                "component_template_bindings_invalid",
                "Article bindings must be unique.",
                "articleBindings");
        }

        Array.Sort(normalizedBindings, static (left, right) =>
        {
            var source = StringComparer.Ordinal.Compare(left.SourceId, right.SourceId);
            if (source != 0) return source;
            var entity = StringComparer.Ordinal.Compare(left.EntityType, right.EntityType);
            return entity != 0 ? entity : StringComparer.Ordinal.Compare(left.ArticleKey, right.ArticleKey);
        });
        var canonicalContent = ValidateAndCanonicalizeContent(contentJson, schemaVersion);
        if (schemaVersion >= 3)
        {
            ValidateArticleBindingsAuthority(canonicalContent, normalizedBindings);
        }
        return new ValidatedInput(
            normalizedCode,
            normalizedCode.ToUpperInvariant(),
            normalizedName,
            normalizedBindings,
            schemaVersion,
            canonicalContent,
            Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(canonicalContent))));
    }

    private static void ValidateArticleBindingsAuthority(
        string canonicalContent,
        IReadOnlyList<ComponentTemplateArticleBinding> normalizedBindings)
    {
        using var document = JsonDocument.Parse(canonicalContent);
        var variants = document.RootElement.GetProperty("articleVariants");
        var identities = variants.EnumerateArray()
            .Select(variant => new ComponentTemplateArticleBinding(
                NormalizeKey(variant.GetProperty("sourceId").GetString()!, 128, "content.articleVariants.sourceId", lower: true),
                NormalizeKey(variant.GetProperty("entityType").GetString()!, 64, "content.articleVariants.entityType", lower: true),
                NormalizeKey(variant.GetProperty("articleKey").GetString()!, 512, "content.articleVariants.articleKey", lower: false)))
            .OrderBy(binding => binding.SourceId, StringComparer.Ordinal)
            .ThenBy(binding => binding.EntityType, StringComparer.Ordinal)
            .ThenBy(binding => binding.ArticleKey, StringComparer.Ordinal)
            .ToArray();
        if (!identities.SequenceEqual(normalizedBindings))
        {
            throw Invalid(
                "component_template_bindings_invalid",
                $"For schemaVersion {document.RootElement.GetProperty("schemaVersion").GetInt32()} articleBindings must exactly match articleVariants.",
                "articleBindings");
        }
    }

    internal static string ValidateAndCanonicalizeContent(string contentJson, int schemaVersion)
    {
        if (!IsSupportedContentSchemaVersion(schemaVersion))
        {
            throw Invalid(
                "component_template_schema_version_unsupported",
                $"Supported component template schema versions are {MinimumSupportedContentSchemaVersion} and {CurrentContentSchemaVersion}.",
                "schemaVersion");
        }
        if (string.IsNullOrWhiteSpace(contentJson))
            throw Invalid("component_template_content_invalid", "Template content is required.", "content");
        if (Encoding.UTF8.GetByteCount(contentJson) > MaximumContentBytes)
        {
            throw Invalid(
                "component_template_content_too_large",
                $"Template content cannot exceed {MaximumContentBytes} UTF-8 bytes.",
                "content");
        }

        try
        {
            using var document = JsonDocument.Parse(contentJson, new JsonDocumentOptions
            {
                AllowTrailingCommas = false,
                CommentHandling = JsonCommentHandling.Disallow,
                MaxDepth = 64,
            });
            var root = document.RootElement;
            RejectDuplicateProperties(root);
            if (!root.TryGetProperty("schemaVersion", out var version) ||
                version.ValueKind != JsonValueKind.Number ||
                !version.TryGetInt32(out var parsedVersion) ||
                parsedVersion != schemaVersion)
            {
                throw Invalid(
                    "component_template_content_invalid",
                    "Content schemaVersion must match the request schemaVersion.",
                    "content.schemaVersion");
            }
            if (schemaVersion == 4)
            {
                ComponentTemplateContentV4Validator.Validate(root);
            }
            else if (schemaVersion == 3)
            {
                ComponentTemplateContentV3Validator.Validate(root);
            }
            else if (schemaVersion == 2)
            {
                ComponentTemplateContentV2Validator.Validate(root);
            }
            else
            {
                ValidateV1Content(root);
            }

            using var buffer = new MemoryStream();
            using (var writer = new Utf8JsonWriter(buffer, new JsonWriterOptions { Indented = false }))
            {
                WriteCanonical(writer, root);
            }
            if (buffer.Length > MaximumContentBytes)
                throw Invalid("component_template_content_too_large", "Canonical template content is too large.", "content");
            return Encoding.UTF8.GetString(buffer.ToArray());
        }
        catch (JsonException error)
        {
            throw new ComponentTemplateException(
                "component_template_content_invalid",
                "Template content is not valid JSON.",
                "content",
                innerException: error);
        }
        catch (OverflowException error)
        {
            throw new ComponentTemplateException(
                "component_template_content_invalid",
                "Template content contains too many objects.",
                "content",
                innerException: error);
        }
    }

    private static void ValidateV1Content(JsonElement root)
    {
        RequireExactProperties(root, "content", "schemaVersion", "views");
        var views = root.GetProperty("views");
        if (views.ValueKind != JsonValueKind.Array ||
                views.GetArrayLength() is < 2 or > MaximumViews)
            {
                throw Invalid(
                    "component_template_content_invalid",
                    $"Content must have between 2 and {MaximumViews} views.",
                    "content.views");
            }

            var ids = new HashSet<string>(StringComparer.Ordinal);
            var e4 = 0;
            var drawing = 0;
            var primitives = 0;
            var contactPoints = 0;
            foreach (var view in views.EnumerateArray())
            {
                RequireExactProperties(view, "content.views", "id", "name", "kind", "primitives", "contactPoints");
                var id = RequiredContentString(view, "id", 128, "content.views.id");
                _ = RequiredContentString(view, "name", 256, "content.views.name");
                if (!ids.Add(id))
                    throw Invalid("component_template_content_invalid", "View IDs must be unique.", "content.views.id");
                var kind = RequiredContentString(view, "kind", 32, "content.views.kind");
                switch (kind)
                {
                    case "e4": e4++; break;
                    case "drawing": drawing++; break;
                    case "additional": break;
                    default:
                        throw Invalid(
                            "component_template_content_invalid",
                            "View kind must be e4, drawing, or additional.",
                            "content.views.kind");
                }
                var viewPrimitives = view.GetProperty("primitives");
                var viewPoints = view.GetProperty("contactPoints");
                if (viewPrimitives.ValueKind != JsonValueKind.Array || viewPoints.ValueKind != JsonValueKind.Array)
                    throw Invalid(
                        "component_template_content_invalid",
                        "Each view must contain primitives and contactPoints arrays.",
                        "content.views");
                primitives = checked(primitives + viewPrimitives.GetArrayLength());
                contactPoints = checked(contactPoints + viewPoints.GetArrayLength());
                foreach (var primitive in viewPrimitives.EnumerateArray())
                {
                    ValidatePrimitive(primitive, ids);
                }
                foreach (var point in viewPoints.EnumerateArray())
                {
                    ValidateContactPoint(point, ids);
                }
            }
            if (e4 != 1 || drawing != 1)
            {
                throw Invalid(
                    "component_template_content_invalid",
                    "Content must contain exactly one e4 view and exactly one drawing view.",
                    "content.views");
            }
            if (primitives > MaximumPrimitives || contactPoints > MaximumContactPoints)
            {
                throw Invalid(
                    "component_template_content_invalid",
                    $"Content cannot exceed {MaximumPrimitives} primitives or {MaximumContactPoints} contact points.",
                    "content.views");
            }

    }

    internal static bool IsSupportedContentSchemaVersion(int schemaVersion) =>
        schemaVersion is >= MinimumSupportedContentSchemaVersion and <= CurrentContentSchemaVersion;

    private static void ValidatePrimitive(JsonElement primitive, ISet<string> ids)
    {
        const string field = "content.views.primitives";
        RequireExactProperties(
            primitive, field, "id", "kind", "x", "y", "width", "height", "color", "text");
        var id = RequiredContentString(primitive, "id", 128, field + ".id");
        if (!ids.Add(id))
            throw Invalid("component_template_content_invalid", "All view and object IDs must be unique.", field + ".id");
        var kind = RequiredContentString(primitive, "kind", 32, field + ".kind");
        if (kind is not ("line" or "rectangle" or "ellipse" or "text"))
            throw Invalid(
                "component_template_content_invalid",
                "Primitive kind must be line, rectangle, ellipse, or text.",
                field + ".kind");
        _ = RequiredNumber(primitive, "x", field + ".x");
        _ = RequiredNumber(primitive, "y", field + ".y");
        _ = RequiredNumber(primitive, "width", field + ".width");
        _ = RequiredNumber(primitive, "height", field + ".height");
        var color = RequiredContentString(primitive, "color", 7, field + ".color", allowEmpty: false);
        if (color.Length != 7 || color[0] != '#' || color.AsSpan(1).ContainsAnyExcept("0123456789abcdefABCDEF"))
            throw Invalid(
                "component_template_content_invalid",
                "Primitive color must be a six-digit hexadecimal color.",
                field + ".color");
        _ = RequiredContentString(primitive, "text", 4_096, field + ".text", allowEmpty: true);
    }

    private static void ValidateContactPoint(JsonElement point, ISet<string> ids)
    {
        const string field = "content.views.contactPoints";
        RequireExactProperties(point, field, "id", "name", "contactNumber", "direction", "x", "y");
        var id = RequiredContentString(point, "id", 128, field + ".id");
        if (!ids.Add(id))
            throw Invalid("component_template_content_invalid", "All view and object IDs must be unique.", field + ".id");
        _ = RequiredContentString(point, "name", 256, field + ".name");
        _ = RequiredContentString(point, "contactNumber", 128, field + ".contactNumber");
        var direction = RequiredContentString(point, "direction", 16, field + ".direction");
        if (direction is not ("left" or "right" or "up" or "down"))
            throw Invalid(
                "component_template_content_invalid",
                "Contact direction must be left, right, up, or down.",
                field + ".direction");
        _ = RequiredNumber(point, "x", field + ".x");
        _ = RequiredNumber(point, "y", field + ".y");
    }

    private static double RequiredNumber(JsonElement owner, string property, string field)
    {
        var value = owner.GetProperty(property);
        if (value.ValueKind != JsonValueKind.Number || !value.TryGetDouble(out var result) ||
            !double.IsFinite(result) || Math.Abs(result) > MaximumCoordinateMagnitude)
        {
            throw Invalid(
                "component_template_content_invalid",
                $"{field} must be a finite number between {-MaximumCoordinateMagnitude} and {MaximumCoordinateMagnitude}.",
                field);
        }
        return result;
    }

    private static void RequireExactProperties(JsonElement value, string field, params string[] expected)
    {
        if (value.ValueKind != JsonValueKind.Object)
            throw Invalid("component_template_content_invalid", $"{field} must be an object.", field);
        var actual = value.EnumerateObject().Select(property => property.Name).ToArray();
        if (actual.Length != expected.Length || actual.Distinct(StringComparer.Ordinal).Count() != actual.Length ||
            !actual.Order(StringComparer.Ordinal).SequenceEqual(expected.Order(StringComparer.Ordinal)))
        {
            throw Invalid(
                "component_template_content_invalid",
                $"{field} has missing, extra, or duplicate properties.",
                field);
        }
    }

    private static string RequiredContentString(
        JsonElement owner,
        string property,
        int maximumLength,
        string field,
        bool allowEmpty = false)
    {
        var value = owner.GetProperty(property);
        if (value.ValueKind != JsonValueKind.String)
            throw Invalid("component_template_content_invalid", $"{field} must be a string.", field);
        var result = value.GetString()!;
        if (result.Length > maximumLength || result.Any(char.IsControl) ||
            !allowEmpty && (result.Length == 0 || !string.Equals(result, result.Trim(), StringComparison.Ordinal)))
        {
            throw Invalid(
                "component_template_content_invalid",
                $"{field} is not a valid string of at most {maximumLength} characters.",
                field);
        }
        return result;
    }

    private static void WriteCanonical(Utf8JsonWriter writer, JsonElement value)
    {
        switch (value.ValueKind)
        {
            case JsonValueKind.Object:
                writer.WriteStartObject();
                foreach (var property in value.EnumerateObject().OrderBy(property => property.Name, StringComparer.Ordinal))
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
            case JsonValueKind.Number: writer.WriteRawValue(value.GetRawText(), skipInputValidation: false); break;
            case JsonValueKind.True: writer.WriteBooleanValue(true); break;
            case JsonValueKind.False: writer.WriteBooleanValue(false); break;
            case JsonValueKind.Null: writer.WriteNullValue(); break;
            default: throw Invalid("component_template_content_invalid", "Template content is invalid.", "content");
        }
    }

    private static void RejectDuplicateProperties(JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.Object)
        {
            var names = new HashSet<string>(StringComparer.Ordinal);
            foreach (var property in value.EnumerateObject())
            {
                if (!names.Add(property.Name))
                    throw Invalid(
                        "component_template_content_invalid",
                        "Template content contains a duplicate JSON property.",
                        "content");
                RejectDuplicateProperties(property.Value);
            }
        }
        else if (value.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in value.EnumerateArray()) RejectDuplicateProperties(item);
        }
    }

    private static string NormalizeText(string value, int maximumLength, string field)
    {
        if (value is null) throw Invalid("component_template_invalid", $"{field} is required.", field);
        var result = string.Join(' ', value.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
        if (result.Length is 0 || result.Length > maximumLength || result.Any(char.IsControl))
            throw Invalid("component_template_invalid", $"{field} must contain 1 to {maximumLength} visible characters.", field);
        return result;
    }

    private static string NormalizeKey(string value, int maximumLength, string field, bool lower)
    {
        var result = NormalizeText(value, maximumLength, field);
        return lower ? result.ToLowerInvariant() : result;
    }

    private static string NormalizeFileName(string value)
    {
        var result = NormalizeText(value, 255, "fileName");
        if (!string.Equals(Path.GetFileName(result), result, StringComparison.Ordinal) ||
            result.IndexOfAny(['/', '\\', ':']) >= 0)
        {
            throw Invalid(
                "component_template_asset_invalid",
                "The image file name must not contain a path.",
                "fileName");
        }
        return result;
    }

    private static string NormalizeMediaType(string value)
    {
        var result = NormalizeText(value, 64, "mediaType").ToLowerInvariant();
        return result == "image/png"
            ? result
            : throw Invalid(
                "component_template_asset_type_unsupported",
                "Only structurally validated PNG image assets are supported.",
                "mediaType");
    }

    private static async Task<byte[]> ReadAndValidateImageAsync(
        Stream source,
        string mediaType,
        CancellationToken cancellationToken)
    {
        using var buffer = new MemoryStream();
        var chunk = new byte[64 * 1024];
        while (true)
        {
            var count = await source.ReadAsync(chunk, cancellationToken).ConfigureAwait(false);
            if (count == 0) break;
            if (buffer.Length + count > MaximumAssetBytes)
            {
                throw Invalid(
                    "component_template_asset_too_large",
                    $"An image asset cannot exceed {MaximumAssetBytes} bytes.",
                    "contentBase64");
            }
            buffer.Write(chunk, 0, count);
        }

        var bytes = buffer.ToArray();
        try
        {
            var dimensions = mediaType switch
            {
                "image/png" => ValidatePng(bytes),
                _ => throw new InvalidDataException(),
            };
            ValidateDimensions(dimensions.Width, dimensions.Height);
        }
        catch (Exception error) when (
            error is InvalidDataException or IOException or OverflowException or ArgumentException)
        {
            throw new ComponentTemplateException(
                "component_template_asset_content_invalid",
                "The image is truncated, malformed, too large, or does not match the declared media type.",
                "contentBase64",
                innerException: error);
        }
        return bytes;
    }

    private static ImageDimensions ValidatePng(ReadOnlySpan<byte> bytes)
    {
        ReadOnlySpan<byte> signature = [137, 80, 78, 71, 13, 10, 26, 10];
        if (bytes.Length < 45 || !bytes[..8].SequenceEqual(signature)) throw new InvalidDataException();
        var offset = 8;
        var seenHeader = false;
        var seenImageData = false;
        var endedImageData = false;
        var seenEnd = false;
        var seenPalette = false;
        var colorType = -1;
        var bitDepth = 0;
        var width = 0;
        var height = 0;
        using var compressed = new MemoryStream();
        while (offset < bytes.Length)
        {
            if (bytes.Length - offset < 12) throw new InvalidDataException();
            var lengthValue = BinaryPrimitives.ReadUInt32BigEndian(bytes.Slice(offset, 4));
            if (lengthValue > int.MaxValue) throw new InvalidDataException();
            var length = (int)lengthValue;
            if (length > bytes.Length - offset - 12) throw new InvalidDataException();
            var type = bytes.Slice(offset + 4, 4);
            if (!IsPngChunkTypeByte(type[0]) || !IsPngChunkTypeByte(type[1]) ||
                !IsPngChunkTypeByte(type[2]) || !IsPngChunkTypeByte(type[3]) ||
                (type[2] & 0x20) != 0)
                throw new InvalidDataException();
            var data = bytes.Slice(offset + 8, length);
            var storedCrc = BinaryPrimitives.ReadUInt32BigEndian(bytes.Slice(offset + 8 + length, 4));
            if (PngCrc(type, data) != storedCrc) throw new InvalidDataException();

            if (!seenHeader)
            {
                if (!type.SequenceEqual("IHDR"u8) || length != 13) throw new InvalidDataException();
                var rawWidth = BinaryPrimitives.ReadUInt32BigEndian(data[..4]);
                var rawHeight = BinaryPrimitives.ReadUInt32BigEndian(data.Slice(4, 4));
                if (rawWidth > int.MaxValue || rawHeight > int.MaxValue) throw new InvalidDataException();
                width = (int)rawWidth;
                height = (int)rawHeight;
                bitDepth = data[8];
                colorType = data[9];
                var validDepth = colorType switch
                {
                    0 => bitDepth is 1 or 2 or 4 or 8 or 16,
                    2 => bitDepth is 8 or 16,
                    3 => bitDepth is 1 or 2 or 4 or 8,
                    4 or 6 => bitDepth is 8 or 16,
                    _ => false,
                };
                if (!validDepth || data[10] != 0 || data[11] != 0 || data[12] != 0)
                    throw new InvalidDataException();
                ValidateDimensions(width, height);
                seenHeader = true;
            }
            else if (type.SequenceEqual("IHDR"u8))
            {
                throw new InvalidDataException();
            }

            if ((type[0] & 0x20) == 0 &&
                !type.SequenceEqual("IHDR"u8) && !type.SequenceEqual("PLTE"u8) &&
                !type.SequenceEqual("IDAT"u8) && !type.SequenceEqual("IEND"u8))
                throw new InvalidDataException();

            if (type.SequenceEqual("PLTE"u8))
            {
                if (seenPalette || seenImageData || colorType is 0 or 4 ||
                    length is < 3 or > 768 || length % 3 != 0)
                    throw new InvalidDataException();
                if (colorType == 3 && length / 3 > 1 << bitDepth)
                    throw new InvalidDataException();
                seenPalette = true;
            }
            else if (type.SequenceEqual("IDAT"u8))
            {
                if (endedImageData || length == 0) throw new InvalidDataException();
                seenImageData = true;
                compressed.Write(data);
            }
            else if (seenImageData && !type.SequenceEqual("IEND"u8))
            {
                endedImageData = true;
            }
            if (type.SequenceEqual("IEND"u8))
            {
                if (length != 0 || !seenImageData || colorType == 3 && !seenPalette)
                    throw new InvalidDataException();
                seenEnd = true;
                offset += 12;
                break;
            }
            offset = checked(offset + length + 12);
        }
        if (!seenHeader || !seenEnd || offset != bytes.Length) throw new InvalidDataException();
        ValidatePngImageData(compressed.ToArray(), width, height, colorType, bitDepth);
        return new ImageDimensions(width, height);
    }

    private static bool IsPngChunkTypeByte(byte value) =>
        value is (>= (byte)'A' and <= (byte)'Z') or (>= (byte)'a' and <= (byte)'z');

    private static void ValidatePngImageData(
        byte[] compressed,
        int width,
        int height,
        int colorType,
        int bitDepth)
    {
        var channels = colorType switch { 0 => 1, 2 => 3, 3 => 1, 4 => 2, 6 => 4, _ => 0 };
        var rowBytes = checked((checked(width * channels * bitDepth) + 7) / 8);
        var decodedBytes = checked((long)(rowBytes + 1) * height);
        if (rowBytes <= 0 || decodedBytes > MaximumDecodedImageBytes) throw new InvalidDataException();
        using var input = new MemoryStream(compressed, writable: false);
        using var zlib = new ZLibStream(input, CompressionMode.Decompress, leaveOpen: false);
        var row = new byte[rowBytes];
        for (var y = 0; y < height; y++)
        {
            var filter = zlib.ReadByte();
            if (filter is < 0 or > 4) throw new InvalidDataException();
            ReadExactly(zlib, row);
        }
        if (zlib.ReadByte() != -1) throw new InvalidDataException();
    }

    private static void ReadExactly(Stream stream, Span<byte> buffer)
    {
        while (!buffer.IsEmpty)
        {
            var count = stream.Read(buffer);
            if (count == 0) throw new InvalidDataException();
            buffer = buffer[count..];
        }
    }

    private static uint PngCrc(ReadOnlySpan<byte> type, ReadOnlySpan<byte> data)
    {
        var crc = uint.MaxValue;
        foreach (var value in type) crc = UpdatePngCrc(crc, value);
        foreach (var value in data) crc = UpdatePngCrc(crc, value);
        return ~crc;
    }

    private static uint UpdatePngCrc(uint crc, byte value)
    {
        crc ^= value;
        for (var bit = 0; bit < 8; bit++)
            crc = (crc & 1) != 0 ? 0xedb88320U ^ (crc >> 1) : crc >> 1;
        return crc;
    }

    private static void ValidateDimensions(int width, int height)
    {
        if (width <= 0 || height <= 0 || width > MaximumImageDimension || height > MaximumImageDimension ||
            (long)width * height > MaximumImagePixels)
            throw new InvalidDataException();
    }

    internal static void ValidatePersistedAsset(ComponentTemplateAsset asset)
    {
        string normalizedFileName;
        string normalizedMediaType;
        try
        {
            normalizedFileName = NormalizeFileName(asset.FileName);
            normalizedMediaType = NormalizeMediaType(asset.MediaType);
        }
        catch (ComponentTemplateException error)
        {
            throw Corrupt(innerException: error);
        }
        if (!string.Equals(asset.FileName, normalizedFileName, StringComparison.Ordinal) ||
            !string.Equals(asset.MediaType, normalizedMediaType, StringComparison.Ordinal) ||
            asset.AssetId == Guid.Empty || asset.Content.SizeBytes is <= 0 or > MaximumAssetBytes ||
            asset.Content.Sha256.Length != 64 ||
            asset.Content.Sha256.Any(character => character is not (>= '0' and <= '9') and not (>= 'a' and <= 'f')))
        {
            throw Corrupt();
        }
    }

    private static void ValidateExpectedVersion(int expectedVersion)
    {
        if (expectedVersion <= 0)
            throw Invalid(
                "component_template_expected_version_invalid",
                "Expected version must be positive.",
                "expectedVersion");
        if (expectedVersion >= MaximumVersionsPerTemplate)
            throw Invalid(
                "component_template_version_limit_reached",
                $"A component template cannot exceed {MaximumVersionsPerTemplate} versions.");
    }

    private static void EnsureExpectedVersion(Head head, int expectedVersion)
    {
        if (head.CurrentVersion != expectedVersion) throw Conflict(head.CurrentVersion);
    }

    private static void InsertOrValidateBlob(
        SqliteUnitOfWork unitOfWork,
        AttachmentContent content,
        string now)
    {
        using (var insert = unitOfWork.CreateCommand(
                   """
                   INSERT INTO attachment_blobs (content_sha256, size_bytes, created_utc)
                   VALUES ($sha256, $sizeBytes, $now)
                   ON CONFLICT (content_sha256) DO NOTHING;
                   """))
        {
            insert.Parameters.AddWithValue("$sha256", content.Sha256);
            insert.Parameters.AddWithValue("$sizeBytes", content.SizeBytes);
            insert.Parameters.AddWithValue("$now", now);
            insert.ExecuteNonQuery();
        }

        using var check = unitOfWork.CreateCommand(
            "SELECT size_bytes FROM attachment_blobs WHERE content_sha256 = $sha256;");
        check.Parameters.AddWithValue("$sha256", content.Sha256);
        if (Convert.ToInt64(check.ExecuteScalar(), CultureInfo.InvariantCulture) != content.SizeBytes)
            throw Corrupt();
    }

    private static void PublishVersion(
        SqliteUnitOfWork unitOfWork,
        Guid templateId,
        int expectedVersion,
        int nextVersion,
        ValidatedInput input,
        string now)
    {
        using var update = unitOfWork.CreateCommand(
            """
            UPDATE component_templates
            SET current_version = $nextVersion,
                current_code = $code,
                current_name = $name,
                normalized_code = $normalizedCode,
                updated_utc = $now
            WHERE template_id = $templateId
              AND current_version = $expectedVersion
              AND deleted_utc IS NULL;
            """);
        update.Parameters.AddWithValue("$nextVersion", nextVersion);
        update.Parameters.AddWithValue("$code", input.Code);
        update.Parameters.AddWithValue("$name", input.Name);
        update.Parameters.AddWithValue("$normalizedCode", input.NormalizedCode);
        update.Parameters.AddWithValue("$now", now);
        update.Parameters.AddWithValue("$templateId", Format(templateId));
        update.Parameters.AddWithValue("$expectedVersion", expectedVersion);
        if (update.ExecuteNonQuery() != 1) throw Conflict(ReadHead(unitOfWork, templateId, false).CurrentVersion);
    }

    private static void InsertVersion(
        SqliteUnitOfWork unitOfWork,
        Guid templateId,
        int version,
        ValidatedInput input,
        IReadOnlyList<ComponentTemplateAsset> assets,
        string now)
    {
        EnsureV2AssetMetadataMatches(input.ContentJson, input.SchemaVersion, assets);
        using (var command = unitOfWork.CreateCommand(
                   """
                   INSERT INTO component_template_versions
                       (template_id, version, schema_version, code, name,
                        content_json, content_sha256, version_sha256, created_utc)
                   VALUES
                       ($templateId, $version, $schemaVersion, $code, $name,
                        $content, $contentSha256, $versionSha256, $now);
                   """))
        {
            command.Parameters.AddWithValue("$templateId", Format(templateId));
            command.Parameters.AddWithValue("$version", version);
            command.Parameters.AddWithValue("$schemaVersion", input.SchemaVersion);
            command.Parameters.AddWithValue("$code", input.Code);
            command.Parameters.AddWithValue("$name", input.Name);
            command.Parameters.AddWithValue("$content", input.ContentJson);
            command.Parameters.AddWithValue("$contentSha256", input.ContentSha256);
            command.Parameters.AddWithValue("$versionSha256", ComputeVersionHash(
                templateId, version, input.SchemaVersion, input.Code, input.Name,
                input.Bindings, assets, input.ContentJson));
            command.Parameters.AddWithValue("$now", now);
            command.ExecuteNonQuery();
        }
        for (var index = 0; index < input.Bindings.Count; index++)
        {
            var binding = input.Bindings[index];
            using var command = unitOfWork.CreateCommand(
                """
                INSERT INTO component_template_article_bindings
                    (template_id, version, binding_ordinal, source_id, entity_type, article_key)
                VALUES
                    ($templateId, $version, $ordinal, $sourceId, $entityType, $articleKey);
                """);
            command.Parameters.AddWithValue("$templateId", Format(templateId));
            command.Parameters.AddWithValue("$version", version);
            command.Parameters.AddWithValue("$ordinal", index);
            command.Parameters.AddWithValue("$sourceId", binding.SourceId);
            command.Parameters.AddWithValue("$entityType", binding.EntityType);
            command.Parameters.AddWithValue("$articleKey", binding.ArticleKey);
            command.ExecuteNonQuery();
        }
        for (var index = 0; index < assets.Count; index++)
        {
            var asset = assets[index];
            using var command = unitOfWork.CreateCommand(
                """
                INSERT INTO component_template_asset_refs
                    (template_id, version, asset_ordinal, asset_id, file_name, media_type, content_sha256)
                VALUES
                    ($templateId, $version, $ordinal, $assetId, $fileName, $mediaType, $contentSha256);
                """);
            command.Parameters.AddWithValue("$templateId", Format(templateId));
            command.Parameters.AddWithValue("$version", version);
            command.Parameters.AddWithValue("$ordinal", index);
            command.Parameters.AddWithValue("$assetId", Format(asset.AssetId));
            command.Parameters.AddWithValue("$fileName", asset.FileName);
            command.Parameters.AddWithValue("$mediaType", asset.MediaType);
            command.Parameters.AddWithValue("$contentSha256", asset.Content.Sha256);
            command.ExecuteNonQuery();
        }
    }

    private static ComponentTemplateVersion ReadVersion(
        SqliteUnitOfWork unitOfWork,
        Guid templateId,
        int version,
        DateTimeOffset templateCreatedUtc,
        DateTimeOffset? currentUpdatedUtc)
    {
        using var command = unitOfWork.CreateCommand(
            """
            SELECT schema_version, code, name, content_json, content_sha256, version_sha256, created_utc
            FROM component_template_versions
            WHERE template_id = $templateId AND version = $version;
            """);
        command.Parameters.AddWithValue("$templateId", Format(templateId));
        command.Parameters.AddWithValue("$version", version);
        using var reader = command.ExecuteReader();
        if (!reader.Read()) throw NotFound("component_template_version_not_found");
        var schemaVersion = reader.GetInt32(0);
        var code = reader.GetString(1);
        var name = reader.GetString(2);
        var content = reader.GetString(3);
        var hash = reader.GetString(4);
        var versionHash = reader.GetString(5);
        var versionCreated = ParseUtc(reader.GetString(6));
        reader.Close();
        var bindings = ReadBindings(unitOfWork, templateId, version);
        var assets = ReadAssets(unitOfWork, templateId, version);
        var canonical = ValidateAndCanonicalizeContent(content, schemaVersion);
        try
        {
            EnsureV2AssetMetadataMatches(canonical, schemaVersion, assets);
        }
        catch (ComponentTemplateException error)
        {
            throw Corrupt(error);
        }
        if (!string.Equals(content, canonical, StringComparison.Ordinal) ||
            !string.Equals(Hash(content), hash, StringComparison.Ordinal) ||
            !string.Equals(
                ComputeVersionHash(templateId, version, schemaVersion, code, name, bindings, assets, content),
                versionHash,
                StringComparison.Ordinal))
            throw Corrupt();
        _ = NormalizeText(code, 128, "code");
        _ = NormalizeText(name, 256, "name");
        return new ComponentTemplateVersion(
            templateId, version, code, name, bindings, assets,
            schemaVersion, content, templateCreatedUtc, currentUpdatedUtc ?? versionCreated,
            versionHash);
    }

    internal static void EnsureV2AssetMetadataMatches(
        string contentJson,
        int schemaVersion,
        IReadOnlyList<ComponentTemplateAsset> assets)
    {
        if (schemaVersion < 2) return;
        using var document = JsonDocument.Parse(contentJson);
        var contentAssets = document.RootElement.GetProperty("assets");
        if (contentAssets.GetArrayLength() != assets.Count)
        {
            throw Invalid(
                "component_template_asset_metadata_mismatch",
                "Content image metadata must exactly match the attached template assets.",
                "content.assets");
        }

        var assetsById = assets.ToDictionary(asset => Format(asset.AssetId), StringComparer.Ordinal);
        var index = 0;
        foreach (var contentAsset in contentAssets.EnumerateArray())
        {
            var contentAssetId = contentAsset.GetProperty("assetId").GetString()!;
            if (!assetsById.TryGetValue(contentAssetId, out var asset) ||
                !string.Equals(contentAsset.GetProperty("fileName").GetString(), asset.FileName, StringComparison.Ordinal) ||
                !string.Equals(contentAsset.GetProperty("mediaType").GetString(), asset.MediaType, StringComparison.Ordinal) ||
                !string.Equals(contentAsset.GetProperty("sha256").GetString(), asset.Content.Sha256, StringComparison.Ordinal) ||
                !contentAsset.GetProperty("sizeBytes").TryGetInt64(out var sizeBytes) ||
                sizeBytes != asset.Content.SizeBytes)
            {
                throw Invalid(
                    "component_template_asset_metadata_mismatch",
                    "Content image metadata must exactly match the attached template assets.",
                    $"content.assets[{index}]");
            }
            index++;
        }
    }

    private static string RewriteV2ContentAssets(
        string contentJson,
        IReadOnlyList<ComponentTemplateAsset> assets)
    {
        var root = JsonNode.Parse(contentJson)?.AsObject() ?? throw Corrupt();
        var contentAssets = new JsonArray();
        foreach (var asset in assets.OrderBy(item => Format(item.AssetId), StringComparer.Ordinal))
        {
            contentAssets.Add(new JsonObject
            {
                ["assetId"] = Format(asset.AssetId),
                ["fileName"] = asset.FileName,
                ["mediaType"] = asset.MediaType,
                ["sha256"] = asset.Content.Sha256,
                ["sizeBytes"] = asset.Content.SizeBytes,
            });
        }
        root["assets"] = contentAssets;
        return root.ToJsonString();
    }

    private static string? FindV2ImageReferencePath(string contentJson, Guid assetId)
    {
        using var document = JsonDocument.Parse(contentJson);
        var expectedId = Format(assetId);
        var viewIndex = 0;
        foreach (var view in document.RootElement.GetProperty("views").EnumerateArray())
        {
            var layerIndex = 0;
            foreach (var layer in view.GetProperty("layers").EnumerateArray())
            {
                var nodeIndex = 0;
                foreach (var node in layer.GetProperty("nodes").EnumerateArray())
                {
                    if (node.GetProperty("kind").GetString() == "image" &&
                        string.Equals(
                            node.GetProperty("geometry").GetProperty("assetId").GetString(),
                            expectedId,
                            StringComparison.Ordinal))
                    {
                        return $"content.views[{viewIndex}].layers[{layerIndex}].nodes[{nodeIndex}].geometry.assetId";
                    }
                    nodeIndex++;
                }
                layerIndex++;
            }
            viewIndex++;
        }
        return null;
    }

    private static IReadOnlyList<ComponentTemplateAsset> ReadAssets(
        SqliteUnitOfWork unitOfWork,
        Guid templateId,
        int version)
    {
        using var command = unitOfWork.CreateCommand(
            """
            SELECT r.asset_id, r.content_sha256, b.size_bytes, r.file_name, r.media_type
            FROM component_template_asset_refs r
            JOIN attachment_blobs b ON b.content_sha256 = r.content_sha256
            WHERE r.template_id = $templateId AND r.version = $version
            ORDER BY r.asset_ordinal;
            """);
        command.Parameters.AddWithValue("$templateId", Format(templateId));
        command.Parameters.AddWithValue("$version", version);
        using var reader = command.ExecuteReader();
        var result = new List<ComponentTemplateAsset>();
        while (reader.Read())
        {
            result.Add(new ComponentTemplateAsset(
                ParseGuid(reader.GetString(0)),
                new AttachmentContent(reader.GetString(1), reader.GetInt64(2)),
                reader.GetString(3),
                reader.GetString(4)));
        }
        if (result.Count > MaximumAssets || result.Select(item => item.AssetId).Distinct().Count() != result.Count)
            throw Corrupt();
        foreach (var asset in result) ValidatePersistedAsset(asset);
        return result;
    }

    private static IReadOnlyList<ComponentTemplateArticleBinding> ReadBindings(
        SqliteUnitOfWork unitOfWork,
        Guid templateId,
        int version)
    {
        using var command = unitOfWork.CreateCommand(
            """
            SELECT source_id, entity_type, article_key
            FROM component_template_article_bindings
            WHERE template_id = $templateId AND version = $version
            ORDER BY binding_ordinal;
            """);
        command.Parameters.AddWithValue("$templateId", Format(templateId));
        command.Parameters.AddWithValue("$version", version);
        using var reader = command.ExecuteReader();
        var result = new List<ComponentTemplateArticleBinding>();
        while (reader.Read()) result.Add(new(reader.GetString(0), reader.GetString(1), reader.GetString(2)));
        if (result.Count > MaximumArticleBindings || result.Distinct().Count() != result.Count) throw Corrupt();
        return result;
    }

    private static Head ReadHead(SqliteUnitOfWork unitOfWork, Guid templateId, bool includeDeleted)
    {
        using var command = unitOfWork.CreateCommand(
            $"""
             SELECT current_version, created_utc, updated_utc
             FROM component_templates
             WHERE template_id = $templateId{(includeDeleted ? "" : " AND deleted_utc IS NULL")};
             """);
        command.Parameters.AddWithValue("$templateId", Format(templateId));
        using var reader = command.ExecuteReader();
        if (!reader.Read()) throw NotFound();
        return new Head(reader.GetInt32(0), ParseUtc(reader.GetString(1)), ParseUtc(reader.GetString(2)));
    }

    private static void ValidateTemplateId(Guid templateId)
    {
        if (templateId == Guid.Empty) throw NotFound();
    }

    private static string Hash(string value) =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(value)));

    internal static string ComputeVersionHash(
        Guid templateId,
        int version,
        int schemaVersion,
        string code,
        string name,
        IReadOnlyList<ComponentTemplateArticleBinding> bindings,
        IReadOnlyList<ComponentTemplateAsset> assets,
        string contentJson)
    {
        using var buffer = new MemoryStream();
        using (var writer = new Utf8JsonWriter(buffer))
        {
            writer.WriteStartObject();
            writer.WriteString("templateId", templateId);
            writer.WriteNumber("version", version);
            writer.WriteNumber("schemaVersion", schemaVersion);
            writer.WriteString("code", code);
            writer.WriteString("name", name);
            writer.WritePropertyName("articleBindings");
            writer.WriteStartArray();
            foreach (var binding in bindings)
            {
                writer.WriteStartObject();
                writer.WriteString("sourceId", binding.SourceId);
                writer.WriteString("entityType", binding.EntityType);
                writer.WriteString("articleKey", binding.ArticleKey);
                writer.WriteEndObject();
            }
            writer.WriteEndArray();
            if (assets.Count > 0)
            {
                writer.WritePropertyName("assets");
                writer.WriteStartArray();
                foreach (var asset in assets)
                {
                    writer.WriteStartObject();
                    writer.WriteString("assetId", asset.AssetId);
                    writer.WriteString("fileName", asset.FileName);
                    writer.WriteString("mediaType", asset.MediaType);
                    writer.WriteString("sha256", asset.Content.Sha256);
                    writer.WriteNumber("sizeBytes", asset.Content.SizeBytes);
                    writer.WriteEndObject();
                }
                writer.WriteEndArray();
            }
            writer.WritePropertyName("content");
            using var content = JsonDocument.Parse(contentJson);
            content.RootElement.WriteTo(writer);
            writer.WriteEndObject();
        }
        return Convert.ToHexStringLower(SHA256.HashData(buffer.ToArray()));
    }

    internal static string ComputeVersionHash(
        Guid templateId,
        int version,
        int schemaVersion,
        string code,
        string name,
        IReadOnlyList<ComponentTemplateArticleBinding> bindings,
        string contentJson) =>
        ComputeVersionHash(templateId, version, schemaVersion, code, name, bindings, [], contentJson);

    private static string Format(Guid value) => value.ToString("D", CultureInfo.InvariantCulture);

    private static Guid ParseGuid(string value) =>
        Guid.TryParseExact(value, "D", out var parsed) && parsed != Guid.Empty ? parsed : throw Corrupt();

    private static string CanonicalUtc(DateTimeOffset value) =>
        value.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture);

    private static DateTimeOffset ParseUtc(string value)
    {
        if (!DateTimeOffset.TryParseExact(value, "O", CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var parsed) ||
            !string.Equals(CanonicalUtc(parsed), value, StringComparison.Ordinal)) throw Corrupt();
        return parsed;
    }

    private static bool IsConstraint(SqliteException error) => error.SqliteErrorCode == 19;

    private static ComponentTemplateException CodeConflict(Exception inner) => new(
        "component_template_code_conflict",
        "An active component template already uses this code.",
        "code",
        innerException: inner);

    private static ComponentTemplateException NotFound(string code = "component_template_not_found") =>
        new(code, "The component template or version does not exist.");

    private static ComponentTemplateException Conflict(int currentVersion) => new(
        "component_template_version_conflict",
        "The component template changed after it was read.",
        "expectedVersion",
        currentVersion);

    private static ComponentTemplateException Corrupt(Exception? innerException = null) => new(
        "component_template_corrupt",
        "The stored component template is corrupt.",
        innerException: innerException);

    private static ComponentTemplateException Invalid(string code, string message, string? field = null) =>
        new(code, message, field);

    private sealed record Head(int CurrentVersion, DateTimeOffset CreatedUtc, DateTimeOffset UpdatedUtc);

    private readonly record struct ImageDimensions(int Width, int Height);

    private sealed record ValidatedInput(
        string Code,
        string NormalizedCode,
        string Name,
        IReadOnlyList<ComponentTemplateArticleBinding> Bindings,
        int SchemaVersion,
        string ContentJson,
        string ContentSha256);
}
