import {describe,it,expect} from "vitest";
import {newTemplateContentV3,addBasicNodeV3,addContactPointV3,addArticleVariantsV3,addContactTypeGroupV3,setArticleVariantContactGroupV3} from "./template-commands-v3";
import {createE4ConnectorSeriesTableFromV3} from "./e4-connector-series-table";
import {setDrawingArray} from "./drawing-array-commands";
import {drawingArrayContactRows} from "./drawing-array-contacts";
import {drawingSelection} from "./drawing-bindings";
import {createTemplateContentV5FromEditor,validateTemplateContentV5} from "./template-model-v5";
import {createConnectorInstanceFromComponentTemplateV3} from "../editor/component-template-placement";
describe("drawing arrays with table-bound contacts",()=>{
 it("repeats two pins through an incomplete last element and preserves row identities on placement",()=>{
  let core=newTemplateContentV3();const view=core.views[1]!,layer=view.layers[0]!;let group:string;
  [core,group]=addContactTypeGroupV3(core,"Signal");
  core=addArticleVariantsV3(core,[{sourceId:"test",entityType:"connector",articleKey:"A2"},{sourceId:"test",entityType:"connector",articleKey:"A5"}]);
  core=setArticleVariantContactGroupV3(core,core.articleVariants[0]!.id,group,2,[]);
  core=setArticleVariantContactGroupV3(core,core.articleVariants[1]!.id,group,5,[]);
  const table=createE4ConnectorSeriesTableFromV3(core,true),bindings=[],selection:string[]=[];
  let id:string;[core,id]=addBasicNodeV3(core,view.id,layer.id,"rectangle");selection.push(id);
  for(let i=0;i<2;i++){[core,id]=addContactPointV3(core,view.id,{number:String(i+1),name:"Pin",contactTypeGroupId:group});selection.push(id);bindings.push({logicalContactId:core.views[1]!.contactPoints.at(-1)!.logicalContactId,seriesRowId:table.seriesDefaults[i]!.rowId});}
  core=setDrawingArray(core,view.id,layer.id,selection,{rows:2,direction:"short-side",numbering:"snake",countSource:"article",count:2,pitchX:20,pitchY:30});
  expect(core.logicalContacts).toHaveLength(2);
  const article=core.articleVariants[1]!;
  const labels=drawingArrayContactRows(core,table,bindings,article.id);
  expect(labels.filter(p=>p.row).map(p=>p.row!.number)).toEqual(["1","2","3","4","5"]);
  expect(labels.filter(p=>!p.row)).toHaveLength(1);
  const drawing={...drawingSelection(core.views[1]!,[core.views[1]!.repeatPlacements[0]!.prototypeGroupId],article.id),target:"drawing" as const,viewId:view.id};
  const content=createTemplateContentV5FromEditor(core,table,[],[],undefined,[drawing],bindings).content;
  expect(validateTemplateContentV5(content).valid).toBe(true);
  const placed=createConnectorInstanceFromComponentTemplateV3({templateId:"t",version:1,versionSha256:"a".repeat(64),code:"S",name:"Series",assets:[],articleBindings:[],content},{id:"x",designation:"X1",articleVariantId:article.id,e4Position:{x:0,y:0}});
  expect(placed.contacts).toHaveLength(5);
  if(placed.libraryBinding?.mode!=="template")throw new Error("Missing binding");
  expect(placed.libraryBinding.snapshot.contacts.map(c=>c.representations.length)).toEqual([1,1,1,1,1]);
  expect(new Set(placed.contacts.map(c=>c.id)).size).toBe(5);
 });
});
