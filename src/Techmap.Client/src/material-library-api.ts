import {createMutationHeaders,type LocalSession} from "./local-session";
import {buildApiUrl,type RuntimeConfig} from "./runtime-config";
import type {CoveringKind} from "./editor/physical-coverings";
export interface GlobalMaterial {
 materialId:string; name:string; mediaType:"image/png"; imageBase64:string;
 lineColor:string; lineWidth:number; textureAngle:number; textureScale:number;
 tint:string; coveringKind:CoveringKind|null; updatedUtc:string; revision:number;
}
export function createMaterialLibraryApi(config:RuntimeConfig,session:LocalSession,fetcher:typeof fetch=fetch){
 const route="material-library";
 const req=async(path:string,init?:RequestInit,query="")=>{
  const r=await fetcher(buildApiUrl(config,path)+query,{credentials:"same-origin",cache:"no-store",...init});
  if(!r.ok){const error=await r.json().catch(()=>null);throw new Error(error?.message??"Не удалось прочитать или изменить библиотеку материалов.");}
  return r.status===204?null:r.json();
 };
 return {
  async list():Promise<GlobalMaterial[]>{const x=await req(route);if(!Array.isArray(x?.materials))throw new Error("Повреждён список материалов.");return x.materials;},
  get:(id:string):Promise<GlobalMaterial>=>req(`${route}/${encodeURIComponent(id)}`),
  imageUrl:(m:GlobalMaterial)=>buildApiUrl(config,`${route}/${encodeURIComponent(m.materialId)}/image`)+`?revision=${m.revision}`,
  create:(m:GlobalMaterial):Promise<GlobalMaterial>=>req(route,{method:"POST",headers:createMutationHeaders(session),body:JSON.stringify(m)}),
  update:(m:GlobalMaterial):Promise<GlobalMaterial>=>req(`${route}/${encodeURIComponent(m.materialId)}`,{method:"PUT",headers:createMutationHeaders(session),body:JSON.stringify(m)}),
  remove:(m:GlobalMaterial)=>req(`${route}/${encodeURIComponent(m.materialId)}`,{method:"DELETE",headers:createMutationHeaders(session)},`?expectedRevision=${m.revision}`)
 };
}
