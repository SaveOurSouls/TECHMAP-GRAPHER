import {expect,it} from "vitest";
import {createEmptyHarnessDesign} from "./model";
import {createJoiningPipe} from "./physical-joining-pipes";
import {physicalTopologyScene} from "./physical-scene";
import {parseHarnessDesignDocument} from "./model";
import {createEditorHistory,executeEditorCommand,undoEditorCommand} from "./history";
import {drawEditorSceneObject} from "./CanvasViewport";

it("saves and renders independent P and OP transparency without changing their geometry",()=>{
 const empty=createEmptyHarnessDesign();
 const topology={snap:false,nodes:[
  {id:"a",position:{x:0,y:0}},{id:"b",position:{x:600,y:0}},
  {id:"c",position:{x:0,y:100}},{id:"d",position:{x:600,y:100}},
 ],segments:[
  {id:"p0",from:"a",to:"b",path:{kind:"polyline" as const,points:[]}},
  {id:"p1",from:"c",to:"d",path:{kind:"polyline" as const,points:[]}},
 ],routes:[]};
 const base={...empty,physicalTopology:topology};
 const joining=createJoiningPipe(base,[["p0"],["p1"]],"op");
 const document={...base,physicalTopology:{...topology,joiningPipes:[joining]}};
 const pChanged=executeEditorCommand(createEditorHistory(document),{type:"set-physical-topology",topology:{...document.physicalTopology,segments:document.physicalTopology.segments.map(s=>s.id==="p0"?{...s,opacity:.3}:s)}});
 const opChanged=executeEditorCommand(pChanged,{type:"update-joining-pipe",pipeId:"op",opacity:.8});
 const restored=parseHarnessDesignDocument(JSON.parse(JSON.stringify(opChanged.present)));
 expect(restored.physicalTopology?.segments.find(s=>s.id==="p0")?.opacity).toBe(.3);
 expect(restored.physicalTopology?.joiningPipes?.find(p=>p.id==="op")?.opacity).toBe(.8);
 expect(restored.physicalTopology?.segments.map(s=>s.path)).toEqual(document.physicalTopology.segments.map(s=>s.path));
 const scene=physicalTopologyScene(restored),p=scene.find(o=>o.id==="p0")!,op=scene.find(o=>o.id==="op")!;
 expect(p.metadata?.opacity).toBe("0.3");expect(op.metadata?.opacity).toBe("0.8");
 expect(p.metadata?.volumeShading).toBe("true");
 for(const [object,expected] of [[p,.3],[op,.8]] as const){
  const state:Record<string,unknown>={globalAlpha:1};
  const context=new Proxy(state,{get(target,key:string){return key in target?target[key]:()=>{};}}) as unknown as CanvasRenderingContext2D;
  drawEditorSceneObject(context,{...object,metadata:{...object.metadata,volumeShading:"false"}},false,"drawing");
  expect(state.globalAlpha).toBe(expected);
 }
 expect(undoEditorCommand(opChanged).present.physicalTopology?.segments.find(s=>s.id==="p0")?.opacity).toBe(.3);
 expect(undoEditorCommand(opChanged).present.physicalTopology?.joiningPipes?.find(p=>p.id==="op")?.opacity).toBeUndefined();
});
