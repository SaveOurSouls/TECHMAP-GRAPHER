import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createConnector, createWire } from '../editor/commands';
import { createEmptyHarnessDesign, type HarnessDesignDocument } from '../editor/model';
import { emptyTerminationDocument } from '../editor/termination-model';
import { buildDrawingBom } from '../editor/drawing-documents';
import { TERMINATION_ASSETS } from '../termination-library/catalog';
import { buildRouteSourceItems } from '../manufacturing/route-source';
import { buildRouteV3SourceItems } from './route-v3-wire-terminals';
import { createInitialRouteV3, generateRouteV3, parseRouteV3, syncRouteV3TerminationOperations, type RouteV3Document } from './route-v3-model';
import { applyRouteV3SourceRefresh, previewRouteV3SourceRefresh } from './route-v3-source-refresh';
import { routeV3WireArtwork, RouteV3WireArtworkPreview } from './route-v3-wire-artwork';
import { routeV3CompositionGroups } from './route-v3-composition-groups';
import { refreshRouteV3 } from './route-v3-graph';
import { routeV3AssignedProductIds, routeV3Products } from './route-v3-operations';

const ref = (id:string,n=1) => ({connectorId:id,contactId:`${id}:contact:${n}`});
function fixture(symbolId='nki-ring', kind:'terminal'|'sleeve'='terminal'):HarnessDesignDocument {
  const terminal = {...createConnector('t','T1',kind==='sleeve'?2:1,{x:100,y:100}),terminationComponent:{kind,symbolId,artifactId:'a'}};
  return {...createEmptyHarnessDesign(),connectors:[terminal,createConnector('x','X1',1,{x:500,y:100})],wires:[createWire('w',ref('t'),ref('x'),100)],terminations:{...emptyTerminationDocument(),artifacts:[{id:'a',kind,symbolId,article:'UNL20'}],groups:[{id:'g',target:ref('t'),artifactId:'a',memberEnds:[{wireId:'w',end:'from'}]}]}};
}
const generated = (d:HarnessDesignDocument) => generateRouteV3(createInitialRouteV3(d),d);

describe('REQ-151 wire terminal semifinished projection',()=>{
  it.each(TERMINATION_ASSETS.filter(a=>a.kind==='terminal').map(a=>[a.id]))('embeds terminal %s in its wire blank without duplicating material',symbolId=>{
    const d=fixture(symbolId),before=JSON.stringify(d),route=generated(d);
    expect(route.preparedRefs).toEqual([{kind:'wire',id:'w'}]);
    expect(route.nodes.map(n=>n.id)).toEqual(['prepared:wire']);
    expect(buildRouteV3SourceItems(d).find(i=>i.ref.kind==='wire')?.terminalFrom).toBe('UNL20');
    expect(routeV3WireArtwork(d,'w')?.start).toBe('terminal');
    const item=buildRouteV3SourceItems(d).find(i=>i.ref.kind==='wire')!;
    const markup=renderToStaticMarkup(createElement(RouteV3WireArtworkPreview,{document:d,item}));
    expect(markup).toContain('data-wire-end="from"');
    expect(markup).toContain('aria-label="Провод: Н: UNL20; К: Без разделки"');
    expect(buildDrawingBom(d,7).find(r=>r.objectIds.includes('a'))?.amount).toBe(7);
    expect(buildRouteSourceItems(d).some(i=>i.ref.id==='a')).toBe(true);
    expect(JSON.stringify(d)).toBe(before);
  });

  it('uses the actual library symbol independently on either end, while respecting manual end overrides',()=>{
    const d=fixture();
    const two={...d,connectors:[d.connectors[0]!,{...d.connectors[1]!,terminationComponent:{kind:'terminal' as const,symbolId:'nvi-fork',artifactId:'b'}}],terminations:{...d.terminations!,artifacts:[...d.terminations!.artifacts,{id:'b',kind:'terminal' as const,symbolId:'nvi-fork',article:'FORK'}]}};
    const item=buildRouteV3SourceItems(two).find(i=>i.ref.kind==='wire')!;
    const render=(override?:{wireId:string;start?:'cut';color?:string})=>renderToStaticMarkup(createElement(RouteV3WireArtworkPreview,{document:two,item,override}));
    expect(render()).toContain('nki-ring-drawing.svg');expect(render()).toContain('nvi-fork-drawing.svg');
    expect(render()).toContain('data-wire-end="to"');
    expect(render({wireId:'w',color:'#112233'})).toContain('nki-ring-drawing.svg');
    expect(render({wireId:'w',start:'cut'})).not.toContain('data-wire-end="from"');
    expect(render({wireId:'w',start:'cut'})).toContain('data-wire-end="to"');
  });

  it('embeds individual terminals and seals; different terminal shapes do not merge into one wire group',()=>{
    const base=fixture();
    const d={...base,connectors:base.connectors.map(({terminationComponent:_component,...c})=>c),terminations:{...base.terminations!,groups:[],artifacts:[...base.terminations!.artifacts,{id:'seal',kind:'seal' as const,symbolId:'preparation-pin-seal',article:'SEAL'}],endPreparations:[{id:'p',wireId:'w',end:'from' as const,mode:'pin-sealed' as const,artifactId:'a',sealArtifactId:'seal'}]}};
    expect(buildRouteV3SourceItems(d).some(i=>i.ref.kind==='termination-artifact')).toBe(false);
    expect(routeV3WireArtwork(d,'w')).toMatchObject({start:'sealed-pin',terminalFrom:'UNL20 / SEAL'});
    const sealedMarkup=renderToStaticMarkup(createElement(RouteV3WireArtworkPreview,{document:d,item:buildRouteV3SourceItems(d).find(i=>i.ref.kind==='wire')!}));
    expect(decodeURIComponent(sealedMarkup)).toContain('three-rib-seal');
    const pair={...base,wires:[...base.wires,{...base.wires[0]!,id:'w2',from:ref('other')}],connectors:[...base.connectors,{...base.connectors[0]!,id:'other',contacts:[{...base.connectors[0]!.contacts[0]!,id:ref('other').contactId}],terminationComponent:{kind:'terminal' as const,symbolId:'nvi-fork',artifactId:'b'}}],terminations:{...base.terminations!,artifacts:[...base.terminations!.artifacts,{...base.terminations!.artifacts[0]!,id:'b',symbolId:'nvi-fork'}]}};
    expect(routeV3CompositionGroups([{kind:'wire',id:'w'},{kind:'wire',id:'w2'}],pair,generated(pair))).toHaveLength(2);
  });

  it('keeps a shared terminal as one BOM instance and preserves its canonical crimp operation',()=>{
    const base=fixture(),d={...base,wires:[...base.wires,{...base.wires[0]!,id:'w2'}],terminations:{...base.terminations!,groups:[{...base.terminations!.groups[0]!,memberEnds:[{wireId:'w',end:'from' as const},{wireId:'w2',end:'from' as const}]}],operations:[{id:'crimp',kind:'crimp' as const,target:{kind:'group' as const,groupId:'g'},executionCount:1}]}};
    const route=generated(d);
    expect(route.nodes.some(n=>n.id==='prepared:termination-artifact')).toBe(false);
    expect(route.nodes.find(n=>n.id==='termination-operation:crimp')?.refs).toEqual([{kind:'wire',id:'w'},{kind:'wire',id:'w2'}]);
    expect(buildDrawingBom(d).filter(r=>r.objectIds.includes('a'))).toHaveLength(1);
  });

  it('keeps sleeves as a separate route operation, with a prepared conductor instead of a finished sleeve on the wire',()=>{
    const base=fixture('sleeve-butt','sleeve');
    const d={...base,terminations:{...base.terminations!,operations:[{id:'sleeve-crimp',kind:'crimp' as const,target:{kind:'portSet' as const,connectorId:'t',contactIds:[ref('t').contactId]},executionCount:1}]}};
    const route=generated(d),stage=route.nodes.find(n=>n.id==='termination-operation:sleeve-crimp')!;
    expect(stage.kind).toBe('assembly');expect(stage.refs).toContainEqual({kind:'termination-artifact',id:'a'});
    expect(routeV3WireArtwork(d,'w')?.start).toBe('cut');
    expect(route.edges.some(e=>e.from==='prepared:wire'&&e.to===stage.id)).toBe(true);
    expect(route.preparedRefs).not.toContainEqual({kind:'termination-artifact',id:'a'});
    expect(route.nodes.some(n=>n.id==='prepared:termination-artifact')).toBe(false);
    expect(parseRouteV3(JSON.parse(JSON.stringify(route)))).not.toBeNull();
  });

  it('provides a separate sleeve stage even before an operator assigns its process and norms',()=>{
    const d=fixture('sleeve-bare','sleeve'),route=generated(d);
    expect(createInitialRouteV3(d).preparedRefs).toEqual([{kind:'wire',id:'w'}]);
    const stage=route.nodes.find(n=>n.id==='sleeve-assembly:a')!;
    expect(stage).toMatchObject({kind:'assembly',title:'Установка гильзы UNL20',refs:[{kind:'wire',id:'w'},{kind:'termination-artifact',id:'a'}]});
    expect(stage.operations?.length??0).toBe(0);
    expect(previewRouteV3SourceRefresh(route,d).changed).toBe(false);
    const changed={...d,wires:[...d.wires,{...d.wires[0]!,id:'w2'}]};
    const updated=syncRouteV3TerminationOperations(applyRouteV3SourceRefresh(route,previewRouteV3SourceRefresh(route,changed)),changed);
    expect(updated.nodes.find(n=>n.id===stage.id)?.refs).toContainEqual({kind:'wire',id:'w2'});
  });

  it('keeps authored operations and their product assignments on an old terminal card',()=>{
    const d=fixture(),artifact={kind:'termination-artifact' as const,id:'a'};
    const old:RouteV3Document={...generated(d),preparedRefs:[...generated(d).preparedRefs,artifact],sourceState:undefined,nodes:[...generated(d).nodes,{id:'prepared:termination-artifact',kind:'semiFinished',title:'Моя подготовка',refs:[artifact],fragmentIds:[],x:400,y:400,operations:[{id:'op',title:'Контроль наконечника',kind:'static',quantity:1,minutesEach:3,lengthMm:0,speedMmPerMinute:1,employees:1,outputProductIds:['product:prepared:termination-artifact:termination-artifact:a']}]}]};
    const updated=syncRouteV3TerminationOperations(applyRouteV3SourceRefresh(old,previewRouteV3SourceRefresh(old,d)),d);
    const node=updated.nodes.find(n=>n.id==='prepared:termination-artifact')!;
    expect(node).toMatchObject({title:'Моя подготовка',x:400,y:400,refs:[{kind:'wire',id:'w'}]});
    expect(routeV3AssignedProductIds(node,node.operations![0]!)).toEqual(routeV3Products(node).map(p=>p.id));
    expect(node.operations?.[0]?.minutesEach).toBe(3);
  });

  it('adopts a legacy sleeve material card as raw material of its operation',()=>{
    const base=fixture('sleeve-bare','sleeve'),d={...base,terminations:{...base.terminations!,operations:[{id:'crimp',kind:'crimp' as const,target:{kind:'group' as const,groupId:'g'},executionCount:1}]}};
    const current=generated(d),artifact={kind:'termination-artifact' as const,id:'a'};
    const old:RouteV3Document={...current,preparedRefs:[...current.preparedRefs,artifact],nodes:[...current.nodes,{id:'prepared:termination-artifact',kind:'semiFinished',title:'Оконцовки и уплотнители',refs:[artifact],fragmentIds:[],x:400,y:32}],edges:[...current.edges,{id:'old-sleeve-input',from:'prepared:termination-artifact',to:'termination-operation:crimp',refs:[artifact]}]};
    const preview=previewRouteV3SourceRefresh(old,d);
    expect(preview.changed).toBe(true);
    const updated=syncRouteV3TerminationOperations(applyRouteV3SourceRefresh(old,preview),d);
    expect(updated.nodes.some(n=>n.id==='prepared:termination-artifact')).toBe(false);
    expect(updated.nodes.find(n=>n.id==='termination-operation:crimp')?.refs).toContainEqual(artifact);
    expect(previewRouteV3SourceRefresh(updated,d).changed).toBe(false);
    expect(parseRouteV3(JSON.parse(JSON.stringify(updated)))).not.toBeNull();
  });

  it('explicitly updates an old material card and redirects its selected input without losing manual graph edits',()=>{
    const d=fixture(),wire={kind:'wire' as const,id:'w'},artifact={kind:'termination-artifact' as const,id:'a'};
    const old:RouteV3Document={...generated(d),preparedRefs:[wire,artifact],sourceState:undefined,graphEdited:true,nodes:[
      {id:'prepared:wire',kind:'semiFinished',title:'Провода',refs:[wire],fragmentIds:[],x:123,y:234},
      {id:'prepared:termination-artifact',kind:'semiFinished',title:'Оконцовки и уплотнители',refs:[artifact],fragmentIds:[],x:500,y:32},
      {id:'manual',kind:'assembly',title:'Моя сборка',refs:[artifact],fragmentIds:[],x:900,y:900,operations:[{id:'op',title:'Контроль',kind:'static',quantity:1,minutesEach:3,lengthMm:0,speedMmPerMinute:1,employees:1}]},
    ],edges:[{id:'selected',from:'prepared:termination-artifact',to:'manual',refs:[artifact]}]};
    const preview=previewRouteV3SourceRefresh(old,d);
    const updated=refreshRouteV3(syncRouteV3TerminationOperations(applyRouteV3SourceRefresh(old,preview),d));
    expect(updated.nodes.some(n=>n.id==='prepared:termination-artifact')).toBe(false);
    expect(updated.nodes.find(n=>n.id==='prepared:wire')).toMatchObject({x:123,y:234});
    expect(updated.nodes.find(n=>n.id==='manual')).toMatchObject({title:'Моя сборка',x:900,y:900,refs:[wire],operations:old.nodes[2]!.operations});
    expect(updated.edges.find(e=>e.to==='manual')).toMatchObject({from:'prepared:wire',refs:[wire]});
    expect(previewRouteV3SourceRefresh(updated,d).changed).toBe(false);
    expect(parseRouteV3(JSON.parse(JSON.stringify(updated)))).not.toBeNull();
  });
});
