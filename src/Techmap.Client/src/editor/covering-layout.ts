import type { EditorSceneObject } from "./editor-types";
import type { HarnessDesignDocument, Point } from "./model";
import { coveringControlFractions, coveringKind, coveringRoute, resolvedCoveringSpan, trimPolyline, type PhysicalCovering } from "./physical-coverings";
import { drawingPhysicalScale, drawingPipeWidth, segmentWireLanes } from "./drawing-thickness";
import { drawingBendRadius, drawingRouteSection, projectOntoDrawingRoute } from "./drawing-route-path";

export interface CoveringHandle { readonly objectId:string; readonly spanIndex:number; readonly part:"from"|"to"; readonly point:Point; readonly normal:Point; readonly halfWidth:number; readonly bound:boolean }
export interface CoveringSurface { readonly polygon:readonly Point[]; readonly path:readonly Point[]; readonly spanIndex?:number }
export type CoveringDragPart="from"|"to"|"body";

/** Mitered edges are shared by the filled surface and endpoint grips. */
export function offsetPolyline(points:readonly Point[],offsets:readonly number[]):Point[] {
 return points.map((p,i)=>{
  const a=points[Math.max(0,i-1)]!,b=points[Math.min(points.length-1,i+1)]!;
  const before=Math.hypot(p.x-a.x,p.y-a.y),after=Math.hypot(b.x-p.x,b.y-p.y);
  const u=before?{x:-(p.y-a.y)/before,y:(p.x-a.x)/before}:null,v=after?{x:-(b.y-p.y)/after,y:(b.x-p.x)/after}:null;
  const n=u&&v?{x:u.x+v.x,y:u.y+v.y}:u??v??{x:0,y:1},len=Math.hypot(n.x,n.y)||1;
  const normal={x:n.x/len,y:n.y/len},factor=u&&v?1/Math.max(.25,normal.x*v.x+normal.y*v.y):1;
  return {x:p.x+normal.x*offsets[i]!*factor,y:p.y+normal.y*offsets[i]!*factor};
 });
}

export function coveringScene(document:HarnessDesignDocument):EditorSceneObject[] {
 const topology=document.physicalTopology;if(!topology)return [];
 const scale=drawingPhysicalScale(document),coverings=topology.coverings??[];
 return coverings.map((covering,order)=>{
  const handles:CoveringHandle[]=[],surfaces:CoveringSurface[]=[],paths:Point[][]=[];
  let maximumWidth=0;
  for(const [spanIndex,original] of covering.spans.entries()){
   const s=resolvedCoveringSpan(document,original),route=coveringRoute(document,s.segmentId),segment=topology.segments.find(p=>p.id===s.segmentId);if(!route||!segment)continue;
   const from=Math.max(route.min,s.from),to=Math.min(route.max,s.to);if(from>=to)continue;
   // Include both pipe exits so a shrink surface can taper instead of crossing its own corners.
   const fractions=[from,...coveringControlFractions(document,s.segmentId).filter(f=>f>from&&f<to),to];
   const display=drawingRouteSection(route.points,drawingBendRadius(document),route.before+from*route.length,route.before+to*route.length,fractions.map(f=>route.before+f*route.length));
   const centerline=display.map(s=>s.point);if(centerline.length<2)continue;
   const pipeWidth=drawingPipeWidth(document,segment),lanes=segmentWireLanes(document,segment.id);
   const bundle=lanes.length?2*Math.max(...lanes.map(l=>Math.abs(l.offset)+l.width/2)):pipeWidth;
   const halfAt=(fraction:number):number=>{
    let width=pipeWidth;
    if(coveringKind(covering)==="heat-shrink"&&(fraction<0||fraction>1)){
     const travel=(fraction<0?-fraction:fraction-1)*route.length;
     width=pipeWidth+(bundle-pipeWidth)*Math.min(1,travel/Math.max(12*scale,pipeWidth));
    }
    // Array order is the physical stacking order; any lower surface remains enclosed.
    for(const lower of coverings.slice(0,order)) {
     if(lower.spans.some(ls=>{const r=resolvedCoveringSpan(document,ls);return ls.segmentId===s.segmentId&&fraction>=r.from&&fraction<=r.to;}))
      width=Math.max(lower.width*scale,width+.5*scale);
    }
    return Math.max(covering.width*scale,width+.5*scale)/2;
   };
   const widths=display.map(s=>halfAt((s.distance-route.before)/route.length));
   for(const width of widths)maximumWidth=Math.max(maximumWidth,2*width);
   const left=offsetPolyline(centerline,widths),right=offsetPolyline(centerline,widths.map(w=>-w));
   surfaces.push({polygon:[...left,...right.reverse()],path:centerline,spanIndex});paths.push(centerline);
   for(const part of ["from","to"] as const){const i=part==="from"?0:centerline.length-1,p=centerline[i]!,q=centerline[part==="from"?1:i-1]!,len=Math.hypot(q.x-p.x,q.y-p.y)||1;handles.push({objectId:covering.id,spanIndex,part,point:p,normal:{x:-(q.y-p.y)/len,y:(q.x-p.x)/len},halfWidth:widths[i]!,bound:original[part==="from"?"fromAnchor":"toAnchor"]!==undefined});}
  }
  return {id:covering.id,kind:"physical-covering",layerId:"wires",x:0,y:0,width:maximumWidth,height:0,color:covering.color,label:covering.name,paths,points:paths.flat(),routeRadius:0,metadata:{coveringKind:coveringKind(covering),surfaces:JSON.stringify(surfaces),coveringHandles:JSON.stringify(handles)}};
 });
}

export function moveCovering(document:HarnessDesignDocument,id:string,spanIndex:number,part:CoveringDragPart,start:Point,point:Point,tolerance=10):PhysicalCovering|null {
 const c=document.physicalTopology?.coverings?.find(c=>c.id===id),original=c?.spans[spanIndex];if(!c||!original)return null;
 const route=coveringRoute(document,original.segmentId);if(!route)return null;
 const s=resolvedCoveringSpan(document,original),project=(p:Point)=>(projectOntoDrawingRoute(route.points,drawingBendRadius(document),p)-route.before)/route.length;
 const delta=project(point)-project(start),minimum=Math.min(.001,(s.to-s.from)/4);
 let from=s.from,to=s.to,fromAnchor=original.fromAnchor,toAnchor=original.toAnchor;
 if(part==="body"){
  const shift=Math.max(route.min-from,Math.min(route.max-to,delta));from+=shift;to+=shift;fromAnchor=toAnchor=undefined;
 }else {
  const target=Math.max(part==="from"?route.min:from+minimum,Math.min(part==="to"?route.max:to-minimum,(part==="from"?from:to)+delta));
  const fractions=coveringControlFractions(document,s.segmentId);
  const anchor=fractions.findIndex(f=>Math.abs(f-target)*route.length<=tolerance&&(part==="from"?f<to:f>from));
  if(part==="from"){from=anchor<0?target:fractions[anchor]!;fromAnchor=anchor<0?undefined:anchor;}else {to=anchor<0?target:fractions[anchor]!;toAnchor=anchor<0?undefined:anchor;}
 }
 return {...c,spans:c.spans.map((span,i)=>i===spanIndex?{...span,from,to,fromAnchor,toAnchor}:span)};
}

/** Wires run parallel inside shrink extensions, then fan out beyond the sleeve edge. */
export function wireExitPath(document:HarnessDesignDocument,segmentId:string,nodeSide:"from"|"to",wireId:string,contact:Point):Point[]|null {
 const route=coveringRoute(document,segmentId);if(!route)return null;
 const fractions=(document.physicalTopology?.coverings??[]).filter(c=>coveringKind(c)==="heat-shrink").flatMap(c=>c.spans.filter(s=>s.segmentId===segmentId).map(s=>resolvedCoveringSpan(document,s)));
 const end=nodeSide==="from"?Math.max(route.min,Math.min(0,...fractions.filter(s=>s.from<0&&s.to>=0).map(s=>s.from))):Math.min(route.max,Math.max(1,...fractions.filter(s=>s.to>1&&s.from<=1).map(s=>s.to)));
 if(nodeSide==="from"?end===0:end===1)return null;
 const a=Math.min(nodeSide==="from"?0:1,end),b=Math.max(nodeSide==="from"?0:1,end);
 const path=trimPolyline(route.points,(route.before+a*route.length)/route.total,(route.before+b*route.length)/route.total);
 const lane=segmentWireLanes(document,segmentId).find(l=>l.id===wireId)?.offset??0;
 const points=offsetPolyline(path,path.map(()=>lane));
 return nodeSide==="from"?[contact,...points]:[...points,contact];
}
