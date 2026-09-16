import { describe, expect, it } from "vitest";
import type { ReferenceCatalogSearchRecord } from "../reference-catalog-api";
import {
  builtInConnectorItems,
  componentTemplateSummaryToEditorCatalogItem,
  componentTemplateSummaryToEditorCatalogItems,
  filterComponentTemplates,
  filterBuiltInConnectors,
  referenceRecordToEditorCatalogItem,
  remoteEditorCatalogSources,
} from "./editor-reference-catalog";

function source(id: string) {
  const result = remoteEditorCatalogSources.find((item) => item.id === id);
  if (!result) throw new Error(`missing test source ${id}`);
  return result;
}

function record(entityType: string, sourceKey: string, payload: Readonly<Record<string, unknown>>): ReferenceCatalogSearchRecord {
  return { recordId: "a".repeat(64), entityType, sourceKey, payload, sourceLocation: null };
}

describe("editor reference catalog", () => {
  it("exposes exact immutable component template versions for placement", () => {
    const template = {
      templateId: "12345678-1234-4123-8123-123456789abc",
      version: 7,
      code: "JST-XH",
      name: "JST XH",
      articleBindings: [],
      createdUtc: "2026-09-14T00:00:00Z",
    };
    expect(componentTemplateSummaryToEditorCatalogItem(template)).toMatchObject({
      id: `component-template:${template.templateId}:7`,
      title: "JST XH",
      subtitle: "JST-XH · версия 7",
      placement: "connector",
      componentTemplateId: template.templateId,
      componentTemplateVersion: 7,
    });
    expect(filterComponentTemplates([template], "xh")).toHaveLength(1);
    expect(filterComponentTemplates([template], "unknown")).toEqual([]);
  });

  it("creates one family card for all article variants and keeps article search", () => {
    const template = {
      templateId: "12345678-1234-4123-8123-123456789abc",
      version: 7,
      code: "JST-XH",
      name: "JST XH",
      articleBindings: [
        { sourceId: "БД.СОЕД", entityType: "connector", articleKey: "B2B-XH-A" },
        { sourceId: "БД.СОЕД", entityType: "connector", articleKey: "B10B-XH-A" },
      ],
      createdUtc: "2026-09-14T00:00:00Z",
    };

    const items = componentTemplateSummaryToEditorCatalogItems(template);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: `component-template:${template.templateId}:7`,
      title: "JST XH",
      subtitle: "JST-XH · 2 артикула · версия 7",
      componentTemplateId: template.templateId,
      componentTemplateVersion: 7,
      componentArticles: template.articleBindings,
    });
    expect(filterComponentTemplates([template], "b10b").map((item) => item.title)).toEqual(["JST XH"]);
    expect(filterComponentTemplates([template], "jst")).toHaveLength(1);
  });

  it("keeps built-in connector cards and searches them locally", () => {
    expect(builtInConnectorItems.map((item) => item.title)).toEqual(["Серия XS", "JST XH", "Свободный соединитель"]);
    expect(filterBuiltInConnectors("XS-10").map((item) => item.title)).toEqual(["Серия XS"]);
    expect(filterBuiltInConnectors("unknown")).toEqual([]);
  });

  it("formats terminal sourceKey, compatible section, insulation and strip length", () => {
    const item = referenceRecordToEditorCatalogItem(source("technology-terminals"), record("terminal", "TER-0007", {
      productName: "Сигнальный контакт",
      sectionFromMm2: 0.35,
      sectionToMm2: 0.5,
      insulationDiameterFromMm: "1,2",
      insulationDiameterToMm: "1,8",
      stripLengthMm: 4.5,
    }));

    expect(item.title).toBe("TER-0007");
    expect(item.subtitle).toBe("Сигнальный контакт · 0,35–0,5 мм² · 1,2–1,8 мм Ø изоляции · зачистка 4,5 мм");
    expect(item).toMatchObject({ sourceId: "technology-terminals", entityType: "terminal", placement: "reference-only" });
  });

  it("formats cable layers and AWG data without inventing missing values", () => {
    const cable = referenceRecordToEditorCatalogItem(source("technology-coax-cables"), record("coax-cable", "RG-316", {
      layers: [{ index: 1, diameterMm: 0.5 }, { index: 2, diameterMm: 1.5 }, { index: 3, diameterMm: 2.5 }],
    }));
    const awg = referenceRecordToEditorCatalogItem(source("technology-awg-reference"), record("awg-reference", "22", {
      sectionMm2: 0.35,
      conductorDiameterMm: 0.67,
    }));

    expect(cable.subtitle).toBe("D1 0,5 мм · D2 1,5 мм · D3 2,5 мм");
    expect(awg.subtitle).toBe("0,35 мм² · Ø жилы 0,67 мм");
  });

  it("keeps an incomplete published record visible and labels missing characteristics", () => {
    const item = referenceRecordToEditorCatalogItem(
      source("technology-terminals"),
      record("terminal", "TER-INCOMPLETE", {}),
    );

    expect(item.title).toBe("TER-INCOMPLETE");
    expect(item.subtitle).toContain("характеристики не заполнены");
  });
});
