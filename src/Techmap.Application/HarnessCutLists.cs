using System.Text.Json;
using Techmap.Domain;

namespace Techmap.Application;

public sealed record HarnessCutListItem(
    string WireId,
    string Circuit,
    string Material,
    string? MaterialSourceKey,
    string? MaterialDisplayName,
    decimal? SourceLengthMm,
    decimal EndCorrectionFromMm,
    decimal EndCorrectionToMm,
    decimal RoundingStepMm,
    decimal? CutLengthMm,
    long Pieces,
    decimal? TotalMetres,
    string Status,
    IReadOnlyList<string> Warnings);

public sealed record HarnessCutList(
    ProjectIdentity ProjectId,
    HarnessIdentity HarnessId,
    long HarnessQuantity,
    string Status,
    string Warning,
    IReadOnlyList<HarnessCutListItem> Items);

public interface IHarnessCutListService
{
    HarnessCutList Get(ProjectIdentity projectId, HarnessIdentity harnessId);
}

public sealed class HarnessCutListException : Exception
{
    public HarnessCutListException(
        string code,
        string message,
        string? field = null,
        Exception? innerException = null)
        : base(message, innerException)
    {
        Code = code;
        Field = field;
    }

    public string Code { get; }

    public string? Field { get; }
}

public sealed class HarnessCutListService(
    IProjectCatalog projectCatalog,
    IHarnessDesignDocumentStore designStore) : IHarnessCutListService
{
    public const string LimitedStatus = "limited";
    public const string ReadyStatus = "ready";
    public const string IncompleteStatus = "incomplete";
    public const string NotPinnedMaterial = "not-pinned";
    public const string MaterialWarning =
        "Материал провода не закреплён. Карта показывает длины заготовок, но пока не является спецификацией материалов.";
    public const string MissingMaterialWarning = "Материал провода не закреплён.";
    public const string MissingLengthWarning = "Не указана конечная длина провода.";
    public const string MissingMaterialWarningCode = "material-missing";
    public const string MissingLengthWarningCode = "length-missing";

    public HarnessCutList Get(ProjectIdentity projectId, HarnessIdentity harnessId)
    {
        ProjectDetails project;
        try
        {
            project = projectCatalog.GetProject(projectId);
        }
        catch (ProjectCatalogException error)
        {
            throw new HarnessCutListException(error.Code, error.Message, error.Field, error);
        }

        var harness = project.Harnesses.SingleOrDefault(candidate => candidate.HarnessId == harnessId);
        if (harness is null)
        {
            throw new HarnessCutListException(
                "harness_not_found",
                "The harness does not exist in this project.");
        }

        HarnessDesignDocument design;
        try
        {
            design = designStore.Get(projectId, harnessId);
        }
        catch (HarnessDesignDocumentException error)
        {
            throw new HarnessCutListException(error.Code, error.Message, error.Field, error);
        }

        if (design.SchemaVersion != 1)
        {
            throw InvalidDesign(
                "Only harness design schemaVersion 1 can be used to build a cut list.",
                "schemaVersion");
        }

        try
        {
            using var document = JsonDocument.Parse(design.ContentJson, new JsonDocumentOptions
            {
                AllowTrailingCommas = false,
                CommentHandling = JsonCommentHandling.Disallow,
                MaxDepth = 128,
            });
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object ||
                !root.TryGetProperty("schemaVersion", out var schemaVersion) ||
                schemaVersion.ValueKind != JsonValueKind.Number ||
                !schemaVersion.TryGetInt32(out var parsedSchemaVersion) ||
                parsedSchemaVersion != 1)
            {
                throw InvalidDesign(
                    "Only harness design content schemaVersion 1 can be used to build a cut list.",
                    "content.schemaVersion");
            }
            if (!root.TryGetProperty("wires", out var wires) || wires.ValueKind != JsonValueKind.Array)
            {
                throw InvalidDesign("The harness design wires collection is invalid.", "content.wires");
            }

            var items = new List<HarnessCutListItem>(wires.GetArrayLength());
            var wireIds = new HashSet<string>(StringComparer.Ordinal);
            var index = 0;
            foreach (var wire in wires.EnumerateArray())
            {
                var path = $"content.wires[{index}]";
                if (wire.ValueKind != JsonValueKind.Object)
                    throw InvalidDesign("A harness design wire must be an object.", path);

                var wireId = RequiredString(wire, "id", $"{path}.id");
                if (!wireIds.Add(wireId))
                    throw InvalidDesign("Harness design wire IDs must be unique.", $"{path}.id");
                var circuit = RequiredString(wire, "circuit", $"{path}.circuit", allowEmpty: true);
                var material = MaterialBindingOrMissing(wire, path);
                var sourceLength = NullableLength(wire, "lengthMm", $"{path}.lengthMm");
                var fromCorrection = CorrectionOrDefault(
                    wire, "endCorrectionFromMm", $"{path}.endCorrectionFromMm");
                var toCorrection = CorrectionOrDefault(
                    wire, "endCorrectionToMm", $"{path}.endCorrectionToMm");
                var roundingStep = LengthOrDefault(
                    wire, "cutRoundingStepMm", 1m, $"{path}.cutRoundingStepMm");
                if (roundingStep.Micrometres == 0)
                    throw InvalidDesign("The cut rounding step must be greater than zero.", $"{path}.cutRoundingStepMm");

                CutLengthResult result;
                try
                {
                    result = CutLengthCalculator.Calculate(new CutLengthInput(
                        [sourceLength], fromCorrection, toCorrection, roundingStep));
                }
                catch (ArgumentException error)
                {
                    throw InvalidDesign("The wire cut-length inputs are invalid.", path, error);
                }
                catch (OverflowException error)
                {
                    throw InvalidDesign("The wire cut length exceeds the supported range.", path, error);
                }

                decimal? totalMetres = null;
                if (result.CutLength is { } cutLength)
                {
                    try
                    {
                        totalMetres = checked((decimal)cutLength.Micrometres * harness.Quantity) /
                            Length.MicrometresPerMetre;
                    }
                    catch (OverflowException error)
                    {
                        throw new HarnessCutListException(
                            "cut_list_total_too_large",
                            "The total wire consumption exceeds the supported decimal range.",
                            path,
                            error);
                    }
                }

                var warnings = new List<string>(2);
                if (material is null)
                    warnings.Add(MissingMaterialWarningCode);
                if (!result.IsComplete)
                    warnings.Add(MissingLengthWarningCode);

                items.Add(new HarnessCutListItem(
                    wireId,
                    circuit,
                    material?.DisplayName ?? NotPinnedMaterial,
                    material?.SourceKey,
                    material?.DisplayName,
                    sourceLength?.Millimetres,
                    fromCorrection.Millimetres,
                    toCorrection.Millimetres,
                    roundingStep.Millimetres,
                    result.CutLength?.Millimetres,
                    harness.Quantity,
                    totalMetres,
                    result.IsComplete ? "ready" : "incomplete",
                    warnings.AsReadOnly()));
                index++;
            }

            var hasMissingMaterials = items.Any(item => item.MaterialSourceKey is null);
            var hasMissingLengths = items.Any(item => item.CutLengthMm is null);
            var warning = hasMissingMaterials
                ? MaterialWarning
                : hasMissingLengths
                    ? MissingLengthWarning
                    : string.Empty;
            var status = hasMissingMaterials || hasMissingLengths
                ? IncompleteStatus
                : ReadyStatus;
            return new HarnessCutList(
                projectId,
                harnessId,
                harness.Quantity,
                status,
                warning,
                items.AsReadOnly());
        }
        catch (HarnessCutListException)
        {
            throw;
        }
        catch (JsonException error)
        {
            throw InvalidDesign("The harness design content is not valid JSON.", "content", error);
        }
    }

    private static MaterialBinding? MaterialBindingOrMissing(JsonElement wire, string wirePath)
    {
        if (!wire.TryGetProperty("materialBinding", out var value) || value.ValueKind == JsonValueKind.Null)
            return null;
        var path = $"{wirePath}.materialBinding";
        if (value.ValueKind != JsonValueKind.Object)
            throw InvalidDesign("The wire material binding must be an object.", path);

        var sourceId = BoundedRequiredString(value, "sourceId", $"{path}.sourceId", 128);
        var snapshotIdText = BoundedRequiredString(value, "snapshotId", $"{path}.snapshotId", 36);
        if (!Guid.TryParseExact(snapshotIdText, "D", out var snapshotId) || snapshotId == Guid.Empty)
            throw InvalidDesign("The wire material snapshotId must be a non-empty UUID.", $"{path}.snapshotId");
        var snapshotSha256 = Sha256(value, "snapshotSha256", $"{path}.snapshotSha256");
        var recordId = Sha256(value, "recordId", $"{path}.recordId");
        var entityType = BoundedRequiredString(value, "entityType", $"{path}.entityType", 16);
        if (entityType is not ("wire" or "cable"))
            throw InvalidDesign("The wire material entityType must be wire or cable.", $"{path}.entityType");
        var sourceKey = BoundedRequiredString(value, "sourceKey", $"{path}.sourceKey", 512);
        var displayName = BoundedRequiredString(value, "displayName", $"{path}.displayName", 256);
        return new MaterialBinding(
            sourceId,
            snapshotId,
            snapshotSha256,
            recordId,
            entityType,
            sourceKey,
            displayName);
    }

    private static string BoundedRequiredString(
        JsonElement owner,
        string propertyName,
        string path,
        int maximumLength)
    {
        if (!owner.TryGetProperty(propertyName, out var value) || value.ValueKind != JsonValueKind.String)
            throw InvalidDesign($"The wire material {propertyName} must be a string.", path);
        var result = value.GetString()!;
        if (string.IsNullOrWhiteSpace(result) || result.Length > maximumLength)
            throw InvalidDesign($"The wire material {propertyName} is empty or too long.", path);
        return result;
    }

    private static string Sha256(JsonElement owner, string propertyName, string path)
    {
        var value = BoundedRequiredString(owner, propertyName, path, 64);
        if (value.Length != 64 || value.Any(character => !Uri.IsHexDigit(character)))
            throw InvalidDesign($"The wire material {propertyName} must be a SHA-256 hexadecimal value.", path);
        return value.ToLowerInvariant();
    }

    private static string RequiredString(
        JsonElement owner,
        string propertyName,
        string path,
        bool allowEmpty = false)
    {
        if (!owner.TryGetProperty(propertyName, out var value) || value.ValueKind != JsonValueKind.String)
            throw InvalidDesign($"The wire {propertyName} must be a string.", path);
        var result = value.GetString()!;
        if (!allowEmpty && string.IsNullOrWhiteSpace(result))
            throw InvalidDesign($"The wire {propertyName} must not be empty.", path);
        return result;
    }

    private static Length? NullableLength(JsonElement owner, string propertyName, string path)
    {
        if (!owner.TryGetProperty(propertyName, out var value) || value.ValueKind == JsonValueKind.Null)
            return null;
        var millimetres = DecimalNumber(value, path);
        try
        {
            return Length.FromMillimetres(millimetres);
        }
        catch (ArgumentException error)
        {
            throw InvalidDesign("The wire source length is invalid or more precise than 0.001 mm.", path, error);
        }
        catch (OverflowException error)
        {
            throw InvalidDesign("The wire source length exceeds the supported range.", path, error);
        }
    }

    private static LengthCorrection CorrectionOrDefault(
        JsonElement owner,
        string propertyName,
        string path)
    {
        if (!owner.TryGetProperty(propertyName, out var value) || value.ValueKind == JsonValueKind.Null)
            return LengthCorrection.FromMillimetres(0m);
        var millimetres = DecimalNumber(value, path);
        try
        {
            return LengthCorrection.FromMillimetres(millimetres);
        }
        catch (ArgumentException error)
        {
            throw InvalidDesign("The wire end correction is invalid or more precise than 0.001 mm.", path, error);
        }
        catch (OverflowException error)
        {
            throw InvalidDesign("The wire end correction exceeds the supported range.", path, error);
        }
    }

    private static Length LengthOrDefault(
        JsonElement owner,
        string propertyName,
        decimal defaultValue,
        string path)
    {
        var millimetres = !owner.TryGetProperty(propertyName, out var value) || value.ValueKind == JsonValueKind.Null
            ? defaultValue
            : DecimalNumber(value, path);
        try
        {
            return Length.FromMillimetres(millimetres);
        }
        catch (ArgumentException error)
        {
            throw InvalidDesign("The cut rounding step is invalid or more precise than 0.001 mm.", path, error);
        }
        catch (OverflowException error)
        {
            throw InvalidDesign("The cut rounding step exceeds the supported range.", path, error);
        }
    }

    private static decimal DecimalNumber(JsonElement value, string path)
    {
        if (value.ValueKind != JsonValueKind.Number || !value.TryGetDecimal(out var result))
            throw InvalidDesign("A cut-list length must be an exact decimal JSON number.", path);
        return result;
    }

    private static HarnessCutListException InvalidDesign(
        string message,
        string field,
        Exception? innerException = null) =>
        new("invalid_cut_list_design", message, field, innerException);

    private sealed record MaterialBinding(
        string SourceId,
        Guid SnapshotId,
        string SnapshotSha256,
        string RecordId,
        string EntityType,
        string SourceKey,
        string DisplayName);
}
