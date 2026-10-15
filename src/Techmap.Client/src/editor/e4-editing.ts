import { defaultE4WireLead, wireEndpointE4Anchor, type HarnessDesignDocument, type E4RouteAnchor, type Point } from "./model";
import { segmentPointDistance } from "./segment-geometry";
import type { PhysicalDragMode } from "./physical-editing";
import { straightLeadEnd } from "./route-lead";
/** Edit authored points before the electrical route validates its leads and obstacles. */
export function editedE4Points(points:readonly Point[],index:number,point:Point,mode:PhysicalDragMode,insert=false,simplify=true):Point[] {
  if(!Number.isInteger(index)||index<0||index>=points.length-(insert?1:2))throw new Error("Точка маршрута Э4 не найдена.");
  if(!Number.isFinite(point.x)||!Number.isFinite(point.y))throw new Error("Координаты перегиба заданы неверно.");
  const result=points.map(p=>({...p})),at=index+1;
  if(insert){
    const a=result[index]!,b=result[at]!,delta={x:point.x-(a.x+b.x)/2,y:point.y-(a.y+b.y)/2};
    if(mode==="carry")for(const i of [index,at])if(i>0&&i<result.length-1)
      result[i]={x:result[i]!.x+delta.x,y:result[i]!.y+delta.y};
    result.splice(at,0,{...point});
  }
  else {
    const delta={x:point.x-result[at]!.x,y:point.y-result[at]!.y};
    result[at]={...point};
    if(mode==="carry")for(const i of [at-1,at+1])if(i>0&&i<result.length-1)
      result[i]={x:result[i]!.x+delta.x,y:result[i]!.y+delta.y};
  }
  if(simplify&&!insert&&mode==="carry")for(let i=result.length-2;i>0;i--){
    const a=result[i-1]!,b=result[i]!,c=result[i+1]!;
    if(Math.abs((b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x))<1e-7&&
      (b.x-a.x)*(c.x-b.x)+(b.y-a.y)*(c.y-b.y)>=0)result.splice(i,1);
  }
  return result;
}

/** Junction identity follows its original segment, never the nearest unrelated line. */
export function movedE4Junctions(document:HarnessDesignDocument,wireId:string,before:readonly Point[],after:readonly Point[],segments?:readonly (readonly Point[])[],finalPoints?:readonly Point[]):Map<string,Point> {
  const result=new Map<string,Point>();
  if(before.length!==after.length)throw new Error("Не совпадают опоры переноса узла.");
  for(const j of document.junctions.filter(j=>j.wireIds.includes(wireId))){
    for(let i=0;i<before.length-1;i++){
      const a=before[i]!,b=before[i+1]!;
      if(segmentPointDistance(j.position,{start:a,end:b})>1e-6)continue;
      const dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy,t=length?Math.max(0,Math.min(1,((j.position.x-a.x)*dx+(j.position.y-a.y)*dy)/length)):0;
      const p=after[i]!,q=after[i+1]!;
      let next=segments?pointAlong(segments[i]!,t):{x:p.x+(q.x-p.x)*t,y:p.y+(q.y-p.y)*t};
      // A collapsed/reversed shoulder no longer exists. Clamp its junction to
      // the surviving carrier, never to a nearby wire or a different net.
      if(finalPoints)next=nearestE4Point(finalPoints,next);
      if(Math.hypot(next.x-j.position.x,next.y-j.position.y)>1e-7)result.set(j.id,next);
      break;
    }
  }
  return result;
}

function nearestE4Point(points:readonly Point[],point:Point):Point {
  let best=point,distance=Infinity;
  for(let i=1;i<points.length;i++){
    const a=points[i-1]!,b=points[i]!,dx=b.x-a.x,dy=b.y-a.y,n=dx*dx+dy*dy;
    const t=n?Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/n)):0;
    const p={x:a.x+dx*t,y:a.y+dy*t},d=Math.hypot(p.x-point.x,p.y-point.y);
    if(d<distance){distance=d;best=p;}
  }
  return best;
}

function pointAlong(points:readonly Point[],fraction:number):Point {
  const lengths=points.slice(1).map((p,i)=>Math.hypot(p.x-points[i]!.x,p.y-points[i]!.y));
  let distance=lengths.reduce((sum,n)=>sum+n,0)*fraction;
  for(let i=0;i<lengths.length;i++){
    const length=lengths[i]!;
    if(distance<=length&&length>1e-8){const a=points[i]!,b=points[i+1]!,t=distance/length;return {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};}
    distance-=length;
  }
  return points.at(-1)!;
}

/** Rebuild only the moved shoulders. Carry propagates a coordinate along a
 * straight run; Shift keeps the neighbouring handles and inserts local elbows.
 * Segment correspondence lets electrical junctions follow their own carrier,
 * even when a straight segment acquires two new corners. No route search. */
export function orthogonalE4Deformation(before:readonly Point[],raw:readonly Point[],start:E4RouteAnchor,end:E4RouteAnchor,
  mode:PhysicalDragMode,focus?:number,retainFocus=false):{points:Point[];vertices:Point[];segments:Point[][]} {
  if(before.length!==raw.length)throw new Error('Не совпадают опоры переноса маршрута.');
  const vertices=raw.map(p=>({...p}));
  const horizontal=before.slice(1).map((b,i)=>Math.abs(b.x-before[i]!.x)>=Math.abs(b.y-before[i]!.y));
  if(mode==='carry')for(let first=0;first<horizontal.length;){
    let last=first;
    while(last+1<horizontal.length&&horizontal[last+1]===horizontal[first])last++;
    const key=horizontal[first]?'y':'x';
    const indices=Array.from({length:last-first+2},(_,i)=>first+i);
    const source=focus!==undefined&&indices.includes(focus)?focus:
      indices.find(i=>(i===0||i===raw.length-1)&&raw[i]![key]!==before[i]![key])??
      indices.find(i=>i===0||i===raw.length-1)??
      indices.reduce((best,i)=>Math.abs(raw[i]![key]-before[i]![key])>Math.abs(raw[best]![key]-before[best]![key])?i:best,first);
    for(const i of indices)if(i>0&&i<vertices.length-1)vertices[i]![key]=raw[source]![key];
    first=last+1;
  }
  const lead=(anchor:E4RouteAnchor):Point=>{
    const length=anchor.leadLength??defaultE4WireLead,d=anchor.leadDirection,p=anchor.position;
    return {x:p.x+(d==='right'?length:d==='left'?-length:0),y:p.y+(d==='down'?length:d==='up'?-length:0)};
  };
  const segments=vertices.slice(1).map((b,i)=>{
    const a=vertices[i]!;
    const forward=(anchor:E4RouteAnchor,p:Point)=>{
      const q=lead(anchor),o=anchor.position;
      return Math.abs((p.x-o.x)*(q.y-o.y)-(p.y-o.y)*(q.x-o.x))<1e-7&&
        (p.x-o.x)*(q.x-o.x)+(p.y-o.y)*(q.y-o.y)>0;
    };
    const first=i===0&&start.leadDirection&&!forward(start,b)?lead(start):a;
    const last=i===vertices.length-2&&end.leadDirection&&!forward(end,a)?lead(end):b;
    const path=[a,first];
    if(first.x!==last.x&&first.y!==last.y){
      // Enter/leave the dragged corner on its original axes. A single elbow
      // avoids the tiny S shoulders that otherwise obstruct T junctions.
      // Do not fold back behind a compulsory contact lead after a small Shift
      // move; otherwise retain the authored shoulder's along-axis position.
      const horizontalFirst=first!==a&&(last.x-first.x)*(first.x-a.x)+(last.y-first.y)*(first.y-a.y)<0
        ?start.leadDirection==='up'||start.leadDirection==='down'
        :focus===i+1?!horizontal[i]:horizontal[i];
      path.push(horizontalFirst?{x:last.x,y:first.y}:{x:first.x,y:last.y});
    }
    path.push(last,b);
    return simplifyE4Points(path);
  });
  return {points:simplifyE4Points(segments.flat(),retainFocus&&focus!==undefined?[vertices[focus]!]:[]),vertices,segments};
}

/** Remove redundant handles and zero-length/backtracking shoulders after a
 * corner crosses its neighbour. Endpoints remain exact. */
export function simplifyE4Points(points:readonly Point[],preserve:readonly Point[]=[]):Point[] {
  const result:Point[]=[];
  for(const point of points){
    if(result.length&&Math.hypot(point.x-result.at(-1)!.x,point.y-result.at(-1)!.y)<1e-7)continue;
    while(result.length>1){
      const a=result.at(-2)!,b=result.at(-1)!;
      if(preserve.some(p=>Math.hypot(p.x-b.x,p.y-b.y)<1e-7))break;
      if(!((a.x===b.x&&b.x===point.x)||(a.y===b.y&&b.y===point.y)))break;
      result.pop();
    }
    result.push({...point});
  }
  return result;
}

/** A T node follows its carrier, never a branch that merely ends there. If
 * several carriers move differently, use the junction's stored carrier order;
 * the remaining routes must join that one position in the same transaction. */
export function resolveE4JunctionMoves(document:HarnessDesignDocument,proposals:ReadonlyMap<string,ReadonlyMap<string,Point>>):Map<string,Point> {
  const result=new Map<string,Point>();
  for(const junction of document.junctions){
    for(const id of junction.wireIds){
      const wire=document.wires.find(w=>w.id===id);
      if(!wire||[wire.from,wire.to].some(e=>e.junctionId===junction.id))continue;
      const point=proposals.get(id)?.get(junction.id);
      if(point){result.set(junction.id,point);break;}
    }
  }
  return result;
}

/** Move shared junctions and bend only attached portions of their other wires. */
export function followE4Junctions(before:HarnessDesignDocument,after:HarnessDesignDocument,positions:ReadonlyMap<string,Point>,owners:ReadonlySet<string>,mode:PhysicalDragMode):HarnessDesignDocument {
  const changed={...after,junctions:after.junctions.map(j=>positions.has(j.id)?{...j,position:positions.get(j.id)!}:j)};
  return {...changed,wires:changed.wires.map(w=>{
    if(owners.has(w.id))return w;
    const moved=before.junctions.filter(j=>j.wireIds.includes(w.id)&&positions.has(j.id));if(!moved.length)return w;
    // A shield-to-junction branch must be rebuilt as a straight lead by the command.
    if([w.from,w.to].some(e=>e.screenId)&&[w.from,w.to].some(e=>e.junctionId))return w;
    const a=wireEndpointE4Anchor(before,w.from),b=wireEndpointE4Anchor(before,w.to),start=wireEndpointE4Anchor(changed,w.from),end=wireEndpointE4Anchor(changed,w.to);
    if(!a||!b||!start||!end)return w;
    const original=[a.position,...w.e4Route,b.position];
    let points=original.flatMap((p,i)=>{
      const q=original[i+1];if(!q)return [p];
      const inner=moved.filter(j=>segmentPointDistance(j.position,{start:p,end:q})<1e-6&&Math.hypot(j.position.x-p.x,j.position.y-p.y)>1e-6&&Math.hypot(j.position.x-q.x,j.position.y-q.y)>1e-6)
        .sort((j,k)=>Math.hypot(j.position.x-p.x,j.position.y-p.y)-Math.hypot(k.position.x-p.x,k.position.y-p.y));
      return [p,...inner.map(j=>j.position)];
    });
    const anchors=points.map(p=>moved.find(j=>Math.hypot(j.position.x-p.x,j.position.y-p.y)<1e-6)?.id);
    const baseline=moveE4Ends(points,a.position,b.position,mode);
    points=moveE4Ends(points,start.position,end.position,mode);
    if(changed.views.e4.e4RoutingMode!=="angular")points=orthogonalE4Deformation(baseline,points,start,end,'carry').vertices;
    if(points.length===anchors.length)points=points.map((p,i)=>i===0||i===points.length-1?p:positions.get(anchors[i]??"")??p);
    const route=changed.views.e4.e4RoutingMode!=="angular"
      ?orthogonalE4Deformation(points,points,start,end,'adjacent').points:preserveE4Leads(points,start,end);
    return {...w,e4Route:route.slice(1,-1),e4RouteMode:"manual" as const};
  })};
}

/** A freely edited shoulder starts after the directed contact's straight lead. */
export function preserveE4Leads(points:readonly Point[],start:E4RouteAnchor,end:E4RouteAnchor):Point[] {
  let result=[...points];
  for(const [anchor,reverse] of [[start,false],[end,true]] as const){
    if(reverse)result.reverse();
    const direction=anchor.leadDirection;
    if(direction){
      const u=direction==="left"?{x:-1,y:0}:direction==="right"?{x:1,y:0}:direction==="up"?{x:0,y:-1}:{x:0,y:1};
      const a=result[0]!,b=straightLeadEnd(result),d={x:b.x-a.x,y:b.y-a.y},length=Math.min(defaultE4WireLead,anchor.leadLength??defaultE4WireLead);
      if(Math.abs(d.x*u.y-d.y*u.x)>1e-7||d.x*u.x+d.y*u.y<length)
        result.splice(1,0,{x:a.x+u.x*length,y:a.y+u.y*length});
    }
    if(reverse)result.reverse();
  }
  return result;
}

export function moveE4Ends(points:readonly Point[],from:Point,to:Point,mode:PhysicalDragMode):Point[] {
  let result=points.map(p=>({...p}));
  if(result.length===2&&mode==="carry"){
    const [a,b]=result as [Point,Point];result=[a,{x:a.x+(b.x-a.x)/3,y:a.y+(b.y-a.y)/3},{x:a.x+2*(b.x-a.x)/3,y:a.y+2*(b.y-a.y)/3},b];
  }
  const original=[...result],shifts=new Map<number,Point[]>();
  for(const [at,p] of [[0,from],[result.length-1,to]] as const){
    const a=original[at]!,delta={x:p.x-a.x,y:p.y-a.y},shoulder=at===0?1:at-1;
    result[at]=p;
    if(mode==="carry"&&result.length>2&&(delta.x||delta.y))shifts.set(shoulder,[...shifts.get(shoulder)??[],delta]);
  }
  for(const [i,deltas] of shifts)result[i]={x:original[i]!.x+deltas.reduce((n,d)=>n+d.x,0)/deltas.length,y:original[i]!.y+deltas.reduce((n,d)=>n+d.y,0)/deltas.length};
  return result;
}
