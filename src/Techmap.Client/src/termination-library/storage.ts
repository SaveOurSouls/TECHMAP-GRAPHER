import {parseTerminationLibrary,parseTerminationRecord,type TerminationLibraryRecord} from './catalog';
import {parseTerminationSeries,type TerminationSeries} from './series';
export interface StorageLike {getItem(key:string):string|null;setItem(key:string,value:string):void}
export const TERMINATION_LIBRARY_STORAGE_KEY='techmap.termination-library.v1';
export interface TerminationCatalog {readonly records:readonly TerminationLibraryRecord[];readonly series:readonly TerminationSeries[]}
export function loadTerminationCatalog(storage:StorageLike):TerminationCatalog{
  const raw=storage.getItem(TERMINATION_LIBRARY_STORAGE_KEY);if(raw===null)return {records:[],series:[]};
  const value=JSON.parse(raw),records=parseTerminationLibrary(value);
  if(records.some(r=>r.origin!=='custom'||!r.id.startsWith('custom:')))throw new Error('Локальный справочник содержит неверные пользовательские ID.');
  if(value.series!==undefined&&!Array.isArray(value.series))throw new Error('Неверный список серий.');
  const series:TerminationSeries[]=(value.series??[]).map((s:unknown)=>parseTerminationSeries(s,records));
  const ids=series.map(s=>s.id),members=series.flatMap(s=>s.recordIds);
  if(new Set(ids).size!==ids.length||new Set(members).size!==members.length)throw new Error('Повторяющиеся серии или принадлежность артикула.');
  return {records,series};
}
export function loadCustomTerminationRecords(storage:StorageLike):TerminationLibraryRecord[]{
  return [...loadTerminationCatalog(storage).records];
}
export function saveCustomTerminationRecords(storage:StorageLike,records:readonly TerminationLibraryRecord[]):void{
  const clean=parseTerminationLibrary({schemaVersion:1,records});
  if(clean.some(r=>r.origin!=='custom'||!r.id.startsWith('custom:')))throw new Error('Шаблоны форм нельзя перезаписывать.');
  const previous=loadTerminationCatalog(storage);
  const series=previous.series.map(s=>parseTerminationSeries(s,clean));
  storage.setItem(TERMINATION_LIBRARY_STORAGE_KEY,JSON.stringify({schemaVersion:1,records:clean,series}));
}
/** One storage write commits membership and every row together; merge unrelated latest series. */
export function saveTerminationSeries(storage:StorageLike,series:TerminationSeries,rows:readonly TerminationLibraryRecord[],expected:TerminationCatalog):TerminationCatalog{
  const latest=loadTerminationCatalog(storage);
  const before=expected.series.find(s=>s.id===series.id),now=latest.series.find(s=>s.id===series.id);
  const ids=new Set([...series.recordIds,...(before?.recordIds??[])]);
  if(JSON.stringify(before)!==JSON.stringify(now)||[...ids].some(id=>JSON.stringify(expected.records.find(r=>r.id===id))!==JSON.stringify(latest.records.find(r=>r.id===id))))throw new Error('Эта серия изменена в другом окне. Обновите библиотеку перед сохранением.');
  if(rows.length!==series.recordIds.length||new Set(rows.map(r=>r.id)).size!==rows.length||rows.some(r=>!ids.has(r.id)||!r.article?.trim()))throw new Error('Заполните уникальный артикул в каждой строке серии.');
  if(before?.recordIds.some(id=>!series.recordIds.includes(id)))throw new Error('Удаление артикулов серии не поддерживается.');
  const clean=rows.map(parseTerminationRecord),updates=new Map(clean.map(r=>[r.id,r]));
  const existingIds=new Set(latest.records.map(r=>r.id));
  const records=[...latest.records.map(r=>updates.get(r.id)??r),...clean.filter(r=>!existingIds.has(r.id))];
  parseTerminationLibrary({schemaVersion:1,records});
  if(records.some(r=>r.origin!=='custom'||!r.id.startsWith('custom:')))throw new Error('Шаблоны форм нельзя перезаписывать.');
  const parsed=parseTerminationSeries(series,records);
  const allSeries=now?latest.series.map(s=>s.id===series.id?parsed:s):[...latest.series,parsed];
  const members=allSeries.flatMap(s=>s.recordIds);
  if(new Set(members).size!==members.length)throw new Error('Артикул уже принадлежит другой серии.');
  storage.setItem(TERMINATION_LIBRARY_STORAGE_KEY,JSON.stringify({schemaVersion:1,records,series:allSeries}));
  return {records,series:allSeries};
}
/** Read latest storage before merging so another editor's records are not discarded. */
export function upsertCustomTerminationRecord(storage:StorageLike,value:TerminationLibraryRecord):TerminationLibraryRecord[]{
  const record=parseTerminationRecord(value),records=loadCustomTerminationRecords(storage),index=records.findIndex(r=>r.id===record.id);
  if(index<0)records.push(record);else records[index]=record;
  saveCustomTerminationRecords(storage,records);return records;
}
