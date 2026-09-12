using System.Buffers;
using System.Security.Cryptography;
using Techmap.Application;

namespace Techmap.Infrastructure.Sqlite;

public sealed record StoredAttachment(string Sha256, long Length);

/// <summary>
/// Stores immutable attachment bytes outside SQLite and addresses them by SHA-256.
/// Database records can retain only <see cref="StoredAttachment.Sha256"/> and
/// <see cref="StoredAttachment.Length"/>.
/// </summary>
public sealed class ContentAddressedAttachmentStore : IAttachmentContentStore
{
    private const int BufferSize = 128 * 1024;
    private const string AttachmentsDirectoryName = "attachments";
    private const string BlobsDirectoryName = "blobs";
    private const string StagingDirectoryName = "staging";
    private static readonly TimeSpan StagingRetention = TimeSpan.FromDays(1);

    private readonly string blobsPath;
    private readonly string stagingPath;

    public ContentAddressedAttachmentStore(string dataRoot)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(dataRoot);

        var resolvedDataRoot = Path.GetFullPath(dataRoot);
        Directory.CreateDirectory(resolvedDataRoot);
        RejectReparsePoint(resolvedDataRoot, "The attachment data root must not be a reparse point.");

        var attachmentsPath = CreateOrdinaryDirectory(
            Path.Combine(resolvedDataRoot, AttachmentsDirectoryName),
            "The attachments directory must not be a reparse point.");
        blobsPath = CreateOrdinaryDirectory(
            Path.Combine(attachmentsPath, BlobsDirectoryName),
            "The attachment blob directory must not be a reparse point.");
        stagingPath = CreateOrdinaryDirectory(
            Path.Combine(attachmentsPath, StagingDirectoryName),
            "The attachment staging directory must not be a reparse point.");
        CleanupStagingFiles();
    }

    public async Task<StoredAttachment> WriteAsync(
        Stream source,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(source);
        if (!source.CanRead)
        {
            throw new ArgumentException("The attachment source stream must be readable.", nameof(source));
        }

        var stagingFile = Path.Combine(stagingPath, $"{Guid.NewGuid():N}.staging");
        try
        {
            var attachment = await WriteStagingFileAsync(source, stagingFile, cancellationToken)
                .ConfigureAwait(false);
            var destination = BlobPath(attachment);
            var shardPath = CreateOrdinaryDirectory(
                Path.GetDirectoryName(destination)
                    ?? throw new InvalidOperationException("The attachment blob path has no parent."),
                "An attachment blob shard must not be a reparse point.");
            RejectReparsePoint(shardPath, "An attachment blob shard must not be a reparse point.");

            try
            {
                File.Move(stagingFile, destination, overwrite: false);
            }
            catch (IOException) when (File.Exists(destination))
            {
                // Concurrent or prior publication of identical content is a successful deduplication.
                await ValidateFileAsync(destination, attachment, cancellationToken).ConfigureAwait(false);
            }

            return attachment;
        }
        finally
        {
            File.Delete(stagingFile);
        }
    }

    public async Task ValidateAsync(
        StoredAttachment attachment,
        CancellationToken cancellationToken = default)
    {
        ValidateReference(attachment);
        var path = BlobPath(attachment);
        await ValidateFileAsync(path, attachment, cancellationToken).ConfigureAwait(false);
    }

    public async Task<FileStream> OpenReadVerifiedAsync(
        StoredAttachment attachment,
        CancellationToken cancellationToken = default)
    {
        ValidateReference(attachment);
        var path = BlobPath(attachment);
        var stream = OpenExistingBlob(path);
        try
        {
            await ValidateStreamAsync(stream, attachment, cancellationToken).ConfigureAwait(false);
            stream.Position = 0;
            return stream;
        }
        catch
        {
            await stream.DisposeAsync().ConfigureAwait(false);
            throw;
        }
    }

    async Task<AttachmentContent> IAttachmentContentStore.WriteAsync(
        Stream source,
        CancellationToken cancellationToken)
    {
        var stored = await WriteAsync(source, cancellationToken).ConfigureAwait(false);
        return new AttachmentContent(stored.Sha256, stored.Length);
    }

    Task IAttachmentContentStore.ValidateAsync(
        AttachmentContent content,
        CancellationToken cancellationToken) =>
        ValidateAsync(new StoredAttachment(content.Sha256, content.SizeBytes), cancellationToken);

    async Task<Stream> IAttachmentContentStore.OpenReadVerifiedAsync(
        AttachmentContent content,
        CancellationToken cancellationToken) =>
        await OpenReadVerifiedAsync(
            new StoredAttachment(content.Sha256, content.SizeBytes),
            cancellationToken).ConfigureAwait(false);

    private static async Task<StoredAttachment> WriteStagingFileAsync(
        Stream source,
        string stagingFile,
        CancellationToken cancellationToken)
    {
        await using var destination = new FileStream(
            stagingFile,
            FileMode.CreateNew,
            FileAccess.Write,
            FileShare.None,
            BufferSize,
            FileOptions.Asynchronous | FileOptions.SequentialScan | FileOptions.WriteThrough);
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        var buffer = ArrayPool<byte>.Shared.Rent(BufferSize);
        long length = 0;
        try
        {
            while (true)
            {
                var count = await source.ReadAsync(buffer.AsMemory(0, BufferSize), cancellationToken)
                    .ConfigureAwait(false);
                if (count == 0)
                {
                    break;
                }

                hash.AppendData(buffer, 0, count);
                length = checked(length + count);
                await destination.WriteAsync(buffer.AsMemory(0, count), cancellationToken)
                    .ConfigureAwait(false);
            }

            await destination.FlushAsync(cancellationToken).ConfigureAwait(false);
            destination.Flush(flushToDisk: true);
            return new StoredAttachment(Convert.ToHexStringLower(hash.GetHashAndReset()), length);
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(buffer);
        }
    }

    private async Task ValidateFileAsync(
        string path,
        StoredAttachment attachment,
        CancellationToken cancellationToken)
    {
        ValidateReference(attachment);
        await using var stream = OpenExistingBlob(path);
        await ValidateStreamAsync(stream, attachment, cancellationToken).ConfigureAwait(false);
    }

    private static async Task ValidateStreamAsync(
        FileStream stream,
        StoredAttachment attachment,
        CancellationToken cancellationToken)
    {
        if (stream.Length != attachment.Length)
        {
            throw new InvalidDataException(
                $"Attachment '{attachment.Sha256}' has an unexpected length.");
        }

        stream.Position = 0;
        var actualHash = Convert.ToHexStringLower(
            await SHA256.HashDataAsync(stream, cancellationToken).ConfigureAwait(false));
        if (!string.Equals(actualHash, attachment.Sha256, StringComparison.Ordinal))
        {
            throw new InvalidDataException(
                $"Attachment '{attachment.Sha256}' failed SHA-256 validation.");
        }
    }

    private FileStream OpenExistingBlob(string path)
    {
        var shardPath = Path.GetDirectoryName(path)
            ?? throw new InvalidOperationException("The attachment blob path has no parent.");
        if (!Directory.Exists(shardPath) || !File.Exists(path))
        {
            throw new FileNotFoundException("The attachment content is missing.", path);
        }

        RejectReparsePoint(shardPath, "An attachment blob shard must not be a reparse point.");
        RejectReparsePoint(path, "An attachment blob must not be a reparse point.");
        return new FileStream(
            path,
            FileMode.Open,
            FileAccess.Read,
            FileShare.Read,
            BufferSize,
            FileOptions.Asynchronous | FileOptions.SequentialScan);
    }

    private string BlobPath(StoredAttachment attachment) =>
        Path.Combine(blobsPath, attachment.Sha256[..2], attachment.Sha256);

    private void CleanupStagingFiles()
    {
        var cutoff = DateTime.UtcNow - StagingRetention;
        foreach (var file in Directory.EnumerateFiles(stagingPath, "*.staging", SearchOption.TopDirectoryOnly))
        {
            try
            {
                RejectReparsePoint(file, "An attachment staging file must not be a reparse point.");
                if (File.GetLastWriteTimeUtc(file) < cutoff)
                {
                    File.Delete(file);
                }
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException)
            {
                // A concurrently removed or inaccessible stale file remains invisible until a later cleanup.
            }
        }
    }

    private static void ValidateReference(StoredAttachment attachment)
    {
        ArgumentNullException.ThrowIfNull(attachment);
        if (attachment.Length < 0)
        {
            throw new ArgumentOutOfRangeException(
                nameof(attachment),
                "The attachment length must not be negative.");
        }

        if (attachment.Sha256.Length != 64 ||
            attachment.Sha256.Any(character =>
                character is not (>= '0' and <= '9') and not (>= 'a' and <= 'f')))
        {
            throw new ArgumentException(
                "The attachment SHA-256 must contain exactly 64 lowercase hexadecimal characters.",
                nameof(attachment));
        }
    }

    private static string CreateOrdinaryDirectory(string path, string reparsePointMessage)
    {
        Directory.CreateDirectory(path);
        RejectReparsePoint(path, reparsePointMessage);
        return path;
    }

    private static void RejectReparsePoint(string path, string message)
    {
        if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0)
        {
            throw new InvalidDataException(message);
        }
    }
}
