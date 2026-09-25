/** Recolour luminance, not opacity: even black/white retain visible material tones. */
export function tintTexturePixels(pixels:Uint8ClampedArray,tint:string):void {
 const rgb=[1,3,5].map(i=>parseInt(tint.slice(i,i+2),16));
 const base=rgb.map(c=>24+c*207/255);
 for(let i=0;i<pixels.length;i+=4){
  const tone=(.2126*pixels[i]!+.7152*pixels[i+1]!+.0722*pixels[i+2]!)/255;
  for(let c=0;c<3;c++)pixels[i+c]=Math.round(tone<.5?base[c]!*(.45+1.1*tone):base[c]!+(255-base[c]!)*(tone-.5)*1.1);
 }
}
const tiles=new Map<string,HTMLCanvasElement>();
export function tintedTexture(image:HTMLImageElement,tint:string):HTMLCanvasElement {
 const key=`${image.src}|${tint}`; const cached=tiles.get(key); if(cached)return cached;
 const tile=document.createElement("canvas"),scale=Math.min(1,512/Math.max(image.naturalWidth,image.naturalHeight));
 tile.width=Math.max(1,Math.round(image.naturalWidth*scale));tile.height=Math.max(1,Math.round(image.naturalHeight*scale));
 const ctx=tile.getContext("2d")!;ctx.drawImage(image,0,0,tile.width,tile.height);
 const pixels=ctx.getImageData(0,0,tile.width,tile.height);tintTexturePixels(pixels.data,tint);ctx.putImageData(pixels,0,0);
 if(tiles.size>=24)tiles.delete(tiles.keys().next().value!);tiles.set(key,tile);return tile;
}
