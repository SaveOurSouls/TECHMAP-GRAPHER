import {
  type HarnessDesignDocument,
  type WireInstance,
  type E4Junction,
  type EditorViewState,
  type DiffPairGroup,
  type WireScreenGroup,
} from "./design-types";
import {
  requireRecord,
  requireText,
  requireInteger,
  parsePoint,
  requirePositive,
  requireNumber,
  requireBoundedText,
} from "./design-parse-primitives";
import { parseManufacturingRoute } from "../manufacturing/route-model";
import { parseConnector } from "./design-connector-parser";
import { parseWire, parseCables, validateCables, normalizeWireColorSource } from "./design-wire-parser";
import { parsePhysicalTopology } from "./physical-topology-validation";
import { validateDrawingDocuments } from "./drawing-documents";
import {
  isJunctionEndpoint,
  isScreenEndpoint,
  wireScreenConnectionPoint,
  wireEndpointE4Anchor,
  createOrthogonalE4Route,
  validateE4Polyline,
  wireGroupHasCommonE4ParallelSpan,
  wireGroupHasScreenCrossSection,
  wireE4PathContainsPoint,
} from "./design-e4-geometry";
import { defaultE4WireLead, defaultLayerIds } from "./design-defaults";
import {
  parseTerminationDocument,
  validateTerminationComponents,
  validateTerminationCircuits,
} from "./termination-model";

export function parseHarnessDesignDocument(value: unknown): HarnessDesignDocument {
  const record = requireRecord(value, "Сервер вернул повреждённый документ жгута.");
  if (record.requiredWriterContractVersion !== undefined && ![1,2,3].includes(record.requiredWriterContractVersion as number)) {
    throw new Error("Для этого документа требуется более новая версия приложения.");
  }
  if (record.schemaVersion !== 1 || !Array.isArray(record.connectors) || !Array.isArray(record.wires)) {
    throw new Error("Версия или состав документа жгута не поддерживаются.");
  }
  const wireValues = record.wires;
  const views = requireRecord(record.views, "Представления документа жгута заданы неверно.");
  let document: HarnessDesignDocument = {
    schemaVersion: 1,
    ...([1,2,3].includes(record.requiredWriterContractVersion as number) ? { requiredWriterContractVersion: record.requiredWriterContractVersion as 1|2|3 } : {}),
    ...(record.manufacturingRoute !== undefined ? { manufacturingRoute: parseManufacturingRoute(record.manufacturingRoute) } : {}),
    customWireColors: parseCustomWireColors(record.customWireColors),
    connectors: record.connectors.map(parseConnector),
    wires: wireValues.map(parseWire),
    cables: record.cables === undefined ? [] : parseCables(record.cables),
    junctions: record.junctions === undefined ? [] : parseJunctions(record.junctions),
    diffPairs: record.diffPairs === undefined ? [] : parseDiffPairs(record.diffPairs),
    screens: record.screens === undefined ? [] : parseScreens(record.screens),
    views: { e4: parseView(views.e4, true), drawing: parseView(views.drawing, false) },
  };
  document = {
    ...document,
    customWireColors: normalizeCustomWireColors([
      ...(document.customWireColors ?? []),
      ...document.connectors.flatMap((connector) => connector.contacts
        .flatMap((contact) => [contact.color, contact.secondaryColor ?? ""])),
    ]),
  };
  document = { ...document, physicalTopology: parsePhysicalTopology(record.physicalTopology, document) };
  document = {...document,drawingDocuments:validateDrawingDocuments(record.drawingDocuments,document)};
  const connectorIds = new Set(document.connectors.map((connector) => connector.id));
  if (connectorIds.size !== document.connectors.length) throw new Error("ID соединителей должны быть уникальны.");
  const wireIds = new Set(document.wires.map((wire) => wire.id));
  if (wireIds.size !== document.wires.length) throw new Error("ID проводов должны быть уникальны.");
  validateCables(document.cables, wireIds);
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
        if (!connector?.contacts.some((contact) => contact.id === endpoint.contactId) && !wire.drawingEndpoints) {
          throw new Error("Провод ссылается на отсутствующую точку подключения.");
        }
      }
    }
  }
  document = {
    ...document,
    wires: document.wires.map((wire) => ({
      ...wire,
      ...([wire.from,wire.to].some(e=>document.wires.filter(w=>[w.from,w.to].some(x=>x.connectorId===e.connectorId&&x.contactId===e.contactId&&!x.junctionId&&!x.screenId)).length>1)?(() => {
        const c=[wire.from,wire.to].map(e=>document.connectors.find(c=>c.id===e.connectorId)?.contacts.find(c=>c.id===e.contactId)).find(c=>c?.wire.trim()||c?.wireSection?.trim());
        return {wireMark:wire.wireMark??wire.materialBinding?.displayName??c?.wire??'',wireSection:wire.wireSection??c?.wireSection??'',secondaryColor:wire.secondaryColor??c?.secondaryColor??'',wireDiameterMm:wire.wireDiameterMm??c?.wireDiameterMm};
      })():{}),
      colorSource: normalizeWireColorSource(document, wire),
    })),
  };
  document = {
    ...document,
    wires: document.wires.map((wire, index) => {
      const wireRecord = requireRecord(wireValues[index], "Провод задан неверно.");
      if (wireRecord.e4Route !== undefined || wire.drawingEndpoints) return wire;
      const start = wireEndpointE4Anchor(document, wire.from);
      const end = wireEndpointE4Anchor(document, wire.to);
      if (!start || !end) throw new Error("Точки подключения маршрута Э4 не найдены.");
      return { ...wire, e4Route: createOrthogonalE4Route(start, end), e4RouteMode: "auto" };
    }),
  };
  for (const [index, wireValue] of wireValues.entries()) {
    const wireRecord = requireRecord(wireValue, "Провод задан неверно.");
    const wire = document.wires[index]!;
    if (wireRecord.e4Route !== undefined && !wire.drawingEndpoints) {
      const start = wireEndpointE4Anchor(document, wire.from);
      const end = wireEndpointE4Anchor(document, wire.to);
      if (!start || !end) throw new Error("Точки подключения маршрута Э4 не найдены.");
      const screenBranch = [wire.from, wire.to].some(isScreenEndpoint) && [wire.from, wire.to].some(isJunctionEndpoint);
      validateE4Polyline(start, wire.e4Route, end, screenBranch ? 0 : defaultE4WireLead);
    }
  }
  validateParsedGroups(document, wireIds);
  validateJunctions(document);
  validateJunctionCircuitComponents(document.wires, document.junctions);
  if (record.terminations !== undefined) document = { ...document, terminations: parseTerminationDocument(record.terminations, document) };
  validateTerminationComponents(document);
  if (document.terminations || document.connectors.some(c=>c.terminationComponent) || document.wires.some(w=>w.wireMark!==undefined||w.wireSection!==undefined||w.secondaryColor!==undefined||w.wireDiameterMm!==undefined)) {
    document = {...document,requiredWriterContractVersion:3};
    validateTerminationCircuits(document);
  }
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
  for (const screen of screens) if (!wireGroupHasScreenCrossSection(document, screen.wireIds)) {
    throw new Error("Провода экрана должны иметь общий поперечный охват.");
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
function parseView(value: unknown, isE4 = false): EditorViewState {
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
  // Documents created before M4-93 have no dedicated connection-point layer.
  // Add it on read so physical nodes stay visible above wires and coverings while
  // preserving every user-controlled visibility/lock state of existing layers.
  if (!layers.some((layer) => layer.id === defaultLayerIds.connectionPoints)) {
    const occupiedOrders = new Set(layers.map(layer => layer.order));
    let nextOrder = 10000;
    while (occupiedOrders.has(nextOrder) && nextOrder >= 0) nextOrder--;
    if (nextOrder < 0) throw new Error("Нет свободного порядка для слоя точек соединения.");
    layers.push({ id: defaultLayerIds.connectionPoints, name: "Точки соединения", order: nextOrder, visible: true, locked: false });
  }
  // Material indices and positional designations are annotations, not artwork.
  // Migrate older documents to a dedicated always-on-top layer while retaining
  // every user-controlled visibility/lock state of existing layers.
  if (!layers.some((layer) => layer.id === defaultLayerIds.materialIndexes)) {
    const occupiedOrders = new Set(layers.map(layer => layer.order));
    let nextOrder = 10000;
    while (occupiedOrders.has(nextOrder) && nextOrder >= 0) nextOrder--;
    if (nextOrder < 0) throw new Error("Нет свободного порядка для слоя индексов материалов.");
    layers.push({ id: defaultLayerIds.materialIndexes, name: "Индексы материалов и позиции", order: nextOrder, visible: true, locked: false });
  }
  const wireCrossingStyle = record.wireCrossingStyle === undefined ? "none" : record.wireCrossingStyle;
  if (wireCrossingStyle !== "none" && wireCrossingStyle !== "bridge") {
    throw new Error("Режим пересечения проводов задан неверно.");
  }
  const e4RoutingMode = record.e4RoutingMode === undefined ? "orthogonal" : record.e4RoutingMode;
  if (e4RoutingMode !== "orthogonal" && e4RoutingMode !== "angular") {
    throw new Error("Режим угловой трассировки Э4 задан неверно.");
  }
  return isE4 ? { layers, wireCrossingStyle, e4RoutingMode } : { layers, wireCrossingStyle };
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
