import { describe, expect, it } from "vitest";
import { applyEditorCommand, createConnector, createWire } from "./commands";
import { createOrthogonalE4Route, wireEndpointE4Anchor, createEmptyHarnessDesign, parseHarnessDesignDocument, type HarnessDesignDocument } from "./model";
import { constrainedPolyline, physicalSegmentPoints, physicalWirePoints, splitPhysicalSegment } from "./physical-topology";
import { buildHarnessSelectionIndex, resolveHarnessSelection } from "./harness-selection";
import { createEditorHistory, executeEditorCommand, undoEditorCommand } from "./history";

export function physicalFixture(): HarnessDesignDocument {
  const connectors = ["A", "B", "C"].map((id, i) => createConnector(id, id, 2, { x: i * 650, y: i * 500 }));
  const end = (id: string, number: number) => ({ connectorId: id, contactId: `${id}:contact:${number}` });
  const document: HarnessDesignDocument = { ...createEmptyHarnessDesign(), connectors,
    wires: [createWire("W1", end("A", 1), end("B", 1)), createWire("W2", end("A", 2), end("C", 1)), createWire("W3", end("B", 2), end("C", 2))],
    physicalTopology: { snap: true, nodes: [
      { id: "NA", connectorId: "A", position: { x: 150, y: 40 } },
      { id: "NB", connectorId: "B", position: { x: 150, y: 40 } },
      { id: "NC", connectorId: "C", position: { x: 150, y: 40 } },
      { id: "J", position: { x: 210, y: 200 } }],
      segments: [{ id: "S0", from: "NA", to: "J", bends: [{ x: 180, y: 100 }] }, { id: "S1", from: "J", to: "NB", bends: [] }, { id: "S2", from: "J", to: "NC", bends: [] }],
      routes: [{ wireId: "W1", steps: [{ segmentId: "S0", reverse: false }, { segmentId: "S1", reverse: false }] }, { wireId: "W2", steps: [{ segmentId: "S0", reverse: false }, { segmentId: "S2", reverse: false }] }, { wireId: "W3", steps: [{ segmentId: "S1", reverse: true }, { segmentId: "S2", reverse: false }] }] } };
  return {...document,wires:document.wires.map(w => ({...w,e4Route:createOrthogonalE4Route(wireEndpointE4Anchor(document,w.from)!,wireEndpointE4Anchor(document,w.to)!)}))};
}

describe("physical topology", () => {
  it("resolves explicit branch membership independently of electrical connectivity", () => {
    const d = physicalFixture(), index = buildHarnessSelectionIndex(d);
    expect(resolveHarnessSelection(index, ["S1"]).wireIds.sort()).toEqual(["W1", "W3"]);
    expect(resolveHarnessSelection(index, ["A"]).wireIds.sort()).toEqual(["W1", "W2"]);
    expect(resolveHarnessSelection(index, ["W1"], true).wireIds).toEqual(["W1"]);
    const crossed = { ...d, physicalTopology: { ...d.physicalTopology!, segments: [...d.physicalTopology!.segments, { id: "cross", from: "NA", to: "NC", bends: [] }] } };
    expect(resolveHarnessSelection(buildHarnessSelectionIndex(crossed), ["cross"]).wireIds).toEqual([]);
  });
  it("splits at existing bends, preserves reverse routes, serializes and undoes", () => {
    const d = physicalFixture();
    const topology = splitPhysicalSegment(d, "S1", 1, "split", "new");
    const h = executeEditorCommand(createEditorHistory(d), { type: "set-physical-topology", topology });
    expect(parseHarnessDesignDocument(JSON.parse(JSON.stringify(h.present))).physicalTopology).toEqual(topology);
    expect(topology.routes.find(r => r.wireId === "W3")!.steps.slice(0, 2)).toEqual([{ segmentId: "new", reverse: true }, { segmentId: "S1", reverse: true }]);
    expect(undoEditorCommand(h).present).toBe(d);
    expect(h.present.wires).toBe(d.wires);
  });
  it("keeps every segment on the 15 degree grid after arbitrary anchor moves", () => {
    for (let i = 1; i < 60; i++) {
      const points = constrainedPolyline([{ x: -10, y: 70 }, { x: i * 13.7 - 400, y: i * 2.31 - 20 }, { x: 220, y: -111 }], true);
      for (let j = 1; j < points.length; j++) {
        const angle = Math.atan2(points[j]!.y - points[j - 1]!.y, points[j]!.x - points[j - 1]!.x) / (Math.PI / 12);
        expect(Math.abs(angle - Math.round(angle))).toBeLessThan(1e-6);
      }
    }
    const input = [{ x: 0, y: 0 }, { x: 123, y: 31 }];
    expect(constrainedPolyline(input, false)).toEqual(input);
  });
  it("moves common exits with connectors without changing lengths, electrical ends or shared topology", () => {
    const d = physicalFixture();
    const moved = applyEditorCommand(d, { type: "move-connector", connectorId: "A", view: "drawing", position: { x: 33, y: 66 } });
    expect(physicalSegmentPoints(moved, moved.physicalTopology!.segments[0]!)[0]).toEqual({ x: 183, y: 106 });
    expect(moved.wires).toBe(d.wires);
    expect(physicalWirePoints(moved, "W1", { x: 0, y: 0 }, { x: 1, y: 1 })!.length).toBeGreaterThan(3);
  });
  it("rejects broken references, discontinuous routes and wrong connector exits", () => {
    const d = physicalFixture();
    for (const steps of [[{ segmentId: "missing", reverse: false }], [{ segmentId: "S0", reverse: false }, { segmentId: "S1", reverse: true }], [{ segmentId: "S2", reverse: false }]]) {
      expect(() => parseHarnessDesignDocument({ ...d, physicalTopology: { ...d.physicalTopology!, routes: [{ wireId: "W1", steps }] } })).toThrow();
    }
    expect(parseHarnessDesignDocument(createEmptyHarnessDesign()).physicalTopology).toBeUndefined();
  });
  it("removes route references when a wire is deleted", () => {
    const d = applyEditorCommand(physicalFixture(), { type: "remove-wire", wireId: "W1" });
    expect(d.physicalTopology!.routes.map(r => r.wireId)).toEqual(["W2", "W3"]);
    expect(() => parseHarnessDesignDocument(d)).not.toThrow();
  });
});
