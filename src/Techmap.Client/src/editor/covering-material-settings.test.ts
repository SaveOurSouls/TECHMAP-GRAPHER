import {expect,it,vi} from "vitest";
import {isValidElement,type ReactNode,type ReactElement} from "react";
import {CoveringMaterialSettings} from "./CoveringMaterialSettings";
import {physicalFixture} from "./physical-topology-fixture";
import {applyEditorCommand} from "./commands";
import {parseRuntimeConfig} from "../runtime-config";
import type {DrawingDocuments} from "./drawing-documents";
vi.mock("react",async original=>({...await original<typeof import("react")>(),useRef:(current:unknown)=>({current}),useState:(value:unknown)=>[value,vi.fn()],useEffect:()=>{}}));
vi.mock("./editor-reference-catalog",()=>({useEditorReferenceCatalog:()=>({query:"",items:[],message:"",hasMore:false,selectSource:vi.fn()})}));
vi.mock("../component-library/image-import",()=>({IMAGE_IMPORT_ACCEPT:".png,.jpg,.svg"}));
function elements(node:ReactNode):ReactElement<Record<string,any>>[]{
  if(Array.isArray(node))return node.flatMap(elements);if(!isValidElement<Record<string,any>>(node))return [];
  return [node,...elements(node.props.children)];
}
const hash="f".repeat(64),entry={sha256:hash,name:"texture.png"};
function setup(){let document=physicalFixture();const upload=vi.fn(async()=>entry);
 const tree=CoveringMaterialSettings({document,upload,urls:{},assetError:"",onClose:vi.fn(),onChange:(documents:DrawingDocuments)=>{document=applyEditorCommand(document,{type:"set-drawing-documents",documents});return true;},config:parseRuntimeConfig({configVersion:1,basePath:"/",apiBasePath:"/api/v1/",appVersion:"1",apiVersion:"1",schemaVersion:"20"}),session:{csrfNonce:"A".repeat(43),instanceId:"12345678-1234-4123-8123-123456789abc"}});
 return {tree,upload,current:()=>document};
}
it("dropping onto a type row uploads and sets that type's preference without changing others",async()=>{
 const s=setup(),row=elements(s.tree).find(e=>e.type==="tr"&&e.key==="nylon")!,file=new File(["image"],"texture.png"),preventDefault=vi.fn();
 row.props.onDrop({preventDefault,dataTransfer:{files:[file]}});await vi.waitFor(()=>expect(s.current().drawingDocuments?.coveringLibrary).toEqual({textures:[entry],defaults:{nylon:{texture:`asset:${hash}`}}}));
 expect(preventDefault).toHaveBeenCalled();expect(s.upload).toHaveBeenCalledExactlyOnceWith(file);
});
it("file picker adds a reusable texture and clears the input for reselecting the same file",async()=>{
 const s=setup(),input=elements(s.tree).find(e=>e.props['aria-label']==="Загрузить текстуру")!,target={files:[new File(["image"],"texture.png")],value:"chosen"};
 input.props.onChange({target});await vi.waitFor(()=>expect(s.current().drawingDocuments?.coveringLibrary).toEqual({textures:[entry],defaults:{}}));
 expect(target.value).toBe("");
});
