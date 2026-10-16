import {
  type HarnessDesignDocument,
  type WireInstance,
  type WireEndpoint,
  isJunctionEndpoint,
  isScreenEndpoint,
  type WireMaterialBinding,
  type ConnectorContact,
  type ConnectorInstance,
  type EditorLayer,
  type ConnectorCustomField,
  type ConnectorContactStatus,
  templateTerminalChoices,
  type E4Junction,
  wireE4PathContainsPoint,
  type Point,
  wireGroupHasCommonE4ParallelSpan,
  wireGroupHasScreenCrossSection,
  type CableInstance,
  type DiffPairGroup,
  type WireScreenGroup,
  type EditorView,
  calculateWireCutLength,
  wireEndpointE4Anchor,
} from "./model";
import { type EditorCommand } from "./editor-command-types";
import { resolveWireColorHex } from "./wire-reference-catalog";
import { connectedTerminationWireIds } from "./termination-model";

export function isFreeDrawingEnd(document: HarnessDesignDocument, wire: WireInstance, end: "from" | "to"): boolean {
  if (!wire.drawingEndpoints) return false;
  const endpoint = end === "from" ? wire.from : wire.to;
  return !document.connectors.some(connector => connector.id === endpoint.connectorId);
}
export function assertNoLockedDrawingWires(document: HarnessDesignDocument, wires: readonly WireInstance[]): void {
  const locked = wires.some(wire => document.views.drawing.layers.some(layer => layer.id === wire.layerIds.drawing && layer.locked));
  if (locked) throw new Error("Слой выбранного провода заблокирован.");
}
export function assertEditableFreeDrawingEnd(document: HarnessDesignDocument, wire: WireInstance, end: "from" | "to"): void {
  if (!isFreeDrawingEnd(document, wire, end)) throw new Error("Изменить можно только свободный конец независимого провода.");
  assertNoLockedDrawingWires(document, [wire]);
}
export function contactWireCount(document:HarnessDesignDocument,connectorId:string,contactId:string):number {
  return document.wires.filter(w=>[w.from,w.to].some(e=>sameConnectorEndpoint(e,connectorId,contactId))).length;
}
/** Capture legacy contact defaults before a second conductor makes them ambiguous. */
export function snapshotSharedWireProperties(document:HarnessDesignDocument,command:EditorCommand):HarnessDesignDocument {
  const extra=command.type==='add-wire'?[command.wire.from,command.wire.to]:command.type==='reconnect-wire'?[command.endpoint]:[];
  const key=(e:WireEndpoint)=>JSON.stringify([e.connectorId,e.contactId]);
  const counts=new Map<string,number>();
  for(const w of document.wires)for(const e of [w.from,w.to])if(!isJunctionEndpoint(e)&&!isScreenEndpoint(e))counts.set(key(e),(counts.get(key(e))??0)+1);
  const shared=(e:WireEndpoint)=>!isJunctionEndpoint(e)&&!isScreenEndpoint(e)&&((counts.get(key(e))??0)>1||extra.some(x=>sameEndpoint(x,e)&&(counts.get(key(e))??0)>0));
  let changed=false;
  const wires=document.wires.map(w=>{
    if(![w.from,w.to].some(shared))return w;
    const c=contactAtEndpoint(document,w.from)??contactAtEndpoint(document,w.to);
    changed=true;
    return {...w,wireMark:w.wireMark??w.materialBinding?.displayName??c?.wire??'',wireSection:w.wireSection??c?.wireSection??'',secondaryColor:w.secondaryColor??c?.secondaryColor??'',wireDiameterMm:w.wireDiameterMm??c?.wireDiameterMm,colorSource:null};
  });
  return changed?{...document,wires}:document;
}
export function syncDirectWireColors(
  document: HarnessDesignDocument,
  connectorId: string,
  contactId: string,
): HarnessDesignDocument {
  if(contactWireCount(document,connectorId,contactId)>1)return document;
  const contact = document.connectors.find((connector) => connector.id === connectorId)
    ?.contacts.find((candidate) => candidate.id === contactId);
  if (!contact) return document;
  const color = resolveWireColorHex(contact.color);
  let changed = false;
  let connectors = document.connectors;
  const wires = document.wires.map((wire) => {
    if (wire.colorSource === null || isJunctionEndpoint(wire.from) || isScreenEndpoint(wire.from) ||
        isJunctionEndpoint(wire.to) || isScreenEndpoint(wire.to) ||
        ![wire.from, wire.to].some((endpoint) => isConnectorEndpoint(endpoint, connectorId, contactId))) return wire;
    const opposite = sameConnectorEndpoint(wire.from, connectorId, contactId) ? wire.to : wire.from;
    const oppositeContact = contactAtEndpoint({ ...document, connectors }, opposite);
    if (oppositeContact && contactWireCount(document,opposite.connectorId,opposite.contactId)<=1 && contactColorIsAutomatic(oppositeContact)) {
      connectors = updateContactColor(connectors, opposite, contact.color, contact.secondaryColor ?? "", "auto");
    }
    changed = true;
    return { ...wire, color, colorSource: { connectorId, contactId } };
  });
  return changed ? { ...document, connectors, wires } : document;
}
/** Keep the two contact rows and their direct conductor on one material. */
export function syncContactWireMaterial(
  document: HarnessDesignDocument,
  connectorId: string,
  contactId: string,
  materialOverride?: WireMaterialBinding,
): HarnessDesignDocument {
  if(contactWireCount(document,connectorId,contactId)>1)return document;
  const source = contactAtEndpoint(document, { connectorId, contactId });
  if (!source) return document;
  if (!document.wires.some(wire => [wire.from, wire.to].some(endpoint =>
    sameConnectorEndpoint(endpoint, connectorId, contactId)))) return document;
  const material = materialOverride ?? source.materialBinding;
  let connectors = document.connectors;
  const wires = document.wires.map(wire => {
    if (![wire.from, wire.to].some(endpoint => sameConnectorEndpoint(endpoint, connectorId, contactId))) return wire;
    const opposite = sameConnectorEndpoint(wire.from, connectorId, contactId) ? wire.to : wire.from;
    if (!isJunctionEndpoint(opposite) && !isScreenEndpoint(opposite) && contactWireCount(document,opposite.connectorId,opposite.contactId)<=1) {
      connectors = connectors.map(connector => connector.id !== opposite.connectorId ? connector : {
        ...connector,
        contacts: connector.contacts.map(contact => contact.id !== opposite.contactId ? contact : {
          ...contact, wire: source.wire, wireSection: source.wireSection,
          wireDiameterMm: source.wireDiameterMm, materialBinding: material,
        }),
      });
    }
    return { ...wire, materialBinding: material };
  });
  return { ...document, connectors, wires };
}
export function resetContactColorToAutomatic(
  document: HarnessDesignDocument,
  connectorId: string,
  contactId: string,
): HarnessDesignDocument {
  const endpoint = { connectorId, contactId } as const;
  if (!contactAtEndpoint(document, endpoint)) throw new Error("Контакт не найден.");
  const directWire = document.wires.find((wire) =>
    !isJunctionEndpoint(wire.from) && !isScreenEndpoint(wire.from) &&
    !isJunctionEndpoint(wire.to) && !isScreenEndpoint(wire.to) &&
    (sameConnectorEndpoint(wire.from, connectorId, contactId) || sameConnectorEndpoint(wire.to, connectorId, contactId)));
  if (!directWire) {
    return { ...document, connectors: updateContactColor(document.connectors, endpoint, "", "", "auto") };
  }
  const opposite = sameConnectorEndpoint(directWire.from, connectorId, contactId) ? directWire.to : directWire.from;
  const source = contactAtEndpoint(document, opposite);
  if (!source || isJunctionEndpoint(opposite) || isScreenEndpoint(opposite)) {
    return { ...document, connectors: updateContactColor(document.connectors, endpoint, "", "", "auto") };
  }
  return {
    ...document,
    connectors: updateContactColor(document.connectors, endpoint, source.color, source.secondaryColor ?? "", "auto"),
    wires: directWire.colorSource === null ? document.wires : document.wires.map((wire) => wire.id === directWire.id ? {
      ...wire,
      color: resolveWireColorHex(source.color),
      colorSource: { connectorId: opposite.connectorId, contactId: opposite.contactId },
    } : wire),
  };
}
function contactColorIsAutomatic(contact: ConnectorContact): boolean {
  return contact.colorMode === "auto" ||
    contact.colorMode === undefined && !contact.color.trim() && !(contact.secondaryColor ?? "").trim();
}
export function contactAtEndpoint(document: HarnessDesignDocument, endpoint: WireEndpoint): ConnectorContact | null {
  if (isJunctionEndpoint(endpoint) || isScreenEndpoint(endpoint)) return null;
  return document.connectors.find((connector) => connector.id === endpoint.connectorId)
    ?.contacts.find((contact) => contact.id === endpoint.contactId) ?? null;
}
export function sameConnectorEndpoint(endpoint: WireEndpoint, connectorId: string, contactId: string): boolean {
  return !isJunctionEndpoint(endpoint) && !isScreenEndpoint(endpoint) &&
    endpoint.connectorId === connectorId && endpoint.contactId === contactId;
}
function updateContactColor(
  connectors: readonly ConnectorInstance[],
  endpoint: WireEndpoint,
  color: string,
  secondaryColor: string,
  colorMode: "auto" | "manual",
): readonly ConnectorInstance[] {
  if (isJunctionEndpoint(endpoint) || isScreenEndpoint(endpoint)) return connectors;
  return connectors.map((connector) => connector.id !== endpoint.connectorId ? connector : {
    ...connector,
    contacts: connector.contacts.map((contact) => contact.id !== endpoint.contactId ? contact : {
      ...contact, color, secondaryColor, colorMode,
    }),
  });
}
export function rememberCustomWireColors(
  document: HarnessDesignDocument,
  values: readonly string[],
): HarnessDesignDocument {
  const colors = [...new Set([
    ...(document.customWireColors ?? []),
    ...values.flatMap((value) => {
      const normalized = value.trim().toUpperCase();
      return /^#[0-9A-F]{6}$/.test(normalized) ? [normalized] : [];
    }),
  ])];
  return colors.length === (document.customWireColors?.length ?? 0) &&
    colors.every((value, index) => value === document.customWireColors?.[index])
    ? document
    : { ...document, customWireColors: colors };
}
export function validateLayers(layers: readonly EditorLayer[]): void {
  if (layers.length < 1 || new Set(layers.map((layer) => layer.id)).size !== layers.length ||
      new Set(layers.map((layer) => layer.order)).size !== layers.length) {
    throw new Error("Слои должны иметь уникальные ID и порядок.");
  }
}
export function updateConnector(
  document: HarnessDesignDocument,
  connectorId: string,
  update: (connector: ConnectorInstance) => ConnectorInstance,
): HarnessDesignDocument {
  return {
    ...document,
    connectors: replaceRequired(document.connectors, connectorId, update, "Соединитель не найден."),
  };
}
export function normalizeContact(
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
    ...(contact.wireSection === undefined ? {} : { wireSection: normalizeValue(contact.wireSection, "Сечение провода") }),
    ...(contact.materialBinding === undefined ? {} : { materialBinding: contact.materialBinding }),
    color: normalizeValue(contact.color, "Цвет провода контакта"),
    secondaryColor: normalizeValue(contact.secondaryColor ?? "", "Второй цвет провода контакта"),
    colorMode: contact.colorMode === "auto" || contact.colorMode === "manual"
      ? contact.colorMode
      : contact.color.trim() || (contact.secondaryColor ?? "").trim() ? "manual" : "auto",
    customValues: normalizeCustomValues(contact.customValues, customFields),
  };
}
export function normalizeCustomField(field: ConnectorCustomField): ConnectorCustomField {
  const id = field.id.trim();
  const label = field.label.trim();
  if (!id || id.length > 1024) throw new Error("ID справочного поля задан неверно.");
  if (!label || label.length > 120) throw new Error("Название справочного поля задано неверно.");
  if (typeof field.visible !== "boolean") throw new Error("Видимость справочного поля задана неверно.");
  return { id, label, visible: field.visible };
}
export function normalizeCustomValues(
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
export function validateUniqueContacts(contacts: readonly ConnectorContact[]): void {
  if (new Set(contacts.map((contact) => contact.id)).size !== contacts.length ||
      new Set(contacts.map((contact) => contact.number)).size !== contacts.length) {
    throw new Error("Контакты соединителя должны иметь уникальные ID и номера.");
  }
}
export function requireContactNumber(number: number): void {
  if (!Number.isSafeInteger(number) || number < 1 || number > 300) {
    throw new Error("Номер контакта должен быть от 1 до 300.");
  }
}
export function requireContactStatus(status: ConnectorContactStatus): void {
  if (status !== "available" && status !== "not-connected") {
    throw new Error("Статус подключения контакта задан неверно.");
  }
}
export function normalizeValue(value: string, name: string): string {
  if (typeof value !== "string" || value.length > 1024) throw new Error(`${name} задано неверно.`);
  return value.trim();
}
export function requireConnectorText(value: string, emptyMessage: string): void {
  if (!value) throw new Error(emptyMessage);
  if (value.length > 120) throw new Error("Значение соединителя не должно быть длиннее 120 символов.");
}
export function requirePartNumberText(value: string, emptyMessage: string): void {
  if (!value) throw new Error(emptyMessage);
  if (value.length > 512) throw new Error("Артикул соединителя не должен быть длиннее 512 символов.");
}
export function normalizeTemplateTerminalArticle(
  connector: ConnectorInstance,
  contact: ConnectorContact,
  value: string,
): string {
  if (connector.libraryBinding?.mode !== "template" || !value) return value;
  const allowed = templateTerminalChoices(connector, contact.logicalContactId);
  if (!allowed.includes(value)) {
    throw new Error("Артикул терминала не входит в список совместимых терминалов закреплённого шаблона.");
  }
  return value;
}
export function isConnectorEndpoint(endpoint: WireEndpoint, connectorId: string, contactId?: string): boolean {
  return !isJunctionEndpoint(endpoint) && !isScreenEndpoint(endpoint) && endpoint.connectorId === connectorId &&
    (contactId === undefined || endpoint.contactId === contactId);
}
export function findWire(document: HarnessDesignDocument, wireId: string): WireInstance {
  const wire = document.wires.find((item) => item.id === wireId);
  if (!wire) throw new Error("Провод не найден.");
  return wire;
}
export function normalizeJunction(junction: E4Junction): E4Junction {
  const id = junction.id.trim();
  const wireIds = junction.wireIds.map((wireId) => wireId.trim());
  if (!id || !Number.isFinite(junction.position.x) || !Number.isFinite(junction.position.y)) throw new Error("Узел соединения задан неверно.");
  if (wireIds.length < 2 || wireIds.some((wireId) => !wireId) || new Set(wireIds).size !== wireIds.length) {
    throw new Error("Узел соединения должен объединять не менее двух разных проводов.");
  }
  return { id, position: { ...junction.position }, wireIds };
}
export function requireJunction(document: HarnessDesignDocument, junctionId: string): E4Junction {
  const junction = document.junctions.find((item) => item.id === junctionId);
  if (!junction) throw new Error("Узел соединения не найден.");
  return junction;
}
export function validateJunctionAgainstWires(document: HarnessDesignDocument, junction: E4Junction): void {
  for (const wireId of junction.wireIds) {
    const wire = findWire(document, wireId);
    const endsAtJunction = [wire.from, wire.to].some((endpoint) => isJunctionEndpoint(endpoint) && endpoint.junctionId === junction.id);
    if (!endsAtJunction && !wireE4PathContainsPoint(document, wire, junction.position)) {
      throw new Error("Линия провода должна проходить через узел соединения.");
    }
  }
}
export function pointOnOrthogonalSegment(point: Point, start: Point, end: Point): boolean {
  if (start.x === end.x) return point.x === start.x && point.y >= Math.min(start.y, end.y) && point.y <= Math.max(start.y, end.y);
  if (start.y === end.y) return point.y === start.y && point.x >= Math.min(start.x, end.x) && point.x <= Math.max(start.x, end.x);
  return false;
}
export function pointsMatch(left: Point, right: Point): boolean {
  return Math.hypot(left.x - right.x, left.y - right.y) < 0.01;
}
export function validateWireGroups(document: HarnessDesignDocument): void {
  for (const group of document.diffPairs) if (!wireGroupHasCommonE4ParallelSpan(document, group.wireIds)) {
    throw new Error("Изменение уберёт общий параллельный участок дифференциальной пары.");
  }
  for (const screen of document.screens) if (!wireGroupHasScreenCrossSection(document, screen.wireIds)) {
    throw new Error("Изменение уберёт общий поперечный охват проводов экрана.");
  }
}
export function normalizeJunctionCircuits(document: HarnessDesignDocument): HarnessDesignDocument {
  const byId = new Map(document.wires.map((wire) => [wire.id, wire]));
  for (const junction of document.junctions) {
    const component = collectConductiveComponent(junction.wireIds, document);
    const circuits = new Set([...component].map((wireId) => byId.get(wireId)?.circuit).filter((value): value is string => Boolean(value)));
    if (circuits.size > 1) throw new Error("Нельзя соединить провода с разными непустыми обозначениями цепи.");
    const circuit = circuits.values().next().value as string | undefined;
    if (circuit) for (const wireId of component) {
      const wire = byId.get(wireId);
      if (wire && !wire.circuit) byId.set(wireId, { ...wire, circuit });
    }
  }
  for (const screen of document.screens) {
    const attached = document.wires.filter((wire) => [wire.from, wire.to].some((endpoint) =>
      isScreenEndpoint(endpoint) && endpoint.screenId === screen.id)).map((wire) => wire.id);
    if (attached.length === 0) continue;
    const component = collectConductiveComponent(attached, document);
    const circuits = new Set([...component].map((wireId) => byId.get(wireId)?.circuit).filter((value): value is string => Boolean(value)));
    if (circuits.size > 1) throw new Error("Нельзя соединить с экраном провода с разными непустыми обозначениями цепи.");
    const circuit = circuits.values().next().value as string | undefined;
    if (circuit) for (const wireId of component) {
      const wire = byId.get(wireId);
      if (wire && !wire.circuit) byId.set(wireId, { ...wire, circuit });
    }
  }
  return { ...document, wires: document.wires.map((wire) => byId.get(wire.id)!) };
}
function collectConductiveComponent(initial: readonly string[], document: HarnessDesignDocument): Set<string> {
  if(document.terminations||document.connectors.some(c=>c.terminationComponent))return connectedTerminationWireIds(document,initial);
  const result = collectJunctionComponent(initial, document.junctions);
  let size = -1;
  while (size !== result.size) {
    size = result.size;
    const screenIds = new Set(document.wires.filter((wire) => result.has(wire.id)).flatMap((wire) =>
      [wire.from, wire.to].flatMap((endpoint) => isScreenEndpoint(endpoint) ? [endpoint.screenId] : [])));
    const attached = document.wires.filter((wire) => [wire.from, wire.to].some((endpoint) =>
      isScreenEndpoint(endpoint) && screenIds.has(endpoint.screenId))).map((wire) => wire.id);
    for (const wireId of collectJunctionComponent(attached, document.junctions)) result.add(wireId);
  }
  return result;
}
export function collectJunctionComponent(initial: readonly string[], junctions: readonly E4Junction[]): Set<string> {
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
export function cleanupWireReferences(document: HarnessDesignDocument, removedWireIds: readonly string[]): HarnessDesignDocument {
  const removed = new Set(removedWireIds);
  let junctions = document.junctions;
  let screens = document.screens;
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
    screens = screens.map((screen) => ({ ...screen, wireIds: screen.wireIds.filter((id) => !removed.has(id)) }));
    const emptyScreenIds = new Set(screens.filter((screen) => screen.wireIds.length === 0).map((screen) => screen.id));
    for (const wire of document.wires) if (!removed.has(wire.id) && [wire.from, wire.to].some((endpoint) =>
      isScreenEndpoint(endpoint) && emptyScreenIds.has(endpoint.screenId))) {
      removed.add(wire.id);
      expanded = true;
    }
    screens = screens.filter((screen) => !emptyScreenIds.has(screen.id));
  }
  return {
    ...document,
    wires: document.wires.filter((wire) => !removed.has(wire.id)),
    cables: document.cables.map((cable) => ({
      ...cable,
      memberWireIds: cable.memberWireIds.filter((wireId) => !removed.has(wireId)),
    })),
    junctions,
    diffPairs: document.diffPairs.filter((group) => !group.wireIds.some((id) => removed.has(id))),
    screens,
  };
}
export function validateCableMembership(
  document: HarnessDesignDocument,
  cable: CableInstance,
  replacingCableId?: string,
): void {
  const wireIds = new Set(document.wires.map((wire) => wire.id));
  if (cable.memberWireIds.some((wireId) => !wireIds.has(wireId))) {
    throw new Error("Кабель ссылается на отсутствующий провод.");
  }
  const occupiedWireIds = new Set(document.cables
    .filter((item) => item.id !== replacingCableId)
    .flatMap((item) => item.memberWireIds));
  if (cable.memberWireIds.some((wireId) => occupiedWireIds.has(wireId))) {
    throw new Error("Провод может входить только в один кабель.");
  }
}
export function updateJunctionMembership(
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
export function addWireToEndpointJunctions(document: HarnessDesignDocument, wire: WireInstance): HarnessDesignDocument {
  let junctions = document.junctions;
  for (const endpoint of [wire.from, wire.to]) if (isJunctionEndpoint(endpoint)) {
    junctions = junctions.map((junction) => junction.id === endpoint.junctionId && !junction.wireIds.includes(wire.id)
      ? { ...junction, wireIds: [...junction.wireIds, wire.id] }
      : junction);
  }
  return { ...document, junctions };
}
export function normalizeDiffPair(document: HarnessDesignDocument, group: DiffPairGroup): DiffPairGroup {
  const id = group.id.trim();
  if (!id || group.wireIds.length !== 2 || group.wireIds[0] === group.wireIds[1]) throw new Error("Дифференциальная пара должна иметь ID и два разных провода.");
  requireWireIds(document, group.wireIds);
  const detachedWires = document.wires.filter(wire => group.wireIds.includes(wire.id) && wire.drawingEndpoints);
  if (detachedWires.length) assertNoLockedDrawingWires(document, detachedWires);
  requirePositiveParameter(group.step, "Шаг дифференциальной пары");
  requirePositiveParameter(group.amplitude, "Амплитуда дифференциальной пары");
  const variant = group.variant ?? 1;
  if (variant !== 1 && variant !== 2) throw new Error("Вид дифференциальной пары задан неверно.");
  if (!wireGroupHasCommonE4ParallelSpan(document, group.wireIds)) {
    throw new Error("Выбранные провода не имеют общего параллельного участка для дифференциальной пары.");
  }
  return { id, wireIds: [group.wireIds[0], group.wireIds[1]], step: group.step, amplitude: group.amplitude, variant };
}
export function normalizeScreen(document: HarnessDesignDocument, screen: WireScreenGroup): WireScreenGroup {
  const id = screen.id.trim();
  const label = screen.label.trim();
  if (!id || !label || label.length > 120) throw new Error("ID или обозначение экрана задано неверно.");
  if (screen.wireIds.length < 1 || new Set(screen.wireIds).size !== screen.wireIds.length) throw new Error("Экран должен содержать хотя бы один провод без повторов.");
  requireWireIds(document, screen.wireIds);
  if (screen.wireIds.some((wireId) => {
    const wire = document.wires.find((item) => item.id === wireId);
    return wire && [wire.from, wire.to].some((endpoint) => isScreenEndpoint(endpoint) && endpoint.screenId === id);
  })) throw new Error("Провод, подключённый к экрану, не может одновременно входить в его охват.");
  if (!Number.isFinite(screen.position) || screen.position < 0 || screen.position > 1) throw new Error("Положение экрана должно быть от 0 до 1.");
  requirePositiveParameter(screen.width, "Ширина экрана");
  const terminalSide = screen.terminalSide ?? "above";
  if (terminalSide !== "above" && terminalSide !== "below" && terminalSide !== "both") {
    throw new Error("Сторона вывода экрана задана неверно.");
  }
  if (!wireGroupHasScreenCrossSection(document, screen.wireIds)) {
    throw new Error("Выбранные провода не имеют общего поперечного охвата для экрана.");
  }
  return { id, wireIds: [...screen.wireIds], position: screen.position, label, width: screen.width, terminalSide };
}
export function requireWireIds(document: HarnessDesignDocument, wireIds: readonly string[]): void {
  if (wireIds.some((id) => !document.wires.some((wire) => wire.id === id))) throw new Error("Группа ссылается на отсутствующий провод.");
}
export function requirePositiveParameter(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} должен быть положительным числом.`);
}
export function updateLayers(
  document: HarnessDesignDocument,
  view: EditorView,
  update: (layers: readonly EditorLayer[]) => readonly EditorLayer[],
): HarnessDesignDocument {
  return {
    ...document,
    views: { ...document.views, [view]: { ...document.views[view], layers: update(document.views[view].layers) } },
  };
}
export function moveLayer(layers: readonly EditorLayer[], layerId: string, direction: -1 | 1): readonly EditorLayer[] {
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
export function validateWire(document: HarnessDesignDocument, wire: WireInstance, pendingJunctionId?: string): void {
  if (sameEndpoint(wire.from, wire.to)) {
    throw new Error("Провод должен соединять две разные точки.");
  }
  requireEndpoint(document, wire.from, pendingJunctionId);
  requireEndpoint(document, wire.to, pendingJunctionId);
  calculateWireCutLength(wire);
}
export function requireEndpoint(document: HarnessDesignDocument, endpoint: WireEndpoint, pendingJunctionId?: string): void {
  if (isJunctionEndpoint(endpoint)) {
    if (endpoint.junctionId !== pendingJunctionId && !document.junctions.some((item) => item.id === endpoint.junctionId)) {
      throw new Error("Узел конца провода не найден.");
    }
    return;
  }
  if (isScreenEndpoint(endpoint)) {
    if (!document.screens.some((screen) => screen.id === endpoint.screenId) ||
        !wireEndpointE4Anchor(document, endpoint)) {
      throw new Error("Точка подключения экрана не найдена.");
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
export function isContactConnected(document: HarnessDesignDocument, connectorId: string, contactId: string): boolean {
  return document.wires.some((wire) =>
    isConnectorEndpoint(wire.from, connectorId, contactId) || isConnectorEndpoint(wire.to, connectorId, contactId));
}
export function sameEndpoint(left: WireEndpoint, right: WireEndpoint): boolean {
  if (isJunctionEndpoint(left)) return isJunctionEndpoint(right) && left.junctionId === right.junctionId;
  if (isScreenEndpoint(left)) return isScreenEndpoint(right) && left.screenId === right.screenId &&
    (left.screenTerminalSide ?? "above") === (right.screenTerminalSide ?? "above");
  return !isJunctionEndpoint(right) && !isScreenEndpoint(right) &&
    left.connectorId === right.connectorId && left.contactId === right.contactId;
}
export function replaceRequired<T extends { readonly id: string }>(
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
export function removeRequired<T extends { readonly id: string }>(items: readonly T[], id: string, message: string): readonly T[] {
  if (!items.some((item) => item.id === id)) throw new Error(message);
  return items.filter((item) => item.id !== id);
}
export function snapE4AngularBend(points: readonly Point[], index: number, target: Point, insert: boolean): Point {
  const previous=points[index]!,next=points[index+(insert?1:2)]!;
  const directions=Array.from({length:12},(_,sector)=>({x:Math.cos(sector*Math.PI/6),y:Math.sin(sector*Math.PI/6)}));
  const candidates:Point[]=[];
  for(const from of directions)for(const to of directions){
    const determinant=from.x*to.y-from.y*to.x;
    if(Math.abs(determinant)<1e-8)continue;
    const dx=next.x-previous.x,dy=next.y-previous.y;
    const distanceFrom=(dx*to.y-dy*to.x)/determinant;
    const distanceTo=(dx*from.y-dy*from.x)/determinant;
    if(distanceFrom<1e-5||distanceTo> -1e-5)continue;
    candidates.push({x:previous.x+from.x*distanceFrom,y:previous.y+from.y*distanceFrom});
  }
  return candidates.sort((left,right)=>Math.hypot(left.x-target.x,left.y-target.y)-Math.hypot(right.x-target.x,right.y-target.y))[0]??target;
}
