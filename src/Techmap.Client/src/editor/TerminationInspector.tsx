import { useState } from 'react';
import './termination-editor.css';
import type { ConnectorInstance, HarnessDesignDocument } from './model';
import type { EditorCommand } from './commands';
import { emptyTerminationDocument, sameContact, effectiveEndPreparation, terminationGroupCompatibility, type EndPreparationMode, type TerminationArtifact, type TerminationDocument, type WireEndRef, type TerminationOperation } from './termination-model';

export const preparationLabels: Record<EndPreparationMode,string> = {cut:'Без разделки',copper:'Медь',tin:'Медь с лужением',pin:'Терминал pin',socket:'Терминал socket','pin-sealed':'Терминал pin с уплотнителем','socket-sealed':'Терминал socket с уплотнителем',lug:'Наконечник'};
type Props={document:HarnessDesignDocument;connector:ConnectorInstance;disabled?:boolean;onCommand:(command:EditorCommand)=>unknown;onChooseArtifact:(apply:(artifact:TerminationArtifact)=>unknown,kind?:'terminal'|'sleeve')=>void};
const endLabel=(e:WireEndRef,d:HarnessDesignDocument)=>`${d.wires.find(w=>w.id===e.wireId)?.circuit||`W${d.wires.findIndex(w=>w.id===e.wireId)+1}`} · ${e.end==='from'?'начало':'конец'}`;

/** Editing the manufacturing aggregate never rewrites electrical endpoints. */
export function TerminationInspector({document,connector,disabled,onCommand,onChooseArtifact}:Props){
 const state=document.terminations??emptyTerminationDocument();
 const [excluded,setExcluded]=useState<readonly string[]>([]);
 const component=connector.terminationComponent;
 const save=(next:TerminationDocument)=>onCommand({type:'set-termination-document',terminations:next});
 const addGroup=(contactId:string,ends:readonly WireEndRef[],artifact:TerminationArtifact)=>{
  const previous=state.groups.find(g=>g.target.connectorId===connector.id&&g.target.contactId===contactId);
  const id=previous?.id??crypto.randomUUID();
  const group={id,target:{connectorId:connector.id,contactId},artifactId:artifact.id,memberEnds:ends};
  return save({...state,artifacts:[...state.artifacts.filter(a=>a.id!==artifact.id),artifact],groups:[...state.groups.filter(g=>g.id!==id),group],operations:state.operations.some(o=>o.target.kind==='group'&&o.target.groupId===id)?state.operations:[...state.operations,{id:crypto.randomUUID(),kind:'crimp',target:{kind:'group',groupId:id},executionCount:null}]});
 };
 const sleeveOperation=(kind:'crimp'|'ultrasonic-weld')=>{
  const id=component?.artifactId;if(!id)return;
  const groups=connector.contacts.map(contact=>({id:state.groups.find(g=>g.target.connectorId===connector.id&&g.target.contactId===contact.id)?.id??crypto.randomUUID(),target:{connectorId:connector.id,contactId:contact.id},artifactId:id,memberEnds:document.wires.flatMap(w=>(['from','to'] as const).filter(end=>sameContact(w[end],{connectorId:connector.id,contactId:contact.id})).map(end=>({wireId:w.id,end})))}));
  if(groups.some(g=>!g.memberEnds.length))return;
  const replaced=new Set(groups.map(g=>g.id));
  save({...state,groups:[...state.groups.filter(g=>!replaced.has(g.id)),...groups],operations:[...state.operations.filter(o=>!(o.target.kind==='portSet'&&o.target.connectorId===connector.id)&&!(o.target.kind==='group'&&replaced.has(o.target.groupId))),{id:crypto.randomUUID(),kind,target:{kind:'portSet',connectorId:connector.id,contactIds:connector.contacts.map(c=>c.id)},executionCount:null}]});
 };
 return <section className="he-termination-inspector" aria-label="Оконцовки и провода"><h3>{component?'Оконцовка':'Провода контактов и общий обжим'}</h3>
  {component?.kind==='preparation'&&<label>Вариант конца<select aria-label="Вариант разделки" disabled={disabled} value={component.preparationMode??'cut'} onChange={e=>onCommand({type:'set-termination-component',connectorId:connector.id,component:{...component,preparationMode:e.target.value as EndPreparationMode,symbolId:`preparation-${({cut:'none',tin:'tinned-copper','pin-sealed':'pin-seal','socket-sealed':'socket-seal'} as Record<string,string>)[e.target.value]??e.target.value}`}})}>{Object.entries(preparationLabels).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>}
  {component&&<><label>Обозначение<input aria-label="Обозначение оконцовки" disabled={disabled} defaultValue={connector.designation} onBlur={e=>{if(e.target.value!==connector.designation)onCommand({type:'update-connector',connectorId:connector.id,designation:e.target.value});}}/></label>{(component.kind!=='preparation'||!['cut','copper','tin'].includes(component.preparationMode??'cut'))&&<button disabled={disabled} onClick={()=>onChooseArtifact(artifact=>onCommand({type:'set-termination-component',connectorId:connector.id,artifact,component:{...component,artifactId:artifact.id,symbolId:component.kind==='preparation'?component.symbolId:artifact.symbolId,color:artifact.color,catalogBinding:artifact.catalogBinding}}),component.kind==='sleeve'?'sleeve':'terminal')}>Выбрать артикул / цвет</button>}</>}
  {component?.kind==='sleeve'&&<div><button disabled={disabled||connector.contacts.some(c=>!document.wires.some(w=>sameContact(w.from,{connectorId:connector.id,contactId:c.id})||sameContact(w.to,{connectorId:connector.id,contactId:c.id})))} onClick={()=>sleeveOperation('ultrasonic-weld')}>УЗ сварка на гильзе</button><button disabled={disabled} onClick={()=>sleeveOperation('crimp')}>Обжим гильзы</button></div>}
  {connector.contacts.map(contact=>{
   const target={connectorId:connector.id,contactId:contact.id};
   const ends=document.wires.flatMap(w=>(['from','to'] as const).filter(end=>sameContact(w[end],target)).map(end=>({wireId:w.id,end})));
   const members=ends.filter(e=>!excluded.includes(`${contact.id}:${e.wireId}:${e.end}`));
   const group=state.groups.find(g=>g.target.connectorId===connector.id&&g.target.contactId===contact.id);
   const artifact=state.artifacts.find(a=>a.id===(group?.artifactId??component?.artifactId));
   return <fieldset key={contact.id} disabled={disabled}><legend>{component?.kind==='sleeve'?(contact===connector.contacts[0]?'A':'B'):`Контакт ${contact.number}`} · проводов {ends.length}</legend>
    {ends.map(e=>{const w=document.wires.find(w=>w.id===e.wireId)!;const key=`${contact.id}:${e.wireId}:${e.end}`;return <div key={key} className="he-termination-wire"><label><input type="checkbox" checked={!excluded.includes(key)} onChange={event=>setExcluded(event.target.checked?excluded.filter(x=>x!==key):[...excluded,key])}/>{endLabel(e,document)}</label><label>Марка<input aria-label={`Марка ${w.id}`} defaultValue={w.wireMark??''} onBlur={event=>{if(event.target.value!==(w.wireMark??''))onCommand({type:'update-wire',wireId:w.id,wireMark:event.target.value});}}/></label><label>Сечение<input aria-label={`Сечение ${w.id}`} defaultValue={w.wireSection??''} onBlur={event=>{if(event.target.value!==(w.wireSection??''))onCommand({type:'update-wire',wireId:w.id,wireSection:event.target.value});}}/></label><label>Цвет<input aria-label={`Цвет ${w.id}`} defaultValue={w.color} onBlur={event=>{if(event.target.value!==w.color)onCommand({type:'update-wire',wireId:w.id,color:event.target.value,colorSource:null});}}/></label><WireEndPreparationControls document={document} wireEnd={e} onCommand={onCommand} onChooseArtifact={onChooseArtifact}/></div>;})}
    <p>{artifact?.article||(artifact?'Шаблон формы · артикул не задан':'Наконечник не выбран')}{group?` · общий обжим: ${group.memberEnds.length} проводов`:''}</p>
    <button disabled={members.length<1||component?.kind==='sleeve'} onClick={()=>onChooseArtifact(a=>addGroup(contact.id,members,a),'terminal')}>Выбрать наконечник из библиотеки</button>
    <button disabled={members.length<2||!artifact} onClick={()=>artifact&&addGroup(contact.id,members,artifact)}>Общий обжим ({members.length})</button>
    {group&&<><span role="status">{({compatible:'Совместимость подтверждена',incompatible:'Сочетание проводов несовместимо',unknown:'Совместимость: нет каталожных данных'} as const)[terminationGroupCompatibility(document,group)]}</span><button onClick={()=>onCommand({type:'remove-termination-group',groupId:group.id})}>Разделить общий обжим</button></>}
   </fieldset>;
  })}
  {state.operations.filter(o=>{const t=o.target;return t.kind==='portSet'?t.connectorId===connector.id:t.kind==='group'?state.groups.some(g=>g.id===t.groupId&&g.target.connectorId===connector.id):t.kind==='wireEnd'?document.wires.some(w=>w.id===t.wireId&&connector.contacts.some(c=>sameContact(w[t.end],{connectorId:connector.id,contactId:c.id}))):false;}).map(o=><OperationFields key={o.id} operation={o} disabled={disabled} onCommand={onCommand}/>)}
 </section>;
}

export function PhysicalTwistControls({document,wireIds,disabled,onCommand}:{document:HarnessDesignDocument;wireIds:readonly string[];disabled?:boolean;onCommand:(c:EditorCommand)=>unknown}){
 const [pitch,setPitch]=useState(30);const [direction,setDirection]=useState<'left'|'right'>('right');
 const common=(document.physicalTopology?.segments??[]).filter(s=>wireIds.every(id=>document.physicalTopology?.routes.find(r=>r.wireId===id)?.steps.some(step=>step.segmentId===s.id)));
 const existing=document.terminations?.twists.filter(t=>t.memberWireIds.some(id=>wireIds.includes(id)))??[];
 return <section aria-label="Скрутка проводов"><h3>Скрутка {wireIds.length} проводов</h3><label>Шаг, мм<input type="number" min="1" value={pitch} onChange={e=>setPitch(Number(e.target.value))}/></label><label>Направление<select value={direction} onChange={e=>setDirection(e.target.value as 'left'|'right')}><option value="right">Правое</option><option value="left">Левое</option></select></label><button disabled={disabled||wireIds.length<2||!common.length||!Number.isFinite(pitch)||pitch<=0} onClick={()=>onCommand({type:'upsert-physical-twist',twist:{id:existing.find(t=>t.memberWireIds.length===wireIds.length&&wireIds.every(id=>t.memberWireIds.includes(id)))?.id??crypto.randomUUID(),memberWireIds:wireIds,segmentIds:common.map(s=>s.id),pitchMm:pitch,direction}})}>Свить на общем участке</button>{!common.length&&<p>Уложите выбранные провода на общий пайп, чтобы задать участок скрутки.</p>}{existing.map(t=><button key={t.id} disabled={disabled} onClick={()=>onCommand({type:'remove-physical-twist',twistId:t.id})}>Убрать скрутку · {t.memberWireIds.length} провода</button>)}</section>;
}

function OperationFields({operation:o,disabled,onCommand}:{operation:TerminationOperation;disabled?:boolean;onCommand:Props['onCommand']}){
 const update=(patch:Partial<TerminationOperation>)=>onCommand({type:'upsert-termination-operation',operation:{...o,...patch}});
 const names={strip:'Зачистка',tin:'Лужение',crimp:'Обжим','ultrasonic-weld':'УЗ сварка',twist:'Скрутка'};
 return <fieldset disabled={disabled}><legend>{names[o.kind]}</legend><label>Число выполнений<input type="number" min="1" step="1" aria-label={`Выполнений ${o.id}`} value={o.executionCount??''} placeholder="Не задано" onChange={e=>update({executionCount:e.target.value?Number(e.target.value):null})}/></label><label>Вместимость процесса<input type="number" min="1" step="1" value={o.processCapacity??''} placeholder="Не задана" onChange={e=>update({processCapacity:e.target.value?Number(e.target.value):null})}/></label>{(['machineSeconds','humanSeconds','setupSeconds'] as const).map((field,i)=><label key={field}>{['Машинное время, с','Ручное время, с','Подготовка, с'][i]}<input type="number" min="0" step="any" value={o.norm?.[field]??''} placeholder="Не задано" onChange={e=>update({norm:{machineSeconds:null,humanSeconds:null,setupSeconds:null,...o.norm,[field]:e.target.value?Number(e.target.value):null}})}/></label>)}<p>{o.recipe?.displayName??'Рецептура не назначена. Каталожную операцию можно выбрать в Маршруте V3.'}</p><button onClick={()=>onCommand({type:'remove-termination-operation',operationId:o.id})}>Удалить операцию</button></fieldset>;
}
function WireEndPreparationControls({document,wireEnd,onCommand,onChooseArtifact}:{document:HarnessDesignDocument;wireEnd:WireEndRef;onCommand:Props['onCommand'];onChooseArtifact:Props['onChooseArtifact']}){
 const own=document.terminations?.endPreparations.find(p=>p.wireId===wireEnd.wireId&&p.end===wireEnd.end);
 const current=effectiveEndPreparation(document,wireEnd);
 const mode=current?.mode??'cut';
 const state=document.terminations??emptyTerminationDocument();
 const wire=document.wires.find(w=>w.id===wireEnd.wireId);
 const target=wire?.[wireEnd.end];
 const sharedArtifactId=state.groups.find(g=>g.memberEnds.some(e=>e.wireId===wireEnd.wireId&&e.end===wireEnd.end))?.artifactId??document.connectors.find(c=>c.id===target?.connectorId)?.terminationComponent?.artifactId;
 const chooseTerminal=()=>onChooseArtifact(artifact=>onCommand({type:'set-termination-document',terminations:{...state,artifacts:[...state.artifacts,artifact],endPreparations:[...state.endPreparations.filter(p=>p.id!==own?.id),{...own,id:own?.id??crypto.randomUUID(),...wireEnd,mode,artifactId:artifact.id}]}}),'terminal');
 const addOperation=(kind:'strip'|'tin')=>onCommand({type:'upsert-termination-operation',operation:{id:crypto.randomUUID(),kind,target:{kind:'wireEnd',...wireEnd},executionCount:null}});
 return <div className="he-wire-end-preparation"><label>Подготовка конца<select value={own?.mode??''} onChange={e=>{if(!e.target.value){if(own)onCommand({type:'remove-end-preparation',...wireEnd});return;}onCommand({type:'set-end-preparation',preparation:{id:own?.id??crypto.randomUUID(),...wireEnd,mode:e.target.value as EndPreparationMode,stripLengthMm:own?.stripLengthMm}});}}><option value="">По компоненту ({preparationLabels[current?.mode??'cut']})</option>{Object.entries(preparationLabels).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>{!['cut','copper','tin'].includes(mode)&&(sharedArtifactId?<span>Артикул задан в общей оконцовке</span>:<button onClick={chooseTerminal}>Артикул терминала конца</button>)}{['pin-sealed','socket-sealed'].includes(mode)&&<label>Артикул уплотнителя<input defaultValue={state.artifacts.find(a=>a.id===own?.sealArtifactId)?.article??''} onBlur={e=>{const article=e.target.value.trim();if(!article)return;const artifact={id:own?.sealArtifactId??crypto.randomUUID(),kind:'seal' as const,article,symbolId:'seal'};onCommand({type:'set-termination-document',terminations:{...state,artifacts:[...state.artifacts.filter(a=>a.id!==artifact.id),artifact],endPreparations:[...state.endPreparations.filter(p=>p.id!==own?.id),{...own,id:own?.id??crypto.randomUUID(),...wireEnd,mode,sealArtifactId:artifact.id}]}});}}/></label>}<label>Зачистка, мм<input type="number" min="0" step="any" value={own?.stripLengthMm??''} placeholder="Не задано" onChange={e=>onCommand({type:'set-end-preparation',preparation:{...own,id:own?.id??crypto.randomUUID(),...wireEnd,mode:own?.mode??current?.mode??'cut',stripLengthMm:e.target.value?Number(e.target.value):null}})}/></label><button onClick={()=>addOperation('strip')}>Операция зачистки</button>{current?.mode==='tin'&&<button onClick={()=>addOperation('tin')}>Операция лужения</button>}</div>;
}
