import { describe, it, expect } from 'vitest';
import { physicalFixture } from './physical-topology-fixture';
import { ensureConnectorExits, insertPhysicalBend, physicalSegmentControls, physicalSegmentPoints, physicalWirePoints } from './physical-topology';
import { hitTestEditorScene, hitTestWireRoutePoint } from './CanvasViewport';
import { designToScene } from './HarnessDesignEditor';
import { applyEditorCommand } from './commands';
import { parseHarnessDesignDocument } from './model';

const layers=[{id:'wires',label:'Провода',visible:true,locked:false},{id:'connectors',label:'Компоненты',visible:true,locked:false}];
describe('pipe editing regressions M4-70',()=>{
 it('adds one exit per connector without replacing existing exits/routes or duplicating on reopen',()=>{
  const d=physicalFixture();expect(ensureConnectorExits(d)).toBe(d.physicalTopology);
  const old={...d,physicalTopology:undefined};const t=ensureConnectorExits(old);
  expect(t.nodes.map(n=>n.connectorId)).toEqual(['A','B','C']);
  expect(ensureConnectorExits({...old,physicalTopology:t})).toBe(t);
  expect(()=>parseHarnessDesignDocument({...old,physicalTopology:t})).not.toThrow();
 });
 it('inserts a bend on the nearest leg instead of appending it after all bends',()=>{
  const d=physicalFixture();const t={...d.physicalTopology!,snap:false,nodes:[{id:'a',position:{x:0,y:0}},{id:'b',position:{x:300,y:100}}],segments:[],routes:[]};
  const doc={...d,physicalTopology:t},s={id:'pipe',from:'a',to:'b',bends:[{x:100,y:0},{x:100,y:100}]};
  const updated=insertPhysicalBend(doc,s,{x:40,y:0});expect(updated.bends).toEqual([{x:40,y:0},...s.bends]);
  expect(insertPhysicalBend(doc,s,{x:100,y:0})).toBe(s);
 });
 it('keeps snap helper vertices out of editable handles and wires follow a changed authored bend',()=>{
  const d=physicalFixture(),s=d.physicalTopology!.segments[0]!;
  expect(physicalSegmentPoints(d,s).length).toBeGreaterThan(physicalSegmentControls(d,s).length);
  const scene=designToScene(d,'drawing');const pipe=scene.find(o=>o.id==='S0')!;
  expect(hitTestWireRoutePoint(pipe,s.bends[0]!,1)).toBe(0);
  const helper=physicalSegmentPoints(d,s).find(p=>!physicalSegmentControls(d,s).some(q=>p.x===q.x&&p.y===q.y))!;
  expect(hitTestWireRoutePoint(pipe,helper,100)).toBeNull();
  const next=applyEditorCommand(d,{type:'set-physical-topology',topology:{...d.physicalTopology!,segments:d.physicalTopology!.segments.map(x=>x.id===s.id?{...x,bends:[{x:250,y:90}]}:x)}});
  expect(next.wires).toEqual(d.wires);expect(next.physicalTopology!.routes).toEqual(d.physicalTopology!.routes);
  expect(physicalWirePoints(next,'W1',{x:0,y:0},{x:1,y:1})).not.toEqual(physicalWirePoints(d,'W1',{x:0,y:0},{x:1,y:1}));
 });
 it('selects the pipe over contained wires and exposes only its assigned wire identities',()=>{
  const d=physicalFixture(),scene=designToScene(d,'drawing'),pipe=scene.find(o=>o.id==='S0')!;
  const points=pipe.points!,p={x:(points[0]!.x+points[1]!.x)/2,y:(points[0]!.y+points[1]!.y)/2};
  expect(hitTestEditorScene(scene,layers,p,10,'drawing')).toBe('S0');
  expect(JSON.parse(pipe.metadata!.wireIds!)).toEqual(['W1','W2']);
  const wire={...scene.find(o=>o.id==='W1')!,metadata:{},points:pipe.points};
  expect(hitTestEditorScene([pipe,wire],layers,p,10,'drawing')).toBe('S0');
 });
});
