import type { EditorSceneObject } from "./editor-types";
import { findWireEndpoint, calculateWireCutLength, type HarnessDesignDocument, type Point, type WireEndpoint } from "./model";
import { coveringPaths } from "./physical-coverings";
import { physicalNodePoint, physicalSegmentPoints } from "./physical-topology";

export interface DrawingTable { readonly id: string; readonly kind: "bom" | "connections" | "cut"; readonly position: Point; readonly dock?: "left" | "right" | "top" | "bottom" }
export interface PositionLeader { readonly id: string; readonly objectId: string; readonly rowKey: string; readonly anchorOffset: Point; readonly circle: Point }
export interface DrawingDocuments { readonly tables: readonly DrawingTable[]; readonly leaders: readonly PositionLeader[]; readonly bomOrder: readonly string[]; readonly bomText?: Record<string, {designation?:string;name?:string;note?:string}> }
export const emptyDrawingDocuments = (): DrawingDocuments => ({ tables: [], leaders: [], bomOrder: [] });
export interface BomRow {
  readonly key: string; readonly position: number; readonly designation: string; readonly name: string;
  readonly amount: number | null; readonly unit: "шт." | "м"; readonly note: string;
  readonly objectIds: readonly string[]; readonly sourceIdentity: string;
}
const keyOf = (...values: unknown[]) => JSON.stringify(values);
const materialKey = (kind: string, binding: {sourceId:string;snapshotId:string;snapshotSha256:string;recordId:string;sourceKey:string}) => keyOf(kind,binding.sourceId,binding.snapshotId,binding.snapshotSha256,binding.recordId,binding.sourceKey);

/** Aggregation never merges textual articles across source snapshots. */
export function buildDrawingBom(document: HarnessDesignDocument, quantity = 1): BomRow[] {
  const rows = new Map<string, {designation:string[];name:string;amountMicros:bigint;unknown:boolean;unit:"шт."|"м";note:string;objectIds:Set<string>}>();
  const add = (key:string,id:string,designation:string,name:string,amount:number|null,unit:"шт."|"м",note:string) => {
    const row=rows.get(key) ?? {designation:[],name,amountMicros:0n,unknown:false,unit,note,objectIds:new Set<string>()};
    row.objectIds.add(id); if(designation && !row.designation.includes(designation)) row.designation.push(designation);
    row.unknown ||= amount===null;
    if(amount!==null) row.amountMicros+=BigInt(Math.round(amount*1e6));
    rows.set(key,row);
  };
  for(const c of document.connectors) {
    const b=c.libraryBinding;
    const key=b?.mode==="template" ? keyOf("connector",b.templateId,b.templateVersion,b.versionSha256,b.article.sourceId,b.article.entityType,b.article.articleKey) : b?.mode==="series" ? keyOf("series",b.seriesId,c.partNumber) : keyOf("free",c.id);
    add(key,c.id,c.designation,c.partNumber || c.designation,1,"шт.",b?.mode==="template"?`Библиотека v${b.templateVersion}`:b?.mode==="series"?"Встроенная серия":"Без библиотечной привязки");
    for(const contact of c.contacts) if(contact.terminalArticle) {
      const identity=b?.mode==="template" ? keyOf("terminal",b.templateId,b.templateVersion,b.versionSha256,contact.terminalArticle,c.terminalCatalog?.versionSha256 ?? "") : keyOf("terminal-unpinned",c.id,contact.id);
      add(identity,c.id,`${c.designation}:${contact.number}`,contact.terminalArticle,1,"шт.",b?.mode==="template"?"Контакт закреплённой серии":"Терминал без закреплённого источника");
    }
  }
  const cableMembers=new Set(document.cables.flatMap(c=>c.memberWireIds));
  for(const blank of [...document.wires.filter(w=>!cableMembers.has(w.id)),...document.cables]) {
    const b=blank.materialBinding, key=b?materialKey("material",b):keyOf("material-unpinned",blank.id);
    const cut=calculateWireCutLength(blank).cutLengthMm;
    add(key,blank.id,"circuit" in blank?blank.circuit || blank.id:blank.id,b?.displayName ?? "Материал не назначен",cut===null?null:cut/1000,"м",b?"По длине заготовки":"Нет закреплённого материала");
  }
  for(const c of document.physicalTopology?.coverings ?? []) if(c.material) add(materialKey("protection",c.material),c.id,c.name,c.material.displayName,c.lengthMm===null?null:c.lengthMm/1000,"м","Защитное покрытие");
  const order=document.drawingDocuments?.bomOrder ?? [];
  const keys=[...rows.keys()].sort((a,b)=>{const ai=order.indexOf(a),bi=order.indexOf(b);return (ai<0?Number.MAX_SAFE_INTEGER:ai)-(bi<0?Number.MAX_SAFE_INTEGER:bi);});
  return keys.map((key,i)=>{const r=rows.get(key)!,edit=document.drawingDocuments?.bomText?.[key];return {key,sourceIdentity:key,position:i+1,designation:edit?.designation??r.designation.join(", "),name:edit?.name??r.name,amount:r.unknown?null:Number(r.amountMicros*BigInt(quantity))/1e6,unit:r.unit,note:edit?.note??r.note+(r.unknown?" · длина не задана":""),objectIds:[...r.objectIds]};});
}

export function connectionEndLabel(document: HarnessDesignDocument,end:WireEndpoint):string {
  if(end.junctionId) return `Узел ${end.junctionId}`;
  if(end.screenId) return `Экран ${end.screenId}`;
  const c=document.connectors.find(c=>c.id===end.connectorId), contact=c?.contacts.find(c=>c.id===end.contactId);
  return `${c?.designation ?? end.connectorId}:${contact?.number ?? end.contactId}`;
}
export function drawingObjectOrigin(document:HarnessDesignDocument,id:string):Point|null {
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
  for(const t of d.tables)if(!["bom","connections","cut"].includes(t.kind)||!point(t.position)||(t.dock!==undefined&&!["left","right","top","bottom"].includes(t.dock)))return fail();
  for(const l of d.leaders){if(ids.has(`${l.id}:anchor`))return fail();ids.add(`${l.id}:anchor`);}
  for(const l of d.leaders)if(!text(l.objectId)||!text(l.rowKey,4096)||!point(l.anchorOffset)||!point(l.circle))return fail();
  if(new Set(d.bomOrder).size!==d.bomOrder.length||d.bomOrder.some(k=>!text(k,4096)))return fail();
  if(d.bomText!==undefined){if(!d.bomText||typeof d.bomText!=="object"||Array.isArray(d.bomText)||Object.keys(d.bomText).length>50000)return fail();for(const [key,edit] of Object.entries(d.bomText)){if(!text(key,4096)||!edit||typeof edit!=="object"||Array.isArray(edit)||Object.entries(edit).some(([k,v])=>!["designation","name","note"].includes(k)||typeof v!=="string"||v.length>4096))return fail();}}
  // Missing targets are intentionally retained and visibly diagnosed, never reassigned by proximity.
  return d;
}

export function drawingDocumentScene(document:HarnessDesignDocument,quantity=1):EditorSceneObject[] {
  const d=document.drawingDocuments;if(!d)return [];
  const rows=buildDrawingBom(document,quantity);
  const tables:EditorSceneObject[]=d.tables.filter(t=>t.kind!=="cut" && !t.dock).map(t=>{
    const headers=t.kind==="bom"?["Поз.","Обозначение","Наименование","Кол-во","Примечание"]:["Провод","A","B","Цепь","Материал","Маршрут"];
    const values=t.kind==="bom"?rows.map(r=>[String(r.position),r.designation,r.name,`${r.amount ?? "—"} ${r.unit}`,r.note]):document.wires.map(w=>[w.id,connectionEndLabel(document,w.from),connectionEndLabel(document,w.to),w.circuit,w.materialBinding?.displayName ?? "—",document.physicalTopology?.routes.some(r=>r.wireId===w.id)?"Задан":"Не задан"]);
    const widths=t.kind==="bom"?[45,140,200,95,240]:[140,130,130,110,160,100];
    return {id:t.id,kind:"drawing-table",layerId:"dimensions",label:t.kind==="bom"?`Спецификация · ${quantity} жгут(а)`:"Таблица соединений",x:t.position.x,y:t.position.y,width:widths.reduce((a,b)=>a+b,0),height:52+values.length*32,color:"#365568",metadata:{rowObjectIds:JSON.stringify(t.kind==="bom"?rows.map(r=>r.objectIds):document.wires.map(w=>[w.id])),headers:JSON.stringify(headers),rows:JSON.stringify(values),widths:JSON.stringify(widths)}};
  });
  const leaders:EditorSceneObject[]=d.leaders.flatMap(l=>{
    const origin=drawingObjectOrigin(document,l.objectId),row=rows.find(r=>r.key===l.rowKey&&r.objectIds.includes(l.objectId));
    const anchor=origin?{x:origin.x+l.anchorOffset.x,y:origin.y+l.anchorOffset.y}:l.circle;
    return [{id:l.id,kind:"position-leader",layerId:"dimensions",label:origin&&row?String(row.position):"?",x:l.circle.x-12,y:l.circle.y-12,width:24,height:24,color:origin&&row?"#365568":"#c23535",points:[anchor,l.circle]},
      {id:`${l.id}:anchor`,kind:"leader-anchor",layerId:"dimensions",label:"",x:anchor.x-4,y:anchor.y-4,width:8,height:8,color:origin&&row?"#365568":"#c23535"}];
  });
  return [...tables,...leaders];
}
export function moveDrawingAnnotation(document:HarnessDesignDocument,id:string,point:Point):DrawingDocuments|null {
  const d=document.drawingDocuments;if(!d)return null;
  if(d.tables.some(t=>t.id===id)) return {...d,tables:d.tables.map(t=>t.id===id?{...t,position:point}:t)};
  const leader=d.leaders.find(l=>l.id===id||`${l.id}:anchor`===id);if(!leader)return null;
  if(leader.id===id)return {...d,leaders:d.leaders.map(l=>l.id===id?{...l,circle:{x:point.x+12,y:point.y+12}}:l)};
  const origin=drawingObjectOrigin(document,leader.objectId);if(!origin)return null;
  return {...d,leaders:d.leaders.map(l=>l.id===leader.id?{...l,anchorOffset:{x:point.x+4-origin.x,y:point.y+4-origin.y}}:l)};
}
