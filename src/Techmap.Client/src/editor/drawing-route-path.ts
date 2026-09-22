import { roundedPolylineCommandsV2 } from "../component-library/rounded-polyline-v2";
import type { EditorPoint } from "./editor-types";

/** Circular tangent joins decorate the stored control polygon; lengths and IDs stay unchanged. */
export function drawingRouteCommands(points: readonly EditorPoint[]) {
  const clean = points.filter((p,i)=>i===0 || Math.hypot(p.x-points[i-1]!.x,p.y-points[i-1]!.y)>1e-7);
  return roundedPolylineCommandsV2(clean.map(p=>[p.x,p.y] as const),24) ?? [];
}
export function traceDrawingRoute(context:CanvasRenderingContext2D,points:readonly EditorPoint[]) {
  context.beginPath();
  for(const c of drawingRouteCommands(points)) {
    if(c.kind==="move")context.moveTo(c.x,c.y);
    else if(c.kind==="line")context.lineTo(c.x,c.y);
    else context.arcTo(c.cornerX,c.cornerY,c.x,c.y,c.radius);
  }
}
/** Sample the same circular joins for pointer picking, instead of the hidden sharp corner. */
export function drawingRouteHitPoints(points:readonly EditorPoint[]):EditorPoint[] {
  const result:EditorPoint[]=[];
  for(const c of drawingRouteCommands(points)) {
    if(c.kind!=="arc"){result.push({x:c.x,y:c.y});continue;}
    const start=result.at(-1)!;
    const dx=c.cornerX-start.x,dy=c.cornerY-start.y,length=Math.hypot(dx,dy);
    if(length<1e-9){result.push({x:c.x,y:c.y});continue;}
    const sign=c.sweep?1:-1,center={x:start.x-dy/length*c.radius*sign,y:start.y+dx/length*c.radius*sign};
    const a=Math.atan2(start.y-center.y,start.x-center.x),b=Math.atan2(c.y-center.y,c.x-center.x);
    let angle=b-a;if(sign>0&&angle<0)angle+=2*Math.PI;if(sign<0&&angle>0)angle-=2*Math.PI;
    const steps=Math.max(2,Math.ceil(Math.abs(angle)*c.radius/2));
    for(let i=1;i<=steps;i++)result.push({x:center.x+Math.cos(a+angle*i/steps)*c.radius,y:center.y+Math.sin(a+angle*i/steps)*c.radius});
  }
  return result;
}
