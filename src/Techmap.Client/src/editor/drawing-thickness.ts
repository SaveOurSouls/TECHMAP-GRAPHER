import type { HarnessDesignDocument, WireInstance } from "./model";
import type { PhysicalSegment } from "./physical-topology-model";

/** Catalogue diameters are millimetres; drawing widths are deliberately relative. */
export function catalogOuterDiameter(payload:Readonly<Record<string,unknown>>):number|undefined {
  const fields=Object.entries(payload).map(([key,value])=>[key.toLowerCase().replace(/[\s_,.()-]/g,""),value] as const);
  for(const names of [["внешнийдиаметр","наружныйдиаметр","outerdiametermm","outerdiameter","externaldiameter"],["диаметризоляции","диаметрпоизоляции","insulationdiameter","insulationdiametermm"]]) {
    for(const [key,value] of fields)if(names.some(name=>key===name||key===name+"мм")) {
      const number=typeof value==="number"?value:typeof value==="string"?Number(value.trim().replace(/\s*(?:mm|мм)$/i,"").replace(",",".")):NaN;
      if(Number.isFinite(number)&&number>0&&number<=1000)return number;
    }
  }
  return undefined;
}
export function wireOuterDiameter(document:HarnessDesignDocument,wire:WireInstance):number|undefined {
  return wire.materialBinding?.outerDiameterMm ?? [wire.from,wire.to].map(e=>document.connectors.find(c=>c.id===e.connectorId)?.contacts.find(c=>c.id===e.contactId)?.wireDiameterMm).find(d=>d!==undefined);
}
export function drawingReferenceDiameter(document:HarnessDesignDocument):number {
  const values=document.wires.map(w=>wireOuterDiameter(document,w)).filter((d):d is number=>!!d&&d>0);
  return values.length?Math.min(...values):1;
}
export const drawingPhysicalScale=(document:HarnessDesignDocument)=>document.drawingDocuments?.physicalScale??1;
export function drawingWireWidth(document:HarnessDesignDocument,wire:WireInstance):number {
  const reference=drawingReferenceDiameter(document);
  return 2.5*drawingPhysicalScale(document)*(wireOuterDiameter(document,wire)??reference)/reference;
}
export function segmentWireLanes(document:HarnessDesignDocument,segmentId:string) {
  const members=(document.physicalTopology?.routes??[]).filter(r=>r.steps.some(s=>s.segmentId===segmentId)).map(r=>r.wireId).sort();
  const gap=.25*drawingPhysicalScale(document),widths=members.map(id=>drawingWireWidth(document,document.wires.find(w=>w.id===id)!));
  const total=widths.reduce((a,b)=>a+b,0)+Math.max(0,members.length-1)*gap;
  let x=-total/2;
  return members.map((id,i)=>{const width=widths[i]!,offset=x+width/2;x+=width+gap;return {id,width,offset};});
}
export function drawingPipeWidth(document:HarnessDesignDocument,segment:PhysicalSegment):number {
  const scale=drawingPhysicalScale(document),lanes=segmentWireLanes(document,segment.id);
  const bundle=lanes.length?lanes.at(-1)!.offset+lanes.at(-1)!.width/2-lanes[0]!.offset+lanes[0]!.width/2:0;
  return Math.max((segment.width??0)*scale,bundle+.5*scale);
}
