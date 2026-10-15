import {expect,it} from "vitest";
import {createEmptyHarnessDesign,parseHarnessDesignDocument,wireEndpointE4Anchor,type HarnessDesignDocument} from "./model";
import {createJoiningPipe,joiningPipeExitPoint} from "./physical-joining-pipes";
import {joiningPipeDisplaySamples,joiningPipeMemberControls} from "./physical-joining-pipe-projection";
import {applyEditorCommand} from "./commands";
import {drawingRouteHitPoints} from "./drawing-route-path";
import {createEditorHistory,executeEditorCommand,undoEditorCommand,redoEditorCommand} from "./history";
import {physicalFixture} from "./physical-topology-fixture";
import {joiningPipeExitVector} from "./physical-joining-pipes";
import {physicalWireDisplay} from "./physical-wire-geometry";
import {physicalTopologyScene} from "./physical-scene";
import {projectOntoPolyline} from "./physical-coverings";

function fixture(reverse=false,persisted=false,angle=0):HarnessDesignDocument {
 const blank=createEmptyHarnessDesign();
 const base:HarnessDesignDocument={...blank,drawingDocuments:{tables:[],leaders:[],bomOrder:[],bendRadius:24},physicalTopology:{snap:false,
   nodes:[{id:"a",position:{x:0,y:0}},{id:"b",position:{x:1000,y:0}},{id:"c",position:{x:0,y:80}},{id:"d",position:{x:1000,y:80}}],
   segments:[{id:"p0",from:"a",to:"b",path:{kind:"polyline",points:[]}},{id:"p1",from:reverse?"d":"c",to:reverse?"c":"d",path:{kind:"polyline",points:[]}}],routes:[]}};
 const initial=createJoiningPipe(base,[["p0"],["p1"]],"op");
 const op={...initial,enterLength:100,exitLength:100,members:initial.members.map((member,index)=>index===1&&persisted?{...member,
   enterOuter:{x:reverse?850:150,y:80},exitOuter:{x:reverse?150:850,y:80},authoredBendRegions:[]}:member)};
 const document={...base,physicalTopology:{...base.physicalTopology!,joiningPipes:[op],
   coverings:[{id:"cover",name:"Оболочка",width:0,color:"#334455",lengthMm:520,spans:[{segmentId:"op",from:-.3,to:1.3}]}]}};
 const rotate=(point:{x:number;y:number})=>({x:(point.x*Math.cos(angle)-point.y*Math.sin(angle))||0,y:(point.x*Math.sin(angle)+point.y*Math.cos(angle))||0});
 return angle===0?document:{...document,physicalTopology:{...document.physicalTopology,nodes:document.physicalTopology.nodes.map(node=>({...node,position:rotate(node.position)})),
  joiningPipes:[{...op,start:rotate(op.start),end:rotate(op.end),path:{...op.path,points:op.path.points.map(rotate)},members:op.members.map(member=>({...member,
   ...(member.enterOuter?{enterOuter:rotate(member.enterOuter)}:{}),...(member.exitOuter?{exitOuter:rotate(member.exitOuter)}:{})}))}]}};
}

it.each([0,Math.PI/4,Math.PI/2,Math.PI])("moves automatic transition supports out of an extending shared lead (angle=%s)",angle=>{
 for(const reverse of [false,true])for(const persisted of [false,true])for(const side of ["from","to"] as const){
  const source=fixture(reverse,persisted,angle);
  let history=createEditorHistory(source);
  for(const length of [100,180,220,260,220,180,100]){
   const op=history.present.physicalTopology!.joiningPipes![0]!;
   const edge=side==="from"?op.start:op.end,offset=side==="from"?-length:length;
   const position={x:edge.x+Math.cos(angle)*offset,y:edge.y+Math.sin(angle)*offset};
   history=executeEditorCommand(history,{type:"update-joining-pipe-exit",pipeId:"op",side,position});
   const next=history.present;
   const actualExit=joiningPipeExitPoint(next.physicalTopology!.joiningPipes![0]!,side);
   expect(actualExit.x).toBeCloseTo(position.x,8);expect(actualExit.y).toBeCloseTo(position.y,8);
   for(const id of ["p0","p1"]){
    const samples=joiningPipeDisplaySamples(next,id)!;
    expect(samples.length).toBeGreaterThan(3);
    const direction=id==="p1"&&reverse?-1:1;
    for(const points of [samples.map(s=>s.point),drawingRouteHitPoints(samples.map(s=>s.point),24)]){
     for(let i=1;i<points.length;i++)expect(((points[i]!.x-points[i-1]!.x)*Math.cos(angle)+(points[i]!.y-points[i-1]!.y)*Math.sin(angle))*direction,
       `${id}, ${side}, length=${length}, persisted=${persisted}, vertex=${i}`).toBeGreaterThanOrEqual(-1e-6);
    }
   }
   expect(next.physicalTopology!.segments).toEqual(source.physicalTopology!.segments);
   expect(next.physicalTopology!.routes).toEqual(source.physicalTopology!.routes);
   expect(next.physicalTopology!.coverings![0]!.lengthMm).toBe(520);
   expect(parseHarnessDesignDocument(JSON.parse(JSON.stringify(next))).physicalTopology).toEqual(next.physicalTopology);
  }
  const restored=joiningPipeDisplaySamples(history.present,"p1")!,initial=joiningPipeDisplaySamples(source,"p1")!;
  expect(restored).toHaveLength(initial.length);
  for(let index=0;index<initial.length;index++){
   expect(restored[index]!.fraction).toBeCloseTo(initial[index]!.fraction,10);
   expect(restored[index]!.point.x).toBeCloseTo(initial[index]!.point.x,8);
   expect(restored[index]!.point.y).toBeCloseTo(initial[index]!.point.y,8);
  }
  expect(redoEditorCommand(undoEditorCommand(history)).present).toEqual(history.present);
 }
});

it("moves the derived midpoint before the new shared exit instead of keeping the former obstruction",()=>{
 const source=fixture(),before=joiningPipeMemberControls(source,"p1")!;
 const old=before.find(control=>control.boundary==="outerEnter")!.point;
 const op=source.physicalTopology!.joiningPipes![0]!;
 const moved=applyEditorCommand(source,{type:"update-joining-pipe-exit",pipeId:"op",side:"from",position:{x:op.start.x-260,y:op.start.y}});
 const controls=joiningPipeMemberControls(moved,"p1")!,outer=controls.find(control=>control.boundary==="outerEnter")!.point;
 const lead=controls.find(control=>control.lead==="enter")!.point;
 expect(outer.x).toBeLessThan(old.x);
 expect(outer.x).toBeLessThanOrEqual(lead.x+1e-7);
 const beforeMidpoint=physicalTopologyScene(source).find(o=>o.id==="p1")!.pipe!.midpoints![0]!;
 const scene=physicalTopologyScene(moved).find(o=>o.id==="p1")!,midpoint=scene.pipe!.midpoints![0]!;
 expect(midpoint.x).toBeLessThan(beforeMidpoint.x);
 expect(projectOntoPolyline(drawingRouteHitPoints(scene.points!,scene.routeRadius),midpoint).distance).toBeLessThan(1e-6);
});

it("keeps live wires, coverings and assigned lengths unchanged through shared exit moves",()=>{
 const d=parseHarnessDesignDocument(JSON.parse(JSON.stringify(physicalFixture())));
 const before={...d,wires:d.wires.map(wire=>({...wire,lengthMm:720}))};
 const op=createJoiningPipe(before,[["S1"],["S2"]],"op");
 const source={...before,physicalTopology:{...before.physicalTopology!,joiningPipes:[op],
   coverings:[{id:"coat",name:"Оболочка",width:0,color:"#334455",lengthMm:520,spans:[{segmentId:"op",from:-.3,to:1.3}]}]}};
 let document:HarnessDesignDocument=source;
 for(const length of [80,160,240,320]){
  const pipe=document.physicalTopology!.joiningPipes![0]!,vector=joiningPipeExitVector(pipe,"from");
  document=applyEditorCommand(document,{type:"update-joining-pipe-exit",pipeId:"op",side:"from",position:{x:pipe.start.x+vector.x*length,y:pipe.start.y+vector.y*length}});
  expect(document.wires).toEqual(source.wires);
  expect(document.physicalTopology!.segments).toEqual(source.physicalTopology!.segments);
  expect(document.physicalTopology!.routes).toEqual(source.physicalTopology!.routes);
  expect(document.physicalTopology!.coverings).toEqual(source.physicalTopology!.coverings);
  for(const id of ["S1","S2"]){
   const controls=joiningPipeMemberControls(document,id)!;
   const outer=controls.find(c=>c.boundary==="outerEnter")!.point,lead=controls.find(c=>c.lead==="enter")!.point;
   expect((outer.x-lead.x)*vector.x+(outer.y-lead.y)*vector.y).toBeGreaterThanOrEqual(-1e-7);
  }
  for(const wire of document.wires){
   const display=physicalWireDisplay(document,wire.id,wireEndpointE4Anchor(document,wire.from)!.position,wireEndpointE4Anchor(document,wire.to)!.position);
   expect(display!.selectionPaths.flat().length,wire.id).toBeGreaterThan(1);
   expect(display!.selectionPaths.flat().every(point=>Number.isFinite(point.x)&&Number.isFinite(point.y))).toBe(true);
  }
 }
});
