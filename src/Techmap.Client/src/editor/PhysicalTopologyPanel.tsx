import {DraftNumberInput} from "../component-library/DraftNumberInput";
import { useState } from "react";
import { InfoHint } from "../InfoHint";
import type { HarnessDesignDocument } from "./model";
import { emptyPhysicalTopology, physicalSegmentPoints, routePhysicalWires, splitPhysicalSegment, type PhysicalStep, type PhysicalTopology } from "./physical-topology";

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
  const label = (id:string)=>{const n=t.nodes.find(n=>n.id===id),c=document.connectors.find(c=>c.id===n?.connectorId);return c?`${c.designation} · выход ${t.nodes.filter(n=>n.connectorId===c.id).findIndex(n=>n.id===id)+1}`:`Узел ${t.nodes.findIndex(n=>n.id===id)+1}`;};
  const addNode = (additional=false) => {
    const connector = document.connectors.find(c => selectedIds.includes(c.id));
    const existing = connector && t.nodes.find(n => n.connectorId === connector.id);
    if (existing&&!additional) { onSelect(existing.id); return; }
    const id = crypto.randomUUID();
    if (onChange({ ...t, nodes: [...t.nodes, { id, position: connector ? { x: 170, y: 60+40*t.nodes.filter(n=>n.connectorId===connector.id).length } : { x: 250 + t.nodes.length * 30, y: 250 }, ...(connector ? { connectorId: connector.id } : {}) }] })) onSelect(id);
  };
  return <section className="he-relations" aria-label="Физические ветви">
    <header className="ui-section-heading"><strong>Ветви · {t.segments.length}</strong><InfoHint>Выберите соединитель и добавьте общий выход, либо создайте свободный узел. Соедините узлы участками. Двойной клик добавляет перегиб выбранному участку; его точки перетаскиваются. «Разветвить» закрепляет существующий перегиб как узел. «Распределить по Э4» находит кратчайшие пути по созданным каналам. Вручную назначенные маршруты остаются закреплены. Для второго выхода выберите разъём и «Ещё выход». В свойствах выхода можно указать его провода. Правый клик по каналу создаёт Т-ответвление; свободный конец достраивается до нужного выхода. Общий выход не соединяет контакты электрически. Координаты не меняют физическую длину.</InfoHint></header>
    <div className="he-relations-actions"><button className="ui-control" type="button" onClick={()=>addNode()}>Узел / выход</button><button className="ui-control" type="button" disabled={!document.connectors.some(c=>selectedIds.includes(c.id))} onClick={()=>addNode(true)}>Ещё выход +</button><button className="ui-control" type="button" onClick={()=>onChange(routePhysicalWires(document,t))}>Распределить по Э4</button></div>
    <div className="he-physical-fields"><select aria-label="Начало участка" value={from} onChange={e => setFrom(e.target.value)}><option value="">От узла</option>{t.nodes.map(n => <option key={n.id} value={n.id}>{label(n.id)}</option>)}</select>
      <select aria-label="Конец участка" value={to} onChange={e => setTo(e.target.value)}><option value="">До узла</option>{t.nodes.map(n => <option key={n.id} value={n.id}>{label(n.id)}</option>)}</select>
      <button className="ui-control" type="button" disabled={!from || !to || from === to} onClick={() => { const id = crypto.randomUUID(); if (onChange(routePhysicalWires(document,{ ...t, segments: [...t.segments, { id, from, to, bends: [] }] }))) onSelect(id); }}>Участок +</button></div>
    {node && <div className="he-physical-fields"><strong>{label(node.id)}</strong>{(["x", "y"] as const).map(axis => <label key={axis}>{axis.toUpperCase()}<input aria-label={`Узел ${axis}`} type="number" value={node.position[axis]} onChange={e => onChange({ ...t, nodes: t.nodes.map(n => n.id === node.id ? { ...n, position: { ...n.position, [axis]: Number(e.target.value) } } : n) })} /></label>)}
      {node.connectorId&&<details><summary>Провода этого выхода</summary>{document.wires.filter(w=>w.from.connectorId===node.connectorId||w.to.connectorId===node.connectorId).map(w=><label key={w.id}><input type="checkbox" checked={!node.wireIds||node.wireIds.includes(w.id)} onChange={e=>{const all=node.wireIds??document.wires.filter(w=>w.from.connectorId===node.connectorId||w.to.connectorId===node.connectorId).map(w=>w.id);onChange(routePhysicalWires(document,{...t,nodes:t.nodes.map(n=>n.id===node.id?{...n,wireIds:e.target.checked?[...all,w.id]:all.filter(id=>id!==w.id)}:n)}));}}/>{w.circuit||w.id}</label>)}</details>}
      {!node.connectorId&&<select aria-label="Достроить ветвь до выхода" value="" onChange={e=>{const target=e.target.value;if(target)onChange(routePhysicalWires(document,{...t,segments:[...t.segments,{id:crypto.randomUUID(),from:node.id,to:target,bends:[]}]}));}}><option value="">Достроить до выхода…</option>{t.nodes.filter(n=>n.connectorId).map(n=><option key={n.id} value={n.id}>{label(n.id)}</option>)}</select>}
      <button className="ui-control" type="button" disabled={t.segments.some(s => s.from === node.id || s.to === node.id)} onClick={() => onChange({ ...t, nodes: t.nodes.filter(n => n.id !== node.id) })}>Удалить узел</button></div>}
    <details open={!!selected}><summary>Участки и маршрут</summary>
      <div className="he-physical-list">{t.segments.map((s, i) => <div key={s.id} className="he-relations-actions">
        <button className="ui-control" type="button" aria-pressed={selectedIds.includes(s.id)} onClick={e => onSelect(s.id,e.ctrlKey || e.shiftKey)}>S{i + 1} · {label(s.from)} → {label(s.to)}</button>
        <button className="ui-control" type="button" aria-label={`Добавить S${i + 1} вперёд`} onClick={() => setSteps([...steps, { segmentId: s.id, reverse: false }])}>→</button>
        <button className="ui-control" type="button" aria-label={`Добавить S${i + 1} обратно`} onClick={() => setSteps([...steps, { segmentId: s.id, reverse: true }])}>←</button>
      </div>)}</div>
      {selected && <><div className="he-physical-fields"><label>Ширина канала<DraftNumberInput aria-label="Ширина канала" min={4} max={200} value={selected.width??16} onValueChange={width=>onChange({...t,segments:t.segments.map(s=>s.id===selected.id?{...s,width}:s)})}/></label><label>Цвет<input aria-label="Цвет канала" type="color" value={selected.color??"#aebfc9"} onChange={e=>onChange({...t,segments:t.segments.map(s=>s.id===selected.id?{...s,color:e.target.value}:s)})}/></label><label><input type="checkbox" checked={selected.showWires!==false} onChange={e=>onChange({...t,segments:t.segments.map(s=>s.id===selected.id?{...s,showWires:e.target.checked}:s)})}/>Проводники Э4</label><label>Артикул из спецификации<select aria-label="Позиция оболочки канала" value={selected.specificationItemId??""} onChange={e=>onChange({...t,segments:t.segments.map(s=>s.id===selected.id?{...s,specificationItemId:e.target.value||undefined}:s)})}><option value="">Не назначен</option>{document.drawingDocuments?.specificationItems?.map(i=><option key={i.id} value={i.id}>{i.designation||i.name}</option>)}</select></label></div><div className="he-relations-actions"><button className="ui-control" type="button" onClick={() => onChange({ ...t, coverings: t.coverings?.map(c=>({...c,spans:c.spans.filter(s=>s.segmentId!==selected.id)})).filter(c=>c.spans.length), segments: t.segments.filter(s => s.id !== selected.id), routes: t.routes.filter(r => !r.steps.some(step => step.segmentId === selected.id)) })}>Удалить участок</button></div>
        {physicalSegmentPoints(document, selected).slice(1, -1).map((p, i) => <div className="he-relations-actions" key={i}><span>Перегиб {i + 1} · {Math.round(p.x)}, {Math.round(p.y)}</span><button className="ui-control" type="button" onClick={() => { const id = crypto.randomUUID(); if (onChange(splitPhysicalSegment(document, selected.id, i + 1, id, crypto.randomUUID()))) onSelect(id); }}>Разветвить</button></div>)}</>}
      <small>{steps.map(s => `${s.reverse ? "←" : "→"}S${t.segments.findIndex(segment => segment.id === s.segmentId) + 1}`).join(" · ") || "Маршрут не набран"}</small>
      <div className="he-relations-actions"><button className="ui-control" type="button" disabled={!wires.length || !steps.length} onClick={() => { if (onChange({ ...t, routes: [...t.routes.filter(r => !wires.includes(r.wireId)), ...wires.map(wireId => ({ wireId, steps }))] })) setSteps([]); }}>Назначить ({wires.length})</button><button className="ui-control" type="button" onClick={() => setSteps([])}>Очистить набор</button>
        <button className="ui-control" type="button" disabled={!wires.length} onClick={() => onChange({ ...t, routes: t.routes.filter(r => !wires.includes(r.wireId)) })}>Снять маршрут</button></div>
      {wires.map(id => <small key={id}>{document.wires.find(w => w.id === id)?.circuit || id}: {t.routes.find(r => r.wireId === id)?.steps.map(s => `S${t.segments.findIndex(segment => segment.id === s.segmentId) + 1}`).join(" → ") || "Маршрут не задан"}</small>)}
    </details>
  </section>;
}
