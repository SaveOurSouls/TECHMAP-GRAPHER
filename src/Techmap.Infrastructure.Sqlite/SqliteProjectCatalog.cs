using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using Techmap.Application;
using Techmap.Domain;

namespace Techmap.Infrastructure.Sqlite;

public sealed class SqliteProjectCatalog : IProjectCatalog, IProjectVersionCatalog
{
    private const int JournalPayloadSchemaVersion = 2;
    private static readonly JsonSerializerOptions JournalJsonOptions = new(JsonSerializerDefaults.Web);
    private readonly SqliteStorage storage;
    private readonly Action<string>? commandProgressHook;

    public SqliteProjectCatalog(SqliteStorage storage, Action<string>? commandProgressHook = null)
    {
        this.storage = storage;
        this.commandProgressHook = commandProgressHook;
    }

    public IReadOnlyList<ProjectSummary> ListProjects() =>
        storage.ExecuteRead(unitOfWork =>
        {
            using var command = unitOfWork.CreateCommand(
                """
                SELECT p.project_id, p.designation, p.project_increment, p.name,
                       p.batch_quantity, p.status, p.revision, p.created_utc, p.updated_utc,
                       COUNT(h.harness_id)
                FROM projects p
                LEFT JOIN harnesses h ON h.project_id = p.project_id
                GROUP BY p.project_id
                ORDER BY p.project_increment DESC, p.project_id;
                """);
            using var reader = command.ExecuteReader();
            var projects = new List<ProjectSummary>();
            while (reader.Read())
            {
                projects.Add(new ProjectSummary(
                    ReadProjectId(reader, 0),
                    reader.GetString(1),
                    reader.GetInt64(2),
                    reader.GetString(3),
                    Math.Min(reader.GetInt64(4), ProjectRules.MaximumHarnessQuantity),
                    ReadStatus(reader.GetString(5)),
                    reader.GetInt64(6),
                    reader.GetInt32(9),
                    ReadTimestamp(reader.GetString(7)),
                    ReadTimestamp(reader.GetString(8))));
            }

            return projects;
        });

    public ProjectDetails GetProject(ProjectIdentity projectId)
    {
        ValidateProjectId(projectId);
        return storage.ExecuteRead(unitOfWork => ReadProject(unitOfWork, projectId));
    }

    public void DeleteProject(ProjectIdentity projectId, long expectedRevision)
    {
        ValidateProjectId(projectId);
        if (expectedRevision < 0) throw Invalid("invalid_expected_revision", "Expected revision must be non-negative.");
        storage.ExecuteInTransaction(unitOfWork =>
        {
            var currentRevision = ReadCurrentRevision(unitOfWork, projectId);
            if (currentRevision != expectedRevision)
                throw new ProjectCommandException("revision_conflict", "Project changed before deletion.", currentRevision);
            // Cascades remove the project-owned graph in one transaction. Defer
            // cross-references between its immutable journals until commit.
            using var defer = unitOfWork.CreateCommand("PRAGMA defer_foreign_keys = ON;");
            defer.ExecuteNonQuery();
            using var delete = unitOfWork.CreateCommand("DELETE FROM projects WHERE project_id = $projectId;");
            delete.Parameters.AddWithValue("$projectId", Format(projectId.Value));
            delete.ExecuteNonQuery();
            commandProgressHook?.Invoke("after_delete_project");
            return true;
        });
    }

    public ProjectDetails CreateProject(CreateProjectCommand command)
    {
        ArgumentNullException.ThrowIfNull(command);
        var normalized = Normalize(command);
        return storage.ExecuteInTransaction(unitOfWork =>
        {
            var projectId = ProjectIdentity.New();
            var increment = AllocateIncrement(unitOfWork);
            var now = UtcNowText();
            InsertProject(unitOfWork, projectId, increment, normalized, now);
            return ReadProject(unitOfWork, projectId);
        });
    }

    public ProjectDetails UpdateProject(ProjectIdentity projectId, UpdateProjectCommand command)
    {
        while (true)
        {
            var revision = GetProject(projectId).Revision;
            try
            {
                return UpdateProject(
                    projectId,
                    new ProjectCommandEnvelope(Guid.NewGuid(), revision),
                    command).Value;
            }
            catch (ProjectCommandException error) when (error.Code == "revision_conflict")
            {
                // Compatibility wrapper for pre-M1-06 in-process callers.
            }
        }
    }

    public ProjectMutationResult<ProjectDetails> UpdateProject(
        ProjectIdentity projectId,
        ProjectCommandEnvelope envelope,
        UpdateProjectCommand command)
    {
        ValidateProjectId(projectId);
        ArgumentNullException.ThrowIfNull(command);
        if (command.Designation is null &&
            command.Name is null &&
            command.BatchQuantity is null &&
            command.Status is null)
        {
            throw Invalid("invalid_request", "At least one project field must be supplied.");
        }

        var designation = command.Designation is null
            ? null
            : NormalizeDesignation(command.Designation, "designation");
        var name = command.Name is null ? null : NormalizeName(command.Name, "name");
        long? batchQuantity = command.BatchQuantity is null
            ? null
            : ValidateBatchQuantity(command.BatchQuantity.Value);
        if (command.Status is not null)
        {
            ValidateStatus(command.Status.Value);
        }

        var statusCode = command.Status is null ? null : ProjectRules.ToCode(command.Status.Value);
        var canonicalRequest = JsonSerializer.Serialize(new
        {
            designation,
            name,
            batchQuantity,
            status = statusCode,
        }, JournalJsonOptions);
        return ExecuteProjectCommand(
            projectId,
            envelope,
            "update_project",
            canonicalRequest,
            (unitOfWork, now) =>
        {
            using var update = unitOfWork.CreateCommand(
                """
                UPDATE projects
                SET designation = COALESCE($designation, designation),
                    name = COALESCE($name, name),
                    batch_quantity = COALESCE($batchQuantity, batch_quantity),
                    status = COALESCE($status, status),
                    updated_utc = $updatedUtc
                WHERE project_id = $projectId;
                """);
            update.Parameters.AddWithValue("$designation", DbValue(designation));
            update.Parameters.AddWithValue("$name", DbValue(name));
            update.Parameters.AddWithValue("$batchQuantity", DbValue(batchQuantity));
            update.Parameters.AddWithValue("$status", DbValue(statusCode));
            update.Parameters.AddWithValue("$updatedUtc", now);
            update.Parameters.AddWithValue("$projectId", Format(projectId.Value));
            if (update.ExecuteNonQuery() != 1)
            {
                throw NotFound("project_not_found", "The project does not exist.");
            }

            return ReadProject(unitOfWork, projectId);
        });
    }

    public ProjectDetails CopyProject(ProjectIdentity sourceProjectId)
    {
        ValidateProjectId(sourceProjectId);
        return storage.ExecuteInTransaction(unitOfWork =>
        {
            var source = ReadProject(unitOfWork, sourceProjectId);
            var destinationId = ProjectIdentity.New();
            var increment = AllocateIncrement(unitOfWork);
            var now = UtcNowText();
            InsertProject(
                unitOfWork,
                destinationId,
                increment,
                new CreateProjectCommand(
                    source.Designation,
                    source.Name,
                    source.BatchQuantity,
                    ProjectStatus.Active),
                now);

            foreach (var harness in source.Harnesses)
            {
                var destinationHarnessId = HarnessIdentity.New();
                InsertHarness(
                    unitOfWork,
                    destinationHarnessId,
                    destinationId,
                    harness.Designation,
                    harness.Quantity,
                    harness.SortOrder,
                    now);
                CopyHarnessDesign(unitOfWork, harness.HarnessId, destinationHarnessId, now);
            }

            CopyAttachments(unitOfWork, sourceProjectId, destinationId, now);
            CopyPinnedCharacteristics(unitOfWork, sourceProjectId, destinationId);
            CopyComponentSnapshotsAndPlacements(
                unitOfWork, sourceProjectId, destinationId, source.Harnesses, now);

            return ReadProject(unitOfWork, destinationId);
        });
    }

    public ProjectDetails AddHarness(ProjectIdentity projectId, string designation, long quantity = 1)
    {
        while (true)
        {
            var revision = GetProject(projectId).Revision;
            try
            {
                return AddHarness(
                    projectId,
                    new ProjectCommandEnvelope(Guid.NewGuid(), revision),
                    designation,
                    quantity).Value;
            }
            catch (ProjectCommandException error) when (error.Code == "revision_conflict")
            {
                // Compatibility wrapper for pre-M1-06 in-process callers.
            }
        }
    }

    public ProjectMutationResult<ProjectDetails> AddHarness(
        ProjectIdentity projectId,
        ProjectCommandEnvelope envelope,
        string designation,
        long? quantity = 1)
    {
        ValidateProjectId(projectId);
        var normalizedDesignation = NormalizeDesignation(designation, "designation");
        long? normalizedQuantity = quantity is null ? null : ValidateHarnessQuantity(quantity.Value);
        var legacyCanonicalRequest = JsonSerializer.Serialize(new
        {
            designation = normalizedDesignation,
        }, JournalJsonOptions);
        var canonicalRequest = normalizedQuantity is null
            ? legacyCanonicalRequest
            : JsonSerializer.Serialize(new
            {
                designation = normalizedDesignation,
                quantity = normalizedQuantity.Value,
            }, JournalJsonOptions);
        return ExecuteProjectCommand(
            projectId,
            envelope,
            "add_harness",
            canonicalRequest,
            (unitOfWork, now) =>
        {
            using var state = unitOfWork.CreateCommand(
                """
                SELECT COUNT(*), COALESCE(MAX(sort_order), -1) + 1
                FROM harnesses
                WHERE project_id = $projectId;
                """);
            state.Parameters.AddWithValue("$projectId", Format(projectId.Value));
            using var reader = state.ExecuteReader();
            if (!reader.Read())
            {
                throw new InvalidDataException("The harness aggregate state is unavailable.");
            }

            var count = reader.GetInt32(0);
            var sortOrder = reader.GetInt32(1);
            if (count >= ProjectRules.MaximumHarnesses)
            {
                throw new ProjectCatalogException(
                    "harness_limit_reached",
                    $"A project cannot contain more than {ProjectRules.MaximumHarnesses} harnesses.");
            }

            reader.Close();
            try
            {
                if (normalizedQuantity is null)
                {
                    throw Invalid(
                        "invalid_harness_quantity",
                        "The harness quantity is required.",
                        "quantity");
                }

                InsertHarness(
                    unitOfWork,
                    HarnessIdentity.New(),
                    projectId,
                    normalizedDesignation,
                    normalizedQuantity.Value,
                    sortOrder,
                    now);
            }
            catch (SqliteException error) when (
                error.SqliteErrorCode == 19 &&
                error.Message.Contains("harness_limit_reached", StringComparison.Ordinal))
            {
                throw new ProjectCatalogException(
                    "harness_limit_reached",
                    $"A project cannot contain more than {ProjectRules.MaximumHarnesses} harnesses.");
            }

            TouchProject(unitOfWork, projectId, now);
            return ReadProject(unitOfWork, projectId);
        }, normalizedQuantity is null ? legacyCanonicalRequest : null);
    }

    public ProjectDetails UpdateHarnessQuantity(
        ProjectIdentity projectId,
        HarnessIdentity harnessId,
        long quantity)
    {
        while (true)
        {
            var revision = GetProject(projectId).Revision;
            try
            {
                return UpdateHarnessQuantity(
                    projectId,
                    harnessId,
                    new ProjectCommandEnvelope(Guid.NewGuid(), revision),
                    quantity).Value;
            }
            catch (ProjectCommandException error) when (error.Code == "revision_conflict")
            {
                // Compatibility wrapper for in-process callers.
            }
        }
    }

    public ProjectMutationResult<ProjectDetails> UpdateHarnessQuantity(
        ProjectIdentity projectId,
        HarnessIdentity harnessId,
        ProjectCommandEnvelope envelope,
        long quantity)
    {
        ValidateProjectId(projectId);
        if (harnessId.Value == Guid.Empty)
        {
            throw Invalid("invalid_harness_id", "The harness ID is invalid.", "harnessId");
        }

        var normalizedQuantity = ValidateHarnessQuantity(quantity);
        var canonicalRequest = JsonSerializer.Serialize(new
        {
            harnessId = Format(harnessId.Value),
            quantity = normalizedQuantity,
        }, JournalJsonOptions);
        return ExecuteProjectCommand(
            projectId,
            envelope,
            "update_harness_quantity",
            canonicalRequest,
            (unitOfWork, now) =>
            {
                using var update = unitOfWork.CreateCommand(
                    """
                    UPDATE harnesses
                    SET quantity = $quantity, updated_utc = $updatedUtc
                    WHERE project_id = $projectId AND harness_id = $harnessId;
                    """);
                update.Parameters.AddWithValue("$quantity", normalizedQuantity);
                update.Parameters.AddWithValue("$updatedUtc", now);
                update.Parameters.AddWithValue("$projectId", Format(projectId.Value));
                update.Parameters.AddWithValue("$harnessId", Format(harnessId.Value));
                if (update.ExecuteNonQuery() != 1)
                {
                    throw NotFound("harness_not_found", "The harness does not exist in this project.");
                }

                TouchProject(unitOfWork, projectId, now);
                return ReadProject(unitOfWork, projectId);
            });
    }

    public ProjectDetails DeleteHarness(ProjectIdentity projectId, HarnessIdentity harnessId)
    {
        while (true)
        {
            var revision = GetProject(projectId).Revision;
            try
            {
                return DeleteHarness(
                    projectId,
                    new ProjectCommandEnvelope(Guid.NewGuid(), revision),
                    harnessId).Value;
            }
            catch (ProjectCommandException error) when (error.Code == "revision_conflict")
            {
                // Compatibility wrapper for pre-M1-06 in-process callers.
            }
        }
    }

    public ProjectMutationResult<ProjectDetails> DeleteHarness(
        ProjectIdentity projectId,
        ProjectCommandEnvelope envelope,
        HarnessIdentity harnessId)
    {
        ValidateProjectId(projectId);
        if (harnessId.Value == Guid.Empty)
        {
            throw Invalid("invalid_harness_id", "The harness ID is invalid.", "harnessId");
        }

        var canonicalRequest = JsonSerializer.Serialize(new
        {
            harnessId = Format(harnessId.Value),
        }, JournalJsonOptions);
        return ExecuteProjectCommand(
            projectId,
            envelope,
            "delete_harness",
            canonicalRequest,
            (unitOfWork, now) =>
        {
            using var delete = unitOfWork.CreateCommand(
                "DELETE FROM harnesses WHERE project_id = $projectId AND harness_id = $harnessId;");
            delete.Parameters.AddWithValue("$projectId", Format(projectId.Value));
            delete.Parameters.AddWithValue("$harnessId", Format(harnessId.Value));
            if (delete.ExecuteNonQuery() != 1)
            {
                throw NotFound("harness_not_found", "The harness does not exist in this project.");
            }

            TouchProject(unitOfWork, projectId, now);
            return ReadProject(unitOfWork, projectId);
        });
    }

    public IReadOnlyList<ProjectVersionEntry> ListVersions(ProjectIdentity projectId)
    {
        ValidateProjectId(projectId);
        return storage.ExecuteRead(unitOfWork =>
        {
            EnsureProjectExists(unitOfWork, projectId);
            using var command = unitOfWork.CreateCommand(
                """
                SELECT revision, command_id, cause, committed_utc
                FROM project_versions
                WHERE project_id = $projectId
                ORDER BY revision;
                """);
            command.Parameters.AddWithValue("$projectId", Format(projectId.Value));
            using var reader = command.ExecuteReader();
            var versions = new List<ProjectVersionEntry>();
            while (reader.Read())
            {
                versions.Add(new ProjectVersionEntry(
                    reader.GetInt64(0),
                    ReadGuid(reader.GetString(1), "command"),
                    reader.GetString(2),
                    ReadTimestamp(reader.GetString(3))));
            }

            return versions;
        });
    }

    private ProjectMutationResult<ProjectDetails> ExecuteProjectCommand(
        ProjectIdentity projectId,
        ProjectCommandEnvelope envelope,
        string commandType,
        string canonicalRequest,
        Func<SqliteUnitOfWork, string, ProjectDetails> mutation,
        string? legacyCanonicalRequest = null)
    {
        ValidateEnvelope(envelope);
        var requestHash = Sha256(canonicalRequest);
        return storage.ExecuteInTransaction(unitOfWork =>
        {
            var replay = ReadCommand(unitOfWork, envelope.CommandId);
            if (replay is not null)
            {
                var requestMatches =
                    replay.RequestSchemaVersion == JournalPayloadSchemaVersion &&
                        string.Equals(replay.RequestJson, canonicalRequest, StringComparison.Ordinal) ||
                    replay.RequestSchemaVersion == 1 &&
                        (string.Equals(replay.RequestJson, canonicalRequest, StringComparison.Ordinal) ||
                         legacyCanonicalRequest is not null &&
                            string.Equals(replay.RequestJson, legacyCanonicalRequest, StringComparison.Ordinal));
                if (replay.ProjectId != projectId.Value ||
                    replay.ExpectedRevision != envelope.ExpectedRevision ||
                    !string.Equals(replay.CommandType, commandType, StringComparison.Ordinal) ||
                    !requestMatches)
                {
                    throw new ProjectCommandException(
                        "command_id_reused",
                        "The command ID was already used for a different project mutation.",
                        ReadCurrentRevisionOrNull(unitOfWork, projectId));
                }

                var storedProject = ReadStoredProject(replay);
                return new ProjectMutationResult<ProjectDetails>(
                    envelope.CommandId,
                    envelope.ExpectedRevision,
                    replay.ResultingRevision,
                    storedProject);
            }

            var currentRevision = ReadCurrentRevision(unitOfWork, projectId);
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

            var now = UtcNowText();
            var project = mutation(unitOfWork, now);
            commandProgressHook?.Invoke("after_mutation");
            var resultingRevision = IncrementRevision(
                unitOfWork,
                projectId,
                envelope.ExpectedRevision,
                now);
            project = project with { Revision = resultingRevision, UpdatedUtc = ReadTimestamp(now) };
            var resultJson = JsonSerializer.Serialize(project, JournalJsonOptions);
            InsertCommand(
                unitOfWork,
                projectId,
                envelope,
                resultingRevision,
                commandType,
                canonicalRequest,
                requestHash,
                resultJson,
                now);
            commandProgressHook?.Invoke("after_journal");
            return new ProjectMutationResult<ProjectDetails>(
                envelope.CommandId,
                envelope.ExpectedRevision,
                resultingRevision,
                project);
        });
    }

    private static StoredCommand? ReadCommand(SqliteUnitOfWork unitOfWork, Guid commandId)
    {
        using var command = unitOfWork.CreateCommand(
            """
            SELECT project_id, expected_revision, resulting_revision, command_type,
                   request_schema_version, request_json, request_sha256,
                   result_schema_version, result_json, result_sha256
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
            ReadGuid(reader.GetString(0), "project"),
            reader.GetInt64(1),
            reader.GetInt64(2),
            reader.GetString(3),
            reader.GetInt32(4),
            reader.GetString(5),
            reader.GetString(6),
            reader.GetInt32(7),
            reader.GetString(8),
            reader.GetString(9));
        if (!string.Equals(stored.RequestSha256, Sha256(stored.RequestJson), StringComparison.Ordinal) ||
            !string.Equals(stored.ResultSha256, Sha256(stored.ResultJson), StringComparison.Ordinal))
        {
            throw new InvalidDataException("A stored project command failed integrity validation.");
        }

        return stored;
    }

    private static ProjectDetails ReadStoredProject(StoredCommand replay)
    {
        var storedProject = JsonSerializer.Deserialize<ProjectDetails>(
            replay.ResultJson,
            JournalJsonOptions)
            ?? throw new InvalidDataException("The stored project command result is invalid.");
        if (replay.ResultSchemaVersion == JournalPayloadSchemaVersion)
        {
            if (storedProject.Revision != replay.ResultingRevision ||
                storedProject.Harnesses.Any(harness =>
                    harness.Quantity <= 0 || harness.Documents is null || harness.Documents.Count != 3))
            {
                throw new InvalidDataException("The stored project command result is inconsistent.");
            }

            return storedProject;
        }

        if (replay.ResultSchemaVersion != 1)
        {
            throw new InvalidDataException("The stored project command result schema is unsupported.");
        }

        var legacyHarnessQuantity = Math.Min(
            storedProject.BatchQuantity,
            ProjectRules.MaximumHarnessQuantity);
        var harnesses = storedProject.Harnesses.Select(harness => harness with
        {
            Quantity = legacyHarnessQuantity,
            Documents = new[] { "e4", "drawing", "route" }.Select(kind =>
                new HarnessDocumentSummary(
                    new HarnessDocumentIdentity(DeterministicGuid(harness.HarnessId.Value, "journal-document", kind)),
                    kind,
                    "empty",
                    harness.CreatedUtc,
                    harness.UpdatedUtc)).ToArray(),
        }).ToArray();
        return storedProject with
        {
            BatchQuantity = legacyHarnessQuantity,
            Revision = replay.ResultingRevision,
            Harnesses = harnesses,
        };
    }

    private static void InsertCommand(
        SqliteUnitOfWork unitOfWork,
        ProjectIdentity projectId,
        ProjectCommandEnvelope envelope,
        long resultingRevision,
        string commandType,
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
            journal.Parameters.AddWithValue("$commandType", commandType);
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
        version.Parameters.AddWithValue("$cause", commandType);
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
            var currentRevision = ReadCurrentRevision(unitOfWork, projectId);
            throw new ProjectCommandException(
                "revision_conflict",
                "The project changed while the command was being accepted.",
                currentRevision,
                "expectedRevision");
        }

        return Convert.ToInt64(value, CultureInfo.InvariantCulture);
    }

    private static long ReadCurrentRevision(SqliteUnitOfWork unitOfWork, ProjectIdentity projectId) =>
        ReadCurrentRevisionOrNull(unitOfWork, projectId)
        ?? throw NotFound("project_not_found", "The project does not exist.");

    private static long? ReadCurrentRevisionOrNull(
        SqliteUnitOfWork unitOfWork,
        ProjectIdentity projectId)
    {
        using var command = unitOfWork.CreateCommand(
            "SELECT revision FROM projects WHERE project_id = $projectId;");
        command.Parameters.AddWithValue("$projectId", Format(projectId.Value));
        var value = command.ExecuteScalar();
        return value is null ? null : Convert.ToInt64(value, CultureInfo.InvariantCulture);
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

    private static Guid DeterministicGuid(Guid namespaceId, string kind, string value)
    {
        Span<byte> namespaceBytes = stackalloc byte[16];
        namespaceId.TryWriteBytes(namespaceBytes, bigEndian: true, out _);
        var nameBytes = Encoding.UTF8.GetBytes($"{kind}/{value}");
        var input = new byte[namespaceBytes.Length + nameBytes.Length];
        namespaceBytes.CopyTo(input);
        nameBytes.CopyTo(input.AsSpan(namespaceBytes.Length));
        var bytes = SHA1.HashData(input)[..16];
        bytes[6] = (byte)((bytes[6] & 0x0F) | 0x50);
        bytes[8] = (byte)((bytes[8] & 0x3F) | 0x80);
        return new Guid(bytes, bigEndian: true);
    }

    private sealed record StoredCommand(
        Guid ProjectId,
        long ExpectedRevision,
        long ResultingRevision,
        string CommandType,
        int RequestSchemaVersion,
        string RequestJson,
        string RequestSha256,
        int ResultSchemaVersion,
        string ResultJson,
        string ResultSha256);

    private static CreateProjectCommand Normalize(CreateProjectCommand command)
    {
        ValidateStatus(command.Status);
        return new CreateProjectCommand(
            NormalizeDesignation(command.Designation, "designation"),
            NormalizeName(command.Name, "name"),
            ValidateBatchQuantity(command.BatchQuantity),
            command.Status);
    }

    private static void ValidateStatus(ProjectStatus status)
    {
        try
        {
            _ = ProjectRules.ToCode(status);
        }
        catch (ArgumentOutOfRangeException error)
        {
            throw Invalid("invalid_status", error.Message, "status");
        }
    }

    private static string NormalizeDesignation(string value, string field)
    {
        try
        {
            return ProjectRules.NormalizeDesignation(value, field);
        }
        catch (Exception error) when (error is ArgumentException)
        {
            throw Invalid("invalid_designation", error.Message, field);
        }
    }

    private static string NormalizeName(string value, string field)
    {
        try
        {
            return ProjectRules.NormalizeName(value, field);
        }
        catch (Exception error) when (error is ArgumentException)
        {
            throw Invalid("invalid_name", error.Message, field);
        }
    }

    private static long ValidateBatchQuantity(long value)
    {
        try
        {
            return ProjectRules.ValidateBatchQuantity(value, "batchQuantity");
        }
        catch (ArgumentOutOfRangeException error)
        {
            throw Invalid("invalid_batch_quantity", error.Message, "batchQuantity");
        }
    }

    private static long ValidateHarnessQuantity(long value)
    {
        try
        {
            return ProjectRules.ValidateHarnessQuantity(value, "quantity");
        }
        catch (ArgumentOutOfRangeException error)
        {
            throw Invalid("invalid_harness_quantity", error.Message, "quantity");
        }
    }

    private static void ValidateProjectId(ProjectIdentity projectId)
    {
        if (projectId.Value == Guid.Empty)
        {
            throw Invalid("invalid_project_id", "The project ID is invalid.", "projectId");
        }
    }

    private static long AllocateIncrement(SqliteUnitOfWork unitOfWork)
    {
        using var command = unitOfWork.CreateCommand(
            """
            UPDATE project_counter
            SET next_increment = next_increment + 1
            WHERE counter_id = 1
            RETURNING next_increment - 1;
            """);
        return Convert.ToInt64(
            command.ExecuteScalar()
                ?? throw new InvalidDataException("The project increment counter is unavailable."),
            CultureInfo.InvariantCulture);
    }

    private static void InsertProject(
        SqliteUnitOfWork unitOfWork,
        ProjectIdentity projectId,
        long increment,
        CreateProjectCommand command,
        string timestamp)
    {
        using var insert = unitOfWork.CreateCommand(
            """
            INSERT INTO projects
                (project_id, designation, project_increment, name, batch_quantity,
                 status, created_utc, updated_utc)
            VALUES
                ($projectId, $designation, $increment, $name, $batchQuantity,
                 $status, $createdUtc, $updatedUtc);
            """);
        insert.Parameters.AddWithValue("$projectId", Format(projectId.Value));
        insert.Parameters.AddWithValue("$designation", command.Designation);
        insert.Parameters.AddWithValue("$increment", increment);
        insert.Parameters.AddWithValue("$name", command.Name);
        insert.Parameters.AddWithValue("$batchQuantity", command.BatchQuantity);
        insert.Parameters.AddWithValue("$status", ProjectRules.ToCode(command.Status));
        insert.Parameters.AddWithValue("$createdUtc", timestamp);
        insert.Parameters.AddWithValue("$updatedUtc", timestamp);
        insert.ExecuteNonQuery();
    }

    private static void InsertHarness(
        SqliteUnitOfWork unitOfWork,
        HarnessIdentity harnessId,
        ProjectIdentity projectId,
        string designation,
        long quantity,
        int sortOrder,
        string timestamp)
    {
        using var insert = unitOfWork.CreateCommand(
            """
            INSERT INTO harnesses
                (harness_id, project_id, designation, quantity, sort_order, created_utc, updated_utc)
            VALUES
                ($harnessId, $projectId, $designation, $quantity, $sortOrder, $createdUtc, $updatedUtc);
            """);
        insert.Parameters.AddWithValue("$harnessId", Format(harnessId.Value));
        insert.Parameters.AddWithValue("$projectId", Format(projectId.Value));
        insert.Parameters.AddWithValue("$designation", designation);
        insert.Parameters.AddWithValue("$quantity", quantity);
        insert.Parameters.AddWithValue("$sortOrder", sortOrder);
        insert.Parameters.AddWithValue("$createdUtc", timestamp);
        insert.Parameters.AddWithValue("$updatedUtc", timestamp);
        insert.ExecuteNonQuery();

        foreach (var kind in new[] { "e4", "drawing", "route" })
        {
            using var document = unitOfWork.CreateCommand(
                """
                INSERT INTO harness_documents
                    (document_id, harness_id, section_kind, status, created_utc, updated_utc)
                VALUES ($documentId, $harnessId, $kind, 'empty', $createdUtc, $updatedUtc);
                """);
            document.Parameters.AddWithValue("$documentId", Format(Guid.NewGuid()));
            document.Parameters.AddWithValue("$harnessId", Format(harnessId.Value));
            document.Parameters.AddWithValue("$kind", kind);
            document.Parameters.AddWithValue("$createdUtc", timestamp);
            document.Parameters.AddWithValue("$updatedUtc", timestamp);
            document.ExecuteNonQuery();
        }
    }

    private static void CopyHarnessDesign(
        SqliteUnitOfWork unitOfWork,
        HarnessIdentity sourceHarnessId,
        HarnessIdentity destinationHarnessId,
        string timestamp)
    {
        using var update = unitOfWork.CreateCommand(
            """
            UPDATE harness_design_documents
            SET schema_version = (
                    SELECT schema_version
                    FROM harness_design_documents
                    WHERE harness_id = $sourceHarnessId),
                content_json = (
                    SELECT content_json
                    FROM harness_design_documents
                    WHERE harness_id = $sourceHarnessId),
                revision = 0,
                created_utc = $timestamp,
                updated_utc = $timestamp
            WHERE harness_id = $destinationHarnessId
              AND EXISTS (
                  SELECT 1
                  FROM harness_design_documents
                  WHERE harness_id = $sourceHarnessId);
            """);
        update.Parameters.AddWithValue("$sourceHarnessId", Format(sourceHarnessId.Value));
        update.Parameters.AddWithValue("$destinationHarnessId", Format(destinationHarnessId.Value));
        update.Parameters.AddWithValue("$timestamp", timestamp);
        if (update.ExecuteNonQuery() != 1)
        {
            throw new InvalidDataException("The source harness design document is missing.");
        }
    }

    private static ProjectDetails ReadProject(
        SqliteUnitOfWork unitOfWork,
        ProjectIdentity projectId)
    {
        string designation;
        long increment;
        string name;
        long batchQuantity;
        ProjectStatus status;
        long revision;
        DateTimeOffset createdUtc;
        DateTimeOffset updatedUtc;
        using (var project = unitOfWork.CreateCommand(
            """
            SELECT designation, project_increment, name, batch_quantity, status,
                   revision, created_utc, updated_utc
            FROM projects
            WHERE project_id = $projectId;
            """))
        {
            project.Parameters.AddWithValue("$projectId", Format(projectId.Value));
            using var reader = project.ExecuteReader();
            if (!reader.Read())
            {
                throw NotFound("project_not_found", "The project does not exist.");
            }

            designation = reader.GetString(0);
            increment = reader.GetInt64(1);
            name = reader.GetString(2);
            batchQuantity = Math.Min(reader.GetInt64(3), ProjectRules.MaximumHarnessQuantity);
            status = ReadStatus(reader.GetString(4));
            revision = reader.GetInt64(5);
            createdUtc = ReadTimestamp(reader.GetString(6));
            updatedUtc = ReadTimestamp(reader.GetString(7));
        }

        var documents = ReadHarnessDocuments(unitOfWork, projectId);
        using var harnessesCommand = unitOfWork.CreateCommand(
            """
            SELECT harness_id, designation, quantity, sort_order, created_utc, updated_utc
            FROM harnesses
            WHERE project_id = $projectId
            ORDER BY sort_order, harness_id;
            """);
        harnessesCommand.Parameters.AddWithValue("$projectId", Format(projectId.Value));
        using var harnessReader = harnessesCommand.ExecuteReader();
        var harnesses = new List<HarnessSummary>();
        while (harnessReader.Read())
        {
            var harnessId = ReadHarnessId(harnessReader, 0);
            harnesses.Add(new HarnessSummary(
                harnessId,
                harnessReader.GetString(1),
                harnessReader.GetInt64(2),
                harnessReader.GetInt32(3),
                ReadTimestamp(harnessReader.GetString(4)),
                ReadTimestamp(harnessReader.GetString(5)),
                documents.TryGetValue(harnessId, out var harnessDocuments)
                    ? harnessDocuments
                    : throw new InvalidDataException("A harness document workspace is incomplete.")));
        }

        return new ProjectDetails(
            projectId,
            designation,
            increment,
            name,
            batchQuantity,
            status,
            revision,
            createdUtc,
            updatedUtc,
            harnesses);
    }

    private static IReadOnlyDictionary<HarnessIdentity, IReadOnlyList<HarnessDocumentSummary>>
        ReadHarnessDocuments(SqliteUnitOfWork unitOfWork, ProjectIdentity projectId)
    {
        using var command = unitOfWork.CreateCommand(
            """
            SELECT d.harness_id, d.document_id, d.section_kind, d.status,
                   d.created_utc, d.updated_utc
            FROM harness_documents d
            INNER JOIN harnesses h ON h.harness_id = d.harness_id
            WHERE h.project_id = $projectId
            ORDER BY d.harness_id,
                     CASE d.section_kind WHEN 'e4' THEN 0 WHEN 'drawing' THEN 1 ELSE 2 END;
            """);
        command.Parameters.AddWithValue("$projectId", Format(projectId.Value));
        using var reader = command.ExecuteReader();
        var documents = new Dictionary<HarnessIdentity, List<HarnessDocumentSummary>>();
        while (reader.Read())
        {
            var harnessId = new HarnessIdentity(ReadGuid(reader.GetString(0), "harness"));
            if (!documents.TryGetValue(harnessId, out var list))
            {
                list = [];
                documents.Add(harnessId, list);
            }

            list.Add(new HarnessDocumentSummary(
                new HarnessDocumentIdentity(ReadGuid(reader.GetString(1), "harness document")),
                reader.GetString(2),
                reader.GetString(3),
                ReadTimestamp(reader.GetString(4)),
                ReadTimestamp(reader.GetString(5))));
        }

        if (documents.Any(pair => pair.Value.Count != 3 ||
                !pair.Value.Select(item => item.Kind).SequenceEqual(new[] { "e4", "drawing", "route" })))
        {
            throw new InvalidDataException("A harness document workspace is incomplete.");
        }

        return documents.ToDictionary(
            pair => pair.Key,
            pair => (IReadOnlyList<HarnessDocumentSummary>)pair.Value);
    }

    private static void EnsureProjectExists(SqliteUnitOfWork unitOfWork, ProjectIdentity projectId)
    {
        using var command = unitOfWork.CreateCommand(
            "SELECT COUNT(*) FROM projects WHERE project_id = $projectId;");
        command.Parameters.AddWithValue("$projectId", Format(projectId.Value));
        if (Convert.ToInt32(command.ExecuteScalar(), CultureInfo.InvariantCulture) != 1)
        {
            throw NotFound("project_not_found", "The project does not exist.");
        }
    }

    private static void TouchProject(
        SqliteUnitOfWork unitOfWork,
        ProjectIdentity projectId,
        string timestamp)
    {
        using var command = unitOfWork.CreateCommand(
            "UPDATE projects SET updated_utc = $updatedUtc WHERE project_id = $projectId;");
        command.Parameters.AddWithValue("$updatedUtc", timestamp);
        command.Parameters.AddWithValue("$projectId", Format(projectId.Value));
        command.ExecuteNonQuery();
    }

    private static void CopyAttachments(
        SqliteUnitOfWork unitOfWork,
        ProjectIdentity sourceProjectId,
        ProjectIdentity destinationProjectId,
        string createdUtc)
    {
        using var read = unitOfWork.CreateCommand(
            """
            SELECT content_sha256, file_name, media_type, purpose
            FROM project_attachments
            WHERE project_id = $projectId
            ORDER BY created_utc, attachment_id;
            """);
        read.Parameters.AddWithValue("$projectId", Format(sourceProjectId.Value));
        using var reader = read.ExecuteReader();
        var rows = new List<(string Hash, string FileName, string MediaType, string Purpose)>();
        while (reader.Read())
        {
            rows.Add((reader.GetString(0), reader.GetString(1), reader.GetString(2), reader.GetString(3)));
        }

        reader.Close();
        foreach (var row in rows)
        {
            using var insert = unitOfWork.CreateCommand(
                """
                INSERT INTO project_attachments (
                    attachment_id, project_id, content_sha256, file_name, media_type, purpose, created_utc)
                VALUES (
                    $attachmentId, $projectId, $contentSha256, $fileName, $mediaType, $purpose, $createdUtc);
                """);
            insert.Parameters.AddWithValue("$attachmentId", Format(Guid.NewGuid()));
            insert.Parameters.AddWithValue("$projectId", Format(destinationProjectId.Value));
            insert.Parameters.AddWithValue("$contentSha256", row.Hash);
            insert.Parameters.AddWithValue("$fileName", row.FileName);
            insert.Parameters.AddWithValue("$mediaType", row.MediaType);
            insert.Parameters.AddWithValue("$purpose", row.Purpose);
            insert.Parameters.AddWithValue("$createdUtc", createdUtc);
            insert.ExecuteNonQuery();
        }
    }

    private static void CopyPinnedCharacteristics(
        SqliteUnitOfWork unitOfWork,
        ProjectIdentity sourceProjectId,
        ProjectIdentity destinationProjectId)
    {
        using var read = unitOfWork.CreateCommand(
            """
            SELECT source_kind, source_record_key, source_version,
                   characteristic_name, characteristic_value, unit,
                   canonical_payload, payload_sha256, captured_utc
            FROM pinned_characteristics
            WHERE project_id = $projectId
            ORDER BY captured_utc, snapshot_id;
            """);
        read.Parameters.AddWithValue("$projectId", Format(sourceProjectId.Value));
        using var reader = read.ExecuteReader();
        var rows = new List<(string SourceKind, string RecordKey, string SourceVersion,
            string Name, string Value, string Unit, string Payload, string Hash, string CapturedUtc)>();
        while (reader.Read())
        {
            rows.Add((
                reader.GetString(0), reader.GetString(1), reader.GetString(2),
                reader.GetString(3), reader.GetString(4), reader.GetString(5),
                reader.GetString(6), reader.GetString(7), reader.GetString(8)));
        }

        reader.Close();
        foreach (var row in rows)
        {
            using var insert = unitOfWork.CreateCommand(
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
            insert.Parameters.AddWithValue("$snapshotId", Format(Guid.NewGuid()));
            insert.Parameters.AddWithValue("$projectId", Format(destinationProjectId.Value));
            insert.Parameters.AddWithValue("$sourceKind", row.SourceKind);
            insert.Parameters.AddWithValue("$sourceRecordKey", row.RecordKey);
            insert.Parameters.AddWithValue("$sourceVersion", row.SourceVersion);
            insert.Parameters.AddWithValue("$characteristicName", row.Name);
            insert.Parameters.AddWithValue("$characteristicValue", row.Value);
            insert.Parameters.AddWithValue("$unit", row.Unit);
            insert.Parameters.AddWithValue("$canonicalPayload", row.Payload);
            insert.Parameters.AddWithValue("$payloadSha256", row.Hash);
            insert.Parameters.AddWithValue("$capturedUtc", row.CapturedUtc);
            insert.ExecuteNonQuery();
        }
    }

    private static void CopyComponentSnapshotsAndPlacements(
        SqliteUnitOfWork unitOfWork,
        ProjectIdentity sourceProjectId,
        ProjectIdentity destinationProjectId,
        IReadOnlyList<HarnessSummary> sourceHarnesses,
        string timestamp)
    {
        var harnessMap = new Dictionary<string, string>(StringComparer.Ordinal);
        using (var destinationHarnesses = unitOfWork.CreateCommand(
                   """
                   SELECT harness_id, sort_order FROM harnesses
                   WHERE project_id = $projectId ORDER BY sort_order, harness_id;
                   """))
        {
            destinationHarnesses.Parameters.AddWithValue("$projectId", Format(destinationProjectId.Value));
            using var reader = destinationHarnesses.ExecuteReader();
            var destinationByOrder = new Dictionary<int, string>();
            while (reader.Read()) destinationByOrder.Add(reader.GetInt32(1), reader.GetString(0));
            foreach (var sourceHarness in sourceHarnesses)
            {
                harnessMap.Add(
                    Format(sourceHarness.HarnessId.Value),
                    destinationByOrder.TryGetValue(sourceHarness.SortOrder, out var destinationHarnessId)
                        ? destinationHarnessId
                        : throw new InvalidDataException("A copied harness is missing."));
            }
        }

        var snapshotMap = new Dictionary<string, string>(StringComparer.Ordinal);
        using (var snapshots = unitOfWork.CreateCommand(
                   """
                   SELECT snapshot_id, source_template_id, source_version, source_version_sha256,
                          schema_version, code, name, content_json, content_sha256
                   FROM project_component_snapshots
                   WHERE project_id = $projectId
                     AND EXISTS (
                         SELECT 1
                         FROM harness_component_placements p
                         INNER JOIN harnesses h ON h.harness_id = p.harness_id
                         INNER JOIN harness_design_documents d ON d.harness_id = p.harness_id
                         WHERE h.project_id = $projectId
                           AND p.snapshot_id = project_component_snapshots.snapshot_id
                           AND EXISTS (
                               SELECT 1
                               FROM json_each(json_extract(d.content_json, '$.connectors')) connector
                               WHERE json_extract(connector.value, '$.id') = p.placement_id))
                   ORDER BY snapshot_id;
                   """))
        {
            snapshots.Parameters.AddWithValue("$projectId", Format(sourceProjectId.Value));
            using var reader = snapshots.ExecuteReader();
            var rows = new List<(string Id, string TemplateId, int Version, string VersionHash,
                int Schema, string Code, string Name, string Content, string ContentHash)>();
            while (reader.Read()) rows.Add((reader.GetString(0), reader.GetString(1), reader.GetInt32(2),
                reader.GetString(3), reader.GetInt32(4), reader.GetString(5), reader.GetString(6),
                reader.GetString(7), reader.GetString(8)));
            reader.Close();
            foreach (var row in rows)
            {
                var destinationSnapshotId = Format(Guid.NewGuid());
                using var insert = unitOfWork.CreateCommand(
                    """
                    INSERT INTO project_component_snapshots
                        (snapshot_id, project_id, source_template_id, source_version,
                         source_version_sha256, schema_version, code, name, content_json,
                         content_sha256, created_utc, updated_utc)
                    VALUES ($snapshotId, $projectId, $templateId, $version, $versionHash,
                            $schema, $code, $name, $content, $contentHash, $timestamp, $timestamp);
                    """);
                insert.Parameters.AddWithValue("$snapshotId", destinationSnapshotId);
                insert.Parameters.AddWithValue("$projectId", Format(destinationProjectId.Value));
                insert.Parameters.AddWithValue("$templateId", row.TemplateId);
                insert.Parameters.AddWithValue("$version", row.Version);
                insert.Parameters.AddWithValue("$versionHash", row.VersionHash);
                insert.Parameters.AddWithValue("$schema", row.Schema);
                insert.Parameters.AddWithValue("$code", row.Code);
                insert.Parameters.AddWithValue("$name", row.Name);
                insert.Parameters.AddWithValue("$content", row.Content);
                insert.Parameters.AddWithValue("$contentHash", row.ContentHash);
                insert.Parameters.AddWithValue("$timestamp", timestamp);
                insert.ExecuteNonQuery();
                snapshotMap.Add(row.Id, destinationSnapshotId);
            }
        }

        foreach (var (sourceSnapshotId, destinationSnapshotId) in snapshotMap)
        {
            using (var bindings = unitOfWork.CreateCommand(
                       """
                       INSERT INTO project_component_snapshot_article_bindings
                           (snapshot_id, binding_ordinal, source_id, entity_type, article_key)
                       SELECT $destinationSnapshotId, binding_ordinal, source_id, entity_type, article_key
                       FROM project_component_snapshot_article_bindings
                       WHERE snapshot_id = $sourceSnapshotId ORDER BY binding_ordinal;
                       """))
            {
                bindings.Parameters.AddWithValue("$destinationSnapshotId", destinationSnapshotId);
                bindings.Parameters.AddWithValue("$sourceSnapshotId", sourceSnapshotId);
                bindings.ExecuteNonQuery();
            }
            using var assets = unitOfWork.CreateCommand(
                """
                INSERT INTO project_component_snapshot_asset_refs
                    (snapshot_id, asset_ordinal, asset_id, file_name, media_type, content_sha256)
                SELECT $destinationSnapshotId, asset_ordinal, asset_id, file_name, media_type, content_sha256
                FROM project_component_snapshot_asset_refs
                WHERE snapshot_id = $sourceSnapshotId ORDER BY asset_ordinal;
                """);
            assets.Parameters.AddWithValue("$destinationSnapshotId", destinationSnapshotId);
            assets.Parameters.AddWithValue("$sourceSnapshotId", sourceSnapshotId);
            assets.ExecuteNonQuery();
        }

        foreach (var (sourceHarnessId, destinationHarnessId) in harnessMap)
        {
            using var placements = unitOfWork.CreateCommand(
                """
                SELECT placement_id, snapshot_id, source_id, entity_type, article_key,
                       instance_json
                FROM harness_component_placements
                WHERE harness_id = $harnessId
                  AND EXISTS (
                      SELECT 1
                      FROM harness_design_documents d,
                           json_each(json_extract(d.content_json, '$.connectors')) connector
                      WHERE d.harness_id = harness_component_placements.harness_id
                        AND json_extract(connector.value, '$.id') = harness_component_placements.placement_id)
                ORDER BY placement_id;
                """);
            placements.Parameters.AddWithValue("$harnessId", sourceHarnessId);
            using var reader = placements.ExecuteReader();
            var rows = new List<(Guid PlacementId, string SnapshotId, string SourceId, string EntityType, string ArticleKey)>();
            while (reader.Read()) rows.Add((
                ReadGuid(reader.GetString(0), "component placement"), reader.GetString(1),
                reader.GetString(2), reader.GetString(3), reader.GetString(4)));
            reader.Close();
            var placementIdMap = rows.ToDictionary(row => row.PlacementId, _ => Guid.NewGuid());
            string designJson;
            using (var design = unitOfWork.CreateCommand(
                       "SELECT content_json FROM harness_design_documents WHERE harness_id = $harnessId;"))
            {
                design.Parameters.AddWithValue("$harnessId", destinationHarnessId);
                designJson = design.ExecuteScalar() as string
                    ?? throw new InvalidDataException("A copied harness design document is missing.");
            }
            var remapped = ProjectComponentPlacementRemapper.RemapHarnessDesign(designJson, placementIdMap);
            using (var design = unitOfWork.CreateCommand(
                       "UPDATE harness_design_documents SET content_json = $content WHERE harness_id = $harnessId;"))
            {
                design.Parameters.AddWithValue("$content", remapped.DesignJson);
                design.Parameters.AddWithValue("$harnessId", destinationHarnessId);
                if (design.ExecuteNonQuery() != 1)
                    throw new InvalidDataException("A copied harness design document is missing.");
            }
            foreach (var row in rows)
            {
                var destinationPlacementId = placementIdMap[row.PlacementId];
                using var insert = unitOfWork.CreateCommand(
                    """
                    INSERT INTO harness_component_placements
                        (placement_id, harness_id, snapshot_id, source_id, entity_type,
                         article_key, instance_json, created_utc, updated_utc)
                    VALUES ($placementId, $harnessId, $snapshotId, $sourceId, $entityType,
                            $articleKey, $instance, $timestamp, $timestamp);
                    """);
                insert.Parameters.AddWithValue("$placementId", Format(destinationPlacementId));
                insert.Parameters.AddWithValue("$harnessId", destinationHarnessId);
                insert.Parameters.AddWithValue("$snapshotId", snapshotMap[row.SnapshotId]);
                insert.Parameters.AddWithValue("$sourceId", row.SourceId);
                insert.Parameters.AddWithValue("$entityType", row.EntityType);
                insert.Parameters.AddWithValue("$articleKey", row.ArticleKey);
                insert.Parameters.AddWithValue("$instance", remapped.InstancesBySourcePlacementId[row.PlacementId]);
                insert.Parameters.AddWithValue("$timestamp", timestamp);
                insert.ExecuteNonQuery();
            }
        }
    }

    private static ProjectIdentity ReadProjectId(SqliteDataReader reader, int ordinal) =>
        new(ReadGuid(reader.GetString(ordinal), "project"));

    private static HarnessIdentity ReadHarnessId(SqliteDataReader reader, int ordinal) =>
        new(ReadGuid(reader.GetString(ordinal), "harness"));

    private static Guid ReadGuid(string value, string kind) =>
        Guid.TryParseExact(value, "D", out var result) && result != Guid.Empty
            ? result
            : throw new InvalidDataException($"The stored {kind} ID is invalid.");

    private static ProjectStatus ReadStatus(string value) =>
        ProjectRules.TryParseStatus(value, out var result)
            ? result
            : throw new InvalidDataException("The stored project status is invalid.");

    private static DateTimeOffset ReadTimestamp(string value) =>
        DateTimeOffset.TryParseExact(
            value,
            "O",
            CultureInfo.InvariantCulture,
            DateTimeStyles.RoundtripKind,
            out var result)
            ? result
            : throw new InvalidDataException("A stored timestamp is invalid.");

    private static string UtcNowText() =>
        DateTimeOffset.UtcNow.ToString("O", CultureInfo.InvariantCulture);

    private static string Format(Guid value) => value.ToString("D", CultureInfo.InvariantCulture);

    private static object DbValue(object? value) => value ?? DBNull.Value;

    private static ProjectCatalogException Invalid(string code, string message, string? field = null) =>
        new(code, message, field);

    private static ProjectCatalogException NotFound(string code, string message) =>
        new(code, message);
}
