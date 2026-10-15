import { describe, expect, it } from 'vitest';
import { applyEditorCommand, createConnector, createWire } from './commands';
import { connectorContactPosition, createEmptyHarnessDesign, parseHarnessDesignDocument, wireEndpointE4Anchor, type HarnessDesignDocument } from './model';
import { connectedTerminationWireIds, effectiveEndPreparation, emptyTerminationDocument, endPreparationModes, parseTerminationDocument, terminationGroupCompatibility, type TerminationArtifact, type TerminationDocument, type TerminationGroup } from './termination-model';
import {physicalFixture} from './physical-topology-fixture';
import {buildDrawingBom} from './drawing-documents';

const binding={sourceId:'test',snapshotId:'snapshot',snapshotSha256:'a'.repeat(64),recordId:'r',sourceKey:'T1',displayName:'Терминал',payload:{article:'T1',maxWireCount:4}};
const artifact:TerminationArtifact={id:'a1',kind:'terminal',article:'T1',symbolId:'nki',catalogBinding:binding};
const contact=(id:string,n=1)=>({connectorId:id,contactId:id+':contact:'+n});
function fixture(count=4):HarnessDesignDocument {
  const connectors=[createConnector('x','X',1,{x:0,y:0}),...Array.from({length:count},(_,i)=>createConnector('z'+i,'Z'+i,1,{x:800,y:i*160}))];
  const wires=Array.from({length:count},(_,i)=>createWire('w'+i,contact('x'),contact('z'+i),100+i));
  return {...createEmptyHarnessDesign(),connectors,wires};
}
const group=(count=4):TerminationGroup=>({id:'g1',target:contact('x'),artifactId:'a1',memberEnds:Array.from({length:count},(_,i)=>({wireId:'w'+i,end:'from' as const}))});
function withGroup(count=4):HarnessDesignDocument {
  const d=fixture(count);return applyEditorCommand(d,{type:'set-termination-document',terminations:{...emptyTerminationDocument(),artifacts:[artifact],groups:[group(count)]}});
}
describe('canonical multi-wire terminations',()=>{
  it.each([2,3,4,7])('keeps %i conductors and exactly one terminal artifact through JSON parsing',count=>{
    const d=withGroup(count);const raw={...JSON.parse(JSON.stringify(d)),wires:d.wires.map(({e4Route:_route,...w})=>w)};
    const parsed=parseHarnessDesignDocument(raw);
    expect(parsed.terminations?.groups[0]?.memberEnds).toHaveLength(count);expect(parsed.terminations?.artifacts).toHaveLength(1);
    expect(parsed.requiredWriterContractVersion).toBe(3);expect(parsed.wires.map(w=>w.lengthMm)).toEqual(d.wires.map(w=>w.lengthMm));
    expect(parsed.terminations?.artifacts[0]?.catalogBinding?.payload).toEqual(binding.payload);
  });
  it('rejects wrong electrical membership and duplicate end assignments atomically',()=>{
    const d=withGroup(2),before=JSON.stringify(d);
    expect(()=>applyEditorCommand(d,{type:'upsert-termination-group',group:{...group(2),target:contact('z0')}})).toThrow(/другой точке/);
    expect(()=>applyEditorCommand(d,{type:'upsert-termination-group',group:{...group(2),id:'g2'}})).toThrow(/повторяющиеся/);
    expect(JSON.stringify(d)).toBe(before);
  });
  it('permits both ends of the same wire in separate groups',()=>{
    const d=applyEditorCommand(withGroup(2),{type:'upsert-termination-artifact',artifact:{...artifact,id:'a2'}});const next=applyEditorCommand(d,{type:'upsert-termination-group',group:{id:'g2',artifactId:'a2',target:contact('z0'),memberEnds:[{wireId:'w0',end:'to'}]}});
    expect(next.terminations?.groups).toHaveLength(2);
  });
  it('rejects reuse of the same physical terminal on another contact',()=>{
    const d=withGroup(2);
    expect(()=>applyEditorCommand(d,{type:'upsert-termination-group',group:{id:'g2',artifactId:'a1',target:contact('z0'),memberEnds:[{wireId:'w0',end:'to'}]}})).toThrow(/разных контактах/);
  });
  it('rejects assigning a second terminal material to an end already prepared individually',()=>{
    let d=applyEditorCommand(fixture(2),{type:'set-termination-document',terminations:{...emptyTerminationDocument(),artifacts:[artifact,{...artifact,id:'individual',article:'IND'}],endPreparations:[{id:'p',wireId:'w0',end:'from',mode:'pin',artifactId:'individual'}]}});
    const before=JSON.stringify(d);
    expect(()=>applyEditorCommand(d,{type:'upsert-termination-group',group:group(2)})).toThrow(/снимите индивидуальный наконечник/);
    expect(JSON.stringify(d)).toBe(before);
    expect(buildDrawingBom(d).filter(r=>r.objectIds.includes('individual')||r.objectIds.includes('a1')).map(r=>r.designation)).toEqual(['IND']);
    d=applyEditorCommand(d,{type:'remove-end-preparation',wireId:'w0',end:'from'});
    // The unreferenced draft artifact is retained and can now be installed.
    d=applyEditorCommand(d,{type:'upsert-termination-group',group:group(2)});
    expect(buildDrawingBom(d).filter(r=>r.objectIds.includes('individual')||r.objectIds.includes('a1')).map(r=>r.designation)).toEqual(['T1']);
  });
  it('rejects a different per-end artifact on a standalone terminal even before grouping',()=>{
    let d=applyEditorCommand(fixture(1),{type:'set-termination-document',terminations:{...emptyTerminationDocument(),artifacts:[artifact,{...artifact,id:'other'}]}});
    d=applyEditorCommand(d,{type:'set-termination-component',connectorId:'x',component:{kind:'terminal',symbolId:'nki',artifactId:'a1'}});
    expect(()=>applyEditorCommand(d,{type:'set-end-preparation',preparation:{id:'p',wireId:'w0',end:'from',mode:'pin',artifactId:'other'}})).toThrow(/общую оконцовку/);
    expect(()=>parseTerminationDocument({...d.terminations!,groups:[{...group(1),artifactId:'other'}]},d)).toThrow(/физическим экземпляром/);
    expect(buildDrawingBom(d).filter(r=>r.objectIds.includes('a1')||r.objectIds.includes('other'))).toHaveLength(1);
  });
  it('replacing a component article remaps its groups to the new physical artifact',()=>{
    let d=withGroup(2);
    d=applyEditorCommand(d,{type:'set-termination-component',connectorId:'x',component:{kind:'terminal',symbolId:'nki',artifactId:'a1'}});
    const next=applyEditorCommand(d,{type:'set-termination-component',connectorId:'x',component:{kind:'terminal',symbolId:'nvi',artifactId:'a2'},artifact:{...artifact,id:'a2',symbolId:'nvi'}});
    expect(next.terminations?.groups[0]?.artifactId).toBe('a2');expect(next.terminations?.artifacts.map(a=>a.id)).toEqual(['a2']);
  });
  it('switching universal lug to bare copper removes stale shared material and operations',()=>{
    let d=withGroup(2);d=applyEditorCommand(d,{type:'set-termination-component',connectorId:'x',component:{kind:'preparation',symbolId:'preparation-lug',preparationMode:'lug',artifactId:'a1',catalogBinding:binding,color:'red'}});
    d=applyEditorCommand(d,{type:'upsert-termination-operation',operation:{id:'crimp',kind:'crimp',target:{kind:'group',groupId:'g1'},executionCount:null}});
    const previous=d.connectors[0]!.terminationComponent!;
    const next=applyEditorCommand(d,{type:'set-termination-component',connectorId:'x',component:{...previous,preparationMode:'copper',symbolId:'preparation-copper'}});
    expect(next.connectors[0]?.terminationComponent).toEqual({kind:'preparation',symbolId:'preparation-copper',preparationMode:'copper'});
    expect(next.terminations?.groups).toEqual([]);expect(next.terminations?.artifacts).toEqual([]);expect(next.terminations?.operations).toEqual([]);
    expect(next.wires.map(w=>[w.from,w.to,w.lengthMm])).toEqual(d.wires.map(w=>[w.from,w.to,w.lengthMm]));
  });
  it('a group article choice updates component metadata and leaves one physical material',()=>{
    let d=withGroup(2);d=applyEditorCommand(d,{type:'set-termination-component',connectorId:'x',component:{kind:'terminal',symbolId:'nki',artifactId:'a1'}});
    const t=d.terminations!;
    const next=applyEditorCommand(d,{type:'set-termination-document',terminations:{...t,artifacts:[...t.artifacts,{...artifact,id:'new',symbolId:'nvi'}],groups:t.groups.map(g=>({...g,artifactId:'new'}))}});
    expect(next.connectors[0]?.terminationComponent?.artifactId).toBe('new');expect(next.terminations?.groups[0]?.artifactId).toBe('new');expect(next.terminations?.artifacts.map(a=>a.id)).toEqual(['new']);
  });
  it.each(['pin','socket','pin-sealed','socket-sealed'] as const)('preserves preparation %s when its common-crimp article changes',mode=>{
    let d=withGroup(2);d=applyEditorCommand(d,{type:'set-termination-component',connectorId:'x',component:{kind:'preparation',symbolId:'preparation-'+mode,preparationMode:mode,artifactId:'a1'},artifact});
    d=applyEditorCommand(d,{type:'upsert-termination-artifact',artifact:{...artifact,id:'a2'}});
    const next=applyEditorCommand(d,{type:'upsert-termination-group',group:{...group(2),artifactId:'a2'}});
    expect(next.connectors[0]?.terminationComponent?.preparationMode).toBe(mode);expect(next.connectors[0]?.terminationComponent?.artifactId).toBe('a2');
    expect(next.terminations?.artifacts.map(a=>a.id)).toEqual(['a2']);
  });
  it('deleting wires cleans groups, preparations and dependent operations without deleting other wires',()=>{
    let d=withGroup(2);d=applyEditorCommand(d,{type:'set-end-preparation',preparation:{id:'p',wireId:'w0',end:'from',mode:'copper'}});
    d=applyEditorCommand(d,{type:'upsert-termination-operation',operation:{id:'o',kind:'crimp',target:{kind:'group',groupId:'g1'},executionCount:null}});
    const remaining=applyEditorCommand(d,{type:'remove-wire',wireId:'w0'});
    expect(remaining.wires.map(w=>w.id)).toEqual(['w1']);expect(remaining.terminations?.groups[0]?.memberEnds).toEqual([{wireId:'w1',end:'from'}]);expect(remaining.terminations?.endPreparations).toEqual([]);
    const none=applyEditorCommand(remaining,{type:'remove-wire',wireId:'w1'});expect(none.terminations?.groups).toEqual([]);expect(none.terminations?.operations).toEqual([]);
  });
  it.each(endPreparationModes)('round-trips explicit preparation %s',mode=>{
    const d=fixture(1);const t={...emptyTerminationDocument(),endPreparations:[{id:'p',wireId:'w0',end:'from' as const,mode,stripLengthMm:null}]};
    expect(parseTerminationDocument(t,d).endPreparations[0]?.mode).toBe(mode);
  });
  it('inherits component preparation for existing and newly attached ends, with explicit override',()=>{
    const d=fixture(2);const prepared={...d,connectors:d.connectors.map(c=>c.id==='x'?{...c,terminationComponent:{kind:'preparation' as const,symbolId:'point',preparationMode:'tin' as const}}:c)};
    expect(effectiveEndPreparation(prepared,{wireId:'w1',end:'from'})?.mode).toBe('tin');
    const changed=applyEditorCommand(prepared,{type:'set-end-preparation',preparation:{id:'p',wireId:'w1',end:'from',mode:'copper'}});
    expect(effectiveEndPreparation(changed,{wireId:'w1',end:'from'})?.mode).toBe('copper');
    expect(effectiveEndPreparation(changed,{wireId:'w0',end:'from'})?.mode).toBe('tin');
    expect(connectedTerminationWireIds(changed,['w0'])).toEqual(new Set(['w0']));
  });
  it('adds one sleeve with two stable ports and one UZ execution recipe across A+B',()=>{
    const sleeve={...createConnector('s','S',2,{x:300,y:200}),terminationComponent:{kind:'sleeve' as const,symbolId:'sleeve',artifactId:'s-art'}};
    let d=applyEditorCommand(createEmptyHarnessDesign(),{type:'add-termination-component',connector:sleeve,artifact:{...artifact,id:'s-art',kind:'sleeve'}});
    const wires=[createWire('a',contact('s'),contact('s',2))];d={...d,wires};
    d=applyEditorCommand(d,{type:'upsert-termination-operation',operation:{id:'weld',kind:'ultrasonic-weld',target:{kind:'portSet',connectorId:'s',contactIds:[sleeve.contacts[0]!.id,sleeve.contacts[1]!.id]},executionCount:3,recipe:binding}});
    expect(d.terminations?.artifacts).toHaveLength(1);expect(d.terminations?.operations[0]?.executionCount).toBe(3);
    expect(connectorContactPosition(sleeve,sleeve.contacts[0]!.id,'e4')).toEqual({x:332,y:250});
    expect(connectorContactPosition(sleeve,sleeve.contacts[1]!.id,'e4')).toEqual({x:488,y:250});
    expect(wireEndpointE4Anchor(d,contact('s'))?.leadDirection).toBe('left');expect(wireEndpointE4Anchor(d,contact('s',2))?.leadDirection).toBe('right');
  });
  it('connects sleeve A and B electrically and rejects contradictory circuits',()=>{
    const d=fixture(2),s={...createConnector('s','S',2,{x:300,y:0}),terminationComponent:{kind:'sleeve' as const,symbolId:'sleeve'}};
    const wired={...d,connectors:[...d.connectors,s],wires:[{...d.wires[0]!,from:contact('s'),circuit:'P'},{...d.wires[1]!,from:contact('s',2),circuit:'Q'}]};
    expect(connectedTerminationWireIds(wired,['w0'])).toEqual(new Set(['w0','w1']));
    expect(()=>applyEditorCommand(wired,{type:'set-termination-document',terminations:emptyTerminationDocument()})).toThrow(/разные цепи/);
  });
  it('rejects terminal with two points and sleeve with one; no partial atomic placement',()=>{
    const d=createEmptyHarnessDesign();
    expect(()=>applyEditorCommand(d,{type:'add-termination-component',connector:{...createConnector('s','S',1,{x:0,y:0}),terminationComponent:{kind:'sleeve',symbolId:'sleeve'}}})).toThrow(/гильза две/);
    expect(()=>applyEditorCommand(d,{type:'add-termination-component',connector:{...createConnector('t','T',2,{x:0,y:0}),terminationComponent:{kind:'terminal',symbolId:'nki'}}})).toThrow(/одну точку/);
    expect(d.connectors).toHaveLength(0);
  });
  it('does not silently classify a count-only catalogue as technologically compatible',()=>{
    let d=withGroup(2);expect(terminationGroupCompatibility(d,group(2))).toBe('unknown');
    const t=d.terminations!;d={...d,wires:d.wires.map(w=>({...w,wireSection:'0.5',materialBinding:{sourceId:'wire',snapshotId:'s',snapshotSha256:'a'.repeat(64),recordId:'r',sourceKey:'key',displayName:'wire',entityType:'wire',sectionUnit:'mm2'}})),terminations:{...t,artifacts:[{...artifact,capacity:{confirmed:true,maxWireCount:2,combinations:[{sections:[0.5,0.5],unit:'mm2'}]}}]}};
    expect(terminationGroupCompatibility(d,group(2))).toBe('compatible');
    expect(terminationGroupCompatibility({...d,wires:d.wires.map(w=>({...w,wireSection:'28',materialBinding:{...w.materialBinding!,sectionUnit:'awg'}}))},group(2))).toBe('incompatible');
  });
  it('rejects operation cycles and absent target refs',()=>{
    const d=withGroup(2),t=d.terminations!;
    const op={id:'o',kind:'crimp' as const,target:{kind:'group' as const,groupId:'g1'},executionCount:1,dependsOn:['o']};
    expect(()=>parseTerminationDocument({...t,operations:[op]},d)).toThrow(/цикл/);
    expect(()=>parseTerminationDocument({...t,operations:[{...op,dependsOn:[],target:{kind:'group',groupId:'gone'}}]},d)).toThrow(/отсутствует/);
  });
  it('rejects twist without a common physical path; never changes electrical endpoints',()=>{
    const d=withGroup(2),before=d.wires.map(w=>[w.from,w.to]);
    expect(()=>applyEditorCommand(d,{type:'upsert-physical-twist',twist:{id:'tw',memberWireIds:['w0','w1'],segmentIds:['missing'],pitchMm:20,direction:'right'}})).toThrow(/общей трассы/);
    expect(d.wires.map(w=>[w.from,w.to])).toEqual(before);expect(d.junctions).toEqual([]);
  });
  it('rejects overlapping twist ownership but permits different spans of the same conductor',()=>{
    const d=physicalFixture();
    const first={id:'a',memberWireIds:['W1','W2'],segmentIds:['S0'],pitchMm:20,direction:'right' as const};
    expect(()=>parseTerminationDocument({...emptyTerminationDocument(),twists:[first,{...first,id:'b'}]},d)).toThrow(/повторяющиеся/);
    expect(parseTerminationDocument({...emptyTerminationDocument(),twists:[first,{...first,id:'b',memberWireIds:['W1','W3'],segmentIds:['S1']}]},d).twists).toHaveLength(2);
  });
  it('preserves individual material and colours when the shared contact defaults change',()=>{
    let d=withGroup(2);d=applyEditorCommand(d,{type:'update-wire',wireId:'w0',wireMark:'A',wireSection:'0.35',color:'#ff0000'});d=applyEditorCommand(d,{type:'update-wire',wireId:'w1',wireMark:'B',wireSection:'0.5',color:'#0000ff'});
    const changed=applyEditorCommand(d,{type:'update-contact',connectorId:'x',contactId:contact('x').contactId,wire:'C',wireSection:'2',color:'#00ff00'});
    expect(changed.wires.map(w=>[w.wireMark,w.wireSection,w.color])).toEqual([['A','0.35','#ff0000'],['B','0.5','#0000ff']]);
  });
  it('keeps old documents without termination collections and rejects unknown future modes',()=>{
    const legacy=parseHarnessDesignDocument(createEmptyHarnessDesign());expect(legacy.terminations).toBeUndefined();
    expect(()=>parseTerminationDocument({...emptyTerminationDocument(),endPreparations:[{id:'p',wireId:'w0',end:'from',mode:'future'}]},fixture(1))).toThrow(/неизвестный режим/);
  });
});
