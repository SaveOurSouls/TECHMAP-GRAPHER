// Isolated end-to-end acceptance for global materials, pinned project textures and restart.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, writeFile, readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const packageRoot=resolve(process.argv[2]??join(root,'artifacts/m4-110/TECHMAP-GRAPHER'));
const clientRoot=join(root,'src/Techmap.Client'),require=createRequire(join(clientRoot,'package.json'));
const {createServer}=await import(pathToFileURL(require.resolve('vite')).href);
await mkdir(join(root,'artifacts/channels-smoke'),{recursive:true});
const dataRoot=await mkdtemp(join(root,'artifacts/channels-smoke/test-'));
const vite=await createServer({root:clientRoot,configFile:false,server:{middlewareMode:true,hmr:false,ws:false},appType:'custom'});
const module=path=>vite.ssrLoadModule(`/src/${path}`);
let server,log='',baseUrl;
async function start(){
  let output='';server=spawn(join(packageRoot,'Techmap.Server.exe'),['--no-browser',`--data-root=${dataRoot}`],{cwd:packageRoot,windowsHide:true,stdio:['ignore','pipe','pipe']});
  server.stdout.on('data',b=>{output+=b;log+=b;});server.stderr.on('data',b=>{output+=b;log+=b;});
  baseUrl=await new Promise((res,rej)=>{const timeout=setTimeout(()=>{clearInterval(timer);rej(new Error(output));},30000);const timer=setInterval(()=>{const match=/TECHMAP_HOST_URL=(https?:\/\/[^\s]+)/.exec(output);if(match){clearTimeout(timeout);clearInterval(timer);res(match[1]);}else if(server.exitCode!==null){clearTimeout(timeout);clearInterval(timer);rej(new Error(output));}},100);});
  const page=await fetch(baseUrl);assert.equal(page.status,200);
  for(const texture of ['Rubber002','Fabric061','Metal049A']) {
    const files=(await readdir(join(packageRoot,'wwwroot/assets'))).filter(name=>name.startsWith(texture+'-')&&name.endsWith('.jpg'));
    assert.equal(files.length,1,`Packaged texture ${texture}`);
    const response=await fetch(new URL('assets/'+files[0],baseUrl));
    assert.equal(response.status,200,`Texture HTTP ${texture}`);
    assert.match(response.headers.get('content-type')??'',/^image\/jpeg/);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()),await readFile(join(packageRoot,'wwwroot/assets',files[0])));
  }
  const cookie=page.headers.getSetCookie().map(c=>c.split(';')[0]).join('; '),origin=new URL(baseUrl).origin;
  const fetcher=(path,init={})=>fetch(new URL(String(path),origin),{...init,headers:{...init.headers,Cookie:cookie,Origin:origin}});
  const config=await(await fetcher('/runtime-config.json')).json(),session=await(await fetcher('/api/v1/session')).json();
  return {fetcher,config,session};
}
async function stop(){const running=server;server=undefined;if(running?.exitCode===null&&running.signalCode===null){const done=once(running,'exit');running.kill();await done;}}
try {
 const {createProjectApi}=await module('project-api.ts'),{createHarnessDesignApi}=await module('editor/design-api.ts');
 const {createMaterialLibraryApi}=await module('material-library-api.ts'),{prepareGlobalCoverings}=await module('editor/global-covering-materials.ts');
 const {physicalFixture}=await module('editor/physical-topology-fixture.ts'),{applyEditorCommand}=await module('editor/commands.ts');
 const {standardCovering}=await module('editor/physical-coverings.ts');
 const {parseHarnessDesignDocument}=await module('editor/model.ts');
 const {createMutationHeaders}=await module('local-session.ts');
 let env=await start(),materials=createMaterialLibraryApi(env.config,env.session,env.fetcher);
 const projects=createProjectApi(env.config,env.session,env.fetcher);
 assert.deepEqual(await projects.listProjects(),[]);
 const seeds=await materials.list();assert.equal(seeds.length,6);assert.ok(seeds.every(m=>m.imageBase64===''));
 let mat=await materials.get(seeds.find(m=>m.coveringKind==='heat-shrink').materialId);
 const original=mat;mat=await materials.update({...mat,tint:'#dc2626',textureScale:2,lineWidth:2.5,textureAngle:30});
 await assert.rejects(materials.update(original),/другом окне/);
 let project=await projects.createProject({designation:'M4-110',name:'Библиотека материалов — тест',status:'draft'});
 project=(await projects.addHarness(project.projectId,{commandId:crypto.randomUUID(),expectedRevision:0},{designation:'Материалы',quantity:1})).project;
 const harnessId=project.harnesses[0].harnessId;let doc=physicalFixture();
 const fresh=standardCovering(doc,'S0',{x:200,y:60},'Термоусадка','material-cover');
 const headers=createMutationHeaders(env.session),path=`/api/v1/projects/${project.projectId}`;
 const pinned=await env.fetcher(`${path}/attachments`,{method:'POST',headers,body:JSON.stringify({commandId:crypto.randomUUID(),expectedRevision:project.revision,fileName:'material.png',mediaType:'image/png',contentBase64:mat.imageBase64,purpose:'covering-texture'})});
 assert.equal(pinned.status,200,await pinned.clone().text());const attachment=(await pinned.json()).attachment;
 const command=await prepareGlobalCoverings(doc,{type:'set-physical-topology',topology:{...doc.physicalTopology,coverings:[fresh]}},materials.list,async()=>({sha256:attachment.sha256,name:mat.name}));
 doc=applyEditorCommand(doc,command);
 assert.equal(doc.physicalTopology.coverings[0].style.textureTint,'#dc2626');assert.equal(doc.physicalTopology.coverings[0].style.lineWidth,2.5);
 const api=createHarnessDesignApi(env.config,env.session,env.fetcher),first=await api.get(project.projectId,harnessId);await api.save(project.projectId,harnessId,first.revision,doc);
 // M4-112: an existing sleeve changes type and pins the replacement in one edit.
 const band=await materials.get(seeds.find(m=>m.coveringKind==='band').materialId);
 const currentProject=await(await env.fetcher(path)).json();
 const bandUpload=await env.fetcher(`${path}/attachments`,{method:'POST',headers,body:JSON.stringify({commandId:crypto.randomUUID(),expectedRevision:currentProject.revision,fileName:'band.png',mediaType:'image/png',contentBase64:band.imageBase64,purpose:'covering-texture'})});
 assert.equal(bandUpload.status,200,await bandUpload.clone().text());const bandAttachment=(await bandUpload.json()).attachment;
 const previous=doc.physicalTopology.coverings[0];
 const replacement=await prepareGlobalCoverings(doc,{type:'set-physical-topology',topology:{...doc.physicalTopology,coverings:[{...previous,kind:'band'}]}},materials.list,async m=>{assert.equal(m.materialId,band.materialId);return {sha256:bandAttachment.sha256,name:band.name};});
 doc=applyEditorCommand(doc,replacement);
 assert.equal(doc.physicalTopology.coverings[0].style.texture,`asset:${bandAttachment.sha256}`);
 assert.notEqual(doc.physicalTopology.coverings[0].style.texture,previous.style.texture);
 assert.equal(doc.physicalTopology.coverings[0].color,previous.color);
 assert.deepEqual(doc.physicalTopology.coverings[0].spans,previous.spans);
 const saved=await api.get(project.projectId,harnessId);await api.save(project.projectId,harnessId,saved.revision,doc);
 mat=await materials.update({...mat,tint:'#16a34a',lineWidth:5});await materials.remove(mat);
 assert.deepEqual((await api.get(project.projectId,harnessId)).content.physicalTopology,parseHarnessDesignDocument(doc).physicalTopology);
 const content=await env.fetcher(`${path}/attachments/${attachment.attachmentId}/content`);assert.equal(content.status,200);assert.deepEqual(Buffer.from(await content.arrayBuffer()),Buffer.from(original.imageBase64,'base64'));
 // Restore the default row for the independent browser exercise, using the public API.
 await materials.create({...mat,revision:0});
 await stop();env=await start();materials=createMaterialLibraryApi(env.config,env.session,env.fetcher);
 const loaded=await createHarnessDesignApi(env.config,env.session,env.fetcher).get(project.projectId,harnessId);
 assert.deepEqual(loaded.content.physicalTopology,parseHarnessDesignDocument(doc).physicalTopology);
 assert.deepEqual(loaded.content.drawingDocuments,parseHarnessDesignDocument(doc).drawingDocuments);
 assert.equal((await materials.get(mat.materialId)).tint,'#16a34a');
 const reloadedImage=await env.fetcher(`${path}/attachments/${attachment.attachmentId}/content`);assert.equal(reloadedImage.status,200);
 await writeFile(join(dataRoot,'acceptance.json'),JSON.stringify({baseUrl,projectId:project.projectId,harnessId,dataRoot,status:'PASS',checks:'seed images, CRUD/conflict, settings and texture pinned in project, global update/delete isolation, PNG bytes, restart',content:loaded.content},null,2));
 console.log(JSON.stringify({baseUrl,projectId:project.projectId,harnessId,dataRoot,status:'PASS'}));
 if(process.argv.includes('--keep'))await new Promise(()=>{});
}finally{await stop();await vite.close();await writeFile(join(dataRoot,'server.log'),log);}
