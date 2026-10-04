import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FreeWireEndsPanel } from "./FreeWireEndsPanel";

const wire = (id: string, freeFrom: string, freeTo: string) => ({ id, kind: "wire" as const, layerId: "wires", label: id, x: 0, y: 0, width: 2, height: 2, color: "#123456", points: [{ x: 1, y: 2 }, { x: 11, y: 12 }], metadata: { freeFrom, freeTo } });

describe("FreeWireEndsPanel", () => {
  it("only renders free ends and supports group controls", () => {
    const html = renderToStaticMarkup(createElement(FreeWireEndsPanel, { objects: [wire("W1", "true", "false"), { ...wire("W2", "true", "true"), drawingEndStyles: { from: "copper", to: "sealed" } }], selectedIds: ["W1", "W2"], disabled: false, onStyle: vi.fn(), onStyles: vi.fn(), onEndpoint: vi.fn(), onBulkX: vi.fn(), focusTarget: { wireId: "W2", end: "to", requestId: 1 } }));
    expect(html).toContain('aria-label="W1: режим from"');
    expect(html).not.toContain('aria-label="W1: режим to"');
    expect(html).toContain('aria-label="Общая координата X from"');
    expect(html).toContain('data-free-wire-id="W2" data-free-wire-end="to"');
    expect(html).toContain('<option value="sealed" selected="">Наконечник с уплотнителем</option>');
    expect(html).toContain('<option value="" selected="">Начало…</option>');
  });
});
