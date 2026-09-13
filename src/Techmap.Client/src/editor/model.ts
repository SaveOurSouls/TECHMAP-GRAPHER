export type EditorView = "e4" | "drawing";

export interface Point {
  readonly x: number;
  readonly y: number;
}

export type ConnectorContactStatus = "available" | "not-connected";

export type ConnectorLibraryContactKind = "signal" | "power" | "third";

export type ConnectorLibraryBinding =
  | { readonly mode: "series"; readonly seriesId: string; readonly partNumber: string }
  | { readonly mode: "free" };

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
  readonly number: number;
  readonly contactType: string;
  readonly circuit: string;
  readonly terminalArticle: string;
  readonly wire: string;
  readonly color: string;
  readonly connectionStatus: ConnectorContactStatus;
  readonly customValues: Readonly<Record<string, string>>;
  readonly libraryContact?: ConnectorLibraryContact | null;
}

export interface ConnectorInstance {
  readonly id: string;
  readonly designation: string;
  readonly partNumber: string;
  readonly contacts: readonly ConnectorContact[];
  readonly schematic: ConnectorSchematicPresentation;
  readonly positions: Readonly<Record<EditorView, Point>>;
  readonly layerIds: Readonly<Record<EditorView, string>>;
  readonly libraryBinding?: ConnectorLibraryBinding;
}

export type WireEndpoint =
  | { readonly connectorId: string; readonly contactId: string; readonly junctionId?: never }
  | { readonly junctionId: string; readonly connectorId: ""; readonly contactId: "" };

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
}

export type WireCrossingStyle = "none" | "bridge";

export type E4RouteLeadDirection = "left" | "right" | null;

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
  readonly lengthMm: number;
  readonly e4Route: readonly Point[];
  /** Missing in older documents and treated as automatic. */
  readonly e4RouteMode?: "auto" | "manual";
  readonly drawingRoute: readonly Point[];
  readonly layerIds: Readonly<Record<EditorView, string>>;
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
  readonly connectors: readonly ConnectorInstance[];
  readonly wires: readonly WireInstance[];
  readonly junctions: readonly E4Junction[];
  readonly diffPairs: readonly DiffPairGroup[];
  readonly screens: readonly WireScreenGroup[];
  readonly views: Readonly<Record<EditorView, EditorViewState>>;
}

export const defaultE4WireLead = 24;

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
          ...(column.key === "number" ? [connector.partNumber] : []),
          ...connector.contacts.map((contact) => column.key === "number" ? String(contact.number)
            : column.key === "contactType" ? contact.contactType
              : column.key === "circuit" ? contact.circuit
                : column.key === "terminal" ? contact.terminalArticle
                  : column.key === "wire" ? contact.wire : contact.color),
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
  const width = Math.max(connectorE4TableMetrics.minimumWidth, x);
  if (columns.length > 0 && width > x) {
    const growIndex = Math.max(0, columns.findIndex((column) => column.kind === "base" && column.key === "number"));
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
    connectors: record.connectors.map(parseConnector),
    wires: wireValues.map(parseWire),
    junctions: record.junctions === undefined ? [] : parseJunctions(record.junctions),
    diffPairs: record.diffPairs === undefined ? [] : parseDiffPairs(record.diffPairs),
    screens: record.screens === undefined ? [] : parseScreens(record.screens),
    views: { e4: parseView(views.e4), drawing: parseView(views.drawing) },
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

export function isJunctionEndpoint(endpoint: WireEndpoint): endpoint is Extract<WireEndpoint, { junctionId: string }> {
  return "junctionId" in endpoint;
}

export function createJunctionEndpoint(junctionId: string): WireEndpoint {
  return { junctionId, connectorId: "", contactId: "" };
}

export function wireEndpointE4Anchor(document: HarnessDesignDocument, endpoint: WireEndpoint): E4RouteAnchor | null {
  if (isJunctionEndpoint(endpoint)) {
    const junction = document.junctions.find((item) => item.id === endpoint.junctionId);
    return junction ? { position: junction.position, leadDirection: null } : null;
  }
  const connector = document.connectors.find((item) => item.id === endpoint.connectorId);
  if (!connector) return null;
  const position = connectorContactPosition(connector, endpoint.contactId, "e4");
  return position ? {
    position,
    leadDirection: connector.schematic.orientation === "contacts-left" ? "left" : "right",
  } : null;
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
  const distance = anchor.leadDirection === "left"
    ? anchor.position.x - adjacent.x
    : adjacent.x - anchor.position.x;
  if (adjacent.y !== anchor.position.y || distance < minimumLead) {
    throw new Error("Маршрут Э4 должен иметь прямой участок наружу от контакта.");
  }
}

function leadPoint(anchor: E4RouteAnchor, minimumLead: number): Point {
  if (anchor.leadDirection === "left") return { x: anchor.position.x - minimumLead, y: anchor.position.y };
  if (anchor.leadDirection === "right") return { x: anchor.position.x + minimumLead, y: anchor.position.y };
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
}

function validateJunctionCircuitComponents(wires: readonly WireInstance[], junctions: readonly E4Junction[]): void {
  const visited = new Set<string>();
  for (const wire of wires) {
    if (visited.has(wire.id)) continue;
    const component = collectConnectedWireIds(wire.id, junctions);
    for (const wireId of component) visited.add(wireId);
    const circuits = new Set(wires.filter((item) => component.has(item.id) && item.circuit).map((item) => item.circuit));
    if (circuits.size > 1) throw new Error("Провода одной цепи через узел соединения имеют разные обозначения цепи.");
  }
}

function collectConnectedWireIds(wireId: string, junctions: readonly E4Junction[]): Set<string> {
  const result = new Set([wireId]);
  let size = -1;
  while (size !== result.size) {
    size = result.size;
    for (const junction of junctions) if (junction.wireIds.some((id) => result.has(id))) {
      for (const id of junction.wireIds) result.add(id);
    }
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
      number: requireInteger(contact.number, "Номер контакта", 1, 300),
      contactType: optionalString(contact.contactType, "Тип контакта"),
      circuit: requireString(contact.circuit, "Цепь контакта"),
      terminalArticle: optionalString(contact.terminalArticle, "Артикул терминала"),
      wire: optionalString(contact.wire, "Провод контакта"),
      color: optionalString(contact.color, "Цвет провода контакта"),
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
    : requireBoundedText(record.partNumber, "Артикул шаблона соединителя", 120);
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
  if (record.mode !== "series") throw new Error("Режим библиотечного соединителя задан неверно.");
  return {
    mode: "series",
    seriesId: requireText(record.seriesId, "ID серии соединителя"),
    partNumber: requireText(record.partNumber, "Артикул соединителя серии"),
  };
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
  const lengthMm = requireNumber(record.lengthMm, "Длина провода");
  if (lengthMm <= 0 || lengthMm > 1_000_000_000) throw new Error("Длина провода задана неверно.");
  return {
    id: requireText(record.id, "ID провода"),
    from: parseEndpoint(record.from),
    to: parseEndpoint(record.to),
    circuit: requireString(record.circuit, "Цепь провода"),
    color: requireText(record.color, "Цвет провода"),
    lengthMm,
    e4Route: record.e4Route === undefined ? [] : record.e4Route.map(parsePoint),
    e4RouteMode: record.e4RouteMode === undefined || record.e4RouteMode === "auto"
      ? "auto"
      : record.e4RouteMode === "manual" ? "manual" : (() => { throw new Error("Режим трассы Э4 задан неверно."); })(),
    drawingRoute: record.drawingRoute.map(parsePoint),
    layerIds: {
      e4: requireText(layerIds.e4, "Слой провода Э4"),
      drawing: requireText(layerIds.drawing, "Слой провода чертежа"),
    },
  };
}

function parseEndpoint(value: unknown): WireEndpoint {
  const record = requireRecord(value, "Конец провода задан неверно.");
  if (record.junctionId !== undefined) return createJunctionEndpoint(requireText(record.junctionId, "Узел конца провода"));
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
    return { id: requireText(record.id, "ID экрана"), wireIds, position, label: requireBoundedText(record.label, "Обозначение экрана", 120), width: requirePositive(record.width, "Ширина экрана") };
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
