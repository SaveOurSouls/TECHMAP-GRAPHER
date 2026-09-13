import { describe, expect, it } from "vitest";
import { applyEditorCommand, createConnector, createWire } from "./commands";
import { createEditorHistory, executeEditorCommand, redoEditorCommand, undoEditorCommand } from "./history";
import { builtInConnectorSeries, createBuiltInConnectorInstance } from "./connector-series-demo";
import { selectConnectorSeriesArticle } from "./connector-series";
import {
  connectorContactPosition,
  connectorE4TableGeometry,
  createJunctionEndpoint,
  createOrthogonalE4Route,
  createEmptyHarnessDesign,
  parseHarnessDesignDocument,
  validateOrthogonalE4Route,
  wireE4PathContainsPoint,
} from "./model";

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

  it("applies a series article atomically and protects its deterministic rows", () => {
    const connector = createBuiltInConnectorInstance("catalog-connector-series:xs-demo-series", {
      id: "xs1", designation: "XS1", e4Position: { x: 0, y: 0 },
    });
    let document = applyEditorCommand(createEmptyHarnessDesign(), { type: "add-connector", connector });
    const selected = selectConnectorSeriesArticle(connector, builtInConnectorSeries[0]!, "XS-10").connector;
    document = applyEditorCommand(document, {
      type: "apply-connector-article",
      connectorId: connector.id,
      partNumber: selected.partNumber,
      contacts: selected.contacts,
      libraryBinding: selected.libraryBinding,
    });
    expect(document.connectors[0]).toMatchObject({
      partNumber: "XS-10",
      libraryBinding: { mode: "series", seriesId: "xs-demo-series", partNumber: "XS-10" },
    });
    expect(document.connectors[0]?.contacts).toHaveLength(10);
    expect(() => applyEditorCommand(document, {
      type: "update-contact", connectorId: "xs1", contactId: "xs1:contact:signal:1", number: 99,
    })).toThrow(/определяются выбранным артикулом/);
    expect(() => applyEditorCommand(document, {
      type: "remove-contact", connectorId: "xs1", contactId: "xs1:contact:signal:1",
    })).toThrow(/определяются выбранным артикулом/);
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
      wires: [(() => {
        const { e4Route: _e4Route, ...wire } = createWire("w1", { connectorId: "x1", contactId: "x1:contact:1" }, { connectorId: "x2", contactId: "x2:contact:1" });
        return wire;
      })()],
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

  it("creates and validates orthogonal E4 routes with 24-unit contact leads", () => {
    const start = { position: { x: 100, y: 50 }, leadDirection: "right" as const };
    const end = { position: { x: 300, y: 90 }, leadDirection: "left" as const };
    const route = createOrthogonalE4Route(start, end);
    expect(route[0]).toEqual({ x: 124, y: 50 });
    expect(route.at(-1)).toEqual({ x: 276, y: 90 });
    expect(() => validateOrthogonalE4Route(start, route, end)).not.toThrow();
    expect(() => validateOrthogonalE4Route(start, [{ x: 110, y: 50 }, { x: 300, y: 90 }], end)).toThrow(/ортогональных|прямой участок/);
  });

  it("stores, moves segments and repairs E4 routes after connector movement", () => {
    let document = connectionDocument();
    document = applyEditorCommand(document, {
      type: "set-e4-wire-route", wireId: "w1",
      route: [{ x: 648, y: 64 }, { x: 700, y: 64 }, { x: 700, y: 120 }, { x: 900, y: 120 }, { x: 900, y: 64 }, { x: 976, y: 64 }],
    });
    document = applyEditorCommand(document, {
      type: "move-e4-wire-segment", wireId: "w1", segmentIndex: 2, position: { x: 760, y: 0 },
    });
    expect(document.wires.find((wire) => wire.id === "w1")?.e4Route.slice(1, 3)).toEqual([
      { x: 760, y: 64 }, { x: 760, y: 120 },
    ]);
    document = applyEditorCommand(document, {
      type: "move-connector", connectorId: "x1", view: "e4", position: { x: 0, y: 200 },
    });
    const wire = document.wires.find((item) => item.id === "w1")!;
    expect(() => validateOrthogonalE4Route(
      { position: connectorContactPosition(document.connectors[0]!, "x1:contact:1", "e4")!, leadDirection: "right" },
      wire.e4Route,
      { position: connectorContactPosition(document.connectors[1]!, "x2:contact:1", "e4")!, leadDirection: "left" },
    )).not.toThrow();
  });

  it("moves junctions attached to a dragged internal segment and reroutes their branches", () => {
    let document = connectionDocument();
    document = applyEditorCommand(document, {
      type: "set-e4-wire-route", wireId: "w1",
      route: [{ x: 648, y: 64 }, { x: 700, y: 64 }, { x: 700, y: 120 }, { x: 900, y: 120 }, { x: 900, y: 64 }, { x: 976, y: 64 }],
    });
    document = applyEditorCommand(document, {
      type: "create-junction",
      junction: { id: "j1", position: { x: 800, y: 120 }, wireIds: ["w1", "w3"] },
      branchWire: {
        ...createWire("w3", { connectorId: "x1", contactId: "x1:contact:3" }, createJunctionEndpoint("j1"), 100, "NET-A"),
        e4Route: [{ x: 648, y: 112 }, { x: 800, y: 112 }],
      },
    });

    document = applyEditorCommand(document, {
      type: "move-e4-wire-segment", wireId: "w1", segmentIndex: 3, position: { x: 0, y: 160 },
    });

    expect(document.junctions[0]?.position).toEqual({ x: 800, y: 160 });
    expect(wireE4PathContainsPoint(document, document.wires.find((wire) => wire.id === "w1")!, { x: 800, y: 160 })).toBe(true);
    expect(wireE4PathContainsPoint(document, document.wires.find((wire) => wire.id === "w3")!, { x: 800, y: 160 })).toBe(true);
  });

  it("rebuilds connected E4 wires after flipping a connector", () => {
    let document = connectionDocument();
    const before = document.wires.find((wire) => wire.id === "w1")!.e4Route;
    document = applyEditorCommand(document, { type: "flip-connector-orientation", connectorId: "x1" });
    const wire = document.wires.find((item) => item.id === "w1")!;
    expect(wire.e4Route).not.toEqual(before);
    expect(() => validateOrthogonalE4Route(
      { position: connectorContactPosition(document.connectors[0]!, "x1:contact:1", "e4")!, leadDirection: "left" },
      wire.e4Route,
      { position: connectorContactPosition(document.connectors[1]!, "x2:contact:1", "e4")!, leadDirection: "left" },
    )).not.toThrow();
  });

  it("rebuilds connected E4 wires after table width and contact row changes", () => {
    let document = connectionDocument();
    document = applyEditorCommand(document, {
      type: "add-custom-field", connectorId: "x1", field: { id: "note", label: "Примечание", visible: true },
    });
    document = applyEditorCommand(document, {
      type: "toggle-base-column-visibility", connectorId: "x1", key: "color",
    });
    let wire = document.wires.find((item) => item.id === "w2")!;
    expect(() => validateOrthogonalE4Route(
      { position: connectorContactPosition(document.connectors[0]!, "x1:contact:2", "e4")!, leadDirection: "right" },
      wire.e4Route,
      { position: connectorContactPosition(document.connectors[1]!, "x2:contact:2", "e4")!, leadDirection: "left" },
    )).not.toThrow();

    document = applyEditorCommand(document, { type: "remove-wire", wireId: "w1" });
    document = applyEditorCommand(document, { type: "remove-contact", connectorId: "x1", contactId: "x1:contact:1" });
    wire = document.wires.find((item) => item.id === "w2")!;
    expect(connectorContactPosition(document.connectors[0]!, "x1:contact:2", "e4")?.y).toBe(64);
    expect(() => validateOrthogonalE4Route(
      { position: connectorContactPosition(document.connectors[0]!, "x1:contact:2", "e4")!, leadDirection: "right" },
      wire.e4Route,
      { position: connectorContactPosition(document.connectors[1]!, "x2:contact:2", "e4")!, leadDirection: "left" },
    )).not.toThrow();
  });

  it("manages crossing style, differential pairs and screens and cleans them on wire removal", () => {
    let document = connectionDocument();
    document = applyEditorCommand(document, { type: "set-wire-crossing-style", view: "e4", style: "bridge" });
    document = applyEditorCommand(document, {
      type: "update-layer", view: "e4", layerId: "wires", visible: false,
    });
    document = applyEditorCommand(document, {
      type: "create-diff-pair", group: { id: "dp1", wireIds: ["w1", "w2"], step: 12, amplitude: 4, variant: 1 },
    });
    document = applyEditorCommand(document, {
      type: "update-diff-pair", groupId: "dp1", variant: 2, step: 16,
    });
    document = applyEditorCommand(document, {
      type: "create-screen", screen: { id: "s1", wireIds: ["w1", "w2"], position: 0.4, label: "SH1", width: 30 },
    });
    document = applyEditorCommand(document, {
      type: "update-screen", screenId: "s1", position: 0.6, label: "SH-A",
    });
    expect(document.views.e4.wireCrossingStyle).toBe("bridge");
    expect(document.diffPairs[0]).toMatchObject({ variant: 2, step: 16 });
    expect(document.screens[0]).toMatchObject({ position: 0.6, label: "SH-A" });
    document = applyEditorCommand(document, { type: "remove-wire", wireId: "w1" });
    expect(document.diffPairs).toHaveLength(0);
    expect(document.screens[0]?.wireIds).toEqual(["w2"]);
  });

  it("rejects differential-pair and screen groups that have no visible common parallel span", () => {
    let document = connectionDocument();
    document = applyEditorCommand(document, {
      type: "add-connector", connector: createConnector("x3", "X3", 1, { x: 2000, y: 300 }),
    });
    document = applyEditorCommand(document, {
      type: "add-connector", connector: createConnector("x4", "X4", 1, { x: 3000, y: 300 }),
    });
    document = applyEditorCommand(document, { type: "flip-connector-orientation", connectorId: "x4" });
    document = applyEditorCommand(document, {
      type: "add-wire",
      wire: createWire("w3", { connectorId: "x3", contactId: "x3:contact:1" }, { connectorId: "x4", contactId: "x4:contact:1" }),
    });

    expect(() => applyEditorCommand(document, {
      type: "create-diff-pair", group: { id: "dp-hidden", wireIds: ["w1", "w3"], step: 12, amplitude: 4, variant: 1 },
    })).toThrow(/общего параллельного участка/);
    expect(() => applyEditorCommand(document, {
      type: "create-screen", screen: { id: "s-hidden", wireIds: ["w1", "w3"], position: 0.5, label: "SH", width: 30 },
    })).toThrow(/общего параллельного участка/);
  });

  it("defaults legacy differential pair variant to the first visual style", () => {
    const current = connectionDocument();
    const parsed = parseHarnessDesignDocument({
      ...current,
      diffPairs: [{ id: "dp-legacy", wireIds: ["w1", "w2"], step: 10, amplitude: 3 }],
    });
    expect(parsed.diffPairs[0]?.variant).toBe(1);
    expect(() => parseHarnessDesignDocument({
      ...current,
      diffPairs: [{ id: "dp-bad", wireIds: ["w1", "w2"], step: 10, amplitude: 3, variant: 3 }],
    })).toThrow(/Вид дифференциальной пары/);
  });

  it("creates an atomic T junction without splitting the target wire and unifies its circuit", () => {
    let document = connectionDocument();
    const branch = {
      ...createWire("w3", { connectorId: "x1", contactId: "x1:contact:3" }, createJunctionEndpoint("j1"), 100, ""),
      e4Route: [{ x: 648, y: 112 }, { x: 700, y: 112 }],
    };
    document = applyEditorCommand(document, {
      type: "create-junction",
      junction: { id: "j1", position: { x: 700, y: 64 }, wireIds: ["w1", "w3"] },
      branchWire: branch,
    });
    expect(document.wires.find((wire) => wire.id === "w1")?.to).toEqual({ connectorId: "x2", contactId: "x2:contact:1" });
    expect(document.wires.find((wire) => wire.id === "w3")?.circuit).toBe("NET-A");
    document = applyEditorCommand(document, { type: "move-junction", junctionId: "j1", position: { x: 740, y: 120 } });
    expect(wireE4PathContainsPoint(document, document.wires.find((wire) => wire.id === "w1")!, { x: 740, y: 120 })).toBe(true);
    expect(() => applyEditorCommand(document, { type: "remove-junction", junctionId: "j1" })).toThrow(/ветвь/);
  });

  it("atomically reconnects a wire endpoint to a point on another wire", () => {
    let document = connectionDocument();
    document = applyEditorCommand(document, {
      type: "add-wire",
      wire: createWire("w3", { connectorId: "x1", contactId: "x1:contact:3" }, { connectorId: "x2", contactId: "x2:contact:3" }, 100, "NET-A"),
    });
    document = applyEditorCommand(document, {
      type: "connect-wire-to-wire", wireId: "w3", end: "to", targetWireId: "w1", junctionId: "j1", position: { x: 700, y: 64 },
    });
    expect(document.junctions[0]).toMatchObject({ id: "j1", wireIds: ["w1", "w3"] });
    expect(document.wires.find((wire) => wire.id === "w3")?.to).toMatchObject({ junctionId: "j1" });
    document = applyEditorCommand(document, {
      type: "add-wire",
      wire: createWire("w4", { connectorId: "x1", contactId: "x1:contact:2" }, createJunctionEndpoint("j1"), 100, ""),
    });
    expect(document.junctions[0]?.wireIds).toEqual(["w1", "w3", "w4"]);
    expect(document.wires.find((wire) => wire.id === "w4")?.circuit).toBe("NET-A");
    expect(() => applyEditorCommand(document, {
      type: "connect-wire-to-wire", wireId: "w2", end: "to", targetWireId: "w1", junctionId: "j2", position: { x: 750, y: 64 },
    })).toThrow(/разными непустыми/);
  });

  it("adds the selected target wire to an existing junction at the same coordinate", () => {
    let document = connectionDocument();
    document = applyEditorCommand(document, {
      type: "add-wire",
      wire: createWire("w3", { connectorId: "x1", contactId: "x1:contact:3" }, { connectorId: "x2", contactId: "x2:contact:3" }, 100, "NET-A"),
    });
    document = applyEditorCommand(document, {
      type: "connect-wire-to-wire", wireId: "w3", end: "to", targetWireId: "w1", junctionId: "j1", position: { x: 700, y: 64 },
    });
    document = applyEditorCommand(document, {
      type: "add-wire",
      wire: {
        ...createWire("w4", { connectorId: "x1", contactId: "x1:contact:1" }, { connectorId: "x2", contactId: "x2:contact:1" }, 100, "NET-A"),
        e4Route: document.wires.find((wire) => wire.id === "w1")!.e4Route,
      },
    });
    document = applyEditorCommand(document, { type: "update-wire", wireId: "w2", circuit: "" });

    document = applyEditorCommand(document, {
      type: "connect-wire-to-wire", wireId: "w2", end: "to", targetWireId: "w4", junctionId: "j1", position: { x: 700, y: 64 },
    });

    expect(document.junctions.find((junction) => junction.id === "j1")?.wireIds).toEqual(["w1", "w3", "w4", "w2"]);
    expect(document.wires.find((wire) => wire.id === "w2")?.to).toMatchObject({ junctionId: "j1" });
  });

  it("adds a new branch and its selected target wire to an existing junction atomically", () => {
    let document = connectionDocument();
    document = applyEditorCommand(document, {
      type: "add-wire",
      wire: createWire("w3", { connectorId: "x1", contactId: "x1:contact:3" }, { connectorId: "x2", contactId: "x2:contact:3" }, 100, "NET-A"),
    });
    document = applyEditorCommand(document, {
      type: "connect-wire-to-wire", wireId: "w3", end: "to", targetWireId: "w1", junctionId: "j1", position: { x: 700, y: 64 },
    });
    document = applyEditorCommand(document, {
      type: "add-wire",
      wire: {
        ...createWire("w4", { connectorId: "x1", contactId: "x1:contact:1" }, { connectorId: "x2", contactId: "x2:contact:1" }, 100, "NET-A"),
        e4Route: document.wires.find((wire) => wire.id === "w1")!.e4Route,
      },
    });
    document = applyEditorCommand(document, {
      type: "add-wire",
      targetWireId: "w4",
      wire: {
        ...createWire("w5", { connectorId: "x1", contactId: "x1:contact:2" }, createJunctionEndpoint("j1"), 100, "NET-A"),
        e4Route: [{ x: 648, y: 88 }, { x: 700, y: 88 }],
      },
    });

    expect(document.junctions.find((junction) => junction.id === "j1")?.wireIds).toEqual(["w1", "w3", "w5", "w4"]);
    expect(document.wires.find((wire) => wire.id === "w5")?.to).toMatchObject({ junctionId: "j1" });
  });

  it("reroutes connector and junction endpoint changes as valid E4 paths", () => {
    let document = connectionDocument();
    document = applyEditorCommand(document, {
      type: "reconnect-wire", wireId: "w1", end: "to", endpoint: { connectorId: "x2", contactId: "x2:contact:3" },
    });
    let wire = document.wires.find((item) => item.id === "w1")!;
    expect(() => validateOrthogonalE4Route(
      { position: connectorContactPosition(document.connectors[0]!, "x1:contact:1", "e4")!, leadDirection: "right" },
      wire.e4Route,
      { position: connectorContactPosition(document.connectors[1]!, "x2:contact:3", "e4")!, leadDirection: "left" },
    )).not.toThrow();

    document = applyEditorCommand(document, {
      type: "add-wire",
      wire: createWire("w3", { connectorId: "x1", contactId: "x1:contact:3" }, { connectorId: "x2", contactId: "x2:contact:2" }, 100, "NET-A"),
    });
    document = applyEditorCommand(document, {
      type: "connect-wire-to-wire", wireId: "w3", end: "to", targetWireId: "w1", junctionId: "j1", position: { x: 700, y: 64 },
    });
    wire = document.wires.find((item) => item.id === "w3")!;
    expect(() => validateOrthogonalE4Route(
      { position: connectorContactPosition(document.connectors[0]!, "x1:contact:3", "e4")!, leadDirection: "right" },
      wire.e4Route,
      { position: { x: 700, y: 64 }, leadDirection: null },
    )).not.toThrow();
  });

  it("parses schema version 1 connection documents with safe defaults", () => {
    const current = connectionDocument();
    const legacy = {
      schemaVersion: 1,
      connectors: current.connectors,
      wires: current.wires.map(({ e4Route: _route, ...wire }) => wire),
      views: {
        e4: { layers: current.views.e4.layers },
        drawing: { layers: current.views.drawing.layers },
      },
    };
    const parsed = parseHarnessDesignDocument(legacy);
    expect(parsed.wires.every((wire) => wire.e4Route.length >= 2)).toBe(true);
    const parsedFirst = parsed.wires[0]!;
    expect(() => validateOrthogonalE4Route(
      { position: connectorContactPosition(parsed.connectors[0]!, "x1:contact:1", "e4")!, leadDirection: "right" },
      parsedFirst.e4Route,
      { position: connectorContactPosition(parsed.connectors[1]!, "x2:contact:1", "e4")!, leadDirection: "left" },
    )).not.toThrow();
    expect(parsed.junctions).toEqual([]);
    expect(parsed.diffPairs).toEqual([]);
    expect(parsed.screens).toEqual([]);
    expect(parsed.views.e4.wireCrossingStyle).toBe("none");
  });
});

function connectionDocument() {
  let document = createEmptyHarnessDesign();
  document = applyEditorCommand(document, {
    type: "add-connector", connector: createConnector("x1", "X1", 3, { x: 0, y: 0 }),
  });
  document = applyEditorCommand(document, {
    type: "add-connector", connector: createConnector("x2", "X2", 3, { x: 1000, y: 0 }),
  });
  document = applyEditorCommand(document, { type: "flip-connector-orientation", connectorId: "x2" });
  document = applyEditorCommand(document, {
    type: "add-wire", wire: createWire("w1", { connectorId: "x1", contactId: "x1:contact:1" }, { connectorId: "x2", contactId: "x2:contact:1" }, 100, "NET-A"),
  });
  document = applyEditorCommand(document, {
    type: "add-wire", wire: createWire("w2", { connectorId: "x1", contactId: "x1:contact:2" }, { connectorId: "x2", contactId: "x2:contact:2" }, 100, "NET-B"),
  });
  document = applyEditorCommand(document, { type: "set-e4-wire-route", wireId: "w1", route: [{ x: 648, y: 64 }, { x: 976, y: 64 }] });
  document = applyEditorCommand(document, { type: "set-e4-wire-route", wireId: "w2", route: [{ x: 648, y: 88 }, { x: 976, y: 88 }] });
  return document;
}
