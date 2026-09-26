using System.Text.Json;

namespace Techmap.Contracts;

public sealed record PutHarnessDesignRecoveryRequest(long Sequence, long BaseRevision, JsonElement Content);

public sealed record HarnessDesignRecoveryResponse(
    Guid DraftId, long Sequence, long BaseRevision, JsonElement Content,
    long ServerRevision, JsonElement ServerContent, DateTimeOffset SavedUtc);
