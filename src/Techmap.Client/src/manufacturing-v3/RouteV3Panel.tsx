import { WirePreparationDialog, useWirePreparationCatalogs } from "./WirePreparationDialog";
import { applyWirePreparation, wirePreparationAssignments } from "./route-v3-wire-preparation";
import { wirePreparationReady } from "../WirePreparationCatalog";
import { buildRouteV3SourceItems } from './route-v3-wire-terminals';
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { LocalSession } from "../local-session";
import type { RuntimeConfig } from "../runtime-config";
import type { HarnessDesignDocument } from "../editor/model";
import type { EditorSceneObject } from "../editor/editor-types";
import { designToScene, HarnessDesignEditor } from "../editor/HarnessDesignEditor";
import { createHarnessDesignApi } from "../editor/design-api";
import { useCoveringAssets } from "../editor/covering-assets";
import { type RouteSourceRef } from "../manufacturing/route-source";
import { createIndependentIsolatedDocument, createRouteDrawingCopy } from "../manufacturing/route-drawing-copy";
import { RouteAssemblyDrawing, RouteAssemblyDrawingPreview } from "../manufacturing/RouteAssemblyDrawing";
import type { RouteRow } from "../manufacturing/route-model";
import { RouteV3WireArtworkPreview } from "./route-v3-wire-artwork";
import { HarnessSectionNavigation, type HarnessSectionId } from "../editor/HarnessSectionNavigation";
import { appendRouteV3Fragment, applyRouteV3SourceRefresh, captureRouteV3Selection, createInitialRouteV3, fragmentDrawingCopy, generateRouteV3, parseRouteV3, previewRouteV3SourceRefresh, refKey, removeRouteV3Fragment, resolveRouteV3SourceDivergence, revealedRouteV3Ids, routeV3StorageKey, routeV3WireArtworkOverride, type RouteV3Document, type RouteV3Fragment, type RouteV3Node } from "./route-v3-model";
import { RouteV3Graph } from "./RouteV3Graph";
import { editableRouteV3, refreshRouteV3 } from "./route-v3-graph";
import "../manufacturing/route-card.css";
import "./route-v3.css";
import { syncRouteV3TerminationOperations } from './route-v3-model';
import { RouteV3SourceArtwork } from './route-v3-termination-artwork';

type Props = { config: RuntimeConfig; session: LocalSession; projectId: string; harnessId: string; onClose?: () => void; onSectionChange?: (section: HarnessSectionId) => void | Promise<void> };
function fragmentRow(fragment: RouteV3Fragment): RouteRow {
  return { id: fragment.id, kind: "assembly", title: fragment.title, sourceObjects: fragment.refs, dependsOn: [], comment: "", operations: [], prepared: false, presentation: { objects: [], backgroundOpacity: fragment.backgroundOpacity, drawingCopy: fragment.drawingCopy, isolatedDrawingCopy: fragment.isolatedDrawingCopy } };
}
function Dialog({ label, onClose, children, editor = false }: { label: string; onClose: () => void; children: ReactNode; editor?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); return () => ref.current?.close(); }, []);
  return <dialog ref={ref} className={editor ? "route-v3-dialog editor" : "route-v3-dialog"} aria-label={label} onCancel={event => { event.preventDefault(); onClose(); }}>{children}</dialog>;
}
function ArtworkTile({ children, zoomEnabled = false }: { children: ReactNode; zoomEnabled?: boolean }) {
  const [zoomed, setZoomed] = useState(false);
  return <div className={`route-v3-artwork-tile${zoomEnabled ? " can-zoom" : ""}${zoomed ? " zoomed" : ""}`}
    role={zoomEnabled ? "button" : undefined} tabIndex={zoomEnabled ? 0 : undefined}
    aria-label={zoomEnabled ? zoomed ? "Уменьшить рисунок и подпись" : "Увеличить рисунок и подпись" : undefined}
    aria-pressed={zoomEnabled ? zoomed : undefined}
    onClick={zoomEnabled ? () => setZoomed(value => !value) : undefined}
    onKeyDown={zoomEnabled ? event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setZoomed(value => !value); } } : undefined}>{children}</div>;
}
export function RouteV3Panel(props: Props) {
  const { config, session, projectId, harnessId } = props;
  const api = useMemo(() => createHarnessDesignApi(config, session), [config, session]);
  const [loaded, setLoaded] = useState<{ source: HarnessDesignDocument; route: RouteV3Document; harnessQuantity: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false; setLoaded(null); setError(null);
    void api.get(projectId, harnessId).then(resource => {
      if (cancelled) return;
      const raw = window.localStorage.getItem(routeV3StorageKey(projectId, harnessId));
      const route = raw === null ? createInitialRouteV3(resource.content, resource.harnessQuantity ?? 1) : parseRouteV3(JSON.parse(raw));
      if (!route) throw new Error("Сохранённый Маршрут v3 повреждён. Данные браузера сохранены без изменений.");
      setLoaded({ source: resource.content, route, harnessQuantity: resource.harnessQuantity ?? 1 });
    }).catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : "Не удалось открыть Маршрут v3."); });
    return () => { cancelled = true; };
  }, [api, projectId, harnessId]);
  if (!loaded) return <section className="route-v3-panel"><p role={error ? "alert" : "status"}>{error ?? "Загружаем Маршрут v3…"}</p><button onClick={props.onClose}>К проектам</button></section>;
  return <Workspace key={`${projectId}:${harnessId}`} {...props} source={loaded.source} initial={loaded.route} harnessQuantity={loaded.harnessQuantity} />;
}

function Workspace({ source, initial, harnessQuantity, config, session, projectId, harnessId, onClose, onSectionChange }: Props & { source: HarnessDesignDocument; initial: RouteV3Document; harnessQuantity: number }) {
  const [route, setRoute] = useState(initial);
  const current = useRef(route); current.current = route;
  const [graphical, setGraphical] = useState(false);
  const [openedOnce, setOpenedOnce] = useState(false);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<RouteV3Fragment | null>(null);
  const [drawingNode, setDrawingNode] = useState<RouteV3Node | null>(null);
  const [preview, setPreview] = useState<RouteV3Node | null>(null);
  const [preparationOpen, setPreparationOpen] = useState(false);
  const preparation = useWirePreparationCatalogs(config, session);
  const initializedPreparation = useRef(false);
  const [refreshOpen, setRefreshOpen] = useState(false);
  const sourceRefresh = useMemo(() => previewRouteV3SourceRefresh(route, source, harnessQuantity), [route, source, harnessQuantity]);
  const sources = useMemo(() => buildRouteV3SourceItems(source), [source]);
  const sourceScene = useMemo(() => designToScene(source, "drawing"), [source]);
  const revealed = useMemo(() => revealedRouteV3Ids(route), [route.fragments]);
  const hidden = useMemo(() => sourceScene.filter(object => !revealed.includes(object.id)).map(object => object.id), [sourceScene, revealed]);
  const textureIds = source.drawingDocuments?.coveringLibrary?.textures.map(texture => texture.sha256).join(",") ?? "";
  const textures = useCoveringAssets(config, session, projectId, !!textureIds, textureIds);
  const persist = (next: RouteV3Document) => {
    try { window.localStorage.setItem(routeV3StorageKey(projectId, harnessId), JSON.stringify(next)); current.current = next; setRoute(next); setError(null); }
    catch { const message = "Не удалось сохранить Маршрут v3 в браузере. Освободите место и повторите сохранение."; setError(message); throw new Error(message); }
  };
  useEffect(() => {
    if (!preparation.data || initializedPreparation.current) return;
    initializedPreparation.current = true;
    if (current.current.wirePreparation || current.current.graphEdited) return;
    const assignments = wirePreparationAssignments(current.current, source, preparation.data.blanks);
    // An incomplete default remains visible in the dialog; never invent its operations.
    if (!assignments.some(a => a.schemeId) || assignments.some(a => a.schemeId && !preparation.data!.schemes.some(s => s.id === a.schemeId && wirePreparationReady(s)))) return;
    try { persist(applyWirePreparation(current.current.nodes.length ? current.current : generateRouteV3(current.current, source), assignments, preparation.data.schemes)); }
    catch (e) { setError(e instanceof Error ? e.message : "Не удалось создать заготовки."); }
  }, [preparation.data, source]);
  const applySourceRefresh = () => {
    if (!window.confirm(`Обновить Маршрут v3 по сохранённому Чертежу/Э4? Изменятся исходное сырьё и количества; ${sourceRefresh.divergences.length} расхождений останутся для проверки оператором.`)) return;
    try { let next = syncRouteV3TerminationOperations(applyRouteV3SourceRefresh(current.current, sourceRefresh),source);
      if (next.wirePreparation) next = applyWirePreparation(next, next.wirePreparation.assignments.filter(a => next.preparedRefs.some(r => r.kind === "wire" && r.id === a.wireId)), next.wirePreparation.schemes, true);
      persist(next); setRefreshOpen(true); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Не удалось обновить маршрут."); }
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
  const artwork = (ref: RouteSourceRef) => { const item = sources.find(candidate => refKey(candidate.ref) === refKey(ref)); return ref.kind === "wire" && item ? <RouteV3WireArtworkPreview document={source} item={item} override={routeV3WireArtworkOverride(route, ref.id)} /> : <RouteV3SourceArtwork document={source} ref={ref} item={item} textureUrls={textures.urls} />; };
  const finalRow: RouteRow = { id: "final", kind: "assembly", title: "Готовый жгут", sourceObjects: sources.map(item => item.ref), dependsOn: [], comment: "", operations: [], prepared: false, presentation: { backgroundOpacity: 0, objects: [], drawingCopy: createRouteDrawingCopy(source) } };
  const board = useMemo(() => refreshRouteV3(editableRouteV3(route.nodes.length || route.graphEdited ? route : generateRouteV3({ ...route, fragments: [] },source))), [route,source]);
  const nodeArtwork = (node: RouteV3Node, zoomEnabled = false): ReactNode => {
    if (node.drawing) return <ArtworkTile zoomEnabled={zoomEnabled}><RouteAssemblyDrawingPreview row={{ ...finalRow, title: node.title, sourceObjects: node.refs, presentation: { objects: [], ...node.drawing } }} document={source} config={config} session={session} projectId={projectId} /></ArtworkTile>;
    const keys = new Set(node.refs.map(refKey));
    const fragments = route.fragments.filter(f => node.fragmentIds.includes(f.id) && f.refs.every(ref => keys.has(refKey(ref))));
    const covered = new Set(fragments.flatMap(f => f.refs.map(refKey)));
    if (node.kind === "final" && sources.every(s => keys.has(refKey(s.ref)))) return <ArtworkTile zoomEnabled={zoomEnabled}><RouteAssemblyDrawingPreview row={finalRow} document={source} config={config} session={session} projectId={projectId} /></ArtworkTile>;
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
    // Artwork components already render their own material and endpoint details.
    // Keep each tile as one zoomable unit so the image and its text scale together
    // in the preview dialog without repeating the source title underneath.
    return <>{fragments.map(f => <ArtworkTile zoomEnabled={zoomEnabled} key={f.id}>{showFragment(f)}</ArtworkTile>)}{pictures.map(n => <ArtworkTile zoomEnabled={zoomEnabled} key={n.id}>{nodeArtwork(n)}</ArtworkTile>)}{node.refs.filter(ref => !covered.has(refKey(ref))).map(ref => <ArtworkTile zoomEnabled={zoomEnabled} key={refKey(ref)}>{artwork(ref)}</ArtworkTile>)}</>;
  };
  const editNodeDrawing = (node: RouteV3Node) => {
    const fragment = route.fragments.find(f => node.fragmentIds.includes(f.id));
    setDrawingNode({ ...node, drawing: node.drawing ?? (fragment ? { backgroundOpacity: fragment.backgroundOpacity, drawingCopy: fragment.drawingCopy, isolatedDrawingCopy: fragment.isolatedDrawingCopy } : { backgroundOpacity: 0, drawingCopy: captureRouteV3Selection(source, sourceScene, node.refs.map(ref => ref.id)).drawingCopy }) });
  };
  return <section className="route-v3-panel" aria-label="Маршрут v3">
    <HarnessSectionNavigation active="route-v3" onHome={onClose} onNavigate={section => onSectionChange?.(section)} />
    <header className="route-v3-header"><div><p className="eyebrow">{graphical ? "СЛЕПКИ ПОСЛЕДОВАТЕЛЬНОСТИ СБОРКИ" : "ПОСЛЕДОВАТЕЛЬНОСТЬ СБОРКИ"}</p><h2>{graphical ? "Графический маршрут" : "Маршрут v3"}</h2><p>{graphical ? `Раскрыто ${sourceScene.length - hidden.length} из ${sourceScene.length} объектов · слепков ${route.fragments.length}` : route.generated ? "Маршрут построен по составу сохранённых слепков." : "Нарезанные заготовки готовы. Соберите слепки в графическом маршруте."}</p></div><div className="route-v3-actions">{graphical ? <><button className="secondary-action" onClick={() => setGraphical(false)}>К маршруту</button><button className="primary-action" disabled={!route.fragments.length} onClick={generate}>Сгенерировать</button></> : <><button className="secondary-action" disabled={!preparation.data} onClick={() => setPreparationOpen(true)}>Заготовка провода</button><button className="primary-action" onClick={openGraphical}>Графический маршрут</button></>}</div></header>
    {error && <p className="route-v3-error" role="alert">{error}</p>}
    {preparation.error && <p role="alert">{preparation.error}</p>}
    {textures.error && <p role="status">{textures.error}</p>}
    <div hidden={graphical}>
      {(!route.sourceState || sourceRefresh.changed || !!route.sourceDivergences?.length) && <div className="route-v3-refresh" role="status"><div><strong>{!route.sourceState ? "Свяжите маршрут с текущим Чертежом/Э4" : sourceRefresh.changed ? "Чертёж или Э4 изменились" : route.sourceDivergences?.some(issue => !issue.resolved) ? "Есть расхождения с источником" : "Изменения источника проверены"}</strong><span>{!route.sourceState ? "Для ранее созданного маршрута нет исходной ревизии. Сохраните текущий источник как точку сравнения." : sourceRefresh.changed ? sourceRefresh.divergences.length ? `${sourceRefresh.divergences.length} изменений требуют проверки перед обновлением маршрута.` : "Геометрия или количество изменились без расхождения состава и точек привязки. Карточки сохранятся." : `${route.sourceDivergences?.filter(issue => !issue.resolved).length ?? 0} расхождений ожидают исправления оператором.`}</span></div><div className="route-v3-refresh-actions">{(!route.sourceState || sourceRefresh.changed) && <button type="button" className="primary-action" onClick={applySourceRefresh}>{route.sourceState ? "Проверить и применить обновление" : "Привязать текущий источник"}</button>}<button type="button" className="secondary-action" onClick={() => setRefreshOpen(value => !value)}>{refreshOpen ? "Скрыть список" : "Показать расхождения"}</button></div></div>}
      {refreshOpen && <div className="route-v3-divergences" aria-label="Расхождения Чертежа и маршрута">{(sourceRefresh.changed ? sourceRefresh.divergences : route.sourceDivergences ?? []).map(issue => { const affected = route.nodes.filter(node => node.refs.some(ref => refKey(ref) === refKey(issue.ref))); const label = sources.find(item => refKey(item.ref) === refKey(issue.ref))?.title ?? `${issue.ref.kind}:${issue.ref.id}`; return <article key={issue.key} className={issue.resolved ? "resolved" : ""}><div><strong>{label}</strong><small>{issue.kind === "added" ? "Добавлен объект" : issue.kind === "removed" ? "Удалён объект" : issue.kind === "attachment" ? "Изменена привязка" : "Изменена спецификация"}</small><span>Карточки: {affected.length ? affected.map(node => node.title).join(", ") : "не назначены"}</span></div><details><summary>Прежнее и новое значение</summary><p>Было: {issue.previous ?? "—"}</p><p>Стало: {issue.current ?? "—"}</p></details>{!sourceRefresh.changed && !issue.resolved && <button type="button" className="secondary-action" onClick={() => persist(resolveRouteV3SourceDivergence(current.current, issue.key))}>Исправлено</button>}</article>; })}{!(sourceRefresh.changed ? sourceRefresh.divergences : route.sourceDivergences ?? []).length && <p>Расхождений нет.</p>}</div>}
      {!route.generated && route.fragments.length > 0 && <p role="status">Слепки сохранены. Нажмите «Сгенерировать» в графическом маршруте для обновления зависимостей.</p>}
      {route.generated && !route.nodes.some(node => node.kind === "final") && <p role="status">Маршрут частичный: сохраните оставшиеся объекты для финального жгута.</p>}
      <RouteV3Graph graph={board} source={source} config={config} session={session} projectId={projectId} harnessId={harnessId} harnessQuantity={harnessQuantity} save={next => persist({ ...next, graphEdited: true })} artwork={nodeArtwork} preview={setPreview} editDrawing={editNodeDrawing} />
    </div>
    <div hidden={!graphical}>
      {openedOnce && <div className="route-v3-layout"><div className="route-v3-editor"><div className="route-v3-editor-toolbar"><label>Название нового слепка<input value={title} maxLength={120} placeholder="Например, Установка соединителя X1" onChange={event => setTitle(event.target.value)} /></label><span>Выберите объекты кнопками списка или рамкой; ПКМ → «Изолировать» / «Сохранить».</span></div><HarnessDesignEditor config={config} session={session} projectId={projectId} harnessId={harnessId} harnessDesignation="Графический маршрут v3" initialView="drawing" localCopy={localCopy} /></div>
        <aside className="route-v3-gallery-panel" aria-label="Сохранённые слепки"><header><h3>Полуфабрикаты</h3><span>{route.fragments.length}</span></header>{route.fragments.map((fragment, index) => <article className="route-v3-fragment-card" key={fragment.id}><button className="route-v3-fragment-preview" aria-label={`Просмотреть слепок ${fragment.title}`} onClick={() => setPreview({ id: fragment.id, kind: "semiFinished", title: fragment.title, fragmentIds: [fragment.id], refs: fragment.refs, x: 0, y: 0 })}>{showFragment(fragment)}</button><strong>{index + 1}. {fragment.title}</strong><span className="route-v3-fragment-meta">{fragment.mode === "isolated" ? "Изолированный" : "Как на чертеже"} · {fragment.refs.length} комплектующих</span><div className="route-v3-fragment-actions"><button className="link-button" onClick={() => setEditing(fragment)}>Редактировать</button><button className="link-button" onClick={() => { try { persist(removeRouteV3Fragment(current.current, fragment.id)); } catch { /* error visible */ } }}>Удалить</button></div></article>)}{!route.fragments.length && <p className="route-v3-empty">Сохранённые фрагменты появятся здесь. Они станут полуфабрикатами маршрута.</p>}</aside>
      </div>}
    </div>
    {preparationOpen && preparation.data && <WirePreparationDialog route={board} source={source} schemes={preparation.data.schemes} blanks={preparation.data.blanks} onClose={() => setPreparationOpen(false)} onApply={(assignments, schemes) => { persist(applyWirePreparation(board, assignments, schemes)); setPreparationOpen(false); }} />}
    {editing && <Dialog label={`Редактор слепка ${editing.title}`} editor onClose={() => setEditing(null)}><div className="route-card-drawing-host"><RouteAssemblyDrawing key={editing.id} config={config} session={session} projectId={projectId} harnessId={harnessId} document={source} row={fragmentRow(editing)} items={sources.filter(item => editing.refs.some(ref => refKey(ref) === refKey(item.ref)))} onCancel={() => setEditing(null)} onSave={presentation => { persist(appendRouteV3Fragment(current.current, { ...editing, drawingCopy: presentation.drawingCopy ?? editing.drawingCopy, isolatedDrawingCopy: presentation.isolatedDrawingCopy, mode: presentation.isolatedDrawingCopy ? "isolated" : "source", backgroundOpacity: presentation.backgroundOpacity })); setEditing(null); setTitle(""); }} /></div></Dialog>}
    {drawingNode && <Dialog label={`Рисунок карточки ${drawingNode.title}`} editor onClose={() => setDrawingNode(null)}><RouteAssemblyDrawing config={config} session={session} projectId={projectId} harnessId={harnessId} document={source} row={{ ...finalRow, id: drawingNode.id, title: drawingNode.title, sourceObjects: drawingNode.refs, presentation: { objects: [], backgroundOpacity: 0, ...drawingNode.drawing } }} items={sources.filter(s => drawingNode.refs.some(r => refKey(r) === refKey(s.ref)))} onCancel={() => setDrawingNode(null)} onSave={presentation => { persist({ ...board, graphEdited: true, nodes: board.nodes.map(n => n.id === drawingNode.id ? { ...n, drawing: { backgroundOpacity: presentation.backgroundOpacity, drawingCopy: presentation.drawingCopy, isolatedDrawingCopy: presentation.isolatedDrawingCopy } } : n) }); setDrawingNode(null); }} /></Dialog>}
    {preview && <Dialog label={preview.title} onClose={() => setPreview(null)}><header className="route-v3-preview-heading"><h3>{preview.title}</h3><button className="secondary-action" onClick={() => setPreview(null)}>Закрыть</button></header><div className="route-v3-large-preview">{nodeArtwork(preview, true)}</div></Dialog>}
  </section>;
}
