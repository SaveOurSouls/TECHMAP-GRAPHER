import { useState } from "react";
import { InfoHint } from "../InfoHint";
import type { HarnessDesignDocument } from "./model";
import { emptyPhysicalTopology, physicalSegmentPoints, splitPhysicalSegment, type PhysicalStep, type PhysicalTopology } from "./physical-topology";

export function PhysicalTopologyPanel({ document, selectedIds, selectedId, onChange, onSelect }: {
  document: HarnessDesignDocument; selectedIds: readonly string[]; selectedId: string | null;
  onChange: (topology: PhysicalTopology) => boolean; onSelect: (id: string, additive?: boolean) => void;
}) {
  const t = document.physicalTopology ?? emptyPhysicalTopology();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [steps, setSteps] = useState<PhysicalStep[]>([]);
  const selected = t.segments.find(s => s.id === selectedId);
  const node = t.nodes.find(n => n.id === selectedId);
  const wires = selectedIds.filter(id => document.wires.some(w => w.id === id));
  const label = (id: string) => document.connectors.find(c => c.id === t.nodes.find(n => n.id === id)?.connectorId)?.designation ?? `Узел ${t.nodes.findIndex(n => n.id === id) + 1}`;
  const addNode = () => {
    const connector = document.connectors.find(c => selectedIds.includes(c.id));
    const existing = connector && t.nodes.find(n => n.connectorId === connector.id);
    if (existing) { onSelect(existing.id); return; }
    const id = crypto.randomUUID();
    if (onChange({ ...t, nodes: [...t.nodes, { id, position: connector ? { x: 170, y: 60 } : { x: 250 + t.nodes.length * 30, y: 250 }, ...(connector ? { connectorId: connector.id } : {}) }] })) onSelect(id);
  };
  return <section className="he-relations" aria-label="Физические ветви">
    <header className="ui-section-heading"><strong>Ветви · {t.segments.length}</strong><InfoHint>Выберите соединитель и добавьте общий выход, либо создайте свободный узел. Соедините узлы участками. Двойной клик добавляет перегиб выбранному участку; его точки перетаскиваются. «Разветвить» закрепляет существующий перегиб как узел. Соберите порядок участков и назначьте выбранным проводам от конца A к B. Общий выход не соединяет контакты электрически. Координаты не меняют физическую длину.</InfoHint></header>
    <div className="he-relations-actions"><button className="ui-control" type="button" onClick={addNode}>Узел / выход</button></div>
    <div className="he-physical-fields"><select aria-label="Начало участка" value={from} onChange={e => setFrom(e.target.value)}><option value="">От узла</option>{t.nodes.map(n => <option key={n.id} value={n.id}>{label(n.id)}</option>)}</select>
      <select aria-label="Конец участка" value={to} onChange={e => setTo(e.target.value)}><option value="">До узла</option>{t.nodes.map(n => <option key={n.id} value={n.id}>{label(n.id)}</option>)}</select>
      <button className="ui-control" type="button" disabled={!from || !to || from === to} onClick={() => { const id = crypto.randomUUID(); if (onChange({ ...t, segments: [...t.segments, { id, from, to, bends: [] }] })) onSelect(id); }}>Участок +</button></div>
    {node && <div className="he-physical-fields"><strong>{label(node.id)}</strong>{(["x", "y"] as const).map(axis => <label key={axis}>{axis.toUpperCase()}<input aria-label={`Узел ${axis}`} type="number" value={node.position[axis]} onChange={e => onChange({ ...t, nodes: t.nodes.map(n => n.id === node.id ? { ...n, position: { ...n.position, [axis]: Number(e.target.value) } } : n) })} /></label>)}
      <button className="ui-control" type="button" disabled={t.segments.some(s => s.from === node.id || s.to === node.id)} onClick={() => onChange({ ...t, nodes: t.nodes.filter(n => n.id !== node.id) })}>Удалить узел</button></div>}
    <details open={!!selected}><summary>Участки и маршрут</summary>
      <div className="he-physical-list">{t.segments.map((s, i) => <div key={s.id} className="he-relations-actions">
        <button className="ui-control" type="button" aria-pressed={selectedIds.includes(s.id)} onClick={e => onSelect(s.id,e.ctrlKey || e.shiftKey)}>S{i + 1} · {label(s.from)} → {label(s.to)}</button>
        <button className="ui-control" type="button" aria-label={`Добавить S${i + 1} вперёд`} onClick={() => setSteps([...steps, { segmentId: s.id, reverse: false }])}>→</button>
        <button className="ui-control" type="button" aria-label={`Добавить S${i + 1} обратно`} onClick={() => setSteps([...steps, { segmentId: s.id, reverse: true }])}>←</button>
      </div>)}</div>
      {selected && <><div className="he-relations-actions"><button className="ui-control" type="button" onClick={() => onChange({ ...t, coverings: t.coverings?.map(c=>({...c,spans:c.spans.filter(s=>s.segmentId!==selected.id)})).filter(c=>c.spans.length), segments: t.segments.filter(s => s.id !== selected.id), routes: t.routes.filter(r => !r.steps.some(step => step.segmentId === selected.id)) })}>Удалить участок</button></div>
        {physicalSegmentPoints(document, selected).slice(1, -1).map((p, i) => <div className="he-relations-actions" key={i}><span>Перегиб {i + 1} · {Math.round(p.x)}, {Math.round(p.y)}</span><button className="ui-control" type="button" onClick={() => { const id = crypto.randomUUID(); if (onChange(splitPhysicalSegment(document, selected.id, i + 1, id, crypto.randomUUID()))) onSelect(id); }}>Разветвить</button></div>)}</>}
      <small>{steps.map(s => `${s.reverse ? "←" : "→"}S${t.segments.findIndex(segment => segment.id === s.segmentId) + 1}`).join(" · ") || "Маршрут не набран"}</small>
      <div className="he-relations-actions"><button className="ui-control" type="button" disabled={!wires.length || !steps.length} onClick={() => { if (onChange({ ...t, routes: [...t.routes.filter(r => !wires.includes(r.wireId)), ...wires.map(wireId => ({ wireId, steps }))] })) setSteps([]); }}>Назначить ({wires.length})</button><button className="ui-control" type="button" onClick={() => setSteps([])}>Очистить набор</button>
        <button className="ui-control" type="button" disabled={!wires.length} onClick={() => onChange({ ...t, routes: t.routes.filter(r => !wires.includes(r.wireId)) })}>Снять маршрут</button></div>
      {wires.map(id => <small key={id}>{document.wires.find(w => w.id === id)?.circuit || id}: {t.routes.find(r => r.wireId === id)?.steps.map(s => `S${t.segments.findIndex(segment => segment.id === s.segmentId) + 1}`).join(" → ") || "Маршрут не задан"}</small>)}
    </details>
  </section>;
}
