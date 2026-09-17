import {
  createE4ConnectorSeriesTableFromV3,
  projectE4ConnectorSeriesTableV2ToV1,
  upgradeE4ConnectorSeriesTableV1ToV2,
  type E4ConnectorSeriesTableV2,
} from "./e4-connector-series-table";
import {
  validateTemplateContentV3Structure,
  type ArticleKeyV3,
  type ArticleParameterValueV3,
  type TemplateContentV3,
  type TemplateV3Diagnostic,
} from "./template-model-v3";
import {
  validateTemplateContentV4,
  type TemplateContentV4,
} from "./template-model-v4";

export interface ArticleContactGroupV5 {
  readonly contactTypeGroupId: string;
  readonly contactCount: number;
}

export interface ArticleVariantV5 extends ArticleKeyV3 {
  readonly id: string;
  readonly parameterValues: ArticleParameterValueV3[];
  readonly contactGroups: ArticleContactGroupV5[];
}

export interface TemplateContentV5 extends Omit<TemplateContentV3, "schemaVersion" | "articleVariants"> {
  readonly schemaVersion: 5;
  readonly compatibleTerminalArticleKeys: ArticleKeyV3[];
  readonly articleVariants: ArticleVariantV5[];
  readonly e4ConnectorTable: E4ConnectorSeriesTableV2;
}

export interface TemplateV5Validation {
  readonly valid: boolean;
  readonly diagnostics: readonly TemplateV3Diagnostic[];
}

export interface TemplateV5Upgrade {
  readonly content: TemplateContentV5;
  readonly diagnostics: readonly TemplateV3Diagnostic[];
}

const ROOT_KEYS = [
  "schemaVersion", "views", "logicalContacts", "parameters", "repeaters", "assets",
  "contactTypeGroups", "compatibleTerminalArticleKeys", "articleVariants", "e4ConnectorTable",
] as const;
const ARTICLE_GROUP_KEYS = ["contactTypeGroupId", "contactCount"] as const;
const TABLE_KEYS = ["modelVersion", "columns", "contactTypeGroups", "seriesDefaults", "articles"] as const;
const TABLE_ARTICLE_KEYS = ["articleVariantId", "sourceId", "entityType", "articleKey", "contactGroups", "rows"] as const;
const ARTICLE_KEY_KEYS = ["sourceId", "entityType", "articleKey"] as const;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;
const TERMINAL_LIMIT = 256;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const hasOwn = (value: object, key: PropertyKey) => Object.prototype.hasOwnProperty.call(value, key);
const identity = (value: ArticleKeyV3): string => `${value.sourceId}\0${value.entityType}\0${value.articleKey}`;

function error(code: string, path: string, message: string): TemplateV3Diagnostic {
  return { code, path, message };
}

function exact(
  value: unknown,
  keys: readonly string[],
  path: string,
  diagnostics: TemplateV3Diagnostic[],
): value is Record<string, unknown> {
  if (!isRecord(value)) {
    diagnostics.push(error("object_required", path, "Ожидается объект."));
    return false;
  }
  const expected = new Set(keys);
  for (const key of Object.keys(value))
    if (!expected.has(key)) diagnostics.push(error("unexpected_key", `${path}.${key}`, "Неизвестное поле."));
  for (const key of keys)
    if (!hasOwn(value, key)) diagnostics.push(error("missing_key", `${path}.${key}`, "Обязательное поле отсутствует."));
  return Object.keys(value).length === keys.length && keys.every(key => hasOwn(value, key));
}

function validText(value: unknown, maximum: number): value is string {
  return typeof value === "string" && Boolean(value.trim()) && value.length <= maximum && !CONTROL_CHARACTERS.test(value);
}

function validateTerminalKeys(value: unknown, diagnostics: TemplateV3Diagnostic[]): readonly ArticleKeyV3[] | null {
  const path = "$.compatibleTerminalArticleKeys";
  if (!Array.isArray(value)) {
    diagnostics.push(error("array_required", path, "Ожидается массив."));
    return null;
  }
  if (value.length > TERMINAL_LIMIT)
    diagnostics.push(error("limit", path, `Превышен лимит ${TERMINAL_LIMIT}.`));
  const result: ArticleKeyV3[] = [], identities = new Set<string>();
  value.forEach((candidate, index) => {
    const itemPath = `${path}[${index}]`;
    if (!exact(candidate, ARTICLE_KEY_KEYS, itemPath, diagnostics)) return;
    const valid = validText(candidate.sourceId, 128) && validText(candidate.entityType, 64) && validText(candidate.articleKey, 512);
    if (!valid) {
      diagnostics.push(error("invalid_article_key", itemPath, "Источник, тип и артикул терминала должны быть заполнены."));
      return;
    }
    const key: ArticleKeyV3 = {
      sourceId: candidate.sourceId as string,
      entityType: candidate.entityType as string,
      articleKey: candidate.articleKey as string,
    };
    const keyIdentity = identity(key);
    if (identities.has(keyIdentity))
      diagnostics.push(error("duplicate_terminal_article", itemPath, "Совместимый терминал повторяется в серии."));
    else identities.add(keyIdentity);
    result.push(key);
  });
  return result;
}

function validateSelectedTerminals(
  table: unknown,
  terminals: readonly ArticleKeyV3[],
  diagnostics: TemplateV3Diagnostic[],
): void {
  if (!isRecord(table)) return;
  const compatible = new Set(terminals.map(identity));
  const validateValue = (value: unknown, path: string) => {
    if (value === null || value === undefined) return;
    if (!exact(value, ARTICLE_KEY_KEYS, path, diagnostics)) return;
    if (!validText(value.sourceId, 128) || !validText(value.entityType, 64) || !validText(value.articleKey, 512)) {
      diagnostics.push(error("invalid_article_key", path, "Источник, тип и артикул терминала должны быть заполнены."));
      return;
    }
    const key = value as unknown as ArticleKeyV3;
    if (!compatible.has(identity(key)))
      diagnostics.push(error("incompatible_standard_terminal", path, "Терминал строки отсутствует в списке совместимых терминалов серии."));
  };
  if (Array.isArray(table.seriesDefaults)) table.seriesDefaults.forEach((row, index) => {
    if (isRecord(row) && isRecord(row.values))
      validateValue(row.values.standardTerminalArticleKey, `$.e4ConnectorTable.seriesDefaults[${index}].values.standardTerminalArticleKey`);
  });
  if (Array.isArray(table.articles)) table.articles.forEach((article, articleIndex) => {
    if (!isRecord(article) || !Array.isArray(article.rows)) return;
    article.rows.forEach((row, rowIndex) => {
      if (isRecord(row) && isRecord(row.overrides) && hasOwn(row.overrides, "standardTerminalArticleKey"))
        validateValue(row.overrides.standardTerminalArticleKey, `$.e4ConnectorTable.articles[${articleIndex}].rows[${rowIndex}].overrides.standardTerminalArticleKey`);
    });
  });
}

function validateV5Shapes(value: Record<string, unknown>, diagnostics: TemplateV3Diagnostic[]): boolean {
  let exactShapes = exact(value, ROOT_KEYS, "$", diagnostics);
  if (!Array.isArray(value.articleVariants)) {
    diagnostics.push(error("array_required", "$.articleVariants", "Ожидается массив."));
    exactShapes = false;
  } else value.articleVariants.forEach((variant, articleIndex) => {
    if (!isRecord(variant)) return;
    if (!Array.isArray(variant.contactGroups)) {
      diagnostics.push(error("array_required", `$.articleVariants[${articleIndex}].contactGroups`, "Ожидается массив."));
      exactShapes = false;
      return;
    }
    variant.contactGroups.forEach((group, groupIndex) => {
      if (!exact(group, ARTICLE_GROUP_KEYS, `$.articleVariants[${articleIndex}].contactGroups[${groupIndex}]`, diagnostics))
        exactShapes = false;
    });
  });
  if (!exact(value.e4ConnectorTable, TABLE_KEYS, "$.e4ConnectorTable", diagnostics)) return false;
  if (value.e4ConnectorTable.modelVersion !== 2) {
    diagnostics.push(error("model_version", "$.e4ConnectorTable.modelVersion", "Поддерживается modelVersion 2."));
    exactShapes = false;
  }
  if (!Array.isArray(value.e4ConnectorTable.articles)) return false;
  value.e4ConnectorTable.articles.forEach((article, articleIndex) => {
    const articlePath = `$.e4ConnectorTable.articles[${articleIndex}]`;
    if (!exact(article, TABLE_ARTICLE_KEYS, articlePath, diagnostics)) { exactShapes = false; return; }
    if (!Array.isArray(article.contactGroups)) return;
    article.contactGroups.forEach((group, groupIndex) => {
      if (!exact(group, ARTICLE_GROUP_KEYS, `${articlePath}.contactGroups[${groupIndex}]`, diagnostics)) exactShapes = false;
    });
  });
  return exactShapes;
}

/** Builds a transient v4 document so the mature geometry/table checks stay shared. */
function projectV5ToV4(value: Record<string, unknown>, terminals: readonly ArticleKeyV3[]): unknown {
  const projected = structuredClone(value);
  projected.schemaVersion = 4;
  delete projected.compatibleTerminalArticleKeys;
  const configuredArticleIds = new Set<string>();
  if (Array.isArray(projected.articleVariants)) for (const variant of projected.articleVariants) {
    if (!isRecord(variant) || !Array.isArray(variant.contactGroups)) continue;
    if (typeof variant.id === "string") configuredArticleIds.add(variant.id);
    for (const group of variant.contactGroups)
      if (isRecord(group)) group.allowedTerminalArticleKeys = structuredClone(terminals);
  }
  if (isRecord(projected.e4ConnectorTable)) {
    projected.e4ConnectorTable.modelVersion = 1;
    if (Array.isArray(projected.e4ConnectorTable.articles)) for (const article of projected.e4ConnectorTable.articles) {
      if (!isRecord(article) || !Array.isArray(article.contactGroups)) continue;
      const projectedTerminals = typeof article.articleVariantId === "string" && configuredArticleIds.has(article.articleVariantId)
        ? terminals : [];
      for (const group of article.contactGroups)
        if (isRecord(group)) group.allowedTerminalArticleKeys = structuredClone(projectedTerminals);
    }
  }
  return projected;
}

export function validateTemplateContentV5(value: unknown): TemplateV5Validation {
  if (!isRecord(value)) return { valid: false, diagnostics: [error("object_required", "$", "Содержимое шаблона v5 должно быть объектом.")] };
  const diagnostics: TemplateV3Diagnostic[] = [];
  const exactShapes = validateV5Shapes(value, diagnostics);
  if (value.schemaVersion !== 5)
    diagnostics.push(error("schema_version", "$.schemaVersion", "Поддерживается schemaVersion 5."));
  const terminals = validateTerminalKeys(value.compatibleTerminalArticleKeys, diagnostics);
  if (terminals !== null) validateSelectedTerminals(value.e4ConnectorTable, terminals, diagnostics);
  if (exactShapes && terminals !== null) {
    const projected = projectV5ToV4(value, terminals);
    const legacyValidation = validateTemplateContentV4(projected);
    diagnostics.push(...legacyValidation.diagnostics.filter(item =>
      !("severity" in item) || item.severity === "error").map(item => ({
      code: item.code,
      path: item.path,
      message: item.message,
    })));
  }
  return { valid: diagnostics.length === 0, diagnostics };
}

export function isTemplateContentV5(value: unknown): value is TemplateContentV5 {
  return isRecord(value) && value.schemaVersion === 5 && validateTemplateContentV5(value).valid;
}

function compatibleTerminalsFromV4(content: TemplateContentV4): ArticleKeyV3[] {
  const result: ArticleKeyV3[] = [], seen = new Set<string>();
  for (const variant of content.articleVariants) for (const group of variant.contactGroups ?? []) {
    for (const terminal of group.allowedTerminalArticleKeys) {
      const key = identity(terminal);
      if (!seen.has(key)) {
        seen.add(key);
        result.push({ ...terminal });
      }
    }
  }
  return result;
}

export function upgradeTemplateContentV4ToV5(content: TemplateContentV4): TemplateV5Upgrade {
  const validation = validateTemplateContentV4(content);
  if (!validation.valid) throw new Error(validation.diagnostics[0]?.message ?? "Некорректный шаблон v4.");
  const compatibleTerminalArticleKeys = compatibleTerminalsFromV4(content);
  const tableGroups = new Map(content.e4ConnectorTable.articles.map(article => [article.articleVariantId, article.contactGroups]));
  const articleVariants: ArticleVariantV5[] = content.articleVariants.map(variant => ({
    id: variant.id,
    sourceId: variant.sourceId,
    entityType: variant.entityType,
    articleKey: variant.articleKey,
    parameterValues: variant.parameterValues.map(value => ({ ...value })),
    contactGroups: (tableGroups.get(variant.id) ?? []).map(group => ({
      contactTypeGroupId: group.contactTypeGroupId,
      contactCount: group.contactCount,
    })),
  }));
  const { schemaVersion: _schemaVersion, articleVariants: _articleVariants, e4ConnectorTable: oldTable, ...core } = content;
  const result: TemplateContentV5 = {
    ...structuredClone(core),
    schemaVersion: 5,
    compatibleTerminalArticleKeys,
    articleVariants,
    e4ConnectorTable: upgradeE4ConnectorSeriesTableV1ToV2(oldTable),
  };
  const upgradedValidation = validateTemplateContentV5(result);
  if (!upgradedValidation.valid)
    throw new Error(upgradedValidation.diagnostics[0]
      ? `${upgradedValidation.diagnostics[0].path}: ${upgradedValidation.diagnostics[0].message}`
      : "Не удалось подготовить шаблон v5.");
  return { content: result, diagnostics: upgradedValidation.diagnostics };
}

export function upgradeTemplateContentV3ToV5(content: TemplateContentV3): TemplateV5Upgrade {
  const validation = validateTemplateContentV3Structure(content);
  if (!validation.valid) throw new Error(validation.diagnostics[0]?.message ?? "Некорректный шаблон v3.");
  const v4: TemplateContentV4 = {
    ...structuredClone(content),
    schemaVersion: 4,
    e4ConnectorTable: createE4ConnectorSeriesTableFromV3(content),
  };
  return upgradeTemplateContentV4ToV5(v4);
}

export function createTemplateContentV5FromEditor(
  content: TemplateContentV3,
  table: TemplateContentV4["e4ConnectorTable"],
  compatibleTerminalArticleKeys: readonly ArticleKeyV3[],
): TemplateV5Upgrade {
  const coreValidation = validateTemplateContentV3Structure(content);
  if (!coreValidation.valid) throw new Error(coreValidation.diagnostics[0]?.message ?? "Некорректный шаблон редактора.");
  const tableGroups = new Map(table.articles.map(article => [article.articleVariantId, article.contactGroups]));
  const articleVariants: ArticleVariantV5[] = content.articleVariants.map(variant => ({
    id: variant.id,
    sourceId: variant.sourceId,
    entityType: variant.entityType,
    articleKey: variant.articleKey,
    parameterValues: variant.parameterValues.map(value => ({ ...value })),
    contactGroups: (tableGroups.get(variant.id) ?? []).map(group => ({
      contactTypeGroupId: group.contactTypeGroupId,
      contactCount: group.contactCount,
    })),
  }));
  const { schemaVersion: _schemaVersion, articleVariants: _articleVariants, ...core } = content;
  const result: TemplateContentV5 = {
    ...structuredClone(core),
    schemaVersion: 5,
    compatibleTerminalArticleKeys: compatibleTerminalArticleKeys.map(item => ({ ...item })),
    articleVariants,
    e4ConnectorTable: upgradeE4ConnectorSeriesTableV1ToV2(table),
  };
  const validation = validateTemplateContentV5(result);
  if (!validation.valid) throw new Error(validation.diagnostics[0]?.message ?? "Не удалось подготовить шаблон v5.");
  return { content: result, diagnostics: validation.diagnostics };
}

/** Projects v5 into the existing reusable v3 editor core. */
export function projectTemplateContentV5ToV3(content: TemplateContentV5): TemplateContentV3 {
  const { schemaVersion: _schemaVersion, compatibleTerminalArticleKeys, e4ConnectorTable: _table, ...core } = content;
  return {
    ...structuredClone(core),
    schemaVersion: 3,
    articleVariants: content.articleVariants.map(variant => ({
      ...structuredClone(variant),
      contactGroups: variant.contactGroups.map(group => ({
        ...group,
        allowedTerminalArticleKeys: compatibleTerminalArticleKeys.map(terminal => ({ ...terminal })),
      })),
    })),
  };
}

export function projectTemplateContentV5TableToV1(content: TemplateContentV5) {
  return projectE4ConnectorSeriesTableV2ToV1(content.e4ConnectorTable, content.compatibleTerminalArticleKeys);
}
