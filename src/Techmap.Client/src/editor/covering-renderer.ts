import type { CoveringHandle, CoveringSurface } from "./covering-layout";
import type { EditorPoint, EditorSceneObject } from "./editor-types";
import { coveringTextureFile,resolvedCoveringStyle,type CoveringStyle } from "./covering-style";
import type { CoveringKind } from "./physical-coverings";
import rubberTexture from "./covering-textures/Rubber002.jpg";
import fabricTexture from "./covering-textures/Fabric061.jpg";
import metalTexture from "./covering-textures/Metal049A.jpg";

const textures=new Map<string,HTMLImageElement>();
const listeners=new Set<()=>void>();
export const coveringTextureUrls: Readonly<Record<string, string>> = {
  Rubber002: rubberTexture, Fabric061: fabricTexture, Metal049A: metalTexture,
};
export function warmCoveringTextures(invalidate:()=>void,objects:readonly EditorSceneObject[]=[]):()=>void {
  listeners.add(invalidate);
  if(typeof Image!=="undefined")for(const file of ["Rubber002","Fabric061","Metal049A"])if(!textures.has(file)){
    const image=new Image();textures.set(file,image);
    image.onload=()=>listeners.forEach(fn=>fn());image.src=coveringTextureUrls[file]!;
  }
  if(typeof Image!=="undefined")for(const object of objects){const url=object.metadata?.coveringTextureUrl;if(!url||textures.has(url))continue;
    const image=new Image();textures.set(url,image);image.onload=()=>listeners.forEach(fn=>fn());image.src=url;
    if(textures.size>1030)for(const key of textures.keys())if(!["Rubber002","Fabric061","Metal049A"].includes(key)&&!objects.some(o=>o.metadata?.coveringTextureUrl===key)){textures.delete(key);break;}
  }
  return ()=>{listeners.delete(invalidate);};
}
const hatchTiles=new Map<string,HTMLCanvasElement>();
/** A bounded repeat tile avoids per-line work on very long pipes. */
function hatchTile(style:Required<CoveringStyle>):HTMLCanvasElement|null {
  if(style.hatch==="none"||typeof document==="undefined")return null;
  const key=JSON.stringify([style.hatch,style.hatchColor]);
  const cached=hatchTiles.get(key);if(cached)return cached;
  const tile=document.createElement("canvas");tile.width=tile.height=32;
  const ctx=tile.getContext("2d");if(!ctx)return null;
  drawHatchTile(ctx,style.hatch,style.hatchColor);
  if(hatchTiles.size>=64)hatchTiles.delete(hatchTiles.keys().next().value!);
  hatchTiles.set(key,tile);return tile;
}
export function drawHatchTile(ctx:CanvasRenderingContext2D,hatch:Required<CoveringStyle>["hatch"],color:string):void {
  ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=2;ctx.beginPath();
  if(hatch==="dots"){ctx.arc(16,16,2,0,2*Math.PI);ctx.fill();}
  else if(hatch!=="none"){
    ctx.moveTo(0,16);ctx.lineTo(32,16);
    if(hatch==="cross"){ctx.moveTo(16,0);ctx.lineTo(16,32);}
    ctx.stroke();
  }
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
  const style=resolvedCoveringStyle(JSON.parse(object.metadata?.coveringStyle??"{}"));
  const file=coveringTextureFile((object.metadata?.coveringKind??"braid") as CoveringKind,style);
  for(const surface of coveringSurfaces(object)){
    const polygon=surface.polygon;if(!polygon.length)continue;
    context.save();context.beginPath();polygon.forEach((p,i)=>i?context.lineTo(p.x,p.y):context.moveTo(p.x,p.y));context.closePath();
    context.fillStyle=object.color;context.fill();
    const image=object.metadata?.coveringTextureUrl?textures.get(object.metadata.coveringTextureUrl):file?textures.get(file):undefined;
    if(image?.complete&&image.naturalWidth){
      const pattern=context.createPattern(image,"repeat");
      if(pattern){pattern.setTransform(new DOMMatrix().rotate(style.textureRotation).scale(.08*style.textureScale));context.save();context.globalAlpha=.38;context.fillStyle=pattern;context.fill();context.restore();}
    }
    const tile=hatchTile(style);
    if(tile){const pattern=context.createPattern(tile,"repeat");if(pattern){pattern.setTransform(new DOMMatrix().rotate(style.hatchRotation).scale(style.hatchSpacing/32));context.fillStyle=pattern;context.fill();}}
    context.strokeStyle=selected?"#007fae":style.lineColor;context.lineWidth=selected?2:1;context.stroke();context.restore();
  }
  if(selected)for(const grip of coveringGrips(object)){
    const {point:p,normal:n,halfWidth:w}=grip;context.strokeStyle=grip.bound?"#21905c":"#007fae";context.lineWidth=3;
    context.beginPath();context.moveTo(p.x-n.x*w,p.y-n.y*w);context.lineTo(p.x+n.x*w,p.y+n.y*w);context.stroke();
  }
}
