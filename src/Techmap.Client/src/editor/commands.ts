import {
  connectorBaseColumnKeys,
  createDefaultConnectorBaseColumns,
  defaultLayerIds,
  type ConnectorBaseColumnKey,
  type ConnectorContact,
  type ConnectorContactStatus,
  type ConnectorCustomField,
  type ConnectorInstance,
  type EditorLayer,
  type EditorView,
  type HarnessDesignDocument,
  type Point,
  type WireEndpoint,
  type WireInstance,
} from "./model";

export type EditorCommand =
  | { readonly type: "add-connector"; readonly connector: ConnectorInstance }
  | { readonly type: "move-connector"; readonly connectorId: string; readonly view: EditorView; readonly position: Point }
  | { readonly type: "update-connector"; readonly connectorId: string; readonly designation: string; readonly partNumber?: string }
  | { readonly type: "flip-connector-orientation"; readonly connectorId: string }
  | { readonly type: "update-contact"; readonly connectorId: string; readonly contactId: string; readonly number?: number; readonly contactType?: string; readonly circuit?: string; readonly terminalArticle?: string; readonly wire?: string; readonly color?: string; readonly connectionStatus?: ConnectorContactStatus; readonly customValues?: Readonly<Record<string, string>> }
  | { readonly type: "add-contact"; readonly connectorId: string; readonly contact: ConnectorContact }
  | { readonly type: "remove-contact"; readonly connectorId: string; readonly contactId: string }
  | { readonly type: "toggle-base-column-visibility"; readonly connectorId: string; readonly key: ConnectorBaseColumnKey }
  | { readonly type: "add-custom-field"; readonly connectorId: string; readonly field: ConnectorCustomField }
  | { readonly type: "remove-custom-field"; readonly connectorId: string; readonly fieldId: string }
  | { readonly type: "toggle-custom-field-visibility"; readonly connectorId: string; readonly fieldId: string }
  | { readonly type: "remove-connector"; readonly connectorId: string }
  | { readonly type: "add-wire"; readonly wire: WireInstance }
  | { readonly type: "remove-wire"; readonly wireId: string }
  | { readonly type: "update-wire"; readonly wireId: string; readonly circuit?: string; readonly color?: string; readonly lengthMm?: number }
  | { readonly type: "reconnect-wire"; readonly wireId: string; readonly end: "from" | "to"; readonly endpoint: WireEndpoint }
  | { readonly type: "set-wire-route"; readonly wireId: string; readonly route: readonly Point[] }
  | { readonly type: "update-layer"; readonly view: EditorView; readonly layerId: string; readonly visible?: boolean; readonly locked?: boolean }
  | { readonly type: "replace-layers"; readonly view: EditorView; readonly layers: readonly EditorLayer[] }
  | { readonly type: "move-layer"; readonly view: EditorView; readonly layerId: string; readonly direction: -1 | 1 };

export function createConnector(
  id: string,
  designation: string,
  contactCount: number,
  e4Position: Point,
  drawingPosition: Point = e4Position,
  partNumber: string = designation,
): ConnectorInstance {
  if (!Number.isSafeInteger(contactCount) || contactCount < 1 || contactCount > 300) {
    throw new Error("Число контактов должно быть от 1 до 300.");
  }
  const normalizedDesignation = designation.trim();
  requireConnectorText(normalizedDesignation, "Укажите обозначение соединителя.");
  const normalizedPartNumber = partNumber.trim();
  requireConnectorText(normalizedPartNumber, "Укажите артикул шаблона соединителя.");
  const contacts: ConnectorContact[] = Array.from({ length: contactCount }, (_, index) => ({
    id: `${id}:contact:${index + 1}`,
    number: index + 1,
    contactType: "",
    circuit: "",
    terminalArticle: "",
    wire: "",
    color: "",
    connectionStatus: "available",
    customValues: {},
  }));
  return {
    id,
    designation: normalizedDesignation,
    partNumber: normalizedPartNumber,
    contacts,
    schematic: {
      orientation: "contacts-right",
      baseColumns: createDefaultConnectorBaseColumns(),
      customFields: [],
    },
    positions: { e4: e4Position, drawing: drawingPosition },
    layerIds: { e4: defaultLayerIds.connectors, drawing: defaultLayerIds.connectors },
  };
}

export function createWire(
  id: string,
  from: WireEndpoint,
  to: WireEndpoint,
  lengthMm = 100,
  circuit = "",
  color = "#334155",
): WireInstance {
  requireLength(lengthMm);
  return {
    id,
    from,
    to,
    circuit: circuit.trim(),
    color,
    lengthMm,
    drawingRoute: [],
    layerIds: { e4: defaultLayerIds.wires, drawing: defaultLayerIds.wires },
  };
}

export function applyEditorCommand(
  document: HarnessDesignDocument,
  command: EditorCommand,
): HarnessDesignDocument {
  switch (command.type) {
    case "add-connector":
      if (document.connectors.some((item) => item.id === command.connector.id)) {
        throw new Error("Соединитель с таким ID уже существует.");
      }
      return { ...document, connectors: [...document.connectors, command.connector] };
    case "move-connector":
      return {
        ...document,
        connectors: replaceRequired(document.connectors, command.connectorId, (connector) => ({
          ...connector,
          positions: { ...connector.positions, [command.view]: command.position },
        }), "Соединитель не найден."),
      };
    case "update-connector": {
      const designation = command.designation.trim();
      requireConnectorText(designation, "Укажите обозначение соединителя.");
      const partNumber = command.partNumber?.trim();
      if (partNumber !== undefined) requireConnectorText(partNumber, "Укажите артикул шаблона соединителя.");
      return {
        ...document,
        connectors: replaceRequired(document.connectors, command.connectorId, (connector) => ({
          ...connector,
          designation,
          partNumber: partNumber ?? connector.partNumber,
        }), "Соединитель не найден."),
      };
    }
    case "flip-connector-orientation":
      return updateConnector(document, command.connectorId, (connector) => ({
        ...connector,
        schematic: {
          ...connector.schematic,
          orientation: connector.schematic.orientation === "contacts-left" ? "contacts-right" : "contacts-left",
        },
      }));
    case "update-contact":
      return updateConnector(document, command.connectorId, (connector) => {
        if (command.number !== undefined) requireContactNumber(command.number);
        if (command.connectionStatus !== undefined) requireContactStatus(command.connectionStatus);
        if (command.connectionStatus === "not-connected" && isContactConnected(document, command.connectorId, command.contactId)) {
          throw new Error("Нельзя пометить контакт как неподключённый, пока к нему подключён провод.");
        }
        const customValues = command.customValues === undefined
          ? undefined
          : normalizeCustomValues(command.customValues, connector.schematic.customFields);
        const contacts = replaceRequired(connector.contacts, command.contactId, (contact) => ({
          ...contact,
          number: command.number ?? contact.number,
          contactType: command.contactType === undefined ? contact.contactType : normalizeValue(command.contactType, "Тип контакта"),
          circuit: command.circuit === undefined ? contact.circuit : normalizeValue(command.circuit, "Цепь контакта"),
          terminalArticle: command.terminalArticle === undefined
            ? contact.terminalArticle
            : normalizeValue(command.terminalArticle, "Артикул терминала"),
          wire: command.wire === undefined ? contact.wire : normalizeValue(command.wire, "Провод контакта"),
          color: command.color === undefined ? contact.color : normalizeValue(command.color, "Цвет провода контакта"),
          connectionStatus: command.connectionStatus ?? contact.connectionStatus,
          customValues: customValues ?? contact.customValues,
        }), "Контакт не найден.");
        validateUniqueContacts(contacts);
        return { ...connector, contacts };
      });
    case "add-contact":
      return updateConnector(document, command.connectorId, (connector) => {
        const contact = normalizeContact(command.contact, connector.schematic.customFields);
        const contacts = [...connector.contacts, contact];
        validateUniqueContacts(contacts);
        return { ...connector, contacts };
      });
    case "remove-contact": {
      if (document.wires.some((wire) =>
        (wire.from.connectorId === command.connectorId && wire.from.contactId === command.contactId) ||
        (wire.to.connectorId === command.connectorId && wire.to.contactId === command.contactId))) {
        throw new Error("Нельзя удалить контакт, к которому подключён провод.");
      }
      return updateConnector(document, command.connectorId, (connector) => ({
        ...connector,
        contacts: removeRequired(connector.contacts, command.contactId, "Контакт не найден."),
      }));
    }
    case "toggle-base-column-visibility":
      if (!connectorBaseColumnKeys.includes(command.key)) throw new Error("Базовая колонка не найдена.");
      return updateConnector(document, command.connectorId, (connector) => ({
        ...connector,
        schematic: {
          ...connector.schematic,
          baseColumns: connector.schematic.baseColumns.map((column) =>
            column.key === command.key ? { ...column, visible: !column.visible } : column),
        },
      }));
    case "add-custom-field":
      return updateConnector(document, command.connectorId, (connector) => {
        const field = normalizeCustomField(command.field);
        if (connector.schematic.customFields.some((item) => item.id === field.id)) {
          throw new Error("Справочное поле с таким ID уже существует.");
        }
        return {
          ...connector,
          schematic: {
            ...connector.schematic,
            customFields: [...connector.schematic.customFields, field],
          },
        };
      });
    case "remove-custom-field":
      return updateConnector(document, command.connectorId, (connector) => ({
        ...connector,
        contacts: connector.contacts.map((contact) => {
          const { [command.fieldId]: _removed, ...customValues } = contact.customValues;
          return { ...contact, customValues };
        }),
        schematic: {
          ...connector.schematic,
          customFields: removeRequired(connector.schematic.customFields, command.fieldId, "Справочное поле не найдено."),
        },
      }));
    case "toggle-custom-field-visibility":
      return updateConnector(document, command.connectorId, (connector) => ({
        ...connector,
        schematic: {
          ...connector.schematic,
          customFields: replaceRequired(connector.schematic.customFields, command.fieldId, (field) => ({
            ...field,
            visible: !field.visible,
          }), "Справочное поле не найдено."),
        },
      }));
    case "remove-connector": {
      if (!document.connectors.some((item) => item.id === command.connectorId)) {
        throw new Error("Соединитель не найден.");
      }
      return {
        ...document,
        connectors: document.connectors.filter((item) => item.id !== command.connectorId),
        wires: document.wires.filter((wire) =>
          wire.from.connectorId !== command.connectorId && wire.to.connectorId !== command.connectorId),
      };
    }
    case "add-wire":
      validateWire(document, command.wire);
      if (document.wires.some((item) => item.id === command.wire.id)) {
        throw new Error("Провод с таким ID уже существует.");
      }
      return { ...document, wires: [...document.wires, command.wire] };
    case "remove-wire":
      return {
        ...document,
        wires: removeRequired(document.wires, command.wireId, "Провод не найден."),
      };
    case "update-wire":
      if (command.lengthMm !== undefined) requireLength(command.lengthMm);
      return {
        ...document,
        wires: replaceRequired(document.wires, command.wireId, (wire) => ({
          ...wire,
          circuit: command.circuit === undefined ? wire.circuit : command.circuit.trim(),
          color: command.color ?? wire.color,
          lengthMm: command.lengthMm ?? wire.lengthMm,
        }), "Провод не найден."),
      };
    case "reconnect-wire": {
      requireEndpoint(document, command.endpoint);
      return {
        ...document,
        wires: replaceRequired(document.wires, command.wireId, (wire) => {
          const changed = { ...wire, [command.end]: { ...command.endpoint } };
          validateWire(document, changed);
          return changed;
        }, "Провод не найден."),
      };
    }
    case "set-wire-route":
      return {
        ...document,
        wires: replaceRequired(document.wires, command.wireId, (wire) => ({
          ...wire,
          drawingRoute: command.route.map((point) => ({ ...point })),
        }), "Провод не найден."),
      };
    case "update-layer":
      return updateLayers(document, command.view, (layers) =>
        replaceRequired(layers, command.layerId, (layer) => ({
          ...layer,
          visible: command.visible ?? layer.visible,
          locked: command.locked ?? layer.locked,
        }), "Слой не найден."));
    case "replace-layers":
      validateLayers(command.layers);
      return updateLayers(document, command.view, () => command.layers.map((layer) => ({ ...layer })));
    case "move-layer":
      return updateLayers(document, command.view, (layers) => moveLayer(layers, command.layerId, command.direction));
  }
}

function validateLayers(layers: readonly EditorLayer[]): void {
  if (layers.length < 1 || new Set(layers.map((layer) => layer.id)).size !== layers.length ||
      new Set(layers.map((layer) => layer.order)).size !== layers.length) {
    throw new Error("Слои должны иметь уникальные ID и порядок.");
  }
}

function updateConnector(
  document: HarnessDesignDocument,
  connectorId: string,
  update: (connector: ConnectorInstance) => ConnectorInstance,
): HarnessDesignDocument {
  return {
    ...document,
    connectors: replaceRequired(document.connectors, connectorId, update, "Соединитель не найден."),
  };
}

function normalizeContact(
  contact: ConnectorContact,
  customFields: readonly ConnectorCustomField[],
): ConnectorContact {
  requireContactNumber(contact.number);
  requireContactStatus(contact.connectionStatus);
  if (!contact.id.trim() || contact.id.length > 1024) throw new Error("ID контакта задан неверно.");
  return {
    ...contact,
    id: contact.id.trim(),
    contactType: normalizeValue(contact.contactType, "Тип контакта"),
    circuit: normalizeValue(contact.circuit, "Цепь контакта"),
    terminalArticle: normalizeValue(contact.terminalArticle, "Артикул терминала"),
    wire: normalizeValue(contact.wire, "Провод контакта"),
    color: normalizeValue(contact.color, "Цвет провода контакта"),
    customValues: normalizeCustomValues(contact.customValues, customFields),
  };
}

function normalizeCustomField(field: ConnectorCustomField): ConnectorCustomField {
  const id = field.id.trim();
  const label = field.label.trim();
  if (!id || id.length > 1024) throw new Error("ID справочного поля задан неверно.");
  if (!label || label.length > 120) throw new Error("Название справочного поля задано неверно.");
  if (typeof field.visible !== "boolean") throw new Error("Видимость справочного поля задана неверно.");
  return { id, label, visible: field.visible };
}

function normalizeCustomValues(
  values: Readonly<Record<string, string>>,
  customFields: readonly ConnectorCustomField[],
): Readonly<Record<string, string>> {
  const knownIds = new Set(customFields.map((field) => field.id));
  const result: Record<string, string> = {};
  for (const [fieldId, value] of Object.entries(values)) {
    if (!knownIds.has(fieldId)) throw new Error("Справочное поле контакта не найдено.");
    result[fieldId] = normalizeValue(value, "Значение справочного поля");
  }
  return result;
}

function validateUniqueContacts(contacts: readonly ConnectorContact[]): void {
  if (new Set(contacts.map((contact) => contact.id)).size !== contacts.length ||
      new Set(contacts.map((contact) => contact.number)).size !== contacts.length) {
    throw new Error("Контакты соединителя должны иметь уникальные ID и номера.");
  }
}

function requireContactNumber(number: number): void {
  if (!Number.isSafeInteger(number) || number < 1 || number > 300) {
    throw new Error("Номер контакта должен быть от 1 до 300.");
  }
}

function requireContactStatus(status: ConnectorContactStatus): void {
  if (status !== "available" && status !== "not-connected") {
    throw new Error("Статус подключения контакта задан неверно.");
  }
}

function normalizeValue(value: string, name: string): string {
  if (typeof value !== "string" || value.length > 1024) throw new Error(`${name} задано неверно.`);
  return value.trim();
}

function requireConnectorText(value: string, emptyMessage: string): void {
  if (!value) throw new Error(emptyMessage);
  if (value.length > 120) throw new Error("Значение соединителя не должно быть длиннее 120 символов.");
}

function updateLayers(
  document: HarnessDesignDocument,
  view: EditorView,
  update: (layers: readonly EditorLayer[]) => readonly EditorLayer[],
): HarnessDesignDocument {
  return {
    ...document,
    views: { ...document.views, [view]: { layers: update(document.views[view].layers) } },
  };
}

function moveLayer(layers: readonly EditorLayer[], layerId: string, direction: -1 | 1): readonly EditorLayer[] {
  const ordered = [...layers].sort((left, right) => left.order - right.order);
  const index = ordered.findIndex((item) => item.id === layerId);
  if (index < 0) throw new Error("Слой не найден.");
  const target = index + direction;
  if (target < 0 || target >= ordered.length) return layers;
  const currentLayer = ordered[index]!;
  const targetLayer = ordered[target]!;
  return layers.map((layer) => layer.id === currentLayer.id
    ? { ...layer, order: targetLayer.order }
    : layer.id === targetLayer.id
      ? { ...layer, order: currentLayer.order }
      : layer);
}

function validateWire(document: HarnessDesignDocument, wire: WireInstance): void {
  if (wire.from.connectorId === wire.to.connectorId && wire.from.contactId === wire.to.contactId) {
    throw new Error("Провод должен соединять две разные точки.");
  }
  requireEndpoint(document, wire.from);
  requireEndpoint(document, wire.to);
  requireLength(wire.lengthMm);
}

function requireEndpoint(document: HarnessDesignDocument, endpoint: WireEndpoint): void {
  const connector = document.connectors.find((item) => item.id === endpoint.connectorId);
  const contact = connector?.contacts.find((item) => item.id === endpoint.contactId);
  if (!contact) {
    throw new Error("Точка подключения провода не найдена.");
  }
  if (contact.connectionStatus === "not-connected") {
    throw new Error("Контакт помечен как неподключённый и не может быть соединён проводом.");
  }
}

function isContactConnected(document: HarnessDesignDocument, connectorId: string, contactId: string): boolean {
  return document.wires.some((wire) =>
    (wire.from.connectorId === connectorId && wire.from.contactId === contactId) ||
    (wire.to.connectorId === connectorId && wire.to.contactId === contactId));
}

function requireLength(lengthMm: number): void {
  if (!Number.isFinite(lengthMm) || lengthMm <= 0 || lengthMm > 1_000_000_000) {
    throw new Error("Длина провода должна быть положительным числом в миллиметрах.");
  }
}

function replaceRequired<T extends { readonly id: string }>(
  items: readonly T[],
  id: string,
  update: (item: T) => T,
  message: string,
): readonly T[] {
  let found = false;
  const result = items.map((item) => {
    if (item.id !== id) return item;
    found = true;
    return update(item);
  });
  if (!found) throw new Error(message);
  return result;
}

function removeRequired<T extends { readonly id: string }>(items: readonly T[], id: string, message: string): readonly T[] {
  if (!items.some((item) => item.id === id)) throw new Error(message);
  return items.filter((item) => item.id !== id);
}
