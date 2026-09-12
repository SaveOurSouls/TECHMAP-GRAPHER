using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Techmap.Application;
using Techmap.Domain;

namespace Techmap.Infrastructure.Sqlite;

public sealed class SqliteProjectAttachmentCatalog(
    SqliteStorage storage,
    IAttachmentContentStore contentStore,
    TimeProvider timeProvider,
    Action<string>? commandProgressHook = null) : IProjectAttachmentCatalog
{
    private const string AttachmentCommandType = "add_attachment";
    private const int JournalPayloadSchemaVersion = 1;
    private static readonly JsonSerializerOptions JournalJsonOptions = new(JsonSerializerDefaults.Web);

    public async Task<ProjectAttachment> AddAsync(
        ProjectIdentity projectId,
        Stream source,
        string fileName,
        string mediaType,
        string purpose,
        CancellationToken cancellationToken = default)
    {
        // The explicit command overload is used by HTTP; preserve the old in-process
        // entry point for existing callers while still journaling every new reference.
        return (await AddCoreAsync(
            projectId,
            null,
            source,
            fileName,
            mediaType,
            purpose,
            cancellationToken).ConfigureAwait(false)).Value;
    }

    public Task<ProjectMutationResult<ProjectAttachment>> AddAsync(
        ProjectIdentity projectId,
        ProjectCommandEnvelope envelope,
        Stream source,
        string fileName,
        string mediaType,
        string purpose,
        CancellationToken cancellationToken = default) =>
        AddCoreAsync(projectId, envelope, source, fileName, mediaType, purpose, cancellationToken);

    private async Task<ProjectMutationResult<ProjectAttachment>> AddCoreAsync(
        ProjectIdentity projectId,
        ProjectCommandEnvelope? requestedEnvelope,
        Stream source,
        string fileName,
        string mediaType,
        string purpose,
        CancellationToken cancellationToken)
    {
        ValidateProjectId(projectId);
        if (requestedEnvelope is not null)
        {
            ValidateEnvelope(requestedEnvelope.Value);
        }
        ArgumentNullException.ThrowIfNull(source);
        var normalizedFileName = NormalizeFileName(fileName);
        var normalizedMediaType = NormalizeToken(mediaType, 127, "mediaType", allowSlash: true);
        var normalizedPurpose = NormalizeToken(purpose, 64, "purpose", allowSlash: false);

        // Immutable content is published first. If the following SQLite transaction fails,
        // it remains an unreferenced safe orphan and is invisible to project reads.
        var content = await contentStore.WriteAsync(source, cancellationToken).ConfigureAwait(false);
        var canonicalRequest = JsonSerializer.Serialize(new
        {
            fileName = normalizedFileName,
            mediaType = normalizedMediaType,
            purpose = normalizedPurpose,
            sha256 = content.Sha256,
            sizeBytes = content.SizeBytes,
        }, JournalJsonOptions);
        var requestHash = Sha256(canonicalRequest);
        var attachment = new ProjectAttachment(
            AttachmentIdentity.New(),
            projectId,
            content,
            normalizedFileName,
            normalizedMediaType,
            normalizedPurpose,
            timeProvider.GetUtcNow());

        return storage.ExecuteInTransaction(unitOfWork =>
        {
            // Legacy in-process callers allocate their envelope under the same writer
            // gate. This also works with non-seekable input and cannot lose a retry.
            var envelope = requestedEnvelope ?? new ProjectCommandEnvelope(
                Guid.NewGuid(),
                ReadRevision(unitOfWork, projectId));
            // Replay must be examined before revision validation: the accepted
            // command can be retried after any number of later project edits.
            var replay = ReadCommand(unitOfWork, envelope.CommandId);
            if (replay is not null)
            {
                if (replay.ProjectId != projectId.Value ||
                    replay.ExpectedRevision != envelope.ExpectedRevision ||
                    !string.Equals(replay.CommandType, AttachmentCommandType, StringComparison.Ordinal) ||
                    !string.Equals(replay.RequestSha256, requestHash, StringComparison.Ordinal) ||
                    !string.Equals(replay.RequestJson, canonicalRequest, StringComparison.Ordinal))
                {
                    throw new ProjectCommandException(
                        "command_id_reused",
                        "The command ID was already used for a different project mutation.",
                        ReadRevisionOrNull(unitOfWork, projectId));
                }

                var original = JsonSerializer.Deserialize<ProjectAttachment>(
                    replay.ResultJson,
                    JournalJsonOptions)
                    ?? throw new InvalidDataException("The stored attachment command result is invalid.");
                return new ProjectMutationResult<ProjectAttachment>(
                    envelope.CommandId,
                    envelope.ExpectedRevision,
                    replay.ResultingRevision,
                    original);
            }

            var currentRevision = ReadRevision(unitOfWork, projectId);
            if (currentRevision != envelope.ExpectedRevision)
            {
                throw new ProjectCommandException(
                    "revision_conflict",
                    $"Expected project revision {envelope.ExpectedRevision}, but current revision is {currentRevision}.",
                    currentRevision,
                    "expectedRevision");
            }
            if (currentRevision == long.MaxValue)
            {
                throw new ProjectCommandException(
                    "revision_limit_reached",
                    "The project revision cannot be incremented.",
                    currentRevision);
            }

            InsertOrValidateBlob(unitOfWork, content, attachment.CreatedUtc);
            using var insert = unitOfWork.CreateCommand(
                """
                INSERT INTO project_attachments (
                    attachment_id,
                    project_id,
                    content_sha256,
                    file_name,
                    media_type,
                    purpose,
                    created_utc)
                VALUES (
                    $attachmentId,
                    $projectId,
                    $contentSha256,
                    $fileName,
                    $mediaType,
                    $purpose,
                    $createdUtc);
                """);
            insert.Parameters.AddWithValue("$attachmentId", Format(attachment.AttachmentId.Value));
            insert.Parameters.AddWithValue("$projectId", Format(projectId.Value));
            insert.Parameters.AddWithValue("$contentSha256", content.Sha256);
            insert.Parameters.AddWithValue("$fileName", attachment.FileName);
            insert.Parameters.AddWithValue("$mediaType", attachment.MediaType);
            insert.Parameters.AddWithValue("$purpose", attachment.Purpose);
            insert.Parameters.AddWithValue(
                "$createdUtc",
                attachment.CreatedUtc.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture));
            insert.ExecuteNonQuery();
            commandProgressHook?.Invoke("after_attachment_reference");
            var now = FormatUtc(attachment.CreatedUtc);
            var resultingRevision = IncrementRevision(unitOfWork, projectId, envelope.ExpectedRevision, now);
            var resultJson = JsonSerializer.Serialize(attachment, JournalJsonOptions);
            InsertCommand(
                unitOfWork,
                projectId,
                envelope,
                resultingRevision,
                canonicalRequest,
                requestHash,
                resultJson,
                now);
            commandProgressHook?.Invoke("after_journal");
            return new ProjectMutationResult<ProjectAttachment>(
                envelope.CommandId,
                envelope.ExpectedRevision,
                resultingRevision,
                attachment);
        });
    }

    public IReadOnlyList<ProjectAttachment> List(ProjectIdentity projectId)
    {
        ValidateProjectId(projectId);
        return storage.ExecuteRead(unitOfWork =>
        {
            EnsureProjectExists(unitOfWork, projectId);
            using var command = unitOfWork.CreateCommand(
                """
                SELECT pa.attachment_id,
                       pa.content_sha256,
                       b.size_bytes,
                       pa.file_name,
                       pa.media_type,
                       pa.purpose,
                       pa.created_utc
                FROM project_attachments pa
                JOIN attachment_blobs b ON b.content_sha256 = pa.content_sha256
                WHERE pa.project_id = $projectId
                ORDER BY pa.created_utc, pa.attachment_id;
                """);
            command.Parameters.AddWithValue("$projectId", Format(projectId.Value));
            using var reader = command.ExecuteReader();
            var attachments = new List<ProjectAttachment>();
            while (reader.Read())
            {
                attachments.Add(ReadAttachment(reader, projectId));
            }

            return attachments;
        });
    }

    public async Task ValidateAsync(
        ProjectIdentity projectId,
        AttachmentIdentity attachmentId,
        CancellationToken cancellationToken = default)
    {
        var attachment = Get(projectId, attachmentId);
        await contentStore.ValidateAsync(attachment.Content, cancellationToken).ConfigureAwait(false);
    }

    public async Task<Stream> OpenReadVerifiedAsync(
        ProjectIdentity projectId,
        AttachmentIdentity attachmentId,
        CancellationToken cancellationToken = default)
    {
        var attachment = Get(projectId, attachmentId);
        return await contentStore.OpenReadVerifiedAsync(attachment.Content, cancellationToken)
            .ConfigureAwait(false);
    }

    private ProjectAttachment Get(ProjectIdentity projectId, AttachmentIdentity attachmentId)
    {
        ValidateProjectId(projectId);
        if (attachmentId.Value == Guid.Empty)
        {
            throw Invalid("invalid_attachment_id", "The attachment ID is invalid.", "attachmentId");
        }

        return storage.ExecuteRead(unitOfWork =>
        {
            EnsureProjectExists(unitOfWork, projectId);
            using var command = unitOfWork.CreateCommand(
                """
                SELECT pa.attachment_id,
                       pa.content_sha256,
                       b.size_bytes,
                       pa.file_name,
                       pa.media_type,
                       pa.purpose,
                       pa.created_utc
                FROM project_attachments pa
                JOIN attachment_blobs b ON b.content_sha256 = pa.content_sha256
                WHERE pa.project_id = $projectId AND pa.attachment_id = $attachmentId;
                """);
            command.Parameters.AddWithValue("$projectId", Format(projectId.Value));
            command.Parameters.AddWithValue("$attachmentId", Format(attachmentId.Value));
            using var reader = command.ExecuteReader();
            if (!reader.Read())
            {
                throw new ProjectAttachmentException(
                    "attachment_not_found",
                    "The attachment does not exist in this project.");
            }

            return ReadAttachment(reader, projectId);
        });
    }

    private static ProjectAttachment ReadAttachment(
        Microsoft.Data.Sqlite.SqliteDataReader reader,
        ProjectIdentity projectId) =>
        new(
            new AttachmentIdentity(Guid.ParseExact(reader.GetString(0), "D")),
            projectId,
            new AttachmentContent(reader.GetString(1), reader.GetInt64(2)),
            reader.GetString(3),
            reader.GetString(4),
            reader.GetString(5),
            DateTimeOffset.ParseExact(
                reader.GetString(6),
                "O",
                CultureInfo.InvariantCulture,
                DateTimeStyles.RoundtripKind));

    private static void InsertOrValidateBlob(
        SqliteUnitOfWork unitOfWork,
        AttachmentContent content,
        DateTimeOffset createdUtc)
    {
        using (var insert = unitOfWork.CreateCommand(
                   """
                   INSERT INTO attachment_blobs (content_sha256, size_bytes, created_utc)
                   VALUES ($contentSha256, $sizeBytes, $createdUtc)
                   ON CONFLICT (content_sha256) DO NOTHING;
                   """))
        {
            insert.Parameters.AddWithValue("$contentSha256", content.Sha256);
            insert.Parameters.AddWithValue("$sizeBytes", content.SizeBytes);
            insert.Parameters.AddWithValue(
                "$createdUtc",
                createdUtc.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture));
            insert.ExecuteNonQuery();
        }

        using var check = unitOfWork.CreateCommand(
            "SELECT size_bytes FROM attachment_blobs WHERE content_sha256 = $contentSha256;");
        check.Parameters.AddWithValue("$contentSha256", content.Sha256);
        var storedSize = Convert.ToInt64(check.ExecuteScalar(), CultureInfo.InvariantCulture);
        if (storedSize != content.SizeBytes)
        {
            throw new InvalidDataException(
                $"Attachment metadata for '{content.Sha256}' has a conflicting length.");
        }
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

    private static StoredCommand? ReadCommand(SqliteUnitOfWork unitOfWork, Guid commandId)
    {
        using var command = unitOfWork.CreateCommand(
            """
            SELECT project_id, expected_revision, resulting_revision, command_type,
                   request_json, request_sha256, result_json, result_sha256
            FROM project_commands
            WHERE command_id = $commandId;
            """);
        command.Parameters.AddWithValue("$commandId", Format(commandId));
        using var reader = command.ExecuteReader();
        if (!reader.Read())
        {
            return null;
        }

        var stored = new StoredCommand(
            Guid.ParseExact(reader.GetString(0), "D"),
            reader.GetInt64(1),
            reader.GetInt64(2),
            reader.GetString(3),
            reader.GetString(4),
            reader.GetString(5),
            reader.GetString(6),
            reader.GetString(7));
        if (!string.Equals(stored.RequestSha256, Sha256(stored.RequestJson), StringComparison.Ordinal) ||
            !string.Equals(stored.ResultSha256, Sha256(stored.ResultJson), StringComparison.Ordinal))
        {
            throw new InvalidDataException("The stored attachment command journal is corrupt.");
        }

        return stored;
    }

    private static void InsertCommand(
        SqliteUnitOfWork unitOfWork,
        ProjectIdentity projectId,
        ProjectCommandEnvelope envelope,
        long resultingRevision,
        string requestJson,
        string requestHash,
        string resultJson,
        string acceptedUtc)
    {
        using (var journal = unitOfWork.CreateCommand(
                   """
                   INSERT INTO project_commands (
                       command_id, project_id, expected_revision, resulting_revision,
                       command_type, request_schema_version, request_json, request_sha256,
                       result_schema_version, result_json, result_sha256, accepted_utc)
                   VALUES (
                       $commandId, $projectId, $expectedRevision, $resultingRevision,
                       $commandType, $schemaVersion, $requestJson, $requestSha256,
                       $schemaVersion, $resultJson, $resultSha256, $acceptedUtc);
                   """))
        {
            journal.Parameters.AddWithValue("$commandId", Format(envelope.CommandId));
            journal.Parameters.AddWithValue("$projectId", Format(projectId.Value));
            journal.Parameters.AddWithValue("$expectedRevision", envelope.ExpectedRevision);
            journal.Parameters.AddWithValue("$resultingRevision", resultingRevision);
            journal.Parameters.AddWithValue("$commandType", AttachmentCommandType);
            journal.Parameters.AddWithValue("$schemaVersion", JournalPayloadSchemaVersion);
            journal.Parameters.AddWithValue("$requestJson", requestJson);
            journal.Parameters.AddWithValue("$requestSha256", requestHash);
            journal.Parameters.AddWithValue("$resultJson", resultJson);
            journal.Parameters.AddWithValue("$resultSha256", Sha256(resultJson));
            journal.Parameters.AddWithValue("$acceptedUtc", acceptedUtc);
            journal.ExecuteNonQuery();
        }

        using var version = unitOfWork.CreateCommand(
            """
            INSERT INTO project_versions (project_id, revision, command_id, cause, committed_utc)
            VALUES ($projectId, $revision, $commandId, $cause, $committedUtc);
            """);
        version.Parameters.AddWithValue("$projectId", Format(projectId.Value));
        version.Parameters.AddWithValue("$revision", resultingRevision);
        version.Parameters.AddWithValue("$commandId", Format(envelope.CommandId));
        version.Parameters.AddWithValue("$cause", AttachmentCommandType);
        version.Parameters.AddWithValue("$committedUtc", acceptedUtc);
        version.ExecuteNonQuery();
    }

    private static long IncrementRevision(
        SqliteUnitOfWork unitOfWork,
        ProjectIdentity projectId,
        long expectedRevision,
        string updatedUtc)
    {
        using var command = unitOfWork.CreateCommand(
            """
            UPDATE projects
            SET revision = revision + 1, updated_utc = $updatedUtc
            WHERE project_id = $projectId AND revision = $expectedRevision
            RETURNING revision;
            """);
        command.Parameters.AddWithValue("$updatedUtc", updatedUtc);
        command.Parameters.AddWithValue("$projectId", Format(projectId.Value));
        command.Parameters.AddWithValue("$expectedRevision", expectedRevision);
        var value = command.ExecuteScalar();
        if (value is null)
        {
            var currentRevision = ReadRevision(unitOfWork, projectId);
            throw new ProjectCommandException(
                "revision_conflict",
                "The project changed while the attachment command was being accepted.",
                currentRevision,
                "expectedRevision");
        }

        return Convert.ToInt64(value, CultureInfo.InvariantCulture);
    }

    private static long ReadRevision(SqliteUnitOfWork unitOfWork, ProjectIdentity projectId) =>
        ReadRevisionOrNull(unitOfWork, projectId)
        ?? throw new ProjectCatalogException("project_not_found", "The project does not exist.");

    private static long? ReadRevisionOrNull(
        SqliteUnitOfWork unitOfWork,
        ProjectIdentity projectId)
    {
        using var command = unitOfWork.CreateCommand(
            "SELECT revision FROM projects WHERE project_id = $projectId;");
        command.Parameters.AddWithValue("$projectId", Format(projectId.Value));
        var value = command.ExecuteScalar();
        return value is null ? null : Convert.ToInt64(value, CultureInfo.InvariantCulture);
    }

    private static string NormalizeFileName(string value)
    {
        var normalized = NormalizeText(value, 255, "fileName");
        if (!string.Equals(Path.GetFileName(normalized), normalized, StringComparison.Ordinal) ||
            normalized is "." or ".." ||
            normalized.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0)
        {
            throw Invalid("invalid_file_name", "The attachment file name is invalid.", "fileName");
        }

        return normalized;
    }

    private static string NormalizeToken(
        string value,
        int maximumLength,
        string field,
        bool allowSlash)
    {
        var normalized = NormalizeText(value, maximumLength, field).ToLowerInvariant();
        var slashCount = normalized.Count(character => character == '/');
        var slashIndex = normalized.IndexOf('/');
        if ((allowSlash &&
                (slashCount != 1 || slashIndex == 0 || slashIndex == normalized.Length - 1)) ||
            (!allowSlash && slashCount != 0) ||
            normalized.Any(character =>
                character is not (>= 'a' and <= 'z') and
                    not (>= '0' and <= '9') and
                    not '.' and not '_' and not '-' and not '+' and not '/'))
        {
            var code = field == "mediaType" ? "invalid_media_type" : $"invalid_{field}";
            throw Invalid(code, $"The attachment {field} is invalid.", field);
        }

        return normalized;
    }

    private static string NormalizeText(string value, int maximumLength, string field)
    {
        if (value is null)
        {
            throw Invalid($"invalid_{field}", $"The attachment {field} is required.", field);
        }

        var normalized = value.Trim().Normalize(NormalizationForm.FormC);
        if (normalized.Length is 0 || normalized.Length > maximumLength || normalized.Any(char.IsControl))
        {
            throw Invalid($"invalid_{field}", $"The attachment {field} is invalid.", field);
        }

        return normalized;
    }

    private static void ValidateProjectId(ProjectIdentity projectId)
    {
        if (projectId.Value == Guid.Empty)
        {
            throw Invalid("invalid_project_id", "The project ID is invalid.", "projectId");
        }
    }

    private static void ValidateEnvelope(ProjectCommandEnvelope envelope)
    {
        if (envelope.CommandId == Guid.Empty)
        {
            throw new ProjectCatalogException(
                "invalid_command_id",
                "The command ID must be a non-empty UUID.",
                "commandId");
        }

        if (envelope.ExpectedRevision < 0)
        {
            throw new ProjectCatalogException(
                "invalid_expected_revision",
                "The expected revision must not be negative.",
                "expectedRevision");
        }
    }

    private static string Sha256(string value) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();

    private static string FormatUtc(DateTimeOffset value) =>
        value.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture);

    private static ProjectAttachmentException Invalid(string code, string message, string? field = null) =>
        new(code, message, field);

    private static string Format(Guid value) => value.ToString("D", CultureInfo.InvariantCulture);

    private sealed record StoredCommand(
        Guid ProjectId,
        long ExpectedRevision,
        long ResultingRevision,
        string CommandType,
        string RequestJson,
        string RequestSha256,
        string ResultJson,
        string ResultSha256);
}
