import { useEffect, useMemo, useRef, useState, type ReactNode, type PointerEvent } from "react";
import type { HarnessDesignDocument } from "../editor/model";
import { buildRouteSourceItems, routeSourceDesignation } from "../manufacturing/route-source";
import { RouteV2CompositionTable } from "../manufacturing-v2/RouteV2CompositionTable";
import { operationMinutes, type UmlOperation } from "../uml/uml-model";
import { refKey, routeV3ConnectionPort, routeV3NodeSize, routeV3ResizeNodeSize, type RouteV3Document, type RouteV3Node } from "./route-v3-model";
import { connectRouteV3, deleteRouteV3Edge, deleteRouteV3Node, insertRouteV3Node, refreshRouteV3 } from "./route-v3-graph";
import "./route-v3-graph.css";

function Modal({ label, close, children }: { label: string; close: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const el = ref.current; el?.showModal(); return () => el?.close(); }, []);
  return <dialog ref={ref} className="route-v3-dialog route-v3-card-dialog" aria-label={label} onCancel={e => { e.preventDefault(); close(); }}>{children}</dialog>;
}
type Props = { graph: RouteV3Document; source: HarnessDesignDocument; save: (doc: RouteV3Document) => void; artwork: (node: RouteV3Node) => ReactNode; preview: (node: RouteV3Node) => void; editDrawing: (node: RouteV3Node) => void };
const minutes = (n: RouteV3Node) => (n.operations ?? []).reduce((s, o) => s + operationMinutes(o), 0);
const time = (n: number) => Math.round(n * 100) / 100;
export function RouteV3Graph({ graph, source, save, artwork, preview, editDrawing }: Props) {
  const current = useRef(graph); current.current = graph;
  const canvas = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ id: string; mode: "move" | "resize"; x: number; y: number; a: number; b: number } | null>(null);
  const [selectedId, select] = useState<string | null>(null);
  const [link, setLink] = useState<{ id: string; x: number; y: number } | null>(null);
  const [deleting, setDeleting] = useState<{ kind: "node" | "edge"; id: string; title: string } | null>(null);
  const [error, setError] = useState("");
  const [query, search] = useState("");
  const selected = graph.nodes.find(n => n.id === selectedId);
  const sources = useMemo(() => buildRouteSourceItems(source), [source]);
  const change = (fn: (d: RouteV3Document) => RouteV3Document) => { try { const next = fn(current.current); save(next); current.current = next; setError(""); return true; } catch (e) { setError(e instanceof Error ? e.message : "Не удалось сохранить карточку."); return false; } };
  const update = (patch: Partial<RouteV3Node>) => change(d => refreshRouteV3({ ...d, nodes: d.nodes.map(n => ({ ...n, ...(n.id === selectedId ? patch : {}), operatorConfirmed: patch.operatorConfirmed === undefined ? false : n.id === selectedId ? patch.operatorConfirmed : n.operatorConfirmed })) }));
  const begin = (e: PointerEvent<HTMLButtonElement>, node: RouteV3Node, mode: "move" | "resize") => {
    if (e.button !== 0) return; e.preventDefault();
    const size = routeV3NodeSize(node);
    gesture.current = { id: node.id, mode, x: e.clientX, y: e.clientY, a: mode === "move" ? node.x : size.width, b: mode === "move" ? node.y : size.height };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const bounds = canvas.current?.getBoundingClientRect();
    if (link && bounds) setLink({ ...link, x: e.clientX - bounds.left, y: e.clientY - bounds.top });
    const g = gesture.current; if (!g) return;
    const a = g.a + e.clientX - g.x, b = g.b + e.clientY - g.y;
    const patch = g.mode === "move" ? { x: Math.max(12, a), y: Math.max(12, b) } : routeV3ResizeNodeSize(a, b);
    change(d => ({ ...d, nodes: d.nodes.map(n => n.id === g.id ? { ...n, ...patch } : n) }));
  };
  useEffect(() => { const cancel = (e: KeyboardEvent) => { if (e.key === "Escape") setLink(null); }; window.addEventListener("keydown", cancel); return () => window.removeEventListener("keydown", cancel); }, []);
  const plus = (id: string | null) => { const next = crypto.randomUUID(); if (change(d => insertRouteV3Node(d, id, next))) { setLink(null); } };
  const width = Math.max(940, ...graph.nodes.map(n => n.x + routeV3NodeSize(n).width + 64));
  const height = Math.max(580, ...graph.nodes.map(n => n.y + routeV3NodeSize(n).height + 80));
  const incoming = selected ? graph.edges.filter(e => e.to === selected.id).map(e => graph.nodes.find(n => n.id === e.from)!) : [];
  const path = (from: { x: number; y: number }, to: { x: number; y: number }) => `M${from.x},${from.y} L${to.x},${to.y}`;
  const updateOperation = (id: string, patch: Partial<UmlOperation>) => update({ operations: selected?.operations?.map(o => o.id === id ? { ...o, ...patch } : o) });
  return <div className="route-v3-graph">
    <div className="route-v3-graph-toolbar"><button className="secondary-action" onClick={() => plus(null)}>+ Добавить карточку</button><span>{graph.nodes.length} карточек · {graph.edges.length} связей · {time(graph.nodes.reduce((s, n) => s + minutes(n), 0))} мин</span>{link && <><span role="status">Выберите верхнюю точку другой карточки</span><button onClick={() => setLink(null)}>Отменить связь</button></>}</div>
    {error && <p role="alert" className="route-v3-error">{error}</p>}
    <div className="route-v3-route-scroll"><div ref={canvas} className="route-v3-route-grid" style={{ width, height }} onPointerMove={move} onPointerUp={() => { gesture.current = null; }} onPointerCancel={() => { gesture.current = null; }}>
      <svg className="route-v3-graph-edges" width={width} height={height} aria-label="Зависимости полуфабрикатов"><defs><marker id="v3-graph-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8Z" /></marker></defs>{graph.edges.map(edge => {
        const from = graph.nodes.find(n => n.id === edge.from)!, to = graph.nodes.find(n => n.id === edge.to)!;
        const a = routeV3ConnectionPort(from, "bottom"), b = routeV3ConnectionPort(to, "top");
        const title = `${from.title} → ${to.title}`;
        return <g key={edge.id}><path d={path(a, b)} markerEnd="url(#v3-graph-arrow)" /><path className="route-v3-edge-hit" d={path(a, b)} onClick={() => setDeleting({ kind: "edge", id: edge.id, title })} /><foreignObject x={(a.x + b.x) / 2 + 32} y={(a.y + b.y) / 2 - 12} width="26" height="26"><button className="route-v3-edge-delete" aria-label={`Удалить связь ${title}`} onClick={() => setDeleting({ kind: "edge", id: edge.id, title })}>×</button></foreignObject></g>;
      })}{link && graph.nodes.some(n => n.id === link.id) && <path className="route-v3-link-preview" d={path(routeV3ConnectionPort(graph.nodes.find(n => n.id === link.id)!, "bottom"), link)} markerEnd="url(#v3-graph-arrow)" />}</svg>
      {graph.nodes.map(node => <article key={node.id} data-node-id={node.id} className={`route-v3-node route-v3-editable-node ${node.kind}`} style={{ left: node.x, top: node.y, ...routeV3NodeSize(node) }}>
        <button className={`route-v3-port top ${link ? "target" : ""}`} aria-label={`Верхняя точка ${node.title}`} onClick={() => { if (link && change(d => connectRouteV3(d, link.id, node.id, crypto.randomUUID()))) setLink(null); }} />
        <button className="route-v3-card-heading" aria-label={`Переместить ${node.title}`} onPointerDown={e => begin(e, node, "move")}><span className="route-v3-node-kicker">{node.kind === "final" ? "ФИНАЛ" : node.kind === "assembly" ? "СБОРКА" : "ПОЛУФАБРИКАТ"}</span><strong>{node.title}</strong><small>{node.refs.length} комплектующих · {node.quantity ?? 1} шт. · {time(minutes(node))} мин</small></button>
        <button className="route-v3-card-delete" aria-label={`Удалить карточку ${node.title}`} onClick={() => setDeleting({ kind: "node", id: node.id, title: node.title })}>×</button>
        <button className="route-v3-card-content" aria-label={`Просмотреть ${node.title}`} onClick={() => preview(node)}>{artwork(node)}{!node.refs.length && !node.fragmentIds.length && <span>Состав пуст</span>}</button>
        <button className="route-v3-card-settings" onClick={() => { select(node.id); search(""); }}>Настроить карточку</button>
        <button className={`route-v3-port bottom ${link?.id === node.id ? "target" : ""}`} aria-label={`Нижняя точка ${node.title}`} onClick={() => { const p = routeV3ConnectionPort(node, "bottom"); setLink({ id: node.id, x: p.x, y: p.y + 30 }); }} />
        <button className="route-v3-card-plus" aria-label={`Добавить карточку после ${node.title}`} onClick={() => plus(node.id)}>+</button>
        <button className="route-v3-card-resize" aria-label={`Изменить размер ${node.title}`} onPointerDown={e => begin(e, node, "resize")} onKeyDown={e => { const delta = e.key === "ArrowRight" || e.key === "ArrowDown" ? 20 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -20 : 0; if (!delta) return; e.preventDefault(); const s = routeV3NodeSize(node); change(d => ({ ...d, nodes: d.nodes.map(n => n.id === node.id ? { ...n, ...routeV3ResizeNodeSize(s.width + (e.key.includes("Left") || e.key.includes("Right") ? delta : 0), s.height + (e.key.includes("Up") || e.key.includes("Down") ? delta : 0)) } : n) })); }} />
      </article>)}
    </div></div>
    {selected && <Modal label={`Настройки карточки ${selected.title}`} close={() => select(null)}>
      <header className="route-v3-preview-heading"><h3>{selected.title}</h3><button onClick={() => select(null)}>Закрыть</button></header>
      {error && <p role="alert">{error}</p>}
      <div className="route-v2-settings-fields"><label>Название<input value={selected.title} maxLength={512} onChange={e => update({ title: e.target.value || "Карточка" })} /></label><label>Количество, шт.<input type="number" min="1" value={selected.quantity ?? 1} onChange={e => update({ quantity: Math.max(1, Number(e.target.value) || 1) })} /></label><button className="secondary-action" onClick={() => editDrawing(selected)}>Открыть редактор рисунка</button></div>
      <section className="route-v2-settings-section"><h4>Состав карточки · {selected.refs.length}</h4><RouteV2CompositionTable node={{ ...selected, quantity: selected.quantity ?? 1, operatorConfirmed: !!selected.operatorConfirmed }} document={source} sources={sources} /></section>
      <section className="route-v2-settings-section"><h4>Рисунки полуфабрикатов и фрагменты</h4><button className="route-v3-settings-art" onClick={() => preview(selected)}>{artwork(selected)}</button></section>
      <section className="route-v2-settings-section"><h4>Материалы карточки</h4><input type="search" aria-label="Поиск сырья и полуфабрикатов" value={query} onChange={e => search(e.target.value)} /><div className="route-v2-material-groups"><section><h5>Сырьё</h5><div className="route-v2-source-choices">{sources.filter(s => `${s.title} ${s.material}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(s => <label className="route-v2-ref-choice" key={refKey(s.ref)}><input type="checkbox" aria-label={`Включить сырьё ${s.title}`} checked={(selected.rawRefs ?? selected.refs).some(r => refKey(r) === refKey(s.ref))} onChange={e => update({ rawRefs: e.target.checked ? [...(selected.rawRefs ?? selected.refs), s.ref] : (selected.rawRefs ?? selected.refs).filter(r => refKey(r) !== refKey(s.ref)) })} /><span><strong>{s.title}</strong><small>{routeSourceDesignation(s)}</small></span></label>)}</div></section><section><h5>Полуфабрикаты</h5><div className="route-v2-source-choices">{incoming.filter(n => n.title.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(n => <label className="route-v2-ref-choice" key={n.id}><input type="checkbox" aria-label={`Включить полуфабрикат ${n.title}`} checked={selected.inputNodeIds?.includes(n.id) ?? true} onChange={e => update({ inputNodeIds: e.target.checked ? [...(selected.inputNodeIds ?? []), n.id] : (selected.inputNodeIds ?? incoming.map(i => i.id)).filter(id => id !== n.id) })} /><span><strong>{n.title}</strong><small>{n.refs.length} объектов · {n.quantity ?? 1} шт.</small></span></label>)}{!incoming.length && <p>Подключите входящую карточку стрелкой.</p>}</div></section></div></section>
      <section className="route-v2-settings-section"><h4>Зависимости</h4>{graph.edges.filter(e => e.to === selected.id).map(e => <div className="route-v3-dependency" key={e.id}><span>{graph.nodes.find(n => n.id === e.from)?.title} → {selected.title}</span><button onClick={() => setDeleting({ kind: "edge", id: e.id, title: "Зависимость" })}>Удалить связь</button></div>)}<button onClick={() => { const p = routeV3ConnectionPort(selected, "bottom"); setLink({ id: selected.id, x: p.x, y: p.y + 30 }); select(null); }}>Связать с карточкой</button><button onClick={() => plus(selected.id)}>+ Зависимая сборка</button></section>
      <section className="route-v2-settings-section"><h4>Операции UML · {time(minutes(selected))} мин</h4><button onClick={() => update({ operations: [...(selected.operations ?? []), { id: crypto.randomUUID(), title: "Новая операция", kind: "running", lengthMm: 1000, speedMmPerMinute: 1000, employees: 1, quantity: 1, minutesEach: 1 }] })}>+ Добавить операцию</button>{(selected.operations ?? []).map(op => <div className="route-v3-operation" key={op.id}><input aria-label="Название операции" value={op.title} onChange={e => updateOperation(op.id, { title: e.target.value })} /><select aria-label="Тип операции" value={op.kind} onChange={e => updateOperation(op.id, { kind: e.target.value as UmlOperation["kind"] })}><option value="running">Погонная</option><option value="static">Статичная</option></select>{(op.kind === "running" ? [["lengthMm", "Длина, мм", 0], ["speedMmPerMinute", "Скорость, мм/мин", 1], ["employees", "Сотрудники", 1]] : [["quantity", "Полуфабрикаты, шт.", 0], ["minutesEach", "Минут на единицу", 0]]).map(([key, label, min]) => <label key={key}>{label}<input type="number" min={min} value={op[key as keyof UmlOperation]} onChange={e => updateOperation(op.id, { [String(key)]: Math.max(Number(min), Number(e.target.value) || 0) })} /></label>)}<span>{time(operationMinutes(op))} мин</span><button aria-label={`Удалить операцию ${op.title}`} onClick={() => update({ operations: selected.operations?.filter(o => o.id !== op.id) })}>Удалить</button></div>)}</section>
      {selected.kind === "final" && <label><input type="checkbox" checked={!!selected.operatorConfirmed} onChange={e => update({ operatorConfirmed: e.target.checked })} />Оператор подтверждает завершение маршрута</label>}
    </Modal>}
    {deleting && <Modal label={deleting.kind === "node" ? "Удалить карточку?" : "Удалить связь?"} close={() => setDeleting(null)}><h3>{deleting.kind === "node" ? "Удалить карточку?" : "Удалить связь?"}</h3><p>{deleting.title}</p><p>Состав зависимых карточек будет пересчитан.</p>{error && <p role="alert">{error}</p>}<button onClick={() => setDeleting(null)}>Отмена</button><button onClick={() => { if (change(d => deleting.kind === "node" ? deleteRouteV3Node(d, deleting.id) : deleteRouteV3Edge(d, deleting.id))) { if (link?.id === deleting.id) setLink(null); setDeleting(null); } }}>Удалить</button></Modal>}
  </div>;
}
