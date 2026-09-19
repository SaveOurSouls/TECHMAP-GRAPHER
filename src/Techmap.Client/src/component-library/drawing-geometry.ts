import type { NumericExpressionV2, TemplateNodeV2 } from "./template-model-v2";

export interface DrawingPoint { x: number; y: number }
export interface DrawingSnaps { corners: boolean; contours: boolean; tangents: boolean }
export const defaultDrawingSnaps: DrawingSnaps = { corners: true, contours: true, tangents: true };
type Evaluate = (value: NumericExpressionV2) => number | null;
export interface DrawingOutline { id: string; points: DrawingPoint[]; closed: boolean; corners?: DrawingPoint[]; curved?: boolean; circle?: { center: DrawingPoint; radius: number } }

export function drawingOutline(node: TemplateNodeV2, evaluate: Evaluate): DrawingOutline | null {
  const values = Object.fromEntries(Object.entries(node.transform).map(([key, value]) => [key, evaluate(value)]));
  if (Object.values(values).some(value => value === null)) return null;
  const angle = values.rotationDegrees! * Math.PI / 180;
  const world = (x: number, y: number): DrawingPoint => ({
    x: values.translateX! + x * values.scaleX! * Math.cos(angle) - y * values.scaleY! * Math.sin(angle),
    y: values.translateY! + x * values.scaleX! * Math.sin(angle) + y * values.scaleY! * Math.cos(angle),
  });
  const n = (value: NumericExpressionV2) => { const result = evaluate(value); if (result === null) throw new Error(); return result; };
  try {
    if (node.kind === "group") return null;
    if (node.kind === "bezier") {
      const control = node.geometry.points.map(p => world(n(p.x), n(p.y)));
      const points: DrawingPoint[] = [];
      for (let i = 0; i + 3 < control.length; i += 3) for (let step = 0; step <= 64; step++) {
        const t = step / 64, u = 1 - t, a = control[i]!, b = control[i+1]!, c = control[i+2]!, d = control[i+3]!;
        points.push({x:u*u*u*a.x+3*u*u*t*b.x+3*u*t*t*c.x+t*t*t*d.x,y:u*u*u*a.y+3*u*u*t*b.y+3*u*t*t*c.y+t*t*t*d.y});
      }
      return {id:node.id,points,closed:node.geometry.closed,corners:control.filter((_,i) => i % 3 === 0),curved:true};
    }
    if ("points" in node.geometry) return { id: node.id, points: node.geometry.points.map(p => world(n(p.x), n(p.y))), closed: node.kind === "closedContour" };
    if (node.kind === "ellipse") {
      const cx = n(node.geometry.centerX), cy = n(node.geometry.centerY), rx = n(node.geometry.radiusX), ry = n(node.geometry.radiusY);
      const radius = Math.abs(rx * values.scaleX!);
      return { id: node.id, closed: true, corners: [], curved: true,
        points: Array.from({ length: 96 }, (_, i) => world(cx + rx * Math.cos(i * Math.PI / 48), cy + ry * Math.sin(i * Math.PI / 48))),
        ...(Math.abs(radius - Math.abs(ry * values.scaleY!)) < 1e-6 ? { circle: { center: world(cx, cy), radius } } : {}),
      };
    }
    const x = n(node.geometry.x), y = n(node.geometry.y) - (node.kind === "text" ? n(node.geometry.fontSize) : 0);
    const w = node.kind === "text" ? n(node.geometry.fontSize) * node.geometry.text.length * 0.6 : n(node.geometry.width);
    const h = node.kind === "text" ? n(node.geometry.fontSize) : n(node.geometry.height);
    return { id: node.id, closed: true, points: [world(x, y), world(x + w, y), world(x + w, y + h), world(x, y + h)] };
  } catch { return null; }
}

export function drawingCenter(outlines: readonly DrawingOutline[]): DrawingPoint | null {
  const points = outlines.flatMap(outline => outline.points);
  if (!points.length) return null;
  return { x: (Math.min(...points.map(p => p.x)) + Math.max(...points.map(p => p.x))) / 2,
    y: (Math.min(...points.map(p => p.y)) + Math.max(...points.map(p => p.y))) / 2 };
}

/** Walks the ownership tree so grouped contours use their actual world position. */
export function drawingLayerOutlines(nodes: readonly TemplateNodeV2[], evaluate: Evaluate): DrawingOutline[] {
  const owned = new Set(nodes.flatMap(node => node.kind === "group" ? node.geometry.childIds : []));
  const byId = new Map(nodes.map(node => [node.id, node]));
  const walk = (node: TemplateNodeV2, ancestors: Set<string>): DrawingOutline[] => {
    if (!node.visible || ancestors.has(node.id)) return [];
    if (node.kind !== "group") { const outline = drawingOutline(node, evaluate); return outline ? [outline] : []; }
    const values = Object.fromEntries(Object.entries(node.transform).map(([key,value]) => [key,evaluate(value)]));
    if (Object.values(values).some(value => value === null)) return [];
    const angle = values.rotationDegrees! * Math.PI / 180, sx=values.scaleX!, sy=values.scaleY!;
    const world = (point:DrawingPoint):DrawingPoint => ({x:values.translateX!+point.x*sx*Math.cos(angle)-point.y*sy*Math.sin(angle),y:values.translateY!+point.x*sx*Math.sin(angle)+point.y*sy*Math.cos(angle)});
    return node.geometry.childIds.flatMap(id => { const child = byId.get(id); return child ? walk(child,new Set([...ancestors,node.id])) : []; }).map(outline => ({
      ...outline,id:node.id,points:outline.points.map(world),corners:outline.corners?.map(world),
      circle:outline.circle && Math.abs(Math.abs(sx)-Math.abs(sy))<1e-8 ? {center:world(outline.circle.center),radius:outline.circle.radius*Math.abs(sx)} : undefined,
    }));
  };
  return nodes.filter(node => !owned.has(node.id)).flatMap(node => walk(node,new Set()));
}

export function circleTangents(anchor: DrawingPoint, center: DrawingPoint, radius: number): DrawingPoint[] {
  const dx = anchor.x - center.x, dy = anchor.y - center.y, distance = Math.hypot(dx, dy);
  if (radius <= 0 || distance < radius) return [];
  const angle = Math.atan2(dy, dx), offset = Math.acos(radius / distance);
  return [angle - offset, angle + offset].map(a => ({ x: center.x + radius * Math.cos(a), y: center.y + radius * Math.sin(a) }));
}

export function snapDrawingPoint(point: DrawingPoint, targets: readonly DrawingOutline[], settings: DrawingSnaps,
  tolerance: number, anchor?: DrawingPoint | null): DrawingPoint {
  const candidates: DrawingPoint[] = [];
  for (const target of targets) {
    if (settings.tangents && anchor && target.circle) candidates.push(...circleTangents(anchor, target.circle.center, target.circle.radius));
    if (settings.corners && !target.circle) candidates.push(...(target.corners ?? target.points));
  }
  const nearest = (values: DrawingPoint[]) => values.map(p => ({ p, d: Math.hypot(point.x - p.x, point.y - p.y) }))
    .filter(item => item.d <= tolerance).sort((a, b) => a.d - b.d)[0]?.p;
  const feature = nearest(candidates);
  if (feature) return feature;
  if (settings.contours) for (const target of targets) {
    if (target.circle) {
      const { center, radius } = target.circle, d = Math.hypot(point.x - center.x, point.y - center.y);
      if (d > 0) candidates.push({ x: center.x + (point.x - center.x) * radius / d, y: center.y + (point.y - center.y) * radius / d });
    } else for (let i = 0; i < target.points.length - (target.closed ? 0 : 1); i++) {
      const a = target.points[i]!, b = target.points[(i + 1) % target.points.length]!;
      const dx = b.x - a.x, dy = b.y - a.y, norm = dx * dx + dy * dy;
      const t = norm === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / norm));
      candidates.push({ x: a.x + t * dx, y: a.y + t * dy });
    }
  }
  return nearest(candidates) ?? point;
}

/** Translates a straight side onto a circle tangent without changing its angle. */
export function snapDrawingTranslation(moving: DrawingOutline, delta: DrawingPoint, targets: readonly DrawingOutline[], settings: DrawingSnaps, tolerance: number): DrawingPoint {
  let correction: DrawingPoint | null = null, best = tolerance;
  const accept = (x: number, y: number) => { const d = Math.hypot(x, y); if (d < best) { best = d; correction = { x, y }; } };
  const points = moving.points.map(p => ({ x: p.x + delta.x, y: p.y + delta.y }));
  for (const point of points) { const snapped = snapDrawingPoint(point, targets, settings, tolerance); if (snapped !== point) accept(snapped.x - point.x, snapped.y - point.y); }
  if (settings.tangents && !moving.curved) for (const target of targets) if (target.circle) {
    for (let i = 0; i < points.length - (moving.closed ? 0 : 1); i++) {
      const a = points[i]!, b = points[(i + 1) % points.length]!, dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
      if (!length) continue;
      const nx = -dy / length, ny = dx / length, { center, radius } = target.circle;
      const along = ((center.x - a.x) * dx + (center.y - a.y) * dy) / length;
      if (along < 0 || along > length) continue;
      const distance = (a.x - center.x) * nx + (a.y - center.y) * ny;
      for (const sign of [-1, 1]) accept(nx * (sign * radius - distance), ny * (sign * radius - distance));
    }
  }
  const result = correction as DrawingPoint | null;
  return result ? { x: delta.x + result.x, y: delta.y + result.y } : delta;
}
