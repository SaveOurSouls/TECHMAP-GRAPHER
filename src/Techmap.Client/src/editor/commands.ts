import {
  connectorBaseColumnKeys,
  createOrthogonalE4Route,
  createJunctionEndpoint,
  createDefaultConnectorBaseColumns,
  defaultLayerIds,
  isJunctionEndpoint,
  validateOrthogonalE4Route,
  wireE4PathContainsPoint,
  wireEndpointE4Anchor,
  wireGroupHasCommonE4ParallelSpan,
  type ConnectorBaseColumnKey,
  type ConnectorContact,
  type ConnectorContactStatus,
  type ConnectorCustomField,
  type ConnectorInstance,
  type DiffPairGroup,
  type E4Junction,
  type EditorLayer,
  type EditorView,
  type HarnessDesignDocument,
  type Point,
  type WireEndpoint,
  type WireCrossingStyle,
  type WireInstance,
  type WireScreenGroup,
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
  | { readonly type: "add-wire"; readonly wire: WireInstance; readonly targetWireId?: string }
  | { readonly type: "remove-wire"; readonly wireId: string }
  | { readonly type: "update-wire"; readonly wireId: string; readonly circuit?: string; readonly color?: string; readonly lengthMm?: number }
  | { readonly type: "reconnect-wire"; readonly wireId: string; readonly end: "from" | "to"; readonly endpoint: WireEndpoint }
  | { readonly type: "set-wire-route"; readonly wireId: string; readonly route: readonly Point[] }
  | { readonly type: "set-e4-wire-route"; readonly wireId: string; readonly route: readonly Point[] }
  | { readonly type: "move-e4-wire-route-point"; readonly wireId: string; readonly pointIndex: number; readonly position: Point }
  | { readonly type: "move-e4-wire-segment"; readonly wireId: string; readonly segmentIndex: number; readonly position: Point }
  | { readonly type: "set-wire-crossing-style"; readonly view: EditorView; readonly style: WireCrossingStyle }
  | { readonly type: "create-junction"; readonly junction: E4Junction; readonly branchWire?: WireInstance }
  | { readonly type: "move-junction"; readonly junctionId: string; readonly position: Point }
  | { readonly type: "remove-junction"; readonly junctionId: string }
  | { readonly type: "connect-wire-to-junction"; readonly wireId: string; readonly end: "from" | "to"; readonly junctionId: string }
  | { readonly type: "connect-wire-to-wire"; readonly wireId: string; readonly end: "from" | "to"; readonly targetWireId: string; readonly junctionId: string; readonly position: Point }
  | { readonly type: "create-diff-pair"; readonly group: DiffPairGroup }
  | { readonly type: "update-diff-pair"; readonly groupId: string; readonly variant?: 1 | 2; readonly step?: number; readonly amplitude?: number }
  | { readonly type: "remove-diff-pair"; readonly groupId: string }
  | { readonly type: "create-screen"; readonly screen: WireScreenGroup }
  | { readonly type: "update-screen"; readonly screenId: string; readonly wireIds?: readonly string[]; readonly position?: number; readonly label?: string; readonly width?: number }
  | { readonly type: "remove-screen"; readonly screenId: string }
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
    e4Route: [],
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
      {
      const moved = {
        ...document,
        connectors: replaceRequired(document.connectors, command.connectorId, (connector) => ({
          ...connector,
          positions: { ...connector.positions, [command.view]: command.position },
        }), "Соединитель не найден."),
      };
      if (command.view !== "e4") return moved;
      return rebuildConnectorE4Wires(moved, command.connectorId);
      }
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
      return updateConnectorE4Geometry(document, command.connectorId, (connector) => ({
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
        (isConnectorEndpoint(wire.from, command.connectorId, command.contactId)) ||
        (isConnectorEndpoint(wire.to, command.connectorId, command.contactId)))) {
        throw new Error("Нельзя удалить контакт, к которому подключён провод.");
      }
      return updateConnectorE4Geometry(document, command.connectorId, (connector) => ({
        ...connector,
        contacts: removeRequired(connector.contacts, command.contactId, "Контакт не найден."),
      }));
    }
    case "toggle-base-column-visibility":
      if (!connectorBaseColumnKeys.includes(command.key)) throw new Error("Базовая колонка не найдена.");
      return updateConnectorE4Geometry(document, command.connectorId, (connector) => ({
        ...connector,
        schematic: {
          ...connector.schematic,
          baseColumns: connector.schematic.baseColumns.map((column) =>
            column.key === command.key ? { ...column, visible: !column.visible } : column),
        },
      }));
    case "add-custom-field":
      return updateConnectorE4Geometry(document, command.connectorId, (connector) => {
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
      return updateConnectorE4Geometry(document, command.connectorId, (connector) => ({
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
      return updateConnectorE4Geometry(document, command.connectorId, (connector) => ({
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
      const removedWireIds = document.wires.filter((wire) =>
        isConnectorEndpoint(wire.from, command.connectorId) || isConnectorEndpoint(wire.to, command.connectorId)).map((wire) => wire.id);
      return cleanupWireReferences({
        ...document,
        connectors: document.connectors.filter((item) => item.id !== command.connectorId),
        wires: document.wires.filter((wire) => !removedWireIds.includes(wire.id)),
      }, removedWireIds);
    }
    case "add-wire":
      validateWire(document, command.wire);
      if (document.wires.some((item) => item.id === command.wire.id)) {
        throw new Error("Провод с таким ID уже существует.");
      }
      let added = addWireToEndpointJunctions(
        { ...document, wires: [...document.wires, command.wire] }, command.wire);
      if (command.targetWireId !== undefined) {
        const junctionEndpoint = [command.wire.from, command.wire.to].find(isJunctionEndpoint);
        if (!junctionEndpoint) throw new Error("Новая ветвь должна завершаться в узле целевого провода.");
        added = addTargetWireToJunction(added, junctionEndpoint.junctionId, command.targetWireId);
      }
      const addedAndRouted = rerouteWireE4(added, command.wire.id);
      validateWireGroups(addedAndRouted);
      return normalizeJunctionCircuits(addedAndRouted);
    case "remove-wire": {
      const changed = {
        ...document,
        wires: removeRequired(document.wires, command.wireId, "Провод не найден."),
      };
      return cleanupWireReferences(changed, [command.wireId]);
    }
    case "update-wire":
      if (command.lengthMm !== undefined) requireLength(command.lengthMm);
      return normalizeJunctionCircuits({
        ...document,
        wires: replaceRequired(document.wires, command.wireId, (wire) => ({
          ...wire,
          circuit: command.circuit === undefined ? wire.circuit : command.circuit.trim(),
          color: command.color ?? wire.color,
          lengthMm: command.lengthMm ?? wire.lengthMm,
        }), "Провод не найден."),
      });
    case "reconnect-wire": {
      requireEndpoint(document, command.endpoint);
      const original = findWire(document, command.wireId);
      const changed = {
        ...document,
        wires: replaceRequired(document.wires, command.wireId, (wire) => {
          const updated = { ...wire, [command.end]: { ...command.endpoint } };
          validateWire(document, updated);
          return updated;
        }, "Провод не найден."),
      };
      const membership = updateJunctionMembership(changed, command.wireId, original[command.end], command.endpoint);
      const routed = rerouteWireE4(membership, command.wireId);
      validateWireGroups(routed);
      return normalizeJunctionCircuits(routed);
    }
    case "set-wire-route":
      return {
        ...document,
        wires: replaceRequired(document.wires, command.wireId, (wire) => ({
          ...wire,
          drawingRoute: command.route.map((point) => ({ ...point })),
        }), "Провод не найден."),
      };
    case "set-e4-wire-route":
      return setE4WireRoute(document, command.wireId, command.route);
    case "move-e4-wire-route-point": {
      const wire = findWire(document, command.wireId);
      if (!Number.isSafeInteger(command.pointIndex) || command.pointIndex < 0 || command.pointIndex >= wire.e4Route.length) {
        throw new Error("Точка маршрута Э4 не найдена.");
      }
      return setE4WireRoute(document, command.wireId, wire.e4Route.map((point, index) =>
        index === command.pointIndex ? { ...command.position } : point));
    }
    case "move-e4-wire-segment": {
      const wire = findWire(document, command.wireId);
      if (!Number.isSafeInteger(command.segmentIndex) || command.segmentIndex < 1 || command.segmentIndex >= wire.e4Route.length) {
        throw new Error("Перемещать можно только внутренний сегмент маршрута Э4.");
      }
      const first = wire.e4Route[command.segmentIndex - 1]!;
      const second = wire.e4Route[command.segmentIndex]!;
      const route = wire.e4Route.map((point) => ({ ...point }));
      if (first.x === second.x) {
        route[command.segmentIndex - 1] = { x: command.position.x, y: first.y };
        route[command.segmentIndex] = { x: command.position.x, y: second.y };
      } else if (first.y === second.y) {
        route[command.segmentIndex - 1] = { x: first.x, y: command.position.y };
        route[command.segmentIndex] = { x: second.x, y: command.position.y };
      } else {
        throw new Error("Сегмент маршрута Э4 должен быть ортогональным.");
      }
      const movedJunctionIds = new Set(document.junctions
        .filter((junction) => junction.wireIds.includes(command.wireId) && pointOnOrthogonalSegment(junction.position, first, second))
        .map((junction) => junction.id));
      let changed: HarnessDesignDocument = {
        ...document,
        wires: document.wires.map((item) => item.id === command.wireId ? { ...item, e4Route: route } : item),
        junctions: document.junctions.map((junction) => !movedJunctionIds.has(junction.id)
          ? junction
          : first.x === second.x
            ? { ...junction, position: { ...junction.position, x: command.position.x } }
            : { ...junction, position: { ...junction.position, y: command.position.y } }),
      };
      const start = wireEndpointE4Anchor(changed, wire.from);
      const end = wireEndpointE4Anchor(changed, wire.to);
      if (!start || !end) throw new Error("Точки подключения маршрута Э4 не найдены.");
      validateOrthogonalE4Route(start, route, end);
      const otherWireIds = new Set(changed.junctions
        .filter((junction) => movedJunctionIds.has(junction.id))
        .flatMap((junction) => junction.wireIds)
        .filter((wireId) => wireId !== command.wireId));
      for (const wireId of otherWireIds) changed = rerouteWireE4ThroughJunctions(changed, wireId);
      for (const junction of changed.junctions.filter((item) => movedJunctionIds.has(item.id))) {
        validateJunctionAgainstWires(changed, junction);
      }
      validateWireGroups(changed);
      return changed;
    }
    case "set-wire-crossing-style":
      if (command.style !== "none" && command.style !== "bridge") throw new Error("Режим пересечения проводов задан неверно.");
      return {
        ...document,
        views: { ...document.views, [command.view]: { ...document.views[command.view], wireCrossingStyle: command.style } },
      };
    case "create-junction": {
      if (document.junctions.some((item) => item.id === command.junction.id)) throw new Error("Узел соединения с таким ID уже существует.");
      let changed = document;
      if (command.branchWire) {
        const endpointMatches = [command.branchWire.from, command.branchWire.to].some((endpoint) =>
          isJunctionEndpoint(endpoint) && endpoint.junctionId === command.junction.id);
        if (!endpointMatches) throw new Error("Ветвь должна завершаться в создаваемом узле соединения.");
        validateWire(document, command.branchWire, command.junction.id);
        if (document.wires.some((wire) => wire.id === command.branchWire!.id)) throw new Error("Провод с таким ID уже существует.");
        changed = { ...document, wires: [...document.wires, command.branchWire] };
      }
      const junction = normalizeJunction(command.junction);
      if (command.branchWire && !junction.wireIds.includes(command.branchWire.id)) {
        throw new Error("Создаваемый узел должен содержать ID новой ветви.");
      }
      validateJunctionAgainstWires(changed, junction);
      const result = { ...changed, junctions: [...changed.junctions, junction] };
      return normalizeJunctionCircuits(command.branchWire ? rerouteWireE4(result, command.branchWire.id) : result);
    }
    case "move-junction": {
      const junction = requireJunction(document, command.junctionId);
      let changed: HarnessDesignDocument = { ...document, junctions: document.junctions.map((item) =>
        item.id === junction.id ? { ...item, position: { ...command.position } } : item) };
      for (const wireId of junction.wireIds) changed = rerouteWireE4ThroughJunctions(changed, wireId);
      validateJunctionAgainstWires(changed, changed.junctions.find((item) => item.id === junction.id)!);
      validateWireGroups(changed);
      return changed;
    }
    case "remove-junction": {
      const junction = requireJunction(document, command.junctionId);
      if (document.wires.some((wire) => [wire.from, wire.to].some((endpoint) =>
        isJunctionEndpoint(endpoint) && endpoint.junctionId === junction.id))) {
        throw new Error("Нельзя удалить узел соединения, в котором завершается ветвь.");
      }
      return { ...document, junctions: document.junctions.filter((item) => item.id !== junction.id) };
    }
    case "connect-wire-to-junction": {
      const existingJunction = requireJunction(document, command.junctionId);
      const original = findWire(document, command.wireId);
      const changed = {
        ...document,
        wires: replaceRequired(document.wires, command.wireId, (wire) => ({
          ...wire,
          [command.end]: createJunctionEndpoint(command.junctionId),
        }), "Провод не найден."),
      };
      const result = updateJunctionMembership(changed, command.wireId, original[command.end], createJunctionEndpoint(command.junctionId));
      validateJunctionAgainstWires(result, result.junctions.find((item) => item.id === existingJunction.id)!);
      const routed = rerouteWireE4(result, command.wireId);
      validateWireGroups(routed);
      return normalizeJunctionCircuits(routed);
    }
    case "connect-wire-to-wire": {
      if (command.wireId === command.targetWireId) throw new Error("Провод нельзя подключить к самому себе.");
      const target = findWire(document, command.targetWireId);
      const existingJunction = document.junctions.find((junction) => junction.id === command.junctionId);
      const junctionPosition = existingJunction?.position ?? command.position;
      if (existingJunction && !pointsMatch(existingJunction.position, command.position)) {
        throw new Error("Существующий узел находится в другой точке.");
      }
      if (!wireE4PathContainsPoint(document, target, junctionPosition)) throw new Error("Целевой провод не проходит через точку соединения.");
      const original = findWire(document, command.wireId);
      const changed = {
        ...document,
        wires: replaceRequired(document.wires, command.wireId, (wire) => ({
          ...wire,
          [command.end]: createJunctionEndpoint(command.junctionId),
        }), "Провод не найден."),
      };
      const junction = existingJunction
        ? normalizeJunction({ ...existingJunction, wireIds: [...new Set([...existingJunction.wireIds, command.targetWireId, command.wireId])] })
        : normalizeJunction({ id: command.junctionId, position: command.position, wireIds: [command.targetWireId, command.wireId] });
      const membership = updateJunctionMembership(changed, command.wireId, original[command.end], createJunctionEndpoint(command.junctionId));
      const result = { ...membership, junctions: existingJunction
        ? membership.junctions.map((item) => item.id === junction.id ? junction : item)
        : [...membership.junctions, junction] };
      validateJunctionAgainstWires(result, junction);
      const routed = rerouteWireE4(result, command.wireId);
      validateWireGroups(routed);
      return normalizeJunctionCircuits(routed);
    }
    case "create-diff-pair": {
      const group = normalizeDiffPair(document, command.group);
      if (document.diffPairs.some((item) => item.id === group.id)) throw new Error("Дифференциальная пара с таким ID уже существует.");
      if (document.diffPairs.some((item) => item.wireIds.some((wireId) => group.wireIds.includes(wireId)))) {
        throw new Error("Провод уже входит в другую дифференциальную пару.");
      }
      return { ...document, diffPairs: [...document.diffPairs, group] };
    }
    case "update-diff-pair":
      return {
        ...document,
        diffPairs: replaceRequired(document.diffPairs, command.groupId, (group) => normalizeDiffPair(document, {
          ...group,
          variant: command.variant ?? group.variant,
          step: command.step ?? group.step,
          amplitude: command.amplitude ?? group.amplitude,
        }), "Дифференциальная пара не найдена."),
      };
    case "remove-diff-pair":
      return { ...document, diffPairs: removeRequired(document.diffPairs, command.groupId, "Дифференциальная пара не найдена.") };
    case "create-screen": {
      const screen = normalizeScreen(document, command.screen);
      if (document.screens.some((item) => item.id === screen.id)) throw new Error("Экран с таким ID уже существует.");
      return { ...document, screens: [...document.screens, screen] };
    }
    case "update-screen":
      return {
        ...document,
        screens: replaceRequired(document.screens, command.screenId, (screen) => normalizeScreen(document, {
          ...screen,
          wireIds: command.wireIds ?? screen.wireIds,
          position: command.position ?? screen.position,
          label: command.label ?? screen.label,
          width: command.width ?? screen.width,
        }), "Экран не найден."),
      };
    case "remove-screen":
      return { ...document, screens: removeRequired(document.screens, command.screenId, "Экран не найден.") };
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

function updateConnectorE4Geometry(
  document: HarnessDesignDocument,
  connectorId: string,
  update: (connector: ConnectorInstance) => ConnectorInstance,
): HarnessDesignDocument {
  return rebuildConnectorE4Wires(updateConnector(document, connectorId, update), connectorId);
}

function rebuildConnectorE4Wires(
  document: HarnessDesignDocument,
  connectorId: string,
): HarnessDesignDocument {
  let changed = document;
  const affectedWireIds = document.wires
    .filter((wire) => isConnectorEndpoint(wire.from, connectorId) || isConnectorEndpoint(wire.to, connectorId))
    .map((wire) => wire.id);
  for (const wireId of affectedWireIds) {
    const wire = findWire(changed, wireId);
    const start = wireEndpointE4Anchor(changed, wire.from);
    const end = wireEndpointE4Anchor(changed, wire.to);
    if (!start || !end) throw new Error("Точки подключения маршрута Э4 не найдены.");
    let currentRouteIsValid = true;
    try {
      validateOrthogonalE4Route(start, wire.e4Route, end);
      for (const junction of changed.junctions.filter((item) => item.wireIds.includes(wireId))) {
        validateJunctionAgainstWires(changed, junction);
      }
    } catch {
      currentRouteIsValid = false;
    }
    if (!currentRouteIsValid) changed = rerouteWireE4ThroughJunctions(changed, wireId);
  }
  for (const junction of changed.junctions.filter((item) => item.wireIds.some((wireId) => affectedWireIds.includes(wireId)))) {
    validateJunctionAgainstWires(changed, junction);
  }
  validateWireGroups(changed);
  return changed;
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

function isConnectorEndpoint(endpoint: WireEndpoint, connectorId: string, contactId?: string): boolean {
  return !isJunctionEndpoint(endpoint) && endpoint.connectorId === connectorId &&
    (contactId === undefined || endpoint.contactId === contactId);
}

function findWire(document: HarnessDesignDocument, wireId: string): WireInstance {
  const wire = document.wires.find((item) => item.id === wireId);
  if (!wire) throw new Error("Провод не найден.");
  return wire;
}

function setE4WireRoute(document: HarnessDesignDocument, wireId: string, route: readonly Point[]): HarnessDesignDocument {
  const wire = findWire(document, wireId);
  const start = wireEndpointE4Anchor(document, wire.from);
  const end = wireEndpointE4Anchor(document, wire.to);
  if (!start || !end) throw new Error("Точки подключения маршрута Э4 не найдены.");
  const copy = route.map((point) => ({ ...point }));
  validateOrthogonalE4Route(start, copy, end);
  const changed = { ...document, wires: document.wires.map((item) => item.id === wireId ? { ...item, e4Route: copy } : item) };
  for (const junction of changed.junctions.filter((item) => item.wireIds.includes(wireId))) validateJunctionAgainstWires(changed, junction);
  validateWireGroups(changed);
  return changed;
}

function rerouteWireE4(document: HarnessDesignDocument, wireId: string): HarnessDesignDocument {
  return rerouteWireE4ThroughJunctions(document, wireId);
}

function rerouteWireE4ThroughJunctions(document: HarnessDesignDocument, wireId: string): HarnessDesignDocument {
  const wire = findWire(document, wireId);
  const start = wireEndpointE4Anchor(document, wire.from);
  const end = wireEndpointE4Anchor(document, wire.to);
  if (!start || !end) throw new Error("Точки подключения маршрута Э4 не найдены.");
  const endpointJunctionIds = new Set([wire.from, wire.to].filter(isJunctionEndpoint).map((endpoint) => endpoint.junctionId));
  const waypoints = document.junctions
    .filter((junction) => junction.wireIds.includes(wireId) && !endpointJunctionIds.has(junction.id))
    .map((junction) => ({ position: junction.position, leadDirection: null }));
  const anchors = [start, ...waypoints, end];
  const e4Route: Point[] = [];
  for (let index = 0; index < anchors.length - 1; index += 1) {
    const legStart = anchors[index]!;
    const legEnd = anchors[index + 1]!;
    e4Route.push(...createOrthogonalE4Route(legStart, legEnd));
    if (index < anchors.length - 2) e4Route.push({ ...legEnd.position });
  }
  validateOrthogonalE4Route(start, e4Route, end);
  return { ...document, wires: document.wires.map((item) => item.id === wireId ? { ...item, e4Route } : item) };
}

function normalizeJunction(junction: E4Junction): E4Junction {
  const id = junction.id.trim();
  const wireIds = junction.wireIds.map((wireId) => wireId.trim());
  if (!id || !Number.isFinite(junction.position.x) || !Number.isFinite(junction.position.y)) throw new Error("Узел соединения задан неверно.");
  if (wireIds.length < 2 || wireIds.some((wireId) => !wireId) || new Set(wireIds).size !== wireIds.length) {
    throw new Error("Узел соединения должен объединять не менее двух разных проводов.");
  }
  return { id, position: { ...junction.position }, wireIds };
}

function requireJunction(document: HarnessDesignDocument, junctionId: string): E4Junction {
  const junction = document.junctions.find((item) => item.id === junctionId);
  if (!junction) throw new Error("Узел соединения не найден.");
  return junction;
}

function validateJunctionAgainstWires(document: HarnessDesignDocument, junction: E4Junction): void {
  for (const wireId of junction.wireIds) {
    const wire = findWire(document, wireId);
    const endsAtJunction = [wire.from, wire.to].some((endpoint) => isJunctionEndpoint(endpoint) && endpoint.junctionId === junction.id);
    if (!endsAtJunction && !wireE4PathContainsPoint(document, wire, junction.position)) {
      throw new Error("Линия провода должна проходить через узел соединения.");
    }
  }
}

function addTargetWireToJunction(
  document: HarnessDesignDocument,
  junctionId: string,
  targetWireId: string,
): HarnessDesignDocument {
  const junction = requireJunction(document, junctionId);
  const targetWire = findWire(document, targetWireId);
  if (!wireE4PathContainsPoint(document, targetWire, junction.position)) {
    throw new Error("Целевой провод не проходит через существующий узел соединения.");
  }
  const changed = junction.wireIds.includes(targetWireId) ? document : {
    ...document,
    junctions: document.junctions.map((item) => item.id === junctionId
      ? { ...item, wireIds: [...item.wireIds, targetWireId] }
      : item),
  };
  validateJunctionAgainstWires(changed, changed.junctions.find((item) => item.id === junctionId)!);
  return changed;
}

function pointOnOrthogonalSegment(point: Point, start: Point, end: Point): boolean {
  if (start.x === end.x) return point.x === start.x && point.y >= Math.min(start.y, end.y) && point.y <= Math.max(start.y, end.y);
  if (start.y === end.y) return point.y === start.y && point.x >= Math.min(start.x, end.x) && point.x <= Math.max(start.x, end.x);
  return false;
}

function pointsMatch(left: Point, right: Point): boolean {
  return Math.hypot(left.x - right.x, left.y - right.y) < 0.01;
}

function validateWireGroups(document: HarnessDesignDocument): void {
  for (const group of document.diffPairs) if (!wireGroupHasCommonE4ParallelSpan(document, group.wireIds)) {
    throw new Error("Изменение уберёт общий параллельный участок дифференциальной пары.");
  }
  for (const screen of document.screens) if (!wireGroupHasCommonE4ParallelSpan(document, screen.wireIds)) {
    throw new Error("Изменение уберёт общий параллельный участок проводов экрана.");
  }
}

function normalizeJunctionCircuits(document: HarnessDesignDocument): HarnessDesignDocument {
  const byId = new Map(document.wires.map((wire) => [wire.id, wire]));
  for (const junction of document.junctions) {
    const component = collectJunctionComponent(junction.wireIds, document.junctions);
    const circuits = new Set([...component].map((wireId) => byId.get(wireId)?.circuit).filter((value): value is string => Boolean(value)));
    if (circuits.size > 1) throw new Error("Нельзя соединить провода с разными непустыми обозначениями цепи.");
    const circuit = circuits.values().next().value as string | undefined;
    if (circuit) for (const wireId of component) {
      const wire = byId.get(wireId);
      if (wire && !wire.circuit) byId.set(wireId, { ...wire, circuit });
    }
  }
  return { ...document, wires: document.wires.map((wire) => byId.get(wire.id)!) };
}

function collectJunctionComponent(initial: readonly string[], junctions: readonly E4Junction[]): Set<string> {
  const result = new Set(initial);
  let size = -1;
  while (size !== result.size) {
    size = result.size;
    for (const junction of junctions) if (junction.wireIds.some((wireId) => result.has(wireId))) {
      for (const wireId of junction.wireIds) result.add(wireId);
    }
  }
  return result;
}

function cleanupWireReferences(document: HarnessDesignDocument, removedWireIds: readonly string[]): HarnessDesignDocument {
  const removed = new Set(removedWireIds);
  let junctions = document.junctions;
  let expanded = true;
  while (expanded) {
    expanded = false;
    junctions = junctions.map((junction) => ({ ...junction, wireIds: junction.wireIds.filter((id) => !removed.has(id)) }));
    const collapsedIds = new Set(junctions.filter((junction) => junction.wireIds.length < 2).map((junction) => junction.id));
    for (const wire of document.wires) if (!removed.has(wire.id) && [wire.from, wire.to].some((endpoint) =>
      isJunctionEndpoint(endpoint) && collapsedIds.has(endpoint.junctionId))) {
      removed.add(wire.id);
      expanded = true;
    }
    junctions = junctions.filter((junction) => !collapsedIds.has(junction.id));
  }
  return {
    ...document,
    wires: document.wires.filter((wire) => !removed.has(wire.id)),
    junctions,
    diffPairs: document.diffPairs.filter((group) => !group.wireIds.some((id) => removed.has(id))),
    screens: document.screens.map((screen) => ({ ...screen, wireIds: screen.wireIds.filter((id) => !removed.has(id)) })).filter((screen) => screen.wireIds.length >= 1),
  };
}

function updateJunctionMembership(
  document: HarnessDesignDocument,
  wireId: string,
  previous: WireEndpoint,
  next: WireEndpoint,
): HarnessDesignDocument {
  let junctions = document.junctions;
  if (isJunctionEndpoint(previous) && (!isJunctionEndpoint(next) || previous.junctionId !== next.junctionId)) {
    junctions = junctions.map((junction) => junction.id === previous.junctionId
      ? { ...junction, wireIds: junction.wireIds.filter((id) => id !== wireId) }
      : junction);
    if (junctions.some((junction) => junction.id === previous.junctionId && junction.wireIds.length < 2)) {
      throw new Error("Переподключение оставит прежний узел менее чем с двумя проводами.");
    }
  }
  if (isJunctionEndpoint(next)) {
    junctions = junctions.map((junction) => junction.id === next.junctionId && !junction.wireIds.includes(wireId)
      ? { ...junction, wireIds: [...junction.wireIds, wireId] }
      : junction);
  }
  return { ...document, junctions };
}

function addWireToEndpointJunctions(document: HarnessDesignDocument, wire: WireInstance): HarnessDesignDocument {
  let junctions = document.junctions;
  for (const endpoint of [wire.from, wire.to]) if (isJunctionEndpoint(endpoint)) {
    junctions = junctions.map((junction) => junction.id === endpoint.junctionId && !junction.wireIds.includes(wire.id)
      ? { ...junction, wireIds: [...junction.wireIds, wire.id] }
      : junction);
  }
  return { ...document, junctions };
}

function normalizeDiffPair(document: HarnessDesignDocument, group: DiffPairGroup): DiffPairGroup {
  const id = group.id.trim();
  if (!id || group.wireIds.length !== 2 || group.wireIds[0] === group.wireIds[1]) throw new Error("Дифференциальная пара должна иметь ID и два разных провода.");
  requireWireIds(document, group.wireIds);
  requirePositiveParameter(group.step, "Шаг дифференциальной пары");
  requirePositiveParameter(group.amplitude, "Амплитуда дифференциальной пары");
  const variant = group.variant ?? 1;
  if (variant !== 1 && variant !== 2) throw new Error("Вид дифференциальной пары задан неверно.");
  if (!wireGroupHasCommonE4ParallelSpan(document, group.wireIds)) {
    throw new Error("Выбранные провода не имеют общего параллельного участка для дифференциальной пары.");
  }
  return { id, wireIds: [group.wireIds[0], group.wireIds[1]], step: group.step, amplitude: group.amplitude, variant };
}

function normalizeScreen(document: HarnessDesignDocument, screen: WireScreenGroup): WireScreenGroup {
  const id = screen.id.trim();
  const label = screen.label.trim();
  if (!id || !label || label.length > 120) throw new Error("ID или обозначение экрана задано неверно.");
  if (screen.wireIds.length < 1 || new Set(screen.wireIds).size !== screen.wireIds.length) throw new Error("Экран должен содержать хотя бы один провод без повторов.");
  requireWireIds(document, screen.wireIds);
  if (!Number.isFinite(screen.position) || screen.position < 0 || screen.position > 1) throw new Error("Положение экрана должно быть от 0 до 1.");
  requirePositiveParameter(screen.width, "Ширина экрана");
  if (!wireGroupHasCommonE4ParallelSpan(document, screen.wireIds)) {
    throw new Error("Выбранные провода не имеют общего параллельного участка для экрана.");
  }
  return { id, wireIds: [...screen.wireIds], position: screen.position, label, width: screen.width };
}

function requireWireIds(document: HarnessDesignDocument, wireIds: readonly string[]): void {
  if (wireIds.some((id) => !document.wires.some((wire) => wire.id === id))) throw new Error("Группа ссылается на отсутствующий провод.");
}

function requirePositiveParameter(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} должен быть положительным числом.`);
}

function updateLayers(
  document: HarnessDesignDocument,
  view: EditorView,
  update: (layers: readonly EditorLayer[]) => readonly EditorLayer[],
): HarnessDesignDocument {
  return {
    ...document,
    views: { ...document.views, [view]: { ...document.views[view], layers: update(document.views[view].layers) } },
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

function validateWire(document: HarnessDesignDocument, wire: WireInstance, pendingJunctionId?: string): void {
  if (sameEndpoint(wire.from, wire.to)) {
    throw new Error("Провод должен соединять две разные точки.");
  }
  requireEndpoint(document, wire.from, pendingJunctionId);
  requireEndpoint(document, wire.to, pendingJunctionId);
  requireLength(wire.lengthMm);
}

function requireEndpoint(document: HarnessDesignDocument, endpoint: WireEndpoint, pendingJunctionId?: string): void {
  if (isJunctionEndpoint(endpoint)) {
    if (endpoint.junctionId !== pendingJunctionId && !document.junctions.some((item) => item.id === endpoint.junctionId)) {
      throw new Error("Узел конца провода не найден.");
    }
    return;
  }
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
    isConnectorEndpoint(wire.from, connectorId, contactId) || isConnectorEndpoint(wire.to, connectorId, contactId));
}

function sameEndpoint(left: WireEndpoint, right: WireEndpoint): boolean {
  return isJunctionEndpoint(left)
    ? isJunctionEndpoint(right) && left.junctionId === right.junctionId
    : !isJunctionEndpoint(right) && left.connectorId === right.connectorId && left.contactId === right.contactId;
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
