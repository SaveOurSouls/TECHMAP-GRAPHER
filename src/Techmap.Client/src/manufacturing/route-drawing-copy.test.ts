import { expect, it } from "vitest";
import { physicalFixture } from "../editor/physical-topology-fixture";
import { legacyRouteDrawingCopyWarnings, migrateLegacyRouteDrawingCopy } from "./route-drawing-copy";

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
});
