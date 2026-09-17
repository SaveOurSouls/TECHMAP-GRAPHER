import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  canPublishXlsxPreview,
  fileSelectionLabel,
  googleSheetsProfilePreviewRequest,
  profileCountLabel,
  ReferenceDiagnosticItem,
  ReferenceImportPanel,
  ReferenceValidationDiagnostics,
  referenceDiagnosticMessage,
  XlsxProfilePicker,
} from "./ReferenceImportPanel";
import { AppNavigation } from "./App";
import type { ReferenceCatalogDiagnostic, XlsxReferencePreview } from "./reference-catalog-api";
import { parseRuntimeConfig } from "./runtime-config";

const config = parseRuntimeConfig({
  configVersion: 1,
  basePath: "/techmap/",
  apiBasePath: "/techmap/api/v1/",
  appVersion: "1.0.0",
  apiVersion: "1",
  schemaVersion: "7",
});
const session = {
  csrfNonce: "A".repeat(43),
  instanceId: "12345678-1234-4123-8123-123456789abc",
};

describe("reference import panel", () => {
  it("marks the selected application section in real navigation", () => {
    const markup = renderToStaticMarkup(createElement(AppNavigation, {
      activeSection: "references",
      onSectionChange: () => undefined,
    }));

    expect(markup).toContain("Проекты");
    expect(markup).toContain("Справочники");
    expect(markup).toContain('class="nav-item active"');
    expect(markup).toContain('aria-current="page"');
  });

  it("renders XLSX and experimental public Google Sheets inputs while keeping manual XLSX mapping", () => {
    const markup = renderToStaticMarkup(createElement(ReferenceImportPanel, { config, session }));

    expect(markup).toContain("Справочники");
    expect(markup).toContain("ЗАГРУЖЕННЫЕ ТАБЛИЦЫ");
    expect(markup).toContain("Загружаем список");
    expect(markup).toContain("Новая таблица");
    expect(markup).toContain("technology-connectors");
    expect(markup).toContain("Выберите загруженный справочник слева");
    expect(markup).toContain("Выбрать рабочую книгу");
    expect(markup).toContain("Google Sheets");
    expect(markup).toContain("экспериментально");
    expect(markup).toContain("публичной ссылке");
    expect(markup).toContain("только для чтения");
    expect(markup).toContain("Какой файл нужен");
    expect(markup).toContain("База данных. Технология.xlsx");
    expect(markup).toContain("Что загрузить");
    expect(markup).toContain("Загружаем список таблиц");
    expect(markup).toContain("Универсальный импорт");
    expect(markup).toContain("Строка заголовков");
    expect(markup).toContain("Ключевой столбец");
    expect(markup).toContain("Обычные ссылки на сайты разрешены");
    expect(markup).toContain("generic-record");
    expect(markup).toContain("Проверить таблицу");
    expect(markup).toContain("Ошибки");
    expect(markup).toContain("Здесь появятся блокирующие ошибки проверки");
    expect(markup).not.toContain("Публикация выполняется отдельным действием");
    expect(markup.indexOf('class="reference-import-card"')).toBeLessThan(markup.indexOf("Выберите загруженный справочник слева"));
    expect(markup).toContain('accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"');
  });

  it("normalizes a Google Sheets profile request and rejects missing input", () => {
    expect(googleSheetsProfilePreviewRequest(
      "  https://docs.google.com/spreadsheets/d/reference/edit  ",
      "  technology.operations  ",
    )).toEqual({
      url: "https://docs.google.com/spreadsheets/d/reference/edit",
      profileId: "technology.operations",
    });
    expect(() => googleSheetsProfilePreviewRequest("   ", "technology.operations"))
      .toThrow("публичную ссылку Google Sheets");
    expect(() => googleSheetsProfilePreviewRequest("https://docs.google.com/spreadsheets/d/reference", "  "))
      .toThrow("Выберите профиль");
  });

  it("renders backend-provided profiles and their exact automatic mapping", () => {
    const profiles = [
      {
        profileId: "technology.operations",
        displayName: "БД.ОП — операции",
        sourceId: "technology-operations",
        sheetName: "БД.ОП",
        entityType: "operation",
        keyColumn: "Номер",
        description: "Операции и исходные параметры времени.",
      },
      {
        profileId: "technology.equipment",
        displayName: "БД.ОБ — оборудование",
        sourceId: "technology-equipment",
        sheetName: "БД.ОБ",
        entityType: "equipment",
        keyColumn: "Инв. номер",
        description: "Физические единицы оборудования.",
      },
    ];
    const markup = renderToStaticMarkup(createElement(XlsxProfilePicker, {
      profiles,
      error: null,
      selectedProfileId: "technology.operations",
      disabled: false,
      onSelect: () => undefined,
    }));

    expect(markup).toContain("БД.ОП — операции");
    expect(markup).toContain("БД.ОБ — оборудование");
    expect(markup).toContain("Операции и исходные параметры времени");
    expect(markup).toContain("Номер");
    expect(markup).toContain('value="technology.operations" selected=""');
    expect(profileCountLabel(1)).toBe("1 профиль");
    expect(profileCountLabel(2)).toBe("2 профиля");
    expect(profileCountLabel(5)).toBe("5 профилей");
    expect(profileCountLabel(11)).toBe("11 профилей");
  });

  it("allows publication with warnings while rejecting stale or expired previews", () => {
    const warningId = "b".repeat(64);
    const preview: XlsxReferencePreview = {
      previewId: "12345678-1234-4123-8123-123456789abc",
      expiresUtc: "2026-09-12T19:00:00Z",
      activeSnapshotId: null,
      snapshotId: "22345678-1234-4123-8123-123456789abc",
      sourceId: "technology-database",
      fileName: "source.xlsx",
      sourceSha256: "a".repeat(64),
      sheets: [{ name: "Лист1", hidden: false }],
      selectedSheet: "Лист1",
      headerRow: 1,
      firstDataRow: 2,
      entityType: "generic-record",
      keyColumn: "RecordKey",
      columns: [],
      sourceRowCount: 1,
      recordCount: 1,
      isTruncated: false,
      validationSha256: "a".repeat(64),
      canPublish: true,
      records: [],
      diagnostics: [{
        diagnosticId: warningId,
        severity: "warning",
        code: "review-required",
        message: "Проверьте строку.",
        entityType: null,
        sourceKey: null,
        field: null,
        sourceLocation: null,
      }],
    };

    expect(canPublishXlsxPreview(preview, new Set(), Date.parse("2026-09-12T18:00:00Z"))).toBe(true);
    expect(canPublishXlsxPreview(preview, new Set([warningId]), Date.parse("2026-09-12T18:00:00Z"))).toBe(true);
    expect(canPublishXlsxPreview(preview, new Set(), Date.parse(preview.expiresUtc))).toBe(false);
    expect(canPublishXlsxPreview(preview, new Set(), Date.parse("2026-09-12T18:00:00Z"), true)).toBe(false);
  });

  it("shows file identity without exposing file content", () => {
    const file = { name: "База данных.xlsx", size: 1536 } as File;
    expect(fileSelectionLabel(file)).toBe("База данных.xlsx · 2 КиБ");
    expect(fileSelectionLabel(null)).toBe("Файл не выбран");
  });

  it("leads with a short explanation for formula and incomplete-field warnings", () => {
    const formulaWarning: ReferenceCatalogDiagnostic = {
      diagnosticId: "a".repeat(64),
      severity: "warning",
      code: "xlsx_cached_formula_values_used",
      message: "Для поля «legacyHumanUnitPriceMag» использованы сохранённые в XLSX результаты формул (128). Проверьте, что книга была пересчитана перед загрузкой.",
      entityType: "operation",
      sourceKey: null,
      field: "legacyHumanUnitPriceMag",
      sourceLocation: "'БД.ОП'!P3",
    };
    const incompleteWarning = {
      ...formulaWarning,
      code: "xlsx_profile_field_incomplete",
      message: "Поле «manualTakeTimeSeconds» не заполнено в 2 строках профиля.",
    };

    expect(referenceDiagnosticMessage(formulaWarning)).toBe(
      "Взяты сохранённые конечные значения формул: 128 ячеек.",
    );
    expect(referenceDiagnosticMessage(incompleteWarning)).toBe(
      "В профиле есть незаполненные строки: 2 строки. Проверьте таблицу.",
    );
  });

  it("keeps source coordinates and internal keys inside collapsed diagnostic details", () => {
    const diagnostic: ReferenceCatalogDiagnostic = {
      diagnosticId: "c".repeat(64),
      severity: "warning",
      code: "xlsx_cached_formula_values_used",
      message: "Для поля «legacyHumanUnitPriceMag» использованы сохранённые в XLSX результаты формул (128). Проверьте, что книга была пересчитана перед загрузкой.",
      entityType: "operation",
      sourceKey: "ОП-12",
      field: "legacyHumanUnitPriceMag",
      sourceLocation: "'БД.ОП'!P3",
    };
    const markup = renderToStaticMarkup(createElement(ReferenceDiagnosticItem, { diagnostic }));

    expect(markup).toContain("Предупреждение: Взяты сохранённые конечные значения формул: 128 ячеек");
    expect(markup).toContain('<details class="diagnostic-details"><summary>Подробности проверки</summary>');
    expect(markup).toContain("legacyHumanUnitPriceMag");
    expect(markup).toContain("БД.ОП");
    expect(markup).toContain("ОП-12");
    expect(markup).not.toContain("<details class=\"diagnostic-details\" open=\"\"");
    expect(markup.match(/<strong>(.*?)<\/strong>/)?.[1]).not.toContain("legacyHumanUnitPriceMag");
    expect(markup).not.toContain("<input");
  });

  it("shows errors and collapsed warning details without confirmation controls", () => {
    const diagnostic: ReferenceCatalogDiagnostic = {
      diagnosticId: "d".repeat(64),
      severity: "warning",
      code: "xlsx_cached_formula_values_used",
      message: "Использованы сохранённые результаты формул (129).",
      entityType: "operation",
      sourceKey: "ОП-12",
      field: "legacyOperationTime",
      sourceLocation: "'БД.ОП'!P3",
    };
    const markup = renderToStaticMarkup(createElement(ReferenceValidationDiagnostics, {
      diagnostics: [diagnostic, {
        ...diagnostic,
        diagnosticId: "e".repeat(64),
        severity: "error",
        code: "xlsx_required_value_missing",
        message: "Не заполнено обязательное поле.",
      }],
    }));

    expect(markup).toContain('aria-label="Блокирующие ошибки"');
    expect(markup).toContain("Ошибка: Не заполнено обязательное поле.");
    expect(markup).toContain('<details class="reference-warning-log"><summary>Предупреждений: 1</summary>');
    expect(markup).toContain("предупреждения принимаются автоматически");
    expect(markup).toContain("Предупреждение: Взяты сохранённые конечные значения формул: 129 ячеек");
    expect(markup).toContain("legacyOperationTime");
    expect(markup).not.toContain("<input");
    expect(markup).not.toContain("checkbox");
    expect(markup).not.toContain('class="reference-warning-log" open');
  });
});
