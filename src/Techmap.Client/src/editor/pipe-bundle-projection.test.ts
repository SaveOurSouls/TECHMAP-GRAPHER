import { expect, it } from "vitest";
import { physicalSegmentPoints } from "./physical-geometry";
import { physicalFixture } from "./physical-topology-fixture";
import { pipeBundleDisplaySamples, projectPipeBundleControls, projectPipeBundlePoint, unprojectPipeBundleEdit } from "./pipe-bundle-projection";
import { physicalWireDisplayPaths, physicalWirePoints } from "./physical-wire-geometry";
import { createEmptyHarnessDesign, type HarnessDesignDocument } from "./model";
import { createConnector, createWire } from "./commands";
import { coveringScene, moveCovering } from "./covering-layout";
import { splitPhysicalSegment } from "./physical-topology";
import { pipeBundleSections } from "./pipe-bundle-section";
import { physicalTopologyScene } from "./physical-scene";

function parallel(): HarnessDesignDocument {
  const connectors=["A","B","C","D"].map((id,i)=>createConnector(id,id,1,{x:i%2*600,y:Math.floor(i/2)*100}));
  return {...createEmptyHarnessDesign(),connectors,
    wires:[createWire("W1",{connectorId:"A",contactId:"A:contact:1"},{connectorId:"B",contactId:"B:contact:1"}),
      createWire("W2",{connectorId:"C",contactId:"C:contact:1"},{connectorId:"D",contactId:"D:contact:1"})].map(w=>({...w,lengthMm:400})),
    drawingDocuments:{tables:[],leaders:[],bomOrder:[],bendRadius:0},
    physicalTopology:{snap:false,
      nodes:[0,1,2].flatMap(i=>[{id:`a${i}`,position:{x:0,y:i*100}},{id:`b${i}`,position:{x:600,y:i*100}}]),
      segments:[0,1,2].map(i=>({id:`s${i}`,from:`a${i}`,to:`b${i}`,path:{kind:"polyline",points:[]},width:10})),
      routes:[{wireId:"W1",steps:[{segmentId:"s0",reverse:false}]},{wireId:"W2",steps:[{segmentId:"s1",reverse:false}]}],
      coverings:[{id:"group",name:"Оболочка",width:0,color:"#334455",lengthMm:240,lengthMode:"manual",
        spans:[{segmentId:"s0",from:.3,to:.7}],bundle:{mode:"flat",members:[{kind:"segment",id:"s0"},{kind:"segment",id:"s1"}]}}]}};
}

it("converges straight parallel members onto one sleeve axis with transitions outside its edges",()=>{
  const doc=parallel(),before=JSON.stringify(doc);
  for(const [id,y] of [["s0",-5],["s1",5]] as const){
    const points=pipeBundleDisplaySamples(doc,id)!;
    expect(points.find(p=>p.fraction===.3)!.point).toEqual({x:180,y});
    expect(points.find(p=>p.fraction===.7)!.point).toEqual({x:420,y});
    expect(points[0]!.point).toEqual({x:0,y:id==="s0"?0:100});
    expect(points.at(-1)!.point).toEqual({x:600,y:id==="s0"?0:100});
  }
  const cover=coveringScene(doc)[0]!;
  expect(cover.paths).toHaveLength(1);
  expect(cover.paths![0]!.every(p=>p.y===0)).toBe(true);
  expect(cover.width).toBe(20.5);
  expect(JSON.stringify(doc)).toBe(before);
});

it("routes each wire inside its projected pipe while preserving measured and electrical data",()=>{
  const doc=parallel(),before=JSON.stringify(doc);
  const pipe=pipeBundleDisplaySamples(doc,"s1")!.map(p=>p.point);
  expect(physicalWireDisplayPaths(doc,"W2",{x:0,y:100},{x:600,y:100})![1]).toEqual(pipe);
  expect(physicalWirePoints(doc,"W2",{x:0,y:100},{x:600,y:100})).toEqual([{x:0,y:100},{x:600,y:100}]);
  expect(doc.wires.map(w=>w.lengthMm)).toEqual([400,400]);
  expect(JSON.stringify(doc)).toBe(before);
});

it("follows a moved sleeve and recreates the same display after JSON without storing display vertices",()=>{
  const doc=parallel(),t=doc.physicalTopology!;
  const moved=moveCovering(doc,"group",0,"body",{x:200,y:0},{x:260,y:0})!;
  const next={...doc,physicalTopology:{...t,coverings:[moved]}};
  expect(moved.spans[0]!.from).toBeCloseTo(.4);
  expect(projectPipeBundlePoint(next,"s1",.4,{x:240,y:100})).toEqual({x:240,y:5});
  expect(projectPipeBundlePoint(next,"s1",.2,{x:120,y:100})).toEqual({x:120,y:100});
  expect(pipeBundleDisplaySamples(JSON.parse(JSON.stringify(next)),"s1")).toEqual(pipeBundleDisplaySamples(next,"s1"));
  expect(next.physicalTopology.segments).toBe(t.segments);
  expect(next.physicalTopology.routes).toBe(t.routes);
  expect(moved.lengthMm).toBe(240);
});

it("uses the same lane for split continuations without repeating the full sleeve on each fragment",()=>{
  const base=parallel(),doc={...base,physicalTopology:{...base.physicalTopology!,segments:base.physicalTopology!.segments.map(s=>s.id==='s0'?{...s,path:{kind:'polyline' as const,points:[{x:300,y:0}]}}:s)}};
  const split={...doc,physicalTopology:splitPhysicalSegment(doc,"s0",1,"cut","tail")};
  expect(pipeBundleDisplaySamples(split,"s0")!.at(-1)!.point).toEqual({x:300,y:-5});
  expect(pipeBundleDisplaySamples(split,"tail")![0]!.point).toEqual({x:300,y:-5});
  expect(pipeBundleSections(split).get("group")!.width).toBe(pipeBundleSections(doc).get("group")!.width);
  expect(projectPipeBundlePoint(split,"s1",.5,{x:300,y:100})).toEqual({x:300,y:5});
  const node=physicalTopologyScene(split).find(s=>s.id==='cut')!;
  expect({x:node.x+5,y:node.y+5}).toEqual({x:300,y:-5});
  const branched={...split,physicalTopology:{...split.physicalTopology,nodes:[...split.physicalTopology.nodes,{id:'tip',position:{x:300,y:-200}}],
    segments:[...split.physicalTopology.segments,{id:'branch',from:'cut',to:'tip',path:{kind:'polyline' as const,points:[]}}]}};
  expect(pipeBundleDisplaySamples(branched,'branch')![0]!.point).toEqual({x:300,y:-5});
  expect(pipeBundleDisplaySamples(branched,'branch')!.at(-1)!.point).toEqual({x:300,y:-200});
});

it("projects nested shells by their own centre, independent of covering array order",()=>{
  const base=parallel(),inner=base.physicalTopology!.coverings![0]!;
  const outer={...inner,id:"outer",bundle:{mode:"flat" as const,members:[{kind:"covering" as const,id:"group"},{kind:"segment" as const,id:"s2"}]}};
  const doc={...base,physicalTopology:{...base.physicalTopology!,coverings:[outer,inner]}};
  const other={...doc,physicalTopology:{...doc.physicalTopology,coverings:[inner,outer]}};
  expect(pipeBundleDisplaySamples(doc,"s1")).toEqual(pipeBundleDisplaySamples(other,"s1"));
  const scene=coveringScene(doc),nested=scene.find(c=>c.id==='group')!;
  expect(nested.paths![0]!.every(p=>p.y===-5)).toBe(true);
  expect(scene.find(c=>c.id==='outer')!.paths![0]!.every(p=>p.y===0)).toBe(true);
  expect(scene.map(c=>c.id)).toEqual(['group','outer']);
});

it("maps a reversed pipe onto the shared axis without reversing its authored endpoints",()=>{
  const doc=parallel();
  const reversed={...doc,physicalTopology:{...doc.physicalTopology!,segments:doc.physicalTopology!.segments.map(s=>s.id==='s1'?{...s,from:s.to,to:s.from}:s)}};
  expect(projectPipeBundlePoint(reversed,'s1',.3,{x:420,y:100})).toEqual({x:420,y:5});
  expect(pipeBundleDisplaySamples(reversed,'s1')![0]!.point).toEqual({x:600,y:100});
});

it("keeps generated stations out of bend ordinals and translates pointer deltas without a jump",()=>{
  const doc=parallel(),pipe=physicalTopologyScene(doc).find(s=>s.id==='s1')!;
  expect(pipe.pipe!.handles).toHaveLength(0);
  expect(pipe.pipe!.midpoints).toEqual([{x:300,y:5}]);
  expect(unprojectPipeBundleEdit(doc,'s1',{x:300,y:100},{x:300,y:5})).toEqual({x:300,y:100});
  expect(unprojectPipeBundleEdit(doc,'s1',{x:300,y:100},{x:305,y:15})).toEqual({x:305,y:110});
});

it("projects bundled pipe presentation inside its sleeve and rejoins the authored route", () => {
  const base = physicalFixture();
  const document = {
    ...base,
    physicalTopology: {
      ...base.physicalTopology!,
      segments: base.physicalTopology!.segments.map(s => ({ ...s, width: 10 })),
      coverings: [{
        id: "bundle", name: "Общая оболочка", width: 0, color: "#334455", lengthMm: null,
        spans: [{ segmentId: "S0", from: .2, to: .8 }],
        bundle: { mode: "flat" as const, members: [{ kind: "segment" as const, id: "S0" }, { kind: "segment" as const, id: "S1" }] },
      }],
    },
  };
  const source = physicalSegmentPoints(document, document.physicalTopology.segments[0]!);
  const projected = pipeBundleDisplaySamples(document, "S0")!.map(s => s.point);
  expect(projected[0]).toEqual(source[0]);
  expect(projected.at(-1)).toEqual(source.at(-1));
  expect(projected.some(point => !source.some(base => Math.hypot(point.x - base.x, point.y - base.y) < 0.01))).toBe(true);
  const controls=projectPipeBundleControls(document, "S0", source);
  expect(controls).toHaveLength(source.length);
  expect(controls[0]).toEqual(source[0]);
  expect(controls.at(-1)).toEqual(source.at(-1));
  const wirePath = physicalWireDisplayPaths(document, "W1", { x: 0, y: 0 }, { x: 650, y: 500 })!.flat();
  expect(wirePath.some(point => !source.some(base => Math.hypot(point.x - base.x, point.y - base.y) < 0.01))).toBe(true);
});

it("leaves an unbundled pipe and authored geometry unchanged", () => {
  const document = physicalFixture();
  const source = physicalSegmentPoints(document, document.physicalTopology!.segments[0]!);
  expect(projectPipeBundleControls(document, "S0", source)).toEqual(source);
  expect(JSON.stringify(document)).toBe(JSON.stringify(physicalFixture()));
});
