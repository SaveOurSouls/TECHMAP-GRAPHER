import {
  type ConnectorInstance,
  type ConnectorDrawingPlacement,
  type ConnectorLibraryContactKind,
  type ConnectorLibraryBinding,
  type ConnectorTerminalCatalog,
  type ComponentTemplateArticleKeySnapshot,
  type ComponentTemplateMaterializedSnapshot,
  type ComponentTemplateAssetSnapshot,
  type ComponentTemplateContactSnapshot,
  type ComponentTemplateContactRepresentationSnapshot,
  type ConnectorLibraryContact,
  type ConnectorSchematicPresentation,
  type ConnectorBaseColumn,
  type ConnectorBaseColumnKey,
  type ConnectorCustomField,
  type ConnectorContactStatus,
  type ConnectorContact,
} from "./design-types";
import {
  requireRecord,
  requireText,
  requireString,
  requireInteger,
  optionalString,
  requireBoundedText,
  parsePoint,
  parseSha256,
  requireNumber,
} from "./design-parse-primitives";
import { parseOuterDiameter, optionalCorrection } from "./wire-measurements";
import { parseWireMaterialBinding } from "./design-wire-parser";
import { parseTerminationComponent } from "./termination-model";
import { restoreTemplateContactNumbers, templateContactNumbers } from "./template-contact-numbering";
import { materializedContactWorldRepresentation } from "./materialized-contact-representation";
import {
  connectorE4TableGeometry,
  templateTerminalChoices,
  createDefaultConnectorBaseColumns,
  connectorBaseColumnKeys,
} from "./connector-presentation";
import { validDrawingScale } from "./drawing-scale";

export function parseConnector(value: unknown): ConnectorInstance {
  const record = requireRecord(value, "Соединитель задан неверно.");
  if (!Array.isArray(record.contacts)) throw new Error("Контакты соединителя заданы неверно.");
  const positions = requireRecord(record.positions, "Координаты соединителя заданы неверно.");
  const layerIds = requireRecord(record.layerIds, "Слои соединителя заданы неверно.");
  const parsedContacts = record.contacts.map((contactValue) => {
    const contact = requireRecord(contactValue, "Контакт соединителя задан неверно.");
    return {
      id: requireText(contact.id, "ID контакта"),
      ...(contact.nameOverride === undefined ? {} : { nameOverride: requireString(contact.nameOverride, "Назначение контакта") }),
      logicalContactId: contact.logicalContactId === undefined
        ? undefined
        : requireText(contact.logicalContactId, "Логический ID контакта"),
      number: requireInteger(contact.number, "Номер контакта", 1, 300),
      contactType: optionalString(contact.contactType, "Тип контакта"),
      circuit: requireString(contact.circuit, "Цепь контакта"),
      terminalArticle: optionalString(contact.terminalArticle, "Артикул терминала"),
      ...(contact.terminalDetails === undefined ? {} : { terminalDetails: parseTerminalDetails(contact.terminalDetails) }),
      wire: optionalString(contact.wire, "Провод контакта"),
      ...(contact.wireDiameterMm === undefined ? {} : {wireDiameterMm:parseOuterDiameter(contact.wireDiameterMm)}),
      ...(contact.wireSection === undefined ? {} : { wireSection: optionalString(contact.wireSection, "Сечение провода") }),
      ...(contact.materialBinding === undefined ? {} : { materialBinding: parseWireMaterialBinding(contact.materialBinding) }),
      color: optionalString(contact.color, "Цвет провода контакта"),
      secondaryColor: optionalString(contact.secondaryColor, "Второй цвет провода контакта"),
      ...(contact.colorMode === undefined ? {} : { colorMode: parseContactColorMode(contact.colorMode) }),
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
  if (schematic.rowOrder?.some(id => !contacts.some(contact => contact.id === id))) {
    throw new Error("Порядок строк ссылается на отсутствующий контакт.");
  }
  const customFieldIds = new Set(schematic.customFields.map((field) => field.id));
  for (const contact of contacts) {
    if (Object.keys(contact.customValues).some((fieldId) => !customFieldIds.has(fieldId))) {
      throw new Error("Значение контакта ссылается на отсутствующее справочное поле.");
    }
  }
  let connector: ConnectorInstance = {
    ...(record.terminationComponent === undefined ? {} : {terminationComponent:parseTerminationComponent(record.terminationComponent)}),
    ...(record.drawingPlacements === undefined ? {} : {drawingPlacements: parseDrawingPlacements(record.drawingPlacements)}),
    ...(record.e4TableMode === true ? { e4TableMode: true } : {}),
    ...(record.terminalCatalog === undefined ? {} : { terminalCatalog: parseConnectorTerminalCatalog(record.terminalCatalog) }),
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
  connector = restoreTemplateContactNumbers(connector);
  validateConnectorLibraryMetadata(connector);
  // Expanding an older table must keep its contact anchors in place, otherwise
  // persisted manual routes can become invalid before the editor even opens.
  const rawSchematic = record.schematic === undefined ? null : requireRecord(record.schematic, "Настройки таблицы заданы неверно.");
  const oldColumns = rawSchematic?.baseColumns;
  const hasSectionColumn = Array.isArray(oldColumns) && oldColumns.some(column => column.key === "wireSection");
  if (!hasSectionColumn && schematic.orientation === "contacts-right" &&
      connector.contacts.every(contact => !materializedContactWorldRepresentation(connector, contact.id, "e4"))) {
    const oldWidth = connectorE4TableGeometry({ ...connector, schematic: { ...schematic,
      baseColumns: schematic.baseColumns.filter(column => column.key !== "wireSection") } }).width;
    const shift = connectorE4TableGeometry(connector).width - oldWidth;
    if (shift) return { ...connector, positions: { ...connector.positions, e4: { ...connector.positions.e4, x: connector.positions.e4.x - shift } } };
  }
  return connector;
}
export function parseDrawingPlacements(value:unknown):ConnectorDrawingPlacement[] {
  if(!Array.isArray(value) || value.length>2000) throw new Error("Некорректный список рисунков компонента.");
  const result=value.map(item=>{
    const record=requireRecord(item,"Некорректный рисунок.");
    if(typeof record.visible!=="boolean") throw new Error("Некорректная видимость рисунка.");
    if(record.rotationDegrees!==undefined && (typeof record.rotationDegrees!=="number" || !Number.isFinite(record.rotationDegrees)||Math.abs(record.rotationDegrees)>360))throw new Error("Некорректный угол рисунка.");
    if(record.scale!==undefined && (typeof record.scale!=="number" || !validDrawingScale(record.scale))) throw new Error("Масштаб рисунка: 5–2000%.");
    return {drawingId:requireText(record.drawingId,"ID рисунка"),visible:record.visible,offset:parsePoint(record.offset),...(record.scale===undefined?{}:{scale:record.scale as number}),...(record.rotationDegrees===undefined?{}:{rotationDegrees:record.rotationDegrees as number})};
  });
  if(new Set(result.map(p=>p.drawingId)).size!==result.length) throw new Error("Повторный ID рисунка.");
  return result;
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
    if (record.contactNumbering !== undefined && record.contactNumbering !== "source-v1")
      throw new Error("Неизвестная версия нумерации контактов шаблона. Обновите приложение.");
    const binding = {
      mode: "template" as const,
      ...(record.contactNumbering === "source-v1" ? {contactNumbering: "source-v1" as const} : {}),
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
  if (connector.terminalCatalog && connector.terminalCatalog.templateId !== binding.templateId) {
    throw new Error("Список терминалов принадлежит другому шаблону.");
  }
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
  if (binding.contactNumbering !== undefined && binding.contactNumbering !== "source-v1")
    throw new Error("Неизвестная версия нумерации контактов шаблона.");
  const sourceByLogicalId = new Map(binding.snapshot.contacts.map(contact => [contact.logicalContactId, contact]));
  if (sourceByLogicalId.size !== binding.snapshot.contacts.length)
    throw new Error("Логические ID материализованных контактов должны быть уникальны.");
  const numbers = binding.contactNumbering === "source-v1"
    ? templateContactNumbers(binding.snapshot.contacts.map(contact => contact.sourceNumber))
    : connector.contacts.map((_, index) => index + 1);
  connector.contacts.forEach((contact, index) => {
    const snapshotContact = sourceByLogicalId.get(contact.logicalContactId!);
    if (!contact.logicalContactId || logicalIds.has(contact.logicalContactId) ||
        !snapshotContact ||
        contact.id !== `${connector.id}:contact:${contact.logicalContactId}` ||
        contact.number !== (binding.contactNumbering === "source-v1" ? Number(snapshotContact.sourceNumber) : numbers[index]) || contact.libraryContact !== null) {
      throw new Error("Контакты не соответствуют закреплённой материализации шаблона.");
    }
    logicalIds.add(contact.logicalContactId);
    if (contact.terminalArticle && !templateTerminalChoices(connector, contact.logicalContactId).includes(contact.terminalArticle)) {
      throw new Error("Терминал контакта не входит в список совместимых терминалов закреплённого шаблона.");
    }
  });
}
function parseConnectorTerminalCatalog(value: unknown): ConnectorTerminalCatalog {
  const record = requireRecord(value, "Список терминалов задан неверно.");
  const byContact = requireRecord(record.byContact, "Контакты списка терминалов заданы неверно.");
  return {
    templateId: requireText(record.templateId, "ID шаблона терминалов"),
    version: requireInteger(record.version, "Версия списка терминалов", 1, 1_000_000),
    versionSha256: parseSha256(record.versionSha256, "Хэш списка терминалов"),
    byContact: Object.fromEntries(Object.entries(byContact).map(([key, values]) => {
      if (!Array.isArray(values) || values.length > 256) throw new Error("Список терминалов контакта задан неверно.");
      return [key, [...new Set(values.map(value => requireBoundedText(value, "Артикул терминала", 512)))]];
    })),
  };
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
export function parseConnectorSchematic(value: unknown): ConnectorSchematicPresentation {
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
  if (record.showName !== undefined && typeof record.showName !== "boolean") throw new Error("Видимость назначения задана неверно.");
  if (record.rowOrder !== undefined && (!Array.isArray(record.rowOrder) ||
      record.rowOrder.some(id => typeof id !== "string" || !id.trim()) ||
      new Set(record.rowOrder).size !== record.rowOrder.length)) {
    throw new Error("Порядок строк контактов задан неверно.");
  }
  return { orientation, baseColumns, customFields,
    ...(record.rowOrder === undefined ? {} : { rowOrder: record.rowOrder as string[] }),
    ...(record.showName === undefined ? {} : { showName: record.showName as boolean }) };
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
  return connectorBaseColumnKeys.map((key) => byKey.get(key) ?? { key, visible: key === "wireSection" ? byKey.get("wire")?.visible ?? true : true });
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
function parseContactColorMode(value: unknown): "auto" | "manual" {
  if (value === "auto" || value === "manual") return value;
  throw new Error("Режим цвета контакта задан неверно.");
}
function parseTerminalDetails(value: unknown): NonNullable<ConnectorContact["terminalDetails"]> {
  const record = requireRecord(value, "Данные терминала заданы неверно.");
  return {
    manufacturer: requireString(record.manufacturer, "Производитель терминала"),
    series: requireString(record.series, "Серия терминала"),
    description: requireString(record.description, "Описание терминала"),
    ...(record.article === undefined ? {} : { article: requireString(record.article, "Артикул терминала") }),
    ...(record.lengthPlusMm === undefined ? {} : { lengthPlusMm: optionalCorrection(record.lengthPlusMm, "L+") }),
    ...(record.lengthMinusMm === undefined ? {} : { lengthMinusMm: optionalCorrection(record.lengthMinusMm, "L-") }),
  };
}
