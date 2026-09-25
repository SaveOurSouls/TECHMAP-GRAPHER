// Isolated end-to-end acceptance for drawing channels, exits and specification.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, writeFile, readdir, readFile } from 'node:fs/promises';
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
 const {createConnector,createWire}=await module('editor/commands.ts');
 const {createEmptyHarnessDesign,parseHarnessDesignDocument,createOrthogonalE4Route,wireEndpointE4Anchor}=await module('editor/model.ts');
 const {ensureConnectorExits,physicalSegmentHandles,movePhysicalHandle,insertPhysicalBend,physicalSegmentControls,branchPhysicalSegment,routePhysicalWires,physicalWireDisplayPaths,connectPhysicalNodeToSegment}=await module('editor/physical-topology.ts');
 const {standardCovering}=await module('editor/physical-coverings.ts');
 const {buildDrawingBom,emptyDrawingDocuments,addDrawingPositions,drawingDocumentScene}=await module('editor/drawing-documents.ts');
 let env=await start();const projects=createProjectApi(env.config,env.session,env.fetcher),designs=createHarnessDesignApi(env.config,env.session,env.fetcher);
 assert.deepEqual(await projects.listProjects(),[]);
 let project=await projects.createProject({designation:'CHANNELS-TEST',name:'Синтетический жгут М4-63',status:'draft'});
 project=(await projects.addHarness(project.projectId,{commandId:crypto.randomUUID(),expectedRevision:0},{designation:'Т-ветвь и второй выход',quantity:2})).project;
 const harnessId=project.harnesses[0].harnessId;
 const texturePng='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
 const {createMutationHeaders}=await module('local-session.ts');
 const uploadResponse=await env.fetcher(`/api/v1/projects/${project.projectId}/attachments`,{method:'POST',headers:createMutationHeaders(env.session),body:JSON.stringify({commandId:crypto.randomUUID(),expectedRevision:project.revision,fileName:'test-texture.png',mediaType:'image/png',purpose:'covering-texture',contentBase64:texturePng})});
 assert.equal(uploadResponse.status,200);const textureAttachment=(await uploadResponse.json()).attachment;
 const connectors=[createConnector('A','X1',2,{x:100,y:100}),createConnector('B','X2',2,{x:700,y:100}),createConnector('C','X3',2,{x:550,y:420})];
 const endpoint=(id,n)=>({connectorId:id,contactId:id+':contact:'+n});
 let doc={...createEmptyHarnessDesign(),connectors,wires:[createWire('W1',endpoint('A',1),endpoint('B',1),null),createWire('W2',endpoint('A',1),endpoint('C',1),null),createWire('W3',endpoint('A',2),endpoint('C',2),null)]};
 doc={...doc,wires:doc.wires.map((w,i)=>({...w,color:['#e23737','#278d45','#227dc4'][i],e4Route:createOrthogonalE4Route(wireEndpointE4Anchor(doc,w.from),wireEndpointE4Anchor(doc,w.to))})),physicalTopology:{snap:false,nodes:[
 {id:'A1',connectorId:'A',position:{x:150,y:60},wireIds:['W1','W2']},{id:'A2',connectorId:'A',position:{x:150,y:120},wireIds:['W3']},
 {id:'B1',connectorId:'B',position:{x:-30,y:60}},{id:'C1',connectorId:'C',position:{x:-30,y:60}}],segments:[{id:'main',from:'A1',to:'B1',path:{kind:'routed',points:[]},width:24,color:'#617b8c'}],routes:[]}};
 const before=structuredClone(doc.wires);
 const cover=standardCovering(doc,'main',{x:340,y:160},'Термоусадка','heat');
 doc.physicalTopology={...doc.physicalTopology,coverings:[cover]};
 let t=branchPhysicalSegment(doc,'main',{x:460,y:160},{junction:'T',continuation:'tail',tip:'tip',branch:'branch'});
 t={...t,segments:[...t.segments,{id:'finish',from:'tip',to:'C1',path:{kind:'routed',points:[]},width:24},{id:'second-exit',from:'A2',to:'C1',path:{kind:'routed',points:[{x:300,y:500}]},width:18}]};
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
 const edited=insertPhysicalBend(doc,pipe,mid);assert.deepEqual(edited.path.points,[mid,...pipe.path.points]);
 // M4-87 separates automatic presentation from authored handles; edit only stored bends.
 const snapped={...doc,physicalTopology:{...doc.physicalTopology,snap:true}};
 const helperIndex=physicalSegmentHandles(snapped,pipe).findIndex(h=>h.bendIndex===0);
 assert.ok(helperIndex>=0);
 const preferred={x:367,y:443};
 const promoted=movePhysicalHandle(snapped,pipe,helperIndex,preferred);
 doc={...snapped,physicalTopology:{...snapped.physicalTopology,segments:snapped.physicalTopology.segments.map(s=>s.id===pipe.id?promoted:s)}};
 doc={...doc,connectors:doc.connectors.map(c=>c.id==='A'?{...c,positions:{...c.positions,drawing:{x:c.positions.drawing.x+3,y:c.positions.drawing.y+2}}}:c)};
 assert.ok(doc.physicalTopology.segments.find(s=>s.id===pipe.id).path.points.some(p=>p.x===preferred.x&&p.y===preferred.y));
 const originalWires=structuredClone(doc.wires),originalRoutes=structuredClone(doc.physicalTopology.routes);
 doc={...doc,physicalTopology:{...doc.physicalTopology,segments:doc.physicalTopology.segments.map(s=>s.id===pipe.id?{...s,path:{...s.path,points:[...s.path.points,{x:450,y:520}]}}:s)}};
 assert.deepEqual(doc.wires,originalWires);assert.deepEqual(doc.physicalTopology.routes,originalRoutes);
 const {segmentDimensionKey}=await module('editor/drawing-dimensions.ts');
 const {applyEditorCommand}=await module('editor/commands.ts');
 const dimensions=doc.physicalTopology.segments.map((s,i)=>({id:'shared-'+s.id,segmentId:s.id,from:0,to:s.path.points.length+1,pointCount:s.path.points.length+2,routeKey:segmentDimensionKey(doc,s.id),mode:'aligned',offset:40,lengthMm:100+i*25}));
 doc=applyEditorCommand(doc,{type:'set-drawing-documents',documents:{...doc.drawingDocuments,dimensions}});
 for(const w of doc.wires){const route=doc.physicalTopology.routes.find(r=>r.wireId===w.id);assert.equal(w.lengthMm,route.steps.reduce((sum,step)=>sum+dimensions.find(d=>d.segmentId===step.segmentId).lengthMm,0));}
 doc=applyEditorCommand(doc,{type:'update-wire',wireId:'W1',endCorrectionFromMm:12.5});
 const parsed=parseHarnessDesignDocument(JSON.parse(JSON.stringify(doc))),initial=await designs.get(project.projectId,harnessId);
 const legacy={...parsed,physicalTopology:{...parsed.physicalTopology,segments:parsed.physicalTopology.segments.map(({path,...segment})=>({...segment,bends:path.points,routing:path.kind==='polyline'?'fixed':'auto'}))}};
 const legacyResponse=await env.fetcher(`/api/v1/projects/${project.projectId}/harnesses/${harnessId}/design`,{method:'PUT',headers:{'Content-Type':'application/json','X-Techmap-CSRF':env.session.csrfNonce},body:JSON.stringify({expectedRevision:initial.revision,schemaVersion:1,content:legacy})});
 assert.equal(legacyResponse.status,200,await legacyResponse.text());
 const migrated=await designs.get(project.projectId,harnessId);
 assert.deepEqual(migrated.content,parsed);
 assert.ok(migrated.content.physicalTopology.segments.every(s=>s.path&&!('bends' in s)&&!('routing' in s)));
 await designs.save(project.projectId,harnessId,migrated.revision,migrated.content);
 assert.deepEqual((await designs.get(project.projectId,harnessId)).content,parsed);
 await stop();env=await start();assert.deepEqual((await createHarnessDesignApi(env.config,env.session,env.fetcher).get(project.projectId,harnessId)).content,parsed);
 // M4-94: the actual node-to-pipe operation survives API validation and restart.
 const restartedDesigns=createHarnessDesignApi(env.config,env.session,env.fetcher);
 const loaded=await restartedDesigns.get(project.projectId,harnessId);
 const joined=applyEditorCommand(loaded.content,{type:'set-physical-topology',topology:routePhysicalWires(loaded.content,
   connectPhysicalNodeToSegment(loaded.content,'C1','main',{x:330,y:160},{junction:'drag-join',segment:'drag-branch',continuation:'drag-tail'}))});
 const savedJoin=await restartedDesigns.save(project.projectId,harnessId,loaded.revision,joined);
 assert.equal(savedJoin.content.physicalTopology.segments.filter(s=>s.from==='drag-join'||s.to==='drag-join').length,3);
 assert.deepEqual(savedJoin.content.wires.map(w=>[w.id,w.from,w.to]),loaded.content.wires.map(w=>[w.id,w.from,w.to]));
 const removed=applyEditorCommand(savedJoin.content,{type:'remove-physical-segment',segmentId:'drag-branch'});
 const compact={...removed,physicalTopology:{...removed.physicalTopology,
   segments:removed.physicalTopology.segments.map((s,i)=>({...s,width:i===0?0:.125})),
   coverings:removed.physicalTopology.coverings?.map((c,i)=>({...c,width:i===0?0:250.25}))}};
 const editable=compact.physicalTopology.segments[0];
 const editControls=physicalSegmentControls(compact,editable);
 const editMid={x:(editControls[0].x+editControls[1].x)/2,y:(editControls[0].y+editControls[1].y)/2};
 const midpointEdited=applyEditorCommand(compact,{type:'edit-physical-bend',segmentId:editable.id,index:0,position:editMid,mode:'adjacent',insert:true});
 const dragged=applyEditorCommand(midpointEdited,{type:'edit-physical-bend',segmentId:editable.id,index:0,position:{x:editMid.x+7,y:editMid.y+13},mode:'carry'});
 const automatic={...dragged,physicalTopology:{...dragged.physicalTopology,snap:true,
   nodes:[...dragged.physicalTopology.nodes,{id:'dim-a',position:{x:1000,y:1000},direction:'right'},{id:'dim-b',position:{x:1360,y:1200},direction:'left'}],
   segments:[...dragged.physicalTopology.segments,{id:'dim-pipe',from:'dim-a',to:'dim-b',path:{kind:'routed',points:[]}}]}};
 const {physicalEditablePoints}=await module('editor/physical-editing.ts');
 const visible=physicalEditablePoints(automatic,automatic.physicalTopology.segments.at(-1));
 assert.ok(visible.length>2);
 const measuredAutomatic=applyEditorCommand(automatic,{type:'add-visible-pipe-dimension',id:'visible-dimension',segmentId:'dim-pipe',from:1,to:2,pointCount:visible.length,mode:'aligned'});
 let e4Base=createEmptyHarnessDesign();
 for(const [id,x] of [['x1',0],['x2',1000]])e4Base=applyEditorCommand(e4Base,{type:'add-connector',connector:createConnector(id,id,3,{x,y:0})});
 e4Base=applyEditorCommand(e4Base,{type:'flip-connector-orientation',connectorId:'x2'});
 e4Base=applyEditorCommand(e4Base,{type:'add-wire',wire:createWire('e4-test',{connectorId:'x1',contactId:'x1:contact:1'},{connectorId:'x2',contactId:'x2:contact:1'})});
 e4Base=applyEditorCommand(e4Base,{type:'set-e4-wire-route',wireId:'e4-test',route:[{x:648,y:64},{x:648,y:200},{x:976,y:200},{x:976,y:64}]});
 e4Base=applyEditorCommand(e4Base,{type:'edit-e4-bend',wireId:'e4-test',index:0,position:{x:636,y:64},mode:'adjacent',insert:true});
 e4Base=applyEditorCommand(e4Base,{type:'edit-e4-bend',wireId:'e4-test',index:2,position:{x:700,y:250},mode:'adjacent'});
 assert.ok(e4Base.wires[0].e4Route.some((p,i,points)=>i>0&&p.x!==points[i-1].x&&p.y!==points[i-1].y));
 const e4JunctionPoint={x:838,y:225};
 e4Base=applyEditorCommand(e4Base,{type:'create-junction',junction:{id:'e4-junction',position:e4JunctionPoint,wireIds:['e4-test','e4-branch']},branchWire:createWire('e4-branch',{connectorId:'x1',contactId:'x1:contact:3'},{junctionId:'e4-junction',connectorId:'',contactId:''})});
 const owner=e4Base.wires.find(w=>w.id==='e4-test'),corner=owner.e4Route.findIndex(p=>p.x===700&&p.y===250);
 e4Base=applyEditorCommand(e4Base,{type:'edit-e4-bend',wireId:'e4-test',index:corner,position:{x:720,y:270},mode:'adjacent'});
 const {wireE4PathContainsPoint}=await module('editor/model.ts');
 for(const id of ['e4-test','e4-branch'])assert.ok(wireE4PathContainsPoint(e4Base,e4Base.wires.find(w=>w.id===id),e4Base.junctions[0].position));
 e4Base=applyEditorCommand(e4Base,{type:'create-screen',screen:{id:'diagonal-screen',wireIds:['e4-test'],position:.4,width:32,label:'SH',terminalSide:'above'}});
 let shared=createEmptyHarnessDesign();
 for(const [id,x] of [['shared-a',0],['shared-b',1000]])shared=applyEditorCommand(shared,{type:'add-connector',connector:createConnector(id,id,4,{x,y:800})});
 shared=applyEditorCommand(shared,{type:'flip-connector-orientation',connectorId:'shared-b'});
 shared=parseHarnessDesignDocument({...shared,wires:[1,2].map(n=>({...createWire('shared-'+n,{connectorId:'shared-a',contactId:'shared-a:contact:'+n},{connectorId:'shared-b',contactId:'shared-b:contact:'+n}),e4RouteMode:'manual',e4Route:n===1
   ?[{x:740,y:864},{x:740,y:1050},{x:860,y:1050},{x:860,y:864}]
   :[{x:700,y:888},{x:800,y:988},{x:930,y:988},{x:930,y:888}]})),junctions:[{id:'shared-j',position:{x:740,y:928},wireIds:['shared-1','shared-2']}]});
 shared=applyEditorCommand(shared,{type:'move-connector',connectorId:'shared-a',view:'e4',position:{x:10,y:820},physicalDragMode:'carry'});
 for(const wire of shared.wires)assert.ok(wireE4PathContainsPoint(shared,wire,shared.junctions[0].position));
 let twisted=createEmptyHarnessDesign();
 for(const [id,x,y] of [['pair-a',0,1600],['pair-b',1000,1800]])twisted=applyEditorCommand(twisted,{type:'add-connector',connector:createConnector(id,id,2,{x,y})});
 twisted=applyEditorCommand(twisted,{type:'flip-connector-orientation',connectorId:'pair-b'});
 twisted=parseHarnessDesignDocument({...twisted,wires:[1,2].map(n=>({...createWire('pair-'+n,{connectorId:'pair-a',contactId:'pair-a:contact:'+n},{connectorId:'pair-b',contactId:'pair-b:contact:'+n}),e4RouteMode:'manual',e4Route:[{x:700,y:1640+24*n},{x:900,y:1840+24*n}]}))});
 twisted=applyEditorCommand(twisted,{type:'create-diff-pair',group:{id:'inclined-pair',wireIds:['pair-1','pair-2'],step:20,amplitude:4,variant:2}});
 let combined={...measuredAutomatic,diffPairs:twisted.diffPairs,screens:e4Base.screens,connectors:[...measuredAutomatic.connectors,...e4Base.connectors,...shared.connectors,...twisted.connectors],wires:[...measuredAutomatic.wires,...e4Base.wires,...shared.wires,...twisted.wires],junctions:[...measuredAutomatic.junctions,...e4Base.junctions,...shared.junctions]};
 combined.drawingDocuments={...addDrawingPositions(combined),leaderScale:2.5,bendRadius:0,volumeShading:false};
 const coveringStyle={texture:`asset:${textureAttachment.sha256}`,textureScale:2.5,textureRotation:-30,hatch:'cross',hatchColor:'#ff0000',hatchSpacing:6,hatchRotation:60,lineColor:'#0000ff'};
 combined.drawingDocuments.coveringLibrary={textures:[{sha256:textureAttachment.sha256,name:'test-texture.png'}],defaults:{braid:{texture:coveringStyle.texture}}};
 combined.physicalTopology={...combined.physicalTopology,coverings:combined.physicalTopology.coverings.map(c=>({...c,style:coveringStyle}))};
 assert.ok(combined.physicalTopology.coverings.length>0);
 // Bundle membership survives the same persistence boundaries as sleeves.
 // Persist membership, motion and derived projection through all boundaries.
 const bundlePipes=combined.physicalTopology.segments.slice(0,3).map(s=>s.id);
 assert.equal(bundlePipes.length,3);
 const bundleCover=(id,mode,members)=>({id,name:id,kind:'heat-shrink',width:0,color:'#8899aa',lengthMm:null,
   spans:[{segmentId:bundlePipes[0],from:.2,to:.8}],bundle:{mode,members}});
 const innerBundle=bundleCover('bundle-inner','flat',bundlePipes.slice(0,2).map(id=>({kind:'segment',id})));
 const outerBundle=bundleCover('bundle-outer','round',[{kind:'covering',id:innerBundle.id},{kind:'segment',id:bundlePipes[2]}]);
 const chainBundle={...bundleCover('bundle-chain','flat',[{kind:'segment',id:'chain-head',continuationIds:['chain-tail']},{kind:'segment',id:bundlePipes[2]}]),spans:[{segmentId:'chain-head',from:.2,to:1},{segmentId:'chain-tail',from:0,to:.8}]};
 let expectedBundleGroups=[outerBundle,innerBundle,chainBundle];
 combined.physicalTopology={...combined.physicalTopology,
   nodes:[...combined.physicalTopology.nodes,...[0,1,2].map(i=>({id:`chain-node-${i}`,position:{x:200+i*100,y:2200}}))],
   segments:[...combined.physicalTopology.segments,...['chain-head','chain-tail'].map((id,i)=>({id,from:`chain-node-${i}`,to:`chain-node-${i+1}`,path:{kind:'polyline',points:[]}}))],
   coverings:[...combined.physicalTopology.coverings,...expectedBundleGroups]};
 const {moveCovering,coveringScene}=await module('editor/covering-layout.ts');
 const {pipeBundleDisplaySamples}=await module('editor/pipe-bundle-projection.ts');
 const movedBundle=moveCovering(combined,'bundle-chain',0,'body',{x:260,y:2200},{x:270,y:2200});
 assert.ok(movedBundle);
 assert.ok(Math.abs(movedBundle.spans[0].from-.3)<1e-7);
 assert.ok(Math.abs(movedBundle.spans[1].to-.9)<1e-7);
 // Match editor commands: each change creates a new immutable document so
 // presentation caches cannot retain the geometry from before the sleeve drag.
 combined={...combined,physicalTopology:{...combined.physicalTopology,coverings:combined.physicalTopology.coverings.map(c=>c.id===movedBundle.id?movedBundle:c)}};
 // Independent supports, including a reversed path, follow one sleeve gesture.
 const multiSupport={...chainBundle,id:'bundle-multiple',lengthMode:'manual',lengthMm:123,
   spans:[{segmentId:'chain-head',from:.2,to:1},{segmentId:'chain-tail',from:0,to:.8},{segmentId:'support-reverse',from:.2,to:.8}],
   bundle:{mode:'flat',members:[{kind:'segment',id:'chain-head',continuationIds:['chain-tail']},{kind:'segment',id:'support-reverse'}]}};
 combined={...combined,physicalTopology:{...combined.physicalTopology,
   nodes:[...combined.physicalTopology.nodes,{id:'support-left',position:{x:200,y:2300}},{id:'support-right',position:{x:400,y:2300}}],
   segments:[...combined.physicalTopology.segments,{id:'support-reverse',from:'support-right',to:'support-left',path:{kind:'polyline',points:[]}}],
   coverings:[...combined.physicalTopology.coverings,multiSupport]}};
 const lengthsBefore=JSON.stringify({wires:combined.wires,segments:combined.physicalTopology.segments,dimensions:combined.drawingDocuments.dimensions});
 const movedMultiple=moveCovering(combined,multiSupport.id,0,'body',{x:260,y:2200},{x:270,y:2200});
 assert.ok(movedMultiple);
 assert.ok(Math.abs(movedMultiple.spans.find(s=>s.segmentId==='chain-head').from-.3)<1e-7);
 assert.ok(Math.abs(movedMultiple.spans.find(s=>s.segmentId==='chain-tail').to-.9)<1e-7);
 assert.ok(Math.abs(movedMultiple.spans.find(s=>s.segmentId==='support-reverse').from-.15)<1e-7);
 assert.ok(Math.abs(movedMultiple.spans.find(s=>s.segmentId==='support-reverse').to-.75)<1e-7);
 assert.equal(movedMultiple.lengthMm,123);
 combined={...combined,physicalTopology:{...combined.physicalTopology,coverings:combined.physicalTopology.coverings.map(c=>c.id===movedMultiple.id?movedMultiple:c)}};
 assert.equal(JSON.stringify({wires:combined.wires,segments:combined.physicalTopology.segments,dimensions:combined.drawingDocuments.dimensions}),lengthsBefore);
 expectedBundleGroups=combined.physicalTopology.coverings.filter(c=>c.bundle);
 const bundleDisplay=content=>({pipes:content.physicalTopology.segments.flatMap(s=>{const p=pipeBundleDisplaySamples(content,s.id);return p?[{id:s.id,samples:p}]:[];}),
   shells:coveringScene(content).filter(c=>expectedBundleGroups.some(g=>g.id===c.id)).map(c=>({id:c.id,paths:c.paths,width:c.width}))});
 const expectedDisplay=bundleDisplay(combined);
 assert.ok(expectedDisplay.pipes.length>=4);
 const leaderScene=drawingDocumentScene(combined);
 assert.ok(leaderScene.some(o=>o.kind==='position-leader'&&o.width===60));
 const savedRemoved=await restartedDesigns.save(project.projectId,harnessId,savedJoin.revision,combined);
 assert.deepEqual(bundleDisplay(savedRemoved.content),expectedDisplay,'Bundle projection survives save');
 const invalidBundle=structuredClone(combined);
 invalidBundle.physicalTopology.coverings.find(c=>c.id==='bundle-inner').bundle.members[1]={kind:'covering',id:'bundle-outer'};
 const invalidBundleResponse=await env.fetcher(`/api/v1/projects/${project.projectId}/harnesses/${harnessId}/design`,{
   method:'PUT',headers:createMutationHeaders(env.session),body:JSON.stringify({expectedRevision:savedRemoved.revision,schemaVersion:1,content:invalidBundle})});
 assert.equal(invalidBundleResponse.status,400,'Cyclic bundle rejected by server');
 assert.deepEqual((await restartedDesigns.get(project.projectId,harnessId)).content,savedRemoved.content,'Rejected bundle leaves document unchanged');
 const disconnected=structuredClone(combined);
 disconnected.physicalTopology.coverings.find(c=>c.id==='bundle-chain').bundle.members[0].continuationIds=[bundlePipes[1]];
 const disconnectedResponse=await env.fetcher(`/api/v1/projects/${project.projectId}/harnesses/${harnessId}/design`,{
   method:'PUT',headers:createMutationHeaders(env.session),body:JSON.stringify({expectedRevision:savedRemoved.revision,schemaVersion:1,content:disconnected})});
 assert.equal(disconnectedResponse.status,400,'Disconnected continuation rejected by server');
 assert.deepEqual((await restartedDesigns.get(project.projectId,harnessId)).content,savedRemoved.content);
 assert.equal(savedRemoved.content.drawingDocuments.leaderScale,2.5);
 assert.equal(savedRemoved.content.drawingDocuments.bendRadius,0);
 assert.equal(savedRemoved.content.drawingDocuments.volumeShading,false);
 assert.deepEqual(savedRemoved.content.drawingDocuments.leaders,JSON.parse(JSON.stringify(combined.drawingDocuments.leaders)));
 assert.deepEqual(savedRemoved.content.wires.find(w=>w.id==='e4-test').e4Route,e4Base.wires[0].e4Route);
 assert.deepEqual(savedRemoved.content.junctions,combined.junctions);
 assert.deepEqual(savedRemoved.content.screens,combined.screens);
 assert.deepEqual(savedRemoved.content.diffPairs,combined.diffPairs);
 assert.deepEqual(savedRemoved.content.physicalTopology.segments,combined.physicalTopology.segments);
 assert.deepEqual(savedRemoved.content.drawingDocuments.dimensions,measuredAutomatic.drawingDocuments.dimensions);
 assert.deepEqual(savedRemoved.content.physicalTopology.coverings,JSON.parse(JSON.stringify(combined.physicalTopology.coverings)));
 assert.ok(!savedRemoved.content.physicalTopology.segments.some(s=>s.id==='drag-branch'));
 await stop();env=await start();
 const reopened=(await createHarnessDesignApi(env.config,env.session,env.fetcher).get(project.projectId,harnessId)).content;
 assert.deepEqual(reopened,savedRemoved.content);
 assert.deepEqual(bundleDisplay(reopened),expectedDisplay,'Bundle projection survives restart');
 const {createCoveringAssetApi}=await module('editor/covering-assets.ts');
 const copied=await createProjectApi(env.config,env.session,env.fetcher).copyProject(project.projectId);
 const copyContent=(await createHarnessDesignApi(env.config,env.session,env.fetcher).get(copied.projectId,copied.harnesses[0].harnessId)).content;
 assert.deepEqual(copyContent.drawingDocuments.coveringLibrary,combined.drawingDocuments.coveringLibrary);
 assert.equal(copyContent.drawingDocuments.volumeShading,false);
 assert.deepEqual(copyContent.physicalTopology.coverings.filter(c=>c.bundle),expectedBundleGroups);
 assert.deepEqual(bundleDisplay(copyContent),expectedDisplay,'Bundle projection survives copy');
 const assets=await createCoveringAssetApi(env.config,env.session,copied.projectId,env.fetcher).list();
 const copiedTexture=assets.find(a=>a.entry.sha256===textureAttachment.sha256);assert.ok(copiedTexture);
 const textureResponse=await env.fetcher(copiedTexture.url);assert.equal(textureResponse.status,200);
 assert.equal(Buffer.from(await textureResponse.arrayBuffer()).toString('base64'),texturePng);
 await stop();const exportPath=dataRoot+'-texture-roundtrip.techmap-project.zip';
 assert.match(await maintenance([`--export-project=${project.projectId}`,`--export-destination=${exportPath}`]),/TECHMAP_PROJECT_EXPORT_STATUS=ok/);
 const importLog=await maintenance([`--import-project=${exportPath}`]),importId=/TECHMAP_PROJECT_IMPORT_PROJECT_ID=([^\s]+)/.exec(importLog)?.[1];assert.ok(importId,importLog);
 env=await start();const importedProject=await createProjectApi(env.config,env.session,env.fetcher).getProject(importId);
 const importedDesign=await createHarnessDesignApi(env.config,env.session,env.fetcher).get(importId,importedProject.harnesses[0].harnessId);
 assert.deepEqual(importedDesign.content.drawingDocuments.coveringLibrary,combined.drawingDocuments.coveringLibrary);
 assert.equal(importedDesign.content.drawingDocuments.volumeShading,false);
 assert.deepEqual(importedDesign.content.physicalTopology.coverings.filter(c=>c.bundle),expectedBundleGroups);
 assert.deepEqual(bundleDisplay(importedDesign.content),expectedDisplay,'Bundle projection survives export/import');
 const importedAssets=await createCoveringAssetApi(env.config,env.session,importId,env.fetcher).list();
 const importedTexture=importedAssets.find(a=>a.entry.sha256===textureAttachment.sha256);assert.ok(importedTexture);
 const importedBytes=await env.fetcher(importedTexture.url);assert.equal(importedBytes.status,200);assert.equal(Buffer.from(await importedBytes.arrayBuffer()).toString('base64'),texturePng);
 const report={status:'ok',dataRoot,projectId:project.projectId,harnessId,branchChecked:true,multipleExitsChecked:true,wireIdentityChecked:true,bomChecked:true,restartChecked:true,pipeEditingChecked:true,automaticExitsChecked:true,sharedDimensionsChecked:true,nodeToPipeChecked:true,pipeRemovalRestartChecked:true,compactWidthsChecked:true,midpointEditingChecked:true,automaticCornerDimensionChecked:true,e4MidpointChecked:true,e4DiagonalChecked:true};
 await writeFile(join(dataRoot,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
} finally {await stop();await vite.close();await writeFile(join(dataRoot,'server.log'),log);}
