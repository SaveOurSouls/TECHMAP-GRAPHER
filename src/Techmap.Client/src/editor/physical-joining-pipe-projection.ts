import type { HarnessDesignDocument, Point } from "./model";
import type { JoiningPipeMember, PhysicalJoiningPipe } from "./physical-topology-model";
import { drawingBendRadius, drawingRouteSamples } from "./drawing-route-path";
import { drawingPhysicalScale, drawingPipeWidth } from "./drawing-thickness";
import { pathLength } from "./physical-coverings";
import { physicalSegmentPoints } from "./physical-geometry";
import { joiningPipePoints, joiningMemberPoints } from "./physical-joining-pipes";
import { packPipeBundle } from "./pipe-bundle-packing";

export interface JoiningPipeSample { readonly fraction:number; readonly point:Point }
const mix=(a:Point,b:Point,t:number):Point=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
function at(samples:readonly JoiningPipeSample[],fraction:number):Point {
  if(fraction<=samples[0]!.fraction)return samples[0]!.point;
  const i=samples.findIndex(s=>s.fraction>=fraction);if(i<0)return samples.at(-1)!.point;
  const a=samples[i-1]!,b=samples[i]!;return mix(a.point,b.point,(fraction-a.fraction)/(b.fraction-a.fraction||1));
}
function sample(points:readonly Point[],radius:number):JoiningPipeSample[] {
  const length=pathLength(points);
  return drawingRouteSamples(points,radius).map(s=>({fraction:length?s.distance/length:0,point:s.point}));
}
export function joiningPipePacking(document:HarnessDesignDocument,pipe:PhysicalJoiningPipe) {
  const scale=drawingPhysicalScale(document),t=document.physicalTopology!;
  return packPipeBundle(pipe.members.map((m,i)=>({id:String(i),diameter:Math.max(.5*scale,...m.segmentIds.map(id=>{
    let width=drawingPipeWidth(document,t.segments.find(s=>s.id===id)!);
    for(const c of t.coverings??[])if(!c.bundle&&c.spans.some(s=>s.segmentId===id))width=Math.max(c.width*scale,width+.5*scale);
    return width;
  }))})),pipe.mode);
}
export function joiningPipeWidth(document:HarnessDesignDocument,pipe:PhysicalJoiningPipe):number {
  return Math.max((pipe.width??0)*drawingPhysicalScale(document),joiningPipePacking(document,pipe).width+drawingPhysicalScale(document));
}
// Parallel offsets use the same bend stations, including sharp corners. Capped
// miters keep a tight turn finite; the OP remains the authoritative centreline.
function offsetSamples(axis:readonly JoiningPipeSample[],offset:number):JoiningPipeSample[] {
  return axis.map((s,i)=>{
    const p=s.point,a=axis[Math.max(0,i-1)]!.point,b=axis[Math.min(axis.length-1,i+1)]!.point;
    const la=Math.hypot(p.x-a.x,p.y-a.y),lb=Math.hypot(b.x-p.x,b.y-p.y);
    const u=la?{x:-(p.y-a.y)/la,y:(p.x-a.x)/la}:null,v=lb?{x:-(b.y-p.y)/lb,y:(b.x-p.x)/lb}:null;
    const n=u&&v?{x:u.x+v.x,y:u.y+v.y}:u??v??{x:0,y:1},l=Math.hypot(n.x,n.y)||1;
    const normal={x:n.x/l,y:n.y/l},factor=u&&v?Math.min(2,1/Math.max(.5,normal.x*v.x+normal.y*v.y)):1;
    return {fraction:s.fraction,point:{x:p.x+normal.x*offset*factor,y:p.y+normal.y*offset*factor}};
  });
}
interface Placement {
  readonly source:readonly JoiningPipeSample[];
  readonly axis:readonly JoiningPipeSample[];
  readonly enter:readonly JoiningPipeSample[];
  readonly exit:readonly JoiningPipeSample[];
  readonly member:JoiningPipeMember;
  readonly before:number; readonly length:number; readonly total:number;
  readonly low:number; readonly high:number;
}
const cache=new WeakMap<HarnessDesignDocument,ReadonlyMap<string,Placement>>();
function placements(document:HarnessDesignDocument):ReadonlyMap<string,Placement> {
  const known=cache.get(document);if(known)return known;
  const result=new Map<string,Placement>(),t=document.physicalTopology,radius=drawingBendRadius(document);
  for(const pipe of t?.joiningPipes??[]){
    const axis=sample(joiningPipePoints(pipe),radius),packed=joiningPipePacking(document,pipe);
    for(const [i,member] of pipe.members.entries()){
      const source=sample(joiningMemberPoints(document,member.segmentIds),radius);
      const lane=offsetSamples(axis,packed.members[i]!.offset);
      const oriented=member.reverse?[...lane].reverse().map(s=>({fraction:1-s.fraction,point:s.point})):lane;
      const lengths=member.segmentIds.map(id=>pathLength(physicalSegmentPoints(document,t!.segments.find(s=>s.id===id)!))),total=lengths.reduce((a,b)=>a+b,0);
      const low=member.from/2,high=(1+member.to)/2;
      const shoulder=(edge:Point,next:Point,outer:Point):Point=>{
        const dx=next.x-edge.x,dy=next.y-edge.y,len=Math.hypot(dx,dy)||1;
        const lead=Math.max(20,Math.min(100,Math.hypot(edge.x-outer.x,edge.y-outer.y)/3));
        return {x:edge.x-dx/len*lead,y:edge.y-dy/len*lead};
      };
      const a=oriented[0]!.point,b=oriented.at(-1)!.point,outerA=at(source,low),outerB=at(source,high);
      const enter=sample([outerA,shoulder(a,oriented[1]!.point,outerA),a],radius);
      const exit=sample([b,shoulder(b,oriented.at(-2)!.point,outerB),outerB],radius);
      let before=0;
      member.segmentIds.forEach((id,j)=>{result.set(id,{source,axis:oriented,enter,exit,member,before,length:lengths[j]!,total,low,high});before+=lengths[j]!;});
    }
  }
  cache.set(document,result);return result;
}
function chainFraction(p:Placement,fraction:number) {return (p.before+fraction*p.length)/(p.total||1);}
function localFraction(p:Placement,fraction:number) {return (fraction*p.total-p.before)/(p.length||1);}
export function hasJoiningPipeProjection(document:HarnessDesignDocument,id:string) {return placements(document).has(id);}
export function joiningPipeControlsMemberStation(document:HarnessDesignDocument,id:string,fraction:number) {
  const p=placements(document).get(id);if(!p)return false;
  const t=chainFraction(p,fraction);return t>=p.member.from&&t<=p.member.to;
}
export function projectJoiningPipePoint(document:HarnessDesignDocument,id:string,fraction:number,point:Point):Point {
  const p=placements(document).get(id);if(!p)return point;
  const t=chainFraction(p,fraction),m=p.member;
  let projected:Point;
  if(t<=p.low||t>=p.high)return point;
  if(t<m.from)projected=at(p.enter,(t-p.low)/(m.from-p.low));
  else if(t>m.to)projected=at(p.exit,(t-m.to)/(p.high-m.to));
  else projected=at(p.axis,(t-m.from)/(m.to-m.from));
  const original=at(p.source,t);
  return {x:point.x+projected.x-original.x,y:point.y+projected.y-original.y};
}
export function joiningPipeProjectionStops(document:HarnessDesignDocument,id:string):number[] {
  const p=placements(document).get(id);if(!p)return [];
  const m=p.member;
  return [...p.source.map(s=>s.fraction),...p.enter.map(s=>p.low+s.fraction*(m.from-p.low)),
    ...p.axis.map(s=>m.from+s.fraction*(m.to-m.from)),...p.exit.map(s=>m.to+s.fraction*(p.high-m.to))]
    .map(t=>localFraction(p,t)).filter(t=>t>=0&&t<=1);
}
const displayCache=new WeakMap<HarnessDesignDocument,Map<string,readonly JoiningPipeSample[]>>();
export function joiningPipeDisplaySamples(document:HarnessDesignDocument,id:string):readonly JoiningPipeSample[]|undefined {
  const p=placements(document).get(id);if(!p)return undefined;
  let map=displayCache.get(document);if(!map){map=new Map();displayCache.set(document,map);}
  const known=map.get(id);if(known)return known;
  const fractions=[...new Set([0,1,...joiningPipeProjectionStops(document,id)])].sort((a,b)=>a-b);
  const result=fractions.map(fraction=>({fraction,point:projectJoiningPipePoint(document,id,fraction,at(p.source,chainFraction(p,fraction)))}));
  map.set(id,result);return result;
}
