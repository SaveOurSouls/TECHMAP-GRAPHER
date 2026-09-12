import type { EditorCamera, EditorPoint } from "./editor-types";

export const minimumEditorZoom = 0.25;
export const maximumEditorZoom = 4;

export function clampEditorZoom(value: number): number {
  return Math.min(maximumEditorZoom, Math.max(minimumEditorZoom, value));
}

export function screenToWorld(camera: EditorCamera, point: EditorPoint): EditorPoint {
  return {
    x: (point.x - camera.offsetX) / camera.zoom,
    y: (point.y - camera.offsetY) / camera.zoom,
  };
}

export function worldToScreen(camera: EditorCamera, point: EditorPoint): EditorPoint {
  return {
    x: point.x * camera.zoom + camera.offsetX,
    y: point.y * camera.zoom + camera.offsetY,
  };
}

export function panEditorCamera(camera: EditorCamera, deltaX: number, deltaY: number): EditorCamera {
  return {
    ...camera,
    offsetX: camera.offsetX + deltaX,
    offsetY: camera.offsetY + deltaY,
  };
}

export function zoomEditorCameraAt(
  camera: EditorCamera,
  anchor: EditorPoint,
  zoom: number,
): EditorCamera {
  const nextZoom = clampEditorZoom(zoom);
  const anchoredWorldPoint = screenToWorld(camera, anchor);
  return {
    zoom: nextZoom,
    offsetX: anchor.x - anchoredWorldPoint.x * nextZoom,
    offsetY: anchor.y - anchoredWorldPoint.y * nextZoom,
  };
}

