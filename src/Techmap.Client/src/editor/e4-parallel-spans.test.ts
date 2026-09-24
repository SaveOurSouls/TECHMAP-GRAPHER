import {expect,it,vi} from "vitest";
import {commonParallelSpan,parallelSpanLocal,parallelSpanWorld} from "./e4-parallel-spans";
import {drawE4DifferentialPairs,getE4DifferentialPairLayout,hitTestE4DifferentialPair} from "./CanvasViewport";
import type {EditorSceneObject} from "./editor-types";
import {createConnector,createWire,applyEditorCommand} from "./commands";
import {createEmptyHarnessDesign,parseHarnessDesignDocument} from "./model";

const paths=[{id:"a",points:[{x:100,y:100},{x:500,y:300}]},{id:"b",points:[{x:100,y:140},{x:500,y:340}]}];
const objects:EditorSceneObject[]=paths.map(p=>({...p,kind:"wire",layerId:"wires",label:p.id,x:0,y:0,width:0,height:0,color:p.id==="a"?"#f00":"#00f"}));
const pair={id:"p",wireIds:["a","b"] as const,step:20,amplitude:4,variant:2 as const};

it("finds the shared oblique interval, rejects nonparallel paths and round-trips coordinates",()=>{
 const span=commonParallelSpan(paths)!;
 expect(span.direction).toEqual({x:2/Math.sqrt(5),y:1/Math.sqrt(5)});
 expect(span.crossMaximum-span.crossMinimum).toBeCloseTo(80/Math.sqrt(5));
 const point={x:250,y:360},local=parallelSpanLocal(span,point),back=parallelSpanWorld(span,local.x,local.y);
 expect(back.x).toBeCloseTo(point.x);expect(back.y).toBeCloseTo(point.y);
 expect(commonParallelSpan([paths[0]!,{id:"b",points:[{x:0,y:0},{x:50,y:100}]}])).toBeNull();
 expect(commonParallelSpan(paths.map(p=>({...p,points:[...p.points].reverse()})))!.firstWireDirection).toBe(-1);
});

it("paints and selects oblique motifs in the same frame",()=>{
 const layout=getE4DifferentialPairLayout(pair,objects)!;
 const center=parallelSpanWorld(layout.span,layout.motifs[0]!.center,(layout.crossMinimum+layout.crossMaximum)/2);
 expect(hitTestE4DifferentialPair([pair],objects,center,1,[{id:"wires",label:"W",visible:true,locked:false}])?.id).toBe("p");
 const context=new Proxy({},{get:(o:Record<string,unknown>,key:string)=>o[key]??(o[key]=vi.fn()),set:(o:Record<string,unknown>,key:string,value)=>{o[key]=value;return true;}}) as unknown as CanvasRenderingContext2D;
 drawE4DifferentialPairs(context,[pair],objects);
 const u=layout.span.direction!;
 expect(context.transform).toHaveBeenCalledWith(u.x,u.y,-u.y,u.x,0,0);
 expect(context.stroke).toHaveBeenCalled();
});

it("clips the oblique decoration away from connector bounds",()=>{
 const original=getE4DifferentialPairLayout(pair,objects)!;
 const table:EditorSceneObject={id:"x",kind:"connector",layerId:"connectors",label:"X",x:250,y:140,width:100,height:150,color:"black"};
 const clipped=getE4DifferentialPairLayout(pair,[...objects,table])!;
 expect(clipped.span.end-clipped.span.start).toBeLessThan(original.span.end-original.span.start);
 for(const motif of clipped.motifs)for(const along of [motif.from,motif.to])for(const cross of [clipped.crossMinimum,clipped.crossMaximum]){
   const p=parallelSpanWorld(clipped.span,along,cross);
   expect(p.x>=table.x&&p.x<=table.x+table.width&&p.y>=table.y&&p.y<=table.y+table.height).toBe(false);
 }
});

it("creates and serializes a pair with a diagonal main section and directed contact leads",()=>{
 const a=createConnector("a","A",2,{x:0,y:0}),b=createConnector("b","B",2,{x:1000,y:200});
 const wires=[1,2].map(n=>({...createWire("w"+n,{connectorId:"a",contactId:"a:contact:"+n},{connectorId:"b",contactId:"b:contact:"+n}),e4Route:[{x:700,y:40+n*24},{x:900,y:240+n*24}],e4RouteMode:"manual" as const}));

 const d={...createEmptyHarnessDesign(),connectors:[a,{...b,schematic:{...b.schematic,orientation:"contacts-left" as const}}],wires};
 const changed=applyEditorCommand(d,{type:"create-diff-pair",group:{...pair,wireIds:["w1","w2"]}});
 expect(parseHarnessDesignDocument(JSON.parse(JSON.stringify(changed))).diffPairs).toEqual(changed.diffPairs);
});
