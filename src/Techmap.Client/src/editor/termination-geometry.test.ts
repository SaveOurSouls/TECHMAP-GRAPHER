import {afterEach,describe,expect,it,vi} from 'vitest';
import {BUILTIN_TERMINATION_RECORDS,createTerminationPlacement} from '../termination-library';
import {createEmptyHarnessDesign,connectorContactPosition,type HarnessDesignDocument} from './model';
import {terminationSceneObject,terminationSceneBounds} from './termination-scene';
import {drawingConnectorIndexLabel,getEditorSceneBounds,hitTestEditorScene,objectIntersectsSelectionRectangle,redrawCanvas} from './CanvasViewport';
import {physicalMultiTwistPath} from './physical-multi-twist';
import {physicalFixture} from './physical-topology-fixture';
import {emptyTerminationDocument} from './termination-model';
import {drawingPipeWidth,drawingWireWidth,segmentWireLanes} from './drawing-thickness';
import {alignDrawingConnectorIndexes,drawingObjectIndexScene,moveDrawingIndex} from './drawing-indices';
import type {EditorLayer,EditorSceneObject} from './editor-types';

const layers:EditorLayer[]=[{id:'symbols',label:'Наконечники',visible:true,locked:false},{id:'pipes',label:'Пайпы',visible:true,locked:false}];
function rotatedScene(angle=90,scale=1,assetId='nki-ring'){
 const placement=createTerminationPlacement(BUILTIN_TERMINATION_RECORDS.find(r=>r.assetId===assetId)!,{id:'t',designation:assetId.startsWith('preparation-')?'Р1':'T1',position:{x:100,y:200}});
 const connector={...placement.connector,layerIds:{...placement.connector.layerIds,drawing:'symbols'},drawingPlacements:[{drawingId:'view:drawing',visible:true,offset:{x:0,y:0},rotationDegrees:angle,scale}]};
 const document={...createEmptyHarnessDesign(),connectors:[connector]};
 return {connector,document,object:terminationSceneObject(document,connector,'drawing')};
}
afterEach(()=>vi.unstubAllGlobals());
describe('termination transformed geometry',()=>{
 it.each([[0,1],[90,2],[-45,.5]])('bounds point-only preparation and its adjacent label at %s degrees / scale %s',(angle,scale)=>{
  const {connector,document,object}=rotatedScene(angle,scale,'preparation-none');
  const anchor=connectorContactPosition(connector,connector.contacts[0]!.id,'drawing')!,b=terminationSceneBounds(object)!;
  expect(b).toEqual({minX:anchor.x-4,minY:anchor.y-4,maxX:anchor.x+4,maxY:anchor.y+4});
  expect(hitTestEditorScene([object],layers,anchor,1,'drawing')).toBe('t');
  expect(hitTestEditorScene([object],layers,{x:anchor.x+40,y:anchor.y+40},1,'drawing')).toBeNull();
  expect(objectIntersectsSelectionRectangle(object,{start:{x:anchor.x-2,y:anchor.y-2},end:{x:anchor.x+2,y:anchor.y+2}})).toBe(true);
  expect(objectIntersectsSelectionRectangle(object,{start:{x:anchor.x+35,y:anchor.y+35},end:{x:anchor.x+45,y:anchor.y+45}})).toBe(false);
  const label=drawingConnectorIndexLabel(object,b),fit=getEditorSceneBounds([object],layers,'drawing')!;
  expect(label.text).toBe('Р1');expect(Math.hypot(label.x-anchor.x,label.y-anchor.y)).toBeLessThan(20);
  expect(fit.minX).toBeLessThanOrEqual(label.minX);expect(fit.minY).toBeLessThanOrEqual(label.minY);expect(fit.maxX).toBeGreaterThanOrEqual(label.maxX);expect(fit.maxY).toBeGreaterThanOrEqual(anchor.y+4);
  expect(fit.maxX-fit.minX).toBeLessThan(50);expect(fit.maxY-fit.minY).toBeLessThan(50);
  const indices=alignDrawingConnectorIndexes(document,[object,...drawingObjectIndexScene(document,[object])],[]),index=indices.find(o=>o.kind==='object-index')!;
  expect(index.label).toBe('Р1');expect(Math.hypot(index.x-anchor.x,index.y-anchor.y)).toBeLessThan(20);
  expect(index.x).toBeGreaterThanOrEqual(fit.minX);expect(index.y).toBeGreaterThanOrEqual(fit.minY);expect(index.x+index.width).toBeLessThanOrEqual(fit.maxX);expect(index.y+18).toBeLessThanOrEqual(fit.maxY);
 });
 it.each(['nki-ring','sleeve-insulated','preparation-none'])('keeps the %s index on actual rotated bounds and retains a dragged offset',assetId=>{
  const {document,object}=rotatedScene(90,2,assetId),b=terminationSceneBounds(object)!;
  const scene=alignDrawingConnectorIndexes(document,[object,...drawingObjectIndexScene(document,[object])],[]),index=scene.find(o=>o.kind==='object-index')!;
  expect(Number(index.metadata?.indexBaseX)).toBeCloseTo(b.maxX+6);expect(Number(index.metadata?.indexBaseY)).toBeCloseTo(b.minY+12);
  const moved=moveDrawingIndex(document,index.id,{x:b.maxX+60,y:(b.minY+b.maxY)/2},scene)!;
  const offset=moved.indexOffsets![object.id]!,nextDocument={...document,drawingDocuments:moved};
  const next=alignDrawingConnectorIndexes(nextDocument,[object,...drawingObjectIndexScene(nextDocument,[object])],[]).find(o=>o.kind==='object-index')!;
  expect(next.x).toBeCloseTo(Number(next.metadata?.indexBaseX)+offset.x);expect(next.y).toBeCloseTo(Number(next.metadata?.indexBaseY)+offset.y);
  expect(nextDocument.drawingDocuments.indexOffsets![object.id]).toEqual(offset);
  expect(Math.abs(next.x-index.x)+Math.abs(next.y-index.y)).toBeGreaterThan(20);
 });
 it('hits the rotated head and fits/box-selects its real extent while preserving the electrical anchor',()=>{
  const {connector,object}=rotatedScene();
  const b=terminationSceneBounds(object)!;
  expect(b.minX).toBeCloseTo(27.5625);expect(b.minY).toBeCloseTo(206.1875);expect(b.maxX).toBeCloseTo(72.4375);expect(b.maxY).toBeCloseTo(373.375);
  expect(connectorContactPosition(connector,connector.contacts[0]!.id,'drawing')).toEqual({x:50,y:232});
  expect(hitTestEditorScene([object],layers,{x:50,y:360},1,'drawing')).toBe('t');
  expect(hitTestEditorScene([object],layers,{x:260,y:250},1,'drawing')).toBeNull();
  expect(objectIntersectsSelectionRectangle(object,{start:{x:45,y:350},end:{x:55,y:370}})).toBe(true);
  const fit=getEditorSceneBounds([object],layers,'drawing')!;
  expect(fit.minX).toBeCloseTo(27.5625);expect(fit.maxY).toBeCloseTo(373.375);expect(fit.minY).toBeLessThan(200);
 });
 it.each([[-135,.5],[45,2],[180,1.25]])('inverse hit transform agrees with the image at %s degrees / scale %s',(angle,scale)=>{
  const {object}=rotatedScene(angle,scale),a=angle*Math.PI/180;
  const p={x:100+scale*(160*Math.cos(a)-50*Math.sin(a)),y:200+scale*(160*Math.sin(a)+50*Math.cos(a))};
  expect(hitTestEditorScene([object],layers,p,1,'drawing')).toBe('t');
  const b=terminationSceneBounds(object)!;expect(p.x).toBeGreaterThanOrEqual(b.minX);expect(p.x).toBeLessThanOrEqual(b.maxX);expect(p.y).toBeGreaterThanOrEqual(b.minY);expect(p.y).toBeLessThanOrEqual(b.maxY);
 });
 it('paints exactly one index after pipe/covering and marks the wire anchor in world coordinates once',()=>{
  vi.stubGlobal('window',{devicePixelRatio:1});
  const {object}=rotatedScene(),ops:{method:string;args:unknown[];color:unknown}[]=[],state:Record<string,unknown>={};
  const context=new Proxy(state,{get(target,key:string){if(key in target)return target[key];return(...args:unknown[])=>ops.push({method:key,args,color:key==='stroke'?target.strokeStyle:target.fillStyle});}}) as unknown as CanvasRenderingContext2D;
  const canvas={width:600,height:600,clientWidth:600,clientHeight:600,getContext:()=>context} as unknown as HTMLCanvasElement;
  const pipe:EditorSceneObject={id:'P',kind:'physical-segment',layerId:'pipes',label:'',x:0,y:220,width:18,height:0,color:'#aabbcc',points:[{x:0,y:220},{x:200,y:220}]};
  const covering:EditorSceneObject={...pipe,id:'cover',kind:'physical-covering',color:'#445566',metadata:{surfaces:JSON.stringify([{polygon:[{x:0,y:210},{x:200,y:210},{x:200,y:240},{x:0,y:240}]}])}};
  redrawCanvas(canvas,'drawing',{offsetX:0,offsetY:0,zoom:1},[object,pipe,covering],layers,new Set());
  const labels=ops.map((o,i)=>({...o,index:i})).filter(o=>o.method==='fillText'&&o.args[0]==='T1');
  const label=drawingConnectorIndexLabel(object,terminationSceneBounds(object)!);
  expect(labels).toHaveLength(1);expect(labels[0]!.args[1]).toBeCloseTo(label.x);expect(labels[0]!.args[2]).toBeCloseTo(label.y);
  const lastSurface=ops.reduce((n,o,i)=>o.color==='#aabbcc'||o.color==='#445566'?i:n,-1);
  expect(lastSurface).toBeGreaterThan(-1);expect(labels[0]!.index).toBeGreaterThan(lastSurface);
  expect(ops.some(o=>o.method==='arc'&&o.args[0]===50&&o.args[1]===232)).toBe(true);
  expect(ops.some(o=>o.method==='arc'&&o.args[0]===150&&o.args[1]===432)).toBe(false);
 });
});
describe('multi-wire twist physical envelope',()=>{
 const cases=[2,3,4].flatMap(count=>(['flat','round'] as const).flatMap(mode=>[false,true].map(mixed=>({count,mode,mixed}))));
 it.each(cases)('keeps $count strands inside their $mode pipe (mixed widths $mixed)',({count,mode,mixed})=>{
  const base=physicalFixture(),wires=Array.from({length:count},(_,i)=>({...base.wires[0]!,id:`tw${i}`,materialBinding:{sourceId:'test',snapshotId:'test',snapshotSha256:'0'.repeat(64),recordId:`r${i}`,entityType:'wire' as const,sourceKey:`r${i}`,displayName:'wire',sectionUnit:'mm2' as const,outerDiameterMm:mixed&&i===0?4:1}}));
  const document:HarnessDesignDocument={...base,wires,physicalTopology:{...base.physicalTopology!,segments:base.physicalTopology!.segments.map(s=>({...s,mode})),routes:wires.map(w=>({...base.physicalTopology!.routes[0]!,wireId:w.id}))},terminations:{...emptyTerminationDocument(),twists:[{id:'twist',memberWireIds:wires.map(w=>w.id),segmentIds:['S0'],pitchMm:30,direction:'right'}]}};
  const before=JSON.stringify(document),half=drawingPipeWidth(document,document.physicalTopology!.segments[0]!)/2;
  for(const wire of wires){const p=physicalMultiTwistPath(document,'S0',wire.id,[{x:0,y:0},{x:240,y:0}])!,lane=segmentWireLanes(document,'S0').find(l=>l.id===wire.id)!;
   expect(p.path[0]!.y).toBeCloseTo(lane.offset);expect(p.path.at(-1)!.y).toBeCloseTo(lane.offset);
   expect(Math.max(...p.path.map(p=>Math.abs(p.y)))+drawingWireWidth(document,wire)/2).toBeLessThanOrEqual(half+1e-9);
  }
  expect(JSON.stringify(document)).toBe(before);
 });
});
