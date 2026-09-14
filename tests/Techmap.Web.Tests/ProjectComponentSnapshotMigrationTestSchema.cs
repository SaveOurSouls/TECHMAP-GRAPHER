using Microsoft.Data.Sqlite;

namespace Techmap.Web.Tests;

internal static class ProjectComponentSnapshotMigrationTestSchema
{
    internal static void Drop(SqliteConnection connection)
    {
        using var command = connection.CreateCommand();
        command.CommandText =
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
            DROP TABLE component_placement_commands;
            DROP TABLE harness_component_placements;
            DROP TABLE project_component_snapshot_asset_refs;
            DROP TABLE project_component_snapshot_article_bindings;
            DROP TABLE project_component_snapshots;
            """;
        command.ExecuteNonQuery();
    }
}
