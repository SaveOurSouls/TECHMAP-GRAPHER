import {parseTerminationLibrary,parseTerminationRecord,type TerminationLibraryRecord} from './catalog';
export interface StorageLike {getItem(key:string):string|null;setItem(key:string,value:string):void}
export const TERMINATION_LIBRARY_STORAGE_KEY='techmap.termination-library.v1';
export function loadCustomTerminationRecords(storage:StorageLike):TerminationLibraryRecord[]{
  const raw=storage.getItem(TERMINATION_LIBRARY_STORAGE_KEY);if(raw===null)return [];
  const records=parseTerminationLibrary(JSON.parse(raw));
  if(records.some(r=>r.origin!=='custom'||!r.id.startsWith('custom:')))throw new Error('Локальный справочник содержит неверные пользовательские ID.');
  return records;
}
export function saveCustomTerminationRecords(storage:StorageLike,records:readonly TerminationLibraryRecord[]):void{
  const clean=parseTerminationLibrary({schemaVersion:1,records});
  if(clean.some(r=>r.origin!=='custom'||!r.id.startsWith('custom:')))throw new Error('Шаблоны форм нельзя перезаписывать.');
  storage.setItem(TERMINATION_LIBRARY_STORAGE_KEY,JSON.stringify({schemaVersion:1,records:clean}));
}
/** Read latest storage before merging so another editor's records are not discarded. */
export function upsertCustomTerminationRecord(storage:StorageLike,value:TerminationLibraryRecord):TerminationLibraryRecord[]{
  const record=parseTerminationRecord(value),records=loadCustomTerminationRecords(storage),index=records.findIndex(r=>r.id===record.id);
  if(index<0)records.push(record);else records[index]=record;
  saveCustomTerminationRecords(storage,records);return records;
}
