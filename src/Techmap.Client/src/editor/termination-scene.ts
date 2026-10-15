import type { ConnectorInstance, HarnessDesignDocument } from './model';
import type { EditorSceneObject } from './editor-types';
import type { EditorSceneBounds } from './editor-camera';
import { drawingLocalPoint, drawingRotation, drawingScale, drawingLocalDirectionVector } from './drawing-scale';
import { getTerminationSymbol } from '../termination-library';
import { getTerminationArtworkBounds,type TerminationLocalBounds } from '../termination-library/artwork-bounds';
import { preparationArtworkBounds, preparationArtworkContains } from './preparation-drawing';

function terminationLocalBounds(object:EditorSceneObject):TerminationLocalBounds{
 try{
  const b:unknown=JSON.parse(object.metadata?.terminationLocalBounds??'null');
  if(Array.isArray(b)&&b.length===4&&b.every(n=>typeof n==='number'&&Number.isFinite(n))&&b[0]>=0&&b[1]>=0&&b[2]<=220&&b[3]<=100&&b[0]<b[2]&&b[1]<b[3])return b as unknown as TerminationLocalBounds;
 }catch{/* Old snapshots keep their safe viewBox fallback until refreshed. */}
 return [0,0,220,100];
}

function terminationWorldPoint(object:EditorSceneObject,p:{x:number;y:number}){
 const scale=Number(object.metadata?.terminationScale??1),angle=Number(object.metadata?.terminationRotation??0)*Math.PI/180;
 return {x:object.x+scale*(p.x*Math.cos(angle)-p.y*Math.sin(angle)),y:object.y+scale*(p.x*Math.sin(angle)+p.y*Math.cos(angle))};
}

/** The scene origin remains the connector origin, even when its picture extends left/up. */
export function terminationSceneBounds(object:EditorSceneObject):EditorSceneBounds|null{
 if(object.kind!=='connector'||!object.metadata?.terminationSymbol)return null;
 if(object.metadata.terminationPointOnly==='true'){
  const p=terminationWorldPoint(object,{x:32,y:50}),bounds=(object.terminationArtwork??[]).map(preparationArtworkBounds);
  return {minX:Math.min(p.x-4,...bounds.map(b=>b.minX)),minY:Math.min(p.y-4,...bounds.map(b=>b.minY)),maxX:Math.max(p.x+4,...bounds.map(b=>b.maxX)),maxY:Math.max(p.y+4,...bounds.map(b=>b.maxY))};
 }
 const [minX,minY,maxX,maxY]=terminationLocalBounds(object);
 const corners=[{x:minX,y:minY},{x:maxX,y:minY},{x:maxX,y:maxY},{x:minX,y:maxY}].map(p=>terminationWorldPoint(object,p));
 return {minX:Math.min(...corners.map(p=>p.x)),minY:Math.min(...corners.map(p=>p.y)),maxX:Math.max(...corners.map(p=>p.x)),maxY:Math.max(...corners.map(p=>p.y))};
}
export function terminationSceneContainsPoint(object:EditorSceneObject,point:{x:number;y:number},tolerance:number):boolean{
 if(object.kind!=='connector'||!object.metadata?.terminationSymbol)return false;
 if(object.metadata?.terminationPointOnly==='true'){
  const p=terminationWorldPoint(object,{x:32,y:50});return Math.hypot(point.x-p.x,point.y-p.y)<=4+tolerance||(object.terminationArtwork??[]).some(art=>preparationArtworkContains(art,point,tolerance));
 }
 const scale=Number(object.metadata?.terminationScale??1),angle=-Number(object.metadata?.terminationRotation??0)*Math.PI/180;
 const dx=point.x-object.x,dy=point.y-object.y,x=(dx*Math.cos(angle)-dy*Math.sin(angle))/scale,y=(dx*Math.sin(angle)+dy*Math.cos(angle))/scale,pad=tolerance/scale;
 const [minX,minY,maxX,maxY]=terminationLocalBounds(object);
 return x>=minX-pad&&x<=maxX+pad&&y>=minY-pad&&y<=maxY+pad;
}

export function terminationSceneObject(document:HarnessDesignDocument,connector:ConnectorInstance,view:'e4'|'drawing'):EditorSceneObject{
 const m=connector.terminationComponent!;
 const artifact=document.terminations?.artifacts.find(a=>a.id===m.artifactId);
 const symbolId=m.kind==='preparation'&&m.preparationMode==='lug'&&artifact?artifact.symbolId:m.symbolId;
 const symbol=getTerminationSymbol({symbolId,color:m.color??artifact?.color,preparationMode:m.preparationMode==='lug'&&artifact&&view==='e4'?undefined:m.preparationMode},view);
 const pointOnly=view==='drawing'&&m.kind==='preparation';
 const localBounds=!pointOnly&&symbol?getTerminationArtworkBounds(symbol.assetId,view):undefined;
 const points=connector.contacts.map((c,index)=>{const p={x:index===1?188:32,y:50};return {...(view==='drawing'?drawingLocalPoint(p,connector.drawingPlacements):p),direction:index===1?'right':'left',...(view==='drawing'?{directionVector:drawingLocalDirectionVector(index===1?'right':'left',connector.drawingPlacements)}:{}),status:c.connectionStatus};});
 const groups=document.terminations?.groups.filter(g=>g.target.connectorId===connector.id)??[];
 const rotation=view==='drawing'?drawingRotation(connector.drawingPlacements):0,scale=view==='drawing'?drawingScale(connector.drawingPlacements):1;
 return {id:connector.id,kind:'connector',layerId:connector.layerIds[view],label:connector.designation,x:connector.positions[view].x,y:connector.positions[view].y,width:220*scale,height:100*scale,color:'#334155',metadata:{terminationSymbol:symbol?.href??'',terminationAssetId:symbol?.assetId??symbolId,...(localBounds?{terminationLocalBounds:JSON.stringify(localBounds)}:{}),terminationPointOnly:String(pointOnly),terminationRotation:String(rotation),terminationScale:String(scale),contactCount:String(connector.contacts.length),materializedContactPoints:JSON.stringify(points),terminationBadge:groups.length?groups.map(g=>`${g.memberEnds.length} пр.`).join(' / '):'',view}};
}
