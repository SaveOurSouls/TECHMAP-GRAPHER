import { drawingObjectPerimeter, type DrawingPerimeters } from "./drawing-object-perimeter";
import { drawingLocalPoint, drawingPointToLocal } from "./drawing-scale";
import { validateDrawingDimensions, type DrawingDimension } from "./drawing-dimensions";
import type { EditorSceneObject } from "./editor-types";
import { findWireEndpoint, calculateWireCutLength, type HarnessDesignDocument, type Point, type WireEndpoint } from "./model";
import { coveringPaths } from "./physical-coverings";
import { physicalNodePoint, physicalSegmentPoints } from "./physical-topology";

export interface DrawingTable { readonly id: string; readonly kind: "bom" | "connections" | "cut"; readonly position: Point; readonly dock?: "left" | "right" | "top" | "bottom"; readonly width?: number; readonly height?: number }
export interface PositionLeader { readonly id: string; readonly objectId: string; readonly rowKey: string; readonly anchorOffset: Point; readonly circle: Point; readonly anchorLocal?: Point; readonly hidden?: boolean }
export interface DrawingSpecificationItem {
  readonly id: string;
  readonly kind: "abstract" | "manual";
  readonly type: string;
  readonly designation: string;
  readonly name: string;
  readonly amount: number | null;
  readonly unit: "шт." | "м" | "г" | "кг" | "л";
  readonly note: string;
  readonly objectId?: string;
  readonly sourceIdentity?: string;
  readonly position?: Point;
}
export interface DrawingDocuments { readonly dimensions?:readonly DrawingDimension[]; readonly tables: readonly DrawingTable[]; readonly leaders: readonly PositionLeader[]; readonly bomOrder: readonly string[]; readonly bomText?: Record<string, {index?:string;designation?:string;name?:string;note?:string}>; readonly specificationItems?: readonly DrawingSpecificationItem[] }
export const emptyDrawingDocuments = (): DrawingDocuments => ({ tables: [], leaders: [], bomOrder: [], specificationItems: [] });
export interface BomRow {
  readonly key: string; readonly position: number; readonly index: string; readonly designation: string; readonly name: string;
  readonly amount: number | null; readonly unit: "шт." | "м" | "г" | "кг" | "л"; readonly note: string;
  readonly objectIds: readonly string[]; readonly sourceIdentity: string;
}
const keyOf = (...values: unknown[]) => JSON.stringify(values);
const materialKey = (kind: string, binding: {sourceId:string;snapshotId:string;snapshotSha256:string;recordId:string;sourceKey:string}) => keyOf(kind,binding.sourceId,binding.snapshotId,binding.snapshotSha256,binding.recordId,binding.sourceKey);

/** Aggregation never merges textual articles across source snapshots. */
export function buildDrawingBom(document: HarnessDesignDocument, quantity = 1): BomRow[] {
  const rows = new Map<string, {index:string[];designation:string[];name:string;amountMicros:bigint;unknown:boolean;unit:"шт."|"м"|"г"|"кг"|"л";note:string;objectIds:Set<string>}>();
  const add = (key:string,id:string,designation:string,name:string,amount:number|null,unit:"шт."|"м"|"г"|"кг"|"л",note:string,index=designation) => {
    const row=rows.get(key) ?? {index:[],designation:[],name,amountMicros:0n,unknown:false,unit,note,objectIds:new Set<string>()};
    row.objectIds.add(id); if(index && !row.index.includes(index))row.index.push(index); if(designation && !row.designation.includes(designation)) row.designation.push(designation);
    row.unknown ||= amount===null;
    if(amount!==null) row.amountMicros+=BigInt(Math.round(amount*1e6));
    rows.set(key,row);
  };
  for(const c of document.connectors) {
    const b=c.libraryBinding;
    const key=b?.mode==="template" ? keyOf("connector",b.templateId,b.templateVersion,b.versionSha256,b.article.sourceId,b.article.entityType,b.article.articleKey) : b?.mode==="series" ? keyOf("series",b.seriesId,c.partNumber) : keyOf("free",c.id);
    const description=(b?.mode==="template"?b.snapshot.name:b?.mode==="series"?c.libraryCode || b.seriesId:undefined) ?? "Соединитель";
    add(key,c.id,c.partNumber || "—",`${c.contacts.length} конт. — ${description}`,1,"шт.",b?.mode==="template"?`Библиотека v${b.templateVersion}`:b?.mode==="series"?"Встроенная серия":"Без библиотечной привязки",c.designation);
    for(const contact of c.contacts) if(contact.terminalArticle) {
      const identity=b?.mode==="template" ? keyOf("terminal",b.templateId,b.templateVersion,b.versionSha256,contact.terminalArticle,c.terminalCatalog?.versionSha256 ?? "") : keyOf("terminal-unpinned",c.id,contact.id);
      add(identity,c.id,contact.terminalArticle,"Контакт",1,"шт.",b?.mode==="template"?"Контакт закреплённой серии":"Терминал без закреплённого источника",`${c.designation}:${contact.number}`);
    }
  }
  const cableMembers=new Set(document.cables.flatMap(c=>c.memberWireIds));
  for(const blank of [...document.wires.filter(w=>!cableMembers.has(w.id)),...document.cables]) {
    const b=blank.materialBinding, key=b?materialKey("material",b):keyOf("material-unpinned",blank.id);
    const cut=calculateWireCutLength(blank).cutLengthMm;
    add(key,blank.id,b?.sourceKey ?? ("circuit" in blank?blank.circuit || blank.id:blank.id),b?.displayName ?? "Материал не назначен",cut===null?null:cut/1000,"м",b?"По длине заготовки":"Нет закреплённого материала","circuit" in blank?blank.circuit || blank.id:blank.id);
    for(const segment of document.physicalTopology?.segments.filter(s=>s.specificationItemId===blank.id)??[])rows.get(key)!.objectIds.add(segment.id);
  }
  for(const c of document.physicalTopology?.coverings ?? []) add(c.material?materialKey("protection",c.material):keyOf("protection-unpinned",c.id),c.id,c.material?.sourceKey ?? c.name,c.material?.displayName ?? c.name,c.lengthMm===null?null:c.lengthMm/1000,"м",c.material?"Защитное покрытие":"Материал защиты не назначен",c.name);
  for(const item of document.drawingDocuments?.specificationItems ?? []) {
    const key=keyOf("specification",item.id);
    add(key,item.id,item.designation,item.name,item.amount,item.unit,item.note || (item.kind === "abstract" ? "Абстрактная позиция" : "Дополнительная позиция"));
    for(const segment of document.physicalTopology?.segments.filter(s=>s.specificationItemId===item.id)??[])rows.get(key)!.objectIds.add(segment.id);
  }
  for(const [index,segment] of (document.physicalTopology?.segments??[]).entries()){
    const assigned=segment.specificationItemId;
    if(assigned&&(document.drawingDocuments?.specificationItems?.some(i=>i.id===assigned)||document.cables.some(c=>c.id===assigned)))continue;
    add(keyOf("physical-channel",segment.id),segment.id,"S"+(index+1),"Канал",null,"м",assigned?"Позиция спецификации отсутствует":"Абстрактный канал · материал не назначен");
  }
  const order=document.drawingDocuments?.bomOrder ?? [];
  const keys=[...rows.keys()].sort((a,b)=>{const ai=order.indexOf(a),bi=order.indexOf(b);return (ai<0?Number.MAX_SAFE_INTEGER:ai)-(bi<0?Number.MAX_SAFE_INTEGER:bi);});
  return keys.map((key,i)=>{const r=rows.get(key)!,edit=document.drawingDocuments?.bomText?.[key];return {key,sourceIdentity:key,position:i+1,index:edit?.index??r.index.join(", "),designation:edit?.designation??r.designation.join(", "),name:edit?.name??r.name,amount:r.unknown?null:Number(r.amountMicros*BigInt(quantity))/1e6,unit:r.unit,note:edit?.note??r.note+(r.unknown?" · длина не задана":""),objectIds:[...r.objectIds]};});
}

export function connectionEndLabel(document: HarnessDesignDocument,end:WireEndpoint):string {
  if(end.junctionId) return `Узел ${end.junctionId}`;
  if(end.screenId) return `Экран ${end.screenId}`;
  const c=document.connectors.find(c=>c.id===end.connectorId), contact=c?.contacts.find(c=>c.id===end.contactId);
  return `${c?.designation ?? end.connectorId}:${contact?.number ?? end.contactId}`;
}
export function drawingObjectOrigin(document:HarnessDesignDocument,id:string):Point|null {
  const extra=document.drawingDocuments?.specificationItems?.find(i=>i.id===id);if(extra)return extra.position ?? null;
  const connector=document.connectors.find(c=>c.id===id);if(connector)return connector.positions.drawing;
  const t=document.physicalTopology;
  const node=t?.nodes.find(n=>n.id===id);if(node)return physicalNodePoint(document,node);
  const segment=t?.segments.find(s=>s.id===id);if(segment)return physicalSegmentPoints(document,segment)[0] ?? null;
  const covering=t?.coverings?.find(c=>c.id===id);if(covering)return coveringPaths(document,covering)[0]?.[0] ?? null;
  const cable=document.cables.find(c=>c.id===id),wire=document.wires.find(w=>w.id===(cable?.memberWireIds[0] ?? id));
  if(wire){const route=t?.routes.find(r=>r.wireId===wire.id),step=route?.steps[0],seg=t?.segments.find(s=>s.id===step?.segmentId);if(seg){const p=physicalSegmentPoints(document,seg);return (step?.reverse?p.at(-1):p[0])??null;}return wire.drawingRoute[0] ?? findWireEndpoint(document,wire.from,"drawing") ?? null;}
  return null;
}

export function validateDrawingDocuments(value:unknown,document:HarnessDesignDocument):DrawingDocuments|undefined {
  if(value===undefined)return undefined;
  const fail=():never=>{throw new Error("Некорректные таблицы или позиционные выноски чертежа.");};
  if(!value||typeof value!=="object")return fail();
  const d=value as DrawingDocuments;
  if(!Array.isArray(d.tables)||d.tables.length>20||!Array.isArray(d.leaders)||d.leaders.length>10000||!Array.isArray(d.bomOrder)||d.bomOrder.length>50000)return fail();
  const ids=new Set([...document.connectors.map(c=>c.id),...document.wires.map(w=>w.id),...document.cables.map(c=>c.id),...document.physicalTopology?.nodes.map(n=>n.id)??[],...document.physicalTopology?.segments.map(s=>s.id)??[],...document.physicalTopology?.coverings?.map(c=>c.id)??[]]);
  const text=(s:unknown,max=128)=>typeof s==="string"&&s.trim().length>0&&s.length<=max;
  const point=(p:Point)=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&Math.abs(p.x)<=1e7&&Math.abs(p.y)<=1e7;
  for(const t of [...d.tables,...d.leaders]){if(!t||!text(t.id)||ids.has(t.id))return fail();ids.add(t.id);}
  for(const t of d.tables)if(!["bom","connections","cut"].includes(t.kind)||!point(t.position)||(t.dock!==undefined&&!["left","right","top","bottom"].includes(t.dock))||
    (t.width!==undefined&&(!Number.isFinite(t.width)||t.width<280||t.width>4000))||(t.height!==undefined&&(!Number.isFinite(t.height)||t.height<160||t.height>4000)))return fail();
  for(const l of d.leaders){if(ids.has(`${l.id}:anchor`))return fail();ids.add(`${l.id}:anchor`);}
  for(const l of d.leaders)if(!text(l.objectId)||!text(l.rowKey,4096)||!point(l.anchorOffset)||!point(l.circle)||(l.anchorLocal!==undefined&&!point(l.anchorLocal))||(l.hidden!==undefined&&typeof l.hidden!=="boolean"))return fail();
  if(new Set(d.bomOrder).size!==d.bomOrder.length||d.bomOrder.some(k=>!text(k,4096)))return fail();
  if(d.bomText!==undefined){if(!d.bomText||typeof d.bomText!=="object"||Array.isArray(d.bomText)||Object.keys(d.bomText).length>50000)return fail();for(const [key,edit] of Object.entries(d.bomText)){if(!text(key,4096)||!edit||typeof edit!=="object"||Array.isArray(edit)||Object.entries(edit).some(([k,v])=>!["index","designation","name","note"].includes(k)||typeof v!=="string"||v.length>4096))return fail();}}
  if(d.specificationItems!==undefined){if(!Array.isArray(d.specificationItems)||d.specificationItems.length>50000)return fail();const itemIds=new Set<string>();for(const item of d.specificationItems){if(!item||!text(item.id)||itemIds.has(item.id)||!((item.kind==="abstract")||(item.kind==="manual"))||!text(item.type,256)||typeof item.designation!=="string"||item.designation.length>4096||!text(item.name,4096)||(!Number.isFinite(item.amount)&&item.amount!==null)||item.amount!==null&&(item.amount<0||item.amount>1e9)||!["шт.","м","г","кг","л"].includes(item.unit)||typeof item.note!=="string"||item.note.length>4096||item.position!==undefined&&!point(item.position)||item.objectId!==undefined&&!text(item.objectId)||item.sourceIdentity!==undefined&&!text(item.sourceIdentity,4096))return fail();itemIds.add(item.id);if(ids.has(item.id))return fail();ids.add(item.id);}}
  const dimensions=validateDrawingDimensions(d.dimensions,document);
  for(const item of dimensions??[]){if(ids.has(item.id))return fail();ids.add(item.id);}
  // Missing targets are intentionally retained and visibly diagnosed, never reassigned by proximity.
  return d;
}

export function drawingDocumentScene(document:HarnessDesignDocument,quantity=1,perimeters?:DrawingPerimeters):EditorSceneObject[] {
  const d=document.drawingDocuments;if(!d)return [];
  const rows=buildDrawingBom(document,quantity);
  const tables:EditorSceneObject[]=d.tables.filter(t=>t.kind!=="cut" && !t.dock).map(t=>{
    const headers=t.kind==="bom"?["Поз.","Индекс","Обозначение","Наименование","Кол-во","Примечание"]:["Провод","A","B","Цепь","Материал","Маршрут"];
    const values=t.kind==="bom"?rows.map(r=>[String(r.position),r.index,r.designation,r.name,`${r.amount ?? "—"} ${r.unit}`,r.note]):document.wires.map(w=>[w.id,connectionEndLabel(document,w.from),connectionEndLabel(document,w.to),w.circuit,w.materialBinding?.displayName ?? "—",document.physicalTopology?.routes.some(r=>r.wireId===w.id)?"Задан":"Не задан"]);
    const widths=t.kind==="bom"?[45,130,140,240,95,200]:[140,130,130,110,160,100];
    return {id:t.id,kind:"drawing-table",layerId:"dimensions",label:t.kind==="bom"?`Спецификация · ${quantity} жгут(а)`:"Таблица соединений",x:t.position.x,y:t.position.y,width:widths.reduce((a,b)=>a+b,0),height:52+values.length*32,color:"#365568",metadata:{rowObjectIds:JSON.stringify(t.kind==="bom"?rows.map(r=>r.objectIds):document.wires.map(w=>[w.id])),headers:JSON.stringify(headers),rows:JSON.stringify(values),widths:JSON.stringify(widths)}};
  });
  const leaders:EditorSceneObject[]=d.leaders.filter(l=>!l.hidden).flatMap(l=>{
    const origin=drawingObjectOrigin(document,l.objectId),row=rows.find(r=>r.key===l.rowKey&&r.objectIds.includes(l.objectId));
    const connector=document.connectors.find(c=>c.id===l.objectId);
    const offset=l.anchorLocal&&connector?drawingLocalPoint(l.anchorLocal,connector.drawingPlacements):l.anchorOffset;
    const target=origin?{x:origin.x+offset.x,y:origin.y+offset.y}:l.circle;
    const anchor=drawingObjectPerimeter(document,l.objectId,target,perimeters)??l.circle;
    return [{id:l.id,kind:"position-leader",layerId:"dimensions",label:origin&&row?String(row.position):"?",x:l.circle.x-12,y:l.circle.y-12,width:24,height:24,color:origin&&row?"#365568":"#c23535",points:[anchor,l.circle]},
      {id:`${l.id}:anchor`,kind:"leader-anchor",layerId:"dimensions",label:"",x:anchor.x-4,y:anchor.y-4,width:8,height:8,color:origin&&row?"#365568":"#c23535"}];
  });
  return [...tables,...leaders,...(d.specificationItems??[]).filter(i=>i.position).map(i=>({id:i.id,kind:"specification-item" as const,layerId:"dimensions",label:i.designation || i.name,x:i.position!.x,y:i.position!.y,width:110,height:38,color:"#416579"}))];
}
export function moveDrawingAnnotation(document:HarnessDesignDocument,id:string,point:Point,perimeters?:DrawingPerimeters):DrawingDocuments|null {
  const d=document.drawingDocuments;if(!d)return null;
  if(d.specificationItems?.some(i=>i.id===id&&i.position))return {...d,specificationItems:d.specificationItems.map(i=>i.id===id?{...i,position:point}:i)};
  if(d.tables.some(t=>t.id===id)) return {...d,tables:d.tables.map(t=>t.id===id?{...t,position:point}:t)};
  const leader=d.leaders.find(l=>l.id===id||`${l.id}:anchor`===id);if(!leader)return null;
  if(leader.id===id)return {...d,leaders:d.leaders.map(l=>l.id===id?{...l,circle:{x:point.x+12,y:point.y+12}}:l)};
  const origin=drawingObjectOrigin(document,leader.objectId);if(!origin)return null;
  const anchor=drawingObjectPerimeter(document,leader.objectId,{x:point.x+4,y:point.y+4},perimeters);if(!anchor)return null;
  const offset={x:anchor.x-origin.x,y:anchor.y-origin.y},connector=document.connectors.find(c=>c.id===leader.objectId);
  return {...d,leaders:d.leaders.map(l=>l.id===leader.id?{...l,anchorOffset:offset,...(connector?{anchorLocal:drawingPointToLocal(offset,connector.drawingPlacements)}:{})}:l)};
}


/** Adds each row to every represented object once; one command remains one Undo. */
export function addDrawingPositions(document:HarnessDesignDocument,perimeters?:DrawingPerimeters,rowKeys?:readonly string[],createId=()=>crypto.randomUUID()):DrawingDocuments {
  const d=document.drawingDocuments??emptyDrawingDocuments(),leaders=[...d.leaders];
  const rows=buildDrawingBom(document).filter(r=>!rowKeys||rowKeys.includes(r.key));
  for(const row of rows)for(const objectId of row.objectIds){
    const origin=drawingObjectOrigin(document,objectId);if(!origin)continue;
    // The physical segment represents its assigned material on the drawing.
    if(document.physicalTopology?.segments.some(s=>s.specificationItemId===objectId))continue;
    const existing=leaders.find(l=>l.objectId===objectId&&l.rowKey===row.key);
    if(existing){if(existing.hidden)leaders[leaders.indexOf(existing)]={...existing,hidden:false};continue;}
    const siblings=leaders.filter(l=>l.objectId===objectId),last=siblings.reduce<PositionLeader|undefined>((right,l)=>!right||l.circle.x>right.circle.x?l:right,undefined);
    const edge=drawingObjectPerimeter(document,objectId,{x:origin.x+10000,y:origin.y-10000},perimeters);if(!edge)continue;
    const circle=last?{x:last.circle.x+24,y:last.circle.y}:{x:edge.x+48,y:edge.y-48};
    const anchor=drawingObjectPerimeter(document,objectId,circle,perimeters)!;
    const offset={x:anchor.x-origin.x,y:anchor.y-origin.y},connector=document.connectors.find(c=>c.id===objectId);
    leaders.push({id:createId(),objectId,rowKey:row.key,anchorOffset:offset,circle,...(connector?{anchorLocal:drawingPointToLocal(offset,connector.drawingPlacements)}:{})});
  }
  return {...d,leaders};
}

export function setDrawingPositionVisibility(document:HarnessDesignDocument,rowKey:string,visible:boolean,perimeters?:DrawingPerimeters):DrawingDocuments {
  const d=visible?addDrawingPositions(document,perimeters,[rowKey]):document.drawingDocuments??emptyDrawingDocuments();
  return {...d,leaders:d.leaders.map(l=>l.rowKey===rowKey?{...l,hidden:!visible}:l)};
}
