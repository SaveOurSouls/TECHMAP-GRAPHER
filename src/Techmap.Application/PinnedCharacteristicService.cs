using Techmap.Domain;

namespace Techmap.Application;

public sealed record ExternalCharacteristicSourceRecord(
    string SourceVersionFingerprint,
    string CharacteristicName,
    string CharacteristicValue,
    string? Unit);

public interface IExternalCharacteristicSource
{
    ExternalCharacteristicSourceRecord Read(string sourceKind, string sourceRecordKey);
}

public interface IPinnedCharacteristicStore
{
    ExternalCharacteristicSnapshot AddOrGet(
        ProjectIdentity projectId,
        ExternalCharacteristicSnapshot snapshot);

    IReadOnlyList<ExternalCharacteristicSnapshot> List(ProjectIdentity projectId);
}

public interface IPinnedCharacteristicCommandStore : IPinnedCharacteristicStore
{
    ProjectMutationResult<ExternalCharacteristicSnapshot> AddOrGet(
        ProjectIdentity projectId,
        ProjectCommandEnvelope envelope,
        string sourceKind,
        string sourceRecordKey,
        Func<ExternalCharacteristicSnapshot> snapshotFactory);

    ProjectMutationResult<ExternalCharacteristicSnapshot> AddOrGet(
        ProjectIdentity projectId,
        ProjectCommandEnvelope envelope,
        ExternalCharacteristicSnapshot snapshot);
}

public sealed class PinnedCharacteristicService(
    IExternalCharacteristicSource source,
    IPinnedCharacteristicStore store,
    TimeProvider timeProvider)
{
    public ProjectMutationResult<ExternalCharacteristicSnapshot> Pin(
        ProjectIdentity projectId,
        ProjectCommandEnvelope envelope,
        string sourceKind,
        string sourceRecordKey)
    {
        if (store is not IPinnedCharacteristicCommandStore commandStore)
        {
            throw new InvalidOperationException("The characteristic store does not support project commands.");
        }

        return commandStore.AddOrGet(projectId, envelope, sourceKind, sourceRecordKey, () =>
        {
            var record = source.Read(sourceKind, sourceRecordKey)
                ?? throw new InvalidDataException("The external characteristic source returned no record.");
            return ExternalCharacteristicSnapshot.Capture(
                CharacteristicSnapshotIdentity.New(), sourceKind, sourceRecordKey,
                record.SourceVersionFingerprint, record.CharacteristicName,
                record.CharacteristicValue, record.Unit, timeProvider.GetUtcNow());
        });
    }

    public ExternalCharacteristicSnapshot Pin(
        ProjectIdentity projectId,
        string sourceKind,
        string sourceRecordKey)
    {
        if (projectId.Value == Guid.Empty)
        {
            throw new ArgumentException("The project ID must not be empty.", nameof(projectId));
        }

        var record = source.Read(sourceKind, sourceRecordKey)
            ?? throw new InvalidDataException("The external characteristic source returned no record.");
        var snapshot = ExternalCharacteristicSnapshot.Capture(
            CharacteristicSnapshotIdentity.New(),
            sourceKind,
            sourceRecordKey,
            record.SourceVersionFingerprint,
            record.CharacteristicName,
            record.CharacteristicValue,
            record.Unit,
            timeProvider.GetUtcNow());
        return store.AddOrGet(projectId, snapshot);
    }
}
