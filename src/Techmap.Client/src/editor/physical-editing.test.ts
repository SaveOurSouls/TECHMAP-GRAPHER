import {expect,it} from "vitest";
import {physicalFixture} from "./physical-topology-fixture";
import {physicalEditablePoints,snapPhysicalPoint,physicalObjectSnapAnchors} from "./physical-editing";
import {applyEditorCommand} from "./commands";
import {createEditorHistory,executeEditorCommand,undoEditorCommand} from "./history";
import {parseHarnessDesignDocument} from "./model";
import {setPipeIntervalLength} from "./drawing-dimensions";
import {routePhysicalWires} from "./physical-wire-routing";

function fixture(){const d=physicalFixture();return {...d,physicalTopology:{...d.physicalTopology!,snap:false,
 nodes:[{id:"a",position:{x:0,y:0}},{id:"b",position:{x:300,y:100}}],routes:[],
 segments:[{id:"pipe",from:"a",to:"b",path:{kind:"polyline" as const,points:[{x:80,y:0},{x:150,y:70},{x:220,y:70}]}}]}};}
it("carries neighboring shoulders normally and only the selected corner with Shift",()=>{
 const d=fixture();
 const command={type:"edit-physical-bend" as const,segmentId:"pipe",index:1,position:{x:170,y:110}};
 const normal=applyEditorCommand(d,{...command,mode:"carry"}),shift=applyEditorCommand(d,{...command,mode:"adjacent"});
 expect(normal.physicalTopology!.segments[0]!.path.points).toEqual([{x:100,y:40},{x:170,y:110},{x:240,y:110}]);
 expect(shift.physicalTopology!.segments[0]!.path.points).toEqual([{x:80,y:0},{x:170,y:110},{x:220,y:70}]);
 expect(d.physicalTopology.segments[0]!.path.points[1]).toEqual({x:150,y:70});
});
it("moves a node with its nearest shoulder, preserving all distant corners",()=>{
 const d=fixture(),command={type:"move-physical-node" as const,nodeId:"a",position:{x:20,y:30}};
 const carry=applyEditorCommand(d,{...command,mode:"carry"}),shift=applyEditorCommand(d,{...command,mode:"adjacent"});
 expect(carry.physicalTopology!.segments[0]!.path.points).toEqual([{x:100,y:30},{x:150,y:70},{x:220,y:70}]);
 expect(shift.physicalTopology!.segments[0]!.path.points).toEqual(d.physicalTopology.segments[0]!.path.points);
});
it("carries the exit of an initially straight pipe and keeps its original direction",()=>{
 const d=fixture(),straight={...d,physicalTopology:{...d.physicalTopology,segments:[{...d.physicalTopology.segments[0]!,path:{kind:"polyline" as const,points:[]}}]}};
 const changed=applyEditorCommand(straight,{type:"move-physical-node",nodeId:"a",position:{x:20,y:30},mode:"carry"});
 const points=changed.physicalTopology!.segments[0]!.path.points;
 expect(points).toHaveLength(2);expect((points[0]!.x-20)/(points[0]!.y-30)).toBeCloseTo(3);
 expect(points[1]).toEqual({x:200,y:200/3});
});
it("aligns connectors using their exits rather than the picture origin",()=>{
 const objects=[{id:"A",kind:"connector",x:0,y:0},{id:"exitA",kind:"physical-node",x:145,y:95,port:{connectorId:"A"}},{id:"exitB",kind:"physical-node",x:345,y:195}];
 expect(physicalObjectSnapAnchors(objects,objects[0]!)).toEqual([{x:200,y:100}]);
});
it("deletes an automatic corner, keeps endpoints and returns through undo",()=>{
 const d=physicalFixture(),s=d.physicalTopology!.segments[1]!;
 const points=physicalEditablePoints(d,s);
 const h=executeEditorCommand(createEditorHistory(d),{type:"remove-physical-bend",segmentId:s.id,index:0});
 expect(h.present.physicalTopology!.segments[1]!.path.points).toEqual(points.slice(2,-1));
 expect(parseHarnessDesignDocument(JSON.parse(JSON.stringify(h.present))).physicalTopology).toEqual(h.present.physicalTopology);
 expect(undoEditorCommand(h).present).toBe(d);
});
it("refuses edits on locked layers and invalid geometry without changing the source",()=>{
 const base=fixture(),d={...base,views:{...base.views,drawing:{...base.views.drawing,layers:base.views.drawing.layers.map(l=>({...l,locked:l.id==="wires"}))}}};
 expect(()=>applyEditorCommand(d,{type:"edit-physical-bend",segmentId:"pipe",index:0,position:{x:30,y:40},mode:"carry"})).toThrow();
 expect(()=>applyEditorCommand(base,{type:"edit-physical-bend",segmentId:"pipe",index:0,position:{x:NaN,y:40},mode:"carry"})).toThrow();
 expect(base.physicalTopology.segments[0]!.path.points[0]).toEqual({x:80,y:0});
});
it("inserts a midpoint while remapping measured intervals and covering anchors",()=>{
 let d=fixture();
 const docs=setPipeIntervalLength(d,"pipe",0,4,150);
 const before={...d,drawingDocuments:docs,physicalTopology:{...d.physicalTopology,coverings:[{id:"c",name:"Cover",width:0,color:"#333333",lengthMm:null,spans:[{segmentId:"pipe",from:0,to:1,fromAnchor:0,toAnchor:4}]}]}};
 const history=executeEditorCommand(createEditorHistory(before),{type:"edit-physical-bend",segmentId:"pipe",index:1,position:{x:115,y:35},mode:"adjacent",insert:true});
 const after=history.present;
 expect(after.physicalTopology!.segments[0]!.path.points).toHaveLength(4);
 expect(after.drawingDocuments!.dimensions![0]).toMatchObject({from:0,to:5,pointCount:6,lengthMm:150});
 expect(after.physicalTopology!.coverings![0]!.spans[0]).toMatchObject({fromAnchor:0,toAnchor:5});
 expect(parseHarnessDesignDocument(JSON.parse(JSON.stringify(after))).physicalTopology).toEqual(after.physicalTopology);
 expect(undoEditorCommand(history).present).toBe(before);
});
it("materializes the entire automatic route on first edit without losing its endpoint dimension",()=>{
 const base=physicalFixture(),s=base.physicalTopology!.segments[1]!;
 const d={...base,drawingDocuments:setPipeIntervalLength(base,s.id,0,1,500)};
 const points=physicalEditablePoints(d,s);expect(points.length).toBeGreaterThan(2);
 const changed=applyEditorCommand(d,{type:"edit-physical-bend",segmentId:s.id,index:0,position:{x:points[1]!.x+20,y:points[1]!.y+10},mode:"adjacent"});
 expect(changed.physicalTopology!.segments[1]!.path.kind).toBe("polyline");
 expect(changed.physicalTopology!.segments[1]!.path.points.at(-1)).toEqual(points.at(-2));
 expect(changed.drawingDocuments!.dimensions![0]).toMatchObject({to:points.length-1,pointCount:points.length,lengthMm:500});
});
it("authors a dimension on visible automatic corners atomically and keeps it through move/save/undo",()=>{
 const base=physicalFixture(),s=base.physicalTopology!.segments[1]!,points=physicalEditablePoints(base,s);
 expect(points.length).toBeGreaterThan(2);
 const h=executeEditorCommand(createEditorHistory(base),{type:"add-visible-pipe-dimension",id:"dim-auto",segmentId:s.id,from:1,to:0,pointCount:points.length,mode:"aligned"});
 const d=h.present;
 expect(d.physicalTopology!.segments[1]!.path).toEqual({kind:"polyline",points:points.slice(1,-1)});
 expect(d.drawingDocuments!.dimensions![0]).toMatchObject({id:"dim-auto",from:0,to:1,pointCount:points.length});
 expect(d.drawingDocuments!.showDimensions).toBe(true);
 const moved=applyEditorCommand(d,{type:"edit-physical-bend",segmentId:s.id,index:0,position:{x:points[1]!.x+20,y:points[1]!.y+10},mode:"adjacent"});
 expect(moved.drawingDocuments!.dimensions).toEqual(d.drawingDocuments!.dimensions);
 expect(parseHarnessDesignDocument(JSON.parse(JSON.stringify(moved))).drawingDocuments).toEqual(moved.drawingDocuments);
 expect(undoEditorCommand(h).present).toBe(base);
});
it("rejects stale or locked automatic dimensions without materializing the source path",()=>{
 const base=physicalFixture(),s=base.physicalTopology!.segments[1]!;
 const cmd={type:"add-visible-pipe-dimension" as const,id:"dim",segmentId:s.id,from:0,to:1,pointCount:physicalEditablePoints(base,s).length,mode:"horizontal" as const};
 expect(()=>applyEditorCommand(base,{...cmd,pointCount:2})).toThrow("Трасса изменилась");
 for(const layer of ["dimensions","wires"]){
  const locked={...base,views:{...base.views,drawing:{...base.views.drawing,layers:base.views.drawing.layers.map(l=>({...l,locked:l.id===layer}))}}};
  expect(()=>applyEditorCommand(locked,cmd)).toThrow("заблокирован");
 }
 expect(s.path.kind).toBe("routed");expect(s.path.points).toEqual([]);
});
it("removes a straightened corner in normal mode but retains it in Shift mode",()=>{
 const d=fixture(),simple={...d,physicalTopology:{...d.physicalTopology,segments:[{...d.physicalTopology.segments[0]!,path:{kind:"polyline" as const,points:[{x:80,y:0}]}}]}};
 const cmd={type:"edit-physical-bend" as const,segmentId:"pipe",index:0,position:{x:150,y:50}};
 expect(applyEditorCommand(simple,{...cmd,mode:"carry"}).physicalTopology!.segments[0]!.path.points).toEqual([]);
 expect(applyEditorCommand(simple,{...cmd,mode:"adjacent"}).physicalTopology!.segments[0]!.path.points).toEqual([{x:150,y:50}]);
});
it("snaps horizontal, vertical and diagonal guides and supports a free mode",()=>{
 const anchor={x:0,y:0};
 for(const [point,target] of [[{x:50,y:1},{x:50,y:0}],[{x:1,y:50},{x:0,y:50}],[{x:49,y:51},{x:50,y:50}]] as const){
  const result=snapPhysicalPoint(point,[anchor],true,3);expect(result.point.x).toBeCloseTo(target.x);expect(result.point.y).toBeCloseTo(target.y);expect(result.guide).toBeDefined();
 }
 expect(snapPhysicalPoint({x:17,y:13},[anchor],false,3).point).toEqual({x:17,y:13});
});
it("updates automatic routes after geometry and dimensions change while retaining manual assignments",()=>{
 const base=physicalFixture();
 const t={...base.physicalTopology!,segments:[...base.physicalTopology!.segments,{id:"direct",from:"NA",to:"NB",path:{kind:"polyline" as const,points:[]}}],routes:[]};
 const routed={...base,physicalTopology:routePhysicalWires(base,t)};
 expect(routed.physicalTopology.routes.find(r=>r.wireId==="W1")!.steps).toHaveLength(1);
 const changed=applyEditorCommand(routed,{type:"set-physical-topology",topology:{...routed.physicalTopology,segments:routed.physicalTopology.segments.map(s=>s.id==="direct"?{...s,path:{kind:"polyline",points:[{x:10000,y:0}]}}:s)}});
 expect(changed.physicalTopology!.routes.find(r=>r.wireId==="W1")!.steps.map(s=>s.segmentId)).toEqual(["S0","S1"]);
 const reference={...routed,drawingDocuments:setPipeIntervalLength(routed,"S0",0,2,100)};
 const measured=applyEditorCommand(reference,{type:"set-drawing-documents",documents:setPipeIntervalLength(reference,"direct",0,1,100000)});
 expect(measured.physicalTopology!.routes.find(r=>r.wireId==="W1")!.steps.map(s=>s.segmentId)).toEqual(["S0","S1"]);
 const pinned={...routed,physicalTopology:{...routed.physicalTopology,routes:routed.physicalTopology.routes.map(r=>({...r,automatic:false}))}};
 const moved=applyEditorCommand(pinned,{type:"move-connector",connectorId:"A",view:"drawing",position:{x:2000,y:2000},physicalDragMode:"carry"});
 expect(moved.physicalTopology!.routes).toEqual(pinned.physicalTopology.routes);
});
