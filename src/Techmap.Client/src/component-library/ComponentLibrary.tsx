import { useCallback, useEffect, useMemo, useState } from "react";
import type { LocalSession } from "../local-session";
import type { RuntimeConfig } from "../runtime-config";
import {
  createReferenceCatalogApi,
  type ReferenceCatalogSearchRecord,
  type ReferenceCatalogSearchRequest,
} from "../reference-catalog-api";
import { createComponentTemplateApi, type ArticleBinding, type ComponentTemplate, type ComponentTemplateSummary, type TemplateAsset } from "./component-template-api";
import { readTemplateAsset } from "./template-assets";
import { isTemplateContentV1, isTemplateContentV2, isTemplateContentV3, isTemplateContentV4, reconcileTemplateEnvelopeAssets, upgradeComponentTemplateContentV1ToV3, upgradeComponentTemplateContentV2, upgradeComponentTemplateContentV3 } from "./template-content";
import { E4ConnectorTableEditor } from "./E4ConnectorTableEditor";
import { createE4ConnectorSeriesTableFromV3, type E4ConnectorSeriesTable } from "./e4-connector-series-table";
import { TemplateCanvasV2 } from "./TemplateCanvasV2";
import { TemplateContactsPanelV2 } from "./TemplateContactsPanelV2";
import { TemplateLayersPanelV2 } from "./TemplateLayersPanelV2";
import { TemplateParametersPanelV2 } from "./TemplateParametersPanelV2";
import {
  CONNECTOR_ARTICLE_ENTITY_V3,
  CONNECTOR_REFERENCE_SOURCE_V3,
  TemplateSeriesPanelV3,
  type NewArticleVariantV3Input,
} from "./TemplateSeriesPanelV3";
import { materializeArticleVariantV3 } from "./template-article-materialization-v3";
import { materializeArticleContactRowsV3 } from "./template-article-contact-rows-v3";
import {
  addAdditionalViewV3 as addAdditionalViewV2, addBasicNodeV3 as addBasicNodeV2, addBundlePortV3 as addBundlePortV2,
  addContactPointV3 as addContactPointV2, addContactTypeGroupV3, addLayerV3 as addLayerV2, addNodeV3 as addNodeV2,
  attachRepeatDomainV3 as attachRepeatDomainV2, constantExpressionV3 as constantExpressionV2,
  createRepeatPrototypeV3 as createRepeatPrototypeV2, deleteAdditionalViewV3 as deleteAdditionalViewV2,
  deleteBundlePortV3 as deleteBundlePortV2, deleteContactPointV3 as deleteContactPointV2,
  deleteContactTypeGroupV3, deleteLayerV3 as deleteLayerV2, deleteNodeV3 as deleteNodeV2,
  deleteRepeatPrototypeV3 as deleteRepeatPrototypeV2, editBundlePortV3 as editBundlePortV2,
  editContactPointV3 as editContactPointV2, editLogicalContactV3 as editLogicalContactV2,
  editNodeV3 as editNodeV2, linkLogicalContactPointV3 as linkLogicalContactPointV2,
  moveNodeV3 as moveNodeV2, newTemplateContentV3 as newTemplateContentV2,
  parameterizeNodeDimensionV3 as parameterizeNodeDimensionV2, projectTemplateContentV3CoreToV2,
  addArticleVariantsV3, removeArticleVariantContactGroupV3, removeArticleVariantV3, renameContactTypeGroupV3,
  renameLayerV3 as renameLayerV2, renameViewV3 as renameViewV2, reorderLayerV3 as reorderLayerV2,
  reorderNodeV3 as reorderNodeV2, setArticleVariantContactGroupV3, setLayerLockedV3 as setLayerLockedV2,
  setLayerVisibleV3 as setLayerVisibleV2, setNodeLockedV3 as setNodeLockedV2,
  setRepeatCountV3 as setRepeatCountV2, setRepeatStepV3 as setRepeatStepV2,
  setTemplateParameterDefaultV3 as setTemplateParameterDefaultV2, upsertArticleVariantV3,
  type BasicNodeKindV3 as BasicNodeKindV2, type BundlePortEditV3 as BundlePortEditV2,
  type ContactPointEditV3 as ContactPointEditV2, type LogicalContactEditV3 as LogicalContactEditV2,
  type NodeEditV3 as NodeEditV2,
} from "./template-commands-v3";
import { type ContactDirectionV2, type ImageNodeV2, type ParameterValueV2, type TemplateContentV2 as LegacyTemplateContentV2, type TemplateV2Diagnostic } from "./template-model-v2";
import { validateTemplateContentV3 as validateTemplateContentV2, type BundlePortV3 as BundlePortV2, type LogicalContactV3 as LogicalContactV2, type NumericExpressionV3 as NumericExpressionV2, type TemplateContentV3 as TemplateContentV2, type TemplateNodeV3 as TemplateNodeV2, type ViewContactPointV3 as ViewContactPointV2 } from "./template-model-v3";
import { validateTemplateContentV4, type TemplateContentV4 } from "./template-model-v4";
import { expandTemplateRepeatsV2 } from "./template-repeat-v2";
import "./component-library.css";

interface Props { config: RuntimeConfig; session: LocalSession; }
interface Draft { templateId: string | null; version: number; code: string; name: string; assets: TemplateAsset[]; content: TemplateContentV2; e4ConnectorTable: E4ConnectorSeriesTable; }
type EditableNode = Extract<TemplateNodeV2, { kind: "line" | "rectangle" | "ellipse" | "text" | "image" }>;

const newDraft = (): Draft => {
  const content = newTemplateContentV2();
  return { templateId: null, version: 0, code: "", name: "Новый компонент", assets: [], content, e4ConnectorTable: createE4ConnectorSeriesTableFromV3(content) };
};
const firstLayerIds = (content: TemplateContentV2) => Object.fromEntries(content.views.map(view => [view.id, view.layers[0]!.id]));
const errorText = (error: unknown) => error instanceof Error ? error.message : "Неизвестная ошибка.";
const constantValue = (expression: NumericExpressionV2) => expression.kind === "constant" ? expression.value : null;

function reconcileE4ConnectorTable(content: TemplateContentV2, previous?: E4ConnectorSeriesTable): E4ConnectorSeriesTable {
  const next = createE4ConnectorSeriesTableFromV3(content);
  if (!previous) return next;
  const previousDefaults = new Map(previous.seriesDefaults.map(row => [row.rowId, row]));
  const previousArticles = new Map(previous.articles.map(article => [article.articleVariantId, article]));
  return {
    ...next,
    columns: next.columns.map(column => previous.columns.find(item => item.id === column.id) ?? column),
    seriesDefaults: next.seriesDefaults.map(row => previousDefaults.get(row.rowId) ?? row),
    articles: next.articles.map(article => {
      const old = previousArticles.get(article.articleVariantId);
      if (!old) return article;
      const oldRows = new Map(old.rows.map(row => [row.seriesRowId, row]));
      return { ...article, rows: article.rows.map(row => oldRows.get(row.seriesRowId) ?? row) };
    }),
  };
}

function v3CoreFromV4(content: TemplateContentV4): TemplateContentV2 {
  const { schemaVersion: _schemaVersion, e4ConnectorTable: _table, ...core } = content;
  return { schemaVersion: 3, ...structuredClone(core) };
}

export const isTemplateUndoShortcut = (
  event: Pick<KeyboardEvent, "ctrlKey" | "metaKey" | "key"> & { readonly target?: EventTarget | null },
) => {
  const target = event.target as { tagName?: string; isContentEditable?: boolean } | null | undefined;
  const tagName = target?.tagName?.toLowerCase();
  const isTextEditor = target?.isContentEditable || tagName === "input" || tagName === "textarea" || tagName === "select";
  return !isTextEditor && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z";
};

export function isTemplateAssetReferencedV2(content: TemplateContentV2 | LegacyTemplateContentV2, assetId: string): boolean {
  return content.views.some(view => view.layers.some(layer => layer.nodes.some(node =>
    node.kind === "image" && node.geometry.assetId === assetId)));
}

const articleIdentity = (value: Pick<ArticleBinding, "sourceId" | "entityType" | "articleKey">) =>
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

/**
 * Old template envelopes used articleBindings as their lookup index. During the
 * explicit v1/v2 upgrade those identities become legacy v3 variants. From v3
 * onward articleVariants is the sole editable authority and the envelope index
 * is derived when the immutable version is saved.
 */
export function addLegacyArticleBindingsToV3(content: TemplateContentV2, bindings: readonly ArticleBinding[]): TemplateContentV2 {
  let next = content;
  const known = new Set(next.articleVariants.map(articleIdentity));
  for (const binding of bindings) {
    if (known.has(articleIdentity(binding))) continue;
    [next] = upsertArticleVariantV3(next, binding);
    known.add(articleIdentity(binding));
  }
  return next;
}

export function articleBindingsFromTemplateV3(content: TemplateContentV2): ArticleBinding[] {
  return content.articleVariants.map(({ sourceId, entityType, articleKey }) => ({ sourceId, entityType, articleKey }));
}

export function createTemplateImageNodeV2(assetId: string, layerId: string): ImageNodeV2 {
  const c = constantExpressionV2;
  return {
    id: crypto.randomUUID(), kind: "image", layerId, visible: true, locked: false, opacity: 1,
    transform: { translateX: c(0), translateY: c(0), rotationDegrees: c(0), scaleX: c(1), scaleY: c(1) },
    stroke: { color: "#000000", width: c(0) }, fill: { color: null },
    geometry: { assetId, x: c(80), y: c(80), width: c(320), height: c(180), cropX: 0, cropY: 0, cropWidth: 1, cropHeight: 1, underlay: true },
  };
}

function isEditableConstantNode(node: TemplateNodeV2): node is EditableNode {
  const constant = (value: NumericExpressionV2) => value.kind === "constant";
  if (![node.transform.translateX, node.transform.translateY].every(constant)) return false;
  if (node.kind === "line") return node.geometry.points.every(point => constant(point.x) && constant(point.y));
  if (node.kind === "rectangle") return [node.geometry.x, node.geometry.y, node.geometry.width, node.geometry.height].every(constant);
  if (node.kind === "ellipse") return [node.geometry.centerX, node.geometry.centerY, node.geometry.radiusX, node.geometry.radiusY].every(constant);
  if (node.kind === "text") return [node.geometry.x, node.geometry.y, node.geometry.fontSize].every(constant);
  if (node.kind === "image") return [node.geometry.x, node.geometry.y, node.geometry.width, node.geometry.height].every(constant);
  return false;
}

export function ComponentLibrary({ config, session }: Props) {
  const api = useMemo(() => createComponentTemplateApi(config, session), [config, session]);
  const referenceApi = useMemo(() => createReferenceCatalogApi(config, session), [config, session]);
  const [items, setItems] = useState<readonly ComponentTemplateSummary[]>([]);
  const [draft, setDraft] = useState<Draft>(() => newDraft());
  const [viewId, setViewId] = useState(() => draft.content.views[0]!.id);
  const [activeLayerIds, setActiveLayerIds] = useState<Record<string, string>>(() => firstLayerIds(draft.content));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<readonly TemplateV2Diagnostic[]>([]);
  const [upgradedFromV1, setUpgradedFromV1] = useState(false);
  const [assetMismatch, setAssetMismatch] = useState(false);
  const [undoStack, setUndoStack] = useState<TemplateContentV2[]>([]);
  const [previewParameterValues, setPreviewParameterValues] = useState<Readonly<Record<string, number>>>({});
  const [selectedArticleVariantId, setSelectedArticleVariantId] = useState<string | null>(null);
  const [pendingLogicalContactId, setPendingLogicalContactId] = useState<string | null>(null);
  const [connectorArticleQuery, setConnectorArticleQuery] = useState("");
  const [connectorArticleSuggestions, setConnectorArticleSuggestions] = useState<readonly NewArticleVariantV3Input[]>([]);
  const [connectorArticleSearchState, setConnectorArticleSearchState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [connectorArticleSearchMessage, setConnectorArticleSearchMessage] = useState<string | null>(null);

  const activeView = draft.content.views.find(view => view.id === viewId) ?? draft.content.views[0];
  const activeLayerId = activeView ? activeLayerIds[activeView.id] ?? activeView.layers[0]!.id : null;
  const activeLayer = activeView?.layers.find(layer => layer.id === activeLayerId) ?? activeView?.layers[0];
  const selected = activeView?.layers.flatMap(layer => layer.nodes.map(node => ({ layer, node }))).find(item => item.node.id === selectedId);
  const selectedContactPoint = activeView?.contactPoints.find(point => point.id === selectedId);
  const selectedBundlePort = activeView?.bundlePorts.find(point => point.id === selectedId);
  const selectedPoint = selectedContactPoint ?? selectedBundlePort;
  const selectedLogicalContact = selectedContactPoint ? draft.content.logicalContacts.find(contact => contact.id === selectedContactPoint.logicalContactId) : undefined;
  const editableNode = selected?.node && isEditableConstantNode(selected.node) ? selected.node : null;
  const compatibilityContent = useMemo(() => projectTemplateContentV3CoreToV2(draft.content), [draft.content]);
  const articlePreview = useMemo(() => {
    if (!selectedArticleVariantId) return { values: {} as Readonly<Record<string, ParameterValueV2>>, rows: [], message: null, error: null };
    try {
      const materialized = materializeArticleVariantV3(draft.content, selectedArticleVariantId);
      const rows = materializeArticleContactRowsV3(draft.content, materialized.variant);
      const groupNames = new Map(draft.content.contactTypeGroups.map(group => [group.id, group.name]));
      const counts = materialized.repeatCounts.map(item => `${groupNames.get(item.contactTypeGroupId) ?? "Группа"}: ${item.requestedContactCount}`);
      const configured = materialized.variant.contactGroups?.reduce((sum, group) => sum + group.contactCount, 0);
      const summary = counts.length ? counts.join(" · ") : configured === undefined ? "используются параметры шаблона" : `${configured} контактов`;
      return { values: materialized.overrides, rows, message: `${materialized.variant.articleKey}: ${summary}`, error: null };
    } catch (caught) {
      return { values: {} as Readonly<Record<string, ParameterValueV2>>, rows: [], message: null, error: errorText(caught) };
    }
  }, [draft.content, selectedArticleVariantId]);
  const effectivePreviewParameterValues = useMemo<Readonly<Record<string, ParameterValueV2>>>(() => ({
    ...previewParameterValues,
    ...articlePreview.values,
  }), [articlePreview.values, previewParameterValues]);

  async function loadList() { try { setItems(await api.list()); setError(null); } catch (caught) { setError(errorText(caught)); } }
  useEffect(() => { void loadList(); }, [api]);
  useEffect(() => {
    if (selectedArticleVariantId && !draft.content.articleVariants.some(variant => variant.id === selectedArticleVariantId))
      setSelectedArticleVariantId(null);
  }, [draft.content.articleVariants, selectedArticleVariantId]);
  useEffect(() => {
    const query = connectorArticleQuery.trim();
    if (!query) {
      setConnectorArticleSuggestions([]);
      setConnectorArticleSearchState("idle");
      setConnectorArticleSearchMessage(null);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setConnectorArticleSearchState("loading");
      setConnectorArticleSearchMessage(null);
      void referenceApi.searchCatalog(CONNECTOR_REFERENCE_SOURCE_V3, connectorArticleSearchRequest(query), controller.signal).then(page => {
        if (controller.signal.aborted) return;
        setConnectorArticleSuggestions(connectorArticleInputs(page.items));
        setConnectorArticleSearchState("ready");
      }).catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setConnectorArticleSuggestions([]);
        setConnectorArticleSearchState("error");
        setConnectorArticleSearchMessage(errorText(caught));
      });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [connectorArticleQuery, referenceApi]);

  function setLoadedDraft(item: ComponentTemplate, content: TemplateContentV2, nextDiagnostics: readonly TemplateV2Diagnostic[], migrated: boolean, mismatch: boolean, table?: E4ConnectorSeriesTable) {
    setDraft({ templateId: item.templateId, version: item.version, code: item.code, name: item.name, assets: [...item.assets], content: structuredClone(content), e4ConnectorTable: structuredClone(table ?? createE4ConnectorSeriesTableFromV3(content)) });
    setViewId(content.views[0]!.id); setActiveLayerIds(firstLayerIds(content)); setSelectedId(null); setUndoStack([]);
    setPendingLogicalContactId(null);
    setSelectedArticleVariantId(null);
    setDirty(migrated); setUpgradedFromV1(migrated); setAssetMismatch(mismatch); setDiagnostics(nextDiagnostics); setSaved(null);
    setPreviewParameterValues({});
    setConnectorArticleQuery(""); setConnectorArticleSuggestions([]); setConnectorArticleSearchState("idle"); setConnectorArticleSearchMessage(null);
  }

  async function open(summary: ComponentTemplateSummary) {
    setBusy(true);
    try {
      const item = await api.get(summary.templateId);
      if (isTemplateContentV1(item.content)) {
        const upgraded = upgradeComponentTemplateContentV1ToV3(item.content, item.assets);
        setLoadedDraft(item, addLegacyArticleBindingsToV3(upgraded.content, item.articleBindings), upgraded.diagnostics, true, false); setError(null);
      } else if (isTemplateContentV2(item.content)) {
        const upgraded = upgradeComponentTemplateContentV2(item.content);
        const content = addLegacyArticleBindingsToV3(upgraded.content, item.articleBindings);
        const reconciliation = reconcileTemplateEnvelopeAssets(content, item.assets), mismatch = reconciliation.diagnostics.length > 0;
        setLoadedDraft(item, content, [...upgraded.diagnostics, ...reconciliation.diagnostics], true, mismatch);
        setError(mismatch ? "Метаданные изображений расходятся с версией шаблона. Сохранение заблокировано." : null);
      } else if (isTemplateContentV3(item.content)) {
        const reconciliation = reconcileTemplateEnvelopeAssets(item.content, item.assets), mismatch = reconciliation.diagnostics.length > 0;
        setLoadedDraft(item, item.content, reconciliation.diagnostics, false, mismatch);
        setError(mismatch ? "Метаданные изображений расходятся с версией шаблона. Сохранение заблокировано." : null);
      } else if (isTemplateContentV4(item.content)) {
        const reconciliation = reconcileTemplateEnvelopeAssets(item.content, item.assets), mismatch = reconciliation.diagnostics.length > 0;
        setLoadedDraft(item, v3CoreFromV4(item.content), reconciliation.diagnostics, false, mismatch, item.content.e4ConnectorTable);
        setError(mismatch ? "Метаданные изображений расходятся с версией шаблона. Сохранение заблокировано." : null);
      }
    } catch (caught) { setError(errorText(caught)); } finally { setBusy(false); }
  }

  function startNew() {
    const next = newDraft(); setDraft(next); setViewId(next.content.views[0]!.id); setActiveLayerIds(firstLayerIds(next.content));
    setSelectedId(null); setUndoStack([]); setDirty(true); setUpgradedFromV1(false); setAssetMismatch(false); setDiagnostics([]); setError(null); setSaved(null);
    setPendingLogicalContactId(null);
    setSelectedArticleVariantId(null);
    setPreviewParameterValues({});
    setConnectorArticleQuery(""); setConnectorArticleSuggestions([]); setConnectorArticleSearchState("idle"); setConnectorArticleSearchMessage(null);
  }
  function markDirty() { setDirty(true); setSaved(null); if (!assetMismatch) setDiagnostics([]); }
  function changeContent(content: TemplateContentV2, selection?: string | null) {
    if (content === draft.content) return;
    setUndoStack(stack => [...stack.slice(-49), draft.content]); setDraft(current => ({ ...current, content, e4ConnectorTable: reconcileE4ConnectorTable(content, current.e4ConnectorTable) }));
    if (selection !== undefined) setSelectedId(selection); markDirty(); setError(null);
  }
  function command(action: () => TemplateContentV2, selection?: string | null) { try { changeContent(action(), selection); } catch (caught) { setError(errorText(caught)); } }
  const undo = useCallback(() => setUndoStack(stack => {
    const previous = stack.at(-1); if (!previous) return stack;
    setDraft(current => ({ ...current, content: previous, e4ConnectorTable: reconcileE4ConnectorTable(previous, current.e4ConnectorTable) })); setSelectedId(null); markDirty(); return stack.slice(0, -1);
  }), []);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => { if (isTemplateUndoShortcut(event)) { event.preventDefault(); undo(); } };
    window.addEventListener("keydown", listener); return () => window.removeEventListener("keydown", listener);
  }, [undo]);

  async function persistDraft(): Promise<ComponentTemplate | null> {
    if (!draft.code.trim() || !draft.name.trim()) { setError("Укажите серию соединителя и описание."); return null; }
    if (assetMismatch) { setError("Сохранение заблокировано: metadata assets не совпадают с версией шаблона."); return null; }
    const reconciliation = reconcileTemplateEnvelopeAssets(draft.content, draft.assets);
    if (reconciliation.diagnostics.length) { setAssetMismatch(true); setDiagnostics(reconciliation.diagnostics); setError(reconciliation.diagnostics[0]!.message); return null; }
    const validation = validateTemplateContentV2(draft.content);
    if (!validation.valid) { setDiagnostics(validation.diagnostics); setError(validation.diagnostics[0]!.message); return null; }
    try {
      expandTemplateRepeatsV2(compatibilityContent);
      for (const variant of draft.content.articleVariants) {
        const materialized = materializeArticleVariantV3(draft.content, variant);
        expandTemplateRepeatsV2(materialized.repeatContent, materialized.repeatOptions);
        materializeArticleContactRowsV3(draft.content, materialized.variant);
      }
    }
    catch (caught) { setError(errorText(caught)); return null; }
    const v4Content: TemplateContentV4 = { ...structuredClone(draft.content), schemaVersion: 4, e4ConnectorTable: structuredClone(draft.e4ConnectorTable) };
    const v4Validation = validateTemplateContentV4(v4Content);
    if (!v4Validation.valid) { setError(v4Validation.diagnostics[0]?.message ?? "Таблица Э4 не прошла проверку."); return null; }
    const body = { code: draft.code.trim(), name: draft.name.trim(), articleBindings: articleBindingsFromTemplateV3(draft.content), content: v4Content };
    return draft.templateId ? api.save(draft.templateId, { expectedVersion: draft.version, ...body }) : api.create(body);
  }

  function applyPersisted(result: ComponentTemplate, resetUndo = false) {
    if (!isTemplateContentV3(result.content) && !isTemplateContentV4(result.content)) throw new Error("Сервер вернул неподдерживаемый формат после сохранения.");
    const content = isTemplateContentV4(result.content) ? v3CoreFromV4(result.content) : result.content;
    const table = isTemplateContentV4(result.content) ? result.content.e4ConnectorTable : createE4ConnectorSeriesTableFromV3(content);
    const reconciliation = reconcileTemplateEnvelopeAssets(result.content, result.assets);
    if (reconciliation.diagnostics.length) throw new Error(reconciliation.diagnostics[0]!.message);
    setDraft({ templateId: result.templateId, version: result.version, code: result.code, name: result.name, assets: [...result.assets], content: structuredClone(content), e4ConnectorTable: structuredClone(table) });
    // Asset mutations change the immutable envelope. Old snapshots could then
    // reintroduce content whose asset list no longer matches the server version.
    if (resetUndo) setUndoStack([]);
    setDirty(false); setUpgradedFromV1(false); setAssetMismatch(false); setDiagnostics([]); setSaved(`Сохранена версия ${result.version}`); setError(null);
  }
  async function save() { setBusy(true); try { const result = await persistDraft(); if (result) { applyPersisted(result); await loadList(); } } catch (caught) { setError(errorText(caught)); } finally { setBusy(false); } }

  async function addAsset(file: File) {
    setBusy(true);
    try {
      const assetInput = await readTemplateAsset(file);
      let persisted: ComponentTemplate | null = null;
      if (!draft.templateId || dirty) { persisted = await persistDraft(); if (!persisted) return; applyPersisted(persisted); }
      const result = await api.addAsset(persisted?.templateId ?? draft.templateId!, { expectedVersion: persisted?.version ?? draft.version, ...assetInput });
      applyPersisted(result, true); await loadList();
    } catch (caught) { setError(errorText(caught)); } finally { setBusy(false); }
  }
  async function removeAsset(assetId: string) {
    if (isTemplateAssetReferencedV2(draft.content, assetId)) { setError("Сначала удалите все размещения этого изображения из видов шаблона."); return; }
    if (!draft.templateId) return;
    setBusy(true);
    try {
      let persisted: ComponentTemplate | null = null;
      if (dirty) { persisted = await persistDraft(); if (!persisted) return; applyPersisted(persisted); }
      const result = await api.removeAsset(persisted?.templateId ?? draft.templateId, assetId, persisted?.version ?? draft.version);
      applyPersisted(result, true); await loadList();
    } catch (caught) { setError(errorText(caught)); } finally { setBusy(false); }
  }

  function appendBasic(kind: BasicNodeKindV2) {
    if (!activeView || !activeLayer) return;
    try { const [content, id] = addBasicNodeV2(draft.content, activeView.id, activeLayer.id, kind); changeContent(content, id); } catch (caught) { setError(errorText(caught)); }
  }
  function appendContact() {
    if (!activeView) return;
    try { const [content, id] = addContactPointV2(draft.content, activeView.id); changeContent(content, id); } catch (caught) { setError(errorText(caught)); }
  }
  function placeLinkedContact(logicalContactId: string) {
    if (!activeView) return;
    try { const [content, id] = linkLogicalContactPointV2(draft.content, activeView.id, logicalContactId); changeContent(content, id); setPendingLogicalContactId(null); } catch (caught) { setError(errorText(caught)); }
  }
  function appendBundlePort() {
    if (!activeView) return;
    try { const [content, id] = addBundlePortV2(draft.content, activeView.id); changeContent(content, id); } catch (caught) { setError(errorText(caught)); }
  }
  function placeAsset(asset: TemplateAsset) {
    if (!activeView || !activeLayer) return;
    const node = createTemplateImageNodeV2(asset.assetId, activeLayer.id);
    command(() => addNodeV2(draft.content, activeView.id, activeLayer.id, node, 0), node.id);
  }
  function moveCanvasNode(nodeId: string, deltaX: number, deltaY: number) {
    if (!activeView) return;
    const layer = activeView.layers.find(item => item.nodes.some(node => node.id === nodeId));
    if (!layer) { setError("Перемещаемый объект не найден в активном виде."); return; }
    command(() => moveNodeV2(draft.content, activeView.id, layer.id, nodeId, deltaX, deltaY), nodeId);
  }
  function addView() {
    try { const [content, id] = addAdditionalViewV2(draft.content); const view = content.views.find(item => item.id === id)!; changeContent(content, null); setActiveLayerIds(current => ({ ...current, [id]: view.layers[0]!.id })); setViewId(id); } catch (caught) { setError(errorText(caught)); }
  }
  function addLayer() {
    if (!activeView) return;
    try { const [content, id] = addLayerV2(draft.content, activeView.id, ""); changeContent(content, null); setActiveLayerIds(current => ({ ...current, [activeView.id]: id })); } catch (caught) { setError(errorText(caught)); }
  }
  const resolveAssetUrl = (assetId: string) => draft.templateId && draft.version > 0 ? api.assetContentUrl(draft.templateId, draft.version, assetId) : "";

  return <div className="component-library">
    <header className="content-heading library-heading"><div><p className="eyebrow">M2 · БИБЛИОТЕКА СОЕДИНИТЕЛЕЙ</p><h1>Серии и компоненты</h1><p>Здесь задаются серия, артикулы и таблица контактов Э4. Графика используется для вспомогательных видов.</p></div><button className="primary-action" type="button" onClick={startNew} disabled={busy}>+ Новая серия</button></header>
    {error && <div className="error-banner" role="alert"><span>{error}</span><button onClick={() => setError(null)} aria-label="Закрыть">×</button></div>}
    {upgradedFromV1 && <div className="library-upgrade-banner" role="status"><strong>Открыта прежняя версия шаблона.</strong><span>Она преобразована только в памяти и будет сохранена как новая версия v3.</span>{diagnostics.map(item => <small key={`${item.code}/${item.path}`}>{item.code}: {item.message}</small>)}</div>}
    {!upgradedFromV1 && diagnostics.length > 0 && <div className="library-diagnostics" role="alert">{diagnostics.map(item => <span key={`${item.code}/${item.path}`}>{item.path}: {item.message}</span>)}</div>}
    {saved && <div className="success-banner" role="status"><span>{saved}. Размещённые ранее экземпляры сохранят закреплённую версию.</span><button onClick={() => setSaved(null)} aria-label="Закрыть">×</button></div>}
    <div className="library-layout"><aside className="library-catalog"><div className="panel-heading"><h2>Шаблоны</h2><button className="refresh-button" onClick={() => void loadList()} disabled={busy}>Обновить</button></div><div className="library-template-list">{items.length ? items.map(item => <button key={item.templateId} className={item.templateId === draft.templateId ? "library-template selected" : "library-template"} onClick={() => void open(item)} disabled={busy}><strong>{item.code}</strong><span>{item.name}</span><small>версия {item.version}</small></button>) : <p className="panel-message">Создайте первый графический шаблон.</p>}</div></aside>
      <section className="library-editor" aria-busy={busy} inert={busy}>
        <div className="library-metadata"><label>Серия соединителя<input aria-label="Серия соединителя" value={draft.code} onChange={event => { setDraft(current => ({ ...current, code: event.target.value })); markDirty(); }} placeholder="Например, JST XH" /></label><label>Описание<input aria-label="Описание серии" value={draft.name} onChange={event => { setDraft(current => ({ ...current, name: event.target.value })); markDirty(); }} placeholder="Например, разъёмы JST XH" /></label><div><span>{draft.templateId ? `Версия ${draft.version}` : "Новая серия"}</span><button className="primary-action" onClick={() => void save()} disabled={busy || assetMismatch}>{busy ? "Сохраняем…" : draft.templateId ? "Создать версию" : "Сохранить серию"}</button></div></div>
        <TemplateSeriesPanelV3
          content={draft.content}
          connectorArticleQuery={connectorArticleQuery}
          connectorArticleSuggestions={connectorArticleSuggestions}
          connectorArticleSearchState={connectorArticleSearchState}
          connectorArticleSearchMessage={connectorArticleSearchMessage}
          onConnectorArticleQueryChange={setConnectorArticleQuery}
          selectedArticleVariantId={selectedArticleVariantId}
          articlePreviewMessage={articlePreview.message}
          articlePreviewError={articlePreview.error}
          articlePreviewRows={articlePreview.rows}
          onSelectArticleVariant={variantId => { setSelectedArticleVariantId(variantId); setPreviewParameterValues({}); }}
          onAddContactTypeGroup={name => command(() => addContactTypeGroupV3(draft.content, name)[0])}
          onRenameContactTypeGroup={(groupId, name) => command(() => renameContactTypeGroupV3(draft.content, groupId, name))}
          onDeleteContactTypeGroup={groupId => command(() => deleteContactTypeGroupV3(draft.content, groupId))}
          onAddArticleVariants={inputs => {
            try {
              changeContent(addArticleVariantsV3(draft.content, inputs));
              if (inputs.some(input => input.sourceId === CONNECTOR_REFERENCE_SOURCE_V3)) {
                setConnectorArticleQuery("");
                setConnectorArticleSuggestions([]);
              }
              return true;
            } catch (caught) {
              setError(errorText(caught));
              return false;
            }
          }}
          onUpdateArticleVariant={(variantId, input) => command(() => upsertArticleVariantV3(draft.content, { id: variantId, ...input })[0])}
          onDeleteArticleVariant={variantId => { if (selectedArticleVariantId === variantId) setSelectedArticleVariantId(null); command(() => removeArticleVariantV3(draft.content, variantId)); }}
          onSetArticleContactGroup={(variantId, groupId, count, terminals) => command(() => setArticleVariantContactGroupV3(draft.content, variantId, groupId, count, terminals))}
          onRemoveArticleContactGroup={(variantId, groupId) => command(() => removeArticleVariantContactGroupV3(draft.content, variantId, groupId))}
        />
        <E4ConnectorTableEditor table={draft.e4ConnectorTable} selectedArticleVariantId={selectedArticleVariantId} disabled={busy || assetMismatch} onChange={table => { setDraft(current => ({ ...current, e4ConnectorTable: table })); markDirty(); }} />
        <details className="library-assets"><summary>Изображения <span>{draft.assets.length}</span></summary><div className="asset-upload"><label className={busy ? "disabled" : ""}>+ Загрузить PNG<input type="file" accept="image/png" disabled={busy} onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void addAsset(file); }} /></label><small>PNG хранится в версии шаблона и размещается ссылкой в активном слое.</small></div>{draft.assets.length > 0 && <div className="asset-list">{draft.assets.map(asset => <article key={asset.assetId}><div className="asset-preview">{draft.templateId && <img src={resolveAssetUrl(asset.assetId)} alt="" />}</div><div><strong>{asset.fileName}</strong><small>{(asset.sizeBytes / 1024).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} КиБ</small></div><div className="asset-actions"><button type="button" onClick={() => placeAsset(asset)} disabled={busy || !activeLayer || activeLayer.locked}>На вид</button><button type="button" className="asset-remove" onClick={() => void removeAsset(asset.assetId)} disabled={busy} aria-label={`Удалить изображение ${asset.fileName}`}>×</button></div></article>)}</div>}</details>
        <div className="library-view-tabs" role="tablist" aria-label="Виды графического шаблона">{draft.content.views.map(view => <button key={view.id} id={`template-view-tab-${view.id}`} role="tab" aria-selected={view.id === activeView?.id} aria-controls={`template-view-panel-${view.id}`} className={view.id === activeView?.id ? "active" : ""} onClick={() => { setViewId(view.id); setSelectedId(null); setPendingLogicalContactId(null); }}>{view.name}</button>)}<button onClick={addView}>+ Вид</button></div>
        {activeView && <TemplateContactsPanelV2
          key={`${activeView.id}:${pendingLogicalContactId ?? ""}`}
          content={compatibilityContent}
          activeViewId={activeView.id}
          preferredLogicalContactId={pendingLogicalContactId}
          onCreateLogicalContact={appendContact}
          onPlaceLinkedContact={placeLinkedContact}
          onAddBundlePort={appendBundlePort}
          onNavigateToMissingPoint={(targetViewId, logicalContactId) => { setViewId(targetViewId); setSelectedId(null); setPendingLogicalContactId(logicalContactId); }}
          onSelectContactPoint={setSelectedId}
          onSelectBundlePort={setSelectedId}
        />}
        {activeView && <TemplateLayersPanelV2
          layers={activeView.layers}
          activeLayerId={activeLayer?.id ?? null}
          onActivate={id => { setActiveLayerIds(current => ({ ...current, [activeView.id]: id })); setSelectedId(null); }}
          onAdd={addLayer}
          onRename={(id, name) => command(() => renameLayerV2(draft.content, activeView.id, id, name))}
          onMove={(id, index) => command(() => reorderLayerV2(draft.content, activeView.id, id, index))}
          onToggleVisible={id => { const layer = activeView.layers.find(item => item.id === id)!; command(() => setLayerVisibleV2(draft.content, activeView.id, id, !layer.visible)); }}
          onToggleLocked={id => { const layer = activeView.layers.find(item => item.id === id)!; command(() => setLayerLockedV2(draft.content, activeView.id, id, !layer.locked)); }}
          onDelete={id => { const fallback = activeView.layers.find(item => item.id !== id); if (!fallback) return; command(() => deleteLayerV2(draft.content, activeView.id, id), null); setActiveLayerIds(current => ({ ...current, [activeView.id]: fallback.id })); }}
        />}
        {activeView && <TemplateParametersPanelV2
          content={compatibilityContent}
          activeViewId={activeView.id}
          activeLayerId={selected?.layer.id ?? activeLayer?.id ?? null}
          selectedNodeId={selected?.node.id ?? null}
          onCreateRepeat={input => command(() => createRepeatPrototypeV2(draft.content, {
            viewId: input.viewId,
            layerId: input.layerId,
            prototypeNodeId: input.prototypeNodeId,
            prototypePointId: input.contactPointId,
            count: input.count,
            step: { x: constantExpressionV2(input.stepX), y: constantExpressionV2(input.stepY) },
          })[0], null)}
          onPlaceRepeatInActiveView={input => {
            if (!activeLayer) return;
            command(() => attachRepeatDomainV2(draft.content, {
              viewId: activeView.id,
              layerId: activeLayer.id,
              prototypeNodeId: input.prototypeNodeId,
              repeatDomainId: input.repeatDomainId,
              step: { x: constantExpressionV2(input.stepX), y: constantExpressionV2(input.stepY) },
            })[0], null);
          }}
          onSetCount={(domainId, count) => {
            command(() => setRepeatCountV2(draft.content, domainId, count));
            setPreviewParameterValues({});
          }}
          onSetStep={(targetViewId, domainId, x, y) => command(() => setRepeatStepV2(
            draft.content, targetViewId, domainId,
            { x: constantExpressionV2(x), y: constantExpressionV2(y) },
          ))}
          onDeleteRepeat={domainId => {
            command(() => deleteRepeatPrototypeV2(draft.content, domainId), null);
            setPreviewParameterValues({});
          }}
          onPreviewValues={setPreviewParameterValues}
          onParameterizeNodeDimension={input => command(() => parameterizeNodeDimensionV2(
            draft.content, input.viewId, input.layerId, input.nodeId, input.dimension,
            { name: input.name, unit: input.unit, defaultValue: input.defaultValue, minimum: input.minimum, maximum: input.maximum },
          )[0])}
          onSetParameterDefault={(parameterId, value) => command(() => setTemplateParameterDefaultV2(draft.content, parameterId, value))}
        />}
        <div className="library-tools"><span>Примитивы</span>{(["line", "rectangle", "ellipse", "text"] as const).map(kind => <button key={kind} onClick={() => appendBasic(kind)} disabled={!activeLayer || activeLayer.locked}>{({ line: "Линия", rectangle: "Прямоугольник", ellipse: "Эллипс", text: "Текст" })[kind]}</button>)}<button className="undo-tool" onClick={undo} disabled={undoStack.length === 0} title="Ctrl+Z">↶ Отменить</button></div>
        <div className="library-workarea" id={activeView ? `template-view-panel-${activeView.id}` : undefined} role="tabpanel" aria-labelledby={activeView ? `template-view-tab-${activeView.id}` : undefined}>{activeView && <TemplateCanvasV2 content={compatibilityContent} viewId={activeView.id} selectedId={selectedId} onSelect={setSelectedId} onNodeMove={moveCanvasNode} resolveAssetUrl={resolveAssetUrl} parameterDefaults={effectivePreviewParameterValues} />}
          <aside className="library-properties"><h3>{selected?.node ? nodeLabel(selected.node) : selectedContactPoint && selectedLogicalContact ? `Контакт №${selectedLogicalContact.number}` : selectedBundlePort ? "Общий выход пучка" : activeLayer ? "Слой" : "Вид"}</h3>
            {!selected?.node && !selectedPoint && activeView && <ViewAndLayerProperties content={draft.content} viewId={activeView.id} layerId={activeLayer?.id ?? null} change={changeContent} command={command} selectLayer={id => setActiveLayerIds(current => ({ ...current, [activeView.id]: id }))} selectView={setViewId} />}
             {selectedContactPoint && selectedLogicalContact && activeView && <ContactPointProperties
               point={selectedContactPoint}
               logical={selectedLogicalContact}
               groups={draft.content.contactTypeGroups}
               editLogical={changes => command(() => editLogicalContactV2(draft.content, selectedLogicalContact.id, changes))}
               editPoint={changes => command(() => editContactPointV2(draft.content, activeView.id, selectedContactPoint.id, changes))}
               remove={() => command(() => deleteContactPointV2(draft.content, activeView.id, selectedContactPoint.id), null)}
             />}
             {selectedContactPoint && !selectedLogicalContact && <p className="readonly-note">Логический контакт точки не найден. Проверьте диагностику шаблона.</p>}
             {selectedBundlePort && activeView && <BundlePortProperties port={selectedBundlePort} edit={changes => command(() => editBundlePortV2(draft.content, activeView.id, selectedBundlePort.id, changes))} remove={() => command(() => deleteBundlePortV2(draft.content, activeView.id, selectedBundlePort.id), null)} />}
            {selected?.node && !editableNode && <><p className="readonly-note">Сложный или параметризованный объект доступен только для чтения. Его данные сохраняются без потерь.</p><label>Тип<input value={selected.node.kind} readOnly /></label></>}
            {editableNode && selected && <NodeProperties node={editableNode} disabled={selected.layer.locked || editableNode.locked} edit={changes => command(() => editNodeV2(draft.content, activeView!.id, selected.layer.id, editableNode.id, changes))} move={(x, y) => command(() => setNodePosition(draft.content, activeView!.id, selected.layer.id, editableNode, x, y))} toggleLock={() => command(() => setNodeLockedV2(draft.content, activeView!.id, selected.layer.id, editableNode.id, !editableNode.locked))} />}
            {selected && <><div className="property-order"><button onClick={() => command(() => reorderNodeV2(draft.content, activeView!.id, selected.layer.id, selected.node.id, 0))} disabled={selected.layer.locked || selected.node.locked}>На задний план</button><button onClick={() => command(() => reorderNodeV2(draft.content, activeView!.id, selected.layer.id, selected.node.id, selected.layer.nodes.length - 1))} disabled={selected.layer.locked || selected.node.locked}>На передний план</button></div><button className="danger-action" onClick={() => command(() => deleteNodeV2(draft.content, activeView!.id, selected.layer.id, selected.node.id), null)} disabled={selected.layer.locked || selected.node.locked}>Удалить объект</button></>}
          </aside>
        </div>
      </section>
    </div>
  </div>;
}

function ViewAndLayerProperties({ content, viewId, layerId, change, command, selectLayer, selectView }: { content: TemplateContentV2; viewId: string; layerId: string | null; change: (content: TemplateContentV2, selection?: string | null) => void; command: (action: () => TemplateContentV2, selection?: string | null) => void; selectLayer: (id: string) => void; selectView: (id: string) => void }) {
  const view = content.views.find(item => item.id === viewId)!, layer = view.layers.find(item => item.id === layerId);
  return <><label>Название вида<input value={view.name} onChange={event => command(() => renameViewV2(content, view.id, event.target.value))} /></label>{view.kind === "additional" && <button className="danger-action" onClick={() => { const fallback = content.views.find(item => item.id !== view.id)!; command(() => deleteAdditionalViewV2(content, view.id), null); selectView(fallback.id); }}>Удалить дополнительный вид</button>}{layer && <><label>Название слоя<input value={layer.name} disabled={layer.locked} onChange={event => command(() => renameLayerV2(content, view.id, layer.id, event.target.value))} /></label><div className="property-order"><button disabled={layer.locked || view.layers[0]!.id === layer.id} onClick={() => command(() => reorderLayerV2(content, view.id, layer.id, view.layers.indexOf(layer) - 1))}>Выше</button><button disabled={layer.locked || view.layers.at(-1)!.id === layer.id} onClick={() => command(() => reorderLayerV2(content, view.id, layer.id, view.layers.indexOf(layer) + 1))}>Ниже</button></div><button className="danger-action" disabled={layer.locked || view.layers.length === 1} onClick={() => { const fallback = view.layers.find(item => item.id !== layer.id)!; change(deleteLayerV2(content, view.id, layer.id), null); selectLayer(fallback.id); }}>Удалить слой</button></>}</>;
}

function ContactPointProperties({ point, logical, groups, editLogical, editPoint, remove }: { point: ViewContactPointV2; logical: LogicalContactV2; groups: TemplateContentV2["contactTypeGroups"]; editLogical: (changes: LogicalContactEditV2) => void; editPoint: (changes: ContactPointEditV2) => void; remove: () => void }) {
  const x = constantValue(point.x), y = constantValue(point.y);
  return <>
    <strong>Общие данные контакта</strong>
    <label>Номер контакта<input value={logical.number} onChange={event => editLogical({ number: event.target.value })} /></label>
    <label>Название<input value={logical.name} onChange={event => editLogical({ name: event.target.value })} /></label>
    <label>Цепь<input value={logical.circuitText ?? ""} onChange={event => editLogical({ circuitText: event.target.value })} placeholder="Например, DATA+" /></label>
    <label>Группа контакта<select value={logical.contactTypeGroupId ?? ""} onChange={event => editLogical({ contactTypeGroupId: event.target.value || null })}><option value="">Не задана</option>{groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
    <strong>Точка в активном виде</strong>
    {x !== null && y !== null ? <div className="coordinate-grid">
      <NumericField label="X" value={x} change={value => editPoint({ x: constantExpressionV2(value) })} />
      <NumericField label="Y" value={y} change={value => editPoint({ y: constantExpressionV2(value) })} />
    </div> : <p className="readonly-note">Положение задано параметрами и сохраняется только для чтения.</p>}
    <label>Направление<select value={point.direction} onChange={event => editPoint({ direction: event.target.value as ContactDirectionV2 })}><option value="left">Влево</option><option value="right">Вправо</option><option value="up">Вверх</option><option value="down">Вниз</option></select></label>
    <button className="danger-action" type="button" onClick={remove}>Удалить точку из вида</button>
  </>;
}

function BundlePortProperties({ port, edit, remove }: { port: BundlePortV2; edit: (changes: BundlePortEditV2) => void; remove: () => void }) {
  const x = constantValue(port.x), y = constantValue(port.y);
  return <>
    <label>Название<input value={port.name} onChange={event => edit({ name: event.target.value })} /></label>
    {x !== null && y !== null ? <div className="coordinate-grid">
      <NumericField label="X" value={x} change={value => edit({ x: constantExpressionV2(value) })} />
      <NumericField label="Y" value={y} change={value => edit({ y: constantExpressionV2(value) })} />
    </div> : <p className="readonly-note">Положение задано параметрами и сохраняется только для чтения.</p>}
    <label>Направление<select value={port.direction} onChange={event => edit({ direction: event.target.value as ContactDirectionV2 })}><option value="left">Влево</option><option value="right">Вправо</option><option value="up">Вверх</option><option value="down">Вниз</option></select></label>
    <p className="readonly-note">Общий выход связывает геометрию жгута и не создаёт электрический контакт.</p>
    <button className="danger-action" type="button" onClick={remove}>Удалить общий выход из вида</button>
  </>;
}

function NodeProperties({ node, disabled, edit, move, toggleLock }: { node: EditableNode; disabled: boolean; edit: (changes: NodeEditV2) => void; move: (x: number, y: number) => void; toggleLock: () => void }) {
  const position = nodePosition(node), dimensions = nodeDimensions(node);
  return <><button type="button" onClick={toggleLock}>{node.locked ? "Разблокировать объект" : "Заблокировать объект"}</button><div className="coordinate-grid"><NumericField label="X" value={position.x} disabled={disabled} change={value => move(value, position.y)} /><NumericField label="Y" value={position.y} disabled={disabled} change={value => move(position.x, value)} />{dimensions && <><NumericField label="Ширина" value={dimensions.width} disabled={disabled} change={value => editDimension(node, "width", value, edit)} /><NumericField label="Высота" value={dimensions.height} disabled={disabled} change={value => editDimension(node, "height", value, edit)} /></>}</div><NumericField label="Прозрачность 0…1" value={node.opacity} disabled={disabled} change={value => { if (value >= 0 && value <= 1) edit({ opacity: value }); }} />{node.kind === "text" && <label>Текст<input value={node.geometry.text} disabled={disabled} onChange={event => edit({ geometry: { ...node.geometry, text: event.target.value } })} /></label>}{node.kind === "image" && <ImageProperties node={node} disabled={disabled} edit={edit} />}</>;
}

function ImageProperties({ node, disabled, edit }: { node: ImageNodeV2; disabled: boolean; edit: (changes: NodeEditV2) => void }) {
  const crop = (key: "cropX" | "cropY" | "cropWidth" | "cropHeight", value: number) => { if (value >= 0 && value <= 1) edit({ geometry: { ...node.geometry, [key]: value } }); };
  return <><label className="check-field"><input type="checkbox" checked={node.geometry.underlay} disabled={disabled} onChange={event => edit({ geometry: { ...node.geometry, underlay: event.target.checked } })} />Подложка</label><div className="coordinate-grid"><NumericField label="Crop X" value={node.geometry.cropX} disabled={disabled} change={value => crop("cropX", value)} /><NumericField label="Crop Y" value={node.geometry.cropY} disabled={disabled} change={value => crop("cropY", value)} /><NumericField label="Crop ширина" value={node.geometry.cropWidth} disabled={disabled} change={value => crop("cropWidth", value)} /><NumericField label="Crop высота" value={node.geometry.cropHeight} disabled={disabled} change={value => crop("cropHeight", value)} /></div></>;
}

function NumericField({ label, value, disabled, change }: { label: string; value: number; disabled?: boolean; change: (value: number) => void }) {
  return <label>{label}<input type="number" value={value} disabled={disabled} onChange={event => { const parsed = Number(event.target.value); if (Number.isFinite(parsed)) change(parsed); }} /></label>;
}

function nodeLabel(node: TemplateNodeV2) { return ({ line: "Линия", polyline: "Ломаная", rectangle: "Прямоугольник", ellipse: "Эллипс", bezier: "Кривая Безье", closedContour: "Контур", text: "Текст", image: "Изображение", group: "Группа" })[node.kind]; }
function nodePosition(node: EditableNode) { const tx = constantValue(node.transform.translateX)!, ty = constantValue(node.transform.translateY)!; if (node.kind === "line") return { x: constantValue(node.geometry.points[0]!.x)! + tx, y: constantValue(node.geometry.points[0]!.y)! + ty }; if (node.kind === "ellipse") return { x: constantValue(node.geometry.centerX)! - constantValue(node.geometry.radiusX)! + tx, y: constantValue(node.geometry.centerY)! - constantValue(node.geometry.radiusY)! + ty }; return { x: constantValue(node.geometry.x)! + tx, y: constantValue(node.geometry.y)! + ty }; }
function nodeDimensions(node: EditableNode): { width: number; height: number } | null { if (node.kind === "line" || node.kind === "text") return null; if (node.kind === "ellipse") return { width: constantValue(node.geometry.radiusX)! * 2, height: constantValue(node.geometry.radiusY)! * 2 }; return { width: constantValue(node.geometry.width)!, height: constantValue(node.geometry.height)! }; }

function setNodePosition(content: TemplateContentV2, viewId: string, layerId: string, node: EditableNode, x: number, y: number): TemplateContentV2 {
  const current = nodePosition(node);
  return moveNodeV2(content, viewId, layerId, node.id, x - current.x, y - current.y);
}
function editDimension(node: EditableNode, key: "width" | "height", value: number, edit: (changes: NodeEditV2) => void) { if (value <= 0 || node.kind === "line" || node.kind === "text") return; const c = constantExpressionV2; if (node.kind === "ellipse") edit({ geometry: { ...node.geometry, [key === "width" ? "radiusX" : "radiusY"]: c(value / 2) } }); else edit({ geometry: { ...node.geometry, [key]: c(value) } }); }
