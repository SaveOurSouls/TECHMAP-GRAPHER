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
                throw new HarnessDesignDocumentException(
                    "design_revision_conflict",
                    "The harness design changed after it was read.",
                    "expectedRevision",
                    current.Revision);
            }

            return Read(unitOfWork, projectId, harnessId);
        });
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
