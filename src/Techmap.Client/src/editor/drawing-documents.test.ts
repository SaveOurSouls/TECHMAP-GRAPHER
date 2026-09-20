import { describe, expect, it } from "vitest";
import { physicalFixture } from "./physical-topology-fixture";
import { buildDrawingBom, drawingDocumentScene, emptyDrawingDocuments, moveDrawingAnnotation } from "./drawing-documents";
import { applyEditorCommand } from "./commands";
import { parseHarnessDesignDocument, type WireMaterialBinding } from "./model";
import { createEditorHistory, executeEditorCommand, undoEditorCommand } from "./history";

const material:WireMaterialBinding={sourceId:"source",snapshotId:"00000000-0000-4000-8000-000000000001",snapshotSha256:"a".repeat(64),recordId:"b".repeat(64),entityType:"wire",sourceKey:"SAME",displayName:"Провод"};
describe("drawing tables and position leaders",()=>{
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
});
