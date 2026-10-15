import {expect,it} from 'vitest';
import {applyEditorCommand,createConnector,createWire,e4RoutingIssues} from './commands';
import {createEmptyHarnessDesign,parseHarnessDesignDocument,wireEndpointE4Anchor,type HarnessDesignDocument} from './model';
import {createEditorHistory,executeEditorCommand,undoEditorCommand,redoEditorCommand} from './history';
import {BUILTIN_TERMINATION_RECORDS,createTerminationPlacement} from '../termination-library';
import {getE4DifferentialPairLayouts,hitTestE4DifferentialPair} from './CanvasViewport';
import {designToScene} from './HarnessDesignEditor';
import {emptyTerminationDocument} from './termination-model';
import {e4ConnectivityFingerprint} from './e4-connectivity';

function fixture():HarnessDesignDocument {
  const a=createConnector('a','XS5',13,{x:0,y:0});
  const placement=createTerminationPlacement(BUILTIN_TERMINATION_RECORDS.find(r=>r.assetId==='nvi-fork')!,
    {id:'t',designation:'T1',position:{x:1100,y:450}});
  const t=placement.connector;
  const wires=[7,13].map((n,i)=>({...createWire(`w${i}`,{connectorId:'a',contactId:a.contacts[n-1]!.id},
    {connectorId:'t',contactId:t.contacts[0]!.id},700,'NET'),e4RouteMode:'manual' as const,
    e4Route:i===0?[{x:780,y:208},{x:780,y:500}]:[{x:980,y:352},{x:980,y:548},{x:1084,y:548},{x:1084,y:500}]}));
  return {...createEmptyHarnessDesign(),connectors:[a,t],wires,terminations:{...emptyTerminationDocument(),artifacts:[placement.artifact!]}};
}
function expectOrthogonal(d:HarnessDesignDocument){
  for(const w of d.wires){
    const points=[wireEndpointE4Anchor(d,w.from)!.position,...w.e4Route,wireEndpointE4Anchor(d,w.to)!.position];
    for(let i=1;i<points.length;i++)expect(points[i]!.x===points[i-1]!.x||points[i]!.y===points[i-1]!.y).toBe(true);
  }
}

it.each(['carry','adjacent'] as const)('C4 moves a corner beside a shared terminal, preserves identities/lengths and undo (%s)',mode=>{
  const d=fixture();
  expect(e4RoutingIssues(d)).toEqual([]);
  const h=executeEditorCommand(createEditorHistory(d),{type:'edit-e4-bend',wireId:'w1',index:0,position:{x:930,y:352},mode});
  expect(h.present.wires[1]!.e4Route).not.toEqual(d.wires[1]!.e4Route);
  expect(h.present.wires[1]!.e4Route).toContainEqual({x:930,y:352});
  expectOrthogonal(h.present);expect(e4RoutingIssues(h.present)).toEqual([]);
  expect(e4ConnectivityFingerprint(h.present)).toBe(e4ConnectivityFingerprint(d));
  expect(h.present.wires.map(w=>[w.id,w.lengthMm,w.from,w.to])).toEqual(d.wires.map(w=>[w.id,w.lengthMm,w.from,w.to]));
  expect(h.present.physicalTopology).toEqual(d.physicalTopology);
  expect(parseHarnessDesignDocument(JSON.parse(JSON.stringify(h.present))).wires).toEqual(h.present.wires);
  expect(undoEditorCommand(h).present).toBe(d);
  expect(redoEditorCommand(undoEditorCommand(h)).present).toBe(h.present);
});

it('C3 repairs an existing sloping wire when its corner is edited',()=>{
  const d=fixture(),wire=d.wires[0]!;
  const legacy={...d,wires:[{...wire,e4Route:[{x:650,y:208},{x:780,y:196},{x:780,y:488},{x:1108,y:500}]}]};
  const changed=applyEditorCommand(legacy,{type:'edit-e4-bend',wireId:wire.id,index:1,position:{x:820,y:560},mode:'carry'});
  expectOrthogonal(changed);expect(e4RoutingIssues(changed)).toEqual([]);
  expect(e4ConnectivityFingerprint(changed)).toBe(e4ConnectivityFingerprint(legacy));
});

it('C2 draws and selects the twist on each horizontal run after moving a connector',()=>{
  const a=createConnector('a','A',2,{x:0,y:0}),b=createConnector('b','B',2,{x:1200,y:0});
  const d={...createEmptyHarnessDesign(),connectors:[a,{...b,schematic:{...b.schematic,orientation:'contacts-left' as const}}],
    wires:[0,1].map(i=>({...createWire(`w${i}`,{connectorId:'a',contactId:a.contacts[i]!.id},{connectorId:'b',contactId:b.contacts[i]!.id}),
      e4Route:[{x:700+i*24,y:64+i*24},{x:950+i*24,y:64+i*24}]})),
    diffPairs:[{id:'pair',wireIds:['w0','w1'] as const,step:24,amplitude:6,variant:2 as const}]};
  const changed=applyEditorCommand(d,{type:'move-connector',connectorId:'b',view:'e4',position:{x:1200,y:160},physicalDragMode:'carry'});
  expectOrthogonal(changed);
  const objects=designToScene(changed,'e4'),group=d.diffPairs[0]!;
  const layouts=getE4DifferentialPairLayouts(group,objects);
  expect(layouts.length).toBeGreaterThanOrEqual(2);
  for(const layout of layouts){
    expect(layout.motifs.length).toBeGreaterThan(0);
    expect(hitTestE4DifferentialPair([group],objects,{x:layout.motifs[0]!.center,y:(layout.crossMinimum+layout.crossMaximum)/2},1)).not.toBeNull();
  }
});
