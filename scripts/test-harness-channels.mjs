// Isolated end-to-end acceptance for drawing channels, exits and specification.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const packageRoot=resolve(process.argv[2]??join(root,'artifacts/m4-63/TECHMAP-GRAPHER'));
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
  const cookie=page.headers.getSetCookie().map(c=>c.split(';')[0]).join('; '),origin=new URL(baseUrl).origin;
  const fetcher=(path,init={})=>fetch(new URL(String(path),origin),{...init,headers:{...init.headers,Cookie:cookie,Origin:origin}});
  const config=await(await fetcher('/runtime-config.json')).json(),session=await(await fetcher('/api/v1/session')).json();
  return {fetcher,config,session};
}
async function stop(){if(server?.exitCode===null){const done=once(server,'exit');server.kill();await done;}}

try {
 const {createProjectApi}=await module('project-api.ts'),{createHarnessDesignApi}=await module('editor/design-api.ts');
 const {createConnector,createWire}=await module('editor/commands.ts');
 const {createEmptyHarnessDesign,parseHarnessDesignDocument,createOrthogonalE4Route,wireEndpointE4Anchor}=await module('editor/model.ts');
 const {ensureConnectorExits,insertPhysicalBend,physicalSegmentControls,branchPhysicalSegment,routePhysicalWires,physicalWireDisplayPaths}=await module('editor/physical-topology.ts');
 const {standardCovering}=await module('editor/physical-coverings.ts');
 const {buildDrawingBom,emptyDrawingDocuments}=await module('editor/drawing-documents.ts');
 let env=await start();const projects=createProjectApi(env.config,env.session,env.fetcher),designs=createHarnessDesignApi(env.config,env.session,env.fetcher);
 assert.deepEqual(await projects.listProjects(),[]);
 let project=await projects.createProject({designation:'CHANNELS-TEST',name:'Синтетический жгут М4-63',status:'draft'});
 project=(await projects.addHarness(project.projectId,{commandId:crypto.randomUUID(),expectedRevision:0},{designation:'Т-ветвь и второй выход',quantity:2})).project;
 const harnessId=project.harnesses[0].harnessId;
 const connectors=[createConnector('A','X1',2,{x:100,y:100}),createConnector('B','X2',2,{x:700,y:100}),createConnector('C','X3',2,{x:550,y:420})];
 const endpoint=(id,n)=>({connectorId:id,contactId:id+':contact:'+n});
 let doc={...createEmptyHarnessDesign(),connectors,wires:[createWire('W1',endpoint('A',1),endpoint('B',1),null),createWire('W2',endpoint('A',1),endpoint('C',1),null),createWire('W3',endpoint('A',2),endpoint('C',2),null)]};
 doc={...doc,wires:doc.wires.map((w,i)=>({...w,color:['#e23737','#278d45','#227dc4'][i],e4Route:createOrthogonalE4Route(wireEndpointE4Anchor(doc,w.from),wireEndpointE4Anchor(doc,w.to))})),physicalTopology:{snap:false,nodes:[
 {id:'A1',connectorId:'A',position:{x:150,y:60},wireIds:['W1','W2']},{id:'A2',connectorId:'A',position:{x:150,y:120},wireIds:['W3']},
 {id:'B1',connectorId:'B',position:{x:-30,y:60}},{id:'C1',connectorId:'C',position:{x:-30,y:60}}],segments:[{id:'main',from:'A1',to:'B1',bends:[],width:24,color:'#617b8c'}],routes:[]}};
 const before=structuredClone(doc.wires);
 const cover=standardCovering(doc,'main',{x:340,y:160},'Термоусадка','heat');
 doc.physicalTopology={...doc.physicalTopology,coverings:[cover]};
 let t=branchPhysicalSegment(doc,'main',{x:460,y:160},{junction:'T',continuation:'tail',tip:'tip',branch:'branch'});
 t={...t,segments:[...t.segments,{id:'finish',from:'tip',to:'C1',bends:[],width:24},{id:'second-exit',from:'A2',to:'C1',bends:[{x:300,y:500}],width:18}]};
 t=routePhysicalWires(doc,t);
 assert.equal(t.routes.length,3);assert.deepEqual(t.routes.find(r=>r.wireId==='W3').steps,[{segmentId:'second-exit',reverse:false}]);
 doc={...doc,physicalTopology:t,drawingDocuments:{...emptyDrawingDocuments(),specificationItems:[
 {id:'glue',kind:'manual',type:'Клей',designation:'GL-1',name:'Клей',amount:2.5,unit:'г',note:''},
 {id:'sheath',kind:'manual',type:'Оболочка',designation:'CAB-01',name:'Общая оболочка',amount:1.2,unit:'м',note:''},
 {id:'clamp',kind:'abstract',type:'Крепёж',designation:'',name:'Крепёж',amount:1,unit:'шт.',note:'',position:{x:340,y:340}}]}};
 doc.physicalTopology={...t,segments:t.segments.map(s=>s.id==='main'||s.id==='tail'?{...s,specificationItemId:'sheath'}:s)};
 assert.deepEqual(doc.wires,before);assert.equal(buildDrawingBom(doc,2).find(r=>r.objectIds.includes('glue')).amount,5);
 const sheath=buildDrawingBom(doc,2).find(r=>r.objectIds.includes('sheath'));assert.equal(sheath.amount,2.4);assert.deepEqual(sheath.objectIds,['sheath','main','tail']);
 assert.notDeepEqual(physicalWireDisplayPaths(doc,'W1',{x:0,y:0},{x:1,y:1})[1],physicalWireDisplayPaths(doc,'W2',{x:0,y:0},{x:1,y:1})[1]);
 const exits=ensureConnectorExits({...doc,physicalTopology:undefined});
 assert.equal(exits.nodes.length,connectors.length);assert.equal(ensureConnectorExits({...doc,physicalTopology:exits}),exits);
 const pipe=doc.physicalTopology.segments.find(s=>s.id==='second-exit');
 const controls=physicalSegmentControls(doc,pipe),mid={x:(controls[0].x+controls[1].x)/2,y:(controls[0].y+controls[1].y)/2};
 const edited=insertPhysicalBend(doc,pipe,mid);assert.deepEqual(edited.bends,[mid,...pipe.bends]);
 const originalWires=structuredClone(doc.wires),originalRoutes=structuredClone(doc.physicalTopology.routes);
 doc={...doc,physicalTopology:{...doc.physicalTopology,segments:doc.physicalTopology.segments.map(s=>s.id===pipe.id?{...edited,bends:edited.bends.map((p,i)=>i===0?{x:p.x+40,y:p.y-20}:p)}:s)}};
 assert.deepEqual(doc.wires,originalWires);assert.deepEqual(doc.physicalTopology.routes,originalRoutes);
 const parsed=parseHarnessDesignDocument(JSON.parse(JSON.stringify(doc))),initial=await designs.get(project.projectId,harnessId);
 await designs.save(project.projectId,harnessId,initial.revision,parsed);
 assert.deepEqual((await designs.get(project.projectId,harnessId)).content,parsed);
 await stop();env=await start();assert.deepEqual((await createHarnessDesignApi(env.config,env.session,env.fetcher).get(project.projectId,harnessId)).content,parsed);
 const report={status:'ok',dataRoot,projectId:project.projectId,harnessId,branchChecked:true,multipleExitsChecked:true,wireIdentityChecked:true,bomChecked:true,restartChecked:true,pipeEditingChecked:true,automaticExitsChecked:true};
 await writeFile(join(dataRoot,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
} finally {await stop();await vite.close();await writeFile(join(dataRoot,'server.log'),log);}
