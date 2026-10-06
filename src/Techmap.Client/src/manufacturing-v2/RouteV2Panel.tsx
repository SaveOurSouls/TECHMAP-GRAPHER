import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { LocalSession } from "../local-session";
import type { RuntimeConfig } from "../runtime-config";
import type { HarnessDesignDocument } from "../editor/model";
import { createHarnessDesignApi } from "../editor/design-api";
import { useCoveringAssets } from "../editor/covering-assets";
import { HarnessSectionNavigation, type HarnessSectionId } from "../editor/HarnessSectionNavigation";
import { buildRouteSourceItems, routeSourceDesignation, type RouteSourceRef } from "../manufacturing/route-source";
import { RouteAssemblyDrawing, RouteAssemblyDrawingPreview } from "../manufacturing/RouteAssemblyDrawing";
import { addRouteV2Assembly, addRouteV2Edge, addRouteV2Final, removeRouteV2Edge, removeRouteV2Node, routeV2StorageKey, createInitialRouteV2, parseRouteV2, routeV2DrawingRow, setRouteV2NodeRefs, setRouteV2NodeInputs, routeV2IncomingSemiFinishedNodes, routeV2NodeSize, routeV2ResizeNodeSize, routeV2ConnectionPort, routeV2RawSourceItems, type RouteV2Document, type RouteV2Node } from "./route-v2-model";
import { RouteV2SourceArtwork } from "./RouteV2Artwork";
import { RouteV2CompositionTable } from "./RouteV2CompositionTable";
import "./route-v2.css";

type Props = { config: RuntimeConfig; session: LocalSession; projectId: string; harnessId: string; onClose?: () => void; onSectionChange?: (section: HarnessSectionId) => void | Promise<void> };
type Preview = { kind: "source"; ref: RouteSourceRef } | { kind: "drawing"; nodeId: string; version: "source" | "isolated" };
type DeleteTarget = { kind: "node" | "edge"; id: string; title: string };
const id = (prefix: string) => prefix + "-" + crypto.randomUUID();
const nodeWidth = 280, nodeHeight = 264;
const nodeSize = (node: RouteV2Node) => routeV2NodeSize(node);
const sourceKey = (ref: RouteSourceRef) => ref.kind + ":" + ref.id;

function readStored(key: string): RouteV2Document | null {
  const saved = window.localStorage.getItem(key);
  if (!saved) return null;
  const parsed = parseRouteV2(JSON.parse(saved));
  if (!parsed) throw new Error("Сохранённая схема Маршрут v2 повреждена. Данные браузера не изменены.");
  return parsed;
}

function Modal({ label, onClose, children, className = "", dismissAnywhere = false }: { label: string; onClose: () => void; children: ReactNode; className?: string; dismissAnywhere?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => { element?.close(); }; }, []);
  return <dialog ref={dialog} className={"route-v2-dialog " + className} aria-label={label} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (dismissAnywhere || event.target === event.currentTarget) onClose(); }}>
    <div className="route-v2-dialog-content">{children}</div>
  </dialog>;
}

function DrawingPreview({ node, version, document, config, session, projectId }: { node: RouteV2Node; version: "source" | "isolated"; document: HarnessDesignDocument; config: RuntimeConfig; session: LocalSession; projectId: string }) {
  const row = routeV2DrawingRow(node);
  const copy = version === "isolated" ? row.presentation.isolatedDrawingCopy : row.presentation.isolatedDrawingCopy ?? row.presentation.drawingCopy;
  return <RouteAssemblyDrawingPreview row={{ ...row, presentation: { ...row.presentation, drawingCopy: copy, isolatedDrawingCopy: undefined } }} document={document} config={config} session={session} projectId={projectId} />;
}

/** The card/gallery contract: once isolated, only that fragment is shown. */
export function routeV2GalleryVersions(node: Pick<RouteV2Node, "drawing">): readonly ("source" | "isolated")[] {
  return node.drawing?.isolatedDrawingCopy ? ["isolated"] : node.drawing?.drawingCopy ? ["source"] : [];
}

/** Apply the same C2 search field to incoming semi-finished results. */
export function filterRouteV2IncomingSemiFinished(nodes: readonly RouteV2Node[], query: string): readonly RouteV2Node[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return nodes;
  return nodes.filter(node => (node.title + " " + node.refs.map(ref => ref.id).join(" ")).toLocaleLowerCase().includes(normalized));
}

export function RouteV2Panel({ config, session, projectId, harnessId, onClose, onSectionChange }: Props) {
  const api = useMemo(() => createHarnessDesignApi(config, session), [config, session]);
  const storageKey = useMemo(() => routeV2StorageKey(projectId, harnessId), [projectId, harnessId]);
  const [graph, setGraph] = useState<RouteV2Document | null>(null);
  const [sourceDocument, setSourceDocument] = useState<HarnessDesignDocument | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [drawingNodeId, setDrawingNodeId] = useState<string | null>(null);
  const [drawingSaveError, setDrawingSaveError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; dx: number; dy: number; clientX: number; clientY: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const graphRef = useRef(graph);
  graphRef.current = graph;

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setGraph(null); setSourceDocument(null); setSelectedId(null); setSettingsOpen(false); setDrawingNodeId(null); setPreview(null); setLinkFrom(null); setDeleteTarget(null); setDrawingSaveError(null);
    void api.get(projectId, harnessId).then(resource => {
      if (cancelled) return;
      const loaded = readStored(storageKey) ?? createInitialRouteV2(resource.content);
      setSourceDocument(resource.content); setGraph(loaded); setError(null);
    }).catch(caught => { if (!cancelled) setError(caught instanceof Error ? caught.message : "Не удалось загрузить схему жгута."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [api, projectId, harnessId, storageKey]);

  const updateGraph = (mutate: (current: RouteV2Document) => RouteV2Document): boolean => {
    if (!graphRef.current) return false;
    const next = mutate(graphRef.current);
    try { window.localStorage.setItem(storageKey, JSON.stringify(next)); graphRef.current = next; setGraph(next); setError(null); return true; }
    catch { setError("Не удалось сохранить изменения в хранилище браузера. Повторите действие после освобождения места."); return false; }
  };
  const selected = graph?.nodes.find(node => node.id === selectedId) ?? null;
  const drawingNode = graph?.nodes.find(node => node.id === drawingNodeId) ?? null;
  const sources = useMemo(() => sourceDocument ? buildRouteSourceItems(sourceDocument) : [], [sourceDocument]);
  const textureIds = sourceDocument?.physicalTopology?.coverings?.map(covering => covering.style?.texture ?? "").filter(texture => texture.startsWith("asset:")).join(",") ?? "";
  const textures = useCoveringAssets(config, session, projectId, Boolean(textureIds), textureIds);
  const rawSources = useMemo(() => sourceDocument ? routeV2RawSourceItems(sourceDocument) : [], [sourceDocument]);
  const incomingSemiFinished = useMemo(() => selectedId && graph ? routeV2IncomingSemiFinishedNodes(graph, selectedId) : [], [graph, selectedId]);
  const filteredSources = useMemo(() => rawSources.filter(item => (item.title + " " + item.material + " " + item.materialArticle).toLocaleLowerCase().includes(query.toLocaleLowerCase().trim())), [rawSources, query]);
  const filteredIncomingSemiFinished = useMemo(() => filterRouteV2IncomingSemiFinished(incomingSemiFinished, query), [incomingSemiFinished, query]);
  const isCompleted = Boolean(graph?.finalNodeId && graph.nodes.find(node => node.id === graph.finalNodeId)?.operatorConfirmed);
  const canvasSize = { width: Math.max(940, ...(graph?.nodes ?? []).map(node => node.x + nodeSize(node).width + 48)), height: Math.max(580, ...(graph?.nodes ?? []).map(node => node.y + nodeSize(node).height + 48)) };

  const selectNode = (nodeId: string) => {
    if (suppressClick.current) { suppressClick.current = false; return; }
    if (linkFrom) {
      try { if (linkFrom !== nodeId) updateGraph(current => addRouteV2Edge(current, id("edge"), linkFrom, nodeId)); } catch (caught) { setError(caught instanceof Error ? caught.message : "Не удалось создать связь."); return; }
      setLinkFrom(null); setSelectedId(nodeId); return;
    }
    setSelectedId(nodeId); setQuery(""); setSettingsOpen(true);
  };
  const startDrag = (event: React.PointerEvent<HTMLButtonElement>, node: RouteV2Node) => {
    if (event.button !== 0 || !canvasRef.current) return;
    const bounds = canvasRef.current.getBoundingClientRect();
    suppressClick.current = false;
    drag.current = { id: node.id, dx: event.clientX - bounds.left - node.x, dy: event.clientY - bounds.top - node.y, clientX: event.clientX, clientY: event.clientY, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const currentDrag = drag.current;
    if (!currentDrag || !canvasRef.current) return;
    if (!currentDrag.moved && Math.hypot(event.clientX - currentDrag.clientX, event.clientY - currentDrag.clientY) < 5) return;
    currentDrag.moved = true; suppressClick.current = true;
    const bounds = canvasRef.current.getBoundingClientRect();
    const x = Math.max(12, event.clientX - bounds.left - currentDrag.dx), y = Math.max(12, event.clientY - bounds.top - currentDrag.dy);
    updateGraph(current => ({ ...current, nodes: current.nodes.map(node => node.id === currentDrag.id ? { ...node, x, y } : node) }));
  };
  const resize = useRef<{ id: string; width: number; height: number; clientX: number; clientY: number } | null>(null);
  const startResize = (event: React.PointerEvent<HTMLButtonElement>, node: RouteV2Node) => {
    event.preventDefault(); event.stopPropagation();
    const size = nodeSize(node);
    resize.current = { id: node.id, width: size.width, height: size.height, clientX: event.clientX, clientY: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const currentResize = resize.current;
    if (!currentResize) return;
    const size = routeV2ResizeNodeSize(currentResize.width + event.clientX - currentResize.clientX, currentResize.height + event.clientY - currentResize.clientY);
    updateGraph(current => ({ ...current, nodes: current.nodes.map(node => node.id === currentResize.id ? { ...node, width: size.width, height: size.height } : node) }));
  };
  const finishResize = () => { resize.current = null; };
  const selectPort = (nodeId: string, side: "top" | "bottom") => {
    if (linkFrom && linkFrom !== nodeId) {
      try {
        updateGraph(current => addRouteV2Edge(current, id("edge"), linkFrom, nodeId));
        setLinkFrom(null); setSelectedId(nodeId);
      } catch (caught) { setError(caught instanceof Error ? caught.message : "Не удалось создать связь."); }
      return;
    }
    // A bottom port is the explicit source gesture. A top port can also start
    // the gesture so keyboard and touch users do not need the card action.
    if (side === "bottom" || !linkFrom) { setLinkFrom(nodeId); setSelectedId(nodeId); }
  };
  const openNew = (nextId: string) => { setSelectedId(nextId); setSettingsOpen(true); setQuery(""); };
  const addAssembly = () => {
    if (!selectedId) return;
    const nextId = id("assembly");
    if (updateGraph(current => addRouteV2Assembly(current, selectedId, nextId, id("edge")))) openNew(nextId);
  };
  const addIndependent = () => {
    const nextId = id("pf");
    if (updateGraph(current => ({ ...current, nodes: [...current.nodes, { id: nextId, kind: "semiFinished", title: "Отдельный полуфабрикат", refs: [], quantity: 1, x: 36, y: Math.max(0, ...current.nodes.map(node => node.y)) + 330, operatorConfirmed: false }] }))) openNew(nextId);
  };
  const addFinal = () => {
    const nextId = id("final");
    if (updateGraph(current => addRouteV2Final(current, nextId))) openNew(nextId);
  };
  const updateSelected = (patch: Partial<RouteV2Node>) => {
    if (selectedId) updateGraph(current => ({ ...current, nodes: current.nodes.map(node => node.id === selectedId ? { ...node, ...patch } : node) }));
  };
  const handoffToUml = () => {
    try { window.localStorage.setItem("techmap.uml-seed." + projectId + "." + harnessId, JSON.stringify(graph)); setError(null); void onSectionChange?.("uml"); }
    catch { setError("Не удалось сохранить зависимости для UML в хранилище браузера."); }
  };
  const confirmDelete = () => {
    if (!deleteTarget) return;
    if (!updateGraph(current => deleteTarget.kind === "node" ? removeRouteV2Node(current, deleteTarget.id) : removeRouteV2Edge(current, deleteTarget.id))) return;
    if (deleteTarget.kind === "node") {
      if (selectedId === deleteTarget.id) { setSelectedId(null); setSettingsOpen(false); }
      if (linkFrom === deleteTarget.id) setLinkFrom(null);
    }
    setDeleteTarget(null);
  };

  if (loading) return <section className="route-v2-panel"><div className="route-v2-loading" role="status">Загружаем редактор маршрута v2…</div></section>;
  if (!graph || !sourceDocument) return <section className="route-v2-panel"><p className="route-v2-error" role="alert">{error ?? "Схема жгута недоступна."}</p><button className="secondary-action" type="button" onClick={onClose}>К проекту</button></section>;
  if (drawingNode) return <div className="route-v2-drawing-host">
    {drawingSaveError && <p className="route-v2-drawing-error" role="alert">{drawingSaveError}</p>}
    <RouteAssemblyDrawing key={drawingNode.id} row={routeV2DrawingRow(drawingNode)} document={sourceDocument} config={config} session={session} projectId={projectId} harnessId={harnessId}
      items={sources.filter(item => drawingNode.refs.some(ref => sourceKey(ref) === sourceKey(item.ref)))}
      onCancel={() => { setDrawingNodeId(null); setDrawingSaveError(null); }}
      onSave={presentation => {
        const saved = updateGraph(current => ({ ...current, nodes: current.nodes.map(node => node.id === drawingNode.id ? { ...node, drawing: { backgroundOpacity: presentation.backgroundOpacity, ...(presentation.drawingCopy ? { drawingCopy: presentation.drawingCopy } : {}), ...(presentation.isolatedDrawingCopy ? { isolatedDrawingCopy: presentation.isolatedDrawingCopy } : {}) } } : node) }));
        if (!saved) { setDrawingSaveError("Не удалось сохранить рисунок в хранилище браузера."); throw new Error("Рисунок не сохранён в хранилище браузера."); }
        setDrawingNodeId(null); setDrawingSaveError(null);
      }} />
  </div>;

  const sourceTitle = (ref: RouteSourceRef) => sources.find(item => sourceKey(item.ref) === sourceKey(ref))?.title ?? ref.id;
  const renderSource = (ref: RouteSourceRef) => <RouteV2SourceArtwork document={sourceDocument} ref={ref} textureUrls={textures.urls} item={sources.find(item => sourceKey(item.ref) === sourceKey(ref))} />;
  const renderDrawing = (node: RouteV2Node, version: "source" | "isolated") => <DrawingPreview node={node} version={version} document={sourceDocument} config={config} session={session} projectId={projectId} />;
  const gallery = (node: RouteV2Node, compact = false) => {
    // Once an isolated fragment exists it is the production artwork for this
    // card. Keep the source copy available in the editor, but show only the
    // isolated result in route galleries and previews.
    const versions = routeV2GalleryVersions(node);
    return <div className={"route-v2-gallery " + (compact ? "compact" : "")} aria-label={"Рисунки " + node.title}>
      {versions.map(version => <button type="button" className="route-v2-thumbnail" key={version} aria-label={"Увеличить " + (version === "source" ? "фрагмент " : "изолированный фрагмент ") + node.title} onClick={() => setPreview({ kind: "drawing", nodeId: node.id, version })}>{renderDrawing(node, version)}<small>{version === "source" ? "Фрагмент" : "Изолированный"}</small></button>)}
      {(node.kind === "semiFinished" || !compact) && node.refs.map(ref => <button type="button" key={sourceKey(ref)} className="route-v2-thumbnail" aria-label={"Увеличить рисунок " + sourceTitle(ref)} onClick={() => setPreview({ kind: "source", ref })}>{renderSource(ref)}<small>{sourceTitle(ref)}</small></button>)}
      {!versions.length && (node.kind !== "semiFinished" && compact || !node.refs.length) && <p className="route-v2-empty">{node.kind === "semiFinished" ? "Выберите полуфабрикаты в настройках" : "Сохраните фрагмент в редакторе рисунка"}</p>}
    </div>;
  };
  const previewNode = preview?.kind === "drawing" ? graph.nodes.find(node => node.id === preview.nodeId) : null;
  const previewTitle = preview?.kind === "source" ? sourceTitle(preview.ref) : previewNode?.title ?? "Рисунок";

  return <section className="route-v2-panel" aria-label="Маршрут v2">
    <HarnessSectionNavigation active="route-v2" onHome={onClose} onNavigate={section => onSectionChange?.(section)} />
    <header className="route-v2-header"><div><p className="eyebrow">ПОСЛЕДОВАТЕЛЬНОСТЬ СБОРКИ</p><h2>Маршрут v2 <span className="route-v2-hint" title="Карточки соединяются верхними и нижними точками. Состав редактируется внутри карточки." aria-label="Подсказка по карточкам">i</span></h2></div><div className="route-v2-actions"><button type="button" className="secondary-action" disabled={!selectedId} onClick={() => setLinkFrom(selectedId)}>Связать с карточкой</button><button type="button" className="secondary-action" disabled={!selectedId} onClick={addAssembly}>+ Сборка</button><button type="button" className="secondary-action" onClick={addIndependent}>+ Отдельный полуфабрикат</button><button type="button" className="secondary-action" disabled={Boolean(graph.finalNodeId)} onClick={addFinal}>Финальная карточка</button></div></header>
    {error && <p className="route-v2-error" role="alert">{error}</p>}
    {textures.error && <p className="route-v2-error" role="status">{textures.error}</p>}
    <div className="route-v2-context"><span>{linkFrom ? "Выберите целевую карточку для «" + graph.nodes.find(node => node.id === linkFrom)?.title + "»" : selected ? "Выбрано: " + selected.title : "Клик по карточке — настройки · Перетаскивание заголовка — перемещение"}</span>{linkFrom && <button type="button" className="link-button" onClick={() => setLinkFrom(null)}>Отменить связь</button>}</div>
    <div className="route-v2-canvas-scroll"><div ref={canvasRef} className="route-v2-canvas" style={{ width: canvasSize.width, height: canvasSize.height }} onPointerMove={event => { moveDrag(event); moveResize(event); }} onPointerUp={() => { drag.current = null; finishResize(); }} onPointerCancel={() => { drag.current = null; finishResize(); suppressClick.current = false; }}>
      <svg className="route-v2-edges" width={canvasSize.width} height={canvasSize.height} aria-label="Связи карточек"><defs><marker id="route-v2-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" /></marker></defs>{graph.edges.map(edge => {
        const from = graph.nodes.find(node => node.id === edge.from), to = graph.nodes.find(node => node.id === edge.to);
        if (!from || !to) return null;
        const start = routeV2ConnectionPort(from, "bottom"), end = routeV2ConnectionPort(to, "top");
        const x1 = start.x, y1 = start.y, x2 = end.x, y2 = end.y;
        const title = from.title + " → " + to.title;
        return <g key={edge.id} className="route-v2-edge-group"><title>{title}</title><line x1={x1} y1={y1} x2={x2} y2={y2} markerEnd="url(#route-v2-arrow)" /><line className="route-v2-edge-hit-line" x1={x1} y1={y1} x2={x2} y2={y2} onClick={() => setDeleteTarget({ kind: "edge", id: edge.id, title })} /><foreignObject className="route-v2-edge-hit" x={(x1 + x2) / 2 - 15} y={(y1 + y2) / 2 - 15} width="30" height="30"><button type="button" className="route-v2-edge-delete" aria-label={"Удалить связь " + title} title="Удалить связь" onClick={() => setDeleteTarget({ kind: "edge", id: edge.id, title })}>×</button></foreignObject></g>;
      })}</svg>
      {graph.nodes.map(node => { const size = nodeSize(node); return <article key={node.id} className={"route-v2-node " + node.kind + (selectedId === node.id ? " selected" : "") + (linkFrom === node.id ? " link-source" : "")} style={{ left: node.x, top: node.y, width: size.width, height: size.height }}>
        <button type="button" className={"route-v2-node-port route-v2-node-port-top" + (linkFrom && linkFrom !== node.id ? " link-target" : "")} aria-label={"Связать с верхней точкой карточки " + node.title} onClick={event => { event.stopPropagation(); selectPort(node.id, "top"); }} />
        <button type="button" className="route-v2-node-body" aria-label={"Открыть настройки карточки " + node.title} onClick={() => selectNode(node.id)} onPointerDown={event => startDrag(event, node)}><span className="route-v2-node-kicker">{node.kind === "semiFinished" ? "ПОЛУФАБРИКАТ" : node.kind === "assembly" ? "СБОРКА" : "ФИНАЛ"}</span><strong>{node.title}</strong><span className="route-v2-node-meta">{node.refs.length} полуфабр. · {node.quantity} шт.</span></button>
        <button type="button" className="route-v2-node-delete" aria-label={"Удалить карточку " + node.title} title="Удалить карточку" onClick={() => setDeleteTarget({ kind: "node", id: node.id, title: node.title })}>×</button>
        {gallery(node, true)}
        <button type="button" className="route-v2-node-settings" onClick={() => selectNode(node.id)}>Настроить карточку</button>
        {node.kind === "final" && <span className={node.operatorConfirmed ? "route-v2-node-confirmed" : "route-v2-node-pending"}>{node.operatorConfirmed ? "Подтверждено оператором" : "Ожидает подтверждения"}</span>}
        <button type="button" className={"route-v2-node-port route-v2-node-port-bottom" + (linkFrom === node.id ? " link-active" : "")} aria-label={"Создать связь из нижней точки карточки " + node.title} onClick={event => { event.stopPropagation(); selectPort(node.id, "bottom"); }} />
        <button type="button" className="route-v2-node-resize" aria-label={"Изменить размер карточки " + node.title} onPointerDown={event => startResize(event, node)} />
      </article>; })}
      {!graph.nodes.length && <p className="route-v2-empty-canvas">Карточек пока нет. Добавьте отдельный полуфабрикат.</p>}
    </div></div>
    <footer className="route-v2-footer"><span>{isCompleted ? "Маршрут подтверждён оператором" : "Завершение подтверждается в настройках финальной карточки"}</span><button type="button" className="primary-action" disabled={!isCompleted} onClick={handoffToUml}>Сформировать UML из зависимостей</button></footer>

    {settingsOpen && selected && <Modal label={"Настройки карточки " + selected.title} onClose={() => setSettingsOpen(false)} className="route-v2-settings-dialog">
      <header className="route-v2-dialog-heading"><div><p className="eyebrow">НАСТРОЙКИ КАРТОЧКИ</p><h3>{selected.title}</h3></div><button type="button" className="secondary-action" onClick={() => setSettingsOpen(false)}>Закрыть</button></header>
      {error && <p className="route-v2-error" role="alert">{error}</p>}
      <div className="route-v2-settings-fields"><label>Название<input maxLength={512} value={selected.title} onChange={event => updateSelected({ title: event.target.value })} /></label><label>Количество, шт.<input type="number" min="1" max="1000000" step="1" value={selected.quantity} onChange={event => updateSelected({ quantity: Math.max(1, Math.min(1000000, Number(event.target.value) || 1)) })} /></label><button type="button" className="secondary-action" onClick={() => { setDrawingSaveError(null); setDrawingNodeId(selected.id); }}>Открыть редактор рисунка</button></div>
      <section className="route-v2-settings-section"><h4>Состав карточки <span>{selected.refs.length + (selected.inputNodeIds?.length ?? 0)}</span> <span className="route-v2-hint" title="Материалы и входящие полуфабрикаты входят в эту карточку." aria-label="Материалы карточки">i</span></h4><RouteV2CompositionTable node={selected} document={sourceDocument} sources={sources} /></section>
      <section className="route-v2-settings-section"><h4>Рисунки полуфабрикатов и фрагменты <span className="route-v2-hint" title="Сохранённый изолированный фрагмент заменяет исходный рисунок в карточке." aria-label="Сохранённый изолированный фрагмент показывается в карточке">i</span></h4>{gallery(selected)}</section>
      <section className="route-v2-settings-section route-v2-material-picker"><h4>Материалы карточки <span className="route-v2-hint" title="Сырьё приходит из спецификации. Полуфабрикаты доступны по входящим стрелкам." aria-label="Сырьё из спецификации, полуфабрикаты по входящим стрелкам">i</span></h4><input className="route-v2-search" type="search" aria-label="Поиск сырья и полуфабрикатов" placeholder="Поиск по объекту или материалу" value={query} onChange={event => setQuery(event.target.value)} />
        <div className="route-v2-material-groups">
          <section className="route-v2-material-group" aria-labelledby="route-v2-raw-heading"><h5 id="route-v2-raw-heading">Сырьё <span>{filteredSources.length}</span></h5><div className="route-v2-source-choices">
            {filteredSources.map(item => { const checked = selected.refs.some(ref => sourceKey(ref) === sourceKey(item.ref)); return <label className={"route-v2-ref-choice " + (checked ? "checked" : "")} key={sourceKey(item.ref)}><input type="checkbox" aria-label={"Включить сырьё " + item.title} checked={checked} onChange={event => { const include = event.target.checked; updateGraph(current => { const node = current.nodes.find(node => node.id === selected.id)!; return setRouteV2NodeRefs(current, node.id, include ? [...node.refs, item.ref] : node.refs.filter(ref => sourceKey(ref) !== sourceKey(item.ref))); }); }} /><span><strong>{item.title}</strong><small>{routeSourceDesignation(item)} · {item.lengthMm == null ? "Длина не задана" : item.lengthMm + " мм"}</small></span></label>; })}
            {!filteredSources.length && <p className="route-v2-empty">Сырьё не найдено.</p>}
          </div></section>
          <section className="route-v2-material-group" aria-labelledby="route-v2-semi-heading"><h5 id="route-v2-semi-heading">Полуфабрикаты <span>{filteredIncomingSemiFinished.length}</span></h5><div className="route-v2-source-choices">
            {filteredIncomingSemiFinished.map(item => { const checked = selected.inputNodeIds?.includes(item.id) ?? false; return <label className={"route-v2-ref-choice route-v2-node-choice " + (checked ? "checked" : "")} key={item.id}><input type="checkbox" aria-label={"Включить полуфабрикат " + item.title} checked={checked} onChange={event => { const next = new Set(selected.inputNodeIds ?? []); if (event.target.checked) next.add(item.id); else next.delete(item.id); updateGraph(current => setRouteV2NodeInputs(current, selected.id, [...next])); }} /><span><strong>{item.title}</strong><small>{item.refs.length} объект(ов) · {item.quantity} шт.</small></span></label>; })}
            {!filteredIncomingSemiFinished.length && <p className="route-v2-empty">{incomingSemiFinished.length ? "Полуфабрикаты не найдены." : "Подключите входящую карточку стрелкой."}</p>}
          </div></section>
        </div>
        {selected.refs.filter(ref => !sources.some(item => sourceKey(item.ref) === sourceKey(ref))).map(ref => <button key={sourceKey(ref)} type="button" className="secondary-action" onClick={() => updateGraph(current => setRouteV2NodeRefs(current, selected.id, selected.refs.filter(item => sourceKey(item) !== sourceKey(ref))))}>Убрать отсутствующий объект {ref.id}</button>)}
      </section>
      <section className="route-v2-settings-section"><h4>Зависимости <span className="route-v2-hint" title="Входящие стрелки определяют доступные полуфабрикаты." aria-label="Входящие стрелки определяют доступные полуфабрикаты">i</span></h4><div className="route-v2-dependencies">{graph.edges.filter(edge => edge.to === selected.id).map(edge => { const title = graph.nodes.find(node => node.id === edge.from)?.title ?? edge.from; return <div key={edge.id}><span>{title} → {selected.title}</span><button type="button" className="link-button" onClick={() => setDeleteTarget({ kind: "edge", id: edge.id, title: title + " → " + selected.title })}>Удалить связь</button></div>; })}{!graph.edges.some(edge => edge.to === selected.id) && <p className="route-v2-muted">Нет входящих связей</p>}</div><div className="route-v2-actions"><button type="button" className="secondary-action" onClick={() => { setLinkFrom(selected.id); setSettingsOpen(false); }}>Связать с карточкой</button><button type="button" className="secondary-action" onClick={addAssembly}>+ Зависимая сборка</button></div></section>
      {selected.kind === "final" && <label className="route-v2-confirm"><input type="checkbox" checked={selected.operatorConfirmed} onChange={event => updateSelected({ operatorConfirmed: event.target.checked })} /> Оператор подтверждает завершение маршрута</label>}
    </Modal>}
    {preview && <Modal label={"Просмотр рисунка " + previewTitle} onClose={() => setPreview(null)} className="route-v2-preview-dialog" dismissAnywhere><header className="route-v2-dialog-heading"><h3>{previewTitle}</h3><button type="button" className="secondary-action" onClick={() => setPreview(null)}>Закрыть</button></header><div className="route-v2-preview-art">{preview.kind === "source" ? renderSource(preview.ref) : previewNode ? renderDrawing(previewNode, preview.version) : <p>Рисунок недоступен</p>}</div><p className="route-v2-muted">Нажмите в любом месте, чтобы закрыть</p></Modal>}
    {deleteTarget && <Modal label={deleteTarget.kind === "node" ? "Удалить карточку?" : "Удалить связь?"} onClose={() => setDeleteTarget(null)} className="route-v2-confirm-dialog"><h3>{deleteTarget.kind === "node" ? "Удалить карточку?" : "Удалить связь?"}</h3><p>«{deleteTarget.title}»</p><p className="route-v2-muted">{deleteTarget.kind === "node" ? "Карточка, её рисунки и связанные стрелки будут удалены из Маршрута v2." : "Обе карточки и выбранные в них полуфабрикаты сохранятся."}</p>{error && <p className="route-v2-error" role="alert">{error}</p>}<div className="route-v2-actions"><button type="button" className="secondary-action" autoFocus onClick={() => setDeleteTarget(null)}>Отмена</button><button type="button" className="route-v2-danger" onClick={confirmDelete}>Удалить</button></div></Modal>}
  </section>;
}
