using System.Globalization;
using Microsoft.Data.Sqlite;
using Techmap.Application;
using Techmap.Domain;

namespace Techmap.Infrastructure.Sqlite;

public sealed class SqliteProjectCatalog(SqliteStorage storage) : IProjectCatalog
{
    public IReadOnlyList<ProjectSummary> ListProjects() =>
        storage.ExecuteRead(unitOfWork =>
        {
            using var command = unitOfWork.CreateCommand(
                """
                SELECT p.project_id, p.designation, p.project_increment, p.name,
                       p.batch_quantity, p.status, p.created_utc, p.updated_utc,
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
                    reader.GetInt64(4),
                    ReadStatus(reader.GetString(5)),
                    reader.GetInt32(8),
                    ReadTimestamp(reader.GetString(6)),
                    ReadTimestamp(reader.GetString(7))));
            }

            return projects;
        });

    public ProjectDetails GetProject(ProjectIdentity projectId)
    {
        ValidateProjectId(projectId);
        return storage.ExecuteRead(unitOfWork => ReadProject(unitOfWork, projectId));
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
        return storage.ExecuteInTransaction(unitOfWork =>
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
            update.Parameters.AddWithValue("$updatedUtc", UtcNowText());
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
                InsertHarness(
                    unitOfWork,
                    HarnessIdentity.New(),
                    destinationId,
                    harness.Designation,
                    harness.SortOrder,
                    now);
            }

            return ReadProject(unitOfWork, destinationId);
        });
    }

    public ProjectDetails AddHarness(ProjectIdentity projectId, string designation)
    {
        ValidateProjectId(projectId);
        var normalizedDesignation = NormalizeDesignation(designation, "designation");
        return storage.ExecuteInTransaction(unitOfWork =>
        {
            EnsureProjectExists(unitOfWork, projectId);
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
            var now = UtcNowText();
            try
            {
                InsertHarness(
                    unitOfWork,
                    HarnessIdentity.New(),
                    projectId,
                    normalizedDesignation,
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
        });
    }

    public ProjectDetails DeleteHarness(ProjectIdentity projectId, HarnessIdentity harnessId)
    {
        ValidateProjectId(projectId);
        if (harnessId.Value == Guid.Empty)
        {
            throw Invalid("invalid_harness_id", "The harness ID is invalid.", "harnessId");
        }

        return storage.ExecuteInTransaction(unitOfWork =>
        {
            EnsureProjectExists(unitOfWork, projectId);
            using var delete = unitOfWork.CreateCommand(
                "DELETE FROM harnesses WHERE project_id = $projectId AND harness_id = $harnessId;");
            delete.Parameters.AddWithValue("$projectId", Format(projectId.Value));
            delete.Parameters.AddWithValue("$harnessId", Format(harnessId.Value));
            if (delete.ExecuteNonQuery() != 1)
            {
                throw NotFound("harness_not_found", "The harness does not exist in this project.");
            }

            TouchProject(unitOfWork, projectId, UtcNowText());
            return ReadProject(unitOfWork, projectId);
        });
    }

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
        int sortOrder,
        string timestamp)
    {
        using var insert = unitOfWork.CreateCommand(
            """
            INSERT INTO harnesses
                (harness_id, project_id, designation, sort_order, created_utc, updated_utc)
            VALUES
                ($harnessId, $projectId, $designation, $sortOrder, $createdUtc, $updatedUtc);
            """);
        insert.Parameters.AddWithValue("$harnessId", Format(harnessId.Value));
        insert.Parameters.AddWithValue("$projectId", Format(projectId.Value));
        insert.Parameters.AddWithValue("$designation", designation);
        insert.Parameters.AddWithValue("$sortOrder", sortOrder);
        insert.Parameters.AddWithValue("$createdUtc", timestamp);
        insert.Parameters.AddWithValue("$updatedUtc", timestamp);
        insert.ExecuteNonQuery();
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
        DateTimeOffset createdUtc;
        DateTimeOffset updatedUtc;
        using (var project = unitOfWork.CreateCommand(
            """
            SELECT designation, project_increment, name, batch_quantity, status,
                   created_utc, updated_utc
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
            batchQuantity = reader.GetInt64(3);
            status = ReadStatus(reader.GetString(4));
            createdUtc = ReadTimestamp(reader.GetString(5));
            updatedUtc = ReadTimestamp(reader.GetString(6));
        }

        using var harnessesCommand = unitOfWork.CreateCommand(
            """
            SELECT harness_id, designation, sort_order, created_utc, updated_utc
            FROM harnesses
            WHERE project_id = $projectId
            ORDER BY sort_order, harness_id;
            """);
        harnessesCommand.Parameters.AddWithValue("$projectId", Format(projectId.Value));
        using var harnessReader = harnessesCommand.ExecuteReader();
        var harnesses = new List<HarnessSummary>();
        while (harnessReader.Read())
        {
            harnesses.Add(new HarnessSummary(
                ReadHarnessId(harnessReader, 0),
                harnessReader.GetString(1),
                harnessReader.GetInt32(2),
                ReadTimestamp(harnessReader.GetString(3)),
                ReadTimestamp(harnessReader.GetString(4))));
        }

        return new ProjectDetails(
            projectId,
            designation,
            increment,
            name,
            batchQuantity,
            status,
            createdUtc,
            updatedUtc,
            harnesses);
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
