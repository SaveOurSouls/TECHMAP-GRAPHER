import { expect, it } from "vitest";
import { createEmptyHarnessDesign } from "../editor/model";
import { previewRouteRebase } from "./route-rebase";
import type { ManufacturingRoute } from "./route-model";

it("previews removals without mutating manual work and revokes readiness", () => {
  const route: ManufacturingRoute = { contractVersion: 1, source: { fingerprintVersion: 1, sha256: "a".repeat(64) }, status: "draft", rows: [{
    id: "manual", kind: "semiFinished", title: "Ручное название", comment: "Не потерять", sourceObjects: [{ kind: "wire", id: "removed" }], dependsOn: [],
    operations: [{ id: "op", mode: "cut", binding: null, note: "Пояснение" }], prepared: true,
    terminalRequirements: [{ wireId: "removed", end: "from", terminalArticle: "T", stripLengthMm: null, binding: null }],
    presentation: { backgroundOpacity: .25, objects: [{ ref: { kind: "wire", id: "removed" }, hidden: false, points: [{ x: 1, y: 2 }] }] },
  }] };
  const preview = previewRouteRebase(route, createEmptyHarnessDesign(), "b".repeat(64));
  expect(preview.removed).toEqual([{ kind: "wire", id: "removed" }]);
  expect(preview.route.rows[0]).toMatchObject({ id: "manual", title: "Ручное название", comment: "Не потерять", sourceObjects: [], operations: route.rows[0]!.operations, prepared: false });
  expect(preview.route.rows[0]!.terminalRequirements).toEqual([]);
  expect(route.rows[0]!.sourceObjects).toHaveLength(1);
  expect(preview.route.source.sha256).toBe("b".repeat(64));
});
