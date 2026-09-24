import type { Point } from "./model";
import type { PhysicalDragMode } from "./physical-editing";
import { validateE4Route, type E4RoutingRequest } from "./e4-router";

/** Repair only the changed shoulders before asking the global router. */
export function completeOrthogonalShoulders(points:readonly Point[],request:E4RoutingRequest):Point[]|null {
  let candidates:Point[][]=[[points[0]!]];
  for(const b of points.slice(1)){
    candidates=candidates.flatMap(path=>{
      const a=path.at(-1)!;
      if(a.x===b.x&&a.y===b.y)return [path];
      if(a.x===b.x||a.y===b.y)return [[...path,b]];
      return [[...path,{x:a.x,y:b.y},b],[...path,{x:b.x,y:a.y},b],
        [...path,{x:(a.x+b.x)/2,y:a.y},{x:(a.x+b.x)/2,y:b.y},b],
        [...path,{x:a.x,y:(a.y+b.y)/2},{x:b.x,y:(a.y+b.y)/2},b]];
    });
    if(candidates.length>256)return null;
  }
  for(const path of candidates){try{validateE4Route(path,request);return path;}catch{/* Try the other elbow. */}}
  return null;
}

/** Edit authored points before the electrical route validates its leads and obstacles. */
export function editedE4Points(points:readonly Point[],index:number,point:Point,mode:PhysicalDragMode,insert=false):Point[] {
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
  if(!insert&&mode==="carry")for(let i=result.length-2;i>0;i--){
    const a=result[i-1]!,b=result[i]!,c=result[i+1]!;
    if(Math.abs((b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x))<1e-7&&
      (b.x-a.x)*(c.x-b.x)+(b.y-a.y)*(c.y-b.y)>=0)result.splice(i,1);
  }
  return result;
}

/** Keep clicked points even when the router simplifies a straight interval. */
export function retainE4Waypoints(points:readonly Point[],waypoints:readonly Point[]):Point[] {
  return points.flatMap((a,index)=>{
    const b=points[index+1];if(!b)return [{...a}];
    const dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy;
    const inner=waypoints.filter(p=>Math.abs((p.x-a.x)*dy-(p.y-a.y)*dx)<1e-7)
      .map(p=>({p,t:((p.x-a.x)*dx+(p.y-a.y)*dy)/length})).filter(p=>p.t>1e-8&&p.t<1-1e-8).sort((p,q)=>p.t-q.t);
    return [{...a},...inner.filter((p,i)=>i===0||Math.abs(p.t-inner[i-1]!.t)>1e-8).map(({p})=>({...p}))];
  });
}
