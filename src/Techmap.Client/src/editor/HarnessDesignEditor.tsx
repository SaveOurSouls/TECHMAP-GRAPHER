import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LocalSession } from "../local-session";
import type { RuntimeConfig } from "../runtime-config";
import { createConnector, createWire, type EditorCommand } from "./commands";
import { createHarnessDesignApi, type HarnessDesignApi, type HarnessDesignResource } from "./design-api";
import { useEditorReferenceCatalog } from "./editor-reference-catalog";
import type { EditorCatalogItem, EditorLayer as UiLayer, EditorSceneObject, HarnessEditorView } from "./editor-types";
import { HarnessEditorWorkspace, type EditorSaveState } from "./HarnessEditorWorkspace";
import { E4ConnectorInspector } from "./E4ConnectorInspector";
import { createEditorHistory, executeEditorCommand, redoEditorCommand, undoEditorCommand, type EditorHistory } from "./history";
import {
  connectorContactPosition,
  connectorE4TableGeometry,
  createEmptyHarnessDesign,
  findWireEndpoint,
  type EditorLayer,
  type HarnessDesignDocument,
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

function toUiLayers(document: HarnessDesignDocument, view: HarnessEditorView): readonly UiLayer[] {
  return [...document.views[view].layers]
    .sort((left, right) => right.order - left.order)
    .map((layer) => ({ id: layer.id, label: layer.name, visible: layer.visible, locked: layer.locked }));
}

function contactPointForWire(
  document: HarnessDesignDocument,
  connectorId: string,
  contactId: string,
  otherConnectorId: string,
  view: HarnessEditorView,
) {
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
      const connectedWires = new Map(connector.contacts.map((contact) => [
        contact.id,
        document.wires.find((wire) =>
          (wire.from.connectorId === connector.id && wire.from.contactId === contact.id) ||
          (wire.to.connectorId === connector.id && wire.to.contactId === contact.id)),
      ]));
      Object.assign(metadata, {
        view: "e4",
        orientation: connector.schematic.orientation === "contacts-left" ? "left" : "right",
        designation: connector.designation,
        partNumber: connector.partNumber,
        columns: JSON.stringify(columnIds),
        columnLabels: JSON.stringify(customLabels),
        rows: JSON.stringify(connector.contacts.map((contact) => {
          const connectedWire = connectedWires.get(contact.id);
          return {
            number: contact.number,
            contactType: contact.contactType,
            circuit: contact.circuit || connectedWire?.circuit || "",
            terminal: contact.terminalArticle,
            wire: contact.wire,
            color: contact.color || connectedWire?.color || "",
            status: contact.connectionStatus,
            customValues: contact.customValues,
          };
        })),
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
    const start = contactPointForWire(document, wire.from.connectorId, wire.from.contactId, wire.to.connectorId, view);
    const end = contactPointForWire(document, wire.to.connectorId, wire.to.contactId, wire.from.connectorId, view);
    if (!start || !end) return [];
    const points = view === "drawing" ? [start, ...wire.drawingRoute, end] : [start, end];
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
      metadata: { lengthMm: String(wire.lengthMm) },
    }];
  });
  const dimensions: EditorSceneObject[] = view === "drawing" ? document.wires.flatMap((wire) => {
    const start = contactPointForWire(
      document, wire.from.connectorId, wire.from.contactId, wire.to.connectorId, view);
    const end = contactPointForWire(
      document, wire.to.connectorId, wire.to.contactId, wire.from.connectorId, view);
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
  const [view, setView] = useState<HarnessEditorView>(initialView);
  const [resource, setResource] = useState<HarnessDesignResource | null>(null);
  const [history, setHistory] = useState<EditorHistory | null>(null);
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<EditorSaveState>("saved");
  const [drawingSnapEnabled, setDrawingSnapEnabled] = useState(true);
  const [message, setMessage] = useState("Загружаем документ жгута…");
  const historyRef = useRef<EditorHistory | null>(null);
  const resourceRef = useRef<HarnessDesignResource | null>(null);
  const savedJsonRef = useRef("");
  const savingRef = useRef(false);
  const savePromiseRef = useRef<Promise<boolean> | null>(null);
  const queuedRef = useRef(false);
  const loadGeneration = useRef(0);

  useEffect(() => { historyRef.current = history; }, [history]);
  useEffect(() => { resourceRef.current = resource; }, [resource]);
  useEffect(() => setView(initialView), [initialView]);

  useEffect(() => {
    const generation = ++loadGeneration.current;
    setResource(null);
    setHistory(null);
    setMessage("Загружаем документ жгута…");
    setSaveState("saved");
    void api.get(projectId, harnessId).then((loaded) => {
      if (generation !== loadGeneration.current) return;
      setResource(loaded);
      setHistory(createEditorHistory(loaded.content));
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
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      if ((event.key === "Delete" || event.key === "Backspace") && selectedObjectId) {
        const current = historyRef.current?.present;
        if (!current) return;
        if (current.connectors.some((item) => item.id === selectedObjectId)) {
          event.preventDefault();
          run({ type: "remove-connector", connectorId: selectedObjectId });
          setSelectedObjectId(null);
        } else if (current.wires.some((item) => item.id === selectedObjectId)) {
          event.preventDefault();
          run({ type: "remove-wire", wireId: selectedObjectId });
          setSelectedObjectId(null);
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
  }, [run, selectedObjectId]);

  if (!history || !resource) {
    return <div className={`he-loading ${saveState === "error" ? "error" : ""}`} role="status">{message}</div>;
  }

  const scene = designToScene(history.present, view);
  const layers = toUiLayers(history.present, view);
  const selectedConnector = view === "e4" && selectedObjectId
    ? history.present.connectors.find((connector) => connector.id === selectedObjectId) ?? null
    : null;
  const selectedConnectorLayer = selectedConnector
    ? layers.find((layer) => layer.id === selectedConnector.layerIds.e4)
    : null;
  const addCatalogItem = (item: EditorCatalogItem, point?: { readonly x: number; readonly y: number }) => {
    if (!item.id.includes("xs-")) return;
    const contactCount = item.id.includes("10") ? 10 : 4;
    const id = crypto.randomUUID();
    const index = history.present.connectors.length;
    const placement = point ?? {
      x: 120 + (index % 4) * 190,
      y: 100 + Math.floor(index / 4) * 150,
    };
    run({
      type: "add-connector",
      connector: createConnector(id, `XS${index + 1}`, contactCount, placement, placement, item.title),
    });
    setSelectedObjectId(id);
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
        saveState={saveState}
        onSaveRequest={() => void flushSave()}
        propertyInspector={selectedConnector ? (
          <E4ConnectorInspector
            connector={selectedConnector}
            disabled={selectedConnectorLayer?.locked === true}
            onCommand={run}
          />
        ) : undefined}
        onViewChange={(nextView) => {
          setView(nextView);
          onViewChange?.(nextView);
        }}
        onSelectedObjectChange={setSelectedObjectId}
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
        onWireConnect={(from, to) => {
          const fromConnector = history.present.connectors.find((item) => item.id === from.connectorId);
          const toConnector = history.present.connectors.find((item) => item.id === to.connectorId);
          const fromContact = fromConnector?.contacts[from.contactIndex];
          const toContact = toConnector?.contacts[to.contactIndex];
          if (!fromContact || !toContact) return;
          const id = crypto.randomUUID();
          run({
            type: "add-wire",
            wire: createWire(
              id,
              { connectorId: from.connectorId, contactId: fromContact.id },
              { connectorId: to.connectorId, contactId: toContact.id },
              100,
            ),
          });
          setSelectedObjectId(id);
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
