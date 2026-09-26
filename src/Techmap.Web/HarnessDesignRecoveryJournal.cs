using System.Text.Json;
using Techmap.Application;
using Techmap.Contracts;
using Techmap.Domain;

namespace Techmap.Web;

/// <summary>Crash journal in the portable data root. Deliberately outside published project exports.</summary>
public sealed class HarnessDesignRecoveryJournal(string dataRoot, IHarnessDesignDocumentStore designs)
{
    public const int MaximumDrafts = 32;
    public const int MaximumContentBytes = 1024 * 1024;
    private readonly object gate = new();
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    public IReadOnlyList<HarnessDesignRecoveryResponse> List(Guid project, Guid harness)
    {
        lock (gate)
        {
            _ = designs.Get(new ProjectIdentity(project), new HarnessIdentity(harness));
            var directory = DirectoryPath(project, harness);
            return !Directory.Exists(directory) ? [] : Directory.EnumerateFiles(directory, "*.json")
                .Select(Read).OrderByDescending(d => d.SavedUtc).ToArray();
        }
    }

    public HarnessDesignRecoveryResponse Put(Guid project, Guid harness, Guid id, PutHarnessDesignRecoveryRequest request)
    {
        if (id == Guid.Empty || request.Sequence < 1 || request.BaseRevision < 0 ||
            request.Content.ValueKind != JsonValueKind.Object)
            throw new HarnessDesignDocumentException("invalid_recovery_draft", "Invalid recovery draft.");
        if (System.Text.Encoding.UTF8.GetByteCount(request.Content.GetRawText()) > MaximumContentBytes)
            throw new HarnessDesignDocumentException("recovery_too_large", "Recovery draft exceeds 1 MiB.");
        lock (gate)
        {
            var server = designs.Get(new ProjectIdentity(project), new HarnessIdentity(harness));
            var path = FilePath(project, harness, id);
            var previous = File.Exists(path) ? Read(path) : null;
            if (previous is not null && request.Sequence <= previous.Sequence)
            {
                if (request.Sequence == previous.Sequence && request.BaseRevision == previous.BaseRevision &&
                    JsonElement.DeepEquals(request.Content, previous.Content)) return previous;
                throw new HarnessDesignDocumentException("recovery_sequence_conflict", "A newer recovery draft is already stored.");
            }
            var directory = DirectoryPath(project, harness);
            Directory.CreateDirectory(directory);
            if (previous is null && Directory.EnumerateFiles(directory, "*.json").Take(MaximumDrafts).Count() >= MaximumDrafts)
                throw new HarnessDesignDocumentException("recovery_limit", "Recovery journal is full. Export or remove an old recovery copy before continuing.");
            using var serverContent = JsonDocument.Parse(server.ContentJson);
            var result = new HarnessDesignRecoveryResponse(id, request.Sequence, request.BaseRevision,
                request.Content.Clone(), previous?.ServerRevision ?? server.Revision,
                previous?.ServerContent ?? serverContent.RootElement.Clone(), DateTimeOffset.UtcNow);
            var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try
            {
                using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                {
                    JsonSerializer.Serialize(stream, result, JsonOptions);
                    stream.Flush(flushToDisk: true);
                }
                File.Move(temporary, path, overwrite: true);
            }
            finally { File.Delete(temporary); }
            return result;
        }
    }

    public void Delete(Guid project, Guid harness, Guid id, long sequence)
    {
        lock (gate)
        {
            _ = designs.Get(new ProjectIdentity(project), new HarnessIdentity(harness));
            var path = FilePath(project, harness, id);
            if (!File.Exists(path)) return;
            if (Read(path).Sequence != sequence)
                throw new HarnessDesignDocumentException("recovery_sequence_conflict", "The recovery copy changed and was preserved.");
            File.Delete(path);
        }
    }

    private string DirectoryPath(Guid project, Guid harness) => Path.Combine(dataRoot, "recovery", project.ToString("D"), harness.ToString("D"));
    private string FilePath(Guid project, Guid harness, Guid id) => Path.Combine(DirectoryPath(project, harness), id.ToString("D") + ".json");
    private static HarnessDesignRecoveryResponse Read(string path)
    {
        if (new FileInfo(path).Length > 2L * MaximumContentBytes + 8192)
            throw new InvalidDataException("Recovery file exceeds the journal limit.");
        return JsonSerializer.Deserialize<HarnessDesignRecoveryResponse>(File.ReadAllText(path), JsonOptions)
            ?? throw new InvalidDataException("Recovery file is empty.");
    }
}
