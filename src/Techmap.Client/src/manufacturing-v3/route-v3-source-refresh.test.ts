import { describe, expect, it } from "vitest";
import { physicalFixture } from "../editor/physical-topology-fixture";
import { applyRouteV3SourceRefresh, previewRouteV3SourceRefresh, resolveRouteV3SourceDivergence, routeV3HasUnresolvedSourceChanges } from "./route-v3-source-refresh";
import { createInitialRouteV3, parseRouteV3 } from "./route-v3-model";

const source = physicalFixture();
describe("Route v3 source reconciliation", () => {
  it("asks for explicit first source adoption for an older saved route", () => {
    const { sourceState: _baseline, ...legacy } = createInitialRouteV3(source);
    const preview = previewRouteV3SourceRefresh(legacy, source);
    expect(preview.changed).toBe(true);
    expect(preview.divergences).toEqual([]);
    expect(previewRouteV3SourceRefresh(applyRouteV3SourceRefresh(legacy, preview), source).changed).toBe(false);
  });
  it("retains authored graph and sees same-point rebind as no qualitative change", () => {
    const initial = createInitialRouteV3(source);
    const route = { ...initial, graphEdited: true, nodes: [{ id: "card", title: "Ручная сборка", kind: "assembly" as const, fragmentIds: [], refs: [], x: 20, y: 30 }], edges: [] };
    const rerouted = { ...source, wires: source.wires.map(w => w.id === "W1" ? { ...w, e4Route: [{ x: 100, y: 100 }], drawingRoute: [{ x: 200, y: 200 }] } : w) };
    const preview = previewRouteV3SourceRefresh(route, rerouted);
    expect(preview.changed).toBe(true);
    expect(preview.divergences).toEqual([]);
    const next = applyRouteV3SourceRefresh(route, preview);
    expect(next.nodes).toEqual(route.nodes);
    expect(next.edges).toEqual(route.edges);
    expect(routeV3HasUnresolvedSourceChanges(next)).toBe(false);
    expect(parseRouteV3(JSON.parse(JSON.stringify(next)))).not.toBeNull();
  });
  it("reports changed endpoints and material lengths until operator resolves each difference", () => {
    const route = createInitialRouteV3(source);
    const wire = source.wires[0]!;
    const changed = { ...source, wires: source.wires.map(w => w.id === wire.id ? { ...w, to: source.wires[1]!.to, lengthMm: 432 } : w) };
    const preview = previewRouteV3SourceRefresh(route, changed);
    expect(preview.divergences.filter(d => d.ref.id === wire.id).map(d => d.kind).sort()).toEqual(["attachment", "specification"]);
    const applied = applyRouteV3SourceRefresh(route, preview);
    expect(routeV3HasUnresolvedSourceChanges(applied)).toBe(true);
    const resolved = applied.sourceDivergences!.reduce((doc, issue) => resolveRouteV3SourceDivergence(doc, issue.key), applied);
    expect(routeV3HasUnresolvedSourceChanges(resolved)).toBe(false);
  });
  it("detects physical branch changes but preserves a route rebuilt through the same points", () => {
    const route = createInitialRouteV3(source);
    const topology = source.physicalTopology!;
    const changed = { ...source, physicalTopology: { ...topology, routes: topology.routes.map(r => r.wireId === "W1" ? { ...r, steps: [{ segmentId: "S0", reverse: false }, { segmentId: "S2", reverse: false }] } : r) } };
    expect(previewRouteV3SourceRefresh(route, changed).divergences).toEqual([expect.objectContaining({ ref: { kind: "wire", id: "W1" }, kind: "attachment" })]);
    const rebound = { ...source, physicalTopology: { ...topology, segments: topology.segments.map(s => s.id === "S0" ? { ...s, id: "S0-new" } : s), routes: topology.routes.map(r => ({ ...r, steps: r.steps.map(step => step.segmentId === "S0" ? { ...step, segmentId: "S0-new" } : step) })) } };
    expect(previewRouteV3SourceRefresh(route, rebound).divergences).toEqual([]);
  });
  it("keeps split/rejoined covering attachment if physical endpoints are the same", () => {
    const covering = { id: "COV", name: "Трубка", spans: [{ segmentId: "S0", from: 0, to: 1 }], width: 1, color: "#ffffff", lengthMm: 100 };
    const before = { ...source, physicalTopology: { ...source.physicalTopology!, coverings: [covering] } };
    const after = { ...before, physicalTopology: { ...before.physicalTopology!, segments: before.physicalTopology!.segments.map(s => s.id === "S0" ? { ...s, path: { kind: "routed" as const, points: [{ x: 90, y: 40 }] } } : s) } };
    const preview = previewRouteV3SourceRefresh(createInitialRouteV3(before), after);
    expect(preview.divergences).toEqual([]);
  });
  it("reports added and removed production inputs", () => {
    const route = createInitialRouteV3(source);
    const changed = { ...source, wires: source.wires.slice(1) };
    expect(previewRouteV3SourceRefresh(route, changed).divergences).toEqual([expect.objectContaining({ ref: { kind: "wire", id: "W1" }, kind: "removed" })]);
  });
  it("updates prepared blanks and downstream composition without replacing authored operations", () => {
    const base = createInitialRouteV3(source);
    const prepared = { id: "prepared:wire", kind: "semiFinished" as const, title: "Провода", refs: base.preparedRefs, fragmentIds: [], x: 0, y: 0 };
    const assembly = { id: "assembly", kind: "assembly" as const, title: "Сборка", refs: base.preparedRefs, fragmentIds: [], x: 0, y: 300, operations: [{ id: "op", title: "Операция", kind: "static" as const, lengthMm: 0, speedMmPerMinute: 1, employees: 1, quantity: 1, minutesEach: 1 }] };
    const route = { ...base, nodes: [prepared, assembly], edges: [{ id: "edge", from: prepared.id, to: assembly.id }] };
    const changed = { ...source, wires: source.wires.slice(0, 2) };
    const applied = applyRouteV3SourceRefresh(route, previewRouteV3SourceRefresh(route, changed));
    expect(applied.nodes.find(node => node.id === prepared.id)?.refs.map(ref => ref.id)).toEqual(["W1", "W2"]);
    expect(applied.nodes.find(node => node.id === assembly.id)?.refs.map(ref => ref.id)).toEqual(["W1", "W2"]);
    expect(applied.nodes.find(node => node.id === assembly.id)?.operations).toEqual(assembly.operations);
    expect(applied.edges.map(edge => [edge.id, edge.from, edge.to])).toEqual(route.edges.map(edge => [edge.id, edge.from, edge.to]));
  });
  it("does not silently assign a newly added wire to an authored downstream card", () => {
    const before = { ...source, wires: source.wires.slice(0, 2) };
    const base = createInitialRouteV3(before);
    const prepared = { id: "prepared:wire", kind: "semiFinished" as const, title: "Провода", refs: base.preparedRefs, fragmentIds: [], x: 0, y: 0 };
    const assembly = { id: "assembly", kind: "assembly" as const, title: "Сборка", refs: base.preparedRefs, fragmentIds: [], x: 0, y: 300 };
    const route = { ...base, nodes: [prepared, assembly], edges: [{ id: "edge", from: prepared.id, to: assembly.id }] };
    const applied = applyRouteV3SourceRefresh(route, previewRouteV3SourceRefresh(route, source));
    expect(applied.nodes.find(node => node.id === prepared.id)?.refs.map(ref => ref.id)).toEqual(["W1", "W2", "W3"]);
    expect(applied.nodes.find(node => node.id === assembly.id)?.refs.map(ref => ref.id)).toEqual(["W1", "W2"]);
    expect(applied.sourceDivergences).toEqual([expect.objectContaining({ ref: { kind: "wire", id: "W3" }, kind: "added" })]);
  });
});
