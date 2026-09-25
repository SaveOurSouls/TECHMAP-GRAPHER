import {expect,it,vi} from "vitest";
import {tintTexturePixels} from "./texture-tint";
import {prepareGlobalCoverings} from "./global-covering-materials";
import {physicalFixture} from "./physical-topology-fixture";
import {standardCovering} from "./physical-coverings";
import {createEditorHistory,executeEditorCommand,undoEditorCommand,redoEditorCommand} from "./history";
import {parseHarnessDesignDocument} from "./model";
import {validCoveringStyle} from "./covering-style";
import type {GlobalMaterial} from "../material-library-api";
const entry={sha256:"a".repeat(64),name:"Материал"};
const material:GlobalMaterial={materialId:"id",name:"Образец",mediaType:"image/png",imageBase64:"png",lineColor:"#123456",lineWidth:2.5,textureAngle:45,textureScale:2,tint:"#16a34a",coveringKind:"heat-shrink",updatedUtc:"",revision:1};
it.each(["#000000","#ffffff","#16a34a","#dc2626"])("recolours %s without flattening tones or changing transparency",tint=>{
 const data=new Uint8ClampedArray([0,0,0,0,96,96,96,71,255,255,255,255]);tintTexturePixels(data,tint);
 expect([data[3],data[7],data[11]]).toEqual([0,71,255]);
 for(let c=0;c<3;c++){expect(data[c+4]!).toBeGreaterThan(data[c]!);expect(data[c+8]!).toBeGreaterThan(data[c+4]!);}
});
it("pins settings and bytes only for new coverings; undo is atomic and old sleeves never follow library updates",async()=>{
 const doc=physicalFixture(),old=standardCovering(doc,"S0",{x:200,y:60},"Термоусадка","old"),fresh={...old,id:"new"};
 const before={...doc,physicalTopology:{...doc.physicalTopology!,coverings:[old]}};
 const command={type:"set-physical-topology" as const,topology:{...before.physicalTopology,coverings:[old,fresh]}};
 const pin=vi.fn(async()=>entry);
 const prepared=await prepareGlobalCoverings(before,command,async()=>[material],pin);
 expect(pin).toHaveBeenCalledTimes(1);
 const h=executeEditorCommand(createEditorHistory(before),prepared),c=h.present.physicalTopology!.coverings![1]!;
 expect(c.style).toMatchObject({texture:`asset:${entry.sha256}`,lineWidth:2.5,textureTint:"#16a34a",textureRotation:45,textureScale:2});
 expect(h.present.physicalTopology!.coverings![0]).toEqual(old);
 expect(h.present.drawingDocuments!.coveringLibrary!.textures).toEqual([entry]);
 const restored=parseHarnessDesignDocument(JSON.parse(JSON.stringify(h.present)));
 expect(restored.physicalTopology).toEqual(h.present.physicalTopology);expect(restored.drawingDocuments).toEqual(h.present.drawingDocuments);
 expect(undoEditorCommand(h).present).toEqual(before);expect(redoEditorCommand(undoEditorCommand(h)).present).toEqual(h.present);
 const list=vi.fn(async()=>[]);await prepareGlobalCoverings(h.present,{type:"set-physical-topology",topology:h.present.physicalTopology!},list,pin);expect(list).not.toHaveBeenCalled();
});
it("an explicit local preference wins and failed asset pinning cannot return a half-applied document",async()=>{
 const doc=physicalFixture(),cover=standardCovering(doc,"S0",{x:200,y:60},"Термоусадка","new");
 const command={type:"set-physical-topology" as const,topology:{...doc.physicalTopology!,coverings:[cover]}};
 const list=vi.fn(async()=>[material]),pin=vi.fn(async()=>{throw new Error("upload failed")});
 const local={...doc,drawingDocuments:{tables:[],leaders:[],bomOrder:[],coveringLibrary:{textures:[],defaults:{"heat-shrink":{texture:"none" as const}}}}};
 expect(await prepareGlobalCoverings(local,command,list,pin)).toBe(command);expect(list).not.toHaveBeenCalled();
 await expect(prepareGlobalCoverings(doc,command,list,pin)).rejects.toThrow("upload failed");expect(doc.physicalTopology?.coverings??[]).toHaveLength(0);
});
it.each([{lineWidth:0},{lineWidth:NaN},{lineWidth:21},{textureTint:"red"}])("rejects invalid extended style %o",style=>expect(validCoveringStyle(style)).toBe(false));
