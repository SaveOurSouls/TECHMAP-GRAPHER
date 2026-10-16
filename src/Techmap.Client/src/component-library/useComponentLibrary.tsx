import { type Props, type Draft, type LoadedTemplate } from "./library-editor-types";
import { useWireDatabaseLookup } from "../editor/editor-reference-catalog";
import { useMemo, useState, useRef, useEffect, useCallback } from "react";
import { createComponentTemplateApi, type ComponentTemplateSummary, type ArticleBinding, type ComponentTemplate, type ComponentTemplateDraft, type TemplateAsset } from "./component-template-api";
import { createReferenceCatalogApi } from "../reference-catalog-api";
import { loadLibraryRecovery, newDraft, firstLayerIds, errorText, TEMPLATE_UNDO_LIMIT, compatibleTerminalsFromV3, applySeriesTerminalsToEditor, addLegacyArticleBindingsToV3, v3CoreFromV4, reconcileE4ConnectorTable, articleBindingsFromTemplateV3, shouldAutoSaveTemplate } from "./library-draft-adapters";
import { LibraryNavigationController, type LibraryNavigationChoice, librarySaveAcknowledgesCurrentEdit } from "./library-navigation-controller";
import { type DrawingTarget, drawingContactContent, articleDrawingView, findArticleDrawing, separateLegacyDrawings, drawingSelection } from "./drawing-bindings";
import { type TemplateV2Diagnostic, type ParameterValueV2 } from "./template-model-v2";
import { type TemplatePointAngleModeV2 } from "./TemplateCanvasV2";
import { type DrawingClipboard, drawingKeyboardAction, copyDrawingSelection, pasteDrawingSelection, deleteDrawingSelection, moveDrawingSelection } from "./drawing-selection";
import { defaultDrawingSnaps } from "./drawing-geometry";
import { isEditableConstantNode, isTemplateUndoShortcut, createTemplateImageNodeV2, isTemplateAssetReferencedV2, nextTemplateSelectionV2 } from "./library-node-editing";
import { drawingArrayContactRows } from "./drawing-array-contacts";
import { projectTemplateContentV3CoreToV2, setArticleVariantContactGroupV3, removeArticleVariantContactGroupV3, addAdditionalViewV3, addNodeV3 as addNodeV2, type BasicNodeKindV3 as BasicNodeKindV2, addBasicNodeV3 as addBasicNodeV2, linkLogicalContactPointV3 as linkLogicalContactPointV2, addContactPointV3 as addContactPointV2, addBundlePortV3 as addBundlePortV2, editContactPointV3 as editContactPointV2, constantExpressionV3 as constantExpressionV2, editBundlePortV3 as editBundlePortV2, moveNodeV3 as moveNodeV2, groupRootNodesV3, ungroupRootNodeV3, reorderRootNodeStepV3, setRootNodeRotationAroundCenterV3, type NodeResizeHandleV3 as NodeResizeHandleV2, resizeNodeV3 as resizeNodeV2, moveNodePointV3, insertNodePointV3, deleteNodePointV3, addAdditionalViewV3 as addAdditionalViewV2, addLayerV3 as addLayerV2 } from "./template-commands-v3";
import { materializeE4ConnectorArticle, type E4ConnectorSeriesTable, createE4ConnectorSeriesTableFromV3, setArticleContactGroupStandardTerminal } from "./e4-connector-series-table";
import { withDrawingArticleCounts } from "./drawing-array-commands";
import { materializeArticleVariantV3 } from "./template-article-materialization-v3";
import { materializeArticleContactRowsV3 } from "./template-article-contact-rows-v3";
import { createTemplateContentV5FromEditor, type TerminalContactTypeBindingV5, projectTemplateContentV5ToV3, projectTemplateContentV5TableToV1 } from "./template-model-v5";
import { standardTerminalKeyV3 } from "./TemplateSeriesPanelV3";
import { articleIdentity, searchTerminalArticles } from "./library-catalog-adapters";
import { materializeGenerator, newDrawingGenerator, generatorFromLegacyArray, type DrawingGenerator, validateDrawingGenerators, type GeneratorRole, assignGeneratorRole, reconcileDrawingGenerators, guardGeneratorArticleEdit } from "./drawing-generator";
import { type TemplateContentV3 as TemplateContentV2 } from "./template-model-v3";
import { isTemplateContentV5, isTemplateContentV1, upgradeComponentTemplateContentV1ToV3, isTemplateContentV2, upgradeComponentTemplateContentV2, reconcileTemplateEnvelopeAssets, isTemplateContentV3, isTemplateContentV4 } from "./template-content";
import { removeLibraryDraftRecovery, writeLibraryDraftRecovery } from "./library-draft-recovery";
import { reconcileArticleDrawings, detachIncompleteGenerators, clearArticleDrawings } from "./drawing-reset";
import { expandTemplateRepeatsV2 } from "./template-repeat-v2";
import { validateArticleDrawingContacts } from "./drawing-contact-validation";
import { importDrawingImage } from "./image-import";

export function useComponentLibrary({ config, session, onNavigationGuard }: Props) {
  const wireLookup = useWireDatabaseLookup(config, session);
  const api = useMemo(() => createComponentTemplateApi(config, session), [config, session]);
  const referenceApi = useMemo(() => createReferenceCatalogApi(config, session), [config, session]);
  const [items, setItems] = useState<readonly ComponentTemplateSummary[]>([]);
  const [recovery] = useState(loadLibraryRecovery);
  const [draft, setDraft] = useState<Draft>(() => recovery?.draft ?? newDraft());
  const editSequence = useRef(0);
  const hasEdited = useRef(Boolean(recovery));
  const navigationController = useRef(new LibraryNavigationController());
  const choiceResolver = useRef<((choice: LibraryNavigationChoice) => void) | null>(null);
  const [navigationPrompt, setNavigationPrompt] = useState(false);
  const navigationDialog = useRef<HTMLDialogElement>(null);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [viewId, setViewId] = useState(() => draft.content.views[0]!.id);
  const [activeLayerIds, setActiveLayerIds] = useState<Record<string, string>>(() => firstLayerIds(draft.content));
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const selectedId = selectedIds.at(-1) ?? null;
  const setSelectedId = (id: string | null) => setSelectedIds(id ? [id] : []);
  const [busy, setBusy] = useState(false);
  const [drawingTarget,setDrawingTarget]=useState<DrawingTarget>("drawing");
  const [removeDrawingPrompt,setRemoveDrawingPrompt]=useState(false);
  const [clearDrawingScope,setClearDrawingScope]=useState<"article"|"series">("series");
  const [dirty, setDirty] = useState(recovery?.dirty ?? true);
  const [autoSaveFailed, setAutoSaveFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(recovery ? "Восстановлен последний черновик библиотеки" : null);
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
  const isNewSeries = draft.templateId === null;

  const activeView = draft.content.views.find(view => view.id === viewId) ?? (graphicEditorMode==="drawing" ? draft.content.views.find(v=>v.id===draft.drawingGenerators?.find(g=>g.target===drawingTarget)?.viewId) ?? draft.content.views.find(v=>v.name===(drawingTarget==="e4"?"Рисунки · Схема Э4":"Рисунки · Маршрут")) ?? draft.content.views.find(v=>v.kind==="drawing") : draft.content.views[0]);
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
  const editorContent = useMemo(() => {
    if (graphicEditorMode !== "drawing" || !selectedArticleVariantId || activeGenerator) return compatibilityContent;
    const view = compatibilityContent.views.find(item => item.id === activeView?.id);
    if (!view) return compatibilityContent;
    const filtered = articleDrawingView(view, draft.articleDrawings, selectedArticleVariantId, drawingTarget);
    return { ...compatibilityContent, views: compatibilityContent.views.map(item => item.id === view.id ? filtered : item) };
  }, [activeGenerator, activeView?.id, compatibilityContent, draft.articleDrawings, drawingTarget, graphicEditorMode, selectedArticleVariantId]);
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
    try { return createTemplateContentV5FromEditor(draft.content, draft.e4ConnectorTable, draft.compatibleTerminalArticleKeys, draft.terminalContactTypeBindings, draft.e4Presentation, draft.articleDrawings, draft.drawingContactBindings, draft.drawingGenerators, draft.compatibleSeals ?? []).content; }
    catch { return null; }
  }, [draft.content, draft.e4ConnectorTable, draft.compatibleTerminalArticleKeys, draft.terminalContactTypeBindings, draft.e4Presentation, draft.articleDrawings, draft.drawingContactBindings, draft.drawingGenerators, draft.compatibleSeals]);
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
  let generatorPreviewError = "Рисунок можно сохранить пустым или продолжить редактирование исходника.";
  if(activeGenerator?.roles.period.length && activeGenerator.periodPointIds.length && selectedArticleVariantId) try { generatedPreview=materializeGenerator(draft.content,draft.e4ConnectorTable,draft.drawingContactBindings??[],activeGenerator,selectedArticleVariantId,generatorMode==="source"?generatorPreviewPeriods:undefined); } catch(caught){generatorPreviewError=errorText(caught);}
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
    try { validateDrawingGenerators(draft.content,draft.e4ConnectorTable,generators,true); }
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
    hasEdited.current = migrated;
    editSequence.current += 1;
    const compatibleTerminalArticleKeys = terminals?.map(item => ({ ...item })) ?? compatibleTerminalsFromV3(content);
    const projected = applySeriesTerminalsToEditor(content, table ?? createE4ConnectorSeriesTableFromV3(content), compatibleTerminalArticleKeys, bindings);
    setDraft({ drawingGenerators: isTemplateContentV5(item.content) ? structuredClone(item.content.drawingGenerators ?? []) : [], e4Presentation: isTemplateContentV5(item.content) ? item.content.e4Presentation : undefined, articleDrawings: isTemplateContentV5(item.content) ? structuredClone(item.content.articleDrawings ?? []) : [], drawingContactBindings: isTemplateContentV5(item.content) ? structuredClone(item.content.drawingContactBindings ?? []) : [], templateId: item.templateId, version: item.version, draftRevision: item.draftRevision, code: item.code, name: item.name, assets: [...item.assets], content: structuredClone(projected.content), compatibleTerminalArticleKeys, compatibleSeals: isTemplateContentV5(item.content) ? structuredClone(item.content.compatibleSeals ?? []) : [], terminalContactTypeBindings: bindings?.map(binding => structuredClone(binding)) ?? null, e4ConnectorTable: structuredClone(projected.table) });
    setViewId(content.views[0]!.id); setActiveLayerIds(firstLayerIds(content)); setSelectedId(null); setUndoStack([]);
    setGraphicEditorMode("e4");
    setPendingLogicalContactId(null);
    setSelectedArticleVariantId(null);
    setDirty(migrated); setAutoSaveFailed(false); setUpgradedFromV1(migrated); setAssetMismatch(mismatch); setDiagnostics(nextDiagnostics); setSaved(null);
    setPreviewParameterValues({});
    setTerminalArticleQuery(""); setTerminalArticleSuggestions([]); setTerminalArticleSearchState("idle"); setTerminalArticleSearchMessage(null);
  }

  async function open(summary: ComponentTemplateSummary) {
    if (!await requestNavigation()) return;
    setBusy(true);
    try {
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
    hasEdited.current = false;
    editSequence.current += 1;
    const next = newDraft(); setDraft(next); setViewId(next.content.views[0]!.id); setActiveLayerIds(firstLayerIds(next.content));
    setGraphicEditorMode("e4");
    setSelectedId(null); setUndoStack([]); setDirty(true); setAutoSaveFailed(false); setUpgradedFromV1(false); setAssetMismatch(false); setDiagnostics([]); setError(null); setSaved(null);
    setPendingLogicalContactId(null);
    setSelectedArticleVariantId(null);
    setPreviewParameterValues({});
    setTerminalArticleQuery(""); setTerminalArticleSuggestions([]); setTerminalArticleSearchState("idle"); setTerminalArticleSearchMessage(null);
  }
  async function startNew() {
    if (!await requestNavigation()) return;
    resetNewDraft();
  }
  function markDirty() { hasEdited.current = true; editSequence.current += 1; setDirty(true); setAutoSaveFailed(false); setSaved(null); if (!assetMismatch) setDiagnostics([]); }

  function clearRecovery(): boolean {
    try {
      if (removeLibraryDraftRecovery(window.localStorage)) { setRecoveryError(null); return true; }
    } catch { /* Storage may be disabled by the browser. */ }
    setRecoveryError("Не удалось удалить локальный черновик. Правки оставлены в редакторе.");
    return false;
  }

  function answerNavigation(choice: LibraryNavigationChoice) {
    setNavigationPrompt(false);
    choiceResolver.current?.(choice);
    choiceResolver.current = null;
  }

  async function saveDraftForNavigation(): Promise<boolean> {
    const sequence = editSequence.current;
    setBusy(true);
    try {
      const result = await persistWorkingDraft();
      if (!result) { setAutoSaveFailed(true); return false; }
      if ("baseVersion" in result) applySavedDraft(result, sequence);
      else applyPersisted(result, false, sequence);
      // App may unmount us immediately after resolving the guard, before the
      // recovery effect runs. Persist the ACK metadata synchronously as well.
      if (librarySaveAcknowledgesCurrentEdit(sequence, editSequence.current)) {
        const acknowledged = { ...draft, templateId: result.templateId, version: "baseVersion" in result ? result.baseVersion : result.version, draftRevision: "baseVersion" in result ? result.draftRevision : 0 };
        try { writeLibraryDraftRecovery(window.localStorage, acknowledged, false); } catch { /* server has acknowledged this draft */ }
      }
      return librarySaveAcknowledgesCurrentEdit(sequence, editSequence.current);
    } catch (caught) { setAutoSaveFailed(true); setError(errorText(caught)); return false; }
    finally { setBusy(false); }
  }

  function requestNavigation(): Promise<boolean> {
    return navigationController.current.request({
      hasChanges: dirty && hasEdited.current,
      busy,
      choose: () => new Promise(resolve => { choiceResolver.current = resolve; setNavigationPrompt(true); }),
      save: saveDraftForNavigation,
      discard: () => { if (!clearRecovery()) return false; resetNewDraft(); return true; },
    });
  }

  const navigationRef = useRef(requestNavigation);
  navigationRef.current = requestNavigation;
  useEffect(() => {
    onNavigationGuard?.(() => navigationRef.current());
    return () => { onNavigationGuard?.(null); choiceResolver.current?.("stay"); };
  }, [onNavigationGuard]);

  useEffect(() => {
    if (navigationPrompt) navigationDialog.current?.showModal();
    else navigationDialog.current?.close();
  }, [navigationPrompt]);

  useEffect(() => {
    if (!hasEdited.current && !draft.templateId) return;
    try {
      if (writeLibraryDraftRecovery(window.localStorage, draft, dirty)) { setRecoveryError(null); return; }
    } catch { /* Storage may be disabled by the browser. */ }
    setRecoveryError("Локальное восстановление недоступно. Сохраните черновик на сервере перед закрытием.");
  }, [draft, dirty]);

  useEffect(() => {
    if (!dirty || !hasEdited.current) return;
    const preventClose = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", preventClose);
    return () => window.removeEventListener("beforeunload", preventClose);
  }, [draft, dirty]);
  function setCompatibleTerminals(terminals: readonly ArticleBinding[]) {
    const identities = new Set(terminals.map(articleIdentity));
    const bindings = (draft.terminalContactTypeBindings ?? []).filter(binding => identities.has(articleIdentity(binding.terminalArticleKey)));
    const projected = applySeriesTerminalsToEditor(draft.content, draft.e4ConnectorTable, terminals, bindings);
    setDraft(current => ({ ...current, content: projected.content, compatibleTerminalArticleKeys: terminals.map(item => ({ ...item })), terminalContactTypeBindings: bindings, e4ConnectorTable: projected.table }));
    markDirty(); setError(null);
  }
  function changeContent(content: TemplateContentV2, selection?: string | null) {
    if (content === draft.content) return;
    let generators = reconcileDrawingGenerators(draft.content,content,draft.drawingGenerators??[]);
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
    const articleDrawings = reconcileArticleDrawings(draft.content, projected.content, draft.articleDrawings ?? [], graphicEditorMode === "drawing" && !activeGenerator ? activeView?.id : undefined, selectedArticleVariantId);
    const drawings = detachIncompleteGenerators(projected.content, generators, articleDrawings);
    setDraft(current => ({ ...current, content: projected.content, e4ConnectorTable: projected.table, ...drawings, terminalContactTypeBindings: bindings,
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
    if (graphicEditorMode === "drawing") {
      const restoredViewId = findArticleDrawing(previous.articleDrawings, selectedArticleVariantId, drawingTarget)?.viewId
        ?? previous.drawingGenerators?.find(generator => generator.target === drawingTarget && generator.articles.some(article => article.articleId === selectedArticleVariantId))?.viewId;
      if (restoredViewId) setViewId(restoredViewId);
      setGeneratorMode("source");
    }
    setDraft(current => ({ ...previous, templateId: current.templateId, version: current.version, draftRevision: current.draftRevision })); setSelectedId(null); markDirty(); setError(null); return stack.slice(0, -1);
  }), [drawingTarget, graphicEditorMode, selectedArticleVariantId]);
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
      v5Content = createTemplateContentV5FromEditor(working.content, working.e4ConnectorTable, working.compatibleTerminalArticleKeys, working.terminalContactTypeBindings, working.e4Presentation, working.articleDrawings, working.drawingContactBindings, working.drawingGenerators, working.compatibleSeals ?? []).content;
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
        // Publication can fail after the draft ACK; retries need its new revision.
        setDraft(current => ({ ...current, templateId: saved.templateId, version: saved.baseVersion, draftRevision: saved.draftRevision }));
      } else {
        return saved;
      }
    }
    return revision > 0 ? api.publishDraft(templateId!, version, revision) : api.get(templateId!);
  }

  function applySavedDraft(result: ComponentTemplateDraft, sequence = editSequence.current) {
    setDraft(current => ({ ...current, templateId: result.templateId, version: result.baseVersion, draftRevision: result.draftRevision }));
    if (!librarySaveAcknowledgesCurrentEdit(sequence, editSequence.current)) return;
    setDirty(false); setAutoSaveFailed(false); setSaved("Сохранено"); setError(null);
  }

  function applyPersisted(result: ComponentTemplate, resetUndo = false, sequence = editSequence.current) {
    if (!librarySaveAcknowledgesCurrentEdit(sequence, editSequence.current)) {
      setDraft(current => ({ ...current, templateId: result.templateId, version: result.version, draftRevision: 0 }));
      return;
    }
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
    setDraft({ drawingGenerators: isTemplateContentV5(result.content) ? structuredClone(result.content.drawingGenerators ?? []) : [], e4Presentation: isTemplateContentV5(result.content) ? result.content.e4Presentation : undefined, articleDrawings: isTemplateContentV5(result.content) ? structuredClone(result.content.articleDrawings ?? []) : [], drawingContactBindings: isTemplateContentV5(result.content) ? structuredClone(result.content.drawingContactBindings ?? []) : [], templateId: result.templateId, version: result.version, draftRevision: 0, code: result.code, name: result.name, assets: [...result.assets], content: structuredClone(projected.content), compatibleTerminalArticleKeys: terminals.map(item => ({ ...item })), compatibleSeals: isTemplateContentV5(result.content) ? structuredClone(result.content.compatibleSeals ?? []) : [], terminalContactTypeBindings: bindings === null ? null : structuredClone(bindings), e4ConnectorTable: structuredClone(projected.table) });
    // Asset mutations change the immutable envelope. Old snapshots could then
    // reintroduce content whose asset list no longer matches the server version.
    if (resetUndo) setUndoStack([]);
    setDirty(false); setAutoSaveFailed(false); setUpgradedFromV1(false); setAssetMismatch(false); setDiagnostics([]); setSaved("Сохранено"); setError(null);
  }
  async function save(): Promise<boolean> {
    if (!dirty && draft.draftRevision === 0) return true;
    const sequence = editSequence.current;
    setBusy(true);
    try {
      const result = await publishWorkingDraft();
      if (result) { applyPersisted(result, false, sequence); await loadList(); return librarySaveAcknowledgesCurrentEdit(sequence, editSequence.current); }
      setAutoSaveFailed(true); return false;
    } catch (caught) { setAutoSaveFailed(true); setError(errorText(caught)); return false; }
    finally { setBusy(false); }
  }
  function openDrawingTarget(target:DrawingTarget,articleId=selectedArticleVariantId) {
    if (!draft.templateId || busy) return;
    setGeneratorPreviewPeriods(undefined);
    const explicit = articleId ? findArticleDrawing(draft.articleDrawings, articleId, target) : undefined;
    const generator=explicit ? undefined : draft.drawingGenerators?.find(g=>g.target===target && draft.content.views.some(v=>v.id===g.viewId) && (!articleId || g.articles.some(a=>a.articleId===articleId) || !g.articles.length));
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
    setDrawingTarget(target);setViewId(view.id);setGraphicEditorMode("drawing");setSelectedArticleVariantId(articleId);setGeneratorMode("source");
    setSelectedIds(binding?[...binding.nodeIds,...binding.contactPointIds,...binding.bundlePortIds??[]]:[]);
  }
  function clearTargetDrawings() {
    if(!activeView)return;
    try {
      const ids = clearDrawingScope === "article" && selectedArticleVariantId ? [selectedArticleVariantId] : draft.content.articleVariants.map(article => article.id);
      const { viewId: clearedViewId, ...cleared } = clearArticleDrawings(draft, drawingTarget, ids, activeView.id);
      setUndoStack(stack=>[...stack.slice(-(TEMPLATE_UNDO_LIMIT-1)),draft]);
      setDraft(current=>({...current,...cleared})); setViewId(clearedViewId);
      markDirty();setRemoveDrawingPrompt(false);setSelectedIds([]);setGeneratorMode("source");setError(null);
    } catch(caught) { setError(errorText(caught)); }
  }
  async function saveArticleDrawing(articleVariantId: string,all=false) {
    if (!activeView) return;
    if(activeGenerator){
      const articleIds=all?draft.content.articleVariants.map(a=>a.id):[articleVariantId];
      const generator={...activeGenerator,articles:[...activeGenerator.articles.filter(a=>!articleIds.includes(a.articleId)),...articleIds.map(articleId=>activeGenerator.articles.find(a=>a.articleId===articleId)??{articleId,nodeIds:[]})]};
      const working={...draft,drawingGenerators:draft.drawingGenerators?.map(g=>g.id===generator.id?generator:g),articleDrawings:draft.articleDrawings?.filter(d=>!(articleIds.includes(d.articleVariantId)&&d.target===drawingTarget))};
      const body=validatedBody(working);if(!body||!working.templateId)return;
      setUndoStack(stack=>[...stack.slice(-(TEMPLATE_UNDO_LIMIT-1)),draft]);setDraft(working);markDirty();
      const sequence = editSequence.current;
      setBusy(true);
      try {const result=await api.saveDraft(working.templateId,{expectedVersion:working.version,expectedDraftRevision:working.draftRevision,...body});applySavedDraft(result, sequence);}
      catch(caught){setAutoSaveFailed(true);setError(errorText(caught));}finally{setBusy(false);}
      return;
    }
    const visibleView = editorContent.views.find(view => view.id === activeView.id)!;
    const ids = selectedIds.length ? selectedIds : [...visibleView.layers.flatMap(layer => layer.nodes.filter(node => node.visible).map(node => node.id)), ...visibleView.contactPoints.map(point => point.id), ...visibleView.bundlePorts.map(port => port.id)];
    const drawing = {...drawingSelection(activeView, ids, articleVariantId),target:drawingTarget,viewId:activeView.id};
    const articleIds=all?draft.content.articleVariants.map(a=>a.id):[articleVariantId];
    const working = { ...draft, drawingGenerators: draft.drawingGenerators?.map(generator => generator.target === drawingTarget ? {...generator, articles:generator.articles.filter(article=>!articleIds.includes(article.articleId))} : generator), articleDrawings: [...(draft.articleDrawings ?? []).filter(item => !(articleIds.includes(item.articleVariantId)&&item.target===drawingTarget)), ...articleIds.map(id=>({...drawing,articleVariantId:id}))] };
    const body = validatedBody(working); if (!body) return;
    setUndoStack(stack => [...stack.slice(-(TEMPLATE_UNDO_LIMIT - 1)), draft]);
    setDraft(working); markDirty();
    const sequence = editSequence.current;
    setBusy(true);
    try {
      const result = working.templateId ? await api.saveDraft(working.templateId, {expectedVersion:working.version,expectedDraftRevision:working.draftRevision,...body}) : await api.create(body);
      if ("baseVersion" in result) applySavedDraft(result, sequence); else applyPersisted(result, false, sequence);
      if (librarySaveAcknowledgesCurrentEdit(sequence, editSequence.current)) setSaved(`Рисунок ${draft.content.articleVariants.find(a => a.id === articleVariantId)?.articleKey} сохранён`);
      await loadList();
    } catch (caught) { setAutoSaveFailed(true); setError(errorText(caught)); } finally { setBusy(false); }
  }

  function returnToLibrary() {
    setGraphicEditorMode("e4");
    if (e4View) setViewId(e4View.id);
  }
  async function saveAndExitDrawing() {
    if (await save()) returnToLibrary();
  }

  useEffect(() => {
    if (navigationPrompt) return;
    // The current API creates a published first version. Only an explicit save
    // may do that; incomplete new series are protected by local recovery.
    if (!draft.templateId) return;
    if (!shouldAutoSaveTemplate({ dirty, failed: autoSaveFailed, busy, assetMismatch, code: draft.code, name: draft.name })) return;
    const timer = window.setTimeout(() => {
      const sequence = editSequence.current;
      setBusy(true);
      void persistWorkingDraft().then(result => {
        if (!result) setAutoSaveFailed(true);
        else if ("baseVersion" in result) applySavedDraft(result, sequence);
        else applyPersisted(result, false, sequence);
      }).catch(caught => { setAutoSaveFailed(true); setError(errorText(caught)); }).finally(() => setBusy(false));
    }, 900);
    return () => window.clearTimeout(timer);
  }, [assetMismatch, autoSaveFailed, busy, dirty, draft, navigationPrompt]);

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
      const assetInput = await importDrawingImage(file, { removeWhiteBackground: true });
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
          setDraft(current=>({...current,content:next,articleDrawings:reconcileArticleDrawings(core,next,current.articleDrawings??[],!activeGenerator?activeView.id:undefined,selectedArticleVariantId),drawingGenerators:current.drawingGenerators?.map(g=>
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
  function appendContact(shapeNodeId?: string) {
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
      if(shapeNodeId) content.views.find(v=>v.id===activeView.id)!.contactPoints.find(p=>p.id===id)!.shape={nodeId:shapeNodeId,fillFromWire:true};
      changeContent(content, shapeNodeId ?? id);
      if(activeGenerator && !activeGenerator.periodPointIds.length && activeGenerator.roles.period.length && !shapeNodeId) setDraft(current=>({...current,drawingGenerators:current.drawingGenerators?.map(g=>g.id===activeGenerator.id?{...g,periodPointIds:[id]}:g)}));
      setDraft(current => ({ ...current, drawingContactBindings: [...(current.drawingContactBindings ?? []).filter(binding => binding.logicalContactId !== logicalContactId && binding.seriesRowId !== row.seriesRowId), {logicalContactId,seriesRowId:row.seriesRowId}] }));
    } catch (caught) { setError(errorText(caught)); }
  }
  function changeShapeContact(enabled:boolean, fillFromWire?:boolean) {
    if(!selected || !activeView)return;
    const point=activeView.contactPoints.find(p=>p.shape?.nodeId===selected.node.id);
    if(enabled && !point){appendContact(selected.node.id);return;}
    const content=structuredClone(draft.content),view=content.views.find(v=>v.id===activeView.id)!;
    if(!enabled)view.contactPoints=view.contactPoints.filter(p=>p.id!==point?.id);
    else if(point)view.contactPoints.find(p=>p.id===point.id)!.shape!.fillFromWire=fillFromWire??false;
    changeContent(content,selected.node.id);
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

  return { activeGenerator, activeLayer, activeView, addAsset, addLayer, answerNavigation, appendBasic, appendBundlePort, appendContact, applyGenerator, assetMismatch, assignGenerator, autoSaveFailed, busy, changeContent, changeGenerator, changeShapeContact, clearDrawingScope, clearTargetDrawings, clipboard, clipboardSynchronized, clipboardToken, command, compatibilityContent, copySelection, createGenerator, deleteCanvasPoint, deleteSelection, diagnostics, dirty, draft, drawingSnaps, drawingTab, drawingTableRows, drawingTarget, e4PreviewContent, e4View, editableNode, editorContent, effectivePreviewParameterValues, error, generatedPreview, generatorArticleMode, generatorMode, generatorPreviewError, generatorPreviewPeriods, graphicEditorMode, groupSelection, hasClipboard, insertCanvasPoint, isNewSeries, items, loadList, markDirty, moveCanvasNode, moveCanvasPoint, navigationDialog, open, openDrawingTarget, pasteSelection, pendingLogicalContactId, placeAsset, placeLinkedContact, pointAngleMode, propertyTab, recovery, recoveryError, removeArticleContactGroup, removeAsset, removeDrawingPrompt, removeTemplate, reorderSelection, repeatedContactLabels, resizeCanvasNode, resolveAssetUrl, returnToLibrary, rotateSelection, save, saveAndExitDrawing, saveArticleDrawing, saved, selectBoxObjects, selectCanvasObject, selected, selectedArticleVariantId, selectedBundlePort, selectedContactPoint, selectedId, selectedIds, selectedLogicalContact, selectedNodeIds, selectedNodes, selectedPoint, selectedRowBinding, selectedTableRow, selectionLocked, setActiveLayerIds, setArticleContactGroup, setAutoSaveFailed, setClearDrawingScope, setCompatibleTerminals, setDraft, setDrawingSnaps, setDrawingTab, setError, setGeneratorMode, setGeneratorPreviewPeriods, setGraphicEditorMode, setPendingLogicalContactId, setPointAngleMode, setPreviewParameterValues, setPropertyTab, setRemoveDrawingPrompt, setSelectedArticleVariantId, setSelectedId, setSelectedIds, setSeriesStandardTerminal, setSeriesTerminalContactType, setStandardTerminal, setTerminalArticleQuery, setUndoStack, setViewId, standardTerminalArticleKeys, standardTerminalIdentities, startNew, terminalArticleQuery, terminalArticleSearchMessage, terminalArticleSearchState, terminalArticleSuggestions, terminalContactTypeGroupIds, textEditorRef, undo, undoStack, ungroupSelection, upgradedFromV1, wireLookup };
}
