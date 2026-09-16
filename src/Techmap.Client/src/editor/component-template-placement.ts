import {
  createDefaultConnectorBaseColumns,
  defaultLayerIds,
  validateConnectorLibraryMetadata,
  type ComponentTemplateArticleKeySnapshot,
  type ComponentTemplateAssetSnapshot,
  type ComponentTemplateContactRepresentationSnapshot,
  type ComponentTemplateContactSnapshot,
  type ComponentTemplateMaterializedSnapshot,
  type ConnectorContact,
  type ConnectorInstance,
  type Point,
} from "./model";
import {
  materializeArticleContactRowsV3,
  type MaterializedArticleContactRowV3,
} from "../component-library/template-article-contact-rows-v3";
import { materializeE4ConnectorArticle } from "../component-library/e4-connector-series-table";
import {
  reconcileTemplateEnvelopeAssets,
  type TemplateEnvelopeAsset,
} from "../component-library/template-content";
import { validateTemplateContentV3 } from "../component-library/template-model-v3";
import type {
  ArticleKeyV3,
  ArticleVariantV3,
  TemplateContentV3,
} from "../component-library/template-model-v3";
import { validateTemplateContentV4, type TemplateContentV4 } from "../component-library/template-model-v4";

/** The immutable data needed from the component-library response at placement time. */
export interface ComponentTemplatePlacementEnvelopeV3 {
  readonly templateId: string;
  readonly version: number;
  readonly versionSha256: string;
  readonly code: string;
  readonly name: string;
  readonly articleBindings: readonly ArticleKeyV3[];
  readonly assets: readonly TemplateEnvelopeAsset[];
  readonly content: TemplateContentV3 | TemplateContentV4;
}

export type ComponentTemplatePlacementEnvelope = ComponentTemplatePlacementEnvelopeV3;

export interface CreateComponentTemplateConnectorOptions {
  readonly id: string;
  readonly designation: string;
  /** Either the full v3 variant or its stable variant ID. */
  readonly articleVariant?: ArticleVariantV3 | string;
  /** Alias useful to catalog UIs that carry only the selected variant ID. */
  readonly articleVariantId?: string;
  readonly e4Position: Point;
  readonly drawingPosition?: Point;
  readonly layerIds?: Readonly<Partial<Record<"e4" | "drawing", string>>>;
}

/**
 * Materializes one selected v3 article into the editor's established
 * ConnectorInstance shape. Each runtime contact keeps the row key separately
 * from its numeric display number, so repeated template rows remain stable.
 */
export function createConnectorInstanceFromComponentTemplateV3(
  template: ComponentTemplatePlacementEnvelopeV3,
  options: CreateComponentTemplateConnectorOptions,
): ConnectorInstance {
  requireText(template.templateId, "ID шаблона компонента");
  requirePositiveInteger(template.version, "Версия шаблона компонента");
  requireSha256(template.versionSha256, "Хэш версии шаблона компонента");
  const code = requireBoundedText(template.code, "Код шаблона компонента", 120);
  const name = requireBoundedText(template.name, "Название шаблона компонента", 256);
  const content = template.content;
  if (content.schemaVersion !== 3 && content.schemaVersion !== 4)
    throw new Error("Для размещения требуется содержимое шаблона v3 или v4.");
  const validation = content.schemaVersion === 4
    ? validateTemplateContentV4(content)
    : validateTemplateContentV3(content);
  if (!validation.valid) throw new Error(`Шаблон v${content.schemaVersion} не прошёл проверку: ${validation.diagnostics[0]?.message ?? "повреждённое содержимое"}`);
  if (reconcileTemplateEnvelopeAssets(content, template.assets).diagnostics.length > 0) {
    throw new Error("Ресурсы шаблона не совпадают с ресурсами его закрепляемой версии.");
  }
  const id = requireText(options.id, "ID соединителя");
  const selectedVariant = options.articleVariant ?? options.articleVariantId;
  if (selectedVariant === undefined) throw new Error("Вариант артикула компонента не выбран.");
  const variant = selectedArticleVariant(content, selectedVariant);
  const rows = materializePlacementRows(content, variant.id);
  if (rows.length < 1 || rows.length > 300) {
    throw new Error("В выбранном варианте должно быть от 1 до 300 контактов.");
  }
  const article = articleKey(variant);
  const articleBindings = uniqueArticleKeys(template.articleBindings);
  if (!articleBindings.some((candidate) => sameArticleKey(candidate, article))) {
    throw new Error("Выбранный артикул отсутствует в индексе закрепляемой версии шаблона.");
  }
  const assets = template.assets.map(snapshotAsset);
  const contacts = rows.map((row, index) => createContact(row, index + 1, content, id));
  const snapshot: ComponentTemplateMaterializedSnapshot = freezeSnapshot({
    templateId: template.templateId,
    templateVersion: template.version,
    versionSha256: template.versionSha256,
    code,
    name,
    articleVariantId: variant.id,
    article,
    articleBindings,
    assets,
    contacts: rows.map((row) => snapshotContact(row, content)),
  });
  const connector: ConnectorInstance = {
    id,
    designation: requireText(options.designation, "Обозначение соединителя"),
    libraryCode: code,
    partNumber: article.articleKey,
    contacts,
    schematic: {
      orientation: "contacts-right",
      baseColumns: createDefaultConnectorBaseColumns(),
      customFields: [],
    },
    positions: {
      e4: copyPosition(options.e4Position),
      drawing: copyPosition(options.drawingPosition ?? options.e4Position),
    },
    layerIds: {
      e4: options.layerIds?.e4 ?? defaultLayerIds.connectors,
      drawing: options.layerIds?.drawing ?? defaultLayerIds.connectors,
    },
    libraryBinding: Object.freeze({
      mode: "template",
      templateId: template.templateId,
      templateVersion: template.version,
      versionSha256: template.versionSha256,
      articleVariantId: variant.id,
      article: Object.freeze({ ...article }),
      snapshot,
    }),
  };
  validateConnectorLibraryMetadata(connector);
  return connector;
}

/** Schema-neutral placement entry point. The v3 name remains as a compatibility alias. */
export const createConnectorInstanceFromComponentTemplate = createConnectorInstanceFromComponentTemplateV3;

/**
 * Re-materializes another article from the same immutable template version.
 * Editable contact values survive when their stable logical row remains present;
 * a v4 standard terminal initializes newly introduced rows.
 */
export function rematerializeComponentTemplateConnectorArticle(
  connector: ConnectorInstance,
  template: ComponentTemplatePlacementEnvelope,
  articleVariantId: string,
): ConnectorInstance {
  const binding = connector.libraryBinding;
  if (binding?.mode !== "template") throw new Error("Соединитель не привязан к шаблону компонента.");
  if (binding.templateId !== template.templateId || binding.templateVersion !== template.version ||
      binding.versionSha256 !== template.versionSha256) {
    throw new Error("Смена артикула возможна только внутри закреплённой версии шаблона.");
  }
  const materialized = createConnectorInstanceFromComponentTemplateV3(template, {
    id: connector.id,
    designation: connector.designation,
    articleVariantId,
    e4Position: connector.positions.e4,
    drawingPosition: connector.positions.drawing,
    layerIds: connector.layerIds,
  });
  const previous = new Map(connector.contacts.map(contact => [contact.logicalContactId, contact]));
  return {
    ...materialized,
    schematic: connector.schematic,
    contacts: materialized.contacts.map(contact => {
      const old = previous.get(contact.logicalContactId);
      if (!old) return { ...contact, customValues: Object.fromEntries(connector.schematic.customFields.map(field => [field.id, ""])) };
      const terminalAllowed = !old.terminalArticle || materialized.libraryBinding?.mode !== "template" ||
        materialized.libraryBinding.snapshot.contacts.find(item => item.logicalContactId === contact.logicalContactId)
          ?.allowedTerminalArticleKeys.some(item => item.articleKey === old.terminalArticle);
      return {
        ...contact,
        circuit: old.circuit,
        terminalArticle: terminalAllowed ? old.terminalArticle : contact.terminalArticle,
        wire: old.wire,
        color: old.color,
        secondaryColor: old.secondaryColor,
        connectionStatus: old.connectionStatus,
        customValues: { ...old.customValues },
      };
    }),
  };
}

interface PlacementContactRow extends MaterializedArticleContactRowV3 {
  readonly standardTerminalArticleKey: ArticleKeyV3 | null;
}

function asV3Core(content: TemplateContentV3 | TemplateContentV4): TemplateContentV3 {
  if (content.schemaVersion === 3) return content;
  const { e4ConnectorTable: _table, ...core } = content;
  return { ...core, schemaVersion: 3 };
}

function materializePlacementRows(
  content: TemplateContentV3 | TemplateContentV4,
  articleVariantId: string,
): readonly PlacementContactRow[] {
  const coreRows = materializeArticleContactRowsV3(asV3Core(content), articleVariantId);
  if (content.schemaVersion === 3) return coreRows.map(row => ({ ...row, standardTerminalArticleKey: null }));
  const tableArticle = materializeE4ConnectorArticle(content.e4ConnectorTable, articleVariantId);
  if (tableArticle.rows.length !== coreRows.length)
    throw new Error("Таблица Э4 не совпадает с материализованными контактами артикула.");
  const allowedByGroup = new Map(tableArticle.contactGroups.map(group => [
    group.contactTypeGroupId,
    group.allowedTerminalArticleKeys,
  ]));
  return coreRows.map((core, index) => {
    const table = tableArticle.rows[index]!;
    const allowed = table.contactTypeGroupId === null ? [] : allowedByGroup.get(table.contactTypeGroupId) ?? [];
    return {
      ...core,
      key: table.seriesRowId,
      contactTypeGroupId: table.contactTypeGroupId,
      number: table.number,
      name: table.name,
      circuitText: table.circuitText,
      allowedTerminalArticleKeys: allowed,
      standardTerminalArticleKey: table.standardTerminalArticleKey,
    };
  });
}

function selectedArticleVariant(
  content: TemplateContentV3 | TemplateContentV4,
  selected: ArticleVariantV3 | string,
): ArticleVariantV3 {
  const id = typeof selected === "string" ? selected : selected.id;
  const variant = content.articleVariants.find((candidate) => candidate.id === id);
  if (!variant) throw new Error(`Вариант артикула ${id} отсутствует в шаблоне.`);
  return variant;
}

function articleKey(variant: ArticleKeyV3): ComponentTemplateArticleKeySnapshot {
  return Object.freeze({
    sourceId: requireBoundedText(variant.sourceId, "Источник артикула", 128),
    entityType: requireBoundedText(variant.entityType, "Тип артикула", 64),
    articleKey: requireBoundedText(variant.articleKey, "Ключ артикула", 512),
  });
}

function uniqueArticleKeys(values: readonly ArticleKeyV3[]): readonly ComponentTemplateArticleKeySnapshot[] {
  const result: ComponentTemplateArticleKeySnapshot[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = articleKey(value);
    const key = `${normalized.sourceId}\0${normalized.entityType}\0${normalized.articleKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return Object.freeze(result);
}

function sameArticleKey(left: ArticleKeyV3, right: ArticleKeyV3): boolean {
  return left.sourceId === right.sourceId && left.entityType === right.entityType &&
    left.articleKey === right.articleKey;
}

function snapshotAsset(asset: TemplateEnvelopeAsset): ComponentTemplateAssetSnapshot {
  return Object.freeze({
    assetId: requireText(asset.assetId, "ID ресурса шаблона"),
    sha256: requireSha256(asset.sha256, "Хэш ресурса шаблона"),
    sizeBytes: requireInteger(asset.sizeBytes, "Размер ресурса шаблона", 0, 10 * 1024 * 1024),
    fileName: requireBoundedText(asset.fileName, "Имя ресурса шаблона", 255),
    mediaType: requireBoundedText(asset.mediaType, "Тип ресурса шаблона", 120),
  });
}

function createContact(
  row: PlacementContactRow,
  number: number,
  content: TemplateContentV3 | TemplateContentV4,
  connectorId: string,
): ConnectorContact {
  const group = row.contactTypeGroupId === null
    ? null
    : content.contactTypeGroups.find((candidate) => candidate.id === row.contactTypeGroupId);
  return {
    id: `${connectorId}:contact:${row.key}`,
    logicalContactId: row.key,
    number,
    contactType: group?.name ?? "",
    circuit: row.circuitText ?? "",
    terminalArticle: row.standardTerminalArticleKey?.articleKey ?? "",
    wire: "",
    color: "",
    secondaryColor: "",
    connectionStatus: "available",
    customValues: {},
    libraryContact: null,
  };
}

function snapshotContact(
  row: PlacementContactRow,
  content: TemplateContentV3 | TemplateContentV4,
): ComponentTemplateContactSnapshot {
  const group = row.contactTypeGroupId === null
    ? null
    : content.contactTypeGroups.find((candidate) => candidate.id === row.contactTypeGroupId);
  return Object.freeze({
    logicalContactId: row.key,
    prototypeLogicalContactId: row.prototypeLogicalContactId,
    sourceNumber: row.number,
    name: row.name,
    circuitText: row.circuitText,
    contactTypeGroupId: row.contactTypeGroupId,
    contactType: group?.name ?? "",
    allowedTerminalArticleKeys: uniqueArticleKeys(row.allowedTerminalArticleKeys),
    representations: Object.freeze(row.representations.map((representation): ComponentTemplateContactRepresentationSnapshot =>
      Object.freeze({ ...representation }))),
  });
}

function freezeSnapshot(snapshot: ComponentTemplateMaterializedSnapshot): ComponentTemplateMaterializedSnapshot {
  Object.freeze(snapshot.article);
  Object.freeze(snapshot.articleBindings);
  Object.freeze(snapshot.assets);
  for (const contact of snapshot.contacts) {
    Object.freeze(contact.allowedTerminalArticleKeys);
    Object.freeze(contact.representations);
    Object.freeze(contact);
  }
  Object.freeze(snapshot.contacts);
  return Object.freeze(snapshot);
}

function requireText(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 1024) throw new Error(`${name} задано неверно.`);
  return value;
}

function copyPosition(position: Point): Point {
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) throw new Error("Положение соединителя задано неверно.");
  return { x: position.x, y: position.y };
}

function requireBoundedText(value: unknown, name: string, maximum: number): string {
  const result = requireText(value, name);
  if (result.length > maximum) throw new Error(`${name} задано неверно.`);
  return result;
}

function requirePositiveInteger(value: unknown, name: string): number {
  return requireInteger(value, name, 1, 1_000_000);
}

function requireInteger(value: unknown, name: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) throw new Error(`${name} задано неверно.`);
  return Number(value);
}

function requireSha256(value: unknown, name: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) throw new Error(`${name} задан неверно.`);
  return value;
}
