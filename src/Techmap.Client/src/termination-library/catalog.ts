import manifest from './symbol-assets/manifest.json';

export type TerminationView = 'e4' | 'drawing';
export type TerminationKind = 'terminal' | 'sleeve' | 'preparation';
export type PreparationMode = 'cut' | 'copper' | 'tin' | 'pin' | 'socket' | 'pin-sealed' | 'socket-sealed' | 'lug';
export interface TerminationAsset {
  readonly id: string; readonly name: string; readonly kind: TerminationKind;
  readonly views: {readonly e4: string; readonly drawing: string};
  readonly anchors: readonly {readonly id: string; readonly role: string; readonly x: number; readonly y: number; readonly normal: readonly number[]}[];
  readonly pivot: {readonly x: number; readonly y: number}; readonly electricalPointCount: number;
  readonly colorOptions?: readonly {readonly id: string; readonly name: string; readonly hex: string; readonly views: {readonly e4: string; readonly drawing: string}}[];
}
export const TERMINATION_ASSETS = manifest.assets as readonly TerminationAsset[];
export const terminationAsset = (id: string) => TERMINATION_ASSETS.find(a => a.id === id);
export function terminationDimensionFields(assetId: string): readonly string[] {
  if (assetId === 'nki-ring' || assetId === 'nvi-fork') return ['L','L1','D','B','d1','P','S'];
  if (assetId.startsWith('nshvi-')) return ['L','L1','C','W','A'];
  if (assetId === 'din-sc-ring') return ['L','d2','d','D','B','E'];
  if (assetId === 'pin-round' || assetId === 'socket-round') return ['L','d'];
  if (assetId.startsWith('sleeve-')) return ['L','D','d'];
  return assetId.startsWith('preparation-') ? [] : ['L','W','t'];
}
export interface ConductorRules {
  readonly confirmed: boolean; readonly evidence: string | null;
  readonly minCount: number | null; readonly maxCount: number | null;
  readonly minSectionMm2: number | null; readonly maxSectionMm2: number | null;
  readonly allowedCombinations: readonly (readonly number[])[];
  readonly materials: readonly string[];
}
export interface TerminationLibraryRecord {
  readonly schemaVersion: 1; readonly id: string; readonly name: string;
  readonly origin: 'template' | 'custom'; readonly assetId: string; readonly kind: TerminationKind;
  readonly manufacturer: string | null; readonly article: string | null;
  readonly dimensionsMm: Readonly<Record<string, number | null>>;
  readonly conductorRules: ConductorRules; readonly ratedCurrentA: number | null;
  readonly colorId: string | null; readonly colorName: string | null;
  readonly material: string | null; readonly insulation: string | null;
  readonly stripLengthMm: number | null;
  readonly correctionsMm: {readonly cut: number | null; readonly strip: number | null};
  readonly source: string | null; readonly notes: string | null;
}
export const unknownConductorRules = (): ConductorRules => ({confirmed:false,evidence:null,minCount:null,maxCount:null,minSectionMm2:null,maxSectionMm2:null,allowedCombinations:[],materials:[]});
export const BUILTIN_TERMINATION_RECORDS: readonly TerminationLibraryRecord[] = TERMINATION_ASSETS.map(a => ({
  schemaVersion:1,id:`template:${a.id}`,name:a.name,origin:'template',assetId:a.id,kind:a.kind,
  manufacturer:null,article:null,dimensionsMm:Object.fromEntries(terminationDimensionFields(a.id).map(k=>[k,null])),
  conductorRules:unknownConductorRules(),ratedCurrentA:null,colorId:null,colorName:null,material:null,insulation:null,
  stripLengthMm:null,correctionsMm:{cut:null,strip:null},source:'Проектный символ 099; каталожные данные не заполнены.',notes:null,
}));
const fail = (s: string): never => {throw new Error(`Библиотека оконцовок: ${s}`);};
function object(v:unknown):Record<string,unknown>{if(!v||typeof v!=='object'||Array.isArray(v))return fail('ожидается объект.');return v as Record<string,unknown>;}
function text(v:unknown,required=false):string|null{if(v===null||v===undefined)return required?fail('заполните название или ID.'):null;if(typeof v!=='string'||v.length>4096)return fail('неверное текстовое поле.');const s=v.trim();return s|| (required?fail('пустое обязательное поле.'):null);}
function number(v:unknown,negative=false,integer=false):number|null{if(v===null||v===undefined)return null;if(typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>1e7||(!negative&&v<0)||(integer&&(!Number.isSafeInteger(v)||v<1)))return fail('неверное числовое поле.');return v;}
function positive(v:unknown):number{const n=number(v);if(n===null||n<=0)return fail('сечение должно быть больше нуля.');return n;}
function pair(min:number|null,max:number|null):void{if(min!==null&&max!==null&&min>max)fail('нижняя граница больше верхней.');}
export function parseTerminationRecord(value:unknown):TerminationLibraryRecord{
  const r=object(value);if(r.schemaVersion!==1)return fail('неподдерживаемая версия записи.');
  const id=text(r.id,true)!;if(!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(id))return fail('неверный ID.');
  const assetId=text(r.assetId,true)!,asset=terminationAsset(assetId);if(!asset||r.kind!==asset.kind)return fail('неизвестный символ или неверный вид.');
  if(r.origin!=='template'&&r.origin!=='custom')return fail('неверное происхождение записи.');
  const dimensions=object(r.dimensionsMm),fields=terminationDimensionFields(assetId);
  if(Object.keys(dimensions).some(k=>!fields.includes(k)))return fail('поле размера не относится к выбранному семейству.');
  const c=object(r.conductorRules);if(typeof c.confirmed!=='boolean')return fail('неверное подтверждение совместимости.');
  if(!Array.isArray(c.allowedCombinations)||c.allowedCombinations.length>128||!Array.isArray(c.materials)||c.materials.length>64)return fail('неверные условия проводников.');
  const combinations=c.allowedCombinations.map(v=>{if(!Array.isArray(v)||!v.length||v.length>128)return fail('пустая/слишком длинная комбинация.');return v.map(positive);});
  const rules:ConductorRules={confirmed:c.confirmed,evidence:text(c.evidence),minCount:number(c.minCount,false,true),maxCount:number(c.maxCount,false,true),minSectionMm2:number(c.minSectionMm2),maxSectionMm2:number(c.maxSectionMm2),allowedCombinations:combinations,materials:c.materials.map(v=>text(v,true)!)};
  pair(rules.minCount,rules.maxCount);pair(rules.minSectionMm2,rules.maxSectionMm2);
  if(rules.minSectionMm2===0||rules.maxSectionMm2===0)return fail('сечение должно быть больше нуля.');
  if(combinations.some(items=>(rules.minCount!==null&&items.length<rules.minCount)||(rules.maxCount!==null&&items.length>rules.maxCount)||items.some(n=>(rules.minSectionMm2!==null&&n<rules.minSectionMm2)||(rules.maxSectionMm2!==null&&n>rules.maxSectionMm2))))return fail('комбинация противоречит диапазону проводников.');
  if(rules.confirmed&&!rules.evidence)return fail('укажите источник подтверждённых условий совместимости.');
  const colorId=text(r.colorId);if(colorId&&!asset.colorOptions?.some(x=>x.id===colorId))return fail('цветовой SVG не предусмотрен для этой формы.');
  const corrections=object(r.correctionsMm);
  const name=text(r.name,true)!,article=text(r.article);if(name.length>512||(article?.length??0)>512)return fail('название и артикул не должны превышать 512 символов.');
  return {schemaVersion:1,id,name,origin:r.origin,assetId,kind:asset.kind,
    manufacturer:text(r.manufacturer),article,dimensionsMm:Object.fromEntries(fields.map(k=>[k,number(dimensions[k])])),conductorRules:rules,
    ratedCurrentA:number(r.ratedCurrentA),colorId,colorName:text(r.colorName),material:text(r.material),insulation:text(r.insulation),stripLengthMm:number(r.stripLengthMm),
    correctionsMm:{cut:number(corrections.cut,true),strip:number(corrections.strip,true)},source:text(r.source),notes:text(r.notes)};
}
export function parseTerminationLibrary(value:unknown):TerminationLibraryRecord[]{
  const r=object(value);if(r.schemaVersion!==1||!Array.isArray(r.records)||r.records.length>2000)return fail('неверный формат справочника.');
  const records=r.records.map(parseTerminationRecord);if(new Set(records.map(r=>r.id)).size!==records.length)return fail('повторяющиеся ID записей.');
  return records;
}
export function createCustomTerminationRecord(base:TerminationLibraryRecord,id=`custom:${crypto.randomUUID()}`):TerminationLibraryRecord{
  return parseTerminationRecord({...JSON.parse(JSON.stringify(base)),id,origin:'custom',name:`${base.name} · свой артикул`,manufacturer:null,article:null,
    dimensionsMm:Object.fromEntries(terminationDimensionFields(base.assetId).map(k=>[k,null])),conductorRules:unknownConductorRules(),ratedCurrentA:null,
    material:null,insulation:null,stripLengthMm:null,correctionsMm:{cut:null,strip:null},source:null,notes:null});
}
export interface TerminationConductor {readonly sectionMm2:number|null; readonly material?:string|null}
export interface CompatibilityResult {readonly status:'compatible'|'incompatible'|'unknown';readonly reason:string}
/** Physical conditions only: color and the symbol's port count never determine capacity. Call for one input at a time. */
export function evaluateTerminationCompatibility(record:TerminationLibraryRecord,wires:readonly TerminationConductor[]):CompatibilityResult{
  const r=record.conductorRules,unknown=(reason:string):CompatibilityResult=>({status:'unknown',reason}),no=(reason:string):CompatibilityResult=>({status:'incompatible',reason});
  if(!r.confirmed||!r.evidence)return unknown('Условия артикула не подтверждены.');
  if((r.minCount!==null&&wires.length<r.minCount)||(r.maxCount!==null&&wires.length>r.maxCount))return no('Число проводников вне диапазона артикула.');
  if(!wires.length)return unknown('Нет проводников для проверки.');
  if(wires.some(w=>w.sectionMm2===null||!Number.isFinite(w.sectionMm2)||w.sectionMm2!<=0))return unknown('Сечение одного из проводников неизвестно.');
  if(wires.some(w=>(r.minSectionMm2!==null&&w.sectionMm2!<r.minSectionMm2)||(r.maxSectionMm2!==null&&w.sectionMm2!>r.maxSectionMm2)))return no('Сечение вне диапазона артикула.');
  if(r.materials.length){if(wires.some(w=>!w.material))return unknown('Материал проводника неизвестен.');if(wires.some(w=>!r.materials.includes(w.material!)))return no('Материал проводника не разрешён.');}
  if(r.allowedCombinations.length){const sections=wires.map(w=>w.sectionMm2!).sort((a,b)=>a-b);if(!r.allowedCombinations.some(c=>c.length===sections.length&&[...c].sort((a,b)=>a-b).every((n,i)=>Math.abs(n-sections[i]!)<1e-9)))return no('Комбинация проводников отсутствует в условиях артикула.');return {status:'compatible',reason:'Комбинация соответствует подтверждённым условиям.'};}
  if(r.minCount===null||r.maxCount===null||r.minSectionMm2===null||r.maxSectionMm2===null)return unknown('Недостаточно условий для полной проверки.');
  return {status:'compatible',reason:'Число и сечения соответствуют подтверждённому диапазону.'};
}
