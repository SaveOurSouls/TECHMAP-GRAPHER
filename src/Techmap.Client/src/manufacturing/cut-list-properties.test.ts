import { expect, it } from "vitest";
import { physicalFixture } from "../editor/physical-topology-fixture";
import { displayWireSection, wireMarkWithoutSection, wireSemiFinishedProperties } from "./cut-list-properties";

function document() {
  const base = physicalFixture();
  return { ...base, connectors: base.connectors.map(connector => ({ ...connector, contacts: connector.contacts.map(contact => {
    if (connector.id === "A" && contact.number === 1) return { ...contact, terminalArticle: "TERM-A", wire: "UL1007 · 28AWG", wireSection: "28", color: "красный", customValues: { seal: "SEAL-A" } };
    if (connector.id === "B" && contact.number === 1) return { ...contact, wire: "UL1007 · 28AWG", wireSection: "28", color: "красный", customValues: { Пайка: "да" } };
    return contact;
  }) })) };
}

it("retains the stored section system and removes only a duplicate section from the mark", () => {
  expect(displayWireSection("28", "UL1007 · 28AWG")).toBe("28AWG");
  expect(displayWireSection("0,35", "НВ-4 · 0,35 мм²")).toBe("0,35 мм²");
  expect(displayWireSection("0,35", "НВ-4 · 0.35 mm2")).toBe("0,35 мм²");
  expect(displayWireSection("30", "UL1007", "awg")).toBe("30AWG");
  expect(displayWireSection("0,35", "НВ-4", "mm2")).toBe("0,35 мм²");
  expect(wireMarkWithoutSection("UL1007 · 28AWG", "28AWG")).toBe("UL1007");
});

it("formats terminal and non-terminal ends for the semi-finished product", () => {
  const value = wireSemiFinishedProperties(document(), "W1")!;
  expect(value).toMatchObject({ mark: "UL1007", section: "28AWG", terminalFrom: "TERM-A / SEAL-A", terminalTo: "лужёная медь" });
});

it("uses the saved catalogue section unit even when the original value was numeric", () => {
  const base = document();
  const selected = {
    ...base,
    connectors: base.connectors.map(connector => ({ ...connector, contacts: connector.contacts.map(contact =>
      contact.number === 1 ? { ...contact, wire: "UL1007", wireSection: "30" } : contact,
    ) })),
    wires: base.wires.map(wire => wire.id !== "W1" ? wire : { ...wire, materialBinding: {
      sourceId: "technology-wires", snapshotId: "11111111-1111-4111-8111-111111111111",
      snapshotSha256: "a".repeat(64), recordId: "b".repeat(64), entityType: "wire" as const,
      sourceKey: "UL1007 #30", displayName: "UL1007 · 30AWG", sectionUnit: "awg" as const,
    } }),
  };

  expect(wireSemiFinishedProperties(selected, "W1")?.section).toBe("30AWG");
});
