import { expect, it } from "vitest";
import { physicalTopologyScene, pipeSceneControls, pipeSceneHandles, pipeSceneWireIds } from "./physical-scene";
import { physicalFixture } from "./physical-topology-fixture";
import { physicalSegmentPoints, physicalSegmentControls } from "./physical-geometry";
import { physicalNodeDirection } from "./physical-ports";
import { hitTestWireRoutePoint, objectsInPaintOrder } from "./CanvasViewport";
import { defaultLayerIds, parseHarnessDesignDocument } from "./model";

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
it("keeps physical connection points on a dedicated top layer and distinguishes exits",()=>{
 const doc=physicalFixture(),scene=physicalTopologyScene(doc);
 const exit=scene.find(o=>o.id==="NA")!,junction=scene.find(o=>o.id==="J")!;
 expect(exit.layerId).toBe(defaultLayerIds.connectionPoints);
 expect(junction.layerId).toBe(defaultLayerIds.connectionPoints);
 expect(exit.color).toBe("#f59e0b");
 expect(junction.color).toBe("#1179ac");
 expect(exit.metadata?.nodeRole).toBe("connector-exit");
 expect(junction.metadata?.nodeRole).toBe("junction");
 const painted=objectsInPaintOrder(scene,doc.views.drawing.layers.map(layer=>({...layer,label:layer.name})));
 expect(painted.findIndex(o=>o.id==="NA")).toBeGreaterThan(painted.findIndex(o=>o.id==="S0"));
 const manuallyReordered=objectsInPaintOrder(scene,[...doc.views.drawing.layers].reverse().map(layer=>({...layer,label:layer.name})));
 expect(manuallyReordered.at(-1)?.id).toBe("J");
 expect(manuallyReordered.findIndex(o=>o.id==="NA")).toBeGreaterThan(manuallyReordered.findIndex(o=>o.id==="S0"));
});
it("migrates legacy view layers with a visible connection-point layer",()=>{
 const doc=physicalFixture();
 const legacy={...doc,views:{...doc.views,e4:{...doc.views.e4,layers:doc.views.e4.layers.filter(layer=>layer.id!==defaultLayerIds.connectionPoints)},drawing:{...doc.views.drawing,layers:doc.views.drawing.layers.filter(layer=>layer.id!==defaultLayerIds.connectionPoints)}}};
 const parsed=parseHarnessDesignDocument(legacy);
 expect(parsed.views.e4.layers.find(layer=>layer.id===defaultLayerIds.connectionPoints)).toMatchObject({visible:true,locked:false});
 expect(parsed.views.drawing.layers.find(layer=>layer.id===defaultLayerIds.connectionPoints)).toMatchObject({visible:true,locked:false});
 const highOrder={...legacy,views:{...legacy.views,drawing:{...legacy.views.drawing,layers:legacy.views.drawing.layers.map((layer,i)=>({...layer,order:10000-i}))}}};
 const migrated=parseHarnessDesignDocument(highOrder);
 expect(()=>parseHarnessDesignDocument(JSON.parse(JSON.stringify(migrated)))).not.toThrow();
});
it("resolves typed port directions at the same scene boundary",()=>{
 const base=physicalFixture(),doc={...base,physicalTopology:{...base.physicalTopology!,nodes:base.physicalTopology!.nodes.map(n=>({...n,direction:"up" as const}))}};
 const scene=physicalTopologyScene(doc);
 for(const node of doc.physicalTopology.nodes){
  const object=scene.find(o=>o.id===node.id)!;
  expect(object.port).toEqual({connectorId:node.connectorId,direction:physicalNodeDirection(doc,node)});
  expect(object.metadata?.nodeRole).toBe(node.connectorId ? "connector-exit" : "junction");
 }
});
