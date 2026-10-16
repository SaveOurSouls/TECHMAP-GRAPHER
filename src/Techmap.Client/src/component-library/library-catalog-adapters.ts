import { type ArticleBinding } from "./component-template-api";
import { type ReferenceCatalogSearchRequest, type ReferenceCatalogSearchRecord, ReferenceCatalogApiError, type ReferenceCatalogApi } from "../reference-catalog-api";
import { CONNECTOR_ARTICLE_ENTITY_V3, type NewArticleVariantV3Input, CONNECTOR_REFERENCE_SOURCE_V3, TERMINAL_ARTICLE_ENTITY_V3, TERMINAL_REFERENCE_SOURCE_V3 } from "./TemplateSeriesPanelV3";

export const articleIdentity = (value: Pick<ArticleBinding, "sourceId" | "entityType" | "articleKey">) =>
  `${value.sourceId}\0${value.entityType}\0${value.articleKey}`;
export function connectorArticleSearchRequest(query: string): ReferenceCatalogSearchRequest {
  return {
    text: query.trim() || null,
    exactSourceKey: null,
    entityTypes: [CONNECTOR_ARTICLE_ENTITY_V3],
    filters: [],
    filterLogic: "all",
    sort: "relevance",
    pageSize: 30,
    cursor: null,
  };
}
export function connectorArticleInputs(
  records: readonly ReferenceCatalogSearchRecord[],
): readonly NewArticleVariantV3Input[] {
  const seen = new Set<string>();
  return records.flatMap(record => {
    const articleKey = record.sourceKey.trim();
    if (record.entityType !== CONNECTOR_ARTICLE_ENTITY_V3 || !articleKey || seen.has(articleKey)) return [];
    seen.add(articleKey);
    return [{ sourceId: CONNECTOR_REFERENCE_SOURCE_V3, entityType: CONNECTOR_ARTICLE_ENTITY_V3, articleKey }];
  });
}
export function terminalArticleSearchRequest(query: string): ReferenceCatalogSearchRequest {
  return {
    text: query.trim() || null,
    exactSourceKey: null,
    entityTypes: [TERMINAL_ARTICLE_ENTITY_V3],
    filters: [],
    filterLogic: "all",
    sort: "relevance",
    pageSize: 30,
    cursor: null,
  };
}
export function terminalArticleInputs(
  records: readonly ReferenceCatalogSearchRecord[],
  sourceId = TERMINAL_REFERENCE_SOURCE_V3,
): readonly ArticleBinding[] {
  const seen = new Set<string>();
  return records.flatMap(record => {
    const articleKey = record.sourceKey.trim();
    if (record.entityType !== TERMINAL_ARTICLE_ENTITY_V3 || !articleKey || seen.has(articleKey)) return [];
    seen.add(articleKey);
    return [{ sourceId, entityType: TERMINAL_ARTICLE_ENTITY_V3, articleKey }];
  });
}
export const LEGACY_TERMINAL_REFERENCE_SOURCE = "technology-database";
function missingSearchableSnapshot(error: unknown): boolean {
  return error instanceof ReferenceCatalogApiError && error.code === "catalog_active_snapshot_not_found";
}
/** Searches the dedicated БД.ТЕР source and falls back to the legacy combined database. */
export async function searchTerminalArticles(
  api: Pick<ReferenceCatalogApi, "searchCatalog">,
  query: string,
  signal?: AbortSignal,
): Promise<readonly ArticleBinding[]> {
  const request = terminalArticleSearchRequest(query);
  try {
    const page = await api.searchCatalog(TERMINAL_REFERENCE_SOURCE_V3, request, signal);
    return terminalArticleInputs(page.items, TERMINAL_REFERENCE_SOURCE_V3);
  } catch (error) {
    if (!missingSearchableSnapshot(error)) throw error;
  }
  try {
    const page = await api.searchCatalog(LEGACY_TERMINAL_REFERENCE_SOURCE, request, signal);
    return terminalArticleInputs(page.items, LEGACY_TERMINAL_REFERENCE_SOURCE);
  } catch (error) {
    if (missingSearchableSnapshot(error))
      throw new Error("Справочник терминалов не загружен. Загрузите и опубликуйте БД.ТЕР в разделе «Справочники».");
    throw error;
  }
}
function compositeSourceKeyParts(value: string): readonly string[] | null {
  const parts: string[] = [];
  let offset = 0;
  while (offset < value.length) {
    const separator = value.indexOf(":", offset);
    if (separator < 0) return null;
    const lengthText = value.slice(offset, separator);
    if (!/^\d+$/.test(lengthText)) return null;
    const length = Number(lengthText);
    const start = separator + 1, end = start + length;
    if (!Number.isSafeInteger(length) || end > value.length) return null;
    parts.push(value.slice(start, end));
    if (end === value.length) return parts;
    if (value[end] !== "|") return null;
    offset = end + 1;
  }
  return parts;
}
/** Human readable БД.ТЕР identity: manufacturer + available article + series. */
export function terminalCatalogLabel(record: ReferenceCatalogSearchRecord): string {
  const text = (key: string) => typeof record.payload[key] === "string" ? record.payload[key].trim() : "";
  const fromPayload = [text("manufacturer"), text("reelArticle") || text("bagArticle"), text("series")].filter(Boolean);
  if (fromPayload.length) return fromPayload.join(" ");
  const composite = compositeSourceKeyParts(record.sourceKey);
  const fromKey = composite ? [composite[0], composite[1] || composite[2], composite[3]].filter(Boolean) : [];
  return fromKey.length ? fromKey.join(" ") : record.sourceKey;
}
