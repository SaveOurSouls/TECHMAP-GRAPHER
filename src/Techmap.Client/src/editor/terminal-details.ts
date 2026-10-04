import type { ReferenceCatalogSearchRecord } from "../reference-catalog-api";
import type { HarnessDesignDocument, ConnectorContact } from "./model";
import { terminalArticleLabel } from "./terminal-article-label";

export type TerminalDetails = NonNullable<ConnectorContact["terminalDetails"]>;

function text(payload: Readonly<Record<string, unknown>>, ...keys: string[]): string {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export function terminalDetailsFromRecord(record: ReferenceCatalogSearchRecord): TerminalDetails {
  return {
    manufacturer: text(record.payload, "manufacturer", "Производитель", "изготовитель"),
    series: text(record.payload, "series", "Серия", "Марка"),
    description: text(record.payload, "description", "Текстовое описание", "Описание", "productName", "Product Name", "Наименование", "name", "Название"),
    article: text(record.payload, "reelArticle", "article", "Артикул", "bagArticle") || terminalArticleLabel(record.sourceKey),
  };
}

function articleAliases(record: ReferenceCatalogSearchRecord): string[] {
  return [record.sourceKey, terminalArticleLabel(record.sourceKey),
    text(record.payload, "reelArticle", "article", "Артикул", "bagArticle")]
    .filter(Boolean).map(value => value.trim().toLocaleLowerCase("ru-RU"));
}

/** Resolve exact catalog keys first; a bare article is usable only if unique. */
export function resolveTerminalDetails(
  article: string,
  records: readonly ReferenceCatalogSearchRecord[],
): TerminalDetails | undefined {
  const terminals = records.filter(record => record.entityType === "terminal");
  const exact = terminals.find(record => record.sourceKey === article);
  if (exact) return terminalDetailsFromRecord(exact);
  const normalized = article.trim().toLocaleLowerCase("ru-RU");
  if (!normalized) return undefined;
  const matches = terminals.filter(record => articleAliases(record).includes(normalized));
  const identities = new Map(matches.map(record => {
    const manufacturer = text(record.payload, "manufacturer", "Производитель").toLocaleLowerCase("ru-RU");
    const series = text(record.payload, "series", "Серия").toLocaleLowerCase("ru-RU");
    const identity = manufacturer && series ? `${manufacturer}\0${series}\0${normalized}` : record.sourceKey;
    return [identity, record] as const;
  }));
  return identities.size === 1 ? terminalDetailsFromRecord(identities.values().next().value!) : undefined;
}

/** Fill metadata for legacy contacts only when an exact catalog key is available. */
export function hydrateTerminalDetails(
  document: HarnessDesignDocument,
  records: readonly ReferenceCatalogSearchRecord[],
): HarnessDesignDocument {
  let changed = false;
  const connectors = document.connectors.map(connector => {
    let connectorChanged = false;
    const contacts = connector.contacts.map(contact => {
      if (contact.terminalDetails || !contact.terminalArticle) return contact;
      const details = resolveTerminalDetails(contact.terminalArticle, records);
      if (!details || !Object.values(details).some(value => value.trim())) return contact;
      changed = connectorChanged = true;
      return { ...contact, terminalDetails: details };
    });
    return connectorChanged ? { ...connector, contacts } : connector;
  });
  return changed ? { ...document, connectors } : document;
}
