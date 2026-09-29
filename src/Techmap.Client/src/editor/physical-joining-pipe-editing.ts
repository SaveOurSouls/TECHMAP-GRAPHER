import type {HarnessDesignDocument,Point} from "./model";
import type {PhysicalTopology} from "./physical-topology-model";
import type {PhysicalDragMode} from "./physical-editing";
import {joiningPipePoints} from "./physical-joining-pipes";

/** Move the complete OP geometry while preserving its authored shape and
 * member transition handles. The electrical graph and member references stay
 * unchanged; only the common pipe's presentation axis moves. */
export function moveJoiningPipe(t:PhysicalTopology,id:string,delta:Point):PhysicalTopology {
  if(!Number.isFinite(delta.x)||!Number.isFinite(delta.y)||(!delta.x&&!delta.y))return t;
  return {...t,joiningPipes:t.joiningPipes?.map(pipe=>pipe.id!==id?pipe:{
    ...pipe,
    start:{x:pipe.start.x+delta.x,y:pipe.start.y+delta.y},
    end:{x:pipe.end.x+delta.x,y:pipe.end.y+delta.y},
    path:{...pipe.path,points:pipe.path.points.map(point=>({x:point.x+delta.x,y:point.y+delta.y}))},
    members:pipe.members.map(member=>({...member,
      ...(member.enterBend?{enterBend:{x:member.enterBend.x+delta.x,y:member.enterBend.y+delta.y}}:{}),
      ...(member.exitBend?{exitBend:{x:member.exitBend.x+delta.x,y:member.exitBend.y+delta.y}}:{}),
    })),
  })};
}

/** Authored points only; derived member bends never become editable OP vertices. */
export function editJoiningPipeBend(document:HarnessDesignDocument,id:string,index:number,point:Point,mode:PhysicalDragMode,insert=false,remove=false):PhysicalTopology {
  const t=document.physicalTopology!,pipe=t.joiningPipes?.find(p=>p.id===id);if(!pipe)return t;
  const all=joiningPipePoints(pipe),points=[...pipe.path.points];
  if(index<0||index>points.length||!insert&&index===points.length)return t;
  if(remove)points.splice(index,1);
  else {
    const original=insert?{x:(all[index]!.x+all[index+1]!.x)/2,y:(all[index]!.y+all[index+1]!.y)/2}:points[index]!;
    const delta={x:point.x-original.x,y:point.y-original.y};
    if(mode==="carry")for(const i of insert?[index-1,index]:[index-1,index+1])if(points[i])points[i]={x:points[i]!.x+delta.x,y:points[i]!.y+delta.y};
    if(insert)points.splice(index,0,point);else points[index]=point;
  }
  const coverings=t.coverings?.map(c=>({...c,spans:c.spans.map(s=>{
    if(s.segmentId!==id)return s;
    const anchor=(a:number|undefined)=>a===undefined?undefined:remove?(a===index+1?undefined:a>index+1?a-1:a):insert&&a>index?a+1:a;
    return {...s,fromAnchor:anchor(s.fromAnchor),toAnchor:anchor(s.toAnchor)};
  })}));
  return {...t,coverings,joiningPipes:t.joiningPipes?.map(p=>p.id===id?{...p,path:{kind:"polyline",points}}:p)};
}
export function removeJoiningPipe(t:PhysicalTopology,id:string):PhysicalTopology {
  return {...t,joiningPipes:t.joiningPipes?.filter(p=>p.id!==id),coverings:t.coverings?.flatMap(c=>{
    const spans=c.spans.filter(s=>s.segmentId!==id);return spans.length?[{...c,spans}]:[];
  })};
}
