import { findWireEndpoint, type HarnessDesignDocument, type Point, type WireEndpoint } from "./model";
import { selectMaterializedContactRepresentation } from "./materialized-contact-representation";
import { drawingBendRadius, drawingRouteHitPoints } from "./drawing-route-path";
import { physicalWireDisplay } from "./physical-wire-geometry";
import { squareConformalContourEnds } from "./covering-contour";

/** A shared connector exit can feed several pipes. A sleeve crossing that
 * exit encloses their actual conductor tails, without assigning them to a
 * different pipe or moving an electrical/physical route. Nearby exits with
 * different IDs are deliberately excluded. */
export function connectorSleeveSupports(document: HarnessDesignDocument, segmentId: string,
  from: number, to: number, centerline: readonly Point[], clearance: number): Point[][] {
  const topology = document.physicalTopology, segment = topology?.segments.find(s => s.id === segmentId);
  if (!topology || !segment || centerline.length < 2) return [];
  const nodeIds = new Set([
    ...(from <= 0 && to >= 0 ? [segment.from] : []),
    ...(from <= 1 && to >= 1 ? [segment.to] : []),
  ].filter(id => topology.nodes.some(node => node.id === id && node.connectorId)));
  if (!nodeIds.size) return [];
  const routes = topology.routes.filter(route => {
    const first = route.steps[0], last = route.steps.at(-1);
    const a = topology.segments.find(s => s.id === first?.segmentId), b = topology.segments.find(s => s.id === last?.segmentId);
    return a && b && (nodeIds.has(first!.reverse ? a.to : a.from) || nodeIds.has(last!.reverse ? b.from : b.to));
  });
  if (!routes.some(route => !route.steps.some(step => step.segmentId === segmentId))) return [];
  const project = (point: Point): Point => {
    let nearest = Infinity, result = centerline[0]!;
    for (let i = 1; i < centerline.length; i++) {
      const a = centerline[i - 1]!, b = centerline[i]!, dx = b.x - a.x, dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
      const p = { x: a.x + t * dx, y: a.y + t * dy }, distance = Math.hypot(p.x - point.x, p.y - point.y);
      if (distance < nearest) { nearest = distance; result = p; }
    }
    return result;
  };
  const supports: Point[][] = [];
  // Match the drawing's table-side fallback as well as pinned contact art.
  const endpoint = (end: WireEndpoint, other: WireEndpoint): Point | null => {
    const point = findWireEndpoint(document, end, "drawing"), connector = document.connectors.find(c => c.id === end.connectorId);
    if (!point || !connector || connector.terminationComponent || selectMaterializedContactRepresentation(connector, end.contactId, "drawing")) return point;
    const target = document.connectors.find(c => c.id === other.connectorId);
    return { x: connector.positions.drawing.x + (target && target.positions.drawing.x < connector.positions.drawing.x ? 0 : 118), y: point.y };
  };
  for (const route of routes) {
    const wire = document.wires.find(wire => wire.id === route.wireId);
    if (!wire) continue;
    const start = wire.drawingEndpoints?.from ?? endpoint(wire.from, wire.to), end = wire.drawingEndpoints?.to ?? endpoint(wire.to, wire.from);
    if (!start || !end) continue;
    const display = physicalWireDisplay(document, wire.id, start, end);
    for (const tail of display?.endpointStrokes ?? []) {
      if (!nodeIds.has(tail.nodeId)) continue;
      const points = drawingRouteHitPoints(tail.points, drawingBendRadius(document)), radius = tail.width / 2 + clearance;
      for (let i = 1; i < points.length; i++) {
        const p = points[i - 1]!, q = points[i]!, length = Math.hypot(q.x - p.x, q.y - p.y);
        if (length < 1e-7) continue;
        const tangent = { x: (q.x - p.x) / length, y: (q.y - p.y) / length }, normal = { x: -tangent.y, y: tangent.x };
        const corners = [p, q].flatMap(point => [-1, 1].flatMap(along => [-1, 1].map(side => ({
          x: point.x + radius * (along * tangent.x + side * normal.x),
          y: point.y + radius * (along * tangent.y + side * normal.y),
        }))));
        // Clip before bridging to the axis, otherwise distant contact bends
        // could widen the sleeve even when they lie beyond its exposed edge.
        const clipped = squareConformalContourEnds(convexHull(corners), centerline);
        if (clipped.length < 3) continue;
        supports.push([...clipped, ...clipped.map(project)]);
      }
    }
  }
  return supports;
}

function convexHull(points: readonly Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const half = (items: readonly Point[]) => {
    const result: Point[] = [];
    for (const point of items) {
      while (result.length > 1 && cross(result.at(-2)!, result.at(-1)!, point) <= 0) result.pop();
      result.push(point);
    }
    return result.slice(0, -1);
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}
