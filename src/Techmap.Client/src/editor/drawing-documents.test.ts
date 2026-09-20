import { describe, expect, it } from "vitest";
import { physicalFixture } from "./physical-topology-fixture";
import { buildDrawingBom, drawingDocumentScene, emptyDrawingDocuments, moveDrawingAnnotation } from "./drawing-documents";
import { applyEditorCommand } from "./commands";
import { parseHarnessDesignDocument, type WireMaterialBinding } from "./model";
import { createEditorHistory, executeEditorCommand, undoEditorCommand } from "./history";

const material:WireMaterialBinding={sourceId:"source",snapshotId:"00000000-0000-4000-8000-000000000001",snapshotSha256:"a".repeat(64),recordId:"b".repeat(64),entityType:"wire",sourceKey:"SAME",displayName:"Провод"};
import { dimensionRouteKey, measuredWireLength, validateDrawingDimensions } from "./drawing-dimensions";
import { tableWindowPosition, tableWindowStyle, resizeTableWindow } from "./DrawingTableWindows";

describe("drawing tables and position leaders",()=>{
  it("preserves resized windows through serialization and a single Undo",()=>{
    const table={id:"T",kind:"bom" as const,position:{x:10,y:20}};
    const d={...physicalFixture(),drawingDocuments:{...emptyDrawingDocuments(),tables:[table]}};
    const size=resizeTableWindow({width:760,height:380},120,60);
    const h=executeEditorCommand(createEditorHistory(d),{type:"set-drawing-documents",documents:{...d.drawingDocuments,tables:[{...table,...size}]}});
    const saved=parseHarnessDesignDocument(JSON.parse(JSON.stringify(h.present)));
    expect(saved.drawingDocuments!.tables[0]).toEqual({...table,width:880,height:440});
    expect(tableWindowStyle(saved.drawingDocuments!.tables[0]!,{offsetX:2,offsetY:3,zoom:2})).toEqual({left:22,top:43,width:880,height:440});
    expect(undoEditorCommand(h).present).toBe(d);
    expect(tableWindowStyle(table,{offsetX:0,offsetY:0,zoom:1})).toMatchObject({width:760,height:380});
  });
  it("resizes away from the pinned edge and limits window size",()=>{
    expect(resizeTableWindow({width:760,height:380},-100,80,"right")).toEqual({width:860,height:460});
    expect(resizeTableWindow({width:760,height:380},100,-80,"bottom")).toEqual({width:860,height:460});
    expect(resizeTableWindow({width:760,height:380},-9999,-9999)).toEqual({width:280,height:160});
    expect(resizeTableWindow({width:760,height:380},9999,9999)).toEqual({width:4000,height:4000});
  });
  it.each([{width:279},{height:159},{width:4001},{height:4001},{width:null},{width:"760"},{height:NaN}])("rejects invalid window size %j",size=>{
    expect(()=>parseHarnessDesignDocument({...physicalFixture(),drawingDocuments:{...emptyDrawingDocuments(),tables:[{id:"T",kind:"bom",position:{x:0,y:0},...size}]}})).toThrow();
  });
  it("keeps source versions separate, sums exactly and excludes material cable members",()=>{
    const d=physicalFixture();
    const doc={...d,wires:d.wires.map((w,i)=>({...w,lengthMm:100.1,cutRoundingStepMm:.001,materialBinding:i===2?{...material,snapshotSha256:"c".repeat(64)}:material}))};
    const rows=buildDrawingBom(doc,3).filter(r=>r.unit==="м");
    expect(rows).toHaveLength(2);expect(rows[0]).toMatchObject({amount:.6006,objectIds:["W1","W2"]});expect(rows[1]!.amount).toBe(.3003);
    const cable={id:"K",memberWireIds:["W1","W2"],materialBinding:{...material,entityType:"cable" as const},lengthMm:200,endCorrectionFromMm:0,endCorrectionToMm:0,cutRoundingStepMm:1};
    expect(buildDrawingBom({...doc,cables:[cable]},2).filter(r=>r.unit==="м").map(r=>r.objectIds)).toEqual([["W3"],["K"]]);
  });
  it("retains unknown length and never counts graphics as additional material",()=>{
    const d=physicalFixture();
    const rows=buildDrawingBom({...d,wires:d.wires.map(w=>({...w,lengthMm:null})),physicalTopology:{...d.physicalTopology!,coverings:[{id:"cover",name:"shell",width:14,color:"#123456",lengthMm:100,spans:[{segmentId:"S0",from:0,to:1}]}]}});
    expect(rows.filter(r=>r.unit==="м").every(r=>r.amount===null)).toBe(true);expect(rows.some(r=>r.objectIds.includes("cover"))).toBe(false);
  });
  it("moves circle and anchor independently, follows object moves and renumbers from BOM",()=>{
    const d=physicalFixture(),rows=buildDrawingBom(d),key=rows.find(r=>r.objectIds.includes("A"))!.key;
    const docs={...emptyDrawingDocuments(),leaders:[{id:"L",objectId:"A",rowKey:key,anchorOffset:{x:10,y:20},circle:{x:300,y:100}}]};
    let doc=applyEditorCommand(d,{type:"set-drawing-documents",documents:docs});
    const moved=moveDrawingAnnotation(doc,"L",{x:400,y:200})!;
    expect(moved.leaders[0]!.anchorOffset).toEqual({x:10,y:20});expect(moved.leaders[0]!.circle).toEqual({x:412,y:212});
    doc={...doc,drawingDocuments:moved};
    const anchor=moveDrawingAnnotation(doc,"L:anchor",{x:36,y:46})!;
    expect(anchor.leaders[0]!.circle).toEqual({x:412,y:212});expect(anchor.leaders[0]!.anchorOffset).toEqual({x:40,y:50});
    doc=applyEditorCommand({...doc,drawingDocuments:anchor},{type:"move-connector",connectorId:"A",view:"drawing",position:{x:100,y:150}});
    expect(drawingDocumentScene(doc).find(o=>o.id==="L")!.points![0]).toEqual({x:140,y:200});
    const reverse={...doc,drawingDocuments:{...anchor,bomOrder:rows.map(r=>r.key).reverse()}};
    expect(drawingDocumentScene(reverse).find(o=>o.id==="L")!.label).toBe(String(rows.length));
  });
  it("round trips annotations, supports Undo and diagnoses deleted targets",()=>{
    const d=physicalFixture(),key=buildDrawingBom(d)[0]!.key;
    const documents={tables:[{id:"T",kind:"bom" as const,position:{x:100,y:200}}],leaders:[{id:"L",objectId:"A",rowKey:key,anchorOffset:{x:0,y:0},circle:{x:300,y:100}}],bomOrder:[key]};
    const h=executeEditorCommand(createEditorHistory(d),{type:"set-drawing-documents",documents});
    expect(parseHarnessDesignDocument(JSON.parse(JSON.stringify(h.present))).drawingDocuments).toEqual(documents);
    expect(undoEditorCommand(h).present).toBe(d);
    expect(JSON.parse(drawingDocumentScene(h.present)[0]!.metadata!.headers!)).toEqual(["Поз.","Обозначение","Наименование","Кол-во","Примечание"]);
    expect(drawingDocumentScene({...h.present,connectors:[]}).find(o=>o.id==="L")!.label).toBe("?");
    expect(()=>parseHarnessDesignDocument({...h.present,drawingDocuments:{...documents,tables:[{...documents.tables[0],position:{x:NaN,y:0}}]}})).toThrow();
  });
  it("keeps floating coordinates in drawing space and docking independent of camera",()=>{
    const table={id:"cut",kind:"cut" as const,position:{x:100,y:200}};
    expect(tableWindowPosition(table,{offsetX:10,offsetY:20,zoom:2})).toEqual({left:210,top:420});
    expect(tableWindowPosition({...table,dock:"right"},{offsetX:-1000,offsetY:-2000,zoom:.2})).toEqual({right:8,top:8});
    const d=physicalFixture(),key=buildDrawingBom(d)[0]!.key;
    const documents={...emptyDrawingDocuments(),tables:[{...table,dock:"bottom" as const}],bomText:{[key]:{name:"Edited",note:"Note"}}};
    const h=executeEditorCommand(createEditorHistory(d),{type:"set-drawing-documents",documents});
    expect(parseHarnessDesignDocument(JSON.parse(JSON.stringify(h.present))).drawingDocuments).toEqual(documents);
    expect(buildDrawingBom(h.present)[0]).toMatchObject({name:"Edited",note:"Note"});
    expect(undoEditorCommand(h).present).toBe(d);
    expect(()=>parseHarnessDesignDocument({...h.present,drawingDocuments:{...documents,tables:[{...table,dock:"bad"}]}})).toThrow();
  });

  it("calculates a total dimension or a complete sum of non-overlapping sections",()=>{
    const d=physicalFixture(),wire=d.wires[0]!,key=dimensionRouteKey(d,wire);
    expect(measuredWireLength([{id:"a",wireId:wire.id,from:0,to:3,pointCount:4,routeKey:key,mode:"aligned",offset:20,lengthMm:350}])).toBe(350);
    expect(measuredWireLength([
      {id:"a",wireId:wire.id,from:0,to:1,pointCount:4,routeKey:key,mode:"horizontal",offset:20,lengthMm:100},
      {id:"b",wireId:wire.id,from:1,to:3,pointCount:4,routeKey:key,mode:"vertical",offset:20,lengthMm:250},
    ])).toBe(350);
    expect(measuredWireLength([{id:"a",wireId:wire.id,from:0,to:1,pointCount:4,routeKey:key,mode:"aligned",offset:20,lengthMm:100}])).toBeNull();
    expect(()=>measuredWireLength([{id:"a",wireId:wire.id,from:0,to:2,pointCount:4,routeKey:key,mode:"aligned",offset:20,lengthMm:100},{id:"b",wireId:wire.id,from:1,to:3,pointCount:4,routeKey:key,mode:"aligned",offset:20,lengthMm:250}])).toThrow();
    expect(validateDrawingDimensions([{id:"a",wireId:wire.id,from:0,to:3,pointCount:4,routeKey:key,mode:"aligned",offset:20,lengthMm:350}],d)).toHaveLength(1);
    expect(()=>validateDrawingDimensions([{id:"a",wireId:wire.id,from:0,to:3,pointCount:4,routeKey:"stale",mode:"aligned",offset:20,lengthMm:350}],d)).toThrow();
  });

});
