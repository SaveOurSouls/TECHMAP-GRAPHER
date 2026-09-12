import { useEffect, useRef, useState, type DragEvent, type MouseEvent, type PointerEvent, type WheelEvent } from "react";
import {
  panEditorCamera,
  screenToWorld,
  zoomEditorCameraAt,
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
  readonly onCameraChange: (camera: EditorCamera) => void;
  readonly onObjectSelect: (objectId: string | null) => void;
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
  readonly onWireRoutePointMove?: (wireId: string, routeIndex: number, point: EditorPoint) => void;
  readonly onWireRoutePointRemove?: (wireId: string, routeIndex: number) => void;
  readonly onCanvasDoubleClick?: (point: EditorPoint) => void;
  readonly onCatalogDrop: (itemId: string, point: EditorPoint) => void;
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

function pointToSegmentDistance(point: EditorPoint, start: EditorPoint, end: EditorPoint): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

function containsPoint(object: EditorSceneObject, point: EditorPoint, tolerance: number): boolean {
  if (object.kind === "wire" || object.kind === "dimension") {
    const points = object.points ?? [];
    for (let index = 1; index < points.length; index += 1) {
      const start = points[index - 1];
      const end = points[index];
      if (start && end && pointToSegmentDistance(point, start, end) <= tolerance) return true;
    }
    return false;
  }
  return point.x >= object.x - tolerance && point.x <= object.x + object.width + tolerance &&
    point.y >= object.y - tolerance && point.y <= object.y + object.height + tolerance;
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

function connectorContactPoints(object: EditorSceneObject): readonly EditorPoint[] {
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
): { readonly connectorId: string; readonly contactIndex: number } | null {
  const layerMap = new Map(layers.map((layer) => [layer.id, layer]));
  const tolerance = 10 / zoom;
  for (const object of [...objects].reverse()) {
    if (object.kind !== "connector" || layerMap.get(object.layerId)?.visible !== true) continue;
    const points = connectorContactPoints(object);
    for (let index = 0; index < points.length; index += 1) {
      const candidate = points[index]!;
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
): string | null {
  const paintOrder = objectsInPaintOrder(objects, layers);
  const tolerance = 7 / zoom;
  for (let index = paintOrder.length - 1; index >= 0; index -= 1) {
    const object = paintOrder[index];
    if (object && containsPoint(object, point, tolerance)) return object.id;
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

function drawObject(context: CanvasRenderingContext2D, object: EditorSceneObject, selected: boolean) {
  context.save();
  if (object.kind === "wire" || object.kind === "dimension") {
    const points = object.points ?? [];
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
    const points = connectorContactPoints(object);
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

function redrawCanvas(
  canvas: HTMLCanvasElement,
  camera: EditorCamera,
  objects: readonly EditorSceneObject[],
  layers: readonly EditorLayer[],
  selectedObjectId: string | null,
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
    drawObject(context, object, object.id === selectedObjectId);
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
  onCameraChange,
  onObjectSelect,
  onObjectMove,
  onWireConnect,
  onWireReconnect,
  onWireRoutePointMove,
  onWireRoutePointRemove,
  onCanvasDoubleClick,
  onCatalogDrop,
}: CanvasViewportProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<PointerDrag | ObjectPointerDrag | WireRoutePointerDrag | null>(null);
  const [wireStart, setWireStart] = useState<{ readonly connectorId: string; readonly contactIndex: number } | null>(null);
  const [wireReconnect, setWireReconnect] = useState<{ readonly wireId: string; readonly end: "from" | "to" } | null>(null);

  useEffect(() => {
    if (tool !== "wire") {
      setWireStart(null);
      setWireReconnect(null);
    }
  }, [tool]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const redraw = () => redrawCanvas(canvas, camera, objects, layers, selectedObjectId);
    redraw();
    const observer = new ResizeObserver(redraw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [camera, layers, objects, selectedObjectId]);

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
      );
      if (wireReconnect) {
        if (endpoint) onWireReconnect?.(wireReconnect.wireId, wireReconnect.end, endpoint);
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
      if (!endpoint) return;
      if (!wireStart) {
        setWireStart(endpoint);
        onObjectSelect(endpoint.connectorId);
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
      );
      const selectedObject = objects.find((item) => item.id === selectedObjectId);
      const preserveWireForRoutePoint = view === "drawing" && objectId === null &&
        selectedObject?.kind === "wire" && onCanvasDoubleClick !== undefined;
      if (!preserveWireForRoutePoint) onObjectSelect(objectId);
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
    }
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const zoomWheel = (event: WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
    onCameraChange(zoomEditorCameraAt(camera, localPoint(event.clientX, event.clientY), camera.zoom * factor));
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
    <div className={`he-canvas-frame tool-${tool}`}>
      <canvas
        ref={canvasRef}
        className="he-canvas"
        tabIndex={0}
        aria-label={`${view === "e4" ? "Поле схемы Э4" : "Поле чертежа"}. Масштаб ${Math.round(camera.zoom * 100)} процентов`}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onWheel={zoomWheel}
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
              : "Колесо — масштаб"}</span>
      </div>
      <ul className="visually-hidden" aria-label="Объекты на поле">
        {objectsInPaintOrder(objects, layers).map((object) => <li key={object.id}>{object.label}</li>)}
      </ul>
    </div>
  );
}
