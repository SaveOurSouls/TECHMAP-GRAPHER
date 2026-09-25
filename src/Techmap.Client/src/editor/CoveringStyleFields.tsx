import { DraftNumberInput } from "../component-library/DraftNumberInput";
import { InfoHint } from "../InfoHint";
import { resolvedCoveringStyle,type CoveringStyle } from "./covering-style";
import {useState} from "react";
import {textureChoices,type CoveringLibrary} from "./covering-library";
import type {CoveringKind} from "./physical-coverings";

const colors=["#27445a","#000000","#111827","#6b7280","#ffffff","#dc2626","#f59e0b","#16a34a","#2563eb","#7c3aed"];
function ColorField({label,value,onChange}:{label:string;value:string;onChange:(value:string)=>void}) {
  return <label>{label}<input type="color" aria-label={label} value={value} onChange={e=>onChange(e.target.value)}/>
    <span className="he-material-colors">{colors.map(color=><button key={color} type="button" aria-label={`${label}: ${color}`} title={color} style={{background:color}} onClick={()=>onChange(color)}/>)}</span></label>;
}
export function CoveringStyleFields({style,color,library,kind,onChange,onColorChange}:{style?:CoveringStyle;color:string;library?:CoveringLibrary;kind?:CoveringKind;onChange:(style:CoveringStyle)=>void;onColorChange:(color:string)=>void}) {
  const [all,setAll]=useState(false);
  const value=resolvedCoveringStyle(style),edit=(patch:CoveringStyle)=>onChange({...style,...patch});
  const preferred=library?.defaults[kind??"braid"]?.texture??"auto",options=textureChoices(library);
  const available=all?options:[...options.filter(t=>t.value===preferred),...options.filter(t=>t.value!==preferred&&(t.value===value.texture||t.value==="none"||t.value==="auto"))];
  return <details className="he-covering-style"><summary>Текстура и штриховка</summary><div className="he-context-fields">
    <label>Текстура<select aria-label="Текстура оболочки" value={value.texture} onChange={e=>edit({texture:e.target.value as CoveringStyle['texture']})}>
      {!available.some(t=>t.value===value.texture)&&<option value={value.texture}>Текстура вне списка</option>}{available.map(t=><option key={t.value} value={t.value}>{t.label}{t.value===preferred?" · предпочтительная":""}</option>)}
    </select><button type="button" className="ui-control" aria-expanded={all} onClick={()=>setAll(!all)}>{all?"Предпочтительные":"Все текстуры"}</button></label><label>Масштаб текстуры<DraftNumberInput aria-label="Масштаб текстуры" min={.1} max={10} step={.1} immediate value={value.textureScale} onValueChange={textureScale=>edit({textureScale})}/></label>
    <label>Угол текстуры, °<DraftNumberInput aria-label="Угол текстуры" min={-180} max={180} step={15} immediate value={value.textureRotation} onValueChange={textureRotation=>edit({textureRotation})}/></label>
    <label>Штриховка<select aria-label="Штриховка оболочки" value={value.hatch} onChange={e=>edit({hatch:e.target.value as CoveringStyle['hatch']})}>
      <option value="none">Нет</option><option value="parallel">Параллельная</option><option value="cross">Перекрёстная</option><option value="dots">Точки</option>
    </select></label>
    <ColorField label="Цвет фона" value={color} onChange={onColorChange}/><ColorField label="Цвет контура" value={value.lineColor} onChange={lineColor=>edit({lineColor})}/>
    {value.hatch!=="none"&&<><ColorField label="Цвет штриховки" value={value.hatchColor} onChange={hatchColor=>edit({hatchColor})}/>
      <label>Шаг штриховки<DraftNumberInput aria-label="Шаг штриховки" min={1} max={100} step="any" immediate value={value.hatchSpacing} onValueChange={hatchSpacing=>edit({hatchSpacing})}/></label>
      <label>Угол штриховки, °<DraftNumberInput aria-label="Угол штриховки" min={-180} max={180} step={15} immediate value={value.hatchRotation} onValueChange={hatchRotation=>edit({hatchRotation})}/></label></>}
    <InfoHint>Фон, штриховка и контур независимы. Текстура повторяется по всей поверхности; «Без текстуры» оставляет чистую заливку и штриховку. Масштаб и углы не меняют размеры материала.</InfoHint>
  </div></details>;
}
