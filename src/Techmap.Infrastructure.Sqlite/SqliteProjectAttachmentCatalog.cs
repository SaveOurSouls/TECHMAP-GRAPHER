using System.Globalization;
using System.Text;
using Techmap.Application;
using Techmap.Domain;

namespace Techmap.Infrastructure.Sqlite;

public sealed class SqliteProjectAttachmentCatalog(
    SqliteStorage storage,
    IAttachmentContentStore contentStore,
    TimeProvider timeProvider) : IProjectAttachmentCatalog
{
    public async Task<ProjectAttachment> AddAsync(
        ProjectIdentity projectId,
        Stream source,
        string fileName,
        string mediaType,
        string purpose,
        CancellationToken cancellationToken = default)
    {
        ValidateProjectId(projectId);
        ArgumentNullException.ThrowIfNull(source);
        var normalizedFileName = NormalizeFileName(fileName);
        var normalizedMediaType = NormalizeToken(mediaType, 127, "mediaType", allowSlash: true);
        var normalizedPurpose = NormalizeToken(purpose, 64, "purpose", allowSlash: false);

        // Immutable content is published first. If the following SQLite transaction fails,
        // it remains an unreferenced safe orphan and is invisible to project reads.
        var content = await contentStore.WriteAsync(source, cancellationToken).ConfigureAwait(false);
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
            EnsureProjectExists(unitOfWork, projectId);
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
            TouchProject(unitOfWork, projectId, attachment.CreatedUtc);
            return attachment;
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

    private static ProjectAttachmentException Invalid(string code, string message, string? field = null) =>
        new(code, message, field);

    private static string Format(Guid value) => value.ToString("D", CultureInfo.InvariantCulture);
}
