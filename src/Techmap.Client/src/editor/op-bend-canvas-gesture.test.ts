import {afterEach,beforeEach,expect,it,vi} from "vitest";
import type {ReactElement} from "react";
import {CanvasViewport} from "./CanvasViewport";
import {createEmptyHarnessDesign,type HarnessDesignDocument} from "./model";
import {createJoiningPipe} from "./physical-joining-pipes";
import {physicalTopologyScene} from "./physical-scene";
import {resolvePhysicalRoutePointCommand} from "./physical-route-point-command";
import {applyEditorCommand} from "./commands";

vi.mock("react",async original=>({...await original<typeof import("react")>(),
  useRef:(current:unknown)=>({current}),useState:(value:unknown)=>[value,vi.fn()],
  useMemo:(factory:()=>unknown)=>factory(),useEffect:vi.fn(),
}));
beforeEach(()=>vi.stubGlobal("window",{addEventListener:vi.fn(),removeEventListener:vi.fn()}));
afterEach(()=>vi.unstubAllGlobals());

it.each([[24,.6],[24,2],[160,.6],[160,2]])("drags and deletes the painted OP grip at radius %s and zoom %s",(radius,zoom)=>{
  const d=createEmptyHarnessDesign();
  const base:HarnessDesignDocument={...d,drawingDocuments:{tables:[],leaders:[],bomOrder:[],bendRadius:radius},physicalTopology:{snap:false,
    nodes:[{id:"a",position:{x:0,y:0}},{id:"b",position:{x:600,y:0}},{id:"c",position:{x:0,y:100}},{id:"d",position:{x:600,y:100}}],
    segments:[{id:"p0",from:"a",to:"b",path:{kind:"polyline",points:[]}},{id:"p1",from:"c",to:"d",path:{kind:"polyline",points:[]}}],routes:[]}};
  const initial=createJoiningPipe(base,[["p0"],["p1"]],"op"),op={...initial,path:{kind:"polyline" as const,points:[{x:300,y:-180}]}};
  const source={...base,physicalTopology:{...base.physicalTopology!,joiningPipes:[op]}},objects=physicalTopologyScene(source);
  const object=objects.find(o=>o.id==="op")!,grip=object.pipe!.handles[0]!,sharp=op.path.points[0]!;
  const select=vi.fn(),remove=vi.fn(),results:HarnessDesignDocument[]=[];
  const update=(id:string,index:number,point:{x:number;y:number}|null,mode:"carry"|"adjacent"="carry",insert=false)=>{
    if(!point)return;const command=resolvePhysicalRoutePointCommand(source,id,index,point,mode,insert);
    expect(command).not.toBeNull();results.push(applyEditorCommand(source,command!));
  };
  const tree=CanvasViewport({view:"drawing",tool:"select",camera:{zoom,offsetX:40,offsetY:240},objects,
    layers:base.views.drawing.layers.map(layer=>({...layer,label:layer.name})),selectedObjectId:"op",onObjectSelect:select,
    onCatalogDrop:vi.fn(),onCameraChange:vi.fn(),onWireRoutePointPreview:update,onWireRoutePointMove:update,onWireRoutePointRemove:remove});
  const canvas=(tree.props as {children:ReactElement[]}).children.find(node=>node?.type==="canvas")!;
  const handlers=canvas.props as Record<string,(event:unknown)=>void>;
  let captured=false;const target={setPointerCapture:vi.fn(()=>captured=true),hasPointerCapture:()=>captured,releasePointerCapture:()=>captured=false};
  const start={pointerId:1,button:0,shiftKey:true,ctrlKey:false,clientX:grip.x*zoom+40,clientY:grip.y*zoom+240,currentTarget:target,preventDefault:vi.fn(),stopPropagation:vi.fn()};
  handlers.onPointerDown!(start);
  const end={...start,clientX:start.clientX+24*zoom,clientY:start.clientY+17*zoom};
  handlers.onPointerMove!(end);handlers.onPointerUp!(end);
  expect(select).toHaveBeenCalledWith("op",false);
  expect(target.setPointerCapture).toHaveBeenCalledWith(1);
  expect(results.length).toBeGreaterThanOrEqual(2);
  expect(results.at(-1)).toEqual(results[0]);
  const moved=results.at(-1)!.physicalTopology!.joiningPipes![0]!.path.points[0]!;
  expect(moved.x).toBeCloseTo(sharp.x+24,8);expect(moved.y).toBeCloseTo(sharp.y+17,8);
  handlers.onDoubleClick!(start);
  expect(remove).toHaveBeenCalledExactlyOnceWith("op",0);
});
