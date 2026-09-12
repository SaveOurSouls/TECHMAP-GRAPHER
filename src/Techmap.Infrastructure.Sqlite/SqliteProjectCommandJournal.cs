using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Techmap.Application;
using Techmap.Domain;

namespace Techmap.Infrastructure.Sqlite;

internal static class SqliteProjectCommandJournal
{
    internal static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    internal static ProjectMutationResult<T> Execute<T>(
        SqliteStorage storage,
        ProjectIdentity projectId,
        ProjectCommandEnvelope envelope,
        string commandType,
        string canonicalRequest,
        Func<SqliteUnitOfWork, T> mutation,
        Func<string, T> readResult,
        Func<T, string> writeResult)
    {
        if (envelope.CommandId == Guid.Empty || envelope.ExpectedRevision < 0)
        {
            throw new ProjectCatalogException(
                envelope.CommandId == Guid.Empty ? "invalid_command_id" : "invalid_expected_revision",
                "The command envelope is invalid.",
                envelope.CommandId == Guid.Empty ? "commandId" : "expectedRevision");
        }

        var requestHash = Hash(canonicalRequest);
        return storage.ExecuteInTransaction(unitOfWork =>
        {
            using (var lookup = unitOfWork.CreateCommand(
                """
                SELECT project_id, expected_revision, resulting_revision, command_type,
                       request_json, request_sha256, result_json, result_sha256
                FROM project_commands WHERE command_id = $commandId;
                """))
            {
                lookup.Parameters.AddWithValue("$commandId", envelope.CommandId.ToString("D"));
                using var reader = lookup.ExecuteReader();
                if (reader.Read())
                {
                    var requestJson = reader.GetString(4);
                    var resultJson = reader.GetString(6);
                    if (!string.Equals(Hash(requestJson), reader.GetString(5), StringComparison.Ordinal) ||
                        !string.Equals(Hash(resultJson), reader.GetString(7), StringComparison.Ordinal))
                    {
                        throw new InvalidDataException("The project command journal is corrupt.");
                    }

                    if (reader.GetString(0) != projectId.Value.ToString("D") ||
                        reader.GetInt64(1) != envelope.ExpectedRevision ||
                        reader.GetString(3) != commandType ||
                        reader.GetString(5) != requestHash || requestJson != canonicalRequest)
                    {
                        reader.Close();
                        throw new ProjectCommandException(
                            "command_id_reused",
                            "The command ID was already used for different data.",
                            CurrentRevision(unitOfWork, projectId));
                    }

                    return new ProjectMutationResult<T>(
                        envelope.CommandId,
                        envelope.ExpectedRevision,
                        reader.GetInt64(2),
                        readResult(resultJson));
                }
            }

            var revision = CurrentRevision(unitOfWork, projectId);
            if (revision != envelope.ExpectedRevision)
            {
                throw new ProjectCommandException(
                    "revision_conflict",
                    "The expected project revision is stale.",
                    revision,
                    "expectedRevision");
            }
            if (revision == long.MaxValue)
            {
                throw new ProjectCommandException(
                    "revision_limit_reached",
                    "The project revision cannot be incremented.",
                    revision);
            }

            var value = mutation(unitOfWork);
            var now = DateTimeOffset.UtcNow.ToString("O", CultureInfo.InvariantCulture);
            var resultingRevision = checked(envelope.ExpectedRevision + 1);
            using (var update = unitOfWork.CreateCommand(
                """
                UPDATE projects SET revision = revision + 1, updated_utc = $now
                WHERE project_id = $projectId AND revision = $expectedRevision;
                """))
            {
                update.Parameters.AddWithValue("$now", now);
                update.Parameters.AddWithValue("$projectId", projectId.Value.ToString("D"));
                update.Parameters.AddWithValue("$expectedRevision", envelope.ExpectedRevision);
                if (update.ExecuteNonQuery() != 1)
                {
                    throw new ProjectCommandException(
                        "revision_conflict", "The project changed.", CurrentRevision(unitOfWork, projectId));
                }
            }

            var serializedResult = writeResult(value);
            using (var journal = unitOfWork.CreateCommand(
                """
                INSERT INTO project_commands (
                    command_id, project_id, expected_revision, resulting_revision, command_type,
                    request_schema_version, request_json, request_sha256,
                    result_schema_version, result_json, result_sha256, accepted_utc)
                VALUES ($commandId, $projectId, $expectedRevision, $resultingRevision, $commandType,
                        1, $requestJson, $requestHash, 1, $resultJson, $resultHash, $now);
                INSERT INTO project_versions (project_id, revision, command_id, cause, committed_utc)
                VALUES ($projectId, $resultingRevision, $commandId, $commandType, $now);
                """))
            {
                journal.Parameters.AddWithValue("$commandId", envelope.CommandId.ToString("D"));
                journal.Parameters.AddWithValue("$projectId", projectId.Value.ToString("D"));
                journal.Parameters.AddWithValue("$expectedRevision", envelope.ExpectedRevision);
                journal.Parameters.AddWithValue("$resultingRevision", resultingRevision);
                journal.Parameters.AddWithValue("$commandType", commandType);
                journal.Parameters.AddWithValue("$requestJson", canonicalRequest);
                journal.Parameters.AddWithValue("$requestHash", requestHash);
                journal.Parameters.AddWithValue("$resultJson", serializedResult);
                journal.Parameters.AddWithValue("$resultHash", Hash(serializedResult));
                journal.Parameters.AddWithValue("$now", now);
                journal.ExecuteNonQuery();
            }

            return new ProjectMutationResult<T>(
                envelope.CommandId, envelope.ExpectedRevision, resultingRevision, value);
        });
    }

    private static long CurrentRevision(SqliteUnitOfWork unitOfWork, ProjectIdentity projectId)
    {
        using var command = unitOfWork.CreateCommand(
            "SELECT revision FROM projects WHERE project_id = $projectId;");
        command.Parameters.AddWithValue("$projectId", projectId.Value.ToString("D"));
        return Convert.ToInt64(
            command.ExecuteScalar()
                ?? throw new ProjectCatalogException("project_not_found", "The project does not exist."),
            CultureInfo.InvariantCulture);
    }

    private static string Hash(string value) =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
}
