import { DrawingGeneratorPanel } from "./DrawingGeneratorPanel";
import { newDrawingGenerator, reconcileDrawingGenerators, generatorFromLegacyArray, assignGeneratorRole, guardGeneratorArticleEdit, materializeGenerator, validateDrawingGenerators, type DrawingGenerator, type GeneratorRole } from "./drawing-generator";
import { validateArticleDrawingContacts } from "./drawing-contact-validation";
import { drawingArrayContactRows } from "./drawing-array-contacts";
import { DrawingSelectionProperties } from "./DrawingSelectionProperties";
import { useInternalDrawingClipboard, copyDrawingSelection, pasteDrawingSelection, deleteDrawingSelection, moveDrawingSelection, stretchDrawingSelection, rotateDrawingSelection, styleDrawingSelection, drawingKeyboardAction, type DrawingClipboard } from "./drawing-selection";
import { E4ArticlePreview } from "./E4ArticlePreview";
import { InfoHint } from "../InfoHint";
import { defaultDrawingSnaps } from "./drawing-geometry";
import { DrawingToolIcon, drawingToolLabels } from "./DrawingToolIcon";
import { hatchKinds, hatchLabels, type DrawingHatch } from "./drawing-hatch";
import { drawingSelection, articleDrawingView, drawingContactContent, type ArticleDrawing, type DrawingContactBinding, type DrawingTarget, findArticleDrawing, separateLegacyDrawings } from "./drawing-bindings";
import { withDrawingArticleCounts } from "./drawing-array-commands";
import { DrawingArrayPanel } from "./DrawingArrayPanel";
import type { ConnectorSchematicPresentation } from "../editor/model";
import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import type { LocalSession } from "../local-session";
import type { RuntimeConfig } from "../runtime-config";
import {
  createReferenceCatalogApi,
  ReferenceCatalogApiError,
  type ReferenceCatalogApi,
  type ReferenceCatalogSearchRecord,
  type ReferenceCatalogSearchRequest,
} from "../reference-catalog-api";
import { createComponentTemplateApi, type ArticleBinding, type ComponentTemplate, type ComponentTemplateDraft, type ComponentTemplateSummary, type TemplateAsset } from "./component-template-api";
import { IMAGE_IMPORT_ACCEPT, importDrawingImage } from "./image-import";
import { addAdditionalViewV3 } from "./template-commands-v3";
import { isTemplateContentV1, isTemplateContentV2, isTemplateContentV3, isTemplateContentV4, isTemplateContentV5, reconcileTemplateEnvelopeAssets, upgradeComponentTemplateContentV1ToV3, upgradeComponentTemplateContentV2 } from "./template-content";
import { createE4ConnectorSeriesTableFromV3, materializeE4ConnectorArticle, setArticleContactGroupStandardTerminal, type E4ConnectorSeriesTable } from "./e4-connector-series-table";
import { TemplateCanvasV2, type TemplatePointAngleModeV2 } from "./TemplateCanvasV2";
import { TemplateContactsPanelV2 } from "./TemplateContactsPanelV2";
import { TemplateLayersPanelV2 } from "./TemplateLayersPanelV2";
import { TemplateParametersPanelV2 } from "./TemplateParametersPanelV2";
import {
  CONNECTOR_ARTICLE_ENTITY_V3,
  CONNECTOR_REFERENCE_SOURCE_V3,
  TERMINAL_ARTICLE_ENTITY_V3,
  TERMINAL_REFERENCE_SOURCE_V3,
  TemplateSeriesPanelV3,
  standardTerminalKeyV3,
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
  moveNodeV3 as moveNodeV2, moveNodePointV3, insertNodePointV3, deleteNodePointV3,
  groupRootNodesV3, ungroupRootNodeV3, reorderRootNodeStepV3, setRootNodeRotationAroundCenterV3,
  resizeNodeV3 as resizeNodeV2, newTemplateContentV3 as newTemplateContentV2,
  parameterizeNodeDimensionV3 as parameterizeNodeDimensionV2, projectTemplateContentV3CoreToV2,
  addArticleVariantsV3, removeArticleVariantContactGroupV3, removeArticleVariantV3, renameContactTypeGroupV3,
  renameLayerV3 as renameLayerV2, renameViewV3 as renameViewV2, reorderLayerV3 as reorderLayerV2,
  setArticleVariantContactGroupV3, setLayerLockedV3 as setLayerLockedV2,
  setLayerVisibleV3 as setLayerVisibleV2, setNodeLockedV3 as setNodeLockedV2,
  setRepeatCountV3 as setRepeatCountV2, setRepeatStepV3 as setRepeatStepV2,
  setTemplateParameterDefaultV3 as setTemplateParameterDefaultV2, upsertArticleVariantV3,
  type BasicNodeKindV3 as BasicNodeKindV2, type BundlePortEditV3 as BundlePortEditV2,
  type ContactPointEditV3 as ContactPointEditV2, type LogicalContactEditV3 as LogicalContactEditV2,
  type NodeEditV3 as NodeEditV2,
  type NodeResizeHandleV3 as NodeResizeHandleV2,
} from "./template-commands-v3";
import { type ContactDirectionV2, type ImageNodeV2, type ParameterValueV2, type TemplateContentV2 as LegacyTemplateContentV2, type TemplateV2Diagnostic } from "./template-model-v2";
import { type BundlePortV3 as BundlePortV2, type LogicalContactV3 as LogicalContactV2, type NumericExpressionV3 as NumericExpressionV2, type TemplateContentV3 as TemplateContentV2, type TemplateNodeV3 as TemplateNodeV2, type ViewContactPointV3 as ViewContactPointV2 } from "./template-model-v3";
import { type TemplateContentV4 } from "./template-model-v4";
import { createTemplateContentV5FromEditor, projectTemplateContentV5TableToV1, projectTemplateContentV5ToV3, type TerminalContactTypeBindingV5 } from "./template-model-v5";
import { expandTemplateRepeatsV2 } from "./template-repeat-v2";
import "./component-library.css";

interface Props { config: RuntimeConfig; session: LocalSession; }
interface Draft { drawingGenerators?: DrawingGenerator[]; e4Presentation?: ConnectorSchematicPresentation; articleDrawings?: ArticleDrawing[]; drawingContactBindings?: DrawingContactBinding[]; templateId: string | null; version: number; draftRevision: number; code: string; name: string; assets: TemplateAsset[]; content: TemplateContentV2; compatibleTerminalArticleKeys: ArticleBinding[]; terminalContactTypeBindings: TerminalContactTypeBindingV5[] | null; e4ConnectorTable: E4ConnectorSeriesTable; }

export const TEMPLATE_UNDO_LIMIT = 100;
export function pushTemplateUndo(stack: readonly TemplateContentV2[], current: TemplateContentV2): TemplateContentV2[] {
  return [...stack.slice(-(TEMPLATE_UNDO_LIMIT - 1)), current];
}
type LoadedTemplate = Pick<ComponentTemplate, "templateId" | "code" | "name" | "articleBindings" | "assets" | "content"> & { readonly version: number; readonly draftRevision: number };
type EditableNode = Extract<TemplateNodeV2, { kind: "line" | "polyline" | "rectangle" | "ellipse" | "bezier" | "closedContour" | "text" | "image" }>;

const newDraft = (): Draft => {
  const content = newTemplateContentV2();
  return { articleDrawings: [], drawingContactBindings: [], templateId: null, version: 0, draftRevision: 0, code: "", name: "Новый компонент", assets: [], content, compatibleTerminalArticleKeys: [], terminalContactTypeBindings: [], e4ConnectorTable: createE4ConnectorSeriesTableFromV3(content) };
};
const firstLayerIds = (content: TemplateContentV2) => Object.fromEntries(content.views.map(view => [view.id, view.layers[0]!.id]));
const errorText = (error: unknown) => error instanceof Error ? error.message : "Неизвестная ошибка.";
const constantValue = (expression: NumericExpressionV2) => expression.kind === "constant" ? expression.value : null;

export function reconcileE4ConnectorTable(content: TemplateContentV2, previous?: E4ConnectorSeriesTable): E4ConnectorSeriesTable {
  const next = createE4ConnectorSeriesTableFromV3(content, true);
  if (!previous) return next;
  const previousDefaults = new Map(previous.seriesDefaults.map(row => [row.rowId, row]));
  const previousArticles = new Map(previous.articles.map(article => [article.articleVariantId, article]));
  return {
    ...next,
    columns: next.columns.map(column => previous.columns.find(item => item.id === column.id) ?? column),
    seriesDefaults: next.seriesDefaults.map(row => {
      const old = previousDefaults.get(row.rowId);
      return old && (old.values.contactTypeGroupId === null || content.contactTypeGroups.some(group => group.id === old.values.contactTypeGroupId)) ? old : row;
    }),
    articles: next.articles.map(article => {
      const old = previousArticles.get(article.articleVariantId);
      if (!old) return article;
      const oldRows = new Map(old.rows.map(row => [row.seriesRowId, row]));
      return { ...article, rows: article.rows.map(row => {
        const oldRow = oldRows.get(row.seriesRowId);
        return oldRow && (oldRow.overrides.contactTypeGroupId == null || content.contactTypeGroups.some(group => group.id === oldRow.overrides.contactTypeGroupId)) ? oldRow : row;
      }) };
    }),
  };
}

function v3CoreFromV4(content: TemplateContentV4): TemplateContentV2 {
  const { schemaVersion: _schemaVersion, e4ConnectorTable: _table, ...core } = content;
  return { schemaVersion: 3, ...structuredClone(core) };
}

function compatibleTerminalsFromV3(content: TemplateContentV2): ArticleBinding[] {
  const result: ArticleBinding[] = [], seen = new Set<string>();
  for (const terminal of content.articleVariants.flatMap(variant =>
    (variant.contactGroups ?? []).flatMap(group => group.allowedTerminalArticleKeys))) {
    const identity = articleIdentity(terminal);
    if (!seen.has(identity)) { seen.add(identity); result.push({ ...terminal }); }
  }
  return result;
}

export function applySeriesTerminalsToEditor(
  content: TemplateContentV2,
  table: E4ConnectorSeriesTable,
  terminals: readonly ArticleBinding[],
  bindings: readonly TerminalContactTypeBindingV5[] | null = null,
  updateStandards = false,
): { content: TemplateContentV2; table: E4ConnectorSeriesTable } {
  const allowed = new Set(terminals.map(articleIdentity));
  const terminalsForGroup = (groupId: string) => terminals.filter(terminal =>
    bindings === null || bindings.some(binding => binding.contactTypeGroupId === groupId &&
      articleIdentity(binding.terminalArticleKey) === articleIdentity(terminal)));
  const terminalAllowedForGroup = (terminal: ArticleBinding | null, groupId: string | null) => terminal === null ||
    (allowed.has(articleIdentity(terminal)) && (bindings === null || (groupId !== null && bindings.some(binding =>
      binding.contactTypeGroupId === groupId && articleIdentity(binding.terminalArticleKey) === articleIdentity(terminal)))));
  const defaultsById = new Map(table.seriesDefaults.map(row => [row.rowId, row.values]));
  return {
    content: {
      ...content,
      articleVariants: content.articleVariants.map(variant => ({
        ...variant,
        contactGroups: variant.contactGroups?.map(group => ({
          ...group,
          allowedTerminalArticleKeys: terminalsForGroup(group.contactTypeGroupId).map(item => ({ ...item })),
        })) ?? null,
      })),
    },
    table: {
      ...table,
      seriesDefaults: table.seriesDefaults.map(row => ({
        ...row,
        values: {
          ...row.values,
          standardTerminalArticleKey: !updateStandards || bindings === null
            ? (terminalAllowedForGroup(row.values.standardTerminalArticleKey, row.values.contactTypeGroupId) ? row.values.standardTerminalArticleKey : null)
            : bindings.find(binding => binding.standard && binding.contactTypeGroupId === row.values.contactTypeGroupId)?.terminalArticleKey ?? null,
        },
      })),
      articles: table.articles.map(article => ({
        ...article,
        contactGroups: article.contactGroups.map(group => ({
          ...group,
          allowedTerminalArticleKeys: terminalsForGroup(group.contactTypeGroupId).map(item => ({ ...item })),
        })),
        rows: article.rows.map(row => ({
          ...row,
          overrides: row.overrides.standardTerminalArticleKey !== undefined &&
            !terminalAllowedForGroup(row.overrides.standardTerminalArticleKey ?? null,
              row.overrides.contactTypeGroupId ?? defaultsById.get(row.seriesRowId)?.contactTypeGroupId ?? null)
            ? { ...row.overrides, standardTerminalArticleKey: null }
            : row.overrides,
        })),
      })),
    },
  };
}

/** XX sets the first contact type count; other groups remain operator-controlled. */
export function addSeriesArticles(content: TemplateContentV2, inputs: readonly NewArticleVariantV3Input[]): TemplateContentV2 {
  let base = content;
  if (inputs.some(input => input.contactCount !== undefined) && !base.contactTypeGroups.length)
    [base] = addContactTypeGroupV3(base, "Сигнальные");
  let next = addArticleVariantsV3(base, inputs);
  inputs.forEach((input, index) => {
    if (input.contactCount === undefined) return;
    const variant = next.articleVariants[base.articleVariants.length + index]!;
    next = setArticleVariantContactGroupV3(next, variant.id, base.contactTypeGroups[0]!.id, input.contactCount, []);
  });
  return next;
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

/** Human readable БД.ТЕР identity: manufacturer + reel article + series. */
export function terminalCatalogLabel(record: ReferenceCatalogSearchRecord): string {
  const text = (key: string) => typeof record.payload[key] === "string" ? record.payload[key].trim() : "";
  const fromPayload = [text("manufacturer"), text("reelArticle"), text("series")].filter(Boolean);
  if (fromPayload.length) return fromPayload.join(" ");
  const composite = compositeSourceKeyParts(record.sourceKey);
  const fromKey = composite ? [composite[0], composite[1], composite[3]].filter(Boolean) : [];
  return fromKey.length ? fromKey.join(" ") : record.sourceKey;
}

export function shouldAutoSaveTemplate(input: {
  readonly dirty: boolean;
  readonly failed: boolean;
  readonly busy: boolean;
  readonly assetMismatch: boolean;
  readonly code: string;
  readonly name: string;
}): boolean {
  return input.dirty && !input.failed && !input.busy && !input.assetMismatch &&
    Boolean(input.code.trim()) && Boolean(input.name.trim());
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
  if (node.kind === "line" || node.kind === "polyline" || node.kind === "bezier" || node.kind === "closedContour") return node.geometry.points.every(point => constant(point.x) && constant(point.y));
  if (node.kind === "rectangle") return [node.geometry.x, node.geometry.y, node.geometry.width, node.geometry.height].every(constant);
  if (node.kind === "ellipse") return [node.geometry.centerX, node.geometry.centerY, node.geometry.radiusX, node.geometry.radiusY].every(constant);
  if (node.kind === "text") return [node.geometry.x, node.geometry.y, node.geometry.fontSize].every(constant);
  if (node.kind === "image") return [node.geometry.x, node.geometry.y, node.geometry.width, node.geometry.height].every(constant);
  return false;
}

export function nextTemplateSelectionV2(current: readonly string[], id: string | null, extend: boolean): readonly string[] {
  if (!id) return [];
  if (!extend) return [id];
  return current.includes(id) ? current.filter(candidate => candidate !== id) : [...current, id];
}

export function ComponentLibrary({ config, session }: Props) {
  const api = useMemo(() => createComponentTemplateApi(config, session), [config, session]);
  const referenceApi = useMemo(() => createReferenceCatalogApi(config, session), [config, session]);
  const [items, setItems] = useState<readonly ComponentTemplateSummary[]>([]);
  const [draft, setDraft] = useState<Draft>(() => newDraft());
  const [viewId, setViewId] = useState(() => draft.content.views[0]!.id);
  const [activeLayerIds, setActiveLayerIds] = useState<Record<string, string>>(() => firstLayerIds(draft.content));
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const selectedId = selectedIds.at(-1) ?? null;
  const setSelectedId = (id: string | null) => setSelectedIds(id ? [id] : []);
  const [busy, setBusy] = useState(false);
  const [drawingTarget,setDrawingTarget]=useState<DrawingTarget>("drawing");
  const [removeDrawingPrompt,setRemoveDrawingPrompt]=useState(false);
  const [dirty, setDirty] = useState(true);
  const [autoSaveFailed, setAutoSaveFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<readonly TemplateV2Diagnostic[]>([]);
  const [upgradedFromV1, setUpgradedFromV1] = useState(false);
  const [assetMismatch, setAssetMismatch] = useState(false);
  const [undoStack, setUndoStack] = useState<Draft[]>([]);
  const [previewParameterValues, setPreviewParameterValues] = useState<Readonly<Record<string, number>>>({});
  const [selectedArticleVariantId, setSelectedArticleVariantId] = useState<string | null>(null);
  const [pendingLogicalContactId, setPendingLogicalContactId] = useState<string | null>(null);
  const [terminalArticleQuery, setTerminalArticleQuery] = useState("");
  const [terminalArticleSuggestions, setTerminalArticleSuggestions] = useState<readonly ArticleBinding[]>([]);
  const [terminalArticleSearchState, setTerminalArticleSearchState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [terminalArticleSearchMessage, setTerminalArticleSearchMessage] = useState<string | null>(null);
  const [pointAngleMode, setPointAngleMode] = useState<TemplatePointAngleModeV2>("snap-15");
  const [graphicEditorMode, setGraphicEditorMode] = useState<"e4" | "drawing">("e4");
  const clipboard = useRef<DrawingClipboard | null>(null);
  const [generatorPreviewPeriods,setGeneratorPreviewPeriods]=useState<number|undefined>();
  const [generatorMode, setGeneratorMode] = useState<"source" | "article">("source");
  const [drawingTab, setDrawingTab] = useState("tools");
  const [propertyTab, setPropertyTab] = useState<"geometry" | "stroke" | "fill">("geometry");
  const textEditorRef = useRef<HTMLInputElement | null>(null);
  const clipboardToken=useRef<string|null>(null);
  const clipboardSynchronized=useRef(false);
  const [hasClipboard,setHasClipboard] = useState(false);
  const pasteCount=useRef(0);
  const [drawingSnaps, setDrawingSnaps] = useState(defaultDrawingSnaps);

  const activeView = draft.content.views.find(view => view.id === viewId) ?? draft.content.views[0];
  const activeGenerator = draft.drawingGenerators?.find(g=>g.viewId===activeView?.id);
  const generatorArticleMode = graphicEditorMode === "drawing" && !!activeGenerator && generatorMode === "article";
  const e4View = draft.content.views.find(view => view.kind === "e4");
  const drawingView = draft.content.views.find(view => view.kind === "drawing");
  const activeLayerId = activeView ? activeLayerIds[activeView.id] ?? activeView.layers[0]!.id : null;
  const activeLayer = activeView?.layers.find(layer => layer.id === activeLayerId) ?? activeView?.layers[0];
  const selected = activeView?.layers.flatMap(layer => layer.nodes.map(node => ({ layer, node }))).find(item => item.node.id === selectedId);
  const selectedNodeIds = activeView
    ? selectedIds.filter(id => activeView.layers.some(layer => layer.nodes.some(node => node.id === id)))
    : [];
  const selectedNodes = activeView?.layers.flatMap(layer => layer.nodes.filter(node => selectedNodeIds.includes(node.id))) ?? [];
  const generatedSelection = generatorArticleMode && selectedIds.some(id=>id.startsWith("generator:"));
  const selectionLocked = generatedSelection || (activeView?.layers.some(layer => layer.nodes.some(node => selectedNodeIds.includes(node.id) && (node.locked || layer.locked))) ?? true);
  const selectedContactPoint = activeView?.contactPoints.find(point => point.id === selectedId);
  const selectedBundlePort = activeView?.bundlePorts.find(point => point.id === selectedId);
  const selectedPoint = selectedContactPoint ?? selectedBundlePort;
  const selectedLogicalContact = selectedContactPoint ? draft.content.logicalContacts.find(contact => contact.id === selectedContactPoint.logicalContactId) : undefined;
  const editableNode = selectedIds.length === 1 && selected?.node && isEditableConstantNode(selected.node) ? selected.node : null;
  const previewDrawingCore = useMemo(() => drawingContactContent(draft.content, draft.e4ConnectorTable, draft.drawingContactBindings ?? [], selectedArticleVariantId), [draft.content, draft.e4ConnectorTable, draft.drawingContactBindings, selectedArticleVariantId]);
  const repeatedContactLabels=useMemo(()=>{
    try{return Object.fromEntries(drawingArrayContactRows(previewDrawingCore,draft.e4ConnectorTable,draft.drawingContactBindings??[],selectedArticleVariantId).map(item=>[`${item.viewId}:${item.point.key}`,item.row?{number:item.row.number,name:item.row.name}:null]));}catch{return {};}
  },[previewDrawingCore,draft.e4ConnectorTable,draft.drawingContactBindings,selectedArticleVariantId]);
  const compatibilityContent = useMemo(() => projectTemplateContentV3CoreToV2(previewDrawingCore), [previewDrawingCore]);
  const drawingTableRows = selectedArticleVariantId ? materializeE4ConnectorArticle(draft.e4ConnectorTable, selectedArticleVariantId).rows : draft.e4ConnectorTable.seriesDefaults.map(row => ({ ...row.values, seriesRowId: row.rowId }));
  const selectedRowBinding = draft.drawingContactBindings?.find(binding => binding.logicalContactId === selectedLogicalContact?.id);
  const selectedTableRow = drawingTableRows.find(row => row.seriesRowId === selectedRowBinding?.seriesRowId);
  const articlePreview = useMemo(() => {
    if (!selectedArticleVariantId) return { values: {} as Readonly<Record<string, ParameterValueV2>>, rows: [], message: null, error: null };
    try {
      const graphic = withDrawingArticleCounts(draft.content);
      const graphicCore = { ...graphic, articleVariants: graphic.articleVariants.map(item => ({ ...item, contactGroups: null })) };
      const materialized = materializeArticleVariantV3(graphicCore, selectedArticleVariantId);
      const rows = materializeArticleContactRowsV3(graphicCore, materialized.variant);
      const groupNames = new Map(draft.content.contactTypeGroups.map(group => [group.id, group.name]));
      const counts = materialized.repeatCounts.map(item => `${groupNames.get(item.contactTypeGroupId) ?? "Группа"}: ${item.requestedContactCount}`);
      const configured = materialized.variant.contactGroups?.reduce((sum, group) => sum + group.contactCount, 0);
      const summary = counts.length ? counts.join(" · ") : configured === undefined ? "используются параметры шаблона" : `${configured} контактов`;
      return { values: materialized.overrides, rows, message: `${materialized.variant.articleKey}: ${summary}`, error: null };
    } catch (caught) {
      return { values: {} as Readonly<Record<string, ParameterValueV2>>, rows: [], message: null, error: errorText(caught) };
    }
  }, [draft.content, selectedArticleVariantId]);
  const e4PreviewContent = useMemo(() => {
    try { return createTemplateContentV5FromEditor(draft.content, draft.e4ConnectorTable, draft.compatibleTerminalArticleKeys, draft.terminalContactTypeBindings, draft.e4Presentation, draft.articleDrawings, draft.drawingContactBindings, draft.drawingGenerators).content; }
    catch { return null; }
  }, [draft.content, draft.e4ConnectorTable, draft.compatibleTerminalArticleKeys, draft.terminalContactTypeBindings, draft.e4Presentation, draft.articleDrawings, draft.drawingContactBindings, draft.drawingGenerators]);
  const effectivePreviewParameterValues = useMemo<Readonly<Record<string, ParameterValueV2>>>(() => ({
    ...previewParameterValues,
    ...articlePreview.values,
  }), [articlePreview.values, previewParameterValues]);
  const standardTerminalArticleKeys = useMemo(() => {
    const result: Record<string, ArticleBinding | null> = {};
    for (const article of draft.e4ConnectorTable.articles) {
      const materialized = materializeE4ConnectorArticle(draft.e4ConnectorTable, article.articleVariantId);
      for (const group of draft.e4ConnectorTable.contactTypeGroups) {
        const rows = materialized.rows.filter(row => row.contactTypeGroupId === group.id);
        const first = rows[0]?.standardTerminalArticleKey ?? null;
        result[standardTerminalKeyV3(article.articleVariantId, group.id)] = rows.length > 0 && rows.every(row =>
          articleIdentity(row.standardTerminalArticleKey ?? { sourceId: "", entityType: "", articleKey: "" }) ===
          articleIdentity(first ?? { sourceId: "", entityType: "", articleKey: "" })) ? first : null;
      }
    }
    return result;
  }, [draft.e4ConnectorTable]);
  const terminalContactTypeGroupIds = useMemo(() => {
    const result: Record<string, string | null> = {};
    for (const terminal of draft.compatibleTerminalArticleKeys) result[articleIdentity(terminal)] = null;
    for (const binding of draft.terminalContactTypeBindings ?? [])
      result[articleIdentity(binding.terminalArticleKey)] = binding.contactTypeGroupId;
    return result;
  }, [draft.compatibleTerminalArticleKeys, draft.terminalContactTypeBindings]);
  const standardTerminalIdentities = useMemo(() => new Set((draft.terminalContactTypeBindings ?? [])
    .filter(binding => binding.standard).map(binding => articleIdentity(binding.terminalArticleKey))),
  [draft.terminalContactTypeBindings]);

  let generatedPreview: ReturnType<typeof materializeGenerator> | null = null;
  let generatorPreviewError = "Выберите артикул и назначьте роли";
  if(activeGenerator && selectedArticleVariantId) try { generatedPreview=materializeGenerator(draft.content,draft.e4ConnectorTable,draft.drawingContactBindings??[],activeGenerator,selectedArticleVariantId,generatorMode==="source"?generatorPreviewPeriods:undefined); } catch(caught){generatorPreviewError=errorText(caught);}
  function createGenerator() {
    if(!activeView)return;
    if(!activeView.repeatPlacements.length){changeGenerator(newDrawingGenerator(activeView.id,drawingTarget));return;}
    try {
      const result=generatorFromLegacyArray(draft.content,activeView.id,drawingTarget);
      setUndoStack(stack=>[...stack.slice(-(TEMPLATE_UNDO_LIMIT-1)),draft]);
      setDraft(current=>({...current,content:result.content,drawingGenerators:[...(current.drawingGenerators??[]),result.generator]}));
      setViewId(result.generator.viewId);setSelectedIds([]);markDirty();setError(null);
    }catch(caught){setError(errorText(caught));}
  }
  function changeGenerator(generator: DrawingGenerator, replaceArticleIds: string[] = []) {
    const generators=[...(draft.drawingGenerators??[]).filter(g=>g.id!==generator.id),generator];
    try { validateDrawingGenerators(draft.content,draft.e4ConnectorTable,generators); }
    catch(caught){setError(errorText(caught));return;}
    setUndoStack(stack=>[...stack.slice(-(TEMPLATE_UNDO_LIMIT-1)),draft]);
    setDraft(current=>({...current,drawingGenerators:generators,articleDrawings:current.articleDrawings?.filter(d=>!(replaceArticleIds.includes(d.articleVariantId)&&d.target===generator.target))}));markDirty();setError(null);
  }
  function assignGenerator(role: GeneratorRole) {
    if(!activeGenerator)return;
    try { changeGenerator(assignGeneratorRole(draft.content,activeGenerator,role,selectedIds)); } catch(caught){setError(errorText(caught));}
  }
  function applyGenerator(ids: string[]) {
    if(!activeGenerator)return;
    const next={...activeGenerator,articles:[...activeGenerator.articles.filter(a=>!ids.includes(a.articleId)),...ids.map(articleId=>activeGenerator.articles.find(a=>a.articleId===articleId)??{articleId,nodeIds:[]})]};
    try { validateDrawingGenerators(draft.content,draft.e4ConnectorTable,[next]); for(const id of ids)materializeGenerator(draft.content,draft.e4ConnectorTable,draft.drawingContactBindings??[],next,id); changeGenerator(next,ids); } catch(caught){setError(errorText(caught));}
  }

  async function loadList() { try { setItems(await api.list()); setError(null); } catch (caught) { setError(errorText(caught)); } }
  useEffect(() => { void loadList(); }, [api]);
  useEffect(() => {
    if (selectedArticleVariantId && !draft.content.articleVariants.some(variant => variant.id === selectedArticleVariantId))
      setSelectedArticleVariantId(null);
  }, [draft.content.articleVariants, selectedArticleVariantId]);
  useEffect(() => {
    const query = terminalArticleQuery.trim();
    if (!query) {
      setTerminalArticleSuggestions([]);
      setTerminalArticleSearchState("idle");
      setTerminalArticleSearchMessage(null);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setTerminalArticleSearchState("loading");
      setTerminalArticleSearchMessage(null);
      void searchTerminalArticles(referenceApi, query, controller.signal).then(items => {
        if (controller.signal.aborted) return;
        setTerminalArticleSuggestions(items);
        setTerminalArticleSearchState("ready");
      }).catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setTerminalArticleSuggestions([]);
        setTerminalArticleSearchState("error");
        setTerminalArticleSearchMessage(errorText(caught));
      });
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [terminalArticleQuery, referenceApi]);

  function setLoadedDraft(item: LoadedTemplate, content: TemplateContentV2, nextDiagnostics: readonly TemplateV2Diagnostic[], migrated: boolean, mismatch: boolean, table?: E4ConnectorSeriesTable, terminals?: readonly ArticleBinding[], bindings: readonly TerminalContactTypeBindingV5[] | null = null) {
    const compatibleTerminalArticleKeys = terminals?.map(item => ({ ...item })) ?? compatibleTerminalsFromV3(content);
    const projected = applySeriesTerminalsToEditor(content, table ?? createE4ConnectorSeriesTableFromV3(content), compatibleTerminalArticleKeys, bindings);
    setDraft({ drawingGenerators: isTemplateContentV5(item.content) ? structuredClone(item.content.drawingGenerators ?? []) : [], e4Presentation: isTemplateContentV5(item.content) ? item.content.e4Presentation : undefined, articleDrawings: isTemplateContentV5(item.content) ? structuredClone(item.content.articleDrawings ?? []) : [], drawingContactBindings: isTemplateContentV5(item.content) ? structuredClone(item.content.drawingContactBindings ?? []) : [], templateId: item.templateId, version: item.version, draftRevision: item.draftRevision, code: item.code, name: item.name, assets: [...item.assets], content: structuredClone(projected.content), compatibleTerminalArticleKeys, terminalContactTypeBindings: bindings?.map(binding => structuredClone(binding)) ?? null, e4ConnectorTable: structuredClone(projected.table) });
    setViewId(content.views[0]!.id); setActiveLayerIds(firstLayerIds(content)); setSelectedId(null); setUndoStack([]);
    setGraphicEditorMode("e4");
    setPendingLogicalContactId(null);
    setSelectedArticleVariantId(null);
    setDirty(migrated); setAutoSaveFailed(false); setUpgradedFromV1(migrated); setAssetMismatch(mismatch); setDiagnostics(nextDiagnostics); setSaved(null);
    setPreviewParameterValues({});
    setTerminalArticleQuery(""); setTerminalArticleSuggestions([]); setTerminalArticleSearchState("idle"); setTerminalArticleSearchMessage(null);
  }

  async function open(summary: ComponentTemplateSummary) {
    setBusy(true);
    try {
      if ((dirty || draft.draftRevision > 0) && (draft.templateId !== null || draft.code.trim() || draft.name.trim() !== "Новый компонент")) {
        const persisted = await publishWorkingDraft();
        if (!persisted) return;
        applyPersisted(persisted);
      }
      const published = await api.get(summary.templateId);
      const savedDraft = await api.getDraft(summary.templateId);
      const item: LoadedTemplate = savedDraft
        ? { ...savedDraft, version: savedDraft.baseVersion, draftRevision: savedDraft.draftRevision }
        : { ...published, draftRevision: 0 };
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
      } else if (isTemplateContentV5(item.content)) {
        const reconciliation = reconcileTemplateEnvelopeAssets(item.content, item.assets), mismatch = reconciliation.diagnostics.length > 0;
        setLoadedDraft(item, projectTemplateContentV5ToV3(item.content), reconciliation.diagnostics, false, mismatch,
          projectTemplateContentV5TableToV1(item.content), item.content.compatibleTerminalArticleKeys, item.content.terminalContactTypeBindings ?? null);
        setError(mismatch ? "Метаданные изображений расходятся с версией шаблона. Сохранение заблокировано." : null);
      }
    } catch (caught) { setError(errorText(caught)); } finally { setBusy(false); }
  }

  function resetNewDraft() {
    const next = newDraft(); setDraft(next); setViewId(next.content.views[0]!.id); setActiveLayerIds(firstLayerIds(next.content));
    setGraphicEditorMode("e4");
    setSelectedId(null); setUndoStack([]); setDirty(true); setAutoSaveFailed(false); setUpgradedFromV1(false); setAssetMismatch(false); setDiagnostics([]); setError(null); setSaved(null);
    setPendingLogicalContactId(null);
    setSelectedArticleVariantId(null);
    setPreviewParameterValues({});
    setTerminalArticleQuery(""); setTerminalArticleSuggestions([]); setTerminalArticleSearchState("idle"); setTerminalArticleSearchMessage(null);
  }
  async function startNew() {
    if ((dirty || draft.draftRevision > 0) && (draft.templateId !== null || draft.code.trim() || draft.name.trim() !== "Новый компонент")) {
      setBusy(true);
      try {
        const persisted = await publishWorkingDraft();
        if (!persisted) return;
        applyPersisted(persisted);
        await loadList();
      } catch (caught) { setError(errorText(caught)); return; }
      finally { setBusy(false); }
    }
    resetNewDraft();
  }
  function markDirty() { setDirty(true); setAutoSaveFailed(false); setSaved(null); if (!assetMismatch) setDiagnostics([]); }
  function setCompatibleTerminals(terminals: readonly ArticleBinding[]) {
    const identities = new Set(terminals.map(articleIdentity));
    const bindings = (draft.terminalContactTypeBindings ?? []).filter(binding => identities.has(articleIdentity(binding.terminalArticleKey)));
    const projected = applySeriesTerminalsToEditor(draft.content, draft.e4ConnectorTable, terminals, bindings);
    setDraft(current => ({ ...current, content: projected.content, compatibleTerminalArticleKeys: terminals.map(item => ({ ...item })), terminalContactTypeBindings: bindings, e4ConnectorTable: projected.table }));
    markDirty(); setError(null);
  }
  function changeContent(content: TemplateContentV2, selection?: string | null) {
    if (content === draft.content) return;
    let generators = draft.drawingGenerators;
    if (generatorArticleMode && activeGenerator && selectedArticleVariantId) {
      try { const next = guardGeneratorArticleEdit(draft.content, content, activeGenerator, selectedArticleVariantId, selectedIds); generators = generators?.map(g=>g.id===next.id?next:g); }
      catch(caught) { setError(errorText(caught)); return; }
    }
    const bindings = draft.terminalContactTypeBindings?.filter(binding => content.contactTypeGroups.some(group => group.id === binding.contactTypeGroupId)) ?? null;
    const reconciled = reconcileE4ConnectorTable(content, draft.e4ConnectorTable);
    const existingRows = new Set(draft.e4ConnectorTable.seriesDefaults.map(row => row.rowId));
    const table = { ...reconciled, seriesDefaults: reconciled.seriesDefaults.map(row => existingRows.has(row.rowId) ? row : {
      ...row, values: { ...row.values, standardTerminalArticleKey: bindings?.find(binding => binding.standard && binding.contactTypeGroupId === row.values.contactTypeGroupId)?.terminalArticleKey ?? null },
    }) };
    const projected = applySeriesTerminalsToEditor(content, table, draft.compatibleTerminalArticleKeys, bindings);
    setUndoStack(stack => [...stack.slice(-(TEMPLATE_UNDO_LIMIT - 1)), draft]);
    setDraft(current => ({ ...current, content: projected.content, e4ConnectorTable: projected.table, drawingGenerators: generators, terminalContactTypeBindings: bindings,
      articleDrawings: current.articleDrawings?.filter(drawing => content.articleVariants.some(a => a.id === drawing.articleVariantId)).map(drawing => ({...drawing,nodeIds:drawing.nodeIds.filter(id => content.views.some(view => view.layers.some(layer => layer.nodes.some(node => node.id === id)))),contactPointIds:drawing.contactPointIds.filter(id => content.views.some(view => view.contactPoints.some(point => point.id === id)))})),
      drawingContactBindings: current.drawingContactBindings?.filter(binding => content.logicalContacts.some(contact => contact.id === binding.logicalContactId) && table.seriesDefaults.some(row => row.rowId === binding.seriesRowId)) }));
    if (selection !== undefined) setSelectedId(selection); markDirty(); setError(null);
  }
  function command(action: () => TemplateContentV2, selection?: string | null) { try {
    if(generatedSelection)throw new Error("Основа защищена. Перейдите в «Исходник».");
    changeContent(action(), selection);
  } catch (caught) { setError(errorText(caught)); } }
  function setArticleContactGroup(
    variantId: string,
    groupId: string,
    count: number,
    terminals: readonly ArticleBinding[],
  ) {
    try {
      changeContent(setArticleVariantContactGroupV3(draft.content, variantId, groupId, count, terminals));
      markDirty(); setError(null);
    } catch (caught) { setError(errorText(caught)); }
  }
  function setStandardTerminal(variantId: string, groupId: string, terminal: ArticleBinding | null) {
    try {
      const table = setArticleContactGroupStandardTerminal(draft.e4ConnectorTable, variantId, groupId, terminal);
      setDraft(current => ({ ...current, e4ConnectorTable: table }));
      markDirty(); setError(null);
    } catch (caught) { setError(errorText(caught)); }
  }
  function setSeriesTerminalContactType(terminal: ArticleBinding, groupId: string | null) {
    try {
      const identity = articleIdentity(terminal);
      const previous = draft.terminalContactTypeBindings?.find(binding => articleIdentity(binding.terminalArticleKey) === identity);
      let bindings = (draft.terminalContactTypeBindings ?? []).filter(binding => articleIdentity(binding.terminalArticleKey) !== identity);
      if (groupId !== null) bindings = [...bindings, { terminalArticleKey: { ...terminal }, contactTypeGroupId: groupId, standard: previous?.contactTypeGroupId === groupId && previous.standard }];
      const projected = applySeriesTerminalsToEditor(draft.content, draft.e4ConnectorTable, draft.compatibleTerminalArticleKeys, bindings);
      setDraft(current => ({ ...current, content: projected.content, terminalContactTypeBindings: bindings, e4ConnectorTable: projected.table }));
      markDirty(); setError(null);
    } catch (caught) { setError(errorText(caught)); }
  }
  function setSeriesStandardTerminal(terminal: ArticleBinding, standard: boolean) {
    try {
      const identity = articleIdentity(terminal);
      const selected = draft.terminalContactTypeBindings?.find(binding => articleIdentity(binding.terminalArticleKey) === identity);
      if (!selected) return;
      const bindings = draft.terminalContactTypeBindings!.map(binding => ({
        ...binding,
        standard: binding.contactTypeGroupId === selected.contactTypeGroupId
          ? articleIdentity(binding.terminalArticleKey) === identity && standard
          : binding.standard,
      }));
      const projected = applySeriesTerminalsToEditor(draft.content, draft.e4ConnectorTable, draft.compatibleTerminalArticleKeys, bindings, true);
      setDraft(current => ({ ...current, terminalContactTypeBindings: bindings, e4ConnectorTable: projected.table, content: projected.content }));
      markDirty(); setError(null);
    } catch (caught) { setError(errorText(caught)); }
  }
  function removeArticleContactGroup(variantId: string, groupId: string) {
    try {
      const content = removeArticleVariantContactGroupV3(draft.content, variantId, groupId);
      let table = reconcileE4ConnectorTable(content, draft.e4ConnectorTable);
      if (materializeE4ConnectorArticle(table, variantId).rows.some(row => row.contactTypeGroupId === groupId))
        table = setArticleContactGroupStandardTerminal(table, variantId, groupId, null);
      setUndoStack(stack => [...stack.slice(-(TEMPLATE_UNDO_LIMIT - 1)), draft]);
      setDraft(current => ({ ...current, content, e4ConnectorTable: table }));
      markDirty(); setError(null);
    } catch (caught) { setError(errorText(caught)); }
  }
  const undo = useCallback(() => setUndoStack(stack => {
    const previous = stack.at(-1); if (!previous) return stack;
    setDraft(current => ({ ...previous, templateId: current.templateId, version: current.version, draftRevision: current.draftRevision })); setSelectedId(null); markDirty(); return stack.slice(0, -1);
  }), []);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => { if (!busy && isTemplateUndoShortcut(event)) { event.preventDefault(); undo(); } };
    window.addEventListener("keydown", listener); return () => window.removeEventListener("keydown", listener);
  }, [undo, busy]);

  useEffect(() => {
    if(graphicEditorMode !== "drawing") return;
    const listener=(event:KeyboardEvent)=>{
      if(busy || event.repeat) return;
      const action=drawingKeyboardAction(event);
      if(!action || action !== "paste" && !selectedIds.length || action === "paste" && !clipboard.current) return;
      if(action==="paste" || action==="copy") return;
      event.preventDefault();
      deleteSelection();
    };
    window.addEventListener("keydown",listener); return ()=>window.removeEventListener("keydown",listener);
  });
  function copySelection(data?:DataTransfer) {
    if(!activeView) return;
    try { clipboard.current=copyDrawingSelection(draft.content,activeView.id,selectedNodeIds); pasteCount.current=0; setHasClipboard(true);
      const token="TECHMAP-DRAWING:"+crypto.randomUUID(); clipboardToken.current=token; clipboardSynchronized.current=false;
      if(data) { data.setData("text/plain",token); clipboardSynchronized.current=true; }
      else void navigator.clipboard?.writeText(token).then(()=>{if(clipboardToken.current===token)clipboardSynchronized.current=true;}).catch(()=>{});
 setError(null); } catch(caught) {setError(errorText(caught));}
  }
  function pasteSelection() {
    if(!activeView || !activeLayer || !clipboard.current) return;
    try {const [content,ids]=pasteDrawingSelection(draft.content,activeView.id,activeLayer.id,clipboard.current,-12*(pasteCount.current+1)); changeContent(content); setSelectedIds(ids);pasteCount.current++;} catch(caught){setError(errorText(caught));}
  }
  function deleteSelection() {
    if(!activeView || !selectedIds.length) return;
    command(()=>deleteDrawingSelection(draft.content,activeView.id,selectedIds),null);
  }

  function validatedBody(working = draft) {
    if (!working.code.trim() || !working.name.trim()) { setError("Укажите серию соединителя и описание."); return null; }
    if (assetMismatch) { setError("Сохранение заблокировано: metadata assets не совпадают с версией шаблона."); return null; }
    const reconciliation = reconcileTemplateEnvelopeAssets(working.content, working.assets);
    if (reconciliation.diagnostics.length) { setAssetMismatch(true); setDiagnostics(reconciliation.diagnostics); setError(reconciliation.diagnostics[0]!.message); return null; }
    try {
      expandTemplateRepeatsV2(compatibilityContent);
    }
    catch (caught) { setError(errorText(caught)); return null; }
    let v5Content;
    try {
      for(const drawing of working.articleDrawings??[])validateArticleDrawingContacts(working.content,working.e4ConnectorTable,working.drawingContactBindings??[],drawing);
      v5Content = createTemplateContentV5FromEditor(working.content, working.e4ConnectorTable, working.compatibleTerminalArticleKeys, working.terminalContactTypeBindings, working.e4Presentation, working.articleDrawings, working.drawingContactBindings, working.drawingGenerators).content;
    } catch (caught) { setError(errorText(caught)); return null; }
    const body = { code: working.code.trim(), name: working.name.trim(), articleBindings: articleBindingsFromTemplateV3(working.content), content: v5Content };
    return body;
  }

  async function persistWorkingDraft(): Promise<ComponentTemplate | ComponentTemplateDraft | null> {
    const body = validatedBody();
    if (!body) return null;
    return draft.templateId
      ? api.saveDraft(draft.templateId, { expectedVersion: draft.version, expectedDraftRevision: draft.draftRevision, ...body })
      : api.create(body);
  }

  async function publishWorkingDraft(): Promise<ComponentTemplate | null> {
    let templateId = draft.templateId, version = draft.version, revision = draft.draftRevision;
    if (dirty || !templateId) {
      const saved = await persistWorkingDraft();
      if (!saved) return null;
      if ("baseVersion" in saved) {
        templateId = saved.templateId; version = saved.baseVersion; revision = saved.draftRevision;
      } else {
        return saved;
      }
    }
    return revision > 0 ? api.publishDraft(templateId!, version, revision) : api.get(templateId!);
  }

  function applySavedDraft(result: ComponentTemplateDraft) {
    setDraft(current => ({ ...current, templateId: result.templateId, version: result.baseVersion, draftRevision: result.draftRevision }));
    setDirty(false); setAutoSaveFailed(false); setSaved("Сохранено"); setError(null);
  }

  function applyPersisted(result: ComponentTemplate, resetUndo = false) {
    if (!isTemplateContentV3(result.content) && !isTemplateContentV4(result.content) && !isTemplateContentV5(result.content)) throw new Error("Сервер вернул неподдерживаемый формат после сохранения.");
    const content = isTemplateContentV5(result.content) ? projectTemplateContentV5ToV3(result.content)
      : isTemplateContentV4(result.content) ? v3CoreFromV4(result.content) : result.content;
    const terminals = isTemplateContentV5(result.content) ? result.content.compatibleTerminalArticleKeys : compatibleTerminalsFromV3(content);
    const bindings = isTemplateContentV5(result.content) ? result.content.terminalContactTypeBindings ?? null : null;
    const table = isTemplateContentV5(result.content) ? projectTemplateContentV5TableToV1(result.content)
      : isTemplateContentV4(result.content) ? result.content.e4ConnectorTable : createE4ConnectorSeriesTableFromV3(content);
    const projected = applySeriesTerminalsToEditor(content, table, terminals, bindings);
    const reconciliation = reconcileTemplateEnvelopeAssets(result.content, result.assets);
    if (reconciliation.diagnostics.length) throw new Error(reconciliation.diagnostics[0]!.message);
    setDraft({ drawingGenerators: isTemplateContentV5(result.content) ? structuredClone(result.content.drawingGenerators ?? []) : [], e4Presentation: isTemplateContentV5(result.content) ? result.content.e4Presentation : undefined, articleDrawings: isTemplateContentV5(result.content) ? structuredClone(result.content.articleDrawings ?? []) : [], drawingContactBindings: isTemplateContentV5(result.content) ? structuredClone(result.content.drawingContactBindings ?? []) : [], templateId: result.templateId, version: result.version, draftRevision: 0, code: result.code, name: result.name, assets: [...result.assets], content: structuredClone(projected.content), compatibleTerminalArticleKeys: terminals.map(item => ({ ...item })), terminalContactTypeBindings: bindings === null ? null : structuredClone(bindings), e4ConnectorTable: structuredClone(projected.table) });
    // Asset mutations change the immutable envelope. Old snapshots could then
    // reintroduce content whose asset list no longer matches the server version.
    if (resetUndo) setUndoStack([]);
    setDirty(false); setAutoSaveFailed(false); setUpgradedFromV1(false); setAssetMismatch(false); setDiagnostics([]); setSaved("Сохранено"); setError(null);
  }
  async function save(): Promise<boolean> {
    if (!dirty && draft.draftRevision === 0) return true;
    setBusy(true);
    try {
      const result = await publishWorkingDraft();
      if (result) { applyPersisted(result); await loadList(); return true; }
      setAutoSaveFailed(true); return false;
    } catch (caught) { setAutoSaveFailed(true); setError(errorText(caught)); return false; }
    finally { setBusy(false); }
  }
  function openDrawingTarget(target:DrawingTarget,articleId=selectedArticleVariantId) {
    if (!draft.templateId || busy) return;
    setGeneratorPreviewPeriods(undefined);
    const generator=draft.drawingGenerators?.find(g=>g.target===target);
    if(generator){
      // Opening a generated drawing without a prior article selection must still
      // show a concrete variant in the result pane. Prefer the current article,
      // then the first assigned variant, and finally the first series variant.
      const initialArticleId = articleId
        ?? generator.articles[0]?.articleId
        ?? draft.content.articleVariants[0]?.id
        ?? null;
      setDrawingTarget(target);setViewId(generator.viewId);setGraphicEditorMode("drawing");setSelectedArticleVariantId(initialArticleId);setSelectedIds([]);
      if(!initialArticleId || !generator.articles.some(a=>a.articleId===initialArticleId))setGeneratorMode("source");
      return;
    }
    const separated=separateLegacyDrawings(draft.content,draft.articleDrawings);
    let content=separated.content;
    if(content!==draft.content){changeContent(content);setDraft(current=>({...current,articleDrawings:separated.drawings}));}
    const binding=findArticleDrawing(separated.drawings,articleId,target);
    const name=target==="e4"?"Рисунки · Схема Э4":"Рисунки · Маршрут";
    let view=content.views.find(v=>binding?.viewId ? v.id===binding.viewId : target==="drawing" || binding && !binding.target ? v.kind==="drawing" : v.name===name);
    if(!view){const [next,id]=addAdditionalViewV3(content,name);content=next;view=content.views.find(v=>v.id===id)!;changeContent(content);}
    setDrawingTarget(target);setViewId(view.id);setGraphicEditorMode("drawing");setSelectedArticleVariantId(articleId);
    setSelectedIds(binding?[...binding.nodeIds,...binding.contactPointIds,...binding.bundlePortIds??[]]:[]);
  }
  function clearTargetDrawings() {
    if(!activeView)return;
    if(activeGenerator){
      if(generatorArticleMode){setError("Очистка основы доступна в режиме «Исходник».");return;}
      setUndoStack(stack=>[...stack.slice(-(TEMPLATE_UNDO_LIMIT-1)),draft]);
      setDraft(current=>({...current,drawingGenerators:current.drawingGenerators?.filter(g=>g.id!==activeGenerator.id),
        content:{...current.content,views:current.content.views.map(v=>v.id===activeView.id?{...v,layers:v.layers.map(l=>({...l,nodes:[]})),contactPoints:[],bundlePorts:[],repeatPlacements:[]}:v)},
        articleDrawings:[...(current.articleDrawings??[]).filter(d=>d.target!==drawingTarget),...current.content.articleVariants.map(a=>({articleVariantId:a.id,target:drawingTarget,viewId:activeView.id,nodeIds:[],contactPointIds:[]}))]}));
      markDirty();setRemoveDrawingPrompt(false);setSelectedIds([]);return;
    }
    const empty={...draft.content,views:draft.content.views.map(v=>v.id===activeView.id?{...v,layers:v.layers.map(l=>({...l,nodes:[]})),contactPoints:[],bundlePorts:[],repeatPlacements:[]}:v)};
    changeContent(empty,null);
    setDraft(current=>({...current,articleDrawings:current.articleDrawings?.map(d=>d.target===drawingTarget || !d.target&&drawingTarget==="drawing"?{...d,target:drawingTarget,viewId:activeView.id,nodeIds:[],contactPointIds:[],bundlePortIds:[]}:d)}));
    setRemoveDrawingPrompt(false);
  }
  async function saveArticleDrawing(articleVariantId: string,all=false) {
    if (!activeView) return;
    if(activeGenerator){
      const articleIds=all?draft.content.articleVariants.map(a=>a.id):[articleVariantId];
      const generator={...activeGenerator,articles:[...activeGenerator.articles.filter(a=>!articleIds.includes(a.articleId)),...articleIds.map(articleId=>activeGenerator.articles.find(a=>a.articleId===articleId)??{articleId,nodeIds:[]})]};
      const working={...draft,drawingGenerators:draft.drawingGenerators?.map(g=>g.id===generator.id?generator:g),articleDrawings:draft.articleDrawings?.filter(d=>!(articleIds.includes(d.articleVariantId)&&d.target===drawingTarget))};
      const body=validatedBody(working);if(!body||!working.templateId)return;
      setBusy(true);
      try {const result=await api.saveDraft(working.templateId,{expectedVersion:working.version,expectedDraftRevision:working.draftRevision,...body});setUndoStack(stack=>[...stack.slice(-(TEMPLATE_UNDO_LIMIT-1)),draft]);setDraft(working);applySavedDraft(result);}
      catch(caught){setError(errorText(caught));}finally{setBusy(false);}
      return;
    }
    const drawing = {...drawingSelection(activeView, selectedIds, articleVariantId),target:drawingTarget,viewId:activeView.id};
    if (!drawing.nodeIds.length && !drawing.contactPointIds.length && !drawing.bundlePortIds?.length) return;
    const articleIds=all?draft.content.articleVariants.map(a=>a.id):[articleVariantId];
    const working = { ...draft, articleDrawings: [...(draft.articleDrawings ?? []).filter(item => !(articleIds.includes(item.articleVariantId)&&item.target===drawingTarget)), ...articleIds.map(id=>({...drawing,articleVariantId:id}))] };
    const body = validatedBody(working); if (!body) return;
    setBusy(true);
    try {
      const result = working.templateId ? await api.saveDraft(working.templateId, {expectedVersion:working.version,expectedDraftRevision:working.draftRevision,...body}) : await api.create(body);
      setUndoStack(stack => [...stack.slice(-(TEMPLATE_UNDO_LIMIT - 1)), draft]);
      setDraft(working);
      if ("baseVersion" in result) applySavedDraft(result); else applyPersisted(result);
      setSaved(`Рисунок ${draft.content.articleVariants.find(a => a.id === articleVariantId)?.articleKey} сохранён`);
      await loadList();
    } catch (caught) { setError(errorText(caught)); } finally { setBusy(false); }
  }

  function returnToLibrary() {
    setGraphicEditorMode("e4");
    if (e4View) setViewId(e4View.id);
  }
  async function saveAndExitDrawing() {
    if (await save()) returnToLibrary();
  }

  useEffect(() => {
    if (graphicEditorMode === "drawing") return;
    if (!shouldAutoSaveTemplate({ dirty, failed: autoSaveFailed, busy, assetMismatch, code: draft.code, name: draft.name })) return;
    const timer = window.setTimeout(() => {
      setBusy(true);
      void persistWorkingDraft().then(result => {
        if (!result) setAutoSaveFailed(true);
        else if ("baseVersion" in result) applySavedDraft(result);
        else applyPersisted(result);
      }).catch(caught => { setAutoSaveFailed(true); setError(errorText(caught)); }).finally(() => setBusy(false));
    }, 900);
    return () => window.clearTimeout(timer);
  }, [assetMismatch, autoSaveFailed, busy, dirty, draft, graphicEditorMode]);

  async function removeTemplate() {
    if (!draft.templateId) return;
    if (!window.confirm(`Удалить серию «${draft.code}» и все версии шаблона? Это действие нельзя отменить.`)) return;
    setBusy(true);
    try {
      await api.remove(draft.templateId, draft.version);
      resetNewDraft();
      await loadList();
      setSaved("Серия удалена");
    } catch (caught) { setError(errorText(caught)); } finally { setBusy(false); }
  }

  async function addAsset(file: File,place=false) {
    setBusy(true);
    try {
      const assetInput = await importDrawingImage(file);
      let persisted: ComponentTemplate | null = null;
      if (!draft.templateId || dirty || draft.draftRevision > 0) { persisted = await publishWorkingDraft(); if (!persisted) return; applyPersisted(persisted); }
      const result = await api.addAsset(persisted?.templateId ?? draft.templateId!, { expectedVersion: persisted?.version ?? draft.version, ...assetInput });
      applyPersisted(result, true);
      if(place && activeView && activeLayer) {
        const asset=result.assets.find(a=>!draft.assets.some(old=>old.assetId===a.assetId)) ?? result.assets.find(a=>a.fileName===assetInput.fileName);
        if(asset && isTemplateContentV5(result.content)) {
          const core=projectTemplateContentV5ToV3(result.content),node=createTemplateImageNodeV2(asset.assetId,activeLayer.id);
          const next=addNodeV2(core,activeView.id,activeLayer.id,node,0);
          setUndoStack([{...draft, templateId:result.templateId, version:result.version, draftRevision:0, assets:[...result.assets], content:core, e4ConnectorTable:projectTemplateContentV5TableToV1(result.content)}]);
          setDraft(current=>({...current,content:next,drawingGenerators:current.drawingGenerators?.map(g=>
            generatorArticleMode && g.id===activeGenerator?.id && selectedArticleVariantId
              ? guardGeneratorArticleEdit(core,next,g,selectedArticleVariantId)
              : g)}));setSelectedId(node.id);markDirty();
        }
      }
      await loadList();
    } catch (caught) { setError(errorText(caught)); } finally { setBusy(false); }
  }
  async function removeAsset(assetId: string) {
    if (isTemplateAssetReferencedV2(draft.content, assetId)) { setError("Сначала удалите все размещения этого изображения из видов шаблона."); return; }
    if (!draft.templateId) return;
    setBusy(true);
    try {
      let persisted: ComponentTemplate | null = null;
      if (dirty || draft.draftRevision > 0) { persisted = await publishWorkingDraft(); if (!persisted) return; applyPersisted(persisted); }
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
    try {
      const placed = new Set(activeView.contactPoints.map(point => point.logicalContactId));
      const row = drawingTableRows.find(row => !(draft.drawingContactBindings ?? []).some(binding => binding.seriesRowId === row.seriesRowId && placed.has(binding.logicalContactId)));
      if (!row) { setError("В таблице выбранного артикула нет свободных контактов. Добавьте строки в схеме Э4."); return; }
      const binding = draft.drawingContactBindings?.find(binding => binding.seriesRowId === row.seriesRowId);
      const existing = draft.content.logicalContacts.find(contact => contact.id === binding?.logicalContactId || contact.id === row.seriesRowId);
      const [content, id] = existing ? linkLogicalContactPointV2(draft.content, activeView.id, existing.id)
        : addContactPointV2(draft.content, activeView.id, {number: draft.content.logicalContacts.some(contact => contact.number === row.number) ? undefined : row.number, name:row.name || `Контакт ${row.number}`, circuitText:row.circuitText, contactTypeGroupId:row.contactTypeGroupId});
      const logicalContactId = content.views.find(view => view.id === activeView.id)!.contactPoints.find(point => point.id === id)!.logicalContactId;
      changeContent(content, id);
      setDraft(current => ({ ...current, drawingContactBindings: [...(current.drawingContactBindings ?? []).filter(binding => binding.logicalContactId !== logicalContactId && binding.seriesRowId !== row.seriesRowId), {logicalContactId,seriesRowId:row.seriesRowId}] }));
    } catch (caught) { setError(errorText(caught)); }
  }
  function placeLinkedContact(logicalContactId: string) {
    if (!activeView) return;
    try { const [content, id] = linkLogicalContactPointV2(draft.content, activeView.id, logicalContactId); changeContent(content, id); setPendingLogicalContactId(null); } catch (caught) { setError(errorText(caught)); }
  }
  function appendBundlePort() {
    if(drawingTarget!=="drawing"){setError("Общий контакт разрешён только для раздела Чертёж.");return;}
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
    if(selectedIds.length>1 && selectedIds.includes(nodeId)) { command(()=>moveDrawingSelection(draft.content,activeView.id,selectedIds,deltaX,deltaY)); return; }
    const point = activeView.contactPoints.find(point => point.id === nodeId);
    if (point && point.x.kind === "constant" && point.y.kind === "constant") {
      const x = point.x.value + deltaX, y = point.y.value + deltaY;
      command(() => editContactPointV2(draft.content, activeView.id, point.id, { x: constantExpressionV2(x), y: constantExpressionV2(y) }), point.id); return;
    }
    const port = activeView.bundlePorts.find(point => point.id === nodeId);
    if (port && port.x.kind === "constant" && port.y.kind === "constant") {
      const x = port.x.value + deltaX, y = port.y.value + deltaY;
      command(() => editBundlePortV2(draft.content, activeView.id, port.id, { x: constantExpressionV2(x), y: constantExpressionV2(y) }), port.id); return;
    }
    const layer = activeView.layers.find(item => item.nodes.some(node => node.id === nodeId));
    if (!layer) { setError("Перемещаемый объект не найден в активном виде."); return; }
    const movingIds = selectedNodeIds.includes(nodeId) && selectedNodeIds.length > 1 ? selectedNodeIds : [nodeId];
    command(() => movingIds.reduce(
      (content, id) => moveNodeV2(content, activeView.id, layer.id, id, deltaX, deltaY),
      draft.content,
    ));
  }
  function selectBoxObjects(ids: readonly string[]) {
    setSelectedIds(ids);
    const layer=activeView?.layers.find(layer=>layer.nodes.some(node=>node.id===ids[0]));
    if(activeView && layer) setActiveLayerIds(current=>({...current,[activeView.id]:layer.id}));
  }
  function selectCanvasObject(id: string | null, extend: boolean) {
    if (!id) { setSelectedIds([]); return; }
    const nodeLayer = activeView?.layers.find(layer => layer.nodes.some(node => node.id === id));
    if (activeView && nodeLayer) setActiveLayerIds(current => ({ ...current, [activeView.id]: nodeLayer.id }));
    if (!extend) { setSelectedIds([id]); return; }
    setSelectedIds(current => nextTemplateSelectionV2(
      current, id, true,
    ));
  }
  function groupSelection() {
    if (!activeView || !activeLayer || selectedNodeIds.length < 2) return;
    try {
      const [content, groupId] = groupRootNodesV3(draft.content, activeView.id, activeLayer.id, selectedNodeIds);
      changeContent(content, groupId);
    } catch (caught) { setError(errorText(caught)); }
  }
  function ungroupSelection() {
    if (!activeView || !activeLayer || selectedNodeIds.length !== 1) return;
    command(() => ungroupRootNodeV3(draft.content, activeView.id, activeLayer.id, selectedNodeIds[0]!), null);
  }
  function reorderSelection(direction: "forward" | "backward") {
    if (!activeView || !activeLayer || selectedNodeIds.length !== 1) return;
    command(() => reorderRootNodeStepV3(draft.content, activeView.id, activeLayer.id, selectedNodeIds[0]!, direction));
  }
  function rotateSelection(rotationDegrees: number) {
    if (!activeView || !activeLayer || selectedNodeIds.length !== 1) return;
    command(
      () => setRootNodeRotationAroundCenterV3(
        draft.content, activeView.id, activeLayer.id, selectedNodeIds[0]!, rotationDegrees,
      ),
      selectedNodeIds[0]!,
    );
  }
  function resizeCanvasNode(nodeId: string, handle: NodeResizeHandleV2, deltaX: number, deltaY: number) {
    if (!activeView) return;
    const layer = activeView.layers.find(item => item.nodes.some(node => node.id === nodeId));
    if (!layer) { setError("Изменяемый объект не найден в активном виде."); return; }
    command(() => resizeNodeV2(draft.content, activeView.id, layer.id, nodeId, handle, deltaX, deltaY), nodeId);
  }
  function editCanvasPoint(nodeId: string, action: (layerId: string) => TemplateContentV2) {
    if (!activeView) return;
    const layer = activeView.layers.find(item => item.nodes.some(node => node.id === nodeId));
    if (!layer) { setError("Изменяемый объект не найден в активном виде."); return; }
    command(() => action(layer.id), nodeId);
  }
  function moveCanvasPoint(nodeId: string, pointIndex: number, deltaX: number, deltaY: number) {
    editCanvasPoint(nodeId, layerId => moveNodePointV3(draft.content, activeView!.id, layerId, nodeId, pointIndex, deltaX, deltaY));
  }
  function insertCanvasPoint(nodeId: string, segmentIndex: number, x: number, y: number) {
    editCanvasPoint(nodeId, layerId => insertNodePointV3(draft.content, activeView!.id, layerId, nodeId, segmentIndex, x, y));
  }
  function deleteCanvasPoint(nodeId: string, pointIndex: number) {
    editCanvasPoint(nodeId, layerId => deleteNodePointV3(draft.content, activeView!.id, layerId, nodeId, pointIndex));
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
    <header className="content-heading library-heading"><div><p className="eyebrow">M2 · БИБЛИОТЕКА СОЕДИНИТЕЛЕЙ</p><h1>Серии и компоненты <InfoHint>Здесь задаются серия, артикулы и таблица контактов Э4. Графика используется для вспомогательных видов.</InfoHint></h1></div><button className="primary-action" type="button" onClick={() => void startNew()} disabled={busy}>+ Новая серия</button></header>
    {error && <div className="error-banner" role="alert"><span>{error}</span><button onClick={() => setError(null)} aria-label="Закрыть">×</button></div>}
    {upgradedFromV1 && <div className="library-upgrade-banner" role="status"><strong>Открыта прежняя версия шаблона.</strong><span>Она преобразована только в памяти и будет сохранена как новая версия v3.</span>{diagnostics.map(item => <small key={`${item.code}/${item.path}`}>{item.code}: {item.message}</small>)}</div>}
    {!upgradedFromV1 && diagnostics.length > 0 && <div className="library-diagnostics" role="alert">{diagnostics.map(item => <span key={`${item.code}/${item.path}`}>{item.path}: {item.message}</span>)}</div>}
    <div className="library-layout"><aside className="library-catalog"><div className="panel-heading"><h2>Шаблоны</h2><button className="refresh-button" onClick={() => void loadList()} disabled={busy}>Обновить</button></div><div className="library-template-list">{items.length ? items.map(item => <button key={item.templateId} className={item.templateId === draft.templateId ? "library-template selected" : "library-template"} onClick={() => void open(item)} disabled={busy}><strong>{item.code}</strong><span>{item.name}</span><small>версия {item.version}</small></button>) : <p className="panel-message">Создайте первый графический шаблон.</p>}</div></aside>
      <section className={`library-editor ${graphicEditorMode === "drawing" ? "drawing-mode" : ""}`} aria-busy={busy}>
        <div className="library-metadata"><label>Серия соединителя<input aria-label="Серия соединителя" value={draft.code} onChange={event => { setDraft(current => ({ ...current, code: event.target.value })); markDirty(); }} placeholder="Например, JST XH" /></label><label>Описание<input aria-label="Описание серии" value={draft.name} onChange={event => { setDraft(current => ({ ...current, name: event.target.value })); markDirty(); }} placeholder="Например, разъёмы JST XH" /></label><div><span className={autoSaveFailed ? "library-save-state error" : "library-save-state"} role="status">{busy ? "Сохранение…" : autoSaveFailed ? "Не сохранено" : dirty ? "Изменено" : saved ?? "Сохранено"}</span><button className="primary-action" onClick={() => { setAutoSaveFailed(false); void save(); }} disabled={busy || assetMismatch || (!dirty && draft.draftRevision === 0)}>{busy ? "Сохраняем…" : "Записать версию"}</button>{draft.templateId && <button type="button" className="danger-action" onClick={() => void removeTemplate()} disabled={busy}>Удалить серию</button>}</div></div>
        <div className="graphic-editor-switcher" role="toolbar" aria-label="Редактор графики">
          <button type="button" className={graphicEditorMode === "e4" ? "active" : ""} onClick={() => { setGraphicEditorMode("e4"); if (e4View) setViewId(e4View.id); }}>Схема Э4</button>
          <button type="button" className={graphicEditorMode === "drawing" ? "active" : ""} disabled={!draft.templateId || busy} onClick={() => openDrawingTarget(drawingTarget)}>Рисунок</button>
          <InfoHint>Сначала выберите серию слева или создайте новую: заполните серию и описание, затем запишите версию. Рисунки редактируются отдельно для Схемы Э4, Чертежа или Маршрута.</InfoHint>
        </div>
        <div className="library-series-workspace">
        {graphicEditorMode === "e4" && <>
        <TemplateSeriesPanelV3
          articlePreview={<>
        {e4PreviewContent && <E4ArticlePreview content={e4PreviewContent} table={draft.e4ConnectorTable} articleId={selectedArticleVariantId} assets={draft.assets} code={draft.code} name={draft.name} disabled={busy || assetMismatch}
          onTableChange={table => { setDraft(current => ({ ...current, content: { ...current.content, articleVariants: current.content.articleVariants.map(variant => ({ ...variant, contactGroups: table.articles.find(article => article.articleVariantId === variant.id)?.contactGroups.map(group => ({ ...group, allowedTerminalArticleKeys: [...group.allowedTerminalArticleKeys] })) ?? variant.contactGroups })) }, e4ConnectorTable: table })); markDirty(); }}
          onChange={value => { setDraft(current => ({ ...current, e4Presentation: value })); markDirty(); }} />}
        {e4PreviewContent && selectedArticleVariantId && (["e4","drawing","route"] as const).map(target=>{
          const generator=draft.drawingGenerators?.find(g=>g.target===target&&g.articles.some(a=>a.articleId===selectedArticleVariantId));
          if(generator){
            try { const generated=materializeGenerator(draft.content,draft.e4ConnectorTable,draft.drawingContactBindings??[],generator,selectedArticleVariantId);
              return <section key={target} className="library-e4-companion" aria-label={`Рисунок ${target}`}><header><strong>Рисунок · {({e4:"Схема Э4",drawing:"Чертёж",route:"Маршрут"})[target]}</strong><button type="button" onClick={()=>openDrawingTarget(target)}>Редактировать</button></header><TemplateCanvasV2 content={projectTemplateContentV3CoreToV2(generated.content)} viewId={generator.viewId} selectedId={null} onSelect={()=>{}} resolveAssetUrl={resolveAssetUrl}/></section>;
            } catch(caught){return <span role="status" key={target}>{errorText(caught)}</span>;}
          }
          const binding=findArticleDrawing(draft.articleDrawings,selectedArticleVariantId,target);
          const view=compatibilityContent.views.find(v=>binding?.viewId ? v.id===binding.viewId : v.kind==="drawing");
          if(!view || target==="route"&&!binding)return null;
          const filtered=articleDrawingView(view,draft.articleDrawings,selectedArticleVariantId,target);
          if(!filtered.layers.some(l=>l.nodes.some(n=>n.visible))&&!filtered.contactPoints.length)return null;
          return <section key={target} className="library-e4-companion" aria-label={`Рисунок ${target}`}><header><strong>Рисунок · {({e4:"Схема Э4",drawing:"Чертёж",route:"Маршрут"})[target]}</strong><button type="button" onClick={()=>openDrawingTarget(target)}>Редактировать</button></header><TemplateCanvasV2 content={{...compatibilityContent,views:compatibilityContent.views.map(v=>v.id===view.id?filtered:v)}} viewId={view.id} selectedId={null} selectedIds={[]} onSelect={()=>{}} resolveAssetUrl={resolveAssetUrl} repeatedContactLabels={repeatedContactLabels} parameterDefaults={effectivePreviewParameterValues}/></section>;
        })}
          </>}
          independentE4
          content={draft.content}
          compatibleTerminalArticleKeys={draft.compatibleTerminalArticleKeys}
          onChangeCompatibleTerminalArticleKeys={setCompatibleTerminals}
          terminalContactTypeGroupIds={terminalContactTypeGroupIds}
          onSetTerminalContactTypeGroup={setSeriesTerminalContactType}
          standardTerminalIdentities={standardTerminalIdentities}
          onSetSeriesStandardTerminal={setSeriesStandardTerminal}
          terminalArticleQuery={terminalArticleQuery}
          terminalArticleSuggestions={terminalArticleSuggestions}
          terminalArticleSearchState={terminalArticleSearchState}
          terminalArticleSearchMessage={terminalArticleSearchMessage}
          onTerminalArticleQueryChange={setTerminalArticleQuery}
          selectedArticleVariantId={selectedArticleVariantId}
          onSelectArticleVariant={variantId => { setSelectedArticleVariantId(variantId); setPreviewParameterValues({}); }}
          onAddContactTypeGroup={name => command(() => addContactTypeGroupV3(draft.content, name)[0])}
          onRenameContactTypeGroup={(groupId, name) => command(() => renameContactTypeGroupV3(draft.content, groupId, name))}
          onDeleteContactTypeGroup={groupId => command(() => deleteContactTypeGroupV3(draft.content, groupId))}
          onAddArticleVariants={inputs => {
            try {
              const content = addSeriesArticles(draft.content, inputs);
              changeContent(content);
              setSelectedArticleVariantId(content.articleVariants.at(-1)!.id);
              return true;
            } catch (caught) {
              setError(errorText(caught));
              return false;
            }
          }}
          onUpdateArticleVariant={(variantId, input) => command(() => upsertArticleVariantV3(draft.content, { id: variantId, ...input })[0])}
          onDeleteArticleVariant={variantId => { if (selectedArticleVariantId === variantId) setSelectedArticleVariantId(null); command(() => removeArticleVariantV3(draft.content, variantId)); }}
          onSetArticleContactGroup={setArticleContactGroup}
          onRemoveArticleContactGroup={removeArticleContactGroup}
          standardTerminalArticleKeys={standardTerminalArticleKeys}
          onSetStandardTerminal={setStandardTerminal}
        />
        </>}
        </div>
        {<section className={`drawing-editor-shell ${graphicEditorMode === "drawing" ? "" : "drawing-hidden"}`} role="dialog" aria-modal="true" aria-label="Редактор рисунка" onCopy={event=>{if((event.target as HTMLElement).closest("input,textarea,select,[contenteditable=true]") || !selectedNodeIds.length)return;event.preventDefault();copySelection(event.clipboardData);}}>
          <header><strong>Рисунок · {draft.code}</strong><label>Раздел<select aria-label="Раздел рисунка" value={drawingTarget} onChange={e=>openDrawingTarget(e.target.value as DrawingTarget)}><option value="e4">Схема Э4</option><option value="drawing">Чертёж</option><option value="route">Маршрут</option></select></label><InfoHint>Рисунок сохраняется только для выбранного раздела. Перетаскивайте PNG, JPG, BMP, SVG, HEIC или вставляйте изображение Ctrl+V на поле. Изображения преобразуются в PNG локально. «Открыть» выделяет сохранённый набор для редактирования.</InfoHint>
            <label>Артикул<select aria-label="Артикул рисунка" value={selectedArticleVariantId ?? ""} onChange={e=>openDrawingTarget(drawingTarget,e.target.value || null)}><option value="">Прототип</option>{draft.content.articleVariants.map(a=><option key={a.id} value={a.id}>{a.articleKey}</option>)}</select></label>
            <button type="button" onClick={returnToLibrary} disabled={busy}>В библиотеку</button>
            <InfoHint>Возврат сохраняет изменения в текущем редакторе. В библиотеке можно исправить данные серии и записать версию.</InfoHint>
            <button type="button" className="primary-action" onClick={() => void saveAndExitDrawing()} disabled={busy || assetMismatch}>Сохранить и выйти</button>
          </header>
          {error && <div className="error-banner" role="alert">{error}</div>}
          <nav className="drawing-ribbon-tabs" aria-label="Инструменты рисунка">{Object.entries({tools:"Фигуры",properties:"Свойства",generator:"Генератор",array:"Массив",contacts:"Контакты",layers:"Слои",assets:"Изображения",parameters:"Параметры",articles:"Артикулы"}).map(([id,label])=><button type="button" key={id} aria-pressed={drawingTab===id} onClick={()=>setDrawingTab(id)}>{label}</button>)}</nav>
          <div className="drawing-ribbon" data-ribbon-tab={drawingTab}>
{drawingTab === "tools" && <div className="drawing-ribbon-page">        <div className="library-tools"><span>Примитивы</span><button type="button" onClick={()=>copySelection()} disabled={!selectedNodeIds.length} title="Ctrl+C">Копировать</button><button type="button" onClick={pasteSelection} disabled={!hasClipboard || !activeLayer || activeLayer.locked} title="Ctrl+V">Вставить</button><button type="button" onClick={deleteSelection} disabled={!selectedIds.length || selectionLocked} title="Delete">Удалить</button><button type="button" className="drawing-primitive" title="Контакт" aria-label="Контакт" onClick={appendContact} disabled={!activeView}><DrawingToolIcon kind="contact"/></button>{(["line", "polyline", "rectangle", "ellipse", "bezier", "closedContour", "text"] as const).map(kind => <button key={kind} className="drawing-primitive" title={drawingToolLabels[kind]} aria-label={drawingToolLabels[kind]} onClick={() => appendBasic(kind)} disabled={!activeLayer || activeLayer.locked}><DrawingToolIcon kind={kind}/></button>)}<label className="angle-snap-control">Угол<select aria-label="Привязка угла" value={pointAngleMode} onChange={event => setPointAngleMode(event.target.value as TemplatePointAngleModeV2)}><option value="snap-15">15°</option><option value="free">Свободно</option></select></label><span className="drawing-snaps">{(["corners", "contours", "tangents"] as const).map(key => <label key={key}><input type="checkbox" checked={drawingSnaps[key]} onChange={e => setDrawingSnaps(current => ({ ...current, [key]: e.target.checked }))} />{({corners:"Углы",contours:"Контуры",tangents:"Касательные"})[key]}</label>)}<InfoHint>Ctrl + колесо — масштаб поля около курсора; Home — исходный масштаб. Привязки действуют при перемещении фигур, контактов и вершин. Касательные — для концов линий и прямых сторон рядом с окружностью.</InfoHint></span><button className="undo-tool" onClick={undo} disabled={undoStack.length === 0} title="Ctrl+Z">↶ Отменить</button></div>
</div>}
{drawingTab === "properties" && <div className="drawing-ribbon-page">          <aside className="library-properties" data-property-tab={propertyTab}><div className="drawing-property-tabs" role="group" aria-label="Свойства объекта">{(["geometry", "stroke", "fill"] as const).map(tab=><button type="button" key={tab} aria-pressed={propertyTab===tab} onClick={()=>setPropertyTab(tab)}>{({geometry:"Геометрия",stroke:"Линия",fill:"Заливка"})[tab]}</button>)}</div><label>Объект<select aria-label="Объект рисунка" value={selectedId ?? ""} onChange={e => { const id=e.target.value; const layer=activeView?.layers.find(l=>l.nodes.some(n=>n.id===id)); if(layer && activeView) setActiveLayerIds(v=>({...v,[activeView.id]:layer.id})); setSelectedId(id || null); }}><option value="">Не выбран</option>{activeView?.layers.flatMap(l=>l.nodes.map((n,i)=><option key={n.id} value={n.id}>{l.name} · {nodeLabel(n)} {i+1}</option>))}</select></label><h3>{selected?.node ? nodeLabel(selected.node) : selectedContactPoint && selectedLogicalContact ? `Контакт №${selectedTableRow?.number ?? selectedLogicalContact.number}` : selectedBundlePort ? "Общий выход пучка" : activeLayer ? "Слой" : "Вид"}</h3>
            {selectedNodeIds.length > 1 && <><button type="button" onClick={groupSelection} disabled={selectionLocked || !selectedNodeIds.every(id=>activeLayer?.nodes.some(node=>node.id===id))}>Сгруппировать</button><DrawingSelectionProperties allNodes={activeView?.layers.flatMap(layer=>layer.nodes)} nodes={selectedNodes} disabled={selectionLocked} change={style=>command(()=>styleDrawingSelection(draft.content,activeView!.id,selectedNodeIds,style))} /></>}
            {selectedNodeIds.length === 1 && selected?.node.kind === "group" && <><button type="button" onClick={ungroupSelection}>Разгруппировать</button><DrawingSelectionProperties allNodes={activeView?.layers.flatMap(layer=>layer.nodes)} nodes={selectedNodes} disabled={selectionLocked} change={style=>command(()=>styleDrawingSelection(draft.content,activeView!.id,selectedNodeIds,style))} /></>}
            {!selected?.node && !selectedPoint && activeView && <ViewAndLayerProperties content={draft.content} viewId={activeView.id} layerId={activeLayer?.id ?? null} change={changeContent} command={command} selectLayer={id => setActiveLayerIds(current => ({ ...current, [activeView.id]: id }))} selectView={setViewId} />}
             {selectedContactPoint && selectedLogicalContact && <label>Контакт таблицы №<select value={selectedRowBinding?.seriesRowId ?? ""} onChange={event => { const seriesRowId = event.target.value; setUndoStack(stack => [...stack.slice(-(TEMPLATE_UNDO_LIMIT - 1)), draft]); setDraft(current => ({...current,drawingContactBindings:[...(current.drawingContactBindings ?? []).filter(binding => binding.logicalContactId !== selectedLogicalContact.id && binding.seriesRowId !== seriesRowId),...(seriesRowId ? [{logicalContactId:selectedLogicalContact.id,seriesRowId}] : [])]})); markDirty(); }}><option value="">Не привязан</option>{drawingTableRows.map(row => <option key={row.seriesRowId} value={row.seriesRowId}>{row.number} · {row.name}</option>)}</select></label>}
             {selectedContactPoint && selectedLogicalContact && activeView && <ContactPointProperties
               point={selectedContactPoint}
               logical={selectedTableRow ? {...selectedLogicalContact, ...selectedTableRow} : selectedLogicalContact}
               tableBound={Boolean(selectedRowBinding)}
               groups={draft.content.contactTypeGroups}
               editLogical={changes => command(() => editLogicalContactV2(draft.content, selectedLogicalContact.id, changes))}
               editPoint={changes => command(() => editContactPointV2(draft.content, activeView.id, selectedContactPoint.id, changes))}
               remove={() => command(() => deleteContactPointV2(draft.content, activeView.id, selectedContactPoint.id), null)}
             />}
             {selectedContactPoint && !selectedLogicalContact && <p className="readonly-note">Логический контакт точки не найден. Проверьте диагностику шаблона.</p>}
             {selectedBundlePort && activeView && <BundlePortProperties port={selectedBundlePort} edit={changes => command(() => editBundlePortV2(draft.content, activeView.id, selectedBundlePort.id, changes))} remove={() => command(() => deleteBundlePortV2(draft.content, activeView.id, selectedBundlePort.id), null)} />}
            {selectedIds.length === 1 && selected?.node && !editableNode && <><p className="readonly-note">Сложный или параметризованный объект доступен только для чтения. Его данные сохраняются без потерь.</p><label>Тип<input value={selected.node.kind} readOnly /></label></>}
            {editableNode && selected && <NodeProperties textEditorRef={textEditorRef} section={propertyTab} node={editableNode} disabled={selected.layer.locked || editableNode.locked} edit={changes => command(() => editNodeV2(draft.content, activeView!.id, selected.layer.id, editableNode.id, changes))} move={(x, y) => command(() => setNodePosition(draft.content, activeView!.id, selected.layer.id, editableNode, x, y))} toggleLock={() => command(() => setNodeLockedV2(draft.content, activeView!.id, selected.layer.id, editableNode.id, !editableNode.locked))} />}
            {selected && selectedNodeIds.length === 1 && selected.node.transform.rotationDegrees.kind === "constant" && <div className="rotation-control"><NumericField label="Поворот, °" value={selected.node.transform.rotationDegrees.value} step={15} disabled={selected.layer.locked || selected.node.locked} change={rotateSelection} /><div className="property-order"><button type="button" disabled={selected.layer.locked || selected.node.locked} onClick={() => rotateSelection(selected.node.transform.rotationDegrees.kind === "constant" ? selected.node.transform.rotationDegrees.value - 90 : 0)}>−90°</button><button type="button" disabled={selected.layer.locked || selected.node.locked} onClick={() => rotateSelection(selected.node.transform.rotationDegrees.kind === "constant" ? selected.node.transform.rotationDegrees.value + 90 : 0)}>+90°</button></div></div>}
            {selected && selectedNodeIds.length === 1 && <><div className="property-order"><button onClick={() => reorderSelection("backward")} disabled={selected.layer.locked || selected.node.locked}>На шаг назад</button><button onClick={() => reorderSelection("forward")} disabled={selected.layer.locked || selected.node.locked}>На шаг вперёд</button></div><button className="danger-action" onClick={deleteSelection} disabled={selectionLocked}>Удалить объект</button></>}
          </aside>
</div>}
{drawingTab === "generator" && <div className="drawing-ribbon-page"><DrawingGeneratorPanel generator={activeGenerator} previewPeriods={generatorPreviewPeriods} setPreviewPeriods={setGeneratorPreviewPeriods} mode={generatorMode} articleId={selectedArticleVariantId} articles={draft.content.articleVariants.map(a=>({id:a.id,articleKey:a.articleKey,count:materializeE4ConnectorArticle(draft.e4ConnectorTable,a.id).rows.length}))} change={changeGenerator} assign={assignGenerator} apply={applyGenerator} choose={id=>{setGeneratorPreviewPeriods(undefined);setSelectedArticleVariantId(id);setSelectedIds([]);if(!activeGenerator?.articles.some(a=>a.articleId===id))setGeneratorMode("source");}} setMode={mode=>{setGeneratorPreviewPeriods(undefined);setGeneratorMode(mode);setSelectedIds([]);}} create={createGenerator}/></div>}
{drawingTab === "array" && <div className="drawing-ribbon-page">{activeView && activeLayer && <DrawingArrayPanel content={draft.content} viewId={activeView.id} layerId={activeLayer.id} selectedIds={selectedIds} onChange={changeContent} onError={setError} />}</div>}
{drawingTab === "contacts" && <div className="drawing-ribbon-page">{activeView && <TemplateContactsPanelV2
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
        </div>}
{drawingTab === "layers" && <div className="drawing-ribbon-page">{activeView && <TemplateLayersPanelV2
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
        </div>}
{drawingTab === "assets" && <div className="drawing-ribbon-page"><section className="library-assets"><div className="asset-upload"><label className={busy ? "disabled" : ""}>+ Изображение<input type="file" accept={IMAGE_IMPORT_ACCEPT} disabled={busy} onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void addAsset(file,true); }} /></label><InfoHint>PNG, JPG, BMP, SVG, HEIC: загрузите файл, перетащите его на поле или вставьте Ctrl+V. Изображение хранится в шаблоне как PNG. Выделите нужные объекты и сохраните их для артикула или всей серии.</InfoHint></div>{draft.assets.length > 0 && <div className="asset-list">{draft.assets.map(asset => <article key={asset.assetId}><div className="asset-preview">{draft.templateId && <img src={resolveAssetUrl(asset.assetId)} alt="" />}</div><div><strong>{asset.fileName}</strong><small>{(asset.sizeBytes / 1024).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} КиБ</small></div><div className="asset-actions"><button type="button" onClick={() => placeAsset(asset)} disabled={busy || !activeLayer || activeLayer.locked}>На вид</button><button type="button" className="asset-remove" onClick={() => void removeAsset(asset.assetId)} disabled={busy} aria-label={`Удалить изображение ${asset.fileName}`}>×</button></div></article>)}</div>}</section>
        </div>}
{drawingTab === "parameters" && <div className="drawing-ribbon-page">{activeView && <TemplateParametersPanelV2
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
          </div>}
{drawingTab === "articles" && <div className="drawing-ribbon-page">          <aside className="drawing-articles" aria-label="Рисунки артикулов"><header className="ui-section-heading"><strong>Артикулы</strong><InfoHint>Выделите фигуры и точки контактов, затем сохраните набор для нужного артикула. Группа сохраняется целиком. Кнопка записывает черновик на сервер; «Сохранить и выйти» публикует версию. Изменение общей фигуры отражается во всех наборах, куда она включена.</InfoHint></header>{draft.content.articleVariants.map(article => <div key={article.id} className={selectedArticleVariantId === article.id ? "active" : ""}><button type="button" onClick={() => openDrawingTarget(drawingTarget,article.id)} title="Открыть сохранённый рисунок">{article.articleKey}{findArticleDrawing(draft.articleDrawings,article.id,drawingTarget) ? " ✓" : ""}</button><button type="button" disabled={busy || assetMismatch || !selectedIds.length} onClick={() => void saveArticleDrawing(article.id)}>Сохранить</button></div>)}<button type="button" disabled={busy||!selectedIds.length||!draft.content.articleVariants.length} onClick={()=>void saveArticleDrawing(draft.content.articleVariants[0]!.id,true)}>Сохранить для всей серии</button><button type="button" disabled={busy} onClick={()=>setRemoveDrawingPrompt(true)}>Очистить рисунки раздела</button>{removeDrawingPrompt&&<div role="alertdialog" aria-label="Очистить рисунки раздела"><p>Удалить рисунки этого раздела для серии? Контакты таблицы сохранятся. Доступна отмена Ctrl+Z.</p><button type="button" onClick={clearTargetDrawings}>Очистить</button><button type="button" onClick={()=>setRemoveDrawingPrompt(false)}>Отмена</button></div>}<span role="status">{saved}</span></aside></div>}
          </div>
        <div className="library-workarea" onDragOver={e=>{if(e.dataTransfer.types.includes("Files"))e.preventDefault();}} onDrop={e=>{e.preventDefault();const file=e.dataTransfer.files[0];if(file&&!busy)void addAsset(file,true);}} onPaste={e=>{if((e.target as HTMLElement).closest("input,textarea,select"))return; if(!busy&&clipboard.current&&useInternalDrawingClipboard(e.clipboardData.getData("text/plain"),clipboardToken.current,clipboardSynchronized.current)){e.preventDefault();pasteSelection();return;} const file=Array.from(e.clipboardData.files)[0];if(file&&!busy){e.preventDefault();void addAsset(file,true);}}} inert={busy} id={activeView ? `template-view-panel-${activeView.id}` : undefined} role="region" aria-label="Поле редактирования рисунка">{activeView && <TemplateCanvasV2 content={generatorArticleMode && generatedPreview ? projectTemplateContentV3CoreToV2(generatedPreview.content) : compatibilityContent} viewId={activeView.id} selectedId={selectedId} selectedIds={selectedIds} onSelect={setSelectedId} onSelectionChange={selectCanvasObject} onBoxSelection={selectBoxObjects} onSelectionStretch={(factor,anchor)=>command(()=>stretchDrawingSelection(draft.content,activeView.id,selectedIds,factor,anchor))} onSelectionRotate={(angle,center)=>command(()=>rotateDrawingSelection(draft.content,activeView.id,selectedIds,angle,center))} onEditText={id => { setSelectedId(id); setDrawingTab("properties"); setPropertyTab("geometry"); requestAnimationFrame(() => { textEditorRef.current?.focus(); textEditorRef.current?.select(); }); }} onNodeMove={moveCanvasNode} onNodeResize={resizeCanvasNode} onNodeRotate={(_id, angle) => rotateSelection(angle)} snaps={drawingSnaps} onNodePointMove={moveCanvasPoint} onNodePointInsert={insertCanvasPoint} onNodePointDelete={deleteCanvasPoint} pointAngleMode={pointAngleMode} resolveAssetUrl={resolveAssetUrl} repeatedContactLabels={repeatedContactLabels} parameterDefaults={effectivePreviewParameterValues} />}

        {activeGenerator && generatorMode === "source" && <aside className="generator-preview" aria-label="Результат генератора"><strong>Вариант · {draft.content.articleVariants.find(a=>a.id===selectedArticleVariantId)?.articleKey}</strong>{generatedPreview ? <TemplateCanvasV2 content={projectTemplateContentV3CoreToV2(generatedPreview.content)} viewId={activeGenerator.viewId} selectedId={null} onSelect={()=>{}} resolveAssetUrl={resolveAssetUrl}/> : <span role="status">{generatorPreviewError}</span>}</aside>}
        </div>
        </section>}
      </section>
    </div>
  </div>;
}

function ViewAndLayerProperties({ content, viewId, layerId, change, command, selectLayer, selectView }: { content: TemplateContentV2; viewId: string; layerId: string | null; change: (content: TemplateContentV2, selection?: string | null) => void; command: (action: () => TemplateContentV2, selection?: string | null) => void; selectLayer: (id: string) => void; selectView: (id: string) => void }) {
  const view = content.views.find(item => item.id === viewId)!, layer = view.layers.find(item => item.id === layerId);
  return <><label>Название вида<input value={view.name} onChange={event => command(() => renameViewV2(content, view.id, event.target.value))} /></label>{view.kind === "additional" && <button className="danger-action" onClick={() => { const fallback = content.views.find(item => item.id !== view.id)!; command(() => deleteAdditionalViewV2(content, view.id), null); selectView(fallback.id); }}>Удалить дополнительный вид</button>}{layer && <><label>Название слоя<input value={layer.name} disabled={layer.locked} onChange={event => command(() => renameLayerV2(content, view.id, layer.id, event.target.value))} /></label><div className="property-order"><button disabled={layer.locked || view.layers[0]!.id === layer.id} onClick={() => command(() => reorderLayerV2(content, view.id, layer.id, view.layers.indexOf(layer) - 1))}>Выше</button><button disabled={layer.locked || view.layers.at(-1)!.id === layer.id} onClick={() => command(() => reorderLayerV2(content, view.id, layer.id, view.layers.indexOf(layer) + 1))}>Ниже</button></div><button className="danger-action" disabled={layer.locked || view.layers.length === 1} onClick={() => { const fallback = view.layers.find(item => item.id !== layer.id)!; change(deleteLayerV2(content, view.id, layer.id), null); selectLayer(fallback.id); }}>Удалить слой</button></>}</>;
}

function ContactPointProperties({ point, logical, groups, editLogical, editPoint, remove, tableBound }: { tableBound?: boolean; point: ViewContactPointV2; logical: LogicalContactV2; groups: TemplateContentV2["contactTypeGroups"]; editLogical: (changes: LogicalContactEditV2) => void; editPoint: (changes: ContactPointEditV2) => void; remove: () => void }) {
  const x = constantValue(point.x), y = constantValue(point.y);
  return <>
    <strong>Общие данные контакта</strong>
    {tableBound && <InfoHint>Номер, название, цепь, тип и стандартный терминал наследуются из строки таблицы Э4. Здесь меняется только положение точки.</InfoHint>}
    <label>Номер контакта<input disabled={tableBound} value={logical.number} onChange={event => editLogical({ number: event.target.value })} /></label>
    <label>Название<input disabled={tableBound} value={logical.name} onChange={event => editLogical({ name: event.target.value })} /></label>
    <label>Цепь<input disabled={tableBound} value={logical.circuitText ?? ""} onChange={event => editLogical({ circuitText: event.target.value })} placeholder="Например, DATA+" /></label>
    <label>Группа контакта<select disabled={tableBound} value={logical.contactTypeGroupId ?? ""} onChange={event => editLogical({ contactTypeGroupId: event.target.value || null })}><option value="">Не задана</option>{groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
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

function NodeProperties({ node, disabled, edit, move, toggleLock, section, textEditorRef }: { section: "geometry" | "stroke" | "fill"; textEditorRef: React.RefObject<HTMLInputElement | null>; node: EditableNode; disabled: boolean; edit: (changes: NodeEditV2) => void; move: (x: number, y: number) => void; toggleLock: () => void }) {
  const position = nodePosition(node), dimensions = nodeDimensions(node);
  const strokeWidth = constantValue(node.stroke.width) ?? 0;
  const canFill = node.kind === "rectangle" || node.kind === "ellipse" || node.kind === "closedContour" || node.kind === "bezier" && node.geometry.closed;
  const fillEnabled = canFill && node.fill.color !== null;
  const updateStroke = (changes: Partial<typeof node.stroke>) => edit({ stroke: { ...node.stroke, ...changes } });
  const colors = ["#111827", "#6b7280", "#ffffff", "#dc2626", "#f59e0b", "#16a34a", "#2563eb", "#7c3aed"];
  return <>
    {section === "geometry" && <button type="button" onClick={toggleLock}>{node.locked ? "Разблокировать объект" : "Заблокировать объект"}</button>}
    {section !== "geometry" && <section className="node-style-panel" aria-label="Стиль фигуры">
      <strong>Стиль</strong>
      {section === "fill" && canFill && <div className="style-section">
        <label className="check-field"><input type="checkbox" checked={fillEnabled} disabled={disabled} onChange={event => edit({ fill: { ...node.fill, color: event.target.checked ? node.fill.color ?? "#ffffff" : null } })} />Заливка</label>
        {fillEnabled && <>
          <label>{node.fill.hatch ? "Цвет штриховки" : "Цвет заливки"}<input type="color" value={node.fill.color ?? "#ffffff"} disabled={disabled} onChange={event => edit({ fill: { ...node.fill, color: event.target.value } })} /></label>
          <div className="style-swatches" aria-label="Быстрый выбор цвета заливки">{colors.map(color => <button key={color} type="button" aria-label={`Цвет заливки ${color}`} title={color} style={{background:color}} disabled={disabled} onClick={() => edit({fill:{...node.fill,color}})} />)}</div>
          <label>Штриховка<select disabled={disabled} value={node.fill.hatch?.kind ?? "solid"} onChange={e => edit({fill: e.target.value === "solid" ? {color:node.fill.color} : {...node.fill,hatch:{...node.fill.hatch,kind:e.target.value as DrawingHatch["kind"],spacing:node.fill.hatch?.spacing ?? 8,angle:node.fill.hatch?.angle ?? 45}}})}><option value="solid">Сплошная</option>{hatchKinds.map(kind => <option key={kind} value={kind}>{hatchLabels[kind]}</option>)}</select></label>
          {node.fill.hatch && <>
            <label className="check-field"><input type="checkbox" checked={!!node.fill.hatch.backgroundColor} disabled={disabled} onChange={e=>edit({fill:{...node.fill,hatch:{...node.fill.hatch!,backgroundColor:e.target.checked?"#ffffff":null}}})}/>Фон штриховки</label>
            <label>Цвет фона<input type="color" value={node.fill.hatch.backgroundColor ?? "#ffffff"} disabled={disabled} onChange={e=>edit({fill:{...node.fill,hatch:{...node.fill.hatch!,backgroundColor:e.target.value}}})}/></label>
            <div className="style-swatches" aria-label="Быстрый выбор цвета фона">{colors.map(color=><button key={color} type="button" title={color} aria-label={`Цвет фона ${color}`} style={{background:color}} disabled={disabled} onClick={()=>edit({fill:{...node.fill,hatch:{...node.fill.hatch!,backgroundColor:color}}})}/>)}</div>
          </>}
          {node.fill.hatch && <div className="coordinate-grid"><NumericField label="Шаг штриховки" min={2} max={100} value={node.fill.hatch.spacing} disabled={disabled} change={spacing => { if(spacing>=2 && spacing<=100) edit({fill:{...node.fill,hatch:{...node.fill.hatch!,spacing}}}); }} /><NumericField label="Угол штриховки, °" min={-360} max={360} value={node.fill.hatch.angle} disabled={disabled} change={angle => { if(Math.abs(angle)<=360) edit({fill:{...node.fill,hatch:{...node.fill.hatch!,angle}}}); }} /></div>}
          <InfoHint>Мотивы для разрезов: линии, сетка, пары, точки и кладка. Назначение материала выбирает автор; набор не заменяет требования ГОСТ 2.306 и ISO 128 к конкретному документу. Меньше шаг — плотнее штриховка.</InfoHint>
        </>}
      </div>}
      {section === "stroke" && <div className="style-section">
        <label>Цвет линии<input type="color" value={node.stroke.color} disabled={disabled} onChange={event => updateStroke({ color: event.target.value })} /></label>
        <div className="style-swatches" aria-label="Быстрый выбор цвета линии">{colors.map(color => <button key={color} type="button" title={color} aria-label={`Цвет линии ${color}`} style={{ background: color }} className={node.stroke.color.toLowerCase() === color ? "active" : ""} disabled={disabled} onClick={() => updateStroke({ color })} />)}</div>
        <div className="style-row"><NumericField label="Толщина" value={strokeWidth} min={0} max={24} step={0.5} disabled={disabled || node.stroke.width.kind !== "constant"} change={value => { if (value >= 0 && value <= 24) updateStroke({ width: constantExpressionV2(value) }); }} />
          <label>Штрих<select value={node.stroke.dash ?? "solid"} disabled={disabled} onChange={event => updateStroke({ dash: event.target.value as NonNullable<typeof node.stroke.dash> })}><option value="solid">Сплошная</option><option value="dash">Штрих</option><option value="dot">Точки</option><option value="dash-dot">Штрих-точка</option></select></label></div>
      </div>}
    </section>}
    {section === "geometry" && <>
    {node.kind === "text" && <label>Текст<input ref={textEditorRef} aria-label="Содержимое текста" value={node.geometry.text} disabled={disabled} onChange={event => edit({ geometry: { ...node.geometry, text: event.target.value } })} /></label>}
    <div className="coordinate-grid"><NumericField label="X" value={position.x} disabled={disabled} change={value => move(value, position.y)} /><NumericField label="Y" value={position.y} disabled={disabled} change={value => move(position.x, value)} />{dimensions && <><NumericField label="Ширина" value={dimensions.width} min={1} disabled={disabled} change={value => editDimension(node, "width", value, edit)} /><NumericField label="Высота" value={dimensions.height} min={1} disabled={disabled} change={value => editDimension(node, "height", value, edit)} /></>}</div>
    <NumericField label="Прозрачность, %" value={Math.round((1-node.opacity)*100)} min={0} max={100} step={1} disabled={disabled} change={value => { if (value >= 0 && value <= 100) edit({ opacity: 1-value/100 }); }} />
    {(node.kind === "line" || node.kind === "polyline" || node.kind === "bezier" || node.kind === "closedContour") && <InfoHint>Перетаскивайте маркеры точек. Двойной щелчок по сегменту добавляет вершину, по внутренней вершине — удаляет её.</InfoHint>}
    {(node.kind === "line" || node.kind === "polyline") && <NumericField label="Радиус изгиба" value={constantValue(node.geometry.bendRadius) ?? 0} min={0} disabled={disabled || node.geometry.bendRadius.kind !== "constant"} change={value => { if (value >= 0) edit({ geometry: { ...node.geometry, bendRadius: constantExpressionV2(value) } }); }} />}
    {node.kind === "image" && <ImageProperties node={node} disabled={disabled} edit={edit} />}
    </>}
  </>;
}

function ImageProperties({ node, disabled, edit }: { node: ImageNodeV2; disabled: boolean; edit: (changes: NodeEditV2) => void }) {
  const crop = (key: "cropX" | "cropY" | "cropWidth" | "cropHeight", value: number) => { if (value >= 0 && value <= 1) edit({ geometry: { ...node.geometry, [key]: value } }); };
  return <><label className="check-field"><input type="checkbox" checked={node.geometry.underlay} disabled={disabled} onChange={event => edit({ geometry: { ...node.geometry, underlay: event.target.checked } })} />Подложка</label><div className="coordinate-grid"><NumericField label="Crop X" value={node.geometry.cropX} disabled={disabled} change={value => crop("cropX", value)} /><NumericField label="Crop Y" value={node.geometry.cropY} disabled={disabled} change={value => crop("cropY", value)} /><NumericField label="Crop ширина" value={node.geometry.cropWidth} disabled={disabled} change={value => crop("cropWidth", value)} /><NumericField label="Crop высота" value={node.geometry.cropHeight} disabled={disabled} change={value => crop("cropHeight", value)} /></div></>;
}

function NumericField({ label, value, disabled, min, max, step, change }: { label: string; value: number; disabled?: boolean; min?: number; max?: number; step?: number; change: (value: number) => void }) {
  return <label>{label}<input type="number" value={value} min={min} max={max} step={step} disabled={disabled} onChange={event => { const parsed = Number(event.target.value); if (Number.isFinite(parsed)) change(parsed); }} /></label>;
}

function nodeLabel(node: TemplateNodeV2) { return ({ line: "Линия", polyline: "Ломаная", rectangle: "Прямоугольник", ellipse: "Эллипс", bezier: "Кривая Безье", closedContour: "Контур", text: "Текст", image: "Изображение", group: "Группа" })[node.kind]; }
function nodePosition(node: EditableNode) { const tx = constantValue(node.transform.translateX)!, ty = constantValue(node.transform.translateY)!; if (node.kind === "line" || node.kind === "polyline" || node.kind === "bezier" || node.kind === "closedContour") return { x: constantValue(node.geometry.points[0]!.x)! + tx, y: constantValue(node.geometry.points[0]!.y)! + ty }; if (node.kind === "ellipse") return { x: constantValue(node.geometry.centerX)! - constantValue(node.geometry.radiusX)! + tx, y: constantValue(node.geometry.centerY)! - constantValue(node.geometry.radiusY)! + ty }; return { x: constantValue(node.geometry.x)! + tx, y: constantValue(node.geometry.y)! + ty }; }
function nodeDimensions(node: EditableNode): { width: number; height: number } | null { if (node.kind === "line" || node.kind === "polyline" || node.kind === "bezier" || node.kind === "closedContour" || node.kind === "text") return null; if (node.kind === "ellipse") return { width: constantValue(node.geometry.radiusX)! * 2, height: constantValue(node.geometry.radiusY)! * 2 }; return { width: constantValue(node.geometry.width)!, height: constantValue(node.geometry.height)! }; }

function setNodePosition(content: TemplateContentV2, viewId: string, layerId: string, node: EditableNode, x: number, y: number): TemplateContentV2 {
  const current = nodePosition(node);
  return moveNodeV2(content, viewId, layerId, node.id, x - current.x, y - current.y);
}
function editDimension(node: EditableNode, key: "width" | "height", value: number, edit: (changes: NodeEditV2) => void) { if (value <= 0 || node.kind === "line" || node.kind === "polyline" || node.kind === "bezier" || node.kind === "closedContour" || node.kind === "text") return; const c = constantExpressionV2; if (node.kind === "ellipse") edit({ geometry: { ...node.geometry, [key === "width" ? "radiusX" : "radiusY"]: c(value / 2) } }); else edit({ geometry: { ...node.geometry, [key]: c(value) } }); }
