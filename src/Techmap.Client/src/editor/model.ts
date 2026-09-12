export type EditorView = "e4" | "drawing";

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface ConnectorContact {
  readonly id: string;
  readonly number: number;
  readonly circuit: string;
}

export interface ConnectorInstance {
  readonly id: string;
  readonly designation: string;
  readonly contacts: readonly ConnectorContact[];
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
  const spacing = view === "e4" ? 22 : 16;
  return { x: origin.x + 118, y: origin.y + 28 + index * spacing };
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
      circuit: requireString(contact.circuit, "Цепь контакта"),
    };
  });
  if (new Set(contacts.map((contact) => contact.id)).size !== contacts.length ||
      new Set(contacts.map((contact) => contact.number)).size !== contacts.length) {
    throw new Error("Контакты соединителя должны иметь уникальные ID и номера.");
  }
  return {
    id: requireText(record.id, "ID соединителя"),
    designation: requireText(record.designation, "Обозначение соединителя"),
    contacts,
    positions: { e4: parsePoint(positions.e4), drawing: parsePoint(positions.drawing) },
    layerIds: {
      e4: requireText(layerIds.e4, "Слой соединителя Э4"),
      drawing: requireText(layerIds.drawing, "Слой соединителя чертежа"),
    },
  };
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

function requireText(value: unknown, name: string): string {
  const result = requireString(value, name);
  if (!result.trim()) throw new Error(`${name} не заполнено.`);
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
