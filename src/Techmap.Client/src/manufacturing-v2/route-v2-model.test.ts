import { describe, expect, it } from "vitest";
import { addRouteV2Assembly, addRouteV2Edge, addRouteV2Final, createInitialRouteV2, parseRouteV2, removeRouteV2Edge, removeRouteV2Node, routeV2DrawingRow, setRouteV2NodeRefs } from "./route-v2-model";
import type { HarnessDesignDocument } from "../editor/model";
import { physicalFixture } from "../editor/physical-topology-fixture";
import { createRouteDrawingCopy } from "../manufacturing/route-drawing-copy";

function documentFixture(): HarnessDesignDocument {
  return {
    schemaVersion: 1,
    connectors: [], wires: [], cables: [],
    drawingDocuments: { schemaVersion: 1, graphics: [], layers: [] },
    physicalTopology: { nodes: [], segments: [], joiningPipes: [], coverings: [], routes: [] },
  } as unknown as HarnessDesignDocument;
}

describe("Route v2 prototype model", () => {
  it("starts with an empty visual graph when the design has no sources", () => {
    expect(createInitialRouteV2(documentFixture())).toMatchObject({ version: 1, nodes: [], edges: [], finalNodeId: null });
  });

  it("drops malformed edges and unknown final nodes on reload", () => {
    const parsed = parseRouteV2({ version: 1, nodes: [{ id: "a", kind: "semiFinished", title: "A", refs: [], quantity: 1, x: 0, y: 0, operatorConfirmed: false }], edges: [{ id: "bad", from: "a", to: "missing" }], finalNodeId: "missing" });
    expect(parsed?.edges).toEqual([]);
    expect(parsed?.finalNodeId).toBeNull();
  });

  it("migrates old card spacing once while preserving refs and saved drawings", () => {
    const source = physicalFixture();
    const drawingCopy = createRouteDrawingCopy(source, ["S0"]);
    const oldGraph = { version: 1, nodes: [
      { id: "a", kind: "semiFinished", title: "A", refs: [{ kind: "wire", id: "wire-1" }], quantity: 1, x: 36, y: 36, operatorConfirmed: false,
        drawing: { backgroundOpacity: 0.4, drawingCopy } },
      { id: "b", kind: "assembly", title: "B", refs: [{ kind: "covering", id: "cover-1" }], quantity: 1, x: 316, y: 210, operatorConfirmed: false },
    ], edges: [], finalNodeId: null };

    const migrated = parseRouteV2(oldGraph)!;
    expect(migrated.layoutVersion).toBe(2);
    expect(migrated.nodes.map(node => [node.x, node.y])).toEqual([[36, 36], [354, 366]]);
    expect(migrated.nodes[0]!.refs).toEqual(oldGraph.nodes[0]!.refs);
    expect(migrated.nodes[0]!.drawing).toEqual(oldGraph.nodes[0]!.drawing);
    expect(parseRouteV2(migrated)!.nodes.map(node => [node.x, node.y])).toEqual([[36, 36], [354, 366]]);
    const nearBoundary = parseRouteV2({ ...migrated, layoutVersion: undefined, nodes: [{ ...migrated.nodes[0]!, x: 12, y: 12 }] });
    expect(nearBoundary!.nodes[0]).toMatchObject({ x: 12, y: 12 });
  });

  it("restores both drawing copies on the same card without changing the source design", () => {
    const source = physicalFixture();
    const before = structuredClone(source);
    const copy = createRouteDrawingCopy(source, ["S0"]);
    const node = { id: "assembly-a", kind: "assembly" as const, title: "Сборка", refs: [], quantity: 1, x: 40, y: 200, operatorConfirmed: false,
      drawing: { backgroundOpacity: 0.4, drawingCopy: copy, isolatedDrawingCopy: createRouteDrawingCopy(source, ["S1"]) } };
    const restored = parseRouteV2(JSON.parse(JSON.stringify({ version: 1, nodes: [node], edges: [], finalNodeId: null })));
    const row = routeV2DrawingRow(restored!.nodes[0]!);
    expect(row.presentation.backgroundOpacity).toBe(0.4);
    expect(row.presentation.drawingCopy?.hiddenObjectIds).toEqual(["S0"]);
    expect(row.presentation.isolatedDrawingCopy?.hiddenObjectIds).toEqual(["S1"]);
    expect(Object.hasOwn(row.presentation.drawingCopy!.document, "manufacturingRoute")).toBe(false);
    expect(source).toEqual(before);
  });

  it("removes a node with incident edges and clears its final marker", () => {
    const graph = { version: 1 as const, nodes: [
      { id: "a", kind: "semiFinished" as const, title: "A", refs: [], quantity: 1, x: 0, y: 0, operatorConfirmed: false },
      { id: "b", kind: "final" as const, title: "B", refs: [], quantity: 1, x: 0, y: 0, operatorConfirmed: false },
      { id: "c", kind: "assembly" as const, title: "C", refs: [], quantity: 1, x: 0, y: 0, operatorConfirmed: false },
    ], edges: [{ id: "ab", from: "a", to: "b" }, { id: "bc", from: "b", to: "c" }], finalNodeId: "b" };
    expect(removeRouteV2Node(graph, "b")).toMatchObject({ nodes: [{ id: "a" }, { id: "c" }], edges: [], finalNodeId: null });
  });

  it("removes only the requested link", () => {
    const graph = { version: 1 as const, nodes: [], edges: [{ id: "one", from: "a", to: "b" }, { id: "two", from: "b", to: "c" }], finalNodeId: null };
    expect(removeRouteV2Edge(graph, "one").edges).toEqual([{ id: "two", from: "b", to: "c" }]);
  });

  it("adds valid links, ignores duplicate/self/unknown links, and rejects cycles", () => {
    const graph = { version: 1 as const, nodes: [
      { id: "a", kind: "semiFinished" as const, title: "A", refs: [], quantity: 1, x: 0, y: 0, operatorConfirmed: false },
      { id: "b", kind: "assembly" as const, title: "B", refs: [], quantity: 1, x: 0, y: 0, operatorConfirmed: false },
      { id: "c", kind: "assembly" as const, title: "C", refs: [], quantity: 1, x: 0, y: 0, operatorConfirmed: false },
    ], edges: [{ id: "ab", from: "a", to: "b" }], finalNodeId: null };
    const extended = addRouteV2Edge(graph, "bc", "b", "c");
    expect(extended.edges).toEqual([{ id: "ab", from: "a", to: "b" }, { id: "bc", from: "b", to: "c" }]);
    expect(addRouteV2Edge(extended, "duplicate-id", "b", "c")).toBe(extended);
    expect(addRouteV2Edge(extended, "self", "b", "b")).toBe(extended);
    expect(addRouteV2Edge(extended, "unknown", "missing", "c")).toBe(extended);
    expect(() => addRouteV2Edge(extended, "ca", "c", "a")).toThrow("Нельзя добавить связь: она создаст цикл зависимостей.");
  });

  it("creates empty assembly and final cards without copying refs", () => {
    const graph = { version: 1 as const, nodes: [
      { id: "pf", kind: "semiFinished" as const, title: "ПФ", refs: [{ kind: "wire" as const, id: "w1" }], quantity: 1, x: 40, y: 20, operatorConfirmed: false },
    ], edges: [], finalNodeId: null };
    const assembly = addRouteV2Assembly(graph, "pf", "assembly", "a-edge");
    expect(assembly.nodes[1]).toMatchObject({ id: "assembly", refs: [], kind: "assembly" });
    const final = addRouteV2Final(assembly, "final", ["f-edge-1"]);
    expect(final.nodes.at(-1)).toMatchObject({ id: "final", refs: [], kind: "final" });
    expect(final.finalNodeId).toBe("final");
    expect(final.edges.at(-1)).toEqual({ id: "f-edge-1", from: "assembly", to: "final" });
  });

  it("sets refs explicitly and deduplicates by kind and ID", () => {
    const graph = { version: 1 as const, nodes: [{ id: "a", kind: "assembly" as const, title: "A", refs: [], quantity: 1, x: 0, y: 0, operatorConfirmed: false }], edges: [], finalNodeId: null };
    const updated = setRouteV2NodeRefs(graph, "a", [{ kind: "wire", id: "w" }, { kind: "wire", id: "w" }, { kind: "cable", id: "w" }]);
    expect(updated.nodes[0]!.refs).toEqual([{ kind: "wire", id: "w" }, { kind: "cable", id: "w" }]);
  });

  it("validates both drawing copies and fails closed without mutating the stored input", () => {
    const source = physicalFixture();
    const valid = createRouteDrawingCopy(source, ["S0"]);
    const saved = { version: 1, nodes: [{ id: "a", kind: "assembly", title: "A", refs: [], quantity: 1, x: 0, y: 0, operatorConfirmed: false,
      accidental: "must not survive", drawing: { backgroundOpacity: 0.5, drawingCopy: valid, isolatedDrawingCopy: { ...valid, hiddenObjectIds: ["", "bad"] } } }], edges: [], finalNodeId: null };
    const before = structuredClone(saved);
    expect(() => parseRouteV2(saved)).toThrow(/Рисунок карточки «A» повреждён \(изолированная копия\)/);
    expect(saved).toEqual(before);
    const parsed = parseRouteV2({ version: 1, nodes: [{ id: "a", kind: "assembly", title: "A", refs: [], quantity: 1, x: 0, y: 0, operatorConfirmed: false,
      accidental: "must not survive", drawing: { backgroundOpacity: 0.5, drawingCopy: valid, isolatedDrawingCopy: createRouteDrawingCopy(source, ["S1"]) } }], edges: [], finalNodeId: null });
    expect(parsed!.nodes[0]).not.toHaveProperty("accidental");
    expect(parsed!.nodes[0]!.drawing?.drawingCopy?.hiddenObjectIds).toEqual(["S0"]);
    expect(parsed!.nodes[0]!.drawing?.isolatedDrawingCopy?.hiddenObjectIds).toEqual(["S1"]);
  });
});
