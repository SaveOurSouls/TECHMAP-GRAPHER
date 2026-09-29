using System.Text.Json;
using System.Text.Json.Nodes;
using Techmap.Domain;

namespace Techmap.Infrastructure.Xlsx;

/// <summary>Separates section labels in the wire worksheet from selectable wire rows.</summary>
public static class WireCatalogRowClassifier
{
    public const string WireEntityType = "wire";
    public const string CategoryEntityType = "wire-category";

    private static readonly HashSet<string> CategoryLabels = new(StringComparer.OrdinalIgnoreCase)
    {
        "Монтажный провод",
        "Высокотемпературный провод",
        "Силиконовый провод",
        "Силиконовый высоковольтный провод",
        "Видео кабель",
        "Мультипровод",
        "Мультипровод ССС",
        "Плоский провод",
        "Аудио провод",
        "Коаксиальный высокотемпературный провод",
        "Промышленного - военного класса провода",
        "Автомобильные Японские",
        "Автомобильные Китайские",
        "Автомобильные Европейские",
        "Автомобильные Американские",
    };

    public static IReadOnlyList<ReferenceCatalogRecordInput> Classify(
        IReadOnlyList<ReferenceCatalogRecordInput> records)
    {
        var result = records.ToArray();
        string? currentCategory = null;
        foreach (var indexed in records
                     .Select((record, index) => (record, index))
                     .OrderBy(item => RowNumber(item.record.SourceLocation)))
        {
            var index = indexed.index;
            var record = indexed.record;
            var mark = Text(record.Payload, "Марка");
            if (IsCategoryLabel(mark, record.Payload))
            {
                currentCategory = mark;
                result[index] = new ReferenceCatalogRecordInput(
                    CategoryEntityType,
                    record.SourceKey,
                    SetCategoryValues(record.Payload, mark),
                    record.SourceLocation);
                continue;
            }

            // Keep the source's material category intact. The worksheet's section
            // labels are available as a separate grouping field for filters.
            result[index] = currentCategory is null
                ? record
                : new ReferenceCatalogRecordInput(
                    record.EntityType,
                    record.SourceKey,
                    SetGroupValue(record.Payload, currentCategory),
                    record.SourceLocation);
        }

        return result;
    }

    private static int RowNumber(string? sourceLocation)
    {
        if (sourceLocation is null) return int.MaxValue;
        var marker = sourceLocation.LastIndexOf('!');
        return marker >= 0 && int.TryParse(sourceLocation[(marker + 1)..], out var row)
            ? row
            : int.MaxValue;
    }

    public static bool IsCategoryLabel(string? mark, JsonElement payload)
    {
        if (string.IsNullOrWhiteSpace(mark) || HasSection(payload)) return false;
        var normalized = mark.Trim();
        if (CategoryLabels.Contains(normalized)) return true;
        return normalized.Contains("провод", StringComparison.OrdinalIgnoreCase) ||
               normalized.Contains("кабель", StringComparison.OrdinalIgnoreCase) ||
               normalized.Contains("мультипровод", StringComparison.OrdinalIgnoreCase) ||
               normalized.StartsWith("автомобильные", StringComparison.OrdinalIgnoreCase);
    }

    private static bool HasSection(JsonElement payload) =>
        !string.IsNullOrWhiteSpace(Text(payload, "Core")) ||
        !string.IsNullOrWhiteSpace(Text(payload, "Pair")) ||
        !string.IsNullOrWhiteSpace(Text(payload, "Сечение C")) ||
        !string.IsNullOrWhiteSpace(Text(payload, "Сечение С")) ||
        !string.IsNullOrWhiteSpace(Text(payload, "Сечение P")) ||
        !string.IsNullOrWhiteSpace(Text(payload, "Сечение Р"));

    private static string Text(JsonElement payload, string property) =>
        payload.TryGetProperty(property, out var value) && value.ValueKind != JsonValueKind.Null
            ? value.ToString().Trim()
            : string.Empty;

    private static JsonElement SetCategoryValues(JsonElement payload, string value)
    {
        var node = JsonNode.Parse(payload.GetRawText())?.AsObject()
            ?? throw new InvalidDataException("Wire catalog payload must be a JSON object.");
        node["Марка"] = null;
        node["Категория"] = value;
        node["Категория группы"] = value;
        using var document = JsonDocument.Parse(node.ToJsonString());
        return document.RootElement.Clone();
    }

    private static JsonElement SetGroupValue(JsonElement payload, string value)
    {
        var node = JsonNode.Parse(payload.GetRawText())?.AsObject()
            ?? throw new InvalidDataException("Wire catalog payload must be a JSON object.");
        node["Категория группы"] = value;
        using var document = JsonDocument.Parse(node.ToJsonString());
        return document.RootElement.Clone();
    }
}
