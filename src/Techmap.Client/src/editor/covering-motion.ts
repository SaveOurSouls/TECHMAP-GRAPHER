import type { HarnessDesignDocument, Point } from "./model";
import { pipeBundlePaths } from "./pipe-bundle-model";
import { coveringRoute, resolvedCoveringSpan, type PhysicalCovering, type CoveringSpan } from "./physical-coverings";
import { drawingBendRadius, drawingRouteSection } from "./drawing-route-path";
import { pipeBundleProjectionStops, projectPipeBundlePoint } from "./pipe-bundle-projection";

interface Station { point: Point; distance: number }
interface Part { id: string; before: number; length: number; min: number; max: number }
interface Interval { from: number; to: number }

function closestDistance(stations: readonly Station[], point: Point): number {
  let nearest=Infinity,result=0;
  for(let i=1;i<stations.length;i++){
    const a=stations[i-1]!,b=stations[i]!,dx=b.point.x-a.point.x,dy=b.point.y-a.point.y;
    const t=Math.max(0,Math.min(1,((point.x-a.point.x)*dx+(point.y-a.point.y)*dy)/(dx*dx+dy*dy||1)));
    const distance=Math.hypot(point.x-a.point.x-t*dx,point.y-a.point.y-t*dy);
    if(distance<nearest){nearest=distance;result=a.distance+(b.distance-a.distance)*t;}
  }
  return result;
}

function coveringAxis(document:HarnessDesignDocument,covering:PhysicalCovering,ids:readonly string[]){
  const parts:Part[]=[],stations:Station[]=[];
  let length=0;
  for(const [i,id] of ids.entries()){
    const route=coveringRoute(document,id);if(!route)return null;
    const before=length,min=i===0?route.min:0,max=i===ids.length-1?route.max:1;
    parts.push({id,before,length:route.length,min,max});
    const display=drawingRouteSection(route.points,drawingBendRadius(document),route.before+min*route.length,route.before+max*route.length,
      pipeBundleProjectionStops(document,id,covering.id).map(f=>route.before+f*route.length));
    stations.push(...display.map(p=>({distance:before+p.distance-route.before,
      point:projectPipeBundlePoint(document,id,(p.distance-route.before)/route.length,p.point,covering.id)})));
    length+=route.length;
  }
  const intervals:Interval[]=[];
  const ranges=covering.spans.flatMap(s=>{
    const part=parts.find(p=>p.id===s.segmentId);if(!part)return [];
    const resolved=resolvedCoveringSpan(document,s);
    return [{from:part.before+resolved.from*part.length,to:part.before+resolved.to*part.length}];
  }).sort((a,b)=>a.from-b.from);
  for(const range of ranges){const last=intervals.at(-1);if(last&&range.from<=last.to+1e-7)last.to=Math.max(last.to,range.to);else intervals.push({...range});}
  return {parts,stations,intervals,length,min:parts[0]!.min*parts[0]!.length,max:length+(parts.at(-1)!.max-1)*parts.at(-1)!.length};
}

/** Translate a bundle sleeve in one longitudinal parameter space. Crossing a
 * split redistributes spans instead of stretching just the fragment under the
 * pointer. The command still owns one covering and one undo transaction. */
export function moveBundleCovering(document:HarnessDesignDocument,covering:PhysicalCovering,spanIndex:number,
  part:"from"|"to"|"body",start:Point,point:Point,tolerance:number):PhysicalCovering|null {
  if(!covering.bundle)return null;
  const original=covering.spans[spanIndex];if(!original)return null;
  const paths=pipeBundlePaths(covering,document.physicalTopology!.coverings??[]);
  const path=paths.find(ids=>ids.includes(original.segmentId));if(!path||path.length<2)return null;
  const axis=coveringAxis(document,covering,path);if(!axis||!axis.intervals.length)return null;
  const delta=closestDistance(axis.stations,point)-closestDistance(axis.stations,start);
  if(Math.abs(delta)<1e-8)return covering;
  const current=axis.parts.find(p=>p.id===original.segmentId)!,span=resolvedCoveringSpan(document,original);
  let ranges=axis.intervals.map(r=>({...r}));
  if(part==='body'){
    const shift=Math.max(axis.min-ranges[0]!.from,Math.min(axis.max-ranges.at(-1)!.to,delta));
    if(Math.abs(shift)<1e-8)return covering;
    ranges=ranges.map(r=>({from:r.from+shift,to:r.to+shift}));
  }else{
    const edge=current.before+(part==='from'?span.from:span.to)*current.length;
    const range=ranges.find(r=>edge>=r.from-1e-7&&edge<=r.to+1e-7);if(!range)return null;
    const index=ranges.indexOf(range),minimum=Math.min(current.length*.001,(range.to-range.from)/4);
    const lo=part==='from'?(ranges[index-1]?.to??axis.min):range.from+minimum;
    const hi=part==='from'?range.to-minimum:(ranges[index+1]?.from??axis.max);
    let target=Math.max(lo,Math.min(hi,edge+delta));
    const anchor=axis.parts.flatMap(p=>[p.before,p.before+p.length]).find(d=>d>=lo&&d<=hi&&Math.abs(d-target)<=tolerance);
    if(anchor!==undefined)target=anchor;
    if(part==='from')range.from=target;else range.to=target;
  }
  const spans:CoveringSpan[]=axis.parts.flatMap(p=>ranges.flatMap(r=>{
    const from=Math.max(p.before+p.min*p.length,r.from),to=Math.min(p.before+p.max*p.length,r.to);
    return to-from>1e-7?[{segmentId:p.id,from:(from-p.before)/p.length,to:(to-p.before)/p.length}]:[];
  }));
  return {...covering,spans:[...covering.spans.filter(s=>!path.includes(s.segmentId)),...spans]};
}

/** Internal fragment boundaries belong to one sleeve; only its exposed ends
 * get resize grips. Body picking retains the span identity for the command. */
export function bundleSpanEdgeVisible(document:HarnessDesignDocument,c:PhysicalCovering,index:number,edge:"from"|"to"):boolean{
  if(!c.bundle)return true;
  const span=c.spans[index]!,resolved=resolvedCoveringSpan(document,span);
  if(edge==='from'?Math.abs(resolved.from)>1e-7:Math.abs(resolved.to-1)>1e-7)return true;
  const path=pipeBundlePaths(c,document.physicalTopology!.coverings??[]).find(p=>p.includes(span.segmentId));if(!path)return true;
  const at=path.indexOf(span.segmentId),neighbor=path[at+(edge==='from'?-1:1)];if(!neighbor)return true;
  return !c.spans.some(s=>{const r=resolvedCoveringSpan(document,s);return s.segmentId===neighbor&&(edge==='from'?Math.abs(r.to-1)<1e-7:Math.abs(r.from)<1e-7);});
}
