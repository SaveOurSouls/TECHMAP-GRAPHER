import { expect, it } from "vitest";
import { physicalFixture } from "../editor/physical-topology-fixture";
import { createIndependentIsolatedDocument, createRouteDrawingCopy, legacyRouteDrawingCopyWarnings, migrateLegacyRouteDrawingCopy, parseRouteDrawingCopy } from "./route-drawing-copy";
import { designToScene } from "../editor/HarnessDesignEditor";

it("migrates legacy visibility and authored P geometry without changing source lengths", () => {
  const source = physicalFixture();
  const before = structuredClone(source);
  const copy = migrateLegacyRouteDrawingCopy(source, [
    { id: "S0", hidden: true, points: [{ x: 150, y: 40 }, { x: 190, y: 120 }, { x: 210, y: 200 }] },
    { id: "NA", hidden: false, points: [{ x: 999, y: 999 }] },
  ]);
  expect(copy.hiddenObjectIds).toEqual(["S0"]);
  expect(copy.document.physicalTopology!.segments[0]!.path.points).toEqual([{ x: 190, y: 120 }]);
  expect(copy.document.physicalTopology!.nodes[0]!.position).toEqual(source.physicalTopology!.nodes[0]!.position);
  expect(copy.document.wires.map(wire => wire.lengthMm)).toEqual(source.wires.map(wire => wire.lengthMm));
  expect(source).toEqual(before);
  expect(legacyRouteDrawingCopyWarnings(source, [{ id: "cover", points: [{ x: 1, y: 2 }] }])).toEqual(["cover"]);
  expect(legacyRouteDrawingCopyWarnings(source, [
    { id: "S0", points: [{ x: 1, y: 2 }] },
    { id: "NA", points: [{ x: 999, y: 999 }] },
    { id: "S1", points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] },
  ])).toEqual(["S0", "NA"]);
});

it("creates a detached drawing model from selected material and drops physical routing", () => {
  const source = physicalFixture();
  const before = structuredClone(source);
  const scene = designToScene(source, "drawing");
  const isolated = createIndependentIsolatedDocument(source, scene, ["W1"]);
  expect(isolated).not.toBeNull();
  expect(isolated!.wires.map(wire => wire.id)).toEqual(["W1"]);
  expect(isolated!.connectors).toEqual([]);
  expect(isolated!.physicalTopology).toBeUndefined();
  expect(isolated!.junctions).toEqual([]);
  expect(isolated!.screens).toEqual([]);
  expect(isolated!.diffPairs).toEqual([]);
  expect(isolated!.wires[0]!.drawingRoute).toEqual([]);
  expect(isolated!.wires[0]!.from.connectorId).toBe("isolated:W1:from");
  expect(isolated!.wires[0]!.to.connectorId).toBe("isolated:W1:to");
  expect(isolated!.wires[0]!.drawingEndpoints).toBeDefined();
  expect(isolated!.wires[0]!.drawingEndStyles).toEqual({ from: "cut", to: "cut" });
  expect(isolated!.wires[0]!.stripProfiles).toEqual(source.wires[0]!.stripProfiles);
  expect(source).toEqual(before);
});

it("returns null when isolation receives only non-material scene objects", () => {
  const source = physicalFixture();
  const scene = designToScene(source, "drawing");
  expect(createIndependentIsolatedDocument(source, scene, ["S0"])).not.toBeNull();
  expect(createIndependentIsolatedDocument(source, scene, ["missing-object"])).toBeNull();
});

it("round-trips the isolated snapshot through route Save/reopen parsing", () => {
  const source = physicalFixture();
  const scene = designToScene(source, "drawing");
  const isolated = createIndependentIsolatedDocument(source, scene, ["W1"]);
  const saved = createRouteDrawingCopy(isolated!, []);
  const reopened = parseRouteDrawingCopy(JSON.parse(JSON.stringify(saved)));
  expect(reopened.document.physicalTopology).toBeUndefined();
  expect(reopened.document.wires[0]!.drawingRoute).toEqual([]);
  expect(reopened.document.wires[0]!.id).toBe("W1");
});
