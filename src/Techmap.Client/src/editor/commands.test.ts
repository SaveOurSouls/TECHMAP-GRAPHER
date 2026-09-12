import { describe, expect, it } from "vitest";
import { applyEditorCommand, createConnector, createWire } from "./commands";
import { createEditorHistory, executeEditorCommand, redoEditorCommand, undoEditorCommand } from "./history";
import { createEmptyHarnessDesign } from "./model";

describe("shared harness editor model", () => {
  it("keeps E4 and drawing positions separate while sharing one connector", () => {
    const connector = createConnector("x1", "X1", 2, { x: 10, y: 20 }, { x: 40, y: 50 });
    const added = applyEditorCommand(createEmptyHarnessDesign(), { type: "add-connector", connector });
    const moved = applyEditorCommand(added, {
      type: "move-connector", connectorId: "x1", view: "drawing", position: { x: 90, y: 110 },
    });
    expect(moved.connectors[0]?.positions.e4).toEqual({ x: 10, y: 20 });
    expect(moved.connectors[0]?.positions.drawing).toEqual({ x: 90, y: 110 });
  });

  it("connects existing contacts and removes their wires with the connector", () => {
    const x1 = createConnector("x1", "X1", 2, { x: 0, y: 0 });
    const x2 = createConnector("x2", "X2", 2, { x: 300, y: 0 });
    let document = applyEditorCommand(createEmptyHarnessDesign(), { type: "add-connector", connector: x1 });
    document = applyEditorCommand(document, { type: "add-connector", connector: x2 });
    document = applyEditorCommand(document, {
      type: "add-wire",
      wire: createWire("w1", { connectorId: "x1", contactId: "x1:contact:1" }, { connectorId: "x2", contactId: "x2:contact:2" }, 350),
    });
    expect(document.wires[0]?.lengthMm).toBe(350);
    document = applyEditorCommand(document, { type: "remove-connector", connectorId: "x1" });
    expect(document.wires).toHaveLength(0);
  });

  it("does not change absolute length when route geometry changes", () => {
    const x1 = createConnector("x1", "X1", 1, { x: 0, y: 0 });
    const x2 = createConnector("x2", "X2", 1, { x: 300, y: 0 });
    let document = createEmptyHarnessDesign();
    document = applyEditorCommand(document, { type: "add-connector", connector: x1 });
    document = applyEditorCommand(document, { type: "add-connector", connector: x2 });
    document = applyEditorCommand(document, {
      type: "add-wire",
      wire: createWire("w1", { connectorId: "x1", contactId: "x1:contact:1" }, { connectorId: "x2", contactId: "x2:contact:1" }, 350),
    });
    document = applyEditorCommand(document, { type: "set-wire-route", wireId: "w1", route: [{ x: 100, y: 90 }] });
    expect(document.wires[0]?.drawingRoute).toEqual([{ x: 100, y: 90 }]);
    expect(document.wires[0]?.lengthMm).toBe(350);
  });

  it("reconnects one end of an existing wire and preserves its properties", () => {
    const x1 = createConnector("x1", "X1", 2, { x: 0, y: 0 });
    const x2 = createConnector("x2", "X2", 2, { x: 300, y: 0 });
    let document = createEmptyHarnessDesign();
    document = applyEditorCommand(document, { type: "add-connector", connector: x1 });
    document = applyEditorCommand(document, { type: "add-connector", connector: x2 });
    document = applyEditorCommand(document, {
      type: "add-wire",
      wire: createWire("w1", { connectorId: "x1", contactId: "x1:contact:1" }, { connectorId: "x2", contactId: "x2:contact:1" }, 420, "ЦЕПЬ-1", "#cc0000"),
    });

    document = applyEditorCommand(document, {
      type: "reconnect-wire",
      wireId: "w1",
      end: "to",
      endpoint: { connectorId: "x2", contactId: "x2:contact:2" },
    });

    expect(document.wires[0]).toMatchObject({
      to: { connectorId: "x2", contactId: "x2:contact:2" },
      lengthMm: 420,
      circuit: "ЦЕПЬ-1",
      color: "#cc0000",
    });
  });

  it("undoes and redoes complete document commands", () => {
    let history = createEditorHistory(createEmptyHarnessDesign());
    history = executeEditorCommand(history, {
      type: "add-connector", connector: createConnector("x1", "X1", 1, { x: 0, y: 0 }),
    });
    expect(history.present.connectors).toHaveLength(1);
    history = undoEditorCommand(history);
    expect(history.present.connectors).toHaveLength(0);
    history = redoEditorCommand(history);
    expect(history.present.connectors).toHaveLength(1);
  });
});
