import { describe, expect, it } from "vitest";
import { parseManufacturingRoute, routeRowComposition } from "./route-model";
import { createEmptyHarnessDesign } from "../editor/model";
import { createRouteDrawingCopy } from "./route-drawing-copy";

const ref = (id: string) => ({ kind: "wire" as const, id });
const row = (id: string, dependsOn: string[] = [], sourceObjects = [ref(id)]): Record<string, unknown> => ({
  id, kind: "semiFinished", title: id, comment: "", sourceObjects, dependsOn, operations: [],
  presentation: { backgroundOpacity: .25, objects: [] }, prepared: false,
});
const route = (rows: unknown[], status: "draft" | "completed" = "draft") => parseManufacturingRoute({
  contractVersion: 1, source: { fingerprintVersion: 1, sha256: "a".repeat(64) }, status, rows,
});

describe("manufacturing route contract", () => {
  it("stores a complete independent drawing copy for an assembly or semi-finished row", () => {
    const document = createEmptyHarnessDesign();
    const copy = createRouteDrawingCopy(document, ["layer:wire"]);
    const candidate = { ...row("assembly", [], []), kind: "assembly" as const, presentation: { backgroundOpacity: .25, objects: [], drawingCopy: copy } };
    const parsed = route([candidate])!;
    expect(parsed.rows[0]!.presentation.drawingCopy?.document).toEqual(copy.document);
    expect(parsed.rows[0]!.presentation.drawingCopy?.document).not.toBe(copy.document);
    expect(() => route([{ ...candidate, presentation: { ...candidate.presentation, drawingCopy: { ...copy, document: { ...copy.document, manufacturingRoute: route([]) } } } }])).toThrow();
    const semiFinished = { ...row("wire"), presentation: { backgroundOpacity: .25, objects: [], drawingCopy: copy }, wireBlankSelections: [{ wireId: "wire", binding: { sourceId: "technology-wire-blanks", entityType: "wire-blank", snapshotId: "11111111-1111-4111-8111-111111111111", snapshotSha256: "a".repeat(64), recordId: "b".repeat(64), sourceKey: "P-01", displayName: "Провод", visual: { start: "cut", end: "cut", color: "#26609e", templateId: "cut", photoDataUrl: null } } }] };
    expect(route([semiFinished])?.rows[0]?.presentation.drawingCopy?.document).toEqual(copy.document);
    expect(route([semiFinished])?.rows[0]?.wireBlankSelections).toEqual(semiFinished.wireBlankSelections);
  });
  it("keeps the source and isolated drawing copies side by side", () => {
    const copy = createRouteDrawingCopy(createEmptyHarnessDesign(), []);
    const parsed = route([{ ...row("assembly", [], []), kind: "assembly", presentation: { backgroundOpacity: .25, objects: [], drawingCopy: copy, isolatedDrawingCopy: copy } }])!;
    expect(parsed.rows[0]!.presentation.drawingCopy?.document).toEqual(copy.document);
    expect(parsed.rows[0]!.presentation.isolatedDrawingCopy?.document).toEqual(copy.document);
    expect(parsed.rows[0]!.presentation.isolatedDrawingCopy).not.toBe(parsed.rows[0]!.presentation.drawingCopy);
  });
  it("accepts a diamond and composes shared ancestors once", () => {
    const parsed = route([row("a"), row("b", ["a"], [ref("b")]), row("c", ["a"], [ref("c")]), row("d", ["b", "c"], [])])!;
    expect(routeRowComposition(parsed, "d").map(item => item.id)).toEqual(["a", "b", "c"]);
  });
  it("rejects cycles, orphan parents and duplicate source introduction", () => {
    expect(() => route([row("a", ["b"]), row("b", ["a"], [])])).toThrow();
    expect(() => route([row("a", ["missing"])])).toThrow();
    expect(() => route([row("a"), row("b", [], [ref("a")])])).toThrow();
  });
  it("requires bound operations for completed routes", () => {
    expect(() => route([{ ...row("a"), prepared: true, operations: [{ id: "op", binding: null, mode: "cut", note: "" }] }], "completed")).toThrow();
  });
  it("allows inherited presentation but rejects unrelated and orphan references", () => {
    const item = (id: string) => ({ ref: ref(id), hidden: false, points: [{ x: 10, y: 20 }] });
    expect(route([row("a"), { ...row("b", ["a"], []), presentation: { backgroundOpacity: .25, objects: [item("a")] } }])).toBeDefined();
    expect(() => route([row("a"), { ...row("b"), presentation: { backgroundOpacity: .25, objects: [item("a")] } }])).toThrow();
    expect(() => route([{ ...row("a"), presentation: { backgroundOpacity: .25, objects: [item("missing")] } }])).toThrow();
  });
  it("copies geometry and distinguishes object kinds sharing the same ID", () => {
    const source = { ...row("a"), sourceObjects: [ref("same"), { kind: "cable", id: "same" }], presentation: { backgroundOpacity: .25, objects: [{ ref: ref("same"), points: [{ x: 1, y: 2 }], hidden: false }] } };
    const parsed = route([source])!;
    source.presentation.objects[0]!.points[0]!.x = 99;
    expect(parsed.rows[0]!.presentation.objects[0]!.points[0]!.x).toBe(1);
    expect(routeRowComposition(parsed, "a")).toHaveLength(2);
  });
  it("rejects duplicate row IDs, dependency edges and operation IDs", () => {
    expect(() => route([row("a"), row("a", [], [])])).toThrow();
    expect(() => route([row("a"), row("b", ["a", "a"])])).toThrow();
    const op = { id: "op", binding: null, mode: "cut", note: "" };
    expect(() => route([{ ...row("a"), operations: [op, op] }])).toThrow();
    expect(() => route([{ ...row("a"), operations: [op] }, { ...row("b"), operations: [op] }])).toThrow();
  });
  it("requires every row prepared and a pinned operation for completion", () => {
    const binding = { sourceId: "ops", entityType: "operation", snapshotId: "11111111-1111-4111-8111-111111111111", snapshotSha256: "b".repeat(64), recordId: "c".repeat(64), sourceKey: "cut", displayName: "Резка" };
    expect(route([{ ...row("a"), kind: "assembly", prepared: true, operations: [{ id: "op", binding, mode: "assembly", note: "" }] }], "completed")?.status).toBe("completed");
    expect(() => route([{ ...row("a"), prepared: true, operations: [{ id: "op", binding, mode: "cut", note: "" }] }], "completed")).toThrow();
    expect(() => route([], "completed")).toThrow();
    expect(() => route([{ ...row("a"), operations: [{ id: "op", binding, mode: "cut", note: "" }] }], "completed")).toThrow();
  });
  it("keeps old opacity values and accepts the full 0 to 100 percent range", () => {
    for (const backgroundOpacity of [0, .1, .25, .5, 1]) {
      expect(route([{ ...row("a"), presentation: { backgroundOpacity, objects: [] } }])?.rows[0]?.presentation.backgroundOpacity).toBe(backgroundOpacity);
    }
    for (const backgroundOpacity of [-.01, 1.01, NaN]) {
      expect(() => route([{ ...row("a"), presentation: { backgroundOpacity, objects: [] } }])).toThrow();
    }
  });
  it("pins a wire illustration and preserves an independent drawing scene", () => {
    const pinned = { wireId: "a", binding: { sourceId: "technology-wire-blanks", entityType: "wire-blank", snapshotId: "11111111-1111-4111-8111-111111111111", snapshotSha256: "a".repeat(64), recordId: "b".repeat(64), sourceKey: "ПФП-01", displayName: "После резки", visual: { start: "cut", end: "cut", color: "#26609e", templateId: "01-cut", photoDataUrl: null } } };
    const candidate = { ...row("a"), wireBlankSelections: [pinned], presentation: { backgroundOpacity: .25, objects: [{ ref: ref("a"), points: [], hidden: false }], drawingObjects: [{ id: "pipe-1", kind: "physical-pipe", layerId: "pipes", points: [{ x: 3, y: 4 }], hidden: true }] } };
    expect(route([candidate])?.rows[0]?.wireBlankSelections?.[0]?.binding.recordId).toBe("b".repeat(64));
    expect(route([candidate])?.rows[0]?.presentation.drawingObjects?.[0]?.hidden).toBe(true);
    expect(() => route([{ ...candidate, wireBlankSelections: [pinned, pinned] }])).toThrow();
  });
  it("preserves independently addressable assembly inputs and rejects drift from dependency lists", () => {
    const assembly = { ...row("assembly", ["a"], []), kind: "assembly", assemblyInputs: [{ id: "input-a", kind: "row", rowId: "a" }] };
    expect(route([row("a"), assembly])?.rows[1]?.assemblyInputs).toEqual(assembly.assemblyInputs);
    expect(() => route([row("a"), { ...assembly, assemblyInputs: [] }])).toThrow();
    expect(() => route([row("a"), { ...assembly, assemblyInputs: [assembly.assemblyInputs[0], assembly.assemblyInputs[0]] }])).toThrow();
    expect(() => route([{ ...row("a"), assemblyInputs: [] }])).toThrow();
  });
  it("rejects unsupported route versions", () => {
    const parsed = route([row("a")])!;
    expect(() => parseManufacturingRoute({ ...parsed, contractVersion: 2 })).toThrow();
    expect(() => parseManufacturingRoute({ ...parsed, source: { ...parsed.source, fingerprintVersion: 2 } })).toThrow();
    expect(() => parseManufacturingRoute({ ...parsed, source: { ...parsed.source, sha256: "bad" } })).toThrow();
  });
  it("accepts the shared operation role only on an assembly row", () => {
    const assembly = { ...row("assembly", ["a"], []), kind: "assembly" as const, role: "sharedOperation", assemblyInputs: [{ id: "input-a", kind: "row" as const, rowId: "a" }] };
    expect(route([row("a"), assembly])?.rows[1]?.role).toBe("sharedOperation");
    expect(() => route([{ ...row("a"), role: "sharedOperation" }])).toThrow();
  });
});
