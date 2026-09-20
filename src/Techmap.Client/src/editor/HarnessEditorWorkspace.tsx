import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  CanvasViewport,
  getEditorSceneBounds,
  getVisibleCableSheathScene,
  type E4ConnectableEndpoint,
  type E4SceneOverlays,
} from "./CanvasViewport";
import type {
  ComponentTemplateViewInstance,
  ResolveComponentTemplateAssetUrl,
} from "./component-template-view-renderer";
import { CatalogDock } from "./CatalogDock";
import { fitEditorCameraToBounds, zoomEditorCameraAt, type EditorViewportSize } from "./editor-camera";
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
import { E4WireSelectionMenu } from "./E4WireSelectionMenu";
import type { E4DifferentialPairState, E4ScreenState } from "./e4-wire-selection-state";
import { LayersPanel } from "./LayersPanel";
import { ObjectInspector } from "./ObjectInspector";
import type { CableInstance, WireEndStripProfiles } from "./model";
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
  { id: "catalog-connector-series:xs-demo-series", title: "Серия XS", subtitle: "Артикулы XS-04 и XS-10", category: "Соединители", accent: "#3f718b", placement: "connector", templateKind: "series", seriesId: "xs-demo-series", defaultPartNumber: "XS-04" },
  { id: "catalog-connector-free", title: "Свободный соединитель", subtitle: "Независимые строки и терминалы из всей базы", category: "Соединители", accent: "#71808a", placement: "connector", templateKind: "free" },
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
  readonly selectedObjectIds?: readonly string[];
  readonly highlightedObjectIds?: readonly string[];
  readonly relationPanel?: ReactNode;
  readonly revealRequest?: { readonly token: number; readonly objectIds: readonly string[] };
  readonly cables?: readonly CableInstance[];
  readonly saveState?: EditorSaveState;
  readonly onSaveRequest?: () => void;
  readonly onViewChange?: (view: HarnessEditorView) => void;
  readonly onObjectsChange?: (objects: readonly EditorSceneObject[]) => void;
  readonly onLayersChange?: (layers: readonly EditorLayer[]) => void;
  readonly onSelectedObjectChange?: (objectId: string | null) => void;
  readonly onSelectedObjectIdsChange?: (objectIds: readonly string[]) => void;
  readonly onCatalogItemActivate?: (item: EditorCatalogItem, point?: EditorPoint) => void;
  readonly onCatalogSourceChange?: (sourceId: string) => void;
  readonly onCatalogQueryChange?: (query: string) => void;
  readonly onCatalogLoadMore?: () => void;
  readonly onCatalogRetry?: () => void;
  readonly onWireMaterialClear?: (wireId: string) => void;
  readonly selectedWireStripProfiles?: WireEndStripProfiles;
  readonly activeWireStripEnd?: "from" | "to";
  readonly onActiveWireStripEndChange?: (end: "from" | "to") => void;
  readonly onWireStripProfileClear?: (wireId: string, end: "from" | "to") => void;
  readonly onObjectMove?: (objectId: string, point: EditorPoint) => void;
  readonly onDrawingMove?: (objectId:string,drawingId:string,offset:EditorPoint)=>void;
  readonly onObjectMovePreview?: (objectId: string, point: EditorPoint | null) => void;
  readonly onObjectEditRequest?: (objectId: string) => void;
  readonly onWireConnect?: (
    from: E4ConnectableEndpoint,
    to: E4ConnectableEndpoint,
  ) => void;
  readonly onWireReconnect?: (
    wireId: string,
    end: "from" | "to",
    target: E4ConnectableEndpoint,
  ) => void;
  readonly onWireConnectToWire?: (
    from: E4ConnectableEndpoint,
    targetWireId: string,
    point: EditorPoint,
  ) => void;
  readonly onWireReconnectToWire?: (
    wireId: string,
    end: "from" | "to",
    targetWireId: string,
    point: EditorPoint,
  ) => void;
  readonly onE4WireSegmentMove?: (wireId: string, segmentIndex: number, coordinate: number) => void;
  readonly onE4WireRoutePointRemove?: (wireId: string, routeIndex: number) => void;
  readonly onE4WireLabelPositionChange?: (wireId: string, position: number) => void;
  readonly onE4ScreenPositionChange?: (screenId: string, position: number) => void;
  readonly e4Overlays?: E4SceneOverlays;
  readonly componentTemplateViewInstances?: readonly ComponentTemplateViewInstance[];
  readonly resolveComponentTemplateAssetUrl?: ResolveComponentTemplateAssetUrl;
  readonly onE4CrossingStyleChange?: (style: "none" | "bridge") => void;
  readonly onE4DifferentialPairChange?: (state: E4DifferentialPairState | null) => void;
  readonly onE4ScreenChange?: (state: E4ScreenState | null) => void;
  readonly onE4ClearGroup?: () => void;
  readonly e4Detached?: boolean;
  readonly onE4DetachedChange?: (detached: boolean) => void;
  readonly onE4Reroute?: () => void;
  readonly onWireRoutePointMove?: (wireId: string, routeIndex: number, point: EditorPoint) => void;
  readonly onWireRoutePointRemove?: (wireId: string, routeIndex: number) => void;
  readonly drawingSnapEnabled?: boolean;
  readonly onDrawingSnapChange?: (enabled: boolean) => void;
  readonly onCanvasDoubleClick?: (point: EditorPoint) => void;
  readonly propertyInspector?: ReactNode;
  readonly canvasEditor?: ReactNode;
  readonly diagnostics?: readonly {
    readonly id: string;
    readonly objectId: string;
    readonly label: string;
    readonly message: string;
  }[];
  readonly previewMessage?: string | null;
  readonly onClose?: () => void;
}

export function reconcileWorkspaceSelection(
  selectedObjectIds: readonly string[],
  selectedObjectId: string | null,
  objects: readonly EditorSceneObject[],
): { readonly objectIds: readonly string[]; readonly primaryObjectId: string | null } {
  const availableIds = new Set(objects.filter((object) => !object.id.startsWith("dimension:")).map((object) => object.id));
  const objectIds = [...new Set(selectedObjectIds)].filter((id) => availableIds.has(id));
  const primaryObjectId = selectedObjectId && availableIds.has(selectedObjectId)
    ? selectedObjectId
    : objectIds.at(-1) ?? null;
  if (primaryObjectId && !objectIds.includes(primaryObjectId)) objectIds.push(primaryObjectId);
  return { objectIds, primaryObjectId };
}

export function reconcileWorkspaceGroupSelection(
  objectIds: readonly string[],
  objects: readonly EditorSceneObject[],
): { readonly objectIds: readonly string[]; readonly primaryObjectId: string | null } {
  const available = new Set(objects.filter((object) => object.kind !== "dimension").map((object) => object.id));
  const nextObjectIds = [...new Set(objectIds)].filter((id) => available.has(id));
  return { objectIds: nextObjectIds, primaryObjectId: nextObjectIds.at(-1) ?? null };
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
  selectedObjectIds: controlledSelectedObjectIds,
  highlightedObjectIds = [], relationPanel, revealRequest,
  cables = [],
  saveState = "saved",
  onSaveRequest,
  onViewChange,
  onObjectsChange,
  onLayersChange,
  onSelectedObjectChange,
  onSelectedObjectIdsChange,
  onCatalogItemActivate,
  onCatalogSourceChange,
  onCatalogQueryChange,
  onCatalogLoadMore,
  onCatalogRetry,
  onWireMaterialClear,
  selectedWireStripProfiles,
  activeWireStripEnd = "from",
  onActiveWireStripEndChange,
  onWireStripProfileClear,
  onObjectMove,
  onObjectMovePreview, onDrawingMove,
  onObjectEditRequest,
  onWireConnect,
  onWireReconnect,
  onWireConnectToWire,
  onWireReconnectToWire,
  onE4WireSegmentMove,
  onE4WireRoutePointRemove,
  onE4WireLabelPositionChange,
  onE4ScreenPositionChange,
  e4Overlays,
  componentTemplateViewInstances,
  resolveComponentTemplateAssetUrl,
  onE4CrossingStyleChange,
  onE4DifferentialPairChange,
  onE4ScreenChange,
  onE4ClearGroup,
  e4Detached,
  onE4DetachedChange,
  onE4Reroute,
  onWireRoutePointMove,
  onWireRoutePointRemove,
  drawingSnapEnabled = true,
  onDrawingSnapChange,
  onCanvasDoubleClick,
  propertyInspector,
  canvasEditor,
  diagnostics = [],
  previewMessage,
  onClose,
}: HarnessEditorWorkspaceProps) {
  const [localView, setLocalView] = useState<HarnessEditorView>("e4");
  const [tool, setTool] = useState<EditorTool>("select");
  const [localObjects, setLocalObjects] = useState(defaultObjects);
  const [localLayers, setLocalLayers] = useState(defaultLayers);
  const [localSelectedObjectId, setLocalSelectedObjectId] = useState<string | null>("W1");
  const [localSelectedObjectIds, setLocalSelectedObjectIds] = useState<readonly string[]>(["W1"]);
  const [camera, setCamera] = useState(initialCamera);
  const [viewportSize, setViewportSize] = useState<EditorViewportSize>({ width: 860, height: 560 });
  const [inspectorTab, setInspectorTab] = useState<"properties" | "layers">("properties");
  const [catalogExpanded, setCatalogExpanded] = useState(true);

  const view = controlledView ?? localView;
  const objects = controlledObjects ?? localObjects;
  const layers = controlledLayers ?? localLayers;
  const selectedObjectId = controlledSelectedObjectId === undefined
    ? localSelectedObjectId
    : controlledSelectedObjectId;
  const selectedObjectIds = controlledSelectedObjectIds ?? localSelectedObjectIds;
  useEffect(() => {
    const normalized = reconcileWorkspaceSelection(selectedObjectIds, selectedObjectId, objects);
    const idsChanged = normalized.objectIds.length !== selectedObjectIds.length ||
      normalized.objectIds.some((id, index) => id !== selectedObjectIds[index]);
    if (!idsChanged && normalized.primaryObjectId === selectedObjectId) return;
    if (controlledSelectedObjectId === undefined) setLocalSelectedObjectId(normalized.primaryObjectId);
    if (controlledSelectedObjectIds === undefined) setLocalSelectedObjectIds(normalized.objectIds);
    onSelectedObjectChange?.(normalized.primaryObjectId);
    onSelectedObjectIdsChange?.(normalized.objectIds);
  }, [
    controlledSelectedObjectId,
    controlledSelectedObjectIds,
    objects,
    onSelectedObjectChange,
    onSelectedObjectIdsChange,
    selectedObjectId,
    selectedObjectIds,
  ]);
  const selectedObject = useMemo(
    () => objects.find((object) => object.id === selectedObjectId) ?? null,
    [objects, selectedObjectId],
  );
  const selectedLayer = layers.find((layer) => layer.id === selectedObject?.layerId);
  const selectedWireIds = selectedObjectIds.filter((id) => objects.some((object) => object.id === id && object.kind === "wire"));
  const selectedDiffPair = e4Overlays?.diffPairs.find((group) =>
    group.wireIds.length === selectedWireIds.length && group.wireIds.every((id) => selectedWireIds.includes(id))) ?? null;
  const selectedScreen = e4Overlays?.screens.find((group) =>
    group.wireIds.length === selectedWireIds.length && group.wireIds.every((id) => selectedWireIds.includes(id))) ?? null;
  const canClearSelectedGroup = Boolean(
    e4Overlays?.diffPairs.some((group) => group.wireIds.some((id) => selectedWireIds.includes(id))) ||
    e4Overlays?.screens.some((group) => group.wireIds.some((id) => selectedWireIds.includes(id))),
  );
  const e4WireMenu = view === "e4" && tool === "select" && selectedWireIds.length > 0 ? (
    <E4WireSelectionMenu
      selectedWireIds={selectedWireIds}
      crossingStyle={e4Overlays?.crossingStyle ?? "none"}
      differentialPair={selectedDiffPair ? {
        variant: selectedDiffPair.variant ?? 1,
        twistPitchMm: selectedDiffPair.step,
      } : null}
      screen={selectedScreen ? {
        positionPercent: Math.round(selectedScreen.position * 100),
        terminalSide: selectedScreen.terminalSide ?? "above",
      } : null}
      canClearGroup={canClearSelectedGroup}
      disabled={selectedWireIds.some((id) => layers.find((layer) =>
        layer.id === objects.find((object) => object.id === id)?.layerId)?.locked === true)}
      onCrossingStyleChange={(style) => onE4CrossingStyleChange?.(style)}
      onDifferentialPairChange={(state) => onE4DifferentialPairChange?.(state)}
      onScreenChange={(state) => onE4ScreenChange?.(state)}
      onClearGroup={() => onE4ClearGroup?.()}
      detached={e4Detached}
      onDetachedChange={onE4DetachedChange}
      onReroute={onE4Reroute}
    />
  ) : null;

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

  const selectObject = (objectId: string | null, additive = false) => {
    const currentIds = selectedObjectIds.filter((id) => objects.some((object) => object.id === id));
    let nextIds: readonly string[];
    if (!objectId) {
      nextIds = [];
    } else if (!additive) {
      nextIds = [objectId];
    } else if (currentIds.includes(objectId)) {
      nextIds = currentIds.filter((id) => id !== objectId);
    } else {
      nextIds = [...currentIds, objectId];
    }
    const primaryId = nextIds.at(-1) ?? null;
    if (controlledSelectedObjectId === undefined) setLocalSelectedObjectId(primaryId);
    if (controlledSelectedObjectIds === undefined) setLocalSelectedObjectIds(nextIds);
    onSelectedObjectChange?.(primaryId);
    onSelectedObjectIdsChange?.(nextIds);
  };

  const selectObjectGroup = (objectIds: readonly string[]) => {
    const next = reconcileWorkspaceGroupSelection(objectIds, objects);
    if (controlledSelectedObjectId === undefined) setLocalSelectedObjectId(next.primaryObjectId);
    if (controlledSelectedObjectIds === undefined) setLocalSelectedObjectIds(next.objectIds);
    onSelectedObjectChange?.(next.primaryObjectId);
    onSelectedObjectIdsChange?.(next.objectIds);
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

  const viewportObjects = useMemo(
    () => view === "e4" ? objects.filter((object) => object.kind !== "dimension") : objects,
    [objects, view],
  );
  const rememberViewportSize = useCallback((size: EditorViewportSize) => {
    setViewportSize((current) => current.width === size.width && current.height === size.height ? current : size);
  }, []);
  const fitView = () => setCamera((current) => fitEditorCameraToBounds(
    current,
    getEditorSceneBounds(viewportObjects, layers, view, e4Overlays,
      componentTemplateViewInstances, resolveComponentTemplateAssetUrl, cables),
    viewportSize,
  ));
  const setZoom = (zoom: number) => setCamera((current) =>
    zoomEditorCameraAt(current, { x: viewportSize.width / 2, y: viewportSize.height / 2 }, zoom));
  const changeZoom = (factor: number) => setCamera((current) =>
    zoomEditorCameraAt(current, { x: viewportSize.width / 2, y: viewportSize.height / 2 }, current.zoom * factor));
  const focusObject = (objectId: string) => {
    selectObject(objectId);
    const object = objects.find((candidate) => candidate.id === objectId);
    if (!object) return;
    setCamera((current) => ({
      ...current,
      offsetX: viewportSize.width / 2 - (object.x + object.width / 2) * current.zoom,
      offsetY: viewportSize.height / 2 - (object.y + object.height / 2) * current.zoom,
    }));
  };
  const diagnosticOverlay = view === "e4" && diagnostics.length > 0 ? (
    <section className="he-e4-diagnostic-list" aria-label="Ошибки схемы Э4">
      <header><strong>Ошибки</strong><span>{diagnostics.length}</span></header>
      {diagnostics.map((diagnostic) => (
        <button type="button" key={diagnostic.id} onClick={() => focusObject(diagnostic.objectId)}>
          <span aria-hidden="true">!</span>
          <span><strong>{diagnostic.label}</strong><small>{diagnostic.message}</small></span>
        </button>
      ))}
    </section>
  ) : undefined;
  const incompatibleCableIds = view === "drawing"
    ? getVisibleCableSheathScene(cables, viewportObjects, layers).incompatibleCableIds
    : [];
  const cableSheathWarning = incompatibleCableIds.length > 0
    ? `Общая оболочка не показана для ${incompatibleCableIds.length === 1
      ? `кабеля ${incompatibleCableIds[0]}`
      : `кабелей ${incompatibleCableIds.join(", ")}`}: у жил нет однозначного общего участка.`
    : null;

  useEffect(() => {
    if (!revealRequest) return;
    const bounds = getEditorSceneBounds(objects.filter(object => revealRequest.objectIds.includes(object.id)), layers, view);
    if (bounds) setCamera(current => fitEditorCameraToBounds(current, bounds, viewportSize));
  }, [revealRequest]);

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
          zoom={camera.zoom}
          onToolChange={setTool}
          onZoomIn={() => changeZoom(1.2)}
          onZoomOut={() => changeZoom(1 / 1.2)}
          onZoomChange={setZoom}
          onFitView={fitView}
        />
        <CanvasViewport
          view={view}
          tool={tool}
          camera={camera}
          objects={viewportObjects}
          layers={layers}
          selectedObjectId={selectedObjectId}
          selectedObjectIds={selectedObjectIds}
          highlightedObjectIds={highlightedObjectIds}
          cables={cables}
          e4Overlays={e4Overlays}
          componentTemplateViewInstances={componentTemplateViewInstances}
          resolveComponentTemplateAssetUrl={resolveComponentTemplateAssetUrl}
          overlay={e4WireMenu}
          diagnosticOverlay={diagnosticOverlay}
          onCameraChange={setCamera}
          onViewportSizeChange={rememberViewportSize}
          onObjectSelect={selectObject}
          onObjectGroupSelect={selectObjectGroup}
          onObjectMove={onObjectMove}
          onDrawingMove={onDrawingMove}
          onObjectMovePreview={onObjectMovePreview}
          onObjectEditRequest={onObjectEditRequest}
          onWireConnect={onWireConnect}
          onWireReconnect={onWireReconnect}
          onWireConnectToWire={onWireConnectToWire}
          onWireReconnectToWire={onWireReconnectToWire}
          onE4WireSegmentMove={onE4WireSegmentMove}
          onE4WireRoutePointRemove={onE4WireRoutePointRemove}
          onE4WireLabelPositionChange={onE4WireLabelPositionChange}
          onE4ScreenPositionChange={onE4ScreenPositionChange}
          onWireToolRequest={() => setTool("wire")}
          onWireRoutePointMove={onWireRoutePointMove}
          onWireRoutePointRemove={onWireRoutePointRemove}
          onCanvasDoubleClick={onCanvasDoubleClick}
          onCatalogDrop={droppedCatalogItem}
          inlineEditor={canvasEditor}
        />
        {(previewMessage || cableSheathWarning) && <div className="he-routing-preview-error" role="status">
          {previewMessage || cableSheathWarning}
        </div>}

        <aside className="he-right-panel" aria-label="Настройки редактора">
          <div className="he-inspector-tabs" role="tablist" aria-label="Панель объекта">
            <button type="button" role="tab" aria-selected={inspectorTab === "properties"} className={inspectorTab === "properties" ? "active" : ""} onClick={() => setInspectorTab("properties")}>Свойства</button>
            <button type="button" role="tab" aria-selected={inspectorTab === "layers"} className={inspectorTab === "layers" ? "active" : ""} onClick={() => setInspectorTab("layers")}>Слои <span>{layers.length}</span></button>
          </div>
          <div className="he-inspector-content">
            {relationPanel}
            {inspectorTab === "properties" ? (
              propertyInspector ?? (
                <ObjectInspector
                  view={view}
                  selectedObject={selectedObject}
                  disabled={selectedLayer?.locked === true}
                  onChange={(objectId, patch) => changeObjects(updateEditorObject(objects, objectId, patch))}
                  onWireMaterialClear={onWireMaterialClear}
                  wireStripProfiles={selectedWireStripProfiles}
                  activeWireStripEnd={activeWireStripEnd}
                  onActiveWireStripEndChange={onActiveWireStripEndChange}
                  onWireStripProfileClear={onWireStripProfileClear}
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
