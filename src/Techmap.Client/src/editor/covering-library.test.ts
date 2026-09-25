import {expect,it,vi} from "vitest";
import {physicalFixture} from "./physical-topology-fixture";
import {standardCovering,type CoveringMaterial} from "./physical-coverings";
import {coveringScene} from "./covering-layout";
import {buildDrawingBom,emptyDrawingDocuments} from "./drawing-documents";
import {emptyCoveringLibrary,textureChoices,validateCoveringLibrary,type CoveringLibrary} from "./covering-library";
import {createCoveringAssetApi,withCoveringTextureUrls} from "./covering-assets";
import {parseHarnessDesignDocument} from "./model";
import {parseRuntimeConfig} from "../runtime-config";
import {applyEditorCommand} from "./commands";
vi.mock("../component-library/image-import",()=>({importDrawingImage:async()=>({fileName:"normalized.png",mediaType:"image/png",contentBase64:"normalized-content"})}));
const hash="a".repeat(64),texture=`asset:${hash}` as const;
const material:CoveringMaterial={sourceId:"technology-database",snapshotId:"12345678-1234-4123-8123-123456789abc",snapshotSha256:"b".repeat(64),recordId:"c".repeat(64),sourceKey:"HS-1",displayName:"Термоусадка HS-1",entityType:"protective-covering"};
const library:CoveringLibrary={textures:[{sha256:hash,name:"Полосы"}],defaults:{"heat-shrink":{texture,material}}};
it("new sleeves inherit texture and pinned material while placed materials survive preference edits",()=>{
  const base=physicalFixture(),d={...base,drawingDocuments:{...emptyDrawingDocuments(),coveringLibrary:library}};
  const cover=standardCovering(d,"S0",{x:200,y:60},"Термоусадка","new-cover");
  expect(cover.style?.texture).toBe(texture);expect(cover.material).toEqual(material);
  const withCover={...d,physicalTopology:{...d.physicalTopology!,coverings:[cover]}};
  const changed=applyEditorCommand(withCover,{type:"set-drawing-documents",documents:{...d.drawingDocuments,coveringLibrary:emptyCoveringLibrary()}});
  expect(changed.physicalTopology!.coverings![0]).toEqual(cover);
  expect(buildDrawingBom(changed).some(row=>row.name===material.displayName)).toBe(true);
  expect(parseHarnessDesignDocument(JSON.parse(JSON.stringify(withCover))).drawingDocuments?.coveringLibrary).toEqual(library);
});
it("automatic textures follow the type preference and resolve against the current project after import",()=>{
  const d=physicalFixture(),cover=standardCovering(d,"S0",{x:200,y:60},"Термоусадка","cover");
  const scene=coveringScene({...d,drawingDocuments:{...emptyDrawingDocuments(),coveringLibrary:library},physicalTopology:{...d.physicalTopology!,coverings:[cover]}});
  expect(withCoveringTextureUrls(scene,{[hash]:"/project-copy/attachment-new/content"})[0]!.metadata!.coveringTextureUrl).toBe("/project-copy/attachment-new/content");
  expect(withCoveringTextureUrls(scene,{})[0]!.metadata!.coveringTextureUrl).toBe("");
  expect(textureChoices(library).find(t=>t.value===texture)?.label).toBe("Полосы");
});
it.each([null,[],{textures:[],defaults:null},{textures:[{sha256:hash,name:""}],defaults:{}},{textures:[{sha256:hash,name:"a"},{sha256:hash,name:"b"}],defaults:{}},{textures:[],defaults:{braid:{texture}}},{textures:[],defaults:{invalid:{texture:"auto"}}},{textures:[],defaults:{braid:{texture:"none",material:{}}}}])("rejects invalid material preferences %j",value=>expect(()=>validateCoveringLibrary(value)).toThrow());
const config=parseRuntimeConfig({configVersion:1,basePath:"/prefix/",apiBasePath:"/prefix/api/v1/",appVersion:"1",apiVersion:"1",schemaVersion:"20"});
const session={csrfNonce:"A".repeat(43),instanceId:"12345678-1234-4123-8123-123456789abc"};
const attachment={attachmentId:"22345678-1234-4123-8123-123456789abc",sha256:hash,fileName:"stripes.png",mediaType:"image/png",purpose:"covering-texture"};
it("lists only texture PNG attachments and builds URLs under the project and prefix",async()=>{
  const fetcher=vi.fn<typeof fetch>(async()=>Response.json({attachments:[attachment,{...attachment,purpose:"user-document"}]}));
  const items=await createCoveringAssetApi(config,session,"project",fetcher).list();
  expect(items).toEqual([{entry:{sha256:hash,name:"stripes.png"},url:`/prefix/api/v1/projects/project/attachments/${attachment.attachmentId}/content`}]);
});
it("uploads normalized PNG with a fresh project revision, command id and CSRF",async()=>{
  const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({revision:7})).mockResolvedValueOnce(Response.json({attachment}));
  const entry=await createCoveringAssetApi(config,session,"project",fetcher).upload(new File(["fake"],"stripes.svg"));
  const init=fetcher.mock.calls[1]![1]!;expect(init.headers).toMatchObject({"X-Techmap-CSRF":session.csrfNonce});
  expect(JSON.parse(String(init.body))).toMatchObject({expectedRevision:7,mediaType:"image/png",fileName:"normalized.png",contentBase64:"normalized-content",purpose:"covering-texture",commandId:expect.any(String)});
  expect(entry.entry).toEqual({sha256:hash,name:"stripes.svg"});
});
it("reports revision conflict without retrying the upload or replacing project changes",async()=>{
  const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({revision:7})).mockResolvedValueOnce(new Response(null,{status:409}));
  await expect(createCoveringAssetApi(config,session,"project",fetcher).upload(new File(["fake"],"texture.png"))).rejects.toThrow("Проект изменился");
  expect(fetcher).toHaveBeenCalledTimes(2);
});
