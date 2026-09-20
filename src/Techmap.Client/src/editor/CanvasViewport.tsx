import type { DimensionMode } from "./drawing-dimensions";
import { screenCrossSections } from "./e4-screen-spans";
import { DrawingResizeGrip } from "./DrawingResizeGrip";
import { drawingScale, DRAWING_VIEW_PLACEMENT_ID } from "./drawing-scale";
import { useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { clearDecorationSpans } from "./e4-decoration-spans";
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
import {
  connectorE4FooterWidth,
  connectorE4TableColumnWidth,
  e4ScreenAlongSize,
} from "./model";
import { getE4WireLabelLayout, projectPointToE4WireLabelPosition } from "./e4-wire-label";
import { E4_BRIDGE_RADIUS } from "./e4-router";
import {
  snapE4ConnectorPosition,
  type E4ConnectorSnapGuides,
  type E4ConnectorSnapTarget,
} from "./e4-connector-snap";
import { resolveWireColorHex } from "./wire-reference-catalog";
import {
  buildWireStripProfileGeometry,
  type WireStripProfileGeometry,
} from "./wire-strip-profile-geometry";
import {
  ComponentTemplateImageCache,
  drawProjectedComponentTemplateView,
  projectComponentTemplateView,
  projectE4DrawingCompanion, projectE4DrawingCompanions, shortestDrawingLink,
  type ComponentTemplateViewInstance,
  type ResolveComponentTemplateAssetUrl,
} from "./component-template-view-renderer";
import {
  buildCableSheathGeometry,
  type CableSheathGeometry,
} from "./cable-sheath-geometry";
import type { CableInstance } from "./model";

export interface CanvasViewportProps {
  readonly view: HarnessEditorView;
  readonly tool: EditorTool;
  readonly camera: EditorCamera;
  readonly objects: readonly EditorSceneObject[];
  readonly layers: readonly EditorLayer[];
  readonly selectedObjectId: string | null;
  readonly selectedObjectIds?: readonly string[];
  readonly highlightedObjectIds?: readonly string[];
  readonly cables?: readonly CableInstance[];
  readonly e4Overlays?: E4SceneOverlays;
  /** Exact project snapshots keyed to connector scene-object ids. */
  readonly componentTemplateViewInstances?: readonly ComponentTemplateViewInstance[];
  /** Resolves an asset inside the exact project snapshot. */
  readonly resolveComponentTemplateAssetUrl?: ResolveComponentTemplateAssetUrl;
  readonly overlay?: ReactNode;
  readonly drawingWindows?:ReactNode;
  readonly onDimensionCreate?:(wireId:string,from:number,to:number,pointCount:number,mode:DimensionMode)=>void;
  readonly diagnosticOverlay?: ReactNode;
  readonly inlineEditor?: ReactNode;
  readonly onCameraChange: (camera: EditorCamera) => void;
  readonly onViewportSizeChange?: (size: EditorViewportSize) => void;
  readonly onObjectSelect: (objectId: string | null, additive?: boolean) => void;
  /** Selects all members of a linked E4 overlay in one state update. */
  readonly onObjectGroupSelect?: (objectIds: readonly string[]) => void;
  readonly onDrawingScale?: (objectId:string,drawingId:string,scale:number)=>void;
  readonly onDrawingMove?: (objectId:string,drawingId:string,offset:EditorPoint)=>void;
  readonly onRelatedObjectsSelect?: (ids:readonly string[])=>void;
  readonly onObjectMove?: (objectId: string, point: EditorPoint) => void;
  /** Shows a transient move without adding an undo entry. Passing null clears it. */
  readonly onObjectMovePreview?: (objectId: string, point: EditorPoint | null) => void;
  readonly onWireConnect?: (
    from: E4ConnectableEndpoint,
    to: E4ConnectableEndpoint,
  ) => void;
  readonly onWireReconnect?: (
    wireId: string,
    end: "from" | "to",
    target: E4ConnectableEndpoint,
  ) => void;
  readonly onWireConnectToWire?: (
    from: E4ConnectableEndpoint,
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
  readonly onE4WireRoutePointRemove?: (wireId: string, routeIndex: number) => void;
  readonly onE4WireLabelPositionChange?: (wireId: string, position: number) => void;
  readonly onE4ScreenPositionChange?: (screenId: string, position: number) => void;
  readonly onWireToolRequest?: () => void;
  readonly onWireRoutePointMove?: (wireId: string, routeIndex: number, point: EditorPoint) => void;
  readonly onWireRoutePointRemove?: (wireId: string, routeIndex: number) => void;
  readonly onObjectEditRequest?: (objectId: string) => void;
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

export function isInlineEditorReadonlyTarget(target: EventTarget | null): boolean {
  const candidate = target as { closest?: (selector: string) => unknown } | null;
  return typeof candidate?.closest === "function" &&
    candidate.closest(".e4-connector-canvas-editor.is-readonly") !== null;
}

/** Controls keep their native text selection, copy and popup interaction. */
export function isInlineEditorControlTarget(target: EventTarget | null): boolean {
  const candidate = target as { closest?: (selector: string) => unknown } | null;
  return typeof candidate?.closest === "function" &&
    candidate.closest("input, textarea, select, button, [contenteditable='true']") !== null;
}

export function inlineObjectDragMoved(deltaX: number, deltaY: number, threshold = 3): boolean {
  return Number.isFinite(deltaX) && Number.isFinite(deltaY) && Math.hypot(deltaX, deltaY) >= threshold;
}

export function inlineObjectDragDestination(
  origin: EditorPoint,
  deltaX: number,
  deltaY: number,
  zoom: number,
): EditorPoint {
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  return { x: origin.x + deltaX / safeZoom, y: origin.y + deltaY / safeZoom };
}

interface PointerDrag {
  readonly kind: "pan";
  readonly pointerId: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly camera: EditorCamera;
}

interface DrawingPointerDrag { readonly kind:"companion"; readonly pointerId:number; readonly clientX:number; readonly clientY:number; readonly objectId:string; readonly drawingId:string; readonly offset:EditorPoint; }

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

interface E4WireLabelPointerDrag {
  readonly kind: "e4-wire-label";
  readonly pointerId: number;
  readonly wireId: string;
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
  crossing: Pick<E4WireCrossing, "point" | "overOrientation">,
  radius = E4_BRIDGE_RADIUS,
): E4BridgeGeometry {
  const { point, overOrientation } = crossing;
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
  /** Direction in which the first selected wire traverses this span. */
  readonly firstWireDirection: 1 | -1;
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
        firstWireDirection: segmentAxisDirection(chosen[0]!, orientation),
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
  const common = findE4CommonParallelSpan(objects, group.wireIds);
  if (!common) return null;
  const span = clearDecorationSpans([common], objects.filter(object => object.kind === "connector"), 10,
    item => Math.max(group.amplitude * 2, item.crossMaximum - item.crossMinimum))
    .sort((a, b) => (b.end - b.start) - (a.end - a.start))[0];
  if (!span) return null;
  const available = span.end - span.start;
  // A stored pitch describes the pair, while the on-screen crossover is only
  // a motif. Leave a substantial straight run around every motif so the two
  // conductors remain individually readable in a dense harness.
  const visualStep = Math.max(40, group.step * 2);
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
}

export function getE4ScreenLayout(
  screen: E4ScreenOverlay,
  objects: readonly EditorSceneObject[],
): E4ScreenLayout | null {
  const candidates = screenCrossSections(screen.wireIds.map(id => {
    const wire=objects.find(object=>object.id===id && object.kind==="wire");
    return {id,points:wire ? getE4WireRoute(wire) : []};
  }));
  const spans = clearDecorationSpans(candidates, objects.filter(object => object.kind === "connector"), e4ScreenAlongSize / 2,
    span => Math.max(32, screen.width, span.crossMaximum - span.crossMinimum + 18));
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
  const cross = (span.crossMinimum + span.crossMaximum) / 2;
  const crossSize = Math.max(32, screen.width, span.crossMaximum - span.crossMinimum + 18);
  const center = span.orientation === "horizontal" ? { x: along, y: cross } : { x: cross, y: along };
  const configuredSide = screen.terminalSide ?? "above";
  const sides: readonly ("above" | "below")[] = configuredSide === "both"
    ? ["above", "below"]
    : [configuredSide];
  const terminals = sides.map((side) => {
    const direction = side === "above" ? -1 : 1;
    const bodyConnectionPoint = span.orientation === "horizontal"
      ? { x: center.x, y: center.y + direction * crossSize / 2 }
      : { x: center.x + direction * crossSize / 2, y: center.y };
    const connectionPoint = bodyConnectionPoint;
    return { side, bodyConnectionPoint, connectionPoint };
  });
  const terminal = terminals[0]!;
  return {
    id: screen.id,
    wireIds: screen.wireIds,
    center,
    orientation: span.orientation,
    // The narrow axis follows the wires; the long axis crosses the bundle.
    alongSize: e4ScreenAlongSize,
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
    const layout = getE4DifferentialPairLayout(group, visibleObjects);
    if (!layout) continue;
    const along = layout.span.orientation === "horizontal" ? point.x : point.y;
    const cross = layout.span.orientation === "horizontal" ? point.y : point.x;
    if (cross < layout.crossMinimum - tolerance || cross > layout.crossMaximum + tolerance) continue;
    if (layout.motifs.some((motif) => along >= motif.from - tolerance && along <= motif.to + tolerance)) {
      return layout;
    }
  }
  return null;
}

/**
 * Finds common spans by route order, preserving bends shared by a routed
 * bundle. If routes do not have a compatible segment sequence the caller
 * falls back to the longest single span for backwards compatibility.
 */
function getE4ScreenPositionForPoint(layout: E4ScreenLayout, point: EditorPoint): number {
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

function pointToSegmentDistance(point: EditorPoint, start: EditorPoint, end: EditorPoint): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

/** Decoration geometry never substitutes the physical wire route. */
export function getDrawingWireStripProfileGeometries(
  object: EditorSceneObject,
  view?: HarnessEditorView,
): readonly WireStripProfileGeometry[] {
  if (view !== "drawing" || object.kind !== "wire" || !object.stripProfiles) return [];
  return (["from", "to"] as const).flatMap((end) => {
    const profile = object.stripProfiles?.[end];
    const geometry = profile && buildWireStripProfileGeometry(object.points ?? [], end, profile);
    return geometry ? [geometry] : [];
  });
}

function polygonContainsPoint(
  polygon: readonly EditorPoint[],
  point: EditorPoint,
  tolerance: number,
): boolean {
  let positive = false;
  let negative = false;
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index]!;
    const end = polygon[(index + 1) % polygon.length]!;
    if (pointToSegmentDistance(point, start, end) <= tolerance) return true;
    const cross = (end.x - start.x) * (point.y - start.y) - (end.y - start.y) * (point.x - start.x);
    positive ||= cross > 0;
    negative ||= cross < 0;
  }
  return !(positive && negative);
}

function containsPoint(
  object: EditorSceneObject,
  point: EditorPoint,
  tolerance: number,
  view?: HarnessEditorView,
): boolean {
  if (object.kind === "physical-covering") return (object.paths ?? [object.points ?? []]).some(path => path.slice(1).some((p,i)=>pointToSegmentDistance(point,path[i]!,p)<=tolerance+object.width/2));
  if (object.kind === "wire" || object.kind === "dimension" || object.kind === "physical-segment") {
    if (getDrawingWireStripProfileGeometries(object, view).some((geometry) =>
      geometry.primitives.some((primitive) => polygonContainsPoint(primitive.polygon, point, tolerance)))) return true;
    const points = view === "e4" && object.kind === "wire" ? getE4WireRoute(object) : object.points ?? [];
    for (let index = 1; index < points.length; index += 1) {
      const start = points[index - 1];
      const end = points[index];
      if (start && end && pointToSegmentDistance(point, start, end) <= tolerance) return true;
    }
    return false;
  }
  for (const contact of connectorCanvasContactPoints(object, view)) {
    if (!contact || contact.status !== "not-connected") continue;
    const cross = contactCrossCenter(contact);
    if (Math.hypot(point.x - cross.x, point.y - cross.y) <= contact.crossSize + tolerance) return true;
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
    const crossCenter = { x: anchor.x + marker.crossCenter.x, y: anchor.y + marker.crossCenter.y };
    // The marker is a single semantic object. Centre its hit target on the X
    // instead of deriving a thin target from the decorative lead and strokes.
    return Math.hypot(point.x - crossCenter.x, point.y - crossCenter.y) <= marker.crossSize + tolerance;
  });
}

export function hitTestWireRoutePoint(
  object: EditorSceneObject | undefined,
  point: EditorPoint,
  zoom: number,
): number | null {
  if (object?.kind !== "wire" && object?.kind !== "physical-segment") return null;
  if (object.metadata?.physicalRoute === "true") return null;
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
  readonly secondaryColor: string;
  readonly name?: string;
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
  readonly libraryCode: string;
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
    const secondaryColor = item.secondaryColor === undefined ? "" : item.secondaryColor;
    const name = item.name === undefined ? "" : item.name;
    const textValues = [contactType, item.circuit, item.terminal, item.wire, item.color, secondaryColor];
    const customValues = parseStringRecord(item.customValues ?? item.values);
    if (!textValues.every((entry) => typeof entry === "string") || typeof name !== "string" || customValues === null ||
        (item.status !== "available" && item.status !== "not-connected")) return null;
    rows.push({
      number: item.number as number,
      type: contactType as string,
      circuit: item.circuit as string,
      terminal: item.terminal as string,
      wire: item.wire as string,
      color: item.color as string,
      secondaryColor: secondaryColor as string,
      name,
      status: item.status,
      customValues,
    });
  }
  return rows;
}

function e4CellText(row: E4ContactRow, column: E4ColumnId): string {
  if (column === "number") return String(row.number);
  if (column === "custom:template-name") return row.name ?? "";
  if (isCustomE4ColumnId(column)) return row.customValues[column.slice("custom:".length)] ?? "";
  if (column === "contactType") return row.type;
  if (column === "color") return [row.color, row.secondaryColor].filter(Boolean).join(" / ");
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
 *   rows: JSON.stringify({ number, contactType, circuit, terminal, wire, color, secondaryColor,
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
  const designation = object.metadata.designation?.trim() || object.label;
  const libraryCode = object.metadata.libraryCode?.trim() || "FREE";
  const partNumber = object.metadata.partNumber?.trim() ?? "";
  const widths = new Map<E4ColumnId, number>(columnIds.map((column) => {
    const label = columnLabels[column] ?? (isCustomE4ColumnId(column) ? column.slice("custom:".length) : e4ColumnLabels[column]);
    const values = rows.map((row) => e4CellText(row, column));
    return [
      column,
      connectorE4TableColumnWidth(isCustomE4ColumnId(column) ? null : column, label, values),
    ];
  }));
  const columnWidth = columnIds.reduce((total, column) => total + (widths.get(column) ?? 0), 0);
  const width = Math.max(118, columnWidth, connectorE4FooterWidth(libraryCode, partNumber));
  const titleHeight = 24;
  const headerHeight = 28;
  const rowHeight = 24;
  const footerHeight = 24;
  const height = titleHeight + headerHeight + rows.length * rowHeight + footerHeight;
  const widthRemainder = width - columnWidth;
  const flexibleColumn = columnIds.findIndex((column) => column !== "number");
  const growColumn = flexibleColumn < 0 ? 0 : flexibleColumn;
  let columnX = object.x;
  const columns = columnIds.map((id, index) => {
    const columnWidth = widths.get(id)! + (index === (growColumn < 0 ? 0 : growColumn) ? widthRemainder : 0);
    const column = {
      id,
      label: columnLabels[id] ?? (isCustomE4ColumnId(id) ? id.slice("custom:".length) : e4ColumnLabels[id]),
      x: columnX,
      width: columnWidth,
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
    libraryCode,
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

export interface MaterializedConnectorContactPoint extends EditorPoint {
  readonly direction: "left" | "right" | "up" | "down";
  readonly status: "available" | "not-connected";
}

interface ConnectorCanvasContactPoint extends MaterializedConnectorContactPoint {
  readonly secondaryPoint: EditorPoint | null;
  readonly crossOffset: number;
  readonly crossSize: number;
}

/** Parses local article-materialized coordinates without compacting contact indexes. */
export function getMaterializedConnectorContactPoints(
  object: EditorSceneObject,
): readonly (MaterializedConnectorContactPoint | null)[] | null {
  if (object.kind !== "connector" || !object.metadata?.materializedContactPoints) return null;
  const parsed = parseJson(object.metadata.materializedContactPoints);
  if (!Array.isArray(parsed)) return null;
  const result: (MaterializedConnectorContactPoint | null)[] = [];
  for (const candidate of parsed) {
    if (candidate === null) {
      result.push(null);
      continue;
    }
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
    const record = candidate as Record<string, unknown>;
    if (typeof record.x !== "number" || !Number.isFinite(record.x) ||
        typeof record.y !== "number" || !Number.isFinite(record.y) ||
        !["left", "right", "up", "down"].includes(String(record.direction)) ||
        !["available", "not-connected"].includes(String(record.status))) return null;
    result.push({
      x: object.x + record.x,
      y: object.y + record.y,
      direction: record.direction as MaterializedConnectorContactPoint["direction"],
      status: record.status as MaterializedConnectorContactPoint["status"],
    });
  }
  return result;
}

function connectorCanvasContactPoints(
  object: EditorSceneObject,
  view: HarnessEditorView | undefined,
): readonly (ConnectorCanvasContactPoint | null)[] {
  const materialized = getMaterializedConnectorContactPoints(object);
  const e4Layout = view === "drawing" ? null : getE4ConnectorLayout(object);
  const legacy = e4Layout ? e4Layout.contactPoints : legacyConnectorContactPoints(object);
  const count = Math.max(materialized?.length ?? 0, legacy.length);
  return Array.from({ length: count }, (_, index): ConnectorCanvasContactPoint | null => {
    const pinned = materialized?.[index];
    if (pinned) return {
      ...pinned,
      secondaryPoint: null,
      crossOffset: 12,
      crossSize: 3,
    };
    if(view==="drawing"&&materialized)return null;
    const fallback = legacy[index];
    if (!fallback) return null;
    if (e4Layout) return {
      ...fallback,
      direction: e4Layout.connectionSide,
      status: e4Layout.rows[index]?.status ?? "available",
      secondaryPoint: null,
      crossOffset: 16,
      crossSize: 5,
    };
    return {
      ...fallback,
      direction: "right",
      status: "available",
      secondaryPoint: { x: object.x, y: fallback.y },
      crossOffset: 12,
      crossSize: 3,
    };
  });
}

function contactOutward(direction: MaterializedConnectorContactPoint["direction"]): EditorPoint {
  return direction === "left" ? { x: -1, y: 0 }
    : direction === "right" ? { x: 1, y: 0 }
      : direction === "up" ? { x: 0, y: -1 }
        : { x: 0, y: 1 };
}

function contactCrossCenter(point: ConnectorCanvasContactPoint): EditorPoint {
  const outward = contactOutward(point.direction);
  return {
    x: point.x + outward.x * point.crossOffset,
    y: point.y + outward.y * point.crossOffset,
  };
}

function drawConnectorContactOverrides(
  context: CanvasRenderingContext2D,
  object: EditorSceneObject,
  view: HarnessEditorView,
  includeFallback: boolean,
): void {
  const points = connectorCanvasContactPoints(object, view);
  const materialized = getMaterializedConnectorContactPoints(object);
  context.save();
  context.lineCap = "round";
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    if (!point) continue;
    if (!includeFallback && !materialized?.[index]) continue;
    if (point.status === "available") {
      context.fillStyle = object.color;
      context.beginPath();
      context.arc(point.x, point.y, 3.5, 0, Math.PI * 2);
      context.fill();
      if (point.secondaryPoint) {
        context.beginPath();
        context.arc(point.secondaryPoint.x, point.secondaryPoint.y, 3.5, 0, Math.PI * 2);
        context.fill();
      }
      continue;
    }
    const cross = contactCrossCenter(point);
    context.strokeStyle = "#2c3fbd";
    context.lineWidth = 1.7;
    context.beginPath();
    context.moveTo(point.x, point.y);
    context.lineTo(cross.x, cross.y);
    context.moveTo(cross.x - point.crossSize, cross.y - point.crossSize);
    context.lineTo(cross.x + point.crossSize, cross.y + point.crossSize);
    context.moveTo(cross.x - point.crossSize, cross.y + point.crossSize);
    context.lineTo(cross.x + point.crossSize, cross.y - point.crossSize);
    context.stroke();
  }
  context.restore();
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
    const points = connectorCanvasContactPoints(object, view);
    for (let index = 0; index < points.length; index += 1) {
      const candidate = points[index]!;
      if (!candidate || candidate.status === "not-connected") continue;
      if (Math.hypot(point.x - candidate.x, point.y - candidate.y) <= tolerance ||
          candidate.secondaryPoint !== null &&
          Math.hypot(point.x - candidate.secondaryPoint.x, point.y - candidate.secondaryPoint.y) <= tolerance) {
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

export interface VisibleCableSheathScene {
  readonly geometries: readonly CableSheathGeometry[];
  readonly incompatibleCableIds: readonly string[];
}

/** Resolves visible drawing sheaths without using hidden conductors as geometry. */
export function getVisibleCableSheathScene(
  cables: readonly CableInstance[],
  objects: readonly EditorSceneObject[],
  layers: readonly EditorLayer[],
): VisibleCableSheathScene {
  const layerMap = new Map(layers.map((layer) => [layer.id, layer]));
  const geometries: CableSheathGeometry[] = [];
  const incompatibleCableIds: string[] = [];
  for (const cable of cables) {
    const strip = cable.sheathStrip;
    if (strip && (strip.fromMm === null || strip.toMm === null || cable.lengthMm === null ||
        Math.round((strip.fromMm + strip.toMm) * 1000) === Math.round(cable.lengthMm * 1000))) continue;
    const members = cable.memberWireIds.map((wireId) =>
      objects.find((object) => object.id === wireId && object.kind === "wire"));
    if (members.some((member) => member && layerMap.get(member.layerId)?.visible !== true)) continue;
    const geometry = buildCableSheathGeometry(cable, objects);
    if (geometry) geometries.push(geometry);
    else incompatibleCableIds.push(cable.id);
  }
  return { geometries, incompatibleCableIds };
}

/** Selects the painted sheath contour while leaving its inner conductors easy to hit. */
export function hitTestCableSheath(
  geometries: readonly CableSheathGeometry[],
  point: EditorPoint,
  zoom: number,
): CableSheathGeometry | null {
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const tolerance = 7 / safeZoom;
  for (let index = geometries.length - 1; index >= 0; index -= 1) {
    const geometry = geometries[index]!;
    if (point.x < geometry.bounds.x - tolerance ||
        point.x > geometry.bounds.x + geometry.bounds.width + tolerance ||
        point.y < geometry.bounds.y - tolerance ||
        point.y > geometry.bounds.y + geometry.bounds.height + tolerance) continue;
    if (geometry.edges.some(([start, end]) => pointToSegmentDistance(point, start, end) <= tolerance)) {
      return geometry;
    }
  }
  return null;
}

export function hitTestEditorScene(
  objects: readonly EditorSceneObject[],
  layers: readonly EditorLayer[],
  point: EditorPoint,
  zoom: number,
  view?: HarnessEditorView,
  componentTemplateViewInstances: readonly ComponentTemplateViewInstance[] = [],
  resolveComponentTemplateAssetUrl?: ResolveComponentTemplateAssetUrl,
): string | null {
  const paintOrder = objectsInPaintOrder(objects, layers);
  const componentViews = new Map(componentTemplateViewInstances.map(instance => [instance.objectId, instance]));
  const tolerance = 7 / zoom;
  const node = paintOrder.find(o => o.kind === "physical-node" && containsPoint(o, point, tolerance, view));
  if (node) return node.id;
  for (let index = paintOrder.length - 1; index >= 0; index -= 1) {
    const object = paintOrder[index];
    const instance = object?.kind === "connector" ? componentViews.get(object.id) : undefined;
    const companions = object && instance && view === "e4" ? projectE4DrawingCompanions(instance, object, getE4ConnectorLayout(object)?.width ?? object.width, resolveComponentTemplateAssetUrl) : [];
    if(companions.some(companion=>companion.visible && point.x >= companion.bounds.minX-tolerance && point.x <= companion.bounds.maxX+tolerance && point.y >= companion.bounds.minY-tolerance && point.y <= companion.bounds.maxY+tolerance)) return object!.id;
    const projection = object && instance && view
      ? projectComponentTemplateView(instance, view, { x: object.x, y: object.y }, resolveComponentTemplateAssetUrl)
      : null;
    if (projection && point.x >= projection.bounds.minX - tolerance && point.x <= projection.bounds.maxX + tolerance &&
        point.y >= projection.bounds.minY - tolerance && point.y <= projection.bounds.maxY + tolerance) return object!.id;
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

function drawE4ColorCell(
  context: CanvasRenderingContext2D,
  row: E4ContactRow,
  column: E4ConnectorColumnLayout,
  y: number,
  height: number,
) {
  const label = e4CellText(row, "color");
  if (!label) return;
  const swatchWidth = Math.min(26, Math.max(14, column.width - 12));
  const swatchHeight = Math.min(13, height - 7);
  const swatchX = column.x + 5;
  const swatchY = y + (height - swatchHeight) / 2;
  const primary = resolveWireColorHex(row.color, undefined, "#d9e2e7");
  const secondary = row.secondaryColor
    ? resolveWireColorHex(row.secondaryColor, undefined, "#d9e2e7")
    : "";
  context.save();
  context.beginPath();
  context.rect(column.x + 1, y + 1, column.width - 2, height - 2);
  context.clip();
  if (secondary) {
    context.fillStyle = primary;
    context.beginPath();
    context.moveTo(swatchX, swatchY);
    context.lineTo(swatchX + swatchWidth, swatchY);
    context.lineTo(swatchX + swatchWidth, swatchY + swatchHeight);
    context.closePath();
    context.fill();
    context.fillStyle = secondary;
    context.beginPath();
    context.moveTo(swatchX, swatchY);
    context.lineTo(swatchX, swatchY + swatchHeight);
    context.lineTo(swatchX + swatchWidth, swatchY + swatchHeight);
    context.closePath();
    context.fill();
  } else {
    context.fillStyle = primary;
    context.fillRect(swatchX, swatchY, swatchWidth, swatchHeight);
  }
  context.strokeStyle = "#8297a2";
  context.lineWidth = 1;
  context.strokeRect(swatchX, swatchY, swatchWidth, swatchHeight);
  if (column.width - swatchWidth >= 36) {
    context.fillStyle = "#284957";
    context.font = "500 8px Inter, Arial, sans-serif";
    context.textAlign = "left";
    context.textBaseline = "middle";
    context.fillText(label, swatchX + swatchWidth + 4, y + height / 2);
  }
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

  const hasDiagnostic = object.metadata?.diagnostic === "error";
  context.strokeStyle = hasDiagnostic ? "#c43d3d" : selected ? "#087bb4" : object.color;
  context.lineWidth = selected ? 3 : 1.5;
  context.strokeRect(layout.x, layout.y, layout.width, layout.height);
  if (hasDiagnostic) {
    context.save();
    context.fillStyle = "#c43d3d";
    context.beginPath();
    context.arc(layout.x + layout.width - 12, layout.y + layout.titleHeight / 2, 8, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#fff";
    context.font = "800 11px Inter, Arial, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("!", layout.x + layout.width - 12, layout.y + layout.titleHeight / 2 + 0.5);
    context.restore();
  }
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
  context.font = "800 12px Inter, Arial, sans-serif";
  drawE4CellText(context, layout.designation, layout.x + layout.width * 0.3, layout.y, layout.width * 0.4, layout.titleHeight);
  context.fillStyle = "#2584a8";
  context.font = "700 8px Inter, Arial, sans-serif";
  context.textAlign = "left";
  context.textBaseline = "middle";
  context.fillText("⊕ Добавить…", layout.x + 6, layout.y + layout.titleHeight / 2);

  context.font = "700 9px Inter, Arial, sans-serif";
  context.textAlign = "left";
  context.textBaseline = "middle";
  const codeWidth = Math.min(layout.width * 0.35, Math.max(34, context.measureText(layout.libraryCode).width + 14));
  context.save();
  context.beginPath();
  context.rect(layout.x + 5, footerY + 1, Math.max(0, codeWidth - 10), layout.footerHeight - 2);
  context.clip();
  context.fillStyle = "#405f6e";
  context.fillText(layout.libraryCode, layout.x + 7, footerY + layout.footerHeight / 2);
  context.restore();
  context.save();
  context.beginPath();
  context.rect(layout.x + codeWidth, footerY + 1, Math.max(0, layout.width - codeWidth - 7), layout.footerHeight - 2);
  context.clip();
  context.fillStyle = "#d62f45";
  context.fillText(layout.partNumber, layout.x + codeWidth + 3, footerY + layout.footerHeight / 2);
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
      if (column.id === "color") drawE4ColorCell(context, row, column, rowY, layout.rowHeight);
      else drawE4CellText(context, e4CellText(row, column.id), column.x, rowY, column.width, layout.rowHeight);
    }
    if (getMaterializedConnectorContactPoints(object)?.[rowIndex]) return;
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

const stripProfilePalette = ["#d6ad65", "#e4ebef", "#a9b7c0", "#7a929e", "#b8c9c2"] as const;
const stripProfileOutline = "#344b59";
const stripProfileStrokeWidth = 1.5;

function drawWireStripProfiles(
  context: CanvasRenderingContext2D,
  object: EditorSceneObject,
  selected: boolean,
): void {
  context.save();
  context.setLineDash([]);
  context.lineWidth = stripProfileStrokeWidth;
  context.lineJoin = "miter";
  context.strokeStyle = selected ? "#1179ac" : stripProfileOutline;
  for (const geometry of getDrawingWireStripProfileGeometries(object, "drawing")) {
    geometry.primitives.forEach((primitive, index) => {
      context.beginPath();
      primitive.polygon.forEach((point, index) => index === 0
        ? context.moveTo(point.x, point.y)
        : context.lineTo(point.x, point.y));
      context.closePath();
      context.fillStyle = index === geometry.primitives.length - 1
        ? object.color
        : stripProfilePalette[(primitive.layerIndex - 1) % stripProfilePalette.length]!;
      context.fill();
      context.stroke();
    });
  }
  context.restore();
}

export function drawEditorSceneObject(
  context: CanvasRenderingContext2D,
  object: EditorSceneObject,
  selected: boolean,
  view: HarnessEditorView,
  componentTemplateViewInstance?: ComponentTemplateViewInstance,
  resolveComponentTemplateAssetUrl?: ResolveComponentTemplateAssetUrl,
  componentTemplateImageCache = new ComponentTemplateImageCache(),
) {
  context.save();
  if(object.kind==="drawing-table") {
    const widths=JSON.parse(object.metadata?.widths ?? "[]") as number[],headers=JSON.parse(object.metadata?.headers ?? "[]") as string[],rows=JSON.parse(object.metadata?.rows ?? "[]") as string[][];
    context.fillStyle="#fff";context.fillRect(object.x,object.y,object.width,object.height);context.strokeStyle=selected?"#1179ac":object.color;context.lineWidth=selected?2:1;context.strokeRect(object.x,object.y,object.width,object.height);
    context.fillStyle=object.color;context.font="bold 12px Arial";context.fillText(object.label,object.x+8,object.y+17);
    const paintRow=(row:string[],y:number,height:number,bold:boolean)=>{let x=object.x;context.font=`${bold?"bold ":""}11px Arial`;row.forEach((value,i)=>{context.strokeRect(x,y,widths[i]!,height);context.save();context.beginPath();context.rect(x+3,y+1,widths[i]!-6,height-2);context.clip();context.fillText(value,x+5,y+height/2+4);context.restore();x+=widths[i]!;});};
    paintRow(headers,object.y+24,28,true);rows.forEach((r,i)=>paintRow(r,object.y+52+i*32,32,false));context.restore();return;
  }
  if(object.kind==="position-leader") {
    const a=object.points?.[0],b=object.points?.[1];if(a&&b){context.strokeStyle=object.color;context.lineWidth=selected?2:1;context.beginPath();context.moveTo(a.x,a.y);context.lineTo(b.x,b.y);context.stroke();context.beginPath();context.arc(b.x,b.y,12,0,Math.PI*2);context.fillStyle="#fff";context.fill();context.stroke();context.fillStyle=object.color;context.textAlign="center";context.textBaseline="middle";context.font="12px Arial";context.fillText(object.label,b.x,b.y);}
    context.restore();return;
  }
  if(object.kind==="leader-anchor") {context.fillStyle=selected?"#1179ac":object.color;context.beginPath();context.arc(object.x+4,object.y+4,4,0,Math.PI*2);context.fill();context.restore();return;}
  if (object.kind === "physical-covering") {
    for (const points of object.paths ?? [object.points ?? []]) {
    context.globalAlpha = selected ? .65 : .3; context.lineJoin = "miter"; context.miterLimit = 4; context.lineCap = "butt";
    context.lineWidth = object.width; context.strokeStyle = selected ? "#1179ac" : object.color;
    context.beginPath(); points.forEach((p,i)=>i===0?context.moveTo(p.x,p.y):context.lineTo(p.x,p.y)); context.stroke();
    context.globalAlpha = 1; context.lineWidth = 1; context.strokeStyle = object.color;
    for (const [a,b] of [[points[0],points[1]],[points.at(-1),points.at(-2)]]) if(a&&b) {const l=Math.hypot(b.x-a.x,b.y-a.y);if(l){const x=-(b.y-a.y)/l*object.width/2,y=(b.x-a.x)/l*object.width/2;context.beginPath();context.moveTo(a.x-x,a.y-y);context.lineTo(a.x+x,a.y+y);context.stroke();}}
    }
    context.restore(); return;
  }
  if (object.kind === "physical-node") {
    context.beginPath(); context.arc(object.x + 5, object.y + 5, 5, 0, Math.PI * 2);
    context.fillStyle = selected ? "#1179ac" : "#ffffff"; context.fill(); context.strokeStyle = "#1179ac"; context.stroke();
    context.font = "11px Arial"; context.fillStyle = "#34566a"; context.fillText(object.label, object.x + 12, object.y);
    context.restore(); return;
  }
  if (object.kind === "connector" && componentTemplateViewInstance) {
    if (view === "e4") {
      const layout=getE4ConnectorLayout(object);
      for(const companion of projectE4DrawingCompanions(componentTemplateViewInstance,object,layout?.width ?? object.width,resolveComponentTemplateAssetUrl).filter(d=>d.visible)) {
        const [from,to]=shortestDrawingLink({minX:object.x,minY:object.y,maxX:object.x+(layout?.width ?? object.width),maxY:object.y+(layout?.height ?? object.height)},companion.bounds);
        context.save();context.strokeStyle="#7b8996";context.lineWidth=1;context.setLineDash([4,4]);context.beginPath();context.moveTo(from.x,from.y);context.lineTo(to.x,to.y);context.stroke();context.restore();
        drawProjectedComponentTemplateView(context,companion,componentTemplateImageCache,selected);
      }
    }
    const projection = projectComponentTemplateView(
      componentTemplateViewInstance, view, { x: object.x, y: object.y }, resolveComponentTemplateAssetUrl,
    );
    if (projection) {
      drawProjectedComponentTemplateView(context, projection, componentTemplateImageCache, selected);
      drawConnectorContactOverrides(context, object, view, true);
      context.restore();
      return;
    }
  }
  if(object.kind==="dimension"&&object.metadata?.boundDimension==="true"&&object.points?.length===4){
    const [a,p,q,b]=object.points as readonly [EditorPoint,EditorPoint,EditorPoint,EditorPoint];
    context.strokeStyle=selected?"#1179ac":object.color;context.fillStyle=context.strokeStyle;context.lineWidth=selected?2:1;
    context.setLineDash([]);context.beginPath();context.moveTo(a.x,a.y);context.lineTo(p.x,p.y);context.moveTo(p.x,p.y);context.lineTo(q.x,q.y);context.lineTo(b.x,b.y);context.stroke();
    const angle=Math.atan2(q.y-p.y,q.x-p.x),dx=Math.cos(angle),dy=Math.sin(angle);
    for(const [point,sign] of [[p,1],[q,-1]] as const){context.beginPath();context.moveTo(point.x,point.y);context.lineTo(point.x+sign*dx*8-dy*3,point.y+sign*dy*8+dx*3);context.lineTo(point.x+sign*dx*8+dy*3,point.y+sign*dy*8-dx*3);context.closePath();context.fill();}
    context.translate((p.x+q.x)/2,(p.y+q.y)/2);context.rotate(angle>Math.PI/2||angle< -Math.PI/2?angle+Math.PI:angle);context.font="600 12px Inter, Arial, sans-serif";context.textAlign="center";context.fillText(object.label,0,-7);context.restore();return;
  }
  if (object.kind === "wire" || object.kind === "dimension" || object.kind === "physical-segment") {
    const points = view === "e4" && object.kind === "wire" ? getE4WireRoute(object) : object.points ?? [];
    if (points.length >= 2) {
      context.beginPath();
      points.forEach((point, index) => index === 0 ? context.moveTo(point.x, point.y) : context.lineTo(point.x, point.y));
      context.strokeStyle = selected ? "#1179ac" : object.color;
      context.lineWidth = selected ? 4 : object.kind === "wire" ? 3 : 1.5;
      if (object.kind === "dimension" || object.kind === "physical-segment" || object.metadata?.routeMissing === "true") context.setLineDash([7, 5]);
      if (view === "e4" && object.kind === "wire" && !selected) strokeE4Wire(context, object.color);
      else context.stroke();
      context.setLineDash([]);
      if (view === "drawing" && object.kind === "wire") drawWireStripProfiles(context, object, selected);
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
      const rawLabelPosition = Number(object.metadata?.e4LabelPosition ?? "0.5");
      const labelPosition = Number.isFinite(rawLabelPosition) && rawLabelPosition >= 0 && rawLabelPosition <= 1
        ? rawLabelPosition
        : 0.5;
      const labelLayout = view === "e4" && object.kind === "wire" && object.label
        ? getE4WireLabelLayout(points, object.label, labelPosition)
        : null;
      const middle = points[Math.floor(points.length / 2)];
      if (labelLayout) {
        context.fillStyle = "rgba(255, 255, 255, 0.94)";
        roundedRectangle(context, labelLayout.x, labelLayout.y, labelLayout.width, labelLayout.height, 3);
        context.fill();
        context.font = "600 12px Inter, Arial, sans-serif";
        context.fillStyle = "#34566a";
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(object.label, labelLayout.x + labelLayout.width / 2, labelLayout.y + labelLayout.height / 2);
        context.textAlign = "start";
        context.textBaseline = "alphabetic";
      } else if (view !== "e4" && middle && object.label) {
        context.font = "600 12px Inter, Arial, sans-serif";
        context.fillStyle = "#34566a";
        context.fillText(object.label, middle.x + 8, middle.y - 9);
      }
    }
  } else if (object.kind === "connector") {
    const e4Layout = view === "e4" ? getE4ConnectorLayout(object) : null;
    if (e4Layout) {
      drawE4Connector(context, object, e4Layout, selected);
      drawConnectorContactOverrides(context, object, view, false);
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
    const materializedPoints = getMaterializedConnectorContactPoints(object);
    const points = legacyConnectorContactPoints(object);
    for (let index = 0; index < points.length; index += 1) {
      if (view==="drawing"&&materializedPoints || materializedPoints?.[index]) continue;
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
    if (materializedPoints) drawConnectorContactOverrides(context, object, view, false);
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

const E4_WHITE_WIRE_OUTLINE = "#53636c";

function isWhiteWireColor(color: string): boolean {
  const normalized = color.trim().toLowerCase().replace(/\s+/g, "");
  return normalized === "white" || normalized === "#fff" || normalized === "#ffffff" ||
    normalized === "#ffffffff" || normalized === "rgb(255,255,255)" || normalized === "rgba(255,255,255,1)";
}

/** Keeps a white E4 conductor visible on the pale canvas without changing its actual colour. */
function strokeE4Wire(context: CanvasRenderingContext2D, color: string, width = 3): void {
  if (isWhiteWireColor(color)) {
    context.strokeStyle = E4_WHITE_WIRE_OUTLINE;
    context.lineWidth = width + 2;
    context.stroke();
  }
  context.strokeStyle = color;
  context.lineWidth = width;
  context.stroke();
}

function drawE4BridgeCrossings(
  context: CanvasRenderingContext2D,
  crossings: readonly E4WireCrossing[],
  objects: readonly EditorSceneObject[],
) {
  const radius = E4_BRIDGE_RADIUS;
  for (const crossing of crossings) {
    const over = objects.find((object) => object.id === crossing.overWireId);
    const under = objects.find((object) => object.id === crossing.underWireId);
    if (!over || !under) continue;
    const geometry = getE4BridgeGeometry(crossing, radius);
    context.save();
    context.lineJoin = "round";
    // Remove the straight portion which the bridge replaces, then restore the
    // perpendicular conductor through the cleared centre. This keeps its
    // colour continuous instead of leaving the white break created by the
    // former eraser-only implementation.
    context.strokeStyle = "#f8fafb";
    context.lineWidth = 7;
    context.lineCap = "butt";
    context.beginPath();
    context.moveTo(geometry.clearStart.x, geometry.clearStart.y);
    context.lineTo(geometry.clearEnd.x, geometry.clearEnd.y);
    context.stroke();
    context.lineCap = "butt";
    context.beginPath();
    if (crossing.overOrientation === "horizontal") {
      context.moveTo(crossing.point.x, crossing.point.y - 5);
      context.lineTo(crossing.point.x, crossing.point.y + 5);
    } else {
      context.moveTo(crossing.point.x - 5, crossing.point.y);
      context.lineTo(crossing.point.x + 5, crossing.point.y);
    }
    strokeE4Wire(context, under.color);
    // A halo which follows the raised path establishes layer order. Drawing
    // the same path in colour afterwards keeps the bridge and both feet whole.
    context.strokeStyle = "#f8fafb";
    context.lineWidth = 7;
    context.beginPath();
    context.moveTo(geometry.coloredStart.x, geometry.coloredStart.y);
    context.lineTo(geometry.arcStart.x, geometry.arcStart.y);
    if (crossing.overOrientation === "horizontal") {
      context.bezierCurveTo(
        crossing.point.x - radius / 2, crossing.point.y - radius,
        crossing.point.x + radius / 2, crossing.point.y - radius,
        crossing.point.x + radius, crossing.point.y,
      );
    } else {
      context.bezierCurveTo(
        crossing.point.x + radius, crossing.point.y - radius / 2,
        crossing.point.x + radius, crossing.point.y + radius / 2,
        crossing.point.x, crossing.point.y + radius,
      );
    }
    context.lineTo(geometry.coloredEnd.x, geometry.coloredEnd.y);
    context.stroke();
    context.lineCap = "round";
    strokeE4Wire(context, over.color);
    context.restore();
  }
}

export function drawE4DifferentialPairs(
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
    for (const [motifIndex, motif] of layout.motifs.entries()) {
      const { from, to, coloredFrom, coloredTo, center: along } = motif;
      const crossingLength = to - from;
      context.save();
      context.lineJoin = "round";
      context.lineCap = "butt";
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
      context.lineCap = "round";
      const traceMotif = (reverse: boolean, extendBefore: boolean, extendAfter: boolean) => {
        const crossStart = reverse ? layout.crossMaximum : layout.crossMinimum;
        const crossEnd = reverse ? layout.crossMinimum : layout.crossMaximum;
        context.beginPath();
        if (span.orientation === "horizontal") {
          context.moveTo(extendBefore ? coloredFrom : from, crossStart);
          context.lineTo(from, crossStart);
          if (layout.variant === 2) context.lineTo(to, crossEnd);
          else context.bezierCurveTo(along - crossingLength / 4, crossStart, along + crossingLength / 4, crossEnd, to, crossEnd);
          context.lineTo(extendAfter ? coloredTo : to, crossEnd);
        } else {
          context.moveTo(crossStart, extendBefore ? coloredFrom : from);
          context.lineTo(crossStart, from);
          if (layout.variant === 2) context.lineTo(crossEnd, to);
          else context.bezierCurveTo(crossStart, along - crossingLength / 4, crossEnd, along + crossingLength / 4, crossEnd, to);
          context.lineTo(crossEnd, extendAfter ? coloredTo : to);
        }
      };
      // Each X represents two wires swapping lanes. Before the first motif the
      // colours belong to their original lanes; after it they belong to the
      // opposite lanes, and every following motif swaps them back. Repaint the
      // straight spans between motifs with the colour of the physical wire
      // which currently occupies that lane, avoiding a colour splice at the
      // feet of an X.
      const firstStartsOnMinimum = motifIndex % 2 === 0;
      traceMotif(!firstStartsOnMinimum, true, true);
      // Both conductors need a halo against the scene painted below. Without
      // this first stroke, a third wire running between the pair's lanes looks
      // electrically joined to the first diagonal at their intersection.
      context.strokeStyle = "#f8fafb";
      context.lineWidth = 7;
      context.lineCap = "butt";
      context.stroke();
      traceMotif(!firstStartsOnMinimum, true, true);
      context.lineCap = "round";
      strokeE4Wire(context, first.color);
      traceMotif(firstStartsOnMinimum, true, true);
      context.strokeStyle = "#f8fafb";
      context.lineWidth = 7;
      context.lineCap = "butt";
      context.stroke();
      context.lineCap = "round";
      strokeE4Wire(context, second.color);
      const nextMotif = layout.motifs[motifIndex + 1];
      const straightEnd = nextMotif?.from ?? span.end;
      if (straightEnd > to) {
        const drawLane = (cross: number, color: string) => {
          context.beginPath();
          if (span.orientation === "horizontal") {
            context.moveTo(to, cross);
            context.lineTo(straightEnd, cross);
          } else {
            context.moveTo(cross, to);
            context.lineTo(cross, straightEnd);
          }
          context.lineCap = "butt";
          strokeE4Wire(context, color);
        };
        const afterSwap = motifIndex % 2 === 0;
        drawLane(layout.crossMinimum, afterSwap ? second.color : first.color);
        drawLane(layout.crossMaximum, afterSwap ? first.color : second.color);
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
    for (const terminal of layout.terminals) {
      context.beginPath();
      context.arc(terminal.connectionPoint.x, terminal.connectionPoint.y, 3.5, 0, Math.PI * 2);
      context.fillStyle = "#183b4d";
      context.fill();
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
  componentTemplateViewInstances: readonly ComponentTemplateViewInstance[] = [],
  resolveComponentTemplateAssetUrl?: ResolveComponentTemplateAssetUrl,
  cables: readonly CableInstance[] = [],
): EditorSceneBounds | null {
  let bounds: EditorSceneBounds | null = null;
  const visibleObjects = objectsInPaintOrder(objects, layers);
  const componentViews = new Map(componentTemplateViewInstances.map(instance => [instance.objectId, instance]));
  for (const object of visibleObjects) {
    if (object.kind === "wire" || object.kind === "dimension" || object.kind === "physical-segment" || object.kind === "physical-covering") {
      const points = view === "e4" && object.kind === "wire" ? getE4WireRoute(object) : object.points ?? [];
      for (const point of points) {
        bounds = expandSceneBounds(bounds, point.x, point.y, point.x, point.y);
      }
      for (const geometry of getDrawingWireStripProfileGeometries(object, view)) {
        for (const primitive of geometry.primitives) {
          for (const point of primitive.polygon) {
            bounds = expandSceneBounds(
              bounds,
              point.x - stripProfileStrokeWidth / 2,
              point.y - stripProfileStrokeWidth / 2,
              point.x + stripProfileStrokeWidth / 2,
              point.y + stripProfileStrokeWidth / 2,
            );
          }
        }
      }
      if (view === "e4" && object.kind === "wire" && object.label) {
        const rawPosition = Number(object.metadata?.e4LabelPosition ?? "0.5");
        const position = Number.isFinite(rawPosition) && rawPosition >= 0 && rawPosition <= 1 ? rawPosition : 0.5;
        const label = getE4WireLabelLayout(points, object.label, position);
        if (label) bounds = expandSceneBounds(bounds, label.x, label.y, label.x + label.width, label.y + label.height);
      }
      continue;
    }
    const instance = object.kind === "connector" ? componentViews.get(object.id) : undefined;
    if (instance && view === "e4") {
      const companion = projectE4DrawingCompanion(instance, object, getE4ConnectorLayout(object)?.width ?? object.width, resolveComponentTemplateAssetUrl);
      if (companion) bounds = expandSceneBounds(bounds, companion.bounds.minX, companion.bounds.minY, companion.bounds.maxX, companion.bounds.maxY);
    }
    const projection = instance
      ? projectComponentTemplateView(instance, view, { x: object.x, y: object.y }, resolveComponentTemplateAssetUrl)
      : null;
    if (projection) {
      bounds = expandSceneBounds(
        bounds,
        projection.bounds.minX,
        projection.bounds.minY,
        projection.bounds.maxX,
        projection.bounds.maxY,
      );
      for (const point of connectorCanvasContactPoints(object, view)) {
        if (!point) continue;
        const cross = point.status === "not-connected" ? contactCrossCenter(point) : point;
        const markerRadius = point.status === "not-connected" ? point.crossSize : 4;
        bounds = expandSceneBounds(
          bounds,
          Math.min(point.x, cross.x) - markerRadius,
          Math.min(point.y, cross.y) - markerRadius,
          Math.max(point.x, cross.x) + markerRadius,
          Math.max(point.y, cross.y) + markerRadius,
        );
        if (point.secondaryPoint) bounds = expandSceneBounds(
          bounds,
          point.secondaryPoint.x - 4,
          point.secondaryPoint.y - 4,
          point.secondaryPoint.x + 4,
          point.secondaryPoint.y + 4,
        );
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
    for (const point of connectorCanvasContactPoints(object, view)) {
      if (!point) continue;
      const cross = point.status === "not-connected" ? contactCrossCenter(point) : point;
      const markerRadius = point.status === "not-connected" ? point.crossSize : 4;
      bounds = expandSceneBounds(
        bounds,
        Math.min(point.x, cross.x) - markerRadius,
        Math.min(point.y, cross.y) - markerRadius,
        Math.max(point.x, cross.x) + markerRadius,
        Math.max(point.y, cross.y) + markerRadius,
      );
      if (point.secondaryPoint) bounds = expandSceneBounds(
        bounds,
        point.secondaryPoint.x - 4,
        point.secondaryPoint.y - 4,
        point.secondaryPoint.x + 4,
        point.secondaryPoint.y + 4,
      );
    }
  }

  if (view !== "e4") {
    for (const geometry of getVisibleCableSheathScene(cables, visibleObjects, layers).geometries) {
      bounds = expandSceneBounds(
        bounds,
        geometry.bounds.x,
        geometry.bounds.y,
        geometry.bounds.x + geometry.bounds.width,
        geometry.bounds.y + geometry.bounds.height,
      );
    }
    return bounds;
  }
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
    bounds = expandSceneBounds(
      bounds,
      layout.center.x - width / 2,
      layout.center.y - height / 2,
      layout.center.x + width / 2,
      layout.center.y + height / 2,
    );
    for (const terminal of layout.terminals) bounds = expandSceneBounds(
      bounds,
      terminal.connectionPoint.x - 4,
      terminal.connectionPoint.y - 4,
      terminal.connectionPoint.x + 4,
      terminal.connectionPoint.y + 4,
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
  cables: readonly CableInstance[] = [],
  e4Overlays?: E4SceneOverlays,
  alignmentGuides?: E4ConnectorSnapGuides,
  componentTemplateViewInstances: readonly ComponentTemplateViewInstance[] = [],
  resolveComponentTemplateAssetUrl?: ResolveComponentTemplateAssetUrl,
  componentTemplateImageCache = new ComponentTemplateImageCache(),
  highlightedObjectIds: readonly string[] = [],
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
  if (view === "drawing") {
    drawCableSheaths(
      context,
      getVisibleCableSheathScene(cables, objects, layers).geometries,
      selectedObjectIds,
      camera.zoom,
    );
  }
  const componentViews = new Map(componentTemplateViewInstances.map(instance => [instance.objectId, instance]));
  const highlighted = new Set(highlightedObjectIds);
  for (const object of objectsInPaintOrder(objects, layers)) {
    if (highlighted.has(object.id) && object.kind === "wire") {
      const points = view === "e4" ? getE4WireRoute(object) : object.points ?? [];
      context.save(); context.strokeStyle = "#f2af28"; context.globalAlpha = .65;
      context.lineWidth = 9 / Math.max(.5, camera.zoom); context.lineJoin = "round"; context.beginPath();
      points.forEach((point, i) => i ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y));
      context.stroke(); context.restore();
    }
    if(highlighted.has(object.id)&&object.kind!=="wire") {
      context.save();context.strokeStyle="#f2af28";context.globalAlpha=.7;context.lineWidth=6/Math.max(.5,camera.zoom);
      if(object.kind==="physical-covering") {for(const path of object.paths??[]){context.beginPath();path.forEach((p,i)=>i?context.lineTo(p.x,p.y):context.moveTo(p.x,p.y));context.stroke();}}
      else context.strokeRect(object.x-4,object.y-4,object.width+8,object.height+8);
      context.restore();
    }
    drawEditorSceneObject(
      context,
      object,
      selectedObjectIds.has(object.id),
      view,
      object.kind === "connector" ? componentViews.get(object.id) : undefined,
      resolveComponentTemplateAssetUrl,
      componentTemplateImageCache,
    );
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
    drawE4ConnectorAlignmentGuides(context, alignmentGuides, camera.zoom);
  }
  context.restore();
}

export function drawCableSheaths(
  context: CanvasRenderingContext2D,
  geometries: readonly CableSheathGeometry[],
  selectedObjectIds: ReadonlySet<string>,
  zoom = 1,
): void {
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  for (const geometry of geometries) {
    const selected = geometry.memberWireIds.length > 0 &&
      geometry.memberWireIds.every((wireId) => selectedObjectIds.has(wireId));
    context.save();
    context.beginPath();
    geometry.polygon.forEach((point, index) => index === 0
      ? context.moveTo(point.x, point.y)
      : context.lineTo(point.x, point.y));
    context.closePath();
    context.fillStyle = selected ? "rgba(17, 121, 172, 0.13)" : "rgba(82, 105, 119, 0.08)";
    context.fill();
    context.strokeStyle = selected ? "#1179ac" : "#607d8b";
    context.lineWidth = (selected ? 3 : 2) / safeZoom;
    context.setLineDash(selected ? [] : [8 / safeZoom, 4 / safeZoom]);
    context.stroke();
    context.restore();
  }
}

function drawE4ConnectorAlignmentGuides(
  context: CanvasRenderingContext2D,
  guides: E4ConnectorSnapGuides | undefined,
  zoom: number,
) {
  if (!guides?.horizontal && !guides?.vertical) return;
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  context.save();
  context.strokeStyle = "#e04f9c";
  context.lineWidth = 1 / safeZoom;
  context.setLineDash([4 / safeZoom, 3 / safeZoom]);
  context.beginPath();
  if (guides.vertical) {
    context.moveTo(guides.vertical.x, guides.vertical.fromY);
    context.lineTo(guides.vertical.x, guides.vertical.toY);
  }
  if (guides.horizontal) {
    context.moveTo(guides.horizontal.fromX, guides.horizontal.y);
    context.lineTo(guides.horizontal.toX, guides.horizontal.y);
  }
  context.stroke();
  context.restore();
}

function e4ConnectorSnapTarget(object: EditorSceneObject): E4ConnectorSnapTarget | null {
  const layout = getE4ConnectorLayout(object);
  if (!layout) return null;
  return {
    id: object.id,
    x: layout.x,
    y: layout.y,
    width: layout.width,
    height: layout.height,
    contactSide: layout.connectionSide,
    firstContactY: layout.contactPoints[0]?.y,
  };
}

export function CanvasViewport({
  view,
  tool,
  camera,
  objects,
  layers,
  selectedObjectId,
  selectedObjectIds,
  highlightedObjectIds = [],
  cables = [],
  e4Overlays,
  componentTemplateViewInstances = [],
  resolveComponentTemplateAssetUrl,
  overlay, drawingWindows,onDimensionCreate,
  diagnosticOverlay,
  inlineEditor,
  onCameraChange,
  onViewportSizeChange,
  onObjectSelect,
  onObjectGroupSelect,
  onRelatedObjectsSelect, onObjectMove, onDrawingMove, onDrawingScale,
  onObjectMovePreview,
  onWireConnect,
  onWireReconnect,
  onWireConnectToWire,
  onWireReconnectToWire,
  onE4WireSegmentMove,
  onE4WireRoutePointRemove,
  onE4WireLabelPositionChange,
  onE4ScreenPositionChange,
  onWireToolRequest,
  onWireRoutePointMove,
  onWireRoutePointRemove,
  onObjectEditRequest,
  onCanvasDoubleClick,
  onCatalogDrop,
}: CanvasViewportProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const componentTemplateImageCacheRef = useRef<ComponentTemplateImageCache | null>(null);
  if (!componentTemplateImageCacheRef.current) {
    componentTemplateImageCacheRef.current = new ComponentTemplateImageCache();
  }
  const dragRef = useRef<PointerDrag | ObjectPointerDrag | DrawingPointerDrag | WireRoutePointerDrag |
    E4WireSegmentPointerDrag | E4WireLabelPointerDrag | E4ScreenPointerDrag | null>(null);
  const inlineDragRef = useRef<ObjectPointerDrag | null>(null);
  const inlineDragActivatedRef = useRef(false);
  const suppressInlineDoubleClickUntilRef = useRef(0);
  const [inlineDragOffset, setInlineDragOffset] = useState<EditorPoint | null>(null);
  const [drawingPreview,setDrawingPreview]=useState<{objectId:string;drawingId:string;offset:EditorPoint}|null>(null);
  const [scalePreview,setScalePreview]=useState<{objectId:string;drawingId:string;scale:number}|null>(null);
  const displayInstances=componentTemplateViewInstances.map(instance=>{
    const change=drawingPreview?.objectId===instance.objectId?drawingPreview:scalePreview?.objectId===instance.objectId?scalePreview:null;
    if(!change)return instance;
    const previous=instance.drawingPlacements?.find(p=>p.drawingId===change.drawingId)??{drawingId:change.drawingId,visible:true,offset:{x:0,y:0}};
    return {...instance,drawingPlacements:[...(instance.drawingPlacements??[]).filter(p=>p.drawingId!==change.drawingId),{...previous,...("scale" in change?{scale:change.scale}:{offset:change.offset})}]};
  });
  const [dimensionStart,setDimensionStart]=useState<{wireId:string;index:number;point:EditorPoint;pointCount:number}[]>([]);
  const [dimensionMessage,setDimensionMessage]=useState("");
  useEffect(()=>{setDimensionStart([]);setDimensionMessage("");},[tool,view]);
  const [wireStart, setWireStart] = useState<E4ConnectableEndpoint | null>(null);
  const [wireReconnect, setWireReconnect] = useState<{ readonly wireId: string; readonly end: "from" | "to" } | null>(null);
  const [wireLabelPreview, setWireLabelPreview] = useState<{ readonly wireId: string; readonly position: number } | null>(null);
  const [screenPositionPreview, setScreenPositionPreview] = useState<{ readonly screenId: string; readonly position: number } | null>(null);
  const [connectorAlignmentGuides, setConnectorAlignmentGuides] = useState<E4ConnectorSnapGuides>({});
  const displayObjects = wireLabelPreview
    ? objects.map((object) => object.id === wireLabelPreview.wireId ? {
      ...object,
      metadata: { ...object.metadata, e4LabelPosition: String(wireLabelPreview.position) },
    } : object)
    : objects;
  const activeSelectedIds = selectedObjectIds ?? (selectedObjectId ? [selectedObjectId] : []);
  const selectedSet = new Set(activeSelectedIds);
  const sourceOverlays = useMemo(
    () => e4Overlays ?? parseE4SceneOverlays(objects),
    [e4Overlays, objects],
  );
  const overlays = useMemo(() => screenPositionPreview ? {
    ...sourceOverlays,
    screens: sourceOverlays.screens.map((screen) => screen.id === screenPositionPreview.screenId
      ? { ...screen, position: screenPositionPreview.position }
      : screen),
  } : sourceOverlays, [screenPositionPreview, sourceOverlays]);
  const cableSheathScene = useMemo(
    () => view === "drawing"
      ? getVisibleCableSheathScene(cables, displayObjects, layers)
      : { geometries: [], incompatibleCableIds: [] },
    [cables, displayObjects, layers, view],
  );
  const selectLinkedE4Group = (wireIds: readonly string[]) => {
    if (onObjectGroupSelect) onObjectGroupSelect(wireIds);
    else onObjectSelect(wireIds.at(-1) ?? null, false);
  };
  const selectedObject = objects.find(object => object.id === selectedObjectId);
  const selectedComponentTemplateInstance = componentTemplateViewInstances.find(instance => instance.objectId === selectedObjectId);
  const selectedHasComponentTemplateView = !!selectedObject && !!selectedComponentTemplateInstance &&
    projectComponentTemplateView(
      selectedComponentTemplateInstance,
      view,
      { x: selectedObject.x, y: selectedObject.y },
      resolveComponentTemplateAssetUrl,
    ) !== null;
  const inlineObject = view === "e4" && tool === "select" && selectedObjectId && !selectedHasComponentTemplateView
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
    const activeObjectId = inlineDragRef.current?.objectId ??
      (dragRef.current?.kind === "object" ? dragRef.current.objectId : null);
    if (activeObjectId) onObjectMovePreview?.(activeObjectId, null);
    inlineDragRef.current = null;
    if (dragRef.current?.kind === "object") dragRef.current = null;
    inlineDragActivatedRef.current = false;
    setInlineDragOffset(null);
    setConnectorAlignmentGuides({});
  }, [inlineObject?.id, onObjectMovePreview, tool, view]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const redraw = () => {
      redrawCanvas(
        canvas,
        view,
        camera,
        displayObjects,
        layers,
        selectedSet,
        cables,
        overlays,
        connectorAlignmentGuides,
        displayInstances,
        resolveComponentTemplateAssetUrl,
        componentTemplateImageCacheRef.current!,
        highlightedObjectIds,
      );
      onViewportSizeChange?.({
        width: Math.max(1, Math.round(canvas.clientWidth)),
        height: Math.max(1, Math.round(canvas.clientHeight)),
      });
    };
    componentTemplateImageCacheRef.current!.setInvalidate(redraw);
    redraw();
    const observer = new ResizeObserver(redraw);
    observer.observe(canvas);
    return () => {
      observer.disconnect();
      componentTemplateImageCacheRef.current?.setInvalidate(null);
    };
  }, [highlightedObjectIds, cables, camera, displayInstances, connectorAlignmentGuides, displayObjects, inlineObject?.id, layers, onViewportSizeChange, overlays, resolveComponentTemplateAssetUrl, selectedObjectIds, selectedObjectId, view]);

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

  const snappedObjectDestination = (objectId: string, destination: EditorPoint): EditorPoint => {
    if (view !== "e4") {
      setConnectorAlignmentGuides({});
      return destination;
    }
    const movingObject = objects.find((object) => object.id === objectId);
    const moving = movingObject ? e4ConnectorSnapTarget(movingObject) : null;
    if (!moving) {
      setConnectorAlignmentGuides({});
      return destination;
    }
    const result = snapE4ConnectorPosition(
      moving,
      objects.flatMap((object) => {
        if (layers.find((layer) => layer.id === object.layerId)?.visible === false) return [];
        const target = e4ConnectorSnapTarget(object);
        return target ? [target] : [];
      }),
      destination,
      camera.zoom,
    );
    setConnectorAlignmentGuides(result.guides);
    return result.position;
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
    if(view==="drawing"&&tool.startsWith("dimension")&&event.button===0){
      const point=screenToWorld(camera,localPoint(event.clientX,event.clientY));
      const candidates=objects.filter(o=>o.kind==="wire"&&layers.some(l=>l.id===o.layerId&&l.visible&&!l.locked)).flatMap(w=>(w.points??[]).map((p,index)=>({wireId:w.id,index,point:p,pointCount:w.points!.length}))).filter(c=>Math.hypot(c.point.x-point.x,c.point.y-point.y)*camera.zoom<=12).sort((a,b)=>Number(b.wireId===selectedObjectId)-Number(a.wireId===selectedObjectId));
      if(!candidates.length){setDimensionMessage("Укажите конец провода или перегиб");return;}
      if(!dimensionStart.length){setDimensionStart(candidates);setDimensionMessage("Укажите вторую точку того же провода");return;}
      const end=candidates.find(c=>dimensionStart.some(a=>a.wireId===c.wireId&&a.index!==c.index));
      const start=end&&dimensionStart.find(a=>a.wireId===end.wireId&&a.index!==end.index);
      if(!end||!start){setDimensionMessage("Нужны две разные точки одного провода");return;}
      onDimensionCreate?.(end.wireId,start.index,end.index,end.pointCount,tool==="dimension-horizontal"?"horizontal":tool==="dimension-vertical"?"vertical":"aligned");
      setDimensionStart([]);return;
    }
    if (tool === "wire") {
      const worldPoint = screenToWorld(camera, localPoint(event.clientX, event.clientY));
      const endpoint = (view === "e4"
        ? hitTestE4ScreenConnection(overlays.screens, objects, worldPoint, camera.zoom, layers)
        : null) ?? hitTestConnectorContact(
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
        if ("screenId" in endpoint) {
          const screen = overlays.screens.find((item) => item.id === endpoint.screenId);
          if (screen) selectLinkedE4Group(screen.wireIds);
        } else {
          onObjectSelect(endpoint.connectorId, false);
        }
      } else {
        const sameEndpoint = "screenId" in wireStart
          ? "screenId" in endpoint && wireStart.screenId === endpoint.screenId &&
            (wireStart.screenTerminalSide ?? "above") === (endpoint.screenTerminalSide ?? "above")
          : "connectorId" in endpoint && wireStart.connectorId === endpoint.connectorId &&
            wireStart.contactIndex === endpoint.contactIndex;
        if (!sameEndpoint) {
          onWireConnect?.(wireStart, endpoint);
        }
        setWireStart(null);
      }
      return;
    }
    if (tool === "select") {
      const worldPoint = screenToWorld(camera, localPoint(event.clientX, event.clientY));
      if(view==="e4" && onDrawingMove && event.button===0) {
        for(const object of [...objects].reverse()) {
          const layer=layers.find(l=>l.id===object.layerId),instance=componentTemplateViewInstances.find(i=>i.objectId===object.id);
          if(object.kind!=="connector" || !instance || !layer?.visible || layer.locked) continue;
          const drawing=projectE4DrawingCompanions(instance,object,getE4ConnectorLayout(object)?.width ?? object.width,resolveComponentTemplateAssetUrl).reverse().find(d=>d.visible && worldPoint.x>=d.bounds.minX && worldPoint.x<=d.bounds.maxX && worldPoint.y>=d.bounds.minY && worldPoint.y<=d.bounds.maxY);
          if(drawing) {event.currentTarget.setPointerCapture(event.pointerId);onObjectSelect(object.id,false);dragRef.current={kind:"companion",pointerId:event.pointerId,clientX:event.clientX,clientY:event.clientY,objectId:object.id,drawingId:drawing.drawingId,offset:drawing.offset};return;}
        }
      }
      if (view === "e4") {
        const screen = hitTestE4Screen(overlays.screens, objects, worldPoint, camera.zoom, layers);
        const endpoint = hitTestE4ScreenConnection(overlays.screens, objects, worldPoint, camera.zoom, layers) ??
          (screen ? null : hitTestConnectorContact(objects, layers, worldPoint, camera.zoom, view));
        if (endpoint && onWireToolRequest) {
          setWireStart(endpoint);
          if ("screenId" in endpoint) {
            const screen = overlays.screens.find((item) => item.id === endpoint.screenId);
            if (screen) selectLinkedE4Group(screen.wireIds);
          } else {
            onObjectSelect(endpoint.connectorId, false);
          }
          onWireToolRequest();
          return;
        }
        if (screen) {
          selectLinkedE4Group(screen.wireIds);
          if (onE4ScreenPositionChange) {
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
          }
          return;
        }
        const differentialPair = hitTestE4DifferentialPair(
          overlays.diffPairs,
          objects,
          worldPoint,
          camera.zoom,
          layers,
        );
        if (differentialPair) {
          selectLinkedE4Group(differentialPair.wireIds);
          return;
        }
        const wireLabel = onE4WireLabelPositionChange
          ? hitTestE4WireLabel(objects, layers, worldPoint, camera.zoom)
          : null;
        if (wireLabel) {
          const wire = objects.find((item) => item.id === wireLabel.wireId);
          const layer = wire ? layers.find((item) => item.id === wire.layerId) : null;
          onObjectSelect(wireLabel.wireId, false);
          if (layer?.locked !== true) {
            event.currentTarget.setPointerCapture(event.pointerId);
            dragRef.current = { kind: "e4-wire-label", pointerId: event.pointerId, wireId: wireLabel.wireId };
          }
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
        const cableSheath = hitTestCableSheath(cableSheathScene.geometries, worldPoint, camera.zoom);
        if (cableSheath) {
          selectLinkedE4Group(cableSheath.memberWireIds);
          return;
        }
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
        componentTemplateViewInstances,
        resolveComponentTemplateAssetUrl,
      );
      const table=objects.find(o=>o.id===objectId&&o.kind==="drawing-table");
      if(table && worldPoint.y>=table.y+52 && onRelatedObjectsSelect) {
        const rows=JSON.parse(table.metadata?.rowObjectIds ?? "[]") as string[][];
        const ids=rows[Math.floor((worldPoint.y-table.y-52)/32)];if(ids){onRelatedObjectsSelect(ids);return;}
      }
      const selectedObject = objects.find((item) => item.id === selectedObjectId);
      const preserveWireForRoutePoint = view === "drawing" && objectId === null &&
        (selectedObject?.kind === "wire" || selectedObject?.kind === "physical-segment") && onCanvasDoubleClick !== undefined;
      if (!preserveWireForRoutePoint) onObjectSelect(objectId, event.ctrlKey || event.shiftKey);
      const object = objects.find((item) => item.id === objectId);
      const layer = object ? layers.find((item) => item.id === object.layerId) : null;
      if (object && (object.kind === "connector" || object.kind === "physical-node" || object.kind === "drawing-table" || object.kind === "position-leader" || object.kind === "leader-anchor") && layer?.locked !== true && onObjectMove) {
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
    if(drag.kind==="companion") { setDrawingPreview({objectId:drag.objectId,drawingId:drag.drawingId,offset:{x:drag.offset.x+(event.clientX-drag.clientX)/camera.zoom,y:drag.offset.y+(event.clientY-drag.clientY)/camera.zoom}});
    } else if (drag.kind === "pan") {
      onCameraChange(panEditorCamera(drag.camera, event.clientX - drag.clientX, event.clientY - drag.clientY));
    } else if (drag.kind === "object" && inlineObjectDragMoved(event.clientX - drag.clientX, event.clientY - drag.clientY)) {
      const destination = snappedObjectDestination(drag.objectId, inlineObjectDragDestination(
        { x: drag.objectX, y: drag.objectY },
        event.clientX - drag.clientX,
        event.clientY - drag.clientY,
        camera.zoom,
      ));
      if (onObjectMovePreview) onObjectMovePreview(drag.objectId, destination);
      else setInlineDragOffset({
        x: (destination.x - drag.objectX) * camera.zoom,
        y: (destination.y - drag.objectY) * camera.zoom,
      });
    } else if (drag.kind === "e4-wire-label") {
      const wire = objects.find((item) => item.id === drag.wireId);
      const position = wire
        ? projectPointToE4WireLabelPosition(getE4WireRoute(wire), screenToWorld(camera, localPoint(event.clientX, event.clientY)))
        : null;
      if (position !== null) setWireLabelPreview({ wireId: drag.wireId, position });
    } else if (drag.kind === "e4-screen") {
      const screen = overlays.screens.find((item) => item.id === drag.screenId);
      const layout = screen ? getE4ScreenLayout(screen, objects) : null;
      const worldPoint = screenToWorld(camera, localPoint(event.clientX, event.clientY));
      if (layout) {
        setScreenPositionPreview({
          screenId: drag.screenId,
          position: getE4ScreenPositionForPoint(layout, worldPoint),
        });
      }
    }
  };

  const endPointer = (event: PointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    if(dragRef.current?.kind==="companion") {
      const drag=dragRef.current;
      if(inlineObjectDragMoved(event.clientX-drag.clientX,event.clientY-drag.clientY)) onDrawingMove?.(drag.objectId,drag.drawingId,{x:drag.offset.x+(event.clientX-drag.clientX)/camera.zoom,y:drag.offset.y+(event.clientY-drag.clientY)/camera.zoom});
      setDrawingPreview(null);
    } else if (dragRef.current?.kind === "object") {
      const drag = dragRef.current;
      const deltaX = event.clientX - drag.clientX;
      const deltaY = event.clientY - drag.clientY;
      if (inlineObjectDragMoved(deltaX, deltaY)) {
        onObjectMove?.(drag.objectId, snappedObjectDestination(
          drag.objectId,
          inlineObjectDragDestination({ x: drag.objectX, y: drag.objectY }, deltaX, deltaY, camera.zoom),
        ));
      }
      onObjectMovePreview?.(drag.objectId, null);
      setConnectorAlignmentGuides({});
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
    } else if (dragRef.current?.kind === "e4-wire-label") {
      const drag = dragRef.current;
      const wire = objects.find((item) => item.id === drag.wireId);
      const position = wire
        ? projectPointToE4WireLabelPosition(getE4WireRoute(wire), screenToWorld(camera, localPoint(event.clientX, event.clientY)))
        : null;
      if (position !== null) onE4WireLabelPositionChange?.(drag.wireId, position);
      setWireLabelPreview(null);
    } else if (dragRef.current?.kind === "e4-screen") {
      const drag = dragRef.current;
      if (screenPositionPreview?.screenId === drag.screenId) {
        onE4ScreenPositionChange?.(drag.screenId, screenPositionPreview.position);
      } else {
        const screen = overlays.screens.find((item) => item.id === drag.screenId);
        const layout = screen ? getE4ScreenLayout(screen, objects) : null;
        const worldPoint = screenToWorld(camera, localPoint(event.clientX, event.clientY));
        if (layout) {
          onE4ScreenPositionChange?.(drag.screenId, getE4ScreenPositionForPoint(layout, worldPoint));
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
      setScreenPositionPreview(null);
    }
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const cancelPointer = (event: PointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    if(dragRef.current.kind==="companion") setDrawingPreview(null);
    if (dragRef.current.kind === "object") {
      onObjectMovePreview?.(dragRef.current.objectId, null);
      setConnectorAlignmentGuides({});
    }
    if (dragRef.current.kind === "e4-wire-label") setWireLabelPreview(null);
    if (dragRef.current.kind === "e4-screen") setScreenPositionPreview(null);
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
    if (view === "e4" && tool === "select" && onE4WireRoutePointRemove) {
      const selectedWire = objects.find((item) => item.id === selectedObjectId);
      const selectedLayer = selectedWire ? layers.find((item) => item.id === selectedWire.layerId) : null;
      const routeIndex = selectedLayer?.locked === true
        ? null
        : hitTestWireRoutePoint(selectedWire, point, camera.zoom);
      if (selectedWire && routeIndex !== null) {
        onE4WireRoutePointRemove(selectedWire.id, routeIndex);
        return;
      }
    }
    if (view === "e4" && tool === "select" && onObjectEditRequest) {
      const objectId = hitTestEditorScene(
        objects,
        layers,
        point,
        camera.zoom,
        view,
        componentTemplateViewInstances,
        resolveComponentTemplateAssetUrl,
      );
      const object = objects.find((item) => item.id === objectId);
      const layer = object ? layers.find((item) => item.id === object.layerId) : null;
      if (object?.kind === "connector" && layer?.locked !== true) {
        onObjectSelect(object.id, false);
        onObjectEditRequest(object.id);
        return;
      }
    }
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

  const inlinePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    containInlineEditorPointerEvent(event);
    if (isInlineEditorControlTarget(event.target)) return;
    if (event.button === 0 && view === "e4" && tool === "select" && onWireToolRequest) {
      const endpoint = hitTestConnectorContact(
        objects,
        layers,
        screenToWorld(camera, localPoint(event.clientX, event.clientY)),
        camera.zoom,
        view,
      );
      if (endpoint) {
        setWireStart(endpoint);
        onObjectSelect(endpoint.connectorId, false);
        onWireToolRequest();
        return;
      }
    }
    if (event.button !== 0 || tool !== "select" || !inlineObject ||
        !isInlineEditorReadonlyTarget(event.target)) return;
    const layer = layers.find((item) => item.id === inlineObject.layerId);
    if (layer?.locked === true) return;
    if (event.detail >= 2 && Date.now() > suppressInlineDoubleClickUntilRef.current && onObjectEditRequest) {
      onObjectEditRequest(inlineObject.id);
      return;
    }
    if (!onObjectMove) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    inlineDragRef.current = {
      kind: "object",
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      objectId: inlineObject.id,
      objectX: inlineObject.x,
      objectY: inlineObject.y,
    };
    inlineDragActivatedRef.current = false;
  };

  const inlinePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    containInlineEditorPointerEvent(event);
    if (inlineDragRef.current?.pointerId !== event.pointerId) return;
    const drag = inlineDragRef.current;
    const deltaX = event.clientX - drag.clientX;
    const deltaY = event.clientY - drag.clientY;
    if (inlineObjectDragMoved(deltaX, deltaY)) {
      onObjectMove?.(drag.objectId, snappedObjectDestination(
        drag.objectId,
        inlineObjectDragDestination({ x: drag.objectX, y: drag.objectY }, deltaX, deltaY, camera.zoom),
      ));
    }
    onObjectMovePreview?.(drag.objectId, null);
    setConnectorAlignmentGuides({});
    if (inlineDragActivatedRef.current) suppressInlineDoubleClickUntilRef.current = Date.now() + 500;
    setInlineDragOffset(null);
    inlineDragRef.current = null;
    inlineDragActivatedRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const inlinePointerCancel = (event: PointerEvent<HTMLDivElement>) => {
    containInlineEditorPointerEvent(event);
    if (inlineDragRef.current?.pointerId !== event.pointerId) return;
    onObjectMovePreview?.(inlineDragRef.current.objectId, null);
    setConnectorAlignmentGuides({});
    setInlineDragOffset(null);
    inlineDragRef.current = null;
    inlineDragActivatedRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const inlinePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    containInlineEditorPointerEvent(event);
    const drag = inlineDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.clientX;
    const deltaY = event.clientY - drag.clientY;
    if (!inlineObjectDragMoved(deltaX, deltaY)) return;
    inlineDragActivatedRef.current = true;
    event.preventDefault();
    const destination = snappedObjectDestination(drag.objectId, inlineObjectDragDestination(
      { x: drag.objectX, y: drag.objectY },
      deltaX,
      deltaY,
      camera.zoom,
    ));
    if (onObjectMovePreview) {
      setInlineDragOffset(null);
      onObjectMovePreview(drag.objectId, destination);
    } else {
      setInlineDragOffset({
        x: (destination.x - drag.objectX) * camera.zoom,
        y: (destination.y - drag.objectY) * camera.zoom,
      });
    }
  };

  const inlineDoubleClick = (event: MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (isInlineEditorControlTarget(event.target)) return;
    if (!inlineObject || Date.now() <= suppressInlineDoubleClickUntilRef.current) {
      event.preventDefault();
      return;
    }
    const layer = layers.find((item) => item.id === inlineObject.layerId);
    if (tool === "select" && layer?.locked !== true) onObjectEditRequest?.(inlineObject.id);
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
        onPointerCancel={cancelPointer}
        onDragOver={allowDrop}
        onDrop={drop}
        onDoubleClick={doubleClick}
      />
      {tool==="select" && onDrawingScale && objects.filter(o=>o.id===selectedObjectId&&o.kind==="connector"&&layers.some(l=>l.id===o.layerId&&l.visible&&!l.locked)).flatMap(object=>{
        const instance=displayInstances.find(i=>i.objectId===object.id);if(!instance)return [];
        const drawings=view==="e4"?projectE4DrawingCompanions(instance,object,getE4ConnectorLayout(object)?.width??object.width,resolveComponentTemplateAssetUrl).filter(d=>d.visible):[];
        const projected=view==="drawing"?projectComponentTemplateView(instance,view,object,resolveComponentTemplateAssetUrl):null;
        const targets=view==="e4"?drawings.map(d=>({id:d.drawingId,x:d.bounds.maxX,y:d.bounds.minY,ax:d.bounds.minX,ay:d.bounds.maxY})) : projected?[{id:DRAWING_VIEW_PLACEMENT_ID,x:projected.bounds.maxX,y:projected.bounds.maxY,ax:object.x,ay:object.y}]:[];
        return targets.map(t=><DrawingResizeGrip key={`${object.id}:${t.id}`} x={t.x*camera.zoom+camera.offsetX} y={t.y*camera.zoom+camera.offsetY} vx={(t.x-t.ax)*camera.zoom} vy={(t.y-t.ay)*camera.zoom} scale={drawingScale(instance.drawingPlacements,t.id)} preview={scale=>setScalePreview(scale===null?null:{objectId:object.id,drawingId:t.id,scale})} commit={scale=>onDrawingScale(object.id,t.id,scale)}/>);
      })}
      <div className="he-canvas-status" aria-live="polite">
        <span>{Math.round(camera.zoom * 100)}%</span>
        <span>{tool === "wire"
          ? wireReconnect ? "Выберите новый контакт для конца провода"
            : wireStart ? "Выберите второй контакт"
              : "Выберите два контакта; конец выбранного провода можно переподключить"
          : tool === "pan" ? "Тяните поле мышью"
            : objects.find((item) => item.id === selectedObjectId)?.kind === "wire"
              ? view === "drawing"
                ? "Точки трассы: перетащить; двойной щелчок — удалить"
                : "Сегменты: перетащить; двойной щелчок по изгибу — удалить"
              : "Ctrl + колесо — масштаб"}</span>
      </div>
      {view==="drawing"&&tool.startsWith("dimension")&&<><svg className="he-dimension-targets" aria-hidden="true">{objects.filter(o=>o.kind==="wire"&&layers.some(l=>l.id===o.layerId&&l.visible)).flatMap(w=>(w.points??[]).map((p,i)=><circle key={`${w.id}:${i}`} cx={p.x*camera.zoom+camera.offsetX} cy={p.y*camera.zoom+camera.offsetY} r={dimensionStart.some(a=>a.wireId===w.id&&a.index===i)?6:4} fill="white" stroke="#167caf" strokeWidth="2"/>))}</svg><div className="he-dimension-help" role="status">{dimensionMessage||"Выберите первую точку провода"}</div></>}
      {drawingWindows}
      {overlay && <div className="he-e4-wire-popover">{overlay}</div>}
      {diagnosticOverlay && <div className="he-e4-diagnostic-popover">{diagnosticOverlay}</div>}
      {inlineEditor && inlineObject && inlineLayout && (
        <div
          className={`he-e4-inline-editor ${inlineObject.metadata?.diagnostic === "error" ? "has-error" : ""}`}
          style={{
            left: inlineLayout.x * camera.zoom + camera.offsetX + (inlineDragOffset?.x ?? 0),
            top: inlineLayout.y * camera.zoom + camera.offsetY + (inlineDragOffset?.y ?? 0),
            width: inlineLayout.width,
            height: inlineLayout.height,
            transform: `scale(${camera.zoom})`,
          }}
          onPointerDown={inlinePointerDown}
          onPointerMove={inlinePointerMove}
          onPointerUp={inlinePointerUp}
          onPointerCancel={inlinePointerCancel}
          onLostPointerCapture={inlinePointerCancel}
          onDoubleClick={inlineDoubleClick}
        >{inlineEditor}</div>
      )}
      <ul className="visually-hidden" aria-label="Объекты на поле">
        {objectsInPaintOrder(objects, layers).map((object) => <li key={object.id}>{object.label}</li>)}
      </ul>
    </div>
  );
}
