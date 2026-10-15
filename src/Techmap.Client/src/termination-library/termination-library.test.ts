import {describe,it,expect} from 'vitest';
// @ts-expect-error Node-only verification; browser tsconfig intentionally excludes Node types.
import {createHash} from 'node:crypto';
// @ts-expect-error Node-only verification; browser tsconfig intentionally excludes Node types.
import {readFileSync,existsSync} from 'node:fs';
// @ts-expect-error Node-only verification; browser tsconfig intentionally excludes Node types.
import {resolve} from 'node:path';
import {BUILTIN_TERMINATION_RECORDS,TERMINATION_ASSETS,parseTerminationRecord,parseTerminationLibrary,createCustomTerminationRecord,evaluateTerminationCompatibility,type TerminationLibraryRecord} from './catalog';
import {getTerminationSymbol,getTerminationSymbolById,preparationAssetIds} from './symbol';
import {loadCustomTerminationRecords,saveCustomTerminationRecords,upsertCustomTerminationRecord,TERMINATION_LIBRARY_STORAGE_KEY,type StorageLike} from './storage';
import {createTerminationPlacement,createTerminationCatalogBinding,terminationArtifactFromRecord} from './placement';
import {terminationSnapshotSha256} from './snapshot-hash';
import {applyEditorCommand} from '../editor/commands';
import {createEmptyHarnessDesign,parseHarnessDesignDocument} from '../editor/model';
const base=(id='nshvi-double')=>BUILTIN_TERMINATION_RECORDS.find(r=>r.assetId===id)!;
const custom=()=>createCustomTerminationRecord(base(),'custom:test');
class MemoryStorage implements StorageLike {values=new Map<string,string>();getItem(k:string){return this.values.get(k)??null;}setItem(k:string,v:string){this.values.set(k,v);}}
const complete=():TerminationLibraryRecord=>parseTerminationRecord({...custom(),article:'User-specified sample',conductorRules:{confirmed:true,evidence:'Provided article data',minCount:2,maxCount:4,minSectionMm2:.25,maxSectionMm2:2.5,allowedCombinations:[[.5,.75],[1,1,1]],materials:[]}});
describe('termination library records and physical rules',()=>{
 it('offers accepted shapes as unknown templates, never fabricated articles/capacities',()=>{
  expect(BUILTIN_TERMINATION_RECORDS).toHaveLength(25);
  for(const r of BUILTIN_TERMINATION_RECORDS){expect(parseTerminationRecord(r)).toEqual(r);expect(r.article).toBeNull();expect(r.manufacturer).toBeNull();expect(r.ratedCurrentA).toBeNull();expect(r.material).toBeNull();expect(r.conductorRules.confirmed).toBe(false);expect(evaluateTerminationCompatibility(r,[{sectionMm2:.5},{sectionMm2:.5}]).status).toBe('unknown');}
 });
 it('cloning a form into a new article does not inherit another article’s confirmed physical data',()=>{
  const r=createCustomTerminationRecord(complete(),'custom:new');expect(r.article).toBeNull();expect(r.conductorRules.confirmed).toBe(false);expect(r.conductorRules.allowedCombinations).toEqual([]);
 });
 it('preserves unknown numbers and signed corrections through serialized schema',()=>{
  const r=parseTerminationRecord({...custom(),dimensionsMm:{L:12},stripLengthMm:0,correctionsMm:{cut:-1.5,strip:2}});
  const parsed=parseTerminationLibrary(JSON.parse(JSON.stringify({schemaVersion:1,records:[r]})))[0]!;
  expect(parsed.dimensionsMm.L).toBe(12);expect(parsed.dimensionsMm.C).toBeNull();expect(parsed.ratedCurrentA).toBeNull();expect(parsed.correctionsMm.cut).toBe(-1.5);expect(parsed.stripLengthMm).toBe(0);
 });
 it.each([{schemaVersion:2},{assetId:'missing'},{kind:'sleeve'},{colorId:'purple'},{ratedCurrentA:NaN},{stripLengthMm:-1},{dimensionsMm:{unrelated:7}},{conductorRules:{...custom().conductorRules,minCount:3,maxCount:2}},{conductorRules:{...custom().conductorRules,allowedCombinations:[[0]]}},{conductorRules:{...custom().conductorRules,confirmed:true}}])('rejects invalid/falsely confirmed record %j',patch=>{expect(()=>parseTerminationRecord({...custom(),...patch})).toThrow();});
 it('rejects duplicate record IDs and incompatible future storage schema',()=>{
  expect(()=>parseTerminationLibrary({schemaVersion:1,records:[custom(),custom()]})).toThrow(/ID/);expect(()=>parseTerminationLibrary({schemaVersion:2,records:[]})).toThrow();
 });
 it('rejects combinations that contradict count or section bounds before projecting document capacity',()=>{
  const r=complete();
  expect(()=>parseTerminationRecord({...r,conductorRules:{...r.conductorRules,maxCount:2}})).toThrow(/комбинация/);
  expect(()=>parseTerminationRecord({...r,conductorRules:{...r.conductorRules,minSectionMm2:1}})).toThrow(/комбинация/);
  expect(()=>parseTerminationRecord({...r,article:'x'.repeat(513)})).toThrow(/512/);
 });
 it('checks unordered explicit combinations with 2/3/4+ wires independently of color',()=>{
  const r=complete();for(const colorId of ['white','red','blue','black','yellow']){
   expect(evaluateTerminationCompatibility({...r,colorId},[{sectionMm2:.75},{sectionMm2:.5}]).status).toBe('compatible');
   expect(evaluateTerminationCompatibility({...r,colorId},[{sectionMm2:.5},{sectionMm2:.5}]).status).toBe('incompatible');
   expect(evaluateTerminationCompatibility({...r,colorId},Array.from({length:5},()=>({sectionMm2:.5}))).status).toBe('incompatible');
  }
  expect(evaluateTerminationCompatibility(r,[{sectionMm2:1},{sectionMm2:1},{sectionMm2:1}]).status).toBe('compatible');
  expect(evaluateTerminationCompatibility(r,[{sectionMm2:null},{sectionMm2:.5}]).status).toBe('unknown');
 });
 it('does not approve partial capacity information or unknown material',()=>{
  const r=parseTerminationRecord({...complete(),conductorRules:{...complete().conductorRules,allowedCombinations:[],maxSectionMm2:null}});
  expect(evaluateTerminationCompatibility(r,[{sectionMm2:.5},{sectionMm2:.5}]).status).toBe('unknown');
  const material={...complete(),conductorRules:{...complete().conductorRules,materials:['copper']}};
  expect(evaluateTerminationCompatibility(material,[{sectionMm2:.5},{sectionMm2:.75}]).status).toBe('unknown');
  expect(evaluateTerminationCompatibility(material,[{sectionMm2:.5,material:'copper'},{sectionMm2:.75,material:'copper'}]).status).toBe('compatible');
  expect(terminationArtifactFromRecord(material,'a').capacity?.confirmed).toBe(false);
 });
});
describe('local custom storage',()=>{
 it('reopens edited articles and merges the latest records from another editor',()=>{
  const storage=new MemoryStorage();saveCustomTerminationRecords(storage,[custom()]);
  const other={...custom(),id:'custom:other',article:'Other'};upsertCustomTerminationRecord(storage,other);
  upsertCustomTerminationRecord(storage,{...custom(),article:'Edited'});
  expect(loadCustomTerminationRecords(storage).map(r=>r.article)).toEqual(['Edited','Other']);
 });
 it('does not overwrite corrupt storage or silently swallow quota failures',()=>{
  const storage=new MemoryStorage();storage.setItem(TERMINATION_LIBRARY_STORAGE_KEY,'broken');
  expect(()=>upsertCustomTerminationRecord(storage,custom())).toThrow();expect(storage.getItem(TERMINATION_LIBRARY_STORAGE_KEY)).toBe('broken');
  expect(()=>saveCustomTerminationRecords({getItem:()=>null,setItem:()=>{throw new Error('quota');}},[custom()])).toThrow('quota');
  expect(()=>saveCustomTerminationRecords(new MemoryStorage(),[base()])).toThrow(/Шаблоны/);
 });
});
describe('runtime accepted symbols and adapters',()=>{
 it('ships every base/color SVG and resolves monochrome E4 versus colored drawing',()=>{
  for(const asset of TERMINATION_ASSETS){
   for(const view of ['e4','drawing'] as const){const d=getTerminationSymbolById(asset.id,view)!;expect(d.pointCount).toBe(asset.kind==='sleeve'?2:1);expect(d.anchors[0]).toMatchObject({x:32,y:50});if(d.pointCount===2)expect(d.anchors[1]).toMatchObject({x:188,y:50});
    const file=resolve('src/termination-library/symbol-assets',asset.views[view]);expect(existsSync(file)).toBe(true);const xml:string=readFileSync(file,'utf8');expect((xml.match(/data-role="wire-entry"/g)??[]).length).toBe(d.pointCount);
    if(view==='e4'){const colors=xml.match(/#[0-9a-f]{6}/gi)??[];expect(colors.every(c=>['#334155','#ffffff'].includes(c.toLowerCase()))).toBe(true);}
   }
   for(const c of asset.colorOptions??[]){expect(existsSync(resolve('src/termination-library/symbol-assets',c.views.drawing))).toBe(true);expect(getTerminationSymbol({assetId:asset.id,colorId:c.id},'drawing')?.href).toContain(c.views.drawing);expect(getTerminationSymbol({symbolId:asset.id,color:c.hex},'e4')?.href).toContain(asset.views.e4);}
  }
  expect(getTerminationSymbolById('unknown','e4')).toBeNull();
 });
 it.each(Object.entries(preparationAssetIds))('maps preparation %s to the accepted shared point', (mode,id)=>{
  expect(getTerminationSymbol({symbolId:'point',preparationMode:mode as keyof typeof preparationAssetIds},'e4')?.assetId).toBe(id);
 });
 it('pins a real immutable SHA-256 payload and changes it when article data changes',()=>{
  for(const s of ['', 'abc', 'окончание', 'a'.repeat(1200)])expect(terminationSnapshotSha256(s)).toBe(createHash('sha256').update(s).digest('hex'));
  const r=complete(),binding=createTerminationCatalogBinding(r);expect(binding.snapshotSha256).toBe(createHash('sha256').update(JSON.stringify(binding.payload)).digest('hex'));
  expect(createTerminationCatalogBinding({...r,article:'new'}).snapshotSha256).not.toBe(binding.snapshotSha256);
  expect(binding.payload).not.toBe(r);expect((binding.payload?.conductorRules as {allowedCombinations:number[][]}).allowedCombinations).toEqual([[.5,.75],[1,1,1]]);
 });
 it.each(BUILTIN_TERMINATION_RECORDS)('places and round-trips $assetId with exactly its accepted point count',r=>{
  const placement=createTerminationPlacement(r,{id:'p',designation:'T1',position:{x:90,y:80}});
  let doc=applyEditorCommand(createEmptyHarnessDesign(),{type:'add-termination-component',...placement});
  doc=parseHarnessDesignDocument(JSON.parse(JSON.stringify(doc)));
  expect(doc.connectors[0]?.contacts).toHaveLength(r.kind==='sleeve'?2:1);expect(doc.connectors[0]?.terminationComponent?.catalogBinding?.payload?.assetId).toBe(r.assetId);
  expect(doc.terminations?.artifacts??[]).toHaveLength(r.kind==='preparation'?0:1);
  if(placement.artifact){expect(placement.artifact.article).toBe('');expect(placement.artifact.capacity?.confirmed).toBe(false);}
 });
});
