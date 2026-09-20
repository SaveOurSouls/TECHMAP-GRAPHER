import { useState } from "react";
import { InfoHint } from "../InfoHint";
import type { EditorCommand } from "./commands";
import type { HarnessDesignDocument } from "./model";
import { buildDrawingBom, connectionEndLabel, drawingObjectOrigin, emptyDrawingDocuments, type DrawingDocuments } from "./drawing-documents";

export function DrawingDocumentsPanel({document,quantity,selectedId,selectedIds,onChange,onCommand,onReveal}: {
  document:HarnessDesignDocument;quantity:number;selectedId:string|null;selectedIds:readonly string[];
  onChange:(d:DrawingDocuments)=>boolean;onCommand:(c:EditorCommand)=>boolean;onReveal:(ids:readonly string[])=>void;
}) {
  const [filter,setFilter]=useState("");
  const [onlyRelated,setOnlyRelated]=useState(false);
  const d=document.drawingDocuments ?? emptyDrawingDocuments(),rows=buildDrawingBom(document,quantity);
  const leader=d.leaders.find(l=>l.id===selectedId||`${l.id}:anchor`===selectedId);
  const addTable=(kind:"bom"|"connections")=>onChange({...d,tables:[...d.tables,{id:crypto.randomUUID(),kind,position:{x:100,y:600+d.tables.length*250}}]});
  const updateLeader=(patch:Partial<NonNullable<typeof leader>>)=>leader&&onChange({...d,leaders:d.leaders.map(l=>l.id===leader.id?{...l,...patch}:l)});
  return <section className="he-relations" aria-label="Документы чертежа"><details open={!!leader}><summary>Таблицы и выноски</summary>
    <header className="ui-section-heading"><InfoHint>Количество спецификации рассчитано для всего количества жгутов. Фильтр меняет показ, но не расход. Кружок выноски и точка привязки перемещаются отдельно; номер следует позиции спецификации. Таблицы на поле перетаскиваются за заголовок. Для выноски выберите строку и нужный экземпляр.</InfoHint></header>
    <div className="he-relations-actions"><button className="ui-control" type="button" onClick={()=>addTable("bom")}>Спецификация +</button><button className="ui-control" type="button" onClick={()=>addTable("connections")}>Соединения +</button></div>
    {d.tables.map(t=><div className="he-relations-actions" key={t.id}><span>{t.kind==="bom"?"Спецификация":"Соединения"}</span><button className="ui-control" type="button" onClick={()=>onChange({...d,tables:d.tables.filter(i=>i.id!==t.id)})}>Убрать с поля</button></div>)}
    <input aria-label="Поиск строки документа" placeholder="Поиск" value={filter} onChange={e=>setFilter(e.target.value)}/>
    <label><input type="checkbox" checked={onlyRelated} onChange={e=>setOnlyRelated(e.target.checked)}/>Только связанные</label>
    <small>Потребность на {quantity} жгут(а)</small>
    <div className="he-document-table"><table aria-label="Спецификация"><thead><tr>{["Поз.","Обозначение","Наименование","Кол-во","Примечание"].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{rows.filter(r=>(!onlyRelated||r.objectIds.some(id=>selectedIds.includes(id)))&&`${r.designation} ${r.name}`.toLocaleLowerCase().includes(filter.toLocaleLowerCase())).map(r=><tr key={r.key}><td><button className="ui-control" type="button" onClick={()=>onReveal(r.objectIds)}>{r.position}</button></td><td>{r.designation}</td><td>{r.name}</td><td>{r.amount ?? "—"} {r.unit}</td><td>{r.note}<div className="he-relations-actions"><button className="ui-control" type="button" onClick={()=>{const i=rows.findIndex(row=>row.key===r.key),keys=rows.map(row=>row.key);if(i>0){[keys[i-1],keys[i]]=[keys[i]!,keys[i-1]!];onChange({...d,bomOrder:keys});}}}>↑</button></div>
      <select aria-label={`Экземпляр позиции ${r.position}`} defaultValue="" onChange={e=>{const objectId=e.target.value,origin=drawingObjectOrigin(document,objectId);if(origin)onChange({...d,leaders:[...d.leaders,{id:crypto.randomUUID(),objectId,rowKey:r.key,anchorOffset:{x:0,y:0},circle:{x:origin.x+80,y:origin.y-70}}]});e.target.value="";}}><option value="">Выноска +</option>{r.objectIds.map(id=><option key={id} value={id}>{document.connectors.find(c=>c.id===id)?.designation ?? id}</option>)}</select>
    </td></tr>)}</tbody></table></div>
    <details><summary>Таблица соединений · {document.wires.length}</summary><div className="he-document-table"><table aria-label="Таблица соединений"><thead><tr>{["Провод","A","B","Цепь","Длина, мм","Материал","Маршрут"].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{document.wires.filter(w=>(!onlyRelated||selectedIds.includes(w.id))&&`${w.circuit} ${connectionEndLabel(document,w.from)} ${connectionEndLabel(document,w.to)}`.toLowerCase().includes(filter.toLowerCase())).map(w=><tr key={w.id}><td><button type="button" className="ui-control" onClick={()=>onReveal([w.id])}>{w.id}</button></td><td>{connectionEndLabel(document,w.from)}</td><td>{connectionEndLabel(document,w.to)}</td><td><input aria-label={`Цепь ${w.id}`} value={w.circuit} onChange={e=>onCommand({type:"update-wire",wireId:w.id,circuit:e.target.value})}/></td><td><input aria-label={`Длина ${w.id}`} type="number" min="0" value={w.lengthMm ?? ""} onChange={e=>onCommand({type:"update-wire",wireId:w.id,lengthMm:e.target.value===""?null:Number(e.target.value)})}/></td><td>{w.materialBinding?.displayName ?? "—"}</td><td>{document.physicalTopology?.routes.find(r=>r.wireId===w.id)?.steps.length ? "Задан" : "Не задан"}</td></tr>)}</tbody></table></div></details>
    {leader && <div className="he-physical-fields"><strong>Выноска</strong>{(["anchorOffset","circle"] as const).flatMap(key=>(["x","y"] as const).map(axis=><label key={`${key}${axis}`}>{key==="circle"?"Круг":"Якорь"} {axis}<input aria-label={`${key} ${axis}`} type="number" value={leader[key][axis]} onChange={e=>updateLeader({[key]:{...leader[key],[axis]:Number(e.target.value)}})}/></label>))}<button className="ui-control" type="button" onClick={()=>onChange({...d,leaders:d.leaders.filter(l=>l.id!==leader.id)})}>Удалить выноску</button></div>}
    {d.leaders.filter(l=>!drawingObjectOrigin(document,l.objectId)||!rows.some(r=>r.key===l.rowKey&&r.objectIds.includes(l.objectId))).map(l=><small role="alert" key={l.id}>Выноска: объект или позиция отсутствует · {l.objectId}</small>)}
  </details></section>;
}
