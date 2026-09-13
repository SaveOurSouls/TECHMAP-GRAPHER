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

function containsPoint(
  object: EditorSceneObject,
  point: EditorPoint,
  tolerance: number,
  view?: HarnessEditorView,
): boolean {
  if (object.kind === "wire" || object.kind === "dimension") {
    const points = object.points ?? [];
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
  return point.x >= object.x - tolerance && point.x <= object.x + width + tolerance &&
    point.y >= object.y - tolerance && point.y <= object.y + height + tolerance;
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

export function e4ContactMarker(status: E4ContactRow["status"]): string {
  return status === "not-connected" ? "--X" : "";
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
  context.textAlign = "left";
  context.textBaseline = "middle";
  context.save();
  context.beginPath();
  context.rect(layout.x + 10, layout.y + 2, layout.width - 20, layout.titleHeight - 4);
  context.clip();
  context.fillText(layout.designation, layout.x + 12, layout.y + layout.titleHeight / 2);
  context.restore();

  context.fillStyle = "#405f6e";
  context.font = "600 10px Inter, Arial, sans-serif";
  context.save();
  context.beginPath();
  context.rect(layout.x + 10, footerY + 1, layout.width - 20, layout.footerHeight - 2);
  context.clip();
  context.fillText(layout.partNumber, layout.x + 12, footerY + layout.footerHeight / 2);
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
    const marker = e4ContactMarker(row.status);
    context.fillStyle = marker ? "#8d3b32" : object.color;
    if (marker) {
      context.font = "700 10px Inter, Arial, sans-serif";
      context.textAlign = layout.connectionSide === "left" ? "right" : "left";
      context.textBaseline = "middle";
      const offset = layout.connectionSide === "left" ? -5 : 5;
      context.fillText(marker, point.x + offset, point.y);
    } else {
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

function redrawCanvas(
  canvas: HTMLCanvasElement,
  view: HarnessEditorView,
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
    drawObject(context, object, object.id === selectedObjectId, view);
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
    const redraw = () => redrawCanvas(canvas, view, camera, objects, layers, selectedObjectId);
    redraw();
    const observer = new ResizeObserver(redraw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [camera, layers, objects, selectedObjectId, view]);

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
        view,
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
