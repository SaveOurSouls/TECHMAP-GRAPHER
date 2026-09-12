namespace Techmap.Infrastructure.Xlsx;

public sealed record XlsxKnownProfile(
    string Id,
    string DisplayName,
    string SourceId,
    string SheetName,
    string EntityType,
    string KeyColumn,
    string Description,
    XlsxCatalogMapping Mapping);

public static class XlsxKnownProfiles
{
    private static readonly IReadOnlyList<XlsxKnownProfile> Profiles =
    [
        CreateOperations(),
        CreateEquipment(),
    ];

    public static IReadOnlyList<XlsxKnownProfile> All => Profiles;

    public static XlsxKnownProfile Get(string profileId)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(profileId);
        return Profiles.SingleOrDefault(profile => string.Equals(profile.Id, profileId, StringComparison.Ordinal))
               ?? throw new XlsxImportException("xlsx_profile_not_found", "Неизвестный профиль импорта XLSX.");
    }

    private static XlsxKnownProfile CreateOperations()
    {
        const string id = "technology.operations";
        const string sourceId = "technology-operations";
        var fields = new[]
        {
            Text("Название", "name", required: true),
            Text("Апликаторы / модули", "applicatorsModules"),
            Text("Программа", "program"),
            Text("Машина", "machine"),
            Text("Полуфабрикат", "semiFinishedProduct"),
            Text("Провод", "wire"),
            Text("Разъем", "connector"),
            Text("Инструмент", "tool"),
            Raw("Время Операции", "legacyOperationTime", allowFormula: true),
            Raw("Время подготовки, сек", "setupTimeSeconds"),
            Raw("Расход на настройку м; шт;", "setupConsumption"),
            Raw("Время Чел, сек/оп; сек/м", "legacyHumanTime", allowFormula: true),
            Raw("Время машины, сек/оп; сек/м", "legacyMachineTime", allowFormula: true),
            Raw("Уд.Цена ЧЛ, сек", "legacyHumanUnitPrice", allowFormula: true),
            Raw("Уд.Цена ЧЛ_МАГ, сек", "legacyHumanUnitPriceMag", allowFormula: true),
            Raw("Уд.Цена МШ, сек", "legacyMachineUnitPrice", allowFormula: true),
            Text("Тип операции", "operationType", required: true),
            Raw("Время ручных работ для взятия полуфабриката", "manualTakeTimeSeconds", allowFormula: true),
            Raw("Время ручных работ", "manualWorkTimeSeconds", allowFormula: true),
            Raw("Время ручных работ для снятия полуфабриката", "manualRemoveTimeSeconds"),
            Raw("Скорость проката, сек/м", "feedTimeSecondsPerMeter"),
            Raw("Скорость работы инструмента", "toolCycleTimeSeconds"),
            Raw("Кол-во операций инструмента", "toolOperationCount"),
            Raw("Время доп.операции", "additionalTimeSeconds"),
            Text("Инструкция", "instruction"),
            Text("Отказы", "rejects"),
        };
        var mapping = new XlsxCatalogMapping(
            "БД.ОП", 2, 3, "operation", "Номер", fields,
            IgnoreUnmappedFormulas: true,
            StopAtFirstMissingKey: true,
            ProfileId: id);
        return new XlsxKnownProfile(
            id, "БД.ОП — операции", sourceId, "БД.ОП", "operation", "Номер",
            "Операции и исходные параметры времени. Чтение заканчивается на первой строке без номера.",
            mapping);
    }

    private static XlsxKnownProfile CreateEquipment()
    {
        const string id = "technology.equipment";
        const string sourceId = "technology-equipment";
        var fields = new[]
        {
            Raw("№", "ordinal", allowFormula: true),
            Text("Тип", "type", required: true),
            Text("Артикул", "article"),
            Text("Наменование", "name", required: true),
            Text("Производитель", "manufacturer"),
            Text("Операции", "operations"),
            Raw("Потребление,вват/ч", "powerConsumption"),
            Text("Ссылка на сайт производителя ", "manufacturerUrl"),
            Text("Расположение", "location"),
            Text("Описание", "description"),
            Text("Для базы", "machineLabel", allowFormula: true),
            Text("Полное наименование ", "fullName"),
            Raw("Стоимость", "cost"),
            Raw("Коэффициент", "coefficient"),
            Raw("Cрок окупаемости, мес.", "paybackMonths"),
            Raw("Кол-во сек. работы в мес.", "workSecondsPerMonth"),
            Raw("Желаемый срок окупаемости, сек.", "targetPaybackSeconds", allowFormula: true),
            Raw("Стоимость 1 сек. эксплуатации без НДС", "operationCostPerSecond", allowFormula: true),
            Text("Габариты ШхД", "dimensions"),
        };
        var mapping = new XlsxCatalogMapping(
            "БД.ОБ", 2, 3, "equipment", "Инв. номер", fields,
            IgnoreUnmappedFormulas: true,
            StopAtFirstMissingKey: true,
            ProfileId: id);
        return new XlsxKnownProfile(
            id, "БД.ОБ — оборудование", sourceId, "БД.ОБ", "equipment", "Инв. номер",
            "Физические единицы оборудования с инвентарным номером. Заготовки без инвентарного номера не публикуются.",
            mapping);
    }

    private static XlsxFieldMapping Text(
        string source,
        string target,
        bool required = false,
        bool allowFormula = false) =>
        new(source, target, XlsxFieldValueKind.Text, required, AllowBlank: true,
            AllowFormulaCachedValue: allowFormula);

    private static XlsxFieldMapping Raw(
        string source,
        string target,
        bool allowFormula = false) =>
        new(source, target, XlsxFieldValueKind.RawScalar,
            AllowFormulaCachedValue: allowFormula,
            SkipBlank: true);
}
