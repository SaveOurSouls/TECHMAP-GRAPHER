import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createConnector, createWire } from "../editor/commands";
import { createEmptyHarnessDesign } from "../editor/model";
import { generateRoute } from "./route-commands";
import { buildRouteSourceItems } from "./route-source";
import { RouteAssemblyDrawing, assemblyDrawingFragment, createAssemblyDrawingDraft } from "./RouteAssemblyDrawing";

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
    expect(draft.objects[0]!.points).toEqual([{ x: 40, y: 50 }, { x: 180, y: 50 }, { x: 180, y: 90 }, { x: 400, y: 90 }]);
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
    expect(fragment.objects).toEqual([{ ref: wire.ref, points: [{ x: 10, y: 20 }, { x: 30, y: 40 }], hidden: false }]);
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
    expect(markup).toContain("route-assembly-drawing__background");
    expect(markup).toContain("route-assembly-drawing__foreground");
  });
});
