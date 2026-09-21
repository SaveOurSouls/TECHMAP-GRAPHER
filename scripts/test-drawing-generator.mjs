// Isolated end-to-end acceptance for series drawing generators.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const packageRoot=resolve(process.argv[2]??join(root,'artifacts/m4-49/TECHMAP-GRAPHER'));
const clientRoot=join(root,'src/Techmap.Client'),require=createRequire(join(clientRoot,'package.json'));
const {createServer}=await import(pathToFileURL(require.resolve('vite')).href);
await mkdir(join(root,'artifacts/generator-smoke'),{recursive:true});
const dataRoot=await mkdtemp(join(root,'artifacts/generator-smoke/test-'));
const vite=await createServer({root:clientRoot,configFile:false,server:{middlewareMode:true,hmr:false,ws:false},appType:'custom'});
const module=path=>vite.ssrLoadModule(`/src/${path}`);
let server,log='',baseUrl;
async function start(){
  let output='';server=spawn(join(packageRoot,'Techmap.Server.exe'),['--no-browser',`--data-root=${dataRoot}`],{cwd:packageRoot,windowsHide:true,stdio:['ignore','pipe','pipe']});
  server.stdout.on('data',b=>{output+=b;log+=b;});server.stderr.on('data',b=>{output+=b;log+=b;});
  baseUrl=await new Promise((res,rej)=>{const timeout=setTimeout(()=>{clearInterval(timer);rej(new Error(output));},30000);const timer=setInterval(()=>{const match=/TECHMAP_HOST_URL=(https?:\/\/[^\s]+)/.exec(output);if(match){clearTimeout(timeout);clearInterval(timer);res(match[1]);}else if(server.exitCode!==null){clearTimeout(timeout);clearInterval(timer);rej(new Error(output));}},100);});
  const page=await fetch(baseUrl);assert.equal(page.status,200);
  const cookie=page.headers.getSetCookie().map(c=>c.split(';')[0]).join('; '),origin=new URL(baseUrl).origin;
  const fetcher=(path,init={})=>fetch(new URL(String(path),origin),{...init,headers:{...init.headers,Cookie:cookie,Origin:origin}});
  const config=await(await fetcher('/runtime-config.json')).json(),session=await(await fetcher('/api/v1/session')).json();
  return {fetcher,config,session};
}
async function stop(){if(server?.exitCode===null){const done=once(server,'exit');server.kill();await done;}}
try {
  const {newTemplateContentV3,addBasicNodeV3,addContactPointV3,addArticleVariantsV3,addContactTypeGroupV3,setArticleVariantContactGroupV3,addAdditionalViewV3,editNodeV3}=await module('component-library/template-commands-v3.ts');
  const {createE4ConnectorSeriesTableFromV3}=await module('component-library/e4-connector-series-table.ts');
  const {createTemplateContentV5FromEditor}=await module('component-library/template-model-v5.ts');
  const {newDrawingGenerator,materializeGenerator}=await module('component-library/drawing-generator.ts');
  const {createComponentTemplateApi}=await module('component-library/component-template-api.ts');
  const {createProjectApi}=await module('project-api.ts');
  const {createConnectorInstanceFromComponentTemplateV3}=await module('editor/component-template-placement.ts');
  const {createComponentPlacementApi,componentPlacementRequest}=await module('editor/component-placement-api.ts');
  const {createHarnessDesignApi}=await module('editor/design-api.ts');
  const {projectE4DrawingCompanions,projectComponentTemplateView}=await module('editor/component-template-view-renderer.ts');
  const {applyEditorCommand}=await module('editor/commands.ts');
  let core=newTemplateContentV3(),group;
  [core,group]=addContactTypeGroupV3(core,'Signal');
  core=addArticleVariantsV3(core,[2,10].map(n=>({sourceId:'БД.СОЕД',entityType:'connector',articleKey:`GEN-${n}`})));
  for(const [i,a] of core.articleVariants.entries())core=setArticleVariantContactGroupV3(core,a.id,group,i===0?2:10,[]);
  const table=createE4ConnectorSeriesTableFromV3(core,true),generators=[],bindings=[];
  for(const target of ['drawing','e4','route']){
    let viewId=core.views[1].id;
    if(target!=='drawing')[core,viewId]=addAdditionalViewV3(core,`Generator ${target}`);
    const layer=core.views.find(v=>v.id===viewId).layers[0],g=newDrawingGenerator(viewId,target);
    for(const role of ['start','period','end','static']){let id;[core,id]=addBasicNodeV3(core,viewId,layer.id,'rectangle');g.roles[role]=[id];}
    let point;[core,point]=addContactPointV3(core,viewId,{name:'Pin',contactTypeGroupId:group});g.periodPointIds=[point];
    if(target==='e4')core.views.find(v=>v.id===viewId).contactPoints.find(p=>p.id===point).shape={nodeId:g.roles.period[0],fillFromWire:true};
    g.articles=core.articleVariants.map(a=>({articleId:a.id,nodeIds:[]}));
    generators.push(g);
  }
  const drawingGenerator=generators[0],source=core.views.find(v=>v.id===drawingGenerator.viewId);
  let extra;[core,extra]=addBasicNodeV3(core,source.id,source.layers[0].id,'ellipse');drawingGenerator.articles[0].nodeIds.push(extra);
  const content=createTemplateContentV5FromEditor(core,table,[],[],undefined,[],bindings,generators).content;
  const articleBindings=core.articleVariants.map(({sourceId,entityType,articleKey})=>({sourceId,entityType,articleKey}));
  let env=await start();
  const templates=createComponentTemplateApi(env.config,env.session,env.fetcher),projects=createProjectApi(env.config,env.session,env.fetcher),placements=createComponentPlacementApi(env.config,env.session,env.fetcher),designs=createHarnessDesignApi(env.config,env.session,env.fetcher);
  assert.deepEqual(await projects.listProjects(),[]);
  const initial=await templates.create({code:'GENERATOR-SMOKE',name:'Synthetic generator test',articleBindings,content});
  const reloaded=await templates.get(initial.templateId);assert.deepEqual(reloaded.content.drawingGenerators,generators);
  const malformed=structuredClone(content);malformed.drawingGenerators[0].rows=3;
  await assert.rejects(()=>templates.save(initial.templateId,{expectedVersion:initial.version,code:initial.code,name:initial.name,articleBindings,content:malformed}));
  let project=await projects.createProject({designation:'GENERATOR-TEST',name:'Synthetic generator acceptance',status:'draft'});
  project=(await projects.addHarness(project.projectId,{commandId:crypto.randomUUID(),expectedRevision:0},{designation:'GENERATOR-HARNESS',quantity:1})).project;
  const harnessId=project.harnesses[0].harnessId;
  const expected=[];
  for(const [index,article] of core.articleVariants.entries()){
    const preview=createConnectorInstanceFromComponentTemplateV3(initial,{id:crypto.randomUUID(),designation:`XS${index+1}`,articleVariantId:article.id,e4Position:{x:200+index*400,y:300}});
    const current=await designs.get(project.projectId,harnessId);
    await placements.place(project.projectId,harnessId,componentPlacementRequest(preview,current.revision,crypto.randomUUID()));
    const saved=await designs.get(project.projectId,harnessId),connector=saved.content.connectors.find(c=>c.id===preview.id);
    assert.deepEqual(JSON.parse(JSON.stringify(connector.libraryBinding)),JSON.parse(JSON.stringify(preview.libraryBinding)));
    assert.equal(connector.contacts.length,index===0?2:10);
    const instance={content:initial.content,objectId:preview.id,snapshotId:'smoke',articleVariantId:article.id};
    const e4=projectE4DrawingCompanions(instance,{x:0,y:0},300);assert.equal(e4.length,1);assert.equal(e4[0].commands.length,connector.contacts.length+3);
    assert.equal(e4[0].commands.filter(c=>c.contactLabel).length,connector.contacts.length);
    const colored=projectE4DrawingCompanions({...instance,contactWireColors:{[table.seriesDefaults[1].rowId]:'#ff0000'}},{x:0,y:0},300);
    assert.deepEqual(colored[0].commands.filter(c=>c.fill==='#ff0000').map(c=>c.contactLabel.text),['2']);
    for(const target of ['drawing','route']){
      const projected=projectComponentTemplateView(instance,'drawing',{x:0,y:0},undefined,target);
      const generator=generators.find(g=>g.target===target),computed=materializeGenerator(core,table,bindings,generator,article.id);
      assert.equal(projected.commands.length,computed.view.layers.flatMap(l=>l.nodes).length);
    }
    const points=materializeGenerator(core,table,bindings,drawingGenerator,article.id).points;
    connector.libraryBinding.snapshot.contacts.forEach((c,i)=>{assert.equal(c.representations.length,1);assert.equal(c.representations[0].x,points[i].point.x.value);assert.equal(c.representations[0].y,points[i].point.y.value);});
    expected.push(connector.libraryBinding);
  }
  const graph=await placements.list(project.projectId,harnessId);
  for(const snapshot of graph.snapshots){assert.equal(snapshot.sourceTemplateId,initial.templateId);assert.equal(snapshot.sourceVersion,initial.version);assert.equal(snapshot.sourceVersionSha256,initial.versionSha256);}
  const current=await designs.get(project.projectId,harnessId),connector=current.content.connectors[0];
  let moved=applyEditorCommand(current.content,{type:'set-drawing-placement',connectorId:connector.id,drawingId:generators[1].id,offset:{x:150,y:50},scale:1.5});
  moved=applyEditorCommand(moved,{type:'set-drawing-placement',connectorId:connector.id,drawingId:'view:drawing',rotationDegrees:22.5,rotationCenter:{x:300,y:400}});
  assert.deepEqual(moved.connectors[0].contacts,connector.contacts);
  assert.deepEqual(moved.connectors[0].positions.e4,connector.positions.e4);
  await designs.save(project.projectId,harnessId,current.revision,moved);
  // Publishing source changes does not mutate pinned instances or local additions.
  const changed=structuredClone(content);changed.drawingGenerators.forEach(g=>{g.pitch=60;g.numbering='snake';});
  const draft=await templates.saveDraft(initial.templateId,{expectedVersion:initial.version,expectedDraftRevision:0,code:initial.code,name:initial.name,articleBindings,content:changed});
  const published=await templates.publishDraft(initial.templateId,initial.version,draft.draftRevision);
  assert.equal(published.version,initial.version+1);assert.deepEqual(published.content.drawingGenerators[0].articles[0].nodeIds,[extra]);
  assert.deepEqual((await designs.get(project.projectId,harnessId)).content.connectors.map(c=>c.libraryBinding),expected);
  await stop();env=await start();
  const after=await createHarnessDesignApi(env.config,env.session,env.fetcher).get(project.projectId,harnessId);
  assert.deepEqual(after.content,moved);
  const templateAfter=await createComponentTemplateApi(env.config,env.session,env.fetcher).get(initial.templateId);
  assert.deepEqual(templateAfter.content.drawingGenerators,changed.drawingGenerators);
  // Removing a copied component or its harness retains a project-owned snapshot.
  // Exercise the actual packaged startup against that state, without user data.
  const retainedProjects=createProjectApi(env.config,env.session,env.fetcher);
  const retainedDesigns=createHarnessDesignApi(env.config,env.session,env.fetcher);
  const retainedPlacements=createComponentPlacementApi(env.config,env.session,env.fetcher);
  const emptyCopy=await retainedProjects.copyProject(project.projectId);
  const emptyHarness=emptyCopy.harnesses[0].harnessId;
  const copyDesign=await retainedDesigns.get(emptyCopy.projectId,emptyHarness);
  await retainedDesigns.save(emptyCopy.projectId,emptyHarness,copyDesign.revision,
    {...copyDesign.content,connectors:[],wires:[],cables:[]});
  const retainedGraph=await retainedPlacements.list(emptyCopy.projectId,emptyHarness);
  assert.equal(retainedGraph.placements.length,0);
  const deletedCopy=await retainedProjects.copyProject(project.projectId);
  await retainedProjects.deleteHarness(deletedCopy.projectId,deletedCopy.harnesses[0].harnessId,
    {commandId:crypto.randomUUID(),expectedRevision:deletedCopy.revision});
  await stop();env=await start();
  const restoredGraph=await createComponentPlacementApi(env.config,env.session,env.fetcher).list(emptyCopy.projectId,emptyHarness);
  assert.deepEqual(restoredGraph.snapshots,retainedGraph.snapshots);
  assert.equal(restoredGraph.placements.length,0);
  assert.equal((await createProjectApi(env.config,env.session,env.fetcher).getProject(deletedCopy.projectId)).harnesses.length,0);
  assert.deepEqual((await createHarnessDesignApi(env.config,env.session,env.fetcher).get(project.projectId,harnessId)).content,moved);
  const report={status:'ok',dataRoot,projectId:project.projectId,harnessId,templateId:initial.templateId,version:published.version,targets:['e4','drawing','route'],counts:[2,10],pinnedBindingChecked:true,additionsChecked:true,restartChecked:true,rotationChecked:true,retainedSnapshotsRestartChecked:true};
  await writeFile(join(dataRoot,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  if(process.argv.includes('--keep-server')){console.log(`GENERATOR_SMOKE_URL=${baseUrl}`);server.unref();server.stdout.unref();server.stderr.unref();server=null;}
} finally {await stop();await vite.close();await writeFile(join(dataRoot,'server.log'),log);}
