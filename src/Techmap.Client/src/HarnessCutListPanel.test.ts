import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { HarnessCutListPanel, HarnessCutListTable } from "./HarnessCutListPanel";
import type { HarnessCutList } from "./harness-cut-list-api";

const cutList: HarnessCutList = {
  projectId: "22345678-1234-4123-8123-123456789abc",
  harnessId: "32345678-1234-4123-8123-123456789abc",
  harnessQuantity: 3,
  status: "limited",
  warning: "Материал провода не закреплён. Карта показывает длины, но не является спецификацией материалов.",
  items: [{
    wireId: "W-1",
    circuit: "DATA+",
    material: "not-pinned",
    materialSourceKey: null,
    materialDisplayName: null,
    sourceLengthMm: 20.001,
    endCorrectionFromMm: -0.001,
    endCorrectionToMm: 0.002,
    roundingStepMm: 0.005,
    cutLengthMm: 20.005,
    pieces: 3,
    totalMetres: 0.060015,
    status: "ready",
    warnings: ["material-missing"],
  }, {
    wireId: "W-2",
    circuit: "",
    material: "not-pinned",
    materialSourceKey: null,
    materialDisplayName: null,
    sourceLengthMm: null,
    endCorrectionFromMm: 0,
    endCorrectionToMm: 0,
    roundingStepMm: 1,
    cutLengthMm: null,
    pieces: 3,
    totalMetres: null,
    status: "incomplete",
    warnings: ["material-missing", "length-missing"],
  }],
};

describe("HarnessCutListPanel", () => {
  it("renders all limited cut-list facts, warnings and incomplete status", () => {
    const markup = renderToStaticMarkup(createElement(HarnessCutListTable, { cutList }));
    for (const heading of ["Цепь / провод", "Исходная длина", "Поправки", "Длина резки", "Шт.", "Общий метраж", "Статус"]) {
      expect(markup).toContain(heading);
    }
    expect(markup).toContain("DATA+");
    expect(markup).toContain("20,001 мм");
    expect(markup).toContain("-0,001 / +0,002 мм");
    expect(markup).toContain("20,005 мм");
    expect(markup).toContain("0,060015 м");
    expect(markup).toContain("Материал не закреплён");
    expect(markup).toContain("не является спецификацией материалов");
    expect(markup).toContain("Не задана");
    expect(markup).toContain("Нет длины");
  });

  it("renders pinned material identity, ready status and each missing-data warning separately", () => {
    const pinnedItem = {
      ...cutList.items[0]!,
      wireId: "W-PINNED",
      material: "pinned",
      materialSourceKey: "UL1061-24-BK",
      materialDisplayName: "UL1061 24 AWG, чёрный",
      warnings: [],
    } as const;
    const materialMissingItem = {
      ...cutList.items[0]!,
      wireId: "W-MATERIAL-MISSING",
      warnings: ["material-missing"],
    } as const;
    const lengthMissingItem = {
      ...cutList.items[1]!,
      wireId: "W-LENGTH-MISSING",
      material: "pinned",
      materialSourceKey: "UL1061-24-RD",
      materialDisplayName: "UL1061 24 AWG, красный",
      warnings: ["length-missing"],
    } as const;
    const markup = renderToStaticMarkup(createElement(HarnessCutListTable, {
      cutList: { ...cutList, warning: "", items: [pinnedItem, materialMissingItem, lengthMissingItem] },
    }));

    expect(markup).toContain("UL1061 24 AWG, чёрный · UL1061-24-BK");
    expect(markup).toContain('<span class="cut-list-status ready">Готово</span>');
    expect(markup).toContain('<span class="cut-list-status ready">Нет материала</span>');
    expect(markup).toContain('<span class="cut-list-status incomplete">Нет длины</span>');
  });

  it("starts compact and offers an explicit refresh after editor save", () => {
    const markup = renderToStaticMarkup(createElement(HarnessCutListPanel, {
      api: { get: vi.fn(() => new Promise<never>(() => {})) },
      projectId: cutList.projectId,
      harnessId: cutList.harnessId,
    }));
    expect(markup).toContain('<details class="harness-cut-list">');
    expect(markup).not.toContain(" open=");
    expect(markup).toContain("Карта резки");
    expect(markup).toContain("После сохранения редактора обновите данные.");
    expect(markup).toContain("Обновить карту резки после сохранения редактора");
    expect(markup).toContain("Загрузка…");
  });
});
