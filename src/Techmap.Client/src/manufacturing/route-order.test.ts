import { expect, it } from "vitest";
import { createEmptyHarnessDesign } from "../editor/model";
import { createConnector, createWire } from "../editor/commands";
import { addAssemblyRow, generateRoute } from "./route-commands";
import { previewRouteRebase } from "./route-rebase";

it("orders generated and newly added blanks as wire, nylon and braids, heat shrink, tapes, then manual assemblies", () => {
  const covering = (id: string, name: string, kind?: "nylon" | "metal-braid" | "heat-shrink" | "tape") =>
    ({ id, name, ...(kind ? { kind } : {}), spans: [], width: 10, color: "#ffffff", lengthMm: 20 });
  const base = createEmptyHarnessDesign();
  const a = createConnector("a", "X1", 1, { x: 0, y: 0 });
  const b = createConnector("b", "X2", 1, { x: 100, y: 0 });
  const document = { ...base, connectors: [a, b], wires: [createWire("wire", { connectorId: "a", contactId: a.contacts[0]!.id }, { connectorId: "b", contactId: b.contacts[0]!.id }, 100)],
    physicalTopology: { snap: false, nodes: [], segments: [], routes: [], coverings: [
    covering("tape", "Лента", "tape"), covering("heat", "Термоусадка", "heat-shrink"),
    covering("braid", "Оплётка", "metal-braid"), covering("nylon", "Нейлонка", "nylon"),
  ] } };
  const initial = { ...document, physicalTopology: { ...document.physicalTopology, coverings: [document.physicalTopology.coverings[0]!] } };
  const route = addAssemblyRow(generateRoute(initial, "a".repeat(64)), "manual", "Сборка", [], []);
  const result = previewRouteRebase(route, document, "b".repeat(64));
  expect(result.route.rows.map(row => row.kind === "assembly" ? row.id : row.sourceObjects[0]!.id))
    .toEqual(["wire", "braid", "nylon", "heat", "tape", "manual"]);
  expect(generateRoute(document, "a".repeat(64)).rows.map(row => row.sourceObjects[0]!.id))
    .toEqual(["wire", "braid", "nylon", "heat", "tape"]);
  expect(generateRoute(document, "a".repeat(64)).rows.map(row => row.index))
    .toEqual(["ПФ-01", "ПФ-02", "ПФ-03", "ПФ-04", "ПФ-05"]);
});
