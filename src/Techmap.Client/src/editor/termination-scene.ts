import type { ConnectorInstance, HarnessDesignDocument } from './model';
import type { EditorSceneObject } from './editor-types';
import type { EditorSceneBounds } from './editor-camera';
import { drawingLocalPoint, drawingRotation, drawingScale, drawingLocalDirectionVector } from './drawing-scale';
import { getTerminationSymbol } from '../termination-library';

function terminationWorldPoint(object:EditorSceneObject,p:{x:number;y:number}){
 const scale=Number(object.metadata?.terminationScale??1),angle=Number(object.metadata?.terminationRotation??0)*Math.PI/180;
 return {x:object.x+scale*(p.x*Math.cos(angle)-p.y*Math.sin(angle)),y:object.y+scale*(p.x*Math.sin(angle)+p.y*Math.cos(angle))};
}

/** The scene origin remains the connector origin, even when its picture extends left/up. */
export function terminationSceneBounds(object:EditorSceneObject):EditorSceneBounds|null{
 if(object.kind!=='connector'||!object.metadata?.terminationSymbol)return null;
 if(object.metadata.terminationPointOnly==='true'){
  const p=terminationWorldPoint(object,{x:32,y:50});return {minX:p.x-4,minY:p.y-4,maxX:p.x+4,maxY:p.y+4};
 }
 const corners=[{x:0,y:0},{x:220,y:0},{x:220,y:100},{x:0,y:100}].map(p=>terminationWorldPoint(object,p));
 return {minX:Math.min(...corners.map(p=>p.x)),minY:Math.min(...corners.map(p=>p.y)),maxX:Math.max(...corners.map(p=>p.x)),maxY:Math.max(...corners.map(p=>p.y))};
}
export function terminationSceneContainsPoint(object:EditorSceneObject,point:{x:number;y:number},tolerance:number):boolean{
 if(object.metadata?.terminationPointOnly==='true'){
  const p=terminationWorldPoint(object,{x:32,y:50});return Math.hypot(point.x-p.x,point.y-p.y)<=4+tolerance;
 }
 const scale=Number(object.metadata?.terminationScale??1),angle=-Number(object.metadata?.terminationRotation??0)*Math.PI/180;
 const dx=point.x-object.x,dy=point.y-object.y,x=(dx*Math.cos(angle)-dy*Math.sin(angle))/scale,y=(dx*Math.sin(angle)+dy*Math.cos(angle))/scale,pad=tolerance/scale;
 return x>=-pad&&x<=220+pad&&y>=-pad&&y<=100+pad;
}

export function terminationSceneObject(document:HarnessDesignDocument,connector:ConnectorInstance,view:'e4'|'drawing'):EditorSceneObject{
 const m=connector.terminationComponent!;
 const artifact=document.terminations?.artifacts.find(a=>a.id===m.artifactId);
 const symbolId=m.kind==='preparation'&&m.preparationMode==='lug'&&artifact?artifact.symbolId:m.symbolId;
 const symbol=getTerminationSymbol({symbolId,color:m.color??artifact?.color,preparationMode:m.preparationMode==='lug'&&artifact&&view==='e4'?undefined:m.preparationMode},view);
 const pointOnly=view==='drawing'&&m.kind==='preparation';
 const points=connector.contacts.map((c,index)=>{const p={x:index===1?188:32,y:50};return {...(view==='drawing'?drawingLocalPoint(p,connector.drawingPlacements):p),direction:index===1?'right':'left',...(view==='drawing'?{directionVector:drawingLocalDirectionVector(index===1?'right':'left',connector.drawingPlacements)}:{}),status:c.connectionStatus};});
 const groups=document.terminations?.groups.filter(g=>g.target.connectorId===connector.id)??[];
 const rotation=view==='drawing'?drawingRotation(connector.drawingPlacements):0,scale=view==='drawing'?drawingScale(connector.drawingPlacements):1;
 return {id:connector.id,kind:'connector',layerId:connector.layerIds[view],label:connector.designation,x:connector.positions[view].x,y:connector.positions[view].y,width:220*scale,height:100*scale,color:'#334155',metadata:{terminationSymbol:symbol?.href??'',terminationPointOnly:String(pointOnly),terminationRotation:String(rotation),terminationScale:String(scale),contactCount:String(connector.contacts.length),materializedContactPoints:JSON.stringify(points),terminationBadge:groups.length?groups.map(g=>`${g.memberEnds.length} пр.`).join(' / '):'',view}};
}
