// Isolated end-to-end acceptance for nested coverings and curved bundle transitions.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, writeFile, readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const packageRoot=resolve(process.argv[2]??join(root,'artifacts/m4-109/TECHMAP-GRAPHER'));
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
 const {createConnector,createWire,applyEditorCommand,normalizeE4RoutingDocument}=await module('editor/commands.ts');
 const {createEmptyHarnessDesign,parseHarnessDesignDocument}=await module('editor/model.ts');
 const {setPipeIntervalLength}=await module('editor/drawing-dimensions.ts');
 const {standardCoveringOver}=await module('editor/physical-coverings.ts');
 const {moveCovering,coveringScene}=await module('editor/covering-layout.ts');
 const {pipeBundleDisplaySamples,pipeBundleTransitionHandles}=await module('editor/pipe-bundle-projection.ts');
 let env=await start();const projects=createProjectApi(env.config,env.session,env.fetcher);let api=createHarnessDesignApi(env.config,env.session,env.fetcher);
 assert.deepEqual(await projects.listProjects(),[]);
 let project=await projects.createProject({designation:'M4-109',name:'Вложенные оболочки на изогнутой оси',status:'draft'});
 project=(await projects.addHarness(project.projectId,{commandId:crypto.randomUUID(),expectedRevision:0},{designation:'Три пайпа',quantity:1})).project;
 const harnessId=project.harnesses[0].harnessId,ys=[160,310,460];
 const connectors=ys.flatMap((y,i)=>[createConnector('A'+i,'X'+(2*i+1),1,{x:40,y:y-70}),createConnector('B'+i,'X'+(2*i+2),1,{x:900,y:y-70})]);
 const inner={id:'group',name:'Внутренняя оболочка',kind:'nylon',width:0,color:'#b19c77',lengthMm:null,spans:['s0','s1'].map(segmentId=>({segmentId,from:.15,to:.85})),bundle:{mode:'flat',members:['s0','s1'].map(id=>({kind:'segment',id})),transitionStart:.1,transitionEnd:.1}};
 const outer={...inner,id:'outer',name:'Внешняя оболочка',kind:'heat-shrink',color:'#424c53',spans:[{segmentId:'s0',from:.4,to:.6}],bundle:{mode:'flat',members:[{kind:'covering',id:'group'},{kind:'segment',id:'s2'}]}};
 let doc=normalizeE4RoutingDocument({...createEmptyHarnessDesign(),connectors,
  wires:ys.map((y,i)=>({...createWire('W'+i,{connectorId:'A'+i,contactId:`A${i}:contact:1`},{connectorId:'B'+i,contactId:`B${i}:contact:1`}),color:['#d64040','#db921b','#287aac'][i]})),
  drawingDocuments:{tables:[],leaders:[],bomOrder:[],bendRadius:18,showDimensions:true},
  physicalTopology:{snap:false,nodes:ys.flatMap((y,i)=>[{id:'a'+i,position:{x:200,y}},{id:'b'+i,position:{x:800,y}}]),
   segments:ys.map((y,i)=>({id:'s'+i,from:'a'+i,to:'b'+i,path:{kind:'polyline',points:[{x:350,y},{x:400,y:y+60},{x:600,y:y+60},{x:650,y}]},width:10})),
   routes:ys.map((y,i)=>({wireId:'W'+i,steps:[{segmentId:'s'+i,reverse:false}]})),coverings:[inner,outer]}});
 for(const id of ['s0','s1','s2'])doc=applyEditorCommand(doc,{type:'set-drawing-documents',documents:setPipeIntervalLength(doc,id,0,5,400)});
 const overlay=standardCoveringOver(doc,inner,'Оплётка','overlay');
 doc=applyEditorCommand(doc,{type:'set-physical-topology',topology:{...doc.physicalTopology,coverings:[inner,outer,{...overlay,spans:[...overlay.spans].reverse()}]}});
 const electrical=JSON.stringify(doc.wires),routes=JSON.stringify(doc.physicalTopology.routes);
 const handle=pipeBundleTransitionHandles(doc,'group').find(h=>h.part==='transition-from');assert.ok(handle);
 const moved=moveCovering(doc,'group',handle.spanIndex,handle.part,handle.point,{x:handle.point.x-15,y:handle.point.y},0);assert.ok(moved);
 doc=applyEditorCommand(doc,{type:'set-physical-topology',topology:{...doc.physicalTopology,coverings:doc.physicalTopology.coverings.map(c=>c.id==='group'?moved:c)}});
 const before=pipeBundleDisplaySamples(doc,'s1');
 const reordered={...doc,physicalTopology:{...doc.physicalTopology,coverings:[...doc.physicalTopology.coverings].reverse()}};
 assert.deepEqual(pipeBundleDisplaySamples(reordered,'s1'),before);
 assert.equal(JSON.stringify(doc.wires),electrical);assert.equal(JSON.stringify(doc.physicalTopology.routes),routes);
 const first=await api.get(project.projectId,harnessId);await api.save(project.projectId,harnessId,first.revision,doc);
 await stop();env=await start();api=createHarnessDesignApi(env.config,env.session,env.fetcher);
 const loaded=await api.get(project.projectId,harnessId);
 assert.deepEqual(loaded.content,parseHarnessDesignDocument(JSON.parse(JSON.stringify(doc))));
 assert.deepEqual(pipeBundleDisplaySamples(loaded.content,'s1'),before);
 assert.deepEqual(loaded.content.wires.map(w=>w.lengthMm),[400,400,400]);
 assert.equal(coveringScene(loaded.content).length,3);
 await writeFile(join(dataRoot,'acceptance.json'),JSON.stringify({baseUrl,projectId:project.projectId,harnessId,checks:'curved axis, nested shells, reordered spans/layers, transition drag, wire identity/length, save/restart',content:loaded.content},null,2));
 console.log(JSON.stringify({baseUrl,projectId:project.projectId,harnessId,dataRoot,status:'PASS'}));
 if(process.argv.includes('--keep'))await new Promise(()=>{});
}finally{await stop();await vite.close();await writeFile(join(dataRoot,'server.log'),log);}
