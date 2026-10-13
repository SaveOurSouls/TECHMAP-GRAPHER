import { describe, expect, it } from "vitest";
import { connectRouteV3, deleteRouteV3Edge, deleteRouteV3Node, editableRouteV3, insertRouteV3Node, refreshRouteV3, routeV3EdgeInputRefs, setRouteV3EdgeInputRefs } from "./route-v3-graph";
import { parseRouteV3, ROUTE_V3_CARD_GAP, routeV3ConnectionPort, routeV3ResizeLayout, routeV3ResizeNodeSize, type RouteV3Document, type RouteV3Node } from "./route-v3-model";
const w1 = { kind: "wire" as const, id: "W1" }, w2 = { kind: "wire" as const, id: "W2" };
const node = (id: string, refs = [w1]): RouteV3Node => ({ id, title: id, refs, fragmentIds: [], kind: "assembly", x: 30, y: 30 });
const graph = (): RouteV3Document => ({ version: 1, fragments: [], preparedRefs: [], generated: true, backgroundOpacity: .2, nodes: [node("a", [w1, w2]), node("b"), node("c")], edges: [{ id: "ab", from: "a", to: "b" }, { id: "bc", from: "b", to: "c" }] });
describe("Route v3 editable dependency graph", () => {
  it("migrates old cumulative refs without transferring unrelated cut blanks", () => {
    const original = graph();
    const d = refreshRouteV3(editableRouteV3({ ...original, nodes: original.nodes.map(n => n.id === "a" ? { ...n, id: "prepared:wire" } : n), edges: original.edges.map(e => e.from === "a" ? { ...e, from: "prepared:wire" } : e) }));
    expect(d.nodes[1]!.rawRefs).toEqual([]);
    expect(d.nodes[1]!.refs).toEqual([w1]);
    expect(parseRouteV3(JSON.parse(JSON.stringify(d)))).toEqual(d);
    expect(editableRouteV3(d)).toEqual(d);
  });
  it("transfers later material changes through generated assembly dependencies", () => {
    const original = graph();
    const d = editableRouteV3({ ...original, nodes: original.nodes.map(n => ({ ...n, refs: [w1] })) });
    const changed = refreshRouteV3({ ...d, nodes: d.nodes.map(n => n.id === "a" ? { ...n, rawRefs: [w1, w2] } : n) });
    expect(changed.nodes.find(n => n.id === "c")!.refs).toEqual([w1, w2]);
  });
  it("preserves a selected subset of cut blanks and keeps complete assembly inputs live", () => {
    const prepared = node("prepared:wire", [w1, w2]);
    const assembly = node("assembly", []);
    const downstream = node("downstream", []);
    const initial = editableRouteV3({ ...graph(), nodes: [prepared, assembly, downstream], edges: [{ id: "cut", from: prepared.id, to: assembly.id }, { id: "whole", from: assembly.id, to: downstream.id }] });
    const selected = setRouteV3EdgeInputRefs(initial, "cut", [w1]);
    expect(routeV3EdgeInputRefs(selected, "cut")).toEqual([w1]);
    expect(selected.nodes.find(value => value.id === assembly.id)?.refs).toEqual([w1]);
    const whole = setRouteV3EdgeInputRefs(selected, "whole", [w1]);
    expect(whole.edges.find(value => value.id === "whole")?.refs).toBeUndefined();
    const changed = refreshRouteV3({ ...whole, nodes: whole.nodes.map(value => value.id === assembly.id ? { ...value, rawRefs: [w2] } : value) });
    expect(changed.nodes.find(value => value.id === downstream.id)?.refs).toEqual([w2, w1]);
    expect(parseRouteV3(JSON.parse(JSON.stringify(changed)))).toEqual(changed);
  });
  it("treats legacy non-prepared cut cards like prepared blanks for subset transfer", () => {
    const cut = { ...node("legacy-cut", [w1, w2]), kind: "semiFinished" as const, fragmentIds: [] };
    const target = node("target", []);
    const initial = editableRouteV3({ ...graph(), nodes: [cut, target], edges: [{ id: "cut-target", from: cut.id, to: target.id }] });
    const selected = setRouteV3EdgeInputRefs(initial, "cut-target", [w2]);
    expect(routeV3EdgeInputRefs(selected, "cut-target")).toEqual([w2]);
    expect(selected.nodes.find(value => value.id === target.id)?.refs).toEqual([w2]);
  });
  it("removes inherited materials transitively while retaining explicit raw material", () => {
    let d = editableRouteV3(graph());
    d = { ...d, nodes: d.nodes.map(n => n.id === "c" ? { ...n, rawRefs: [w2] } : n) };
    const cut = deleteRouteV3Edge(d, "ab");
    expect(cut.nodes[1]!.refs).toEqual([]);
    expect(cut.nodes[2]!.refs).toEqual([w2]);
    const restored = connectRouteV3(cut, "a", "b", "new-ab");
    expect(restored.nodes[1]!.refs).toEqual([w1, w2]);
    expect(restored.nodes[2]!.refs).toEqual([w2, w1]);
  });
  it("inserts one card before all immediate children, retaining other parents", () => {
    const d = editableRouteV3({ ...graph(), nodes: [node("a"), node("b"), node("c"), node("other", [w2])], edges: [{ id: "ab", from: "a", to: "b" }, { id: "ac", from: "a", to: "c" }, { id: "ob", from: "other", to: "b" }] });
    const next = insertRouteV3Node(d, "a", "inserted");
    expect(next.edges.map(e => `${e.from}>${e.to}`).sort()).toEqual(["a>inserted", "inserted>b", "inserted>c", "other>b"]);
    expect(next.nodes.find(n => n.id === "b")!.inputNodeIds).toEqual(["inserted", "other"]);
    expect(next.nodes.find(n => n.id === "inserted")!.refs).toEqual([w1]);
    expect(next.nodes.find(n => n.id === "b")!.y).toBeGreaterThan(next.nodes.at(-1)!.y);
  });
  it("adds at leaves and rejects cycles even for deselected inputs", () => {
    const d = editableRouteV3(graph());
    expect(insertRouteV3Node(d, "c", "new").nodes.at(-1)!.refs).toEqual([w1, w2]);
    expect(() => connectRouteV3(d, "c", "a", "cycle")).toThrow(/цикл/);
    expect(() => connectRouteV3(d, "a", "a", "self")).toThrow();
    expect(connectRouteV3(d, "a", "b", "duplicate")).toBe(d);
    expect(deleteRouteV3Node(d, "b").nodes.find(n => n.id === "c")!.refs).toEqual([]);
  });
  it("deduplicates diamond inheritance and updates ports after resize", () => {
    let d = editableRouteV3(graph());
    d = connectRouteV3(d, "a", "c", "ac");
    expect(d.nodes.find(n => n.id === "c")!.refs).toEqual([w1, w2]);
    const size = routeV3ResizeNodeSize(500, 570);
    expect(routeV3ConnectionPort({ ...node("n"), ...size }, "bottom")).toEqual({ x: 280, y: 600 });
    expect(routeV3ResizeNodeSize(-100, 9999)).toEqual({ width: 220, height: 720 });
  });
  it("persists operations and sizes and rejects invalid additions", () => {
    const d = editableRouteV3(graph());
    const saved = { ...d, nodes: d.nodes.map(n => ({ ...n, width: 500, height: 570, quantity: 2, operations: [{ id: "op", title: "Cut", kind: "static" as const, quantity: 3, minutesEach: 2, lengthMm: 0, speedMmPerMinute: 1, employees: 1 }] })) };
    expect(parseRouteV3(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
    expect(parseRouteV3({ ...saved, nodes: [{ ...saved.nodes[0], width: -2 }] })).toBeNull();
  });
  it("snaps a resizing card to matching dimensions and cascades overlapping neighbours", () => {
    const cards = [
      { ...node("a"), x: 40, y: 40, width: 280, height: 264 },
      { ...node("b"), x: 330, y: 40, width: 400, height: 300 },
      { ...node("c"), x: 744, y: 40, width: 280, height: 264 },
    ];
    const layout = routeV3ResizeLayout(cards, "a", 393, 292);
    expect(layout.size).toEqual({ width: 400, height: 300 });
    expect(layout.snapped).toEqual({ width: true, height: true });
    expect(layout.nodes.find(card => card.id === "b")!.x).toBe(40 + 400 + ROUTE_V3_CARD_GAP);
    expect(layout.nodes.find(card => card.id === "c")!.x).toBe(40 + 400 + ROUTE_V3_CARD_GAP + 400 + ROUTE_V3_CARD_GAP);
  });
  it("uses the right side when a left collision would leave the board", () => {
    const layout = routeV3ResizeLayout([{ ...node("a"), x: 12, y: 40, width: 280, height: 264 }, { ...node("b"), x: 30, y: 40, width: 220, height: 170 }], "a", 300, 264);
    expect(layout.nodes.find(card => card.id === "b")!.x).toBe(12 + 300 + ROUTE_V3_CARD_GAP);
  });
});
