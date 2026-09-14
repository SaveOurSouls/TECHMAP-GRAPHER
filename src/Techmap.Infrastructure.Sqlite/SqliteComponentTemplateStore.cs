using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using Techmap.Application;

namespace Techmap.Infrastructure.Sqlite;

public sealed class SqliteComponentTemplateStore(
    SqliteStorage storage,
    TimeProvider timeProvider) : IComponentTemplateStore
{
    public const int CurrentContentSchemaVersion = 1;
    public const int MaximumContentBytes = 1024 * 1024;
    public const int MaximumTemplates = 500;
    public const int MaximumVersionsPerTemplate = 100;
    public const int MaximumArticleBindings = 64;
    public const int MaximumViews = 34;
    public const int MaximumPrimitives = 5_000;
    public const int MaximumContactPoints = 2_000;
    public const double MaximumCoordinateMagnitude = 1_000_000;

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

                InsertVersion(unitOfWork, templateId, 1, input, now);
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
                InsertVersion(unitOfWork, templateId, nextVersion, input, now);
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

    private static ValidatedInput ValidateInput(
        string code,
        string name,
        IReadOnlyCollection<ComponentTemplateArticleBinding> bindings,
        int schemaVersion,
        string contentJson)
    {
        var normalizedCode = NormalizeText(code, 128, "code");
        var normalizedName = NormalizeText(name, 256, "name");
        if (schemaVersion != CurrentContentSchemaVersion)
        {
            throw Invalid(
                "component_template_schema_version_unsupported",
                $"The supported component template schema version is {CurrentContentSchemaVersion}.",
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
        return new ValidatedInput(
            normalizedCode,
            normalizedCode.ToUpperInvariant(),
            normalizedName,
            normalizedBindings,
            schemaVersion,
            canonicalContent,
            Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(canonicalContent))));
    }

    internal static string ValidateAndCanonicalizeContent(string contentJson, int schemaVersion)
    {
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
            RequireExactProperties(root, "content", "schemaVersion", "views");
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
            if (!root.TryGetProperty("views", out var views) || views.ValueKind != JsonValueKind.Array ||
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

    private static void InsertVersion(
        SqliteUnitOfWork unitOfWork,
        Guid templateId,
        int version,
        ValidatedInput input,
        string now)
    {
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
                input.Bindings, input.ContentJson));
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
        var canonical = ValidateAndCanonicalizeContent(content, schemaVersion);
        if (!string.Equals(content, canonical, StringComparison.Ordinal) ||
            !string.Equals(Hash(content), hash, StringComparison.Ordinal) ||
            !string.Equals(
                ComputeVersionHash(templateId, version, schemaVersion, code, name, bindings, content),
                versionHash,
                StringComparison.Ordinal))
            throw Corrupt();
        _ = NormalizeText(code, 128, "code");
        _ = NormalizeText(name, 256, "name");
        return new ComponentTemplateVersion(
            templateId, version, code, name, bindings,
            schemaVersion, content, templateCreatedUtc, currentUpdatedUtc ?? versionCreated);
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
            writer.WritePropertyName("content");
            using var content = JsonDocument.Parse(contentJson);
            content.RootElement.WriteTo(writer);
            writer.WriteEndObject();
        }
        return Convert.ToHexStringLower(SHA256.HashData(buffer.ToArray()));
    }

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

    private static ComponentTemplateException Corrupt() => new(
        "component_template_corrupt",
        "The stored component template is corrupt.");

    private static ComponentTemplateException Invalid(string code, string message, string? field = null) =>
        new(code, message, field);

    private sealed record Head(int CurrentVersion, DateTimeOffset CreatedUtc, DateTimeOffset UpdatedUtc);

    private sealed record ValidatedInput(
        string Code,
        string NormalizedCode,
        string Name,
        IReadOnlyList<ComponentTemplateArticleBinding> Bindings,
        int SchemaVersion,
        string ContentJson,
        string ContentSha256);
}
