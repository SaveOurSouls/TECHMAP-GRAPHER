import { useMemo, useState, type ReactNode } from "react";
import { CanvasViewport } from "./CanvasViewport";
import { CatalogDock } from "./CatalogDock";
import { zoomEditorCameraAt } from "./editor-camera";
import { moveLayer, toggleLayerLock, toggleLayerVisibility, updateEditorObject } from "./editor-state";
import type {
  EditorCamera,
  EditorCatalogItem,
  EditorCatalogSource,
  EditorLayer,
  EditorPoint,
  EditorSceneObject,
  EditorTool,
  HarnessEditorView,
} from "./editor-types";
import { EditorToolbar } from "./EditorToolbar";
import { LayersPanel } from "./LayersPanel";
import { ObjectInspector } from "./ObjectInspector";
import "./harness-editor.css";

const defaultLayers: readonly EditorLayer[] = [
  { id: "annotations", label: "Размеры и обозначения", visible: true, locked: false },
  { id: "components", label: "Соединители", visible: true, locked: false },
  { id: "wires", label: "Провода", visible: true, locked: false },
];

const defaultObjects: readonly EditorSceneObject[] = [
  { id: "XS1", layerId: "components", kind: "connector", label: "XS1", x: 145, y: 145, width: 118, height: 72, color: "#416579" },
  { id: "XS2", layerId: "components", kind: "connector", label: "XS2", x: 590, y: 300, width: 118, height: 72, color: "#416579" },
  {
    id: "W1",
    layerId: "wires",
    kind: "wire",
    label: "W1 · 350 мм",
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    color: "#bd3b38",
    points: [{ x: 263, y: 180 }, { x: 415, y: 180 }, { x: 415, y: 336 }, { x: 590, y: 336 }],
  },
  {
    id: "DIM-1",
    layerId: "annotations",
    kind: "dimension",
    label: "350 мм",
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    color: "#55798e",
    points: [{ x: 270, y: 415 }, { x: 585, y: 415 }],
  },
];

const defaultCatalog: readonly EditorCatalogItem[] = [
  { id: "catalog-xs-04", title: "XS-04", subtitle: "Соединитель · 4 контакта", category: "Соединители", accent: "#3f718b" },
  { id: "catalog-xs-10", title: "XS-10", subtitle: "Соединитель · 10 контактов", category: "Соединители", accent: "#3f718b" },
  { id: "catalog-wire-red", title: "Провод 0,35", subtitle: "Красный · 0,35 мм²", category: "Провода", accent: "#c94b47" },
  { id: "catalog-wire-black", title: "Провод 0,50", subtitle: "Чёрный · 0,50 мм²", category: "Провода", accent: "#303a40" },
  { id: "catalog-tube", title: "ТУТ 3/1,5", subtitle: "Термоусадка · чёрная", category: "Аксессуары", accent: "#596168" },
  { id: "catalog-braid", title: "Оплётка 4–8", subtitle: "Нейлоновая · чёрная", category: "Аксессуары", accent: "#758087" },
];

const initialCamera: EditorCamera = { offsetX: 70, offsetY: 48, zoom: 1 };

export type EditorSaveState = "saved" | "saving" | "changed" | "error";

export interface HarnessEditorWorkspaceProps {
  readonly harnessId: string;
  readonly harnessDesignation: string;
  readonly view?: HarnessEditorView;
  readonly objects?: readonly EditorSceneObject[];
  readonly layers?: readonly EditorLayer[];
  readonly catalogItems?: readonly EditorCatalogItem[];
  readonly catalogSources?: readonly EditorCatalogSource[];
  readonly selectedCatalogSourceId?: string;
  readonly catalogQuery?: string;
  readonly catalogLoadState?: "idle" | "loading" | "loading-more" | "ready" | "unpublished" | "error";
  readonly catalogMessage?: string | null;
  readonly catalogHasMore?: boolean;
  readonly selectedObjectId?: string | null;
  readonly saveState?: EditorSaveState;
  readonly onSaveRequest?: () => void;
  readonly onViewChange?: (view: HarnessEditorView) => void;
  readonly onObjectsChange?: (objects: readonly EditorSceneObject[]) => void;
  readonly onLayersChange?: (layers: readonly EditorLayer[]) => void;
  readonly onSelectedObjectChange?: (objectId: string | null) => void;
  readonly onCatalogItemActivate?: (item: EditorCatalogItem, point?: EditorPoint) => void;
  readonly onCatalogSourceChange?: (sourceId: string) => void;
  readonly onCatalogQueryChange?: (query: string) => void;
  readonly onCatalogLoadMore?: () => void;
  readonly onCatalogRetry?: () => void;
  readonly onObjectMove?: (objectId: string, point: EditorPoint) => void;
  readonly onWireConnect?: (
    from: { readonly connectorId: string; readonly contactIndex: number },
    to: { readonly connectorId: string; readonly contactIndex: number },
  ) => void;
  readonly onWireReconnect?: (
    wireId: string,
    end: "from" | "to",
    target: { readonly connectorId: string; readonly contactIndex: number },
  ) => void;
  readonly onWireRoutePointMove?: (wireId: string, routeIndex: number, point: EditorPoint) => void;
  readonly onWireRoutePointRemove?: (wireId: string, routeIndex: number) => void;
  readonly drawingSnapEnabled?: boolean;
  readonly onDrawingSnapChange?: (enabled: boolean) => void;
  readonly onCanvasDoubleClick?: (point: EditorPoint) => void;
  readonly propertyInspector?: ReactNode;
  readonly onClose?: () => void;
}

const saveLabels: Readonly<Record<EditorSaveState, string>> = {
  saved: "Сохранено",
  saving: "Сохраняем…",
  changed: "Есть изменения",
  error: "Ошибка сохранения",
};

export function HarnessEditorWorkspace({
  harnessId,
  harnessDesignation,
  view: controlledView,
  objects: controlledObjects,
  layers: controlledLayers,
  catalogItems = defaultCatalog,
  catalogSources,
  selectedCatalogSourceId,
  catalogQuery,
  catalogLoadState,
  catalogMessage,
  catalogHasMore,
  selectedObjectId: controlledSelectedObjectId,
  saveState = "saved",
  onSaveRequest,
  onViewChange,
  onObjectsChange,
  onLayersChange,
  onSelectedObjectChange,
  onCatalogItemActivate,
  onCatalogSourceChange,
  onCatalogQueryChange,
  onCatalogLoadMore,
  onCatalogRetry,
  onObjectMove,
  onWireConnect,
  onWireReconnect,
  onWireRoutePointMove,
  onWireRoutePointRemove,
  drawingSnapEnabled = true,
  onDrawingSnapChange,
  onCanvasDoubleClick,
  propertyInspector,
  onClose,
}: HarnessEditorWorkspaceProps) {
  const [localView, setLocalView] = useState<HarnessEditorView>("e4");
  const [tool, setTool] = useState<EditorTool>("select");
  const [localObjects, setLocalObjects] = useState(defaultObjects);
  const [localLayers, setLocalLayers] = useState(defaultLayers);
  const [localSelectedObjectId, setLocalSelectedObjectId] = useState<string | null>("W1");
  const [camera, setCamera] = useState(initialCamera);
  const [inspectorTab, setInspectorTab] = useState<"properties" | "layers">("properties");
  const [catalogExpanded, setCatalogExpanded] = useState(true);

  const view = controlledView ?? localView;
  const objects = controlledObjects ?? localObjects;
  const layers = controlledLayers ?? localLayers;
  const selectedObjectId = controlledSelectedObjectId === undefined
    ? localSelectedObjectId
    : controlledSelectedObjectId;
  const selectedObject = useMemo(
    () => objects.find((object) => object.id === selectedObjectId) ?? null,
    [objects, selectedObjectId],
  );
  const selectedLayer = layers.find((layer) => layer.id === selectedObject?.layerId);

  const changeView = (nextView: HarnessEditorView) => {
    if (controlledView === undefined) setLocalView(nextView);
    onViewChange?.(nextView);
    if (nextView === "e4" && tool === "dimension") setTool("select");
  };

  const changeObjects = (nextObjects: readonly EditorSceneObject[]) => {
    if (controlledObjects === undefined) setLocalObjects(nextObjects);
    onObjectsChange?.(nextObjects);
  };

  const changeLayers = (nextLayers: readonly EditorLayer[]) => {
    if (controlledLayers === undefined) setLocalLayers(nextLayers);
    onLayersChange?.(nextLayers);
  };

  const selectObject = (objectId: string | null) => {
    if (controlledSelectedObjectId === undefined) setLocalSelectedObjectId(objectId);
    onSelectedObjectChange?.(objectId);
  };

  const activateCatalogItem = (item: EditorCatalogItem, point?: EditorPoint) => {
    onCatalogItemActivate?.(item, point);
    if (controlledObjects !== undefined) return;
    const placement = point ?? { x: 385, y: 245 };
    const nextObject: EditorSceneObject = {
      id: `${item.id}-${objects.length + 1}`,
      layerId: "components",
      kind: "connector",
      label: item.title,
      x: Math.round(placement.x - 55),
      y: Math.round(placement.y - 34),
      width: 110,
      height: 68,
      color: item.accent,
    };
    changeObjects([...objects, nextObject]);
    selectObject(nextObject.id);
  };

  const droppedCatalogItem = (itemId: string, point: EditorPoint) => {
    const item = catalogItems.find((candidate) => candidate.id === itemId);
    if (item) activateCatalogItem(item, point);
  };

  const resetView = () => setCamera(initialCamera);
  const changeZoom = (factor: number) => setCamera((current) =>
    zoomEditorCameraAt(current, { x: 430, y: 280 }, current.zoom * factor));

  return (
    <section className="harness-editor" data-harness-id={harnessId} aria-label={`Редактор жгута ${harnessDesignation}`}>
      <header className="he-header">
        <div className="he-header-identity">
          {onClose && <button className="he-back" type="button" onClick={onClose} aria-label="Вернуться к проекту">←</button>}
          <div>
            <span>ПРОЕКТ / ЖГУТ</span>
            <strong>{harnessDesignation}</strong>
          </div>
        </div>
        <div className="he-view-tabs" role="tablist" aria-label="Представление жгута">
          <button type="button" role="tab" aria-selected={view === "e4"} className={view === "e4" ? "active" : ""} onClick={() => changeView("e4")}>Схема Э4</button>
          <button type="button" role="tab" aria-selected={view === "drawing"} className={view === "drawing" ? "active" : ""} onClick={() => changeView("drawing")}>Чертёж</button>
        </div>
        <div className="he-view-options">
          {view === "drawing" && (
            <button
              className={drawingSnapEnabled ? "he-angle-snap active" : "he-angle-snap"}
              type="button"
              aria-pressed={drawingSnapEnabled}
              title="Фиксировать направление нового участка с шагом 15 градусов"
              onClick={() => onDrawingSnapChange?.(!drawingSnapEnabled)}
            >15°</button>
          )}
        </div>
        <button
          className={`he-save-state ${saveState}`}
          type="button"
          onClick={onSaveRequest}
          disabled={!onSaveRequest || saveState === "saved" || saveState === "saving"}
          title={saveState === "error" ? "Повторить сохранение" : "Сохранить сейчас"}
        >
          <span aria-hidden="true" />{saveLabels[saveState]}
        </button>
      </header>

      <div className="he-workspace">
        <EditorToolbar
          view={view}
          activeTool={tool}
          onToolChange={setTool}
          onZoomIn={() => changeZoom(1.2)}
          onZoomOut={() => changeZoom(1 / 1.2)}
          onResetView={resetView}
        />
        <CanvasViewport
          view={view}
          tool={tool}
          camera={camera}
          objects={view === "e4" ? objects.filter((object) => object.kind !== "dimension") : objects}
          layers={layers}
          selectedObjectId={selectedObjectId}
          onCameraChange={setCamera}
          onObjectSelect={selectObject}
          onObjectMove={onObjectMove}
          onWireConnect={onWireConnect}
          onWireReconnect={onWireReconnect}
          onWireRoutePointMove={onWireRoutePointMove}
          onWireRoutePointRemove={onWireRoutePointRemove}
          onCanvasDoubleClick={onCanvasDoubleClick}
          onCatalogDrop={droppedCatalogItem}
        />

        <aside className="he-right-panel" aria-label="Настройки редактора">
          <div className="he-inspector-tabs" role="tablist" aria-label="Панель объекта">
            <button type="button" role="tab" aria-selected={inspectorTab === "properties"} className={inspectorTab === "properties" ? "active" : ""} onClick={() => setInspectorTab("properties")}>Свойства</button>
            <button type="button" role="tab" aria-selected={inspectorTab === "layers"} className={inspectorTab === "layers" ? "active" : ""} onClick={() => setInspectorTab("layers")}>Слои <span>{layers.length}</span></button>
          </div>
          <div className="he-inspector-content">
            {inspectorTab === "properties" ? (
              propertyInspector ?? (
                <ObjectInspector
                  view={view}
                  selectedObject={selectedObject}
                  disabled={selectedLayer?.locked === true}
                  onChange={(objectId, patch) => changeObjects(updateEditorObject(objects, objectId, patch))}
                />
              )
            ) : (
              <LayersPanel
                layers={layers}
                onVisibilityToggle={(layerId) => changeLayers(toggleLayerVisibility(layers, layerId))}
                onLockToggle={(layerId) => changeLayers(toggleLayerLock(layers, layerId))}
                onMove={(layerId, targetIndex) => changeLayers(moveLayer(layers, layerId, targetIndex))}
              />
            )}
          </div>
        </aside>

        <CatalogDock
          items={catalogItems}
          sources={catalogSources}
          selectedSourceId={selectedCatalogSourceId}
          query={catalogQuery}
          loadState={catalogLoadState}
          message={catalogMessage}
          hasMore={catalogHasMore}
          expanded={catalogExpanded}
          onExpandedChange={setCatalogExpanded}
          onActivate={activateCatalogItem}
          onSourceChange={onCatalogSourceChange}
          onQueryChange={onCatalogQueryChange}
          onLoadMore={onCatalogLoadMore}
          onRetry={onCatalogRetry}
        />
      </div>
    </section>
  );
}

export { defaultCatalog as harnessEditorDemoCatalog, defaultLayers as harnessEditorDemoLayers, defaultObjects as harnessEditorDemoObjects };
