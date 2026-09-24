import { defaultE4WireLead, type E4RouteAnchor, type Point } from "./model";
import type { PhysicalDragMode } from "./physical-editing";
import { straightLeadEnd } from "./route-lead";
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
  const original=[...result];
  for(const [at,p] of [[0,from],[result.length-1,to]] as const){
    const a=original[at]!,delta={x:p.x-a.x,y:p.y-a.y},shoulder=at===0?1:at-1;
    result[at]=p;
    if(mode==="carry"&&result.length>2)result[shoulder]={x:result[shoulder]!.x+delta.x,y:result[shoulder]!.y+delta.y};
  }
  return result;
}
