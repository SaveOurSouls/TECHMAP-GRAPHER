// @ts-expect-error Node-only source contract; browser tsconfig intentionally excludes Node types.
import { readFileSync } from "node:fs";
// @ts-expect-error Node-only source contract; browser tsconfig intentionally excludes Node types.
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BUILTIN_TERMINATION_RECORDS, createTerminationPlacement } from "../termination-library";
import { applyEditorCommand, createConnector, createWire, e4RoutingIssues } from "./commands";
import { createEmptyHarnessDesign, createOrthogonalE4Route, parseHarnessDesignDocument, wireEndpointE4Anchor } from "./model";

const record = (assetId: string) => {
  const found = BUILTIN_TERMINATION_RECORDS.find((item) => item.assetId === assetId);
  if (!found) throw new Error(`Не найден встроенный символ ${assetId}.`);
  return found;
};

function terminationDocument(assetId: string) {
  const placement = createTerminationPlacement(record(assetId), {
    id: "termination",
    designation: "T1",
    position: { x: 80, y: 100 },
  });
  return {
    placement,
    document: applyEditorCommand(createEmptyHarnessDesign(), {
      type: "add-termination-component",
      ...placement,
    }),
  };
}

function addFanout(
  assetId: string,
  count: number,
  direction: "from" | "to",
  contactIndex = 0,
) {
  const { placement, document: initial } = terminationDocument(assetId);
  const contact = placement.connector.contacts[contactIndex]!;
  let document = initial;
  for (let index = 0; index < count; index += 1) {
    const connector = createConnector(`ordinary-${index}`, `X${index + 1}`, 1, {
      x: 650,
      y: 40 + index * 150,
    });
    document = applyEditorCommand(document, { type: "add-connector", connector });
    const ordinaryContact = { connectorId: connector.id, contactId: connector.contacts[0]!.id };
    const terminalContact = { connectorId: placement.connector.id, contactId: contact.id };
    const endpoints = direction === "from"
      ? createWire(`wire-${index}`, terminalContact, ordinaryContact, 100)
      : createWire(`wire-${index}`, ordinaryContact, terminalContact, 100);
    document = applyEditorCommand(document, { type: "add-wire", wire: endpoints });
  }
  return document;
}

describe("E4 routing to termination components", () => {
  it("keeps newly connected UI wires route-free until the command router runs", () => {
    const source = readFileSync(resolve("src/editor/useHarnessDesignEditor.tsx"), "utf8") + "\n" +
      readFileSync(resolve("src/editor/HarnessDesignEditorSurface.tsx"), "utf8");
    const start = source.indexOf("const createRoutedWire =");
    const end = source.indexOf("const selectedWireIds =", start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const factory = source.slice(start, end);
    expect(factory).toContain("return wire;");
    expect(factory).not.toMatch(/e4Route\s*:/);
    expect(source).toContain("wire: createRoutedWire(id, fromEndpoint, toEndpoint)");

    const branchStart = source.indexOf("onWireConnectToWire={(from, targetWireId, point) => {");
    const branchEnd = source.indexOf("onWireReconnectToWire=", branchStart);
    expect(branchStart).toBeGreaterThanOrEqual(0);
    expect(branchEnd).toBeGreaterThan(branchStart);
    const branchHandler = source.slice(branchStart, branchEnd);
    expect(branchHandler).not.toMatch(/e4Route\s*:/);
    expect(branchHandler).toContain('type: "add-wire"');
    expect(branchHandler).toContain('type: "create-junction"');
  });

  it.each([2, 3, 4, 7])("routes %i wires in both directions to a terminal and ordinary connector", (count) => {
    for (const direction of ["from", "to"] as const) {
      const document = addFanout("nki-ring", count, direction);
      expect(document.wires).toHaveLength(count);
      const parsed = parseHarnessDesignDocument(JSON.parse(JSON.stringify(document)));
      expect(parsed.wires.map((wire) => wire.e4Route)).toEqual(document.wires.map((wire) => wire.e4Route));
    }
  }, 15000);

  it.each([2, 3, 4, 7])("routes %i wires to one ordinary connector contact", (count) => {
    for (const direction of ["from", "to"] as const) {
      let document = createEmptyHarnessDesign();
      const hub = createConnector("ordinary-hub", "X1", 1, { x: 650, y: 250 });
      document = applyEditorCommand(document, { type: "add-connector", connector: hub });
      for (let index = 0; index < count; index += 1) {
        const placement = createTerminationPlacement(record("nki-ring"), {
          id: `terminal-${index}`,
          designation: `T${index + 1}`,
          position: { x: 60, y: 90 + index * 120 },
        });
        document = applyEditorCommand(document, { type: "add-termination-component", ...placement });
        const ordinaryContact = { connectorId: hub.id, contactId: hub.contacts[0]!.id };
        const terminalContact = { connectorId: placement.connector.id, contactId: placement.connector.contacts[0]!.id };
        const endpoints = direction === "from"
          ? createWire(`wire-${index}`, ordinaryContact, terminalContact, 100)
          : createWire(`wire-${index}`, terminalContact, ordinaryContact, 100);
        document = applyEditorCommand(document, {
          type: "add-wire",
          wire: endpoints,
        });
      }
      expect(document.wires).toHaveLength(count);
      const parsed = parseHarnessDesignDocument(JSON.parse(JSON.stringify(document)));
      expect(parsed.wires.map((wire) => wire.e4Route)).toEqual(document.wires.map((wire) => wire.e4Route));
    }
  });

  it.each(["preparation-none", "preparation-copper", "preparation-tinned-copper"])(
    "routes 2/3/4 wires to free-end preparation %s without weakening other obstacles",
    (assetId) => {
      for (const count of [2, 3, 4]) {
        for (const direction of ["from", "to"] as const) {
          const document = addFanout(assetId, count, direction);
          expect(document.wires).toHaveLength(count);
          expect(() => parseHarnessDesignDocument(JSON.parse(JSON.stringify(document)))).not.toThrow();
        }
      }
    },
  );

  it.each([0, 1])("routes 2/3/4 wires to sleeve port %i independently", (contactIndex) => {
    for (const count of [2, 3, 4]) {
      for (const direction of ["from", "to"] as const) {
        const document = addFanout("sleeve-insulated", count, direction, contactIndex);
        expect(document.wires).toHaveLength(count);
        expect(() => parseHarnessDesignDocument(JSON.parse(JSON.stringify(document)))).not.toThrow();
      }
    }
  });

  it("reconnects an existing wire to a terminal from either endpoint", () => {
    for (const end of ["from", "to"] as const) {
      const { placement, document: initial } = terminationDocument("nki-ring");
      const connector = createConnector("ordinary", "X1", 1, { x: 650, y: 100 });
      const otherConnector = createConnector("other", "X2", 1, { x: 650, y: 300 });
      let document = applyEditorCommand(initial, { type: "add-connector", connector });
      document = applyEditorCommand(document, { type: "add-connector", connector: otherConnector });
      document = applyEditorCommand(document, {
        type: "add-wire",
        wire: createWire("wire", { connectorId: connector.id, contactId: connector.contacts[0]!.id },
          { connectorId: otherConnector.id, contactId: otherConnector.contacts[0]!.id }, 100),
      });
      const endpoint = { connectorId: placement.connector.id, contactId: placement.connector.contacts[0]!.id };
      document = applyEditorCommand(document, { type: "reconnect-wire", wireId: "wire", end, endpoint });
      expect(document.wires[0]![end]).toEqual(endpoint);
      expect(() => parseHarnessDesignDocument(JSON.parse(JSON.stringify(document)))).not.toThrow();
    }
  });

  it("keeps a multi-wire terminal bundle connected and reroutes it when the component moves", () => {
    const before = addFanout("nki-ring", 4, "from");
    const endpoints = before.wires.map(({ id, from, to }) => ({ id, from, to }));
    const moved = applyEditorCommand(before, {
      type: "move-connector",
      connectorId: "termination",
      view: "e4",
      position: { x: 240, y: 340 },
    });

    expect(moved.wires.map(({ id, from, to }) => ({ id, from, to }))).toEqual(endpoints);
    expect(moved.wires.every((wire) => wire.e4RouteMode === "auto")).toBe(true);
    expect(moved.wires.map((wire) => wire.e4Route)).not.toEqual(before.wires.map((wire) => wire.e4Route));
    const parsed = parseHarnessDesignDocument(JSON.parse(JSON.stringify(moved)));
    expect(parsed.wires.map((wire) => wire.e4Route)).toEqual(moved.wires.map((wire) => wire.e4Route));
  });

  it("reroutes automatic preparation wires after a carry drag before another termination is added", () => {
    const placement = createTerminationPlacement(record("preparation-none"), {
      id: "preparation",
      designation: "Р1",
      position: { x: 584, y: 12 },
    });
    const ordinary = createConnector("x1", "X1", 1, { x: 543, y: 184 });
    let document = applyEditorCommand(createEmptyHarnessDesign(), {
      type: "add-termination-component",
      ...placement,
    });
    document = applyEditorCommand(document, { type: "add-connector", connector: ordinary });
    const ordinaryContact = { connectorId: ordinary.id, contactId: ordinary.contacts[0]!.id };
    const prepContact = { connectorId: placement.connector.id, contactId: placement.connector.contacts[0]!.id };
    for (let index = 0; index < 4; index += 1) {
      document = applyEditorCommand(document, {
        type: "add-wire",
        wire: createWire(`wire-${index}`, ordinaryContact, prepContact, 100),
      });
    }
    const wireStates = document.wires.map(({ id, from, to, lengthMm }) => ({ id, from, to, lengthMm }));
    const moved = applyEditorCommand(document, {
      type: "move-connector",
      connectorId: placement.connector.id,
      view: "e4",
      position: { x: 631, y: 92 },
      physicalDragMode: "carry",
    });
    expect(moved.wires.map(({ id, from, to, lengthMm }) => ({ id, from, to, lengthMm }))).toEqual(wireStates);
    expect(moved.wires.every((wire) => wire.e4RouteMode === "auto")).toBe(true);
    expect(e4RoutingIssues(moved)).toEqual([]);

    const next = createTerminationPlacement(record("nki-ring"), {
      id: "next-terminal",
      designation: "T1",
      position: { x: 800, y: 300 },
    });
    expect(() => applyEditorCommand(moved, { type: "add-termination-component", ...next })).not.toThrow();
  });

  it("still rejects an intentionally manual route through the termination obstacle", () => {
    const { placement, document } = terminationDocument("nki-ring");
    const connector = createConnector("ordinary", "X1", 1, { x: 650, y: 100 });
    const withConnector = applyEditorCommand(document, { type: "add-connector", connector });
    const from = { connectorId: placement.connector.id, contactId: placement.connector.contacts[0]!.id };
    const to = { connectorId: connector.id, contactId: connector.contacts[0]!.id };
    const wire = createWire("manual-wire", from, to, 100);
    const start = wireEndpointE4Anchor(withConnector, wire.from)!;
    const end = wireEndpointE4Anchor(withConnector, wire.to)!;
    const route = createOrthogonalE4Route(start, end);
    expect(() => applyEditorCommand(withConnector, {
      type: "add-wire",
      wire: { ...wire, e4Route: route, e4RouteMode: "manual" },
    })).toThrow(/Маршрут проходит через препятствие termination/);
  });
});
