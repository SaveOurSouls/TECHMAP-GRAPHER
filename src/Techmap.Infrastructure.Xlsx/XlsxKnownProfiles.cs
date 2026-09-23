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
        CreateTerminals(),
        CreateCoaxTerminations(),
        CreateCoaxCableDimensions(),
        CreateAwgReference(),
        CreateWires(),
    ];

    public static IReadOnlyList<XlsxKnownProfile> All => Profiles;

    public static XlsxKnownProfile Get(string profileId)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(profileId);
        return Profiles.SingleOrDefault(profile => string.Equals(profile.Id, profileId, StringComparison.Ordinal))
               ?? throw new XlsxImportException("xlsx_profile_not_found", "Неизвестный профиль импорта XLSX.");
    }

    private static XlsxKnownProfile CreateWires()
    {
        const string id = "technology.wires";
        return new XlsxKnownProfile(id, "Провода — все колонки строки 3", "technology-wires",
            "Автоопределение по заголовкам", "wire", "составной ключ",
            "Все колонки строки 3, данные со строки 4. Марки, жилы, пары и сечения сохраняются без потери вариантов.",
            new XlsxCatalogMapping(null, 3, 4, "wire", "Марка",
                IgnoreUnmappedFormulas: true, ProfileId: id,
                CompositeKeyColumns: ["Марка", "Core", "Сечение C", "Pair", "Сечение P"],
                PreserveDuplicateRows: true, DetectSheetByColumns: true, ImportAllColumns: true));
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

    private static XlsxKnownProfile CreateTerminals()
    {
        const string id = "technology.terminals";
        const string sourceId = "technology-terminals";
        var fields = new[]
        {
            Text("Тип разъема", "connectorType", required: true),
            Text("Производитель", "manufacturer"), Text("Product Name", "productName"),
            Text("Series", "series"), Raw("Шаг разьема", "pitchMm"),
            Text("Тип контакта", "contactType"), Text("Артикул контакта (REEL)", "reelArticle", required: true),
            Text("Артикул контакта (BAG)", "bagArticle"), Text("Аппликатор", "applicator"),
            Text("Пневма Автомат", "pneumaticAutomatic"), Raw("ОТР", "otr"),
            Raw("С зачисткой", "withStripping"), Text("Длина зачистки, мм", "stripLengthMm", warnWhenMissing: true),
            Raw("L+", "lengthPlusMm"), Raw("L-", "lengthMinusMm"),
            Text("Высота обжима проводника , мм", "conductorCrimpHeightMm"),
            Text("Высота обжима изоляции, мм", "insulationCrimpHeightMm"),
            Raw("Усилие обрыва контакта от, N", "pullForceMinN"), Raw("Усилие обрыва контакта до, N", "pullForceMaxN"),
            Raw("От AWG", "awgFrom"), Raw("До AWG", "awgTo"),
            Raw("От мм2", "sectionFromMm2", allowFormula: true, warnWhenMissing: true),
            Raw("До мм2", "sectionToMm2", allowFormula: true, warnWhenMissing: true),
            Raw("Диаметр изоляции от, мм", "insulationDiameterFromMm", warnWhenMissing: true),
            Raw("Диаметр изоляции до, мм", "insulationDiameterToMm", warnWhenMissing: true),
            Text("Материал контакта", "contactMaterial"), Raw("Максисмальная сила тока, А", "maximumCurrentA"),
            Text("Ссылка на DATASHEET на сайте производителя", "datasheetUrl"),
        };
        var mapping = new XlsxCatalogMapping(
            "БД.ТЕР", 1, 2, "terminal", "Артикул контакта (REEL)", fields,
            LastDataRow: 280,
            IgnoreUnmappedFormulas: true,
            ProfileId: id,
            CompositeKeyColumns: ["Производитель", "Артикул контакта (REEL)", "Артикул контакта (BAG)", "Series"],
            BoundaryColumns: ["Тип разъема", "Производитель", "Product Name", "Series", "Артикул контакта (REEL)"]);
        return new XlsxKnownProfile(
            id, "БД.ТЕР — терминалы", sourceId, "БД.ТЕР", "terminal", "составной ключ",
            "Терминалы и совместимость сечений/изоляции; одинаковые артикулы разных серий остаются отдельными.", mapping);
    }

    private static XlsxKnownProfile CreateCoaxTerminations()
    {
        const string id = "technology.coax-terminations";
        const string sourceId = "technology-coax-terminations";
        var fields = new[]
        {
            Text("Артикул", "legacyArticle", allowFormula: true), Text("Тип/Серия", "typeSeries", required: true),
            Text("Провод", "cable", required: true), Text("Производитель", "manufacturer", required: true),
            Text("Программа", "program"),
            Raw("D1", "layerD1", allowFormula: true), Raw("D2", "layerD2"), Raw("D3", "layerD3"),
            Raw("L1", "layerL1", warnWhenMissing: true), Raw("L2", "layerL2", warnWhenMissing: true),
            Raw("L3", "layerL3", warnWhenMissing: true), Raw("L+", "lengthPlusMm"), Raw("L-", "lengthMinusMm"),
            Text("Тип пина", "pinType"), Text("Тип экрана", "shieldType"),
        };
        var mapping = new XlsxCatalogMapping(
            "БД.КОАКС", 2, 3, "coax-termination", "Провод", fields,
            LastDataRow: 61,
            IgnoreUnmappedFormulas: true,
            ProfileId: id,
            CompositeKeyColumns: ["Тип/Серия", "Провод", "Производитель", "L1", "L2", "L3", "Тип пина", "Тип экрана"],
            PreserveDuplicateRows: true,
            LayerArray: ThreeLayers(),
            BoundaryColumns: ["Тип/Серия", "Провод", "Производитель"]);
        return new XlsxKnownProfile(
            id, "БД.КОАКС — разделка коаксиала", sourceId, "БД.КОАКС", "coax-termination", "составной ключ",
            "Разделка коаксиала. Полностью совпадающие строки сохраняются отдельными вариантами с предупреждением.", mapping);
    }

    private static XlsxKnownProfile CreateCoaxCableDimensions()
    {
        const string id = "technology.coax-cables";
        const string sourceId = "technology-coax-cables";
        var fields = new[]
        {
            Raw("D1", "layerD1"), Raw("D2", "layerD2"), Raw("D3", "layerD3"),
        };
        var mapping = new XlsxCatalogMapping(
            "СПР.КАБ", 1, 2, "coax-cable", "Кабель", fields,
            LastDataRow: 25,
            IgnoreUnmappedFormulas: true,
            ProfileId: id,
            CompositeKeyColumns: ["Кабель", "D1", "D2", "D3"],
            PreserveDuplicateRows: true,
            LayerArray: ThreeDiameterLayers(),
            BoundaryColumns: ["Кабель"]);
        return new XlsxKnownProfile(
            id, "СПР.КАБ — диаметры коаксиальных кабелей", sourceId, "СПР.КАБ", "coax-cable", "составной ключ",
            "Первая таблица СПР.КАБ: диаметры слоёв коаксиального кабеля от центральной жилы наружу.", mapping);
    }

    private static XlsxKnownProfile CreateAwgReference()
    {
        const string id = "technology.awg-reference";
        const string sourceId = "technology-awg-reference";
        var fields = new[]
        {
            Raw("ГОСТ", "sectionMm2"), Raw("Ø жилы", "conductorDiameterMm"), Raw("МГТФ", "mgtfDiameterMm"),
            Raw("МС", "msDiameterMm"), Raw("M22759", "m22759DiameterMm"), Raw("PTFE", "ptfeDiameterMm"),
            Raw("UL1061", "ul1061DiameterMm"), Raw("UL1571", "ul1571DiameterMm"), Raw("UL1007", "ul1007DiameterMm"),
            Raw("UL1015", "ul1015DiameterMm"), Raw("МГШВ", "mgshvDiameterMm"), Raw("НВ-4", "nv4DiameterMm"),
            Raw("Силикон", "siliconeDiameterMm"), Raw("РКГМ", "rkgmDiameterMm"), Raw("ПВАМ", "pvamDiameterMm"),
            Raw("ПГВА", "pgvaDiameterMm"), Raw("FLRY", "flryDiameterMm"), Raw("TXL", "txlDiameterMm"),
            Raw("GXL", "gxlDiameterMm"),
        };
        var mapping = new XlsxCatalogMapping(
            "СПР.КАБ", 28, 29, "awg-reference", "AWG", fields,
            LastDataRow: 50,
            IgnoreUnmappedFormulas: true,
            ProfileId: id,
            AllowNonTextKey: true,
            BoundaryColumns: ["AWG"]);
        return new XlsxKnownProfile(
            id, "СПР.КАБ — соответствие AWG и диаметров", sourceId, "СПР.КАБ", "awg-reference", "AWG",
            "Вторая таблица СПР.КАБ: AWG, сечение по ГОСТ, диаметр жилы и наружные диаметры марок проводов.", mapping);
    }

    private static XlsxLayerArrayMapping ThreeLayers() => new(
        "layers",
        [
            new XlsxLayerMemberMapping(1, "layerD1", "layerL1"),
            new XlsxLayerMemberMapping(2, "layerD2", "layerL2"),
            new XlsxLayerMemberMapping(3, "layerD3", "layerL3"),
        ],
        ["-", "—"]);

    private static XlsxLayerArrayMapping ThreeDiameterLayers() => new(
        "layers",
        [
            new XlsxLayerMemberMapping(1, "layerD1"),
            new XlsxLayerMemberMapping(2, "layerD2"),
            new XlsxLayerMemberMapping(3, "layerD3"),
        ],
        ["-", "—"]);

    private static XlsxFieldMapping Text(
        string source,
        string target,
        bool required = false,
        bool allowFormula = false,
        bool warnWhenMissing = false) =>
        new(source, target, XlsxFieldValueKind.TextScalar, required,
            AllowBlank: !required && !warnWhenMissing,
            AllowFormulaCachedValue: allowFormula,
            SkipBlank: !required && warnWhenMissing,
            WarnWhenMissing: warnWhenMissing);

    private static XlsxFieldMapping Raw(
        string source,
        string target,
        bool allowFormula = false,
        bool warnWhenMissing = false) =>
        new(source, target, XlsxFieldValueKind.RawScalar,
            AllowFormulaCachedValue: allowFormula,
            SkipBlank: true,
            WarnWhenMissing: warnWhenMissing);
}
