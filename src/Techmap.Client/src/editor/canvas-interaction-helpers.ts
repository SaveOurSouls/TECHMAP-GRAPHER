import { type EditorCamera, type EditorPoint, type EditorSceneObject } from "./editor-types";
import { zoomEditorCameraFromWheel } from "./editor-camera";
import { type PointerEvent } from "react";
import { type E4ConnectorSnapTarget } from "./e4-connector-snap";
import { getE4ConnectorLayout } from "./canvas-connector-layout";

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

export function e4ConnectorSnapTarget(object: EditorSceneObject): E4ConnectorSnapTarget | null {
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
    contactRowsY: layout.contactPoints.map(point => point.y),
  };
}
