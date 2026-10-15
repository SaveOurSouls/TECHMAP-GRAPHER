import { expect, it } from "vitest";
import { physicalFixture } from "../editor/physical-topology-fixture";
import { createInitialRouteV3, parseRouteV3, resetRouteV3WireArtwork, routeV3GroupedSourceQuantity, setRouteV3WireArtworkOverride } from "./route-v3-model";
import { routeV3CompositionGroups, setRouteV3GroupArtwork } from "./route-v3-composition-groups";

it("separates different saved appearances without duplicating batch quantities and regroups on reset", () => {
  const source = physicalFixture();
  const refs = source.wires.map(wire => ({ kind: "wire" as const, id: wire.id }));
  const initial = createInitialRouteV3(source);
  expect(routeV3CompositionGroups(refs, source, initial)).toHaveLength(1);
  const changed = setRouteV3WireArtworkOverride(initial, { wireId: refs[0]!.id, color: "#123456" });
  const groups = routeV3CompositionGroups(refs, source, changed);
  expect(groups.map(group => group.length)).toEqual([1, 2]);
  expect(groups.map(group => routeV3GroupedSourceQuantity(group[0]!, group, source, 5).perBatch)).toEqual([5, 10]);
  expect(routeV3CompositionGroups(refs, source, resetRouteV3WireArtwork(changed, [refs[0]!.id]))).toHaveLength(1);
});

it("edits the whole row atomically, preserves other overrides, and survives serialization", () => {
  const source = physicalFixture();
  const ids = source.wires.map(wire => wire.id);
  const initial = setRouteV3WireArtworkOverride(createInitialRouteV3(source), { wireId: ids[0]!, end: "tin" });
  const changed = setRouteV3GroupArtwork(initial, ids.slice(0, 2), { start: "copper", color: "#00ff00" });
  expect(changed.wireArtwork).toEqual([
    { wireId: ids[0], start: "copper", end: "tin", color: "#00ff00" },
    { wireId: ids[1], start: "copper", color: "#00ff00" },
  ]);
  expect(initial.wireArtwork).toEqual([{ wireId: ids[0], end: "tin" }]);
  expect(parseRouteV3(JSON.parse(JSON.stringify(changed)))).toEqual(changed);
});
