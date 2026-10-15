import {useEffect,useId,useMemo,useState} from 'react';
import {BUILTIN_TERMINATION_RECORDS,TERMINATION_ASSETS,createCustomTerminationRecord,parseTerminationRecord,type TerminationLibraryRecord,type TerminationView} from './catalog';
import {loadCustomTerminationRecords,upsertCustomTerminationRecord,TERMINATION_LIBRARY_STORAGE_KEY,type StorageLike} from './storage';
import {TerminationSymbol} from './TerminationSymbol';
import {TerminationRecordEditor} from './TerminationRecordEditor';
import './termination-library.css';
export interface TerminationLibraryPickerProps {
 readonly onSelect:(record:TerminationLibraryRecord)=>void;readonly onClose?:()=>void;
 readonly selectedId?:string;readonly view?:TerminationView;readonly storage?:StorageLike;
}
export function TerminationLibraryPicker({onSelect,onClose,selectedId,view='drawing',storage}:TerminationLibraryPickerProps){
 const prefix=useId();
 const target=useMemo(()=>{try{return storage??(typeof window!=='undefined'?window.localStorage:undefined);}catch{return undefined;}},[storage]);
 const [storageError,setStorageError]=useState<string|null>(null),[custom,setCustom]=useState<readonly TerminationLibraryRecord[]>([]);
 const [selected,setSelected]=useState(selectedId??BUILTIN_TERMINATION_RECORDS[0]!.id),[query,setQuery]=useState(''),[family,setFamily]=useState(''),[draft,setDraft]=useState<TerminationLibraryRecord|null>(null),[color,setColor]=useState<string|null|undefined>(undefined);
 useEffect(()=>{const reload=()=>{try{if(!target)throw new Error('Локальное хранилище недоступно.');setCustom(loadCustomTerminationRecords(target));setStorageError(null);}catch(cause){setStorageError(cause instanceof Error?cause.message:'Не удалось прочитать локальный справочник.');}};reload();
  if(typeof window==='undefined')return;const onStorage=(e:StorageEvent)=>{if(e.key===TERMINATION_LIBRARY_STORAGE_KEY)reload();};window.addEventListener('storage',onStorage);return()=>window.removeEventListener('storage',onStorage);
 },[target]);
 useEffect(()=>{if(selectedId){setSelected(selectedId);setColor(undefined);}},[selectedId]);
 const records=useMemo(()=>[...BUILTIN_TERMINATION_RECORDS,...custom],[custom]);
 const current=records.find(r=>r.id===selected)??records[0]!;
 const needle=query.trim().toLocaleLowerCase('ru-RU');
 const filtered=records.filter(r=>(!family||r.assetId===family)&&(!needle||[r.name,r.manufacturer,r.article].some(v=>v?.toLocaleLowerCase('ru-RU').includes(needle))));
 const selectedRecord=parseTerminationRecord({...current,colorId:color===undefined?current.colorId:color});
 const colors=TERMINATION_ASSETS.find(a=>a.id===current.assetId)?.colorOptions??[];
 const choose=(r:TerminationLibraryRecord)=>{setSelected(r.id);setColor(undefined);};
 return <section className="termination-library" aria-labelledby={`${prefix}-title`}>
  <header className="termination-library-header"><h3 id={`${prefix}-title`}>Библиотека оконцовок</h3>{onClose&&<button type="button" onClick={onClose} aria-label="Закрыть библиотеку оконцовок">Закрыть</button>}</header>
  {storageError&&<p className="termination-error" role="alert">{storageError} Пользовательские записи не перезаписываются.</p>}
  {draft?<TerminationRecordEditor key={draft.id} record={draft} onCancel={()=>setDraft(null)} disabled={!target||!!storageError} onSave={value=>{if(!target)throw new Error('Локальное хранилище недоступно.');setCustom(upsertCustomTerminationRecord(target,value));choose(value);setDraft(null);}}/>:<>
   <div className="termination-library-search"><label>Поиск<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Форма, производитель или артикул"/></label><label>Форма<select value={family} onChange={e=>setFamily(e.target.value)}><option value="">Все формы</option>{TERMINATION_ASSETS.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label></div>
   <div className="termination-library-body"><div className="termination-library-results" aria-label="Записи библиотеки">{filtered.map(r=><button type="button" key={r.id} className={r.id===current.id?'is-selected':''} onClick={()=>choose(r)} aria-pressed={r.id===current.id}><TerminationSymbol record={r} view={view} width={132} height={60}/><span>{r.name}<small>{r.article??'Шаблон формы · артикул не задан'}{r.manufacturer?` · ${r.manufacturer}`:''}</small></span></button>)}{!filtered.length&&<p>Совпадений нет.</p>}</div>
   <div className="termination-library-detail"><TerminationSymbol record={selectedRecord} view={view}/><h4>{current.name}</h4><p>{current.manufacturer??'Производитель не задан'} · {current.article??'Артикул не задан'}</p>
    {!!colors.length&&<label>Цвет рисунка<select value={(color===undefined?current.colorId:color)??''} onChange={e=>setColor(e.target.value||null)}><option value="">Исходный рисунок</option>{colors.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
    <p>{current.kind==='sleeve'?'Два входа по краям гильзы':'Один вход провода'}. Условия проводников: {current.conductorRules.confirmed?'указаны в записи':'неизвестны'}.</p>
    <p className="termination-library-muted">Цвет не определяет сечение или допустимое число проводов.</p>
    <dl><dt>Материал</dt><dd>{current.material??'Неизвестно'}</dd><dt>Изоляция</dt><dd>{current.insulation??'Неизвестно'}</dd><dt>Ток, А</dt><dd>{current.ratedCurrentA??'Неизвестно'}</dd><dt>Зачистка, мм</dt><dd>{current.stripLengthMm??'Неизвестно'}</dd></dl>
    <div className="termination-actions"><button type="button" onClick={()=>onSelect(selectedRecord)}>Выбрать</button><button type="button" disabled={!target||!!storageError} onClick={()=>setDraft(createCustomTerminationRecord(selectedRecord))}>Создать артикул</button>{current.origin==='custom'&&<button type="button" disabled={!target||!!storageError} onClick={()=>setDraft(selectedRecord)}>Редактировать артикул</button>}</div>
   </div></div>
  </>}
 </section>;
}
