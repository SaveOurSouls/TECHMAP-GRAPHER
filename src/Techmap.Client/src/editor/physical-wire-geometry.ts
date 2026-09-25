import type { HarnessDesignDocument, Point } from "./model";
import { physicalSegmentPoints, physicalContactTail } from "./physical-geometry";
import { segmentWireLanes } from "./drawing-thickness";
import { coveringKind, coveringRoute, resolvedCoveringSpan, trimPolyline } from "./physical-coverings";
import { hasPipeBundleProjection, pipeBundleDisplaySamples } from "./pipe-bundle-projection";
import { drawingBendRadius, drawingRouteHitPoints } from "./drawing-route-path";

/** Conductors follow the pipe centreline exactly; do not apply another angle snap. */
export function physicalWirePoints(document: HarnessDesignDocument, wireId: string, start: Point, end: Point): Point[] | null {
  const topology = document.physicalTopology;
  const route = topology?.routes.find(r => r.wireId === wireId);
  if (!topology || !route?.steps.length) return null;
  const points = route.steps.flatMap(step => {
    const segment = topology.segments.find(s => s.id === step.segmentId)!;
    const path = physicalSegmentPoints(document, segment);
    return step.reverse ? path.reverse() : path;
  });
  const first = route.steps[0]!, last = route.steps.at(-1)!;
  const a = topology.segments.find(s => s.id === first.segmentId)!;
  const b = topology.segments.find(s => s.id === last.segmentId)!;
  const from = topology.nodes.find(n => n.id === (first.reverse ? a.to : a.from))!;
  const to = topology.nodes.find(n => n.id === (last.reverse ? b.from : b.to))!;
  const wire = document.wires.find(w => w.id === wireId)!;
  const fromTail = physicalContactTail(document, from, wire.from.contactId, start, points[0]!);
  const toTail = physicalContactTail(document, to, wire.to.contactId, end, points.at(-1)!).reverse();
  return [...fromTail.slice(0,-1), ...points, ...toTail.slice(1)].filter((p,i,all) => !i || Math.hypot(p.x-all[i-1]!.x,p.y-all[i-1]!.y)>1e-7);
}

/** Display lanes never alter measured centreline geometry or electrical endpoints. */
const offsetPolyline=(points:readonly Point[],offsets:readonly number[]):Point[]=>points.map((p,i)=>{const a=points[Math.max(0,i-1)]!,b=points[Math.min(points.length-1,i+1)]!,before=Math.hypot(p.x-a.x,p.y-a.y),after=Math.hypot(b.x-p.x,b.y-p.y),u=before?{x:-(p.y-a.y)/before,y:(p.x-a.x)/before}:null,v=after?{x:-(b.y-p.y)/after,y:(b.x-p.x)/after}:null,n=u&&v?{x:u.x+v.x,y:u.y+v.y}:u??v??{x:0,y:1},len=Math.hypot(n.x,n.y)||1;return {x:p.x+n.x/len*offsets[i]!,y:p.y+n.y/len*offsets[i]!};});
export function physicalWireDisplayPaths(document:HarnessDesignDocument,wireId:string,start:Point,end:Point):Point[][]|undefined {
 const t=document.physicalTopology,route=t?.routes.find(r=>r.wireId===wireId);if(!t||!route?.steps.length)return undefined;
 const paths:Point[][]=[];
 const projected=route.steps.some(step=>hasPipeBundleProjection(document,step.segmentId));
 for(const step of route.steps){
  const segment=t.segments.find(s=>s.id===step.segmentId)!;
  if(segment.showWires===false)continue;
  const offset=segmentWireLanes(document,segment.id).find(l=>l.id===wireId)?.offset??0;
  const points=pipeBundleDisplaySamples(document,segment.id)?.map(s=>s.point)??(projected?drawingRouteHitPoints(physicalSegmentPoints(document,segment),drawingBendRadius(document)):physicalSegmentPoints(document,segment));
  const lane=offsetPolyline(points,points.map(()=>offset));
  if(step.reverse)lane.reverse();paths.push(lane);
 }
 const first=route.steps[0]!,last=route.steps.at(-1)!;
 const a=physicalSegmentPoints(document,t.segments.find(s=>s.id===first.segmentId)!);
 const b=physicalSegmentPoints(document,t.segments.find(s=>s.id===last.segmentId)!);
 const from=first.reverse?a.at(-1)!:a[0]!,to=last.reverse?b[0]!:b.at(-1)!;
 const wireExitPath=(document:HarnessDesignDocument,segmentId:string,nodeSide:"from"|"to",wireId:string,contactId:string,contact:Point):Point[]|null=>{
  const route=coveringRoute(document,segmentId);if(!route)return null;
  const spans=(document.physicalTopology?.coverings??[]).filter(c=>coveringKind(c)==="heat-shrink").flatMap(c=>c.spans.filter(s=>s.segmentId===segmentId).map(s=>resolvedCoveringSpan(document,s)));
  const edge=nodeSide==="from"?Math.max(route.min,Math.min(0,...spans.filter(s=>s.from<0&&s.to>=0).map(s=>s.from))):Math.min(route.max,Math.max(1,...spans.filter(s=>s.to>1&&s.from<=1).map(s=>s.to)));
  if(nodeSide==="from"?edge===0:edge===1)return null;const a=Math.min(nodeSide==="from"?0:1,edge),b=Math.max(nodeSide==="from"?0:1,edge);
  const path=trimPolyline(route.points,(route.before+a*route.length)/route.total,(route.before+b*route.length)/route.total),offset=segmentWireLanes(document,segmentId).find(l=>l.id===wireId)?.offset??0,lane=offsetPolyline(path,path.map(()=>offset));
  const segment=document.physicalTopology!.segments.find(s=>s.id===segmentId)!,nodeId=nodeSide==="from"?segment.from:segment.to,node=document.physicalTopology!.nodes.find(n=>n.id===nodeId)!;
  if(!lane.length)return null;
  const tail=physicalContactTail(document,node,contactId,contact,nodeSide==="from"?lane[0]!:lane.at(-1)!);
  return nodeSide==="from"?[...tail.slice(0,-1),...lane]:[...lane,...tail.reverse().slice(1)];
 };
 const wire=document.wires.find(w=>w.id===wireId)!;
 const fromNode=t.nodes.find(n=>n.id===(first.reverse?t.segments.find(s=>s.id===first.segmentId)!.to:t.segments.find(s=>s.id===first.segmentId)!.from))!;
 const toNode=t.nodes.find(n=>n.id===(last.reverse?t.segments.find(s=>s.id===last.segmentId)!.from:t.segments.find(s=>s.id===last.segmentId)!.to))!;
 const fromTail=wireExitPath(document,first.segmentId,first.reverse?"to":"from",wireId,wire.from.contactId,start);
 const toTail=wireExitPath(document,last.segmentId,last.reverse?"from":"to",wireId,wire.to.contactId,end);
 const startPath=fromTail?(first.reverse?fromTail.reverse():fromTail):physicalContactTail(document,fromNode,wire.from.contactId,start,from);
 const endPath=toTail?(last.reverse?toTail.reverse():toTail):physicalContactTail(document,toNode,wire.to.contactId,end,to).reverse();
 return [projected?drawingRouteHitPoints(startPath,drawingBendRadius(document)):startPath,...paths,projected?drawingRouteHitPoints(endPath,drawingBendRadius(document)):endPath];
}
