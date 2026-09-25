import { coveringWidthProfile, encloseWidthProfiles, profileHalfWidth, type WidthSupport } from "./covering-width-profile";
import type { EditorSceneObject } from "./editor-types";
import type { HarnessDesignDocument, Point } from "./model";
import { coveringControlFractions, coveringKind, coveringRoute, resolvedCoveringSpan, trimPolyline, type PhysicalCovering } from "./physical-coverings";
import { coveringDiameterRatio, drawingPhysicalScale, drawingPipeWidth, segmentWireLanes } from "./drawing-thickness";
import { drawingBendRadius, drawingRouteSection } from "./drawing-route-path";
import { pipeBundleSections } from "./pipe-bundle-section";
import { pipeBundleAxisPath, pipeBundleCoatingKey } from "./pipe-bundle-model";
import { pipeBundleProjectionStops, projectPipeBundlePoint, pipeBundleTransitionHandles } from "./pipe-bundle-projection";
import { moveBundleCovering, bundleSpanEdgeVisible } from "./covering-motion";

export interface CoveringHandle { readonly objectId:string; readonly spanIndex:number; readonly part:"from"|"to"|"transition-from"|"transition-to"; readonly point:Point; readonly normal:Point; readonly halfWidth:number; readonly bound:boolean }
export interface CoveringSurface { readonly polygon:readonly Point[]; readonly path:readonly Point[]; readonly spanIndex?:number; readonly openStart?:boolean; readonly openEnd?:boolean }
export type CoveringDragPart="from"|"to"|"body"|"transition-from"|"transition-to";
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
 const scale=drawingPhysicalScale(document),sourceCoverings=topology.coverings??[];
 const diameterRatio=coveringDiameterRatio(document),coveringClearance=.5*scale;
 // Physical stacking of ordinary coatings is authored by array order. Bundle
 // shells are painted after their contained groups regardless of save order.
 const coverings:PhysicalCovering[]=sourceCoverings.filter(c=>!c.bundle),seen=new Set(coverings.map(c=>c.id));
 const addBundle=(covering:PhysicalCovering)=>{if(seen.has(covering.id))return;seen.add(covering.id);
   for(const member of covering.bundle?.members??[])if(member.kind==='covering'){const inner=sourceCoverings.find(c=>c.id===member.id);if(inner){
     for(const layer of sourceCoverings)if(layer.bundle&&pipeBundleCoatingKey(layer)===pipeBundleCoatingKey(inner))addBundle(layer);
   }}
   coverings.push(covering);};
 for(const covering of sourceCoverings)if(covering.bundle)addBundle(covering);
 const bundleSections=pipeBundleSections(document);
 const supportsBySegment=new Map<string,WidthSupport[]>();
 return coverings.map((covering,order)=>{
  const handles:CoveringHandle[]=[],surfaces:CoveringSurface[]=[],paths:Point[][]=[];
  const ownSupports:{segmentId:string;support:WidthSupport}[]=[];
  let maximumWidth=0;
  const bundleAxis=covering.bundle?pipeBundleAxisPath(covering,sourceCoverings):undefined;
  for(const [spanIndex,original] of covering.spans.entries()){
   if(bundleAxis&&!bundleAxis.includes(original.segmentId))continue;
   const s=resolvedCoveringSpan(document,original),route=coveringRoute(document,s.segmentId),segment=topology.segments.find(p=>p.id===s.segmentId);if(!route||!segment)continue;
   const from=Math.max(route.min,s.from),to=Math.min(route.max,s.to);if(from>=to)continue;
   const groupedWidth=bundleSections.get(covering.id)?.width;
   const pipeWidth=groupedWidth??drawingPipeWidth(document,segment),lanes=segmentWireLanes(document,segment.id);
   const bundle=lanes.length?2*Math.max(...lanes.map(l=>Math.abs(l.offset)+l.width/2)):pipeWidth;
   const halfAt=(fraction:number):number=>{
    if(groupedWidth!==undefined)return groupedWidth/2;
    let width=pipeWidth;
    if(coveringKind(covering)==="heat-shrink"&&(fraction<0||fraction>1)) width=bundle;
    // Array order is the physical stacking order; any lower surface remains enclosed.
    for(const lower of coverings.slice(0,order)) {
     if(lower.spans.some(ls=>{const r=resolvedCoveringSpan(document,ls);return ls.segmentId===s.segmentId&&fraction>=r.from&&fraction<=r.to;}))
      width=Math.max(lower.width*scale,width+coveringClearance);
    }
    return (width+.5*scale)/2;
   };
   const boundaries=[0,1,...coverings.slice(0,order).flatMap(lower=>lower.spans.filter(ls=>ls.segmentId===s.segmentId).flatMap(ls=>{const r=resolvedCoveringSpan(document,ls);return [r.from,r.to];}))];
   const baseProfile=coveringWidthProfile(route.min*route.length,route.max*route.length,boundaries.map(f=>f*route.length),distance=>halfAt(distance/route.length));
   const fitted=encloseWidthProfiles(baseProfile,supportsBySegment.get(s.segmentId)??[],coveringClearance/2);
   // The width field controls the largest diameter. Every smaller diameter
   // grows with it, at 1/ratio of the increment per adjacent support level.
   const levels=[...new Set(fitted.map(p=>p.halfWidth))].sort((a,b)=>b-a);
   const growth=Math.max(0,covering.width*scale/2-(levels[0]??0));
   const profile=fitted.map(p=>({...p,halfWidth:p.halfWidth+growth/Math.pow(diameterRatio,levels.indexOf(p.halfWidth))}));
   ownSupports.push({segmentId:s.segmentId,support:{from:from*route.length,to:to*route.length,profile}});
   const stops=[...profile.map(p=>route.before+p.at),...[...coveringControlFractions(document,s.segmentId),...pipeBundleProjectionStops(document,s.segmentId,covering.id)].map(f=>route.before+f*route.length)];
   const display=drawingRouteSection(route.points,drawingBendRadius(document),route.before+from*route.length,route.before+to*route.length,stops);
   const centerline=display.map(p=>projectPipeBundlePoint(document,s.segmentId,(p.distance-route.before)/route.length,p.point,covering.id));if(centerline.length<2)continue;
   const widths=display.map(s=>profileHalfWidth(profile,s.distance-route.before));
   for(const width of widths)maximumWidth=Math.max(maximumWidth,2*width);
   const left=offsetPolyline(centerline,widths),right=offsetPolyline(centerline,widths.map(w=>-w));
   surfaces.push({polygon:[...left,...right.reverse()],path:centerline,spanIndex,
     ...(!bundleSpanEdgeVisible(document,covering,spanIndex,'from')?{openStart:true}:{}),
     ...(!bundleSpanEdgeVisible(document,covering,spanIndex,'to')?{openEnd:true}:{})});paths.push(centerline);
   for(const part of ["from","to"] as const){if(!bundleSpanEdgeVisible(document,covering,spanIndex,part))continue;const i=part==="from"?0:centerline.length-1,p=centerline[i]!,q=centerline[part==="from"?1:i-1]!,len=Math.hypot(q.x-p.x,q.y-p.y)||1;handles.push({objectId:covering.id,spanIndex,part,point:p,normal:{x:-(q.y-p.y)/len,y:(q.x-p.x)/len},halfWidth:widths[i]!,bound:original[part==="from"?"fromAnchor":"toAnchor"]!==undefined});}
  }
  if(covering.bundle)handles.push(...pipeBundleTransitionHandles(document,covering.id));
  for(const {segmentId,support} of ownSupports) supportsBySegment.set(segmentId,[...(supportsBySegment.get(segmentId)??[]),support]);
  return {id:covering.id,kind:"physical-covering",layerId:"wires",x:0,y:0,width:maximumWidth,height:0,color:covering.color,label:covering.name,paths,points:paths.flat(),routeRadius:0,metadata:{coveringKind:coveringKind(covering),...(document.drawingDocuments?.volumeShading === false ? {volumeShading:"false"} : {}),coveringStyle:JSON.stringify({...covering.style,texture:!covering.style?.texture||covering.style.texture==="auto"?document.drawingDocuments?.coveringLibrary?.defaults[coveringKind(covering)]?.texture??"auto":covering.style.texture}),surfaces:JSON.stringify(surfaces),coveringHandles:JSON.stringify(handles)}};
 });
}

export function moveCovering(document:HarnessDesignDocument,id:string,spanIndex:number,part:CoveringDragPart,start:Point,point:Point,tolerance=10):PhysicalCovering|null {
 const c=document.physicalTopology?.coverings?.find(c=>c.id===id),original=c?.spans[spanIndex];if(!c||!original)return null;
 if(part==="transition-from"||part==="transition-to"){
  if(!c.bundle)return null;
  const grip=pipeBundleTransitionHandles(document,c.id).find(h=>h.part===part&&h.spanIndex===spanIndex);if(!grip)return null;
  const dx=point.x-start.x,dy=point.y-start.y,change=(dx*grip.tangent.x+dy*grip.tangent.y)/grip.axisLength;
  const key=part==="transition-from"?"transitionStart":"transitionEnd";
  return {...c,bundle:{...c.bundle,[key]:Math.max(.001,Math.min(.5,grip.fraction+(part==="transition-from"?-change:change)))}};
 }
 const bundleMove=moveBundleCovering(document,c,spanIndex,part,start,point,tolerance);if(bundleMove)return bundleMove;
 const route=coveringRoute(document,original.segmentId);if(!route)return null;
 const s=resolvedCoveringSpan(document,original);
 const display=drawingRouteSection(route.points,drawingBendRadius(document),0,route.total,
   pipeBundleProjectionStops(document,original.segmentId,c.id).map(f=>route.before+f*route.length))
   .map(p=>({distance:p.distance,point:projectPipeBundlePoint(document,original.segmentId,(p.distance-route.before)/route.length,p.point,c.id)}));
 const project=(point:Point)=>{
   let nearest=Infinity,at=0;
   for(let i=1;i<display.length;i++){const a=display[i-1]!,b=display[i]!,dx=b.point.x-a.point.x,dy=b.point.y-a.point.y;
     const t=Math.max(0,Math.min(1,((point.x-a.point.x)*dx+(point.y-a.point.y)*dy)/(dx*dx+dy*dy||1)));
     const distance=Math.hypot(point.x-a.point.x-t*dx,point.y-a.point.y-t*dy);
     if(distance<nearest){nearest=distance;at=a.distance+(b.distance-a.distance)*t;}
   }
   return (at-route.before)/route.length;
 };
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
