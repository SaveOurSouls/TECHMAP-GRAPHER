import { useEffect, useMemo, useRef, useState } from "react";
import type { LocalSession } from "../local-session";
import type { RuntimeConfig } from "../runtime-config";
import { createInitialRouteV2, parseRouteV2, routeV2StorageKey } from "../manufacturing-v2/route-v2-model";
import { createHarnessDesignApi } from "../editor/design-api";
import { createUmlFromRouteV2, documentMinutes, nodeMinutes, operationMinutes, parseUml, umlId, umlStorageKey, type UmlDocument, type UmlNode, type UmlOperation } from "./uml-model";
import "./uml.css";

type Props = { config: RuntimeConfig; session: LocalSession; projectId: string; harnessId: string; onClose?: () => void };
const nodeWidth = 236;
const nodeHeight = 128;
const readJson = (key: string): unknown => { try { return JSON.parse(window.localStorage.getItem(key) ?? "null"); } catch { return null; } };

export function UmlPanel({ config, session, projectId, harnessId, onClose }: Props) {
  const api = useMemo(() => createHarnessDesignApi(config, session), [config, session]);
  const key = useMemo(() => umlStorageKey(projectId, harnessId), [projectId, harnessId]);
  const [document, setDocument] = useState<UmlDocument | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    void api.get(projectId, harnessId).then(resource => {
      if (cancelled) return;
      const saved = parseUml(readJson(key));
      const seed = parseRouteV2(readJson(`techmap.uml-seed.${projectId}.${harnessId}`)) ?? parseRouteV2(readJson(routeV2StorageKey(projectId, harnessId))) ?? createInitialRouteV2(resource.content);
      setDocument(saved ?? createUmlFromRouteV2(seed));
    }).catch(caught => { if (!cancelled) setError(caught instanceof Error ? caught.message : "Не удалось открыть UML-схему."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [api, projectId, harnessId, key]);

  useEffect(() => { if (document) { try { window.localStorage.setItem(key, JSON.stringify(document)); } catch { /* optional test cache */ } } }, [document, key]);
  const selected = document?.nodes.find(node => node.id === selectedId) ?? null;
  const canvasSize = useMemo(() => ({ width: Math.max(920, ...(document?.nodes ?? []).map(node => node.x + nodeWidth + 48)), height: Math.max(540, ...(document?.nodes ?? []).map(node => node.y + nodeHeight + 48)) }), [document]);
  const update = (mutate: (current: UmlDocument) => UmlDocument) => setDocument(current => current ? mutate(current) : current);
  const select = (id: string) => {
    if (linkFrom && linkFrom !== id) { update(current => current.edges.some(edge => edge.from === linkFrom && edge.to === id) ? current : { ...current, edges: [...current.edges, { id: umlId("edge"), from: linkFrom, to: id }] }); setLinkFrom(null); }
    setSelectedId(id);
  };
  const startDrag = (event: React.PointerEvent<HTMLButtonElement>, node: UmlNode) => { const bounds = canvasRef.current?.getBoundingClientRect(); if (!bounds) return; setDrag({ id: node.id, dx: event.clientX - bounds.left - node.x, dy: event.clientY - bounds.top - node.y }); event.currentTarget.setPointerCapture(event.pointerId); };
  const moveDrag = (event: React.PointerEvent<HTMLDivElement>) => { if (!drag || !canvasRef.current) return; const bounds = canvasRef.current.getBoundingClientRect(); update(current => ({ ...current, nodes: current.nodes.map(node => node.id === drag.id ? { ...node, x: Math.max(12, event.clientX - bounds.left - drag.dx), y: Math.max(12, event.clientY - bounds.top - drag.dy) } : node) })); };
  const addBlock = () => { const nextId = umlId("block"); update(current => ({ ...current, nodes: [...current.nodes, { id: nextId, title: `Блок ${current.nodes.length + 1}`, sourceNodeId: null, x: 48, y: Math.max(36, ...current.nodes.map(node => node.y)) + 174, operations: [] }] })); setSelectedId(nextId); };
  const updateNode = (patch: Partial<UmlNode>) => { if (!selectedId) return; update(current => ({ ...current, nodes: current.nodes.map(node => node.id === selectedId ? { ...node, ...patch } : node) })); };
  const addOperation = () => { if (!selected) return; const operation: UmlOperation = { id: umlId("operation"), title: "Новая операция", kind: "running", lengthMm: 1000, speedMmPerMinute: 1000, employees: 1, quantity: 1, minutesEach: 1 }; updateNode({ operations: [...selected.operations, operation] }); };
  const updateOperation = (operationId: string, patch: Partial<UmlOperation>) => { if (!selected) return; updateNode({ operations: selected.operations.map(operation => operation.id === operationId ? { ...operation, ...patch } : operation) }); };
  const importV2 = async () => { try { const resource = await api.get(projectId, harnessId); const seed = parseRouteV2(readJson(`techmap.uml-seed.${projectId}.${harnessId}`)) ?? parseRouteV2(readJson(routeV2StorageKey(projectId, harnessId))) ?? createInitialRouteV2(resource.content); setDocument(createUmlFromRouteV2(seed)); setSelectedId(null); setError(null); } catch (caught) { setError(caught instanceof Error ? caught.message : "Не удалось импортировать маршрут v2."); } };

  if (loading) return <section className="uml-panel"><div className="uml-loading" role="status">Загружаем UML-редактор…</div></section>;
  if (!document) return <section className="uml-panel"><p className="uml-error" role="alert">{error ?? "UML-схема недоступна."}</p><button className="secondary-action" type="button" onClick={onClose}>К проекту</button></section>;
  return <section className="uml-panel" aria-label="UML схема зависимостей">
    <nav className="uml-nav" aria-label="Редактор UML"><button type="button" className="route-home-button" onClick={onClose}>← <span>К проекту</span></button><span className="uml-nav-current">UML</span><span className="uml-nav-note">Ручной граф зависимостей · рисунки V2 не редактируются</span></nav>
    <header className="uml-header"><div><p className="eyebrow">ТЕСТОВАЯ СХЕМА · DAG</p><h2>UML зависимостей</h2><p>Добавляйте блоки и связи вручную или импортируйте подтверждённый процесс из «Маршрут v2».</p></div><div className="uml-actions"><button className="secondary-action" type="button" onClick={() => setLinkFrom(selectedId)} disabled={!selectedId}>Связать с блоком</button><button className="secondary-action" type="button" onClick={addBlock}>+ Добавить блок</button><button className="primary-action" type="button" onClick={() => void importV2()}>Импортировать из Маршрут v2</button></div></header>
    {error && <p className="uml-error" role="alert">{error}</p>}
    <div className="uml-summary"><span>Блоки <strong>{document.nodes.length}</strong></span><span>Связи <strong>{document.edges.length}</strong></span><span>Общее время <strong>{Math.round(documentMinutes(document) * 10) / 10} мин</strong></span></div>
    <div className="uml-workspace"><div className="uml-canvas-scroll"><div ref={canvasRef} className="uml-canvas" style={{ width: canvasSize.width, height: canvasSize.height }} onPointerMove={moveDrag} onPointerUp={() => setDrag(null)} onPointerCancel={() => setDrag(null)}>
      <svg className="uml-edges" width={canvasSize.width} height={canvasSize.height} aria-hidden="true">{document.edges.map(edge => { const from = document.nodes.find(node => node.id === edge.from), to = document.nodes.find(node => node.id === edge.to); if (!from || !to) return null; return <line key={edge.id} x1={from.x + nodeWidth / 2} y1={from.y + nodeHeight} x2={to.x + nodeWidth / 2} y2={to.y} markerEnd="url(#uml-arrow)" />; })}<defs><marker id="uml-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" /></marker></defs></svg>
      {document.nodes.map(node => <button type="button" key={node.id} className={`uml-node ${selectedId === node.id ? "selected" : ""} ${linkFrom === node.id ? "link-source" : ""}`} style={{ left: node.x, top: node.y, width: nodeWidth, minHeight: nodeHeight }} onClick={() => select(node.id)} onPointerDown={event => startDrag(event, node)}><span className="uml-node-kicker">{node.sourceNodeId ? "ИЗ МАРШРУТА V2" : "РУЧНОЙ БЛОК"}</span><strong>{node.title}</strong><span>{node.operations.length ? `${node.operations.length} оп. · ${Math.round(nodeMinutes(node) * 10) / 10} мин` : "Операции не добавлены"}</span></button>)}
    </div></div>
    <aside className="uml-inspector" aria-label="Свойства UML блока"><div className="uml-inspector-heading"><div><p className="eyebrow">БЛОК</p><h3>{selected?.title ?? "Выберите блок"}</h3></div>{linkFrom && <button type="button" className="link-button" onClick={() => setLinkFrom(null)}>Отменить связь</button>}</div>
      {!selected ? <p className="uml-muted">Выберите блок, чтобы назначить операции и увидеть расчёт времени.</p> : <><label>Название<input value={selected.title} onChange={event => updateNode({ title: event.target.value })} /></label><div className="uml-operation-heading"><strong>Операции</strong><button type="button" className="link-button" onClick={addOperation}>+ Добавить</button></div>{selected.operations.length === 0 && <p className="uml-muted">Погонные операции считают время по длине и числу сотрудников. Для статичных задайте количество и время на единицу.</p>}{selected.operations.map(operation => <div className="uml-operation" key={operation.id}><input aria-label="Название операции" value={operation.title} onChange={event => updateOperation(operation.id, { title: event.target.value })} /><select aria-label="Тип операции" value={operation.kind} onChange={event => updateOperation(operation.id, { kind: event.target.value as UmlOperation["kind"] })}><option value="running">Погонная</option><option value="static">Статичная</option></select>{operation.kind === "running" ? <div className="uml-operation-grid"><label>Длина, мм<input type="number" min="0" value={operation.lengthMm} onChange={event => updateOperation(operation.id, { lengthMm: Number(event.target.value) || 0 })} /></label><label>Скорость, мм/мин<input type="number" min="1" value={operation.speedMmPerMinute} onChange={event => updateOperation(operation.id, { speedMmPerMinute: Math.max(1, Number(event.target.value) || 1) })} /></label><label>Сотрудники<input type="number" min="1" value={operation.employees} onChange={event => updateOperation(operation.id, { employees: Math.max(1, Number(event.target.value) || 1) })} /></label></div> : <div className="uml-operation-grid"><label>Полуфабрикаты, шт.<input type="number" min="0" value={operation.quantity} onChange={event => updateOperation(operation.id, { quantity: Math.max(0, Number(event.target.value) || 0) })} /></label><label>Минут на единицу<input type="number" min="0" value={operation.minutesEach} onChange={event => updateOperation(operation.id, { minutesEach: Math.max(0, Number(event.target.value) || 0) })} /></label></div>}<span className="uml-operation-total">Итого: {Math.round(operationMinutes(operation) * 10) / 10} мин</span></div>)}</>}
      {selected && <div className="uml-node-total">Время блока: <strong>{Math.round(nodeMinutes(selected) * 10) / 10} мин</strong></div>}
    </aside></div>
  </section>;
}
