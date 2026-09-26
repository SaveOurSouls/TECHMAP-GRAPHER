import { describe, expect, it } from "vitest";
import { parseManufacturingRoute, routeRowComposition } from "./route-model";

const ref = (id: string) => ({ kind: "wire" as const, id });
const row = (id: string, dependsOn: string[] = [], sourceObjects = [ref(id)]): Record<string, unknown> => ({
  id, kind: "semiFinished", title: id, comment: "", sourceObjects, dependsOn, operations: [],
  presentation: { backgroundOpacity: .25, objects: [] }, prepared: false,
});
const route = (rows: unknown[], status: "draft" | "completed" = "draft") => parseManufacturingRoute({
  contractVersion: 1, source: { fingerprintVersion: 1, sha256: "a".repeat(64) }, status, rows,
});

describe("manufacturing route contract", () => {
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
  it("rejects unsupported route versions and out-of-range opacity", () => {
    expect(() => route([{ ...row("a"), presentation: { backgroundOpacity: .05, objects: [] } }])).toThrow();
    const parsed = route([row("a")])!;
    expect(() => parseManufacturingRoute({ ...parsed, contractVersion: 2 })).toThrow();
    expect(() => parseManufacturingRoute({ ...parsed, source: { ...parsed.source, fingerprintVersion: 2 } })).toThrow();
    expect(() => parseManufacturingRoute({ ...parsed, source: { ...parsed.source, sha256: "bad" } })).toThrow();
  });
});
