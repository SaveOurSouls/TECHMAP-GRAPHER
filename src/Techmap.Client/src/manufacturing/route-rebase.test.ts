import { expect, it } from "vitest";
import { createEmptyHarnessDesign } from "../editor/model";
import { createConnector, createWire } from "../editor/commands";
import { previewRouteRebase } from "./route-rebase";
import type { ManufacturingRoute } from "./route-model";
import { createRouteDrawingCopy } from "./route-drawing-copy";

it("previews removals without mutating manual work and revokes readiness", () => {
  const route: ManufacturingRoute = { contractVersion: 1, source: { fingerprintVersion: 1, sha256: "a".repeat(64) }, status: "draft", rows: [{
    id: "manual", kind: "semiFinished", title: "Ручное название", comment: "Не потерять", sourceObjects: [{ kind: "wire", id: "removed" }], dependsOn: [],
    operations: [{ id: "op", mode: "cut", binding: null, note: "Пояснение" }], prepared: true,
    terminalRequirements: [{ wireId: "removed", end: "from", terminalArticle: "T", stripLengthMm: null, binding: null }],
    wireBlankSelections: [{ wireId: "removed", binding: { sourceId: "technology-wire-blanks", entityType: "wire-blank", snapshotId: "11111111-1111-4111-8111-111111111111", snapshotSha256: "b".repeat(64), recordId: "c".repeat(64), sourceKey: "blank", displayName: "Blank", visual: { start: "cut", end: "cut", color: "#ff0000", templateId: "01-cut", photoDataUrl: null } } }],
    presentation: { backgroundOpacity: .25, objects: [{ ref: { kind: "wire", id: "removed" }, hidden: false, points: [{ x: 1, y: 2 }] }] },
  }] };
  const preview = previewRouteRebase(route, createEmptyHarnessDesign(), "b".repeat(64));
  expect(preview.removed).toEqual([{ kind: "wire", id: "removed" }]);
  expect(preview.route.rows).toEqual([]);
  expect(route.rows[0]!.sourceObjects).toHaveLength(1);
  expect(preview.route.source.sha256).toBe("b".repeat(64));
});

it("removes a vanished wire from a merged blank and its assembly, then inserts a new wire before the assembly", () => {
  const a = createConnector("a", "X1", 2, { x: 0, y: 0 });
  const b = createConnector("b", "X2", 2, { x: 100, y: 0 });
  const wire = (id: string, contact: number) => createWire(id,
    { connectorId: "a", contactId: a.contacts[contact]!.id },
    { connectorId: "b", contactId: b.contacts[contact]!.id }, 100);
  const document = { ...createEmptyHarnessDesign(), connectors: [a, b], wires: [wire("keep", 0), wire("new", 1)] };
  const route: ManufacturingRoute = { contractVersion: 1, source: { fingerprintVersion: 1, sha256: "a".repeat(64) }, status: "draft", rows: [
    { id: "merged", kind: "semiFinished", title: "Пара", comment: "Оставить", sourceObjects: [{ kind: "wire", id: "keep" }, { kind: "wire", id: "gone" }],
      dependsOn: [], operations: [], prepared: true, presentation: { backgroundOpacity: .25, objects: [] } },
    { id: "orphan", kind: "semiFinished", title: "Удалён", comment: "", sourceObjects: [{ kind: "wire", id: "gone2" }], dependsOn: [], operations: [], prepared: true, presentation: { backgroundOpacity: .25, objects: [] } },
    { id: "assembly", kind: "assembly", title: "Сборка", comment: "Ручная", sourceObjects: [], dependsOn: ["merged", "orphan"],
      assemblyInputs: [{ id: "one", kind: "row", rowId: "merged" }, { id: "two", kind: "row", rowId: "orphan" }], operations: [], prepared: true,
      presentation: { backgroundOpacity: .25, objects: [] } },
  ] };
  const result = previewRouteRebase(route, document, "b".repeat(64));
  expect(result.removed.map(ref => ref.id)).toEqual(["gone", "gone2"]);
  expect(result.added).toEqual([{ kind: "wire", id: "new" }]);
  expect(result.route.rows.map(row => row.kind === "assembly" ? row.id : row.sourceObjects[0]!.id)).toEqual(["keep", "new", "assembly"]);
  expect(result.route.rows[0]).toMatchObject({ id: "merged", comment: "Оставить", prepared: false, sourceObjects: [{ kind: "wire", id: "keep" }] });
  expect(result.route.rows[2]).toMatchObject({ dependsOn: ["merged"], assemblyInputs: [{ id: "one", rowId: "merged" }], comment: "Ручная", prepared: false });
});

it("removes assembly input lines whose raw source disappeared from the drawing", () => {
  const source = { kind: "connector" as const, id: "removed" };
  const route: ManufacturingRoute = { contractVersion: 1, source: { fingerprintVersion: 1, sha256: "a".repeat(64) }, status: "draft", rows: [{
    id: "assembly", kind: "assembly", title: "Сборка", comment: "Сохранить", sourceObjects: [source], dependsOn: [],
    assemblyInputs: [{ id: "input-1", kind: "source", ref: source }], operations: [], prepared: true,
    presentation: { backgroundOpacity: 0, objects: [{ ref: source, points: [{ x: 5, y: 6 }], hidden: false }], drawingObjects: [{ id: "pipe", kind: "physical-segment", layerId: "wires", points: [{ x: 5, y: 6 }], hidden: true }], drawingCopy: createRouteDrawingCopy(createEmptyHarnessDesign(), ["pipe"]) },
  }] };
  const preview = previewRouteRebase(route, createEmptyHarnessDesign(), "b".repeat(64));
  expect(preview.removed).toEqual([source]);
  expect(preview.route.rows[0]).toMatchObject({ assemblyInputs: [], sourceObjects: [], prepared: false, comment: "Сохранить" });
  expect(preview.route.rows[0]!.presentation.objects).toEqual([]);
  expect(preview.route.rows[0]!.presentation.drawingObjects).toEqual(route.rows[0]!.presentation.drawingObjects);
  expect(preview.route.rows[0]!.presentation.drawingCopy).toEqual(route.rows[0]!.presentation.drawingCopy);
  expect(preview.route.rows[0]!.presentation.drawingCopy).not.toBe(route.rows[0]!.presentation.drawingCopy);
});
