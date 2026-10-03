import { describe, expect, it } from "vitest";
import { createConnector, createWire } from "../editor/commands";
import { createEmptyHarnessDesign } from "../editor/model";
import { addAssemblyInput, addAssemblyRow, copyAssemblyPresentation, generateRoute, mergeRouteRows, removeAssemblyInput, updateRouteRow, routeRowPresentationConflicts } from "./route-commands";
import { parseManufacturingRoute, routeRowComposition, type ManufacturingRoute, type RouteRow } from "./route-model";
const sha = "a".repeat(64);
const row = (id: string, dependsOn: string[] = []): RouteRow => ({
  id, kind: "semiFinished", title: id, comment: `comment ${id}`, sourceObjects: [{ kind: "wire", id }],
  dependsOn, operations: [{ id: `op-${id}`, binding: null, mode: "cut", note: id }],
  presentation: { backgroundOpacity: .25, objects: [{ ref: { kind: "wire", id }, points: [{ x: 10, y: 20 }], hidden: false }] }, prepared: true,
});
const route = (...rows: RouteRow[]): ManufacturingRoute => parseManufacturingRoute({ contractVersion: 1, source: { fingerprintVersion: 1, sha256: sha }, status: "draft", rows })!;

describe("manufacturing route commands", () => {
  it("persists merged component metrics through parse and repeated merge", () => {
    const original = route({ ...row("a"), index: "ПФ-01", quantity: 2, reserve: 3, operationTimeMinutes: 4 }, { ...row("b"), index: "ПФ-02", quantity: 5, reserve: 1, operationTimeMinutes: 7 });
    const merged = mergeRouteRows(original, ["a", "b"], "merged");
    expect(merged.rows[0]!.components?.map(item => [item.title, item.quantity, item.reserve, item.operationTimeMinutes])).toEqual([["a", 2, 3, 4], ["b", 5, 1, 7]]);
    const restored = parseManufacturingRoute(JSON.parse(JSON.stringify(merged)))!;
    expect(restored.rows[0]!.components).toEqual(merged.rows[0]!.components);
    const repeated = mergeRouteRows(route(merged.rows[0]!, { ...row("c"), quantity: 9, reserve: 2, operationTimeMinutes: 8 }), ["merged", "c"], "merged-again");
    expect(repeated.rows[0]!.components?.map(item => item.ref.id)).toEqual(["a", "b", "c"]);
    expect(repeated.rows[0]!.components?.at(-1)).toMatchObject({ quantity: 9, reserve: 2, operationTimeMinutes: 8 });
  });
  it("rejects component metadata with an extra field or wrong reference", () => {
    const base = mergeRouteRows(route(row("a"), row("b")), ["a", "b"], "merged");
    const extra = JSON.parse(JSON.stringify(base)); extra.rows[0].components[0].unexpected = true;
    expect(() => parseManufacturingRoute(extra)).toThrow();
    const wrong = JSON.parse(JSON.stringify(base)); wrong.rows[0].components[0].ref.id = "missing";
    expect(() => parseManufacturingRoute(wrong)).toThrow();
  });
  it("preserves per-wire catalog choices when merging semi-finished rows", () => {
    const binding = { sourceId: "technology-wire-blanks" as const, entityType: "wire-blank" as const, snapshotId: "11111111-1111-4111-8111-111111111111", snapshotSha256: "b".repeat(64), recordId: "c".repeat(64), sourceKey: "blank", displayName: "Blank", visual: { start: "cut", end: "cut", color: "#ff0000", templateId: "01-cut", photoDataUrl: null } };
    const original = route(...["a", "b"].map(id => ({ ...row(id), wireBlankSelections: [{ wireId: id, binding }] })));
    const merged = mergeRouteRows(original, ["a", "b"], "merged");
    expect(merged.rows[0]!.wireBlankSelections).toEqual(original.rows.flatMap(item => item.wireBlankSelections!));
  });
  it("copies assembly drawing overlays independently of manufacturing composition", () => {
    const drawingObjects = [{ id: "pipe", kind: "physical-segment", layerId: "wires", points: [{ x: 10, y: 20 }], hidden: true }];
    const original = addAssemblyRow(route(row("a")), "assembly", "Assembly", [], []);
    const updated = updateRouteRow(original, "assembly", { presentation: { backgroundOpacity: .5, objects: [], drawingObjects } });
    const copied = copyAssemblyPresentation(updated, "assembly");
    expect(copied.drawingObjects).toEqual(drawingObjects);
    expect(copied.drawingObjects![0]!.points[0]).not.toBe(drawingObjects[0]!.points[0]);
    expect(routeRowComposition(updated, "assembly")).toEqual([]);
  });
  it("generates wire, cable and covering once, with cable conductors unprepared and connectors reserved for assembly", () => {
    const a = createConnector("a", "X1", 2, { x: 0, y: 0 }), b = createConnector("b", "X2", 2, { x: 100, y: 0 });
    const wire = createWire("wire", { connectorId: "a", contactId: a.contacts[0]!.id }, { connectorId: "b", contactId: b.contacts[0]!.id }, null);
    const document = { ...createEmptyHarnessDesign(), connectors: [a, b], wires: [wire], cables: [{ id: "cable", memberWireIds: ["wire"], lengthMm: 100, endCorrectionFromMm: 0, endCorrectionToMm: 0, cutRoundingStepMm: 1 }],
      physicalTopology: { snap: false, nodes: [], segments: [], routes: [], coverings: [{ id: "cover", name: "Обмотка", spans: [], width: 20, color: "#ffffff", lengthMm: 100 }] } };
    const saved = JSON.stringify(document);
    const generated = generateRoute(document, sha);
    expect(generated.rows.map(r => r.sourceObjects)).toEqual([[{ kind: "wire", id: "wire" }], [{ kind: "cable", id: "cable" }], [{ kind: "covering", id: "cover" }]]);
    expect(generated.rows.every(r => !r.prepared && r.kind === "semiFinished" && !r.operations.length)).toBe(true);
    expect(JSON.stringify(document)).toBe(saved);
    expect(generated.source.sha256).toBe(sha);
  });
  it("merges objects, operations, presentation and comments and rewrites downstream dependencies", () => {
    const original = route(row("a"), row("b"), row("c", ["a", "b"]), row("d", ["c"]));
    const snapshot = JSON.stringify(original);
    const merged = mergeRouteRows(original, ["a", "b"], "merged");
    expect(merged.rows.map(r => r.id)).toEqual(["merged", "c", "d"]);
    expect(merged.rows[0]!.operations.map(op => op.id)).toEqual(["op-a", "op-b"]);
    expect(merged.rows[0]!.sourceObjects.map(ref => ref.id)).toEqual(["a", "b"]);
    expect(merged.rows[0]!.presentation.objects).toHaveLength(2);
    expect(merged.rows[0]!.comment).toBe("comment a\n\ncomment b");
    expect(merged.rows[1]!.dependsOn).toEqual(["merged"]);
    expect(merged.rows.every(r => !r.prepared)).toBe(true);
    expect(routeRowComposition(merged, "d").map(ref => ref.id)).toEqual(["a", "b", "c", "d"]);
    expect(JSON.stringify(original)).toBe(snapshot);
  });
  it("keeps each wire's terminal requirements and project photos when blanks are merged", () => {
    const terminal = (wireId: string) => ({ wireId, end: "from" as const, terminalArticle: `${wireId}-terminal`, stripLengthMm: null, binding: null });
    const first = { ...row("a"), terminalRequirements: [terminal("a")], photos: [{ sha256: "a".repeat(64), name: "first.png" }] };
    const second = { ...row("b"), terminalRequirements: [terminal("b")], photos: [{ sha256: "b".repeat(64), name: "second.png" }] };
    const merged = mergeRouteRows(route(first, second), ["a", "b"], "merged").rows[0]!;
    expect(merged.terminalRequirements).toEqual([terminal("a"), terminal("b")]);
    expect(merged.photos?.map(photo => photo.name)).toEqual(["first.png", "second.png"]);
  });
  it("collapses internal dependencies but rejects a merge producing a cycle", () => {
    expect(mergeRouteRows(route(row("a"), row("b", ["a"])), ["a", "b"], "merged").rows[0]!.dependsOn).toEqual([]);
    expect(() => mergeRouteRows(route(row("a"), row("middle", ["a"]), row("b", ["middle"])), ["a", "b"], "merged")).toThrow();
  });
  it("unions shared ancestors once and refuses to silently discard conflicting presentation", () => {
    const sharedObject = { ref: { kind: "wire" as const, id: "a" }, points: [{ x: 10, y: 20 }], hidden: false };
    const b = { ...row("b", ["a"]), presentation: { backgroundOpacity: .25, objects: [sharedObject] } };
    const c = { ...row("c", ["a"]), presentation: { backgroundOpacity: .25, objects: [sharedObject] } };
    const merged = mergeRouteRows(route(row("a"), b, c), ["b", "c"], "merged");
    expect(merged.rows[1]!.dependsOn).toEqual(["a"]);
    expect(merged.rows[1]!.presentation.objects).toHaveLength(1);
    expect(routeRowComposition(merged, "merged").map(ref => ref.id)).toEqual(["a", "b", "c"]);
    const changedC = { ...c, presentation: { ...c.presentation, objects: [{ ...sharedObject, hidden: true }] } };
    expect(() => mergeRouteRows(route(row("a"), b, changedC), ["b", "c"], "merged")).toThrow("Разные представления");
  });
  it("rejects assemblies, duplicate selections, missing rows and occupied output IDs", () => {
    const original = route(row("a"), row("b"));
    for (const [ids, id] of [[ ["a", "a"], "new" ], [["a", "missing"], "new"], [["a", "b"], "b"]] as const) expect(() => mergeRouteRows(original, ids, id)).toThrow();
    const assembly = addAssemblyRow(original, "assembly", "Сборка", [], ["a", "b"]);
    expect(() => mergeRouteRows(assembly, ["a", "assembly"], "new")).toThrow();
  });
  it("reports inherited conflicting shapes instead of selecting a parent silently", () => {
    const a = row("a");
    const inherited = a.presentation.objects[0]!;
    const b = { ...row("b", ["a"]), presentation: { backgroundOpacity: .25, objects: [{ ...inherited, points: [{ x: 30, y: 40 }] }] } };
    const c = { ...row("c", ["a"]), presentation: { backgroundOpacity: .25, objects: [{ ...inherited, hidden: true }] } };
    const assembled = addAssemblyRow(route(a, b, c), "out", "Сборка", [], ["b", "c"]);
    expect(routeRowPresentationConflicts(assembled, "out")).toEqual([{ ref: inherited.ref, variants: [
      { rowId: "b", object: b.presentation.objects[0] }, { rowId: "c", object: c.presentation.objects[0] },
    ] }]);
    expect(routeRowPresentationConflicts(updateRouteRow(assembled, "out", { presentation: { backgroundOpacity: .25, objects: [inherited] } }), "out")).toEqual([]);
    expect(routeRowPresentationConflicts(addAssemblyRow(route(a, row("b", ["a"]), c), "out", "Сборка", [], ["b", "c"]), "out")).toEqual([]);
  });
  it("introduces connector at assembly and inherits inputs instead of introducing them twice", () => {
    const assembled = addAssemblyRow(route(row("a"), row("b")), "assembly", "Монтаж", [{ kind: "connector", id: "connector" }], ["a", "b"]);
    expect(routeRowComposition(assembled, "assembly").map(ref => ref.id)).toEqual(["a", "b", "connector"]);
    expect(assembled.rows.at(-1)?.kind).toBe("assembly");
    expect(() => addAssemblyRow(assembled, "duplicate", "Повтор", [{ kind: "wire", id: "a" }], ["assembly"])).toThrow();
    expect(() => addAssemblyRow(assembled, "orphan", "Ошибка", [], ["absent"])).toThrow();
  });
  it("creates an empty assembly and adds one input line per action while preserving the DAG", () => {
    const original = route(row("a"), row("b"));
    const empty = addAssemblyRow(original, "assembly", "Сборка", [], []);
    expect(empty.rows.at(-1)?.assemblyInputs).toEqual([]);
    expect(routeRowComposition(empty, "assembly")).toEqual([]);
    const withRawSelection = addAssemblyInput(empty, "assembly", { id: "input-1", kind: "source", ref: { kind: "wire", id: "a" } });
    expect(withRawSelection.rows.at(-1)?.assemblyInputs).toEqual([{ id: "input-1", kind: "row", rowId: "a" }]);
    expect(withRawSelection.rows.at(-1)?.dependsOn).toEqual(["a"]);
    const withBlank = addAssemblyInput(withRawSelection, "assembly", { id: "input-2", kind: "row", rowId: "b" });
    expect(withBlank.rows.at(-1)?.assemblyInputs).toHaveLength(2);
    expect(routeRowComposition(withBlank, "assembly").map(ref => ref.id)).toEqual(["a", "b"]);
    expect(() => addAssemblyInput(withBlank, "assembly", { id: "input-3", kind: "source", ref: { kind: "wire", id: "a" } })).toThrow("уже добавлен");
    expect(() => addAssemblyInput(withBlank, "assembly", { id: "input-3", kind: "row", rowId: "assembly" })).toThrow();
    const withConnector = addAssemblyInput(withBlank, "assembly", { id: "input-3", kind: "source", ref: { kind: "connector", id: "x1" } });
    expect(withConnector.rows.at(-1)?.assemblyInputs?.at(-1)).toEqual({ id: "input-3", kind: "source", ref: { kind: "connector", id: "x1" } });
    expect(routeRowComposition(withConnector, "assembly").map(ref => ref.id)).toEqual(["a", "b", "x1"]);
    expect(JSON.stringify(original)).toBe(JSON.stringify(route(row("a"), row("b"))));
  });
  it("rewrites an assembly input when its producing semi-finished rows are merged", () => {
    const original = addAssemblyRow(route(row("a"), row("b")), "assembly", "Сборка", [], ["a", "b"]);
    const merged = mergeRouteRows(original, ["a", "b"], "combined");
    expect(merged.rows.at(-1)?.dependsOn).toEqual(["combined"]);
    expect(merged.rows.at(-1)?.assemblyInputs).toEqual([{ id: "row-1", kind: "row", rowId: "combined" }]);
  });
  it("removes one input and invalidates descendants and saved shapes outside their composition", () => {
    const original = route(row("a"), row("b"));
    const withAssembly = addAssemblyInput(addAssemblyInput(addAssemblyRow(original, "assembly", "Сборка", [], []), "assembly", { id: "a-in", kind: "row", rowId: "a" }), "assembly", { id: "b-in", kind: "row", rowId: "b" });
    const withDrawing = updateRouteRow(withAssembly, "assembly", { prepared: true, presentation: { backgroundOpacity: 1, objects: [
      { ref: { kind: "wire", id: "a" }, points: [{ x: 1, y: 2 }], hidden: false },
      { ref: { kind: "wire", id: "b" }, points: [{ x: 3, y: 4 }], hidden: false },
    ] } });
    const child = addAssemblyRow(withDrawing, "child", "Сборка 2", [], ["assembly"]);
    const removed = removeAssemblyInput(child, "assembly", "b-in");
    expect(removed.rows.find(item => item.id === "assembly")?.dependsOn).toEqual(["a"]);
    expect(removed.rows.find(item => item.id === "assembly")?.presentation.objects.map(item => item.ref.id)).toEqual(["a"]);
    expect(removed.rows.find(item => item.id === "assembly")?.prepared).toBe(false);
    expect(routeRowComposition(removed, "child").map(ref => ref.id)).toEqual(["a"]);
    expect(() => removeAssemblyInput(removed, "assembly", "missing")).toThrow();
  });
  it("copies inherited geometry by stable ID without sharing points or changing source rows", () => {
    const original = addAssemblyRow(route(row("a"), row("b")), "assembly", "Сборка", [], ["a", "b"]);
    const saved = JSON.stringify(original);
    const copy = copyAssemblyPresentation(original, "assembly");
    expect(copy.objects.map(item => item.ref.id)).toEqual(["a", "b"]);
    (copy.objects[0]!.points as { x: number; y: number }[])[0]!.x = 99;
    expect(original.rows[0]!.presentation.objects[0]!.points[0]!.x).toBe(10);
    expect(JSON.stringify(original)).toBe(saved);
  });
  it("updates immutably, invalidates dependent rows and rejects invalid edits", () => {
    const original = route(row("a"), row("b", ["a"]), row("other"));
    const updated = updateRouteRow(original, "a", { comment: "changed" });
    expect(updated.rows.map(r => r.prepared)).toEqual([false, false, true]);
    expect(original.rows[0]!.comment).toBe("comment a");
    expect(updateRouteRow(updated, "a", { prepared: true }).rows.map(r => r.prepared)).toEqual([true, false, true]);
    expect(() => updateRouteRow(original, "a", { dependsOn: ["b"] })).toThrow();
    expect(() => updateRouteRow(original, "a", { presentation: { backgroundOpacity: 1.1, objects: [] } })).toThrow();
    expect(() => updateRouteRow(original, "missing", { comment: "lost" })).toThrow();
  });
});
