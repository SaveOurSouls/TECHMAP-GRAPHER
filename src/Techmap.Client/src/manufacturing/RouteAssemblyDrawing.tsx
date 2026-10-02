import { useEffect, useMemo, useRef, useState } from "react";
import type { HarnessDesignDocument, Point } from "../editor/model";
import type { EditorCamera, EditorSceneObject } from "../editor/editor-types";
import { fitEditorCameraToBounds, screenToWorld } from "../editor/editor-camera";
import { designToScene } from "../editor/HarnessDesignEditor";
import { drawEditorSceneObject, getEditorSceneBounds, hitTestEditorScene, objectsInPaintOrder, redrawCanvas } from "../editor/CanvasViewport";
import { ComponentTemplateImageCache, type ComponentTemplateViewInstance, type ResolveComponentTemplateAssetUrl } from "../editor/component-template-view-renderer";
import { warmCoveringTextures } from "../editor/covering-renderer";
import type { RouteRow } from "./route-model";
import type { RouteSourceItem, RouteSourceRef } from "./route-source";
import "./route-assembly-drawing.css";

export type AssemblyDrawingPresentation = RouteRow["presentation"];
export type AssemblyDrawingObject = AssemblyDrawingPresentation["objects"][number];
type DrawingObject = NonNullable<AssemblyDrawingPresentation["drawingObjects"]>[number];
export interface RouteAssemblyDrawingProps {
  readonly row: RouteRow; readonly document: HarnessDesignDocument;
  readonly sources?: readonly RouteSourceItem[]; readonly items: readonly RouteSourceItem[];
  readonly componentTemplateViewInstances?: readonly ComponentTemplateViewInstance[];
  readonly resolveComponentTemplateAssetUrl?: ResolveComponentTemplateAssetUrl;
  readonly onSave: (presentation: AssemblyDrawingPresentation) => void; readonly onCancel: () => void;
}
const refKey = (ref: RouteSourceRef): string => `${ref.kind}:${ref.id}`;
const clonePoints = (points: readonly Point[]): Point[] => points.map(point => ({ ...point }));
const clamp = (value: number): number => Math.max(0, Math.min(1, value));
const EMPTY_INSTANCES: readonly ComponentTemplateViewInstance[] = [];
const sceneControls = (object: EditorSceneObject): readonly Point[] => object.pipe?.authoredPoints ?? object.points ?? [{ x: object.x, y: object.y }];

/** Every scene object has a stable ID, including P, OP, shells and annotations. */
export function createAssemblyDrawingDraft(row: RouteRow, document: HarnessDesignDocument, items: readonly RouteSourceItem[]): AssemblyDrawingPresentation {
  const scene = designToScene(document, "drawing");
  const saved = new Map(row.presentation.objects.map(object => [refKey(object.ref), object]));
  const objects = items.map(item => {
    const previous = saved.get(refKey(item.ref));
    const source = scene.find(object => object.id === item.ref.id);
    return { ref: item.ref, hidden: previous?.hidden ?? false, points: clonePoints(previous?.points ?? source?.points ?? (source ? [{ x: source.x, y: source.y }] : [])) };
  });
  const prior = new Map(row.presentation.drawingObjects?.map(object => [object.id, object]) ?? []);
  const drawingObjects = scene.map(object => {
    const previous = prior.get(object.id);
    return { id: object.id, kind: object.kind, layerId: object.layerId, hidden: previous?.hidden ?? false, points: clonePoints(previous?.points ?? sceneControls(object)) };
  });
  return { backgroundOpacity: clamp(row.presentation.backgroundOpacity), objects, drawingObjects };
}
export function assemblyDrawingFragment(presentation: AssemblyDrawingPresentation): AssemblyDrawingPresentation {
  return { backgroundOpacity: presentation.backgroundOpacity, objects: presentation.objects.map(object => ({ ...object, points: clonePoints(object.points) })),
    ...(presentation.drawingObjects ? { drawingObjects: presentation.drawingObjects.map(object => ({ ...object, points: clonePoints(object.points) })) } : {}) };
}
export function setAssemblyDrawingLayerVisibility(states: readonly DrawingObject[], layerId: string, visible: boolean): DrawingObject[] {
  return states.map(state => state.layerId === layerId ? { ...state, hidden: !visible } : state);
}
export function moveAssemblyDrawingObject(states: readonly DrawingObject[], id: string, from: Point, to: Point): DrawingObject[] {
  const dx = to.x - from.x, dy = to.y - from.y;
  return states.map(state => state.id === id ? { ...state, points: state.points.map(point => ({ x: point.x + dx, y: point.y + dy })) } : state);
}
export function assemblyDrawingScene(scene: readonly EditorSceneObject[], states: readonly DrawingObject[]): EditorSceneObject[] {
  const byId = new Map(states.map(state => [state.id, state]));
  return scene.flatMap(object => {
    const state = byId.get(object.id);
    if (!state || state.hidden) return [];
    const source = sceneControls(object);
    if (state.points.length !== source.length || !state.points.some((point, index) => point.x !== source[index]!.x || point.y !== source[index]!.y)) return [object];
    const dx = state.points[0]!.x - source[0]!.x, dy = state.points[0]!.y - source[0]!.y;
    const translate = (point: Point): Point => ({ x: point.x + dx, y: point.y + dy });
    const translated = (points: readonly Point[]): Point[] => points.map(translate);
    if (object.kind === "connector" || object.kind === "physical-node" || object.kind === "physical-covering") {
      let metadata = object.metadata;
      if (object.kind === "physical-covering" && metadata?.surfaces) {
        const surfaces = JSON.parse(metadata.surfaces) as { polygon: Point[]; path: Point[] }[];
        metadata = { ...metadata, surfaces: JSON.stringify(surfaces.map(surface => ({ ...surface, polygon: translated(surface.polygon), path: translated(surface.path) }))) };
      }
      return [{ ...object, x: object.x + dx, y: object.y + dy, metadata,
        ...(object.points ? { points: translated(object.points) } : {}),
        ...(object.paths ? { paths: object.paths.map(translated) } : {}) }];
    }
    if (object.kind === "wire") {
      const displacement = state.points.map((point, index) => ({ x: point.x - source[index]!.x, y: point.y - source[index]!.y }));
      const transform = (point: Point): Point => {
        let nearest = 0, distance = Number.POSITIVE_INFINITY;
        source.forEach((control, index) => { const next = Math.hypot(control.x - point.x, control.y - point.y); if (next < distance) { distance = next; nearest = index; } });
        return { x: point.x + displacement[nearest]!.x, y: point.y + displacement[nearest]!.y };
      };
      return [{ ...object, points: state.points, ...(object.paths ? { paths: object.paths.map(path => path.map(transform)) } : {}),
        ...(object.visibleWireStrokes ? { visibleWireStrokes: object.visibleWireStrokes.map(stroke => ({ ...stroke, points: stroke.points.map(transform) })) } : {}) }];
    }
    return [{ ...object, points: state.points, ...(object.paths ? { paths: object.paths.map(translated) } : {}),
      ...(object.pipe ? { pipe: { ...object.pipe, authoredPoints: state.points, handles: state.points.slice(1, -1), controls: state.points } } : {}) }];
  });
}

export function RouteAssemblyDrawingPreview({ row, document, componentTemplateViewInstances = EMPTY_INSTANCES, resolveComponentTemplateAssetUrl }: Pick<RouteAssemblyDrawingProps, "row" | "document" | "componentTemplateViewInstances" | "resolveComponentTemplateAssetUrl">) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useMemo(() => designToScene(document, "drawing"), [document]);
  const objects = useMemo(() => assemblyDrawingScene(scene, row.presentation.drawingObjects ?? []), [scene, row.presentation.drawingObjects]);
  const layers = useMemo(() => document.views.drawing.layers.map(layer => ({ id: layer.id, label: layer.name, visible: true, locked: true })), [document]);
  const cache = useRef(new ComponentTemplateImageCache());
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const draw = () => {
      const ratio = window.devicePixelRatio || 1, width = Math.max(1, element.clientWidth), height = Math.max(1, element.clientHeight);
      element.width = Math.round(width * ratio); element.height = Math.round(height * ratio);
      const context = element.getContext("2d"); if (!context) return;
      context.setTransform(ratio, 0, 0, ratio, 0, 0); context.clearRect(0, 0, width, height);
      const camera = fitEditorCameraToBounds({ offsetX: 0, offsetY: 0, zoom: 1 },
        getEditorSceneBounds(objects, layers, "drawing", undefined, componentTemplateViewInstances, resolveComponentTemplateAssetUrl, document.cables), { width, height }, 20);
      context.save(); context.translate(camera.offsetX, camera.offsetY); context.scale(camera.zoom, camera.zoom);
      const instances = new Map(componentTemplateViewInstances.map(instance => [instance.objectId, instance]));
      for (const object of objectsInPaintOrder(objects, layers, "drawing")) drawEditorSceneObject(context, object, false, "drawing", instances.get(object.id), resolveComponentTemplateAssetUrl, cache.current);
      context.restore();
    };
    cache.current.setInvalidate(draw);
    draw(); const stopTextures = warmCoveringTextures(draw, objects); const observer = new ResizeObserver(draw); observer.observe(element); return () => { observer.disconnect(); stopTextures(); cache.current.setInvalidate(null); };
  }, [objects, layers, componentTemplateViewInstances, resolveComponentTemplateAssetUrl, document]);
  return <canvas ref={canvas} className="route-assembly-drawing__preview" role="img" aria-label={`Фрагмент сборки ${row.title}`} />;
}

export function RouteAssemblyDrawing({ row, document, items, componentTemplateViewInstances = EMPTY_INSTANCES, resolveComponentTemplateAssetUrl, onSave, onCancel }: RouteAssemblyDrawingProps) {
  const scene = useMemo(() => designToScene(document, "drawing"), [document]);
  const [presentation, setPresentation] = useState<AssemblyDrawingPresentation>(() => createAssemblyDrawingDraft(row, document, items));
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [camera, setCamera] = useState<EditorCamera>({ offsetX: 0, offsetY: 0, zoom: 1 });
  const frame = useRef<HTMLDivElement>(null), backgroundCanvas = useRef<HTMLCanvasElement>(null), foregroundCanvas = useRef<HTMLCanvasElement>(null);
  const imageCache = useRef(new ComponentTemplateImageCache());
  const drag = useRef<{ id: string; index: number; pointerId: number; start?: Point } | null>(null);
  const states = presentation.drawingObjects ?? [];
  const stateById = useMemo(() => new Map(states.map(state => [state.id, state])), [states]);
  const sceneById = useMemo(() => new Map(scene.map(object => [object.id, object])), [scene]);
  const layers = useMemo(() => document.views.drawing.layers.map(layer => ({ id: layer.id, label: layer.name, visible: true, locked: false })), [document]);
  const background = scene.filter(object => layers.some(layer => layer.id === object.layerId && layer.visible));
  const foreground = assemblyDrawingScene(scene, states).filter(object => layers.some(layer => layer.id === object.layerId && layer.visible));
  const selectedObject = foreground.find(object => object.id === selected), selectedState = selected ? stateById.get(selected) : undefined;
  const choose = (id: string, additive: boolean) => {
    setSelected(id);
    setSelectedIds(current => additive ? (() => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; })() : new Set([id]));
  };
  const named = (object: EditorSceneObject) => object.kind === "physical-segment" ? `${object.pipe?.role === "joining-pipe" ? "ОП" : "П"} · ${object.label}` : object.kind === "physical-covering" ? `Оболочка · ${object.label}` : object.label || object.kind;
  useEffect(() => {
    const element = frame.current; if (!element) return;
    const fit = () => setCamera(current => fitEditorCameraToBounds(current, getEditorSceneBounds(scene, layers, "drawing", undefined, componentTemplateViewInstances, resolveComponentTemplateAssetUrl, document.cables), { width: element.clientWidth, height: element.clientHeight }, 42));
    fit(); const observer = new ResizeObserver(fit); observer.observe(element); return () => observer.disconnect();
  }, [scene, document, componentTemplateViewInstances, resolveComponentTemplateAssetUrl]);
  useEffect(() => {
    if (!backgroundCanvas.current || !foregroundCanvas.current) return;
    const canvas = foregroundCanvas.current, context = canvas.getContext("2d");
    if (!context) return;
    const draw = () => {
      redrawCanvas(backgroundCanvas.current!, "drawing", camera, background, layers, new Set(), document.cables, undefined, undefined, componentTemplateViewInstances, resolveComponentTemplateAssetUrl);
      const ratio = window.devicePixelRatio || 1, width = Math.max(1, Math.round(canvas.clientWidth)), height = Math.max(1, Math.round(canvas.clientHeight));
      canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0); context.clearRect(0, 0, width, height);
      context.save(); context.translate(camera.offsetX, camera.offsetY); context.scale(camera.zoom, camera.zoom);
      const instances = new Map(componentTemplateViewInstances.map(instance => [instance.objectId, instance]));
      for (const object of objectsInPaintOrder(foreground, layers, "drawing")) drawEditorSceneObject(context, object, selected === object.id, "drawing", instances.get(object.id), resolveComponentTemplateAssetUrl, imageCache.current);
      context.restore();
    };
    imageCache.current.setInvalidate(draw); draw();
    const stopTextures = warmCoveringTextures(draw, foreground);
    return () => { stopTextures(); imageCache.current.setInvalidate(null); };
  }, [background, foreground, layers, camera, selected, document, componentTemplateViewInstances, resolveComponentTemplateAssetUrl]);
  const updateState = (id: string, update: (state: DrawingObject) => DrawingObject) => setPresentation(current => ({ ...current, drawingObjects: current.drawingObjects?.map(state => state.id === id ? update(state) : state) }));
  const localPoint = (event: React.PointerEvent<HTMLDivElement>): Point => {
    const rect = frame.current!.getBoundingClientRect(); return screenToWorld(camera, { x: event.clientX - rect.left, y: event.clientY - rect.top });
  };
  return <section className="route-assembly-drawing" aria-label={`Рисунок сборки ${row.title}`}>
    <header className="route-assembly-drawing__header"><div><p className="route-assembly-drawing__eyebrow">КОПИЯ ЧЕРТЕЖА СБОРКИ</p><h3>{row.title}</h3><p>Геометрия и видимость сохраняются в рисунке этапа. Исходный чертёж и длины остаются прежними.</p></div><div className="route-assembly-drawing__actions"><button type="button" className="secondary-action" onClick={onCancel}>Отмена</button><button type="button" className="primary-action" onClick={() => onSave(assemblyDrawingFragment(presentation))}>Сохранить фрагмент</button></div></header>
    <div className="route-assembly-drawing__toolbar"><label>Фон жгута <output>{Math.round(presentation.backgroundOpacity * 100)}%</output><input type="range" min={0} max={100} step={1} value={Math.round(presentation.backgroundOpacity * 100)} aria-label="Фон жгута" onChange={event => setPresentation(current => ({ ...current, backgroundOpacity: Number(event.target.value) / 100 }))} /></label><span className="route-assembly-drawing__count">В фрагменте: {states.filter(state => !state.hidden).length} из {states.length}; выбрано {selectedIds.size}</span><button type="button" className="secondary-action" onClick={() => setPresentation(current => ({ ...current, drawingObjects: current.drawingObjects?.map(state => ({ ...state, hidden: false })) }))}>Показать все</button><button type="button" className="secondary-action" disabled={!selectedIds.size} onClick={() => setPresentation(current => ({ ...current, drawingObjects: current.drawingObjects?.map(state => ({ ...state, hidden: !selectedIds.has(state.id) })) }))}>Изолировать выбранное</button></div>
    <div className="route-assembly-drawing__workspace"><aside className="route-assembly-drawing__objects" aria-label="Объекты чертежа"><h4>Слои и объекты</h4>{document.views.drawing.layers.map(layer => <section key={layer.id} className="route-assembly-drawing__layer"><label><input type="checkbox" checked={states.filter(state => state.layerId === layer.id).every(state => !state.hidden)} onChange={event => setPresentation(current => ({ ...current, drawingObjects: setAssemblyDrawingLayerVisibility(current.drawingObjects ?? [], layer.id, event.target.checked) }))} />{layer.name}</label>{scene.filter(object => object.layerId === layer.id).map(object => { const hidden = stateById.get(object.id)?.hidden ?? true; return <div key={object.id} className={`route-assembly-drawing__object ${selectedIds.has(object.id) ? "is-selected" : ""} ${hidden ? "is-hidden" : ""}`}><button type="button" className="route-assembly-drawing__object-name" aria-pressed={selectedIds.has(object.id)} onClick={event => choose(object.id, event.ctrlKey || event.shiftKey || event.metaKey)}><span>{named(object)}</span><small>{hidden ? "Скрыто" : "В фрагменте"}</small></button><button type="button" className="icon-action" aria-label={`${hidden ? "Показать" : "Скрыть"} ${named(object)}`} onClick={() => updateState(object.id, current => ({ ...current, hidden: !current.hidden }))}>{hidden ? "◉" : "◌"}</button></div>; })}</section>)}</aside>
      <div ref={frame} className="route-assembly-drawing__viewport" role="img" aria-label="Копия чертежа сборки" onPointerDown={event => {
        const point = localPoint(event);
        if (selectedObject && selectedState) { const index = selectedState.points.findIndex(control => Math.hypot(control.x - point.x, control.y - point.y) <= 9 / camera.zoom); if (index >= 0) { drag.current = { id: selectedObject.id, index, pointerId: event.pointerId, start: point }; event.currentTarget.setPointerCapture(event.pointerId); return; } }
        const hit = hitTestEditorScene(foreground, layers, point, camera.zoom, "drawing", componentTemplateViewInstances, resolveComponentTemplateAssetUrl)
          ?? hitTestEditorScene(scene, layers, point, camera.zoom, "drawing", componentTemplateViewInstances, resolveComponentTemplateAssetUrl);
        if (hit && hit === selected && sceneById.get(hit)?.kind === "physical-covering" && !stateById.get(hit)?.hidden) { drag.current = { id: hit, index: 0, pointerId: event.pointerId, start: point }; event.currentTarget.setPointerCapture(event.pointerId); return; }
        if (hit) { choose(hit, event.ctrlKey || event.shiftKey || event.metaKey); updateState(hit, state => ({ ...state, hidden: false })); }
      }} onPointerMove={event => { const active = drag.current; if (active?.pointerId !== event.pointerId) return; const point = localPoint(event); if (sceneById.get(active.id)?.kind === "physical-covering") { const previous = active.start!; setPresentation(current => ({ ...current, drawingObjects: moveAssemblyDrawingObject(current.drawingObjects ?? [], active.id, previous, point) })); drag.current = { ...active, start: point }; } else updateState(active.id, state => ({ ...state, points: state.points.map((value, index) => index === active.index ? point : value) })); }} onPointerUp={event => { if (drag.current?.pointerId === event.pointerId) { drag.current = null; event.currentTarget.releasePointerCapture(event.pointerId); } }} onPointerCancel={() => { drag.current = null; }}>
        <canvas ref={backgroundCanvas} className="route-assembly-drawing__viewport-canvas route-assembly-drawing__viewport-background" style={{ opacity: presentation.backgroundOpacity }} aria-hidden="true" /><canvas ref={foregroundCanvas} className="route-assembly-drawing__viewport-canvas" aria-hidden="true" />
        {selectedObject && selectedState && !selectedState.hidden && <svg className="route-assembly-drawing__handles" aria-hidden="true">{selectedState.points.map((point, index) => <circle key={index} cx={point.x * camera.zoom + camera.offsetX} cy={point.y * camera.zoom + camera.offsetY} r={5} />)}</svg>}
      </div></div><p className="route-assembly-drawing__hint">Выберите объект на чертеже или в слое. П/ОП и оболочки выбираются поверх проводов; ручки выбранной геометрии можно перемещать.</p>
  </section>;
}
