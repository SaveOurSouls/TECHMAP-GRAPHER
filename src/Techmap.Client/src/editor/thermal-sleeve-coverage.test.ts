import { describe, expect, it } from "vitest";
import { createConnector, createWire } from "./commands";
import { createEmptyHarnessDesign, type HarnessDesignDocument, type Point } from "./model";
import { coveringScene, moveCovering } from "./covering-layout";
import { coveringGrips, coveringSurfaces } from "./covering-renderer";
import { drawingRouteHitPoints } from "./drawing-route-path";
import { designToScene } from "./HarnessDesignEditor";

function fixture(): HarnessDesignDocument {
  const connectors = [createConnector("A", "XS1", 16, { x: 0, y: 0 }), createConnector("B", "XS2", 8, { x: 900, y: 0 })];
  const contacts = [1, 2, 7, 8, 12, 13, 16];
  const wires = contacts.map((contact, i) => createWire(`W${i}`, { connectorId: "A", contactId: `A:contact:${contact}` },
    { connectorId: "B", contactId: `B:contact:${i + 1}` }, 420 + i));
  return { ...createEmptyHarnessDesign(), connectors, wires,
    physicalTopology: { snap: false, nodes: [
      { id: "a", connectorId: "A", position: { x: 395, y: 260 } },
      { id: "b", connectorId: "B", position: { x: -100, y: 260 } },
    ], segments: [{ id: "pipe", from: "a", to: "b", path: { kind: "polyline", points: [] } },
      { id: "other", from: "a", to: "b", path: { kind: "polyline", points: [{ x: 700, y: 400 }] } }],
    routes: wires.map((wire, i) => ({ wireId: wire.id, steps: [{ segmentId: i < 4 ? "pipe" : "other", reverse: false }] })),
    coverings: [{ id: "tube", name: "ТУ2", kind: "heat-shrink", width: 0, color: "#424c53", lengthMm: 70,
      spans: [{ segmentId: "pipe", from: -.18, to: .04 }] }] } };
}

function inside(polygon: readonly Point[], point: Point): boolean {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j]!, b = polygon[i]!;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

function assertCoverage(document: HarnessDesignDocument, side: "from" | "to" = "from") {
    const surface = coveringSurfaces(coveringScene(document)[0]!)[0]!, polygon = surface.polygon;
    const scene = designToScene(document, "drawing"), axis = surface.path;
    const signed = (p: Point, edge: Point, inside: Point) => ((p.x - edge.x) * (inside.x - edge.x) + (p.y - edge.y) * (inside.y - edge.y)) / Math.hypot(inside.x - edge.x, inside.y - edge.y);
    const misses: Point[] = [];
    for (const wire of document.wires) {
      const display = scene.find(object => object.id === wire.id)!;
      for (const stroke of display.visibleWireStrokes!) for (const p of drawingRouteHitPoints(stroke.points, 24).flatMap((b, i, points) => {
        const a = points[Math.max(0, i - 1)]!, count = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
        const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        return Array.from({ length: count }, (_, j) => ({ x: a.x + (b.x - a.x) * j / count, y: a.y + (b.y - a.y) * j / count }))
          .flatMap(p => [-1, 0, 1].map(side => ({ x: p.x - side * (b.y - a.y) / length * stroke.width / 2,
            y: p.y + side * (b.x - a.x) / length * stroke.width / 2 })));
      })) {
        const within = (side === "from" ? p.x < 393 : p.x > 802) &&
          signed(p, axis[0]!, axis[1]!) > 2 && signed(p, axis.at(-1)!, axis.at(-2)!) > 2;
        if (within && !inside(polygon, p)) misses.push(p);
      }
    }
    expect(misses.length).toBe(0);
}

describe("thermal sleeve coverage at a shared connector exit", () => {
  it("encloses every conductor approaching the shared exit across the sleeve section", () => {
    assertCoverage(fixture());
  });

  it("handles reversed pipes and reverse wire steps at the opposite sleeve end", () => {
    const base = fixture(), t = base.physicalTopology!;
    const document = { ...base, physicalTopology: { ...t,
      segments: t.segments.map(s => ({ ...s, from: s.to, to: s.from, path: { ...s.path, points: [...s.path.points].reverse() } })),
      routes: t.routes.map(r => ({ ...r, steps: r.steps.map(s => ({ ...s, reverse: true })) })),
      coverings: t.coverings!.map(c => ({ ...c, spans: [{ segmentId: "pipe", from: .96, to: 1.18 }] })),
    } };
    assertCoverage(document);
  });

  it("encloses the right-hand table contact tails at the pipe's other end", () => {
    const base = fixture(), t = base.physicalTopology!;
    assertCoverage({ ...base, physicalTopology: { ...t, coverings: t.coverings!.map(c => ({ ...c,
      spans: [{ segmentId: "pipe", from: .96, to: 1.18 }],
    })) } }, "to");
  });

  it("encloses the full drawn width of mixed-diameter wires", () => {
    const document = fixture();
    assertCoverage({ ...document, connectors: document.connectors.map(connector => ({ ...connector,
      contacts: connector.contacts.map((contact, i) => ({ ...contact, wireDiameterMm: i >= 11 ? 3 : 1 })),
    })) });
  });

  it("does not capture an overlapping exit with a different stable ID", () => {
    const base = fixture(), t = base.physicalTopology!;
    const isolated = { ...base, physicalTopology: { ...t,
      nodes: [...t.nodes, { ...t.nodes[0]!, id: "separate" }],
      segments: t.segments.map(s => s.id === "other" ? { ...s, from: "separate" } : s),
    } };
    const absent = { ...base, physicalTopology: { ...t, routes: t.routes.slice(0, 4) } };
    expect(coveringSurfaces(coveringScene(isolated)[0]!)).toEqual(coveringSurfaces(coveringScene(absent)[0]!));
    expect(coveringSurfaces(coveringScene(base)[0]!)).not.toEqual(coveringSurfaces(coveringScene(isolated)[0]!));
  });

  it("keeps a sleeve wholly inside a pipe independent of the other exit tails", () => {
    const base = fixture(), t = base.physicalTopology!;
    const internal = { ...base, physicalTopology: { ...t, coverings: t.coverings!.map(c => ({ ...c, spans: [{ segmentId: "pipe", from: .1, to: .3 }] })) } };
    const moved = { ...internal, connectors: internal.connectors.map(c => c.id === "A" ? { ...c, positions: { ...c.positions, drawing: { x: -100, y: -100 } } } : c) };
    // The pipe endpoints move with their connector, so compare the effect of
    // removing the other routes in the same document instead.
    const absent = { ...moved, physicalTopology: { ...moved.physicalTopology, routes: t.routes.slice(0, 4) } };
    expect(coveringSurfaces(coveringScene(moved)[0]!)).toEqual(coveringSurfaces(coveringScene(absent)[0]!));
  });

  it("rebuilds on membership changes without mutating routes, lengths or the document", () => {
    const document = fixture(), before = JSON.stringify(document), t = document.physicalTopology!;
    const original = coveringSurfaces(coveringScene(document)[0]!);
    const reduced = { ...document, physicalTopology: { ...t, routes: t.routes.slice(0, 4) } };
    expect(coveringSurfaces(coveringScene(reduced)[0]!)).not.toEqual(original);
    expect(coveringSurfaces(coveringScene(JSON.parse(before))[0]!)).toEqual(original);
    expect(JSON.stringify(document)).toBe(before);
    expect(document.wires.map(w => w.lengthMm)).toEqual([420, 421, 422, 423, 424, 425, 426]);
    const moved = moveCovering(document, "tube", 0, "body", { x: 395, y: 260 }, { x: 405, y: 260 })!;
    expect(moved.lengthMm).toBe(70);
    expect(t.routes).toBe(document.physicalTopology!.routes);
    const movedNode = { ...document, physicalTopology: { ...t, nodes: t.nodes.map(n => n.id === "a" ? { ...n, position: { x: 405, y: 240 } } : n) } };
    expect(coveringSurfaces(coveringScene(movedNode)[0]!)).not.toEqual(original);
    expect(movedNode.wires).toBe(document.wires);
    expect(movedNode.physicalTopology.routes).toBe(t.routes);
    expect(movedNode.physicalTopology.coverings).toBe(t.coverings);
  });

  it("places exposed edge grips on the expanded contour", () => {
    const scene = coveringScene(fixture())[0]!, polygon = coveringSurfaces(scene)[0]!.polygon;
    for (const grip of coveringGrips(scene)) {
      expect(grip.edgeFrom).toBeDefined(); expect(grip.edgeTo).toBeDefined();
      for (const p of [grip.edgeFrom!, grip.edgeTo!]) expect(polygon.some(q => Math.hypot(p.x - q.x, p.y - q.y) < 1e-5)).toBe(true);
    }
  });
});
