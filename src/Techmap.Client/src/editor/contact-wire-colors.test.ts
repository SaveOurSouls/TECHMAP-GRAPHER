import { describe, expect, it } from "vitest";
import { applyEditorCommand, createConnector } from "./commands";
import { createEmptyHarnessDesign, parseHarnessDesignDocument } from "./model";

describe("connector contact wire colors", () => {
  it("stores an optional secondary color and clears it back to a one-color wire", () => {
    let document = applyEditorCommand(createEmptyHarnessDesign(), {
      type: "add-connector",
      connector: createConnector("x1", "X1", 1, { x: 0, y: 0 }),
    });
    document = applyEditorCommand(document, {
      type: "update-contact",
      connectorId: "x1",
      contactId: "x1:contact:1",
      wire: "UL1061 28 AWG",
      color: "красный",
      secondaryColor: "чёрный",
    });
    expect(document.connectors[0]?.contacts[0]).toMatchObject({
      wire: "UL1061 28 AWG", color: "красный", secondaryColor: "чёрный",
    });

    document = applyEditorCommand(document, {
      type: "update-contact", connectorId: "x1", contactId: "x1:contact:1", secondaryColor: "",
    });
    expect(document.connectors[0]?.contacts[0]?.secondaryColor).toBe("");

    document = applyEditorCommand(document, {
      type: "update-contact", connectorId: "x1", contactId: "x1:contact:1", color: "#12abef",
    });
    document = applyEditorCommand(document, {
      type: "update-contact", connectorId: "x1", contactId: "x1:contact:1", color: "красный",
    });
    expect(document.customWireColors).toEqual(["#12ABEF"]);
  });

  it("defaults a missing legacy secondary color to an empty value", () => {
    const connector = createConnector("x1", "X1", 1, { x: 0, y: 0 });
    const legacyContact = { ...connector.contacts[0] } as Record<string, unknown>;
    delete legacyContact.secondaryColor;
    const parsed = parseHarnessDesignDocument({
      ...createEmptyHarnessDesign(),
      connectors: [{ ...connector, contacts: [legacyContact] }],
    });
    expect(parsed.connectors[0]?.contacts[0]?.secondaryColor).toBe("");
    expect(parsed.customWireColors).toEqual([]);
  });

  it("restores custom colors from old contact values and validates the persisted list", () => {
    const connector = createConnector("x1", "X1", 1, { x: 0, y: 0 });
    const parsed = parseHarnessDesignDocument({
      ...createEmptyHarnessDesign(),
      customWireColors: undefined,
      connectors: [{ ...connector, contacts: [{ ...connector.contacts[0]!, color: "#12abef" }] }],
    });
    expect(parsed.customWireColors).toEqual(["#12ABEF"]);
    expect(() => parseHarnessDesignDocument({ ...createEmptyHarnessDesign(), customWireColors: [12] })).toThrow(/цвета/);
  });
});
