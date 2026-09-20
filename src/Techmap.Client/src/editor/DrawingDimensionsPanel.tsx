import { useEffect, useState } from "react";
import { InfoHint } from "../InfoHint";
import type { HarnessDesignDocument } from "./model";
import type { DrawingDocuments } from "./drawing-documents";
export function DrawingDimensionsPanel({document,selectedId,onChange}:{document:HarnessDesignDocument;selectedId:string|null;onChange:(documents:DrawingDocuments)=>boolean}) {
  const d=document.drawingDocuments,selected=d?.dimensions?.find(d=>d.id===selectedId);
  const [value,setValue]=useState(""),[invalid,setInvalid]=useState(false);
  useEffect(()=>{setValue(selected?.lengthMm===null||selected?.lengthMm===undefined?"":String(selected.lengthMm));setInvalid(false);},[selected?.id,selected?.lengthMm]);
  const edit=(patch:Partial<NonNullable<typeof selected>>)=>!!d&&!!selected&&onChange({...d,dimensions:d.dimensions?.map(item=>item.id===selected.id?{...item,...patch}:item)});
  const commit=()=>{const number=value.trim()===""?null:Number(value.replace(",","."));if(number!==null&&!Number.isFinite(number)){setInvalid(true);return;}setInvalid(!edit({lengthMm:number}));};
  return <section className="he-relations" aria-label="Размеры чертежа"><header className="ui-section-heading"><strong>Размеры</strong><InfoHint>Выберите горизонтальный, вертикальный или свободный размер, затем две точки одного провода: конец или перегиб. Размер задаёт физическую длину выбранного участка; ориентация меняет вынос линии. Общий размер между концами задаёт всю длину. Без общего размера суммируются только полностью покрывающие провод непересекающиеся участки. Пропуски оставляют длину неизвестной. Изменение числа перегибов снимает прежние привязки; доступна отмена Ctrl+Z. Миллиметры не вычисляются из пикселей.</InfoHint></header>
    {selected?<><label>Длина, мм<input autoFocus aria-label="Размер, мм" inputMode="decimal" value={value} aria-invalid={invalid} onChange={e=>{setValue(e.target.value);setInvalid(false);}} onBlur={commit} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();commit();}}}/></label>{invalid&&<small role="alert">Проверьте длину и перекрытие участков.</small>}
      <label>Вынос<input type="number" aria-label="Вынос размера" value={selected.offset} onChange={e=>edit({offset:Number(e.target.value)})}/></label>
      <button type="button" className="ui-control" onClick={()=>d&&onChange({...d,dimensions:d.dimensions?.filter(item=>item.id!==selected.id)})}>Удалить размер</button>
      <small>{selected.from===0&&selected.to===selected.pointCount-1?"Общая длина":"Участок провода"} · {document.wires.find(w=>w.id===selected.wireId)?.circuit||selected.wireId}</small>
    </>:<small>↔ · ↕ · ⤢ — выберите две точки провода</small>}
  </section>;
}
