import { describe, expect, it } from "vitest";
import { createInitialRouteV2, parseRouteV2 } from "./route-v2-model";
import type { HarnessDesignDocument } from "../editor/model";

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
});
