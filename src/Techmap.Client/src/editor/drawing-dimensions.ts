import { findWireEndpoint, calculateWireCutLength, type HarnessDesignDocument, type Point, type WireInstance } from "./model";
import { physicalWirePoints, physicalSegmentControls } from "./physical-topology";
import type { EditorSceneObject } from "./editor-types";

export type DimensionMode="horizontal"|"vertical"|"aligned";
export interface DrawingDimension {
  readonly id:string; readonly wireId?:string; readonly segmentId?:string; readonly from:number; readonly to:number;
  readonly pointCount:number; readonly routeKey:string; readonly mode:DimensionMode;
  readonly offset:number; readonly lengthMm:number|null;
}
/** Coordinate changes preserve anchors; a changed endpoint/topology never silently retargets an index. */
export function dimensionRouteKey(document:HarnessDesignDocument,wire:WireInstance):string {
  const endpoint=(e:WireInstance["from"])=>e.junctionId?`j:${e.junctionId}`:e.screenId?`s:${e.screenId}`:`c:${e.connectorId}:${e.contactId}`;
  const t=document.physicalTopology,route=t?.routes.find(r=>r.wireId===wire.id);
  return JSON.stringify([endpoint(wire.from),endpoint(wire.to),route?.steps.length?route.steps.map(step=>{
    const s=t!.segments.find(s=>s.id===step.segmentId)!;return [s.id,step.reverse,s.from,s.to,s.bends.length];
  }):wire.drawingRoute.length]);
}
export function dimensionWirePoints(document:HarnessDesignDocument,wire:WireInstance):readonly Point[] {
  const a=findWireEndpoint(document,wire.from,"drawing"),b=findWireEndpoint(document,wire.to,"drawing");
  return a&&b?physicalWirePoints(document,wire.id,a,b)??[a,...wire.drawingRoute,b]:[];
}
export function measuredWireLength(dimensions:readonly DrawingDimension[]):number|null {
  if(!dimensions.length)return null;
  const end=dimensions[0]!.pointCount-1;
  const totals=dimensions.filter(d=>d.from===0&&d.to===end);
  if(totals.length>1)throw new Error("Общая длина провода уже задана размером.");
  if(totals.length)return totals[0]!.lengthMm;
  const sorted=[...dimensions].sort((a,b)=>a.from-b.from);
  let next=0,micros=0,complete=true;
  for(const d of sorted){
    if(d.from<next)throw new Error("Размерные участки перекрываются. Задайте общую длину либо непересекающиеся участки.");
    if(d.from!==next||d.lengthMm===null)complete=false;
    micros+=Math.round((d.lengthMm??0)*1000);next=d.to;
  }
  return complete&&next===end?micros/1000:null;
}
export function segmentDimensionKey(document:HarnessDesignDocument,segmentId:string):string {
  const s=document.physicalTopology?.segments.find(s=>s.id===segmentId);
  return JSON.stringify(s?[s.id,s.from,s.to,s.bends.length]:null);
}
export function dimensionTargetKey(document:HarnessDesignDocument,d:DrawingDimension):string|null {
  if(d.segmentId)return document.physicalTopology?.segments.some(s=>s.id===d.segmentId)?segmentDimensionKey(document,d.segmentId):null;
  const wire=document.wires.find(w=>w.id===d.wireId);return wire?dimensionRouteKey(document,wire):null;
}
export function pipeMeasuredWireLength(document:HarnessDesignDocument,wireId:string):{managed:boolean;lengthMm:number|null} {
  const route=document.physicalTopology?.routes.find(r=>r.wireId===wireId);
  const dims=document.drawingDocuments?.dimensions??[];
  const managed=!!route?.steps.some(s=>dims.some(d=>d.segmentId===s.segmentId));
  if(!managed||!route?.steps.length)return {managed:false,lengthMm:null};
  let micros=0;
  for(const step of route.steps){const length=measuredWireLength(dims.filter(d=>d.segmentId===step.segmentId));if(length===null)return {managed:true,lengthMm:null};micros+=Math.round(length*1000);}
  return {managed:true,lengthMm:micros/1000};
}
export function validateDrawingDimensions(value:unknown,document:HarnessDesignDocument):readonly DrawingDimension[]|undefined {
  if(value===undefined)return undefined;
  const fail=():never=>{throw new Error("Некорректные размеры чертежа.");};
  if(!Array.isArray(value)||value.length>10000)return fail();
  const ids=new Set<string>();
  for(const d of value as DrawingDimension[]){
    if(!d)return fail();
    const pipe=d.segmentId!==undefined;
    if(!d||typeof d.id!=="string"||!d.id.trim()||d.id.length>128||ids.has(d.id)||pipe&&(typeof d.segmentId!=="string"||d.wireId!==undefined)||!pipe&&typeof d.wireId!=="string"||typeof d.routeKey!=="string"||d.routeKey.length>65536||!["horizontal","vertical","aligned"].includes(d.mode)||!Number.isFinite(d.offset)||Math.abs(d.offset)>1e7||!Number.isInteger(d.pointCount)||d.pointCount<2||d.pointCount>50000||!Number.isInteger(d.from)||!Number.isInteger(d.to)||d.from<0||d.to<=d.from||d.to>=d.pointCount||d.lengthMm!==null&&(!Number.isFinite(d.lengthMm)||d.lengthMm<0||d.lengthMm>1e7||Math.abs(d.lengthMm*1000-Math.round(d.lengthMm*1000))>1e-5))return fail();
    ids.add(d.id);
    if(d.routeKey!==dimensionTargetKey(document,d))return fail();
    if(pipe&&d.pointCount!==document.physicalTopology!.segments.find(s=>s.id===d.segmentId)!.bends.length+2)return fail();
  }
  for(const target of new Set((value as DrawingDimension[]).map(d=>d.segmentId??d.wireId))){const group=(value as DrawingDimension[]).filter(d=>(d.segmentId??d.wireId)===target);if(group.some(d=>d.pointCount!==group[0]!.pointCount))return fail();measuredWireLength(group);}
  return value as DrawingDimension[];
}
/** Pipe measurements own shared route lengths; legacy wire dimensions remain individual overrides. */
export function reconcileDrawingDimensions(before:HarnessDesignDocument,after:HarnessDesignDocument):HarnessDesignDocument {
  const old=before.drawingDocuments?.dimensions??[],current=after.drawingDocuments?.dimensions??[];
  if(!old.length&&!current.length)return after;
  const dimensions=current.filter(d=>{
    if(dimensionTargetKey(after,d)!==d.routeKey)return false;
    if(d.segmentId)return after.physicalTopology!.segments.find(s=>s.id===d.segmentId)!.bends.length+2===d.pointCount;
    const wire=after.wires.find(w=>w.id===d.wireId),previous=before.wires.find(w=>w.id===d.wireId);
    return wire&&(!previous||dimensionWirePoints(before,previous).length===dimensionWirePoints(after,wire).length);
  });
  const measured={...after,drawingDocuments:{...after.drawingDocuments!,dimensions}};
  return {...measured,wires:after.wires.map(w=>{
    const own=dimensions.filter(d=>d.wireId===w.id),shared=pipeMeasuredWireLength(measured,w.id);
    const affected=own.length||shared.managed||old.some(d=>d.wireId===w.id)||pipeMeasuredWireLength(before,w.id).managed;
    if(!affected)return w;
    const lengthMm=own.length?measuredWireLength(own):shared.lengthMm;
    calculateWireCutLength({...w,lengthMm});return {...w,lengthMm};
  })};
}
export function dimensionGeometry(a:Point,b:Point,mode:DimensionMode,offset:number):readonly Point[] {
  if(mode==="horizontal")return [a,{x:a.x,y:Math.max(a.y,b.y)+offset},{x:b.x,y:Math.max(a.y,b.y)+offset},b];
  if(mode==="vertical")return [a,{x:Math.max(a.x,b.x)+offset,y:a.y},{x:Math.max(a.x,b.x)+offset,y:b.y},b];
  const length=Math.hypot(b.x-a.x,b.y-a.y)||1,dx=-(b.y-a.y)/length*offset,dy=(b.x-a.x)/length*offset;
  return [a,{x:a.x+dx,y:a.y+dy},{x:b.x+dx,y:b.y+dy},b];
}
export function drawingDimensionScene(document:HarnessDesignDocument,wires:readonly EditorSceneObject[]):EditorSceneObject[] {
  return (document.drawingDocuments?.dimensions??[]).flatMap(d=>{
    const segment=document.physicalTopology?.segments.find(s=>s.id===d.segmentId);
    const points=segment?physicalSegmentControls(document,segment):wires.find(w=>w.id===d.wireId)?.points,a=points?.[d.from],b=points?.[d.to];
    if(!a||!b)return [];
    const valid=points?.length===d.pointCount;
    return [{id:d.id,kind:"dimension" as const,layerId:"dimensions",label:valid?(d.lengthMm===null?"— мм":`${d.lengthMm} мм`):"Обновите привязку",x:0,y:0,width:0,height:0,color:valid?"#55798e":"#bb3333",points:dimensionGeometry(a,b,d.mode,d.offset),metadata:{boundDimension:"true"}}];
  });
}
