import { describe, expect, it } from "vitest";
import { routeV2GalleryVersions } from "./RouteV2Panel";
import { routeV2ConnectionPort, routeV2NodeSize, routeV2ResizeNodeSize, routeV2IncomingSemiFinishedNodes, type RouteV2Document, type RouteV2Node } from "./route-v2-model";

const node = (patch: Partial<RouteV2Node> = {}): RouteV2Node => ({
  id: "card", kind: "assembly", title: "Сборка", refs: [], quantity: 1, x: 20, y: 30, operatorConfirmed: false, ...patch,
});

describe("Route v2 card UI contracts", () => {
  it("shows an isolated fragment as the only gallery version", () => {
    expect(routeV2GalleryVersions(node())).toEqual([]);
    expect(routeV2GalleryVersions(node({ drawing: { backgroundOpacity: 1, drawingCopy: {} as never } }))).toEqual(["source"]);
    expect(routeV2GalleryVersions(node({ drawing: { backgroundOpacity: 1, drawingCopy: {} as never, isolatedDrawingCopy: {} as never } }))).toEqual(["isolated"]);
  });

  it("clamps resize and places ports at the resized card bounds", () => {
    const resized = routeV2ResizeNodeSize(500, 420);
    expect(resized).toEqual({ width: 500, height: 420 });
    expect(routeV2NodeSize({ width: 1, height: 9999 })).toEqual({ width: 220, height: 720 });
    expect(routeV2ConnectionPort({ ...node(), width: 500, height: 420 }, "top")).toEqual({ x: 270, y: 30 });
    expect(routeV2ConnectionPort({ ...node(), width: 500, height: 420 }, "bottom")).toEqual({ x: 270, y: 450 });
  });

  it("offers only semi-finished cards connected by incoming edges", () => {
    const graph: RouteV2Document = {
      version: 1,
      nodes: [node({ id: "source", kind: "semiFinished" }), node({ id: "assembly", kind: "assembly" }), node({ id: "unlinked", kind: "semiFinished" }), node({ id: "other", kind: "final" })],
      edges: [{ id: "e1", from: "source", to: "assembly" }, { id: "e2", from: "other", to: "assembly" }],
      finalNodeId: "other",
    };
    expect(routeV2IncomingSemiFinishedNodes(graph, "assembly").map(item => item.id)).toEqual(["source"]);
  });
});
