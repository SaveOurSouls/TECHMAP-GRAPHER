import type { CoveringHandle, CoveringSurface } from "./covering-layout";
import type { EditorPoint, EditorSceneObject } from "./editor-types";

const textureFiles:Record<string,string>={"heat-shrink":"Rubber002",nylon:"Fabric061",braid:"Fabric061","metal-braid":"Metal049A",tape:"Rubber002",band:"Fabric061"};
const textures=new Map<string,HTMLImageElement>();
const listeners=new Set<()=>void>();
export function warmCoveringTextures(invalidate:()=>void):()=>void {
  listeners.add(invalidate);
  if(typeof Image!=="undefined")for(const file of new Set(Object.values(textureFiles)))if(!textures.has(file)){
    const image=new Image();textures.set(file,image);
    image.onload=()=>listeners.forEach(fn=>fn());image.src=`/textures/coverings/${file}.jpg`;
  }
  return ()=>{listeners.delete(invalidate);};
}
export const coveringGrips=(object:EditorSceneObject):CoveringHandle[]=>JSON.parse(object.metadata?.coveringHandles??"[]");
export const coveringSurfaces=(object:EditorSceneObject):CoveringSurface[]=>JSON.parse(object.metadata?.surfaces??"[]");

/** Even/odd containment supports concave sleeves around bends. */
export function coveringHit(object:EditorSceneObject,p:EditorPoint,tolerance:number):number|null {
  for(const [index,surface] of coveringSurfaces(object).entries()){
    let inside=false;const polygon=surface.polygon;
    for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
      const a=polygon[j]!,b=polygon[i]!,dx=b.x-a.x,dy=b.y-a.y,den=dx*dx+dy*dy;
      const t=den?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/den)):0;
      if(Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy)<=tolerance)return surface.spanIndex??index;
      if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)inside=!inside;
    }
    if(inside)return surface.spanIndex??index;
  }
  return null;
}

export function drawCoveringSurface(context:CanvasRenderingContext2D,object:EditorSceneObject,selected:boolean):void {
  for(const surface of coveringSurfaces(object)){
    const polygon=surface.polygon;if(!polygon.length)continue;
    context.save();context.beginPath();polygon.forEach((p,i)=>i?context.lineTo(p.x,p.y):context.moveTo(p.x,p.y));context.closePath();
    context.fillStyle=object.color;context.fill();
    const image=textures.get(textureFiles[object.metadata?.coveringKind??"braid"]!);
    if(image?.complete&&image.naturalWidth){
      const pattern=context.createPattern(image,"repeat");
      if(pattern){pattern.setTransform(new DOMMatrix().scale(.08));context.save();context.globalAlpha=.38;context.fillStyle=pattern;context.fill();context.restore();}
    }
    context.strokeStyle=selected?"#007fae":"#34434e";context.lineWidth=selected?2:1;context.stroke();context.restore();
  }
  if(selected)for(const grip of coveringGrips(object)){
    const {point:p,normal:n,halfWidth:w}=grip;context.strokeStyle=grip.bound?"#21905c":"#007fae";context.lineWidth=3;
    context.beginPath();context.moveTo(p.x-n.x*w,p.y-n.y*w);context.lineTo(p.x+n.x*w,p.y+n.y*w);context.stroke();
  }
}
