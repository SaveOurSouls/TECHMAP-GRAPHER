import {buildHarnessSelectionIndex,resolveHarnessSelection} from "./harness-selection";
import { describe,it,expect } from "vitest";
import { physicalFixture } from "./physical-topology-fixture";
import { dimensionGeometry,dimensionRouteKey,dimensionWirePoints,segmentDimensionKey,pipeMeasuredWireLength,validateDrawingDimensions } from "./drawing-dimensions";
import { applyEditorCommand } from "./commands";
import { createEditorHistory,executeEditorCommand,undoEditorCommand } from "./history";
import { calculateWireCutLength,parseHarnessDesignDocument } from "./model";
import { emptyDrawingDocuments } from "./drawing-documents";
const fixture=()=>{const d=physicalFixture();return {...d,physicalTopology:undefined,wires:d.wires.map(w=>({...w,drawingRoute:[{x:300,y:100},{x:300,y:300}]}))};};
describe("bound dimensions",()=>{
 it("keeps aligned offsets parallel and vertical/horizontal projections axis aligned",()=>{
  const a={x:10,y:20},b={x:40,y:60},points=dimensionGeometry(a,b,"aligned",12);
  expect(points[2]!.x-points[1]!.x).toBeCloseTo(30);expect(points[2]!.y-points[1]!.y).toBeCloseTo(40);
  expect(dimensionGeometry(a,b,"horizontal",10).slice(1,3)).toEqual([{x:10,y:70},{x:40,y:70}]);
  expect(dimensionGeometry(a,b,"vertical",10).slice(1,3)).toEqual([{x:50,y:20},{x:50,y:60}]);
 });
 it("updates cutting length atomically, round trips, invalidates removed bends and undoes",()=>{
  const d=fixture(),wire=d.wires[0]!,base={wireId:wire.id,pointCount:4,routeKey:dimensionRouteKey(d,wire),mode:"aligned" as const,offset:40};
  const dimensions=[{...base,id:"dim1",from:0,to:1,lengthMm:100.125},{...base,id:"dim2",from:1,to:3,lengthMm:200.125}];
  const history=executeEditorCommand(createEditorHistory(d),{type:"set-drawing-documents",documents:{...emptyDrawingDocuments(),dimensions}});
  expect(history.present.wires[0]!.lengthMm).toBe(300.25);expect(calculateWireCutLength(history.present.wires[0]!).cutLengthMm).toBe(301);
  expect(parseHarnessDesignDocument(JSON.parse(JSON.stringify(history.present))).drawingDocuments?.dimensions).toEqual(dimensions);
  expect(undoEditorCommand(history).present).toBe(d);
  const moved=applyEditorCommand(history.present,{type:"set-wire-route",wireId:wire.id,route:[{x:320,y:80},{x:340,y:330}]});
  expect(moved.drawingDocuments?.dimensions).toEqual(dimensions);expect(moved.wires[0]!.lengthMm).toBe(300.25);
  const removed=applyEditorCommand(moved,{type:"set-wire-route",wireId:wire.id,route:[{x:320,y:80}]});
  expect(removed.drawingDocuments?.dimensions).toEqual([]);expect(removed.wires[0]!.lengthMm).toBeNull();
  expect(()=>applyEditorCommand(moved,{type:"update-wire",wireId:wire.id,lengthMm:4})).toThrow(/размерами/);
  expect(applyEditorCommand(moved,{type:"set-drawing-documents",documents:{...moved.drawingDocuments!,dimensions:[dimensions[0]!]}}).wires[0]!.lengthMm).toBeNull();
 });
 it("follows a physical path and invalidates replacement of its branch identity",()=>{
  const d=physicalFixture(),wire=d.wires[0]!,points=dimensionWirePoints(d,wire);
  const dimension={id:"physical-dim",wireId:wire.id,from:0,to:points.length-1,pointCount:points.length,routeKey:dimensionRouteKey(d,wire),mode:"horizontal" as const,offset:20,lengthMm:432.1};
  const measured=applyEditorCommand(d,{type:"set-drawing-documents",documents:{...emptyDrawingDocuments(),dimensions:[dimension]}});
  expect(measured.wires[0]!.lengthMm).toBe(432.1);
  const topology={...d.physicalTopology!,segments:d.physicalTopology!.segments.map(s=>s.id==="S0"?{...s,id:"replacement"}:s),routes:d.physicalTopology!.routes.map(r=>({...r,steps:r.steps.map(s=>s.segmentId==="S0"?{...s,segmentId:"replacement"}:s)}))};
  expect(applyEditorCommand(measured,{type:"set-physical-topology",topology}).wires[0]!.lengthMm).toBeNull();
  expect(()=>validateDrawingDimensions([{...dimension,from:"bad"}],d)).toThrow();

 });
 it("shares measured pipes, sums per route, preserves individual corrections and invalidates missing lengths",()=>{
  const d=physicalFixture();
  const dimensions=d.physicalTopology!.segments.map((segment,i)=>({id:`P${i}`,segmentId:segment.id,from:0,to:segment.bends.length+1,pointCount:segment.bends.length+2,routeKey:segmentDimensionKey(d,segment.id),mode:"aligned" as const,offset:30,lengthMm:[125.5,200,50][i]!}));
  const measured=applyEditorCommand(d,{type:"set-drawing-documents",documents:{...emptyDrawingDocuments(),dimensions}});
  expect(measured.wires.map(w=>w.lengthMm)).toEqual([325.5,175.5,250]);
  expect(resolveHarnessSelection(buildHarnessSelectionIndex(measured),["P0"]).wireIds).toEqual(["W1","W2"]);
  expect(parseHarnessDesignDocument(JSON.parse(JSON.stringify(measured))).drawingDocuments?.dimensions).toEqual(dimensions);
  const corrected=applyEditorCommand(measured,{type:"update-wire",wireId:"W1",endCorrectionFromMm:10,endCorrectionToMm:2.5});
  expect(calculateWireCutLength(corrected.wires[0]!).cutLengthMm).toBe(338);
  expect(corrected.wires[1]!.lengthMm).toBe(175.5);
  const partial=applyEditorCommand(corrected,{type:"set-drawing-documents",documents:{...corrected.drawingDocuments!,dimensions:dimensions.slice(0,2)}});
  expect(partial.wires.map(w=>w.lengthMm)).toEqual([325.5,null,null]);
  const moved=applyEditorCommand(measured,{type:"set-physical-topology",topology:{...measured.physicalTopology!,snap:false,segments:measured.physicalTopology!.segments.map(s=>({...s,bends:s.bends.map(p=>({x:p.x+20,y:p.y+10}))}))}});
  expect(moved.wires.map(w=>w.lengthMm)).toEqual([325.5,175.5,250]);
  const changed=applyEditorCommand(moved,{type:"set-physical-topology",topology:{...moved.physicalTopology!,segments:moved.physicalTopology!.segments.map(s=>s.id==="S0"?{...s,bends:[]}:s)}});
  expect(changed.wires.map(w=>w.lengthMm)).toEqual([null,null,250]);
  expect(()=>applyEditorCommand(measured,{type:"update-wire",wireId:"W1",lengthMm:1})).toThrow(/размерами/);
  expect(pipeMeasuredWireLength(measured,"W1").managed).toBe(true);
 });
});
