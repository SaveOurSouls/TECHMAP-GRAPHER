import {terminationAsset,type PreparationMode,type TerminationView,type TerminationAsset} from './catalog';
// The production server exposes /assets only. Vite emits content-hashed files there.
const symbolUrls=import.meta.glob<string>('./symbol-assets/*.svg',{eager:true,query:'?url&no-inline',import:'default'});
export interface TerminationSymbolSelection {readonly assetId?:string;readonly symbolId?:string;readonly colorId?:string|null;readonly color?:string;readonly preparationMode?:PreparationMode}
export const preparationAssetIds:Readonly<Record<PreparationMode,string>>={cut:'preparation-none',copper:'preparation-copper',tin:'preparation-tinned-copper',pin:'preparation-pin',socket:'preparation-socket','pin-sealed':'preparation-pin-seal','socket-sealed':'preparation-socket-seal',lug:'preparation-lug'};
export const preparationModeForAsset=(id:string):PreparationMode|undefined=>(Object.entries(preparationAssetIds) as [PreparationMode,string][]).find(([,v])=>v===id)?.[0];
export interface TerminationSymbolDescriptor {
 readonly assetId:string;readonly href:string;readonly viewBox:readonly [number,number,number,number];
 readonly anchors:TerminationAsset['anchors'];readonly pivot:TerminationAsset['pivot'];readonly pointCount:number;
 readonly monochrome:boolean;readonly colorApplied:boolean;
}
export function getTerminationSymbol(selection:TerminationSymbolSelection,view:TerminationView):TerminationSymbolDescriptor|null{
 const id=selection.preparationMode?preparationAssetIds[selection.preparationMode]:selection.assetId??selection.symbolId;
 const asset=id?terminationAsset(id):undefined;if(!asset)return null;
 const color=selection.colorId??selection.color,option=asset.colorOptions?.find(c=>c.id===color||c.hex.toLowerCase()===color?.toLowerCase());
 const filename=option?.views[view]??asset.views[view];
 const href=symbolUrls[`./symbol-assets/${filename}`];if(!href)return null;
 return {assetId:asset.id,href,viewBox:[0,0,220,100],anchors:asset.anchors,pivot:asset.pivot,pointCount:asset.electricalPointCount,monochrome:view==='e4',colorApplied:view==='drawing'&&!!option};
}
export function getTerminationSymbolById(assetId:string,view:TerminationView,colorId?:string):TerminationSymbolDescriptor|null{return getTerminationSymbol({assetId,colorId},view);}
