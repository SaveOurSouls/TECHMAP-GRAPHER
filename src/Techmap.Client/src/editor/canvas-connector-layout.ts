import type { EditorLayer, EditorPoint, EditorSceneObject, HarnessEditorView } from "./editor-types";
import { connectorE4FooterWidth, connectorE4TableColumnWidth } from "./model";
import { isRecord, parseJson } from "./canvas-scene-metadata";

function contactCount(object: EditorSceneObject): number {
  const value = Number(object.metadata?.contactCount ?? "0");
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

const e4BaseColumnIds = ["color", "wireSection", "wire", "terminal", "circuit", "contactType", "number"] as const;
type E4BaseColumnId = typeof e4BaseColumnIds[number];
export type E4ColumnId = E4BaseColumnId | `custom:${string}`;
type E4ConnectionSide = "left" | "right";

export interface E4ContactRow {
  readonly number: number;
  readonly type: string;
  readonly circuit: string;
  readonly terminal: string;
  readonly wire: string;
  readonly wireSection: string;
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
  wire: "Марка",
  wireSection: "Сечение",
  terminal: "Терминал",
  circuit: "Цепь",
  contactType: "Тип",
  number: "№",
};

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
    const textValues = [contactType, item.circuit, item.terminal, item.wire, item.wireSection ?? "", item.color, secondaryColor];
    const customValues = parseStringRecord(item.customValues ?? item.values);
    if (!textValues.every((entry) => typeof entry === "string") || typeof name !== "string" || customValues === null ||
        (item.status !== "available" && item.status !== "not-connected")) return null;
    rows.push({
      number: item.number as number,
      type: contactType as string,
      circuit: item.circuit as string,
      terminal: item.terminal as string,
      wire: item.wire as string,
      wireSection: (item.wireSection as string | undefined) ?? "",
      color: item.color as string,
      secondaryColor: secondaryColor as string,
      name,
      status: item.status,
      customValues,
    });
  }
  return rows;
}

export function e4CellText(row: E4ContactRow, column: E4ColumnId): string {
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
  if(object.metadata?.terminationSymbol)return null;
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
  const suppliedWidths = parseJson(object.metadata.columnWidths);
  const authoritativeWidths = Array.isArray(suppliedWidths) && suppliedWidths.length === columnIds.length &&
    suppliedWidths.every(value => typeof value === "number" && Number.isFinite(value) && value > 0) ? suppliedWidths as number[] : null;
  const widths = new Map<E4ColumnId, number>(columnIds.map((column, index) => {
    const label = columnLabels[column] ?? (isCustomE4ColumnId(column) ? column.slice("custom:".length) : e4ColumnLabels[column]);
    const values = rows.map((row) => e4CellText(row, column));
    return [
      column,
      authoritativeWidths?.[index] ?? connectorE4TableColumnWidth(isCustomE4ColumnId(column) ? null : column, label, column === "color" ? [] : values),
    ];
  }));
  const columnWidth = columnIds.reduce((total, column) => total + (widths.get(column) ?? 0), 0);
  const width = authoritativeWidths ? object.width : Math.max(118, columnWidth, connectorE4FooterWidth(libraryCode, partNumber));
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

export function legacyConnectorContactPoints(object: EditorSceneObject): readonly EditorPoint[] {
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
  readonly directionVector?: EditorPoint;
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
        (record.directionVector !== undefined && (!record.directionVector || typeof record.directionVector !== "object" ||
          typeof (record.directionVector as EditorPoint).x !== "number" || !Number.isFinite((record.directionVector as EditorPoint).x) ||
          typeof (record.directionVector as EditorPoint).y !== "number" || !Number.isFinite((record.directionVector as EditorPoint).y))) ||
        !["available", "not-connected"].includes(String(record.status))) return null;
    result.push({
      x: object.x + record.x,
      y: object.y + record.y,
      direction: record.direction as MaterializedConnectorContactPoint["direction"],
      ...(record.directionVector ? {directionVector:record.directionVector as EditorPoint} : {}),
      status: record.status as MaterializedConnectorContactPoint["status"],
    });
  }
  return result;
}

export function connectorCanvasContactPoints(
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

export function contactCrossCenter(point: ConnectorCanvasContactPoint): EditorPoint {
  const outward = point.directionVector ?? contactOutward(point.direction);
  return {
    x: point.x + outward.x * point.crossOffset,
    y: point.y + outward.y * point.crossOffset,
  };
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
