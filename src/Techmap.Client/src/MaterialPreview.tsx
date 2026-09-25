import {useEffect,useRef} from "react";
import {textureOverlay} from "./editor/texture-tint";
import {drawThreadBand} from "./editor/thread-band-renderer";
import {drawCatalogHatch} from "./hatching";
export function MaterialPreview({url,tint,angle,scale,lineColor,lineWidth,kind,backgroundColor="#f3f5f6",hatchCode,hatchLineWidth=1}:{kind?:string|null;url:string;tint:string;angle:number;scale:number;lineColor:string;lineWidth:number;backgroundColor?:string;hatchCode?:string|null;hatchLineWidth?:number}){
 const canvas=useRef<HTMLCanvasElement>(null);
 useEffect(()=>{
  let cancelled=false;
  const draw=(image?:HTMLImageElement)=>{
   if(cancelled||!canvas.current)return;const ctx=canvas.current.getContext("2d");if(!ctx)return;
   ctx.clearRect(0,0,160,64);ctx.fillStyle=backgroundColor;ctx.fillRect(0,0,160,64);
   if(hatchCode)drawCatalogHatch(ctx,hatchCode,scale,angle,tint,hatchLineWidth,{x:0,y:0,width:160,height:64});
   else if(image){
    const tile=textureOverlay(image,tint),pattern=ctx.createPattern(tile,"repeat");
    if(pattern){pattern.setTransform(new DOMMatrix().rotate(angle).scale(.5*scale*64/tile.width));ctx.fillStyle=pattern;ctx.fillRect(0,0,160,64);}
    if(kind==="band")drawThreadBand(ctx,{polygon:[{x:0,y:0},{x:160,y:0},{x:160,y:64},{x:0,y:64}],path:[{x:0,y:32},{x:160,y:32}]},scale,angle,tint);
   }
   ctx.strokeStyle=lineColor;ctx.lineWidth=lineWidth;ctx.strokeRect(lineWidth/2,lineWidth/2,160-lineWidth,64-lineWidth);
  };
  draw();
  if(!hatchCode){const image=new Image();image.onload=()=>draw(image);image.src=url;}
  return()=>{cancelled=true};
 },[url,tint,angle,scale,lineColor,lineWidth,kind,backgroundColor,hatchCode,hatchLineWidth]);
 return <canvas ref={canvas} width={160} height={64} aria-label={hatchCode?"Образец штриховки":"Образец текстуры"}/>;
}
