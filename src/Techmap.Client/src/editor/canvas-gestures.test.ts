import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { CanvasViewport } from "./CanvasViewport";
import type { EditorSceneObject } from "./editor-types";

// Exercise the actual event handlers without a browser renderer. Effects install
// the real Escape listener; pointer capture and native events are modeled below.
const hooks=vi.hoisted(()=>({effects:[] as (()=>unknown)[]}));
vi.mock("react",async importOriginal=>({
  ...await importOriginal<typeof import("react")>(),
  useRef:(current:unknown)=>({current}),
  useState:(value:unknown)=>[typeof value==="function"?value():value,vi.fn()],
  useMemo:(factory:()=>unknown)=>factory(),
  useEffect:(effect:()=>unknown)=>{hooks.effects.push(effect);},
}));

const connector:EditorSceneObject={id:"X",kind:"connector",layerId:"connectors",label:"X",x:100,y:80,width:118,height:100,color:"#222",metadata:{view:"e4",orientation:"right",rows:"[]"}};
let keydown:(event:{key:string})=>void;
beforeEach(()=>{
  hooks.effects=[];
  vi.stubGlobal("window",{addEventListener:(type:string,fn:typeof keydown)=>{if(type==="keydown")keydown=fn;},removeEventListener:vi.fn()});
});
afterEach(()=>vi.unstubAllGlobals());

function fixture(){
  const move=vi.fn(),preview=vi.fn();
  const tree=CanvasViewport({view:"e4",tool:"select",camera:{zoom:1,offsetX:0,offsetY:0},objects:[connector],layers:[{id:"connectors",label:"Соединители",visible:true,locked:false}],selectedObjectId:"X",inlineEditor:"Table",onCatalogDrop:vi.fn(),onCameraChange:vi.fn(),onObjectSelect:vi.fn(),onObjectMove:move,onObjectMovePreview:preview});
  hooks.effects.forEach(effect=>effect());
  const children=(tree.props as {children:ReactElement[]}).children.filter(Boolean);
  const inline=children.find(c=>(c.props as {className?:string}).className?.startsWith("he-e4-inline-editor"))!;
  const canvas=children.find(c=>c.type==="canvas")!;
  type Handlers=Record<string,(event:unknown)=>void>;
  const handlers=inline.props as Handlers,canvasHandlers=canvas.props as Handlers;
  let captured=false;
  const currentTarget={setPointerCapture:()=>{captured=true;},hasPointerCapture:()=>captured,releasePointerCapture:vi.fn(()=>{captured=false;})};
  const event=(shiftKey=false,x=100,y=90)=>({pointerId:1,button:0,detail:1,clientX:x,clientY:y,shiftKey,currentTarget,target:{closest:(selector:string)=>selector.includes("is-readonly")?{}:null},stopPropagation:vi.fn(),preventDefault:vi.fn()});
  return {handlers,canvasHandlers,event,move,preview,currentTarget};
}

it.each([false,true])("passes the initial Shift=%s mode through inline preview and commit",shift=>{
  const f=fixture();
  f.handlers.onPointerDown!(f.event(shift));
  f.handlers.onPointerMove!(f.event(!shift,130,110));
  expect(f.preview).toHaveBeenLastCalledWith("X",{x:130,y:100},shift?"adjacent":"carry");
  f.handlers.onPointerUp!(f.event(!shift,130,110));
  expect(f.move).toHaveBeenCalledExactlyOnceWith("X",{x:130,y:100},shift?"adjacent":"carry");
  f.handlers.onLostPointerCapture!(f.event());
  expect(f.move).toHaveBeenCalledTimes(1);
});

it.each(["Escape","onPointerCancel","onLostPointerCapture"])("cancels inline preview on %s without a later commit",cancel=>{
  const f=fixture();
  f.handlers.onPointerDown!(f.event(true));
  f.handlers.onPointerMove!(f.event(true,130,110));
  if(cancel==="Escape")keydown({key:"Escape"});else f.handlers[cancel]!(f.event());
  expect(f.preview).toHaveBeenLastCalledWith("X",null);
  expect(f.currentTarget.releasePointerCapture).toHaveBeenCalledTimes(1);
  f.handlers.onPointerUp!(f.event(true,150,130));
  expect(f.move).not.toHaveBeenCalled();
});

it("cancels Canvas object capture loss and ignores its later pointerup",()=>{
  const f=fixture();
  f.canvasHandlers.onPointerDown!(f.event(false,110,90));
  f.canvasHandlers.onPointerMove!(f.event(false,140,110));
  f.canvasHandlers.onLostPointerCapture!(f.event());
  expect(f.preview).toHaveBeenLastCalledWith("X",null);
  f.canvasHandlers.onPointerUp!(f.event(false,160,130));
  expect(f.move).not.toHaveBeenCalled();
});

it('picks a bundle participant without creating a pipe drag or changing selection',()=>{
 const pick=vi.fn(),move=vi.fn(),select=vi.fn(),double=vi.fn(),cancel=vi.fn();
 const pipe:EditorSceneObject={id:'pipe',kind:'physical-segment',layerId:'pipes',label:'S1',color:'#333333',x:0,y:0,width:10,height:0,points:[{x:20,y:50},{x:300,y:50}]};
 const tree=CanvasViewport({view:'drawing',tool:'select',camera:{zoom:1,offsetX:0,offsetY:0},objects:[pipe],layers:[{id:'pipes',label:'Pipes',visible:true,locked:false}],selectedObjectId:null,
  onCatalogDrop:vi.fn(),onCameraChange:vi.fn(),onObjectSelect:select,onObjectMove:move,onObjectPick:pick,onObjectPickCancel:cancel,onCanvasDoubleClick:double});
 const canvas=(tree.props as {children:ReactElement[]}).children.find(c=>c?.type==='canvas')!;
 const handlers=canvas.props as Record<string,(event:any)=>void>,capture=vi.fn();
 const e={pointerId:1,button:0,clientX:100,clientY:50,currentTarget:{setPointerCapture:capture},preventDefault:vi.fn(),stopPropagation:vi.fn()};
 handlers.onPointerDown!(e);handlers.onDoubleClick!(e);
 expect(pick).toHaveBeenCalledExactlyOnceWith('pipe');expect(capture).not.toHaveBeenCalled();expect(select).not.toHaveBeenCalled();expect(move).not.toHaveBeenCalled();expect(double).not.toHaveBeenCalled();
 handlers.onKeyDown!({...e,key:'Escape'});expect(cancel).toHaveBeenCalledOnce();
});
