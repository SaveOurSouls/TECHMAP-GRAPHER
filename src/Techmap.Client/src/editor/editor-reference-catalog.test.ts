import { describe, expect, it } from "vitest";
import type { ReferenceCatalogSearchRecord } from "../reference-catalog-api";
import {
  builtInConnectorItems,
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
