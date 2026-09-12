import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LocalSession } from "../local-session";
import {
  createReferenceCatalogApi,
  ReferenceCatalogApiError,
  type ReferenceCatalogSearchRecord,
} from "../reference-catalog-api";
import type { RuntimeConfig } from "../runtime-config";
import type { EditorCatalogItem, EditorCatalogSource } from "./editor-types";

interface RemoteCatalogSource extends EditorCatalogSource {
  readonly entityTypes: readonly string[];
  readonly accent: string;
}

const localSource: EditorCatalogSource = {
  id: "built-in-connectors",
  label: "Соединители",
  description: "Универсальные соединители до подключения профильной базы",
};

export const remoteEditorCatalogSources: readonly RemoteCatalogSource[] = [
  {
    id: "technology-database",
    label: "Провода",
    description: "Провода и кабели из универсально опубликованного справочника",
    entityTypes: ["wire", "cable", "coax-cable"],
    accent: "#356c88",
  },
  {
    id: "technology-terminals",
    label: "Терминалы",
    description: "Опубликованный справочник БД.ТЕР",
    entityTypes: ["terminal"],
    accent: "#8a6635",
  },
  {
    id: "technology-coax-cables",
    label: "Кабели",
    description: "Диаметры коаксиальных кабелей из СПР.КАБ",
    entityTypes: ["coax-cable"],
    accent: "#596d78",
  },
  {
    id: "technology-awg-reference",
    label: "Провода AWG",
    description: "Сечения и диаметры проводов из СПР.КАБ",
    entityTypes: ["awg-reference"],
    accent: "#356c88",
  },
];

export const editorCatalogSources: readonly EditorCatalogSource[] = [localSource, ...remoteEditorCatalogSources];

export const builtInConnectorItems: readonly EditorCatalogItem[] = [
  {
    id: "catalog-xs-04",
    title: "XS-04",
    subtitle: "Универсальный соединитель · 4 контакта",
    category: "Соединители",
    accent: "#3f718b",
    placement: "connector",
  },
  {
    id: "catalog-xs-10",
    title: "XS-10",
    subtitle: "Универсальный соединитель · 10 контактов",
    category: "Соединители",
    accent: "#3f718b",
    placement: "connector",
  },
];

function displayValue(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value).replace(".", ",");
  return null;
}

function firstValue(payload: Readonly<Record<string, unknown>>, ...keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = displayValue(payload[key]);
    if (value) return value;
  }
  return null;
}

function range(
  payload: Readonly<Record<string, unknown>>,
  fromKey: string,
  toKey: string,
  unit: string,
): string | null {
  const from = displayValue(payload[fromKey]);
  const to = displayValue(payload[toKey]);
  if (from && to) return from === to ? `${from} ${unit}` : `${from}–${to} ${unit}`;
  if (from) return `от ${from} ${unit}`;
  if (to) return `до ${to} ${unit}`;
  return null;
}

export function referenceRecordToEditorCatalogItem(
  source: RemoteCatalogSource,
  record: ReferenceCatalogSearchRecord,
): EditorCatalogItem {
  const payload = record.payload;
  const details: string[] = [];
  if (record.entityType === "terminal") {
    const family = firstValue(payload, "productName", "series", "connectorType", "manufacturer");
    const section = range(payload, "sectionFromMm2", "sectionToMm2", "мм²") ??
      range(payload, "awgFrom", "awgTo", "AWG");
    const insulation = range(payload, "insulationDiameterFromMm", "insulationDiameterToMm", "мм Ø изоляции");
    const strip = firstValue(payload, "stripLengthMm");
    if (family) details.push(family);
    if (section) details.push(section);
    if (insulation) details.push(insulation);
    if (strip) details.push(`зачистка ${strip} мм`);
  } else if (record.entityType === "coax-cable") {
    const layers = Array.isArray(payload.layers) ? payload.layers : [];
    const diameters = layers.flatMap((layer) => {
      if (typeof layer !== "object" || layer === null || Array.isArray(layer)) return [];
      const item = layer as Record<string, unknown>;
      const index = displayValue(item.index);
      const diameter = displayValue(item.diameterMm);
      return index && diameter ? [`D${index} ${diameter} мм`] : [];
    });
    details.push(...diameters.slice(0, 3));
  } else if (record.entityType === "awg-reference") {
    const section = firstValue(payload, "sectionMm2");
    const conductor = firstValue(payload, "conductorDiameterMm");
    if (section) details.push(`${section} мм²`);
    if (conductor) details.push(`Ø жилы ${conductor} мм`);
  } else if (record.entityType === "wire" || record.entityType === "cable") {
    const name = firstValue(payload, "name", "Название", "mark", "Марка", "series", "Серия");
    const section = firstValue(payload, "sectionMm2", "Сечение", "section", "awg", "AWG");
    const color = firstValue(payload, "color", "Цвет");
    if (name) details.push(name);
    if (section) details.push(`${section}${/awg/i.test(section) ? "" : " мм²"}`);
    if (color) details.push(color);
  } else {
    const name = firstValue(payload, "name", "productName", "series", "manufacturer");
    if (name) details.push(name);
  }
  return {
    id: `reference:${source.id}:${record.recordId}`,
    title: record.sourceKey,
    subtitle: details.length > 0 ? details.join(" · ") : `${source.label} · характеристики не заполнены`,
    category: source.label,
    accent: source.accent,
    placement: "reference-only",
    sourceId: source.id,
    sourceKey: record.sourceKey,
    entityType: record.entityType,
  };
}

export function filterBuiltInConnectors(query: string): readonly EditorCatalogItem[] {
  const normalized = query.trim().toLocaleLowerCase("ru");
  if (!normalized) return builtInConnectorItems;
  return builtInConnectorItems.filter((item) =>
    `${item.title} ${item.subtitle}`.toLocaleLowerCase("ru").includes(normalized));
}

type CatalogLoadState = "idle" | "loading" | "loading-more" | "ready" | "unpublished" | "error";

export interface EditorReferenceCatalogState {
  readonly sources: readonly EditorCatalogSource[];
  readonly selectedSourceId: string;
  readonly query: string;
  readonly items: readonly EditorCatalogItem[];
  readonly loadState: CatalogLoadState;
  readonly message: string | null;
  readonly hasMore: boolean;
  readonly selectSource: (sourceId: string) => void;
  readonly changeQuery: (query: string) => void;
  readonly loadMore: () => void;
  readonly retry: () => void;
}

const pageSize = 30;

export function useEditorReferenceCatalog(
  config: RuntimeConfig,
  session: LocalSession,
): EditorReferenceCatalogState {
  const api = useMemo(() => createReferenceCatalogApi(config, session), [config, session]);
  const [selectedSourceId, setSelectedSourceId] = useState(localSource.id);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [remoteItems, setRemoteItems] = useState<readonly EditorCatalogItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<CatalogLoadState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const requestGeneration = useRef(0);
  const source = remoteEditorCatalogSources.find((item) => item.id === selectedSourceId) ?? null;

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!source) {
      requestGeneration.current += 1;
      setRemoteItems([]);
      setNextCursor(null);
      setLoadState("ready");
      setMessage(null);
      return;
    }
    const generation = ++requestGeneration.current;
    const controller = new AbortController();
    setRemoteItems([]);
    setNextCursor(null);
    setLoadState("loading");
    setMessage(null);
    void api.searchCatalog(source.id, {
      text: debouncedQuery.trim() || null,
      exactSourceKey: null,
      entityTypes: source.entityTypes,
      filters: [],
      filterLogic: "all",
      sort: debouncedQuery.trim() ? "relevance" : "source-key-asc",
      pageSize,
      cursor: null,
    }, controller.signal).then((page) => {
      if (requestGeneration.current !== generation) return;
      setRemoteItems(page.items.map((record) => referenceRecordToEditorCatalogItem(source, record)));
      setNextCursor(page.nextCursor);
      setLoadState("ready");
    }).catch((error: unknown) => {
      if (controller.signal.aborted || requestGeneration.current !== generation) return;
      if (error instanceof ReferenceCatalogApiError && error.code === "catalog_active_snapshot_not_found") {
        setLoadState("unpublished");
        setMessage(`Справочник «${source.label}» ещё не опубликован.`);
        return;
      }
      setLoadState("error");
      setMessage(error instanceof Error ? error.message : "Не удалось загрузить справочник.");
    });
    return () => controller.abort();
  }, [api, debouncedQuery, reloadToken, source]);

  const loadMore = useCallback(() => {
    if (!source || !nextCursor || loadState === "loading" || loadState === "loading-more") return;
    const generation = ++requestGeneration.current;
    setLoadState("loading-more");
    setMessage(null);
    void api.searchCatalog(source.id, {
      text: debouncedQuery.trim() || null,
      exactSourceKey: null,
      entityTypes: source.entityTypes,
      filters: [],
      filterLogic: "all",
      sort: debouncedQuery.trim() ? "relevance" : "source-key-asc",
      pageSize,
      cursor: nextCursor,
    }).then((page) => {
      if (requestGeneration.current !== generation) return;
      setRemoteItems((current) => {
        const existing = new Set(current.map((item) => item.id));
        return [...current, ...page.items
          .map((record) => referenceRecordToEditorCatalogItem(source, record))
          .filter((item) => !existing.has(item.id))];
      });
      setNextCursor(page.nextCursor);
      setLoadState("ready");
    }).catch((error: unknown) => {
      if (requestGeneration.current !== generation) return;
      if (error instanceof ReferenceCatalogApiError && (
        error.code === "catalog_cursor_snapshot_changed" || error.code === "catalog_cursor_invalid"
      )) {
        setReloadToken((value) => value + 1);
        return;
      }
      setLoadState("error");
      setMessage(error instanceof Error ? error.message : "Не удалось загрузить следующую страницу.");
    });
  }, [api, debouncedQuery, loadState, nextCursor, source]);

  return {
    sources: editorCatalogSources,
    selectedSourceId,
    query,
    items: source ? remoteItems : filterBuiltInConnectors(query),
    loadState,
    message,
    hasMore: source !== null && nextCursor !== null,
    selectSource: (sourceId) => {
      if (editorCatalogSources.some((item) => item.id === sourceId)) {
        requestGeneration.current += 1;
        setSelectedSourceId(sourceId);
      }
    },
    changeQuery: (value) => {
      requestGeneration.current += 1;
      setQuery(value);
    },
    loadMore,
    retry: () => setReloadToken((value) => value + 1),
  };
}
