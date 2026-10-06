import { useEffect, useMemo, useRef, useState } from "react";
import type { HarnessDesignDocument, Point } from "../editor/model";
import type { WireBlankEnd } from "../WireBlankCatalog";
import type { EditorSceneObject } from "../editor/editor-types";
import { fitEditorCameraToBounds } from "../editor/editor-camera";
import { HarnessDesignEditor, designToScene, useLocalCopyTemplateViews } from "../editor/HarnessDesignEditor";
import { drawEditorSceneObject, getEditorSceneBounds, objectsInPaintOrder } from "../editor/CanvasViewport";
import { ComponentTemplateImageCache, type ComponentTemplateViewInstance, type ResolveComponentTemplateAssetUrl } from "../editor/component-template-view-renderer";
import { warmCoveringTextures } from "../editor/covering-renderer";
import type { RouteRow } from "./route-model";
import type { RouteSourceItem, RouteSourceRef } from "./route-source";
import type { RuntimeConfig } from "../runtime-config";
import type { LocalSession } from "../local-session";
import { useCoveringAssets, withCoveringTextureUrls } from "../editor/covering-assets";
import { createIndependentIsolatedDocument, createRouteDrawingCopy, migrateLegacyRouteDrawingCopy, legacyRouteDrawingCopyWarnings, type RouteDrawingCopy } from "./route-drawing-copy";
import "./route-assembly-drawing.css";

export type AssemblyDrawingPresentation = RouteRow["presentation"];
export type AssemblyDrawingObject = AssemblyDrawingPresentation["objects"][number];
type DrawingObject = NonNullable<AssemblyDrawingPresentation["drawingObjects"]>[number];
export interface RouteAssemblyDrawingProps {
  readonly row: RouteRow; readonly document: HarnessDesignDocument;
  readonly config: RuntimeConfig; readonly session: LocalSession; readonly projectId: string; readonly harnessId: string;
  readonly sources?: readonly RouteSourceItem[]; readonly items: readonly RouteSourceItem[];
  readonly componentTemplateViewInstances?: readonly ComponentTemplateViewInstance[];
  readonly resolveComponentTemplateAssetUrl?: ResolveComponentTemplateAssetUrl;
  /** End treatments selected for wires produced by the current semi-finished stage. */
  readonly inheritedEndStyles?: ReadonlyMap<string, Readonly<{ from: WireBlankEnd; to: WireBlankEnd }>>;
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

export function RouteAssemblyDrawingPreview({ row, document: sourceDocument, config, session, projectId, componentTemplateViewInstances = EMPTY_INSTANCES, resolveComponentTemplateAssetUrl }: Pick<RouteAssemblyDrawingProps, "row" | "document" | "config" | "session" | "projectId" | "componentTemplateViewInstances" | "resolveComponentTemplateAssetUrl">) {
  const activeCopy = row.presentation.isolatedDrawingCopy ?? row.presentation.drawingCopy;
  const document = activeCopy?.document ?? sourceDocument;
  const localTemplateViews = useLocalCopyTemplateViews(activeCopy ? document : undefined,
    config, session, projectId, !!activeCopy, componentTemplateViewInstances, resolveComponentTemplateAssetUrl);
  const previewInstances = activeCopy ? localTemplateViews.instances : componentTemplateViewInstances;
  const previewAssetUrl = activeCopy ? localTemplateViews.resolveAssetUrl : resolveComponentTemplateAssetUrl;
  const textures = useCoveringAssets(config, session, projectId, !!document.drawingDocuments?.coveringLibrary?.textures.length, document.drawingDocuments?.coveringLibrary?.textures.map(texture => texture.sha256).join(",") ?? "");
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useMemo(() => withCoveringTextureUrls(designToScene(document, "drawing"), textures.urls).map(object =>
    object.kind === "wire" || object.kind === "physical-segment" || object.kind === "physical-covering"
      ? { ...object, metadata: { ...object.metadata, volumeShading: object.metadata?.volumeShading ?? String(document.drawingDocuments?.volumeShading !== false) } }
      : object), [document, textures.urls]);
  const objects = useMemo(() => {
    if (!activeCopy) return assemblyDrawingScene(scene, row.presentation.drawingObjects ?? []);
    const hidden = new Set(activeCopy.hiddenObjectIds);
    return scene.filter(object => !hidden.has(object.id));
  }, [scene, row.presentation, activeCopy]);
  const layers = useMemo(() => document.views.drawing.layers.map(layer => ({ id: layer.id, label: layer.name, visible: layer.visible, locked: true })), [document]);
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
        getEditorSceneBounds(objects, layers, "drawing", undefined, previewInstances, previewAssetUrl, document.cables), { width, height }, 20);
      context.save(); context.translate(camera.offsetX, camera.offsetY); context.scale(camera.zoom, camera.zoom);
      const instances = new Map(previewInstances.map(instance => [instance.objectId, instance]));
      for (const object of objectsInPaintOrder(objects, layers, "drawing")) drawEditorSceneObject(context, object, false, "drawing", instances.get(object.id), previewAssetUrl, cache.current);
      context.restore();
    };
    cache.current.setInvalidate(draw);
    draw(); const stopTextures = warmCoveringTextures(draw, objects); const observer = new ResizeObserver(draw); observer.observe(element); return () => { observer.disconnect(); stopTextures(); cache.current.setInvalidate(null); };
  }, [objects, layers, previewInstances, previewAssetUrl, document]);
  return <>{localTemplateViews.error && <p role="status">{localTemplateViews.error}</p>}<canvas ref={canvas} className="route-assembly-drawing__preview" role="img" aria-label={`Фрагмент сборки ${row.title}`} /></>;
}

export function RouteAssemblyDrawing({ row, document, config, session, projectId, harnessId, onSave, onCancel, inheritedEndStyles }: RouteAssemblyDrawingProps) {
  type EditorMode = "source" | "isolated";
  type SessionCopies = {
    source: RouteDrawingCopy; isolated: RouteDrawingCopy | null;
    sourceOpacity: number; isolatedOpacity: number;
    legacyWarnings: readonly string[];
  };
  const sessionCopies = useRef<SessionCopies | null>(null);
  if (!sessionCopies.current) {
    const source = row.presentation.drawingCopy
      ? createRouteDrawingCopy(row.presentation.drawingCopy.document, row.presentation.drawingCopy.hiddenObjectIds)
      : migrateLegacyRouteDrawingCopy(document, row.presentation.drawingObjects ?? []);
    const isolated = row.presentation.isolatedDrawingCopy
      ? createRouteDrawingCopy(row.presentation.isolatedDrawingCopy.document, row.presentation.isolatedDrawingCopy.hiddenObjectIds)
      : null;
    sessionCopies.current = {
      source,
      isolated,
      sourceOpacity: row.presentation.backgroundOpacity,
      isolatedOpacity: row.presentation.backgroundOpacity,
      legacyWarnings: row.presentation.drawingCopy ? [] : legacyRouteDrawingCopyWarnings(document, row.presentation.drawingObjects ?? []),
    };
  }
  const copies = sessionCopies.current;
  const [editor, setEditor] = useState(() => ({
    mode: (copies.isolated ? "isolated" : "source") as EditorMode,
    initialCopy: copies.isolated ?? copies.source,
    backgroundOpacity: row.presentation.backgroundOpacity,
  }));
  const { mode, initialCopy } = editor;
  const switchMode = (next: EditorMode) => {
    if (next === mode) return;
    const copy = next === "isolated" ? copies.isolated : copies.source;
    if (copy) setEditor({
      mode: next,
      initialCopy: createRouteDrawingCopy(copy.document, copy.hiddenObjectIds),
      backgroundOpacity: next === "isolated" ? copies.isolatedOpacity : copies.sourceOpacity,
    });
  };
  const latestRowRef = useRef(row);
  latestRowRef.current = row;
  const latestSaveRef = useRef(onSave);
  latestSaveRef.current = onSave;
  const latestCancelRef = useRef(onCancel);
  latestCancelRef.current = onCancel;
  const latestEndStylesRef = useRef(inheritedEndStyles);
  latestEndStylesRef.current = inheritedEndStyles;

  // Polling supplies fresh row/document objects. Only an explicit mode switch
  // changes the editor's initial document; draft notifications never feed it
  // back, so history and asynchronously loaded connector artwork stay intact.
  const legacyWarnings = mode === "source" ? copies.legacyWarnings : [];
  const localCopy = useMemo(() => ({
    initialDocument: initialCopy.document,
    hiddenObjectIds: initialCopy.hiddenObjectIds,
    backgroundOpacity: editor.backgroundOpacity,
    allowCleanSave: mode === "isolated",
    onDraftChange: (copy: HarnessDesignDocument, hiddenObjectIds: readonly string[], backgroundOpacity: number) => {
      const draft = createRouteDrawingCopy(copy, hiddenObjectIds);
      if (mode === "isolated") {
        copies.isolated = draft;
        copies.isolatedOpacity = backgroundOpacity;
      } else {
        copies.source = draft;
        copies.sourceOpacity = backgroundOpacity;
      }
    },
    onSave: (copy: HarnessDesignDocument, hiddenObjectIds: readonly string[], backgroundOpacity: number) => {
      const latestPresentation = latestRowRef.current.presentation;
      const sourceCopy = mode === "source"
        ? createRouteDrawingCopy(copy, hiddenObjectIds)
        : copies.source;
      const isolatedCopy = mode === "isolated"
        ? createRouteDrawingCopy(copy, hiddenObjectIds)
        : copies.isolated ?? latestPresentation.isolatedDrawingCopy;
      latestSaveRef.current({
        ...latestPresentation,
        backgroundOpacity,
        drawingCopy: sourceCopy,
        ...(isolatedCopy ? { isolatedDrawingCopy: isolatedCopy } : {}),
      });
    },
    onIsolateObjects: (copy: HarnessDesignDocument, objectIds: readonly string[], actualScene?: readonly EditorSceneObject[]) => {
      if (mode === "source") copies.source = createRouteDrawingCopy(copy, copies.source.hiddenObjectIds);
      const isolated = createIndependentIsolatedDocument(copy, actualScene ?? designToScene(copy, "drawing"), objectIds, latestEndStylesRef.current);
      if (isolated) {
        copies.isolated = createRouteDrawingCopy(isolated);
        copies.isolatedOpacity = 0;
        switchMode("isolated");
      }
      return isolated;
    },
    onCancel: () => latestCancelRef.current(),
  }), [copies, editor]);
  return <section className="route-full-drawing" aria-label={`Копия чертежа этапа ${row.title}`}>
    <div className="route-fragment-mode" role="group" aria-label="Версия фрагмента">
      <span>Версия</span>
      <button type="button" className={mode === "source" ? "active" : ""} aria-pressed={mode === "source"} onClick={() => switchMode("source")}>Исходная копия</button>
      <button type="button" className={mode === "isolated" ? "active" : ""} aria-pressed={mode === "isolated"} disabled={!copies.isolated} onClick={() => switchMode("isolated")}>Изолированный фрагмент</button>
    </div>
    {legacyWarnings.length > 0 && <p className="route-full-drawing__migration" role="status">Старый рисунок: расположение {legacyWarnings.length} объектов восстановлено из чертежа. Проверьте их положение перед сохранением. Отмена сохранит прежний рисунок.</p>}
    <HarnessDesignEditor config={config} session={session} projectId={projectId} harnessId={harnessId}
      key={mode} harnessDesignation={row.title} initialView="drawing" localCopy={localCopy} />
  </section>;
}
