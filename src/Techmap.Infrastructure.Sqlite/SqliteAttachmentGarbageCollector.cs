using System.Globalization;

namespace Techmap.Infrastructure.Sqlite;

/// <summary>
/// Startup-only maintenance. The caller must hold the exclusive data-root lease and
/// must invoke this before request handlers or other blob writers can run.
/// </summary>
internal static class SqliteAttachmentGarbageCollector
{
    public static int Prune(SqliteStorage storage, TimeProvider? timeProvider = null)
    {
        ArgumentNullException.ThrowIfNull(storage);
        var cutoff = (timeProvider ?? TimeProvider.System).GetUtcNow().ToUniversalTime().AddDays(-1);
        var referenced = storage.ExecuteRead(unitOfWork =>
        {
            using var command = unitOfWork.CreateCommand(
                """
                SELECT content_sha256 FROM project_attachments
                UNION
                SELECT content_sha256 FROM component_template_asset_refs;
                """);
            using var reader = command.ExecuteReader();
            var result = new HashSet<string>(StringComparer.Ordinal);
            while (reader.Read()) result.Add(reader.GetString(0));
            return result;
        });

        var removed = new ContentAddressedAttachmentStore(storage.Layout.DataRootPath)
            .PruneUnreferencedBlobs(referenced, cutoff);
        storage.ExecuteInTransaction(unitOfWork =>
        {
            using var command = unitOfWork.CreateCommand(
                """
                DELETE FROM attachment_blobs
                WHERE created_utc < $cutoff
                  AND NOT EXISTS (
                      SELECT 1 FROM project_attachments p
                      WHERE p.content_sha256 = attachment_blobs.content_sha256)
                  AND NOT EXISTS (
                      SELECT 1 FROM component_template_asset_refs a
                      WHERE a.content_sha256 = attachment_blobs.content_sha256);
                """);
            command.Parameters.AddWithValue(
                "$cutoff", cutoff.ToString("O", CultureInfo.InvariantCulture));
            command.ExecuteNonQuery();
        });
        return removed;
    }
}
