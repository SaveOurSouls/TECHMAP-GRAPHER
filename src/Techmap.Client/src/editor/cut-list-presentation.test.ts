import { expect, it } from "vitest";
import type { HarnessCutListItem } from "../harness-cut-list-api";
import { groupedCutListPresentation, nextCutListSort } from "./cut-list-presentation";

const item = (wireId: string, material: string, sourceKind: HarnessCutListItem["sourceKind"] = "wire"): HarnessCutListItem => ({ wireId, circuit: wireId, sourceKind, material, materialSourceKey: null, materialDisplayName: material, sourceLengthMm: 10, endCorrectionFromMm: 0, endCorrectionToMm: 0, roundingStepMm: 1, cutLengthMm: 10, pieces: 1, totalMetres: .01, status: "ready", warnings: [] });

it("groups wire blanks separately from coverings and filters their properties", () => {
  const groups = groupedCutListPresentation([item("W2", "Z-wire"), item("C1", "Heat shrink", "covering"), item("W1", "A-wire")], undefined, "wire", []);
  expect(groups.map(group => [group.id, group.rows.map(row => row.item.wireId)])).toEqual([["wires", ["W2", "W1"]]]);
  expect(groupedCutListPresentation([item("W1", "Wire"), item("C1", "Heat shrink", "covering")], undefined, "", []).map(group => group.id)).toEqual(["wires", "coverings"]);
});

it("accumulates click priority and only changes the direction of its existing key", () => {
  const mark = nextCutListSort([], "mark");
  const color = nextCutListSort(mark, "color");
  expect(color).toEqual([{ field: "mark", direction: "asc" }, { field: "color", direction: "asc" }]);
  expect(nextCutListSort(color, "mark")).toEqual([{ field: "mark", direction: "desc" }, { field: "color", direction: "asc" }]);
  expect(nextCutListSort(nextCutListSort(color, "mark"), "mark")).toEqual([{ field: "color", direction: "asc" }]);
});
