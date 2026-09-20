import { useRef, useState, type CSSProperties } from "react";
import type { EditorCamera } from "./editor-types";
import type { HarnessDesignDocument } from "./model";
import type { EditorCommand } from "./commands";
import { emptyDrawingDocuments, type DrawingDocuments, type DrawingTable } from "./drawing-documents";
import { DrawingDocumentsPanel } from "./DrawingDocumentsPanel";
import { CutDiagramPanel } from "./CutDiagramPanel";
import { InfoHint } from "../InfoHint";

export function tableWindowPosition(table:DrawingTable,camera:EditorCamera):CSSProperties {
  if(table.dock) return table.dock==="right"?{right:8,top:8}:table.dock==="bottom"?{left:8,bottom:8}:{left:8,top:8};
  return {left:table.position.x*camera.zoom+camera.offsetX,top:table.position.y*camera.zoom+camera.offsetY};
}
export function DrawingTableWindows(props:{document:HarnessDesignDocument;camera:EditorCamera;quantity:number;revision:number;unsaved:boolean;selectedIds:readonly string[];onChange:(d:DrawingDocuments)=>boolean;onCommand:(c:EditorCommand)=>boolean;onReveal:(ids:readonly string[])=>void}) {
  const d=props.document.drawingDocuments??emptyDrawingDocuments();
  return <>{d.tables.map(table=><TableWindow key={table.id} {...props} table={table}/>)}</>;
}
function TableWindow({table,camera,document,quantity,revision,unsaved,selectedIds,onChange,onCommand,onReveal}:Parameters<typeof DrawingTableWindows>[0]&{table:DrawingTable}) {
  const drag=useRef<{x:number;y:number}|null>(null);
  const [delta,setDelta]=useState({x:0,y:0});
  const d=document.drawingDocuments!;
  const update=(patch:Partial<DrawingTable>)=>onChange({...d,tables:d.tables.map(t=>t.id===table.id?{...t,...patch}:t)});
  const title=table.kind==="bom"?"Спецификация":table.kind==="cut"?"Резка и разделка":"Таблица соединений";
  return <section className="he-table-window" aria-label={title+" на поле"} style={{...tableWindowPosition(table,camera),transform:`translate(${delta.x}px,${delta.y}px)`}}
    onPointerDown={e=>e.stopPropagation()} onWheel={e=>e.stopPropagation()} onKeyDown={e=>{if(!((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="z"))e.stopPropagation();}}>
    <header onPointerDown={e=>{if(table.dock||e.button!==0||(e.target as HTMLElement).closest("button,select"))return;drag.current={x:e.clientX,y:e.clientY};e.currentTarget.setPointerCapture(e.pointerId);}}
      onPointerMove={e=>{if(drag.current)setDelta({x:e.clientX-drag.current.x,y:e.clientY-drag.current.y});}}
      onPointerUp={e=>{if(!drag.current)return;const start=drag.current;drag.current=null;setDelta({x:0,y:0});update({position:{x:table.position.x+(e.clientX-start.x)/camera.zoom,y:table.position.y+(e.clientY-start.y)/camera.zoom}});}}
      onPointerCancel={()=>{drag.current=null;setDelta({x:0,y:0});}}>
      <strong>{title}</strong><InfoHint>Перетаскивайте окно за заголовок. Размер окна меняется за нижний правый угол. Закреплённое окно остаётся у края при перемещении и масштабировании чертежа. Изменения используют общий документ и Ctrl+Z.</InfoHint>
      <select aria-label={`Закрепить: ${title}`} value={table.dock??""} onChange={e=>update({dock:(e.target.value||undefined) as DrawingTable["dock"],...(!e.target.value?{position:{x:(24-camera.offsetX)/camera.zoom,y:(24-camera.offsetY)/camera.zoom}}:{})})}>
        <option value="">На поле</option><option value="left">Слева</option><option value="right">Справа</option><option value="top">Сверху</option><option value="bottom">Снизу</option>
      </select><button type="button" className="ui-control" aria-label={`Закрыть: ${title}`} onClick={()=>onChange({...d,tables:d.tables.filter(t=>t.id!==table.id)})}>×</button>
    </header>
    <div className="he-table-window-body">{table.kind==="cut"?<CutDiagramPanel embedded document={document} quantity={quantity} revision={revision} unsaved={unsaved} relatedIds={selectedIds} onCommand={onCommand} onReveal={id=>onReveal([id])}/>:<DrawingDocumentsPanel mode={table.kind} document={document} quantity={quantity} selectedId={null} selectedIds={selectedIds} onChange={onChange} onCommand={onCommand} onReveal={onReveal}/>}</div>
  </section>;
}
