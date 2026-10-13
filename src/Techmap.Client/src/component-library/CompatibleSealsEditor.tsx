import { useEffect, useState } from "react";
import type { CompatibleSealV5 } from "./template-model-v5";
import { InfoHint } from "../InfoHint";

export const EMPTY_COMPATIBLE_SEAL: CompatibleSealV5 = Object.freeze({
  article: "", color: "", section: "", insulationDiameter: "",
});

function newSeal(index: number): CompatibleSealV5 {
  return { article: `Уплотнитель-${index + 1}`, color: "Не задан", section: "Не задано", insulationDiameter: "Не задан" };
}

function SealCell({ value, label, onCommit }: { readonly value: string; readonly label: string; readonly onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return <input aria-label={label} value={draft} maxLength={512}
    onChange={event => setDraft(event.currentTarget.value)}
    onBlur={() => { if (!draft.trim()) setDraft(value); else if (draft.trim() !== value) onCommit(draft.trim()); }}
    onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} />;
}

export function CompatibleSealsEditor({ seals, disabled, onChange }: {
  readonly seals: readonly CompatibleSealV5[];
  readonly disabled?: boolean;
  readonly onChange: (seals: readonly CompatibleSealV5[]) => void;
}) {
  const update = (index: number, patch: Partial<CompatibleSealV5>) => {
    const next = seals.map((seal, candidateIndex) => candidateIndex === index ? { ...seal, ...patch } : { ...seal });
    onChange(next);
  };
  return <section className="series-v3-compatible-seals" aria-label="Совместимые уплотнители">
    <header><div><strong>Совместимые уплотнители</strong><InfoHint>Укажите позиции, которые можно выбрать в строках таблицы Э4 этой серии.</InfoHint></div>
      <button type="button" disabled={disabled} onClick={() => onChange([...seals, newSeal(seals.length)])}>+ Уплотнитель</button></header>
    {seals.length === 0 ? <p>Совместимые уплотнители пока не заданы.</p> : <div className="series-v3-seal-list">
      {seals.map((seal, index) => <div className="series-v3-seal-row" key={`${seal.article}:${index}`}>
        <label className="series-v3-seal-field">Артикул<SealCell value={seal.article} label={`Артикул уплотнителя ${index + 1}`} onCommit={article => update(index, { article })} /></label>
        <label className="series-v3-seal-field">Цвет<SealCell value={seal.color} label={`Цвет уплотнителя ${index + 1}`} onCommit={color => update(index, { color })} /></label>
        <label className="series-v3-seal-field">Сечение<SealCell value={seal.section} label={`Сечение уплотнителя ${index + 1}`} onCommit={section => update(index, { section })} /></label>
        <label className="series-v3-seal-field">Диаметр изоляции<SealCell value={seal.insulationDiameter} label={`Диаметр изоляции уплотнителя ${index + 1}`} onCommit={insulationDiameter => update(index, { insulationDiameter })} /></label>
        <button type="button" className="series-v3-remove-seal" disabled={disabled} aria-label={`Удалить уплотнитель ${index + 1}`}
          onClick={() => onChange(seals.filter((_, candidateIndex) => candidateIndex !== index))}>×</button>
      </div>)}</div>}
  </section>;
}
