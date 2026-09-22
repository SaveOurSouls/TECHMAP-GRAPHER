import type {EditorTool} from "./editor-types";
import { useEffect, useRef, useState } from "react";
import { InfoHint } from "../InfoHint";
import type { HarnessDesignDocument } from "./model";
import type { DrawingDocuments } from "./drawing-documents";
export function DrawingDimensionsPanel({document,selectedId,onChange,activeTool,onToolChange}:{activeTool?:EditorTool;onToolChange?:(tool:EditorTool)=>void;document:HarnessDesignDocument;selectedId:string|null;onChange:(documents:DrawingDocuments)=>boolean}) {
  const d=document.drawingDocuments,selected=d?.dimensions?.find(d=>d.id===selectedId);
  const dirty=useRef(false);
  const [value,setValue]=useState(""),[invalid,setInvalid]=useState(false);
  useEffect(()=>{setValue(selected?.lengthMm===null||selected?.lengthMm===undefined?"":String(selected.lengthMm));setInvalid(false);dirty.current=false;},[selected?.id,selected?.lengthMm]);
  const edit=(patch:Partial<NonNullable<typeof selected>>)=>!!d&&!!selected&&onChange({...d,dimensions:d.dimensions?.map(item=>item.id===selected.id?{...item,...patch}:item)});
  const commit=()=>{if(!dirty.current)return;const number=value.trim()===""?null:Number(value.replace(",","."));if(number!==null&&!Number.isFinite(number)){setInvalid(true);return;}const accepted=edit({lengthMm:number});setInvalid(!accepted);if(accepted)dirty.current=false;};
  return <section className="he-relations" aria-label="Размеры чертежа"><header className="ui-section-heading"><strong>Размеры</strong><InfoHint>Выберите горизонтальный, вертикальный или свободный размер, затем два узла или перегиба одного пайпа. Его длина учитывается у всех проходящих проводов; размеры отдельных участков суммируются. Все пайпы маршрута должны быть измерены. Длина считается между общими выходами соединителей; индивидуальные добавки задаются поправками начала/конца провода. Для провода без пайпа можно выбрать его точки. Размер задаёт физическую длину выбранного участка; ориентация меняет вынос линии. Общий размер между концами задаёт всю длину. Без общего размера суммируются только полностью покрывающие провод непересекающиеся участки. Пропуски оставляют длину неизвестной. Изменение числа перегибов снимает прежние привязки; доступна отмена Ctrl+Z. Миллиметры не вычисляются из пикселей.</InfoHint></header>
    <div role="group" aria-label="Создать размер" style={{display:"flex",gap:6}}>{([ ["dimension-horizontal","Горизонтальный размер","↔"],["dimension-vertical","Вертикальный размер","↕"],["dimension","Свободный размер","⤢"] ] as const).map(([tool,label,glyph])=><button type="button" className="ui-control" key={tool} aria-label={label} title={label} aria-pressed={activeTool===tool} onClick={()=>onToolChange?.(tool)} style={{minWidth:36,minHeight:32}}>{glyph}</button>)}</div>
    {selected?<><label>Длина, мм<input autoFocus aria-label="Размер, мм" inputMode="decimal" value={value} aria-invalid={invalid} onChange={e=>{dirty.current=true;setValue(e.target.value);setInvalid(false);}} onBlur={commit} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();commit();}}}/></label>{invalid&&<small role="alert">Проверьте длину и перекрытие участков.</small>}
      <label>Вынос<input type="number" aria-label="Вынос размера" value={selected.offset} onChange={e=>edit({offset:Number(e.target.value)})}/></label>
      <button type="button" className="ui-control" onClick={()=>d&&onChange({...d,dimensions:d.dimensions?.filter(item=>item.id!==selected.id)})}>Удалить размер</button>
      <small>{selected.from===0&&selected.to===selected.pointCount-1?"Общая длина":"Участок"} · {selected.segmentId?`Пайп S${(document.physicalTopology?.segments.findIndex(s=>s.id===selected.segmentId)??-1)+1}`:document.wires.find(w=>w.id===selected.wireId)?.circuit||selected.wireId}</small>
    </>:<small>↔ · ↕ · ⤢ — выберите узлы или перегибы пайпа</small>}
  </section>;
}
