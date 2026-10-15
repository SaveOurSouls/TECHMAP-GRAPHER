import {describe,it,expect} from 'vitest';
import {BUILTIN_TERMINATION_RECORDS,createTerminationPlacement} from '../termination-library';
import {applyEditorCommand,createConnector,createWire} from './commands';
import {createEmptyHarnessDesign,connectorContactPosition,parseHarnessDesignDocument} from './model';
import {terminationSceneObject} from './termination-scene';
import {designToScene} from './HarnessDesignEditor';
import {getE4ConnectorLayout,hitTestConnectorContact} from './CanvasViewport';
import {emptyTerminationDocument} from './termination-model';
import {physicalFixture} from './physical-topology-fixture';
import {physicalMultiTwistPath} from './physical-multi-twist';

describe('termination editor integration',()=>{
 it.each(['nki-ring','nshvi-double','sleeve-insulated','preparation-none'])('renders %s anchors exactly where wires connect after JSON round trip',assetId=>{
  const record=BUILTIN_TERMINATION_RECORDS.find(r=>r.assetId===assetId)!;
  const placement=createTerminationPlacement(record,{id:'t',designation:'T1',position:{x:100,y:200}});
  const d=applyEditorCommand(createEmptyHarnessDesign(),{type:'add-termination-component',...placement});
  const parsed=parseHarnessDesignDocument(JSON.parse(JSON.stringify(d)));
  for(const view of ['e4','drawing'] as const){
   const c=parsed.connectors[0]!,scene=terminationSceneObject(parsed,c,view);
   expect(getE4ConnectorLayout(scene)).toBeNull();
   const points=JSON.parse(scene.metadata!.materializedContactPoints!);
   expect(points).toHaveLength(assetId.startsWith('sleeve')?2:1);
   for(const [i,p] of points.entries()){
    const pos=connectorContactPosition(c,c.contacts[i]!.id,view)!;
    expect(pos).toEqual({x:scene.x+p.x,y:scene.y+p.y});
    const hit=hitTestConnectorContact([scene],parsed.views[view].layers.map(l=>({...l,label:l.name})),pos,1,view);
    expect(hit).toEqual({connectorId:'t',contactIndex:i});
   }
   expect(scene.metadata!.terminationPointOnly).toBe(String(assetId==='preparation-none'&&view==='drawing'));
  }
 });
 it('keeps shared-terminal wires on the same picture anchor in both views',()=>{
  const placement=createTerminationPlacement(BUILTIN_TERMINATION_RECORDS.find(r=>r.assetId==='nki-ring')!,{id:'t',designation:'T1',position:{x:50,y:100}});
  let d=applyEditorCommand(createEmptyHarnessDesign(),{type:'add-termination-component',...placement});
  for(let i=0;i<4;i++){
   const c=createConnector('x'+i,'X'+i,1,{x:700,y:200+i*150});d=applyEditorCommand(d,{type:'add-connector',connector:c});
   d=applyEditorCommand(d,{type:'add-wire',wire:createWire('w'+i,{connectorId:'t',contactId:placement.connector.contacts[0]!.id},{connectorId:c.id,contactId:c.contacts[0]!.id},100)});
  }
  for(const view of ['e4','drawing'] as const){const wires=designToScene(d,view).filter(o=>o.kind==='wire');expect(wires).toHaveLength(4);expect(wires.every(w=>w.points?.[0]?.x===82&&w.points?.[0]?.y===150)).toBe(true);}
 });
 it.each([2,3,4])('renders a %i-conductor physical twist without modifying endpoints or lengths',count=>{
  const base=physicalFixture(),seed=base.wires[0]!;
  const wires=Array.from({length:count},(_,i)=>({...seed,id:'tw'+i,color:i%2?'#a00':'#00a'}));
  const d={...base,wires,physicalTopology:{...base.physicalTopology!,routes:wires.map(w=>({...base.physicalTopology!.routes[0]!,wireId:w.id}))},terminations:{...emptyTerminationDocument(),twists:[{id:'tw',memberWireIds:wires.map(w=>w.id),segmentIds:['S0'],pitchMm:30,direction:'right' as const}]}};
  const before=JSON.stringify(d),center=[{x:0,y:0},{x:160,y:0},{x:160,y:100}];
  const paths=wires.map(w=>physicalMultiTwistPath(d,'S0',w.id,center));
  expect(paths.every(p=>p&&p.path.length>10)).toBe(true);
  expect(new Set(paths.map(p=>JSON.stringify(p!.path)))).toHaveLength(count);
  expect(physicalMultiTwistPath(d,'S1',wires[0]!.id,center)).toBeNull();
  expect(JSON.stringify(d)).toBe(before);
 });
});
