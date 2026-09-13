import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LocalSession } from "../local-session";
import type { RuntimeConfig } from "../runtime-config";
import { applyEditorCommand, createWire, normalizeE4RoutingDocument, type EditorCommand } from "./commands";
import { createHarnessDesignApi, type HarnessDesignApi, type HarnessDesignResource } from "./design-api";
import { useEditorReferenceCatalog, useTerminalArticleLookup } from "./editor-reference-catalog";
import type { EditorCatalogItem, EditorLayer as UiLayer, EditorSceneObject, HarnessEditorView } from "./editor-types";
import { HarnessEditorWorkspace, type EditorSaveState } from "./HarnessEditorWorkspace";
import { E4ConnectorInspector } from "./E4ConnectorInspector";
import { collectE4Diagnostics } from "./e4-diagnostics";
import {
  builtInConnectorSeries,
  createBuiltInConnectorInstance,
} from "./connector-series-demo";
import type { E4DifferentialPairState, E4ScreenState } from "./e4-wire-selection-state";
import { createEditorHistory, executeEditorCommand, redoEditorCommand, undoEditorCommand, type EditorHistory } from "./history";
import {
  connectorContactPosition,
  connectorE4TableGeometry,
  createJunctionEndpoint,
  createOrthogonalE4Route,
  createEmptyHarnessDesign,
  findWireEndpoint,
  isJunctionEndpoint,
  wireEndpointE4Anchor,
  type EditorLayer,
  type HarnessDesignDocument,
  type WireEndpoint,
} from "./model";

export interface HarnessDesignEditorProps {
  readonly config: RuntimeConfig;
  readonly session: LocalSession;
  readonly projectId: string;
  readonly harnessId: string;
  readonly harnessDesignation: string;
  readonly initialView: HarnessEditorView;
  readonly apiOverride?: HarnessDesignApi;
  readonly onClose?: () => void;
  readonly onViewChange?: (view: HarnessEditorView) => void;
}

export function normalizeEditorSelection(
  selectedIds: readonly string[],
  selectedPrimaryId: string | null,
  availableObjectIds: ReadonlySet<string>,
): { readonly objectIds: readonly string[]; readonly primaryObjectId: string | null } {
  const objectIds = [...new Set(selectedIds)].filter((id) => availableObjectIds.has(id));
  const primaryObjectId = selectedPrimaryId && availableObjectIds.has(selectedPrimaryId)
    ? selectedPrimaryId
    : objectIds.at(-1) ?? null;
  if (primaryObjectId && !objectIds.includes(primaryObjectId)) objectIds.push(primaryObjectId);
  return { objectIds, primaryObjectId };
}

export function selectedEditorDeletionCommands(
  document: HarnessDesignDocument,
  selectedObjectIds: readonly string[],
): readonly EditorCommand[] {
  const selectedIds = new Set(selectedObjectIds);
  return [
    ...document.wires
      .filter((wire) => selectedIds.has(wire.id))
      .map((wire): EditorCommand => ({ type: "remove-wire", wireId: wire.id })),
    ...document.connectors
      .filter((connector) => selectedIds.has(connector.id))
      .map((connector): EditorCommand => ({ type: "remove-connector", connectorId: connector.id })),
  ];
}

function toUiLayers(document: HarnessDesignDocument, view: HarnessEditorView): readonly UiLayer[] {
  return [...document.views[view].layers]
    .sort((left, right) => right.order - left.order)
    .map((layer) => ({ id: layer.id, label: layer.name, visible: layer.visible, locked: layer.locked }));
}

function contactPointForWire(
  document: HarnessDesignDocument,
  endpoint: WireEndpoint,
  otherEndpoint: WireEndpoint,
  view: HarnessEditorView,
) {
  if (isJunctionEndpoint(endpoint)) return findWireEndpoint(document, endpoint, view);
  const connectorId = endpoint.connectorId;
  const contactId = endpoint.contactId;
  const otherConnectorId = isJunctionEndpoint(otherEndpoint) ? "" : otherEndpoint.connectorId;
  const connector = document.connectors.find((item) => item.id === connectorId);
  const other = document.connectors.find((item) => item.id === otherConnectorId);
  if (!connector) return null;
  const point = connectorContactPosition(connector, contactId, view);
  if (!point) return null;
  if (view === "e4") return point;
  const height = Math.max(72, 44 + connector.contacts.length * 16);
  const useLeft = other ? other.positions[view].x < connector.positions[view].x : false;
  return {
    x: useLeft ? connector.positions[view].x : connector.positions[view].x + 118,
    y: Math.min(point.y, connector.positions[view].y + height - 12),
  };
}

export function designToScene(
  document: HarnessDesignDocument,
  view: HarnessEditorView,
  diagnosticObjectIds: ReadonlySet<string> = new Set(),
): readonly EditorSceneObject[] {
  const connectors: EditorSceneObject[] = document.connectors.map((connector) => {
    const geometry = view === "e4" ? connectorE4TableGeometry(connector) : null;
    const metadata: Record<string, string> = { contactCount: String(connector.contacts.length) };
    if (view === "e4" && geometry) {
      const columnIds = geometry.columns.map((column) => column.kind === "base"
        ? column.key
        : `custom:${column.id}`);
      const customLabels = Object.fromEntries(geometry.columns.flatMap((column) =>
        column.kind === "custom" ? [[`custom:${column.id}`, column.label]] : []));
      Object.assign(metadata, {
        view: "e4",
        orientation: connector.schematic.orientation === "contacts-left" ? "left" : "right",
        designation: connector.designation,
        partNumber: connector.partNumber,
        columns: JSON.stringify(columnIds),
        columnLabels: JSON.stringify(customLabels),
        rows: JSON.stringify(connector.contacts.map((contact) => ({
            number: contact.number,
            contactType: contact.contactType,
            circuit: contact.circuit,
            terminal: contact.terminalArticle,
            wire: contact.wire,
            color: contact.color,
            status: contact.connectionStatus,
            customValues: contact.customValues,
          }))),
        ...(diagnosticObjectIds.has(connector.id) ? { diagnostic: "error" } : {}),
      });
    }
    return {
      id: connector.id,
      layerId: connector.layerIds[view],
      kind: "connector" as const,
      label: connector.designation,
      x: connector.positions[view].x,
      y: connector.positions[view].y,
      width: geometry?.width ?? 118,
      height: geometry?.height ?? Math.max(72, 44 + connector.contacts.length * 16),
      color: "#416579",
      metadata,
    };
  });
  const wires: EditorSceneObject[] = document.wires.flatMap((wire, index) => {
    const start = contactPointForWire(document, wire.from, wire.to, view);
    const end = contactPointForWire(document, wire.to, wire.from, view);
    if (!start || !end) return [];
    const points = view === "drawing" ? [start, ...wire.drawingRoute, end] : [start, ...wire.e4Route, end];
    const fromAnchor = view === "e4" ? wireEndpointE4Anchor(document, wire.from) : null;
    const toAnchor = view === "e4" ? wireEndpointE4Anchor(document, wire.to) : null;
    return [{
      id: wire.id,
      layerId: wire.layerIds[view],
      kind: "wire" as const,
      label: wire.circuit || `W${index + 1}`,
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      color: wire.color,
      points,
      metadata: {
        lengthMm: String(wire.lengthMm),
        e4LabelPosition: String(wire.e4LabelPosition ?? 0.5),
        ...(view === "e4" ? {
          view: "e4",
          fromSide: fromAnchor?.leadDirection ?? "",
          toSide: toAnchor?.leadDirection ?? "",
          leadLength: "24",
        } : {}),
      },
    }];
  });
  const dimensions: EditorSceneObject[] = view === "drawing" ? document.wires.flatMap((wire) => {
    const start = contactPointForWire(document, wire.from, wire.to, view);
    const end = contactPointForWire(document, wire.to, wire.from, view);
    if (!start || !end) return [];
    const y = Math.max(start.y, end.y) + 70;
    return [{
      id: `dimension:${wire.id}`,
      layerId: "dimensions",
      kind: "dimension" as const,
      label: `${wire.lengthMm} мм`,
      x: 0, y: 0, width: 0, height: 0, color: "#55798e",
      points: [{ x: start.x, y }, { x: end.x, y }],
    }];
  }) : [];
  return [...connectors, ...wires, ...dimensions];
}

function fromUiLayers(layers: readonly UiLayer[], previous: readonly EditorLayer[]): readonly EditorLayer[] {
  return layers.map((layer, index) => ({
    id: layer.id,
    name: previous.find((item) => item.id === layer.id)?.name ?? layer.label,
    order: layers.length - index - 1,
    visible: layer.visible,
    locked: layer.locked,
  }));
}

export function snapRoutePoint(
  start: { readonly x: number; readonly y: number },
  point: { readonly x: number; readonly y: number },
  enabled: boolean,
) {
  if (!enabled) return point;
  const dx = point.x - start.x;
  const dy = point.y - start.y;
  const distance = Math.hypot(dx, dy);
  const step = Math.PI / 12;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: start.x + Math.cos(angle) * distance, y: start.y + Math.sin(angle) * distance };
}

export function HarnessDesignEditor({
  config,
  session,
  projectId,
  harnessId,
  harnessDesignation,
  initialView,
  apiOverride,
  onClose,
  onViewChange,
}: HarnessDesignEditorProps) {
  const api = useMemo(() => apiOverride ?? createHarnessDesignApi(config, session), [apiOverride, config, session]);
  const catalog = useEditorReferenceCatalog(config, session);
  const terminalLookup = useTerminalArticleLookup(config, session);
  const [view, setView] = useState<HarnessEditorView>(initialView);
  const [resource, setResource] = useState<HarnessDesignResource | null>(null);
  const [history, setHistory] = useState<EditorHistory | null>(null);
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [selectedObjectIds, setSelectedObjectIds] = useState<readonly string[]>([]);
  const [editingObjectId, setEditingObjectId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<EditorSaveState>("saved");
  const [drawingSnapEnabled, setDrawingSnapEnabled] = useState(true);
  const [movePreview, setMovePreview] = useState<{
    readonly objectId: string;
    readonly point: { readonly x: number; readonly y: number };
  } | null>(null);
  const [message, setMessage] = useState("Загружаем документ жгута…");
  const historyRef = useRef<EditorHistory | null>(null);
  const resourceRef = useRef<HarnessDesignResource | null>(null);
  const savedJsonRef = useRef("");
  const savingRef = useRef(false);
  const savePromiseRef = useRef<Promise<boolean> | null>(null);
  const queuedRef = useRef(false);
  const loadGeneration = useRef(0);
  const previewFrameRef = useRef<number | null>(null);
  const pendingMovePreviewRef = useRef<typeof movePreview>(null);

  useEffect(() => { historyRef.current = history; }, [history]);
  useEffect(() => { resourceRef.current = resource; }, [resource]);
  useEffect(() => setView(initialView), [initialView]);

  useEffect(() => {
    const generation = ++loadGeneration.current;
    setResource(null);
    setHistory(null);
    setSelectedObjectId(null);
    setSelectedObjectIds([]);
    setEditingObjectId(null);
    setMovePreview(null);
    setMessage("Загружаем документ жгута…");
    setSaveState("saved");
    void api.get(projectId, harnessId).then((loaded) => {
      if (generation !== loadGeneration.current) return;
      const normalizedContent = normalizeE4RoutingDocument(loaded.content);
      setResource(loaded);
      setHistory(createEditorHistory(normalizedContent));
      savedJsonRef.current = JSON.stringify(loaded.content);
      setMessage("");
    }).catch((error: unknown) => {
      if (generation !== loadGeneration.current) return;
      setSaveState("error");
      setMessage(error instanceof Error ? error.message : "Не удалось загрузить документ жгута.");
    });
    return () => { loadGeneration.current += 1; };
  }, [api, harnessId, projectId]);

  const flushSave = useCallback((): Promise<boolean> => {
    if (savePromiseRef.current) {
      queuedRef.current = true;
      return savePromiseRef.current;
    }
    const promise = (async () => {
      savingRef.current = true;
      try {
        do {
          queuedRef.current = false;
          const currentHistory = historyRef.current;
          const currentResource = resourceRef.current;
          if (!currentHistory || !currentResource) break;
          const content = currentHistory.present;
          const serialized = JSON.stringify(content);
          if (serialized === savedJsonRef.current) break;
          setSaveState("saving");
          const saved = await api.save(projectId, harnessId, currentResource.revision, content);
          savedJsonRef.current = serialized;
          resourceRef.current = saved;
          setResource(saved);
        } while (queuedRef.current || (historyRef.current && JSON.stringify(historyRef.current.present) !== savedJsonRef.current));
        setSaveState("saved");
        setMessage("");
        return true;
      } catch (error: unknown) {
        setSaveState("error");
        setMessage(error instanceof Error ? error.message : "Не удалось сохранить документ жгута.");
        return false;
      } finally {
        savingRef.current = false;
      }
    })();
    savePromiseRef.current = promise;
    void promise.finally(() => {
      if (savePromiseRef.current === promise) savePromiseRef.current = null;
    });
    return promise;
  }, [api, harnessId, projectId]);

  useEffect(() => {
    if (!history) return;
    if (JSON.stringify(history.present) === savedJsonRef.current) {
      if (!savingRef.current) setSaveState("saved");
      return;
    }
    setSaveState("changed");
    const timer = window.setTimeout(() => void flushSave(), 650);
    return () => window.clearTimeout(timer);
  }, [flushSave, history]);

  useEffect(() => {
    if (!history) return;
    const availableObjectIds = new Set([
      ...history.present.connectors.map((item) => item.id),
      ...history.present.wires.map((item) => item.id),
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

  const previewResult = useMemo(() => {
    if (!history) return { document: null, error: null };
    if (!movePreview) return { document: history.present, error: null };
    try {
      return { document: applyEditorCommand(history.present, {
        type: "move-connector",
        connectorId: movePreview.objectId,
        view,
        position: movePreview.point,
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
            endpoint.connectorId === movePreview.objectId)),
        },
        error: error instanceof Error ? error.message : "Трассировка невозможна.",
      };
    }
  }, [history, movePreview, view]);

  const run = useCallback((command: EditorCommand): boolean => {
    const current = historyRef.current;
    if (!current) return false;
    try {
      const next = executeEditorCommand(current, command);
      historyRef.current = next;
      setHistory(next);
      setMessage("");
      return true;
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : "Не удалось изменить документ жгута.");
      return false;
    }
  }, []);

  const previewObjectMove = useCallback((objectId: string, point: { readonly x: number; readonly y: number } | null) => {
    pendingMovePreviewRef.current = point ? { objectId, point } : null;
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
      if (event.key === "Escape" && editingObjectId) {
        event.preventDefault();
        setEditingObjectId(null);
        return;
      }
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
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
  }, [editingObjectId, run, selectedObjectIds]);

  if (!history || !resource) {
    return <div className={`he-loading ${saveState === "error" ? "error" : ""}`} role="status">{message}</div>;
  }

  const diagnostics = view === "e4" ? collectE4Diagnostics(history.present) : [];
  const diagnosticObjectIds = new Set(diagnostics.map((diagnostic) => diagnostic.target.objectId));
  const scene = designToScene(previewResult.document ?? history.present, view, diagnosticObjectIds);
  const layers = toUiLayers(history.present, view);
  const selectedConnector = view === "e4" && selectedObjectId
    ? history.present.connectors.find((connector) => connector.id === selectedObjectId) ?? null
    : null;
  const selectedConnectorLayer = selectedConnector
    ? layers.find((layer) => layer.id === selectedConnector.layerIds.e4)
    : null;
  const selectedSeriesId = selectedConnector?.libraryBinding?.mode === "series"
    ? selectedConnector.libraryBinding.seriesId
    : null;
  const selectedConnectorSeries = selectedSeriesId
    ? builtInConnectorSeries.find((series) => series.id === selectedSeriesId)
    : undefined;
  const addCatalogItem = (item: EditorCatalogItem, point?: { readonly x: number; readonly y: number }) => {
    if (item.placement !== "connector") return;
    const id = crypto.randomUUID();
    const index = history.present.connectors.length;
    const preview = createBuiltInConnectorInstance(item.id, {
      id,
      designation: `XS${index + 1}`,
      e4Position: { x: 0, y: 0 },
      partNumber: item.defaultPartNumber,
    });
    const nextE4Y = history.present.connectors.reduce((bottom, connector) => Math.max(
      bottom,
      connector.positions.e4.y + connectorE4TableGeometry(connector).height + 90,
    ), 100);
    const placement = point ?? { x: 120, y: nextE4Y };
    run({
      type: "add-connector",
      connector: { ...preview, positions: { e4: placement, drawing: placement } },
    });
    setSelectedObjectId(id);
    setSelectedObjectIds([id]);
  };

  const addRoutePoint = (point: { readonly x: number; readonly y: number }) => {
    if (view !== "drawing" || !selectedObjectId) return;
    const wire = history.present.wires.find((item) => item.id === selectedObjectId);
    if (!wire) return;
    const renderedWire = scene.find((item) => item.id === wire.id);
    const start = wire.drawingRoute.at(-1) ?? renderedWire?.points?.[0] ??
      findWireEndpoint(history.present, wire.from, "drawing");
    if (!start) return;
    const next = snapRoutePoint(start, point, drawingSnapEnabled);
    run({ type: "set-wire-route", wireId: wire.id, route: [...wire.drawingRoute, next] });
  };

  const createRoutedWire = (id: string, from: WireEndpoint, to: WireEndpoint) => {
    const wire = createWire(id, from, to, 100);
    const start = wireEndpointE4Anchor(history.present, from);
    const end = wireEndpointE4Anchor(history.present, to);
    return start && end ? { ...wire, e4Route: createOrthogonalE4Route(start, end) } : wire;
  };

  const selectedWireIds = selectedObjectIds.filter((id) => history.present.wires.some((wire) => wire.id === id));
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
      run({ type: "update-screen", screenId: selectedScreen.id, position });
    } else {
      run({
        type: "create-screen",
        screen: { id: crypto.randomUUID(), wireIds: selectedWireIds, position, label: "Экран", width: 46 },
      });
    }
  };

  return (
    <div className="he-host">
      {message && <div className="he-save-message" role="alert">{message}</div>}
      <HarnessEditorWorkspace
        harnessId={harnessId}
        harnessDesignation={harnessDesignation}
        view={view}
        objects={scene}
        layers={layers}
        catalogItems={catalog.items}
        catalogSources={catalog.sources}
        selectedCatalogSourceId={catalog.selectedSourceId}
        catalogQuery={catalog.query}
        catalogLoadState={catalog.loadState}
        catalogMessage={catalog.message}
        catalogHasMore={catalog.hasMore}
        selectedObjectId={selectedObjectId}
        selectedObjectIds={selectedObjectIds}
        e4Overlays={view === "e4" ? {
          crossingStyle: history.present.views.e4.wireCrossingStyle,
          junctions: history.present.junctions,
          diffPairs: history.present.diffPairs,
          screens: history.present.screens,
        } : undefined}
        saveState={saveState}
        onSaveRequest={() => void flushSave()}
        propertyInspector={selectedConnector ? (
          <E4ConnectorInspector
            connector={selectedConnector}
            series={selectedConnectorSeries}
            terminalArticles={terminalLookup.articles}
            onTerminalSearch={terminalLookup.search}
            disabled={selectedConnectorLayer?.locked === true}
            onCommand={run}
          />
        ) : undefined}
        canvasEditor={selectedConnector ? (
          <E4ConnectorInspector
            connector={selectedConnector}
            series={selectedConnectorSeries}
            terminalArticles={terminalLookup.articles}
            onTerminalSearch={terminalLookup.search}
            disabled={selectedConnectorLayer?.locked === true}
            onCommand={run}
            mode="canvas"
            editing={editingObjectId === selectedConnector.id}
            onEditingChange={(editing) => setEditingObjectId(editing ? selectedConnector.id : null)}
          />
        ) : undefined}
        diagnostics={diagnostics.map((diagnostic) => ({
          id: diagnostic.id,
          objectId: diagnostic.target.objectId,
          label: diagnostic.designation,
          message: diagnostic.message,
        }))}
        previewMessage={previewResult.error}
        onViewChange={(nextView) => {
          setEditingObjectId(null);
          setView(nextView);
          onViewChange?.(nextView);
        }}
        onSelectedObjectChange={(objectId) => {
          setSelectedObjectId(objectId);
          setEditingObjectId((current) => current === objectId ? current : null);
        }}
        onSelectedObjectIdsChange={setSelectedObjectIds}
        onCatalogItemActivate={addCatalogItem}
        onCatalogSourceChange={catalog.selectSource}
        onCatalogQueryChange={catalog.changeQuery}
        onCatalogLoadMore={catalog.loadMore}
        onCatalogRetry={catalog.retry}
        onObjectMove={(objectId, point) => run({
          type: "move-connector",
          connectorId: objectId,
          view,
          position: point,
        })}
        onObjectMovePreview={previewObjectMove}
        onObjectEditRequest={(objectId) => {
          setSelectedObjectId(objectId);
          setSelectedObjectIds([objectId]);
          setEditingObjectId(objectId);
        }}
        onWireConnect={(from, to) => {
          const fromConnector = history.present.connectors.find((item) => item.id === from.connectorId);
          const toConnector = history.present.connectors.find((item) => item.id === to.connectorId);
          const fromContact = fromConnector?.contacts[from.contactIndex];
          const toContact = toConnector?.contacts[to.contactIndex];
          if (!fromContact || !toContact) return;
          const id = crypto.randomUUID();
          run({
            type: "add-wire",
            wire: createRoutedWire(
              id,
              { connectorId: from.connectorId, contactId: fromContact.id },
              { connectorId: to.connectorId, contactId: toContact.id },
            ),
          });
          setSelectedObjectId(id);
          setSelectedObjectIds([id]);
        }}
        onWireReconnect={(wireId, end, target) => {
          const connector = history.present.connectors.find((item) => item.id === target.connectorId);
          const contact = connector?.contacts[target.contactIndex];
          if (!contact) return;
          run({
            type: "reconnect-wire",
            wireId,
            end,
            endpoint: { connectorId: target.connectorId, contactId: contact.id },
          });
          setSelectedObjectId(wireId);
          setSelectedObjectIds([wireId]);
        }}
        onWireConnectToWire={(from, targetWireId, point) => {
          const connector = history.present.connectors.find((item) => item.id === from.connectorId);
          const contact = connector?.contacts[from.contactIndex];
          const targetWire = history.present.wires.find((item) => item.id === targetWireId);
          if (!contact || !targetWire) return;
          const wireId = crypto.randomUUID();
          const existingJunction = history.present.junctions.find((junction) =>
            junction.wireIds.includes(targetWireId) &&
            Math.hypot(junction.position.x - point.x, junction.position.y - point.y) < 0.01);
          const junctionId = existingJunction?.id ?? crypto.randomUUID();
          const fromEndpoint = { connectorId: from.connectorId, contactId: contact.id };
          const toEndpoint = createJunctionEndpoint(junctionId);
          const base = createWire(wireId, fromEndpoint, toEndpoint, 100, targetWire.circuit);
          const start = wireEndpointE4Anchor(history.present, fromEndpoint);
          const branchWire = start ? {
            ...base,
            e4Route: createOrthogonalE4Route(start, { position: point, leadDirection: null }),
          } : base;
          const succeeded = existingJunction
            ? run({ type: "add-wire", wire: branchWire, targetWireId })
            : run({
              type: "create-junction",
              junction: { id: junctionId, position: point, wireIds: [targetWireId, wireId] },
              branchWire,
            });
          if (succeeded) {
            setSelectedObjectId(wireId);
            setSelectedObjectIds([wireId]);
          }
        }}
        onWireReconnectToWire={(wireId, end, targetWireId, point) => {
          const existingJunction = history.present.junctions.find((junction) =>
            junction.wireIds.includes(targetWireId) &&
            Math.hypot(junction.position.x - point.x, junction.position.y - point.y) < 0.01);
          const succeeded = existingJunction
            ? run({
              type: "connect-wire-to-wire",
              wireId,
              end,
              targetWireId,
              junctionId: existingJunction.id,
              position: existingJunction.position,
            })
            : run({
              type: "connect-wire-to-wire",
              wireId,
              end,
              targetWireId,
              junctionId: crypto.randomUUID(),
              position: point,
            });
          if (succeeded) {
            setSelectedObjectId(wireId);
            setSelectedObjectIds([wireId]);
          }
        }}
        onE4WireSegmentMove={(wireId, segmentIndex, coordinate) => run({
          type: "move-e4-wire-segment",
          wireId,
          segmentIndex,
          position: { x: coordinate, y: coordinate },
        })}
        onE4WireLabelPositionChange={(wireId, position) => run({
          type: "set-e4-wire-label-position",
          wireId,
          position,
        })}
        onE4ScreenPositionChange={(screenId, position) => run({
          type: "update-screen",
          screenId,
          position,
        })}
        onE4CrossingStyleChange={(style) => run({ type: "set-wire-crossing-style", view: "e4", style })}
        onE4DifferentialPairChange={changeDiffPair}
        onE4ScreenChange={changeScreen}
        onE4ClearGroup={() => {
          for (const group of history.present.diffPairs.filter((item) =>
            item.wireIds.some((id) => selectedWireIds.includes(id)))) {
            run({ type: "remove-diff-pair", groupId: group.id });
          }
          for (const screen of history.present.screens.filter((item) =>
            item.wireIds.some((id) => selectedWireIds.includes(id)))) {
            run({ type: "remove-screen", screenId: screen.id });
          }
        }}
        onWireRoutePointMove={(wireId, routeIndex, point) => {
          const wire = history.present.wires.find((item) => item.id === wireId);
          if (!wire || routeIndex < 0 || routeIndex >= wire.drawingRoute.length) return;
          const route = wire.drawingRoute.map((item, index) => index === routeIndex ? point : item);
          run({ type: "set-wire-route", wireId, route });
        }}
        onWireRoutePointRemove={(wireId, routeIndex) => {
          const wire = history.present.wires.find((item) => item.id === wireId);
          if (!wire || routeIndex < 0 || routeIndex >= wire.drawingRoute.length) return;
          run({ type: "set-wire-route", wireId, route: wire.drawingRoute.filter((_, index) => index !== routeIndex) });
        }}
        drawingSnapEnabled={drawingSnapEnabled}
        onDrawingSnapChange={setDrawingSnapEnabled}
        onCanvasDoubleClick={addRoutePoint}
        onObjectsChange={(objects) => {
          const selected = selectedObjectId ? objects.find((item) => item.id === selectedObjectId) : null;
          if (!selected || selected.id.startsWith("dimension:")) return;
          const previous = scene.find((item) => item.id === selected.id);
          if (!previous) return;
          if (selected.kind === "connector") {
            if (selected.x !== previous.x || selected.y !== previous.y) {
              run({ type: "move-connector", connectorId: selected.id, view, position: { x: selected.x, y: selected.y } });
            } else if (selected.label !== previous.label) {
              run({ type: "update-connector", connectorId: selected.id, designation: selected.label });
            }
          } else if (selected.kind === "wire") {
            const lengthMm = Number(selected.metadata?.lengthMm);
            run({
              type: "update-wire",
              wireId: selected.id,
              circuit: selected.label === previous.label ? undefined : selected.label,
              color: selected.color === previous.color ? undefined : selected.color,
              lengthMm: Number.isFinite(lengthMm) && lengthMm > 0 && selected.metadata?.lengthMm !== previous.metadata?.lengthMm
                ? lengthMm : undefined,
            });
          }
        }}
        onLayersChange={(nextLayers) => run({
          type: "replace-layers",
          view,
          layers: fromUiLayers(nextLayers, history.present.views[view].layers),
        })}
        onClose={onClose ? async () => {
          if (await flushSave()) onClose();
        } : undefined}
      />
    </div>
  );
}
