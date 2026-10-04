import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LocalSession } from "../local-session";
import type { RuntimeConfig } from "../runtime-config";
import { createHarnessDesignApi } from "../editor/design-api";
import { routeV2StorageKey, createInitialRouteV2, parseRouteV2, routeV2DrawingRow, routeV2SourceTitle, type RouteV2Document, type RouteV2Node } from "./route-v2-model";
import { buildRouteSourceItems, type RouteSourceRef } from "../manufacturing/route-source";
import { RouteAssemblyDrawing, RouteAssemblyDrawingPreview, type AssemblyDrawingPresentation } from "../manufacturing/RouteAssemblyDrawing";
import "./route-v2.css";

type Props = { config: RuntimeConfig; session: LocalSession; projectId: string; harnessId: string; onClose?: () => void };

const id = (prefix: string) => `${prefix}-${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`;
const nodeWidth = 232;
const nodeHeight = 122;

function readStored(key: string): RouteV2Document | null {
  const saved = window.localStorage.getItem(key);
  if (!saved) return null;
  const parsed = parseRouteV2(JSON.parse(saved));
  if (!parsed) throw new Error("Сохранённая схема Маршрут v2 повреждена. Данные браузера не изменены.");
  return parsed;
}

function nodeRefs(node: RouteV2Node): readonly RouteSourceRef[] { return node.refs; }

export function RouteV2Panel({ config, session, projectId, harnessId, onClose }: Props) {
  const api = useMemo(() => createHarnessDesignApi(config, session), [config, session]);
  const storageKey = useMemo(() => routeV2StorageKey(projectId, harnessId), [projectId, harnessId]);
  const [graph, setGraph] = useState<RouteV2Document | null>(null);
  const [sourceDocument, setSourceDocument] = useState<import("../editor/model").HarnessDesignDocument | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawingNodeId, setDrawingNodeId] = useState<string | null>(null);
  const [drawingSaveError, setDrawingSaveError] = useState<string | null>(null);
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    void api.get(projectId, harnessId).then(resource => {
      if (cancelled) return;
      setSourceDocument(resource.content);
      setGraph(readStored(storageKey) ?? createInitialRouteV2(resource.content));
      setError(null);
    }).catch(caught => { if (!cancelled) setError(caught instanceof Error ? caught.message : "Не удалось загрузить схему жгута."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [api, projectId, harnessId, storageKey]);

  useEffect(() => {
    if (!graph) return;
    try { window.localStorage.setItem(storageKey, JSON.stringify(graph)); }
    catch { setError("Не удалось сохранить изменения Маршрут v2 в хранилище браузера."); }
  }, [graph, storageKey]);

  const selected = graph?.nodes.find(node => node.id === selectedId) ?? null;
  const drawingNode = graph?.nodes.find(node => node.id === drawingNodeId) ?? null;
  const sourceItems = useMemo(() => sourceDocument ? buildRouteSourceItems(sourceDocument) : [], [sourceDocument]);
  const isCompleted = Boolean(graph?.finalNodeId && graph.nodes.find(node => node.id === graph.finalNodeId)?.operatorConfirmed);
  const canvasSize = useMemo(() => {
    const width = Math.max(920, ...(graph?.nodes ?? []).map(node => node.x + nodeWidth + 48));
    const height = Math.max(540, ...(graph?.nodes ?? []).map(node => node.y + nodeHeight + 48));
    return { width, height };
  }, [graph]);

  const updateGraph = useCallback((mutate: (current: RouteV2Document) => RouteV2Document) => setGraph(current => current ? mutate(current) : current), []);
  const selectNode = (nodeId: string) => {
    if (linkFrom && linkFrom !== nodeId) {
      updateGraph(current => current.edges.some(edge => edge.from === linkFrom && edge.to === nodeId)
        ? current
        : { ...current, edges: [...current.edges, { id: id("edge"), from: linkFrom, to: nodeId }] });
      setLinkFrom(null);
    }
    setSelectedId(nodeId);
  };
  const startDrag = (event: React.PointerEvent<HTMLButtonElement>, node: RouteV2Node) => {
    if (!canvasRef.current) return;
    const bounds = canvasRef.current.getBoundingClientRect();
    setDrag({ id: node.id, dx: event.clientX - bounds.left - node.x, dy: event.clientY - bounds.top - node.y });
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag || !canvasRef.current) return;
    const bounds = canvasRef.current.getBoundingClientRect();
    const x = Math.max(12, event.clientX - bounds.left - drag.dx), y = Math.max(12, event.clientY - bounds.top - drag.dy);
    updateGraph(current => ({ ...current, nodes: current.nodes.map(node => node.id === drag.id ? { ...node, x, y } : node) }));
  };
  const addAssembly = () => {
    if (!graph || !selectedId) return;
    const nextId = id("assembly");
    const selectedNode = graph.nodes.find(node => node.id === selectedId);
    const maxY = Math.max(...graph.nodes.map(node => node.y), selectedNode?.y ?? 0);
    updateGraph(current => ({ ...current,
      nodes: [...current.nodes, { id: nextId, kind: "assembly", title: `Сборка ${current.nodes.filter(node => node.kind === "assembly").length + 1}`, refs: [], quantity: 1, x: selectedNode?.x ?? 48, y: maxY + 174, operatorConfirmed: false }],
      edges: [...current.edges, { id: id("edge"), from: selectedId, to: nextId }],
    }));
    setSelectedId(nextId);
  };
  const addIndependent = () => {
    if (!graph || !selected) return;
    const nextId = id("pf");
    updateGraph(current => ({ ...current, nodes: [...current.nodes, { id: nextId, kind: "semiFinished", title: `${selected.title} · отдельный`, refs: [...selected.refs], quantity: selected.quantity, x: selected.x + 24, y: Math.max(...current.nodes.map(node => node.y)) + 174, operatorConfirmed: false }] }));
  };
  const addFinal = () => {
    if (!graph || graph.finalNodeId) return;
    const nextId = id("final");
    const parents = graph.nodes.filter(node => !graph.edges.some(edge => edge.from === node.id));
    const maxY = graph.nodes.length ? Math.max(...graph.nodes.map(node => node.y)) : 36;
    updateGraph(current => ({ ...current, finalNodeId: nextId,
      nodes: [...current.nodes, { id: nextId, kind: "final", title: "Готовый жгут · финальная карточка", refs: parents.flatMap(node => node.refs), quantity: 1, x: 48, y: maxY + 190, operatorConfirmed: false }],
      edges: [...current.edges, ...parents.map(parent => ({ id: id("edge"), from: parent.id, to: nextId }))],
    }));
    setSelectedId(nextId);
  };
  const updateSelected = (patch: Partial<RouteV2Node>) => {
    if (!selectedId) return;
    updateGraph(current => ({ ...current, nodes: current.nodes.map(node => node.id === selectedId ? { ...node, ...patch } : node) }));
  };
  const handoffToUml = () => { if (graph) { try { window.localStorage.setItem(`techmap.uml-seed.${projectId}.${harnessId}`, JSON.stringify(graph)); } catch { /* optional cache */ } } };

  if (loading) return <section className="route-v2-panel"><div className="route-v2-loading" role="status">Загружаем редактор маршрута v2…</div></section>;
  if (!graph || !sourceDocument) return <section className="route-v2-panel"><p className="route-v2-error" role="alert">{error ?? "Схема жгута недоступна."}</p><button className="secondary-action" type="button" onClick={onClose}>К проекту</button></section>;
  if (drawingNode) {
    const row = routeV2DrawingRow(drawingNode);
    return <>
      {drawingSaveError && <p className="route-v2-drawing-error" role="alert">{drawingSaveError}</p>}
      <RouteAssemblyDrawing key={drawingNode.id} row={row} document={sourceDocument} config={config} session={session} projectId={projectId} harnessId={harnessId}
        items={sourceItems.filter(item => drawingNode.refs.some(ref => ref.kind === item.ref.kind && ref.id === item.ref.id))}
        onCancel={() => { setDrawingNodeId(null); setDrawingSaveError(null); }}
        onSave={(presentation: AssemblyDrawingPresentation) => {
          const next: RouteV2Document = { ...graph, nodes: graph.nodes.map(node => node.id === drawingNode.id ? {
            ...node,
            drawing: {
              backgroundOpacity: presentation.backgroundOpacity,
              ...(presentation.drawingCopy ? { drawingCopy: presentation.drawingCopy } : {}),
              ...(presentation.isolatedDrawingCopy ? { isolatedDrawingCopy: presentation.isolatedDrawingCopy } : {}),
            },
          } : node) };
          try { window.localStorage.setItem(storageKey, JSON.stringify(next)); }
          catch { setDrawingSaveError("Не удалось сохранить рисунок в хранилище браузера. Освободите место и повторите сохранение."); return; }
          setGraph(next);
          setDrawingNodeId(null);
          setDrawingSaveError(null);
        }} />
    </>;
  }

  return <section className="route-v2-panel" aria-label="Маршрут v2">
    <nav className="route-v2-nav" aria-label="Редактор тестовой схемы"><button type="button" className="route-home-button" onClick={onClose}>← <span>К проекту</span></button><span className="route-v2-nav-current">Маршрут v2</span><span className="route-v2-nav-note">Визуальный прототип · без расчётов и операций</span></nav>
    <header className="route-v2-header"><div><p className="eyebrow">ТЕСТОВАЯ СХЕМА · СВЕРХУ ВНИЗ</p><h2>Маршрут v2</h2><p>Карточки полуфабрикатов, сборок и зависимостей остаются отдельными от старого маршрута.</p></div><div className="route-v2-actions"><button type="button" className="secondary-action" disabled={!selectedId} onClick={() => setLinkFrom(selectedId)}>Связать с карточкой</button><button type="button" className="secondary-action" disabled={!selectedId} onClick={addAssembly}>+ Сборка</button><button type="button" className="secondary-action" disabled={!selectedId} onClick={addIndependent}>+ Отдельный полуфабрикат</button><button type="button" className="secondary-action" disabled={Boolean(graph.finalNodeId)} onClick={addFinal}>Финальная карточка</button></div></header>
    {error && <p className="route-v2-error" role="alert">{error}</p>}
    <div className="route-v2-workspace">
      <div className="route-v2-canvas-scroll"><div ref={canvasRef} className="route-v2-canvas" style={{ width: canvasSize.width, height: canvasSize.height }} onPointerMove={moveDrag} onPointerUp={() => setDrag(null)} onPointerCancel={() => setDrag(null)}>
        <svg className="route-v2-edges" width={canvasSize.width} height={canvasSize.height} aria-hidden="true">{graph.edges.map(edge => { const from = graph.nodes.find(node => node.id === edge.from), to = graph.nodes.find(node => node.id === edge.to); if (!from || !to) return null; return <g key={edge.id}><line x1={from.x + nodeWidth / 2} y1={from.y + nodeHeight} x2={to.x + nodeWidth / 2} y2={to.y} markerEnd="url(#route-v2-arrow)" /><title>{from.title} → {to.title}</title></g>; })}<defs><marker id="route-v2-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" /></marker></defs></svg>
        {graph.nodes.map(node => <button key={node.id} type="button" className={`route-v2-node ${node.kind} ${selectedId === node.id ? "selected" : ""} ${linkFrom === node.id ? "link-source" : ""}`} style={{ left: node.x, top: node.y, width: nodeWidth, minHeight: nodeHeight }} onClick={() => selectNode(node.id)} onPointerDown={event => startDrag(event, node)}>
          <span className="route-v2-node-kicker">{node.kind === "semiFinished" ? "ПОЛУФАБРИКАТ" : node.kind === "assembly" ? "СБОРКА" : "ФИНАЛ"}</span><strong>{node.title}</strong><span className="route-v2-node-meta">{node.refs.length ? `${node.refs.length} объект${node.refs.length === 1 ? "" : "а"}` : "Входы добавляются отдельно"} · {node.quantity} шт.</span>{node.kind === "final" && <span className={node.operatorConfirmed ? "route-v2-node-confirmed" : "route-v2-node-pending"}>{node.operatorConfirmed ? "✓ подтверждено оператором" : "ожидает подтверждения"}</span>}
        </button>)}
      </div></div>
      <aside className="route-v2-inspector" aria-label="Свойства карточки">
        <div className="route-v2-inspector-heading"><div><p className="eyebrow">КАРТОЧКА</p><h3>{selected?.title ?? "Выберите карточку"}</h3></div>{linkFrom && <button type="button" className="link-button" onClick={() => setLinkFrom(null)}>Отменить связь</button>}</div>
        {!selected ? <p className="route-v2-muted">Кликните карточку, чтобы посмотреть группу полуфабрикатов и зависимости.</p> : <>
          <button type="button" className="secondary-action route-v2-drawing-action" onClick={() => { setDrawingSaveError(null); setDrawingNodeId(selected.id); }}>Открыть редактор рисунка</button>
          {selected.drawing?.drawingCopy && <RouteAssemblyDrawingPreview row={routeV2DrawingRow(selected)} document={sourceDocument} config={config} session={session} projectId={projectId} />}
          <label>Название<input value={selected.title} onChange={event => updateSelected({ title: event.target.value })} /></label><label>Количество<div className="route-v2-number"><input type="number" min="1" step="1" value={selected.quantity} onChange={event => updateSelected({ quantity: Math.max(1, Number(event.target.value) || 1) })} /><span>шт.</span></div></label>
          <div className="route-v2-list"><strong>Состав карточки</strong>{nodeRefs(selected).length ? nodeRefs(selected).map(ref => <span key={`${ref.kind}:${ref.id}`}>{routeV2SourceTitle(sourceDocument, ref)}</span>) : <span className="route-v2-muted">Полуфабрикаты будут добавлены как независимые входы.</span>}</div>
          <div className="route-v2-list"><strong>Зависимости</strong>{graph.edges.filter(edge => edge.to === selected.id).map(edge => <span key={edge.id}>{graph.nodes.find(node => node.id === edge.from)?.title ?? edge.from}</span>)}{!graph.edges.some(edge => edge.to === selected.id) && <span className="route-v2-muted">Нет входящих связей</span>}</div>
          {selected.kind === "assembly" && <div className="route-v2-list"><strong>Добавить полуфабрикат в сборку</strong>{graph.nodes.filter(node => node.kind === "semiFinished" && !graph.edges.some(edge => edge.from === node.id && edge.to === selected.id)).map(node => <button type="button" className="route-v2-input-button" key={node.id} onClick={() => updateGraph(current => ({ ...current, edges: [...current.edges, { id: id("edge"), from: node.id, to: selected.id }], nodes: current.nodes.map(item => item.id === selected.id ? { ...item, refs: [...item.refs, ...node.refs] } : item) }))}>+ {node.title}</button>)}</div>}
          {selected.kind === "final" && <label className="route-v2-confirm"><input type="checkbox" checked={selected.operatorConfirmed} onChange={event => updateSelected({ operatorConfirmed: event.target.checked })} /> Оператор подтверждает завершение маршрута</label>}
        </>}
        {isCompleted && <div className="route-v2-complete" role="status">Маршрут завершён оператором. Граф готов к передаче в UML.</div>}
        <button type="button" className="primary-action" disabled={!isCompleted} onClick={handoffToUml}>Сформировать UML из зависимостей</button>
      </aside>
    </div>
  </section>;
}
