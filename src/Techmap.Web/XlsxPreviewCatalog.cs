using System.Text;
using Techmap.Infrastructure.Xlsx;

namespace Techmap.Web;

public sealed record StoredXlsxPreview(Guid Id, DateTimeOffset ExpiresUtc);

public sealed class XlsxPreviewCatalog
{
    public const int MaximumEntries = 8;
    public const long MaximumEntryBytes = 32L * 1024 * 1024;
    public const long MaximumTotalBytes = 64L * 1024 * 1024;

    private static readonly TimeSpan Lifetime = TimeSpan.FromMinutes(30);
    private readonly Lock gate = new();
    private readonly Dictionary<Guid, Entry> entries = [];
    private readonly SemaphoreSlim importGate = new(1, 1);
    private long retainedBytes;

    public IDisposable? TryBeginImport() => importGate.Wait(0) ? new ImportLease(importGate) : null;

    public StoredXlsxPreview Add(string sourceId, XlsxCatalogPreview preview, Guid? activeSnapshotId)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(sourceId);
        ArgumentNullException.ThrowIfNull(preview);
        var estimatedBytes = EstimateBytes(preview);
        if (estimatedBytes > MaximumEntryBytes)
            throw new XlsxPreviewCatalogException("xlsx_preview_too_large", "Результат импорта слишком велик для безопасного предварительного просмотра.");

        lock (gate)
        {
            var now = DateTimeOffset.UtcNow;
            PurgeExpired(now);
            while (entries.Count >= MaximumEntries || retainedBytes + estimatedBytes > MaximumTotalBytes)
            {
                if (entries.Count == 0)
                    throw new XlsxPreviewCatalogException("xlsx_preview_too_large", "Результат импорта слишком велик для безопасного предварительного просмотра.");
                Remove(entries.MinBy(item => item.Value.ExpiresUtc).Key);
            }

            var id = Guid.NewGuid();
            var expiresUtc = now.Add(Lifetime);
            entries.Add(id, new Entry(sourceId, preview, activeSnapshotId, expiresUtc, estimatedBytes));
            retainedBytes += estimatedBytes;
            return new StoredXlsxPreview(id, expiresUtc);
        }
    }

    public bool TryGet(Guid id, string sourceId, out XlsxCatalogPreview preview, out Guid? activeSnapshotId)
    {
        lock (gate)
        {
            PurgeExpired(DateTimeOffset.UtcNow);
            if (entries.TryGetValue(id, out var entry) &&
                string.Equals(entry.SourceId, sourceId, StringComparison.Ordinal))
            {
                preview = entry.Preview;
                activeSnapshotId = entry.ActiveSnapshotId;
                return true;
            }
        }

        preview = null!;
        activeSnapshotId = null;
        return false;
    }

    private void PurgeExpired(DateTimeOffset now)
    {
        foreach (var id in entries.Where(item => item.Value.ExpiresUtc <= now).Select(item => item.Key).ToArray())
            Remove(id);
    }

    private void Remove(Guid id)
    {
        if (entries.Remove(id, out var removed)) retainedBytes -= removed.EstimatedBytes;
    }

    private static long EstimateBytes(XlsxCatalogPreview preview)
    {
        var snapshotBytes = preview.Validation.Snapshot is { } snapshot
            ? Encoding.UTF8.GetByteCount(snapshot.CanonicalJson)
            : 0;
        var diagnosticBytes = preview.Validation.Diagnostics.Sum(item =>
            (long)Encoding.UTF8.GetByteCount(item.Message) +
            Encoding.UTF8.GetByteCount(item.Code) +
            Encoding.UTF8.GetByteCount(item.SourceLocation ?? "") + 256);
        var previewBytes = preview.Records.Sum(item =>
            (long)Encoding.UTF8.GetByteCount(item.Payload.GetRawText()) +
            Encoding.UTF8.GetByteCount(item.SourceKey) + 128);
        return checked(snapshotBytes + diagnosticBytes + previewBytes + 4_096);
    }

    private sealed record Entry(
        string SourceId,
        XlsxCatalogPreview Preview,
        Guid? ActiveSnapshotId,
        DateTimeOffset ExpiresUtc,
        long EstimatedBytes);

    private sealed class ImportLease(SemaphoreSlim semaphore) : IDisposable
    {
        private SemaphoreSlim? owned = semaphore;
        public void Dispose() => Interlocked.Exchange(ref owned, null)?.Release();
    }
}

public sealed class XlsxPreviewCatalogException(string code, string message) : Exception(message)
{
    public string Code { get; } = code;
}
