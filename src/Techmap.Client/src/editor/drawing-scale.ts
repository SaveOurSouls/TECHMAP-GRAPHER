import type { ConnectorDrawingPlacement } from "./model";
export const DRAWING_VIEW_PLACEMENT_ID="view:drawing";
export function drawingScale(placements:readonly ConnectorDrawingPlacement[]|undefined,id=DRAWING_VIEW_PLACEMENT_ID){return placements?.find(p=>p.drawingId===id)?.scale??1;}
export function validDrawingScale(value:number){return Number.isFinite(value)&&value>=.05&&value<=20;}
export function scaleFromDrag(scale:number,vx:number,vy:number,dx:number,dy:number){return Math.max(.05,Math.min(20,scale*(1+(dx*vx+dy*vy)/Math.max(1,vx*vx+vy*vy))));}
