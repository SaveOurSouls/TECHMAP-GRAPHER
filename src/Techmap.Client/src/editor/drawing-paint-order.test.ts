import { afterEach, expect, it, vi } from "vitest";
import { hitTestEditorScene, objectsInPaintOrder, redrawCanvas } from "./CanvasViewport";
import type { EditorLayer, EditorSceneObject } from "./editor-types";

const layers: EditorLayer[] = [
  { id: "picture", label: "Рисунок", visible: true, locked: false },
  { id: "wire", label: "Провод", visible: true, locked: false },
];
const connector: EditorSceneObject = {
  id: "X1", kind: "connector", layerId: "picture", label: "X1",
  x: 0, y: 0, width: 100, height: 60, color: "#123456",
  metadata: { materializedContactPoints: JSON.stringify([{ x: 20, y: 20, direction: "right", status: "available" }, null]) },
};
const wire: EditorSceneObject = {
  id: "W1", kind: "wire", layerId: "wire", label: "", color: "#ff0000",
  x: 0, y: 0, width: 0, height: 0, points: [{ x: 20, y: 20 }, { x: 120, y: 20 }],
};
afterEach(() => vi.unstubAllGlobals());

it("keeps drawing pictures below wires after either layer order, without changing E4", () => {
  for (const order of [layers, [...layers].reverse()]) {
    expect(objectsInPaintOrder([wire, connector], order, "drawing").map(o => o.id)).toEqual(["X1", "W1"]);
    expect(hitTestEditorScene([wire, connector], order, { x: 70, y: 20 }, 1, "drawing")).toBe("W1");
    expect(hitTestEditorScene([wire, connector], order, { x: 20, y: 20 }, 1, "drawing")).toBe("X1");
  }
  expect(objectsInPaintOrder([wire, connector], layers, "e4").map(o => o.id)).toEqual(["W1", "X1"]);
  const hidden = layers.map(l => l.id === "picture" ? { ...l, visible: false } : l);
  expect(objectsInPaintOrder([wire, connector], hidden, "drawing").map(o => o.id)).toEqual(["W1"]);
  expect(hitTestEditorScene([wire, connector], hidden, { x: 20, y: 20 }, 1, "drawing")).toBe("W1");
});

it("paints unselected contact marks after an overlapping wire and table in the actual canvas pass", () => {
  vi.stubGlobal("window", { devicePixelRatio: 1 });
  const operations: { method: string; args: unknown[]; color: unknown }[] = [];
  const state: Record<string, unknown> = {};
  const context = new Proxy(state, {
    get(target, key: string) {
      if (key in target) return target[key];
      return (...args: unknown[]) => operations.push({ method: key, args, color: key === "stroke" ? target.strokeStyle : target.fillStyle });
    },
  }) as unknown as CanvasRenderingContext2D;
  const canvas = { width: 300, height: 200, clientWidth: 300, clientHeight: 200, getContext: () => context } as unknown as HTMLCanvasElement;
  const table: EditorSceneObject = { id: "table", layerId: "picture", kind: "drawing-table", label: "TABLE", x: 0, y: 0, width: 100, height: 100, color: "#333", metadata: { widths: "[]", headers: "[]", rows: "[]" } };
  redrawCanvas(canvas, "drawing", { offsetX: 0, offsetY: 0, zoom: 1 }, [wire, connector, table], layers, new Set());
  const lastContact = operations.reduce((last, o, index) => o.method === "arc" && o.args[0] === 20 && o.args[1] === 20 ? index : last, -1);
  const wireStroke = operations.findIndex(o => o.method === "stroke" && o.color === "#ff0000");
  const tablePaint = operations.findIndex(o => o.method === "fillText" && o.args[0] === "TABLE");
  const connectorFill = operations.findIndex(o => o.method === "fillText" && o.args[0] === "X1");
  expect(connectorFill).toBeLessThan(wireStroke);
  expect(lastContact).toBeGreaterThan(wireStroke);
  expect(lastContact).toBeGreaterThan(tablePaint);
  expect(operations.slice(lastContact + 1).filter(o => o.method === "fill")).toEqual([{ method: "fill", args: [], color: "#123456" }]);
});
