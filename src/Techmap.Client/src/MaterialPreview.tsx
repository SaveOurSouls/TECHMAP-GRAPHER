import {useEffect,useRef} from "react";
import {tintedTexture} from "./editor/texture-tint";
export function MaterialPreview({url,tint,angle,scale,lineColor,lineWidth}:{url:string;tint:string;angle:number;scale:number;lineColor:string;lineWidth:number}){
 const canvas=useRef<HTMLCanvasElement>(null);
 useEffect(()=>{let cancelled=false;const image=new Image();image.onload=()=>{if(cancelled||!canvas.current)return;const ctx=canvas.current.getContext("2d");if(!ctx)return;ctx.clearRect(0,0,160,64);ctx.fillStyle="#f3f5f6";ctx.fillRect(0,0,160,64);const tile=tintedTexture(image,tint),pattern=ctx.createPattern(tile,"repeat");if(pattern){pattern.setTransform(new DOMMatrix().rotate(angle).scale(.5*scale*64/tile.width));ctx.fillStyle=pattern;ctx.fillRect(0,0,160,64);}ctx.strokeStyle=lineColor;ctx.lineWidth=lineWidth;ctx.strokeRect(lineWidth/2,lineWidth/2,160-lineWidth,64-lineWidth);};image.src=url;return()=>{cancelled=true};},[url,tint,angle,scale,lineColor,lineWidth]);
 return <canvas ref={canvas} width={160} height={64} aria-label="Образец текстуры"/>;
}
