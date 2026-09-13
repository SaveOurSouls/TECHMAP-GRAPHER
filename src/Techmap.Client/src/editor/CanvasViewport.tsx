import { useEffect, useRef, useState, type DragEvent, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import {
  panEditorCamera,
  screenToWorld,
  zoomEditorCameraFromWheel,
  type EditorSceneBounds,
  type EditorViewportSize,
} from "./editor-camera";
import type {
  EditorCamera,
  EditorLayer,
  EditorPoint,
  EditorSceneObject,
  EditorTool,
  HarnessEditorView,
} from "./editor-types";

export interface CanvasViewportProps {
  readonly view: HarnessEditorView;
  readonly tool: EditorTool;
  readonly camera: EditorCamera;
  readonly objects: readonly EditorSceneObject[];
  readonly layers: readonly EditorLayer[];
  readonly selectedObjectId: string | null;
  readonly selectedObjectIds?: readonly string[];
  readonly e4Overlays?: E4SceneOverlays;
  readonly overlay?: ReactNode;
  readonly inlineEditor?: ReactNode;
  readonly onCameraChange: (camera: EditorCamera) => void;
  readonly onViewportSizeChange?: (size: EditorViewportSize) => void;
  readonly onObjectSelect: (objectId: string | null, additive?: boolean) => void;
  readonly onObjectMove?: (objectId: string, point: EditorPoint) => void;
  readonly onWireConnect?: (
    from: { readonly connectorId: string; readonly contactIndex: number },
    to: { readonly connectorId: string; readonly contactIndex: number },
  ) => void;
  readonly onWireReconnect?: (
    wireId: string,
    end: "from" | "to",
    target: { readonly connectorId: string; readonly contactIndex: number },
  ) => void;
  readonly onWireConnectToWire?: (
    from: { readonly connectorId: string; readonly contactIndex: number },
    targetWireId: string,
    point: EditorPoint,
  ) => void;
  readonly onWireReconnectToWire?: (
    wireId: string,
    end: "from" | "to",
    targetWireId: string,
    point: EditorPoint,
  ) => void;
  readonly onE4WireSegmentMove?: (wireId: string, segmentIndex: number, coordinate: number) => void;
  readonly onE4ScreenPositionChange?: (screenId: string, position: number) => void;
  readonly onWireRoutePointMove?: (wireId: string, routeIndex: number, point: EditorPoint) => void;
  readonly onWireRoutePointRemove?: (wireId: string, routeIndex: number) => void;
  readonly onCanvasDoubleClick?: (point: EditorPoint) => void;
  readonly onCatalogDrop: (itemId: string, point: EditorPoint) => void;
}

interface EditorViewportWheelEvent {
  readonly ctrlKey: boolean;
  readonly deltaY: number;
  readonly clientX: number;
  readonly clientY: number;
  preventDefault: () => void;
}

/** Handles Ctrl+wheel for the whole viewport, including HTML controls over the canvas. */
export function handleEditorViewportWheel(
  event: EditorViewportWheelEvent,
  camera: EditorCamera,
  canvasBounds: Pick<DOMRect, "left" | "top">,
  onCameraChange: (camera: EditorCamera) => void,
): boolean {
  if (!event.ctrlKey || event.deltaY === 0) return false;
  event.preventDefault();
  const anchor = { x: event.clientX - canvasBounds.left, y: event.clientY - canvasBounds.top };
  onCameraChange(zoomEditorCameraFromWheel(camera, anchor, event.deltaY, event.ctrlKey));
  return true;
}

export function containInlineEditorPointerEvent(event: Pick<PointerEvent<HTMLElement>, "stopPropagation">): void {
  event.stopPropagation();
}

interface PointerDrag {
  readonly kind: "pan";
  readonly pointerId: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly camera: EditorCamera;
}

interface ObjectPointerDrag {
  readonly kind: "object";
  readonly pointerId: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly objectId: string;
  readonly objectX: number;
  readonly objectY: number;
}

interface WireRoutePointerDrag {
  readonly kind: "wire-route";
  readonly pointerId: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly wireId: string;
  readonly routeIndex: number;
  readonly point: EditorPoint;
}

interface E4WireSegmentPointerDrag {
  readonly kind: "e4-wire-segment";
  readonly pointerId: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly wireId: string;
  readonly segmentIndex: number;
  readonly orientation: E4SegmentOrientation;
  readonly coordinate: number;
}

interface E4ScreenPointerDrag {
  readonly kind: "e4-screen";
  readonly pointerId: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly screenId: string;
  readonly orientation: E4SegmentOrientation;
  readonly position: number;
  readonly spanLength: number;
}

export const E4_WIRE_LEAD_LENGTH = 24;
export type E4SegmentOrientation = "horizontal" | "vertical";
export type E4ContactSide = "left" | "right";

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
}

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

function appendUnique(points: EditorPoint[], point: EditorPoint) {
  if (!samePoint(points.at(-1) ?? point, point) || points.length === 0) points.push(point);
}

function sideDirection(side: E4ContactSide): number {
  return side === "left" ? -1 : 1;
}

/**
 * Produces the E4 display route. Every connector endpoint starts with a
 * horizontal 24-world-unit lead. Intermediate points are joined by Manhattan
 * elbows; Drawing routes never use this helper.
 */
export function buildE4OrthogonalRoute(
  input: readonly EditorPoint[],
  options: Readonly<{
    leadLength?: number;
    fromSide?: E4ContactSide;
    toSide?: E4ContactSide;
  }> = {},
): readonly EditorPoint[] {
  const source = input.filter(finitePoint);
  if (source.length < 2) return source;
  const start = source[0]!;
  const end = source.at(-1)!;
  const inferredFromSide: E4ContactSide = end.x >= start.x ? "right" : "left";
  const inferredToSide: E4ContactSide = inferredFromSide === "right" ? "left" : "right";
  const leadLength = Number.isFinite(options.leadLength) && (options.leadLength ?? 0) > 0
    ? options.leadLength!
    : E4_WIRE_LEAD_LENGTH;
  const startLead = {
    x: start.x + sideDirection(options.fromSide ?? inferredFromSide) * leadLength,
    y: start.y,
  };
  const endLead = {
    x: end.x + sideDirection(options.toSide ?? inferredToSide) * leadLength,
    y: end.y,
  };
  const waypoints = [start, startLead, ...source.slice(1, -1), endLead, end];
  const result: EditorPoint[] = [];
  for (const target of waypoints) {
    const current = result.at(-1);
    if (!current) {
      result.push(target);
      continue;
    }
    if (current.x !== target.x && current.y !== target.y) {
      appendUnique(result, { x: target.x, y: current.y });
    }
    appendUnique(result, target);
  }
  return result;
}

function metadataSide(value: string | undefined): E4ContactSide | undefined {
  return value === "left" || value === "right" ? value : undefined;
}

export function getE4WireRoute(object: EditorSceneObject): readonly EditorPoint[] {
  if (object.kind !== "wire") return object.points ?? [];
  const points = object.points ?? [];
  if (object.metadata?.view === "e4" || object.metadata?.routeComplete === "true") return points;
  const leadLengthValue = Number(object.metadata?.leadLength);
  const leadLength = Number.isFinite(leadLengthValue) && leadLengthValue > 0 ? leadLengthValue : E4_WIRE_LEAD_LENGTH;
  if (points.length >= 4 && isCompleteE4Route(points, metadataSide(object.metadata?.fromSide), metadataSide(object.metadata?.toSide), leadLength)) {
    return points;
  }
  return buildE4OrthogonalRoute(points, {
    leadLength: Number.isFinite(leadLengthValue) && leadLengthValue > 0 ? leadLengthValue : undefined,
    fromSide: metadataSide(object.metadata?.fromSide),
    toSide: metadataSide(object.metadata?.toSide),
  });
}

function isCompleteE4Route(
  points: readonly EditorPoint[],
  fromSide: E4ContactSide | undefined,
  toSide: E4ContactSide | undefined,
  leadLength: number,
): boolean {
  if (e4WireSegments(points).length !== points.length - 1) return false;
  const start = points[0]!;
  const startLead = points[1]!;
  const endLead = points.at(-2)!;
  const end = points.at(-1)!;
  const startDistance = fromSide === "left" ? start.x - startLead.x : startLead.x - start.x;
  const endDistance = toSide === "left" ? end.x - endLead.x : endLead.x - end.x;
  return start.y === startLead.y && end.y === endLead.y &&
    (fromSide === undefined || startDistance >= leadLength) &&
    (toSide === undefined || endDistance >= leadLength);
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

export function moveE4OrthogonalSegment(
  points: readonly EditorPoint[],
  segmentIndex: number,
  coordinate: number,
): readonly EditorPoint[] {
  if (!Number.isFinite(coordinate)) return points;
  const result = points.map((point) => ({ ...point }));
  const start = result[segmentIndex];
  const end = result[segmentIndex + 1];
  if (!start || !end || segmentIndex <= 0 || segmentIndex >= result.length - 2) return points;
  if (start.y === end.y) {
    result[segmentIndex] = { ...start, y: coordinate };
    result[segmentIndex + 1] = { ...end, y: coordinate };
    return result;
  }
  if (start.x === end.x) {
    result[segmentIndex] = { ...start, x: coordinate };
    result[segmentIndex + 1] = { ...end, x: coordinate };
    return result;
  }
  return points;
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
      ? [{ id: item.id, wireIds, position, width, label: typeof item.label === "string" ? item.label : "" }]
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
    const overSegments = e4WireSegments(getE4WireRoute(over));
    for (let underIndex = 0; underIndex < overIndex; underIndex += 1) {
      const under = paintOrder[underIndex]!;
      const underSegments = e4WireSegments(getE4WireRoute(under));
      for (const overSegment of overSegments) {
        for (const underSegment of underSegments) {
          if (overSegment.orientation === underSegment.orientation) continue;
          const horizontal = overSegment.orientation === "horizontal" ? overSegment : underSegment;
          const vertical = overSegment.orientation === "vertical" ? overSegment : underSegment;
          const point = { x: vertical.start.x, y: horizontal.start.y };
          const onHorizontal = point.x >= Math.min(horizontal.start.x, horizontal.end.x) &&
            point.x <= Math.max(horizontal.start.x, horizontal.end.x);
          const onVertical = point.y >= Math.min(vertical.start.y, vertical.end.y) &&
            point.y <= Math.max(vertical.start.y, vertical.end.y);
          const isJunction = junctions.some((junction) => pointMatches(junction.position, point));
          if (!onHorizontal || !onVertical || isJunction) continue;
          if (result.some((item) => item.overWireId === over.id && item.underWireId === under.id && pointMatches(item.point, point))) continue;
          result.push({ point, overWireId: over.id, underWireId: under.id, overOrientation: overSegment.orientation });
        }
      }
    }
  }
  return result;
}

export interface E4ParallelSpan {
  readonly orientation: E4SegmentOrientation;
  readonly start: number;
  readonly end: number;
  readonly crossMinimum: number;
  readonly crossMaximum: number;
  readonly segmentByWireId: Readonly<Record<string, E4WireSegment>>;
}

export function findE4CommonParallelSpan(
  objects: readonly EditorSceneObject[],
  wireIds: readonly string[],
): E4ParallelSpan | null {
  const wires = wireIds.map((wireId) => objects.find((object) => object.id === wireId && object.kind === "wire"));
  if (wires.some((wire) => wire === undefined) || wires.length === 0) return null;
  let best: E4ParallelSpan | null = null;
  for (const orientation of ["horizontal", "vertical"] as const) {
    const segmentsByWire = wires.map((wire) => e4WireSegments(getE4WireRoute(wire!))
      .filter((segment) => segment.orientation === orientation)
      .map((segment) => ({
        segment,
        start: orientation === "horizontal"
          ? Math.min(segment.start.x, segment.end.x)
          : Math.min(segment.start.y, segment.end.y),
        end: orientation === "horizontal"
          ? Math.max(segment.start.x, segment.end.x)
          : Math.max(segment.start.y, segment.end.y),
      })));
    if (segmentsByWire.some((segments) => segments.length === 0)) continue;

    // In an optimal choice the common start is the start of at least one
    // selected segment. At each such candidate, choosing the covering segment
    // with the furthest end for every wire dominates every other choice. This
    // turns the former Cartesian-product search into a polynomial scan.
    const candidateStarts = [...new Set(segmentsByWire.flatMap((segments) =>
      segments.map((item) => item.start)))].sort((left, right) => left - right);
    for (const start of candidateStarts) {
      const chosen: E4WireSegment[] = [];
      let end = Number.POSITIVE_INFINITY;
      for (const segments of segmentsByWire) {
        let furthest: (typeof segments)[number] | null = null;
        for (const candidate of segments) {
          if (candidate.start > start || candidate.end <= start) continue;
          if (!furthest || candidate.end > furthest.end) furthest = candidate;
        }
        if (!furthest) {
          chosen.length = 0;
          break;
        }
        chosen.push(furthest.segment);
        end = Math.min(end, furthest.end);
      }
      if (chosen.length !== wires.length || end <= start || best && best.end - best.start >= end - start) continue;
      const crosses = chosen.map((segment) => orientation === "horizontal" ? segment.start.y : segment.start.x);
      best = {
        orientation,
        start,
        end,
        crossMinimum: Math.min(...crosses),
        crossMaximum: Math.max(...crosses),
        segmentByWireId: Object.fromEntries(wireIds.map((wireId, index) => [wireId, chosen[index]!])),
      };
    }
  }
  return best;
}

export interface E4ScreenLayout {
  readonly id: string;
  readonly wireIds: readonly string[];
  readonly center: EditorPoint;
  readonly orientation: E4SegmentOrientation;
  readonly alongSize: number;
  readonly crossSize: number;
  readonly span: E4ParallelSpan;
  readonly spans: readonly E4ParallelSpan[];
  readonly pathLength: number;
}

export interface E4DifferentialPairMotif {
  readonly from: number;
  readonly center: number;
  readonly to: number;
}

export interface E4DifferentialPairLayout {
  readonly id: string;
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
  const span = findE4CommonParallelSpan(objects, group.wireIds);
  if (!span) return null;
  const available = span.end - span.start;
  const step = Math.max(18, group.step);
  const count = Math.max(1, Math.floor(available / step));
  const margin = Math.min(step / 2, available / (count + 1));
  const motifLength = Math.min(18, step * 0.55);
  const crossCenter = (span.crossMinimum + span.crossMaximum) / 2;
  const crossMinimum = span.crossMinimum === span.crossMaximum
    ? crossCenter - group.amplitude
    : span.crossMinimum;
  const crossMaximum = span.crossMinimum === span.crossMaximum
    ? crossCenter + group.amplitude
    : span.crossMaximum;
  return {
    id: group.id,
    variant: group.variant ?? 1,
    span,
    crossMinimum,
    crossMaximum,
    motifs: Array.from({ length: count }, (_, index) => {
      const center = Math.min(span.end - margin, span.start + margin + index * step);
      return {
        from: Math.max(span.start, center - motifLength / 2),
        center,
        to: Math.min(span.end, center + motifLength / 2),
      };
    }),
  };
}

export function getE4ScreenLayout(
  screen: E4ScreenOverlay,
  objects: readonly EditorSceneObject[],
): E4ScreenLayout | null {
  const alignedSpans = findE4AlignedParallelSpans(objects, screen.wireIds);
  const fallbackSpan = findE4CommonParallelSpan(objects, screen.wireIds);
  const spans = alignedSpans.length > 0 ? alignedSpans : fallbackSpan ? [fallbackSpan] : [];
  if (spans.length === 0) return null;
  const pathLength = spans.reduce((sum, item) => sum + (item.end - item.start), 0);
  const requestedDistance = pathLength * Math.max(0, Math.min(1, screen.position));
  let distance = 0;
  let span = spans[0]!;
  for (const candidate of spans) {
    const length = candidate.end - candidate.start;
    if (requestedDistance <= distance + length || candidate === spans.at(-1)) {
      span = candidate;
      break;
    }
    distance += length;
  }
  const along = span.start + Math.max(0, Math.min(span.end - span.start, requestedDistance - distance));
  const cross = (span.crossMinimum + span.crossMaximum) / 2;
  return {
    id: screen.id,
    wireIds: screen.wireIds,
    center: span.orientation === "horizontal" ? { x: along, y: cross } : { x: cross, y: along },
    orientation: span.orientation,
    alongSize: Math.max(10, screen.width),
    crossSize: Math.max(18, span.crossMaximum - span.crossMinimum + 18),
    span,
    spans,
    pathLength,
  };
}

/**
 * Finds common spans by route order, preserving bends shared by a routed
 * bundle. If routes do not have a compatible segment sequence the caller
 * falls back to the longest single span for backwards compatibility.
 */
function findE4AlignedParallelSpans(
  objects: readonly EditorSceneObject[],
  wireIds: readonly string[],
): readonly E4ParallelSpan[] {
  const wires = wireIds.map((wireId) => objects.find((object) => object.id === wireId && object.kind === "wire"));
  if (wires.length === 0 || wires.some((wire) => wire === undefined)) return [];
  const segmentLists = wires.map((wire) => e4WireSegments(getE4WireRoute(wire!)));
  if (segmentLists.some((segments) => segments.length !== segmentLists[0]!.length)) return [];
  const count = Math.min(...segmentLists.map((segments) => segments.length));
  const result: E4ParallelSpan[] = [];
  for (let index = 0; index < count; index += 1) {
    const selected = segmentLists.map((segments) => segments[index]!);
    if (selected.some((segment) => segment.orientation !== selected[0]!.orientation)) return [];
    const orientation = selected[0]!.orientation;
    const starts = selected.map((segment) => orientation === "horizontal"
      ? Math.min(segment.start.x, segment.end.x)
      : Math.min(segment.start.y, segment.end.y));
    const ends = selected.map((segment) => orientation === "horizontal"
      ? Math.max(segment.start.x, segment.end.x)
      : Math.max(segment.start.y, segment.end.y));
    const start = Math.max(...starts);
    const end = Math.min(...ends);
    if (end <= start) continue;
    const crosses = selected.map((segment) => orientation === "horizontal" ? segment.start.y : segment.start.x);
    result.push({
      orientation,
      start,
      end,
      crossMinimum: Math.min(...crosses),
      crossMaximum: Math.max(...crosses),
      segmentByWireId: Object.fromEntries(wireIds.map((wireId, wireIndex) => [wireId, selected[wireIndex]!])),
    });
  }
  return result;
}

function getE4ScreenPositionForPoint(layout: E4ScreenLayout, point: EditorPoint): number {
  let accumulated = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestAlong = 0;
  for (const span of layout.spans) {
    const minimum = span.start;
    const maximum = span.end;
    const axis = span.orientation === "horizontal" ? point.x : point.y;
    const cross = span.orientation === "horizontal" ? point.y : point.x;
    const along = Math.max(minimum, Math.min(maximum, axis));
    const distance = Math.hypot(axis - along, cross - (span.crossMinimum + span.crossMaximum) / 2);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestAlong = accumulated + along - minimum;
    }
    accumulated += maximum - minimum;
  }
  return layout.pathLength <= 0 ? 0 : Math.max(0, Math.min(1, bestAlong / layout.pathLength));
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

function pointToSegmentDistance(point: EditorPoint, start: EditorPoint, end: EditorPoint): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

function containsPoint(
  object: EditorSceneObject,
  point: EditorPoint,
  tolerance: number,
  view?: HarnessEditorView,
): boolean {
  if (object.kind === "wire" || object.kind === "dimension") {
    const points = view === "e4" && object.kind === "wire" ? getE4WireRoute(object) : object.points ?? [];
    for (let index = 1; index < points.length; index += 1) {
      const start = points[index - 1];
      const end = points[index];
      if (start && end && pointToSegmentDistance(point, start, end) <= tolerance) return true;
    }
    return false;
  }
  const e4Layout = view === "drawing" ? null : getE4ConnectorLayout(object);
  const width = e4Layout?.width ?? object.width;
  const height = e4Layout?.height ?? object.height;
  if (point.x >= object.x - tolerance && point.x <= object.x + width + tolerance &&
      point.y >= object.y - tolerance && point.y <= object.y + height + tolerance) return true;
  if (!e4Layout) return false;
  return e4Layout.rows.some((row, rowIndex) => {
    const marker = e4ContactMarker(row.status, e4Layout.connectionSide);
    if (!marker) return false;
    const anchor = e4Layout.contactPoints[rowIndex]!;
    const lineStart = { x: anchor.x + marker.lineStart.x, y: anchor.y + marker.lineStart.y };
    const lineEnd = { x: anchor.x + marker.lineEnd.x, y: anchor.y + marker.lineEnd.y };
    const crossCenter = { x: anchor.x + marker.crossCenter.x, y: anchor.y + marker.crossCenter.y };
    const crossStartA = { x: crossCenter.x - marker.crossSize, y: crossCenter.y - marker.crossSize };
    const crossEndA = { x: crossCenter.x + marker.crossSize, y: crossCenter.y + marker.crossSize };
    const crossStartB = { x: crossCenter.x - marker.crossSize, y: crossCenter.y + marker.crossSize };
    const crossEndB = { x: crossCenter.x + marker.crossSize, y: crossCenter.y - marker.crossSize };
    return pointToSegmentDistance(point, lineStart, lineEnd) <= tolerance ||
      pointToSegmentDistance(point, crossStartA, crossEndA) <= tolerance ||
      pointToSegmentDistance(point, crossStartB, crossEndB) <= tolerance;
  });
}

export function hitTestWireRoutePoint(
  object: EditorSceneObject | undefined,
  point: EditorPoint,
  zoom: number,
): number | null {
  if (object?.kind !== "wire") return null;
  const points = object.points ?? [];
  const tolerance = 10 / zoom;
  for (let pointIndex = 1; pointIndex < points.length - 1; pointIndex += 1) {
    const candidate = points[pointIndex]!;
    if (Math.hypot(point.x - candidate.x, point.y - candidate.y) <= tolerance) return pointIndex - 1;
  }
  return null;
}

export function hitTestWireEnd(
  object: EditorSceneObject | undefined,
  point: EditorPoint,
  zoom: number,
): "from" | "to" | null {
  if (object?.kind !== "wire") return null;
  const points = object.points ?? [];
  if (points.length < 2) return null;
  const tolerance = 10 / zoom;
  if (Math.hypot(point.x - points[0]!.x, point.y - points[0]!.y) <= tolerance) return "from";
  const last = points.at(-1)!;
  return Math.hypot(point.x - last.x, point.y - last.y) <= tolerance ? "to" : null;
}

function contactCount(object: EditorSceneObject): number {
  const value = Number(object.metadata?.contactCount ?? "0");
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

const e4BaseColumnIds = ["color", "wire", "terminal", "circuit", "contactType", "number"] as const;
type E4BaseColumnId = typeof e4BaseColumnIds[number];
type E4ColumnId = E4BaseColumnId | `custom:${string}`;
type E4ConnectionSide = "left" | "right";

interface E4ContactRow {
  readonly number: number;
  readonly type: string;
  readonly circuit: string;
  readonly terminal: string;
  readonly wire: string;
  readonly color: string;
  readonly status: "available" | "not-connected";
  readonly customValues: Readonly<Record<string, string>>;
}

export interface E4ConnectorColumnLayout {
  readonly id: E4ColumnId;
  readonly label: string;
  readonly x: number;
  readonly width: number;
}

export interface E4ConnectorLayout {
  readonly designation: string;
  readonly partNumber: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly titleHeight: number;
  readonly headerHeight: number;
  readonly rowHeight: number;
  readonly footerHeight: number;
  readonly connectionSide: E4ConnectionSide;
  readonly columns: readonly E4ConnectorColumnLayout[];
  readonly rows: readonly E4ContactRow[];
  readonly contactPoints: readonly EditorPoint[];
}

const e4ColumnLabels: Readonly<Record<E4BaseColumnId, string>> = {
  color: "Цвет",
  wire: "Провод",
  terminal: "Терминал",
  circuit: "Цепь",
  contactType: "Тип",
  number: "№",
};

const e4ColumnWidths: Readonly<Record<E4BaseColumnId, number>> = {
  color: 80,
  wire: 132,
  terminal: 132,
  circuit: 140,
  contactType: 96,
  number: 44,
};

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(value: string | undefined): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function isE4ColumnId(value: unknown): value is E4ColumnId {
  return typeof value === "string" &&
    ((e4BaseColumnIds as readonly string[]).includes(value) || /^custom:[^:]+$/.test(value));
}

function isCustomE4ColumnId(value: E4ColumnId): value is `custom:${string}` {
  return value.startsWith("custom:");
}

function parseE4Columns(value: string | undefined, connectionSide: E4ConnectionSide): readonly E4ColumnId[] {
  const parsed = parseJson(value);
  const unique = Array.isArray(parsed) && parsed.every(isE4ColumnId) && new Set(parsed).size === parsed.length
    ? parsed
    : null;
  const defaultColumns: readonly E4ColumnId[] = connectionSide === "right"
    ? e4BaseColumnIds
    : [...e4BaseColumnIds].reverse();
  if (!unique) return defaultColumns;
  return unique;
}

function parseStringRecord(value: unknown): Readonly<Record<string, string>> | null {
  if (!isRecord(value)) return value === undefined ? {} : null;
  if (Object.values(value).some((item) => typeof item !== "string")) return null;
  return value as Readonly<Record<string, string>>;
}

function parseE4Rows(value: string | undefined): readonly E4ContactRow[] | null {
  const parsed = parseJson(value);
  if (!Array.isArray(parsed)) return null;
  const rows: E4ContactRow[] = [];
  for (const item of parsed) {
    if (!isRecord(item) || !Number.isSafeInteger(item.number) || (item.number as number) < 1) return null;
    const contactType = typeof item.contactType === "string" ? item.contactType : item.type;
    const textValues = [contactType, item.circuit, item.terminal, item.wire, item.color];
    const customValues = parseStringRecord(item.customValues ?? item.values);
    if (!textValues.every((entry) => typeof entry === "string") || customValues === null ||
        (item.status !== "available" && item.status !== "not-connected")) return null;
    rows.push({
      number: item.number as number,
      type: contactType as string,
      circuit: item.circuit as string,
      terminal: item.terminal as string,
      wire: item.wire as string,
      color: item.color as string,
      status: item.status,
      customValues,
    });
  }
  return rows;
}

function e4CellText(row: E4ContactRow, column: E4ColumnId): string {
  if (column === "number") return String(row.number);
  if (isCustomE4ColumnId(column)) return row.customValues[column.slice("custom:".length)] ?? "";
  if (column === "contactType") return row.type;
  return row[column];
}

export interface E4ContactMarkerGeometry {
  readonly lineStart: EditorPoint;
  readonly lineEnd: EditorPoint;
  readonly crossCenter: EditorPoint;
  readonly crossSize: number;
}

/**
 * Returns the geometry for the dedicated E4 "not connected" glyph.  The
 * contact remains the anchor; a short lead and a diagonal cross are drawn
 * outside the connector.  This deliberately does not use a text "--X"
 * marker, so the glyph mirrors with the connector's connection side.
 */
export function e4ContactMarker(
  status: E4ContactRow["status"],
  connectionSide: E4ConnectionSide,
): E4ContactMarkerGeometry | null {
  if (status !== "not-connected") return null;
  const direction = connectionSide === "left" ? -1 : 1;
  const lineLength = 12;
  const crossOffset = 16;
  return {
    lineStart: { x: 0, y: 0 },
    lineEnd: { x: direction * lineLength, y: 0 },
    crossCenter: { x: direction * crossOffset, y: 0 },
    crossSize: 5,
  };
}

/**
 * E4 connector metadata contract:
 * { view: "e4", orientation: "left" | "right", designation: string,
 *   partNumber?: string, columns: JSON.stringify(E4ColumnId[]),
 *   columnLabels?: JSON.stringify(Record<string, string>),
 *   rows: JSON.stringify({ number, contactType, circuit, terminal, wire, color,
 *     status: "available" | "not-connected", customValues: Record<string, string> }[]) }.
 * The orientation names the outer contact side. Invalid metadata deliberately
 * returns null so legacy contactCount connectors keep their compact renderer.
 */
export function getE4ConnectorLayout(object: EditorSceneObject): E4ConnectorLayout | null {
  if (object.kind !== "connector" || object.metadata?.view !== "e4") return null;
  const connectionSide = object.metadata.orientation === "left"
    ? "left"
    : object.metadata.orientation === "right" ? "right" : null;
  const rows = parseE4Rows(object.metadata.rows);
  if (!connectionSide || rows === null) return null;
  const columnIds = parseE4Columns(object.metadata.columns, connectionSide);
  const columnLabels = parseStringRecord(parseJson(object.metadata.columnLabels)) ?? {};
  const widths = new Map<E4ColumnId, number>(columnIds.map((column) => [
    column,
    isCustomE4ColumnId(column) ? 120 : e4ColumnWidths[column],
  ]));
  const designation = object.metadata.designation?.trim() || object.label;
  const partNumber = object.metadata.partNumber?.trim() ?? "";
  const columnWidth = columnIds.reduce((total, column) => total + (widths.get(column) ?? 0), 0);
  const width = Math.max(118, columnWidth);
  const titleHeight = 24;
  const headerHeight = 28;
  const rowHeight = 24;
  const footerHeight = 24;
  const height = titleHeight + headerHeight + rows.length * rowHeight + footerHeight;
  let columnX = object.x;
  const columns = columnIds.map((id) => {
    const column = {
      id,
      label: columnLabels[id] ?? (isCustomE4ColumnId(id) ? id.slice("custom:".length) : e4ColumnLabels[id]),
      x: columnX,
      width: widths.get(id)!,
    };
    columnX += column.width;
    return column;
  });
  const contactX = connectionSide === "left" ? object.x : object.x + width;
  const contactPoints = rows.map((_, index) => ({
    x: contactX,
    y: object.y + titleHeight + headerHeight + index * rowHeight + rowHeight / 2,
  }));
  return {
    designation,
    partNumber,
    x: object.x,
    y: object.y,
    width,
    height,
    titleHeight,
    headerHeight,
    rowHeight,
    footerHeight,
    connectionSide,
    columns,
    rows,
    contactPoints,
  };
}

function legacyConnectorContactPoints(object: EditorSceneObject): readonly EditorPoint[] {
  const count = contactCount(object);
  if (object.kind !== "connector" || count === 0) return [];
  const spacing = (object.height - 44) / count;
  return Array.from({ length: count }, (_, index) => ({
    x: object.x + object.width,
    y: object.y + 28 + index * spacing,
  }));
}

export function hitTestConnectorContact(
  objects: readonly EditorSceneObject[],
  layers: readonly EditorLayer[],
  point: EditorPoint,
  zoom: number,
  view?: HarnessEditorView,
): { readonly connectorId: string; readonly contactIndex: number } | null {
  const layerMap = new Map(layers.map((layer) => [layer.id, layer]));
  const tolerance = 10 / zoom;
  for (const object of [...objects].reverse()) {
    if (object.kind !== "connector" || layerMap.get(object.layerId)?.visible !== true) continue;
    const e4Layout = view === "drawing" ? null : getE4ConnectorLayout(object);
    const points = e4Layout?.contactPoints ?? legacyConnectorContactPoints(object);
    for (let index = 0; index < points.length; index += 1) {
      const candidate = points[index]!;
      if (e4Layout?.rows[index]?.status === "not-connected") continue;
      if (e4Layout && Math.hypot(point.x - candidate.x, point.y - candidate.y) <= tolerance) {
        return { connectorId: object.id, contactIndex: index };
      }
      if (e4Layout) continue;
      const left = { x: object.x, y: candidate.y };
      if (Math.hypot(point.x - candidate.x, point.y - candidate.y) <= tolerance ||
          Math.hypot(point.x - left.x, point.y - left.y) <= tolerance) {
        return { connectorId: object.id, contactIndex: index };
      }
    }
  }
  return null;
}

export function objectsInPaintOrder(
  objects: readonly EditorSceneObject[],
  layers: readonly EditorLayer[],
): readonly EditorSceneObject[] {
  const objectGroups = new Map<string, EditorSceneObject[]>();
  for (const object of objects) {
    const group = objectGroups.get(object.layerId) ?? [];
    group.push(object);
    objectGroups.set(object.layerId, group);
  }

  const result: EditorSceneObject[] = [];
  for (const layer of [...layers].reverse()) {
    if (layer.visible) result.push(...(objectGroups.get(layer.id) ?? []));
  }
  return result;
}

export function hitTestEditorScene(
  objects: readonly EditorSceneObject[],
  layers: readonly EditorLayer[],
  point: EditorPoint,
  zoom: number,
  view?: HarnessEditorView,
): string | null {
  const paintOrder = objectsInPaintOrder(objects, layers);
  const tolerance = 7 / zoom;
  for (let index = paintOrder.length - 1; index >= 0; index -= 1) {
    const object = paintOrder[index];
    if (object && containsPoint(object, point, tolerance, view)) return object.id;
  }
  return null;
}

function roundedRectangle(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

function drawGrid(context: CanvasRenderingContext2D, width: number, height: number, camera: EditorCamera) {
  context.fillStyle = "#f8fafb";
  context.fillRect(0, 0, width, height);
  const minorStep = 20 * camera.zoom;
  const majorStep = 100 * camera.zoom;
  if (minorStep >= 8) {
    context.fillStyle = "#dfe6ea";
    const startX = ((camera.offsetX % minorStep) + minorStep) % minorStep;
    const startY = ((camera.offsetY % minorStep) + minorStep) % minorStep;
    for (let x = startX; x < width; x += minorStep) {
      for (let y = startY; y < height; y += minorStep) context.fillRect(Math.round(x), Math.round(y), 1, 1);
    }
  }
  context.strokeStyle = "#d6e0e5";
  context.lineWidth = 1;
  context.beginPath();
  const majorX = ((camera.offsetX % majorStep) + majorStep) % majorStep;
  const majorY = ((camera.offsetY % majorStep) + majorStep) % majorStep;
  for (let x = majorX; x < width; x += majorStep) {
    context.moveTo(Math.round(x) + 0.5, 0);
    context.lineTo(Math.round(x) + 0.5, height);
  }
  for (let y = majorY; y < height; y += majorStep) {
    context.moveTo(0, Math.round(y) + 0.5);
    context.lineTo(width, Math.round(y) + 0.5);
  }
  context.stroke();
}

function drawE4CellText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  context.save();
  context.beginPath();
  context.rect(x + 3, y + 1, Math.max(0, width - 6), Math.max(0, height - 2));
  context.clip();
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, x + width / 2, y + height / 2);
  context.restore();
}

function drawE4Connector(
  context: CanvasRenderingContext2D,
  object: EditorSceneObject,
  layout: E4ConnectorLayout,
  selected: boolean,
) {
  const headerY = layout.y + layout.titleHeight;
  const bodyY = headerY + layout.headerHeight;
  const footerY = bodyY + layout.rows.length * layout.rowHeight;
  context.fillStyle = "#ffffff";
  context.fillRect(layout.x, layout.y, layout.width, layout.height);
  context.fillStyle = "#e9f0f3";
  context.fillRect(layout.x, layout.y, layout.width, layout.titleHeight);
  context.fillStyle = "#f4f7f8";
  context.fillRect(layout.x, headerY, layout.width, layout.headerHeight);
  context.fillStyle = "#f4f7f8";
  context.fillRect(layout.x, footerY, layout.width, layout.footerHeight);

  context.strokeStyle = selected ? "#087bb4" : object.color;
  context.lineWidth = selected ? 3 : 1.5;
  context.strokeRect(layout.x, layout.y, layout.width, layout.height);
  context.lineWidth = 1;
  context.strokeStyle = "#9fb2bc";
  context.beginPath();
  context.moveTo(layout.x, headerY);
  context.lineTo(layout.x + layout.width, headerY);
  context.moveTo(layout.x, bodyY);
  context.lineTo(layout.x + layout.width, bodyY);
  context.moveTo(layout.x, footerY);
  context.lineTo(layout.x + layout.width, footerY);
  for (const column of layout.columns.slice(1)) {
    context.moveTo(column.x, headerY);
    context.lineTo(column.x, footerY);
  }
  for (let index = 1; index < layout.rows.length; index += 1) {
    const rowY = bodyY + index * layout.rowHeight;
    context.moveTo(layout.x, rowY);
    context.lineTo(layout.x + layout.width, rowY);
  }
  context.stroke();

  context.fillStyle = "#17384b";
  context.font = "700 13px Inter, Arial, sans-serif";
  const labelOnRight = layout.connectionSide === "left";
  context.textAlign = labelOnRight ? "right" : "left";
  context.textBaseline = "middle";
  context.save();
  context.beginPath();
  context.rect(layout.x + 10, layout.y + 2, layout.width - 20, layout.titleHeight - 4);
  context.clip();
  context.fillText(
    layout.designation,
    labelOnRight ? layout.x + layout.width - 12 : layout.x + 12,
    layout.y + layout.titleHeight / 2,
  );
  context.restore();

  context.fillStyle = "#405f6e";
  context.font = "600 10px Inter, Arial, sans-serif";
  context.save();
  context.beginPath();
  context.rect(layout.x + 10, footerY + 1, layout.width - 20, layout.footerHeight - 2);
  context.clip();
  context.fillText(
    layout.partNumber,
    labelOnRight ? layout.x + layout.width - 12 : layout.x + 12,
    footerY + layout.footerHeight / 2,
  );
  context.restore();

  context.fillStyle = "#405f6e";
  context.font = "700 10px Inter, Arial, sans-serif";
  for (const column of layout.columns) {
    drawE4CellText(context, column.label, column.x, headerY, column.width, layout.headerHeight);
  }

  context.fillStyle = "#284957";
  context.font = "500 10px Inter, Arial, sans-serif";
  layout.rows.forEach((row, rowIndex) => {
    const rowY = bodyY + rowIndex * layout.rowHeight;
    for (const column of layout.columns) {
      drawE4CellText(context, e4CellText(row, column.id), column.x, rowY, column.width, layout.rowHeight);
    }
    const point = layout.contactPoints[rowIndex]!;
    const marker = e4ContactMarker(row.status, layout.connectionSide);
    if (marker) {
      context.save();
      context.strokeStyle = "#2c3fbd";
      context.lineWidth = 1.7;
      context.lineCap = "round";
      context.beginPath();
      context.moveTo(point.x + marker.lineStart.x, point.y + marker.lineStart.y);
      context.lineTo(point.x + marker.lineEnd.x, point.y + marker.lineEnd.y);
      context.stroke();
      context.beginPath();
      context.moveTo(
        point.x + marker.crossCenter.x - marker.crossSize,
        point.y + marker.crossCenter.y - marker.crossSize,
      );
      context.lineTo(
        point.x + marker.crossCenter.x + marker.crossSize,
        point.y + marker.crossCenter.y + marker.crossSize,
      );
      context.moveTo(
        point.x + marker.crossCenter.x - marker.crossSize,
        point.y + marker.crossCenter.y + marker.crossSize,
      );
      context.lineTo(
        point.x + marker.crossCenter.x + marker.crossSize,
        point.y + marker.crossCenter.y - marker.crossSize,
      );
      context.stroke();
      context.restore();
    } else {
      context.fillStyle = object.color;
      context.beginPath();
      context.arc(point.x, point.y, 3.5, 0, Math.PI * 2);
      context.fill();
    }
    context.fillStyle = "#284957";
    context.font = "500 10px Inter, Arial, sans-serif";
  });
}

function drawObject(
  context: CanvasRenderingContext2D,
  object: EditorSceneObject,
  selected: boolean,
  view: HarnessEditorView,
) {
  context.save();
  if (object.kind === "wire" || object.kind === "dimension") {
    const points = view === "e4" && object.kind === "wire" ? getE4WireRoute(object) : object.points ?? [];
    if (points.length >= 2) {
      context.beginPath();
      points.forEach((point, index) => index === 0 ? context.moveTo(point.x, point.y) : context.lineTo(point.x, point.y));
      context.strokeStyle = selected ? "#1179ac" : object.color;
      context.lineWidth = selected ? 4 : object.kind === "wire" ? 3 : 1.5;
      if (object.kind === "dimension") context.setLineDash([7, 5]);
      context.stroke();
      context.setLineDash([]);
      if (selected) {
        context.fillStyle = "#ffffff";
        context.strokeStyle = "#1179ac";
        for (const point of points) {
          context.beginPath();
          context.arc(point.x, point.y, 4.5, 0, Math.PI * 2);
          context.fill();
          context.stroke();
        }
      }
      const middle = points[Math.floor(points.length / 2)];
      if (middle && object.label) {
        context.font = "600 12px Inter, Arial, sans-serif";
        context.fillStyle = "#34566a";
        context.fillText(object.label, middle.x + 8, middle.y - 9);
      }
    }
  } else if (object.kind === "connector") {
    const e4Layout = view === "e4" ? getE4ConnectorLayout(object) : null;
    if (e4Layout) {
      drawE4Connector(context, object, e4Layout, selected);
      context.restore();
      return;
    }
    roundedRectangle(context, object.x, object.y, object.width, object.height, 7);
    context.fillStyle = "#ffffff";
    context.fill();
    context.strokeStyle = selected ? "#087bb4" : object.color;
    context.lineWidth = selected ? 3 : 2;
    context.stroke();
    context.fillStyle = "#17384b";
    context.font = "700 13px Inter, Arial, sans-serif";
    context.fillText(object.label, object.x + 12, object.y + 22);
    context.fillStyle = object.color;
    const points = legacyConnectorContactPoints(object);
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index]!;
      context.beginPath();
      context.arc(point.x, point.y, 3.5, 0, Math.PI * 2);
      context.fill();
      context.beginPath();
      context.arc(object.x, point.y, 3.5, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "#55717f";
      context.font = "500 9px Inter, Arial, sans-serif";
      context.fillText(String(index + 1), object.x + 9, point.y + 3);
      context.fillStyle = object.color;
    }
  } else {
    context.fillStyle = object.color;
    context.font = "600 14px Inter, Arial, sans-serif";
    context.fillText(object.label, object.x, object.y + 16);
    if (selected) {
      context.strokeStyle = "#087bb4";
      context.setLineDash([5, 4]);
      context.strokeRect(object.x - 6, object.y - 5, object.width + 12, object.height + 10);
    }
  }
  context.restore();
}

function drawE4BridgeCrossings(
  context: CanvasRenderingContext2D,
  crossings: readonly E4WireCrossing[],
  objects: readonly EditorSceneObject[],
) {
  const radius = 7;
  for (const crossing of crossings) {
    const over = objects.find((object) => object.id === crossing.overWireId);
    if (!over) continue;
    context.save();
    context.strokeStyle = "#f8fafb";
    context.lineWidth = 7;
    context.lineCap = "round";
    context.beginPath();
    if (crossing.overOrientation === "horizontal") {
      context.moveTo(crossing.point.x - radius - 2, crossing.point.y);
      context.lineTo(crossing.point.x + radius + 2, crossing.point.y);
    } else {
      context.moveTo(crossing.point.x, crossing.point.y - radius - 2);
      context.lineTo(crossing.point.x, crossing.point.y + radius + 2);
    }
    context.stroke();
    context.strokeStyle = over.color;
    context.lineWidth = 3;
    context.beginPath();
    if (crossing.overOrientation === "horizontal") {
      context.moveTo(crossing.point.x - radius, crossing.point.y);
      context.bezierCurveTo(
        crossing.point.x - radius / 2, crossing.point.y - radius,
        crossing.point.x + radius / 2, crossing.point.y - radius,
        crossing.point.x + radius, crossing.point.y,
      );
    } else {
      context.moveTo(crossing.point.x, crossing.point.y - radius);
      context.bezierCurveTo(
        crossing.point.x + radius, crossing.point.y - radius / 2,
        crossing.point.x + radius, crossing.point.y + radius / 2,
        crossing.point.x, crossing.point.y + radius,
      );
    }
    context.stroke();
    context.restore();
  }
}

function drawE4DifferentialPairs(
  context: CanvasRenderingContext2D,
  groups: readonly E4DifferentialPairOverlay[],
  objects: readonly EditorSceneObject[],
) {
  for (const group of groups) {
    const layout = getE4DifferentialPairLayout(group, objects);
    if (!layout) continue;
    const span = layout.span;
    const first = objects.find((object) => object.id === group.wireIds[0]);
    const second = objects.find((object) => object.id === group.wireIds[1]);
    if (!first || !second) continue;
    for (const motif of layout.motifs) {
      const { from, to, center: along } = motif;
      const crossingLength = to - from;
      context.save();
      context.lineCap = "round";
      context.strokeStyle = "#f8fafb";
      context.lineWidth = 7;
      for (const crossValue of [layout.crossMinimum, layout.crossMaximum]) {
        context.beginPath();
        if (span.orientation === "horizontal") {
          context.moveTo(from, crossValue);
          context.lineTo(to, crossValue);
        } else {
          context.moveTo(crossValue, from);
          context.lineTo(crossValue, to);
        }
        context.stroke();
      }
      context.lineWidth = 2.5;
      for (const [wire, reverse] of [[first, false], [second, true]] as const) {
        const crossStart = reverse ? layout.crossMaximum : layout.crossMinimum;
        const crossEnd = reverse ? layout.crossMinimum : layout.crossMaximum;
        context.strokeStyle = wire.color;
        context.beginPath();
        if (span.orientation === "horizontal") {
          context.moveTo(from, crossStart);
          if (layout.variant === 2) context.lineTo(to, crossEnd);
          else context.bezierCurveTo(along - crossingLength / 4, crossStart, along + crossingLength / 4, crossEnd, to, crossEnd);
        } else {
          context.moveTo(crossStart, from);
          if (layout.variant === 2) context.lineTo(crossEnd, to);
          else context.bezierCurveTo(crossStart, along - crossingLength / 4, crossEnd, along + crossingLength / 4, crossEnd, to);
        }
        context.stroke();
      }
      context.restore();
    }
  }
}

function drawE4Junctions(context: CanvasRenderingContext2D, junctions: readonly E4JunctionOverlay[]) {
  context.save();
  context.fillStyle = "#183b4d";
  for (const junction of junctions) {
    context.beginPath();
    context.arc(junction.position.x, junction.position.y, 5, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}

function drawE4Screens(
  context: CanvasRenderingContext2D,
  screens: readonly E4ScreenOverlay[],
  objects: readonly EditorSceneObject[],
) {
  for (const screen of screens) {
    const layout = getE4ScreenLayout(screen, objects);
    if (!layout) continue;
    const width = layout.orientation === "horizontal" ? layout.alongSize : layout.crossSize;
    const height = layout.orientation === "horizontal" ? layout.crossSize : layout.alongSize;
    context.beginPath();
    context.ellipse(layout.center.x, layout.center.y, width / 2, height / 2, 0, 0, Math.PI * 2);
    context.fillStyle = "rgba(226, 232, 236, 0.5)";
    context.fill();
    context.strokeStyle = "#506d7c";
    context.lineWidth = 1.5;
    context.stroke();
    if (screen.label) {
      context.fillStyle = "#34566a";
      context.font = "600 10px Inter, Arial, sans-serif";
      context.textAlign = "center";
      context.textBaseline = "bottom";
      context.fillText(screen.label, layout.center.x, layout.center.y - height / 2 - 3);
    }
  }
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

function expandSceneBounds(
  bounds: EditorSceneBounds | null,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): EditorSceneBounds {
  if (!bounds) return { minX, minY, maxX, maxY };
  return {
    minX: Math.min(bounds.minX, minX),
    minY: Math.min(bounds.minY, minY),
    maxX: Math.max(bounds.maxX, maxX),
    maxY: Math.max(bounds.maxY, maxY),
  };
}

/** Returns world-space bounds for everything painted in the current view. */
export function getEditorSceneBounds(
  objects: readonly EditorSceneObject[],
  layers: readonly EditorLayer[],
  view: HarnessEditorView,
  e4Overlays?: E4SceneOverlays,
): EditorSceneBounds | null {
  let bounds: EditorSceneBounds | null = null;
  const visibleObjects = objectsInPaintOrder(objects, layers);
  for (const object of visibleObjects) {
    if (object.kind === "wire" || object.kind === "dimension") {
      const points = view === "e4" && object.kind === "wire" ? getE4WireRoute(object) : object.points ?? [];
      for (const point of points) {
        bounds = expandSceneBounds(bounds, point.x, point.y, point.x, point.y);
      }
      continue;
    }
    const e4Layout = view === "e4" ? getE4ConnectorLayout(object) : null;
    const width = e4Layout?.width ?? object.width;
    const height = e4Layout?.height ?? object.height;
    let minX = object.x;
    let maxX = object.x + Math.max(1, width);
    if (e4Layout) {
      const hasDisconnectedContact = e4Layout.rows.some((row) => row.status === "not-connected");
      if (hasDisconnectedContact) {
        if (e4Layout.connectionSide === "left") minX -= 21;
        else maxX += 21;
      }
    }
    bounds = expandSceneBounds(bounds, minX, object.y, maxX, object.y + Math.max(1, height));
  }

  if (view !== "e4") return bounds;
  const visibleOverlays = getVisibleE4SceneOverlays(
    e4Overlays ?? parseE4SceneOverlays(objects),
    objects,
    layers,
  );
  for (const junction of visibleOverlays.junctions) {
    bounds = expandSceneBounds(
      bounds,
      junction.position.x - 5,
      junction.position.y - 5,
      junction.position.x + 5,
      junction.position.y + 5,
    );
  }
  for (const group of visibleOverlays.diffPairs) {
    const layout = getE4DifferentialPairLayout(group, visibleObjects);
    if (!layout) continue;
    if (layout.span.orientation === "horizontal") {
      bounds = expandSceneBounds(bounds, layout.span.start, layout.crossMinimum, layout.span.end, layout.crossMaximum);
    } else {
      bounds = expandSceneBounds(bounds, layout.crossMinimum, layout.span.start, layout.crossMaximum, layout.span.end);
    }
  }
  for (const screen of visibleOverlays.screens) {
    const layout = getE4ScreenLayout(screen, visibleObjects);
    if (!layout) continue;
    const width = layout.orientation === "horizontal" ? layout.alongSize : layout.crossSize;
    const height = layout.orientation === "horizontal" ? layout.crossSize : layout.alongSize;
    const labelSpace = screen.label ? 15 : 0;
    bounds = expandSceneBounds(
      bounds,
      layout.center.x - width / 2,
      layout.center.y - height / 2 - labelSpace,
      layout.center.x + width / 2,
      layout.center.y + height / 2,
    );
  }
  return bounds;
}

function redrawCanvas(
  canvas: HTMLCanvasElement,
  view: HarnessEditorView,
  camera: EditorCamera,
  objects: readonly EditorSceneObject[],
  layers: readonly EditorLayer[],
  selectedObjectIds: ReadonlySet<string>,
  e4Overlays?: E4SceneOverlays,
) {
  const context = canvas.getContext("2d");
  if (!context) return;
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(canvas.clientWidth));
  const height = Math.max(1, Math.round(canvas.clientHeight));
  const pixelWidth = Math.round(width * ratio);
  const pixelHeight = Math.round(height * ratio);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  drawGrid(context, width, height, camera);
  context.save();
  context.translate(camera.offsetX, camera.offsetY);
  context.scale(camera.zoom, camera.zoom);
  for (const object of objectsInPaintOrder(objects, layers)) {
    drawObject(context, object, selectedObjectIds.has(object.id), view);
  }
  if (view === "e4") {
    const overlays = e4Overlays ?? parseE4SceneOverlays(objects);
    const visibleOverlays = getVisibleE4SceneOverlays(overlays, objects, layers);
    if (overlays.crossingStyle === "bridge") {
      drawE4BridgeCrossings(context, getE4WireCrossings(objects, layers, visibleOverlays.junctions), objects);
    }
    drawE4DifferentialPairs(context, visibleOverlays.diffPairs, objects);
    drawE4Junctions(context, visibleOverlays.junctions);
    drawE4Screens(context, visibleOverlays.screens, objects);
  }
  context.restore();
}

export function CanvasViewport({
  view,
  tool,
  camera,
  objects,
  layers,
  selectedObjectId,
  selectedObjectIds,
  e4Overlays,
  overlay,
  inlineEditor,
  onCameraChange,
  onViewportSizeChange,
  onObjectSelect,
  onObjectMove,
  onWireConnect,
  onWireReconnect,
  onWireConnectToWire,
  onWireReconnectToWire,
  onE4WireSegmentMove,
  onE4ScreenPositionChange,
  onWireRoutePointMove,
  onWireRoutePointRemove,
  onCanvasDoubleClick,
  onCatalogDrop,
}: CanvasViewportProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<PointerDrag | ObjectPointerDrag | WireRoutePointerDrag |
    E4WireSegmentPointerDrag | E4ScreenPointerDrag | null>(null);
  const [wireStart, setWireStart] = useState<{ readonly connectorId: string; readonly contactIndex: number } | null>(null);
  const [wireReconnect, setWireReconnect] = useState<{ readonly wireId: string; readonly end: "from" | "to" } | null>(null);
  const activeSelectedIds = selectedObjectIds ?? (selectedObjectId ? [selectedObjectId] : []);
  const selectedSet = new Set(activeSelectedIds);
  const overlays = e4Overlays ?? parseE4SceneOverlays(objects);
  const inlineObject = view === "e4" && selectedObjectId
    ? objects.find((object) => object.id === selectedObjectId && object.kind === "connector") ?? null
    : null;
  const inlineLayout = inlineObject ? getE4ConnectorLayout(inlineObject) : null;

  useEffect(() => {
    if (tool !== "wire") {
      setWireStart(null);
      setWireReconnect(null);
    }
  }, [tool]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const redraw = () => {
      redrawCanvas(canvas, view, camera, objects, layers, selectedSet, e4Overlays);
      onViewportSizeChange?.({
        width: Math.max(1, Math.round(canvas.clientWidth)),
        height: Math.max(1, Math.round(canvas.clientHeight)),
      });
    };
    redraw();
    const observer = new ResizeObserver(redraw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [camera, e4Overlays, layers, objects, onViewportSizeChange, selectedObjectIds, selectedObjectId, view]);

  useEffect(() => {
    const frame = frameRef.current;
    const canvas = canvasRef.current;
    if (!frame || !canvas) return;
    const wheel = (event: globalThis.WheelEvent) => {
      handleEditorViewportWheel(event, camera, canvas.getBoundingClientRect(), onCameraChange);
    };
    frame.addEventListener("wheel", wheel, { passive: false, capture: true });
    return () => frame.removeEventListener("wheel", wheel, true);
  }, [camera, onCameraChange]);

  const localPoint = (clientX: number, clientY: number): EditorPoint => {
    const bounds = canvasRef.current?.getBoundingClientRect();
    return { x: clientX - (bounds?.left ?? 0), y: clientY - (bounds?.top ?? 0) };
  };

  const pointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    const shouldPan = tool === "pan" || event.button === 1;
    if (shouldPan) {
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = {
        kind: "pan",
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        camera,
      };
      return;
    }
    if (tool === "wire") {
      const worldPoint = screenToWorld(camera, localPoint(event.clientX, event.clientY));
      const endpoint = hitTestConnectorContact(
        objects,
        layers,
        worldPoint,
        camera.zoom,
        view,
      );
      if (wireReconnect) {
        if (endpoint) {
          onWireReconnect?.(wireReconnect.wireId, wireReconnect.end, endpoint);
        } else {
          const target = hitTestWireSegment(objects, layers, worldPoint, camera.zoom, wireReconnect.wireId);
          if (target) onWireReconnectToWire?.(
            wireReconnect.wireId,
            wireReconnect.end,
            target.wireId,
            target.point,
          );
        }
        setWireReconnect(null);
        return;
      }
      if (!wireStart) {
        const selectedWire = objects.find((item) => item.id === selectedObjectId);
        const selectedLayer = selectedWire ? layers.find((item) => item.id === selectedWire.layerId) : null;
        const wireEnd = selectedLayer?.locked === true ? null : hitTestWireEnd(selectedWire, worldPoint, camera.zoom);
        if (wireEnd && selectedWire) {
          setWireReconnect({ wireId: selectedWire.id, end: wireEnd });
          return;
        }
      }
      if (!endpoint) {
        if (wireStart) {
          const target = hitTestWireSegment(objects, layers, worldPoint, camera.zoom);
          if (target && onWireConnectToWire) {
            onWireConnectToWire(wireStart, target.wireId, target.point);
            setWireStart(null);
          }
        }
        return;
      }
      if (!wireStart) {
        setWireStart(endpoint);
        onObjectSelect(endpoint.connectorId, false);
      } else {
        if (wireStart.connectorId !== endpoint.connectorId || wireStart.contactIndex !== endpoint.contactIndex) {
          onWireConnect?.(wireStart, endpoint);
        }
        setWireStart(null);
      }
      return;
    }
    if (tool === "select") {
      const worldPoint = screenToWorld(camera, localPoint(event.clientX, event.clientY));
      if (view === "e4") {
        const screen = onE4ScreenPositionChange
          ? hitTestE4Screen(overlays.screens, objects, worldPoint, camera.zoom, layers)
          : null;
        if (screen) {
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = {
            kind: "e4-screen",
            pointerId: event.pointerId,
            clientX: event.clientX,
            clientY: event.clientY,
            screenId: screen.id,
            orientation: screen.orientation,
            position: overlays.screens.find((item) => item.id === screen.id)?.position ?? 0.5,
            spanLength: screen.pathLength,
          };
          return;
        }
        const segment = onE4WireSegmentMove
          ? hitTestE4WireSegment(objects, layers, worldPoint, camera.zoom)
          : null;
        if (segment) {
          const additive = event.ctrlKey || event.shiftKey;
          const togglingOff = additive && selectedSet.has(segment.wireId);
          onObjectSelect(segment.wireId, additive);
          if (togglingOff) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = {
            kind: "e4-wire-segment",
            pointerId: event.pointerId,
            clientX: event.clientX,
            clientY: event.clientY,
            wireId: segment.wireId,
            segmentIndex: segment.index,
            orientation: segment.orientation,
            coordinate: segment.orientation === "horizontal" ? segment.start.y : segment.start.x,
          };
          return;
        }
      }
      if (view === "drawing") {
        const selectedWire = objects.find((item) => item.id === selectedObjectId);
        const selectedLayer = selectedWire ? layers.find((item) => item.id === selectedWire.layerId) : null;
        const routeIndex = selectedLayer?.locked === true
          ? null
          : hitTestWireRoutePoint(selectedWire, worldPoint, camera.zoom);
        const routePoint = routeIndex === null ? null : selectedWire?.points?.[routeIndex + 1];
        if (selectedWire && routeIndex !== null && routePoint) {
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = {
            kind: "wire-route",
            pointerId: event.pointerId,
            clientX: event.clientX,
            clientY: event.clientY,
            wireId: selectedWire.id,
            routeIndex,
            point: routePoint,
          };
          return;
        }
      }
      const objectId = hitTestEditorScene(
        objects,
        layers,
        worldPoint,
        camera.zoom,
        view,
      );
      const selectedObject = objects.find((item) => item.id === selectedObjectId);
      const preserveWireForRoutePoint = view === "drawing" && objectId === null &&
        selectedObject?.kind === "wire" && onCanvasDoubleClick !== undefined;
      if (!preserveWireForRoutePoint) onObjectSelect(objectId, event.ctrlKey || event.shiftKey);
      const object = objects.find((item) => item.id === objectId);
      const layer = object ? layers.find((item) => item.id === object.layerId) : null;
      if (object && object.kind === "connector" && layer?.locked !== true && onObjectMove) {
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = {
          kind: "object",
          pointerId: event.pointerId,
          clientX: event.clientX,
          clientY: event.clientY,
          objectId: object.id,
          objectX: object.x,
          objectY: object.y,
        };
      }
    }
  };

  const pointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.kind === "pan") {
      onCameraChange(panEditorCamera(drag.camera, event.clientX - drag.clientX, event.clientY - drag.clientY));
    }
  };

  const endPointer = (event: PointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    if (dragRef.current?.kind === "object") {
      const drag = dragRef.current;
      onObjectMove?.(drag.objectId, {
        x: drag.objectX + (event.clientX - drag.clientX) / camera.zoom,
        y: drag.objectY + (event.clientY - drag.clientY) / camera.zoom,
      });
    } else if (dragRef.current?.kind === "wire-route") {
      const drag = dragRef.current;
      onWireRoutePointMove?.(drag.wireId, drag.routeIndex, {
        x: drag.point.x + (event.clientX - drag.clientX) / camera.zoom,
        y: drag.point.y + (event.clientY - drag.clientY) / camera.zoom,
      });
    } else if (dragRef.current?.kind === "e4-wire-segment") {
      const drag = dragRef.current;
      const pixelDelta = drag.orientation === "horizontal"
        ? event.clientY - drag.clientY
        : event.clientX - drag.clientX;
      if (Math.abs(pixelDelta) >= 1) {
        onE4WireSegmentMove?.(drag.wireId, drag.segmentIndex, drag.coordinate + pixelDelta / camera.zoom);
      }
    } else if (dragRef.current?.kind === "e4-screen") {
      const drag = dragRef.current;
      const screen = overlays.screens.find((item) => item.id === drag.screenId);
      const layout = screen ? getE4ScreenLayout(screen, objects) : null;
      const worldPoint = screenToWorld(camera, localPoint(event.clientX, event.clientY));
      if (layout) {
        const position = getE4ScreenPositionForPoint(layout, worldPoint);
        onE4ScreenPositionChange?.(drag.screenId, position);
      } else {
        const pixelDelta = drag.orientation === "horizontal"
          ? event.clientX - drag.clientX
          : event.clientY - drag.clientY;
        if (Math.abs(pixelDelta) >= 1) {
          const position = Math.max(0, Math.min(1, drag.position + pixelDelta / camera.zoom / drag.spanLength));
          onE4ScreenPositionChange?.(drag.screenId, position);
        }
      }
    }
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const allowDrop = (event: DragEvent<HTMLCanvasElement>) => {
    if (!event.dataTransfer.types.includes("application/x-techmap-catalog-item")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const drop = (event: DragEvent<HTMLCanvasElement>) => {
    const itemId = event.dataTransfer.getData("application/x-techmap-catalog-item");
    if (!itemId) return;
    event.preventDefault();
    onCatalogDrop(itemId, screenToWorld(camera, localPoint(event.clientX, event.clientY)));
  };

  const doubleClick = (event: MouseEvent<HTMLCanvasElement>) => {
    const point = screenToWorld(camera, localPoint(event.clientX, event.clientY));
    if (view === "drawing") {
      const selectedWire = objects.find((item) => item.id === selectedObjectId);
      const selectedLayer = selectedWire ? layers.find((item) => item.id === selectedWire.layerId) : null;
      const routeIndex = selectedLayer?.locked === true
        ? null
        : hitTestWireRoutePoint(selectedWire, point, camera.zoom);
      if (selectedWire && routeIndex !== null) {
        onWireRoutePointRemove?.(selectedWire.id, routeIndex);
        return;
      }
    }
    onCanvasDoubleClick?.(point);
  };

  return (
    <div ref={frameRef} className={`he-canvas-frame tool-${tool}`}>
      <canvas
        ref={canvasRef}
        className="he-canvas"
        tabIndex={0}
        aria-label={`${view === "e4" ? "Поле схемы Э4" : "Поле чертежа"}. Масштаб ${Math.round(camera.zoom * 100)} процентов`}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onDragOver={allowDrop}
        onDrop={drop}
        onDoubleClick={doubleClick}
      />
      <div className="he-canvas-status" aria-live="polite">
        <span>{Math.round(camera.zoom * 100)}%</span>
        <span>{tool === "wire"
          ? wireReconnect ? "Выберите новый контакт для конца провода"
            : wireStart ? "Выберите второй контакт"
              : "Выберите два контакта; конец выбранного провода можно переподключить"
          : tool === "pan" ? "Тяните поле мышью"
            : view === "drawing" && objects.find((item) => item.id === selectedObjectId)?.kind === "wire"
              ? "Точки трассы: перетащить; двойной щелчок — удалить"
              : "Ctrl + колесо — масштаб"}</span>
      </div>
      {overlay && <div className="he-e4-wire-popover">{overlay}</div>}
      {inlineEditor && inlineObject && inlineLayout && (
        <div
          className="he-e4-inline-editor"
          style={{
            left: inlineLayout.x * camera.zoom + camera.offsetX,
            top: inlineLayout.y * camera.zoom + camera.offsetY,
            width: inlineLayout.width,
            height: inlineLayout.height,
            transform: `scale(${camera.zoom})`,
          }}
          onPointerDown={containInlineEditorPointerEvent}
        >{inlineEditor}</div>
      )}
      <ul className="visually-hidden" aria-label="Объекты на поле">
        {objectsInPaintOrder(objects, layers).map((object) => <li key={object.id}>{object.label}</li>)}
      </ul>
    </div>
  );
}
