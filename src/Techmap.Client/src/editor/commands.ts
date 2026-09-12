import {
  defaultLayerIds,
  type ConnectorContact,
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
  | { readonly type: "update-connector"; readonly connectorId: string; readonly designation: string }
  | { readonly type: "remove-connector"; readonly connectorId: string }
  | { readonly type: "add-wire"; readonly wire: WireInstance }
  | { readonly type: "remove-wire"; readonly wireId: string }
  | { readonly type: "update-wire"; readonly wireId: string; readonly circuit?: string; readonly color?: string; readonly lengthMm?: number }
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
): ConnectorInstance {
  if (!Number.isSafeInteger(contactCount) || contactCount < 1 || contactCount > 300) {
    throw new Error("Число контактов должно быть от 1 до 300.");
  }
  const normalizedDesignation = designation.trim();
  if (!normalizedDesignation) throw new Error("Укажите обозначение соединителя.");
  const contacts: ConnectorContact[] = Array.from({ length: contactCount }, (_, index) => ({
    id: `${id}:contact:${index + 1}`,
    number: index + 1,
    circuit: "",
  }));
  return {
    id,
    designation: normalizedDesignation,
    contacts,
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
      if (!designation) throw new Error("Укажите обозначение соединителя.");
      return {
        ...document,
        connectors: replaceRequired(document.connectors, command.connectorId, (connector) => ({
          ...connector,
          designation,
        }), "Соединитель не найден."),
      };
    }
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
  if (!connector || !connector.contacts.some((contact) => contact.id === endpoint.contactId)) {
    throw new Error("Точка подключения провода не найдена.");
  }
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
