import {useCallback,useEffect,useMemo,useRef,useState} from "react";
import {InfoHint} from "./InfoHint";
import {createMaterialLibraryApi,type GlobalMaterial} from "./material-library-api";
import type {RuntimeConfig} from "./runtime-config";
import type {LocalSession} from "./local-session";
import {importDrawingImage} from "./component-library/image-import";
import {DraftNumberInput} from "./component-library/DraftNumberInput";
import {coveringKinds} from "./editor/covering-library";
import {MaterialPreview} from "./MaterialPreview";
import {ColorField} from "./editor/CoveringStyleFields";
import "./material-library.css";

type Api=ReturnType<typeof createMaterialLibraryApi>;
const text=(e:unknown)=>e instanceof Error?e.message:"Не удалось изменить материал.";
export function MaterialLibrary({config,session}:{config:RuntimeConfig;session:LocalSession}){
 const api=useMemo(()=>createMaterialLibraryApi(config,session),[config,session]);
 const [rows,setRows]=useState<GlobalMaterial[]>([]),[error,setError]=useState(""),[busy,setBusy]=useState(true);
 const load=useCallback(async()=>{setError("");try{setRows(await api.list());}catch(e){setError(text(e));}finally{setBusy(false);}},[api]);
 useEffect(()=>{void load()},[load]);
 const add=async()=>{setBusy(true);setError("");try{
  const canvas=document.createElement("canvas");canvas.width=canvas.height=64;const ctx=canvas.getContext("2d")!;ctx.fillStyle="#aaa";ctx.fillRect(0,0,64,64);
  const m:GlobalMaterial={materialId:crypto.randomUUID(),name:"Новый материал",mediaType:"image/png",imageBase64:canvas.toDataURL("image/png").split(",")[1]!,lineColor:"#34434e",lineWidth:1,textureAngle:0,textureScale:1,tint:"#888888",coveringKind:null,updatedUtc:new Date().toISOString(),revision:0};
  await api.create(m);await load();
 }catch(e){setError(text(e));}finally{setBusy(false);}};
 return <section className="material-library" aria-labelledby="materials-title">
  <div className="content-heading"><div><p className="eyebrow">ОБЩАЯ БИБЛИОТЕКА</p><h1 id="materials-title">Материалы <InfoHint>Настройки действуют для новых оболочек во всех проектах. У каждого типа одна основная текстура. Сохранённые оболочки сохраняют свою текстуру и настройки. PNG и SVG — до 10 МиБ; SVG преобразуется в PNG. Текстура — отдельный прозрачный слой: тёмные пиксели задают рисунок, светлые открывают фон. Цвет фона выбирается у оболочки на чертеже.</InfoHint></h1></div>
   <button className="primary-action" type="button" onClick={()=>void add()} disabled={busy}>+ Материал</button></div>
  {error&&<p role="alert">{error}</p>}{busy&&<p role="status">Загрузка…</p>}
  <div className="material-table-wrap"><table className="material-table" aria-label="Библиотека материалов"><thead><tr><th>Материал / основной тип</th><th>Текстура</th><th>Контур</th><th>Поворот / масштаб</th><th>Цвет текстуры</th><th>Действия</th></tr></thead><tbody>
   {rows.map(row=><MaterialRow key={row.materialId} row={row} api={api} reload={load}/>)}</tbody></table></div>
 </section>;
}
function MaterialRow({row,api,reload}:{row:GlobalMaterial;api:Api;reload:()=>Promise<void>}){
 const [draft,setDraft]=useState(row),[busy,setBusy]=useState(false),[error,setError]=useState(""),[deleting,setDeleting]=useState(false);
 const input=useRef<HTMLInputElement>(null),previousRow=useRef(row);
 // Keep unsaved fields if another row's type assignment refreshed the list; save then detects conflict.
 useEffect(()=>{const previous=previousRow.current;previousRow.current=row;setDraft(old=>JSON.stringify(old)===JSON.stringify(previous)?row:old)},[row]);
 const edit=(patch:Partial<GlobalMaterial>)=>setDraft(old=>({...old,...patch}));
 const work=async(action:()=>Promise<void>)=>{setBusy(true);setError("");try{await action();}catch(e){setError(text(e));}finally{setBusy(false);}};
 const dirty=JSON.stringify(draft)!==JSON.stringify(row);
 const upload=(file:File)=>work(async()=>{if(!/\.(png|svg)$/i.test(file.name)&&!["image/png","image/svg+xml"].includes(file.type))throw new Error("Выберите PNG или SVG.");const image=await importDrawingImage(file);edit({imageBase64:image.contentBase64});});
 return <tr><td><label className="sr-only" htmlFor={`material-${row.materialId}`}>Название материала</label><input id={`material-${row.materialId}`} value={draft.name} maxLength={255} onChange={e=>edit({name:e.target.value})} disabled={busy}/>
  <select aria-label={`Основной тип ${draft.name}`} value={draft.coveringKind??""} disabled={busy} onChange={e=>edit({coveringKind:e.target.value as GlobalMaterial["coveringKind"]||null})}><option value="">Без назначения</option>{coveringKinds.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></td>
  <td><MaterialPreview kind={draft.coveringKind} url={draft.imageBase64?`data:image/png;base64,${draft.imageBase64}`:api.imageUrl(row)} tint={draft.tint} scale={draft.textureScale} angle={draft.textureAngle} lineColor={draft.lineColor} lineWidth={draft.lineWidth}/><input ref={input} type="file" accept=".png,.svg,image/png,image/svg+xml" hidden onChange={e=>{const f=e.target.files?.[0];if(f)void upload(f);e.target.value=""}}/><button type="button" className="ui-control" disabled={busy} onClick={()=>input.current?.click()}>Обновить текстуру</button></td>
  <td><ColorField label="Цвет контура" value={draft.lineColor} onChange={lineColor=>edit({lineColor})}/><label>Толщина<DraftNumberInput aria-label={`Толщина контура ${draft.name}`} immediate min={.1} max={20} step={.1} value={draft.lineWidth} onValueChange={lineWidth=>edit({lineWidth})}/></label></td>
  <td><label>Угол, °<DraftNumberInput aria-label={`Угол текстуры ${draft.name}`} immediate min={-180} max={180} value={draft.textureAngle} onValueChange={textureAngle=>edit({textureAngle})}/></label><label>Масштаб<DraftNumberInput aria-label={`Масштаб текстуры ${draft.name}`} immediate min={.1} max={10} step={.1} value={draft.textureScale} onValueChange={textureScale=>edit({textureScale})}/></label></td>
  <td><ColorField label="Цвет текстуры" value={draft.tint} onChange={tint=>edit({tint})}/></td>
  <td><button type="button" className="primary-action" disabled={busy||!dirty} onClick={()=>void work(async()=>{const image=draft.imageBase64?draft.imageBase64:(await api.get(row.materialId)).imageBase64;const saved=await api.update({...draft,imageBase64:image});setDraft({...saved,imageBase64:""});await reload();})}>Сохранить</button><button type="button" className="ui-control" disabled={busy} onClick={()=>setDeleting(!deleting)}>Удалить</button>
   {dirty&&<button type="button" className="ui-control" disabled={busy} onClick={()=>setDraft(row)}>Отменить</button>}
   {deleting&&<div className="material-delete" role="group" aria-label={`Удаление ${draft.name}`}><span>Удалить материал?</span><button type="button" disabled={busy} onClick={()=>void work(async()=>{await api.remove(row);await reload()})}>Удалить из библиотеки</button><button type="button" onClick={()=>setDeleting(false)}>Отмена</button></div>}
   {error&&<div role="alert">{error}<button type="button" onClick={()=>void work(async()=>{const fresh=await api.get(row.materialId);setDraft({...fresh,imageBase64:""});await reload()})}>Загрузить сохранённое</button></div>}</td>
 </tr>;
}
