import {describe,expect,it} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createConnector,createWire,applyEditorCommand} from '../editor/commands';
import {createEmptyHarnessDesign,parseHarnessDesignDocument,type HarnessDesignDocument} from '../editor/model';
import {buildDrawingBom,connectionWireMark,connectionWireSection,connectionWireColor} from '../editor/drawing-documents';
import {emptyTerminationDocument,type TerminationArtifact} from '../editor/termination-model';
import {buildRouteSourceItems} from '../manufacturing/route-source';
import {createRouteDrawingCopy,parseRouteDrawingCopy} from '../manufacturing/route-drawing-copy';
import {createInitialRouteV3,generateRouteV3,parseRouteV3,syncRouteV3TerminationOperations} from './route-v3-model';
import {previewRouteV3SourceRefresh,applyRouteV3SourceRefresh} from './route-v3-source-refresh';
import {routeV3OperationProjectTimes,routeV3OperationFromCatalog} from './route-v3-operations';
import type {ReferenceCatalogRecord,ReferenceCatalogSnapshot} from '../reference-catalog-api';
import {routeV3WireArtwork,RouteV3WireArtworkPreview} from './route-v3-wire-artwork';

const ref=(id:string,n=1)=>({connectorId:id,contactId:id+':contact:'+n});
const binding={sourceId:'test',snapshotId:'pinned',snapshotSha256:'a'.repeat(64),recordId:'r',sourceKey:'S1',displayName:'Гильза S1',payload:{norm:5}};
function fixture():HarnessDesignDocument{
  const sleeve={...createConnector('s','S1',2,{x:300,y:300}),terminationComponent:{kind:'sleeve' as const,symbolId:'butt-sleeve',artifactId:'a'}};
  const connectors=[sleeve,...Array.from({length:4},(_,i)=>createConnector('x'+i,'X'+i,1,{x:900,y:i*200}))];
  const wires=Array.from({length:4},(_,i)=>({...createWire('w'+i,ref('s',i<2?1:2),ref('x'+i),100),wireMark:'M'+i,wireSection:'0.5',colorSource:null}));
  const artifact:TerminationArtifact={id:'a',kind:'sleeve',article:'S1',symbolId:'butt-sleeve',catalogBinding:binding};
  const t={...emptyTerminationDocument(),artifacts:[artifact],groups:[{id:'A',target:ref('s'),artifactId:'a',memberEnds:[{wireId:'w0',end:'from' as const},{wireId:'w1',end:'from' as const}]},{id:'B',target:ref('s',2),artifactId:'a',memberEnds:[{wireId:'w2',end:'from' as const},{wireId:'w3',end:'from' as const}]}],operations:[{id:'weld',kind:'ultrasonic-weld' as const,target:{kind:'portSet' as const,connectorId:'s',contactIds:[ref('s').contactId,ref('s',2).contactId]},executionCount:3,recipe:binding,norm:{machineSeconds:4,humanSeconds:1,setupSeconds:10}}]};
  const d=applyEditorCommand({...createEmptyHarnessDesign(),connectors,wires},{type:'set-termination-document',terminations:t});
  return parseHarnessDesignDocument({...d,wires:d.wires.map(({e4Route:_route,...w})=>w)});
}
describe('termination route and BOM projections',()=>{
  it('labels a common crimp by its contact designation and repeats its production labels in the image alt',()=>{
    const terminal=createConnector('t','T1',1,{x:300,y:300}),other=createConnector('x','X1',1,{x:900,y:300});
    const groupId='35d45696-2a21-46ad-a682-56133d970999';
    const d:HarnessDesignDocument={...createEmptyHarnessDesign(),connectors:[terminal,other],wires:[createWire('w',ref('t'),ref('x'),100)],terminations:{...emptyTerminationDocument(),artifacts:[{id:'a',kind:'terminal',article:'',symbolId:'ring-terminal'}],groups:[{id:groupId,target:ref('t'),artifactId:'a',memberEnds:[{wireId:'w',end:'from'}]}]}};
    const item=buildRouteSourceItems(d).find(i=>i.ref.kind==='wire')!;
    expect(item.terminalFrom).toBe('В общий обжим T1:1');
    const markup=renderToStaticMarkup(createElement(RouteV3WireArtworkPreview,{document:d,item}));
    expect(markup).toContain('Н: В общий обжим T1:1; К: Без разделки');
    expect(markup).not.toContain(groupId);
    expect(markup).not.toContain('Без разделки — Без разделки');
  });
  it('includes canonical operations on the very first visit without saving fragments or generating again',()=>{
    const route=createInitialRouteV3(fixture(),10);
    expect(route.nodes.find(n=>n.id==='termination-operation:weld')?.operations?.[0]?.terminationOperationId).toBe('weld');
    expect(route.edges.some(e=>e.to==='termination-operation:weld')).toBe(true);
    expect(previewRouteV3SourceRefresh(route,fixture(),10).changed).toBe(false);
  });
  it('prompts explicit adoption when an older saved board has no source operation cards',()=>{
    const d=fixture(),initial=createInitialRouteV3(d,10),old={...initial,nodes:initial.nodes.filter(n=>!n.id.startsWith('termination-operation:')),edges:[]};
    const preview=previewRouteV3SourceRefresh(old,d,10);
    expect(preview.changed).toBe(true);expect(preview.divergences.some(d=>d.previous==='Операция отсутствует в маршруте')).toBe(true);
    const adopted=syncRouteV3TerminationOperations(applyRouteV3SourceRefresh(old,preview),d);
    expect(adopted.nodes.filter(n=>n.id==='termination-operation:weld')).toHaveLength(1);
  });
  it('preserves recipe executions and a pinned manual DB.OP choice through explicit refresh without duplicate operations',()=>{
    const d=fixture(),route=createInitialRouteV3(d,10),node=route.nodes.find(n=>n.id==='termination-operation:weld')!;
    const record:ReferenceCatalogRecord={recordId:'manual',sourceKey:'42',sourceLocation:null,entityType:'operation',payload:{name:'Норма сварки',operationType:'Статичный',manualWorkTimeSeconds:6,manualTakeTimeSeconds:1,manualRemoveTimeSeconds:1,additionalTimeSeconds:2,setupTimeSeconds:5}};
    const snapshot={sourceId:'operations',snapshotId:'pinned-op',sha256:'b'.repeat(64)} as ReferenceCatalogSnapshot;
    const selected=routeV3OperationFromCatalog(record,snapshot,node.operations![0]!.id,node.operations![0]);
    expect(selected.terminationOperationId).toBe('weld');
    expect(routeV3OperationProjectTimes(selected,node,d,10).cycles).toBe(30);
    expect(routeV3OperationProjectTimes(selected,node,d,10).projectMinutes).toBeCloseTo((30*10+5)/60);
    const manual={...route,nodes:route.nodes.map(n=>n.id===node.id?{...n,x:999,operations:[selected]}:n)};
    const changed={...d,terminations:{...d.terminations!,operations:d.terminations!.operations.map(o=>({...o,executionCount:2,norm:{humanSeconds:999,machineSeconds:999,setupSeconds:999}}))}};
    expect(routeV3OperationProjectTimes(selected,node,changed,10).cycles).toBe(30);
    const refreshed=syncRouteV3TerminationOperations(applyRouteV3SourceRefresh(manual,previewRouteV3SourceRefresh(manual,changed,10)),changed);
    const refreshedNode=refreshed.nodes.find(n=>n.id===node.id)!;expect(refreshedNode.x).toBe(999);expect(refreshedNode.operations).toHaveLength(1);
    const operation=refreshedNode.operations![0]!;
    expect(operation.catalogBinding?.recordId).toBe('manual');expect(operation.terminationOperationSnapshot?.executionCount).toBe(2);
    expect(routeV3OperationProjectTimes(operation,refreshedNode,changed,10).projectMinutes).toBeCloseTo((20*10+5)/60);
    const twice=syncRouteV3TerminationOperations(refreshed,changed);expect(twice.nodes.find(n=>n.id===node.id)?.operations).toHaveLength(1);
  });
  it('counts four conductors and one sleeve for two groups, without a second connector material',()=>{
    const d=fixture(),items=buildRouteSourceItems(d),bom=buildDrawingBom(d,10);
    expect(items.filter(i=>i.ref.kind==='wire')).toHaveLength(4);
    expect(items.filter(i=>i.ref.kind==='termination-artifact')).toHaveLength(1);
    expect(items.some(i=>i.ref.kind==='connector'&&i.ref.id==='s')).toBe(false);
    expect(bom.filter(r=>r.objectIds.includes('a'))).toHaveLength(1);
    expect(bom.find(r=>r.objectIds.includes('a'))?.amount).toBe(10);
    expect(bom.some(r=>r.objectIds.includes('s')&&r.name.includes('2 конт.'))).toBe(false);
  });
  it('ignores orphan drafts but preserves them for editing',()=>{
    const d=fixture(),t=d.terminations!;
    const next={...d,terminations:{...t,artifacts:[...t.artifacts,{...t.artifacts[0]!,id:'orphan'}]}};
    expect(next.terminations.artifacts).toHaveLength(2);
    expect(buildRouteSourceItems(next).some(i=>i.ref.id==='orphan')).toBe(false);
    expect(buildDrawingBom(next).some(r=>r.objectIds.includes('orphan'))).toBe(false);
  });
  it('exposes one UZ operation on both ports, with recipe executions rather than member count',()=>{
    const d=fixture(),route=generateRouteV3(createInitialRouteV3(d),d);
    const nodes=route.nodes.filter(n=>n.id==='termination-operation:weld');expect(nodes).toHaveLength(1);
    expect(nodes[0]?.refs.filter(r=>r.kind==='wire')).toHaveLength(4);
    expect(nodes[0]?.refs.filter(r=>r.kind==='termination-artifact')).toHaveLength(1);
    const times=routeV3OperationProjectTimes(nodes[0]!.operations![0]!,nodes[0]!,d,10);
    expect(times.cycles).toBe(30);expect(times.projectMinutes).toBeCloseTo((30*1+10)/60);expect(times.machineMinutes).toBeCloseTo(4/60);
    expect(parseRouteV3(JSON.parse(JSON.stringify(route)))).not.toBeNull();
  });
  it('does not divide prescribed executions by process capacity again; explicit zero human time is known',()=>{
    const original=fixture();const d={...original,terminations:{...original.terminations!,operations:original.terminations!.operations.map(o=>({...o,processCapacity:4,norm:{machineSeconds:null,humanSeconds:0,setupSeconds:10}}))}};
    const route=generateRouteV3(createInitialRouteV3(d),d),node=route.nodes.find(n=>n.id==='termination-operation:weld')!;
    const times=routeV3OperationProjectTimes(node.operations![0]!,node,d,10);
    expect(times.cycles).toBe(30);expect(times.projectMinutes).toBeCloseTo(10/60);expect(times.machineMinutes).toBeNull();
  });
  it('keeps unknown norms null and only applies changed recipes after explicit refresh',()=>{
    const d=fixture(),route=generateRouteV3(createInitialRouteV3(d),d),node=route.nodes.find(n=>n.id==='termination-operation:weld')!;
    const changed={...d,terminations:{...d.terminations!,operations:d.terminations!.operations.map(o=>({...o,executionCount:2,norm:undefined}))}};
    expect(routeV3OperationProjectTimes(node.operations![0]!,node,changed,10).cycles).toBe(30);
    const preview=previewRouteV3SourceRefresh(route,changed,10);expect(preview.divergences.some(i=>i.ref.id==='a')).toBe(true);
    const refreshed=syncRouteV3TerminationOperations(applyRouteV3SourceRefresh(route,preview),changed);
    const nextNode=refreshed.nodes.find(n=>n.id===node.id)!;
    expect(routeV3OperationProjectTimes(nextNode.operations![0]!,nextNode,changed,10).projectMinutes).toBeNull();
    expect(refreshed.nodes.find(n=>n.id===node.id)?.x).toBe(node.x);
  });
  it('preserves the aggregate and metadata in an independent embedded copy',()=>{
    const d=fixture();const copy=createRouteDrawingCopy(d);const parsed=parseRouteDrawingCopy(JSON.parse(JSON.stringify(copy)));
    expect(parsed.document.terminations).toEqual(d.terminations);expect(parsed.document.connectors[0]?.terminationComponent).toEqual(d.connectors[0]?.terminationComponent);
    expect(parsed.document.terminations).not.toBe(d.terminations);
  });
  it('shows own conductor attributes and no completed sleeve on each preparation blank',()=>{
    const d=fixture(),w=d.wires[2]!;
    expect(connectionWireMark(d,w)).toBe('M2');expect(connectionWireSection(d,w)).toBe('0.5');expect(connectionWireColor(d,w).hex).toBe(w.color);
    const artwork=routeV3WireArtwork(d,w.id)!;expect(artwork.mark).toBe('M2');expect(artwork.start).toBe('cut');expect(artwork.terminalFrom).toContain('S1');
  });
});
