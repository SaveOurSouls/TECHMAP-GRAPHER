import { InfoHint } from "../InfoHint";
import type { PhysicalTopology } from "./physical-topology";

export function PhysicalCoveringsPanel({ topology: t, selectedIds, onChange, onReveal }: {
  topology: PhysicalTopology; selectedIds: readonly string[]; onChange: (t: PhysicalTopology) => boolean; onReveal: (id: string) => void;
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
      <label>Ширина<input aria-label="Ширина оболочки" type="number" min="1" max="200" value={selected.width} onChange={e => update({ width: Number(e.target.value) })} /></label>
      <label>Цвет<input aria-label="Цвет оболочки" type="color" value={selected.color} onChange={e => update({ color: e.target.value })} /></label>
      <label>Длина, мм<input aria-label="Длина защиты, мм" type="number" min="0" step="0.001" value={selected.lengthMm ?? ""} onChange={e => update({ lengthMm: e.target.value === "" ? null : Number(e.target.value) })} /></label>
      <small>{selected.material?.displayName ?? "Графическая оболочка · без материала"}</small>
      {selected.spans.map(span => <div className="he-physical-fields" key={span.segmentId}><span>S{t.segments.findIndex(s => s.id === span.segmentId) + 1}</span>
        {(["from", "to"] as const).map(key => <label key={key}>{key === "from" ? "От, %" : "До, %"}<input aria-label={`${key === "from" ? "Начало" : "Конец"} покрытия ${span.segmentId}`} type="number" min="0" max="100" step="0.1" value={Math.round(span[key] * 1000) / 10} onChange={e => update({ spans: selected.spans.map(s => s.segmentId === span.segmentId ? { ...s, [key]: Number(e.target.value) / 100 } : s) })} /></label>)}
      </div>)}
      <button className="ui-control" type="button" onClick={() => onChange({ ...t, coverings: t.coverings?.filter(c => c.id !== selected.id) })}>Удалить оболочку</button>
    </div>}
  </details></section>;
}
