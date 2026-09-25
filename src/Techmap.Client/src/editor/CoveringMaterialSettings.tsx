import {useEffect,useRef,useState} from "react";
import {InfoHint} from "../InfoHint";
import type {RuntimeConfig} from "../runtime-config";
import type {LocalSession} from "../local-session";
import {useEditorReferenceCatalog} from "./editor-reference-catalog";
import {coveringKinds,emptyCoveringLibrary,textureChoices,type CoveringLibrary,type CoveringTextureEntry} from "./covering-library";
import {coveringMaterial,type CoveringKind} from "./physical-coverings";
import type {CoveringTexture} from "./covering-style";
import type {HarnessDesignDocument} from "./model";
import type {DrawingDocuments} from "./drawing-documents";
import {IMAGE_IMPORT_ACCEPT} from "../component-library/image-import";

export function CoveringMaterialSettings({document,urls,assetError,upload,onChange,onClose,config,session}:{document:HarnessDesignDocument;urls:Readonly<Record<string,string>>;assetError:string;upload:(file:File)=>Promise<CoveringTextureEntry>;onChange:(d:DrawingDocuments)=>boolean;onClose:()=>void;config:RuntimeConfig;session:LocalSession}) {
  const dialog=useRef<HTMLDialogElement>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const catalog=useEditorReferenceCatalog(config,session);
  useEffect(()=>{dialog.current?.showModal();dialog.current?.querySelector<HTMLInputElement>('input[aria-label="Поиск материалов защиты"]')?.focus();catalog.selectSource("technology-protection");},[]);
  const library=document.drawingDocuments?.coveringLibrary??emptyCoveringLibrary(),choices=textureChoices(library);
  const latest=useRef({document,library,onChange});latest.current={document,library,onChange};
  const save=(next:CoveringLibrary)=>latest.current.onChange({...latest.current.document.drawingDocuments??{tables:[],leaders:[],bomOrder:[]},coveringLibrary:next});
  const importFile=async(file:File|undefined,kind?:CoveringKind)=>{
    if(!file||busy)return;setBusy(true);setError("");
    try{const entry=await upload(file),current=latest.current.library;
      save({...current,textures:current.textures.some(t=>t.sha256===entry.sha256)?current.textures:[...current.textures,entry],defaults:kind?{...current.defaults,[kind]:{...current.defaults[kind],texture:`asset:${entry.sha256}`}}:current.defaults});
    }catch(e){setError(e instanceof Error?e.message:"Не удалось импортировать текстуру.");}finally{setBusy(false);}
  };
  return <dialog ref={dialog} className="he-material-settings" aria-label="Материалы чертежа" onCancel={e=>{e.preventDefault();if(!busy)onClose();}}>
    <header className="ui-section-heading"><strong>Материалы чертежа</strong><InfoHint>Настройки общие для оболочек этого чертежа. Новая оболочка получает выбранную текстуру и закреплённый материал. Уже назначенные материалы не заменяются. Перетащите изображение в строку типа или загрузите в список. Файлы хранятся во вложениях проекта и входят в его экспорт.</InfoHint><button type="button" className="ui-control" disabled={busy} onClick={onClose}>Готово</button></header>
    {(error||assetError)&&<p role="alert">{error||assetError}</p>}
    <fieldset disabled={busy}><label className="he-material-search">Материал из базы<input aria-label="Поиск материалов защиты" value={catalog.query} placeholder="Артикул или название" onChange={e=>catalog.changeQuery(e.target.value)}/></label>
    {catalog.message&&<div role="status">{catalog.message}</div>}{catalog.hasMore&&<button type="button" className="ui-control" onClick={catalog.loadMore}>Ещё материалы</button>}
    <table className="he-material-table"><thead><tr><th>Оболочка</th><th>Текстура по умолчанию</th><th>Материал по умолчанию</th></tr></thead><tbody>{coveringKinds.map(([kind,label])=>{
      const pref=library.defaults[kind],value=pref?.texture??"auto",material=pref?.material,items=catalog.items.filter(i=>i.entityType==="protective-covering");
      const key=(m:typeof material)=>m?JSON.stringify([m.sourceId,m.snapshotId,m.recordId]):"";
      return <tr key={kind} onDragOver={e=>{if(e.dataTransfer.types.includes("Files")){e.preventDefault();e.dataTransfer.dropEffect="copy";}}} onDrop={e=>{e.preventDefault();void importFile(e.dataTransfer.files[0],kind);}}><th>{label}</th><td>
        <select aria-label={`Текстура: ${label}`} value={value} onChange={e=>save({...library,defaults:{...library.defaults,[kind]:{...pref,texture:e.target.value as CoveringTexture}}})}>{choices.map(t=><option value={t.value} key={t.value}>{t.label}</option>)}</select>
      </td><td><select aria-label={`Материал: ${label}`} value={key(material)} onChange={e=>{const item=items.find(i=>key(coveringMaterial(i))===e.target.value);save({...library,defaults:{...library.defaults,[kind]:{texture:value,...(item?{material:coveringMaterial(item)}:{})}}});}}>
        <option value="">Не назначен</option>{material&&!items.some(i=>key(coveringMaterial(i))===key(material))&&<option value={key(material)}>{material.displayName}</option>}{items.map(i=><option key={i.id} value={key(coveringMaterial(i))}>{i.referenceDisplayName||i.title}</option>)}
      </select></td></tr>;
    })}</tbody></table>
    <section onDragOver={e=>{if(e.dataTransfer.types.includes("Files"))e.preventDefault();}} onDrop={e=>{e.preventDefault();void importFile(e.dataTransfer.files[0]);}} className="he-texture-drop">
      <label>Добавить текстуру<input aria-label="Загрузить текстуру" type="file" accept={IMAGE_IMPORT_ACCEPT} onChange={e=>{void importFile(e.target.files?.[0]);e.target.value="";}}/></label>
      <table className="he-material-table"><thead><tr><th>Рисунок</th><th>Название</th><th></th></tr></thead><tbody>{library.textures.map(t=>{
        const value=`asset:${t.sha256}`,used=Object.values(library.defaults).some(p=>p?.texture===value)||document.physicalTopology?.coverings?.some(c=>c.style?.texture===value);
        return <tr key={t.sha256}><td>{urls[t.sha256]?<img src={urls[t.sha256]} alt={t.name}/>:<span>Недоступна</span>}</td><td>{t.name}</td><td><button type="button" className="ui-control" disabled={used} title={used?"Используется в настройках или на чертеже":"Убрать из списка; вложение проекта сохраняется"} onClick={()=>save({...library,textures:library.textures.filter(x=>x.sha256!==t.sha256)})}>Убрать</button></td></tr>;
      })}</tbody></table>
    </section></fieldset>{busy&&<p role="status">Загружаем текстуру…</p>}
  </dialog>;
}
