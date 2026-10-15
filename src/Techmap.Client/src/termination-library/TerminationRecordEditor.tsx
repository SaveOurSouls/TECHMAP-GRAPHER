import {useId,useState} from 'react';
import {parseTerminationRecord,terminationAsset,terminationDimensionFields,type TerminationLibraryRecord,type ConductorRules} from './catalog';
export interface TerminationRecordEditorProps {readonly record:TerminationLibraryRecord;readonly onSave:(record:TerminationLibraryRecord)=>void;readonly onCancel:()=>void;readonly disabled?:boolean}
export function TerminationRecordEditor({record,onSave,onCancel,disabled=false}:TerminationRecordEditorProps){
 const prefix=useId(),[draft,setDraft]=useState(record),[combinations,setCombinations]=useState(record.conductorRules.allowedCombinations.map(x=>x.join(' + ')).join('\n')),[materialsText,setMaterialsText]=useState(record.conductorRules.materials.join(', ')),[error,setError]=useState<string|null>(null);
 const patch=(p:Partial<TerminationLibraryRecord>)=>setDraft(d=>({...d,...p}));
 const rules=(p:Partial<ConductorRules>)=>setDraft(d=>({...d,conductorRules:{...d.conductorRules,...p}}));
 const number=(value:string)=>value.trim()===''?null:Number(value.replace(',','.'));
 const text=(label:string,key:'name'|'manufacturer'|'article'|'material'|'insulation'|'source'|'colorName'|'notes')=><label>{label}<input value={draft[key]??''} maxLength={key==='name'||key==='article'?512:4096} onChange={e=>patch({[key]:e.target.value||null})}/></label>;
 const numeric=(label:string,value:number|null,change:(v:number|null)=>void,negative=false)=><label>{label}<input type="number" step="any" min={negative?undefined:0} placeholder="Неизвестно" value={value??''} onChange={e=>change(number(e.target.value))}/></label>;
 return <form className="termination-record-editor" aria-labelledby={`${prefix}-title`} onSubmit={e=>{e.preventDefault();try{
  const allowedCombinations=combinations.split('\n').map(x=>x.trim()).filter(Boolean).map(line=>line.split('+').map(v=>Number(v.trim().replace(',','.'))));
  const materials=materialsText.split(',').map(s=>s.trim()).filter(Boolean);
  onSave(parseTerminationRecord({...draft,conductorRules:{...draft.conductorRules,allowedCombinations,materials}}));setError(null);
 }catch(cause){setError(cause instanceof Error?cause.message:'Не удалось сохранить запись.');}}}>
  <h4 id={`${prefix}-title`}>Артикул · {terminationAsset(draft.assetId)?.name}</h4>
  <fieldset disabled={disabled}><legend>Каталожные данные</legend><div className="termination-form-grid">
   {text('Название','name')}{text('Производитель','manufacturer')}{text('Артикул','article')}{text('Материал наконечника','material')}{text('Изоляция','insulation')}{text('Цвет по каталогу','colorName')}
   <label>Исполнение рисунка<select value={draft.colorId??''} onChange={e=>patch({colorId:e.target.value||null})}><option value="">Исходный рисунок</option>{terminationAsset(draft.assetId)?.colorOptions?.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
   {numeric('Номинальный ток, А',draft.ratedCurrentA,v=>patch({ratedCurrentA:v}))}
   {numeric('Длина зачистки, мм',draft.stripLengthMm,v=>patch({stripLengthMm:v}))}
   {numeric('Поправка резки, мм',draft.correctionsMm.cut,v=>patch({correctionsMm:{...draft.correctionsMm,cut:v}}),true)}
   {numeric('Поправка зачистки, мм',draft.correctionsMm.strip,v=>patch({correctionsMm:{...draft.correctionsMm,strip:v}}),true)}
   {text('Источник данных артикула','source')}
  </div></fieldset>
  {!!terminationDimensionFields(draft.assetId).length&&<fieldset disabled={disabled}><legend>Размеры семейства, мм</legend><div className="termination-form-grid">{terminationDimensionFields(draft.assetId).map(k=><span key={k}>{numeric(k,draft.dimensionsMm[k]??null,v=>patch({dimensionsMm:{...draft.dimensionsMm,[k]:v}}))}</span>)}</div></fieldset>}
  <fieldset disabled={disabled}><legend>Проводники на одном входе</legend><p>Цвет рисунка не определяет совместимость. Пустые значения остаются неизвестными.</p><div className="termination-form-grid">
   {numeric('Число проводников · от',draft.conductorRules.minCount,v=>rules({minCount:v}))}{numeric('Число проводников · до',draft.conductorRules.maxCount,v=>rules({maxCount:v}))}
   {numeric('Сечение одного проводника · от, мм²',draft.conductorRules.minSectionMm2,v=>rules({minSectionMm2:v}))}{numeric('Сечение одного проводника · до, мм²',draft.conductorRules.maxSectionMm2,v=>rules({maxSectionMm2:v}))}
   <label>Материалы проводников через запятую<input value={materialsText} onChange={e=>setMaterialsText(e.target.value)}/></label>
   <label>Источник условий совместимости<input value={draft.conductorRules.evidence??''} onChange={e=>rules({evidence:e.target.value||null})}/></label>
   <label className="termination-combinations">Разрешённые комбинации сечений, мм²<textarea rows={3} placeholder={'0.5 + 0.5\n1 + 0.5'} value={combinations} onChange={e=>setCombinations(e.target.value)}/><small>Одна комбинация в строке; порядок проводников не важен.</small></label>
  </div><label className="termination-checkbox"><input type="checkbox" checked={draft.conductorRules.confirmed} onChange={e=>rules({confirmed:e.target.checked})}/>Условия подтверждены указанным источником</label></fieldset>
  <fieldset disabled={disabled}><legend>Примечание</legend>{text('Примечание','notes')}</fieldset>
  {error&&<p role="alert" className="termination-error">{error}</p>}
  <div className="termination-actions"><button type="submit" disabled={disabled}>Сохранить артикул</button><button type="button" onClick={onCancel}>Отмена</button></div>
 </form>;
}
