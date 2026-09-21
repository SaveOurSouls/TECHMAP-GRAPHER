import { physicalFixture } from "./physical-topology-fixture";
import { describe, expect, it } from "vitest";
import { applyEditorCommand } from "./commands";
import { createEmptyHarnessDesign, createOrthogonalE4Route, wireEndpointE4Anchor, parseHarnessDesignDocument } from "./model";
import { constrainedPolyline, physicalSegmentPoints, physicalWirePoints, splitPhysicalSegment } from "./physical-topology";
import { buildHarnessSelectionIndex, resolveHarnessSelection } from "./harness-selection";
import { createEditorHistory, executeEditorCommand, undoEditorCommand } from "./history";


describe("physical topology", () => {
  it("resolves explicit branch membership independently of electrical connectivity", () => {
    const d = physicalFixture(), index = buildHarnessSelectionIndex(d);
    expect(resolveHarnessSelection(index, ["S1"]).wireIds.sort()).toEqual(["W1", "W3"]);
    expect(resolveHarnessSelection(index, ["A"]).wireIds.sort()).toEqual(["W1", "W2"]);
    expect(resolveHarnessSelection(index, ["W1"], true).wireIds).toEqual(["W1"]);
    const crossed = { ...d, physicalTopology: { ...d.physicalTopology!, segments: [...d.physicalTopology!.segments, { id: "cross", from: "NA", to: "NC", bends: [] }] } };
    expect(resolveHarnessSelection(buildHarnessSelectionIndex(crossed), ["cross"]).wireIds).toEqual([]);
  });
  it("splits at existing bends, preserves reverse routes, serializes and undoes", () => {
    const d = physicalFixture();
    const topology = splitPhysicalSegment(d, "S1", 1, "split", "new");
    const h = executeEditorCommand(createEditorHistory(d), { type: "set-physical-topology", topology });
    expect(parseHarnessDesignDocument(JSON.parse(JSON.stringify(h.present))).physicalTopology).toEqual(topology);
    expect(topology.routes.find(r => r.wireId === "W3")!.steps.slice(0, 2)).toEqual([{ segmentId: "new", reverse: true }, { segmentId: "S1", reverse: true }]);
    expect(undoEditorCommand(h).present).toBe(d);
    expect(h.present.wires).toBe(d.wires);
  });
  it("keeps every segment on the 15 degree grid after arbitrary anchor moves", () => {
    for (let i = 1; i < 60; i++) {
      const points = constrainedPolyline([{ x: -10, y: 70 }, { x: i * 13.7 - 400, y: i * 2.31 - 20 }, { x: 220, y: -111 }], true);
      for (let j = 1; j < points.length; j++) {
        const angle = Math.atan2(points[j]!.y - points[j - 1]!.y, points[j]!.x - points[j - 1]!.x) / (Math.PI / 12);
        expect(Math.abs(angle - Math.round(angle))).toBeLessThan(1e-6);
      }
    }
    const input = [{ x: 0, y: 0 }, { x: 123, y: 31 }];
    expect(constrainedPolyline(input, false)).toEqual(input);
  });
  it("moves common exits with connectors without changing lengths, electrical ends or shared topology", () => {
    const d = physicalFixture();
    const moved = applyEditorCommand(d, { type: "move-connector", connectorId: "A", view: "drawing", position: { x: 33, y: 66 } });
    expect(physicalSegmentPoints(moved, moved.physicalTopology!.segments[0]!)[0]).toEqual({ x: 183, y: 106 });
    expect(moved.wires).toBe(d.wires);
    expect(physicalWirePoints(moved, "W1", { x: 0, y: 0 }, { x: 1, y: 1 })!.length).toBeGreaterThan(3);
  });
  it("rejects broken references, discontinuous routes and wrong connector exits", () => {
    const d = physicalFixture();
    for (const steps of [[{ segmentId: "missing", reverse: false }], [{ segmentId: "S0", reverse: false }, { segmentId: "S1", reverse: true }], [{ segmentId: "S2", reverse: false }]]) {
      expect(() => parseHarnessDesignDocument({ ...d, physicalTopology: { ...d.physicalTopology!, routes: [{ wireId: "W1", steps }] } })).toThrow();
    }
    expect(parseHarnessDesignDocument(createEmptyHarnessDesign()).physicalTopology).toBeUndefined();
  });
  it("removes route references when a wire is deleted", () => {
    const d = applyEditorCommand(physicalFixture(), { type: "remove-wire", wireId: "W1" });
    expect(d.physicalTopology!.routes.map(r => r.wireId)).toEqual(["W2", "W3"]);
    expect(() => parseHarnessDesignDocument(d)).not.toThrow();
  });
});

it("keeps connector exits and drag coordinates consistent with a rotated scaled drawing",async()=>{
 const {physicalNodeLocalPoint,physicalNodePoint}=await import("./physical-topology");
 const {createConnector}=await import("./commands");
 const {createEmptyHarnessDesign}=await import("./model");
 const c={...createConnector("c","X1",1,{x:0,y:0}),drawingPlacements:[{drawingId:"view:drawing",offset:{x:0,y:0},visible:true,scale:2,rotationDegrees:90}]};
 const doc={...createEmptyHarnessDesign(),connectors:[c]},node={id:"exit",connectorId:c.id,position:{x:30,y:20}};
 const point=physicalNodePoint(doc,node);
 expect(point.x).toBeCloseTo(c.positions.drawing.x-40);expect(point.y).toBeCloseTo(c.positions.drawing.y+60);
 const local=physicalNodeLocalPoint(doc,node,point);expect(local.x).toBeCloseTo(30);expect(local.y).toBeCloseTo(20);
});

it("displays E4 conductors as separate channel lanes and hides them without changing the route",async()=>{
 const {physicalWireDisplayPaths}=await import("./physical-topology");
 const d=physicalFixture(),start={x:0,y:0},end={x:1000,y:500};
 const first=physicalWireDisplayPaths(d,"W1",start,end)!,second=physicalWireDisplayPaths(d,"W2",start,end)!;
 expect(first[1]).not.toEqual(second[1]);
 const t={...d.physicalTopology!,segments:d.physicalTopology!.segments.map(s=>({...s,showWires:false,width:24,color:"#112233"}))};
 const h=executeEditorCommand(createEditorHistory(d),{type:"set-physical-topology",topology:t});
 expect(physicalWireDisplayPaths(h.present,"W1",start,end)).toHaveLength(2);
 expect(h.present.wires).toEqual(d.wires);expect(parseHarnessDesignDocument(JSON.parse(JSON.stringify(h.present))).physicalTopology).toEqual(t);
 expect(undoEditorCommand(h).present).toEqual(d);
});

it("makes a T at an interior click without losing reverse routes, protection spans or channel style",async()=>{
 const {branchPhysicalSegment}=await import("./physical-topology");
 const d=physicalFixture(),segment={...d.physicalTopology!.segments[0]!,width:28,color:"#112233",showWires:false};
 const doc={...d,physicalTopology:{...d.physicalTopology!,snap:false,segments:[segment,...d.physicalTopology!.segments.slice(1)],coverings:[{id:"cover",name:"Tape",width:32,color:"#222222",lengthMm:50,spans:[{segmentId:"S0",from:0,to:1}]}]}};
 const points=physicalSegmentPoints(doc,segment),point={x:(points[0]!.x+points[1]!.x)/2,y:(points[0]!.y+points[1]!.y)/2};
 const t=branchPhysicalSegment(doc,"S0",point,{junction:"T",continuation:"tail",tip:"tip",branch:"branch"});
 expect(t.segments.filter(s=>s.from==="T"||s.to==="T")).toHaveLength(3);
 expect(t.segments.find(s=>s.id==="tail")).toMatchObject({width:28,color:"#112233",showWires:false});
 expect(t.coverings![0]!.spans.map(s=>s.segmentId)).toEqual(["S0","tail"]);
 expect(t.routes[0]!.steps.map(s=>s.segmentId)).toEqual(["S0","tail","S1"]);
 expect(parseHarnessDesignDocument({...doc,physicalTopology:t}).physicalTopology).toEqual(t);
 expect(doc.wires).toBe(d.wires);
});
it("distributes wires to shortest channels, preserves pinned routes and supports separate exits for double crimp",async()=>{
 const {routePhysicalWires}=await import("./physical-topology");const base=physicalFixture();const d={...base,wires:base.wires.map(w=>w.id==="W2"?{...w,from:base.wires[0]!.from,e4Route:createOrthogonalE4Route(wireEndpointE4Anchor(base,base.wires[0]!.from)!,wireEndpointE4Anchor(base,w.to)!)}:w)};
 let t={...d.physicalTopology!,nodes:[...d.physicalTopology!.nodes,{id:"NA2",connectorId:"A",position:{x:160,y:70},wireIds:["W2"]}],segments:[...d.physicalTopology!.segments,{id:"direct",from:"NA2",to:"NC",bends:[]}],routes:[]};
 t={...t,nodes:t.nodes.map(n=>n.id==="NA"?{...n,wireIds:["W1"]}:n)};
 const routed=routePhysicalWires(d,t);
 expect(routed.routes.find(r=>r.wireId==="W2")!.steps).toEqual([{segmentId:"direct",reverse:false}]);
 expect(routed.routes.find(r=>r.wireId==="W1")!.steps.map(s=>s.segmentId)).toEqual(["S0","S1"]);
 expect(parseHarnessDesignDocument({...d,physicalTopology:routed}).physicalTopology).toEqual(routed);
 expect(routePhysicalWires(d,d.physicalTopology!).routes).toEqual(d.physicalTopology!.routes);
 expect(d.wires[0]!.from.contactId).toEqual(d.wires[1]!.from.contactId);
 const noExit={...t,nodes:t.nodes.map(n=>n.connectorId==="A"?{...n,wireIds:[]}:n)};
 expect(routePhysicalWires(d,noExit).routes.some(r=>r.wireId==="W1"||r.wireId==="W2")).toBe(false);
});
