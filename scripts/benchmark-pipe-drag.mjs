// Synthetic drawing only. No server or user project is opened.
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Session } from 'node:inspector';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const client=join(root,'src/Techmap.Client'),require=createRequire(join(client,'package.json'));
const {createServer}=await import(pathToFileURL(require.resolve('vite')).href);
const vite=await createServer({root:client,configFile:false,server:{middlewareMode:true,hmr:false,ws:false},appType:'custom'});
try {
 const load=name=>vite.ssrLoadModule(`/src/editor/${name}`);
 const {createEmptyHarnessDesign}=await load('model.ts');
 const {createConnector,createWire,applyEditorCommand}=await load('commands.ts');
 const {designToScene}=await load('HarnessDesignEditor.tsx');
 const count=Number(process.env.PIPE_BENCH_WIRES??24),iterations=40;
 const connectors=['A','B'].map((id,i)=>createConnector(id,id,count,{x:i*1000,y:0}));
 const wires=Array.from({length:count},(_,i)=>createWire('w'+i,{connectorId:'A',contactId:`A:contact:${i+1}`},{connectorId:'B',contactId:`B:contact:${i+1}`}));
 const inner={id:'inner',name:'Inner',width:0,color:'#777777',lengthMm:null,spans:[{segmentId:'s0',from:.15,to:.85}],bundle:{mode:'flat',members:[{kind:'segment',id:'s0'},{kind:'segment',id:'s1'}]}};
 const outer={...inner,id:'outer',spans:[{segmentId:'s0',from:.4,to:.6}],bundle:{mode:'flat',members:[{kind:'covering',id:'inner'},{kind:'segment',id:'s2'}]}};
 const base={...createEmptyHarnessDesign(),connectors,wires,drawingDocuments:{tables:[],leaders:[],bomOrder:[],bendRadius:18},physicalTopology:{snap:false,
   nodes:[0,1,2].flatMap(i=>[{id:'a'+i,position:{x:150,y:100+i*150}},{id:'b'+i,position:{x:850,y:100+i*150}}]),
   segments:[0,1,2].map(i=>({id:'s'+i,from:'a'+i,to:'b'+i,path:{kind:'polyline',points:[{x:300,y:100+i*150},{x:400,y:160+i*150},{x:600,y:160+i*150},{x:700,y:100+i*150}]},width:10})),
   routes:wires.map((w,i)=>({wireId:w.id,steps:[{segmentId:'s'+i%3,reverse:false}]})),coverings:[inner,outer]}};
 const frame=i=>{
   const start=performance.now();
   const document=applyEditorCommand(base,{type:'edit-physical-bend',segmentId:'s0',index:1,position:{x:400+i,y:160+i/2},mode:'carry'});
   const command=performance.now()-start;
   const scene=designToScene(document,'drawing');
   return {command,total:performance.now()-start,objects:scene.length};
 };
 for(let i=0;i<8;i++)frame(i);
 const session=new Session();session.connect();
 const post=(method)=>new Promise((res,rej)=>session.post(method,(e,r)=>e?rej(e):res(r)));
 await post('Profiler.enable');await post('Profiler.start');
 const frames=Array.from({length:iterations},(_,i)=>frame(i));
 const {profile}=await post('Profiler.stop');session.disconnect();
 const hits=new Map();for(const node of profile.nodes){const name=node.callFrame.functionName||'(anonymous)';hits.set(name,(hits.get(name)??0)+(node.hitCount??0));}
 const summary=key=>{const values=frames.map(f=>f[key]).sort((a,b)=>a-b);return {medianMs:+values[Math.floor(values.length/2)].toFixed(2),p95Ms:+values[Math.floor(values.length*.95)].toFixed(2)};};
 console.log(JSON.stringify({wires:count,pipes:3,nestedCoverings:2,frames:iterations,command:summary('command'),geometryFrame:summary('total'),hotFunctions:[...hits].sort((a,b)=>b[1]-a[1]).slice(0,14)},null,2));
} finally {await vite.close();}
