import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { EditorSceneObject } from "./editor-types";
import { ObjectInspector, parseWireCorrectionDraft } from "./ObjectInspector";

function wireObject(metadata: Readonly<Record<string, string>>): EditorSceneObject {
  return {
    id: "wire-1",
    layerId: "wires",
    kind: "wire",
    label: "CAN-H",
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    color: "#334155",
    metadata,
  };
}

function inputTag(markup: string, ariaLabel: string): string {
  const marker = `aria-label="${ariaLabel}"`;
  const markerIndex = markup.indexOf(marker);
  expect(markerIndex).toBeGreaterThanOrEqual(0);
  return markup.slice(markup.lastIndexOf("<input", markerIndex), markup.indexOf(">", markerIndex) + 1);
}

describe("wire object inspector", () => {
  it("keeps intermediate signed correction text out of the document until it is a number", () => {
    expect(parseWireCorrectionDraft("")).toBeNull();
    expect(parseWireCorrectionDraft("-")).toBeNull();
    expect(parseWireCorrectionDraft("-2")).toBe(-2);
    expect(parseWireCorrectionDraft("-2.001")).toBe(-2.001);
  });

  it("shows editable source values and the calculated cut length", () => {
    const markup = renderToStaticMarkup(createElement(ObjectInspector, {
      view: "drawing",
      selectedObject: wireObject({
        lengthKnown: "true",
        lengthMm: "1000.1",
        endCorrectionFromMm: "10",
        endCorrectionToMm: "20",
        cutRoundingStepMm: "1",
        cutLengthMm: "1031",
        materialStatus: "included",
      }),
      disabled: false,
      onChange: vi.fn(),
    }));

    expect(inputTag(markup, "Длина задана")).toContain("checked");
    expect(inputTag(markup, "Абсолютная длина, мм")).toContain('value="1000.1"');
    expect(inputTag(markup, "Поправка начала, мм")).toContain('value="10"');
    expect(inputTag(markup, "Поправка начала, мм")).toContain('type="text"');
    expect(inputTag(markup, "Поправка начала, мм")).toContain('inputMode="decimal"');
    expect(inputTag(markup, "Поправка конца, мм")).toContain('value="20"');
    expect(markup).toContain("Расчётная длина резки");
    expect(markup).toContain("1031");
    expect(markup).toContain("Длина готова для карты резки");
  });

  it("does not expose drawing length controls on the E4 schematic", () => {
    const markup = renderToStaticMarkup(createElement(ObjectInspector, {
      view: "e4",
      selectedObject: wireObject({
        lengthKnown: "false",
        lengthMm: "",
        endCorrectionFromMm: "0",
        endCorrectionToMm: "0",
        cutRoundingStepMm: "1",
        cutLengthMm: "",
        materialStatus: "excluded",
      }),
      disabled: false,
      onChange: vi.fn(),
    }));

    expect(markup).not.toContain("Длина задана");
    expect(markup).not.toContain("Абсолютная длина, мм");
    expect(markup).not.toContain("Поправка начала, мм");
    expect(markup).not.toContain("Поправка конца, мм");
    expect(markup).not.toContain("Шаг округления длины резки, мм");
    expect(markup).not.toContain("Расчётная длина резки");
    expect(markup).toContain("Цепь / обозначение");
    expect(markup).toContain("Цвет");
  });

  it("offers all standard wire colors and keeps the full custom palette", () => {
    const markup = renderToStaticMarkup(createElement(ObjectInspector, {
      view: "e4", selectedObject: wireObject({ lengthKnown: "false" }), disabled: false, onChange: vi.fn(),
    }));
    expect(markup).toContain('aria-label="Стандартные цвета проводов"');
    for (const color of ["красный", "черный", "белый", "оранжевый", "зеленый", "фиолетовый", "желтый",
      "голубой", "синий", "коричневый", "серый", "розовый", "бирюзовый"]) {
      expect(markup).toContain(`aria-label="${color}"`);
    }
    expect(inputTag(markup, "Цвет объекта")).toContain('type="color"');
  });
});
