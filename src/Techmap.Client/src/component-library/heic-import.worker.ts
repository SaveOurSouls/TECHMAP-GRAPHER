import buildLibheif from "heic-decoder";
// Served as a same-origin worker; no blob workers or unsafe-eval CSP exceptions.
self.onmessage=async (event:MessageEvent<ArrayBuffer>)=>{
  let decoder:any,images:any[]=[];
  try {
    const lib=buildLibheif();decoder=new lib.HeifDecoder();images=decoder.decode(event.data);
    if(!images.length)throw new Error("HEIC не содержит изображения.");
    const image=images[0],width=image.get_width(),height=image.get_height();
    if(width<=0||height<=0||width>16384||height>16384||width*height*4>256*1024*1024)throw new Error("Изображение HEIC слишком большое.");
    const rgba=await new Promise<ImageData>((resolve,reject)=>image.display(new ImageData(width,height),(data:ImageData|null)=>data?resolve(data):reject(new Error("Не удалось декодировать HEIC."))));
    const canvas=new OffscreenCanvas(width,height);canvas.getContext("2d")!.putImageData(rgba,0,0);
    const png=await canvas.convertToBlob({type:"image/png"});self.postMessage({png});
    if(decoder.decoder)lib.heif_context_free(decoder.decoder);
  }catch(error){self.postMessage({error:error instanceof Error?error.message:String(error)});}
  finally{images.forEach(image=>image.free());}
};
