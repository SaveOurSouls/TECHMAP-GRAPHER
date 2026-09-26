import { describe, expect, it } from "vitest";
import { createConnector, createWire } from "../editor/commands";
import { createEmptyHarnessDesign } from "../editor/model";
import { addAssemblyRow, generateRoute, mergeRouteRows, updateRouteRow, routeRowPresentationConflicts } from "./route-commands";
import { parseManufacturingRoute, routeRowComposition, type ManufacturingRoute, type RouteRow } from "./route-model";

const sha = "a".repeat(64);
const row = (id: string, dependsOn: string[] = []): RouteRow => ({
  id, kind: "semiFinished", title: id, comment: `comment ${id}`, sourceObjects: [{ kind: "wire", id }],
  dependsOn, operations: [{ id: `op-${id}`, binding: null, mode: "cut", note: id }],
  presentation: { backgroundOpacity: .25, objects: [{ ref: { kind: "wire", id }, points: [{ x: 10, y: 20 }], hidden: false }] }, prepared: true,
});
const route = (...rows: RouteRow[]): ManufacturingRoute => parseManufacturingRoute({ contractVersion: 1, source: { fingerprintVersion: 1, sha256: sha }, status: "draft", rows })!;

describe("manufacturing route commands", () => {
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
  it("updates immutably, invalidates dependent rows and rejects invalid edits", () => {
    const original = route(row("a"), row("b", ["a"]), row("other"));
    const updated = updateRouteRow(original, "a", { comment: "changed" });
    expect(updated.rows.map(r => r.prepared)).toEqual([false, false, true]);
    expect(original.rows[0]!.comment).toBe("comment a");
    expect(updateRouteRow(updated, "a", { prepared: true }).rows.map(r => r.prepared)).toEqual([true, false, true]);
    expect(() => updateRouteRow(original, "a", { dependsOn: ["b"] })).toThrow();
    expect(() => updateRouteRow(original, "a", { presentation: { backgroundOpacity: 1, objects: [] } })).toThrow();
    expect(() => updateRouteRow(original, "missing", { comment: "lost" })).toThrow();
  });
});
