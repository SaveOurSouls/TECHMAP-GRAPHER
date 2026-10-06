import { describe, expect, it } from "vitest";
import {
  ROUTE_V2_NODE_DEFAULT_HEIGHT,
  ROUTE_V2_NODE_DEFAULT_WIDTH,
  addRouteV2Edge,
  parseRouteV2,
  removeRouteV2Node,
  routeV2ConnectionPort,
  routeV2IncomingSemiFinishedNodes,
  routeV2NodeSize,
  routeV2PreferredDrawingCopy,
  routeV2ResizeNodeSize,
  setRouteV2NodeInputs,
  type RouteV2Document,
  type RouteV2Node,
} from "./route-v2-model";
import { createRouteDrawingCopy } from "../manufacturing/route-drawing-copy";
import { physicalFixture } from "../editor/physical-topology-fixture";

const node = (id: string, kind: "semiFinished" | "assembly" = "assembly"): RouteV2Node => ({
  id, kind, title: id, refs: [], quantity: 1, x: 40, y: 20, operatorConfirmed: false,
});

describe("Route v2 C2 model contract", () => {
  it("reads legacy cards with safe dimensions and preserves the v1 storage version", () => {
    const parsed = parseRouteV2({ version: 1, nodes: [node("a")], edges: [], finalNodeId: null });
    expect(parsed?.version).toBe(1);
    expect(parsed?.nodes[0]).toMatchObject({ width: ROUTE_V2_NODE_DEFAULT_WIDTH, height: ROUTE_V2_NODE_DEFAULT_HEIGHT });
  });

  it("clamps persisted and interactive card sizes", () => {
    expect(routeV2NodeSize({ width: 1, height: 10 })).toEqual({ width: 220, height: 170 });
    expect(routeV2ResizeNodeSize(9999, 9999)).toEqual({ width: 720, height: 720 });
    expect(routeV2NodeSize({ width: Number.NaN, height: undefined })).toEqual({ width: ROUTE_V2_NODE_DEFAULT_WIDTH, height: ROUTE_V2_NODE_DEFAULT_HEIGHT });
  });

  it("exposes only incoming semi-finished cards and stores selected IDs separately from raw refs", () => {
    let graph: RouteV2Document = { version: 1 as const, nodes: [node("raw", "semiFinished"), node("incoming", "semiFinished"), node("outgoing", "semiFinished"), node("assembly")], edges: [], finalNodeId: null };
    graph = addRouteV2Edge(graph, "in", "incoming", "assembly");
    graph = addRouteV2Edge(graph, "out", "assembly", "outgoing");
    graph = setRouteV2NodeInputs(graph, "assembly", ["incoming", "incoming", "missing", "assembly"]);
    expect(routeV2IncomingSemiFinishedNodes(graph, "assembly").map(item => item.id)).toEqual(["incoming"]);
    expect(graph.nodes.find(item => item.id === "assembly")?.inputNodeIds).toEqual(["incoming", "missing"]);
    expect(removeRouteV2Node(graph, "incoming").nodes.find(item => item.id === "assembly")?.inputNodeIds).toEqual(["missing"]);
  });

  it("prefers an isolated copy and exposes connection port geometry", () => {
    const document = physicalFixture();
    const source = createRouteDrawingCopy(document, ["S0"]);
    const isolated = createRouteDrawingCopy(document, ["S1"]);
    const card = { ...node("a"), width: 300, height: 200, drawing: { backgroundOpacity: 1, drawingCopy: source, isolatedDrawingCopy: isolated } };
    expect(routeV2PreferredDrawingCopy(card)?.hiddenObjectIds).toEqual(["S1"]);
    expect(routeV2ConnectionPort(card, "top")).toEqual({ x: 190, y: 20 });
    expect(routeV2ConnectionPort(card, "bottom")).toEqual({ x: 190, y: 220 });
  });
});
