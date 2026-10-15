import { describe,expect,it } from "vitest";
import { artworkJacketAnchor,artworkWireDiameter,renderPartSvg } from "../wire-blank-artwork.mjs";
import { BUILTIN_TERMINATION_RECORDS,createTerminationPlacement } from "../termination-library";
import { applyEditorCommand,createConnector,createWire } from "./commands";
import { createEmptyHarnessDesign,connectorContactPosition,parseHarnessDesignDocument,calculateWireCutLength,createOrthogonalE4Route,wireEndpointE4Anchor,type HarnessDesignDocument } from "./model";
import { dimensionRouteKey,dimensionTargetPoints,dimensionDisplayPoints,drawingDimensionScene,setPipeIntervalLength,type DrawingDimension } from "./drawing-dimensions";
import { drawingWireWidth } from "./drawing-thickness";
import { emptyTerminationDocument,type EndPreparationMode } from "./termination-model";
import { wireDimensionEnd } from "./drawing-dimension-anchors";
import { createEditorHistory,executeEditorCommand,undoEditorCommand } from "./history";

function fixture(assetId="preparation-copper",angle=0,scale=1):HarnessDesignDocument {
 const placement=createTerminationPlacement(BUILTIN_TERMINATION_RECORDS.find(r=>r.assetId===assetId)!,{id:"p",designation:"P1",position:{x:300,y:100}});
 const p={...placement.connector,drawingPlacements:[{drawingId:"view:drawing",visible:true,offset:{x:0,y:0},rotationDegrees:angle,scale}]};
 const source=createConnector("source","X1",1,{x:0,y:100});
 const wire=createWire("w",{connectorId:source.id,contactId:source.contacts[0]!.id},{connectorId:p.id,contactId:p.contacts[0]!.id},350);
 const d={...createEmptyHarnessDesign(),connectors:[source,p],wires:[{...wire,drawingRoute:[{x:200,y:150}]}],...(placement.artifact?{terminations:{...emptyTerminationDocument(),artifacts:[placement.artifact]}}:{})};
 return {...d,wires:d.wires.map(w=>({...w,e4Route:createOrthogonalE4Route(wireEndpointE4Anchor(d,w.from)!,wireEndpointE4Anchor(d,w.to)!)}))};
}
function dimension(d:HarnessDesignDocument):DrawingDimension {
 const wire=d.wires[0]!;
 return {id:"d",wireId:wire.id,from:0,to:2,pointCount:3,routeKey:dimensionRouteKey(d,wire),mode:"horizontal",offset:60,lengthMm:350};
}
function withPipe(d:HarnessDesignDocument):HarnessDesignDocument {
 return {...d,physicalTopology:{snap:false,nodes:[{id:"start",position:{x:180,y:130}},{id:"end",connectorId:"p",position:{x:170,y:60}}],segments:[{id:"pipe",from:"start",to:"end",path:{kind:"polyline",points:[]}}],routes:[{wireId:"w",steps:[{segmentId:"pipe",reverse:false}]}]}};
}

describe("dimension termination anchors (REQ-149, C1/C2)",()=>{
 it.each(["copper","tin"] as const)("C1 includes the complete %s artwork at either wire end",mode=>{
  const base=fixture(),p=base.connectors[1]!,contact=connectorContactPosition(p,p.contacts[0]!.id,"drawing")!;
  for(const end of ["from","to"] as const){
   const original=base.wires[0]!,wire=end==="to"?original:{...original,from:original.to,to:original.from};
   const d={...base,wires:[wire],terminations:{...emptyTerminationDocument(),endPreparations:[{id:"override",wireId:"w",end,mode}]}};
   const anchor=wireDimensionEnd(d,wire,end)!,adjacent=wire.drawingRoute[0]!;
   const svg=renderPartSvg(mode,wire.color),path=svg.match(/<path d="M([\d.]+) 112H220V128H158Z"[^>]+stroke-width="([\d.]+)"/)!;
   expect(path).not.toBeNull();
   const extension=(artworkJacketAnchor-(Number(path[1])-Number(path[2])/2))*drawingWireWidth(d,wire)/artworkWireDiameter;
   expect(Math.hypot(anchor.x-contact.x,anchor.y-contact.y)).toBeCloseTo(extension);
   expect((anchor.x-contact.x)*(contact.x-adjacent.x)+(anchor.y-contact.y)*(contact.y-adjacent.y)).toBeGreaterThan(0);
   const points=dimensionTargetPoints(d,dimension(d));
   expect(end==="to"?points.at(-1):points[0]).toEqual(anchor);
  }
 });
 it.each([[0,.5],[90,2],[-45,1]])("follows rotated/scaled P1 and the drawing wire width (%s, %s)",(angle,scale)=>{
  const d=fixture("preparation-copper",angle,scale),wire=d.wires[0]!,contact=connectorContactPosition(d.connectors[1]!,wire.to.contactId!,"drawing")!;
  for(const physicalScale of [.2,1,8]){
   const drawing={...d,drawingDocuments:{tables:[],leaders:[],bomOrder:[],physicalScale}};
   const end=wireDimensionEnd(drawing,wire,"to")!;
   expect(Math.hypot(end.x-contact.x,end.y-contact.y)).toBeCloseTo(64.55*drawingWireWidth(drawing,wire)/artworkWireDiameter);
   const display=dimensionDisplayPoints(drawing,dimension(drawing));
   expect(display.at(-1)).toEqual(end);expect(display.at(-2)!.x).toBeCloseTo(end.x);
  }
 });
 it.each(["cut","pin","socket","pin-sealed","socket-sealed","lug"] as EndPreparationMode[])("measures P1 mode %s at its input, without adding the fitting length",mode=>{
  const base=fixture(),p=base.connectors[1]!,d={...base,connectors:[base.connectors[0]!,{...p,terminationComponent:{...p.terminationComponent!,preparationMode:mode}}]};
  expect(dimensionTargetPoints(d,dimension(d)).at(-1)).toEqual(connectorContactPosition(d.connectors[1]!,p.contacts[0]!.id,"drawing"));
 });
 it.each(["nki-ring","nshvi-double","preparation-pin-seal"])("C2 uses the physical joint of %s and follows its independent movement",asset=>{
  const base=withPipe(fixture(asset,45,2));
  const d={...base,drawingDocuments:{...setPipeIntervalLength(base,"pipe",0,1,350),showDimensions:true}};
  const dim=d.drawingDocuments.dimensions![0]!;
  const joint={x:300+(170-60)*Math.SQRT2,y:100+(170+60)*Math.SQRT2};
  expect(dimensionTargetPoints(d,dim).at(-1)!.x).toBeCloseTo(joint.x);
  expect(dimensionTargetPoints(d,dim).at(-1)!.y).toBeCloseTo(joint.y);
  const moved=executeEditorCommand(createEditorHistory(d),{type:"move-physical-node",nodeId:"end",position:{x:600,y:250},mode:"adjacent"});
  expect(dimensionTargetPoints(moved.present,dim).at(-1)).toEqual({x:600,y:250});
  expect(moved.present.wires.map(w=>[w.from,w.to,w.lengthMm])).toEqual(d.wires.map(w=>[w.from,w.to,w.lengthMm]));
  expect(undoEditorCommand(moved).present).toBe(d);
  const reopened=parseHarnessDesignDocument(JSON.parse(JSON.stringify(moved.present)));
  expect(dimensionTargetPoints(reopened,dim).at(-1)).toEqual({x:600,y:250});
 });
 it("C1 pipe dimensions include the P1 wire tail rather than the legacy physical node or fallback frame",()=>{
  const d=withPipe(fixture()),dim=setPipeIntervalLength(d,"pipe",0,1,350).dimensions![0]!;
  expect(dimensionTargetPoints(d,dim).at(-1)).toEqual(wireDimensionEnd(d,d.wires[0]!,"to"));
 });
 it("keeps the same copper anchor when the physical pipe direction is reversed",()=>{
  const base=withPipe(fixture()),t=base.physicalTopology!,s=t.segments[0]!;
  const d={...base,physicalTopology:{...t,segments:[{...s,from:s.to,to:s.from}],routes:[{wireId:"w",steps:[{segmentId:s.id,reverse:true}]}]}};
  const dim=setPipeIntervalLength(d,s.id,0,1,350).dimensions![0]!;
  expect(dimensionTargetPoints(d,dim)[0]).toEqual(wireDimensionEnd(d,d.wires[0]!,"to"));
 });
 it("does not retarget another exit of the same P1 to the wire's copper",()=>{
  const base=withPipe(fixture()),t=base.physicalTopology!;
  const d={...base,physicalTopology:{...t,nodes:[...t.nodes,{id:"other-exit",connectorId:"p",position:{x:220,y:10}}],segments:[...t.segments,{id:"other-pipe",from:"end",to:"other-exit",path:{kind:"polyline" as const,points:[]}}],routes:[{wireId:"w",steps:[{segmentId:"pipe",reverse:false},{segmentId:"other-pipe",reverse:false}]}]}};
  const dim=setPipeIntervalLength(d,"pipe",0,1,350).dimensions![0]!;
  expect(dimensionTargetPoints(d,dim).at(-1)).toEqual({x:470,y:160});
 });
 it("keeps end styles of an isolated wire independent of its source connector",()=>{
  const base=fixture("nki-ring"),wire={...base.wires[0]!,drawingEndpoints:{from:{x:0,y:0},to:{x:100,y:0}},drawingRoute:[],drawingEndStyles:{from:"copper" as const,to:"sealed" as const}},d={...base,wires:[wire]};
  const dim={...dimension(d),to:1,pointCount:2};
  expect(dimensionTargetPoints(d,dim)[0]).toEqual(wire.drawingEndpoints.from);
  expect(dimensionTargetPoints(d,dim).at(-1)).toEqual(wire.drawingEndpoints.to);
 });
 it("uses identical legacy/explicit anchors and leaves connections, lengths and the serialized model unchanged",()=>{
  const base=fixture(),wire=base.wires[0]!,before=JSON.stringify(base),length=calculateWireCutLength(wire);
  const legacy=drawingDimensionScene(base).find(o=>o.id==="dimension:w")!;
  const measured=applyEditorCommand(base,{type:"set-drawing-documents",documents:{tables:[],leaders:[],bomOrder:[],dimensions:[dimension(base)]}});
  expect(drawingDimensionScene(measured)[0]!.points!.at(-1)).toEqual(legacy.points!.at(-1));
  expect(JSON.stringify(base)).toBe(before);expect(calculateWireCutLength(measured.wires[0]!)).toEqual(length);
 });
});
