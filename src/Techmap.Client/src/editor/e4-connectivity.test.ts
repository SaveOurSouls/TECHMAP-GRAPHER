import { describe, expect, it } from "vitest";
import { applyEditorCommand, createConnector, createWire } from "./commands";
import { e4ConnectivityFingerprint, projectE4Connectivity } from "./e4-connectivity";
import { createEmptyHarnessDesign } from "./model";

function connectedDocument() {
  let document = createEmptyHarnessDesign();
  document = applyEditorCommand(document, {
    type: "add-connector",
    connector: createConnector("x1", "X1", 2, { x: 0, y: 0 }),
  });
  document = applyEditorCommand(document, {
    type: "add-connector",
    connector: createConnector("x2", "X2", 2, { x: 800, y: 0 }),
  });
  document = applyEditorCommand(document, { type: "flip-connector-orientation", connectorId: "x2" });
  document = applyEditorCommand(document, {
    type: "add-wire",
    wire: createWire(
      "w1",
      { connectorId: "x1", contactId: "x1:contact:1" },
      { connectorId: "x2", contactId: "x2:contact:1" },
      350,
      "NET-A",
    ),
  });
  return document;
}

describe("canonical E4 connectivity", () => {
  it("stays unchanged after connector, table and route geometry commands", () => {
    let document = connectedDocument();
    const before = e4ConnectivityFingerprint(document);

    document = applyEditorCommand(document, {
      type: "move-connector", connectorId: "x1", view: "e4", position: { x: 40, y: 120 },
    });
    document = applyEditorCommand(document, {
      type: "toggle-base-column-visibility", connectorId: "x1", key: "color",
    });
    document = applyEditorCommand(document, { type: "flip-connector-orientation", connectorId: "x1" });

    expect(e4ConnectivityFingerprint(document)).toBe(before);
  });

  it("is independent of document array order and endpoint direction", () => {
    const document = connectedDocument();
    const reversed = {
      ...document,
      connectors: [...document.connectors].reverse(),
      wires: [...document.wires].reverse().map((wire) => ({ ...wire, from: wire.to, to: wire.from })),
      junctions: [...document.junctions].reverse(),
      diffPairs: [...document.diffPairs].reverse(),
      screens: [...document.screens].reverse(),
    };

    expect(projectE4Connectivity(reversed)).toEqual(projectE4Connectivity(document));
  });

  it("changes after an electrical endpoint, circuit or contact status changes", () => {
    const document = connectedDocument();
    const baseline = e4ConnectivityFingerprint(document);
    const reconnected = {
      ...document,
      wires: document.wires.map((wire) => ({
        ...wire,
        to: { connectorId: "x2", contactId: "x2:contact:2" },
      })),
    };
    const renamedCircuit = {
      ...document,
      wires: document.wires.map((wire) => ({ ...wire, circuit: "NET-B" })),
    };
    const notConnected = {
      ...document,
      connectors: document.connectors.map((connector) => connector.id === "x1"
        ? {
          ...connector,
          contacts: connector.contacts.map((contact) => contact.id === "x1:contact:2"
            ? { ...contact, connectionStatus: "not-connected" as const }
            : contact),
        }
        : connector),
    };

    expect(e4ConnectivityFingerprint(reconnected)).not.toBe(baseline);
    expect(e4ConnectivityFingerprint(renamedCircuit)).not.toBe(baseline);
    expect(e4ConnectivityFingerprint(notConnected)).not.toBe(baseline);
  });
});

