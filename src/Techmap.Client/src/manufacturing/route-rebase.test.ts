import { expect, it } from "vitest";
import { createEmptyHarnessDesign } from "../editor/model";
import { previewRouteRebase } from "./route-rebase";
import type { ManufacturingRoute } from "./route-model";

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
  expect(preview.route.rows[0]).toMatchObject({ id: "manual", title: "Ручное название", comment: "Не потерять", sourceObjects: [], operations: route.rows[0]!.operations, prepared: false });
  expect(preview.route.rows[0]!.terminalRequirements).toEqual([]);
  expect(preview.route.rows[0]!.wireBlankSelections).toEqual([]);
  expect(route.rows[0]!.sourceObjects).toHaveLength(1);
  expect(preview.route.source.sha256).toBe("b".repeat(64));
});

it("removes assembly input lines whose raw source disappeared from the drawing", () => {
  const source = { kind: "connector" as const, id: "removed" };
  const route: ManufacturingRoute = { contractVersion: 1, source: { fingerprintVersion: 1, sha256: "a".repeat(64) }, status: "draft", rows: [{
    id: "assembly", kind: "assembly", title: "Сборка", comment: "Сохранить", sourceObjects: [source], dependsOn: [],
    assemblyInputs: [{ id: "input-1", kind: "source", ref: source }], operations: [], prepared: true,
    presentation: { backgroundOpacity: 0, objects: [{ ref: source, points: [{ x: 5, y: 6 }], hidden: false }], drawingObjects: [{ id: "pipe", kind: "physical-segment", layerId: "wires", points: [{ x: 5, y: 6 }], hidden: true }] },
  }] };
  const preview = previewRouteRebase(route, createEmptyHarnessDesign(), "b".repeat(64));
  expect(preview.removed).toEqual([source]);
  expect(preview.route.rows[0]).toMatchObject({ assemblyInputs: [], sourceObjects: [], prepared: false, comment: "Сохранить" });
  expect(preview.route.rows[0]!.presentation.objects).toEqual([]);
  expect(preview.route.rows[0]!.presentation.drawingObjects).toEqual(route.rows[0]!.presentation.drawingObjects);
});
