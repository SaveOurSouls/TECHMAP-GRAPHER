import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  canPublishXlsxPreview,
  fileSelectionLabel,
  ReferenceImportPanel,
} from "./ReferenceImportPanel";
import { AppNavigation } from "./App";
import type { XlsxReferencePreview } from "./reference-catalog-api";
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

  it("renders the real XLSX mapping and preview workflow", () => {
    const markup = renderToStaticMarkup(createElement(ReferenceImportPanel, { config, session }));

    expect(markup).toContain("Справочники");
    expect(markup).toContain("Выбрать XLSX");
    expect(markup).toContain("Строка заголовков");
    expect(markup).toContain("Ключевой столбец");
    expect(markup).toContain("generic-record");
    expect(markup).toContain("Проверить файл");
    expect(markup).toContain("Сначала проверьте файл");
    expect(markup).toContain('accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"');
  });

  it("requires current preview, warning acknowledgement and a live token", () => {
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

    expect(canPublishXlsxPreview(preview, new Set(), Date.parse("2026-09-12T18:00:00Z"))).toBe(false);
    expect(canPublishXlsxPreview(preview, new Set([warningId]), Date.parse("2026-09-12T18:00:00Z"))).toBe(true);
    expect(canPublishXlsxPreview(preview, new Set([warningId]), Date.parse(preview.expiresUtc))).toBe(false);
    expect(canPublishXlsxPreview(preview, new Set([warningId]), Date.parse("2026-09-12T18:00:00Z"), true)).toBe(false);
  });

  it("shows file identity without exposing file content", () => {
    const file = { name: "База данных.xlsx", size: 1536 } as File;
    expect(fileSelectionLabel(file)).toBe("База данных.xlsx · 2 КиБ");
    expect(fileSelectionLabel(null)).toBe("Файл не выбран");
  });
});
