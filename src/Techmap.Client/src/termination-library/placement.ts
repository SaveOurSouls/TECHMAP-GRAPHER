import {createConnector} from '../editor/commands';
import type {ConnectorInstance,Point} from '../editor/model';
import type {TerminationArtifact,TerminationCatalogBinding} from '../editor/termination-model';
import {parseTerminationRecord,type TerminationLibraryRecord} from './catalog';
import {preparationModeForAsset} from './symbol';
import {terminationSnapshotSha256} from './snapshot-hash';
export function createTerminationCatalogBinding(value:TerminationLibraryRecord):TerminationCatalogBinding{
 const record=parseTerminationRecord(value),serialized=JSON.stringify(record),hash=terminationSnapshotSha256(serialized);
 return {sourceId:'techmap-termination-library',snapshotId:`sha256:${hash}`,snapshotSha256:hash,recordId:record.id,sourceKey:record.article??record.id,displayName:record.name,payload:JSON.parse(serialized) as Readonly<Record<string,unknown>>};
}
export function terminationArtifactFromRecord(value:TerminationLibraryRecord,id:string):TerminationArtifact{
 const r=parseTerminationRecord(value);if(r.kind==='preparation')throw new Error('Разделка — обработка конца, выберите материальный наконечник или гильзу.');
 if(!id.trim())throw new Error('Укажите ID материала оконцовки.');
 const c=r.conductorRules;
 // The current document capacity has no typed conductor-material field. Keep material
 // restrictions pinned, but do not project a misleading positive compatibility result.
 return {id,kind:r.kind,article:r.article??'',symbolId:r.assetId,...(r.colorId?{color:r.colorId}:{}),dimensions:Object.fromEntries(Object.entries(r.dimensionsMm).filter((x):x is [string,number]=>x[1]!==null)),catalogBinding:createTerminationCatalogBinding(r),capacity:{confirmed:c.confirmed&&!!c.evidence&&c.materials.length===0,
  ...(c.minCount===null?{}:{minWireCount:c.minCount}),...(c.maxCount===null?{}:{maxWireCount:c.maxCount}),
  ...(c.allowedCombinations.length?{combinations:c.allowedCombinations.map(sections=>({sections:[...sections],unit:'mm2' as const,...(c.materials.length===1?{material:c.materials[0]}:{})}))}:{})}};
}
export function createTerminationPlacement(value:TerminationLibraryRecord,options:{readonly id:string;readonly designation:string;readonly position:Point}):{connector:ConnectorInstance;artifact?:TerminationArtifact}{
 const r=parseTerminationRecord(value),artifact=r.kind==='preparation'?undefined:terminationArtifactFromRecord(r,`${options.id}:artifact`);
 const connector=createConnector(options.id,options.designation,r.kind==='sleeve'?2:1,options.position,options.position,r.article??r.name);
 return {connector:{...connector,e4TableMode:false,terminationComponent:{kind:r.kind,symbolId:r.assetId,...(artifact?{artifactId:artifact.id}:{}),...(r.colorId?{color:r.colorId}:{}),...(r.kind==='preparation'?{preparationMode:preparationModeForAsset(r.assetId)}:{}),catalogBinding:createTerminationCatalogBinding(r),...(r.kind==='sleeve'?{conductive:true}:{})}},...(artifact?{artifact}:{})};
}
