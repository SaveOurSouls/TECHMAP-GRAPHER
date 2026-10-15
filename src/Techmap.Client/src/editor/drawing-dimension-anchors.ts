import { artworkJacketAnchor, artworkWireDiameter } from "../wire-blank-artwork.mjs";
import { findWireEndpoint, type HarnessDesignDocument, type Point, type WireInstance } from "./model";
import { effectiveEndPreparation } from "./termination-model";
import { drawingWireWidth } from "./drawing-thickness";
import { physicalWirePoints } from "./physical-wire-geometry";

/** End decorations extend outside the jacket endpoint; only bare conductors
 * contribute to a dimension. Fittings are measured at their conductor input. */
export function wireDimensionEnd(document:HarnessDesignDocument,wire:WireInstance,end:"from"|"to"):Point|null {
 const endpoint=wire[end],connector=document.connectors.find(c=>c.id===endpoint.connectorId);
 const origin=wire.drawingEndpoints?.[end]??findWireEndpoint(document,endpoint,"drawing");
 if(!origin)return null;
 // An isolated illustration owns its endpoints independently of source P1.
 if(wire.drawingEndpoints)return origin;
 const preparation=effectiveEndPreparation(document,{wireId:wire.id,end});
 const mode=connector?.terminationComponent?.kind==="preparation"?preparation?.mode:undefined;
 if(mode!=="copper"&&mode!=="tin")return origin;
 const start=findWireEndpoint(document,wire.from,"drawing"),finish=findWireEndpoint(document,wire.to,"drawing");
 if(!start||!finish)return origin;
 const route=physicalWirePoints(document,wire.id,start,finish)??[start,...wire.drawingRoute,finish];
 const ordered=end==="from"?route:[...route].reverse();
 const adjacent=ordered.find(p=>Math.hypot(p.x-origin.x,p.y-origin.y)>1e-7);
 if(!adjacent)return origin;
 const dx=origin.x-adjacent.x,dy=origin.y-adjacent.y,length=Math.hypot(dx,dy);
 // Canonical conductor path: x=158 with a 1.1-unit outline. Include its
 // visible outer edge, rather than the jacket anchor or a viewBox corner.
 const extension=(artworkJacketAnchor-(158-1.1/2))*drawingWireWidth(document,wire)/artworkWireDiameter;
 return {x:origin.x+dx/length*extension,y:origin.y+dy/length*extension};
}

/** A pipe ends at its authored physical joint. Bare preparations additionally
 * include the attached wire tail and visible conductor beyond that joint. */
export function pipeTerminationDimensionEnd(document:HarnessDesignDocument,segmentId:string,side:"from"|"to",joint:Point,adjacent:Point):Point {
 const topology=document.physicalTopology,segment=topology?.segments.find(s=>s.id===segmentId),nodeId=segment?.[side];
 const connectorId=topology?.nodes.find(n=>n.id===nodeId)?.connectorId;
 const connector=document.connectors.find(c=>c.id===connectorId);
 if(connector?.terminationComponent?.kind!=="preparation")return joint;
 const candidates=document.wires.flatMap(w=>(["from","to"] as const).flatMap(end=>{
  if(w[end].connectorId!==connectorId||w.drawingEndpoints)return [];
  const route=topology?.routes.find(r=>r.wireId===w.id),step=end==="from"?route?.steps[0]:route?.steps.at(-1);
  if(step?.segmentId!==segmentId)return [];
  const startsAtFrom=end==="from"?!step.reverse:step.reverse;
  const routeNode=segment?.[startsAtFrom?"from":"to"];
  if(routeNode!==nodeId)return [];
  const mode=effectiveEndPreparation(document,{wireId:w.id,end})?.mode;
  if(mode!=="cut"&&mode!=="copper"&&mode!=="tin")return [];
  const point=wireDimensionEnd(document,w,end);return point?[point]:[];
 }));
 const dx=joint.x-adjacent.x,dy=joint.y-adjacent.y;
 return candidates.reduce<Point|null>((best,p)=>!best||(p.x-joint.x)*dx+(p.y-joint.y)*dy>(best.x-joint.x)*dx+(best.y-joint.y)*dy?p:best,null)??joint;
}
