import { type WireInstance, type CableInstance, type WireMaterialBinding, type WireEndStripProfiles, type WireStripProfileBinding, type WireColorSource, type HarnessDesignDocument, type WireEndpoint } from "./design-types";
import { requireRecord, requireNumber, parsePoint, requireText, requireString, parseNormalizedPosition, requireBoundedText, parseNonEmptyGuid, parseSha256, requireInteger } from "./design-parse-primitives";
import { validateWirePhysicalLength, validateWireCorrection, defaultWireCutRoundingStepMm, validateWireRoundingStep, calculateWireCutLength, parseOuterDiameter, calculateCableSheathStrip, normalizeWireStripProfileLayers } from "./wire-measurements";
import { wireBlankEnds, type WireBlankEnd } from "../WireBlankCatalog";
import { isJunctionEndpoint, isScreenEndpoint, createJunctionEndpoint, createScreenEndpoint } from "./design-e4-geometry";

export function parseWire(value: unknown): WireInstance {
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
  const drawingEndpoints = record.drawingEndpoints === undefined ? undefined : (() => {
    const endpoints = requireRecord(record.drawingEndpoints, "Свободные концы рисунка заданы неверно.");
    return { from: parsePoint(endpoints.from), to: parsePoint(endpoints.to) };
  })();
  const drawingEndStyles = record.drawingEndStyles === undefined ? undefined : (() => {
    const styles = requireRecord(record.drawingEndStyles, "Режимы отображения концов заданы неверно.");
    if (!wireBlankEnds.includes(styles.from as WireBlankEnd) || !wireBlankEnds.includes(styles.to as WireBlankEnd)) {
      throw new Error("Режим отображения конца провода задан неверно.");
    }
    return { from: styles.from as WireBlankEnd, to: styles.to as WireBlankEnd };
  })();
  return {
    id: requireText(record.id, "ID провода"),
    ...(record.wireMark===undefined?{}:{wireMark:requireString(record.wireMark,'Марка провода')}),
    ...(record.wireSection===undefined?{}:{wireSection:requireString(record.wireSection,'Сечение провода')}),
    ...(record.secondaryColor===undefined?{}:{secondaryColor:requireString(record.secondaryColor,'Второй цвет провода')}),
    ...(record.wireDiameterMm===undefined?{}:{wireDiameterMm:parseOuterDiameter(record.wireDiameterMm)}),
    from: parseEndpoint(record.from),
    to: parseEndpoint(record.to),
    circuit: requireString(record.circuit, "Цепь провода"),
    color: requireText(record.color, "Цвет провода"),
    colorSource: record.colorSource === undefined || record.colorSource === null
      ? record.colorSource : parseWireColorSource(record.colorSource),
    materialBinding: record.materialBinding === undefined
      ? undefined : parseWireMaterialBinding(record.materialBinding),
    stripProfiles: record.stripProfiles === undefined
      ? undefined : parseWireEndStripProfiles(record.stripProfiles),
    ...(drawingEndpoints ? { drawingEndpoints } : {}),
    ...(drawingEndStyles ? { drawingEndStyles } : {}),
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
export function parseCables(value: unknown): readonly CableInstance[] {
  if (!Array.isArray(value)) throw new Error("Кабели заданы неверно.");
  return value.map(normalizeCableInstance);
}
/** Validates and copies a physical multicore cable before it enters a document. */
export function normalizeCableInstance(value: unknown): CableInstance {
  const record = requireRecord(value, "Кабель задан неверно.");
  if (!Array.isArray(record.memberWireIds)) throw new Error("Состав жил кабеля задан неверно.");
  const memberWireIds = record.memberWireIds.map((item) => requireText(item, "ID жилы кабеля"));
  if (new Set(memberWireIds).size !== memberWireIds.length) {
    throw new Error("Состав жил кабеля не должен содержать повторяющиеся провода.");
  }
  const materialBinding = record.materialBinding === undefined
    ? undefined
    : parseWireMaterialBinding(record.materialBinding);
  if (materialBinding !== undefined && materialBinding.entityType !== "cable") {
    throw new Error("Материал многожильного кабеля должен иметь тип cable.");
  }
  const lengthMm = record.lengthMm === undefined || record.lengthMm === null
    ? null
    : validateWirePhysicalLength(requireNumber(record.lengthMm, "Длина кабеля"), "Длина кабеля");
  const endCorrectionFromMm = record.endCorrectionFromMm === undefined
    ? 0
    : validateWireCorrection(requireNumber(record.endCorrectionFromMm, "Поправка начала кабеля"), "Поправка начала кабеля");
  const endCorrectionToMm = record.endCorrectionToMm === undefined
    ? 0
    : validateWireCorrection(requireNumber(record.endCorrectionToMm, "Поправка конца кабеля"), "Поправка конца кабеля");
  const cutRoundingStepMm = record.cutRoundingStepMm === undefined
    ? defaultWireCutRoundingStepMm
    : validateWireRoundingStep(requireNumber(record.cutRoundingStepMm, "Шаг округления длины резки кабеля"));
  calculateWireCutLength({ lengthMm, endCorrectionFromMm, endCorrectionToMm, cutRoundingStepMm });
  const sheathRecord = record.sheathStrip === undefined ? undefined : requireRecord(record.sheathStrip, "Снятие оболочки задано неверно.");
  const sheathStrip = sheathRecord === undefined ? undefined : Object.freeze({
    fromMm: sheathRecord.fromMm === null ? null : validateWirePhysicalLength(requireNumber(sheathRecord.fromMm, "Снятие оболочки начала")),
    toMm: sheathRecord.toMm === null ? null : validateWirePhysicalLength(requireNumber(sheathRecord.toMm, "Снятие оболочки конца")),
  });
  const cable = Object.freeze({
    id: requireText(record.id, "ID кабеля"),
    memberWireIds: Object.freeze(memberWireIds),
    materialBinding,
    lengthMm,
    endCorrectionFromMm,
    endCorrectionToMm,
    cutRoundingStepMm,
    ...(sheathStrip === undefined ? {} : { sheathStrip }),
  });
  calculateCableSheathStrip(cable);
  return cable;
}
export function validateCables(cables: readonly CableInstance[], wireIds: ReadonlySet<string>): void {
  if (new Set(cables.map((cable) => cable.id)).size !== cables.length) {
    throw new Error("ID кабелей должны быть уникальны.");
  }
  const assignedWireIds = new Set<string>();
  for (const cable of cables) {
    for (const wireId of cable.memberWireIds) {
      if (!wireIds.has(wireId)) throw new Error("Кабель ссылается на отсутствующий провод.");
      if (assignedWireIds.has(wireId)) throw new Error("Провод может входить только в один кабель.");
      assignedWireIds.add(wireId);
    }
  }
}
export function parseWireMaterialBinding(value: unknown): WireMaterialBinding {
  const record = requireRecord(value, "Привязка материала провода задана неверно.");
  if (record.entityType !== "wire" && record.entityType !== "cable") {
    throw new Error("Тип материала провода задан неверно.");
  }
  return Object.freeze({
    ...(record.outerDiameterMm===undefined?{}:{outerDiameterMm:parseOuterDiameter(record.outerDiameterMm)}),
    ...(record.sectionUnit === undefined ? {} : {
      sectionUnit: record.sectionUnit === "awg" || record.sectionUnit === "mm2"
        ? record.sectionUnit : (() => { throw new Error("Единица сечения материала провода задана неверно."); })(),
    }),
    sourceId: requireBoundedText(record.sourceId, "Источник материала провода", 128),
    snapshotId: parseNonEmptyGuid(record.snapshotId, "ID снимка материала провода"),
    snapshotSha256: parseSha256(record.snapshotSha256, "Хэш снимка материала провода"),
    recordId: parseSha256(record.recordId, "ID записи материала провода"),
    entityType: record.entityType,
    sourceKey: requireBoundedText(record.sourceKey, "Ключ материала провода", 512),
    displayName: requireBoundedText(record.displayName, "Название материала провода", 256),
  });
}
function parseWireEndStripProfiles(value: unknown): WireEndStripProfiles | undefined {
  const record = requireRecord(value, "Профили разделки концов провода заданы неверно.");
  const from = record.from === undefined ? undefined : normalizeWireStripProfileBinding(record.from);
  const to = record.to === undefined ? undefined : normalizeWireStripProfileBinding(record.to);
  return from === undefined && to === undefined ? undefined : Object.freeze({ from, to });
}
/** Validates and snapshots a catalog profile before it is stored in a command result. */
export function normalizeWireStripProfileBinding(value: unknown): WireStripProfileBinding {
  const record = requireRecord(value, "Привязка профиля разделки задана неверно.");
  if (record.entityType !== "coax-termination") {
    throw new Error("Тип профиля разделки задан неверно.");
  }
  if (!Array.isArray(record.layers)) throw new Error("Слои профиля разделки заданы неверно.");
  const layers = normalizeWireStripProfileLayers(record.layers.map((item) => {
    const layer = requireRecord(item, "Слой профиля разделки задан неверно.");
    return {
      index: requireInteger(layer.index, "Номер слоя профиля разделки", 1, Number.MAX_SAFE_INTEGER),
      diameterMm: requireNumber(layer.diameterMm, "Диаметр слоя профиля разделки"),
      stripLengthMm: requireNumber(layer.stripLengthMm, "Длина слоя профиля разделки"),
    };
  }));
  return Object.freeze({
    sourceId: requireBoundedText(record.sourceId, "Источник профиля разделки", 128),
    snapshotId: parseNonEmptyGuid(record.snapshotId, "ID снимка профиля разделки"),
    snapshotSha256: parseSha256(record.snapshotSha256, "Хэш снимка профиля разделки"),
    recordId: parseSha256(record.recordId, "ID записи профиля разделки"),
    entityType: record.entityType,
    sourceKey: requireBoundedText(record.sourceKey, "Ключ профиля разделки", 512),
    displayName: requireBoundedText(record.displayName, "Название профиля разделки", 256),
    layers,
  });
}
function parseWireColorSource(value: unknown): WireColorSource {
  const record = requireRecord(value, "Источник цвета провода задан неверно.");
  return {
    connectorId: requireText(record.connectorId, "Соединитель источника цвета"),
    contactId: requireText(record.contactId, "Контакт источника цвета"),
  };
}
export function normalizeWireColorSource(document: HarnessDesignDocument, wire: WireInstance): WireColorSource | null | undefined {
  if([wire.from,wire.to].some(e=>!e.junctionId&&!e.screenId&&document.wires.filter(w=>[w.from,w.to].some(x=>x.connectorId===e.connectorId&&x.contactId===e.contactId&&!x.junctionId&&!x.screenId)).length>1))return null;
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
