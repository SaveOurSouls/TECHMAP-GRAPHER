import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createEmptyHarnessDesign, type HarnessDesignDocument } from "../editor/model";
import { createConnector, createWire } from "../editor/commands";
import { CutDiagramPanel } from "../editor/CutDiagramPanel";
import { buildLiveCutList } from "../editor/live-cut-list";
import { generateRoute, updateRouteRow } from "./route-commands";
import { routeCutReadiness } from "./route-cut-readiness";
import type { RouteOperation } from "./route-model";

const sha = "a".repeat(64);
const binding: NonNullable<RouteOperation["binding"]> = { sourceId: "ops", entityType: "operation", snapshotId: "11111111-1111-4111-8111-111111111111", snapshotSha256: sha, recordId: "b".repeat(64), sourceKey: "cut", displayName: "Резка" };
function prepared(): HarnessDesignDocument {
  const a=createConnector("a","X1",1,{x:0,y:0}),b=createConnector("b","X2",1,{x:300,y:0});
  let doc:HarnessDesignDocument={...createEmptyHarnessDesign(),connectors:[a,b],wires:[{...createWire("w",{connectorId:"a",contactId:a.contacts[0]!.id},{connectorId:"b",contactId:b.contacts[0]!.id},null),lengthMm:100}],cables:[{id:"cable",memberWireIds:["w"],lengthMm:150,endCorrectionFromMm:0,endCorrectionToMm:0,cutRoundingStepMm:1}],physicalTopology:{snap:false,nodes:[],segments:[],routes:[],coverings:[{id:"cover",name:"Оплётка",spans:[{segmentId:"s",from:0,to:1,fromAnchor:0,toAnchor:2}],width:20,color:"#000000",lengthMode:"auto",lengthMm:null}]},drawingDocuments:{tables:[],leaders:[],bomOrder:[],dimensions:[{id:"d",segmentId:"s",from:0,to:2,pointCount:3,routeKey:"s",mode:"path",offset:20,lengthMm:120.125}]}};
  let route=generateRoute(doc,sha);
  for(const row of route.rows)if(row.sourceObjects[0]!.kind!=="wire")route=updateRouteRow(route,row.id,{prepared:true,operations:[{id:`cut-${row.id}`,binding,mode:"cut",note:""}]});
  return {...doc,manufacturingRoute:route};
}
describe("route cut readiness",()=>{
  it("blocks absent/stale/unsaved routes and accepts prepared cable and covering without counting member twice",()=>{
    const doc=prepared();
    expect(routeCutReadiness({...doc,manufacturingRoute:undefined},sha).code).toBe("route_cut_not_prepared");
    expect(routeCutReadiness(doc,"b".repeat(64)).code).toBe("route_source_stale");
    expect(routeCutReadiness(doc,sha,true).ready).toBe(false);
    expect(routeCutReadiness(doc,sha).ready).toBe(true);
    const cut=buildLiveCutList(doc,"p","h",3);
    expect(cut.items.map(item=>item.sourceKind)).toEqual(["cable","covering"]);
    expect(cut.items[1]).toMatchObject({wireId:"cover",cutLengthMm:120.125,totalMetres:.360375});
  });
  it.each(["strip-from","strip-to","strip-both","tin","assembly"] as const)("does not count %s as a cutting operation",mode=>{
    const doc=prepared(), route=doc.manufacturingRoute!;
    const cable=route.rows.find(row=>row.sourceObjects[0]!.kind==="cable")!;
    expect(routeCutReadiness({...doc,manufacturingRoute:updateRouteRow(route,cable.id,{prepared:true,operations:[{id:"op",binding,mode,note:""}]})},sha).ready).toBe(false);
  });
  it("blocks unbound cutting operations and missing covering preparation",()=>{
    const doc=prepared(),route=doc.manufacturingRoute!,cover=route.rows.find(row=>row.sourceObjects[0]!.kind==="covering")!;
    expect(routeCutReadiness({...doc,manufacturingRoute:updateRouteRow(route,cover.id,{prepared:true,operations:[{id:"op",binding:null,mode:"cut",note:""}]})},sha).ready).toBe(false);
    expect(routeCutReadiness({...doc,manufacturingRoute:{...route,rows:route.rows.filter(row=>row.id!==cover.id)}},sha).ready).toBe(false);
  });
  it("hides an already open cut table when dimensions change and source hash becomes stale",()=>{
    const doc=prepared();
    const markup=renderToStaticMarkup(createElement(CutDiagramPanel,{document:doc,quantity:3,revision:2,unsaved:false,sourceFingerprint:"b".repeat(64),embedded:true,relatedIds:[],onReveal:()=>{},onCommand:()=>true}));
    expect(markup).toContain("Карта резки недоступна"); expect(markup).not.toContain('<table');
    const ready=renderToStaticMarkup(createElement(CutDiagramPanel,{document:doc,quantity:3,revision:2,unsaved:false,sourceFingerprint:sha,embedded:true,relatedIds:[],onReveal:()=>{},onCommand:()=>true}));
    expect(ready).toContain("120,125 мм"); expect(ready).toContain("Оплётка");
  });
  it("does not derive covering millimetres from geometry when explicit anchors are absent",()=>{
    const doc=prepared(),topology=doc.physicalTopology!,cover=topology.coverings![0]!;
    const missing={...doc,physicalTopology:{...topology,coverings:[{...cover,spans:[{segmentId:"s",from:0,to:1}]}]}};
    expect(buildLiveCutList(missing,"p","h",1).items.find(i=>i.sourceKind==="covering")?.cutLengthMm).toBeNull();
  });
});
