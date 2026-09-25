import {InfoHint} from "../InfoHint";
import type {PhysicalTopology} from "./physical-topology-model";
import {pipeMemberSegments,resolvePipeBundles,type PipeBundle,type PipeBundleMember} from "./pipe-bundle-model";

export interface PipeBundleDraft {readonly coveringId:string;readonly bundle:PipeBundle}
export function beginPipeBundle(t:PhysicalTopology,id:string):PipeBundleDraft|null {
 const c=t.coverings?.find(c=>c.id===id);if(!c)return null;
 return {coveringId:id,bundle:c.bundle??{mode:'flat',members:c.spans.map(s=>({kind:'segment',id:s.segmentId}))}};
}
export function pipeBundleDraftTopology(t:PhysicalTopology,draft:PipeBundleDraft):PhysicalTopology {
 if(!t.coverings?.some(c=>c.id===draft.coveringId))throw new Error('Оболочка была удалена. Закройте выбор состава.');
 if(draft.bundle.members.length<2)throw new Error('Добавьте ещё один пайп или группу.');
 const coverings=t.coverings.map(c=>c.id===draft.coveringId?{...c,bundle:draft.bundle}:c);
 resolvePipeBundles(coverings,new Set(t.segments.map(s=>s.id)));
 return {...t,coverings};
}
export function pipeBundleDraftHighlights(t:PhysicalTopology,draft:PipeBundleDraft):string[] {
 const resolved=resolvePipeBundles(t.coverings??[],new Set(t.segments.map(s=>s.id)));
 return [draft.coveringId,...draft.bundle.members.flatMap(m=>m.kind==='segment'?[...pipeMemberSegments(m)]:[m.id,...resolved.get(m.id)??[]])];
}
export function togglePipeBundleMember(t:PhysicalTopology,draft:PipeBundleDraft,id:string):PipeBundleDraft {
 const index=draft.bundle.members.findIndex(m=>m.id===id||m.kind==='segment'&&pipeMemberSegments(m).includes(id));
 if(index>=0)return {...draft,bundle:{...draft.bundle,members:draft.bundle.members.filter((_,i)=>i!==index)}};
 const member:PipeBundleMember|undefined=t.segments.some(s=>s.id===id)?{kind:'segment',id}:
  id!==draft.coveringId&&t.coverings?.some(c=>c.id===id&&c.bundle)?{kind:'covering',id}:undefined;
 return member?{...draft,bundle:{...draft.bundle,members:[...draft.bundle.members,member]}}:draft;
}
export function PipeBundleEditor({topology,draft,onChange,onSave,onCancel}:{
 topology:PhysicalTopology;draft:PipeBundleDraft;onChange:(draft:PipeBundleDraft)=>void;onSave:()=>void;onCancel:()=>void;
}) {
 let error='';try{pipeBundleDraftTopology(topology,draft);}catch(e){error=e instanceof Error?e.message:'Проверьте состав.';}
 const label=(m:PipeBundleMember)=>m.kind==='covering'?topology.coverings?.find(c=>c.id===m.id)?.name??m.id:
  `S${topology.segments.findIndex(s=>s.id===m.id)+1}${m.continuationIds?.length?` · ${m.continuationIds.length+1} участка`:''}`;
 const candidates:PipeBundleMember[]=[...topology.segments.map(s=>({kind:'segment' as const,id:s.id})),
  ...topology.coverings?.filter(c=>c.bundle&&c.id!==draft.coveringId).map(c=>({kind:'covering' as const,id:c.id}))??[]];
 return <section className="he-bundle-editor" aria-label="Объединение пайпов" onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();onCancel();}}}>
  <strong>Объединить</strong><InfoHint>Выберите пайпы или готовые группы на поле либо в списке. Повторный клик исключает участника. Сохранить применяет весь состав одним шагом отмены. Опорный пайп оболочки должен оставаться в составе; циклы и повторные участники запрещены.</InfoHint>
  <select aria-label="Укладка группы" value={draft.bundle.mode} onChange={e=>onChange({...draft,bundle:{...draft.bundle,mode:e.target.value as PipeBundle['mode']}})}>
   <option value="flat">Плоская</option><option value="round">Объёмная</option>
  </select>
  <select aria-label="Добавить участника группы" value="" onChange={e=>{if(e.target.value)onChange(togglePipeBundleMember(topology,draft,e.target.value));}}>
   <option value="">Добавить пайп / группу…</option>{candidates.filter(m=>!draft.bundle.members.some(chosen=>chosen.id===m.id||chosen.kind==='segment'&&pipeMemberSegments(chosen).includes(m.id))).map(m=><option key={`${m.kind}:${m.id}`} value={m.id}>{label(m)}</option>)}
  </select>
  <div className="he-bundle-members" aria-label="Состав группы">{draft.bundle.members.map(m=><button type="button" className="ui-control" key={`${m.kind}:${m.id}`} aria-label={`Исключить ${label(m)}`} onClick={()=>onChange(togglePipeBundleMember(topology,draft,m.id))}>{label(m)} ×</button>)}</div>
  <span>{draft.bundle.members.length} участников</span>
  <button type="button" className="ui-control" disabled={!!error} onClick={onSave}>Сохранить</button>
  <button type="button" className="ui-control" onClick={onCancel}>Отмена</button>
  {error&&<span role="status">{error}</span>}
 </section>;
}
