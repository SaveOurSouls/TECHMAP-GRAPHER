using Techmap.Domain;

namespace Techmap.Application;

public sealed record HarnessDesignDocument(
    HarnessIdentity HarnessId,
    long Revision,
    int SchemaVersion,
    string ContentJson,
    DateTimeOffset CreatedUtc,
    DateTimeOffset UpdatedUtc,
    string? SourceFingerprint = null,
    long? HarnessQuantity = null);

public interface IHarnessDesignDocumentStore
{
    HarnessDesignDocument Get(ProjectIdentity projectId, HarnessIdentity harnessId);

    HarnessDesignDocument Put(
        ProjectIdentity projectId,
        HarnessIdentity harnessId,
        long expectedRevision,
        int schemaVersion,
        string contentJson,
        int? writerContractVersion = null);
}

public sealed class HarnessDesignDocumentException : Exception
{
    public HarnessDesignDocumentException(
        string code,
        string message,
        string? field = null,
        long? currentRevision = null,
        Exception? innerException = null)
        : base(message, innerException)
    {
        Code = code;
        Field = field;
        CurrentRevision = currentRevision;
    }

    public string Code { get; }

    public string? Field { get; }

    public long? CurrentRevision { get; }
}
