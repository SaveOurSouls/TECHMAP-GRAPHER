import { expect, it } from "vitest";
import { physicalFixture } from "../editor/physical-topology-fixture";
import { createInitialRouteV3, parseRouteV3, resetRouteV3WireArtwork, setRouteV3WireArtworkOverride } from "./route-v3-model";
import { routeV3WireArtwork } from "./route-v3-wire-artwork";

function source() {
  const base = physicalFixture();
  const connectors = base.connectors.map(connector => ({ ...connector, contacts: connector.contacts.map(contact => {
    if (connector.id === "A" && contact.number === 1) return { ...contact, terminalArticle: "TERM-A", wire: "МГТФ", wireSection: "0,35", color: "красный", customValues: { Уплотнитель: "да" } };
    if (connector.id === "B" && contact.number === 1) return { ...contact, wire: "МГТФ", wireSection: "0,35", color: "красный", customValues: { Пайка: "да" } };
    return contact;
  }) }));
  return { ...base, connectors };
}

it("derives v3 artwork from E4 material, terminal, seal and solder fields", () => {
  const value = routeV3WireArtwork(source(), "W1")!;
  expect(value).toMatchObject({ mark: "МГТФ", section: "0,35", start: "sealed", end: "tin", automatic: true });
  expect(value.color).toBe("#D32F2F");
});

it("keeps the manual V3 end and colour until the user explicitly resets to E4", () => {
  const initial = createInitialRouteV3(source());
  const manual = setRouteV3WireArtworkOverride(initial, { wireId: "W1", start: "copper", end: "cut", color: "#123456" });
  expect(routeV3WireArtwork(source(), "W1", manual.wireArtwork![0])).toMatchObject({ start: "copper", end: "cut", color: "#123456", automatic: false });
  const reset = resetRouteV3WireArtwork(manual, ["W1"]);
  expect(reset.wireArtwork).toBeUndefined();
  expect(routeV3WireArtwork(source(), "W1")).toMatchObject({ start: "sealed", end: "tin", automatic: true });
  expect(parseRouteV3(JSON.parse(JSON.stringify(manual)))).toEqual(manual);
  expect(parseRouteV3({ ...manual, wireArtwork: [{ wireId: "W1", color: "bad" }] })).toBeNull();
});
