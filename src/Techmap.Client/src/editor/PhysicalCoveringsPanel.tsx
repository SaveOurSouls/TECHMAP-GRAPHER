import { InfoHint } from "../InfoHint";
import type { PhysicalTopology } from "./physical-topology-model";
import type { HarnessDesignDocument } from "./model";
import { coveringMeasuredLength, coveringControlFractions, coveringKind, resolvedCoveringSpan, type CoveringKind } from "./physical-coverings";

export function PhysicalCoveringsPanel({ document, topology: t, selectedIds, onChange, onReveal }: {
  document: HarnessDesignDocument; topology: PhysicalTopology; selectedIds: readonly string[]; onChange: (t: PhysicalTopology) => boolean; onReveal: (id: string) => void;
}) {
  const segments = t.segments.filter(s => selectedIds.includes(s.id));
  const selected = t.coverings?.find(c => selectedIds.includes(c.id));
  const update = (patch: Partial<NonNullable<PhysicalTopology["coverings"]>[number]>) => selected && onChange({ ...t, coverings: t.coverings?.map(c => c.id === selected.id ? { ...c, ...patch } : c) });
  return <section className="he-relations" aria-label="Оболочки и защита"><details open={!!selected}>
    <summary>Оболочки и защита · {t.coverings?.length ?? 0}</summary>
    <header className="ui-section-heading"><InfoHint>Выберите участки и создайте общую оболочку. Для материала защиты дважды щёлкните позицию каталога «Защита»: тип protective-covering в универсальном справочнике. Начало и конец — проценты каждого участка. Ширина условная; расход задаётся отдельной длиной в миллиметрах. Разветвление сохраняет покрытые интервалы.</InfoHint><button className="ui-control" type="button" disabled={!segments.length} onClick={() => onChange({ ...t, coverings: [...t.coverings ?? [], { id: crypto.randomUUID(), name: "Оболочка", width: 14, color: "#84959f", lengthMm: null, spans: segments.map(s => ({ segmentId: s.id, from: 0, to: 1 })) }] })}>Оболочка +</button></header>
    {t.coverings?.map(c => <button key={c.id} type="button" className="ui-control" aria-pressed={selected?.id === c.id} onClick={() => onReveal(c.id)}>{c.name}</button>)}
    {selected && <div className="he-physical-fields">
      <label>Название<input aria-label="Название оболочки" value={selected.name} onChange={e => update({ name: e.target.value })} /></label>
      <label>Тип<select aria-label="Тип покрытия" value={coveringKind(selected)} onChange={e=>update({kind:e.target.value as CoveringKind})}>{([['heat-shrink','Термоусадка'],['nylon','Нейлонка'],['braid','Оплётка'],['metal-braid','Металлическая плетёнка'],['tape','Обмотка'],['band','Нитевый бандаж']] as const).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
      <label>Цвет<input aria-label="Цвет оболочки" type="color" value={selected.color} onChange={e => update({ color: e.target.value })} /></label>
      <label><input type="checkbox" checked={selected.lengthMode==='manual'||selected.lengthMode===undefined&&selected.lengthMm!==null} onChange={e=>update({lengthMode:e.target.checked?'manual':'auto'})}/>Длина вручную</label>
      <label>Длина, мм<input aria-label="Длина защиты, мм" type="number" min="0" step="0.001" value={coveringMeasuredLength(document,selected) ?? ""} onChange={e => update({ lengthMode:'manual', lengthMm: e.target.value === "" ? null : Number(e.target.value) })} /></label>
      <small>Тяните поверхность вдоль пайпа, торцы — для растяжения. Зелёный торец привязан к точке. Два привязанных торца берут длину из размеров пайпа.</small>
      <small>{selected.material?.displayName ?? "Графическая оболочка · без материала"}</small>
      {selected.spans.map(span => <div className="he-physical-fields" key={span.segmentId}><span>S{t.segments.findIndex(s => s.id === span.segmentId) + 1}</span>
        {(["from", "to"] as const).map(key => <label key={key}>{key === "from" ? "Начало" : "Конец"}<select aria-label={`${key === "from" ? "Привязка начала" : "Привязка конца"} покрытия ${span.segmentId}`} value={span[key==='from'?'fromAnchor':'toAnchor']??'free'} onChange={e=>update({spans:selected.spans.map(s=>s===span?{...resolvedCoveringSpan(document,s),[key==='from'?'fromAnchor':'toAnchor']:e.target.value==='free'?undefined:Number(e.target.value)}:s)})}><option value="free">Свободно</option>{coveringControlFractions(document,span.segmentId).map((f,i)=><option key={i} value={i} disabled={key==='from'?f>=resolvedCoveringSpan(document,span).to:f<=resolvedCoveringSpan(document,span).from}>Точка {i+1}</option>)}</select></label>)}
      </div>)}
      <button className="ui-control" type="button" onClick={() => onChange({ ...t, coverings: t.coverings?.filter(c => c.id !== selected.id) })}>Удалить оболочку</button>
      <button className="ui-control" type="button" onClick={()=>onChange({...t,coverings:[...t.coverings?.filter(c=>c.id!==selected.id)??[],selected]})}>Поверх остальных</button>
    </div>}
  </details></section>;
}
