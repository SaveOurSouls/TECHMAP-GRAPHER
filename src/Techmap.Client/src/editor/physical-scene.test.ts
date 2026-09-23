import { expect, it } from "vitest";
import { physicalTopologyScene, pipeSceneControls, pipeSceneHandles, pipeSceneWireIds } from "./physical-scene";
import { physicalFixture } from "./physical-topology-fixture";
import { physicalSegmentPoints, physicalSegmentControls } from "./physical-geometry";
import { physicalNodeDirection } from "./physical-ports";
import { hitTestWireRoutePoint } from "./CanvasViewport";

it("carries author controls, rendered route and wire identity independently without metadata serialization",()=>{
 const doc=physicalFixture(),before=JSON.stringify(doc),scene=physicalTopologyScene(doc);
 for(const segment of doc.physicalTopology!.segments){
  const pipe=scene.find(o=>o.id===segment.id)!;
  expect(pipe.points).toEqual(physicalSegmentPoints(doc,segment));
  expect(pipeSceneControls(pipe)).toEqual(physicalSegmentControls(doc,segment));
  expect(pipeSceneHandles(pipe)).toEqual(segment.path.points);
  expect(pipe.metadata).toBeUndefined();
  for(const [i,p] of segment.path.points.entries())expect(hitTestWireRoutePoint(pipe,p,100)).toBe(i);
  if(!segment.path.points.length)for(const p of pipe.points!.slice(1,-1))expect(hitTestWireRoutePoint(pipe,p,100)).toBeNull();
 }
 expect(pipeSceneWireIds(scene.find(o=>o.id==="S0"))).toEqual(["W1","W2"]);
 expect(JSON.stringify(doc)).toBe(before);
});
it("resolves typed port directions at the same scene boundary",()=>{
 const base=physicalFixture(),doc={...base,physicalTopology:{...base.physicalTopology!,nodes:base.physicalTopology!.nodes.map(n=>({...n,direction:"up" as const}))}};
 const scene=physicalTopologyScene(doc);
 for(const node of doc.physicalTopology.nodes){
  const object=scene.find(o=>o.id===node.id)!;
  expect(object.port).toEqual({connectorId:node.connectorId,direction:physicalNodeDirection(doc,node)});
  expect(object.metadata).toBeUndefined();
 }
});
