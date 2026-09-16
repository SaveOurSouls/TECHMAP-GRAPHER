import { materializedContactWorldRepresentation } from "./materialized-contact-representation";

export type EditorView = "e4" | "drawing";

export interface Point {
  readonly x: number;
  readonly y: number;
}

export type ConnectorContactStatus = "available" | "not-connected";

export type ConnectorLibraryContactKind = "signal" | "power" | "third";

export type ConnectorLibraryBinding =
  | { readonly mode: "series"; readonly seriesId: string; readonly partNumber: string }
  | {
      readonly mode: "template";
      readonly templateId: string;
      readonly templateVersion: number;
      readonly versionSha256: string;
      readonly articleVariantId: string;
      readonly article: ComponentTemplateArticleKeySnapshot;
      readonly snapshot: ComponentTemplateMaterializedSnapshot;
    }
  | { readonly mode: "free" };

export interface ComponentTemplateArticleKeySnapshot {
  readonly sourceId: string;
  readonly entityType: string;
  readonly articleKey: string;
}

export interface ComponentTemplateAssetSnapshot {
  readonly assetId: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly fileName: string;
  readonly mediaType: string;
}

export interface ComponentTemplateContactRepresentationSnapshot {
  readonly viewId: string;
  readonly viewName: string;
  readonly viewKind: "e4" | "drawing" | "additional";
  readonly pointId: string;
  readonly occurrenceKey?: string;
  readonly x: number;
  readonly y: number;
  readonly direction: "left" | "right" | "up" | "down";
}

export interface ComponentTemplateContactSnapshot {
  /** Logical-contact ID for fixed contacts and the stable occurrence key for repeated contacts. */
  readonly logicalContactId: string;
  readonly prototypeLogicalContactId: string;
  readonly sourceNumber: string;
  readonly name: string;
  readonly circuitText: string | null;
  readonly contactTypeGroupId: string | null;
  readonly contactType: string;
  readonly allowedTerminalArticleKeys: readonly ComponentTemplateArticleKeySnapshot[];
  readonly representations: readonly ComponentTemplateContactRepresentationSnapshot[];
}

/**
 * Placement-owned materialization of one exact template article. The full
 * reusable template remains in the project component snapshot; this compact
 * copy is enough for the editor to reopen and route the instance without
 * following a newer library head.
 */
export interface ComponentTemplateMaterializedSnapshot {
  readonly templateId: string;
  readonly templateVersion: number;
  readonly versionSha256: string;
  readonly code: string;
  readonly name: string;
  readonly articleVariantId: string;
  readonly article: ComponentTemplateArticleKeySnapshot;
  readonly articleBindings: readonly ComponentTemplateArticleKeySnapshot[];
  readonly assets: readonly ComponentTemplateAssetSnapshot[];
  readonly contacts: readonly ComponentTemplateContactSnapshot[];
}

export interface ConnectorLibraryContact {
  readonly kind: ConnectorLibraryContactKind;
  readonly ordinal: number;
}

export type ConnectorSchematicOrientation = "contacts-left" | "contacts-right";

export const connectorBaseColumnKeys = [
  "number",
  "contactType",
  "circuit",
  "terminal",
  "wire",
  "color",
] as const;

export type ConnectorBaseColumnKey = typeof connectorBaseColumnKeys[number];

export interface ConnectorBaseColumn {
  readonly key: ConnectorBaseColumnKey;
  readonly visible: boolean;
}

export interface ConnectorCustomField {
  readonly id: string;
  readonly label: string;
  readonly visible: boolean;
}

export interface ConnectorSchematicPresentation {
  readonly orientation: ConnectorSchematicOrientation;
  readonly baseColumns: readonly ConnectorBaseColumn[];
  readonly customFields: readonly ConnectorCustomField[];
}

export type ConnectorE4TableColumn =
  | { readonly kind: "base"; readonly key: ConnectorBaseColumnKey; readonly x: number; readonly width: number }
  | { readonly kind: "custom"; readonly id: string; readonly label: string; readonly x: number; readonly width: number };

export interface ConnectorE4TableGeometry {
  readonly width: number;
  readonly height: number;
  readonly titleHeight: number;
  readonly headerHeight: number;
  readonly rowHeight: number;
  readonly footerHeight: number;
  readonly columns: readonly ConnectorE4TableColumn[];
  readonly contactPoints: Readonly<Record<string, Point>>;
}

export const connectorE4TableMetrics = {
  minimumWidth: 118,
  titleHeight: 24,
  headerHeight: 28,
  rowHeight: 24,
  footerHeight: 24,
  characterWidth: 6.2,
  cellHorizontalPadding: 12,
  headerControlWidth: 22,
  customColumnWidth: 64,
  baseColumnWidths: {
    number: 44,
    contactType: 60,
    circuit: 64,
    terminal: 78,
    wire: 72,
    color: 56,
  } satisfies Readonly<Record<ConnectorBaseColumnKey, number>>,
  maximumColumnWidth: 220,
} as const;

const connectorBaseColumnLabels: Readonly<Record<ConnectorBaseColumnKey, string>> = {
  number: "№",
  contactType: "Тип",
  circuit: "Цепь",
  terminal: "Терминал",
  wire: "Провод",
  color: "Цвет",
};

function e4TextWidth(text: string): number {
  return Array.from(text.trim()).length * connectorE4TableMetrics.characterWidth;
}

export function connectorE4FooterWidth(libraryCode: string, partNumber: string): number {
  return Math.ceil(
    e4TextWidth(libraryCode) + e4TextWidth(partNumber) + connectorE4TableMetrics.cellHorizontalPadding * 3,
  );
}

/**
 * Shared content-based E4 column sizing for both the canvas drawing and its
 * HTML editor overlay.  It intentionally uses a deterministic font estimate:
 * persisted connector geometry and contact anchors must not depend on the
 * browser's loaded fonts or on a canvas instance.
 */
export function connectorE4TableColumnWidth(
  key: ConnectorBaseColumnKey | null,
  label: string,
  values: readonly string[],
): number {
  const minimum = key === null
    ? connectorE4TableMetrics.customColumnWidth
    : connectorE4TableMetrics.baseColumnWidths[key];
  const headerWidth = e4TextWidth(label) + connectorE4TableMetrics.cellHorizontalPadding +
    connectorE4TableMetrics.headerControlWidth;
  const contentWidth = Math.max(0, ...values.map(e4TextWidth)) + connectorE4TableMetrics.cellHorizontalPadding;
  return Math.ceil(Math.min(
    connectorE4TableMetrics.maximumColumnWidth,
    Math.max(minimum, headerWidth, contentWidth),
  ));
}

export interface ConnectorContact {
  readonly id: string;
  /** Stable template logical ID, or a repeat occurrence key for a materialized row. */
  readonly logicalContactId?: string;
  readonly number: number;
  readonly contactType: string;
  readonly circuit: string;
  readonly terminalArticle: string;
  readonly wire: string;
  readonly color: string;
  /** Empty or missing means that the wire has one insulation color. */
  readonly secondaryColor?: string;
  readonly connectionStatus: ConnectorContactStatus;
  readonly customValues: Readonly<Record<string, string>>;
  readonly libraryContact?: ConnectorLibraryContact | null;
}

export interface ConnectorInstance {
  readonly id: string;
  readonly designation: string;
  /** Editable footer code for a free connector. Series connectors derive it from their library. */
  readonly libraryCode?: string;
  readonly partNumber: string;
  readonly contacts: readonly ConnectorContact[];
  readonly schematic: ConnectorSchematicPresentation;
  readonly positions: Readonly<Record<EditorView, Point>>;
  readonly layerIds: Readonly<Record<EditorView, string>>;
  readonly libraryBinding?: ConnectorLibraryBinding;
}

export type WireEndpoint =
  | { readonly connectorId: string; readonly contactId: string; readonly junctionId?: never; readonly screenId?: never }
  | { readonly junctionId: string; readonly connectorId: ""; readonly contactId: ""; readonly screenId?: never }
  | { readonly screenId: string; readonly screenTerminalSide?: WireScreenEndpointSide; readonly connectorId: ""; readonly contactId: ""; readonly junctionId?: never };

export interface E4Junction {
  readonly id: string;
  readonly position: Point;
  readonly wireIds: readonly string[];
}

export interface DiffPairGroup {
  readonly id: string;
  readonly wireIds: readonly [string, string];
  readonly step: number;
  readonly amplitude: number;
  readonly variant: 1 | 2;
}

export interface WireScreenGroup {
  readonly id: string;
  readonly wireIds: readonly string[];
  readonly position: number;
  readonly label: string;
  readonly width: number;
  /** Conducting terminal display. Missing in legacy JSON means `above`. */
  readonly terminalSide?: WireScreenTerminalSide;
}

export type WireScreenTerminalSide = "above" | "below" | "both";
export type WireScreenEndpointSide = Exclude<WireScreenTerminalSide, "both">;

export type WireCrossingStyle = "none" | "bridge";

export type E4RouteLeadDirection = "left" | "right" | "up" | "down" | null;

export interface E4RouteAnchor {
  readonly position: Point;
  readonly leadDirection: E4RouteLeadDirection;
}

export interface WireInstance {
  readonly id: string;
  readonly from: WireEndpoint;
  readonly to: WireEndpoint;
  readonly circuit: string;
  readonly color: string;
  /** Contact whose table color drives a direct contact-to-contact wire. */
  readonly colorSource?: WireColorSource | null;
  /** Physical source length. Null means that the wire is intentionally incomplete. */
  readonly lengthMm: number | null;
  /** Signed technological correction at the `from` end, in millimetres. */
  readonly endCorrectionFromMm: number;
  /** Signed technological correction at the `to` end, in millimetres. */
  readonly endCorrectionToMm: number;
  /** Positive step used to round only the final cut length upwards. */
  readonly cutRoundingStepMm: number;
  readonly e4Route: readonly Point[];
  /** Missing in older documents and treated as automatic. */
  readonly e4RouteMode?: "auto" | "manual";
  /** Normalized distance along the complete E4 route. Missing means centered. */
  readonly e4LabelPosition?: number;
  readonly drawingRoute: readonly Point[];
  readonly layerIds: Readonly<Record<EditorView, string>>;
}

export interface WireColorSource {
  readonly connectorId: string;
  readonly contactId: string;
}

export interface WireCutLengthCalculation {
  readonly sourceLengthMm: number | null;
  readonly endCorrectionFromMm: number;
  readonly endCorrectionToMm: number;
  readonly cutRoundingStepMm: number;
  readonly unroundedTotalMm: number | null;
  readonly cutLengthMm: number | null;
  readonly materialConsumptionMm: number | null;
  readonly isComplete: boolean;
}

export const defaultWireCutRoundingStepMm = 1;
const maximumWireLengthMm = 1_000_000_000;
const micrometresPerMillimetre = 1_000;

/** Mirrors the exact M1 domain calculation without deriving physical length from canvas geometry. */
export function calculateWireCutLength(wire: Pick<WireInstance,
  "lengthMm" | "endCorrectionFromMm" | "endCorrectionToMm" | "cutRoundingStepMm"
>): WireCutLengthCalculation {
  const sourceLengthMm = validateWirePhysicalLength(wire.lengthMm);
  const endCorrectionFromMm = validateWireCorrection(wire.endCorrectionFromMm, "Поправка начала провода");
  const endCorrectionToMm = validateWireCorrection(wire.endCorrectionToMm, "Поправка конца провода");
  const cutRoundingStepMm = validateWireRoundingStep(wire.cutRoundingStepMm);
  const common = { sourceLengthMm, endCorrectionFromMm, endCorrectionToMm, cutRoundingStepMm };
  if (sourceLengthMm === null) {
    return {
      ...common,
      unroundedTotalMm: null,
      cutLengthMm: null,
      materialConsumptionMm: null,
      isComplete: false,
    };
  }
  const totalMicrometres = toExactMicrometres(sourceLengthMm, "Длина провода") +
    toExactMicrometres(endCorrectionFromMm, "Поправка начала провода") +
    toExactMicrometres(endCorrectionToMm, "Поправка конца провода");
  if (totalMicrometres < 0n) throw new Error("Итоговая длина провода не должна быть отрицательной.");
  const stepMicrometres = toExactMicrometres(cutRoundingStepMm, "Шаг округления длины резки");
  const remainder = totalMicrometres % stepMicrometres;
  const roundedMicrometres = remainder === 0n
    ? totalMicrometres
    : totalMicrometres + stepMicrometres - remainder;
  const unroundedTotalMm = Number(totalMicrometres) / micrometresPerMillimetre;
  const cutLengthMm = Number(roundedMicrometres) / micrometresPerMillimetre;
  return {
    ...common,
    unroundedTotalMm,
    cutLengthMm,
    materialConsumptionMm: cutLengthMm,
    isComplete: true,
  };
}

export interface EditorLayer {
  readonly id: string;
  readonly name: string;
  readonly order: number;
  readonly visible: boolean;
  readonly locked: boolean;
}

export interface EditorViewState {
  readonly layers: readonly EditorLayer[];
  readonly wireCrossingStyle: WireCrossingStyle;
}

export interface HarnessDesignDocument {
  readonly schemaVersion: 1;
  /** User-created wire colors retained by this harness even when temporarily unused. */
  readonly customWireColors?: readonly string[];
  readonly connectors: readonly ConnectorInstance[];
  readonly wires: readonly WireInstance[];
  readonly junctions: readonly E4Junction[];
  readonly diffPairs: readonly DiffPairGroup[];
  readonly screens: readonly WireScreenGroup[];
  readonly views: Readonly<Record<EditorView, EditorViewState>>;
}

export const defaultE4WireLead = 24;
export const e4ScreenAlongSize = 18;

export const defaultLayerIds = {
  connectors: "connectors",
  wires: "wires",
  dimensions: "dimensions",
} as const;

export function createDefaultConnectorBaseColumns(): readonly ConnectorBaseColumn[] {
  return connectorBaseColumnKeys.map((key) => ({ key, visible: true }));
}

export function connectorE4TableGeometry(connector: ConnectorInstance): ConnectorE4TableGeometry {
  const baseColumns: ConnectorE4TableColumn[] = connector.schematic.baseColumns
    .filter((column) => column.visible)
    .map((column) => ({
      kind: "base",
      key: column.key,
      x: 0,
      width: connectorE4TableColumnWidth(
        column.key,
        connectorBaseColumnLabels[column.key],
        [
          ...connector.contacts.map((contact) => column.key === "number" ? String(contact.number)
            : column.key === "contactType" ? contact.contactType
              : column.key === "circuit" ? contact.circuit
                : column.key === "terminal" ? contact.terminalArticle
                  : column.key === "wire" ? contact.wire
                    : [contact.color, contact.secondaryColor].filter(Boolean).join(" / ")),
        ],
      ),
    }));
  const customColumns: ConnectorE4TableColumn[] = connector.schematic.customFields
    .filter((field) => field.visible)
    .map((field) => ({
      kind: "custom",
      id: field.id,
      label: field.label,
      x: 0,
      width: connectorE4TableColumnWidth(
        null,
        field.label,
        connector.contacts.map((contact) => contact.customValues[field.id] ?? ""),
      ),
    }));
  const contactsFirst = connector.schematic.orientation === "contacts-left";
  const orderedColumns = contactsFirst
    ? [...baseColumns, ...customColumns]
    : [...customColumns, ...baseColumns].reverse();
  let x = 0;
  let columns = orderedColumns.map((column) => {
    const positioned = { ...column, x };
    x += column.width;
    return positioned;
  });
  const libraryCode = connector.libraryBinding?.mode === "series"
    ? connector.libraryBinding.seriesId
    : connector.libraryCode ?? "FREE";
  const width = Math.max(
    connectorE4TableMetrics.minimumWidth,
    x,
    connectorE4FooterWidth(libraryCode, connector.partNumber),
  );
  if (columns.length > 0 && width > x) {
    const flexibleIndex = columns.findIndex((column) => column.kind !== "base" || column.key !== "number");
    const growIndex = flexibleIndex < 0 ? 0 : flexibleIndex;
    columns = columns.map((column, index) => index === growIndex
      ? { ...column, width: column.width + width - x }
      : column);
    let adjustedX = 0;
    columns = columns.map((column) => {
      const positioned = { ...column, x: adjustedX };
      adjustedX += column.width;
      return positioned;
    });
  }
  const height = connectorE4TableMetrics.titleHeight + connectorE4TableMetrics.headerHeight +
    connector.contacts.length * connectorE4TableMetrics.rowHeight + connectorE4TableMetrics.footerHeight;
  const contactX = contactsFirst ? 0 : width;
  const contactPoints = Object.fromEntries(connector.contacts.map((contact, index) => [
    contact.id,
    {
      x: contactX,
      y: connectorE4TableMetrics.titleHeight + connectorE4TableMetrics.headerHeight +
        (index + 0.5) * connectorE4TableMetrics.rowHeight,
    },
  ]));
  return {
    width,
    height,
    titleHeight: connectorE4TableMetrics.titleHeight,
    headerHeight: connectorE4TableMetrics.headerHeight,
    rowHeight: connectorE4TableMetrics.rowHeight,
    footerHeight: connectorE4TableMetrics.footerHeight,
    columns,
    contactPoints,
  };
}

function defaultLayers(): readonly EditorLayer[] {
  return [
    { id: defaultLayerIds.dimensions, name: "Размеры", order: 2, visible: true, locked: false },
    { id: defaultLayerIds.connectors, name: "Соединители", order: 1, visible: true, locked: false },
    { id: defaultLayerIds.wires, name: "Провода", order: 0, visible: true, locked: false },
  ];
}

export function createEmptyHarnessDesign(): HarnessDesignDocument {
  return {
    schemaVersion: 1,
    customWireColors: [],
    connectors: [],
    wires: [],
    junctions: [],
    diffPairs: [],
    screens: [],
    views: {
      e4: { layers: defaultLayers(), wireCrossingStyle: "none" },
      drawing: { layers: defaultLayers(), wireCrossingStyle: "none" },
    },
  };
}

export function parseHarnessDesignDocument(value: unknown): HarnessDesignDocument {
  const record = requireRecord(value, "Сервер вернул повреждённый документ жгута.");
  if (record.schemaVersion !== 1 || !Array.isArray(record.connectors) || !Array.isArray(record.wires)) {
    throw new Error("Версия или состав документа жгута не поддерживаются.");
  }
  const wireValues = record.wires;
  const views = requireRecord(record.views, "Представления документа жгута заданы неверно.");
  let document: HarnessDesignDocument = {
    schemaVersion: 1,
    customWireColors: parseCustomWireColors(record.customWireColors),
    connectors: record.connectors.map(parseConnector),
    wires: wireValues.map(parseWire),
    junctions: record.junctions === undefined ? [] : parseJunctions(record.junctions),
    diffPairs: record.diffPairs === undefined ? [] : parseDiffPairs(record.diffPairs),
    screens: record.screens === undefined ? [] : parseScreens(record.screens),
    views: { e4: parseView(views.e4), drawing: parseView(views.drawing) },
  };
  document = {
    ...document,
    customWireColors: normalizeCustomWireColors([
      ...(document.customWireColors ?? []),
      ...document.connectors.flatMap((connector) => connector.contacts
        .flatMap((contact) => [contact.color, contact.secondaryColor ?? ""])),
    ]),
  };
  const connectorIds = new Set(document.connectors.map((connector) => connector.id));
  if (connectorIds.size !== document.connectors.length) throw new Error("ID соединителей должны быть уникальны.");
  const wireIds = new Set(document.wires.map((wire) => wire.id));
  if (wireIds.size !== document.wires.length) throw new Error("ID проводов должны быть уникальны.");
  const junctionIds = new Set(document.junctions.map((junction) => junction.id));
  if (junctionIds.size !== document.junctions.length) throw new Error("ID узлов соединения должны быть уникальны.");
  for (const wire of document.wires) {
    for (const endpoint of [wire.from, wire.to]) {
      if (isJunctionEndpoint(endpoint)) {
        if (!junctionIds.has(endpoint.junctionId)) throw new Error("Провод ссылается на отсутствующий узел соединения.");
      } else if (isScreenEndpoint(endpoint)) {
        if (!document.screens.some((screen) => screen.id === endpoint.screenId) ||
            !wireScreenConnectionPoint(document, endpoint.screenId, new Set(), endpoint.screenTerminalSide)) {
          throw new Error("Провод ссылается на отсутствующую точку подключения экрана.");
        }
      } else {
        const connector = document.connectors.find((item) => item.id === endpoint.connectorId);
        if (!connector?.contacts.some((contact) => contact.id === endpoint.contactId)) {
          throw new Error("Провод ссылается на отсутствующую точку подключения.");
        }
      }
    }
  }
  document = {
    ...document,
    wires: document.wires.map((wire) => ({
      ...wire,
      colorSource: normalizeWireColorSource(document, wire),
    })),
  };
  document = {
    ...document,
    wires: document.wires.map((wire, index) => {
      const wireRecord = requireRecord(wireValues[index], "Провод задан неверно.");
      if (wireRecord.e4Route !== undefined) return wire;
      const start = wireEndpointE4Anchor(document, wire.from);
      const end = wireEndpointE4Anchor(document, wire.to);
      if (!start || !end) throw new Error("Точки подключения маршрута Э4 не найдены.");
      return { ...wire, e4Route: createOrthogonalE4Route(start, end), e4RouteMode: "auto" };
    }),
  };
  for (const [index, wireValue] of wireValues.entries()) {
    const wireRecord = requireRecord(wireValue, "Провод задан неверно.");
    const wire = document.wires[index]!;
    if (wireRecord.e4Route !== undefined) {
      const start = wireEndpointE4Anchor(document, wire.from);
      const end = wireEndpointE4Anchor(document, wire.to);
      if (!start || !end) throw new Error("Точки подключения маршрута Э4 не найдены.");
      validateOrthogonalE4Route(start, wire.e4Route, end);
    }
  }
  validateParsedGroups(document, wireIds);
  validateJunctions(document);
  validateJunctionCircuitComponents(document.wires, document.junctions);
  return document;
}

function parseCustomWireColors(value: unknown): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error("Пользовательские цвета проводов заданы неверно.");
  }
  return normalizeCustomWireColors(value as readonly string[]);
}

function normalizeCustomWireColors(values: readonly string[]): readonly string[] {
  return [...new Set(values.flatMap((value) => {
    const normalized = value.trim().toUpperCase();
    return /^#[0-9A-F]{6}$/.test(normalized) ? [normalized] : [];
  }))];
}

export function isJunctionEndpoint(endpoint: WireEndpoint): endpoint is Extract<WireEndpoint, { junctionId: string }> {
  return "junctionId" in endpoint;
}

export function createJunctionEndpoint(junctionId: string): WireEndpoint {
  return { junctionId, connectorId: "", contactId: "" };
}

export function isScreenEndpoint(endpoint: WireEndpoint): endpoint is Extract<WireEndpoint, { screenId: string }> {
  return "screenId" in endpoint;
}

export function createScreenEndpoint(screenId: string, screenTerminalSide?: WireScreenEndpointSide): WireEndpoint {
  return screenTerminalSide
    ? { screenId, screenTerminalSide, connectorId: "", contactId: "" }
    : { screenId, connectorId: "", contactId: "" };
}

export function wireEndpointE4Anchor(document: HarnessDesignDocument, endpoint: WireEndpoint): E4RouteAnchor | null {
  return wireEndpointE4AnchorInternal(document, endpoint, new Set());
}

function wireEndpointE4AnchorInternal(
  document: HarnessDesignDocument,
  endpoint: WireEndpoint,
  resolvingScreenIds: ReadonlySet<string>,
): E4RouteAnchor | null {
  if (isJunctionEndpoint(endpoint)) {
    const junction = document.junctions.find((item) => item.id === endpoint.junctionId);
    return junction ? { position: junction.position, leadDirection: null } : null;
  }
  if (isScreenEndpoint(endpoint)) {
    const geometry = wireScreenConnectionGeometry(
      document,
      endpoint.screenId,
      resolvingScreenIds,
      endpoint.screenTerminalSide,
    );
    return geometry ? {
      position: geometry.connectionPoint,
      leadDirection: geometry.orientation === "horizontal"
        ? geometry.terminalSide === "above" ? "up" : "down"
        : geometry.terminalSide === "above" ? "left" : "right",
    } : null;
  }
  const connector = document.connectors.find((item) => item.id === endpoint.connectorId);
  if (!connector) return null;
  const materialized = materializedContactWorldRepresentation(connector, endpoint.contactId, "e4");
  const position = materialized?.position ?? connectorContactPosition(connector, endpoint.contactId, "e4");
  return position ? {
    position,
    leadDirection: materialized?.direction ??
      (connector.schematic.orientation === "contacts-left" ? "left" : "right"),
  } : null;
}

interface ScreenRouteSpan {
  readonly orientation: "horizontal" | "vertical";
  readonly start: number;
  readonly end: number;
  readonly crossMinimum: number;
  readonly crossMaximum: number;
  readonly routeIndex: number;
}

interface ScreenRouteSegment {
  readonly orientation: "horizontal" | "vertical";
  readonly start: number;
  readonly end: number;
  readonly cross: number;
  readonly routeIndex: number;
}

export interface WireScreenConnectionGeometry {
  readonly center: Point;
  readonly bodyConnectionPoint: Point;
  readonly connectionPoint: Point;
  readonly terminalSide: WireScreenEndpointSide;
  readonly terminals: readonly {
    readonly side: WireScreenEndpointSide;
    readonly bodyConnectionPoint: Point;
    readonly connectionPoint: Point;
  }[];
  readonly orientation: "horizontal" | "vertical";
  readonly alongSize: number;
  readonly crossSize: number;
}

/** Derives the screen body and its explicit conducting ports from the screened routes. */
export function wireScreenConnectionGeometry(
  document: HarnessDesignDocument,
  screenId: string,
  resolvingScreenIds: ReadonlySet<string> = new Set(),
  preferredTerminalSide?: WireScreenEndpointSide,
): WireScreenConnectionGeometry | null {
  if (resolvingScreenIds.has(screenId)) return null;
  const screen = document.screens.find((item) => item.id === screenId);
  if (!screen) return null;
  const nextResolving = new Set([...resolvingScreenIds, screenId]);
  const segmentLists: ScreenRouteSegment[][] = screen.wireIds.map((wireId): ScreenRouteSegment[] => {
    const wire = document.wires.find((item) => item.id === wireId);
    if (!wire) return [];
    const start = wireEndpointE4AnchorInternal(document, wire.from, nextResolving)?.position;
    const end = wireEndpointE4AnchorInternal(document, wire.to, nextResolving)?.position;
    if (!start || !end) return [];
    const points = [start, ...wire.e4Route, end];
    const segments: ScreenRouteSegment[] = [];
    points.slice(1).forEach((current, index) => {
      const previous = points[index]!;
      if (previous.y === current.y && previous.x !== current.x) segments.push({
        orientation: "horizontal",
        start: Math.min(previous.x, current.x),
        end: Math.max(previous.x, current.x),
        cross: previous.y,
        routeIndex: index,
      });
      else if (previous.x === current.x && previous.y !== current.y) segments.push({
        orientation: "vertical",
        start: Math.min(previous.y, current.y),
        end: Math.max(previous.y, current.y),
        cross: previous.x,
        routeIndex: index,
      });
    });
    return segments;
  });
  if (segmentLists.length === 0 || segmentLists.some((segments) => segments.length === 0)) return null;

  const spans: ScreenRouteSpan[] = [];
  const aligned = segmentLists.every((segments) => segments.length === segmentLists[0]!.length);
  if (aligned) for (let index = 0; index < segmentLists[0]!.length; index += 1) {
    const selected = segmentLists.map((segments) => segments[index]!);
    if (selected.some((segment) => segment.orientation !== selected[0]!.orientation)) continue;
    const start = Math.max(...selected.map((segment) => segment.start));
    const end = Math.min(...selected.map((segment) => segment.end));
    if (end > start) spans.push({
      orientation: selected[0]!.orientation,
      start,
      end,
      crossMinimum: Math.min(...selected.map((segment) => segment.cross)),
      crossMaximum: Math.max(...selected.map((segment) => segment.cross)),
      routeIndex: selected[0]!.routeIndex,
    });
  }
  if (spans.length === 0) {
    const seen = new Set<string>();
    for (const orientation of ["horizontal", "vertical"] as const) {
      const candidates = [...new Set(segmentLists.flatMap((segments) => segments
        .filter((segment) => segment.orientation === orientation)
        .map((segment) => segment.start)))].sort((left, right) => left - right);
      for (const start of candidates) {
        const selected = segmentLists.map((segments) => segments
          .filter((segment) => segment.orientation === orientation && segment.start <= start && segment.end > start)
          .sort((left, right) => right.end - left.end || left.routeIndex - right.routeIndex)[0]);
        if (selected.some((segment) => segment === undefined)) continue;
        const end = Math.min(...selected.map((segment) => segment!.end));
        if (end <= start) continue;
        const key = `${orientation}:${selected.map((segment) => segment!.routeIndex).join(":")}`;
        if (seen.has(key)) continue;
        seen.add(key);
        spans.push({
          orientation,
          start,
          end,
          crossMinimum: Math.min(...selected.map((segment) => segment!.cross)),
          crossMaximum: Math.max(...selected.map((segment) => segment!.cross)),
          routeIndex: selected[0]!.routeIndex,
        });
      }
    }
  }
  if (spans.length === 0) return null;
  spans.sort((left, right) => left.routeIndex - right.routeIndex || left.start - right.start);
  const pathLength = spans.reduce((sum, span) => sum + span.end - span.start, 0);
  const requestedDistance = pathLength * Math.max(0, Math.min(1, screen.position));
  let accumulated = 0;
  let selected = spans[0]!;
  for (const span of spans) {
    if (requestedDistance <= accumulated + span.end - span.start || span === spans.at(-1)) {
      selected = span;
      break;
    }
    accumulated += span.end - span.start;
  }
  const along = selected.start + Math.max(0, Math.min(selected.end - selected.start, requestedDistance - accumulated));
  const cross = (selected.crossMinimum + selected.crossMaximum) / 2;
  const alongSize = e4ScreenAlongSize;
  const crossSize = Math.max(32, screen.width, selected.crossMaximum - selected.crossMinimum + 18);
  const center = selected.orientation === "horizontal" ? { x: along, y: cross } : { x: cross, y: along };
  const configuredSide = screen.terminalSide ?? "above";
  const terminalSides: readonly WireScreenEndpointSide[] = configuredSide === "both"
    ? ["above", "below"]
    : [configuredSide];
  const terminals = terminalSides.map((side) => {
    const direction = side === "above" ? -1 : 1;
    const bodyConnectionPoint = selected.orientation === "horizontal"
      ? { x: center.x, y: center.y + direction * crossSize / 2 }
      : { x: center.x + direction * crossSize / 2, y: center.y };
    // The port belongs to the oval itself. A wire only becomes connected after
    // the user explicitly starts or ends it on this perimeter point.
    const connectionPoint = bodyConnectionPoint;
    return { side, bodyConnectionPoint, connectionPoint };
  });
  const terminal = preferredTerminalSide === undefined
    ? terminals[0]!
    : terminals.find((item) => item.side === preferredTerminalSide);
  // Never silently move a persisted endpoint to the opposite port when the
  // screen mode changes. Such a document/command must be repaired explicitly.
  if (!terminal) return null;
  return {
    center,
    bodyConnectionPoint: terminal.bodyConnectionPoint,
    connectionPoint: terminal.connectionPoint,
    terminalSide: terminal.side,
    terminals,
    orientation: selected.orientation,
    alongSize,
    crossSize,
  };
}

export function wireScreenConnectionPoint(
  document: HarnessDesignDocument,
  screenId: string,
  resolvingScreenIds: ReadonlySet<string> = new Set(),
  preferredTerminalSide?: WireScreenEndpointSide,
): Point | null {
  return wireScreenConnectionGeometry(document, screenId, resolvingScreenIds, preferredTerminalSide)?.connectionPoint ?? null;
}

export function validateOrthogonalE4Route(
  start: E4RouteAnchor,
  intermediate: readonly Point[],
  end: E4RouteAnchor,
  minimumLead = defaultE4WireLead,
): void {
  if (!Number.isFinite(minimumLead) || minimumLead < 0) throw new Error("Минимальный прямой участок задан неверно.");
  const points = [start.position, ...intermediate, end.position];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!;
    const current = points[index]!;
    if ((previous.x === current.x) === (previous.y === current.y)) {
      throw new Error("Маршрут Э4 должен состоять из ненулевых ортогональных сегментов.");
    }
  }
  validateLead(start, points[1]!, minimumLead);
  validateLead(end, points.at(-2)!, minimumLead);
}

export function createOrthogonalE4Route(
  start: E4RouteAnchor,
  end: E4RouteAnchor,
  minimumLead = defaultE4WireLead,
): readonly Point[] {
  const startLead = leadPoint(start, minimumLead);
  const endLead = leadPoint(end, minimumLead);
  const candidates: Point[] = [];
  if (!samePoint(start.position, startLead)) candidates.push(startLead);
  if (startLead.x !== endLead.x && startLead.y !== endLead.y) candidates.push({ x: endLead.x, y: startLead.y });
  if (!samePoint(startLead, endLead)) candidates.push(endLead);
  const intermediate = candidates.filter((point, index) => {
    const previous = index === 0 ? start.position : candidates[index - 1]!;
    return !samePoint(point, previous) && !samePoint(point, end.position);
  });
  validateOrthogonalE4Route(start, intermediate, end, minimumLead);
  return intermediate;
}

function validateLead(anchor: E4RouteAnchor, adjacent: Point, minimumLead: number): void {
  if (anchor.leadDirection === null) return;
  const horizontal = anchor.leadDirection === "left" || anchor.leadDirection === "right";
  const distance = anchor.leadDirection === "left"
    ? anchor.position.x - adjacent.x
    : anchor.leadDirection === "right"
      ? adjacent.x - anchor.position.x
      : anchor.leadDirection === "up"
        ? anchor.position.y - adjacent.y
        : adjacent.y - anchor.position.y;
  const aligned = horizontal ? adjacent.y === anchor.position.y : adjacent.x === anchor.position.x;
  if (!aligned || distance < minimumLead) {
    throw new Error("Маршрут Э4 должен иметь прямой участок наружу от контакта.");
  }
}

function leadPoint(anchor: E4RouteAnchor, minimumLead: number): Point {
  if (anchor.leadDirection === "left") return { x: anchor.position.x - minimumLead, y: anchor.position.y };
  if (anchor.leadDirection === "right") return { x: anchor.position.x + minimumLead, y: anchor.position.y };
  if (anchor.leadDirection === "up") return { x: anchor.position.x, y: anchor.position.y - minimumLead };
  if (anchor.leadDirection === "down") return { x: anchor.position.x, y: anchor.position.y + minimumLead };
  return anchor.position;
}

function samePoint(left: Point, right: Point): boolean {
  return left.x === right.x && left.y === right.y;
}

function validateParsedGroups(
  document: HarnessDesignDocument,
  wireIds: ReadonlySet<string>,
): void {
  const { diffPairs, screens } = document;
  if (new Set(diffPairs.map((group) => group.id)).size !== diffPairs.length ||
      new Set(screens.map((group) => group.id)).size !== screens.length) {
    throw new Error("ID групп проводов должны быть уникальны.");
  }
  for (const group of [...diffPairs, ...screens]) {
    if (group.wireIds.some((wireId) => !wireIds.has(wireId))) {
      throw new Error("Группа ссылается на отсутствующий провод.");
    }
  }
  const pairedWireIds = diffPairs.flatMap((group) => [...group.wireIds]);
  if (new Set(pairedWireIds).size !== pairedWireIds.length) {
    throw new Error("Провод не может входить в несколько дифференциальных пар.");
  }
  for (const group of diffPairs) if (!wireGroupHasCommonE4ParallelSpan(document, group.wireIds)) {
    throw new Error("Провода дифференциальной пары должны иметь общий параллельный участок.");
  }
  for (const screen of screens) if (!wireGroupHasCommonE4ParallelSpan(document, screen.wireIds)) {
    throw new Error("Провода экрана должны иметь общий параллельный участок.");
  }
  for (const screen of screens) if (screen.wireIds.some((wireId) => {
    const wire = document.wires.find((item) => item.id === wireId);
    return wire && [wire.from, wire.to].some((endpoint) => isScreenEndpoint(endpoint) && endpoint.screenId === screen.id);
  })) throw new Error("Провод, подключённый к экрану, не может одновременно входить в его охват.");
}

function validateJunctionCircuitComponents(wires: readonly WireInstance[], junctions: readonly E4Junction[]): void {
  const visited = new Set<string>();
  for (const wire of wires) {
    if (visited.has(wire.id)) continue;
    const component = collectConnectedWireIds(wire.id, wires, junctions);
    for (const wireId of component) visited.add(wireId);
    const circuits = new Set(wires.filter((item) => component.has(item.id) && item.circuit).map((item) => item.circuit));
    if (circuits.size > 1) throw new Error("Провода одной цепи через узел соединения имеют разные обозначения цепи.");
  }
}

function collectConnectedWireIds(
  wireId: string,
  wires: readonly WireInstance[],
  junctions: readonly E4Junction[],
): Set<string> {
  const result = new Set([wireId]);
  let size = -1;
  while (size !== result.size) {
    size = result.size;
    for (const junction of junctions) if (junction.wireIds.some((id) => result.has(id))) {
      for (const id of junction.wireIds) result.add(id);
    }
    const screenIds = new Set(wires.filter((wire) => result.has(wire.id)).flatMap((wire) =>
      [wire.from, wire.to].flatMap((endpoint) => isScreenEndpoint(endpoint) ? [endpoint.screenId] : [])));
    for (const wire of wires) if ([wire.from, wire.to].some((endpoint) =>
      isScreenEndpoint(endpoint) && screenIds.has(endpoint.screenId))) result.add(wire.id);
  }
  return result;
}

export function connectorContactPosition(
  connector: ConnectorInstance,
  contactId: string,
  view: EditorView,
): Point | null {
  const index = connector.contacts.findIndex((contact) => contact.id === contactId);
  if (index < 0) return null;
  const materialized = materializedContactWorldRepresentation(connector, contactId, view);
  if (materialized) return materialized.position;
  const origin = connector.positions[view];
  if (view === "e4") {
    const point = connectorE4TableGeometry(connector).contactPoints[contactId];
    return point ? { x: origin.x + point.x, y: origin.y + point.y } : null;
  }
  return { x: origin.x + 118, y: origin.y + 28 + index * 16 };
}

export function findWireEndpoint(
  document: HarnessDesignDocument,
  endpoint: WireEndpoint,
  view: EditorView,
): Point | null {
  if (isJunctionEndpoint(endpoint)) {
    return view === "e4" ? document.junctions.find((item) => item.id === endpoint.junctionId)?.position ?? null : null;
  }
  if (isScreenEndpoint(endpoint)) {
    return view === "e4"
      ? wireScreenConnectionPoint(document, endpoint.screenId, new Set(), endpoint.screenTerminalSide)
      : null;
  }
  const connector = document.connectors.find((item) => item.id === endpoint.connectorId);
  return connector ? connectorContactPosition(connector, endpoint.contactId, view) : null;
}

function parseConnector(value: unknown): ConnectorInstance {
  const record = requireRecord(value, "Соединитель задан неверно.");
  if (!Array.isArray(record.contacts)) throw new Error("Контакты соединителя заданы неверно.");
  const positions = requireRecord(record.positions, "Координаты соединителя заданы неверно.");
  const layerIds = requireRecord(record.layerIds, "Слои соединителя заданы неверно.");
  const parsedContacts = record.contacts.map((contactValue) => {
    const contact = requireRecord(contactValue, "Контакт соединителя задан неверно.");
    return {
      id: requireText(contact.id, "ID контакта"),
      logicalContactId: contact.logicalContactId === undefined
        ? undefined
        : requireText(contact.logicalContactId, "Логический ID контакта"),
      number: requireInteger(contact.number, "Номер контакта", 1, 300),
      contactType: optionalString(contact.contactType, "Тип контакта"),
      circuit: requireString(contact.circuit, "Цепь контакта"),
      terminalArticle: optionalString(contact.terminalArticle, "Артикул терминала"),
      wire: optionalString(contact.wire, "Провод контакта"),
      color: optionalString(contact.color, "Цвет провода контакта"),
      secondaryColor: optionalString(contact.secondaryColor, "Второй цвет провода контакта"),
      connectionStatus: parseContactStatus(contact.connectionStatus),
      customValues: parseCustomValues(contact.customValues),
      libraryContact: parseConnectorLibraryContact(contact.libraryContact),
    };
  });
  if (new Set(parsedContacts.map((contact) => contact.id)).size !== parsedContacts.length ||
      new Set(parsedContacts.map((contact) => contact.number)).size !== parsedContacts.length) {
    throw new Error("Контакты соединителя должны иметь уникальные ID и номера.");
  }
  const designation = requireBoundedText(record.designation, "Обозначение соединителя", 120);
  const partNumber = record.partNumber === undefined
    ? designation
    : requireBoundedText(record.partNumber, "Артикул шаблона соединителя", 512);
  const libraryBinding = parseConnectorLibraryBinding(record.libraryBinding) ?? { mode: "free" };
  const contacts = parsedContacts.map((contact) => ({
    ...contact,
    libraryContact: contact.libraryContact ?? null,
  }));
  const schematic = parseConnectorSchematic(record.schematic);
  const customFieldIds = new Set(schematic.customFields.map((field) => field.id));
  for (const contact of contacts) {
    if (Object.keys(contact.customValues).some((fieldId) => !customFieldIds.has(fieldId))) {
      throw new Error("Значение контакта ссылается на отсутствующее справочное поле.");
    }
  }
  const connector: ConnectorInstance = {
    id: requireText(record.id, "ID соединителя"),
    designation,
    libraryCode: record.libraryCode === undefined
      ? "FREE"
      : requireBoundedText(record.libraryCode, "Код свободного блока", 120),
    partNumber,
    contacts,
    schematic,
    positions: { e4: parsePoint(positions.e4), drawing: parsePoint(positions.drawing) },
    layerIds: {
      e4: requireText(layerIds.e4, "Слой соединителя Э4"),
      drawing: requireText(layerIds.drawing, "Слой соединителя чертежа"),
    },
    libraryBinding,
  };
  validateConnectorLibraryMetadata(connector);
  return connector;
}

/** Validates additive library metadata without requiring the external series catalog. */
export function validateConnectorLibraryMetadata(connector: ConnectorInstance): void {
  const binding = connector.libraryBinding;
  if (binding === undefined || binding.mode === "free") {
    if (connector.contacts.some((contact) => contact.libraryContact !== undefined && contact.libraryContact !== null)) {
      throw new Error("Свободный соединитель не должен ссылаться на позиции библиотечной серии.");
    }
    return;
  }
  if (binding.mode === "template") {
    validateComponentTemplateBinding(connector, binding);
    return;
  }
  if (!binding.seriesId.trim() || !binding.partNumber.trim()) {
    throw new Error("Привязка соединителя к серии задана неверно.");
  }
  if (connector.partNumber !== binding.partNumber) {
    throw new Error("Артикул соединителя не совпадает с выбранным артикулом серии.");
  }
  const nextOrdinal: Record<ConnectorLibraryContactKind, number> = { signal: 1, power: 1, third: 1 };
  const kindOrder: Readonly<Record<ConnectorLibraryContactKind, number>> = { signal: 0, power: 1, third: 2 };
  let previousKindOrder = 0;
  connector.contacts.forEach((contact, index) => {
    const position = contact.libraryContact;
    if (!position) throw new Error("У библиотечного контакта отсутствует позиция в серии.");
    const order = kindOrder[position.kind];
    if (order === undefined || !Number.isSafeInteger(position.ordinal) || position.ordinal < 1 ||
        order < previousKindOrder || position.ordinal !== nextOrdinal[position.kind]) {
      throw new Error("Позиции библиотечных контактов заданы непоследовательно.");
    }
    if (contact.number !== index + 1 ||
        contact.id !== `${connector.id}:contact:${position.kind}:${position.ordinal}`) {
      throw new Error("ID или номер библиотечного контакта не соответствует его позиции в серии.");
    }
    nextOrdinal[position.kind] += 1;
    previousKindOrder = order;
  });
}

function parseConnectorLibraryBinding(value: unknown): ConnectorLibraryBinding | undefined {
  if (value === undefined) return undefined;
  const record = requireRecord(value, "Привязка соединителя к библиотечной серии задана неверно.");
  if (record.mode === "free") return { mode: "free" };
  if (record.mode === "template") {
    const binding = {
      mode: "template" as const,
      templateId: requireText(record.templateId, "ID шаблона компонента"),
      templateVersion: requireInteger(record.templateVersion, "Версия шаблона компонента", 1, 1_000_000),
      versionSha256: parseSha256(record.versionSha256, "Хэш версии шаблона компонента"),
      articleVariantId: requireText(record.articleVariantId, "ID варианта артикула"),
      article: parseTemplateArticleKey(record.article, "Артикул экземпляра компонента"),
      snapshot: parseComponentTemplateSnapshot(record.snapshot),
    };
    validateTemplateBindingSnapshotIdentity(binding);
    return binding;
  }
  if (record.mode !== "series") throw new Error("Режим библиотечного соединителя задан неверно.");
  return {
    mode: "series",
    seriesId: requireText(record.seriesId, "ID серии соединителя"),
    partNumber: requireText(record.partNumber, "Артикул соединителя серии"),
  };
}

function validateComponentTemplateBinding(
  connector: ConnectorInstance,
  binding: Extract<ConnectorLibraryBinding, { readonly mode: "template" }>,
): void {
  validateTemplateBindingSnapshotIdentity(binding);
  if (connector.partNumber !== binding.article.articleKey) {
    throw new Error("Артикул соединителя не совпадает с закреплённым вариантом шаблона.");
  }
  if (connector.libraryCode !== binding.snapshot.code) {
    throw new Error("Код соединителя не совпадает с закреплённым шаблоном.");
  }
  if (connector.contacts.length !== binding.snapshot.contacts.length) {
    throw new Error("Число контактов не совпадает с закреплённым вариантом шаблона.");
  }
  const logicalIds = new Set<string>();
  connector.contacts.forEach((contact, index) => {
    const snapshotContact = binding.snapshot.contacts[index]!;
    if (!contact.logicalContactId || !logicalIds.add(contact.logicalContactId) ||
        contact.logicalContactId !== snapshotContact.logicalContactId ||
        contact.id !== `${connector.id}:contact:${contact.logicalContactId}` ||
        contact.number !== index + 1 || contact.libraryContact !== null) {
      throw new Error("Контакты не соответствуют закреплённой материализации шаблона.");
    }
    if (contact.terminalArticle && !snapshotContact.allowedTerminalArticleKeys.some((candidate) =>
      candidate.articleKey === contact.terminalArticle)) {
      throw new Error("Терминал контакта не входит в список совместимых терминалов закреплённого шаблона.");
    }
  });
}

function validateTemplateBindingSnapshotIdentity(
  binding: Extract<ConnectorLibraryBinding, { readonly mode: "template" }>,
): void {
  const snapshot = binding.snapshot;
  if (snapshot.templateId !== binding.templateId ||
      snapshot.templateVersion !== binding.templateVersion ||
      snapshot.versionSha256 !== binding.versionSha256 ||
      snapshot.articleVariantId !== binding.articleVariantId ||
      !sameTemplateArticleKey(snapshot.article, binding.article)) {
    throw new Error("Привязка не совпадает с закреплённым снимком шаблона.");
  }
  if (!snapshot.articleBindings.some((candidate) => sameTemplateArticleKey(candidate, snapshot.article))) {
    throw new Error("Артикул экземпляра отсутствует в закреплённом индексе шаблона.");
  }
}

function sameTemplateArticleKey(
  left: ComponentTemplateArticleKeySnapshot,
  right: ComponentTemplateArticleKeySnapshot,
): boolean {
  return left.sourceId === right.sourceId && left.entityType === right.entityType &&
    left.articleKey === right.articleKey;
}

function parseComponentTemplateSnapshot(value: unknown): ComponentTemplateMaterializedSnapshot {
  const record = requireRecord(value, "Закреплённый снимок шаблона задан неверно.");
  if (!Array.isArray(record.articleBindings) || !Array.isArray(record.assets) || !Array.isArray(record.contacts)) {
    throw new Error("Состав закреплённого снимка шаблона задан неверно.");
  }
  const articleBindings = record.articleBindings.map((candidate) =>
    parseTemplateArticleKey(candidate, "Артикул индекса шаблона"));
  requireUniqueTemplateArticleKeys(articleBindings, "Артикулы индекса шаблона должны быть уникальны.");
  const assets = record.assets.map(parseTemplateAssetSnapshot);
  if (new Set(assets.map((asset) => asset.assetId)).size !== assets.length) {
    throw new Error("Ресурсы закреплённого шаблона должны иметь уникальные ID.");
  }
  const contacts = record.contacts.map(parseTemplateContactSnapshot);
  if (new Set(contacts.map((contact) => contact.logicalContactId)).size !== contacts.length) {
    throw new Error("Логические ID материализованных контактов должны быть уникальны.");
  }
  return deepFreezeTemplateSnapshot({
    templateId: requireText(record.templateId, "ID закреплённого шаблона"),
    templateVersion: requireInteger(record.templateVersion, "Версия закреплённого шаблона", 1, 1_000_000),
    versionSha256: parseSha256(record.versionSha256, "Хэш закреплённого шаблона"),
    code: requireBoundedText(record.code, "Код закреплённого шаблона", 120),
    name: requireBoundedText(record.name, "Название закреплённого шаблона", 256),
    articleVariantId: requireText(record.articleVariantId, "ID варианта артикула закреплённого шаблона"),
    article: parseTemplateArticleKey(record.article, "Артикул закреплённого шаблона"),
    articleBindings,
    assets,
    contacts,
  });
}

function parseTemplateArticleKey(value: unknown, name: string): ComponentTemplateArticleKeySnapshot {
  const record = requireRecord(value, `${name} задан неверно.`);
  return {
    sourceId: requireBoundedText(record.sourceId, `${name}: источник`, 128),
    entityType: requireBoundedText(record.entityType, `${name}: тип сущности`, 64),
    articleKey: requireBoundedText(record.articleKey, `${name}: ключ`, 512),
  };
}

function requireUniqueTemplateArticleKeys(
  values: readonly ComponentTemplateArticleKeySnapshot[],
  message: string,
): void {
  const keys = values.map((value) => `${value.sourceId}\0${value.entityType}\0${value.articleKey}`);
  if (new Set(keys).size !== keys.length) throw new Error(message);
}

function parseTemplateAssetSnapshot(value: unknown): ComponentTemplateAssetSnapshot {
  const record = requireRecord(value, "Ресурс закреплённого шаблона задан неверно.");
  return {
    assetId: requireText(record.assetId, "ID ресурса закреплённого шаблона"),
    sha256: parseSha256(record.sha256, "Хэш ресурса закреплённого шаблона"),
    sizeBytes: requireInteger(record.sizeBytes, "Размер ресурса закреплённого шаблона", 0, 10 * 1024 * 1024),
    fileName: requireBoundedText(record.fileName, "Имя ресурса закреплённого шаблона", 255),
    mediaType: requireBoundedText(record.mediaType, "Тип ресурса закреплённого шаблона", 120),
  };
}

function parseTemplateContactSnapshot(value: unknown): ComponentTemplateContactSnapshot {
  const record = requireRecord(value, "Материализованный контакт шаблона задан неверно.");
  if (!Array.isArray(record.allowedTerminalArticleKeys) || !Array.isArray(record.representations)) {
    throw new Error("Состав материализованного контакта шаблона задан неверно.");
  }
  const allowedTerminalArticleKeys = record.allowedTerminalArticleKeys.map((candidate) =>
    parseTemplateArticleKey(candidate, "Допустимый терминал"));
  requireUniqueTemplateArticleKeys(allowedTerminalArticleKeys, "Допустимые терминалы контакта должны быть уникальны.");
  const representations = record.representations.map(parseTemplateContactRepresentationSnapshot);
  return {
    logicalContactId: requireText(record.logicalContactId, "Логический ID материализованного контакта"),
    prototypeLogicalContactId: requireText(record.prototypeLogicalContactId, "ID прототипа материализованного контакта"),
    sourceNumber: requireBoundedText(record.sourceNumber, "Номер материализованного контакта", 128),
    name: requireBoundedText(record.name, "Имя материализованного контакта", 256),
    circuitText: record.circuitText === null ? null : requireString(record.circuitText, "Цепь материализованного контакта"),
    contactTypeGroupId: record.contactTypeGroupId === null
      ? null
      : requireText(record.contactTypeGroupId, "ID группы типа материализованного контакта"),
    contactType: requireString(record.contactType, "Тип материализованного контакта"),
    allowedTerminalArticleKeys,
    representations,
  };
}

function parseTemplateContactRepresentationSnapshot(
  value: unknown,
): ComponentTemplateContactRepresentationSnapshot {
  const record = requireRecord(value, "Представление материализованного контакта задано неверно.");
  if (record.viewKind !== "e4" && record.viewKind !== "drawing" && record.viewKind !== "additional") {
    throw new Error("Вид представления материализованного контакта задан неверно.");
  }
  if (record.direction !== "left" && record.direction !== "right" &&
      record.direction !== "up" && record.direction !== "down") {
    throw new Error("Направление представления материализованного контакта задано неверно.");
  }
  return {
    viewId: requireText(record.viewId, "ID вида материализованного контакта"),
    viewName: requireBoundedText(record.viewName, "Название вида материализованного контакта", 256),
    viewKind: record.viewKind,
    pointId: requireText(record.pointId, "ID точки материализованного контакта"),
    occurrenceKey: record.occurrenceKey === undefined
      ? undefined
      : requireText(record.occurrenceKey, "Ключ повторной точки материализованного контакта"),
    x: requireNumber(record.x, "Координата X материализованного контакта"),
    y: requireNumber(record.y, "Координата Y материализованного контакта"),
    direction: record.direction,
  };
}

function deepFreezeTemplateSnapshot(
  snapshot: ComponentTemplateMaterializedSnapshot,
): ComponentTemplateMaterializedSnapshot {
  for (const article of snapshot.articleBindings) Object.freeze(article);
  for (const terminal of snapshot.contacts.flatMap((contact) => contact.allowedTerminalArticleKeys)) Object.freeze(terminal);
  for (const asset of snapshot.assets) Object.freeze(asset);
  for (const contact of snapshot.contacts) {
    for (const terminal of contact.allowedTerminalArticleKeys) Object.freeze(terminal);
    for (const representation of contact.representations) Object.freeze(representation);
    Object.freeze(contact.allowedTerminalArticleKeys);
    Object.freeze(contact.representations);
    Object.freeze(contact);
  }
  Object.freeze(snapshot.article);
  Object.freeze(snapshot.articleBindings);
  Object.freeze(snapshot.assets);
  Object.freeze(snapshot.contacts);
  return Object.freeze(snapshot);
}

function parseSha256(value: unknown, name: string): string {
  const result = requireString(value, name);
  if (!/^[0-9a-f]{64}$/.test(result)) throw new Error(`${name} задан неверно.`);
  return result;
}

function parseConnectorLibraryContact(value: unknown): ConnectorLibraryContact | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const record = requireRecord(value, "Позиция контакта в библиотечной серии задана неверно.");
  if (record.kind !== "signal" && record.kind !== "power" && record.kind !== "third") {
    throw new Error("Тип контакта библиотечной серии задан неверно.");
  }
  return {
    kind: record.kind,
    ordinal: requireInteger(record.ordinal, "Порядковый номер контакта серии", 1, 300),
  };
}

function parseConnectorSchematic(value: unknown): ConnectorSchematicPresentation {
  if (value === undefined) {
    return { orientation: "contacts-right", baseColumns: createDefaultConnectorBaseColumns(), customFields: [] };
  }
  const record = requireRecord(value, "Представление соединителя на схеме задано неверно.");
  const orientation = record.orientation === "contacts-left" || record.orientation === "contacts-right"
    ? record.orientation
    : (() => { throw new Error("Ориентация соединителя на схеме задана неверно."); })();
  const baseColumns = parseBaseColumns(record.baseColumns);
  const customFields = record.customFields === undefined
    ? []
    : parseCustomFields(record.customFields);
  return { orientation, baseColumns, customFields };
}

function parseBaseColumns(value: unknown): readonly ConnectorBaseColumn[] {
  if (value === undefined) return createDefaultConnectorBaseColumns();
  if (!Array.isArray(value)) throw new Error("Базовые колонки соединителя заданы неверно.");
  const byKey = new Map<ConnectorBaseColumnKey, ConnectorBaseColumn>();
  for (const columnValue of value) {
    const column = requireRecord(columnValue, "Базовая колонка соединителя задана неверно.");
    if (!connectorBaseColumnKeys.includes(column.key as ConnectorBaseColumnKey) || typeof column.visible !== "boolean") {
      throw new Error("Базовая колонка соединителя задана неверно.");
    }
    const key = column.key as ConnectorBaseColumnKey;
    if (byKey.has(key)) throw new Error("Базовые колонки соединителя не должны повторяться.");
    byKey.set(key, { key, visible: column.visible });
  }
  return connectorBaseColumnKeys.map((key) => byKey.get(key) ?? { key, visible: true });
}

function parseCustomFields(value: unknown): readonly ConnectorCustomField[] {
  if (!Array.isArray(value)) throw new Error("Справочные поля соединителя заданы неверно.");
  const fields = value.map((fieldValue) => {
    const field = requireRecord(fieldValue, "Справочное поле соединителя задано неверно.");
    if (typeof field.visible !== "boolean") throw new Error("Видимость справочного поля задана неверно.");
    return {
      id: requireText(field.id, "ID справочного поля"),
      label: requireBoundedText(field.label, "Название справочного поля", 120),
      visible: field.visible,
    };
  });
  if (new Set(fields.map((field) => field.id)).size !== fields.length) {
    throw new Error("ID справочных полей должны быть уникальны.");
  }
  return fields;
}

function parseContactStatus(value: unknown): ConnectorContactStatus {
  if (value === undefined) return "available";
  if (value !== "available" && value !== "not-connected") {
    throw new Error("Статус подключения контакта задан неверно.");
  }
  return value;
}

function parseCustomValues(value: unknown): Readonly<Record<string, string>> {
  if (value === undefined) return {};
  const record = requireRecord(value, "Значения справочных полей контакта заданы неверно.");
  return Object.fromEntries(Object.entries(record).map(([key, item]) => [
    requireText(key, "ID справочного поля"),
    requireString(item, "Значение справочного поля"),
  ]));
}

function parseWire(value: unknown): WireInstance {
  const record = requireRecord(value, "Провод задан неверно.");
  const layerIds = requireRecord(record.layerIds, "Слои провода заданы неверно.");
  if (!Array.isArray(record.drawingRoute) || (record.e4Route !== undefined && !Array.isArray(record.e4Route))) {
    throw new Error("Трасса провода задана неверно.");
  }
  const lengthMm = record.lengthMm === undefined || record.lengthMm === null
    ? null
    : validateWirePhysicalLength(requireNumber(record.lengthMm, "Длина провода"));
  const endCorrectionFromMm = record.endCorrectionFromMm === undefined
    ? 0
    : validateWireCorrection(requireNumber(record.endCorrectionFromMm, "Поправка начала провода"), "Поправка начала провода");
  const endCorrectionToMm = record.endCorrectionToMm === undefined
    ? 0
    : validateWireCorrection(requireNumber(record.endCorrectionToMm, "Поправка конца провода"), "Поправка конца провода");
  const cutRoundingStepMm = record.cutRoundingStepMm === undefined
    ? defaultWireCutRoundingStepMm
    : validateWireRoundingStep(requireNumber(record.cutRoundingStepMm, "Шаг округления длины резки"));
  calculateWireCutLength({ lengthMm, endCorrectionFromMm, endCorrectionToMm, cutRoundingStepMm });
  return {
    id: requireText(record.id, "ID провода"),
    from: parseEndpoint(record.from),
    to: parseEndpoint(record.to),
    circuit: requireString(record.circuit, "Цепь провода"),
    color: requireText(record.color, "Цвет провода"),
    colorSource: record.colorSource === undefined || record.colorSource === null
      ? record.colorSource : parseWireColorSource(record.colorSource),
    lengthMm,
    endCorrectionFromMm,
    endCorrectionToMm,
    cutRoundingStepMm,
    e4Route: record.e4Route === undefined ? [] : record.e4Route.map(parsePoint),
    e4RouteMode: record.e4RouteMode === undefined || record.e4RouteMode === "auto"
      ? "auto"
      : record.e4RouteMode === "manual" ? "manual" : (() => { throw new Error("Режим трассы Э4 задан неверно."); })(),
    e4LabelPosition: record.e4LabelPosition === undefined
      ? 0.5
      : parseNormalizedPosition(record.e4LabelPosition, "Положение обозначения провода"),
    drawingRoute: record.drawingRoute.map(parsePoint),
    layerIds: {
      e4: requireText(layerIds.e4, "Слой провода Э4"),
      drawing: requireText(layerIds.drawing, "Слой провода чертежа"),
    },
  };
}

function parseWireColorSource(value: unknown): WireColorSource {
  const record = requireRecord(value, "Источник цвета провода задан неверно.");
  return {
    connectorId: requireText(record.connectorId, "Соединитель источника цвета"),
    contactId: requireText(record.contactId, "Контакт источника цвета"),
  };
}

function normalizeWireColorSource(document: HarnessDesignDocument, wire: WireInstance): WireColorSource | null | undefined {
  if (isJunctionEndpoint(wire.from) || isScreenEndpoint(wire.from) ||
      isJunctionEndpoint(wire.to) || isScreenEndpoint(wire.to)) return undefined;
  if (wire.colorSource === null) return null;
  const endpoints = [wire.from, wire.to] as const;
  const source = wire.colorSource && endpoints.some((endpoint) =>
    endpoint.connectorId === wire.colorSource!.connectorId && endpoint.contactId === wire.colorSource!.contactId)
    ? wire.colorSource
    : endpoints.find((endpoint) => document.connectors.find((connector) => connector.id === endpoint.connectorId)
      ?.contacts.find((contact) => contact.id === endpoint.contactId)?.color.trim()) ?? endpoints[0];
  return { connectorId: source.connectorId, contactId: source.contactId };
}

function validateWirePhysicalLength(value: number | null): number | null {
  if (value === null) return null;
  if (!Number.isFinite(value) || value < 0 || value > maximumWireLengthMm) {
    throw new Error("Длина провода должна быть неотрицательным числом в миллиметрах или неизвестной.");
  }
  toExactMicrometres(value, "Длина провода");
  return value;
}

function validateWireCorrection(value: number, name: string): number {
  if (!Number.isFinite(value) || Math.abs(value) > maximumWireLengthMm) {
    throw new Error(`${name} задана неверно.`);
  }
  toExactMicrometres(value, name);
  return value;
}

function validateWireRoundingStep(value: number): number {
  if (!Number.isFinite(value) || value <= 0 || value > maximumWireLengthMm) {
    throw new Error("Шаг округления длины резки должен быть положительным числом в миллиметрах.");
  }
  toExactMicrometres(value, "Шаг округления длины резки");
  return value;
}

function toExactMicrometres(value: number, name: string): bigint {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(value.toString());
  if (!match) {
    throw new Error(`${name} должна задаваться с точностью не более 0,001 мм.`);
  }
  const sign = match[1] === "-" ? -1n : 1n;
  const fraction = match[3] ?? "";
  const exponent = Number(match[4] ?? "0");
  const digits = BigInt(`${match[2]}${fraction}`);
  const micrometreExponent = exponent - fraction.length + 3;
  if (micrometreExponent >= 0) {
    return sign * digits * 10n ** BigInt(micrometreExponent);
  }
  const divisor = 10n ** BigInt(-micrometreExponent);
  if (digits % divisor !== 0n) {
    throw new Error(`${name} должна задаваться с точностью не более 0,001 мм.`);
  }
  return sign * (digits / divisor);
}

function parseNormalizedPosition(value: unknown, name: string): number {
  const number = requireNumber(value, name);
  if (number < 0 || number > 1) throw new Error(`${name} должно быть от 0 до 1.`);
  return number;
}

function parseEndpoint(value: unknown): WireEndpoint {
  const record = requireRecord(value, "Конец провода задан неверно.");
  if (record.junctionId !== undefined) return createJunctionEndpoint(requireText(record.junctionId, "Узел конца провода"));
  if (record.screenId !== undefined) {
    const side = record.screenTerminalSide;
    if (side !== undefined && side !== "above" && side !== "below") {
      throw new Error("Сторона точки подключения экрана задана неверно.");
    }
    return createScreenEndpoint(requireText(record.screenId, "Экран конца провода"), side);
  }
  return {
    connectorId: requireText(record.connectorId, "Соединитель конца провода"),
    contactId: requireText(record.contactId, "Контакт конца провода"),
  };
}

function parseView(value: unknown): EditorViewState {
  const record = requireRecord(value, "Представление документа задано неверно.");
  if (!Array.isArray(record.layers)) throw new Error("Слои представления заданы неверно.");
  const layers = record.layers.map((layerValue) => {
    const layer = requireRecord(layerValue, "Слой задан неверно.");
    if (typeof layer.visible !== "boolean" || typeof layer.locked !== "boolean") {
      throw new Error("Состояние слоя задано неверно.");
    }
    return {
      id: requireText(layer.id, "ID слоя"),
      name: requireText(layer.name, "Имя слоя"),
      order: requireInteger(layer.order, "Порядок слоя", 0, 10_000),
      visible: layer.visible,
      locked: layer.locked,
    };
  });
  if (new Set(layers.map((layer) => layer.id)).size !== layers.length ||
      new Set(layers.map((layer) => layer.order)).size !== layers.length) {
    throw new Error("Слои должны иметь уникальные ID и порядок.");
  }
  const wireCrossingStyle = record.wireCrossingStyle === undefined ? "none" : record.wireCrossingStyle;
  if (wireCrossingStyle !== "none" && wireCrossingStyle !== "bridge") {
    throw new Error("Режим пересечения проводов задан неверно.");
  }
  return { layers, wireCrossingStyle };
}

function parseJunctions(value: unknown): readonly E4Junction[] {
  if (!Array.isArray(value)) throw new Error("Узлы соединения заданы неверно.");
  return value.map((item) => {
    const record = requireRecord(item, "Узел соединения задан неверно.");
    if (!Array.isArray(record.wireIds) || record.wireIds.length < 2) {
      throw new Error("Узел соединения должен объединять не менее двух проводов.");
    }
    const wireIds = record.wireIds.map((id) => requireText(id, "ID провода узла соединения"));
    if (new Set(wireIds).size !== wireIds.length) throw new Error("Провода узла соединения не должны повторяться.");
    return { id: requireText(record.id, "ID узла соединения"), position: parsePoint(record.position), wireIds };
  });
}

function validateJunctions(document: HarnessDesignDocument): void {
  const wires = new Map(document.wires.map((wire) => [wire.id, wire]));
  for (const junction of document.junctions) {
    for (const wireId of junction.wireIds) {
      const wire = wires.get(wireId);
      if (!wire) throw new Error("Узел соединения ссылается на отсутствующий провод.");
      const endsAtJunction = [wire.from, wire.to].some((endpoint) =>
        isJunctionEndpoint(endpoint) && endpoint.junctionId === junction.id);
      if (!endsAtJunction && !wireE4PathContainsPoint(document, wire, junction.position)) {
        throw new Error("Линия провода должна проходить через узел соединения.");
      }
    }
  }
  for (const wire of document.wires) {
    for (const endpoint of [wire.from, wire.to]) if (isJunctionEndpoint(endpoint)) {
      const junction = document.junctions.find((item) => item.id === endpoint.junctionId);
      if (!junction?.wireIds.includes(wire.id)) throw new Error("Узел соединения не содержит завершающийся в нём провод.");
    }
  }
}

export function wireE4PathContainsPoint(
  document: HarnessDesignDocument,
  wire: WireInstance,
  point: Point,
): boolean {
  const start = wireEndpointE4Anchor(document, wire.from)?.position;
  const end = wireEndpointE4Anchor(document, wire.to)?.position;
  if (!start || !end) return false;
  const points = [start, ...wire.e4Route, end];
  return points.slice(1).some((current, index) => pointOnSegment(point, points[index]!, current));
}

export function wireGroupHasCommonE4ParallelSpan(
  document: HarnessDesignDocument,
  wireIds: readonly string[],
): boolean {
  const segmentGroups = wireIds.map((wireId) => {
    const wire = document.wires.find((item) => item.id === wireId);
    if (!wire) return [];
    const start = wireEndpointE4Anchor(document, wire.from)?.position;
    const end = wireEndpointE4Anchor(document, wire.to)?.position;
    if (!start || !end) return [];
    const points = [start, ...wire.e4Route, end];
    return points.slice(1).map((current, index) => {
      const previous = points[index]!;
      return previous.y === current.y
        ? { orientation: "horizontal" as const, start: Math.min(previous.x, current.x), end: Math.max(previous.x, current.x) }
        : { orientation: "vertical" as const, start: Math.min(previous.y, current.y), end: Math.max(previous.y, current.y) };
    });
  });
  if (segmentGroups.length === 0 || segmentGroups.some((segments) => segments.length === 0)) return false;

  const visit = (wireIndex: number, orientation: "horizontal" | "vertical" | null, start: number, end: number): boolean => {
    if (wireIndex === segmentGroups.length) return end > start;
    for (const segment of segmentGroups[wireIndex]!) {
      if (orientation !== null && segment.orientation !== orientation) continue;
      const overlapStart = wireIndex === 0 ? segment.start : Math.max(start, segment.start);
      const overlapEnd = wireIndex === 0 ? segment.end : Math.min(end, segment.end);
      if (overlapEnd > overlapStart && visit(wireIndex + 1, segment.orientation, overlapStart, overlapEnd)) return true;
    }
    return false;
  };
  return visit(0, null, 0, 0);
}

function pointOnSegment(point: Point, start: Point, end: Point): boolean {
  if (start.x === end.x) return point.x === start.x && point.y >= Math.min(start.y, end.y) && point.y <= Math.max(start.y, end.y);
  if (start.y === end.y) return point.y === start.y && point.x >= Math.min(start.x, end.x) && point.x <= Math.max(start.x, end.x);
  return false;
}

function parseDiffPairs(value: unknown): readonly DiffPairGroup[] {
  if (!Array.isArray(value)) throw new Error("Дифференциальные пары заданы неверно.");
  return value.map((item) => {
    const record = requireRecord(item, "Дифференциальная пара задана неверно.");
    if (!Array.isArray(record.wireIds) || record.wireIds.length !== 2) throw new Error("Дифференциальная пара должна содержать два провода.");
    const wireIds = record.wireIds.map((id) => requireText(id, "ID провода")) as [string, string];
    if (wireIds[0] === wireIds[1]) throw new Error("Дифференциальная пара должна содержать два разных провода.");
    const variant = record.variant === undefined ? 1 : record.variant;
    if (variant !== 1 && variant !== 2) throw new Error("Вид дифференциальной пары задан неверно.");
    return { id: requireText(record.id, "ID дифференциальной пары"), wireIds, step: requirePositive(record.step, "Шаг пары"), amplitude: requirePositive(record.amplitude, "Амплитуда пары"), variant };
  });
}

function parseScreens(value: unknown): readonly WireScreenGroup[] {
  if (!Array.isArray(value)) throw new Error("Экраны проводов заданы неверно.");
  return value.map((item) => {
    const record = requireRecord(item, "Экран проводов задан неверно.");
    if (!Array.isArray(record.wireIds) || record.wireIds.length < 1) throw new Error("Экран должен содержать хотя бы один провод.");
    const wireIds = record.wireIds.map((id) => requireText(id, "ID провода"));
    if (new Set(wireIds).size !== wireIds.length) throw new Error("Провода экрана не должны повторяться.");
    const position = requireNumber(record.position, "Положение экрана");
    if (position < 0 || position > 1) throw new Error("Положение экрана должно быть от 0 до 1.");
    const terminalSide = record.terminalSide === undefined ? "above" : record.terminalSide;
    if (terminalSide !== "above" && terminalSide !== "below" && terminalSide !== "both") {
      throw new Error("Сторона вывода экрана задана неверно.");
    }
    return { id: requireText(record.id, "ID экрана"), wireIds, position, label: requireBoundedText(record.label, "Обозначение экрана", 120), width: requirePositive(record.width, "Ширина экрана"), terminalSide };
  });
}

function requirePositive(value: unknown, name: string): number {
  const result = requireNumber(value, name);
  if (result <= 0) throw new Error(`${name} должно быть положительным числом.`);
  return result;
}

function parsePoint(value: unknown): Point {
  const record = requireRecord(value, "Координата задана неверно.");
  return { x: requireNumber(record.x, "Координата X"), y: requireNumber(record.y, "Координата Y") };
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length > 1024) throw new Error(`${name} задано неверно.`);
  return value;
}

function optionalString(value: unknown, name: string): string {
  return value === undefined ? "" : requireString(value, name);
}

function requireText(value: unknown, name: string): string {
  const result = requireString(value, name);
  if (!result.trim()) throw new Error(`${name} не заполнено.`);
  return result;
}

function requireBoundedText(value: unknown, name: string, maximumLength: number): string {
  const result = requireText(value, name);
  if (result.length > maximumLength) throw new Error(`${name} задано неверно.`);
  return result;
}

function requireNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${name} задано неверно.`);
  return value;
}

function requireInteger(value: unknown, name: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${name} задано неверно.`);
  }
  return value as number;
}
