import { describe, expect, it } from "vitest";
import { createConnector, createWire } from "./commands";
import { createEmptyHarnessDesign, createOrthogonalE4Route, findWireEndpoint, parseHarnessDesignDocument,
  wireEndpointE4Anchor, type HarnessDesignDocument } from "./model";
import { coveringScene, moveCovering } from "./covering-layout";
import { coveringGrips, coveringSurfaces } from "./covering-renderer";
import { physicalWireDisplay } from "./physical-wire-geometry";

function fixture(): HarnessDesignDocument {
  const connectors = [createConnector("A", "XS1", 16, { x: 0, y: 0 }), createConnector("B", "XS2", 8, { x: 900, y: 0 })];
  const wires = [1, 2, 7, 8, 12, 13, 16].map((contact, i) => createWire(`W${i}`,
    { connectorId: "A", contactId: `A:contact:${contact}` }, { connectorId: "B", contactId: `B:contact:${i + 1}` }, 420 + i));
  const base = { ...createEmptyHarnessDesign(), connectors, wires };
  return { ...base, wires: wires.map(wire => ({ ...wire,
    e4Route: createOrthogonalE4Route(wireEndpointE4Anchor(base, wire.from)!, wireEndpointE4Anchor(base, wire.to)!),
  })), physicalTopology: { snap: false, nodes: [
    { id: "a", connectorId: "A", position: { x: 395, y: 260 } },
    { id: "b", connectorId: "B", position: { x: -100, y: 260 } },
  ], segments: [
    { id: "pipe", from: "a", to: "b", path: { kind: "polyline", points: [] } },
    { id: "other", from: "a", to: "b", path: { kind: "polyline", points: [{ x: 700, y: 400 }] } },
  ], routes: wires.map((wire, i) => ({ wireId: wire.id, steps: [{ segmentId: i < 4 ? "pipe" : "other", reverse: false }] })),
  coverings: [{ id: "tube", name: "ТУ2", kind: "heat-shrink", width: 0, color: "#424c53", lengthMm: 70,
    style: { texture: "Rubber002", textureScale: 1.5, textureRotation: 20 },
    spans: [{ segmentId: "pipe", from: -.18, to: .04 }] }],
  } };
}

function display(document: HarnessDesignDocument, id: string) {
  const wire = document.wires.find(w => w.id === id)!;
  return physicalWireDisplay(document, id, findWireEndpoint(document, wire.from, "drawing")!, findWireEndpoint(document, wire.to, "drawing")!);
}

function assertSurface(document: HarnessDesignDocument) {
  const object = coveringScene(document)[0]!, surfaces = coveringSurfaces(object);
  expect(surfaces).toHaveLength(1);
  const polygon = surfaces[0]!.polygon;
  expect(polygon.length).toBeGreaterThanOrEqual(4);
  expect(polygon.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
  const area = polygon.reduce((sum, p, i) => {
    const q = polygon[(i + 1) % polygon.length]!;
    return sum + p.x * q.y - p.y * q.x;
  }, 0);
  expect(Math.abs(area)).toBeGreaterThan(1);
  expect(surfaces[0]!.conformal).toBeUndefined();
  expect(JSON.parse(object.metadata!.coveringStyle!)).toMatchObject({ texture: "Rubber002", textureScale: 1.5, textureRotation: 20 });
  expect(coveringGrips(object)).toHaveLength(2);
  return surfaces;
}

describe("REQ-147: a P sleeve belongs only to its own pipe", () => {
  it("keeps its contour independent of other pipes at the same connector exit", () => {
    const source = fixture(), t = source.physicalTopology!;
    const withoutOthers = { ...source, physicalTopology: { ...t, routes: t.routes.slice(0, 4) } };
    expect(assertSurface(source)).toEqual(assertSurface(withoutOthers));
  });

  it("pulls its own conductors into the extension without pulling in another P", () => {
    const source = fixture(), bare = { ...source, physicalTopology: { ...source.physicalTopology!, coverings: [] } };
    for (const id of ["W0", "W1", "W2", "W3"]) expect(display(source, id)!.paths).not.toEqual(display(bare, id)!.paths);
    for (const id of ["W4", "W5", "W6"]) expect(display(source, id)).toEqual(display(bare, id));
  });

  it("preserves surface and assigned texture while moving the connector and sleeve edges/body", () => {
    const source = fixture();
    let document: HarnessDesignDocument = { ...source, connectors: source.connectors.map(c => c.id === "A"
      ? { ...c, positions: { ...c.positions, drawing: { x: 90, y: 50 } } } : c) };
    assertSurface(document);
    for (const part of ["from", "to", "body"] as const) {
      const grips = coveringGrips(coveringScene(document)[0]!);
      const start = grips[part === "to" ? 1 : 0]!.point;
      const moved = moveCovering(document, "tube", 0, part, start, { x: start.x + 10, y: start.y + 4 }, 0)!;
      expect(moved).not.toBeNull();
      document = { ...document, physicalTopology: { ...document.physicalTopology!, coverings: [moved] } };
      assertSurface(document);
      expect(moved.lengthMm).toBe(70);
      expect(moved.style).toEqual(source.physicalTopology!.coverings![0]!.style);
    }
    expect(assertSurface(parseHarnessDesignDocument(JSON.parse(JSON.stringify(document))))).toEqual(assertSurface(document));
    expect(document.wires).toBe(source.wires);
    expect(document.physicalTopology!.routes).toBe(source.physicalTopology!.routes);
  });

  it("retains the same isolation when the pipe and its route steps are reversed", () => {
    const source = fixture(), t = source.physicalTopology!;
    const reverse = { ...source, physicalTopology: { ...t,
      segments: t.segments.map(s => ({ ...s, from: s.to, to: s.from, path: { ...s.path, points: [...s.path.points].reverse() } })),
      routes: t.routes.map(r => ({ ...r, steps: r.steps.map(s => ({ ...s, reverse: true })) })),
      coverings: t.coverings!.map(c => ({ ...c, spans: [{ segmentId: "pipe", from: .96, to: 1.18 }] })),
    } };
    const bare = { ...reverse, physicalTopology: { ...reverse.physicalTopology, coverings: [] } };
    assertSurface(reverse);
    expect(display(reverse, "W0")!.paths).not.toEqual(display(bare, "W0")!.paths);
    expect(display(reverse, "W4")).toEqual(display(bare, "W4"));
  });
});
