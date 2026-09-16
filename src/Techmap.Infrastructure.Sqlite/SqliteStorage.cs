using System.Globalization;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;

[assembly: InternalsVisibleTo("Techmap.Web.Tests")]
[assembly: InternalsVisibleTo("Techmap.Server")]

namespace Techmap.Infrastructure.Sqlite;

public sealed record SqliteStorageDiagnostics(
    int SchemaVersion,
    string SqliteVersion,
    bool ForeignKeysEnabled,
    int BusyTimeoutMilliseconds,
    string JournalMode);

public sealed class SqliteStorage : IDisposable, IAsyncDisposable
{
    public const int CurrentSchemaVersion = 18;
    public const int DefaultBusyTimeoutMilliseconds = 5_000;

    private const string InitialMigrationId = "M1-03-initial-storage";
    private const string InitialSchemaSql =
        """
        CREATE TABLE schema_history (
            version INTEGER NOT NULL PRIMARY KEY CHECK (version > 0),
            migration_id TEXT NOT NULL UNIQUE,
            script_sha256 TEXT NOT NULL,
            app_version TEXT NOT NULL,
            applied_utc TEXT NOT NULL,
            description TEXT NOT NULL CHECK (length(description) > 0)
        ) STRICT;
        """;
    private const string ProjectMigrationId = "M1-04-projects-and-harnesses";
    private const string ProjectSchemaSql =
        """
        CREATE TABLE project_counter (
            counter_id INTEGER NOT NULL PRIMARY KEY CHECK (counter_id = 1),
            next_increment INTEGER NOT NULL CHECK (next_increment > 0)
        ) STRICT;

        INSERT INTO project_counter (counter_id, next_increment) VALUES (1, 1);

        CREATE TABLE projects (
            project_id TEXT NOT NULL PRIMARY KEY CHECK (length(project_id) = 36),
            designation TEXT NOT NULL CHECK (length(designation) BETWEEN 1 AND 128),
            project_increment INTEGER NOT NULL UNIQUE CHECK (project_increment > 0),
            name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 256),
            batch_quantity INTEGER NOT NULL CHECK (batch_quantity > 0),
            status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'completed')),
            created_utc TEXT NOT NULL,
            updated_utc TEXT NOT NULL
        ) STRICT;

        CREATE TABLE harnesses (
            harness_id TEXT NOT NULL PRIMARY KEY CHECK (length(harness_id) = 36),
            project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
            designation TEXT NOT NULL CHECK (length(designation) BETWEEN 1 AND 128),
            sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
            created_utc TEXT NOT NULL,
            updated_utc TEXT NOT NULL,
            UNIQUE (project_id, sort_order)
        ) STRICT;

        CREATE INDEX ix_harnesses_project_order
            ON harnesses (project_id, sort_order, harness_id);

        CREATE TRIGGER enforce_project_harness_limit
        BEFORE INSERT ON harnesses
        WHEN (SELECT COUNT(*) FROM harnesses WHERE project_id = NEW.project_id) >= 100
        BEGIN
            SELECT RAISE(ABORT, 'harness_limit_reached');
        END;
        """;
    private const string ProjectDataMigrationId = "M1-05-attachments-and-pinned-data";
    private const string ProjectDataSchemaSql =
        """
        CREATE TABLE attachment_blobs (
            content_sha256 TEXT NOT NULL PRIMARY KEY
                CHECK (length(content_sha256) = 64)
                CHECK (content_sha256 = lower(content_sha256))
                CHECK (content_sha256 NOT GLOB '*[^0-9a-f]*'),
            size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
            created_utc TEXT NOT NULL
        ) STRICT;

        CREATE TABLE project_attachments (
            attachment_id TEXT NOT NULL PRIMARY KEY CHECK (length(attachment_id) = 36),
            project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
            content_sha256 TEXT NOT NULL
                REFERENCES attachment_blobs(content_sha256) ON DELETE RESTRICT,
            file_name TEXT NOT NULL CHECK (length(file_name) BETWEEN 1 AND 255),
            media_type TEXT NOT NULL CHECK (length(media_type) BETWEEN 1 AND 127),
            purpose TEXT NOT NULL CHECK (length(purpose) BETWEEN 1 AND 64),
            created_utc TEXT NOT NULL
        ) STRICT;

        CREATE INDEX ix_project_attachments_project
            ON project_attachments (project_id, created_utc, attachment_id);
        CREATE INDEX ix_project_attachments_content
            ON project_attachments (content_sha256, attachment_id);

        CREATE TABLE pinned_characteristics (
            snapshot_id TEXT NOT NULL PRIMARY KEY CHECK (length(snapshot_id) = 36),
            project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
            source_kind TEXT NOT NULL CHECK (length(source_kind) BETWEEN 1 AND 64),
            source_record_key TEXT NOT NULL CHECK (length(source_record_key) BETWEEN 1 AND 512),
            source_version TEXT NOT NULL CHECK (length(source_version) BETWEEN 1 AND 512),
            characteristic_name TEXT NOT NULL CHECK (length(characteristic_name) BETWEEN 1 AND 256),
            characteristic_value TEXT NOT NULL CHECK (length(characteristic_value) <= 4096),
            unit TEXT NOT NULL CHECK (length(unit) <= 64),
            canonical_payload TEXT NOT NULL CHECK (length(canonical_payload) BETWEEN 2 AND 65536),
            payload_sha256 TEXT NOT NULL
                CHECK (length(payload_sha256) = 64)
                CHECK (payload_sha256 = lower(payload_sha256))
                CHECK (payload_sha256 NOT GLOB '*[^0-9a-f]*'),
            captured_utc TEXT NOT NULL,
            UNIQUE (
                project_id,
                source_kind,
                source_record_key,
                source_version,
                characteristic_name)
        ) STRICT;

        CREATE INDEX ix_pinned_characteristics_project
            ON pinned_characteristics (project_id, source_kind, source_record_key, characteristic_name);

        CREATE TRIGGER prevent_pinned_characteristic_update
        BEFORE UPDATE ON pinned_characteristics
        BEGIN
            SELECT RAISE(ABORT, 'pinned_characteristic_is_immutable');
        END;
        """;
    private const string ProjectCommandMigrationId = "M1-06-project-command-journal";
    private const string ProjectCommandSchemaSql =
        """
        ALTER TABLE projects
            ADD COLUMN revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0);

        CREATE TABLE project_commands (
            command_id TEXT NOT NULL PRIMARY KEY CHECK (length(command_id) = 36),
            project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
            expected_revision INTEGER NOT NULL CHECK (expected_revision >= 0),
            resulting_revision INTEGER NOT NULL CHECK (resulting_revision = expected_revision + 1),
            command_type TEXT NOT NULL CHECK (length(command_type) BETWEEN 1 AND 64),
            request_schema_version INTEGER NOT NULL CHECK (request_schema_version > 0),
            request_json TEXT NOT NULL CHECK (length(request_json) >= 2),
            request_sha256 TEXT NOT NULL
                CHECK (length(request_sha256) = 64)
                CHECK (request_sha256 = lower(request_sha256))
                CHECK (request_sha256 NOT GLOB '*[^0-9a-f]*'),
            result_schema_version INTEGER NOT NULL CHECK (result_schema_version > 0),
            result_json TEXT NOT NULL CHECK (length(result_json) >= 2),
            result_sha256 TEXT NOT NULL
                CHECK (length(result_sha256) = 64)
                CHECK (result_sha256 = lower(result_sha256))
                CHECK (result_sha256 NOT GLOB '*[^0-9a-f]*'),
            accepted_utc TEXT NOT NULL,
            UNIQUE (project_id, resulting_revision)
        ) STRICT;

        CREATE INDEX ix_project_commands_project_time
            ON project_commands (project_id, accepted_utc, command_id);

        CREATE TABLE project_versions (
            project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
            revision INTEGER NOT NULL CHECK (revision > 0),
            command_id TEXT NOT NULL UNIQUE REFERENCES project_commands(command_id) ON DELETE RESTRICT,
            cause TEXT NOT NULL CHECK (length(cause) BETWEEN 1 AND 64),
            committed_utc TEXT NOT NULL,
            PRIMARY KEY (project_id, revision)
        ) STRICT;

        CREATE TRIGGER prevent_project_command_update
        BEFORE UPDATE ON project_commands
        BEGIN
            SELECT RAISE(ABORT, 'project_command_is_immutable');
        END;

        CREATE TRIGGER prevent_project_command_delete
        BEFORE DELETE ON project_commands
        WHEN EXISTS (SELECT 1 FROM projects WHERE project_id = OLD.project_id)
        BEGIN
            SELECT RAISE(ABORT, 'project_command_is_immutable');
        END;

        CREATE TRIGGER prevent_project_version_update
        BEFORE UPDATE ON project_versions
        BEGIN
            SELECT RAISE(ABORT, 'project_version_is_immutable');
        END;

        CREATE TRIGGER prevent_project_version_delete
        BEFORE DELETE ON project_versions
        WHEN EXISTS (SELECT 1 FROM projects WHERE project_id = OLD.project_id)
        BEGIN
            SELECT RAISE(ABORT, 'project_version_is_immutable');
        END;
        """;
    private const string ProjectImportMigrationId = "M1-14-project-import-provenance";
    private const string ProjectImportSchemaSql =
        """
        CREATE TABLE project_imports (
            project_id TEXT NOT NULL PRIMARY KEY
                REFERENCES projects(project_id) ON DELETE CASCADE,
            import_operation_id TEXT NOT NULL UNIQUE CHECK (length(import_operation_id) = 36),
            source_manifest_sha256 TEXT NOT NULL
                CHECK (length(source_manifest_sha256) = 64)
                CHECK (source_manifest_sha256 = lower(source_manifest_sha256))
                CHECK (source_manifest_sha256 NOT GLOB '*[^0-9a-f]*'),
            source_archive_sha256 TEXT NOT NULL
                CHECK (length(source_archive_sha256) = 64)
                CHECK (source_archive_sha256 = lower(source_archive_sha256))
                CHECK (source_archive_sha256 NOT GLOB '*[^0-9a-f]*'),
            source_project_id TEXT NOT NULL CHECK (length(source_project_id) = 36),
            source_project_revision INTEGER NOT NULL CHECK (source_project_revision >= 0),
            source_project_increment INTEGER NOT NULL CHECK (source_project_increment > 0),
            source_storage_schema_version INTEGER NOT NULL
                CHECK (source_storage_schema_version > 0),
            source_app_version TEXT NOT NULL CHECK (length(source_app_version) BETWEEN 1 AND 128),
            import_app_version TEXT NOT NULL CHECK (length(import_app_version) BETWEEN 1 AND 128),
            imported_utc TEXT NOT NULL
        ) STRICT;

        CREATE INDEX ix_project_imports_source
            ON project_imports (source_project_id, imported_utc, project_id);

        CREATE TRIGGER prevent_project_import_update
        BEFORE UPDATE ON project_imports
        BEGIN
            SELECT RAISE(ABORT, 'project_import_is_immutable');
        END;

        CREATE TRIGGER prevent_project_import_delete
        BEFORE DELETE ON project_imports
        WHEN EXISTS (SELECT 1 FROM projects WHERE project_id = OLD.project_id)
        BEGIN
            SELECT RAISE(ABORT, 'project_import_is_immutable');
        END;
        """;

    private const string HarnessWorkspaceMigrationId = "M1-04R-harness-workspaces";
    private const string HarnessWorkspaceSchemaSql =
        """
        ALTER TABLE harnesses
            ADD COLUMN quantity INTEGER NOT NULL DEFAULT 1
                CHECK (quantity > 0 AND quantity <= 9007199254740991);

        UPDATE harnesses
        SET quantity = MIN(
            (SELECT batch_quantity FROM projects WHERE projects.project_id = harnesses.project_id),
            9007199254740991);

        CREATE TABLE harness_documents (
            document_id TEXT NOT NULL PRIMARY KEY CHECK (length(document_id) = 36),
            harness_id TEXT NOT NULL REFERENCES harnesses(harness_id) ON UPDATE CASCADE ON DELETE CASCADE,
            section_kind TEXT NOT NULL CHECK (section_kind IN ('e4', 'drawing', 'route')),
            status TEXT NOT NULL CHECK (status IN ('empty')),
            created_utc TEXT NOT NULL,
            updated_utc TEXT NOT NULL,
            UNIQUE (harness_id, section_kind)
        ) STRICT;

        CREATE INDEX ix_harness_documents_harness
            ON harness_documents (harness_id, section_kind, document_id);

        INSERT INTO harness_documents
            (document_id, harness_id, section_kind, status, created_utc, updated_utc)
        SELECT lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-a'||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))),
               harness_id, kind, 'empty', created_utc, updated_utc
        FROM harnesses
        CROSS JOIN (SELECT 'e4' AS kind UNION ALL SELECT 'drawing' UNION ALL SELECT 'route');
        """;

    private const string ReferenceSnapshotMigrationId = "M2-01-versioned-reference-snapshots";
    private const string ReferenceSnapshotSchemaSql =
        """
        CREATE TABLE reference_sources (
            source_id TEXT NOT NULL PRIMARY KEY CHECK (length(source_id) = 36),
            source_key TEXT NOT NULL UNIQUE CHECK (length(source_key) BETWEEN 1 AND 256),
            source_kind TEXT NOT NULL CHECK (length(source_kind) BETWEEN 1 AND 64),
            display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 256),
            created_utc TEXT NOT NULL CHECK (length(created_utc) BETWEEN 1 AND 64)
        ) STRICT;

        CREATE TABLE reference_snapshots (
            snapshot_id TEXT NOT NULL PRIMARY KEY CHECK (length(snapshot_id) = 36),
            source_id TEXT NOT NULL REFERENCES reference_sources(source_id) ON DELETE RESTRICT,
            snapshot_sequence INTEGER NOT NULL CHECK (snapshot_sequence > 0),
            contract_version INTEGER NOT NULL CHECK (contract_version > 0),
            source_version TEXT NOT NULL CHECK (length(source_version) BETWEEN 1 AND 512),
            source_content_sha256 TEXT NOT NULL
                CHECK (length(source_content_sha256) = 64)
                CHECK (source_content_sha256 = lower(source_content_sha256))
                CHECK (source_content_sha256 NOT GLOB '*[^0-9a-f]*'),
            snapshot_metadata_sha256 TEXT NOT NULL
                CHECK (length(snapshot_metadata_sha256) = 64)
                CHECK (snapshot_metadata_sha256 = lower(snapshot_metadata_sha256))
                CHECK (snapshot_metadata_sha256 NOT GLOB '*[^0-9a-f]*'),
            canonical_content_sha256 TEXT NULL
                CHECK (canonical_content_sha256 IS NULL OR length(canonical_content_sha256) = 64)
                CHECK (canonical_content_sha256 IS NULL OR canonical_content_sha256 = lower(canonical_content_sha256))
                CHECK (canonical_content_sha256 IS NULL OR canonical_content_sha256 NOT GLOB '*[^0-9a-f]*'),
            provenance_json TEXT NOT NULL CHECK (length(provenance_json) BETWEEN 2 AND 65536),
            lifecycle_status TEXT NOT NULL CHECK (lifecycle_status IN ('draft', 'validated', 'published')),
            captured_utc TEXT NOT NULL CHECK (length(captured_utc) BETWEEN 1 AND 64),
            validated_utc TEXT NULL
                CHECK (validated_utc IS NULL OR length(validated_utc) BETWEEN 1 AND 64),
            published_utc TEXT NULL
                CHECK (published_utc IS NULL OR length(published_utc) BETWEEN 1 AND 64),
            CHECK (
                (lifecycle_status = 'draft' AND canonical_content_sha256 IS NULL
                    AND validated_utc IS NULL AND published_utc IS NULL)
                OR
                (lifecycle_status = 'validated' AND canonical_content_sha256 IS NOT NULL
                    AND validated_utc IS NOT NULL AND published_utc IS NULL)
                OR
                (lifecycle_status = 'published' AND canonical_content_sha256 IS NOT NULL
                    AND validated_utc IS NOT NULL AND published_utc IS NOT NULL)),
            UNIQUE (source_id, snapshot_sequence),
            UNIQUE (source_id, snapshot_id)
        ) STRICT;

        CREATE INDEX ix_reference_snapshots_source
            ON reference_snapshots (source_id, snapshot_sequence DESC, snapshot_id);

        CREATE TABLE reference_snapshot_records (
            snapshot_id TEXT NOT NULL
                REFERENCES reference_snapshots(snapshot_id) ON DELETE RESTRICT,
            entity_type TEXT NOT NULL CHECK (length(entity_type) BETWEEN 1 AND 64),
            source_record_key TEXT NOT NULL CHECK (length(source_record_key) BETWEEN 1 AND 512),
            source_location TEXT NULL
                CHECK (source_location IS NULL OR length(source_location) BETWEEN 1 AND 512),
            canonical_payload TEXT NOT NULL
                CHECK (length(canonical_payload) BETWEEN 2 AND 1048576),
            payload_sha256 TEXT NOT NULL
                CHECK (length(payload_sha256) = 64)
                CHECK (payload_sha256 = lower(payload_sha256))
                CHECK (payload_sha256 NOT GLOB '*[^0-9a-f]*'),
            PRIMARY KEY (snapshot_id, entity_type, source_record_key)
        ) STRICT;

        CREATE INDEX ix_reference_snapshot_records_type
            ON reference_snapshot_records (snapshot_id, entity_type, source_record_key);

        CREATE TABLE reference_snapshot_diagnostics (
            snapshot_id TEXT NOT NULL
                REFERENCES reference_snapshots(snapshot_id) ON DELETE RESTRICT,
            diagnostic_index INTEGER NOT NULL CHECK (diagnostic_index >= 0),
            severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'error')),
            code TEXT NOT NULL CHECK (length(code) BETWEEN 1 AND 64),
            entity_type TEXT NULL
                CHECK (entity_type IS NULL OR length(entity_type) BETWEEN 1 AND 64),
            source_record_key TEXT NULL
                CHECK (source_record_key IS NULL OR length(source_record_key) BETWEEN 1 AND 512),
            source_location TEXT NULL
                CHECK (source_location IS NULL OR length(source_location) BETWEEN 1 AND 512),
            field_name TEXT NULL
                CHECK (field_name IS NULL OR length(field_name) BETWEEN 1 AND 256),
            message TEXT NOT NULL CHECK (length(message) BETWEEN 1 AND 4096),
            diagnostic_sha256 TEXT NOT NULL
                CHECK (length(diagnostic_sha256) = 64)
                CHECK (diagnostic_sha256 = lower(diagnostic_sha256))
                CHECK (diagnostic_sha256 NOT GLOB '*[^0-9a-f]*'),
            PRIMARY KEY (snapshot_id, diagnostic_index)
        ) STRICT;

        CREATE INDEX ix_reference_snapshot_diagnostics_severity
            ON reference_snapshot_diagnostics (snapshot_id, severity, diagnostic_index);

        CREATE TABLE reference_source_heads (
            source_id TEXT NOT NULL PRIMARY KEY
                REFERENCES reference_sources(source_id) ON DELETE RESTRICT,
            snapshot_id TEXT NOT NULL UNIQUE,
            FOREIGN KEY (source_id, snapshot_id)
                REFERENCES reference_snapshots(source_id, snapshot_id) ON DELETE RESTRICT
        ) STRICT;

        CREATE TRIGGER enforce_reference_snapshot_update
        BEFORE UPDATE ON reference_snapshots
        WHEN OLD.snapshot_id <> NEW.snapshot_id
          OR OLD.source_id <> NEW.source_id
          OR OLD.snapshot_sequence <> NEW.snapshot_sequence
          OR NOT (
                (OLD.lifecycle_status = 'draft'
                    AND (
                        (NEW.lifecycle_status = 'draft'
                            AND OLD.canonical_content_sha256 IS NEW.canonical_content_sha256
                            AND OLD.validated_utc IS NEW.validated_utc
                            AND OLD.published_utc IS NEW.published_utc)
                        OR (NEW.lifecycle_status = 'validated'
                            AND OLD.contract_version = NEW.contract_version
                            AND OLD.source_version = NEW.source_version
                            AND OLD.source_content_sha256 = NEW.source_content_sha256
                            AND OLD.snapshot_metadata_sha256 = NEW.snapshot_metadata_sha256
                            AND OLD.provenance_json = NEW.provenance_json
                            AND OLD.captured_utc = NEW.captured_utc)))
                OR
                (OLD.lifecycle_status = 'validated'
                    AND NEW.lifecycle_status = 'published'
                    AND OLD.contract_version = NEW.contract_version
                    AND OLD.source_version = NEW.source_version
                    AND OLD.source_content_sha256 = NEW.source_content_sha256
                    AND OLD.snapshot_metadata_sha256 = NEW.snapshot_metadata_sha256
                    AND OLD.canonical_content_sha256 = NEW.canonical_content_sha256
                    AND OLD.provenance_json = NEW.provenance_json
                    AND OLD.captured_utc = NEW.captured_utc
                    AND OLD.validated_utc = NEW.validated_utc))
        BEGIN
            SELECT RAISE(ABORT, 'reference_snapshot_lifecycle_transition_is_invalid');
        END;

        CREATE TRIGGER prevent_reference_snapshot_delete
        BEFORE DELETE ON reference_snapshots
        WHEN OLD.lifecycle_status <> 'draft'
        BEGIN
            SELECT RAISE(ABORT, 'reference_snapshot_is_immutable');
        END;

        CREATE TRIGGER enforce_reference_snapshot_validation
        BEFORE UPDATE ON reference_snapshots
        WHEN OLD.lifecycle_status = 'draft'
          AND NEW.lifecycle_status = 'validated'
          AND EXISTS (
                SELECT 1 FROM reference_snapshot_diagnostics
                WHERE snapshot_id = OLD.snapshot_id AND severity = 'error')
        BEGIN
            SELECT RAISE(ABORT, 'reference_snapshot_has_validation_errors');
        END;

        CREATE TRIGGER prevent_record_insert_into_frozen_snapshot
        BEFORE INSERT ON reference_snapshot_records
        WHEN COALESCE((
            SELECT lifecycle_status FROM reference_snapshots
            WHERE snapshot_id = NEW.snapshot_id), '') <> 'draft'
        BEGIN
            SELECT RAISE(ABORT, 'reference_snapshot_is_frozen');
        END;

        CREATE TRIGGER prevent_frozen_reference_snapshot_record_update
        BEFORE UPDATE ON reference_snapshot_records
        WHEN COALESCE((
                SELECT lifecycle_status FROM reference_snapshots
                WHERE snapshot_id = OLD.snapshot_id), '') <> 'draft'
          OR COALESCE((
                SELECT lifecycle_status FROM reference_snapshots
                WHERE snapshot_id = NEW.snapshot_id), '') <> 'draft'
        BEGIN
            SELECT RAISE(ABORT, 'reference_snapshot_is_frozen');
        END;

        CREATE TRIGGER prevent_frozen_reference_snapshot_record_delete
        BEFORE DELETE ON reference_snapshot_records
        WHEN COALESCE((
            SELECT lifecycle_status FROM reference_snapshots
            WHERE snapshot_id = OLD.snapshot_id), '') <> 'draft'
        BEGIN
            SELECT RAISE(ABORT, 'reference_snapshot_is_frozen');
        END;

        CREATE TRIGGER prevent_reference_snapshot_record_reassignment
        BEFORE UPDATE ON reference_snapshot_records
        WHEN OLD.snapshot_id <> NEW.snapshot_id
        BEGIN
            SELECT RAISE(ABORT, 'reference_snapshot_record_cannot_be_reassigned');
        END;

        CREATE TRIGGER prevent_frozen_reference_snapshot_diagnostic_update
        BEFORE UPDATE ON reference_snapshot_diagnostics
        WHEN COALESCE((
                SELECT lifecycle_status FROM reference_snapshots
                WHERE snapshot_id = OLD.snapshot_id), '') <> 'draft'
          OR COALESCE((
                SELECT lifecycle_status FROM reference_snapshots
                WHERE snapshot_id = NEW.snapshot_id), '') <> 'draft'
        BEGIN
            SELECT RAISE(ABORT, 'reference_snapshot_is_frozen');
        END;

        CREATE TRIGGER prevent_frozen_reference_snapshot_diagnostic_delete
        BEFORE DELETE ON reference_snapshot_diagnostics
        WHEN COALESCE((
            SELECT lifecycle_status FROM reference_snapshots
            WHERE snapshot_id = OLD.snapshot_id), '') <> 'draft'
        BEGIN
            SELECT RAISE(ABORT, 'reference_snapshot_is_frozen');
        END;

        CREATE TRIGGER prevent_reference_snapshot_diagnostic_reassignment
        BEFORE UPDATE ON reference_snapshot_diagnostics
        WHEN OLD.snapshot_id <> NEW.snapshot_id
        BEGIN
            SELECT RAISE(ABORT, 'reference_snapshot_diagnostic_cannot_be_reassigned');
        END;

        CREATE TRIGGER prevent_diagnostic_insert_into_frozen_snapshot
        BEFORE INSERT ON reference_snapshot_diagnostics
        WHEN COALESCE((
            SELECT lifecycle_status FROM reference_snapshots
            WHERE snapshot_id = NEW.snapshot_id), '') <> 'draft'
        BEGIN
            SELECT RAISE(ABORT, 'reference_snapshot_is_frozen');
        END;

        CREATE TRIGGER enforce_published_reference_source_head_insert
        BEFORE INSERT ON reference_source_heads
        WHEN COALESCE((
                SELECT lifecycle_status FROM reference_snapshots
                WHERE snapshot_id = NEW.snapshot_id AND source_id = NEW.source_id), '') <> 'published'
        BEGIN
            SELECT RAISE(ABORT, 'reference_source_head_requires_published_snapshot');
        END;

        CREATE TRIGGER enforce_published_reference_source_head_update
        BEFORE UPDATE ON reference_source_heads
        WHEN COALESCE((
                SELECT lifecycle_status FROM reference_snapshots
                WHERE snapshot_id = NEW.snapshot_id AND source_id = NEW.source_id), '') <> 'published'
        BEGIN
            SELECT RAISE(ABORT, 'reference_source_head_requires_published_snapshot');
        END;
        """;

    private const string ReferenceSearchMigrationId = "M2-03-reference-catalog-search";
    private const string ReferenceSearchSchemaSql =
        """
        CREATE TABLE reference_search_projections (
            source_id TEXT NOT NULL PRIMARY KEY
                REFERENCES reference_sources(source_id) ON DELETE RESTRICT,
            snapshot_id TEXT NOT NULL UNIQUE,
            projection_version INTEGER NOT NULL CHECK (projection_version = 1),
            record_count INTEGER NOT NULL CHECK (record_count >= 0),
            UNIQUE (source_id, snapshot_id),
            FOREIGN KEY (source_id, snapshot_id)
                REFERENCES reference_snapshots(source_id, snapshot_id) ON DELETE RESTRICT
        ) STRICT;

        CREATE TABLE reference_search_records (
            search_id INTEGER NOT NULL PRIMARY KEY,
            source_id TEXT NOT NULL,
            snapshot_id TEXT NOT NULL,
            entity_type TEXT NOT NULL,
            source_record_key TEXT NOT NULL,
            normalized_source_key TEXT NOT NULL CHECK (length(normalized_source_key) BETWEEN 1 AND 512),
            search_text TEXT NOT NULL CHECK (length(search_text) BETWEEN 1 AND 1049600),
            UNIQUE (source_id, entity_type, source_record_key),
            FOREIGN KEY (source_id, snapshot_id)
                REFERENCES reference_search_projections(source_id, snapshot_id) ON DELETE CASCADE,
            FOREIGN KEY (snapshot_id, entity_type, source_record_key)
                REFERENCES reference_snapshot_records(snapshot_id, entity_type, source_record_key)
                ON DELETE RESTRICT
        ) STRICT;

        CREATE INDEX ix_reference_search_records_key
            ON reference_search_records
                (source_id, normalized_source_key, source_record_key, entity_type);
        CREATE INDEX ix_reference_search_records_type
            ON reference_search_records
                (source_id, entity_type, normalized_source_key, source_record_key);

        CREATE VIRTUAL TABLE reference_search_fts USING fts5(
            search_text,
            content='reference_search_records',
            content_rowid='search_id',
            tokenize='unicode61 remove_diacritics 0',
            prefix='2 3 4'
        );

        CREATE TRIGGER reference_search_records_ai AFTER INSERT ON reference_search_records BEGIN
            INSERT INTO reference_search_fts(rowid, search_text)
            VALUES (new.search_id, new.search_text);
        END;
        CREATE TRIGGER reference_search_records_ad AFTER DELETE ON reference_search_records BEGIN
            INSERT INTO reference_search_fts(reference_search_fts, rowid, search_text)
            VALUES ('delete', old.search_id, old.search_text);
        END;
        CREATE TRIGGER reference_search_records_au AFTER UPDATE ON reference_search_records BEGIN
            INSERT INTO reference_search_fts(reference_search_fts, rowid, search_text)
            VALUES ('delete', old.search_id, old.search_text);
            INSERT INTO reference_search_fts(rowid, search_text)
            VALUES (new.search_id, new.search_text);
        END;

        CREATE TABLE reference_search_fields (
            search_id INTEGER NOT NULL
                REFERENCES reference_search_records(search_id) ON DELETE CASCADE,
            field_ordinal INTEGER NOT NULL CHECK (field_ordinal >= 0),
            source_id TEXT NOT NULL,
            entity_type TEXT NOT NULL,
            source_record_key TEXT NOT NULL,
            source_field_name TEXT NOT NULL CHECK (length(source_field_name) >= 1),
            field_name TEXT NULL CHECK (field_name IS NULL OR length(field_name) BETWEEN 1 AND 256),
            value_kind TEXT NOT NULL CHECK (value_kind IN ('text', 'number', 'boolean', 'null', 'blank')),
            normalized_text TEXT NULL CHECK (normalized_text IS NULL OR length(normalized_text) <= 32767),
            PRIMARY KEY (search_id, field_ordinal)
        ) STRICT;

        CREATE INDEX ix_reference_search_fields_text
            ON reference_search_fields
                (source_id, field_name, normalized_text, entity_type, source_record_key);

        CREATE TABLE reference_catalog_saved_filters (
            filter_id TEXT NOT NULL PRIMARY KEY CHECK (length(filter_id) = 36),
            name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 128),
            normalized_name TEXT NOT NULL CHECK (length(normalized_name) BETWEEN 1 AND 128),
            source_id TEXT NOT NULL
                REFERENCES reference_sources(source_id) ON DELETE CASCADE,
            query_version INTEGER NOT NULL CHECK (query_version = 1),
            query_json TEXT NOT NULL CHECK (length(query_json) BETWEEN 2 AND 16384),
            query_sha256 TEXT NOT NULL
                CHECK (length(query_sha256) = 64)
                CHECK (query_sha256 = lower(query_sha256))
                CHECK (query_sha256 NOT GLOB '*[^0-9a-f]*'),
            created_utc TEXT NOT NULL CHECK (length(created_utc) BETWEEN 1 AND 64),
            updated_utc TEXT NOT NULL CHECK (length(updated_utc) BETWEEN 1 AND 64),
            UNIQUE (source_id, normalized_name)
        ) STRICT;

        """;

    internal const string EmptyHarnessDesignJson =
        "{\"schemaVersion\":1,\"connectors\":[],\"wires\":[],\"views\":{\"e4\":{\"layers\":[{\"id\":\"dimensions\",\"name\":\"Размеры\",\"order\":2,\"visible\":true,\"locked\":false},{\"id\":\"connectors\",\"name\":\"Соединители\",\"order\":1,\"visible\":true,\"locked\":false},{\"id\":\"wires\",\"name\":\"Провода\",\"order\":0,\"visible\":true,\"locked\":false}]},\"drawing\":{\"layers\":[{\"id\":\"dimensions\",\"name\":\"Размеры\",\"order\":2,\"visible\":true,\"locked\":false},{\"id\":\"connectors\",\"name\":\"Соединители\",\"order\":1,\"visible\":true,\"locked\":false},{\"id\":\"wires\",\"name\":\"Провода\",\"order\":0,\"visible\":true,\"locked\":false}]}}}";
    private const string HarnessDesignMigrationId = "E-01-harness-design-documents";
    private static readonly string HarnessDesignSchemaSql =
        $$"""
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
        SELECT harness_id, 0, 1, '{{EmptyHarnessDesignJson}}', created_utc, updated_utc
        FROM harnesses;

        CREATE TRIGGER create_harness_design_document
        AFTER INSERT ON harnesses
        BEGIN
            INSERT INTO harness_design_documents
                (harness_id, revision, schema_version, content_json, created_utc, updated_utc)
            VALUES (NEW.harness_id, 0, 1, '{{EmptyHarnessDesignJson}}', NEW.created_utc, NEW.updated_utc);
        END;
        """;

    private const string ComponentTemplateMigrationId = "M2-05-component-template-library";
    private const string ComponentTemplateSchemaSql =
        """
        CREATE TABLE component_templates (
            template_id TEXT NOT NULL PRIMARY KEY CHECK (length(template_id) = 36),
            current_version INTEGER NOT NULL CHECK (current_version >= 0),
            current_code TEXT NOT NULL CHECK (length(current_code) BETWEEN 1 AND 128),
            current_name TEXT NOT NULL CHECK (length(current_name) BETWEEN 1 AND 256),
            normalized_code TEXT NOT NULL CHECK (length(normalized_code) BETWEEN 1 AND 128),
            created_utc TEXT NOT NULL CHECK (length(created_utc) BETWEEN 1 AND 64),
            updated_utc TEXT NOT NULL CHECK (length(updated_utc) BETWEEN 1 AND 64),
            deleted_utc TEXT NULL CHECK (deleted_utc IS NULL OR length(deleted_utc) BETWEEN 1 AND 64)
        ) STRICT;

        CREATE UNIQUE INDEX ux_component_templates_active_code
            ON component_templates(normalized_code)
            WHERE deleted_utc IS NULL;

        CREATE TABLE component_template_versions (
            template_id TEXT NOT NULL REFERENCES component_templates(template_id)
                ON UPDATE CASCADE ON DELETE RESTRICT,
            version INTEGER NOT NULL CHECK (version > 0),
            schema_version INTEGER NOT NULL CHECK (schema_version = 1),
            code TEXT NOT NULL CHECK (length(code) BETWEEN 1 AND 128),
            name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 256),
            content_json TEXT NOT NULL CHECK (length(content_json) BETWEEN 2 AND 1048576)
                CHECK (json_valid(content_json)),
            content_sha256 TEXT NOT NULL
                CHECK (length(content_sha256) = 64)
                CHECK (content_sha256 = lower(content_sha256))
                CHECK (content_sha256 NOT GLOB '*[^0-9a-f]*'),
            version_sha256 TEXT NOT NULL
                CHECK (length(version_sha256) = 64)
                CHECK (version_sha256 = lower(version_sha256))
                CHECK (version_sha256 NOT GLOB '*[^0-9a-f]*'),
            created_utc TEXT NOT NULL CHECK (length(created_utc) BETWEEN 1 AND 64),
            PRIMARY KEY (template_id, version)
        ) STRICT;

        CREATE INDEX ix_component_template_versions_template
            ON component_template_versions(template_id, version DESC);

        CREATE TABLE component_template_article_bindings (
            template_id TEXT NOT NULL,
            version INTEGER NOT NULL,
            binding_ordinal INTEGER NOT NULL CHECK (binding_ordinal >= 0 AND binding_ordinal < 64),
            source_id TEXT NOT NULL CHECK (length(source_id) BETWEEN 1 AND 128),
            entity_type TEXT NOT NULL CHECK (length(entity_type) BETWEEN 1 AND 64),
            article_key TEXT NOT NULL CHECK (length(article_key) BETWEEN 1 AND 512),
            PRIMARY KEY (template_id, version, binding_ordinal),
            UNIQUE (template_id, version, source_id, entity_type, article_key),
            FOREIGN KEY (template_id, version)
                REFERENCES component_template_versions(template_id, version)
                ON UPDATE CASCADE ON DELETE RESTRICT
        ) STRICT;

        CREATE INDEX ix_component_template_bindings_article
            ON component_template_article_bindings(source_id, entity_type, article_key);

        CREATE TRIGGER enforce_component_template_version_append
        BEFORE INSERT ON component_template_versions
        WHEN NEW.version <> (
            SELECT current_version + 1
            FROM component_templates
            WHERE template_id = NEW.template_id)
        BEGIN
            SELECT RAISE(ABORT, 'component_template_version_not_append');
        END;

        CREATE TRIGGER enforce_component_template_head_publish
        BEFORE UPDATE OF current_version ON component_templates
        WHEN NEW.current_version <> OLD.current_version
        BEGIN
            SELECT CASE
                WHEN NEW.current_version <> OLD.current_version + 1
                  OR NOT EXISTS (
                      SELECT 1
                      FROM component_template_versions v
                      WHERE v.template_id = NEW.template_id
                        AND v.version = NEW.current_version
                        AND v.code = NEW.current_code
                        AND v.name = NEW.current_name)
                THEN RAISE(ABORT, 'component_template_head_invalid')
            END;
        END;

        CREATE TRIGGER prevent_component_template_binding_late_insert
        BEFORE INSERT ON component_template_article_bindings
        WHEN NEW.version <= (
            SELECT current_version
            FROM component_templates
            WHERE template_id = NEW.template_id)
        BEGIN
            SELECT RAISE(ABORT, 'component_template_binding_immutable');
        END;

        CREATE TRIGGER prevent_component_template_version_update
        BEFORE UPDATE ON component_template_versions
        BEGIN
            SELECT RAISE(ABORT, 'component_template_version_immutable');
        END;

        CREATE TRIGGER prevent_component_template_version_delete
        BEFORE DELETE ON component_template_versions
        BEGIN
            SELECT RAISE(ABORT, 'component_template_version_immutable');
        END;

        CREATE TRIGGER prevent_component_template_binding_update
        BEFORE UPDATE ON component_template_article_bindings
        BEGIN
            SELECT RAISE(ABORT, 'component_template_binding_immutable');
        END;

        CREATE TRIGGER prevent_component_template_binding_delete
        BEFORE DELETE ON component_template_article_bindings
        BEGIN
            SELECT RAISE(ABORT, 'component_template_binding_immutable');
        END;
        """;

    private const string ComponentTemplateAssetMigrationId = "M2-06A-component-template-assets";
    private const string ComponentTemplateAssetSchemaSql =
        """
        CREATE TABLE component_template_asset_refs (
            template_id TEXT NOT NULL,
            version INTEGER NOT NULL,
            asset_ordinal INTEGER NOT NULL CHECK (asset_ordinal >= 0 AND asset_ordinal < 64),
            asset_id TEXT NOT NULL CHECK (length(asset_id) = 36),
            file_name TEXT NOT NULL CHECK (length(file_name) BETWEEN 1 AND 255),
            media_type TEXT NOT NULL CHECK (media_type = 'image/png'),
            content_sha256 TEXT NOT NULL
                REFERENCES attachment_blobs(content_sha256) ON UPDATE CASCADE ON DELETE RESTRICT,
            PRIMARY KEY (template_id, version, asset_id),
            UNIQUE (template_id, version, asset_ordinal),
            FOREIGN KEY (template_id, version)
                REFERENCES component_template_versions(template_id, version)
                ON UPDATE CASCADE ON DELETE RESTRICT
        ) STRICT;

        CREATE INDEX ix_component_template_assets_content
            ON component_template_asset_refs(content_sha256, template_id, version);

        CREATE TRIGGER prevent_component_template_asset_late_insert
        BEFORE INSERT ON component_template_asset_refs
        WHEN NEW.version <= (
            SELECT current_version
            FROM component_templates
            WHERE template_id = NEW.template_id)
        BEGIN
            SELECT RAISE(ABORT, 'component_template_asset_immutable');
        END;

        CREATE TRIGGER prevent_component_template_asset_update
        BEFORE UPDATE ON component_template_asset_refs
        BEGIN
            SELECT RAISE(ABORT, 'component_template_asset_immutable');
        END;

        CREATE TRIGGER prevent_component_template_asset_delete
        BEFORE DELETE ON component_template_asset_refs
        BEGIN
            SELECT RAISE(ABORT, 'component_template_asset_immutable');
        END;
        """;

    private const string ComponentTemplateContentV2MigrationId = "M2-06D-component-template-content-v2";
    private const string ComponentTemplateContentV2SchemaSql =
        """
        DROP TRIGGER enforce_component_template_version_append;
        DROP TRIGGER enforce_component_template_head_publish;
        DROP TRIGGER prevent_component_template_binding_late_insert;
        DROP TRIGGER prevent_component_template_version_update;
        DROP TRIGGER prevent_component_template_version_delete;
        DROP TRIGGER prevent_component_template_binding_update;
        DROP TRIGGER prevent_component_template_binding_delete;
        DROP TRIGGER prevent_component_template_asset_late_insert;
        DROP TRIGGER prevent_component_template_asset_update;
        DROP TRIGGER prevent_component_template_asset_delete;
        DROP INDEX ix_component_template_versions_template;
        DROP INDEX ix_component_template_bindings_article;
        DROP INDEX ix_component_template_assets_content;

        ALTER TABLE component_template_article_bindings RENAME TO component_template_article_bindings_v1;
        ALTER TABLE component_template_asset_refs RENAME TO component_template_asset_refs_v1;
        ALTER TABLE component_template_versions RENAME TO component_template_versions_v1;

        CREATE TABLE component_template_versions (
            template_id TEXT NOT NULL REFERENCES component_templates(template_id)
                ON UPDATE CASCADE ON DELETE RESTRICT,
            version INTEGER NOT NULL CHECK (version > 0),
            schema_version INTEGER NOT NULL CHECK (schema_version IN (1, 2)),
            code TEXT NOT NULL CHECK (length(code) BETWEEN 1 AND 128),
            name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 256),
            content_json TEXT NOT NULL CHECK (length(content_json) BETWEEN 2 AND 1048576)
                CHECK (json_valid(content_json)),
            content_sha256 TEXT NOT NULL
                CHECK (length(content_sha256) = 64)
                CHECK (content_sha256 = lower(content_sha256))
                CHECK (content_sha256 NOT GLOB '*[^0-9a-f]*'),
            version_sha256 TEXT NOT NULL
                CHECK (length(version_sha256) = 64)
                CHECK (version_sha256 = lower(version_sha256))
                CHECK (version_sha256 NOT GLOB '*[^0-9a-f]*'),
            created_utc TEXT NOT NULL CHECK (length(created_utc) BETWEEN 1 AND 64),
            PRIMARY KEY (template_id, version)
        ) STRICT;

        CREATE INDEX ix_component_template_versions_template
            ON component_template_versions(template_id, version DESC);

        CREATE TABLE component_template_article_bindings (
            template_id TEXT NOT NULL,
            version INTEGER NOT NULL,
            binding_ordinal INTEGER NOT NULL CHECK (binding_ordinal >= 0 AND binding_ordinal < 64),
            source_id TEXT NOT NULL CHECK (length(source_id) BETWEEN 1 AND 128),
            entity_type TEXT NOT NULL CHECK (length(entity_type) BETWEEN 1 AND 64),
            article_key TEXT NOT NULL CHECK (length(article_key) BETWEEN 1 AND 512),
            PRIMARY KEY (template_id, version, binding_ordinal),
            UNIQUE (template_id, version, source_id, entity_type, article_key),
            FOREIGN KEY (template_id, version)
                REFERENCES component_template_versions(template_id, version)
                ON UPDATE CASCADE ON DELETE RESTRICT
        ) STRICT;

        CREATE INDEX ix_component_template_bindings_article
            ON component_template_article_bindings(source_id, entity_type, article_key);

        CREATE TABLE component_template_asset_refs (
            template_id TEXT NOT NULL,
            version INTEGER NOT NULL,
            asset_ordinal INTEGER NOT NULL CHECK (asset_ordinal >= 0 AND asset_ordinal < 64),
            asset_id TEXT NOT NULL CHECK (length(asset_id) = 36),
            file_name TEXT NOT NULL CHECK (length(file_name) BETWEEN 1 AND 255),
            media_type TEXT NOT NULL CHECK (media_type = 'image/png'),
            content_sha256 TEXT NOT NULL
                REFERENCES attachment_blobs(content_sha256) ON UPDATE CASCADE ON DELETE RESTRICT,
            PRIMARY KEY (template_id, version, asset_id),
            UNIQUE (template_id, version, asset_ordinal),
            FOREIGN KEY (template_id, version)
                REFERENCES component_template_versions(template_id, version)
                ON UPDATE CASCADE ON DELETE RESTRICT
        ) STRICT;

        CREATE INDEX ix_component_template_assets_content
            ON component_template_asset_refs(content_sha256, template_id, version);

        INSERT INTO component_template_versions
            (template_id, version, schema_version, code, name, content_json,
             content_sha256, version_sha256, created_utc)
        SELECT template_id, version, schema_version, code, name, content_json,
               content_sha256, version_sha256, created_utc
        FROM component_template_versions_v1;

        INSERT INTO component_template_article_bindings
            (template_id, version, binding_ordinal, source_id, entity_type, article_key)
        SELECT template_id, version, binding_ordinal, source_id, entity_type, article_key
        FROM component_template_article_bindings_v1;

        INSERT INTO component_template_asset_refs
            (template_id, version, asset_ordinal, asset_id, file_name, media_type, content_sha256)
        SELECT template_id, version, asset_ordinal, asset_id, file_name, media_type, content_sha256
        FROM component_template_asset_refs_v1;

        DROP TABLE component_template_asset_refs_v1;
        DROP TABLE component_template_article_bindings_v1;
        DROP TABLE component_template_versions_v1;

        CREATE TRIGGER enforce_component_template_version_append
        BEFORE INSERT ON component_template_versions
        WHEN NEW.version <> (
            SELECT current_version + 1
            FROM component_templates
            WHERE template_id = NEW.template_id)
        BEGIN
            SELECT RAISE(ABORT, 'component_template_version_not_append');
        END;

        CREATE TRIGGER enforce_component_template_head_publish
        BEFORE UPDATE OF current_version ON component_templates
        WHEN NEW.current_version <> OLD.current_version
        BEGIN
            SELECT CASE
                WHEN NEW.current_version <> OLD.current_version + 1
                  OR NOT EXISTS (
                      SELECT 1
                      FROM component_template_versions v
                      WHERE v.template_id = NEW.template_id
                        AND v.version = NEW.current_version
                        AND v.code = NEW.current_code
                        AND v.name = NEW.current_name)
                THEN RAISE(ABORT, 'component_template_head_invalid')
            END;
        END;

        CREATE TRIGGER prevent_component_template_binding_late_insert
        BEFORE INSERT ON component_template_article_bindings
        WHEN NEW.version <= (
            SELECT current_version
            FROM component_templates
            WHERE template_id = NEW.template_id)
        BEGIN
            SELECT RAISE(ABORT, 'component_template_binding_immutable');
        END;

        CREATE TRIGGER prevent_component_template_version_update
        BEFORE UPDATE ON component_template_versions
        BEGIN
            SELECT RAISE(ABORT, 'component_template_version_immutable');
        END;

        CREATE TRIGGER prevent_component_template_version_delete
        BEFORE DELETE ON component_template_versions
        BEGIN
            SELECT RAISE(ABORT, 'component_template_version_immutable');
        END;

        CREATE TRIGGER prevent_component_template_binding_update
        BEFORE UPDATE ON component_template_article_bindings
        BEGIN
            SELECT RAISE(ABORT, 'component_template_binding_immutable');
        END;

        CREATE TRIGGER prevent_component_template_binding_delete
        BEFORE DELETE ON component_template_article_bindings
        BEGIN
            SELECT RAISE(ABORT, 'component_template_binding_immutable');
        END;

        CREATE TRIGGER prevent_component_template_asset_late_insert
        BEFORE INSERT ON component_template_asset_refs
        WHEN NEW.version <= (
            SELECT current_version
            FROM component_templates
            WHERE template_id = NEW.template_id)
        BEGIN
            SELECT RAISE(ABORT, 'component_template_asset_immutable');
        END;

        CREATE TRIGGER prevent_component_template_asset_update
        BEFORE UPDATE ON component_template_asset_refs
        BEGIN
            SELECT RAISE(ABORT, 'component_template_asset_immutable');
        END;

        CREATE TRIGGER prevent_component_template_asset_delete
        BEFORE DELETE ON component_template_asset_refs
        BEGIN
            SELECT RAISE(ABORT, 'component_template_asset_immutable');
        END;
        """;

    private const string ComponentTemplateContentV3MigrationId = "M2-08-component-template-content-v3";
    private static readonly string ComponentTemplateContentV3SchemaSql =
        ComponentTemplateContentV2SchemaSql.Replace(
            "schema_version IN (1, 2)",
            "schema_version IN (1, 2, 3)",
            StringComparison.Ordinal);

    private const string ComponentTemplateArticleIndexV2MigrationId = "M2-08-component-template-article-index-v2";
    private const string ComponentTemplateArticleIndexV2SchemaSql =
        """
        DROP TRIGGER prevent_component_template_binding_late_insert;
        DROP TRIGGER prevent_component_template_binding_update;
        DROP TRIGGER prevent_component_template_binding_delete;
        DROP INDEX ix_component_template_bindings_article;

        ALTER TABLE component_template_article_bindings RENAME TO component_template_article_bindings_v1;
        CREATE TABLE component_template_article_bindings (
            template_id TEXT NOT NULL,
            version INTEGER NOT NULL,
            binding_ordinal INTEGER NOT NULL CHECK (binding_ordinal >= 0 AND binding_ordinal < 500),
            source_id TEXT NOT NULL CHECK (length(source_id) BETWEEN 1 AND 128),
            entity_type TEXT NOT NULL CHECK (length(entity_type) BETWEEN 1 AND 64),
            article_key TEXT NOT NULL CHECK (length(article_key) BETWEEN 1 AND 512),
            PRIMARY KEY (template_id, version, binding_ordinal),
            UNIQUE (template_id, version, source_id, entity_type, article_key),
            FOREIGN KEY (template_id, version)
                REFERENCES component_template_versions(template_id, version)
                ON UPDATE CASCADE ON DELETE RESTRICT
        ) STRICT;
        INSERT INTO component_template_article_bindings
            (template_id, version, binding_ordinal, source_id, entity_type, article_key)
        SELECT template_id, version, binding_ordinal, source_id, entity_type, article_key
        FROM component_template_article_bindings_v1;
        DROP TABLE component_template_article_bindings_v1;

        CREATE INDEX ix_component_template_bindings_article
            ON component_template_article_bindings(source_id, entity_type, article_key);
        CREATE TRIGGER prevent_component_template_binding_late_insert
        BEFORE INSERT ON component_template_article_bindings
        WHEN NEW.version <= (
            SELECT current_version
            FROM component_templates
            WHERE template_id = NEW.template_id)
        BEGIN
            SELECT RAISE(ABORT, 'component_template_binding_immutable');
        END;
        CREATE TRIGGER prevent_component_template_binding_update
        BEFORE UPDATE ON component_template_article_bindings
        BEGIN
            SELECT RAISE(ABORT, 'component_template_binding_immutable');
        END;
        CREATE TRIGGER prevent_component_template_binding_delete
        BEFORE DELETE ON component_template_article_bindings
        BEGIN
            SELECT RAISE(ABORT, 'component_template_binding_immutable');
        END;
        """;

    private const string ProjectComponentSnapshotsMigrationId = "M3-01-project-component-snapshots";
    private const string ProjectComponentSnapshotsSchemaSql =
        """
        CREATE TABLE project_component_snapshots (
            snapshot_id TEXT NOT NULL PRIMARY KEY CHECK (length(snapshot_id) = 36),
            project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
            source_template_id TEXT NOT NULL CHECK (length(source_template_id) = 36),
            source_version INTEGER NOT NULL CHECK (source_version > 0),
            source_version_sha256 TEXT NOT NULL
                CHECK (length(source_version_sha256) = 64)
                CHECK (source_version_sha256 = lower(source_version_sha256))
                CHECK (source_version_sha256 NOT GLOB '*[^0-9a-f]*'),
            schema_version INTEGER NOT NULL CHECK (schema_version = 3),
            code TEXT NOT NULL CHECK (length(code) BETWEEN 1 AND 128),
            name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 256),
            content_json TEXT NOT NULL CHECK (length(content_json) >= 2 AND json_valid(content_json)),
            content_sha256 TEXT NOT NULL
                CHECK (length(content_sha256) = 64)
                CHECK (content_sha256 = lower(content_sha256))
                CHECK (content_sha256 NOT GLOB '*[^0-9a-f]*'),
            created_utc TEXT NOT NULL,
            updated_utc TEXT NOT NULL,
            UNIQUE (project_id, source_template_id, source_version, source_version_sha256)
        ) STRICT;

        CREATE INDEX ix_project_component_snapshots_project
            ON project_component_snapshots(project_id, snapshot_id);

        CREATE TABLE project_component_snapshot_article_bindings (
            snapshot_id TEXT NOT NULL REFERENCES project_component_snapshots(snapshot_id)
                ON UPDATE CASCADE ON DELETE CASCADE,
            binding_ordinal INTEGER NOT NULL CHECK (binding_ordinal >= 0 AND binding_ordinal < 500),
            source_id TEXT NOT NULL CHECK (length(source_id) BETWEEN 1 AND 128),
            entity_type TEXT NOT NULL CHECK (length(entity_type) BETWEEN 1 AND 64),
            article_key TEXT NOT NULL CHECK (length(article_key) BETWEEN 1 AND 512),
            PRIMARY KEY (snapshot_id, binding_ordinal),
            UNIQUE (snapshot_id, source_id, entity_type, article_key)
        ) STRICT;

        CREATE TABLE project_component_snapshot_asset_refs (
            snapshot_id TEXT NOT NULL REFERENCES project_component_snapshots(snapshot_id)
                ON UPDATE CASCADE ON DELETE CASCADE,
            asset_ordinal INTEGER NOT NULL CHECK (asset_ordinal >= 0 AND asset_ordinal < 64),
            asset_id TEXT NOT NULL CHECK (length(asset_id) = 36),
            file_name TEXT NOT NULL CHECK (length(file_name) BETWEEN 1 AND 255),
            media_type TEXT NOT NULL CHECK (length(media_type) BETWEEN 1 AND 64),
            content_sha256 TEXT NOT NULL REFERENCES attachment_blobs(content_sha256) ON DELETE RESTRICT,
            PRIMARY KEY (snapshot_id, asset_id),
            UNIQUE (snapshot_id, asset_ordinal)
        ) STRICT;

        CREATE INDEX ix_project_component_snapshot_assets_content
            ON project_component_snapshot_asset_refs(content_sha256, snapshot_id);

        CREATE TABLE harness_component_placements (
            placement_id TEXT NOT NULL PRIMARY KEY CHECK (length(placement_id) = 36),
            harness_id TEXT NOT NULL REFERENCES harnesses(harness_id) ON DELETE CASCADE,
            snapshot_id TEXT NOT NULL REFERENCES project_component_snapshots(snapshot_id) ON DELETE RESTRICT,
            source_id TEXT NOT NULL CHECK (length(source_id) BETWEEN 1 AND 128),
            entity_type TEXT NOT NULL CHECK (length(entity_type) BETWEEN 1 AND 64),
            article_key TEXT NOT NULL CHECK (length(article_key) BETWEEN 1 AND 512),
            instance_json TEXT NOT NULL CHECK (length(instance_json) >= 2 AND json_valid(instance_json)),
            created_utc TEXT NOT NULL,
            updated_utc TEXT NOT NULL
        ) STRICT;

        CREATE INDEX ix_harness_component_placements_harness
            ON harness_component_placements(harness_id, placement_id);

        CREATE TABLE component_placement_commands (
            command_id TEXT NOT NULL PRIMARY KEY CHECK (length(command_id) = 36),
            harness_id TEXT NOT NULL REFERENCES harnesses(harness_id) ON DELETE CASCADE,
            placement_id TEXT NOT NULL UNIQUE REFERENCES harness_component_placements(placement_id) ON DELETE RESTRICT,
            snapshot_id TEXT NOT NULL REFERENCES project_component_snapshots(snapshot_id) ON DELETE RESTRICT,
            expected_revision INTEGER NOT NULL CHECK (expected_revision >= 0),
            resulting_revision INTEGER NOT NULL CHECK (resulting_revision = expected_revision + 1),
            request_json TEXT NOT NULL CHECK (length(request_json) >= 2 AND json_valid(request_json)),
            request_sha256 TEXT NOT NULL
                CHECK (length(request_sha256) = 64)
                CHECK (request_sha256 = lower(request_sha256))
                CHECK (request_sha256 NOT GLOB '*[^0-9a-f]*'),
            accepted_utc TEXT NOT NULL
        ) STRICT;

        CREATE TRIGGER prevent_component_placement_command_update
        BEFORE UPDATE ON component_placement_commands
        BEGIN SELECT RAISE(ABORT, 'component_placement_command_immutable'); END;
        CREATE TRIGGER prevent_component_placement_command_delete
        BEFORE DELETE ON component_placement_commands
        WHEN EXISTS (SELECT 1 FROM harnesses WHERE harness_id = OLD.harness_id)
        BEGIN SELECT RAISE(ABORT, 'component_placement_command_immutable'); END;

        CREATE TRIGGER enforce_component_snapshot_binding_insert
        BEFORE INSERT ON project_component_snapshot_article_bindings
        WHEN EXISTS (
            SELECT 1 FROM harness_component_placements p
            WHERE p.snapshot_id = NEW.snapshot_id)
        BEGIN
            SELECT RAISE(ABORT, 'project_component_snapshot_immutable');
        END;

        CREATE TRIGGER enforce_component_snapshot_asset_insert
        BEFORE INSERT ON project_component_snapshot_asset_refs
        WHEN EXISTS (
            SELECT 1 FROM harness_component_placements p
            WHERE p.snapshot_id = NEW.snapshot_id)
        BEGIN
            SELECT RAISE(ABORT, 'project_component_snapshot_immutable');
        END;

        CREATE TRIGGER prevent_component_snapshot_update
        BEFORE UPDATE ON project_component_snapshots
        BEGIN SELECT RAISE(ABORT, 'project_component_snapshot_immutable'); END;
        CREATE TRIGGER prevent_component_snapshot_delete
        BEFORE DELETE ON project_component_snapshots
        WHEN EXISTS (SELECT 1 FROM projects WHERE project_id = OLD.project_id)
        BEGIN SELECT RAISE(ABORT, 'project_component_snapshot_immutable'); END;
        CREATE TRIGGER prevent_component_snapshot_binding_update
        BEFORE UPDATE ON project_component_snapshot_article_bindings
        BEGIN SELECT RAISE(ABORT, 'project_component_snapshot_immutable'); END;
        CREATE TRIGGER prevent_component_snapshot_binding_delete
        BEFORE DELETE ON project_component_snapshot_article_bindings
        WHEN EXISTS (SELECT 1 FROM project_component_snapshots WHERE snapshot_id = OLD.snapshot_id)
        BEGIN SELECT RAISE(ABORT, 'project_component_snapshot_immutable'); END;
        CREATE TRIGGER prevent_component_snapshot_asset_update
        BEFORE UPDATE ON project_component_snapshot_asset_refs
        BEGIN SELECT RAISE(ABORT, 'project_component_snapshot_immutable'); END;
        CREATE TRIGGER prevent_component_snapshot_asset_delete
        BEFORE DELETE ON project_component_snapshot_asset_refs
        WHEN EXISTS (SELECT 1 FROM project_component_snapshots WHERE snapshot_id = OLD.snapshot_id)
        BEGIN SELECT RAISE(ABORT, 'project_component_snapshot_immutable'); END;

        CREATE TRIGGER enforce_component_placement_project
        BEFORE INSERT ON harness_component_placements
        WHEN (SELECT project_id FROM harnesses WHERE harness_id = NEW.harness_id) <>
             (SELECT project_id FROM project_component_snapshots WHERE snapshot_id = NEW.snapshot_id)
        BEGIN SELECT RAISE(ABORT, 'component_placement_project_mismatch'); END;
        """;

    private const string ComponentTemplateContentV4MigrationId = "M3-03-component-template-content-v4";
    private static readonly string ComponentTemplateContentV4SchemaSql =
        ComponentTemplateContentV2SchemaSql
            .Replace(
                "schema_version IN (1, 2)",
                "schema_version IN (1, 2, 3, 4)",
                StringComparison.Ordinal)
            .Replace(
                "binding_ordinal >= 0 AND binding_ordinal < 64",
                "binding_ordinal >= 0 AND binding_ordinal < 500",
                StringComparison.Ordinal);
    private const string ProjectComponentSnapshotsV4MigrationId = "M3-04-project-component-snapshots-v4";
    private static readonly string ProjectComponentSnapshotsV4SchemaSql =
        """
        DROP TRIGGER prevent_component_placement_command_update;
        DROP TRIGGER prevent_component_placement_command_delete;
        DROP TRIGGER enforce_component_snapshot_binding_insert;
        DROP TRIGGER enforce_component_snapshot_asset_insert;
        DROP TRIGGER prevent_component_snapshot_update;
        DROP TRIGGER prevent_component_snapshot_delete;
        DROP TRIGGER prevent_component_snapshot_binding_update;
        DROP TRIGGER prevent_component_snapshot_binding_delete;
        DROP TRIGGER prevent_component_snapshot_asset_update;
        DROP TRIGGER prevent_component_snapshot_asset_delete;
        DROP TRIGGER enforce_component_placement_project;

        CREATE TEMP TABLE snapshots_v4_backup AS SELECT * FROM project_component_snapshots;
        CREATE TEMP TABLE snapshot_bindings_v4_backup AS SELECT * FROM project_component_snapshot_article_bindings;
        CREATE TEMP TABLE snapshot_assets_v4_backup AS SELECT * FROM project_component_snapshot_asset_refs;
        CREATE TEMP TABLE placements_v4_backup AS SELECT * FROM harness_component_placements;
        CREATE TEMP TABLE placement_commands_v4_backup AS SELECT * FROM component_placement_commands;

        DROP TABLE component_placement_commands;
        DROP TABLE harness_component_placements;
        DROP TABLE project_component_snapshot_asset_refs;
        DROP TABLE project_component_snapshot_article_bindings;
        DROP TABLE project_component_snapshots;
        """ + ProjectComponentSnapshotsSchemaSql.Replace(
            "schema_version = 3",
            "schema_version IN (3, 4)",
            StringComparison.Ordinal) +
        """
        INSERT INTO project_component_snapshots SELECT * FROM snapshots_v4_backup;
        INSERT INTO project_component_snapshot_article_bindings SELECT * FROM snapshot_bindings_v4_backup;
        INSERT INTO project_component_snapshot_asset_refs SELECT * FROM snapshot_assets_v4_backup;
        INSERT INTO harness_component_placements SELECT * FROM placements_v4_backup;
        INSERT INTO component_placement_commands SELECT * FROM placement_commands_v4_backup;

        DROP TABLE snapshots_v4_backup;
        DROP TABLE snapshot_bindings_v4_backup;
        DROP TABLE snapshot_assets_v4_backup;
        DROP TABLE placements_v4_backup;
        DROP TABLE placement_commands_v4_backup;
        """;

    private const string ComponentTemplateContentV5MigrationId = "M3-05-component-template-content-v5";
    private static readonly string ComponentTemplateContentV5SchemaSql =
        ComponentTemplateContentV4SchemaSql.Replace(
            "schema_version IN (1, 2, 3, 4)",
            "schema_version IN (1, 2, 3, 4, 5)",
            StringComparison.Ordinal);

    private readonly string connectionString;
    private readonly int busyTimeoutMilliseconds;
    private readonly SemaphoreSlim writerGate = new(initialCount: 1, maxCount: 1);
    private readonly AsyncLocal<bool> transactionScope = new();
    private int disposed;

    private SqliteStorage(
        StorageGenerationLayout layout,
        string connectionString,
        int busyTimeoutMilliseconds,
        SqliteStorageDiagnostics diagnostics)
    {
        Layout = layout;
        this.connectionString = connectionString;
        this.busyTimeoutMilliseconds = busyTimeoutMilliseconds;
        Diagnostics = diagnostics;
    }

    public StorageGenerationLayout Layout { get; }

    public SqliteStorageDiagnostics Diagnostics { get; }

    public static SqliteStorage Open(
        string dataRoot,
        int busyTimeoutMilliseconds = DefaultBusyTimeoutMilliseconds)
    {
        if (busyTimeoutMilliseconds < 0)
        {
            throw new ArgumentOutOfRangeException(
                nameof(busyTimeoutMilliseconds),
                "The SQLite busy timeout must not be negative.");
        }

        var prepared = StorageGenerationLayout.Prepare(dataRoot);
        if (!prepared.Initialize)
        {
            var existingVersion = ReadExistingSchemaVersion(prepared.Layout.DatabasePath);
            if (existingVersion < CurrentSchemaVersion)
            {
                throw new StorageMigrationRequiredException(existingVersion, CurrentSchemaVersion);
            }
        }

        var initializationConnectionString = CreateConnectionString(
            prepared.Layout.DatabasePath,
            prepared.Initialize,
            busyTimeoutMilliseconds);
        var diagnostics = InitializeOrValidateDatabase(
            initializationConnectionString,
            prepared.Initialize,
            busyTimeoutMilliseconds);
        StorageGenerationLayout.PublishReadyAndCurrent(prepared);
        var connectionString = CreateConnectionString(
            prepared.Layout.DatabasePath,
            initialize: false,
            busyTimeoutMilliseconds);
        return new SqliteStorage(prepared.Layout, connectionString, busyTimeoutMilliseconds, diagnostics);
    }

    public void ExecuteInTransaction(Action<SqliteUnitOfWork> operation)
    {
        ArgumentNullException.ThrowIfNull(operation);
        ExecuteInTransaction(unitOfWork =>
        {
            operation(unitOfWork);
            return true;
        });
    }

    public T ExecuteInTransaction<T>(Func<SqliteUnitOfWork, T> operation)
    {
        ArgumentNullException.ThrowIfNull(operation);
        ThrowIfDisposed();
        ThrowIfNestedTransaction();
        writerGate.Wait();
        try
        {
            ThrowIfDisposed();
            transactionScope.Value = true;
            using var connection = OpenConfiguredConnection();
            using var transaction = connection.BeginTransaction(deferred: false);
            using var context = CreateDbContext(connection, transaction);
            var unitOfWork = new SqliteUnitOfWork(connection, transaction, context);
            try
            {
                var result = operation(unitOfWork);
                transaction.Commit();
                return result;
            }
            catch
            {
                TryRollback(transaction);
                throw;
            }
            finally
            {
                unitOfWork.Complete();
            }
        }
        finally
        {
            transactionScope.Value = false;
            writerGate.Release();
        }
    }

    public T ExecuteRead<T>(Func<SqliteUnitOfWork, T> operation)
    {
        ArgumentNullException.ThrowIfNull(operation);
        ThrowIfDisposed();
        ThrowIfNestedTransaction();
        transactionScope.Value = true;
        try
        {
            using var connection = OpenConfiguredConnection();
            using var transaction = connection.BeginTransaction(deferred: true);
            using var context = CreateDbContext(connection, transaction);
            var unitOfWork = new SqliteUnitOfWork(connection, transaction, context);
            try
            {
                var result = operation(unitOfWork);
                transaction.Commit();
                return result;
            }
            catch
            {
                TryRollback(transaction);
                throw;
            }
            finally
            {
                unitOfWork.Complete();
            }
        }
        finally
        {
            transactionScope.Value = false;
        }
    }

    public async Task<T> ExecuteReadAsync<T>(
        Func<SqliteUnitOfWork, CancellationToken, Task<T>> operation,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(operation);
        ThrowIfDisposed();
        ThrowIfNestedTransaction();
        transactionScope.Value = true;
        try
        {
            await using var connection = await OpenConfiguredConnectionAsync(cancellationToken).ConfigureAwait(false);
            await using var transaction = connection.BeginTransaction(deferred: true);
            await using var context = CreateDbContext(connection, transaction);
            var unitOfWork = new SqliteUnitOfWork(connection, transaction, context);
            try
            {
                var result = await operation(unitOfWork, cancellationToken).ConfigureAwait(false);
                await transaction.CommitAsync(cancellationToken).ConfigureAwait(false);
                return result;
            }
            catch
            {
                await TryRollbackAsync(transaction).ConfigureAwait(false);
                throw;
            }
            finally
            {
                unitOfWork.Complete();
            }
        }
        finally
        {
            transactionScope.Value = false;
        }
    }

    public Task ExecuteInTransactionAsync(
        Func<SqliteUnitOfWork, CancellationToken, Task> operation,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(operation);
        return ExecuteInTransactionAsync(
            async (unitOfWork, token) =>
            {
                await operation(unitOfWork, token).ConfigureAwait(false);
                return true;
            },
            cancellationToken);
    }

    public async Task<T> ExecuteInTransactionAsync<T>(
        Func<SqliteUnitOfWork, CancellationToken, Task<T>> operation,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(operation);
        ThrowIfDisposed();
        ThrowIfNestedTransaction();
        await writerGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            ThrowIfDisposed();
            transactionScope.Value = true;
            await using var connection = await OpenConfiguredConnectionAsync(cancellationToken)
                .ConfigureAwait(false);
            await using var transaction = connection.BeginTransaction(deferred: false);
            await using var context = CreateDbContext(connection, transaction);
            var unitOfWork = new SqliteUnitOfWork(connection, transaction, context);
            try
            {
                var result = await operation(unitOfWork, cancellationToken).ConfigureAwait(false);
                await transaction.CommitAsync(cancellationToken).ConfigureAwait(false);
                return result;
            }
            catch
            {
                await TryRollbackAsync(transaction).ConfigureAwait(false);
                throw;
            }
            finally
            {
                unitOfWork.Complete();
            }
        }
        finally
        {
            transactionScope.Value = false;
            writerGate.Release();
        }
    }

    public void Dispose()
    {
        Interlocked.Exchange(ref disposed, 1);
        GC.SuppressFinalize(this);
    }

    public ValueTask DisposeAsync()
    {
        Dispose();
        return ValueTask.CompletedTask;
    }

    private static string CreateConnectionString(
        string databasePath,
        bool initialize,
        int busyTimeoutMilliseconds) =>
        new SqliteConnectionStringBuilder
        {
            DataSource = databasePath,
            Mode = initialize ? SqliteOpenMode.ReadWriteCreate : SqliteOpenMode.ReadWrite,
            Cache = SqliteCacheMode.Private,
            Pooling = false,
            DefaultTimeout = Math.Max(1, (busyTimeoutMilliseconds + 999) / 1000),
        }.ToString();

    private static int ReadExistingSchemaVersion(string databasePath)
    {
        using var connection = new SqliteConnection(new SqliteConnectionStringBuilder
        {
            DataSource = databasePath,
            Mode = SqliteOpenMode.ReadOnly,
            Cache = SqliteCacheMode.Private,
            Pooling = false,
        }.ToString());
        connection.Open();
        return ValidateSchema(connection);
    }

    private static SqliteStorageDiagnostics InitializeOrValidateDatabase(
        string connectionString,
        bool initialize,
        int busyTimeoutMilliseconds)
    {
        using var connection = new SqliteConnection(connectionString);
        connection.Open();
        ConfigureConnection(connection, busyTimeoutMilliseconds);
        if (initialize)
        {
            InitializeSchema(connection);
        }

        var version = ValidateSchema(connection);
        if (!initialize && version < CurrentSchemaVersion)
        {
            throw new StorageMigrationRequiredException(version, CurrentSchemaVersion);
        }

        while (initialize && version < CurrentSchemaVersion)
        {
            version = ApplyNextMigration(connection, version);
        }

        version = ValidateSchema(connection);
        var foreignKeysEnabled = ExecuteScalarInt32(connection, "PRAGMA foreign_keys;") == 1;
        var effectiveBusyTimeout = ExecuteScalarInt32(connection, "PRAGMA busy_timeout;");
        var journalMode = ExecuteScalarString(connection, "PRAGMA journal_mode;");
        var synchronous = ExecuteScalarInt32(connection, "PRAGMA synchronous;");
        if (!foreignKeysEnabled ||
            effectiveBusyTimeout != busyTimeoutMilliseconds ||
            !string.Equals(journalMode, "wal", StringComparison.OrdinalIgnoreCase) ||
            synchronous != 2)
        {
            throw new InvalidOperationException("The required SQLite connection settings were not applied.");
        }

        var sqliteVersion = ExecuteScalarString(connection, "SELECT sqlite_version();");
        if (string.IsNullOrWhiteSpace(sqliteVersion))
        {
            throw new InvalidOperationException("The SQLite runtime version is unavailable.");
        }

        return new SqliteStorageDiagnostics(
            version,
            sqliteVersion,
            foreignKeysEnabled,
            effectiveBusyTimeout,
            journalMode);
    }

    private static void InitializeSchema(SqliteConnection connection)
    {
        using var transaction = connection.BeginTransaction(deferred: false);
        try
        {
            using var createHistory = connection.CreateCommand();
            createHistory.Transaction = transaction;
            createHistory.CommandText = InitialSchemaSql;
            createHistory.ExecuteNonQuery();

            using var insertInitial = connection.CreateCommand();
            insertInitial.Transaction = transaction;
            insertInitial.CommandText =
                """
                INSERT INTO schema_history
                    (version, migration_id, script_sha256, app_version, applied_utc, description)
                VALUES (
                    $version, $migrationId, $scriptHash, $appVersion, $appliedUtc, $description);
                """;
            insertInitial.Parameters.AddWithValue("$version", 1);
            insertInitial.Parameters.AddWithValue("$migrationId", InitialMigrationId);
            insertInitial.Parameters.AddWithValue(
                "$scriptHash",
                HashMigrationSql(InitialSchemaSql));
            insertInitial.Parameters.AddWithValue(
                "$appVersion",
                ApplicationInformationalVersion());
            insertInitial.Parameters.AddWithValue(
                "$appliedUtc",
                DateTimeOffset.UtcNow.ToString("O", CultureInfo.InvariantCulture));
            insertInitial.Parameters.AddWithValue("$description", "Initial storage schema");
            insertInitial.ExecuteNonQuery();

            using var setUserVersion = connection.CreateCommand();
            setUserVersion.Transaction = transaction;
            setUserVersion.CommandText = "PRAGMA user_version = 1;";
            setUserVersion.ExecuteNonQuery();
            transaction.Commit();
        }
        catch
        {
            TryRollback(transaction);
            throw;
        }
    }

    internal static int ValidateSchema(SqliteConnection connection)
    {
        var history = ExecuteScalarInt32(
            connection,
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='schema_history';");
        if (history != 1)
        {
            throw new InvalidDataException("The SQLite schema history is missing.");
        }

        var userVersion = ExecuteScalarInt32(connection, "PRAGMA user_version;");
        using var historyCommand = connection.CreateCommand();
        historyCommand.CommandText =
            "SELECT version, migration_id, script_sha256 FROM schema_history ORDER BY version;";
        using var reader = historyCommand.ExecuteReader();
        var rows = new List<(int Version, string MigrationId, string ScriptHash)>();
        while (reader.Read())
        {
            rows.Add((reader.GetInt32(0), reader.GetString(1), reader.GetString(2)));
        }

        if (rows.Count == 0 ||
            userVersion <= 0 ||
            userVersion > CurrentSchemaVersion ||
            rows.Count != userVersion)
        {
            throw new InvalidDataException(
                $"The database schema version is inconsistent or unsupported: " +
                $"rows={rows.Count}, user_version={userVersion}.");
        }

        var expected = new[]
        {
            (Version: 1, MigrationId: InitialMigrationId, Sql: InitialSchemaSql),
            (Version: 2, MigrationId: ProjectMigrationId, Sql: ProjectSchemaSql),
            (Version: 3, MigrationId: ProjectDataMigrationId, Sql: ProjectDataSchemaSql),
            (Version: 4, MigrationId: ProjectCommandMigrationId, Sql: ProjectCommandSchemaSql),
            (Version: 5, MigrationId: ProjectImportMigrationId, Sql: ProjectImportSchemaSql),
            (Version: 6, MigrationId: HarnessWorkspaceMigrationId, Sql: HarnessWorkspaceSchemaSql),
            (Version: 7, MigrationId: ReferenceSnapshotMigrationId, Sql: ReferenceSnapshotSchemaSql),
            (Version: 8, MigrationId: ReferenceSearchMigrationId, Sql: ReferenceSearchSchemaSql),
            (Version: 9, MigrationId: HarnessDesignMigrationId, Sql: HarnessDesignSchemaSql),
            (Version: 10, MigrationId: ComponentTemplateMigrationId, Sql: ComponentTemplateSchemaSql),
            (Version: 11, MigrationId: ComponentTemplateAssetMigrationId, Sql: ComponentTemplateAssetSchemaSql),
            (Version: 12, MigrationId: ComponentTemplateContentV2MigrationId, Sql: ComponentTemplateContentV2SchemaSql),
            (Version: 13, MigrationId: ComponentTemplateContentV3MigrationId, Sql: ComponentTemplateContentV3SchemaSql),
            (Version: 14, MigrationId: ComponentTemplateArticleIndexV2MigrationId, Sql: ComponentTemplateArticleIndexV2SchemaSql),
            (Version: 15, MigrationId: ProjectComponentSnapshotsMigrationId, Sql: ProjectComponentSnapshotsSchemaSql),
            (Version: 16, MigrationId: ComponentTemplateContentV4MigrationId, Sql: ComponentTemplateContentV4SchemaSql),
            (Version: 17, MigrationId: ProjectComponentSnapshotsV4MigrationId, Sql: ProjectComponentSnapshotsV4SchemaSql),
            (Version: 18, MigrationId: ComponentTemplateContentV5MigrationId, Sql: ComponentTemplateContentV5SchemaSql),
        };
        for (var index = 0; index < rows.Count; index++)
        {
            var row = rows[index];
            var migration = expected[index];
            var expectedHash = HashMigrationSql(migration.Sql);
            if (row.Version != migration.Version ||
                !string.Equals(row.MigrationId, migration.MigrationId, StringComparison.Ordinal) ||
                !string.Equals(row.ScriptHash, expectedHash, StringComparison.Ordinal))
            {
                throw new InvalidDataException(
                    $"The database schema history is inconsistent at version {index + 1}.");
            }
        }

        ValidateSchemaShape(connection, userVersion);

        return userVersion;
    }

    internal static void InitializeSchemaAtVersion(SqliteConnection connection, int targetVersion)
    {
        ArgumentNullException.ThrowIfNull(connection);
        if (targetVersion is < 1 or > CurrentSchemaVersion)
        {
            throw new ArgumentOutOfRangeException(nameof(targetVersion));
        }

        InitializeSchema(connection);
        var version = 1;
        while (version < targetVersion)
        {
            version = ApplyNextMigration(connection, version);
        }
    }

    private static void ValidateSchemaShape(SqliteConnection connection, int schemaVersion)
    {
        var expected = BuildExpectedSchemaShape(schemaVersion);
        var actual = ReadSchemaShape(connection);
        if (!actual.SequenceEqual(expected))
        {
            throw new InvalidDataException(
                $"The database schema shape is inconsistent at version {schemaVersion}.");
        }
    }

    private static IReadOnlyList<SchemaObject> BuildExpectedSchemaShape(int schemaVersion)
    {
        using var expected = new SqliteConnection("Data Source=:memory:;Mode=Memory;Pooling=False");
        expected.Open();
        ExecuteSchemaSql(expected, InitialSchemaSql);
        if (schemaVersion >= 2)
        {
            ExecuteSchemaSql(expected, ProjectSchemaSql);
        }

        if (schemaVersion >= 3)
        {
            ExecuteSchemaSql(expected, ProjectDataSchemaSql);
        }

        if (schemaVersion >= 4)
        {
            ExecuteSchemaSql(expected, ProjectCommandSchemaSql);
        }

        if (schemaVersion >= 5)
        {
            ExecuteSchemaSql(expected, ProjectImportSchemaSql);
        }

        if (schemaVersion >= 6)
        {
            ExecuteSchemaSql(expected, HarnessWorkspaceSchemaSql);
        }

        if (schemaVersion >= 7)
        {
            ExecuteSchemaSql(expected, ReferenceSnapshotSchemaSql);
        }

        if (schemaVersion >= 8)
        {
            ExecuteSchemaSql(expected, ReferenceSearchSchemaSql);
        }

        if (schemaVersion >= 9)
        {
            ExecuteSchemaSql(expected, HarnessDesignSchemaSql);
        }

        if (schemaVersion >= 10)
        {
            ExecuteSchemaSql(expected, ComponentTemplateSchemaSql);
        }

        if (schemaVersion >= 11)
        {
            ExecuteSchemaSql(expected, ComponentTemplateAssetSchemaSql);
        }

        if (schemaVersion >= 12)
        {
            ExecuteSchemaSql(expected, ComponentTemplateContentV2SchemaSql);
        }

        if (schemaVersion >= 13)
        {
            ExecuteSchemaSql(expected, ComponentTemplateContentV3SchemaSql);
        }

        if (schemaVersion >= 14)
        {
            ExecuteSchemaSql(expected, ComponentTemplateArticleIndexV2SchemaSql);
        }

        if (schemaVersion >= 15)
        {
            ExecuteSchemaSql(expected, ProjectComponentSnapshotsSchemaSql);
        }

        if (schemaVersion >= 16)
        {
            ExecuteSchemaSql(expected, ComponentTemplateContentV4SchemaSql);
        }

        if (schemaVersion >= 17)
        {
            ExecuteSchemaSql(expected, ProjectComponentSnapshotsV4SchemaSql);
        }

        if (schemaVersion >= 18)
        {
            ExecuteSchemaSql(expected, ComponentTemplateContentV5SchemaSql);
        }

        return ReadSchemaShape(expected);
    }

    private static void ExecuteSchemaSql(SqliteConnection connection, string sql)
    {
        using var command = connection.CreateCommand();
        command.CommandText = sql;
        command.ExecuteNonQuery();
    }

    private static IReadOnlyList<SchemaObject> ReadSchemaShape(SqliteConnection connection)
    {
        using var command = connection.CreateCommand();
        command.CommandText =
            """
            SELECT type, name, tbl_name, sql
            FROM sqlite_schema
            WHERE type IN ('table', 'index', 'trigger')
              AND name NOT LIKE 'sqlite_%'
              AND sql IS NOT NULL
            ORDER BY type, name;
            """;
        using var reader = command.ExecuteReader();
        var result = new List<SchemaObject>();
        while (reader.Read())
        {
            result.Add(new SchemaObject(
                reader.GetString(0),
                reader.GetString(1),
                reader.GetString(2),
                NormalizeSchemaSql(reader.GetString(3))));
        }

        return result;
    }

    private static string NormalizeSchemaSql(string sql) =>
        string.Join(' ', sql.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));

    private sealed record SchemaObject(string Type, string Name, string TableName, string Sql);

    internal static int ApplyNextMigration(
        SqliteConnection connection,
        int currentVersion,
        Action? beforeCommit = null)
    {
        var migration = currentVersion switch
        {
            1 => (
                Version: 2,
                MigrationId: ProjectMigrationId,
                Sql: ProjectSchemaSql,
                Description: "Projects and harnesses"),
            2 => (
                Version: 3,
                MigrationId: ProjectDataMigrationId,
                Sql: ProjectDataSchemaSql,
                Description: "Attachments and pinned external data"),
            3 => (
                Version: 4,
                MigrationId: ProjectCommandMigrationId,
                Sql: ProjectCommandSchemaSql,
                Description: "Project revisions and immutable command journal"),
            4 => (
                Version: 5,
                MigrationId: ProjectImportMigrationId,
                Sql: ProjectImportSchemaSql,
                Description: "Project import provenance"),
            5 => (
                Version: 6,
                MigrationId: HarnessWorkspaceMigrationId,
                Sql: HarnessWorkspaceSchemaSql,
                Description: "Harness quantities and document workspaces"),
            6 => (
                Version: 7,
                MigrationId: ReferenceSnapshotMigrationId,
                Sql: ReferenceSnapshotSchemaSql,
                Description: "Versioned external reference snapshots"),
            7 => (
                Version: 8,
                MigrationId: ReferenceSearchMigrationId,
                Sql: ReferenceSearchSchemaSql,
                Description: "Indexed reference catalog search"),
            8 => (
                Version: 9,
                MigrationId: HarnessDesignMigrationId,
                Sql: HarnessDesignSchemaSql,
                Description: "Shared harness design documents"),
            9 => (
                Version: 10,
                MigrationId: ComponentTemplateMigrationId,
                Sql: ComponentTemplateSchemaSql,
                Description: "Versioned component template library"),
            10 => (
                Version: 11,
                MigrationId: ComponentTemplateAssetMigrationId,
                Sql: ComponentTemplateAssetSchemaSql,
                Description: "Immutable component template image assets"),
            11 => (
                Version: 12,
                MigrationId: ComponentTemplateContentV2MigrationId,
                Sql: ComponentTemplateContentV2SchemaSql,
                Description: "Component template content schema version 2"),
            12 => (
                Version: 13,
                MigrationId: ComponentTemplateContentV3MigrationId,
                Sql: ComponentTemplateContentV3SchemaSql,
                Description: "Component template content schema version 3"),
            13 => (
                Version: 14,
                MigrationId: ComponentTemplateArticleIndexV2MigrationId,
                Sql: ComponentTemplateArticleIndexV2SchemaSql,
                Description: "Component template article index capacity 500"),
            14 => (
                Version: 15,
                MigrationId: ProjectComponentSnapshotsMigrationId,
                Sql: ProjectComponentSnapshotsSchemaSql,
                Description: "Project-owned component snapshots and harness placements"),
            15 => (
                Version: 16,
                MigrationId: ComponentTemplateContentV4MigrationId,
                Sql: ComponentTemplateContentV4SchemaSql,
                Description: "E4 connector series table content schema version 4"),
            16 => (
                Version: 17,
                MigrationId: ProjectComponentSnapshotsV4MigrationId,
                Sql: ProjectComponentSnapshotsV4SchemaSql,
                Description: "Project component snapshots support content schema version 4"),
            17 => (
                Version: 18,
                MigrationId: ComponentTemplateContentV5MigrationId,
                Sql: ComponentTemplateContentV5SchemaSql,
                Description: "Component template content schema version 5"),
            _ => throw new InvalidDataException(
                $"No supported migration follows storage schema {currentVersion}."),
        };

        if (migration.Version != currentVersion + 1)
        {
            throw new InvalidDataException(
                $"No supported migration follows storage schema {currentVersion}.");
        }

        using var transaction = connection.BeginTransaction(deferred: false);
        try
        {
            using (var migrate = connection.CreateCommand())
            {
                migrate.Transaction = transaction;
                migrate.CommandText = migration.Sql;
                migrate.ExecuteNonQuery();
            }

            if (migration.Version == 8)
            {
                ReferenceCatalogSearchProjection.Backfill(connection, transaction);
            }

            using (var appendHistory = connection.CreateCommand())
            {
                appendHistory.Transaction = transaction;
                appendHistory.CommandText =
                    """
                    INSERT INTO schema_history
                        (version, migration_id, script_sha256, app_version, applied_utc, description)
                    VALUES (
                        $version, $migrationId, $scriptHash, $appVersion, $appliedUtc, $description);
                    """;
                appendHistory.Parameters.AddWithValue("$version", migration.Version);
                appendHistory.Parameters.AddWithValue("$migrationId", migration.MigrationId);
                appendHistory.Parameters.AddWithValue(
                    "$scriptHash",
                    HashMigrationSql(migration.Sql));
                appendHistory.Parameters.AddWithValue("$appVersion", ApplicationInformationalVersion());
                appendHistory.Parameters.AddWithValue(
                    "$appliedUtc",
                    DateTimeOffset.UtcNow.ToString("O", CultureInfo.InvariantCulture));
                appendHistory.Parameters.AddWithValue("$description", migration.Description);
                appendHistory.ExecuteNonQuery();
            }

            beforeCommit?.Invoke();

            using (var setUserVersion = connection.CreateCommand())
            {
                setUserVersion.Transaction = transaction;
                setUserVersion.CommandText = $"PRAGMA user_version = {migration.Version};";
                setUserVersion.ExecuteNonQuery();
            }

            transaction.Commit();
            return migration.Version;
        }
        catch
        {
            TryRollback(transaction);
            throw;
        }
    }

    internal static bool HasCompleteMigrationPath(int sourceVersion, int targetVersion)
    {
        if (sourceVersion <= 0 || targetVersion < sourceVersion || targetVersion > CurrentSchemaVersion)
        {
            return false;
        }

        for (var version = sourceVersion; version < targetVersion; version++)
        {
            if (version is not (1 or 2 or 3 or 4 or 5 or 6 or 7 or 8 or 9 or 10 or 11 or 12 or 13 or 14 or 15 or 16 or 17))
            {
                return false;
            }
        }

        return true;
    }

    private static string ApplicationInformationalVersion() =>
        typeof(SqliteStorage).Assembly
            .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?
            .InformationalVersion ?? "unknown";

    private static string HashMigrationSql(string sql) =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(
            sql.Replace("\r\n", "\n", StringComparison.Ordinal).Replace('\r', '\n'))));

    private SqliteConnection OpenConfiguredConnection()
    {
        var connection = new SqliteConnection(connectionString);
        try
        {
            connection.Open();
            ConfigureConnection(connection, busyTimeoutMilliseconds);
            return connection;
        }
        catch
        {
            connection.Dispose();
            throw;
        }
    }

    private static TechmapDbContext CreateDbContext(
        SqliteConnection connection,
        SqliteTransaction transaction)
    {
        var options = new DbContextOptionsBuilder<TechmapDbContext>()
            .UseSqlite(connection)
            .Options;
        var context = new TechmapDbContext(options);
        context.Database.UseTransaction(transaction);
        return context;
    }

    private async Task<SqliteConnection> OpenConfiguredConnectionAsync(
        CancellationToken cancellationToken)
    {
        var connection = new SqliteConnection(connectionString);
        try
        {
            await connection.OpenAsync(cancellationToken).ConfigureAwait(false);
            ConfigureConnection(connection, busyTimeoutMilliseconds);
            return connection;
        }
        catch
        {
            await connection.DisposeAsync().ConfigureAwait(false);
            throw;
        }
    }

    private static void ConfigureConnection(
        SqliteConnection connection,
        int busyTimeoutMilliseconds)
    {
        using (var pragmas = connection.CreateCommand())
        {
            pragmas.CommandText = $"""
                PRAGMA foreign_keys = ON;
                PRAGMA busy_timeout = {busyTimeoutMilliseconds};
                PRAGMA synchronous = FULL;
                """;
            pragmas.ExecuteNonQuery();
        }

        using var journal = connection.CreateCommand();
        journal.CommandText = "PRAGMA journal_mode = WAL;";
        var journalMode = Convert.ToString(journal.ExecuteScalar(), CultureInfo.InvariantCulture);
        if (!string.Equals(journalMode, "wal", StringComparison.OrdinalIgnoreCase) ||
            ExecuteScalarInt32(connection, "PRAGMA foreign_keys;") != 1 ||
            ExecuteScalarInt32(connection, "PRAGMA busy_timeout;") != busyTimeoutMilliseconds ||
            ExecuteScalarInt32(connection, "PRAGMA synchronous;") != 2)
        {
            throw new InvalidOperationException("The required SQLite connection settings were not applied.");
        }
    }

    private static int ExecuteScalarInt32(SqliteConnection connection, string commandText) =>
        Convert.ToInt32(ExecuteScalar(connection, commandText), CultureInfo.InvariantCulture);

    private static string ExecuteScalarString(SqliteConnection connection, string commandText) =>
        Convert.ToString(ExecuteScalar(connection, commandText), CultureInfo.InvariantCulture)
            ?? throw new InvalidDataException("A required SQLite value is missing.");

    private static object? ExecuteScalar(SqliteConnection connection, string commandText)
    {
        using var command = connection.CreateCommand();
        command.CommandText = commandText;
        return command.ExecuteScalar();
    }

    private static void TryRollback(SqliteTransaction transaction)
    {
        try
        {
            transaction.Rollback();
        }
        catch (Exception error) when (error is SqliteException or InvalidOperationException)
        {
            // Preserve the original operation or commit exception.
        }
    }

    private static async Task TryRollbackAsync(SqliteTransaction transaction)
    {
        try
        {
            await transaction.RollbackAsync(CancellationToken.None).ConfigureAwait(false);
        }
        catch (Exception error) when (error is SqliteException or InvalidOperationException)
        {
            // Preserve the original operation or commit exception.
        }
    }

    private void ThrowIfDisposed()
    {
        ObjectDisposedException.ThrowIf(Volatile.Read(ref disposed) != 0, this);
    }

    private void ThrowIfNestedTransaction()
    {
        if (transactionScope.Value)
        {
            throw new InvalidOperationException(
                "A nested SQLite unit of work is not supported on the same execution context.");
        }
    }
}

public sealed class StorageMigrationRequiredException : IOException
{
    public StorageMigrationRequiredException(int foundSchemaVersion, int requiredSchemaVersion)
        : base($"Storage schema {foundSchemaVersion} requires offline migration to {requiredSchemaVersion}.")
    {
        FoundSchemaVersion = foundSchemaVersion;
        RequiredSchemaVersion = requiredSchemaVersion;
    }

    public int FoundSchemaVersion { get; }

    public int RequiredSchemaVersion { get; }
}
