import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { CanvasViewport } from "./CanvasViewport";
import type { EditorSceneObject } from "./editor-types";

// Exercise the actual event handlers without a browser renderer. Effects install
// the real Escape listener; pointer capture and native events are modeled below.
const hooks=vi.hoisted(()=>({effects:[] as (()=>unknown)[], states:[] as unknown[], index:0}));
vi.mock("react",async importOriginal=>({
  ...await importOriginal<typeof import("react")>(),
  useRef:(current:unknown)=>({current}),
  useState:(value:unknown)=>{const index=hooks.index++;if(!(index in hooks.states))hooks.states[index]=typeof value==="function"?value():value;return [hooks.states[index],(next:unknown)=>{hooks.states[index]=next;}];},
  useMemo:(factory:()=>unknown)=>factory(),
  useEffect:(effect:()=>unknown)=>{hooks.effects.push(effect);},
}));

const connector:EditorSceneObject={id:"X",kind:"connector",layerId:"connectors",label:"X",x:100,y:80,width:118,height:100,color:"#222",metadata:{view:"e4",orientation:"right",rows:"[]"}};
let keydown:(event:{key:string})=>void;
beforeEach(()=>{
  hooks.effects=[];
  hooks.states=[];hooks.index=0;
  vi.stubGlobal("window",{addEventListener:(type:string,fn:typeof keydown)=>{if(type==="keydown")keydown=fn;},removeEventListener:vi.fn()});
});

it.each([110,500])('isolates the full canvas selection from a right click at x=%s',x=>{
  const isolate=vi.fn(),select=vi.fn(),move=vi.fn();
  const second={...connector,id:'Y',x:300};
  const props={view:'drawing' as const,tool:'select' as const,camera:{zoom:1,offsetX:0,offsetY:0},objects:[connector,second],layers:[{id:'connectors',label:'Соединители',visible:true,locked:false}],selectedObjectId:'X',selectedObjectIds:['X','Y'],onObjectsIsolate:isolate,onObjectSelect:select,onObjectMove:move,onCatalogDrop:vi.fn(),onCameraChange:vi.fn()};
  const render=()=>{hooks.index=0;return CanvasViewport(props);};
  const tree=render();
  const canvas=(tree.props as {children:ReactElement[]}).children.find(c=>c?.type==='canvas')!;
  const event={button:2,clientX:x,clientY:90,preventDefault:vi.fn()};
  (canvas.props as any).onPointerDown(event);
  (canvas.props as any).onContextMenu(event);
  expect(select).not.toHaveBeenCalled();
  const findButton=(node:any):any=>{if(!node||typeof node!=='object')return undefined;if(node.type==='button'&&node.props.children==='Изолировать')return node;return [node.props?.children].flat(Infinity).map(findButton).find(Boolean);};
  const button=findButton(render());
  expect(button).toBeDefined();
  button.props.onClick();
  expect(isolate).toHaveBeenCalledExactlyOnceWith(['X','Y']);
  expect(move).not.toHaveBeenCalled();
});

it('does not offer isolation for service geometry alone', () => {
  const node: EditorSceneObject = { ...connector, id: 'N', kind: 'physical-node', label: 'Выход', port: { direction: null } };
  const isolate = vi.fn();
  const props = { view: 'drawing' as const, tool: 'select' as const, camera: { zoom: 1, offsetX: 0, offsetY: 0 }, objects: [node], layers: [{ id: 'connectors', label: 'Соединители', visible: true, locked: false }], selectedObjectId: 'N', selectedObjectIds: ['N'], onObjectsIsolate: isolate, onObjectSelect: vi.fn(), onCatalogDrop: vi.fn(), onCameraChange: vi.fn() };
  const render = () => { hooks.index = 0; return CanvasViewport(props); };
  const tree = render();
  const canvas = (tree.props as { children: ReactElement[] }).children.find(child => child?.type === 'canvas')!;
  (canvas.props as any).onContextMenu({ clientX: 110, clientY: 90, preventDefault: vi.fn() });
  expect(JSON.stringify(render())).not.toContain('Изолировать');
  expect(isolate).not.toHaveBeenCalled();
});
afterEach(()=>vi.unstubAllGlobals());

it('opens the paired wire menu at its free endpoint despite a truncated painted stroke and overlapping dimension',()=>{
 const action=vi.fn(),select=vi.fn();
 const wire:EditorSceneObject={id:'W1',kind:'wire',layerId:'wires',label:'W1',x:0,y:0,width:0,height:0,color:'#222',points:[{x:20,y:50},{x:200,y:50}],visibleWireStrokes:[{points:[{x:20,y:50},{x:150,y:50}],width:2}],metadata:{detachedDrawing:'true',freeTo:'true',drawingPairId:'pair',drawingPairWireIds:JSON.stringify(['W1','W2'])}};
 const other:EditorSceneObject={...wire,id:'W2',points:[{x:20,y:70},{x:200,y:70}],visibleWireStrokes:[]};
 const dimension:EditorSceneObject={id:'D',kind:'dimension',layerId:'dimensions',label:'180',x:190,y:40,width:20,height:20,color:'#333',points:[{x:190,y:50},{x:210,y:50}]};
 const props={view:'drawing' as const,tool:'select' as const,camera:{zoom:1,offsetX:0,offsetY:0},objects:[wire,other,dimension],layers:[{id:'dimensions',label:'Размеры',visible:true,locked:false},{id:'wires',label:'Провода',visible:true,locked:false}],selectedObjectId:'W1',selectedObjectIds:['W1'],onObjectSelect:select,onCatalogDrop:vi.fn(),onCameraChange:vi.fn(),onDetachedPairAction:action};
 const render=()=>{hooks.index=0;return CanvasViewport(props);};
 const canvas=(render().props as {children:ReactElement[]}).children.find(c=>c?.type==='canvas')!;
 (canvas.props as any).onContextMenu({clientX:200,clientY:50,preventDefault:vi.fn()});
 const find=(node:any):any=>{if(!node||typeof node!=='object')return undefined;if(node.type==='button'&&node.props.children==='Распрямить пару')return node;return [node.props?.children].flat(Infinity).map(find).find(Boolean);};
 const button=find(render());
 expect(button).toBeDefined();button.props.onClick();
 expect(action).toHaveBeenCalledExactlyOnceWith(['W1','W2'],'straighten');
 expect(select).not.toHaveBeenCalled();
});

it.each([false,true])('inserts a detached midpoint with independent anchors and Escape=%s rollback',cancel=>{
 const move=vi.fn(),preview=vi.fn();
 const points=[{x:20,y:50},{x:200,y:50}];
 const wire:EditorSceneObject={id:'W',kind:'wire',layerId:'wires',label:'W',x:0,y:0,width:0,height:0,color:'#222',points,metadata:{detachedDrawing:'true'}};
 const tree=CanvasViewport({view:'drawing',tool:'select',camera:{zoom:1,offsetX:0,offsetY:0},objects:[wire],layers:[{id:'wires',label:'Провода',visible:true,locked:false}],selectedObjectId:'W',onObjectSelect:vi.fn(),onCatalogDrop:vi.fn(),onCameraChange:vi.fn(),onWireRoutePointMove:move,onWireRoutePointPreview:preview});
 hooks.effects.forEach(effect=>effect());
 const canvas=(tree.props as {children:ReactElement[]}).children.find(c=>c?.type==='canvas')!;
 const h=canvas.props as Record<string,(event:any)=>void>;
 const target={style:{cursor:''},setPointerCapture:vi.fn(),hasPointerCapture:()=>true,releasePointerCapture:vi.fn()};
 const e={pointerId:1,button:0,clientX:110,clientY:50,currentTarget:target,preventDefault:vi.fn()};
 h.onPointerDown!(e);h.onPointerMove!({...e,clientY:80});
 expect(preview).toHaveBeenLastCalledWith('W',0,{x:110,y:80},'adjacent',true);
 if(cancel)keydown({key:'Escape'});
 h.onPointerUp!({...e,clientY:80});
 if(cancel)expect(move).not.toHaveBeenCalled();else expect(move).toHaveBeenCalledExactlyOnceWith('W',0,{x:110,y:80},'adjacent',true);
 expect(points).toEqual([{x:20,y:50},{x:200,y:50}]);
});

it.each([true,false])('only drags explicitly free drawing endpoints (free=%s)',free=>{
 const move=vi.fn(),preview=vi.fn();
 const wire:EditorSceneObject={id:'W',kind:'wire',layerId:'wires',label:'W',x:0,y:0,width:0,height:0,color:'#222',points:[{x:20,y:50},{x:200,y:50}],metadata:{freeFrom:String(free)}};
 const tree=CanvasViewport({view:'drawing',tool:'select',camera:{zoom:1,offsetX:0,offsetY:0},objects:[wire],layers:[{id:'wires',label:'Провода',visible:true,locked:false}],selectedObjectId:'W',onObjectSelect:vi.fn(),onCatalogDrop:vi.fn(),onCameraChange:vi.fn(),onFreeWireEndpointMove:move,onFreeWireEndpointPreview:preview});
 const canvas=(tree.props as {children:ReactElement[]}).children.find(c=>c?.type==='canvas')!;
 const h=canvas.props as Record<string,(event:any)=>void>;
 const target={style:{cursor:''},setPointerCapture:vi.fn(),hasPointerCapture:()=>true,releasePointerCapture:vi.fn()};
 const e={pointerId:1,button:0,clientX:20,clientY:50,currentTarget:target,preventDefault:vi.fn()};
 h.onPointerDown!(e);h.onPointerMove!({...e,clientX:35,clientY:70});h.onPointerUp!({...e,clientX:35,clientY:70});
 if(free){expect(move).toHaveBeenCalledExactlyOnceWith('W','from',{x:35,y:70});expect(preview).toHaveBeenLastCalledWith('W','from',null);}else expect(move).not.toHaveBeenCalled();
});

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
