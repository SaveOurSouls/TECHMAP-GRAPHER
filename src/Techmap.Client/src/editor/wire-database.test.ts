import { describe, expect, it } from "vitest";
import { formatWireSection, wireDatabaseOption, filterWireOptions } from "./wire-database";
import { createBuiltInConnectorInstance } from "./connector-series-demo";
import { createEmptyHarnessDesign, parseHarnessDesignDocument, connectorContactPosition, createOrthogonalE4Route, wireEndpointE4Anchor } from "./model";
import { createWire } from "./commands";
import { createEditorHistory, executeEditorCommand, undoEditorCommand } from "./history";
import { designToScene } from "./HarnessDesignEditor";
import { getE4ConnectorLayout } from "./CanvasViewport";

describe("wire database", () => {
  it.each(["1C", "1С", " 1 с "])("shows only the core section for %s", Core => {
    expect(formatWireSection({ Core, "Сечение C": "0,35", Pair: "2P", "Сечение P": "0,12" })).toBe("0,35");
  });
  it("combines core and pair sections without adding assumed units", () => {
    expect(formatWireSection({ Core: "3C", "Сечение C": 0.5, Pair: "2P", "Сечение P": "0,22" })).toBe("3C x 0,5 / 2P x 0,22");
    expect(formatWireSection({ Core: "2С", "Сечение C": "24AWG" })).toBe("2С x 24AWG");
    expect(formatWireSection({ Core: "0C", Pair: "2P", "Сечение P": 0.12 })).toBe("2P x 0,12");
    expect(formatWireSection({ Core: "3C", "Сечение C": "0,5", Pair: "0P", "Сечение P": "0" })).toBe("3C x 0,5");
  });
  it("keeps variants searchable by all imported characteristics", () => {
    const red = wireDatabaseOption({ recordId: "red", sourceLocation: null, entityType: "wire", sourceKey: "key1", payload: {
      Марка: "TEST", Core: "1C", "Сечение C": 0.35, Цвет: "красный", Артикул: "0007",
    } });
    const blue = wireDatabaseOption({ ...{ recordId: "blue", sourceLocation: null, entityType: "wire", sourceKey: "key2" }, payload: {
      Марка: "TEST", Core: "3C", "Сечение C": 0.5, Цвет: "синий",
    } });
    expect(red.mark).toBe("TEST");
    expect(red.section).toBe("0,35");
    expect(red.detail).toContain("Артикул: 0007");
    expect(filterWireOptions([red, blue], "TEST 0.35 красный")).toEqual([red]);
  });
  it("roundtrips both fields, renders them on canvas and undoes the selection together", () => {
    const connector = createBuiltInConnectorInstance("catalog-connector-free", {
      id: "wire-test", designation: "X1", e4Position: { x: 0, y: 0 }, freeContactCount: 1,
    });
    const legacy = { ...createEmptyHarnessDesign(), connectors: [{ ...connector,
      contacts: connector.contacts.map(contact => ({ ...contact, wire: "legacy full text" })),
      schematic: { ...connector.schematic, baseColumns: connector.schematic.baseColumns.filter(c => c.key !== "wireSection") },
    }] };
    const parsed = parseHarnessDesignDocument(JSON.parse(JSON.stringify(legacy)));
    expect(parsed.connectors[0]!.contacts[0]!.wire).toBe("legacy full text");
    expect(parsed.connectors[0]!.schematic.baseColumns.find(c => c.key === "wireSection")?.visible).toBe(true);
    const history = executeEditorCommand(createEditorHistory(parsed), { type: "update-contact", connectorId: connector.id,
      contactId: connector.contacts[0]!.id, wire: "TEST", wireSection: "3C x 0,5 / 2P x 0,22" });
    const restored = parseHarnessDesignDocument(JSON.parse(JSON.stringify(history.present)));
    expect(restored.connectors[0]!.contacts[0]).toMatchObject({ wire: "TEST", wireSection: "3C x 0,5 / 2P x 0,22" });
    const scene = designToScene(restored, "e4");
    expect(JSON.stringify(scene)).toContain("wireSection");
    expect(getE4ConnectorLayout(scene.find(o => o.id === connector.id)!)?.columns.map(c => c.label)).toEqual(expect.arrayContaining(["Марка", "Сечение"]));
    expect(undoEditorCommand(history).present.connectors[0]!.contacts[0]!.wire).toBe("legacy full text");
  });
  it("opens legacy manual routes with the same contact coordinates and does not shift again", () => {
    const connectors = [0, 1200].map((x, i) => {
      const connector = createBuiltInConnectorInstance("catalog-connector-free", {
        id: `x${i}`, designation: `X${i}`, e4Position: { x, y: 0 }, freeContactCount: 1,
      });
      return { ...connector, schematic: { ...connector.schematic, baseColumns: connector.schematic.baseColumns.filter(c => c.key !== "wireSection") } };
    });
    let legacy = { ...createEmptyHarnessDesign(), connectors };
    const wire = createWire("w1", { connectorId: "x0", contactId: connectors[0]!.contacts[0]!.id }, { connectorId: "x1", contactId: connectors[1]!.contacts[0]!.id });
    legacy = { ...legacy, wires: [{ ...wire, e4Route: createOrthogonalE4Route(wireEndpointE4Anchor(legacy, wire.from)!, wireEndpointE4Anchor(legacy, wire.to)!), e4RouteMode: "manual" }] };
    const parsed = parseHarnessDesignDocument(JSON.parse(JSON.stringify(legacy)));
    parsed.connectors.forEach((connector, i) => expect(connectorContactPosition(connector, connector.contacts[0]!.id, "e4"))
      .toEqual(connectorContactPosition(connectors[i]!, connector.contacts[0]!.id, "e4")));
    expect(parsed.wires[0]!.e4Route).toEqual(legacy.wires[0]!.e4Route);
    expect(parseHarnessDesignDocument(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
  });
});
