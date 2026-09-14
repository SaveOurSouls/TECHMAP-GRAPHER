using System.Text.Json;
using Techmap.Domain;

namespace Techmap.Application;

public sealed record HarnessCutListItem(
    string WireId,
    string Circuit,
    string Material,
    decimal? SourceLengthMm,
    decimal EndCorrectionFromMm,
    decimal EndCorrectionToMm,
    decimal RoundingStepMm,
    decimal? CutLengthMm,
    long Pieces,
    decimal? TotalMetres,
    string Status);

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
    public const string NotPinnedMaterial = "not-pinned";
    public const string MaterialWarning =
        "Материал провода не закреплён. Карта показывает длины заготовок, но пока не является спецификацией материалов.";

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

                items.Add(new HarnessCutListItem(
                    wireId,
                    circuit,
                    NotPinnedMaterial,
                    sourceLength?.Millimetres,
                    fromCorrection.Millimetres,
                    toCorrection.Millimetres,
                    roundingStep.Millimetres,
                    result.CutLength?.Millimetres,
                    harness.Quantity,
                    totalMetres,
                    result.IsComplete ? "ready" : "incomplete"));
                index++;
            }

            return new HarnessCutList(
                projectId,
                harnessId,
                harness.Quantity,
                LimitedStatus,
                MaterialWarning,
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
}
