import { type HarnessDesignEditorProps, type PendingComponentPlacement } from "./harness-editor-types";
import { useConnectionTableSettings } from "./connection-table-settings";
import { useMemo, useState, useRef, useEffect, useCallback } from "react";
import { createHarnessDesignApi, type HarnessDesignResource, parseRecoverableHarnessDesignContent } from "./design-api";
import { createDesignRecoveryApi, DesignRecoverySession, type ServerRecoveryDraft } from "./design-recovery-api";
import { createComponentTemplateApi } from "../component-library/component-template-api";
import { createComponentPlacementApi, componentPlacementRequest } from "./component-placement-api";
import { createGlobalCoveringPreparer, coveringMaterialChanged } from "./global-covering-materials";
import { useEditorReferenceCatalog, useTerminalArticleLookup, useWireDatabaseLookup } from "./editor-reference-catalog";
import { type HarnessEditorView, type EditorCatalogItem } from "./editor-types";
import { type TerminationArtifact } from "./termination-model";
import { type HarnessDesignDocument, isJunctionEndpoint, isScreenEndpoint, connectorE4TableGeometry, findWireEndpoint, type WireEndpoint } from "./model";
import { createTerminationPlacement } from "../termination-library";
import { type EditorHistory, createEditorHistory, executeEditorCommand, undoEditorCommand, redoEditorCommand } from "./history";
import { useCoveringAssets } from "./covering-assets";
import { type DrawingSnaps, defaultDrawingSnaps } from "../component-library/drawing-geometry";
import { type JoiningPipeDraft } from "./JoiningPipeEditor";
import { buildHarnessSelectionIndex, resolveHarnessSelection } from "./harness-selection";
import { type EditorSaveState } from "./HarnessEditorWorkspace";
import { type ProjectComponentSnapshotLookup, acceptProjectComponentSnapshotLookup, loadComponentTemplateForLocalCopy, localTemplateSnapshot, buildComponentTemplateViewInstances, loadComponentTemplateForPlacement } from "./harness-component-snapshots";
import { DesignSaveCoordinator } from "./design-save-coordinator";
import { resolveConnectedWireMaterials } from "./resolve-wire-materials";
import { hydrateTerminalDetails, wireEndTerminalCorrections } from "./terminal-details";
import { readHarnessDesignRecoveryDraft, browserRecoveryStorage, removeHarnessDesignRecoveryDraft, writeHarnessDesignRecoveryDraft } from "./design-recovery-draft";
import { reconcileDrawingDocuments, moveDrawingAnnotation } from "./drawing-documents";
import { migrateJoiningPipes, joiningPipeEndpoint, joiningPipeExit } from "./physical-joining-pipes";
import { normalizeEditorSelection, selectedEditorDeletionCommands, toUiLayers, snapRoutePoint } from "./harness-selection-adapters";
import { buildDrawingPerimeters } from "./drawing-object-perimeter";
import { type PhysicalCovering, coveringMaterial } from "./physical-coverings";
import { applyEditorCommand, e4RoutingIssues, type EditorCommand, createWire } from "./commands";
import { resolvePhysicalRoutePointCommand } from "./physical-route-point-command";
import { previewE4ConnectorMove } from "./e4-move-preview";
import { alignDrawingConnectorIndexes, moveDrawingIndex } from "./drawing-indices";
import { designToScene } from "./harness-scene-projection";
import { physicalNodePoint } from "./physical-ports";
import { pipeBundleNodePoint } from "./pipe-bundle-projection";
import { collectE4Diagnostics } from "./e4-diagnostics";
import { projectComponentTemplateView } from "./component-template-view-renderer";
import { volumeShadingEligible } from "./volume-shading";
import { ensureConnectorExits } from "./physical-topology";
import { terminationSceneObject } from "./termination-scene";
import { type TerminationLibraryRecord } from "../termination-library/catalog";
import { materializePlacementRows, rematerializeComponentTemplateConnectorArticle, firstPlaceableArticleVariantId, createConnectorInstanceFromComponentTemplateV3 } from "./component-template-placement";
import { builtInConnectorSeries, createBuiltInConnectorInstance } from "./connector-series-demo";
import { isTemplateContentV3, isTemplateContentV4, isTemplateContentV5 } from "../component-library/template-content";
import { refreshedTemplateTerminalCatalog } from "./template-terminal-catalog";
import { builtInWireColors, createCustomWireColor, resolveWireColorHex } from "./wire-reference-catalog";
import { wireStripProfileUpdateFromCatalogItem, cableMaterialUpdateFromCatalogItem, wireMaterialUpdateFromCatalogItem } from "./harness-catalog-adapters";
import { detachedWireBendInsertionIndex } from "./detached-wire-editing";
import { type E4DifferentialPairState, type E4ScreenState } from "./e4-wire-selection-state";

export function useHarnessDesignEditor({
  config,
  session,
  projectId,
  harnessId,
  harnessDesignation,
  initialView, harnessQuantity = 1, initialReveal,
  apiOverride,
  componentPlacementApiOverride,
  onClose,
  onViewChange,
  onRouteRequest,
  onSectionChange,
  localCopy,
}: HarnessDesignEditorProps) {
  // Subscribe the scene projection as well as the left-panel editor to the
  // global preference, so a column change is visible immediately on the field.
  const connectionTableSettings = useConnectionTableSettings();
  const api = useMemo(() => apiOverride ?? createHarnessDesignApi(config, session), [apiOverride, config, session]);
  const recoveryApi = useMemo(() => createDesignRecoveryApi(config, session), [config, session]);
  const recoverySession = useMemo(() => new DesignRecoverySession(recoveryApi, projectId, harnessId), [recoveryApi, projectId, harnessId]);
  const [recoveryError, setRecoveryError] = useState("");
  const recoveryCleanupWarning = "Документ сохранён, но очистка аварийной копии не выполнена. Копия сохранена для проверки.";
  const recoveryBusy = useRef(false);
  const recoveryArchives = useRef<Pick<ServerRecoveryDraft, "draftId" | "sequence">[]>([]);
  const componentTemplateApi = useMemo(() => createComponentTemplateApi(config, session), [config, session]);
  const componentPlacementApi = useMemo(
    () => componentPlacementApiOverride ?? createComponentPlacementApi(config, session),
    [componentPlacementApiOverride, config, session],
  );
  const prepareCoverings=useMemo(()=>createGlobalCoveringPreparer(config,session,projectId),[config,session,projectId]);
  const preparingCovering=useRef(false);
  const catalog = useEditorReferenceCatalog(config, session);
  const terminalLookup = useTerminalArticleLookup(config, session);
  const wireLookup = useWireDatabaseLookup(config, session);
  const [view, setView] = useState<HarnessEditorView>(localCopy ? "drawing" : initialView);
  const [terminationPicker,setTerminationPicker]=useState<{apply?:(artifact:TerminationArtifact)=>unknown;kind?:'terminal'|'sleeve';document?:HarnessDesignDocument}|null>(null);
  const [terminationDraft, setTerminationDraft] = useState<ReturnType<typeof createTerminationPlacement> | null>(null);
  const [terminationPickerError, setTerminationPickerError] = useState<string | null>(null);
  const [resource, setResource] = useState<HarnessDesignResource | null>(null);
  const [history, setHistory] = useState<EditorHistory | null>(null);
  const [hiddenObjectIds, setHiddenObjectIds] = useState<readonly string[]>(localCopy?.hiddenObjectIds ?? []);
  const [backgroundOpacity, setBackgroundOpacity] = useState(localCopy?.backgroundOpacity ?? 1);
  const textureAssets=useCoveringAssets(config,session,projectId,!!history?.present.drawingDocuments?.coveringLibrary?.textures.length,history?.present.drawingDocuments?.coveringLibrary?.textures.map(t=>t.sha256).join(",")??"");
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [selectedObjectIds, setSelectedObjectIds] = useState<readonly string[]>([]);
  const graphicsClipboardRef=useRef<readonly import("./drawing-documents").DrawingGraphic[]>([]);
  const [drawingSnaps,setDrawingSnaps]=useState<DrawingSnaps>(defaultDrawingSnaps);
  const [graphicAngleStep,setGraphicAngleStep]=useState(15);
  const [relatedSourceIds, setRelatedSourceIds] = useState<readonly string[]>([]);
  const [wholeNet, setWholeNet] = useState(false);
  const [joiningPipeDraft, setJoiningPipeDraft] = useState<JoiningPipeDraft | null>(null);
  const [revealRequest, setRevealRequest] = useState<{token: number; objectIds: readonly string[]} | undefined>();
  const selectionIndex = useMemo(() => history ? buildHarnessSelectionIndex(history.present) : null, [history?.present]);
  const related = useMemo(() => selectionIndex ? resolveHarnessSelection(selectionIndex, relatedSourceIds.length ? relatedSourceIds : selectedObjectIds, wholeNet) : {wireIds: [], componentIds: [], rowIds: [], unresolvedIds: []}, [selectionIndex, relatedSourceIds, selectedObjectIds, wholeNet]);
  const [activeWireStripEnd, setActiveWireStripEnd] = useState<"from" | "to">("from");
  const [editingObjectId, setEditingObjectId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<EditorSaveState>("saved");
  const [e4Detached, setE4Detached] = useState(false);
  const [refreshingTerminals, setRefreshingTerminals] = useState(false);
  const [uiFailureNonce, setUiFailureNonce] = useState(0);
  const [movePreview, setMovePreview] = useState<{
    readonly objectId: string;
    readonly point: { readonly x: number; readonly y: number };
    readonly mode?: import("./physical-editing").PhysicalDragMode;
  } | null>(null);
  const [message, setMessage] = useState("Загружаем документ жгута…");
  const [recoveryDrafts, setRecoveryDrafts] = useState<readonly {
    readonly id: string;
    readonly sequence?: number;
    readonly content: HarnessDesignDocument;
    readonly baseRevision: number;
    readonly serverContent?: unknown;
    readonly serverRevision?: number;
  }[]>([]);
  const [componentSnapshotsByPlacement, setComponentSnapshotsByPlacement] =
    useState<ProjectComponentSnapshotLookup>(() => new Map());
  const localTemplateLoading = useRef(new Set<string>());
  const localTemplateSnapshotIds = useRef(new Set<string>());
  const [componentGraphLoaded, setComponentGraphLoaded] = useState(false);
  const [componentGraphMessage, setComponentGraphMessage] = useState("");
  const historyRef = useRef<EditorHistory | null>(null);
  const resourceRef = useRef<HarnessDesignResource | null>(null);
  const savedJsonRef = useRef("");
  const savingRef = useRef(false);
  const saveCoordinatorRef = useRef<DesignSaveCoordinator | null>(null);
  const loadGeneration = useRef(0);
  const componentGraphRequestGeneration = useRef(0);
  const previewFrameRef = useRef<number | null>(null);
  const pendingMovePreviewRef = useRef<typeof movePreview>(null);
  const placementBusyRef = useRef(false);
  const placementOperationRef = useRef<symbol | null>(null);
  const pendingPlacementRef = useRef<PendingComponentPlacement | null>(null);
  const [placementBusy, setPlacementBusy] = useState(false);
  const [placementPending, setPlacementPending] = useState(false);
  const materialResolutionGeneration = useRef<number | null>(null);

  useEffect(() => { historyRef.current = history; }, [history]);
  const draftChangeRef = useRef(localCopy?.onDraftChange);
  draftChangeRef.current = localCopy?.onDraftChange;
  useEffect(() => {
    if (history) draftChangeRef.current?.(history.present, hiddenObjectIds, backgroundOpacity);
  }, [history?.present, hiddenObjectIds, backgroundOpacity]);
  useEffect(() => { resourceRef.current = resource; }, [resource]);
  useEffect(() => setView(localCopy ? "drawing" : initialView), [initialView, localCopy]);

  // Library presets contain mark and section text but older documents do not
  // contain the published record ID. Resolve that text once the active wire
  // snapshot is available, then update the connected conductor and both ends
  // in a single undo step.
  useEffect(() => {
    if (!history || wireLookup.databaseOptions.length === 0 || placementBusy || placementPending ||
        materialResolutionGeneration.current === loadGeneration.current) return;
    materialResolutionGeneration.current = loadGeneration.current;
    const resolved = resolveConnectedWireMaterials(history.present, wireLookup.databaseOptions);
    if (resolved === history.present) return;
    const next = { past: [...history.past, history.present].slice(-100), present: resolved, future: [] };
    historyRef.current = next;
    setHistory(next);
  }, [history, placementBusy, placementPending, wireLookup.databaseOptions]);

  // Descriptive catalog data enriches legacy contacts without changing their
  // selected articles or adding user-visible undo steps. Keep history coherent.
  useEffect(() => {
    if (!history || !terminalLookup.records.length || placementBusy || placementPending) return;
    const present = hydrateTerminalDetails(history.present, terminalLookup.records);
    if (present === history.present) return;
    const next = { present, past: history.past.map(doc => hydrateTerminalDetails(doc, terminalLookup.records)),
      future: history.future.map(doc => hydrateTerminalDetails(doc, terminalLookup.records)) };
    historyRef.current = next;
    setHistory(next);
  }, [history, terminalLookup.records, placementBusy, placementPending]);

  const refreshComponentGraph = useCallback(async (editorGeneration: number): Promise<void> => {
    const requestGeneration = ++componentGraphRequestGeneration.current;
    try {
      const graph = await componentPlacementApi.list(projectId, harnessId);
      if (editorGeneration !== loadGeneration.current ||
          requestGeneration !== componentGraphRequestGeneration.current) return;
      setComponentSnapshotsByPlacement((current) =>
        acceptProjectComponentSnapshotLookup(current, graph, editorGeneration, loadGeneration.current));
      setComponentGraphMessage("");
      setComponentGraphLoaded(true);
    } catch (error) {
      if (editorGeneration !== loadGeneration.current ||
          requestGeneration !== componentGraphRequestGeneration.current) return;
      setComponentSnapshotsByPlacement(new Map());
      setComponentGraphMessage(error instanceof Error
        ? `Не удалось загрузить закреплённые виды компонентов: ${error.message}`
        : "Не удалось загрузить закреплённые виды компонентов.");
      setComponentGraphLoaded(true);
    }
  }, [componentPlacementApi, harnessId, projectId]);
  const resolveComponentTemplateAssetUrl = useCallback(
    (snapshotId: string, assetId: string) => {
      if (localCopy && localTemplateSnapshotIds.current.has(snapshotId)) {
        const snapshot = [...componentSnapshotsByPlacement.values()].find(item => item.snapshotId === snapshotId);
        if (snapshot) return componentTemplateApi.assetContentUrl(snapshot.sourceTemplateId, snapshot.sourceVersion, assetId);
      }
      return componentPlacementApi.assetContentUrl(projectId, harnessId, snapshotId, assetId);
    },
    [componentPlacementApi, componentSnapshotsByPlacement, componentTemplateApi, harnessId, projectId, localCopy],
  );

  useEffect(() => {
    if (!localCopy || !history || !componentGraphLoaded) return;
    const generation = loadGeneration.current;
    for (const connector of history.present.connectors) {
      const binding = connector.libraryBinding;
      if (binding?.mode !== "template" || componentSnapshotsByPlacement.has(connector.id) || localTemplateLoading.current.has(connector.id)) continue;
      localTemplateLoading.current.add(connector.id);
      void loadComponentTemplateForLocalCopy(componentTemplateApi, binding.templateId, binding.templateVersion).then(template => {
        if (generation !== loadGeneration.current) return;
        if (template.versionSha256 !== binding.versionSha256) throw new Error("Версия библиотечного рисунка изменилась.");
        const snapshot = localTemplateSnapshot(projectId, template);
        localTemplateSnapshotIds.current.add(snapshot.snapshotId);
        setComponentSnapshotsByPlacement(current => new Map(current).set(connector.id, snapshot));
      }).catch(error => {
        if (generation === loadGeneration.current) setMessage(error instanceof Error ? error.message : "Не удалось загрузить библиотечный рисунок копии.");
      }).finally(() => localTemplateLoading.current.delete(connector.id));
    }
  }, [localCopy, history?.present.connectors, componentSnapshotsByPlacement, componentTemplateApi, projectId, componentGraphLoaded]);

  useEffect(() => {
    const generation = ++loadGeneration.current;
    placementOperationRef.current = null;
    placementBusyRef.current = false;
    pendingPlacementRef.current = null;
    setPlacementBusy(false);
    setPlacementPending(false);
    setTerminationDraft(null);
    setTerminationPicker(null);
    setResource(null);
    setHistory(null);
    setSelectedObjectId(null);
    setSelectedObjectIds([]);
    setRelatedSourceIds([]); setWholeNet(false); setRevealRequest(undefined);
    setE4Detached(false);
    setEditingObjectId(null);
    setMovePreview(null);
    setComponentSnapshotsByPlacement(new Map());
    localTemplateLoading.current.clear();
    localTemplateSnapshotIds.current.clear();
    setComponentGraphLoaded(false);
    setComponentGraphMessage("");
    setMessage("Загружаем документ жгута…");
    setRecoveryDrafts([]);
    setRecoveryError("");
    recoveryArchives.current = [];
    setSaveState("saved");
    if (localCopy) {
      const copied = structuredClone(localCopy.initialDocument);
      const localResource: HarnessDesignResource = {
        harnessId, schemaVersion: 1, revision: 0, content: copied,
        updatedUtc: new Date().toISOString(),
      };
      setResource(localResource);
      setHistory(createEditorHistory(copied));
      savedJsonRef.current = JSON.stringify(copied);
      setHiddenObjectIds(localCopy.hiddenObjectIds ?? []);
      setBackgroundOpacity(localCopy.backgroundOpacity ?? 1);
      setMessage("");
      void refreshComponentGraph(generation);
      return () => { loadGeneration.current += 1; componentGraphRequestGeneration.current += 1; };
    }
    const journalRequest = recoveryApi.list(projectId, harnessId).catch(() => {
      if (generation === loadGeneration.current) setRecoveryError("Аварийный журнал недоступен. Восстановление после смены порта не гарантировано; сохраните копию перед закрытием.");
      return [];
    });
    const designRequest = Promise.all([api.get(projectId, harnessId), journalRequest]).then(([loaded, journal]) => {
      if (generation !== loadGeneration.current) return;
      if (initialReveal?.projectId === projectId && initialReveal.harnessId === harnessId) {
        const found = resolveHarnessSelection(buildHarnessSelectionIndex(loaded.content), [initialReveal.objectId]);
        setRelatedSourceIds([initialReveal.objectId]);
        setRevealRequest({token: Date.now(), objectIds: [...found.wireIds, ...found.componentIds]});
      }
      const savedJson = JSON.stringify(loaded.content);
      let recoveryMessage = loaded.recoveryWarning ?? "";
      const candidates: typeof recoveryDrafts[number][] = [];
      for (const item of journal) {
        try {
          const parsed = parseRecoverableHarnessDesignContent(item.content).content;
          if (JSON.stringify(parsed) === savedJson) {
            // The server has acknowledged these exact contents. Older clients
            // could leave this journal behind when their DELETE URL was rejected.
            void recoveryApi.remove(projectId, harnessId, item.draftId, item.sequence).catch(() => {
              if (generation === loadGeneration.current) setRecoveryError(recoveryCleanupWarning);
            });
            continue;
          }
          candidates.push({ id: item.draftId, sequence: item.sequence, content: parsed,
            baseRevision: item.baseRevision, serverContent: item.serverContent, serverRevision: item.serverRevision });
        } catch { setRecoveryError("Одна из аварийных копий повреждена и сохранена на диске без изменений."); }
      }
      const draft = readHarnessDesignRecoveryDraft(browserRecoveryStorage(), projectId, harnessId);
      if (draft) {
        try {
          const recoveredDraft = parseRecoverableHarnessDesignContent(draft.content);
          if (JSON.stringify(recoveredDraft.content) !== savedJson) {
            if (!candidates.some(c => JSON.stringify(c.content) === JSON.stringify(recoveredDraft.content))) candidates.unshift({ id: "browser", content: recoveredDraft.content, baseRevision: draft.baseRevision, serverContent: loaded.content, serverRevision: loaded.revision });
            const revisionWarning = draft.baseRevision === loaded.revision
              ? ""
              : ` Черновик создан от ревизии ${draft.baseRevision}, на сервере уже ревизия ${loaded.revision}; после восстановления внимательно проверьте изменения.`;
            recoveryMessage = `Найдены несохранённые изменения этого жгута. Серверный документ открыт без изменений; восстановите черновик кнопкой ниже.${revisionWarning}`;
          } else {
            removeHarnessDesignRecoveryDraft(browserRecoveryStorage(), projectId, harnessId);
          }
        } catch {
          recoveryMessage = `${recoveryMessage ? `${recoveryMessage} ` : ""}Найден локальный черновик, но он повреждён и не применён.`;
        }
      }
      setRecoveryDrafts(candidates);
      setResource(loaded);
      setHistory(createEditorHistory(reconcileDrawingDocuments(loaded.content, migrateJoiningPipes(loaded.content))));
      savedJsonRef.current = savedJson;
      setMessage(recoveryMessage);
    }).catch((error: unknown) => {
      if (generation !== loadGeneration.current) return;
      setSaveState("error");
      setMessage(error instanceof Error ? error.message : "Не удалось загрузить документ жгута.");
    });

    const componentGraphRequest = refreshComponentGraph(generation);
    void Promise.allSettled([designRequest, componentGraphRequest]);
    return () => {
      loadGeneration.current += 1;
      componentGraphRequestGeneration.current += 1;
    };
  }, [api, harnessId, projectId, recoveryApi, refreshComponentGraph, localCopy?.initialDocument]);

  const saveOnce = useCallback(async (): Promise<boolean> => {
      if (localCopy) return true;
      savingRef.current = true;
      try {
        const currentHistory = historyRef.current;
        const currentResource = resourceRef.current;
        if (!currentHistory || !currentResource) return true;
        const content = currentHistory.present;
        const serialized = JSON.stringify(content);
        if (serialized === savedJsonRef.current) return true;
        setSaveState("saving");
        const saved = await api.save(projectId, harnessId, currentResource.revision, content);
        const savedJson = JSON.stringify(saved.content);
        savedJsonRef.current = savedJson;
        resourceRef.current = saved;
        setResource(saved);
        if (historyRef.current === currentHistory) {
          const acknowledgedHistory = { ...currentHistory, present: saved.content };
          historyRef.current = acknowledgedHistory;
          setHistory(acknowledgedHistory);
          setSaveState("saved");
          if (!recoveryDrafts.some(d => d.id === "browser")) removeHarnessDesignRecoveryDraft(browserRecoveryStorage(), projectId, harnessId);
          const generation = loadGeneration.current;
          const archivedAtSave = recoveryArchives.current.slice();
          void recoverySession.clear().then(() => recoveryApi.removeMany(projectId, harnessId, archivedAtSave)).then((removedIds) => {
            recoveryArchives.current = recoveryArchives.current.filter(draft => !removedIds.includes(draft.draftId));
            if (generation === loadGeneration.current) {
              setRecoveryDrafts(current => current.filter(draft => !removedIds.includes(draft.id)));
              setRecoveryError(current => current === recoveryCleanupWarning ? "" : current);
            }
          }).catch(() => {
            if (generation === loadGeneration.current) setRecoveryError(recoveryCleanupWarning);
          });
        } else {
          setSaveState("changed");
        }
        setMessage(saved.recoveryWarning ?? "");
        return true;
      } catch (error: unknown) {
        setSaveState("error");
        setMessage(error instanceof Error ? error.message : "Не удалось сохранить документ жгута.");
        return false;
      } finally {
        savingRef.current = false;
      }
  }, [api, harnessId, projectId, recoveryApi, recoveryDrafts, recoverySession, localCopy]);

  const flushSave = useCallback((): Promise<boolean> => {
    if (!saveCoordinatorRef.current) {
      saveCoordinatorRef.current = new DesignSaveCoordinator(saveOnce);
    }
    return saveCoordinatorRef.current.flush();
  }, [saveOnce]);

  useEffect(() => {
    saveCoordinatorRef.current = null;
  }, [saveOnce]);

  useEffect(() => {
    if (!history) return;
    if (localCopy) {
      setSaveState(JSON.stringify(history.present) === savedJsonRef.current ? "saved" : "changed");
      return;
    }
    if (JSON.stringify(history.present) === savedJsonRef.current) {
      if (!savingRef.current) setSaveState("saved");
      return;
    }
    const baseRevision = resourceRef.current?.revision;
    const recoveryGeneration = loadGeneration.current;
    if (baseRevision !== undefined) {
      const localWritten = !recoveryDrafts.some(d => d.id === "browser") && writeHarnessDesignRecoveryDraft(
        browserRecoveryStorage(),
        projectId,
        harnessId,
        baseRevision,
        history.present,
      );
      if (!localWritten) setRecoveryError("Локальная аварийная копия недоступна или содержит прежний конфликт. Ожидается запись серверного журнала; не закрывайте редактор.");
      void recoverySession.write(baseRevision, history.present).then(() => {
        if (recoveryGeneration !== loadGeneration.current) return;
        setRecoveryError(localWritten ? "" : "Аварийная копия записана на сервере. Резервная запись в браузере недоступна.");
      }).catch(() => {
        if (recoveryGeneration !== loadGeneration.current) return;
        setRecoveryError(localWritten
          ? "Серверный аварийный журнал не записан. Копия есть только в этом браузере и на этом порту; сохраните документ перед закрытием."
          : "Аварийная копия не записана ни в браузере, ни на сервере. Не закрывайте редактор; сохраните документ или скачайте копию.");
      });
    }
    setSaveState("changed");
    const timer = window.setTimeout(() => void flushSave(), 650);
    return () => window.clearTimeout(timer);
  }, [flushSave, harnessId, history, projectId, recoveryDrafts, recoverySession, localCopy]);

  useEffect(() => {
    if (!history) return;
    const availableObjectIds = new Set([
      ...history.present.connectors.map((item) => item.id),
      ...history.present.connectors.map((item) => `object-index:${item.id}`),
      ...history.present.wires.map((item) => item.id),
      ...history.present.wires.map((item) => `object-index:${item.id}`),
      ...history.present.drawingDocuments?.specificationItems?.map(i=>i.id) ?? [],
      ...history.present.drawingDocuments?.tables.map(t=>t.id) ?? [],
      ...history.present.drawingDocuments?.dimensions?.map(d=>d.id)??[],
      ...history.present.drawingDocuments?.leaders.flatMap(l=>[l.id,`${l.id}:anchor`]) ?? [],
      ...history.present.drawingDocuments?.rails?.flatMap(r=>[r.id,`${r.id}:start`,`${r.id}:end`]) ?? [],
      ...history.present.physicalTopology?.coverings?.map(c => c.id) ?? [],
      ...history.present.physicalTopology?.coverings?.map(c => `object-index:${c.id}`) ?? [],
      ...history.present.physicalTopology?.nodes.map(n => n.id) ?? [],
      ...history.present.physicalTopology?.segments.map(n => n.id) ?? [],
      ...history.present.physicalTopology?.joiningPipes?.flatMap(p=>[p.id,`${p.id}:from`,`${p.id}:to`])??[],
    ]);
    const normalized = normalizeEditorSelection(selectedObjectIds, selectedObjectId, availableObjectIds);
    if (normalized.primaryObjectId !== selectedObjectId) setSelectedObjectId(normalized.primaryObjectId);
    if (normalized.objectIds.length !== selectedObjectIds.length ||
        normalized.objectIds.some((id, index) => id !== selectedObjectIds[index])) {
      setSelectedObjectIds(normalized.objectIds);
    }
  }, [history, selectedObjectId, selectedObjectIds]);

  useEffect(() => {
    if (editingObjectId && (view !== "e4" || editingObjectId !== selectedObjectId)) setEditingObjectId(null);
  }, [editingObjectId, selectedObjectId, view]);

  useEffect(() => setActiveWireStripEnd("from"), [selectedObjectId]);

  const componentTemplateViewInstances = useMemo(() => history
    ? buildComponentTemplateViewInstances(history.present, componentSnapshotsByPlacement) : [],
    [history?.present, componentSnapshotsByPlacement]);
  const drawingPerimeters=useMemo(()=>buildDrawingPerimeters(componentTemplateViewInstances),[componentTemplateViewInstances]);

  const [selectedPipeInterval,setSelectedPipeInterval]=useState<{id:string;from:number;to:number}|null>(null);
  const [coveringPreview,setCoveringPreview]=useState<PhysicalCovering|null>(null);
  const [thicknessPreview,setThicknessPreview]=useState<number|null>(null);
  const [pipeOpacityPreview,setPipeOpacityPreview]=useState<number|null>(null);
  const [bendRadiusPreview,setBendRadiusPreview]=useState<number|null>(null);
  const [leaderScalePreview,setLeaderScalePreview]=useState<number|null>(null);
  const [indexScalePreview,setIndexScalePreview]=useState<number|null>(null);
  const [dimensionScalePreview,setDimensionScalePreview]=useState<number|null>(null);
  const [minimumOverlapPreview,setMinimumOverlapPreview]=useState<number|null>(null);
  const [opCoveringEdgePreview,setOpCoveringEdgePreview]=useState<number|null>(null);
  const [coveringRatioPreview,setCoveringRatioPreview]=useState<number|null>(null);
  const [pairPitchPreview,setPairPitchPreview]=useState<{id:string;step:number}|null>(null);
  const [pipePreview,setPipePreview]=useState<{id:string;index:number;point:{x:number;y:number};mode?:import("./physical-editing").PhysicalDragMode;insert?:boolean}|null>(null);
  const [freeEndPreviews,setFreeEndPreviews]=useState<readonly {wireId:string;end:"from"|"to";position:{x:number;y:number}}[]>([]);
  const previewResult = useMemo(() => {
    if (!history) return { document: null, error: null };
    if(freeEndPreviews.length){
      try{return {document:freeEndPreviews.reduce((document, preview)=>applyEditorCommand(document,{type:"set-wire-drawing-endpoint",...preview}),history.present),error:null};}
      catch(error){return {document:history.present,error:error instanceof Error?error.message:"Не удалось переместить конец провода."};}
    }
    if(pairPitchPreview)return {document:{...history.present,diffPairs:history.present.diffPairs.map(pair=>pair.id===pairPitchPreview.id?{...pair,step:pairPitchPreview.step}:pair)},error:null};
    if(bendRadiusPreview!==null)return {document:{...history.present,drawingDocuments:{...(history.present.drawingDocuments??{tables:[],leaders:[],bomOrder:[]}),bendRadius:bendRadiusPreview}},error:null};
    if(leaderScalePreview!==null)return {document:{...history.present,drawingDocuments:{...(history.present.drawingDocuments??{tables:[],leaders:[],bomOrder:[]}),leaderScale:leaderScalePreview}},error:null};
    if(indexScalePreview!==null)return {document:{...history.present,drawingDocuments:{...(history.present.drawingDocuments??{tables:[],leaders:[],bomOrder:[]}),indexScale:indexScalePreview}},error:null};
    if(dimensionScalePreview!==null)return {document:{...history.present,drawingDocuments:{...(history.present.drawingDocuments??{tables:[],leaders:[],bomOrder:[]}),dimensionScale:dimensionScalePreview}},error:null};
    if(minimumOverlapPreview!==null)return {document:{...history.present,drawingDocuments:{...(history.present.drawingDocuments??{tables:[],leaders:[],bomOrder:[]}),minimumCoveringOverlapPx:minimumOverlapPreview}},error:null};
    if(opCoveringEdgePreview!==null)return {document:{...history.present,drawingDocuments:{...(history.present.drawingDocuments??{tables:[],leaders:[],bomOrder:[]}),opCoveringEdgePx:opCoveringEdgePreview}},error:null};
    if(coveringRatioPreview!==null)return {document:{...history.present,drawingDocuments:{...(history.present.drawingDocuments??{tables:[],leaders:[],bomOrder:[]}),coveringDiameterRatio:coveringRatioPreview}},error:null};
    if(coveringPreview&&history.present.physicalTopology)return {document:{...history.present,physicalTopology:{...history.present.physicalTopology,coverings:history.present.physicalTopology.coverings?.map(c=>c.id===coveringPreview.id?coveringPreview:c)}},error:null};
    if(pipeOpacityPreview!==null)return {document:{...history.present,drawingDocuments:{...(history.present.drawingDocuments??{tables:[],leaders:[],bomOrder:[]}),pipeOpacity:1-pipeOpacityPreview/100}},error:null};
    if(thicknessPreview!==null)return {document:{...history.present,drawingDocuments:{...(history.present.drawingDocuments??{tables:[],leaders:[],bomOrder:[]}),physicalScale:thicknessPreview}},error:null};
    if(pipePreview&&view==="e4"){
      try{return {document:applyEditorCommand(history.present,{type:"edit-e4-bend",wireId:pipePreview.id,index:pipePreview.index,position:pipePreview.point,mode:pipePreview.mode??"carry",insert:pipePreview.insert}),error:null};}
      catch(error){return {document:history.present,error:error instanceof Error?error.message:"Не удалось изменить перегиб Э4."};}
    }
    if(pipePreview&&view==="drawing"&&history.present.wires.some(w=>w.id===pipePreview.id&&w.drawingEndpoints)){
      try{return {document:applyEditorCommand(history.present,{type:"edit-detached-wire-bend",wireId:pipePreview.id,index:pipePreview.index,position:pipePreview.point,insert:pipePreview.insert}),error:null};}
      catch(error){return {document:history.present,error:error instanceof Error?error.message:"Не удалось изменить перегиб."};}
    }
    if(pipePreview&&history.present.physicalTopology) {
      try{const command=resolvePhysicalRoutePointCommand(history.present,pipePreview.id,pipePreview.index,pipePreview.point,pipePreview.mode,pipePreview.insert);
        return {document:command?applyEditorCommand(history.present,command):history.present,error:null};}
      catch(error){return {document:history.present,error:error instanceof Error?error.message:"Не удалось изменить перегиб."};}
    }
    if (!movePreview) return { document: history.present, error: null };
    try {
      if (view === 'e4' && history.present.connectors.some(c => c.id === movePreview.objectId)) {
        return { document: previewE4ConnectorMove(history.present, movePreview.objectId,
          movePreview.point, movePreview.mode), error: null };
      }
      if(movePreview.objectId.startsWith("object-index:")){
        const indexScene=alignDrawingConnectorIndexes(history.present,designToScene(history.present,"drawing"),componentTemplateViewInstances,resolveComponentTemplateAssetUrl);
        const index=moveDrawingIndex(history.present,movePreview.objectId,movePreview.point,indexScene);
        if(index)return {document:{...history.present,drawingDocuments:index},error:null};
      }
      const annotation=moveDrawingAnnotation(history.present,movePreview.objectId,movePreview.point,drawingPerimeters);
      if(annotation)return {document:{...history.present,drawingDocuments:annotation},error:null};
      const topology = history.present.physicalTopology;
      const joiningPipe=topology?.joiningPipes?.find(pipe=>pipe.id===movePreview.objectId);
      if(joiningPipe){
        return {document:applyEditorCommand(history.present,{type:"move-joining-pipe",pipeId:joiningPipe.id,delta:movePreview.point}),error:null};
      }
      const opEndpoint=joiningPipeEndpoint(topology,movePreview.objectId);
      if(opEndpoint){
        return {document:applyEditorCommand(history.present,{type:"update-joining-pipe",pipeId:opEndpoint.pipe.id,[opEndpoint.side==="from"?"start":"end"]:{x:movePreview.point.x+5,y:movePreview.point.y+5}}),error:null};
      }
      const opExit=joiningPipeExit(topology,movePreview.objectId);
      if(opExit)return {document:applyEditorCommand(history.present,{type:"update-joining-pipe-exit",pipeId:opExit.pipe.id,side:opExit.side,position:{x:movePreview.point.x+5,y:movePreview.point.y+5}}),error:null};
      const node = topology?.nodes.find(n => n.id === movePreview.objectId);
      if (node && topology) {
        const original=physicalNodePoint(history.present,node),display=pipeBundleNodePoint(history.present,node.id,original);
        return { document: applyEditorCommand(history.present, {type:"move-physical-node",nodeId:node.id,position:{x:movePreview.point.x+5+original.x-display.x,y:movePreview.point.y+5+original.y-display.y},mode:movePreview.mode??"carry"}), error:null };
      }
      return { document: applyEditorCommand(history.present, {
        type: "move-connector",
        connectorId: movePreview.objectId,
        view,
        position: movePreview.point,
        physicalDragMode:movePreview.mode??"carry",
      }), error: null };
    } catch (error) {
      // An impossible placement still follows the pointer, but no previous
      // wire trace is drawn beneath it. Releasing it leaves the saved scene
      // intact and the normal command reports why it could not be placed.
      return {
        document: {
          ...history.present,
          connectors: history.present.connectors.map((connector) => connector.id === movePreview.objectId
            ? { ...connector, positions: { ...connector.positions, [view]: movePreview.point } }
            : connector),
          wires: history.present.wires.filter((wire) => ![wire.from, wire.to].some((endpoint) =>
            !isJunctionEndpoint(endpoint) && !isScreenEndpoint(endpoint) && endpoint.connectorId === movePreview.objectId)),
        },
        error: error instanceof Error ? error.message : "Трассировка невозможна.",
      };
    }
  }, [history, movePreview, view, pipePreview, freeEndPreviews, drawingPerimeters, componentTemplateViewInstances, resolveComponentTemplateAssetUrl, coveringPreview, thicknessPreview, pipeOpacityPreview, leaderScalePreview, indexScalePreview, dimensionScalePreview, minimumOverlapPreview, opCoveringEdgePreview, bendRadiusPreview, coveringRatioPreview, pairPitchPreview]);

  const routingIssues = useMemo(() => view === "e4" && history
    ? e4RoutingIssues(history.present) : [], [history?.present, view]);
  const diagnostics = useMemo(() => view === "e4" && history ? collectE4Diagnostics(history.present) : [], [history?.present, view]);
  const drawingTemplateIds = useMemo(() => new Set(view === "drawing" ? componentTemplateViewInstances
    .filter(i => projectComponentTemplateView(i, "drawing", {x:0,y:0})?.commands.length).map(i => i.objectId) : []),
    [view, componentTemplateViewInstances]);
  const volumeEligible = useMemo(() => {
    return history ? volumeShadingEligible(history.present) : false;
  }, [history?.present]);

  const run = useCallback((command: EditorCommand): boolean => {
    if (placementBusyRef.current || pendingPlacementRef.current) return false;
    const current = historyRef.current;
    if (!current) return false;
    if(!localCopy && command.type==="set-physical-topology"&&!command.coveringLibrary&&command.topology.coverings?.some(c=>coveringMaterialChanged(current.present,c))){
      if(preparingCovering.current){setMessage("Подождите: закрепляем материал оболочки.");return false;}
      preparingCovering.current=true;const generation=loadGeneration.current;setMessage("Закрепляем материал оболочки…");
      void prepareCoverings(current.present,command).then(prepared=>{
        if(loadGeneration.current!==generation)return;
        if(historyRef.current?.present!==current.present)throw new Error("Чертёж изменился во время загрузки материала. Повторите добавление оболочки.");
        const next=executeEditorCommand(current,prepared);historyRef.current=next;setHistory(next);setMessage("");
        const added=prepared.topology.coverings?.find(c=>!current.present.physicalTopology?.coverings?.some(old=>old.id===c.id));
        if(added){setSelectedObjectId(added.id);setSelectedObjectIds([added.id]);}
      }).catch(error=>setMessage(error instanceof Error?error.message:"Не удалось закрепить материал.")).finally(()=>{preparingCovering.current=false});
      return false;
    }
    try {
      let next = executeEditorCommand(current, command);
      // Component/article replacement and E4 edits can change the contact text
      // without creating a new wire. Reconcile the connected conductor on every
      // command while the active wire snapshot is available.
      if (wireLookup.databaseOptions.length && ["update-contact", "add-wire", "apply-template-article",
          "apply-connector-article", "reconnect-wire"].includes(command.type)) next = { ...next,
        present: resolveConnectedWireMaterials(next.present, wireLookup.databaseOptions) };
      historyRef.current = next;
      setHistory(next);
      setMessage("");
      return true;
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : "Не удалось изменить документ жгута.");
      return false;
    }
  }, [prepareCoverings, localCopy, wireLookup.databaseOptions]);

  const initializedExits = useRef(new Set<string>());
  useEffect(() => {
    if (view !== "drawing" || !history || placementBusy || placementPending) return;
    const pending = history.present.connectors.filter(c=>!initializedExits.current.has(c.id));
    if(!pending.length)return;
    if (localCopy) return;
    const topology = ensureConnectorExits(history.present);
    if (topology === history.present.physicalTopology || run({ type: "set-physical-topology", topology }))
      history.present.connectors.forEach(c=>initializedExits.current.add(c.id));
  }, [view, history, placementBusy, placementPending, run]);

  const previewObjectMove = useCallback((objectId: string, point: { readonly x: number; readonly y: number } | null, mode?:import("./physical-editing").PhysicalDragMode) => {
    pendingMovePreviewRef.current = point ? { objectId, point, mode } : null;
    if (!point) {
      if (previewFrameRef.current !== null) cancelAnimationFrame(previewFrameRef.current);
      previewFrameRef.current = null;
      setMovePreview(null);
      return;
    }
    if (previewFrameRef.current !== null) return;
    previewFrameRef.current = requestAnimationFrame(() => {
      previewFrameRef.current = null;
      setMovePreview(pendingMovePreviewRef.current);
    });
  }, []);

  useEffect(() => {
    if (!history) return;
    const upgrade = (document: HarnessDesignDocument) => {
      let changed = document;
      for (const connector of document.connectors) {
        if (!connector.e4TableMode && componentSnapshotsByPlacement.get(connector.id)?.content.schemaVersion === 5) {
          changed = applyEditorCommand(changed, { type: "use-e4-table", connectorId: connector.id });
        }
      }
      return changed;
    };
    try {
      const present = upgrade(history.present);
      if (present === history.present) return;
      // A geometry migration is not an operator edit. Upgrade the undo states
      // as well, otherwise Ctrl+Z would immediately reapply the same migration.
      const changed = { present, past: history.past.map(upgrade), future: history.future.map(upgrade) };
      historyRef.current = changed;
      setHistory(changed);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось восстановить табличные точки Э4.");
    }
  }, [history, componentSnapshotsByPlacement]);

  useEffect(() => () => {
    if (previewFrameRef.current !== null) cancelAnimationFrame(previewFrameRef.current);
  }, []);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      const current = historyRef.current;
      if (!current || JSON.stringify(current.present) === savedJsonRef.current) return;
      event.preventDefault();
      event.returnValue = true;
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, []);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (terminationPicker || terminationDraft) {
        if (event.key === "Escape") { event.preventDefault(); setTerminationPicker(null); setTerminationDraft(null); }
        return;
      }
      if(joiningPipeDraft){if(event.key==='Escape'){event.preventDefault();setJoiningPipeDraft(null);}return;}
      if (placementBusyRef.current || pendingPlacementRef.current) return;
      if (event.key === "Escape" && editingObjectId) {
        event.preventDefault();
        setEditingObjectId(null);
        return;
      }
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      if (event.key === "Escape") { setRelatedSourceIds([]); setSelectedObjectId(null); setSelectedObjectIds([]); return; }
      if ((event.key === "Delete" || event.key === "Backspace") && selectedObjectIds.length > 0) {
        const current = historyRef.current?.present;
        if (!current) return;
        const commands = selectedEditorDeletionCommands(current, selectedObjectIds);
        if (commands.length > 0) event.preventDefault();
        for (const command of commands) run(command);
        if (commands.length > 0) {
          setSelectedObjectId(null);
          setSelectedObjectIds([]);
        }
        return;
      }
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key.toLocaleLowerCase();
      const current=historyRef.current?.present;
      if(key==="c"&&current){const selected=new Set(selectedObjectIds);graphicsClipboardRef.current=(current.drawingDocuments?.graphics??[]).filter(g=>selected.has(g.id));if(graphicsClipboardRef.current.length){event.preventDefault();return;}}
      if(key==="v"&&current&&graphicsClipboardRef.current.length){event.preventDefault();const docs=current.drawingDocuments??{tables:[],leaders:[],bomOrder:[]};const copies=graphicsClipboardRef.current.map(g=>({...g,id:crypto.randomUUID(),view,points:g.points.map(p=>({x:p.x+20,y:p.y+20}))}));run({type:"set-drawing-documents",documents:{...docs,graphics:[...(docs.graphics??[]),...copies]}});setSelectedObjectIds(copies.map(g=>g.id));setSelectedObjectId(copies.at(-1)?.id??null);return;}
      if((event.key==="["||event.key==="]")&&current){const selected=new Set(selectedObjectIds),delta=event.key==="]"?15:-15,graphics=current.drawingDocuments?.graphics??[],changed=graphics.filter(g=>selected.has(g.id));if(changed.length){event.preventDefault();const docs=current.drawingDocuments!;run({type:"set-drawing-documents",documents:{...docs,graphics:graphics.map(g=>{if(!selected.has(g.id))return g;if(g.kind==="text")return {...g,angle:((g.angle??0)+delta+360)%360};const cx=g.points.reduce((s,p)=>s+p.x,0)/g.points.length,cy=g.points.reduce((s,p)=>s+p.y,0)/g.points.length,a=delta*Math.PI/180,c=Math.cos(a),sn=Math.sin(a);return {...g,points:g.points.map(p=>({x:cx+(p.x-cx)*c-(p.y-cy)*sn,y:cy+(p.x-cx)*sn+(p.y-cy)*c}))};})}});return;}}
      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        setHistory((current) => current ? undoEditorCommand(current) : current);
      } else if (key === "y" || (key === "z" && event.shiftKey)) {
        event.preventDefault();
        setHistory((current) => current ? redoEditorCommand(current) : current);
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [editingObjectId, run, selectedObjectIds,joiningPipeDraft,terminationDraft,terminationPicker]);

  useEffect(() => {
    if (!localCopy?.captureSelection || !localCopy.revealedObjectIds || !history) return;
    const revealed = new Set(localCopy.revealedObjectIds);
    const ids = designToScene(history.present, "drawing").filter(object => !revealed.has(object.id)).map(object => object.id);
    setHiddenObjectIds(current => current.length === ids.length && current.every((id,index) => id === ids[index]) ? current : ids);
  }, [localCopy?.captureSelection, localCopy?.revealedObjectIds, history?.present]);

  if (!history || !resource) {
    return { ready: false as const, earlyContent: (<div className={`he-loading ${saveState === "error" ? "error" : ""}`} role="status">{message}</div>) };
  }

  const terminationPreview = terminationDraft ? terminationSceneObject(history.present, terminationDraft.connector, view) : null;
  const beginTerminationPlacement = (record: TerminationLibraryRecord) => {
    const prefix = record.kind === 'preparation' ? 'Р' : 'T';
    const names = new Set(history.present.connectors.map(c => c.designation));
    let number = 1;
    while (names.has(`${prefix}${number}`)) number++;
    setTerminationDraft(createTerminationPlacement(record, {id: crypto.randomUUID(), designation: `${prefix}${number}`, position: {x: 0, y: 0}}));
    setJoiningPipeDraft(null); setEditingObjectId(null);
    setSelectedObjectId(null); setSelectedObjectIds([]); setMessage('');
  };

  const diagnosticObjectIds = new Set(diagnostics.map((diagnostic) => diagnostic.target.objectId));
  const materializedConnectorIds = new Set(componentTemplateViewInstances.map((instance) => instance.objectId));
  const hasComponentGraphIntegrityMismatch = history.present.connectors.some((connector) =>
    connector.libraryBinding?.mode === "template" && componentSnapshotsByPlacement.has(connector.id) &&
    !materializedConnectorIds.has(connector.id));
  const componentGraphIntegrityMessage = componentGraphMessage || (hasComponentGraphIntegrityMismatch
    ? "Закреплённые контактные данные компонента не совпадают со снимком проекта. Используется резервное отображение."
    : "");
  const sourceDocument=previewResult.document??history.present;
  const drawingDocument=view!=="drawing"?sourceDocument:{...sourceDocument,connectors:sourceDocument.connectors.map(connector=>{
    const instance=componentTemplateViewInstances.find(i=>i.objectId===connector.id),binding=connector.libraryBinding;
    if(!instance||binding?.mode!=="template")return connector;
    const rows=materializePlacementRows(instance.content,instance.articleVariantId);
    return {...connector,libraryBinding:{...binding,snapshot:{...binding.snapshot,contacts:binding.snapshot.contacts.map(contact=>({...contact,representations:rows.find(r=>r.key===contact.logicalContactId)?.representations??[]}))}}};
  })};
  const scene = alignDrawingConnectorIndexes(drawingDocument, designToScene(
    drawingDocument,
    view,
    diagnosticObjectIds,
    materializedConnectorIds,
    harnessQuantity,
    drawingTemplateIds,
    drawingPerimeters,
  ),componentTemplateViewInstances,resolveComponentTemplateAssetUrl);
  const layers = toUiLayers(history.present, view);
  const selectedConnector = selectedObjectId
    ? history.present.connectors.find((connector) => connector.id === selectedObjectId && (view === "e4" || connector.terminationComponent)) ?? null
    : null;
  const selectedConnectorLayer = selectedConnector
    ? layers.find((layer) => layer.id === selectedConnector.layerIds[view])
    : null;
  const selectedSeriesId = selectedConnector?.libraryBinding?.mode === "series"
    ? selectedConnector.libraryBinding.seriesId
    : null;
  const selectedConnectorSeries = selectedSeriesId
    ? builtInConnectorSeries.find((series) => series.id === selectedSeriesId)
    : undefined;
  const selectedTemplateSnapshot = selectedConnector?.libraryBinding?.mode === "template"
    ? componentSnapshotsByPlacement.get(selectedConnector.id) ?? null
    : null;
  const selectedTemplateArticleOptions = selectedTemplateSnapshot &&
      (isTemplateContentV3(selectedTemplateSnapshot.content) || isTemplateContentV4(selectedTemplateSnapshot.content) || isTemplateContentV5(selectedTemplateSnapshot.content))
    ? selectedTemplateSnapshot.content.articleVariants.map((article) => ({
        articleVariantId: article.id,
        articleKey: article.articleKey,
      }))
    : [];
  const selectTemplateArticle = selectedConnector && selectedTemplateSnapshot &&
      (isTemplateContentV3(selectedTemplateSnapshot.content) || isTemplateContentV4(selectedTemplateSnapshot.content) || isTemplateContentV5(selectedTemplateSnapshot.content))
    ? (articleVariantId: string) => {
        try {
          if (selectedConnector.libraryBinding?.mode === "template" &&
              selectedConnector.libraryBinding.articleVariantId === articleVariantId) return;
          const content = selectedTemplateSnapshot.content;
          if (!isTemplateContentV3(content) && !isTemplateContentV4(content) && !isTemplateContentV5(content)) return;
          const connector = rematerializeComponentTemplateConnectorArticle(selectedConnector, {
            templateId: selectedTemplateSnapshot.sourceTemplateId,
            version: selectedTemplateSnapshot.sourceVersion,
            versionSha256: selectedTemplateSnapshot.sourceVersionSha256,
            code: selectedTemplateSnapshot.code,
            name: selectedTemplateSnapshot.name,
            articleBindings: selectedTemplateSnapshot.articleBindings,
            assets: selectedTemplateSnapshot.assets,
            content,
          }, articleVariantId);
          run({ type: "apply-template-article", connectorId: selectedConnector.id, connector });
        } catch (error) {
          setMessage(error instanceof Error ? error.message : "Не удалось выбрать артикул семейства.");
        }
      }
    : undefined;
  const refreshTemplateTerminals = selectedConnector && selectedTemplateSnapshot
      ? async () => {
        if (refreshingTerminals) return;
        const generation = loadGeneration.current;
        const connectorId = selectedConnector.id;
        setRefreshingTerminals(true);
        try {
          const latest = await componentTemplateApi.get(selectedTemplateSnapshot.sourceTemplateId);
          if (generation !== loadGeneration.current) return;
          const current = historyRef.current?.present.connectors.find(item => item.id === connectorId);
          if (!current) return;
          const catalog = refreshedTemplateTerminalCatalog(current, latest);
          run({ type: "refresh-template-terminals", connectorId, catalog });
        } catch (error) {
          if (generation === loadGeneration.current) setMessage(error instanceof Error ? error.message : "Не удалось обновить совместимые терминалы.");
        } finally {
          setRefreshingTerminals(false);
        }
      }
    : undefined;
  const customWireColorHexes = [...new Set([
    ...(history.present.customWireColors ?? []),
    ...history.present.connectors.flatMap((connector) => connector.contacts
      .flatMap((contact) => [contact.color, contact.secondaryColor ?? ""])),
  ].flatMap((value) => {
    const normalized = value.trim().toUpperCase();
    return /^#[0-9A-F]{6}$/.test(normalized) ? [normalized] : [];
  }))];
  const editorWireColors = [
    ...builtInWireColors,
    ...customWireColorHexes.map((hex) => createCustomWireColor(hex)),
  ];
  const placeCatalogItem = async (item: EditorCatalogItem, point?: { readonly x: number; readonly y: number }) => {
    const spec=history.present.drawingDocuments?.specificationItems?.find(i=>i.id===selectedObjectId);
    if(view==="drawing"&&spec&&item.sourceId&&item.snapshotId&&item.snapshotSha256&&item.recordId&&item.sourceKey){
      const documents=history.present.drawingDocuments!;
      run({type:"set-drawing-documents",documents:{...documents,specificationItems:documents.specificationItems!.map(i=>i.id===spec.id?{...i,kind:"manual",designation:item.sourceKey!,name:item.referenceDisplayName||item.title,sourceIdentity:JSON.stringify([item.sourceId,item.snapshotId,item.snapshotSha256,item.recordId,item.entityType,item.sourceKey])}:i)}});return;
    }
    if (item.entityType === "protective-covering") {
      const t = history.present.physicalTopology;
      if (view !== "drawing" || !t) { setMessage("Сначала создайте и выберите физические участки на Чертеже."); return; }
      try {
        const material = coveringMaterial(item);
        const existing = t.coverings?.find(c => selectedObjectIds.includes(c.id));
        const spans = t.segments.filter(s => selectedObjectIds.includes(s.id)).map(s => ({segmentId:s.id,from:0,to:1}));
        if (!existing && !spans.length) throw new Error("Выберите участки или оболочку для назначения защиты.");
        run({type:"set-physical-topology",topology:{...t,coverings:existing ? t.coverings?.map(c=>c.id===existing.id?{...c,material,name:material.displayName}:c) : [...t.coverings ?? [],{id:crypto.randomUUID(),name:material.displayName,material,spans,width:0,color:"#687e8a",lengthMm:null}]}});
      } catch(error) { setMessage(error instanceof Error ? error.message : "Не удалось назначить защиту."); }
      return;
    }
    if (item.placement === "reference-only" && item.entityType === "coax-termination") {
      if (view !== "drawing") {
        setMessage("Профиль разделки назначается проводу только в режиме «Чертёж».");
        return;
      }
      const selectedWireId = selectedObjectIds.length === 1 &&
        history.present.wires.some((wire) => wire.id === selectedObjectIds[0])
        ? selectedObjectIds[0]!
        : null;
      const selectedWire = selectedWireId
        ? history.present.wires.find((wire) => wire.id === selectedWireId)
        : undefined;
      const locked = selectedWire
        ? history.present.views.drawing.layers.some((layer) => layer.id === selectedWire.layerIds.drawing && layer.locked)
        : false;
      const result = wireStripProfileUpdateFromCatalogItem(item, selectedWireId, activeWireStripEnd, locked);
      if (!result.ok) setMessage(result.error);
      else run(result.command);
      return;
    }
    if (item.placement === "reference-only" && (item.entityType === "wire" || item.entityType === "cable")) {
      if (item.entityType === "cable" && selectedCable) {
        const result = cableMaterialUpdateFromCatalogItem(item, selectedCable.id);
        if (!result.ok) setMessage(result.error);
        else run(result.command);
        return;
      }
      const selectedWireId = selectedObjectIds.length === 1 &&
        history.present.wires.some((wire) => wire.id === selectedObjectIds[0])
        ? selectedObjectIds[0]!
        : null;
      const result = wireMaterialUpdateFromCatalogItem(item, selectedWireId);
      if (!result.ok) setMessage(result.error);
      else {
        const option=wireLookup.databaseOptions.find(candidate=>candidate.id===item.recordId);
        const selected=history.present.wires.find(wire=>wire.id===selectedWireId);
        const endpoint=selected&&[selected.from,selected.to].find(end=>"connectorId" in end);
        if(option?.materialBinding&&endpoint&&"connectorId" in endpoint)run({
          type:"update-contact",connectorId:endpoint.connectorId,contactId:endpoint.contactId,
          wire:option.mark,wireSection:option.section,wireDiameterMm:option.diameterMm??null,
          materialBinding:option.materialBinding,...(option.color?{color:option.color}:{}),
        });
        else run(result.command);
      }
      return;
    }
    if (item.placement !== "connector") return;
    const generation = loadGeneration.current;
    const id = crypto.randomUUID();
    const index = history.present.connectors.length;
    let preview: ReturnType<typeof createBuiltInConnectorInstance>;
    let isPersistentTemplate = false;
    if (item.componentTemplateId && item.componentTemplateVersion) {
      try {
        const template = localCopy
          ? await loadComponentTemplateForLocalCopy(componentTemplateApi, item.componentTemplateId, item.componentTemplateVersion)
          : await loadComponentTemplateForPlacement(
            componentTemplateApi, item.componentTemplateId, item.componentTemplateVersion);
        if (generation !== loadGeneration.current) return;
        if (!isTemplateContentV3(template.content) && !isTemplateContentV4(template.content) && !isTemplateContentV5(template.content)) {
          throw new Error("Для размещения в жгуте требуется шаблон v3 или v4.");
        }
        // A catalog card represents the whole series. Its cached article
        // metadata may predate the loaded immutable version, whose first real
        // variant is the deterministic initial selection.
        const variantId = firstPlaceableArticleVariantId(template.content);
        const variant = template.content.articleVariants.find(candidate => candidate.id === variantId);
        if (!variant) throw new Error("В библиотечном шаблоне нет варианта артикула для размещения.");
        preview = createConnectorInstanceFromComponentTemplateV3({
          templateId: template.templateId,
          version: template.version,
          versionSha256: template.versionSha256,
          code: template.code,
          name: template.name,
          articleBindings: template.articleBindings,
          assets: template.assets,
          content: template.content,
        }, {
          id,
          designation: `XS${index + 1}`,
          articleVariantId: variant.id,
          e4Position: { x: 0, y: 0 },
        });
        isPersistentTemplate = true;
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Не удалось разместить библиотечный компонент.");
        return;
      }
    } else {
      preview = createBuiltInConnectorInstance(item.id, {
        id,
        designation: `XS${index + 1}`,
        e4Position: { x: 0, y: 0 },
        partNumber: item.defaultPartNumber,
      });
    }
    const nextE4Y = history.present.connectors.reduce((bottom, connector) => Math.max(
      bottom,
      connector.positions.e4.y + connectorE4TableGeometry(connector).height + 90,
    ), 100);
    const placement = point ?? { x: 120, y: nextE4Y };
    const command: EditorCommand = {
      type: "add-connector",
      connector: { ...preview, positions: { e4: placement, drawing: placement } },
    };
    if (isPersistentTemplate && !localCopy) {
      const currentHistory = historyRef.current;
      const currentResource = resourceRef.current;
      if (!currentHistory || !currentResource) return;
      if (!(await flushSave())) return;
      if (generation !== loadGeneration.current) return;
      const latestHistory = historyRef.current;
      const latestResource = resourceRef.current;
      if (!latestHistory || !latestResource) return;
      let nextHistory: EditorHistory;
      try {
        nextHistory = executeEditorCommand(latestHistory, command);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Не удалось разместить компонент.");
        return;
      }
      const pending: PendingComponentPlacement = pendingPlacementRef.current ?? {
        body: componentPlacementRequest(command.connector, latestResource.revision, crypto.randomUUID()),
        nextHistory,
        connectorId: preview.id,
        loadGeneration: generation,
      };
      pendingPlacementRef.current = pending;
      setPlacementPending(true);
      try {
        const result = await componentPlacementApi.place(projectId, harnessId, pending.body);
        const authoritative = await api.get(projectId, harnessId);
        if (pending.loadGeneration !== loadGeneration.current || pendingPlacementRef.current !== pending) return;
        nextHistory = pending.nextHistory;
        if (authoritative.revision !== result.resultingRevision ||
            !authoritative.content.connectors.some((connector) => connector.id === pending.connectorId)) {
          throw new Error("Сервер не подтвердил компонент в документе жгута.");
        }
        historyRef.current = nextHistory;
        setHistory(nextHistory);
        const saved = { ...authoritative, content: nextHistory.present };
        resourceRef.current = saved;
        setResource(saved);
        savedJsonRef.current = JSON.stringify(nextHistory.present);
        setSaveState("saved");
        pendingPlacementRef.current = null;
        setPlacementPending(false);
        void refreshComponentGraph(pending.loadGeneration);
      } catch (error) {
        // The exact command is kept for the next activation. If the response was
        // lost after the server committed it, the idempotent command journal
        // returns the already accepted result instead of creating a duplicate.
        if (pending.loadGeneration === loadGeneration.current && pendingPlacementRef.current === pending) {
          setMessage(error instanceof Error ? error.message : "Не удалось закрепить компонент в проекте.");
        }
        return;
      }
    } else {
      run(command);
    }
    setSelectedObjectId(id);
    setSelectedObjectIds([id]);
  };

  const retryPendingPlacement = async () => {
    if (placementBusyRef.current) return;
    const pending = pendingPlacementRef.current;
    if (!pending || pending.loadGeneration !== loadGeneration.current) return;
    const operation = Symbol("component-placement-retry");
    placementOperationRef.current = operation;
    placementBusyRef.current = true;
    setPlacementBusy(true);
    try {
      const result = await componentPlacementApi.place(projectId, harnessId, pending.body);
      const authoritative = await api.get(projectId, harnessId);
      if (pending.loadGeneration !== loadGeneration.current || pendingPlacementRef.current !== pending) return;
      if (authoritative.revision !== result.resultingRevision ||
          !authoritative.content.connectors.some((connector) => connector.id === pending.connectorId)) {
        throw new Error("Сервер не подтвердил компонент в документе жгута.");
      }
      historyRef.current = pending.nextHistory;
      setHistory(pending.nextHistory);
      const saved = { ...authoritative, content: pending.nextHistory.present };
      resourceRef.current = saved;
      setResource(saved);
      savedJsonRef.current = JSON.stringify(pending.nextHistory.present);
      pendingPlacementRef.current = null;
      setPlacementPending(false);
      void refreshComponentGraph(pending.loadGeneration);
      setSaveState("saved");
      setMessage("");
      setSelectedObjectId(pending.connectorId);
      setSelectedObjectIds([pending.connectorId]);
    } catch (error) {
      if (pending.loadGeneration === loadGeneration.current && pendingPlacementRef.current === pending) {
        setMessage(error instanceof Error ? error.message : "Не удалось закрепить компонент в проекте.");
      }
    } finally {
      if (placementOperationRef.current === operation) {
        placementOperationRef.current = null;
        placementBusyRef.current = false;
        setPlacementBusy(false);
      }
    }
  };

  const addCatalogItem = async (item: EditorCatalogItem, point?: { readonly x: number; readonly y: number }) => {
    if (placementBusyRef.current) return;
    if (pendingPlacementRef.current) {
      await retryPendingPlacement();
      return;
    }
    const persistent = Boolean(item.componentTemplateId && item.componentTemplateVersion);
    if (!persistent) {
      await placeCatalogItem(item, point);
      return;
    }
    if (placementBusyRef.current) return;
    const operation = Symbol("component-placement");
    placementOperationRef.current = operation;
    placementBusyRef.current = true;
    setPlacementBusy(true);
    try {
      await placeCatalogItem(item, point);
    } finally {
      if (placementOperationRef.current === operation) {
        placementOperationRef.current = null;
        placementBusyRef.current = false;
        setPlacementBusy(false);
      }
    }
  };

  const addRoutePoint = (point: { readonly x: number; readonly y: number }, ctrlKey = false) => {
    if (view !== "drawing" || !selectedObjectId) return;
    const topology = history.present.physicalTopology;
    const segment = topology?.segments.find(s => s.id === selectedObjectId);
    if (topology && segment) return;
    const wire = history.present.wires.find((item) => item.id === selectedObjectId);
    if (!wire || topology?.routes.some(r => r.wireId === wire.id)) return;
    if(wire.drawingEndpoints){
      const index=detachedWireBendInsertionIndex(wire,point);
      const anchor=index===0?wire.drawingEndpoints.from:wire.drawingRoute[index-1]!;
      const next=snapRoutePoint(anchor,point,ctrlKey,Math.PI/12);
      run({type:"edit-detached-wire-bend",wireId:wire.id,index,position:next,insert:true});
      return;
    }
    const renderedWire = scene.find((item) => item.id === wire.id);
    const start = wire.drawingRoute.at(-1) ?? renderedWire?.points?.[0] ??
      findWireEndpoint(history.present, wire.from, "drawing");
    if (!start) return;
    const next = snapRoutePoint(start, point, ctrlKey, Math.PI / 6);
    run({ type: "set-wire-route", wireId: wire.id, route: [...wire.drawingRoute, next] });
  };

  const createRoutedWire = (id: string, from: WireEndpoint, to: WireEndpoint) => {
    const contactValues = [from, to].flatMap((endpoint) => {
      if (isJunctionEndpoint(endpoint) || isScreenEndpoint(endpoint)) return [];
      const connector = history.present.connectors.find((item) => item.id === endpoint.connectorId);
      const contact = connector?.contacts.find((item) => item.id === endpoint.contactId);
      return contact ? [contact] : [];
    });
    const circuit = contactValues.find((contact) => contact.circuit.trim())?.circuit ?? "";
    const colorName = contactValues.find((contact) => contact.color.trim())?.color ?? "";
    const colorContact = contactValues.find((contact) => contact.color.trim());
    const colorSource = colorContact
      ? [from, to].find((endpoint) => !isJunctionEndpoint(endpoint) && !isScreenEndpoint(endpoint) &&
        endpoint.contactId === colorContact.id)
      : !isJunctionEndpoint(from) && !isScreenEndpoint(from) ? from : undefined;
    // A newly connected end starts with the terminal's L+ allowance.  The
    // inspector keeps the resulting value editable and can replace it with L-.
    const terminalCorrections = wireEndTerminalCorrections(history.present, { from, to }, terminalLookup.records);
    const wire = createWire(
      id, from, to, null, circuit, resolveWireColorHex(colorName),
      terminalCorrections.from?.plusMm ?? 0, terminalCorrections.to?.plusMm ?? 0, 1,
      colorSource ? { connectorId: colorSource.connectorId, contactId: colorSource.contactId } : undefined,
    );
    // add-wire owns obstacle-aware routing. A provisional Manhattan path can
    // cross the source body and would be rejected as an explicit manual route.
    return wire;
  };

  const selectedWireIds = selectedObjectIds.filter((id) => history.present.wires.some((wire) => wire.id === id));
  const selectedCable = history.present.cables.find((cable) =>
    cable.memberWireIds.length === selectedWireIds.length &&
    cable.memberWireIds.every((wireId) => selectedWireIds.includes(wireId))) ?? null;
  const selectedWireForCorrections = selectedObjectId
    ? history.present.wires.find(wire => wire.id === selectedObjectId)
    : undefined;
  const selectedTerminalCorrections = selectedWireForCorrections
    ? wireEndTerminalCorrections(history.present, selectedWireForCorrections, terminalLookup.records)
    : undefined;
  const selectedWiresLocked = selectedWireIds.some((wireId) => {
    const wire = history.present.wires.find((item) => item.id === wireId);
    return wire ? history.present.views.drawing.layers.some((layer) => layer.id === wire.layerIds.drawing && layer.locked) : false;
  });
  const selectedDiffPair = history.present.diffPairs.find((group) =>
    group.wireIds.length === selectedWireIds.length && group.wireIds.every((id) => selectedWireIds.includes(id))) ?? null;
  const selectedScreen = history.present.screens.find((group) =>
    group.wireIds.length === selectedWireIds.length && group.wireIds.every((id) => selectedWireIds.includes(id))) ?? null;

  const changeDiffPair = (state: E4DifferentialPairState | null) => {
    if (selectedWireIds.length !== 2) return;
    if (state === null) {
      if (selectedDiffPair) run({ type: "remove-diff-pair", groupId: selectedDiffPair.id });
      return;
    }
    if (selectedDiffPair) {
      run({
        type: "update-diff-pair",
        groupId: selectedDiffPair.id,
        variant: state.variant,
        step: state.twistPitchMm,
      });
      return;
    }
    run({
      type: "create-diff-pair",
      group: {
        id: crypto.randomUUID(),
        wireIds: [selectedWireIds[0]!, selectedWireIds[1]!],
        variant: state.variant,
        step: state.twistPitchMm,
        amplitude: 7,
      },
    });
  };

  const changeScreen = (state: E4ScreenState | null) => {
    if (selectedWireIds.length < 1) return;
    if (state === null) {
      if (selectedScreen) run({ type: "remove-screen", screenId: selectedScreen.id });
      return;
    }
    const position = state.positionPercent / 100;
    if (selectedScreen) {
      run({ type: "update-screen", screenId: selectedScreen.id, position, terminalSide: state.terminalSide });
    } else {
      run({
        type: "create-screen",
        screen: { id: crypto.randomUUID(), wireIds: selectedWireIds, position, label: "Экран", width: 46, terminalSide: state.terminalSide },
      });
    }
  };

  const positionsVisible = !!history?.present.drawingDocuments?.leaders.some(leader => !leader.hidden);
  const isolateLocalObjects = (objectIds: readonly string[]) => {
    if (!localCopy?.onIsolateObjects) return;
    const current = historyRef.current?.present;
    if (!current) return;
    const detached = localCopy.onIsolateObjects(current, objectIds, scene);
    if (!detached) return;
    const next = createEditorHistory(detached);
    historyRef.current = next;
    setHistory(next);
    setHiddenObjectIds([]);
    setBackgroundOpacity(0);
    setSelectedObjectId(null);
    setSelectedObjectIds([]);
    setMessage("Создан изолированный фрагмент. Его геометрия не связана с исходным маршрутом.");
  };

  return { ready: true as const, activeWireStripEnd, addCatalogItem, addRoutePoint, backgroundOpacity, beginTerminationPlacement, bendRadiusPreview, catalog, changeDiffPair, changeScreen, componentGraphIntegrityMessage, componentTemplateViewInstances, connectionTableSettings, coveringRatioPreview, createRoutedWire, diagnostics, dimensionScalePreview, drawingDocument, drawingPerimeters, drawingSnaps, e4Detached, editingObjectId, editorWireColors, flushSave, graphicAngleStep, graphicsClipboardRef, harnessDesignation, harnessId, harnessQuantity, hiddenObjectIds, history, historyRef, indexScalePreview, isolateLocalObjects, joiningPipeDraft, layers, leaderScalePreview, loadGeneration, localCopy, materializedConnectorIds, message, minimumOverlapPreview, onClose, onRouteRequest, onSectionChange, onViewChange, opCoveringEdgePreview, pairPitchPreview, pipeOpacityPreview, placementBusy, placementPending, positionsVisible, previewObjectMove, previewResult, projectId, recoveryApi, recoveryArchives, recoveryBusy, recoveryDrafts, recoveryError, recoverySession, refreshComponentGraph, refreshTemplateTerminals, refreshingTerminals, related, relatedSourceIds, resolveComponentTemplateAssetUrl, resource, resourceRef, retryPendingPlacement, revealRequest, routingIssues, run, saveState, savedJsonRef, scene, selectTemplateArticle, selectedCable, selectedConnector, selectedConnectorLayer, selectedConnectorSeries, selectedObjectId, selectedObjectIds, selectedPipeInterval, selectedTemplateArticleOptions, selectedTerminalCorrections, selectedWireIds, selectedWiresLocked, selectionIndex, setActiveWireStripEnd, setBackgroundOpacity, setBendRadiusPreview, setCoveringPreview, setCoveringRatioPreview, setDimensionScalePreview, setDrawingSnaps, setE4Detached, setEditingObjectId, setFreeEndPreviews, setGraphicAngleStep, setHiddenObjectIds, setHistory, setIndexScalePreview, setJoiningPipeDraft, setLeaderScalePreview, setMessage, setMinimumOverlapPreview, setMovePreview, setOpCoveringEdgePreview, setPairPitchPreview, setPipeOpacityPreview, setPipePreview, setRecoveryDrafts, setRecoveryError, setRelatedSourceIds, setRevealRequest, setSaveState, setSelectedObjectId, setSelectedObjectIds, setSelectedPipeInterval, setTerminationDraft, setTerminationPicker, setTerminationPickerError, setThicknessPreview, setUiFailureNonce, setView, setWholeNet, terminalLookup, terminationDraft, terminationPicker, terminationPickerError, terminationPreview, textureAssets, thicknessPreview, uiFailureNonce, view, volumeEligible, wholeNet, wireLookup };
}
