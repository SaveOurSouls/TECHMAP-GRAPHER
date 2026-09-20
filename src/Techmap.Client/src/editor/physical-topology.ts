import type { HarnessDesignDocument, Point } from "./model";

export interface PhysicalNode { readonly id: string; readonly position: Point; readonly connectorId?: string }
export interface PhysicalSegment { readonly id: string; readonly from: string; readonly to: string; readonly bends: readonly Point[] }
export interface PhysicalStep { readonly segmentId: string; readonly reverse: boolean }
export interface PhysicalRoute { readonly wireId: string; readonly steps: readonly PhysicalStep[] }
export interface PhysicalTopology {
  readonly nodes: readonly PhysicalNode[];
  readonly segments: readonly PhysicalSegment[];
  readonly routes: readonly PhysicalRoute[];
  readonly snap: boolean;
}
export const emptyPhysicalTopology = (): PhysicalTopology => ({ nodes: [], segments: [], routes: [], snap: true });

export function physicalNodePoint(document: HarnessDesignDocument, node: PhysicalNode): Point {
  const origin = document.connectors.find(c => c.id === node.connectorId)?.positions.drawing;
  return origin ? { x: origin.x + node.position.x, y: origin.y + node.position.y } : node.position;
}

/** Preserve both anchors. A short horizontal/vertical completion makes every leg a multiple of 15°. */
export function constrainedPolyline(points: readonly Point[], snap: boolean): Point[] {
  const result: Point[] = [];
  for (const end of points) {
    const start = result.at(-1);
    if (start && Math.hypot(end.x - start.x, end.y - start.y) < 1e-7) continue;
    if (start && snap) {
      const dx = end.x - start.x, dy = end.y - start.y;
      const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 12)) * Math.PI / 12;
      const cx = Math.cos(angle), sy = Math.sin(angle);
      const distance = Math.min(Math.abs(cx) < 1e-8 ? Infinity : Math.abs(dx / cx), Math.abs(sy) < 1e-8 ? Infinity : Math.abs(dy / sy));
      const bend = { x: start.x + distance * cx, y: start.y + distance * sy };
      if (Number.isFinite(distance) && distance > 1e-7 && Math.hypot(bend.x - end.x, bend.y - end.y) > 1e-7) result.push(bend);
    }
    result.push(end);
  }
  return result;
}

export function physicalSegmentPoints(document: HarnessDesignDocument, segment: PhysicalSegment): Point[] {
  const topology = document.physicalTopology!;
  return constrainedPolyline([physicalNodePoint(document, topology.nodes.find(n => n.id === segment.from)!), ...segment.bends,
    physicalNodePoint(document, topology.nodes.find(n => n.id === segment.to)!)], topology.snap);
}

export function physicalWirePoints(document: HarnessDesignDocument, wireId: string, start: Point, end: Point): Point[] | null {
  const topology = document.physicalTopology;
  const route = topology?.routes.find(r => r.wireId === wireId);
  if (!topology || !route?.steps.length) return null;
  const points = route.steps.flatMap(step => {
    const segment = topology.segments.find(s => s.id === step.segmentId)!;
    const path = physicalSegmentPoints(document, segment);
    return step.reverse ? path.reverse() : path;
  });
  return constrainedPolyline([start, ...points, end], topology.snap);
}

export function parsePhysicalTopology(value: unknown, document: HarnessDesignDocument): PhysicalTopology | undefined {
  if (value === undefined) return undefined;
  const fail = (): never => { throw new Error("Некорректная физическая трасса: проверьте узлы, участки и порядок маршрутов."); };
  if (!value || typeof value !== "object") return fail();
  const t = value as PhysicalTopology;
  if (!Array.isArray(t.nodes) || !Array.isArray(t.segments) || !Array.isArray(t.routes) || typeof t.snap !== "boolean" ||
      t.nodes.length > 10000 || t.segments.length > 20000 || t.routes.length > 20000) return fail();
  const text = (s: unknown): s is string => typeof s === "string" && s.trim().length > 0 && s.length <= 128;
  const point = (p: Point) => p && Number.isFinite(p.x) && Number.isFinite(p.y) && Math.abs(p.x) <= 1e7 && Math.abs(p.y) <= 1e7;
  const ids = new Set([...document.connectors.map(c => c.id), ...document.wires.map(w => w.id)]);
  const unique = (id: unknown) => { if (!text(id) || ids.has(id)) fail(); ids.add(id as string); };
  for (const n of t.nodes) {
    if (!n) return fail(); unique(n.id);
    if (!point(n.position) || n.connectorId !== undefined && !document.connectors.some(c => c.id === n.connectorId)) return fail();
  }
  const anchored = t.nodes.filter(n => n.connectorId).map(n => n.connectorId);
  if (new Set(anchored).size !== anchored.length) return fail();
  for (const s of t.segments) {
    if (!s) return fail(); unique(s.id);
    if (s.from === s.to || !t.nodes.some(n => n.id === s.from) || !t.nodes.some(n => n.id === s.to) || !Array.isArray(s.bends) || s.bends.length > 1000 || !s.bends.every(point)) return fail();
  }
  const wireIds = new Set<string>();
  for (const r of t.routes) {
    if (!r || wireIds.has(r.wireId) || !document.wires.some(w => w.id === r.wireId) || !Array.isArray(r.steps) || !r.steps.length || r.steps.length > 20000) return fail();
    wireIds.add(r.wireId);
    let previous: string | undefined;
    const visited = new Set<string>();
    for (const step of r.steps) {
      const s = t.segments.find(s => s.id === step?.segmentId);
      if (!s || typeof step.reverse !== "boolean" || visited.has(s.id)) return fail();
      visited.add(s.id);
      const from = step.reverse ? s.to : s.from, to = step.reverse ? s.from : s.to;
      if (previous && previous !== from) return fail();
      previous = to;
    }
    const first = t.segments.find(s => s.id === r.steps[0]!.segmentId)!;
    const last = t.segments.find(s => s.id === r.steps.at(-1)!.segmentId)!;
    const from = t.nodes.find(n => n.id === (r.steps[0]!.reverse ? first.to : first.from))!;
    const to = t.nodes.find(n => n.id === (r.steps.at(-1)!.reverse ? last.from : last.to))!;
    const w = document.wires.find(w => w.id === r.wireId)!;
    if (from.connectorId && from.connectorId !== w.from.connectorId || to.connectorId && to.connectorId !== w.to.connectorId) return fail();
  }
  return t;
}

/** Explicit split, never inferred from a crossing. All route references retain their order and direction. */
export function splitPhysicalSegment(document: HarnessDesignDocument, segmentId: string, bendIndex: number, nodeId: string, nextId: string): PhysicalTopology {
  const t = document.physicalTopology!;
  const s = t.segments.find(s => s.id === segmentId)!;
  const points = physicalSegmentPoints(document, s);
  if (bendIndex < 1 || bendIndex >= points.length - 1) throw new Error("Выберите существующий перегиб участка.");
  return { ...t, nodes: [...t.nodes, { id: nodeId, position: points[bendIndex]! }],
    segments: [...t.segments.map(item => item.id === s.id ? { ...s, to: nodeId, bends: points.slice(1, bendIndex) } : item),
      { id: nextId, from: nodeId, to: s.to, bends: points.slice(bendIndex + 1, -1) }],
    routes: t.routes.map(r => ({ ...r, steps: r.steps.flatMap(step => step.segmentId !== s.id ? [step] : step.reverse
      ? [{ segmentId: nextId, reverse: true }, step] : [step, { segmentId: nextId, reverse: false }]) })) };
}

export function prunePhysicalTopology(document: HarnessDesignDocument): HarnessDesignDocument {
  const t = document.physicalTopology;
  if (!t) return document;
  const nodes = t.nodes.filter(n => !n.connectorId || document.connectors.some(c => c.id === n.connectorId));
  const segments = t.segments.filter(s => nodes.some(n => n.id === s.from) && nodes.some(n => n.id === s.to));
  const routes = t.routes.filter(r => {
    const wire = document.wires.find(w => w.id === r.wireId);
    if (!wire || !r.steps.every(step => segments.some(s => s.id === step.segmentId))) return false;
    const first = segments.find(s => s.id === r.steps[0]?.segmentId), last = segments.find(s => s.id === r.steps.at(-1)?.segmentId);
    if (!first || !last) return false;
    const a = nodes.find(n => n.id === (r.steps[0]!.reverse ? first.to : first.from))?.connectorId;
    const b = nodes.find(n => n.id === (r.steps.at(-1)!.reverse ? last.from : last.to))?.connectorId;
    return (!a || a === wire.from.connectorId) && (!b || b === wire.to.connectorId);
  });
  return { ...document, physicalTopology: { ...t, nodes, segments, routes } };
}
