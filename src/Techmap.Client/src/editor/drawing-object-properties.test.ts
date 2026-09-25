import {expect,it,vi,afterEach} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {createElement,isValidElement,type ReactElement,type ReactNode} from "react";
import {PhysicalTopologyPanel} from "./PhysicalTopologyPanel";
import {PhysicalCoveringsPanel} from "./PhysicalCoveringsPanel";
import {DrawingObjectProperties} from "./DrawingObjectProperties";
import {CanvasObjectHint,CANVAS_HINT_DELAY} from "./CanvasObjectHint";
import {canvasPopoverPosition,CanvasObjectPopover} from "./CanvasObjectPopover";
import {physicalFixture} from "./physical-topology-fixture";
import {applyEditorCommand,type EditorCommand} from "./commands";

const hooks=vi.hoisted(()=>({effects:[] as (()=>unknown)[],set:vi.fn()}));
vi.mock("react",async original=>({...await original<typeof import("react")>(),useRef:(current:unknown)=>({current}),useState:(value:unknown)=>[value,hooks.set],useEffect:(effect:()=>unknown)=>hooks.effects.push(effect),useLayoutEffect:()=>{}}));
afterEach(()=>{vi.useRealTimers();hooks.effects=[];hooks.set.mockClear();});
function elements(node:ReactNode):ReactElement<Record<string,any>>[]{
  if(Array.isArray(node))return node.flatMap(elements);
  if(!isValidElement<Record<string,any>>(node))return [];
  return [node,...elements(node.props.children)];
}
it("hides topology inventories on the right but keeps creation and routing actions",()=>{
  const markup=renderToStaticMarkup(createElement(PhysicalTopologyPanel,{mode:"actions",document:physicalFixture(),selectedIds:["S0"],selectedId:"S0",onChange:()=>true,onSelect:()=>{}}));
  expect(markup).toContain("Распределить по Э4");expect(markup).toContain("Ещё выход +");
  expect(markup).not.toContain('<table');expect(markup).not.toContain('Ширина канала');expect(markup).not.toContain('Ручной маршрут проводов');
});
it("edits a pipe through its existing command without exposing unrelated pipe rows",()=>{
  const d=physicalFixture();let changed=d;
  const tree=PhysicalTopologyPanel({mode:"object",document:d,selectedId:"S0",selectedIds:["S0"],onSelect:vi.fn(),onChange:topology=>{changed=applyEditorCommand(d,{type:"set-physical-topology",topology});return true;}});
  const field=elements(tree).find(e=>e.props['aria-label']==="Ширина канала")!;
  field.props.onValueChange(1.5);
  expect(changed.physicalTopology!.segments[0]!.width).toBe(1.5);
  expect(changed.physicalTopology!.segments.slice(1)).toEqual(d.physicalTopology!.segments.slice(1));
  expect(changed.wires).toEqual(d.wires);
  expect(elements(tree).some(e=>e.type==="table")).toBe(false);
});
it("moves only the chosen coating behind the others",()=>{
  const d=physicalFixture(),cover=(id:string)=>({id,name:id,width:0,color:"#123456",lengthMm:null,spans:[{segmentId:"S0",from:0,to:1}]});
  const t={...d.physicalTopology!,coverings:[cover("a"),cover("b"),cover("c")]};let changed=t;
  const tree=PhysicalCoveringsPanel({compact:true,document:{...d,physicalTopology:t},topology:t,selectedIds:["b"],onReveal:vi.fn(),onChange:value=>{changed=value as typeof t;return true;}});
  elements(tree).find(e=>e.type==="button"&&e.props["aria-label"]==="На задний план")!.props.onClick();
  expect(changed.coverings.map(c=>c.id)).toEqual(["b","a","c"]);expect(changed.segments).toBe(t.segments);
});
it("keeps selected wires for manual routes and creates a sleeve for all selected pipes",()=>{
  const d=physicalFixture(),command=vi.fn<(command:EditorCommand)=>boolean>(()=>true);
  const wireTree=DrawingObjectProperties({document:d,objectId:"W1",selectedIds:["W1","W2"],instances:[],onCommand:command,onSelect:vi.fn()});
  expect(elements(wireTree).find(e=>e.type===PhysicalTopologyPanel)!.props.selectedIds).toEqual(["W1","W2"]);
  const pipeTree=DrawingObjectProperties({document:d,objectId:"S0",selectedIds:["S0","S2"],instances:[],onCommand:command,onSelect:vi.fn()});
  elements(pipeTree).find(e=>e.type==="button"&&e.props.children==="Оболочка на выделенные пайпы")!.props.onClick();
  const changed=applyEditorCommand(d,command.mock.calls[0]![0]);
  expect(changed.physicalTopology!.coverings![0]!.spans.map(s=>s.segmentId)).toEqual(["S0","S2"]);
});
it("does not enable library drawing commands for a free connector",()=>{
  const tree=DrawingObjectProperties({document:physicalFixture(),objectId:"A",selectedIds:["A"],instances:[],onCommand:vi.fn(),onSelect:vi.fn()});
  expect(elements(tree).filter(e=>typeof e.props.onChange==="function").every(e=>e.props.disabled===true)).toBe(true);
});
it("keeps the popup inside viewport edges",()=>{
  expect(canvasPopoverPosition(1200,700,350,400,1280,720)).toEqual({left:922,top:312});
  expect(canvasPopoverPosition(-50,-20,350,400,1280,720)).toEqual({left:8,top:8});
});
it("waits more than one second before showing a hint and cancels a departed target",()=>{
  vi.useFakeTimers();const target={id:"S0",label:"S1",x:10,y:20};
  CanvasObjectHint({target});const cleanup=hooks.effects[0]!() as ()=>void;
  hooks.set.mockClear();vi.advanceTimersByTime(1000);expect(hooks.set).not.toHaveBeenCalled();
  vi.advanceTimersByTime(CANVAS_HINT_DELAY-1000);expect(hooks.set).toHaveBeenCalledExactlyOnceWith(target);
  cleanup();hooks.set.mockClear();const cancel=hooks.effects[0]!() as ()=>void;cancel();hooks.set.mockClear();
  vi.advanceTimersByTime(CANVAS_HINT_DELAY+1);expect(hooks.set).not.toHaveBeenCalled();
});

it("does not dismiss the property editor for a bubbled nested hint toggle",()=>{
 const close=vi.fn(),tree=CanvasObjectPopover({x:0,y:0,label:"Properties",children:null,onClose:close});
 expect(tree.props.popover).toBe("manual");
 const parent={},hint={};tree.props.onToggle({target:hint,currentTarget:parent,newState:"closed"});expect(close).not.toHaveBeenCalled();
 tree.props.onToggle({target:parent,currentTarget:parent,newState:"closed"});expect(close).toHaveBeenCalledOnce();
});
