import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createConnector, createWire } from "../editor/commands";
import { createEmptyHarnessDesign } from "../editor/model";
import { generateRoute } from "./route-commands";
import { buildRouteSourceItems } from "./route-source";
import { RouteAssemblyDrawing, RouteAssemblyDrawingPreview, assemblyDrawingFragment, assemblyDrawingScene, createAssemblyDrawingDraft, moveAssemblyDrawingObject, setAssemblyDrawingLayerVisibility } from "./RouteAssemblyDrawing";
import { designToScene } from "../editor/HarnessDesignEditor";
import { physicalFixture } from "../editor/physical-topology-fixture";

function fixture() {
  const a = createConnector("a", "X1", 1, { x: 40, y: 50 });
  const b = createConnector("b", "X2", 1, { x: 400, y: 90 });
  const wire = { ...createWire("wire", { connectorId: a.id, contactId: a.contacts[0]!.id }, { connectorId: b.id, contactId: b.contacts[0]!.id }, 225, "Питание", "#f00"), drawingRoute: [{ x: 180, y: 50 }, { x: 180, y: 90 }] };
  const document = { ...createEmptyHarnessDesign(), connectors: [a, b], wires: [wire] };
  const items = buildRouteSourceItems(document);
  const generated = generateRoute(document, "a".repeat(64), 1);
  const row = { ...generated.rows[0]!, kind: "assembly" as const, title: "Первая сборка" };
  return { document, items, row };
}

describe("assembly drawing copy", () => {
  it("copies drawing points without mutating the harness or row", () => {
    const { document, items, row } = fixture();
    const sourceBefore = structuredClone(document);
    const draft = createAssemblyDrawingDraft(row, document, items.filter(item => item.ref.kind === "wire"));
    expect(draft.objects[0]!.points.slice(1, 3)).toEqual([{ x: 180, y: 50 }, { x: 180, y: 90 }]);
    expect(draft.drawingObjects?.some(object => object.kind === "wire" && object.points.length >= 4)).toBe(true);
    expect(draft.objects[0]!.points[1]).not.toBe(document.wires[0]!.drawingRoute[0]);
    expect(document).toEqual(sourceBefore);
    expect(row.presentation.objects).toEqual([]);
  });

  it("preserves the prior authored shape when reopening and clips the saved fragment", () => {
    const { document, items, row } = fixture();
    const wire = items.find(item => item.ref.kind === "wire")!;
    const connector = items.find(item => item.ref.kind === "connector")!;
    const previous = {
      ...row,
      presentation: { backgroundOpacity: 1, objects: [
        { ref: wire.ref, points: [{ x: 10, y: 20 }, { x: 30, y: 40 }], hidden: false },
        { ref: connector.ref, points: [{ x: 50, y: 60 }], hidden: true },
      ] },
    };
    const draft = createAssemblyDrawingDraft(previous, document, [wire, connector]);
    expect(draft.objects[0]!.points).toEqual([{ x: 10, y: 20 }, { x: 30, y: 40 }]);
    expect(draft.objects[1]!.hidden).toBe(true);
    const fragment = assemblyDrawingFragment(draft);
    expect(fragment.backgroundOpacity).toBe(1);
    expect(fragment.objects).toEqual([
      { ref: wire.ref, points: [{ x: 10, y: 20 }, { x: 30, y: 40 }], hidden: false },
      { ref: connector.ref, points: [{ x: 50, y: 60 }], hidden: true },
    ]);
    expect(previous.presentation.objects).toHaveLength(2);
  });

  it("renders full harness geometry only in the editor copy", () => {
    const { document, items, row } = fixture();
    const markup = renderToStaticMarkup(createElement(RouteAssemblyDrawing, {
      row, document, sources: items, items: items.filter(item => item.ref.kind === "wire"), onSave: () => {}, onCancel: () => {},
    }));
    expect(markup).toContain("Копия чертежа сборки");
    expect(markup).toContain("Сохранить фрагмент");
    expect(markup).toContain("Фон жгута");
    expect(markup).toContain('min="0" max="100"');
    expect(markup).toContain("route-assembly-drawing__viewport-background");
    expect(markup).toContain("route-assembly-drawing__viewport-canvas");
  });

  it("opens an empty assembly on all drawing layers and preserves an isolated fragment", () => {
    const { document, row } = fixture();
    const draft = createAssemblyDrawingDraft(row, document, []);
    expect(draft.drawingObjects?.length).toBeGreaterThan(2);
    expect(draft.drawingObjects?.every(object => !object.hidden)).toBe(true);
    const wireId = document.wires[0]!.id;
    const isolated = { ...draft, drawingObjects: draft.drawingObjects!.map(object => ({ ...object, hidden: object.id !== wireId })) };
    const saved = assemblyDrawingFragment(isolated);
    const reopened = createAssemblyDrawingDraft({ ...row, presentation: saved }, document, []);
    expect(reopened.drawingObjects?.filter(object => !object.hidden).map(object => object.id)).toEqual([wireId]);
    expect(assemblyDrawingScene(designToScene(document, "drawing"), reopened.drawingObjects!).map(object => object.id)).toEqual([wireId]);
    const markup = renderToStaticMarkup(createElement(RouteAssemblyDrawingPreview, { row: { ...row, presentation: saved }, document }));
    expect(markup).toContain("Фрагмент сборки");
  });

  it("keeps P, OP and covering as selectable saved drawing objects", () => {
    const base = physicalFixture();
    const document = { ...base, physicalTopology: { ...base.physicalTopology!,
      joiningPipes: [{ id: "op", start: { x: 120, y: 80 }, end: { x: 360, y: 80 }, path: { kind: "polyline" as const, points: [] }, members: [{ segmentIds: ["S0"], from: 0, to: 1, reverse: false }], mode: "flat" as const }],
      coverings: [{ id: "shell", name: "Оболочка", width: 14, color: "#aebfc9", lengthMm: null, spans: [{ segmentId: "S0", from: 0, to: 1 }] }],
    } };
    const generated = generateRoute(document, "a".repeat(64), 1);
    const row = { ...generated.rows[0]!, kind: "assembly" as const };
    const draft = createAssemblyDrawingDraft(row, document, []);
    const ids = draft.drawingObjects!.map(object => object.id);
    expect(ids).toContain("S0");
    expect(ids).toContain("op");
    expect(ids).toContain("shell");
    const source = JSON.stringify(document);
    const isolated = assemblyDrawingFragment({ ...draft, drawingObjects: draft.drawingObjects!.map(object => ({ ...object, hidden: object.id !== "op" })) });
    expect(assemblyDrawingScene(designToScene(document, "drawing"), isolated.drawingObjects!).map(object => object.id)).toEqual(["op"]);
    expect(JSON.stringify(document)).toBe(source);
  });

  it("persists layer visibility and moves a covering in the copy", () => {
    const base = physicalFixture();
    const document = { ...base, physicalTopology: { ...base.physicalTopology!, coverings: [{ id: "shell", name: "Оболочка", width: 14, color: "#aaa", lengthMm: null, spans: [{ segmentId: "S0", from: 0, to: 1 }] }] } };
    const row = { ...generateRoute(document, "a".repeat(64), 1).rows[0]!, kind: "assembly" as const };
    const draft = createAssemblyDrawingDraft(row, document, []);
    const shell = draft.drawingObjects!.find(object => object.id === "shell")!;
    const hidden = setAssemblyDrawingLayerVisibility(draft.drawingObjects!, shell.layerId, false);
    expect(hidden.find(object => object.id === shell.id)!.hidden).toBe(true);
    const moved = moveAssemblyDrawingObject(draft.drawingObjects!, shell.id, shell.points[0]!, { x: shell.points[0]!.x + 25, y: shell.points[0]!.y + 15 });
    expect(moved.find(object => object.id === shell.id)!.points[0]).toEqual({ x: shell.points[0]!.x + 25, y: shell.points[0]!.y + 15 });
    const reopened = createAssemblyDrawingDraft({ ...row, presentation: assemblyDrawingFragment({ ...draft, drawingObjects: hidden }) }, document, []);
    expect(reopened.drawingObjects!.find(object => object.id === shell.id)!.hidden).toBe(true);
  });
});
