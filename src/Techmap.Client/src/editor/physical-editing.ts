import type { HarnessDesignDocument, Point } from "./model";
import type { PhysicalSegment } from "./physical-topology-model";
import { physicalSegmentPoints, physicalSegmentControls } from "./physical-geometry";
import { physicalNodePoint } from "./physical-ports";
import { resolvedCoveringSpan } from "./physical-coverings";

export type PhysicalDragMode = "carry" | "adjacent";
const near = (a:Point,b:Point) => Math.hypot(a.x-b.x,a.y-b.y)<1e-6;
const shifted = (p:Point,d:Point):Point => ({x:p.x+d.x,y:p.y+d.y});

/** Automatic corners become author-owned only when an edit is committed. */
export function physicalEditablePoints(document:HarnessDesignDocument,segment:PhysicalSegment):readonly Point[] {
  return segment.path.kind==="routed"&&!segment.path.points.length&&document.physicalTopology?.snap
    ? physicalSegmentPoints(document,segment) : physicalSegmentControls(document,segment);
}

/** A dimension owns its visible corners; freeze them in the same undo transaction. */
export function materializePhysicalPath(document:HarnessDesignDocument,id:string):HarnessDesignDocument {
  const segment=document.physicalTopology?.segments.find(s=>s.id===id);
  if(!segment||segment.path.kind==="polyline")return document;
  const points=physicalEditablePoints(document,segment);
  return replacePath(document,segment,points,anchorMap(document,segment,points));
}

/** Snap the dragged point to a visible 0/45/90 guide; otherwise use 15° when enabled. */
export function snapPhysicalPoint(point:Point,anchors:readonly Point[],enabled:boolean,tolerance:number) {
  if(!enabled||!anchors.length)return {point,guide:undefined as readonly Point[]|undefined};
  let best:{point:Point;guide:readonly Point[];distance:number}|undefined;
  for(const a of anchors)for(const angle of [0,Math.PI/4,Math.PI/2,3*Math.PI/4]) {
    const u={x:Math.cos(angle),y:Math.sin(angle)},length=(point.x-a.x)*u.x+(point.y-a.y)*u.y;
    const p={x:a.x+u.x*length,y:a.y+u.y*length},distance=Math.hypot(p.x-point.x,p.y-point.y);
    if(distance<=tolerance&&(!best||distance<best.distance))best={point:p,guide:[a,p],distance};
  }
  if(best)return best;
  const a=anchors[0]!,angle=Math.round(Math.atan2(point.y-a.y,point.x-a.x)/(Math.PI/12))*Math.PI/12;
  const length=Math.hypot(point.x-a.x,point.y-a.y);
  return {point:{x:a.x+Math.cos(angle)*length,y:a.y+Math.sin(angle)*length},guide:undefined};
}

/** Update ordinal anchors explicitly; never silently attach a measurement to another corner. */
function replacePath(document:HarnessDesignDocument,segment:PhysicalSegment,points:readonly Point[],oldToNew:ReadonlyMap<number,number>):HarnessDesignDocument {
  const t=document.physicalTopology!;
  const changed={...segment,path:{kind:"polyline" as const,points:points.slice(1,-1)}};
  const coverings=t.coverings?.map(c=>({...c,spans:c.spans.map(s=>s.segmentId!==segment.id?s:{...resolvedCoveringSpan(document,s),
    fromAnchor:s.fromAnchor===undefined?undefined:oldToNew.get(s.fromAnchor),
    toAnchor:s.toAnchor===undefined?undefined:oldToNew.get(s.toAnchor)})}));
  const dimensions=document.drawingDocuments?.dimensions?.flatMap(d=>{
    if(d.segmentId!==segment.id)return [d];
    const from=oldToNew.get(d.from),to=oldToNew.get(d.to);
    return from===undefined||to===undefined||from>=to?[]:[{...d,from,to,pointCount:points.length,
      routeKey:JSON.stringify([segment.id,segment.from,segment.to,points.length-2])}];
  });
  return {...document,physicalTopology:{...t,segments:t.segments.map(s=>s.id===segment.id?changed:s),coverings},
    ...(document.drawingDocuments?{drawingDocuments:{...document.drawingDocuments,dimensions}}:{})};
}

function anchorMap(document:HarnessDesignDocument,segment:PhysicalSegment,editable:readonly Point[]) {
  return new Map(physicalSegmentControls(document,segment).map((p,i)=>[i,
    i===0?0:i===segment.path.points.length+1?editable.length-1:segment.path.points.length?i:editable.findIndex(q=>near(p,q))]));
}

function mergeStraight(points:Point[],map:Map<number,number>) {
  for(let i=points.length-2;i>0;i--){
    const a=points[i-1]!,b=points[i]!,c=points[i+1]!;
    const cross=(b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x);
    const dot=(b.x-a.x)*(c.x-b.x)+(b.y-a.y)*(c.y-b.y);
    if(Math.abs(cross)<=1e-7*Math.max(1,Math.hypot(c.x-a.x,c.y-a.y))&&dot>=0){
      points.splice(i,1);
      for(const [old,value] of map){if(value===i)map.delete(old);else if(value>i)map.set(old,value-1);}
    }
  }
}

export function physicalObjectSnapAnchors(objects:readonly {id:string;kind:string;x:number;y:number;port?:{connectorId?:string}}[],object:{id:string;kind:string;x:number;y:number}):Point[] {
  if(object.kind!=="connector"&&object.kind!=="physical-node")return [];
  const own=object.kind==="physical-node"?[object]:objects.filter(o=>o.kind==="physical-node"&&o.port?.connectorId===object.id);
  return own.flatMap(exit=>objects.filter(o=>o.kind==="physical-node"&&o.id!==exit.id&&o.port?.connectorId!==object.id)
    .map(o=>({x:o.x-(exit.x-object.x),y:o.y-(exit.y-object.y)})));
}

/** Preserve adjacent inner shoulders in carry mode; Shift edits only the selected vertex. */
export function editPhysicalBend(document:HarnessDesignDocument,id:string,index:number,point:Point,mode:PhysicalDragMode,insert=false):HarnessDesignDocument {
  const segment=document.physicalTopology?.segments.find(s=>s.id===id);if(!segment)return document;
  const original=physicalEditablePoints(document,segment),map=anchorMap(document,segment,original);
  const points=[...original];
  if(insert){
    if(index<0||index>=points.length-1)return document;
    points.splice(index+1,0,point);
    for(const [old,value] of map)if(value>index)map.set(old,value+1);
  }else {
    const at=index+1;if(at<=0||at>=points.length-1)return document;
    const delta={x:point.x-points[at]!.x,y:point.y-points[at]!.y};
    points[at]=point;
    if(mode==="carry")for(const neighbor of [at-1,at+1])if(neighbor>0&&neighbor<points.length-1)points[neighbor]=shifted(points[neighbor]!,delta);
    if(mode==="carry")mergeStraight(points,map);
  }
  return replacePath(document,segment,points,map);
}

export function deletePhysicalBend(document:HarnessDesignDocument,id:string,index:number):HarnessDesignDocument {
  const segment=document.physicalTopology?.segments.find(s=>s.id===id);if(!segment)return document;
  const original=physicalEditablePoints(document,segment),map=anchorMap(document,segment,original),at=index+1;
  if(at<=0||at>=original.length-1)return document;
  for(const [old,value] of map){if(value===at)map.delete(old);else if(value>at)map.set(old,value-1);}
  return replacePath(document,segment,original.filter((_,i)=>i!==at),map);
}

/** Freeze the visible route at move start and carry only shoulders next to moved exits. */
export function carryPhysicalExits(before:HarnessDesignDocument,after:HarnessDesignDocument,nodeIds:ReadonlySet<string>,mode:PhysicalDragMode):HarnessDesignDocument {
  if(!before.physicalTopology||!after.physicalTopology)return after;
  let result=after;
  for(const segment of before.physicalTopology.segments){
    if(!nodeIds.has(segment.from)&&!nodeIds.has(segment.to))continue;
    let original=physicalEditablePoints(before,segment);
    if(mode==="carry"&&original.length===2){
      const [a,b]=original as readonly [Point,Point];
      original=[a,{x:a.x+(b.x-a.x)/3,y:a.y+(b.y-a.y)/3},{x:a.x+2*(b.x-a.x)/3,y:a.y+2*(b.y-a.y)/3},b];
    }
    const points=[...original],map=anchorMap(before,segment,original);
    for(const side of ["from","to"] as const){
      if(!nodeIds.has(segment[side]))continue;
      const at=side==="from"?0:points.length-1;
      const node=after.physicalTopology.nodes.find(n=>n.id===segment[side]);if(!node)continue;
      const p=physicalNodePoint(after,node),delta={x:p.x-original[at]!.x,y:p.y-original[at]!.y};
      points[at]=p;
      const shoulder=side==="from"?1:points.length-2;
      if(mode==="carry"&&points.length>2)points[shoulder]=shifted(original[shoulder]!,delta);
    }
    if(mode==="carry")mergeStraight(points,map);
    result=replacePath(result,segment,points,map);
  }
  return result;
}
