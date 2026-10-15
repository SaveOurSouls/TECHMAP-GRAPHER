import type { HarnessDesignDocument,Point } from './model';
import { drawingWireWidth,drawingPhysicalScale,segmentWireLanes } from './drawing-thickness';
import type { TwistedPairPath } from './drawing-twisted-pair';

/** A presentation on explicitly shared physical segments. Never changes routes or cut lengths. */
export function physicalMultiTwistPath(document:HarnessDesignDocument,segmentId:string,wireId:string,centerline:readonly Point[]):TwistedPairPath|null{
 const group=document.terminations?.twists.find(t=>t.segmentIds.includes(segmentId)&&t.memberWireIds.includes(wireId));
 if(!group||centerline.length<2||!group.pitchMm)return null;
 const wire=document.wires.find(w=>w.id===wireId);if(!wire)return null;
 const lanes=segmentWireLanes(document,segmentId).filter(l=>group.memberWireIds.includes(l.id));
 if(lanes.length!==group.memberWireIds.length)return null;
 const lengths=[0];for(let i=1;i<centerline.length;i++)lengths.push(lengths.at(-1)!+Math.hypot(centerline[i]!.x-centerline[i-1]!.x,centerline[i]!.y-centerline[i-1]!.y));
 const length=lengths.at(-1)!;if(length<1)return null;
 const pitch=Math.max(4,group.pitchMm*drawingPhysicalScale(document));
 const index=group.memberWireIds.indexOf(wireId),phase=index/group.memberWireIds.length*2*Math.PI;
 const middle=(Math.min(...lanes.map(l=>l.offset-l.width/2))+Math.max(...lanes.map(l=>l.offset+l.width/2)))/2;
 // These are strand centre positions; stroke width supplies the outer radius once.
 const middleDepth=(Math.min(...lanes.map(l=>(l.depth??0)-l.width/2))+Math.max(...lanes.map(l=>(l.depth??0)+l.width/2)))/2;
 const lane=lanes.find(l=>l.id===wireId)!;
 const radius=Math.hypot(lane.offset-middle,(lane.depth??0)-middleDepth);
 const width=drawingWireWidth(document,wire),points:Point[]=[];
 const count=Math.min(10000,Math.max(2,Math.ceil(length/Math.min(3,pitch/20))));
 for(let i=0;i<=count;i++){
  const distance=i/count*length;let j=lengths.findIndex(n=>n>distance)-1;if(j<0)j=centerline.length-2;
  const a=centerline[j]!,b=centerline[j+1]!,leg=lengths[j+1]!-lengths[j]!||1,t=(distance-lengths[j]!)/leg;
  const envelope=Math.min(1,distance/(pitch/3),(length-distance)/(pitch/3));
  const offset=(1-envelope)*lane.offset+envelope*(middle+radius*Math.sin(phase+(group.direction==='right'?1:-1)*distance/pitch*2*Math.PI));
  points.push({x:a.x+(b.x-a.x)*t-(b.y-a.y)/leg*offset,y:a.y+(b.y-a.y)*t+(b.x-a.x)/leg*offset});
 }
 return {path:points,strokes:[{points,width,radius:0,lineJoin:'round'}]};
}
