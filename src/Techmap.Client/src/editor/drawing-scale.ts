import type { ConnectorDrawingPlacement } from "./model";
export const DRAWING_VIEW_PLACEMENT_ID="view:drawing";
export function drawingScale(placements:readonly ConnectorDrawingPlacement[]|undefined,id=DRAWING_VIEW_PLACEMENT_ID){return placements?.find(p=>p.drawingId===id)?.scale??1;}
export function validDrawingScale(value:number){return Number.isFinite(value)&&value>=.05&&value<=20;}
export function scaleFromDrag(scale:number,vx:number,vy:number,dx:number,dy:number){return Math.max(.05,Math.min(20,scale*(1+(dx*vx+dy*vy)/Math.max(1,vx*vx+vy*vy))));}

export function drawingRotation(placements:readonly ConnectorDrawingPlacement[]|undefined){return placements?.find(p=>p.drawingId===DRAWING_VIEW_PLACEMENT_ID)?.rotationDegrees??0;}
export function drawingLocalPoint(point:{x:number;y:number},placements:readonly ConnectorDrawingPlacement[]|undefined){
 const a=drawingRotation(placements)*Math.PI/180,scale=drawingScale(placements);
 return {x:scale*(point.x*Math.cos(a)-point.y*Math.sin(a)),y:scale*(point.x*Math.sin(a)+point.y*Math.cos(a))};
}

export function drawingPointToLocal(point:{x:number;y:number},placements:readonly ConnectorDrawingPlacement[]|undefined){
 const a=-drawingRotation(placements)*Math.PI/180,scale=drawingScale(placements);
 return {x:(point.x*Math.cos(a)-point.y*Math.sin(a))/scale,y:(point.x*Math.sin(a)+point.y*Math.cos(a))/scale};
}
