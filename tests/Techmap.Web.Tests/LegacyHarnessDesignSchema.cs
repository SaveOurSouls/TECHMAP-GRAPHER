using Microsoft.Data.Sqlite;
using Techmap.Infrastructure.Sqlite;

namespace Techmap.Web.Tests;

/** Restores the historical design CHECK when a test downgrades a current database by hand. */
internal static class LegacyHarnessDesignSchema
{
    internal static void RestoreOneMiBLimit(SqliteConnection connection)
    {
        using var command = connection.CreateCommand();
        command.CommandText = $$"""
            DROP TRIGGER create_harness_design_document;
            CREATE TEMP TABLE legacy_design_rows AS SELECT * FROM harness_design_documents;
            DROP TABLE harness_design_documents;
            CREATE TABLE harness_design_documents (
                harness_id TEXT NOT NULL PRIMARY KEY
                    REFERENCES harnesses(harness_id) ON UPDATE CASCADE ON DELETE CASCADE,
                revision INTEGER NOT NULL CHECK (revision >= 0),
                schema_version INTEGER NOT NULL CHECK (schema_version = 1),
                content_json TEXT NOT NULL
                    CHECK (length(content_json) BETWEEN 2 AND 1048576)
                    CHECK (json_valid(content_json)),
                created_utc TEXT NOT NULL CHECK (length(created_utc) BETWEEN 1 AND 64),
                updated_utc TEXT NOT NULL CHECK (length(updated_utc) BETWEEN 1 AND 64)
            ) STRICT;
            INSERT INTO harness_design_documents
                (harness_id, revision, schema_version, content_json, created_utc, updated_utc)
            SELECT harness_id, revision, schema_version, content_json, created_utc, updated_utc
            FROM legacy_design_rows;
            DROP TABLE legacy_design_rows;
            CREATE TRIGGER create_harness_design_document
            AFTER INSERT ON harnesses
            BEGIN
                INSERT INTO harness_design_documents
                    (harness_id, revision, schema_version, content_json, created_utc, updated_utc)
                VALUES (NEW.harness_id, 0, 1, '{{SqliteStorage.EmptyHarnessDesignJson}}', NEW.created_utc, NEW.updated_utc);
            END;
            """;
        command.ExecuteNonQuery();
    }
}
