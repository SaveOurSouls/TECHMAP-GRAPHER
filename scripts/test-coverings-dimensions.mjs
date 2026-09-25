// Isolated end-to-end acceptance for drawing channels, exits and specification.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, writeFile, readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const packageRoot=resolve(process.argv[2]??join(root,'artifacts/m4-108/TECHMAP-GRAPHER'));
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
async function maintenance(args){
 const child=spawn(join(packageRoot,'Techmap.Server.exe'),['--no-browser',`--data-root=${dataRoot}`,...args],{cwd:packageRoot,windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';
 child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
 const timer=setTimeout(()=>child.kill(),60000);try{const [code]=await once(child,'exit');assert.equal(code,0,output);return output;}finally{clearTimeout(timer);}
}

try {
 const {createProjectApi}=await module('project-api.ts'),{createHarnessDesignApi}=await module('editor/design-api.ts');
 const {createConnector,createWire,applyEditorCommand,normalizeE4RoutingDocument}=await module('editor/commands.ts');
 const {createEmptyHarnessDesign,parseHarnessDesignDocument,createOrthogonalE4Route,wireEndpointE4Anchor}=await module('editor/model.ts');
 const {setPipeIntervalLength,drawingDimensionScene}=await module('editor/drawing-dimensions.ts');
 const {standardCoveringOver}=await module('editor/physical-coverings.ts');
 const {moveCovering,coveringScene}=await module('editor/covering-layout.ts');
 let env=await start();const projects=createProjectApi(env.config,env.session,env.fetcher);let api=createHarnessDesignApi(env.config,env.session,env.fetcher);
 assert.deepEqual(await projects.listProjects(),[]);
 let project=await projects.createProject({designation:'M4-108',name:'Проверка оболочек и размеров',status:'draft'});
 project=(await projects.addHarness(project.projectId,{commandId:crypto.randomUUID(),expectedRevision:0},{designation:'Два пайпа',quantity:1})).project;
 const harnessId=project.harnesses[0].harnessId;
 const connectors=['A','B','C','D'].map((id,i)=>createConnector(id,'X'+(i+1),1,{x:60+i%2*750,y:80+Math.floor(i/2)*260}));
 let doc={...createEmptyHarnessDesign(),connectors,wires:[createWire('W1',{connectorId:'A',contactId:'A:contact:1'},{connectorId:'B',contactId:'B:contact:1'}),createWire('W2',{connectorId:'C',contactId:'C:contact:1'},{connectorId:'D',contactId:'D:contact:1'})],drawingDocuments:{tables:[],leaders:[],bomOrder:[],bendRadius:18,coveringDiameterRatio:2,dimensionMode:'horizontal',showDimensions:true},physicalTopology:{snap:false,nodes:[{id:'a',position:{x:200,y:170}},{id:'b',position:{x:750,y:170}},{id:'c',position:{x:200,y:330}},{id:'d',position:{x:750,y:330}}],segments:[{id:'S1',from:'a',to:'b',path:{kind:'polyline',points:[]},width:12},{id:'S2',from:'c',to:'d',path:{kind:'polyline',points:[]},width:18}],routes:[{wireId:'W1',steps:[{segmentId:'S1',reverse:false}]},{wireId:'W2',steps:[{segmentId:'S2',reverse:false}]}],coverings:[{id:'group',name:'Общая термоусадка',kind:'heat-shrink',width:0,color:'#424c53',lengthMm:null,spans:[{segmentId:'S1',from:.35,to:.65}],bundle:{mode:'flat',members:[{kind:'segment',id:'S1'},{kind:'segment',id:'S2'}],transitionStart:.16,transitionEnd:.16}},{id:'nylon',name:'Нейлонка',kind:'nylon',width:26,color:'#b19c77',lengthMm:null,spans:[{segmentId:'S2',from:.1,to:.9}]}]}};
 doc={...doc,wires:doc.wires.map((w,i)=>({...w,color:i?'#db921b':'#d64040',e4Route:createOrthogonalE4Route(wireEndpointE4Anchor(doc,w.from),wireEndpointE4Anchor(doc,w.to))}))};
 doc=normalizeE4RoutingDocument(doc);
 for(const id of ['S1','S2'])doc=applyEditorCommand(doc,{type:'set-drawing-documents',documents:setPipeIntervalLength(doc,id,0,1,400)});
 const dimension=doc.drawingDocuments.dimensions[0];doc=applyEditorCommand(doc,{type:'set-drawing-documents',documents:{...doc.drawingDocuments,dimensions:[...doc.drawingDocuments.dimensions,{...dimension,id:'aux',auxiliary:true,lengthMm:120,offset:-50}]}});
 const overlay=standardCoveringOver(doc,doc.physicalTopology.coverings[1],'Обмотка','overlay');
 doc=applyEditorCommand(doc,{type:'set-physical-topology',topology:{...doc.physicalTopology,coverings:[...doc.physicalTopology.coverings,{...overlay,spans:[{segmentId:'S2',from:.05,to:.27}],width:32}]}});
 const first=await api.get(project.projectId,harnessId),saved=await api.save(project.projectId,harnessId,first.revision,doc);
 assert.deepEqual(saved.content.wires.map(w=>w.lengthMm),[400,400]);assert.equal(saved.content.drawingDocuments.coveringDiameterRatio,2);
 const withBend=applyEditorCommand(doc,{type:'edit-physical-bend',segmentId:'S1',index:0,position:{x:400,y:140},mode:'adjacent',insert:true});
 const withoutBend=applyEditorCommand(withBend,{type:'remove-physical-bend',segmentId:'S1',index:0});
 assert.deepEqual(withoutBend.wires.map(w=>w.lengthMm),[400,400]);await api.save(project.projectId,harnessId,saved.revision,withoutBend);
 await stop();env=await start();api=createHarnessDesignApi(env.config,env.session,env.fetcher);const loaded=await api.get(project.projectId,harnessId);
 assert.deepEqual(loaded.content,parseHarnessDesignDocument(JSON.parse(JSON.stringify(withoutBend))));
 assert.equal(drawingDimensionScene(loaded.content).filter(o=>o.metadata?.auxiliary==='true').length,1);
 assert.equal(coveringScene(loaded.content).length,3);
 await writeFile(join(dataRoot,'acceptance.json'),JSON.stringify({baseUrl,projectId:project.projectId,harnessId,checks:'covering stack, ratio, auxiliary, endpoint dimensions, bend delete, save/restart',content:loaded.content},null,2));
 console.log(JSON.stringify({baseUrl,projectId:project.projectId,harnessId,dataRoot,status:'PASS'}));
 if(process.argv.includes('--keep'))await new Promise(()=>{});
}finally{await stop();await vite.close();await writeFile(join(dataRoot,'server.log'),log);}
