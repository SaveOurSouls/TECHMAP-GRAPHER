import {afterEach,expect,it,vi} from "vitest";
import {physicalFixture} from "./physical-topology-fixture";
import {applyEditorCommand} from "./commands";
import {parseHarnessDesignDocument} from "./model";
import {coveringScene,moveCovering} from "./covering-layout";
import {splitCoveringSpans,type PhysicalCovering} from "./physical-coverings";
import {coveringTextureFile,defaultCoveringStyle,resolvedCoveringStyle,type CoveringStyle} from "./covering-style";
import {coveringTextureUrls,drawCoveringSurface,drawHatchTile,warmCoveringTextures} from "./covering-renderer";
import {drawVolumeSurface} from "./drawing-volume";

const style:CoveringStyle={texture:"Metal049A",textureScale:2.5,textureRotation:-30,hatch:"cross",hatchColor:"#ff0000",hatchSpacing:6,hatchRotation:60,lineColor:"#0000ff"};
const cover:PhysicalCovering={id:"style-cover",name:"Оболочка",color:"#ffffff",width:20,lengthMm:90,spans:[{segmentId:"S0",from:.1,to:.8}],style};
const fixture=()=>{const d=physicalFixture();return {...d,drawingDocuments:{tables:[],leaders:[],bomOrder:[],volumeShading:false},physicalTopology:{...d.physicalTopology!,coverings:[cover]}};};
it("shades sleeve bands from local centre points",()=>{
 const fills:string[]=[];const state={fillStyle:"",save:()=>undefined,restore:()=>undefined,beginPath:()=>undefined,moveTo:()=>undefined,lineTo:()=>undefined,closePath:()=>undefined,fill:()=>fills.push(state.fillStyle),clip:()=>undefined};
 drawVolumeSurface(state as unknown as CanvasRenderingContext2D,[{x:0,y:-10},{x:100,y:-10},{x:100,y:10},{x:0,y:10}],[{x:0,y:0},{x:100,y:0}]);
 expect(fills.length).toBe(8);expect(fills[0]).toBe("rgba(0,0,0,.25)");
});
afterEach(()=>vi.unstubAllGlobals());
it("imports every built-in texture through the asset pipeline",()=>{
  expect(Object.keys(coveringTextureUrls)).toEqual(["Rubber002","Fabric061","Metal049A"]);
  for(const [name,url] of Object.entries(coveringTextureUrls))expect(url).toContain(name);
});

it("retains legacy defaults and chooses the preferred texture without changing geometry",()=>{
  expect(resolvedCoveringStyle()).toEqual(defaultCoveringStyle);
  expect(coveringTextureFile("nylon")).toBe("Fabric061");
  expect(coveringTextureFile("heat-shrink")).toBe("Rubber002");
  expect(coveringTextureFile("braid",{texture:"none"})).toBeNull();
  expect(coveringTextureFile("braid",style)).toBe("Metal049A");
});

it("persists independent styles through a command, reload, sleeve move and branch split",()=>{
  const d=physicalFixture(),changed=applyEditorCommand(d,{type:"set-physical-topology",topology:fixture().physicalTopology!});
  const loaded=parseHarnessDesignDocument(JSON.parse(JSON.stringify(changed)));
  expect(loaded.physicalTopology!.coverings![0]!.style).toEqual(style);
  expect(loaded.wires).toEqual(parseHarnessDesignDocument(JSON.parse(JSON.stringify(d))).wires);
  const object=coveringScene(loaded)[0]!;
  expect(JSON.parse(object.metadata!.coveringStyle!)).toEqual(style);
  const start=object.paths![0]![0]!;
  expect(moveCovering(loaded,cover.id,0,"body",start,{x:start.x+5,y:start.y})!.style).toEqual(style);
  expect(splitCoveringSpans([cover],"S0","split",.5)![0]!.style).toEqual(style);
  expect(loaded.physicalTopology!.coverings![0]!.color).toBe("#ffffff");
});
it.each([null,[],{texture:"remote.jpg"},{texture:null},{textureScale:0},{textureScale:10.01},{textureRotation:181},{textureRotation:"45"},{hatch:"unknown"},{hatchColor:"red"},{lineColor:"#12345g"},{hatchSpacing:0},{hatchSpacing:101},{hatchRotation:NaN}])("rejects invalid style %j",invalid=>{
  const d=fixture();expect(()=>parseHarnessDesignDocument({...d,physicalTopology:{...d.physicalTopology,coverings:[{...cover,style:invalid}]}})).toThrow();
});
it("renders fill, texture, hatch and outline independently with separate transforms",()=>{
  class Matrix { angle=0;size=1;rotate(n:number){this.angle=n;return this;}scale(n:number){this.size=n;return this;} }
  class FakeImage { complete=true;naturalWidth=1024;naturalHeight=1024;onload?:()=>void;set src(_:string){this.onload?.();} }
  const tileCtx=new Proxy({},{get:(_,key)=>key==="getImageData"?()=>({data:new Uint8ClampedArray([0,0,0,255,255,255,255,255])}):vi.fn(),set:()=>true});
  vi.stubGlobal("Image",FakeImage);vi.stubGlobal("DOMMatrix",Matrix);
  vi.stubGlobal("document",{querySelector:()=>null,createElement:()=>({getContext:()=>tileCtx})});
  const transforms:Matrix[]=[],patterns:object[]=[],fills:unknown[]=[];
  const state={fillStyle:undefined as unknown,strokeStyle:undefined as unknown,fill(){fills.push(this.fillStyle);},createPattern(){const p={setTransform:(m:Matrix)=>transforms.push(m)};patterns.push(p);return p;}};
  const ctx=new Proxy(state,{get:(t,key)=>key in t?t[key as keyof typeof t]:vi.fn(),set:(t,key,value)=>{Reflect.set(t,key,value);return true;}}) as unknown as CanvasRenderingContext2D;
  const stop=warmCoveringTextures(vi.fn());
  drawCoveringSurface(ctx,coveringScene(fixture())[0]!,false);stop();
  expect(fills).toEqual(["#ffffff",...patterns]);
  expect(transforms.map(m=>[m.angle,m.size])).toEqual([[-30,2.5*32/512],[60,6/32]]);
  expect(state.strokeStyle).toBe("#0000ff");
  fills.length=0;transforms.length=0;
  const d=fixture();d.physicalTopology.coverings=[{...cover,style:{...style,texture:"none",hatch:"none"}}];
  drawCoveringSurface(ctx,coveringScene(d)[0]!,false);
  expect(fills).toEqual(["#ffffff"]);expect(transforms).toHaveLength(0);
});
it.each(["parallel","cross","dots"] as const)("draws %s in the requested hatch color",hatch=>{
  const ctx=new Proxy({},{get:(t,k)=>k in t?Reflect.get(t,k):vi.fn(),set:(t,k,v)=>{Reflect.set(t,k,v);return true;}}) as CanvasRenderingContext2D;
  drawHatchTile(ctx,hatch,"#de1234");expect(ctx.strokeStyle).toBe("#de1234");expect(ctx.fillStyle).toBe("#de1234");
});
