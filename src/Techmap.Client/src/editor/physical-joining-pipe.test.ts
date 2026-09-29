import {describe,expect,it} from "vitest";
import {createEmptyHarnessDesign,type HarnessDesignDocument} from "./model";
import {createJoiningPipe,joiningPipePoints} from "./physical-joining-pipes";
import {joiningPipeDisplaySamples,joiningPipeMemberControls,joiningPipeTransitionHandles,joiningPipeWidth,projectJoiningPipePoint} from "./physical-joining-pipe-projection";
import {editJoiningPipeBend,moveJoiningPipe} from "./physical-joining-pipe-editing";
import {parsePhysicalTopology} from "./physical-topology-validation";
import {coveringScene} from "./covering-layout";
import {removePhysicalSegment} from "./physical-topology";
import {splitPhysicalSegment} from "./physical-topology";
import {physicalTopologyScene} from "./physical-scene";
import {applyEditorCommand} from "./commands";
import {parseHarnessDesignDocument} from "./model";
import {migrateJoiningPipes} from "./physical-joining-pipes";
import {beginJoiningPipe,toggleJoiningPipeMember,joiningPipeDraftTopology} from "./JoiningPipeEditor";
import {createEditorHistory,executeEditorCommand,undoEditorCommand} from "./history";
import {hitTestEditorScene,pipeMidpoints} from "./CanvasViewport";
import {coveringHit} from "./covering-renderer";
import {drawingRouteCommands} from "./drawing-route-path";

function fixture():HarnessDesignDocument {
 const d=createEmptyHarnessDesign();
 return {...d,physicalTopology:{snap:true,nodes:[
   {id:"a",position:{x:0,y:0}},{id:"b",position:{x:600,y:0}},{id:"c",position:{x:0,y:100}},{id:"d",position:{x:600,y:100}}],
   segments:[
    {id:"p0",from:"a",to:"b",path:{kind:"polyline",points:[]}},
    {id:"p1",from:"c",to:"d",path:{kind:"polyline",points:[]}}],routes:[]}};
}

describe("joining pipe hierarchy",()=>{
 it("owns an independent centreline and keeps members parallel inside it",()=>{
  const d=fixture(),op=createJoiningPipe(d,[["p0"],["p1"]],"op");
  const next={...d,physicalTopology:{...d.physicalTopology!,joiningPipes:[op]}};
  expect(op.start).toEqual({x:180,y:0});expect(op.end).toEqual({x:420,y:0});
  const inside0=projectJoiningPipePoint(next,"p0",.5,{x:300,y:0}),inside1=projectJoiningPipePoint(next,"p1",.5,{x:300,y:100});
  expect(inside0.x).toBe(300);expect(inside1.x).toBe(300);expect(inside0.y).toBeLessThan(inside1.y);
  expect(joiningPipeWidth(next,op)).toBeGreaterThan(0);
  expect(joiningPipePoints(op)).toEqual([{x:180,y:0},{x:420,y:0}]);
 });
it("moves an OP bend without changing members or electrical routes",()=>{
  const d=fixture(),op=createJoiningPipe(d,[["p0"],["p1"]],"op"),base={...d,physicalTopology:{...d.physicalTopology!,joiningPipes:[op]}};
  const moved={...base,physicalTopology:editJoiningPipeBend(base,"op",0,{x:300,y:80},"adjacent",true)};
  expect(moved.physicalTopology!.joiningPipes![0]!.path.points).toEqual([{x:300,y:80}]);
  expect(moved.physicalTopology!.segments).toEqual(base.physicalTopology!.segments);
  expect(moved.physicalTopology!.routes).toBe(base.physicalTopology!.routes);
  expect(projectJoiningPipePoint(moved,"p1",.5,{x:300,y:100}).y).toBeGreaterThan(75);
 });
 it("allows a covering to target OP and survives JSON validation",()=>{
  const d=fixture(),op=createJoiningPipe(d,[["p0"],["p1"]],"op"),next={...d,physicalTopology:{...d.physicalTopology!,joiningPipes:[op],coverings:[{id:"cover",name:"Термоусадка",width:0,color:"#334455",lengthMm:null,spans:[{segmentId:"op",from:0,to:1}]}]}};
  expect(coveringScene(next).find(c=>c.id==="cover")!.paths![0]).toEqual(joiningPipePoints(op));
  const loaded=JSON.parse(JSON.stringify(next));expect(parsePhysicalTopology(loaded.physicalTopology,loaded)!.joiningPipes![0]!.id).toBe("op");
 });
 it("removes an OP when fewer than two member pipes remain",()=>{
  const d=fixture(),op=createJoiningPipe(d,[["p0"],["p1"]],"op"),next={...d,physicalTopology:{...d.physicalTopology!,joiningPipes:[op]}};
  const removed=removePhysicalSegment(next,"p1");expect(removed.joiningPipes).toEqual([]);
 });
});

it("endpoints move freely in both axes and preserve connectors, routes and member paths",()=>{
 const d=fixture(),op=createJoiningPipe(d,[["p0"],["p1"]],"op"),base={...d,physicalTopology:{...d.physicalTopology!,joiningPipes:[op]}};
 const moved=applyEditorCommand(base,{type:"update-joining-pipe",pipeId:"op",start:{x:250,y:170},end:{x:500,y:230}});
 expect(moved.physicalTopology!.joiningPipes![0]!.start).toEqual({x:250,y:170});
 expect(moved.physicalTopology!.segments).toEqual(base.physicalTopology!.segments);expect(moved.connectors).toBe(base.connectors);expect(moved.wires).toBe(base.wires);
 const a=projectJoiningPipePoint(moved,"p0",.4,{x:240,y:0}),b=projectJoiningPipePoint(moved,"p0",.6,{x:360,y:0});
 expect((b.y-a.y)/(b.x-a.x)).toBeCloseTo(60/250,6);
 for(const id of ["p0","p1"]){const path=joiningPipeDisplaySamples(moved,id)!;expect(path[0]!.point).toEqual({x:0,y:id==="p0"?0:100});expect(path.at(-1)!.point).toEqual({x:600,y:id==="p0"?0:100});}
});
it("moves the complete OP axis and authored transition bends together",()=>{
 const d=fixture(),op=createJoiningPipe(d,[["p0"],["p1"]],"op"),withBend={...op,members:op.members.map((member,index)=>index===1?{...member,enterBend:{x:140,y:20},exitBend:{x:460,y:20}}:member),path:{kind:"polyline" as const,points:[{x:300,y:40}]}};
 const base={...d,physicalTopology:{...d.physicalTopology!,joiningPipes:[withBend]}},moved=moveJoiningPipe(base.physicalTopology!,"op",{x:25,y:-12}),next=moved.joiningPipes![0]!;
 expect(next.start).toEqual({x:205,y:-12});expect(next.end).toEqual({x:445,y:-12});expect(next.path.points).toEqual([{x:325,y:28}]);
 expect(next.members[1]!.enterBend).toEqual({x:165,y:8});expect(next.members[1]!.exitBend).toEqual({x:485,y:8});
 expect(moved.segments).toBe(base.physicalTopology!.segments);
});
it("keeps projected members inside a covering when the OP bends",()=>{
 const d=fixture(),op=createJoiningPipe(d,[["p0"],["p1"]],"op"),base={...d,physicalTopology:{...d.physicalTopology!,joiningPipes:[op],coverings:[{id:"cover",name:"Термоусадка",width:0,color:"#334455",lengthMm:null,spans:[{segmentId:"op",from:0,to:1}]}]}};
 const bent=applyEditorCommand(base,{type:"edit-joining-pipe-bend",pipeId:"op",index:0,position:{x:300,y:220},mode:"adjacent",insert:true});
 const shell=coveringScene(bent).find(object=>object.id==="cover")!,path=joiningPipeDisplaySamples(bent,"p0")!;
 expect(path.filter(sample=>sample.fraction>=.3&&sample.fraction<=.7).every(sample=>coveringHit(shell,sample.point,1e-6)!==null)).toBe(true);
});

it("exposes joining transitions as authored member handles",()=>{
 const d=fixture(),op=createJoiningPipe(d,[["p0"],["p1"]],"op"),base={...d,physicalTopology:{...d.physicalTopology!,joiningPipes:[op]}};
 const transitions=joiningPipeTransitionHandles(base,"p0");
 expect(transitions).toHaveLength(2);
 const member=physicalTopologyScene(base).find(object=>object.id==="p0")!;
 expect(member.pipe?.joiningTransitionHandles).toHaveLength(2);
 for(const transition of transitions)expect(member.pipe?.handles).toContainEqual(transition.point);
 expect(member.routeRadius).toBeGreaterThan(0);
 expect(drawingRouteCommands(member.points!,member.routeRadius).some(command=>command.kind==="arc")).toBe(true);
 const moved=applyEditorCommand(base,{type:"update-joining-pipe-member-bend",pipeId:"op",memberIndex:0,side:"enter",position:{x:150,y:-40}});
 expect(moved.physicalTopology!.joiningPipes![0]!.members[0]!.enterBend).toEqual({x:150,y:-40});
 expect(joiningPipeDisplaySamples(moved,"p0")!.some(sample=>Math.hypot(sample.point.x-150,sample.point.y+40)<1e-6)).toBe(true);
 const restored=parseHarnessDesignDocument(JSON.parse(JSON.stringify(moved)));
 expect(restored.physicalTopology!.joiningPipes![0]!.members[0]!.enterBend).toEqual({x:150,y:-40});
});

it("builds each member transition as connection to bend to connection with usable midpoints",()=>{
 const d=fixture(),op=createJoiningPipe(d,[["p0"],["p1"]],"op"),base={...d,physicalTopology:{...d.physicalTopology!,joiningPipes:[op]}};
 const controls=joiningPipeMemberControls(base,"p1")!;
 expect(controls).toHaveLength(6);
 expect(controls.filter(control=>control.connection)).toHaveLength(4);
 expect(controls.filter(control=>control.transition)).toHaveLength(2);
 expect(controls.map(control=>control.transition?.side)).toEqual([undefined,"enter",undefined,undefined,"exit",undefined]);
 expect(controls.every((control,index)=>index===0||control.fraction>controls[index-1]!.fraction)).toBe(true);
 const member=physicalTopologyScene(base).find(object=>object.id==="p1")!;
 expect(member.pipe?.joiningTransitionMidpoints).toHaveLength(4);
 expect(pipeMidpoints(member)).toEqual(expect.arrayContaining(member.pipe!.joiningTransitionMidpoints!.map(handle=>expect.objectContaining({index:handle.index}))));
});

it("reversed pipes follow the OP direction with fixed endpoints",()=>{
 const d=fixture(),reversed={...d,physicalTopology:{...d.physicalTopology!,segments:d.physicalTopology!.segments.map(s=>s.id==="p1"?{...s,from:s.to,to:s.from}:s)}};
 const op=createJoiningPipe(reversed,[["p0"],["p1"]],"op"),next={...reversed,physicalTopology:{...reversed.physicalTopology,joiningPipes:[op]}};
 expect(op.members[1]!.reverse).toBe(true);
 const a=projectJoiningPipePoint(next,"p1",.4,{x:360,y:100});expect(a.x).toBeCloseTo(360);expect(a.y).toBeCloseTo(.25);
 expect(joiningPipeDisplaySamples(next,"p1")![0]!.point).toEqual({x:600,y:100});
});

it("split fragments share a continuous lane and keep their node on the display route",()=>{
 const d=fixture(),t={...d.physicalTopology!,segments:d.physicalTopology!.segments.map(s=>s.id==="p0"?{...s,path:{kind:"polyline" as const,points:[{x:300,y:0}]}}:s)};
 const start={...d,physicalTopology:t},op=createJoiningPipe(start,[["p0"],["p1"]],"op"),base={...start,physicalTopology:{...t,joiningPipes:[op]}};
 const split={...base,physicalTopology:splitPhysicalSegment(base,"p0",1,"split","tail")};
 expect(split.physicalTopology.joiningPipes![0]!.members[0]!.segmentIds).toEqual(["p0","tail"]);
 const a=joiningPipeDisplaySamples(split,"p0")!.at(-1)!.point,b=joiningPipeDisplaySamples(split,"tail")![0]!.point;expect(a).toEqual(b);
 const node=physicalTopologyScene(split).find(o=>o.id==="split")!;expect(node.y+5).toBeCloseTo(a.y);
 expect(()=>parsePhysicalTopology(split.physicalTopology,split)).not.toThrow();
});

it("bend add, move and delete use one undo step and retain covering anchors",()=>{
 const d=fixture(),op=createJoiningPipe(d,[["p0"],["p1"]],"op"),base={...d,physicalTopology:{...d.physicalTopology!,joiningPipes:[op],coverings:[{id:"cover",name:"Термоусадка",color:"#112233",width:0,lengthMm:200,spans:[{segmentId:"op",from:0,to:1,fromAnchor:0,toAnchor:1}]}]}};
 const h=executeEditorCommand(createEditorHistory(base),{type:"edit-joining-pipe-bend",pipeId:"op",index:0,position:{x:300,y:80},mode:"adjacent",insert:true});
 expect(h.present.physicalTopology!.coverings![0]!.spans[0]!.toAnchor).toBe(2);
  const covered=coveringScene(h.present)[0]!.paths![0]!;
  expect(Math.max(...covered.map(p=>p.y))).toBeGreaterThan(60);
  expect(covered[0]).toEqual(op.start);expect(covered.at(-1)).toEqual(op.end);
 expect(undoEditorCommand(h).present).toBe(base);
 const removed=applyEditorCommand(h.present,{type:"edit-joining-pipe-bend",pipeId:"op",index:0,position:{x:0,y:0},mode:"adjacent",remove:true});
 expect(removed.physicalTopology!.joiningPipes![0]!.path.points).toEqual([]);expect(removed.physicalTopology!.coverings![0]!.spans[0]!.toAnchor).toBe(1);
 expect(parseHarnessDesignDocument(JSON.parse(JSON.stringify(h.present))).physicalTopology!.joiningPipes).toEqual(h.present.physicalTopology!.joiningPipes);
});

it("migrates legacy groups and coatings without losing IDs or material lengths",()=>{
 const d=fixture(),cover={id:"cover",name:"Термоусадка",color:"#112233",width:0,lengthMm:200,spans:[{segmentId:"p0",from:.2,to:.8}],bundle:{mode:"flat" as const,members:[{kind:"segment" as const,id:"p0"},{kind:"segment" as const,id:"p1"}],bodyOffset:{x:40,y:50}}};
 const base={...d,physicalTopology:{...d.physicalTopology!,coverings:[cover,{...cover,id:"overlay",spans:[{segmentId:"p0",from:.4,to:.6}]}]}};
 const migrated=migrateJoiningPipes(base);expect(migrated.physicalTopology!.joiningPipes).toHaveLength(1);
 expect(migrated.physicalTopology!.joiningPipes![0]!.start).toEqual({x:160,y:50});
 expect(migrated.physicalTopology!.coverings!.map(c=>c.id)).toEqual(["cover","overlay"]);expect(migrated.physicalTopology!.coverings!.map(c=>c.lengthMm)).toEqual([200,200]);
 expect(migrated.physicalTopology!.coverings![1]!.spans[0]!.from).toBeCloseTo(1/3);
 expect(migrateJoiningPipes(migrated)).toBe(migrated);expect(()=>parseHarnessDesignDocument(JSON.parse(JSON.stringify(migrated)))).not.toThrow();
});

it.each(["duplicate","missing","range","path","collision","owner","collapsed","legacy","cycle"])("rejects invalid OP %s",mutation=>{
 const d=fixture(),op=createJoiningPipe(d,[["p0"],["p1"]],"op"),t=JSON.parse(JSON.stringify({...d.physicalTopology,joiningPipes:[op]}));
 if(mutation==="duplicate")t.joiningPipes[0].members[1].segmentIds=["p0"];
 if(mutation==="missing")t.joiningPipes[0].members[1].segmentIds=["absent"];
 if(mutation==="range")t.joiningPipes[0].members[0].from=1;
 if(mutation==="path")t.joiningPipes[0].path.points=[{x:NaN,y:0}];
 if(mutation==="collision")t.joiningPipes[0].id="a";
 if(mutation==="owner")t.joiningPipes.push({...op,id:"another"});
 if(mutation==="collapsed")t.joiningPipes[0].end={...op.start};
 if(mutation==="legacy")t.joiningPipes[0].bends=[];
 if(mutation==="cycle"){t.segments.push({...t.segments[0],id:"loop",from:"b",to:"a"});t.joiningPipes[0].members[0].segmentIds.push("loop");}
 expect(()=>parsePhysicalTopology(t,d)).toThrow();
});

it("draft creation, cancellation, selection and deletion keep the electrical graph intact",()=>{
 const d=fixture(),draft=beginJoiningPipe(d,"p0")!;
 expect(()=>joiningPipeDraftTopology(d,draft)).toThrow();
 const chosen=toggleJoiningPipeMember(d,draft,"p1"),t=joiningPipeDraftTopology(d,chosen),next={...d,physicalTopology:t};
 expect(d.physicalTopology!.joiningPipes).toBeUndefined();expect(t.routes).toBe(d.physicalTopology!.routes);
 const scene=physicalTopologyScene(next),pipe=scene.find(o=>o.id===chosen.id)!;expect(pipe.pipe!.midpoints).toHaveLength(1);
 expect(pipe.pipe!.role).toBe("joining-pipe");expect(scene.filter(o=>o.metadata?.joiningPipe===chosen.id)).toHaveLength(2);
 const layers=next.views.drawing.layers.map(l=>({id:l.id,label:l.name,visible:l.visible,locked:l.locked}));
 expect(hitTestEditorScene(scene,layers,{x:250,y:0},1,"drawing")).toBe(chosen.id);
 const memberMidpoints=pipeMidpoints(scene.find(o=>o.id==="p1")!);
 expect(memberMidpoints.length).toBeGreaterThan(0);
 expect(scene.find(o=>o.id==="p1")!.pipe?.joiningTransitionMidpoints).toHaveLength(4);
 const removed=applyEditorCommand(next,{type:"remove-physical-segment",segmentId:chosen.id});expect(removed.physicalTopology!.joiningPipes).toEqual([]);expect(removed.physicalTopology!.segments).toEqual(t.segments);
});
