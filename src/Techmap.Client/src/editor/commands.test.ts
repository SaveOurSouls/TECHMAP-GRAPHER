import { describe, expect, it } from "vitest";
import { applyEditorCommand, createConnector, createWire } from "./commands";
import { createEditorHistory, executeEditorCommand, redoEditorCommand, undoEditorCommand } from "./history";
import { connectorContactPosition, connectorE4TableGeometry, createEmptyHarnessDesign, parseHarnessDesignDocument } from "./model";

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

  it("creates an E4 table presentation with independent template article and orientation", () => {
    const connector = createConnector("x1", "XS1", 2, { x: 0, y: 0 }, undefined, "SH-001");
    expect(connector.designation).toBe("XS1");
    expect(connector.partNumber).toBe("SH-001");
    expect(connector.schematic.orientation).toBe("contacts-right");
    expect(connector.schematic.baseColumns.map((column) => column.key)).toEqual([
      "number", "contactType", "circuit", "terminal", "wire", "color",
    ]);
    expect(connector.contacts[0]).toMatchObject({
      contactType: "", terminalArticle: "", wire: "", color: "", connectionStatus: "available", customValues: {},
    });
    let document = applyEditorCommand(createEmptyHarnessDesign(), { type: "add-connector", connector });
    document = applyEditorCommand(document, {
      type: "update-connector", connectorId: "x1", designation: "XP1", partNumber: "BS1071-7",
    });
    expect(document.connectors[0]).toMatchObject({ designation: "XP1", partNumber: "BS1071-7" });
    expect(() => applyEditorCommand(document, {
      type: "update-connector", connectorId: "x1", designation: "XP1", partNumber: " ",
    })).toThrow(/артикул/);
  });

  it("supports flipping orientation, contact status, custom fields and safe contact removal", () => {
    let document = applyEditorCommand(createEmptyHarnessDesign(), {
      type: "add-connector", connector: createConnector("x1", "XS1", 2, { x: 0, y: 0 }),
    });
    document = applyEditorCommand(document, {
      type: "add-custom-field", connectorId: "x1", field: { id: "note", label: "Примечание", visible: true },
    });
    document = applyEditorCommand(document, {
      type: "update-contact", connectorId: "x1", contactId: "x1:contact:1",
      contactType: "сигнальный", terminalArticle: "SH-001", wire: "UL1061 28AWG", color: "чёрный",
      connectionStatus: "not-connected",
      customValues: { note: "оператор" },
    });
    document = applyEditorCommand(document, { type: "flip-connector-orientation", connectorId: "x1" });
    document = applyEditorCommand(document, {
      type: "toggle-base-column-visibility", connectorId: "x1", key: "number",
    });
    document = applyEditorCommand(document, {
      type: "add-contact",
      connectorId: "x1",
      contact: {
        id: "x1:contact:3", number: 3, contactType: "силовой", circuit: "L1",
        terminalArticle: "SH-003", wire: "UL1061 20AWG", color: "синий",
        connectionStatus: "available", customValues: { note: "резерв" },
      },
    });
    expect(document.connectors[0]?.schematic.orientation).toBe("contacts-left");
    expect(document.connectors[0]?.schematic.baseColumns.find((column) => column.key === "number")?.visible).toBe(false);
    expect(document.connectors[0]?.contacts[0]).toMatchObject({
      contactType: "сигнальный", terminalArticle: "SH-001", wire: "UL1061 28AWG", color: "чёрный",
      connectionStatus: "not-connected", customValues: { note: "оператор" },
    });
    document = applyEditorCommand(document, { type: "remove-contact", connectorId: "x1", contactId: "x1:contact:3" });
    expect(document.connectors[0]?.contacts.map((contact) => contact.number)).toEqual([1, 2]);
    document = applyEditorCommand(document, { type: "remove-custom-field", connectorId: "x1", fieldId: "note" });
    expect(document.connectors[0]?.contacts[0]?.customValues).toEqual({});
  });

  it("does not remove a contact referenced by a wire and parses legacy contacts with defaults", () => {
    const legacy = createEmptyHarnessDesign();
    const x1 = createConnector("x1", "X1", 1, { x: 0, y: 0 });
    const x2 = createConnector("x2", "X2", 1, { x: 200, y: 0 });
    const { partNumber: _partNumber, schematic: _schematic, ...legacyX1 } = x1;
    const legacyJson = {
      ...legacy,
      connectors: [
        { ...legacyX1, contacts: [{ id: "x1:contact:1", number: 1, circuit: "" }] },
        x2,
      ],
      wires: [createWire("w1", { connectorId: "x1", contactId: "x1:contact:1" }, { connectorId: "x2", contactId: "x2:contact:1" })],
    };
    const parsed = parseHarnessDesignDocument(legacyJson);
    expect(parsed.connectors[0]?.partNumber).toBe("X1");
    expect(parsed.connectors[0]?.contacts[0]).toMatchObject({ wire: "", color: "", connectionStatus: "available", customValues: {} });
    expect(() => applyEditorCommand(parsed, { type: "remove-contact", connectorId: "x1", contactId: "x1:contact:1" })).toThrow(/подключён/);
  });

  it("enforces the electrical meaning of a not-connected contact", () => {
    let document = createEmptyHarnessDesign();
    document = applyEditorCommand(document, {
      type: "add-connector", connector: createConnector("x1", "X1", 2, { x: 0, y: 0 }),
    });
    document = applyEditorCommand(document, {
      type: "add-connector", connector: createConnector("x2", "X2", 2, { x: 200, y: 0 }),
    });
    document = applyEditorCommand(document, {
      type: "update-contact", connectorId: "x1", contactId: "x1:contact:1", connectionStatus: "not-connected",
    });
    expect(() => applyEditorCommand(document, {
      type: "add-wire",
      wire: createWire("w1", { connectorId: "x1", contactId: "x1:contact:1" }, { connectorId: "x2", contactId: "x2:contact:1" }),
    })).toThrow(/неподключённый/);

    document = applyEditorCommand(document, {
      type: "add-wire",
      wire: createWire("w2", { connectorId: "x1", contactId: "x1:contact:2" }, { connectorId: "x2", contactId: "x2:contact:1" }),
    });
    expect(() => applyEditorCommand(document, {
      type: "update-contact", connectorId: "x1", contactId: "x1:contact:2", connectionStatus: "not-connected",
    })).toThrow(/пока к нему подключён провод/);
    expect(() => applyEditorCommand(document, {
      type: "reconnect-wire", wireId: "w2", end: "to",
      endpoint: { connectorId: "x1", contactId: "x1:contact:1" },
    })).toThrow(/неподключённый/);
  });

  it("derives mirrored E4 table geometry and keeps drawing geometry unchanged", () => {
    let document = applyEditorCommand(createEmptyHarnessDesign(), {
      type: "add-connector", connector: createConnector("x1", "XS1", 2, { x: 10, y: 20 }, { x: 30, y: 40 }),
    });
    const right = connectorE4TableGeometry(document.connectors[0]!);
    expect(right.columns.map((column) => column.kind === "base" ? column.key : column.id)).toEqual([
      "color", "wire", "terminal", "circuit", "contactType", "number",
    ]);
    expect(connectorContactPosition(document.connectors[0]!, "x1:contact:1", "e4")).toEqual({
      x: 10 + right.width,
      y: 20 + right.titleHeight + right.headerHeight + right.rowHeight / 2,
    });
    expect(connectorContactPosition(document.connectors[0]!, "x1:contact:1", "drawing")).toEqual({ x: 148, y: 68 });

    document = applyEditorCommand(document, { type: "flip-connector-orientation", connectorId: "x1" });
    const left = connectorE4TableGeometry(document.connectors[0]!);
    expect(left.columns.map((column) => column.kind === "base" ? column.key : column.id)).toEqual([
      "number", "contactType", "circuit", "terminal", "wire", "color",
    ]);
    expect(connectorContactPosition(document.connectors[0]!, "x1:contact:1", "e4")?.x).toBe(10);
    expect(left.height).toBe(left.titleHeight + left.headerHeight + 2 * left.rowHeight + left.footerHeight);
  });
});
