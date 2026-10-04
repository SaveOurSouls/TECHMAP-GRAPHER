import { describe, expect, it } from "vitest";
import { createInitialRouteV2, parseRouteV2, routeV2DrawingRow } from "./route-v2-model";
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
});
