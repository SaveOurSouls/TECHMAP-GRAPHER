import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { LocalSession } from "../local-session";
import type { RuntimeConfig } from "../runtime-config";
import type { HarnessDesignDocument } from "../editor/model";
import type { EditorSceneObject } from "../editor/editor-types";
import { designToScene, HarnessDesignEditor } from "../editor/HarnessDesignEditor";
import { createHarnessDesignApi } from "../editor/design-api";
import { useCoveringAssets } from "../editor/covering-assets";
import { buildRouteSourceItems, type RouteSourceRef } from "../manufacturing/route-source";
import { createIndependentIsolatedDocument, createRouteDrawingCopy } from "../manufacturing/route-drawing-copy";
import { RouteAssemblyDrawing, RouteAssemblyDrawingPreview } from "../manufacturing/RouteAssemblyDrawing";
import type { RouteRow } from "../manufacturing/route-model";
import { RouteV2SourceArtwork } from "../manufacturing-v2/RouteV2Artwork";
import { HarnessSectionNavigation, type HarnessSectionId } from "../editor/HarnessSectionNavigation";
import { appendRouteV3Fragment, captureRouteV3Selection, createInitialRouteV3, fragmentDrawingCopy, generateRouteV3, parseRouteV3, refKey, removeRouteV3Fragment, revealedRouteV3Ids, routeV3StorageKey, type RouteV3Document, type RouteV3Fragment, type RouteV3Node } from "./route-v3-model";
import { RouteV3Graph } from "./RouteV3Graph";
import { editableRouteV3, refreshRouteV3 } from "./route-v3-graph";
import "../manufacturing-v2/route-v2.css";
import "./route-v3.css";

type Props = { config: RuntimeConfig; session: LocalSession; projectId: string; harnessId: string; onClose?: () => void; onSectionChange?: (section: HarnessSectionId) => void | Promise<void> };
function fragmentRow(fragment: RouteV3Fragment): RouteRow {
  return { id: fragment.id, kind: "assembly", title: fragment.title, sourceObjects: fragment.refs, dependsOn: [], comment: "", operations: [], prepared: false, presentation: { objects: [], backgroundOpacity: fragment.backgroundOpacity, drawingCopy: fragment.drawingCopy, isolatedDrawingCopy: fragment.isolatedDrawingCopy } };
}
function Dialog({ label, onClose, children, editor = false }: { label: string; onClose: () => void; children: ReactNode; editor?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); return () => ref.current?.close(); }, []);
  return <dialog ref={ref} className={editor ? "route-v3-dialog editor" : "route-v3-dialog"} aria-label={label} onCancel={event => { event.preventDefault(); onClose(); }}>{children}</dialog>;
}
export function RouteV3Panel(props: Props) {
  const { config, session, projectId, harnessId } = props;
  const api = useMemo(() => createHarnessDesignApi(config, session), [config, session]);
  const [loaded, setLoaded] = useState<{ source: HarnessDesignDocument; route: RouteV3Document } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false; setLoaded(null); setError(null);
    void api.get(projectId, harnessId).then(resource => {
      if (cancelled) return;
      const raw = window.localStorage.getItem(routeV3StorageKey(projectId, harnessId));
      const route = raw === null ? createInitialRouteV3(resource.content) : parseRouteV3(JSON.parse(raw));
      if (!route) throw new Error("Сохранённый Маршрут v3 повреждён. Данные браузера сохранены без изменений.");
      setLoaded({ source: resource.content, route });
    }).catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : "Не удалось открыть Маршрут v3."); });
    return () => { cancelled = true; };
  }, [api, projectId, harnessId]);
  if (!loaded) return <section className="route-v3-panel"><p role={error ? "alert" : "status"}>{error ?? "Загружаем Маршрут v3…"}</p><button onClick={props.onClose}>К проектам</button></section>;
  return <Workspace key={`${projectId}:${harnessId}`} {...props} source={loaded.source} initial={loaded.route} />;
}

function Workspace({ source, initial, config, session, projectId, harnessId, onClose, onSectionChange }: Props & { source: HarnessDesignDocument; initial: RouteV3Document }) {
  const [route, setRoute] = useState(initial);
  const current = useRef(route); current.current = route;
  const [graphical, setGraphical] = useState(false);
  const [openedOnce, setOpenedOnce] = useState(false);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<RouteV3Fragment | null>(null);
  const [drawingNode, setDrawingNode] = useState<RouteV3Node | null>(null);
  const [preview, setPreview] = useState<RouteV3Node | null>(null);
  const sources = useMemo(() => buildRouteSourceItems(source), [source]);
  const sourceScene = useMemo(() => designToScene(source, "drawing"), [source]);
  const revealed = useMemo(() => revealedRouteV3Ids(route), [route.fragments]);
  const hidden = useMemo(() => sourceScene.filter(object => !revealed.includes(object.id)).map(object => object.id), [sourceScene, revealed]);
  const textureIds = source.drawingDocuments?.coveringLibrary?.textures.map(texture => texture.sha256).join(",") ?? "";
  const textures = useCoveringAssets(config, session, projectId, !!textureIds, textureIds);
  const persist = (next: RouteV3Document) => {
    try { window.localStorage.setItem(routeV3StorageKey(projectId, harnessId), JSON.stringify(next)); current.current = next; setRoute(next); setError(null); }
    catch { const message = "Не удалось сохранить Маршрут v3 в браузере. Освободите место и повторите сохранение."; setError(message); throw new Error(message); }
  };
  const newFragment = (document: HarnessDesignDocument, ids: readonly string[], scene: readonly EditorSceneObject[], isolate: boolean): RouteV3Fragment => {
    const selection = captureRouteV3Selection(document, scene, ids);
    if (!selection.objectIds.length) throw new Error("Выберите объекты для слепка.");
    let isolatedDrawingCopy;
    if (isolate) {
      const isolated = createIndependentIsolatedDocument(document, scene, selection.objectIds);
      if (!isolated) throw new Error("Для изоляции выберите провода или соединители. Оболочки и графику можно сохранить как слепок.");
      isolatedDrawingCopy = createRouteDrawingCopy(isolated);
    }
    return { ...selection, id: crypto.randomUUID(), title: title.trim() || `Полуфабрикат ${current.current.fragments.length + 1}`, createdAt: new Date().toISOString(), mode: isolate ? "isolated" : "source", backgroundOpacity: isolate ? 0 : current.current.backgroundOpacity, ...(isolatedDrawingCopy ? { isolatedDrawingCopy } : {}) };
  };
  const saveSelection = (document: HarnessDesignDocument, ids: readonly string[], scene: readonly EditorSceneObject[]) => {
    try { persist(appendRouteV3Fragment(current.current, newFragment(document, ids, scene, false))); setTitle(""); }
    catch (e) { setError(e instanceof Error ? e.message : "Не удалось сохранить слепок."); }
  };
  const localCopy = {
    initialDocument: source, hiddenObjectIds: hidden, backgroundOpacity: route.backgroundOpacity,
    captureSelection: true, revealedObjectIds: revealed,
    onSave: () => undefined, onObjectsSave: saveSelection,
    onIsolateObjects: (document: HarnessDesignDocument, ids: readonly string[], scene?: readonly EditorSceneObject[]) => {
      try { setEditing(newFragment(document, ids, scene ?? sourceScene, true)); }
      catch (e) { setError(e instanceof Error ? e.message : "Не удалось изолировать."); }
      // The modal owns its isolated editor. The main canvas and history stay mounted.
      return null;
    },
    onBackgroundOpacityChange: (opacity: number) => { try { persist({ ...current.current, backgroundOpacity: opacity }); } catch { /* error stays visible */ } },
    onCancel: () => setGraphical(false),
  };
  const openGraphical = () => { setOpenedOnce(true); setGraphical(true); };
  const generate = () => { if (current.current.graphEdited && !window.confirm("Пересоздать маршрут из слепков? Ручные карточки, связи, размеры и операции будут заменены.")) return; try { persist(generateRouteV3(current.current, source, sourceScene.map(object => object.id))); setGraphical(false); } catch (e) { setError(e instanceof Error ? e.message : "Не удалось сгенерировать маршрут."); } };
  const showFragment = (fragment: RouteV3Fragment) => <RouteAssemblyDrawingPreview row={{ ...fragmentRow(fragment), presentation: { objects: [], backgroundOpacity: 0, drawingCopy: fragmentDrawingCopy(fragment) } }} document={source} config={config} session={session} projectId={projectId} />;
  const artwork = (ref: RouteSourceRef) => <RouteV2SourceArtwork document={source} ref={ref} item={sources.find(item => refKey(item.ref) === refKey(ref))} textureUrls={textures.urls} />;
  const finalRow: RouteRow = { id: "final", kind: "assembly", title: "Готовый жгут", sourceObjects: sources.map(item => item.ref), dependsOn: [], comment: "", operations: [], prepared: false, presentation: { backgroundOpacity: 0, objects: [], drawingCopy: createRouteDrawingCopy(source) } };
  const board = useMemo(() => refreshRouteV3(editableRouteV3(route.nodes.length || route.graphEdited ? route : { ...route, nodes: generateRouteV3({ ...route, fragments: [] }).nodes })), [route]);
  const nodeArtwork = (node: RouteV3Node): ReactNode => {
    if (node.drawing) return <RouteAssemblyDrawingPreview row={{ ...finalRow, title: node.title, sourceObjects: node.refs, presentation: { objects: [], ...node.drawing } }} document={source} config={config} session={session} projectId={projectId} />;
    const keys = new Set(node.refs.map(refKey));
    const fragments = route.fragments.filter(f => node.fragmentIds.includes(f.id) && f.refs.every(ref => keys.has(refKey(ref))));
    const covered = new Set(fragments.flatMap(f => f.refs.map(refKey)));
    if (node.kind === "final" && sources.every(s => keys.has(refKey(s.ref)))) return <RouteAssemblyDrawingPreview row={finalRow} document={source} config={config} session={session} projectId={projectId} />;
    // Keep a saved PF image when passing its full result through a dependency.
    const pictures: RouteV3Node[] = [], visited = new Set<string>();
    const collectPictures = (target: RouteV3Node) => {
      for (const edge of board.edges.filter(e => e.to === target.id && target.inputNodeIds?.includes(e.from))) {
        if (visited.has(edge.from)) continue;
        visited.add(edge.from);
        const input = board.nodes.find(n => n.id === edge.from)!;
        if (!input.refs.length || !input.refs.every(r => keys.has(refKey(r))) || !input.refs.some(r => !covered.has(refKey(r)))) continue;
        if (input.drawing || input.fragmentIds.length) { pictures.push(input); for (const ref of input.refs) covered.add(refKey(ref)); }
        else collectPictures(input);
      }
    };
    collectPictures(node);
    return <>{fragments.map(f => <div key={f.id}>{showFragment(f)}</div>)}{pictures.map(n => <div key={n.id}>{nodeArtwork(n)}<small>{n.title}</small></div>)}{node.refs.filter(ref => !covered.has(refKey(ref))).map(ref => <div key={refKey(ref)}>{artwork(ref)}<small>{sources.find(s => refKey(s.ref) === refKey(ref))?.title ?? ref.id}</small></div>)}</>;
  };
  const editNodeDrawing = (node: RouteV3Node) => {
    const fragment = route.fragments.find(f => node.fragmentIds.includes(f.id));
    setDrawingNode({ ...node, drawing: node.drawing ?? (fragment ? { backgroundOpacity: fragment.backgroundOpacity, drawingCopy: fragment.drawingCopy, isolatedDrawingCopy: fragment.isolatedDrawingCopy } : { backgroundOpacity: 0, drawingCopy: captureRouteV3Selection(source, sourceScene, node.refs.map(ref => ref.id)).drawingCopy }) });
  };
  return <section className="route-v3-panel" aria-label="Маршрут v3">
    <HarnessSectionNavigation active="route-v3" onHome={onClose} onNavigate={section => onSectionChange?.(section)} />
    <header className="route-v3-header"><div><p className="eyebrow">{graphical ? "СЛЕПКИ ПОСЛЕДОВАТЕЛЬНОСТИ СБОРКИ" : "ПОСЛЕДОВАТЕЛЬНОСТЬ СБОРКИ"}</p><h2>{graphical ? "Графический маршрут" : "Маршрут v3"}</h2><p>{graphical ? `Раскрыто ${sourceScene.length - hidden.length} из ${sourceScene.length} объектов · слепков ${route.fragments.length}` : route.generated ? "Маршрут построен по составу сохранённых слепков." : "Нарезанные заготовки готовы. Соберите слепки в графическом маршруте."}</p></div><div className="route-v3-actions">{graphical ? <><button className="secondary-action" onClick={() => setGraphical(false)}>К маршруту</button><button className="primary-action" disabled={!route.fragments.length} onClick={generate}>Сгенерировать</button></> : <button className="primary-action" onClick={openGraphical}>Графический маршрут</button>}</div></header>
    {error && <p className="route-v3-error" role="alert">{error}</p>}
    {textures.error && <p role="status">{textures.error}</p>}
    <div hidden={graphical}>
      {!route.generated && route.fragments.length > 0 && <p role="status">Слепки сохранены. Нажмите «Сгенерировать» в графическом маршруте для обновления зависимостей.</p>}
      {route.generated && !route.nodes.some(node => node.kind === "final") && <p role="status">Маршрут частичный: сохраните оставшиеся объекты для финального жгута.</p>}
      <RouteV3Graph graph={board} source={source} save={next => persist({ ...next, graphEdited: true })} artwork={nodeArtwork} preview={setPreview} editDrawing={editNodeDrawing} />
    </div>
    <div hidden={!graphical}>
      {openedOnce && <div className="route-v3-layout"><div className="route-v3-editor"><div className="route-v3-editor-toolbar"><label>Название нового слепка<input value={title} maxLength={120} placeholder="Например, Установка соединителя X1" onChange={event => setTitle(event.target.value)} /></label><span>Выберите объекты кнопками списка или рамкой; ПКМ → «Изолировать» / «Сохранить».</span></div><HarnessDesignEditor config={config} session={session} projectId={projectId} harnessId={harnessId} harnessDesignation="Графический маршрут v3" initialView="drawing" localCopy={localCopy} /></div>
        <aside className="route-v3-gallery-panel" aria-label="Сохранённые слепки"><header><h3>Полуфабрикаты</h3><span>{route.fragments.length}</span></header>{route.fragments.map((fragment, index) => <article className="route-v3-fragment-card" key={fragment.id}><button className="route-v3-fragment-preview" aria-label={`Просмотреть слепок ${fragment.title}`} onClick={() => setPreview({ id: fragment.id, kind: "semiFinished", title: fragment.title, fragmentIds: [fragment.id], refs: fragment.refs, x: 0, y: 0 })}>{showFragment(fragment)}</button><strong>{index + 1}. {fragment.title}</strong><span className="route-v3-fragment-meta">{fragment.mode === "isolated" ? "Изолированный" : "Как на чертеже"} · {fragment.refs.length} комплектующих</span><div className="route-v3-fragment-actions"><button className="link-button" onClick={() => setEditing(fragment)}>Редактировать</button><button className="link-button" onClick={() => { try { persist(removeRouteV3Fragment(current.current, fragment.id)); } catch { /* error visible */ } }}>Удалить</button></div></article>)}{!route.fragments.length && <p className="route-v3-empty">Сохранённые фрагменты появятся здесь. Они станут полуфабрикатами маршрута.</p>}</aside>
      </div>}
    </div>
    {editing && <Dialog label={`Редактор слепка ${editing.title}`} editor onClose={() => setEditing(null)}><div className="route-v2-drawing-host"><RouteAssemblyDrawing key={editing.id} config={config} session={session} projectId={projectId} harnessId={harnessId} document={source} row={fragmentRow(editing)} items={sources.filter(item => editing.refs.some(ref => refKey(ref) === refKey(item.ref)))} onCancel={() => setEditing(null)} onSave={presentation => { persist(appendRouteV3Fragment(current.current, { ...editing, drawingCopy: presentation.drawingCopy ?? editing.drawingCopy, isolatedDrawingCopy: presentation.isolatedDrawingCopy, mode: presentation.isolatedDrawingCopy ? "isolated" : "source", backgroundOpacity: presentation.backgroundOpacity })); setEditing(null); setTitle(""); }} /></div></Dialog>}
    {drawingNode && <Dialog label={`Рисунок карточки ${drawingNode.title}`} editor onClose={() => setDrawingNode(null)}><RouteAssemblyDrawing config={config} session={session} projectId={projectId} harnessId={harnessId} document={source} row={{ ...finalRow, id: drawingNode.id, title: drawingNode.title, sourceObjects: drawingNode.refs, presentation: { objects: [], backgroundOpacity: 0, ...drawingNode.drawing } }} items={sources.filter(s => drawingNode.refs.some(r => refKey(r) === refKey(s.ref)))} onCancel={() => setDrawingNode(null)} onSave={presentation => { persist({ ...board, graphEdited: true, nodes: board.nodes.map(n => n.id === drawingNode.id ? { ...n, drawing: { backgroundOpacity: presentation.backgroundOpacity, drawingCopy: presentation.drawingCopy, isolatedDrawingCopy: presentation.isolatedDrawingCopy } } : n) }); setDrawingNode(null); }} /></Dialog>}
    {preview && <Dialog label={preview.title} onClose={() => setPreview(null)}><header className="route-v3-preview-heading"><h3>{preview.title}</h3><button className="secondary-action" onClick={() => setPreview(null)}>Закрыть</button></header><div className="route-v3-large-preview">{nodeArtwork(preview)}</div><ul className="route-v3-preview-list">{preview.refs.map(ref => <li key={refKey(ref)}>{sources.find(item => refKey(item.ref) === refKey(ref))?.title ?? ref.id}</li>)}</ul></Dialog>}
  </section>;
}
