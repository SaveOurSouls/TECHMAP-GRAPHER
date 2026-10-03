import { expect, it } from "vitest";
import { designToScene } from "./HarnessDesignEditor";
import { freeTwistedPairPaths, physicalTwistedPairPath } from "./drawing-twisted-pair";
import { physicalFixture } from "./physical-topology-fixture";
import { physicalWireDisplay } from "./physical-wire-geometry";

const group = { id: "pair", wireIds: ["W1", "W2"] as const, step: 25, amplitude: 4, variant: 1 as const };

it("projects a physical E4 pair as alternating colored paths without changing stored routes", () => {
  const base = physicalFixture();
  const document = { ...base, diffPairs: [group] };
  const before = JSON.stringify(document);
  const center = [{ x: 0, y: 0 }, { x: 120, y: 0 }];
  const first = physicalTwistedPairPath(document, "S0", "W1", center)!;
  const second = physicalTwistedPairPath(document, "S0", "W2", center)!;
  expect(first).not.toBeNull();
  expect(second).not.toBeNull();
  expect(first.path[0]!.y).toBeCloseTo(first.path.at(-1)!.y);
  expect(second.path[0]!.y).toBeCloseTo(second.path.at(-1)!.y);
  expect(first.path.find(point => point.x === 12)!.y).toBeCloseTo(second.path[0]!.y);
  expect(second.path.find(point => point.x === 12)!.y).toBeCloseTo(first.path[0]!.y);
  expect(first.strokes.length).toBeGreaterThan(1);
  expect(second.strokes.length).toBeGreaterThan(1);
  const projected = designToScene(document, "drawing").filter(object => object.kind === "wire" && group.wireIds.includes(object.id as "W1" | "W2"));
  expect(projected).toHaveLength(2);
  expect(projected.every(wire => wire.visibleWireStrokes!.length > 2)).toBe(true);
  const ordinary = designToScene({ ...document, diffPairs: [] }, "drawing").find(object => object.id === "W1")!;
  expect(ordinary.visibleWireStrokes!.length).toBeLessThan(projected[0]!.visibleWireStrokes!.length);
  expect(JSON.stringify(document)).toBe(before);
});

it("keeps conductors hidden when their physical pipe hides wires", () => {
  const base = physicalFixture();
  const document = { ...base, diffPairs: [group], physicalTopology: {
    ...base.physicalTopology!, segments: base.physicalTopology!.segments.map(segment =>
      segment.id === "S0" ? { ...segment, showWires: false } : segment),
  } };
  const display = physicalWireDisplay(document, "W1", { x: 0, y: 0 }, { x: 600, y: 600 })!;
  expect(display.twisted).toBe(false);
  expect(display.selectionPaths.length).toBeGreaterThan(0);
});

it("twists free drawing routes on their common straight section and leaves the ends anchored", () => {
  const wires = [
    { id: "W1", points: [{ x: 0, y: 0 }, { x: 120, y: 0 }], width: 2.5 },
    { id: "W2", points: [{ x: 0, y: 10 }, { x: 120, y: 10 }], width: 2.5 },
  ];
  const result = freeTwistedPairPaths(group, wires);
  expect(result.size).toBe(2);
  expect(result.get("W1")!.path[0]).toEqual(wires[0]!.points[0]);
  expect(result.get("W2")!.path.at(-1)).toEqual(wires[1]!.points[1]);
  expect(result.get("W1")!.strokes.length).toBeGreaterThan(1);
  expect(freeTwistedPairPaths(group, [{ ...wires[0]!, points: [{ x: 0, y: 0 }, { x: 0, y: 120 }] }, wires[1]!]).size).toBe(0);
});
