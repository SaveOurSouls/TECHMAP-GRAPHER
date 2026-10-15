import { describe, expect, it } from 'vitest';
import { BUILTIN_TERMINATION_RECORDS, createCustomTerminationRecord } from './catalog';
import { generateTerminationSeries, groupTerminationSeries, parseTerminationSeries } from './series';
import { loadTerminationCatalog, saveTerminationSeries, saveCustomTerminationRecords, upsertCustomTerminationRecord, TERMINATION_LIBRARY_STORAGE_KEY } from './storage';
import { createTerminationCatalogBinding } from './placement';
import { recordFromTerminationBinding } from './TerminationProperties';

class MemoryStorage {
  value: string | null = null;
  writes = 0;
  getItem() { return this.value; }
  setItem(_key: string, value: string) { this.value = value; this.writes++; }
}
const input = { name: 'Серия A', manufacturer: 'Завод', assetId: 'nki-ring', articlePattern: 'A-{n}', count: 3, start: 5, step: 2, padding: 3 };
const empty = { records: [], series: [] };
describe('termination series generation and persistence', () => {
  it('generates stable independent records, without guessing catalog conditions', () => {
    const a = generateTerminationSeries(input, 'series:a'), b = generateTerminationSeries(input, 'series:b');
    expect(a.records.map(r => r.article)).toEqual(['A-005','A-007','A-009']);
    expect(new Set([...a.records,...b.records].map(r => r.id)).size).toBe(6);
    expect(a.records.every(r => r.manufacturer === 'Завод' && r.dimensionsMm.L === null && !r.conductorRules.confirmed)).toBe(true);
    expect(groupTerminationSeries([...a.records,...b.records],[a.series,b.series]).filter(s => s.origin === 'custom')).toHaveLength(2);
  });
  it.each([{count:0},{count:201},{step:0},{start:-1},{padding:13},{count:2,articlePattern:'same'},{manufacturer:''},{assetId:'missing'}])('rejects invalid generator input %j', patch => {
    expect(() => generateTerminationSeries({...input,...patch})).toThrow();
  });
  it('commits the whole table and membership in a single write, preserving other series', () => {
    const storage = new MemoryStorage(), a=generateTerminationSeries(input,'series:a'), b=generateTerminationSeries({...input,manufacturer:'Другой завод'},'series:b');
    saveTerminationSeries(storage,a.series,a.records,empty);
    expect(storage.writes).toBe(1);
    saveTerminationSeries(storage,b.series,b.records,empty);
    const reopened=loadTerminationCatalog(storage);
    expect(reopened.series).toHaveLength(2);expect(reopened.records).toHaveLength(6);
    const edited=a.records.map((r,i)=>({...r,dimensionsMm:{...r.dimensionsMm,L:20+i},correctionsMm:{cut:-1,strip:2}}));
    saveTerminationSeries(storage,a.series,edited,reopened);
    expect(loadTerminationCatalog(storage).records.find(r=>r.id===a.records[0]!.id)?.dimensionsMm.L).toBe(20);
    expect(loadTerminationCatalog(storage).records.filter(r=>b.series.recordIds.includes(r.id))).toEqual(b.records);
    expect(loadTerminationCatalog(storage).series.map(s=>s.id)).toEqual(['series:a','series:b']);
    expect(loadTerminationCatalog(storage).records.map(r=>r.id)).toEqual(reopened.records.map(r=>r.id));
  });
  it('keeps legacy article IDs and snapshots through adoption into a series', () => {
    const storage=new MemoryStorage(),record={...createCustomTerminationRecord(BUILTIN_TERMINATION_RECORDS[0]!,'custom:legacy'),article:'OLD'};
    storage.value=JSON.stringify({schemaVersion:1,records:[record]});
    const expected=loadTerminationCatalog(storage),groups=groupTerminationSeries(expected.records,expected.series);
    expect(groups.find(s=>s.origin==='legacy')?.records[0]?.id).toBe(record.id);
    const binding=createTerminationCatalogBinding(record);
    saveTerminationSeries(storage,{id:'series:adopted',name:'Старая серия',manufacturer:null,assetId:record.assetId,recordIds:[record.id]},[{...record,article:'NEW'}],expected);
    expect(loadTerminationCatalog(storage).records[0]?.id).toBe(record.id);
    expect(recordFromTerminationBinding(binding)?.article).toBe('OLD');
    expect(groupTerminationSeries(loadTerminationCatalog(storage).records,loadTerminationCatalog(storage).series).some(s=>s.origin==='legacy')).toBe(false);
  });
  it('preserves series metadata when an older storage helper updates an article', () => {
    const storage=new MemoryStorage(),a=generateTerminationSeries(input,'series:a');
    saveTerminationSeries(storage,a.series,a.records,empty);
    upsertCustomTerminationRecord(storage,{...a.records[0]!,notes:'изменение'});
    expect(loadTerminationCatalog(storage).series).toEqual([a.series]);
  });
  it('appends generated rows without changing existing IDs or fields', () => {
    const storage=new MemoryStorage(),a=generateTerminationSeries(input,'series:a');
    saveTerminationSeries(storage,a.series,a.records,empty);
    const before=loadTerminationCatalog(storage),extra=generateTerminationSeries({...input,start:20,count:2});
    const combined={...a.series,recordIds:[...a.series.recordIds,...extra.series.recordIds]};
    saveTerminationSeries(storage,combined,[...a.records,...extra.records],before);
    const after=loadTerminationCatalog(storage);
    expect(after.records).toHaveLength(5);expect(after.records.slice(0,3)).toEqual(a.records);
    expect(after.series[0]?.id).toBe(a.series.id);
    expect(()=>saveTerminationSeries(storage,{...combined,recordIds:combined.recordIds.slice(1)},after.records.slice(1),after)).toThrow(/Удаление/);
  });
  it('rejects stale saves, duplicate articles and template overwrite before writing', () => {
    const storage=new MemoryStorage(),a=generateTerminationSeries(input,'series:a');
    saveTerminationSeries(storage,a.series,a.records,empty);const expected=loadTerminationCatalog(storage);
    upsertCustomTerminationRecord(storage,{...a.records[0]!,notes:'другое окно'});const before=storage.value;
    expect(()=>saveTerminationSeries(storage,a.series,a.records,expected)).toThrow(/другом окне/);expect(storage.value).toBe(before);
    expect(()=>saveTerminationSeries(storage,a.series,a.records.map(r=>({...r,article:'DUP'})),loadTerminationCatalog(storage))).toThrow(/повторяться/);
    expect(()=>parseTerminationSeries({...a.series,recordIds:[BUILTIN_TERMINATION_RECORDS[0]!.id]},BUILTIN_TERMINATION_RECORDS)).toThrow();
    expect(()=>saveCustomTerminationRecords(storage,BUILTIN_TERMINATION_RECORDS)).toThrow(/Шаблоны/);
  });
  it('does not overwrite malformed membership, corrupt data or quota failures', () => {
    const storage=new MemoryStorage(),a=generateTerminationSeries(input,'series:a');
    storage.value=JSON.stringify({schemaVersion:1,records:a.records,series:[{...a.series,recordIds:['missing']}]});const before=storage.value;
    expect(()=>saveTerminationSeries(storage,a.series,a.records,empty)).toThrow();expect(storage.value).toBe(before);
    storage.value='broken';expect(()=>saveTerminationSeries(storage,a.series,a.records,empty)).toThrow();expect(storage.value).toBe('broken');
    expect(()=>saveTerminationSeries({getItem:()=>null,setItem:()=>{throw new Error('quota');}},a.series,a.records,empty)).toThrow('quota');
    expect(TERMINATION_LIBRARY_STORAGE_KEY).toBe('techmap.termination-library.v1');
  });
});
