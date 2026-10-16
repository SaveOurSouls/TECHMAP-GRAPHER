import type { EditorLayer, EditorPoint, EditorSceneObject } from "./editor-types";
import { commonParallelSpan, commonHorizontalPairSpans, parallelSpanLocal, type ParallelSpan } from "./e4-parallel-spans";
import { intersectSegments, segmentsParallel } from "./segment-geometry";
import { screenCrossSections, uprightScreenBody, clearScreenSections, type ScreenCrossSection } from "./e4-screen-spans";
import { clearDecorationSpans } from "./e4-decoration-spans";
import { connectorE4TableMetrics, e4ScreenAlongSize } from "./model";
import { getE4WireLabelLayout } from "./e4-wire-label";
import { E4_BRIDGE_RADIUS } from "./e4-router";
import { isRecord, parseJson } from "./canvas-scene-metadata";
import { objectsInPaintOrder } from "./canvas-paint-order";

export type E4SegmentOrientation = "horizontal" | "vertical";

export interface E4WireSegment {
  readonly index: number;
  readonly start: EditorPoint;
  readonly end: EditorPoint;
  readonly orientation: E4SegmentOrientation;
}

export interface E4WireSegmentHit extends E4WireSegment {
  readonly wireId: string;
  readonly point: EditorPoint;
  readonly distance: number;
}

export interface OrthogonalProjection {
  readonly point: EditorPoint;
  readonly distance: number;
  readonly position: number;
  readonly orientation: E4SegmentOrientation;
}

export interface E4JunctionOverlay {
  readonly id: string;
  readonly position: EditorPoint;
  readonly wireIds: readonly string[];
}

export interface E4DifferentialPairOverlay {
  readonly id: string;
  readonly wireIds: readonly [string, string];
  readonly step: number;
  readonly amplitude: number;
  readonly variant?: 1 | 2;
}

export interface E4ScreenOverlay {
  readonly id: string;
  readonly wireIds: readonly string[];
  readonly position: number;
  readonly label: string;
  readonly width: number;
  readonly terminalSide?: "above" | "below" | "both";
}

export type E4ConnectableEndpoint =
  | { readonly connectorId: string; readonly contactIndex: number }
  | { readonly screenId: string; readonly screenTerminalSide?: "above" | "below" };

export interface E4SceneOverlays {
  readonly crossingStyle: "none" | "bridge";
  readonly junctions: readonly E4JunctionOverlay[];
  readonly diffPairs: readonly E4DifferentialPairOverlay[];
  readonly screens: readonly E4ScreenOverlay[];
}

function finitePoint(point: EditorPoint | undefined): point is EditorPoint {
  return point !== undefined && Number.isFinite(point.x) && Number.isFinite(point.y);
}

function samePoint(left: EditorPoint, right: EditorPoint): boolean {
  return Math.abs(left.x - right.x) < 0.000001 && Math.abs(left.y - right.y) < 0.000001;
}

/** The scene owns routing. Painting and hit testing use exactly the same supplied points. */
export function getE4WireRoute(object: EditorSceneObject): readonly EditorPoint[] {
  return object.points ?? [];
}

export function e4WireSegments(points: readonly EditorPoint[]): readonly E4WireSegment[] {
  const result: E4WireSegment[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    if (!start || !end || samePoint(start, end)) continue;
    if (start.x !== end.x && start.y !== end.y) continue;
    result.push({
      index,
      start,
      end,
      orientation: start.y === end.y ? "horizontal" : "vertical",
    });
  }
  return result;
}

export function projectPointToOrthogonalSegment(
  point: EditorPoint,
  start: EditorPoint,
  end: EditorPoint,
): OrthogonalProjection | null {
  if (start.y === end.y) {
    const minimum = Math.min(start.x, end.x);
    const maximum = Math.max(start.x, end.x);
    const x = Math.max(minimum, Math.min(maximum, point.x));
    const length = maximum - minimum;
    return {
      point: { x, y: start.y },
      distance: Math.hypot(point.x - x, point.y - start.y),
      position: length === 0 ? 0 : (x - minimum) / length,
      orientation: "horizontal",
    };
  }
  if (start.x === end.x) {
    const minimum = Math.min(start.y, end.y);
    const maximum = Math.max(start.y, end.y);
    const y = Math.max(minimum, Math.min(maximum, point.y));
    const length = maximum - minimum;
    return {
      point: { x: start.x, y },
      distance: Math.hypot(point.x - start.x, point.y - y),
      position: length === 0 ? 0 : (y - minimum) / length,
      orientation: "vertical",
    };
  }
  return null;
}

function movableE4Segment(segments: readonly E4WireSegment[], segment: E4WireSegment): boolean {
  const position = segments.findIndex((candidate) => candidate.index === segment.index);
  const previous = segments[position - 1];
  const next = segments[position + 1];
  return previous !== undefined && next !== undefined &&
    previous.index === segment.index - 1 && next.index === segment.index + 1 &&
    previous.orientation !== segment.orientation && next.orientation !== segment.orientation;
}

function hitTestE4WireSegments(
  objects: readonly EditorSceneObject[],
  layers: readonly EditorLayer[],
  point: EditorPoint,
  zoom: number,
  internalOnly: boolean,
  excludedWireId?: string,
): E4WireSegmentHit | null {
  const layerMap = new Map(layers.map((layer) => [layer.id, layer]));
  const tolerance = 8 / zoom;
  for (const object of [...objectsInPaintOrder(objects, layers)].reverse()) {
    if (object.kind !== "wire" || object.id === excludedWireId) continue;
    const layer = layerMap.get(object.layerId);
    if (layer?.visible !== true || (internalOnly && layer.locked)) continue;
    if(!internalOnly){
      const points=getE4WireRoute(object);
      for(let index=0;index<points.length-1;index++){
        const start=points[index]!,end=points[index+1]!,dx=end.x-start.x,dy=end.y-start.y,length=dx*dx+dy*dy;
        if(!length)continue;
        const t=Math.max(0,Math.min(1,((point.x-start.x)*dx+(point.y-start.y)*dy)/length));
        const projected={x:start.x+t*dx,y:start.y+t*dy},distance=Math.hypot(point.x-projected.x,point.y-projected.y);
        if(distance<=tolerance)return {start,end,index,wireId:object.id,point:projected,distance,orientation:Math.abs(dx)>=Math.abs(dy)?"horizontal":"vertical"};
      }
      continue;
    }
    const segments = e4WireSegments(getE4WireRoute(object));
    for (const segment of segments) {
      if (internalOnly && !movableE4Segment(segments, segment)) continue;
      const projection = projectPointToOrthogonalSegment(point, segment.start, segment.end);
      if (projection && projection.distance <= tolerance) {
        return { ...segment, wireId: object.id, point: projection.point, distance: projection.distance };
      }
    }
  }
  return null;
}

export function hitTestE4WireSegment(
  objects: readonly EditorSceneObject[],
  layers: readonly EditorLayer[],
  point: EditorPoint,
  zoom: number,
): E4WireSegmentHit | null {
  return hitTestE4WireSegments(objects, layers, point, zoom, true);
}

export function hitTestWireSegment(
  objects: readonly EditorSceneObject[],
  layers: readonly EditorLayer[],
  point: EditorPoint,
  zoom: number,
  excludedWireId?: string,
): E4WireSegmentHit | null {
  return hitTestE4WireSegments(objects, layers, point, zoom, false, excludedWireId);
}


function parseStringArray(value: unknown): readonly string[] | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) return null;
  return value;
}

export function parseE4SceneOverlays(objects: readonly EditorSceneObject[]): E4SceneOverlays {
  const metadata = objects.find((object) => object.metadata?.view === "e4" &&
    (object.metadata.junctions !== undefined || object.metadata.diffPairs !== undefined ||
      object.metadata.screens !== undefined || object.metadata.crossingStyle !== undefined))?.metadata;
  const junctionsValue = parseJson(metadata?.junctions);
  const diffPairsValue = parseJson(metadata?.diffPairs);
  const screensValue = parseJson(metadata?.screens);
  const junctions: E4JunctionOverlay[] = Array.isArray(junctionsValue) ? junctionsValue.flatMap((item) => {
    if (!isRecord(item) || typeof item.id !== "string" || !isRecord(item.position)) return [];
    const position = { x: Number(item.position.x), y: Number(item.position.y) };
    const wireIds = parseStringArray(item.wireIds);
    return finitePoint(position) && wireIds ? [{ id: item.id, position, wireIds }] : [];
  }) : [];
  const diffPairs: E4DifferentialPairOverlay[] = Array.isArray(diffPairsValue) ? diffPairsValue.flatMap((item) => {
    if (!isRecord(item) || typeof item.id !== "string") return [];
    const wireIds = parseStringArray(item.wireIds);
    const step = Number(item.step);
    const amplitude = Number(item.amplitude);
    const variant = item.variant === 2 ? 2 : 1;
    return wireIds?.length === 2 && step > 0 && amplitude > 0
      ? [{ id: item.id, wireIds: [wireIds[0]!, wireIds[1]!], step, amplitude, variant }]
      : [];
  }) : [];
  const screens: E4ScreenOverlay[] = Array.isArray(screensValue) ? screensValue.flatMap((item) => {
    if (!isRecord(item) || typeof item.id !== "string") return [];
    const wireIds = parseStringArray(item.wireIds);
    const position = Number(item.position);
    const width = Number(item.width);
    return wireIds && wireIds.length > 0 && position >= 0 && position <= 1 && width > 0
      ? [{
        id: item.id,
        wireIds,
        position,
        width,
        label: typeof item.label === "string" ? item.label : "",
        terminalSide: item.terminalSide === "below" || item.terminalSide === "both" ? item.terminalSide : "above",
      }]
      : [];
  }) : [];
  return {
    crossingStyle: metadata?.crossingStyle === "bridge" ? "bridge" : "none",
    junctions,
    diffPairs,
    screens,
  };
}

export interface E4WireCrossing {
  readonly point: EditorPoint;
  readonly overWireId: string;
  readonly underWireId: string;
  readonly overOrientation: E4SegmentOrientation;
  readonly overDirection?:EditorPoint;
  readonly underDirection?:EditorPoint;
}

export interface E4BridgeGeometry {
  readonly clearStart: EditorPoint;
  readonly clearEnd: EditorPoint;
  readonly coloredStart: EditorPoint;
  readonly arcStart: EditorPoint;
  readonly arcEnd: EditorPoint;
  readonly coloredEnd: EditorPoint;
}

/** Geometry with coloured legs overlapping the exact butt-capped clear span. */
export function getE4BridgeGeometry(
  crossing: Pick<E4WireCrossing, "point" | "overOrientation" | "overDirection">,
  radius = E4_BRIDGE_RADIUS,
): E4BridgeGeometry {
  const { point, overOrientation } = crossing;
  if(crossing.overDirection){
    const u=crossing.overDirection,at=(n:number)=>({x:point.x+u.x*n,y:point.y+u.y*n});
    return {clearStart:at(-radius-1),clearEnd:at(radius+1),coloredStart:at(-radius-2),coloredEnd:at(radius+2),arcStart:at(-radius),arcEnd:at(radius)};
  }
  if (overOrientation === "horizontal") {
    return {
      clearStart: { x: point.x - radius - 1, y: point.y },
      clearEnd: { x: point.x + radius + 1, y: point.y },
      coloredStart: { x: point.x - radius - 2, y: point.y },
      arcStart: { x: point.x - radius, y: point.y },
      arcEnd: { x: point.x + radius, y: point.y },
      coloredEnd: { x: point.x + radius + 2, y: point.y },
    };
  }
  return {
    clearStart: { x: point.x, y: point.y - radius - 1 },
    clearEnd: { x: point.x, y: point.y + radius + 1 },
    coloredStart: { x: point.x, y: point.y - radius - 2 },
    arcStart: { x: point.x, y: point.y - radius },
    arcEnd: { x: point.x, y: point.y + radius },
    coloredEnd: { x: point.x, y: point.y + radius + 2 },
  };
}

function pointMatches(point: EditorPoint, candidate: EditorPoint, tolerance = 0.001): boolean {
  return Math.hypot(point.x - candidate.x, point.y - candidate.y) <= tolerance;
}

export function getE4WireCrossings(
  objects: readonly EditorSceneObject[],
  layers: readonly EditorLayer[],
  junctions: readonly E4JunctionOverlay[] = [],
): readonly E4WireCrossing[] {
  const paintOrder = objectsInPaintOrder(objects, layers).filter((object) => object.kind === "wire");
  const result: E4WireCrossing[] = [];
  for (let overIndex = 1; overIndex < paintOrder.length; overIndex += 1) {
    const over = paintOrder[overIndex]!;
    const segments=(o:EditorSceneObject)=>(o.points??[]).slice(1).map((end,i)=>({start:o.points![i]!,end}));
    const overSegments = segments(over);
    for (let underIndex = 0; underIndex < overIndex; underIndex += 1) {
      const under = paintOrder[underIndex]!;
      const underSegments = segments(under);
      for (const overSegment of overSegments) {
        for (const underSegment of underSegments) {
          const hit=intersectSegments(overSegment,underSegment);
          if(hit.kind!=="point"||segmentsParallel(overSegment,underSegment))continue;
          const point=hit.point;
          const isJunction = junctions.some((junction) => pointMatches(junction.position, point));
          if (isJunction) continue;
          if (result.some((item) => item.overWireId === over.id && item.underWireId === under.id && pointMatches(item.point, point))) continue;
          const diagonal=[overSegment,underSegment].some(s=>s.start.x!==s.end.x&&s.start.y!==s.end.y);
          const direction=(s:typeof overSegment)=>{const n=Math.hypot(s.end.x-s.start.x,s.end.y-s.start.y),sign=s.end.x<s.start.x||s.end.x===s.start.x&&s.end.y<s.start.y?-1:1;return {x:(s.end.x-s.start.x)/n*sign,y:(s.end.y-s.start.y)/n*sign};};
          result.push({ point, overWireId: over.id, underWireId: under.id, overOrientation: overSegment.start.y===overSegment.end.y?"horizontal":"vertical",
            ...(diagonal?{overDirection:direction(overSegment),underDirection:direction(underSegment)}:{}) });
        }
      }
    }
  }
  return result;
}

export type E4ParallelSpan = ParallelSpan;

export function findE4CommonParallelSpan(objects:readonly EditorSceneObject[],wireIds:readonly string[]):E4ParallelSpan|null {
  return commonParallelSpan(wireIds.map(id=>({id,points:objects.find(o=>o.id===id&&o.kind==="wire")?.points??[]})));
}
export interface E4ScreenLayout {
  readonly id: string;
  readonly wireIds: readonly string[];
  readonly center: EditorPoint;
  readonly orientation: E4SegmentOrientation;
  readonly alongSize: number;
  readonly crossSize: number;
  readonly span: ScreenCrossSection;
  readonly spans: readonly ScreenCrossSection[];
  readonly pathLength: number;
  readonly bodyConnectionPoint: EditorPoint;
  readonly connectionPoint: EditorPoint;
  readonly terminalSide: "above" | "below";
  readonly terminals: readonly {
    readonly side: "above" | "below";
    readonly bodyConnectionPoint: EditorPoint;
    readonly connectionPoint: EditorPoint;
  }[];
}

export interface E4DifferentialPairMotif {
  readonly from: number;
  readonly center: number;
  readonly to: number;
  /** Coloured horizontal/vertical legs overlap the erased base conductors here. */
  readonly coloredFrom: number;
  readonly coloredTo: number;
}

export interface E4DifferentialPairLayout {
  readonly id: string;
  readonly wireIds: readonly [string, string];
  readonly variant: 1 | 2;
  readonly span: E4ParallelSpan;
  readonly crossMinimum: number;
  readonly crossMaximum: number;
  readonly motifs: readonly E4DifferentialPairMotif[];
}

export function getE4DifferentialPairLayout(
  group: E4DifferentialPairOverlay,
  objects: readonly EditorSceneObject[],
): E4DifferentialPairLayout | null {
  return getE4DifferentialPairLayouts(group,objects).sort((a,b)=>(b.span.end-b.span.start)-(a.span.end-a.span.start))[0]??null;
}

export function getE4DifferentialPairLayouts(group:E4DifferentialPairOverlay,objects:readonly EditorSceneObject[]):E4DifferentialPairLayout[] {
  return commonHorizontalPairSpans(group.wireIds.map(id=>({id,points:objects.find(o=>o.id===id&&o.kind==="wire")?.points??[]})))
    .flatMap(common=>pairLayoutsOnSpan(group,objects,common));
}

function pairLayoutsOnSpan(group:E4DifferentialPairOverlay,objects:readonly EditorSceneObject[],common:E4ParallelSpan):E4DifferentialPairLayout[] {
  const tables=objects.filter(object=>object.kind==="connector").map(table=>{
    if(!common.direction)return table;
    const corners=[{x:table.x,y:table.y},{x:table.x+table.width,y:table.y},{x:table.x,y:table.y+table.height},{x:table.x+table.width,y:table.y+table.height}].map(p=>parallelSpanLocal(common,p));
    const x=Math.min(...corners.map(p=>p.x)),y=Math.min(...corners.map(p=>p.y));
    return {x,y,width:Math.max(...corners.map(p=>p.x))-x,height:Math.max(...corners.map(p=>p.y))-y};
  });
  // Paint the pair directly on the shared horizontal segment of the real
  // routes. A wide legacy/manual bundle remains wide until its routes are
  // replanned; shifting only the painted motif would detach it from the wires.
  const rawCrossGap = Math.abs(common.crossMaximum - common.crossMinimum);
  const crossGap = rawCrossGap > 1e-6 ? rawCrossGap : Math.max(group.amplitude * 2, 1);
  const compactCrossCenter = (common.crossMinimum + common.crossMaximum) / 2;
  const compactCommon: E4ParallelSpan = {
    ...common,
    crossMinimum: compactCrossCenter - crossGap / 2,
    crossMaximum: compactCrossCenter + crossGap / 2,
  };
  return clearDecorationSpans([compactCommon], tables, 10,
    item => Math.max(group.amplitude * 2, item.crossMaximum - item.crossMinimum)).map(span=>{
  const available = span.end - span.start;
  // Keep the visible pitch at the smallest readable E4 increment. The stored
  // physical pitch may be larger, but it must not make a long common span look
  // like a handful of stretched loops.
  const visualStep = Math.max(connectorE4TableMetrics.rowHeight, group.step);
  const count = Math.max(1, Math.floor(available / visualStep));
  const spacing = available / count;
  const motifLength = Math.min(16, Math.max(8, spacing * 0.3));
  const crossCenter = (span.crossMinimum + span.crossMaximum) / 2;
  const crossMinimum = span.crossMinimum === span.crossMaximum
    ? crossCenter - group.amplitude
    : span.crossMinimum;
  const crossMaximum = span.crossMinimum === span.crossMaximum
    ? crossCenter + group.amplitude
    : span.crossMaximum;
  return {
    id: group.id,
    wireIds: group.wireIds,
    variant: group.variant ?? 1,
    span,
    crossMinimum,
    crossMaximum,
    motifs: Array.from({ length: count }, (_, index) => {
      const center = span.start + spacing * (index + 0.5);
      return {
        from: Math.max(span.start, center - motifLength / 2),
        center,
        to: Math.min(span.end, center + motifLength / 2),
        coloredFrom: Math.max(span.start, center - motifLength / 2 - 2),
        coloredTo: Math.min(span.end, center + motifLength / 2 + 2),
      };
    }),
  };
  });
}

export function getE4ScreenLayout(
  screen: E4ScreenOverlay,
  objects: readonly EditorSceneObject[],
): E4ScreenLayout | null {
  const candidates = screenCrossSections(screen.wireIds.map(id => {
    const wire=objects.find(object=>object.id===id && object.kind==="wire");
    return {id,points:wire ? getE4WireRoute(wire) : []};
  }));
  const spans = clearScreenSections(candidates, objects.filter(object => object.kind === "connector"),screen.width,e4ScreenAlongSize);
  if (spans.length === 0) return null;
  const orderedSpans = [...spans].sort((a,b)=>a.firstWireDirection*(a.start-b.start));
  const pathLength = orderedSpans.reduce((sum, item) => sum + (item.end - item.start), 0);
  const requestedDistance = pathLength * Math.max(0, Math.min(1, screen.position));
  let distance = 0;
  let span = orderedSpans[0]!;
  for (const candidate of orderedSpans) {
    const length = candidate.end - candidate.start;
    if (requestedDistance <= distance + length || candidate === orderedSpans.at(-1)) {
      span = candidate;
      break;
    }
    distance += length;
  }
  const spanOffset = Math.max(0, Math.min(span.end - span.start, requestedDistance - distance));
  const along = span.firstWireDirection === 1 ? span.start + spanOffset : span.end - spanOffset;
  const {center,crossSize,alongSize}=uprightScreenBody(span,along,screen.width,e4ScreenAlongSize);
  const configuredSide = screen.terminalSide ?? "above";
  const sides: readonly ("above" | "below")[] = configuredSide === "both"
    ? ["above", "below"]
    : [configuredSide];
  const terminals = sides.map((side) => {
    const direction = side === "above" ? -1 : 1;
    const bodyConnectionPoint = { x: center.x, y: center.y + direction * crossSize / 2 };
    const connectionPoint = bodyConnectionPoint;
    return { side, bodyConnectionPoint, connectionPoint };
  });
  const terminal = terminals[0]!;
  return {
    id: screen.id,
    wireIds: screen.wireIds,
    center,
    orientation: "horizontal",
    alongSize,
    crossSize,
    span,
    spans: orderedSpans,
    pathLength,
    bodyConnectionPoint: terminal.bodyConnectionPoint,
    connectionPoint: terminal.connectionPoint,
    terminalSide: terminal.side,
    terminals,
  };
}

export function hitTestE4DifferentialPair(
  groups: readonly E4DifferentialPairOverlay[],
  objects: readonly EditorSceneObject[],
  point: EditorPoint,
  zoom: number,
  layers?: readonly EditorLayer[],
): E4DifferentialPairLayout | null {
  const tolerance = 6 / zoom;
  const visibleObjects = layers ? objectsInPaintOrder(objects, layers) : objects;
  for (const group of [...groups].reverse()) {
    if (layers && !isE4OverlayVisible(group.wireIds, objects, layers)) continue;
    for(const layout of getE4DifferentialPairLayouts(group, visibleObjects)){
    const local=parallelSpanLocal(layout.span,point);
    const along = local.x;
    const cross = local.y;
    if (cross < layout.crossMinimum - tolerance || cross > layout.crossMaximum + tolerance) continue;
    if (layout.motifs.some((motif) => along >= motif.from - tolerance && along <= motif.to + tolerance)) {
      return layout;
    }
    }
  }
  return null;
}

/**
 * Finds common spans by route order, preserving bends shared by a routed
 * bundle. If routes do not have a compatible segment sequence the caller
 * falls back to the longest single span for backwards compatibility.
 */
export function getE4ScreenPositionForPoint(layout: E4ScreenLayout, point: EditorPoint): number {
  let accumulated = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestAlong = 0;
  for (const span of layout.spans) {
    const minimum = span.start;
    const maximum = span.end;
    const axis = span.orientation === "horizontal" ? point.x : point.y;
    const along = Math.max(minimum, Math.min(maximum, axis));
    const distance = Math.abs(axis - along);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestAlong = accumulated + (span.firstWireDirection === 1 ? along - minimum : maximum - along);
    }
    accumulated += maximum - minimum;
  }
  return layout.pathLength <= 0 ? 0 : Math.max(0, Math.min(1, bestAlong / layout.pathLength));
}

function segmentAxisDirection(segment: E4WireSegment, orientation: E4SegmentOrientation): 1 | -1 {
  const delta = orientation === "horizontal" ? segment.end.x - segment.start.x : segment.end.y - segment.start.y;
  return delta >= 0 ? 1 : -1;
}

export function hitTestE4Screen(
  screens: readonly E4ScreenOverlay[],
  objects: readonly EditorSceneObject[],
  point: EditorPoint,
  zoom: number,
  layers?: readonly EditorLayer[],
): E4ScreenLayout | null {
  const tolerance = 5 / zoom;
  const visibleObjects = layers ? objectsInPaintOrder(objects, layers) : objects;
  for (const screen of [...screens].reverse()) {
    const layout = getE4ScreenLayout(screen, visibleObjects);
    if (!layout) continue;
    const halfWidth = (layout.orientation === "horizontal" ? layout.alongSize : layout.crossSize) / 2 + tolerance;
    const halfHeight = (layout.orientation === "horizontal" ? layout.crossSize : layout.alongSize) / 2 + tolerance;
    const normalizedX = (point.x - layout.center.x) / halfWidth;
    const normalizedY = (point.y - layout.center.y) / halfHeight;
    if (normalizedX * normalizedX + normalizedY * normalizedY <= 1) return layout;
  }
  return null;
}

export function hitTestE4ScreenConnection(
  screens: readonly E4ScreenOverlay[],
  objects: readonly EditorSceneObject[],
  point: EditorPoint,
  zoom: number,
  layers?: readonly EditorLayer[],
): { readonly screenId: string; readonly screenTerminalSide: "above" | "below" } | null {
  const tolerance = 9 / Math.max(zoom, 0.01);
  const visibleObjects = layers ? objectsInPaintOrder(objects, layers) : objects;
  for (const screen of [...screens].reverse()) {
    if (layers && !isE4OverlayVisible(screen.wireIds, objects, layers)) continue;
    const layout = getE4ScreenLayout(screen, visibleObjects);
    const terminal = layout?.terminals.find((item) =>
      Math.hypot(point.x - item.connectionPoint.x, point.y - item.connectionPoint.y) <= tolerance);
    if (terminal) {
      return { screenId: screen.id, screenTerminalSide: terminal.side };
    }
  }
  return null;
}

export function hitTestE4WireLabel(
  objects: readonly EditorSceneObject[],
  layers: readonly EditorLayer[],
  point: EditorPoint,
  zoom: number,
): { readonly wireId: string } | null {
  const tolerance = 3 / Math.max(zoom, 0.01);
  for (const object of [...objectsInPaintOrder(objects, layers)].reverse()) {
    if (object.kind !== "wire" || !object.label) continue;
    const rawPosition = Number(object.metadata?.e4LabelPosition ?? "0.5");
    const position = Number.isFinite(rawPosition) && rawPosition >= 0 && rawPosition <= 1 ? rawPosition : 0.5;
    const layout = getE4WireLabelLayout(getE4WireRoute(object), object.label, position);
    if (layout && point.x >= layout.x - tolerance && point.x <= layout.x + layout.width + tolerance &&
        point.y >= layout.y - tolerance && point.y <= layout.y + layout.height + tolerance) {
      return { wireId: object.id };
    }
  }
  return null;
}

function isE4OverlayVisible(
  wireIds: readonly string[],
  objects: readonly EditorSceneObject[],
  layers: readonly EditorLayer[],
): boolean {
  if (wireIds.length === 0) return false;
  const layerMap = new Map(layers.map((layer) => [layer.id, layer]));
  return wireIds.every((wireId) => {
    const wire = objects.find((object) => object.id === wireId && object.kind === "wire");
    return wire !== undefined && layerMap.get(wire.layerId)?.visible === true;
  });
}

export function getVisibleE4SceneOverlays(
  overlays: E4SceneOverlays,
  objects: readonly EditorSceneObject[],
  layers: readonly EditorLayer[],
): E4SceneOverlays {
  return {
    crossingStyle: overlays.crossingStyle,
    junctions: overlays.junctions.filter((junction) =>
      isE4OverlayVisible(junction.wireIds, objects, layers)),
    diffPairs: overlays.diffPairs.filter((group) =>
      isE4OverlayVisible(group.wireIds, objects, layers)),
    screens: overlays.screens.filter((screen) =>
      isE4OverlayVisible(screen.wireIds, objects, layers)),
  };
}
