import {expect,it} from "vitest";
import {createEmptyHarnessDesign,parseHarnessDesignDocument,type HarnessDesignDocument} from "./model";
import {createJoiningPipe} from "./physical-joining-pipes";
import {physicalTopologyScene} from "./physical-scene";
import {drawingRouteHitPoints} from "./drawing-route-path";
import {projectOntoPolyline} from "./physical-coverings";
import {hitTestWireRoutePoint,numberedPipeBendHandles} from "./CanvasViewport";
import {resolvePhysicalRoutePointCommand} from "./physical-route-point-command";
import {applyEditorCommand} from "./commands";
import {createEditorHistory,executeEditorCommand,undoEditorCommand,redoEditorCommand} from "./history";
import {physicalFixture} from "./physical-topology-fixture";

function fixture(radius:number,reverse=false):HarnessDesignDocument {
  const d=createEmptyHarnessDesign();
  const bends=[{x:30,y:220},{x:100,y:100},{x:250,y:0},{x:400,y:200},{x:550,y:220}];
  const parallel=bends.map(point=>({x:point.x,y:point.y+60}));
  const source:HarnessDesignDocument={...d,drawingDocuments:{tables:[],leaders:[],bomOrder:[],bendRadius:radius},physicalTopology:{snap:true,nodes:[
    {id:"a",position:{x:0,y:240}},{id:"b",position:{x:600,y:240}},
    {id:"c",position:{x:0,y:300}},{id:"d",position:{x:600,y:300}},
  ],segments:[
    {id:"p0",from:"a",to:"b",path:{kind:"polyline",points:bends}},
    {id:"p1",from:reverse?"d":"c",to:reverse?"c":"d",path:{kind:"polyline",points:reverse?[...parallel].reverse():parallel}},
  ],routes:[]}};
  const op=createJoiningPipe(source,[["p0"],["p1"]],"op");
  return {...source,physicalTopology:{...source.physicalTopology!,joiningPipes:[op]}};
}

it.each([0,24,160])("keeps all numbered OP/member grips on the painted route at radius %s",radius=>{
  for(const reverse of [false,true])for(const object of physicalTopologyScene(fixture(radius,reverse)).filter(o=>o.kind==="physical-segment")){
    const painted=drawingRouteHitPoints(object.points!,object.routeRadius);
    expect(numberedPipeBendHandles(object).length).toBeGreaterThan(0);
    for(const index of numberedPipeBendHandles(object)){
      const point=object.pipe!.handles[index]!;
      expect(projectOntoPolyline(painted,point).distance,`${object.id}/${index}/${reverse}`).toBeLessThan(.05);
    }
  }
});

it("does not resurrect a numbered outer transition after deletion",()=>{
  const source=fixture(24);
  const document=applyEditorCommand(source,{type:"update-joining-pipe-member-boundary",pipeId:"op",memberIndex:1,boundary:"outerEnter",origin:{x:0,y:0},position:{x:70,y:100}});
  const object=physicalTopologyScene(document).find(o=>o.id==="p1")!;
  const boundary=object.pipe!.joiningBoundaryHandles!.find(h=>h.boundary==="outerEnter")!;
  const point=object.pipe!.handles[boundary.index]!;
  const command=resolvePhysicalRoutePointCommand(document,object.id,boundary.index,{x:point.x+10,y:point.y-10},"adjacent");
  expect(command?.type).toBe("update-joining-pipe-member-boundary");
  const removed=applyEditorCommand(document,{type:"clear-joining-pipe-member-boundary",pipeId:"op",memberIndex:boundary.memberIndex,boundary:"outerEnter"});
  const next=physicalTopologyScene(removed).find(o=>o.id===object.id)!;
  expect(next.pipe!.joiningBoundaryHandles!.some(h=>h.boundary==="outerEnter"&&!next.pipe!.controlledHandles!.includes(h.index))).toBe(false);
  const loaded=parseHarnessDesignDocument(JSON.parse(JSON.stringify(removed)));
  expect(physicalTopologyScene(loaded)).toEqual(physicalTopologyScene(removed));
  expect(removed.physicalTopology!.segments).toEqual(source.physicalTopology!.segments);
});

it.each(["op","p0","p1"])("uses the displayed grip delta for %s and preserves Undo/Redo and reload",id=>{
  const source=fixture(160,true),object=physicalTopologyScene(source).find(o=>o.id===id)!;
  const index=numberedPipeBendHandles(object)[0]!;
  expect(index).toBeDefined();
  const grip=object.pipe!.handles[index]!,sharp=object.pipe!.handleOrigins![index]!;
  expect(hitTestWireRoutePoint(object,grip,100)).toBe(index);
  expect(resolvePhysicalRoutePointCommand(source,id,index,grip,"adjacent")).toBeNull();
  const delta={x:37,y:-23};
  const command=resolvePhysicalRoutePointCommand(source,id,index,{x:grip.x+delta.x,y:grip.y+delta.y},"adjacent")!;
  expect(command).not.toBeNull();
  const history=executeEditorCommand(createEditorHistory(source),command);
  const moved=history.present;
  const next=physicalTopologyScene(moved).find(o=>o.id===id)!;
  expect(next.pipe!.handleOrigins!.some(point=>Math.hypot(point.x-sharp.x-delta.x,point.y-sharp.y-delta.y)<1e-6)).toBe(true);
  for(const handle of numberedPipeBendHandles(next)){
    const point=next.pipe!.handles[handle]!;
    expect(projectOntoPolyline(drawingRouteHitPoints(next.points!,next.routeRadius),point).distance).toBeLessThan(1e-6);
  }
  expect(history.past).toHaveLength(1);
  const undone=undoEditorCommand(history);
  expect(undone.present).toBe(source);
  expect(redoEditorCommand(undone).present).toEqual(moved);
  expect(parseHarnessDesignDocument(JSON.parse(JSON.stringify(moved))).physicalTopology).toEqual(moved.physicalTopology);
});

it.each([false,true])("keeps reversed-member outer stations near their own source endpoints (reverse=%s)",reverse=>{
  const document=fixture(24,reverse),scene=physicalTopologyScene(document).find(o=>o.id==="p1")!;
  const start=scene.points![0]!,end=scene.points!.at(-1)!;
  const enter=scene.pipe!.joiningBoundaryHandles!.find(h=>h.boundary==="outerEnter")!;
  const exit=scene.pipe!.joiningBoundaryHandles!.find(h=>h.boundary==="outerExit")!;
  const a=scene.pipe!.handleOrigins![enter.index]!,b=scene.pipe!.handleOrigins![exit.index]!;
  expect(Math.hypot(a.x-start.x,a.y-start.y)).toBeLessThan(Math.hypot(a.x-end.x,a.y-end.y));
  expect(Math.hypot(b.x-end.x,b.y-end.y)).toBeLessThan(Math.hypot(b.x-start.x,b.y-start.y));
});

it("edits and deletes automatic member corners without changing wires, routes or assigned lengths",()=>{
  const d=parseHarnessDesignDocument(JSON.parse(JSON.stringify(physicalFixture())));
  const withLengths={...d,wires:d.wires.map(wire=>({...wire,lengthMm:720}))};
  const op=createJoiningPipe(withLengths,[["S1"],["S2"]],"op");
  const source={...withLengths,physicalTopology:{...withLengths.physicalTopology!,joiningPipes:[op],
    coverings:[{id:"coat",name:"Оболочка",color:"#556677",width:12,lengthMm:520,spans:[{segmentId:"op",from:0,to:1}]}]}};
  const scene=physicalTopologyScene(source).find(o=>o.id==="S1")!;
  const index=numberedPipeBendHandles(scene).find(i=>scene.pipe!.authoredHandleIndices![i]!>0)!;
  expect(index).toBeDefined();
  const grip=scene.pipe!.handles[index]!;
  const command=resolvePhysicalRoutePointCommand(source,"S1",index,{x:grip.x+30,y:grip.y-40},"adjacent")!;
  const moved=applyEditorCommand(source,command);
  const removed=applyEditorCommand(moved,{type:"remove-physical-bend",segmentId:"S1",index:scene.pipe!.authoredHandleIndices![index]!-1});
  for(const document of [moved,removed,parseHarnessDesignDocument(JSON.parse(JSON.stringify(removed)))]){
    expect(document.wires).toEqual(source.wires);
    expect(document.physicalTopology!.routes).toEqual(source.physicalTopology!.routes);
    expect(document.physicalTopology!.coverings![0]!.lengthMm).toBe(520);
    const member=physicalTopologyScene(document).find(o=>o.id==="S1")!;
    for(const i of numberedPipeBendHandles(member))expect(projectOntoPolyline(drawingRouteHitPoints(member.points!,member.routeRadius),member.pipe!.handles[i]!).distance).toBeLessThan(1e-6);
  }
});
