import { describe, expect, it } from "vitest";
import { physicalFixture } from "./physical-topology-fixture";
import { catalogOuterDiameter, drawingReferenceDiameter, drawingWireWidth, drawingPipeWidth } from "./drawing-thickness";
import { coveringScene, moveCovering, wireExitPath } from "./covering-layout";
import { coveringHit, coveringGrips, coveringSurfaces } from "./covering-renderer";
import { coveringMeasuredLength, coveringRoute, type PhysicalCovering } from "./physical-coverings";
import { drawingDimensionScene, dimensionTargetPoints, moveDrawingDimension, setPipeIntervalLength, toggleDrawingDimensions } from "./drawing-dimensions";
import { applyEditorCommand } from "./commands";
import { parseHarnessDesignDocument, type HarnessDesignDocument } from "./model";
import { hitTestEditorScene, drawEditorSceneObject } from "./CanvasViewport";
import { vi } from "vitest";

function straight():HarnessDesignDocument {
 const d=physicalFixture();return {...d,physicalTopology:{...d.physicalTopology!,snap:false,nodes:d.physicalTopology!.nodes.map(n=>n.id==="NA"?{...n,position:{x:180,y:60}}:n.id==="J"?{...n,position:{x:480,y:60}}:n),segments:d.physicalTopology!.segments.map(s=>({...s,path: { kind: "routed" as const, points: [] }}))}};
}
const sleeve=(patch:Partial<PhysicalCovering>={}):PhysicalCovering=>({id:"cover",name:"Термоусадка",kind:"heat-shrink",width:20,color:"#556677",lengthMm:null,lengthMode:"auto",spans:[{segmentId:"S0",from:.1,to:.8}],...patch});
const covered=(c:PhysicalCovering[]= [sleeve()])=>{const d=straight();return {...d,physicalTopology:{...d.physicalTopology!,coverings:c}};};

describe("relative drawing scale",()=>{
 it("reads Russian diameter columns with outer diameter precedence and decimal commas",()=>{
  expect(catalogOuterDiameter({"Диаметр изоляции":1.2,"Внешний диаметр, мм":"2,4 мм"})).toBe(2.4);
  expect(catalogOuterDiameter({"Диаметр изоляции":1.2,"Внешний диаметр (мм)":"2,4 мм"})).toBe(2.4);
  expect(catalogOuterDiameter({"Внешний диаметр":"—","Диаметр изоляции":"1,7"})).toBe(1.7);
  expect(catalogOuterDiameter({"Внешний диаметр":-3})).toBeUndefined();
 });
 it("scales all widths against the smallest known diameter while preserving ratios",()=>{
  const d=straight();const doc={...d,connectors:d.connectors.map((c,i)=>({...c,contacts:c.contacts.map((p,j)=>({...p,wireDiameterMm:i===0?j===0?1.2:3:undefined}))}))};
  expect(drawingReferenceDiameter(doc)).toBe(1.2);
  expect(drawingWireWidth(doc,doc.wires[1]!)/drawingWireWidth(doc,doc.wires[0]!)).toBeCloseTo(2.5);
  const scaled={...doc,drawingDocuments:{tables:[],leaders:[],bomOrder:[],physicalScale:2}};
  expect(drawingWireWidth(scaled,doc.wires[0]!)).toBe(2*drawingWireWidth(doc,doc.wires[0]!));
  expect(drawingPipeWidth(scaled,doc.physicalTopology!.segments[0]!)).toBe(2*drawingPipeWidth(doc,doc.physicalTopology!.segments[0]!));
  expect(parseHarnessDesignDocument(JSON.parse(JSON.stringify(scaled))).drawingDocuments?.physicalScale).toBe(2);
 });
});

describe("pipe dimensions",()=>{
 it("sets a pipe interval once, retains its identity and hides without losing lengths",()=>{
  let d=straight();d=applyEditorCommand(d,{type:"set-drawing-documents",documents:setPipeIntervalLength(d,"S0",0,1,123.456)});
  const id=d.drawingDocuments!.dimensions![0]!.id;
  expect(drawingDimensionScene(d)).toHaveLength(0);
  d=applyEditorCommand(d,{type:"set-drawing-documents",documents:toggleDrawingDimensions(d)});
  expect(drawingDimensionScene(d).find(o=>o.id===id)?.label).toBe("123.456 мм");
  d=applyEditorCommand(d,{type:"set-drawing-documents",documents:toggleDrawingDimensions(d)});
  expect(drawingDimensionScene(d)).toHaveLength(0);
  expect(d.drawingDocuments!.dimensions!.find(x=>x.id===id)?.lengthMm).toBe(123.456);
  expect(setPipeIntervalLength(d,"S0",0,1,200).dimensions!.find(x=>x.segmentId==="S0")?.id).toBe(id);
 });
 it("attaches connector witnesses to a perimeter corner",()=>{
  const d=straight(),docs=setPipeIntervalLength(d,"S0",0,1,100),dimension=docs.dimensions![0]!;
  const p=dimensionTargetPoints(d,dimension,new Map([["A",[[{x:0,y:0},{x:100,y:0},{x:100,y:80},{x:0,y:80},{x:0,y:0}]]]]));
  expect(p[0]).toEqual({x:100,y:80});expect(p[1]).toEqual({x:480,y:60});
 });
 it("snaps collinear dimensions and replaces adjacent arrows with dots",()=>{
  let d=straight();d={...d,physicalTopology:{...d.physicalTopology!,nodes:d.physicalTopology!.nodes.map(n=>n.id==="NA"?{...n,connectorId:undefined}:n),segments:d.physicalTopology!.segments.map(s=>s.id==="S0"?{...s,path: { kind: "routed" as const, points: [{x:330,y:60}] }}:s)}};
  d={...d,drawingDocuments:setPipeIntervalLength(d,"S0",0,1,100)};
  d={...d,drawingDocuments:setPipeIntervalLength(d,"S0",1,2,200)};
  d={...d,drawingDocuments:{...d.drawingDocuments!,showDimensions:true}};
  const second=d.drawingDocuments!.dimensions![1]!;
  const changed=moveDrawingDimension(d,second.id,{x:405,y:104})!;
  expect(changed.dimensions![1]!.offset).toBe(40);
  const scene=drawingDimensionScene({...d,drawingDocuments:changed});
  expect(scene[0]!.metadata?.dotEnd).toBe("true");expect(scene[1]!.metadata?.dotStart).toBe("true");
 });
 it("draws a path dimension through all bends",()=>{
  const d=physicalFixture(),docs=setPipeIntervalLength(d,"S0",0,2,250);
  const scene=drawingDimensionScene({...d,drawingDocuments:{...docs,showDimensions:true,dimensions:docs.dimensions!.map(x=>({...x,mode:"path"}))}});
  expect(scene[0]!.points!.length).toBeGreaterThan(4);
  const context=new Proxy({},{get:()=>vi.fn(),set:()=>true}) as CanvasRenderingContext2D;
  expect(()=>drawEditorSceneObject(context,scene[0]!,false,"drawing")).not.toThrow();
 });
});

describe("covering surfaces and editing",()=>{
 it("is opaque, preserves layer order, and can be hit above the pipe",()=>{
  const d=covered([sleeve({id:"nylon",kind:"nylon"}),sleeve()]),scene=coveringScene(d);
  expect(scene.map(s=>s.id)).toEqual(["nylon","cover"]);
  const surface=coveringSurfaces(scene[1]!)[0]!,p=surface.path[0]!;
  expect(coveringHit(scene[1]!,{x:p.x+20,y:p.y},0)).toBe(0);
  expect(coveringSurfaces(scene[1]!)[0]!.polygon).not.toEqual(coveringSurfaces(scene[0]!)[0]!.polygon);
  expect(hitTestEditorScene(scene,[{id:"wires",label:"wires",visible:true,locked:false}],{x:p.x+20,y:p.y},1,"drawing")).toBe("cover");
  expect(coveringGrips(scene[1]!)).toHaveLength(2);
 });
 it("slides a sleeve without changing manual length and stretches either end with snapping",()=>{
  const d=covered([sleeve({lengthMode:"manual",lengthMm:70})]);
  const moved=moveCovering(d,"cover",0,"body",{x:240,y:60},{x:270,y:60})!;
  expect(moved.spans[0]!.from).toBeCloseTo(.2);expect(moved.spans[0]!.to).toBeCloseTo(.9);expect(moved.lengthMm).toBe(70);
  const anchored=moveCovering(d,"cover",0,"from",{x:210,y:60},{x:182,y:60})!;
  expect(anchored.spans[0]!.fromAnchor).toBe(0);expect(anchored.spans[0]!.from).toBe(0);
  const stretched=moveCovering(d,"cover",0,"to",{x:420,y:60},{x:478,y:60})!;
  expect(stretched.spans[0]!.toAnchor).toBe(1);
 });
 it("uses measured lengths only for fully bound automatic spans",()=>{
  let d=covered();d={...d,drawingDocuments:setPipeIntervalLength(d,"S0",0,1,150.125)};
  const bound=sleeve({spans:[{segmentId:"S0",from:0,to:1,fromAnchor:0,toAnchor:1}]});
  expect(coveringMeasuredLength(d,bound)).toBe(150.125);
  expect(coveringMeasuredLength(d,{...bound,lengthMode:"manual",lengthMm:80})).toBe(80);
  expect(coveringMeasuredLength(d,sleeve())).toBeNull();
 });
 it("shrinks around parallel wires on connector tails while nylon keeps its pipe width",()=>{
  const c=sleeve({spans:[{segmentId:"S0",from:-.1,to:.3}]}),d=covered([c]);
  const route=coveringRoute(d,"S0")!;expect(route.min).toBeLessThan(0);
  const exit=wireExitPath(d,"S0","from","W1",{x:118,y:60})!;expect(exit.length).toBeGreaterThanOrEqual(3);
  const heat=coveringGrips(coveringScene(d)[0]!);
  const nylon=coveringGrips(coveringScene(covered([{...c,kind:"nylon"}]))[0]!);
  expect(heat[0]!.halfWidth).toBeLessThan(heat[1]!.halfWidth);
  expect(nylon[0]!.halfWidth).toBeCloseTo(nylon[1]!.halfWidth);
  expect(wireExitPath(covered([{...c,kind:"nylon"}]),"S0","from","W1",{x:118,y:60})).toBeNull();
 });
});
