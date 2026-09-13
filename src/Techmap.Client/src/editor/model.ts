export type EditorView = "e4" | "drawing";

export interface Point {
  readonly x: number;
  readonly y: number;
}

export type ConnectorContactStatus = "available" | "not-connected";

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
  customColumnWidth: 120,
  baseColumnWidths: {
    number: 44,
    contactType: 96,
    circuit: 140,
    terminal: 132,
    wire: 132,
    color: 80,
  } satisfies Readonly<Record<ConnectorBaseColumnKey, number>>,
} as const;

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
}

export interface ConnectorInstance {
  readonly id: string;
  readonly designation: string;
  readonly partNumber: string;
  readonly contacts: readonly ConnectorContact[];
  readonly schematic: ConnectorSchematicPresentation;
  readonly positions: Readonly<Record<EditorView, Point>>;
  readonly layerIds: Readonly<Record<EditorView, string>>;
}

export interface WireEndpoint {
  readonly connectorId: string;
  readonly contactId: string;
}

export interface WireInstance {
  readonly id: string;
  readonly from: WireEndpoint;
  readonly to: WireEndpoint;
  readonly circuit: string;
  readonly color: string;
  readonly lengthMm: number;
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
}

export interface HarnessDesignDocument {
  readonly schemaVersion: 1;
  readonly connectors: readonly ConnectorInstance[];
  readonly wires: readonly WireInstance[];
  readonly views: Readonly<Record<EditorView, EditorViewState>>;
}

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
      width: connectorE4TableMetrics.baseColumnWidths[column.key],
    }));
  const customColumns: ConnectorE4TableColumn[] = connector.schematic.customFields
    .filter((field) => field.visible)
    .map((field) => ({
      kind: "custom",
      id: field.id,
      label: field.label,
      x: 0,
      width: connectorE4TableMetrics.customColumnWidth,
    }));
  const contactsFirst = connector.schematic.orientation === "contacts-left";
  const orderedColumns = contactsFirst
    ? [...baseColumns, ...customColumns]
    : [...customColumns, ...baseColumns].reverse();
  let x = 0;
  const columns = orderedColumns.map((column) => {
    const positioned = { ...column, x };
    x += column.width;
    return positioned;
  });
  const width = Math.max(connectorE4TableMetrics.minimumWidth, x);
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
    views: {
      e4: { layers: defaultLayers() },
      drawing: { layers: defaultLayers() },
    },
  };
}

export function parseHarnessDesignDocument(value: unknown): HarnessDesignDocument {
  const record = requireRecord(value, "Сервер вернул повреждённый документ жгута.");
  if (record.schemaVersion !== 1 || !Array.isArray(record.connectors) || !Array.isArray(record.wires)) {
    throw new Error("Версия или состав документа жгута не поддерживаются.");
  }
  const views = requireRecord(record.views, "Представления документа жгута заданы неверно.");
  const document: HarnessDesignDocument = {
    schemaVersion: 1,
    connectors: record.connectors.map(parseConnector),
    wires: record.wires.map(parseWire),
    views: { e4: parseView(views.e4), drawing: parseView(views.drawing) },
  };
  const connectorIds = new Set(document.connectors.map((connector) => connector.id));
  if (connectorIds.size !== document.connectors.length) throw new Error("ID соединителей должны быть уникальны.");
  const wireIds = new Set(document.wires.map((wire) => wire.id));
  if (wireIds.size !== document.wires.length) throw new Error("ID проводов должны быть уникальны.");
  for (const wire of document.wires) {
    for (const endpoint of [wire.from, wire.to]) {
      const connector = document.connectors.find((item) => item.id === endpoint.connectorId);
      if (!connector?.contacts.some((contact) => contact.id === endpoint.contactId)) {
        throw new Error("Провод ссылается на отсутствующую точку подключения.");
      }
    }
  }
  return document;
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
  const connector = document.connectors.find((item) => item.id === endpoint.connectorId);
  return connector ? connectorContactPosition(connector, endpoint.contactId, view) : null;
}

function parseConnector(value: unknown): ConnectorInstance {
  const record = requireRecord(value, "Соединитель задан неверно.");
  if (!Array.isArray(record.contacts)) throw new Error("Контакты соединителя заданы неверно.");
  const positions = requireRecord(record.positions, "Координаты соединителя заданы неверно.");
  const layerIds = requireRecord(record.layerIds, "Слои соединителя заданы неверно.");
  const contacts = record.contacts.map((contactValue) => {
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
    };
  });
  if (new Set(contacts.map((contact) => contact.id)).size !== contacts.length ||
      new Set(contacts.map((contact) => contact.number)).size !== contacts.length) {
    throw new Error("Контакты соединителя должны иметь уникальные ID и номера.");
  }
  const designation = requireBoundedText(record.designation, "Обозначение соединителя", 120);
  const schematic = parseConnectorSchematic(record.schematic);
  const customFieldIds = new Set(schematic.customFields.map((field) => field.id));
  for (const contact of contacts) {
    if (Object.keys(contact.customValues).some((fieldId) => !customFieldIds.has(fieldId))) {
      throw new Error("Значение контакта ссылается на отсутствующее справочное поле.");
    }
  }
  return {
    id: requireText(record.id, "ID соединителя"),
    designation,
    partNumber: record.partNumber === undefined
      ? designation
      : requireBoundedText(record.partNumber, "Артикул шаблона соединителя", 120),
    contacts,
    schematic,
    positions: { e4: parsePoint(positions.e4), drawing: parsePoint(positions.drawing) },
    layerIds: {
      e4: requireText(layerIds.e4, "Слой соединителя Э4"),
      drawing: requireText(layerIds.drawing, "Слой соединителя чертежа"),
    },
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
  if (!Array.isArray(record.drawingRoute)) throw new Error("Трасса провода задана неверно.");
  const lengthMm = requireNumber(record.lengthMm, "Длина провода");
  if (lengthMm <= 0 || lengthMm > 1_000_000_000) throw new Error("Длина провода задана неверно.");
  return {
    id: requireText(record.id, "ID провода"),
    from: parseEndpoint(record.from),
    to: parseEndpoint(record.to),
    circuit: requireString(record.circuit, "Цепь провода"),
    color: requireText(record.color, "Цвет провода"),
    lengthMm,
    drawingRoute: record.drawingRoute.map(parsePoint),
    layerIds: {
      e4: requireText(layerIds.e4, "Слой провода Э4"),
      drawing: requireText(layerIds.drawing, "Слой провода чертежа"),
    },
  };
}

function parseEndpoint(value: unknown): WireEndpoint {
  const record = requireRecord(value, "Конец провода задан неверно.");
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
  return { layers };
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
