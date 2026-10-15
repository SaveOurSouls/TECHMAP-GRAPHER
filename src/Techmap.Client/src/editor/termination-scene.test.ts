import {describe,it,expect} from 'vitest';
// @ts-expect-error Node-only source-integrity test; application tsconfig excludes Node types.
import {createHash} from 'node:crypto';
// @ts-expect-error Node-only source-integrity test; application tsconfig excludes Node types.
import {readFileSync,readdirSync} from 'node:fs';
// @ts-expect-error Node-only source-integrity test; application tsconfig excludes Node types.
import {resolve} from 'node:path';
import {TERMINATION_ASSETS,BUILTIN_TERMINATION_RECORDS,createTerminationPlacement,type TerminationView} from '../termination-library';
import {getTerminationArtworkBounds,TERMINATION_ARTWORK_BOUNDS} from '../termination-library/artwork-bounds';
import {createEmptyHarnessDesign,connectorContactPosition} from './model';
import {terminationSceneObject,terminationSceneBounds,terminationSceneContainsPoint} from './termination-scene';

function fixture(id:string,view:TerminationView,rotation=0,scale=1){
 const record=BUILTIN_TERMINATION_RECORDS.find(r=>r.assetId===id)!;
 const {connector:c}=createTerminationPlacement(record,{id:'t',designation:'T1',position:{x:200,y:300}});
 const connector={...c,drawingPlacements:[{drawingId:'view:drawing',offset:{x:0,y:0},rotationDegrees:rotation,scale,visible:true}]};
 const object=terminationSceneObject({...createEmptyHarnessDesign(),connectors:[connector]},connector,view);
 return {connector,object};
}
describe('accepted termination artwork footprint',()=>{
 it('pins exactly all 62 shipped SVG hashes, so changed/additional art cannot silently retain stale bounds',()=>{
  const folder=resolve('src/termination-library/symbol-assets');
  const files:string[]=(readdirSync(folder) as string[]).filter(n=>n.endsWith('.svg')).sort();
  expect(files).toHaveLength(62);expect(Object.keys(TERMINATION_ARTWORK_BOUNDS).sort()).toEqual(files);
  for(const name of files){const entry=TERMINATION_ARTWORK_BOUNDS[name]!;expect(createHash('sha256').update(readFileSync(resolve(folder,name))).digest('hex'),name).toBe(entry.sha256);const [x,y,right,bottom]=entry.bounds;expect(x).toBeGreaterThanOrEqual(0);expect(y).toBeGreaterThanOrEqual(0);expect(right).toBeLessThanOrEqual(220);expect(bottom).toBeLessThanOrEqual(100);expect(right).toBeGreaterThan(x);expect(bottom).toBeGreaterThan(y);}
 });
 it('uses measured fork and compact flag outlines rather than the 220×100 transparent page',()=>{
  expect(getTerminationArtworkBounds('nvi-fork','drawing')).toEqual([6.1875,30.5625,177.4375,69.4375]);
  const {object}=fixture('flag','drawing'),b=terminationSceneBounds(object)!;
  expect(b.maxX-b.minX).toBeLessThan(76);expect(b.maxY-b.minY).toBeLessThan(57);
  expect(terminationSceneContainsPoint(object,{x:400,y:350},0)).toBe(false);
  expect(terminationSceneContainsPoint(object,{x:260,y:330},0)).toBe(true);
 });
 it('color variants retain the same visible footprint and electrical shape',()=>{
  for(const asset of TERMINATION_ASSETS)for(const color of asset.colorOptions??[]){expect(TERMINATION_ARTWORK_BOUNDS[color.views.drawing]!.bounds).toEqual(TERMINATION_ARTWORK_BOUNDS[asset.views.drawing]!.bounds);expect(color.views.e4).toBe(asset.views.e4);}
 });
 it.each(TERMINATION_ASSETS)('keeps $id bounds tight under rotation/scale without moving its electrical ports',asset=>{
  for(const view of ['e4','drawing'] as const)for(const rotation of [0,30,90,-135])for(const scale of [.5,2]){
   const {connector,object}=fixture(asset.id,view,rotation,scale),b=terminationSceneBounds(object)!,pointOnly=view==='drawing'&&asset.kind==='preparation';
   const angle=(view==='drawing'?rotation:0)*Math.PI/180,s=view==='drawing'?scale:1;
   const world=(x:number,y:number)=>({x:200+s*(x*Math.cos(angle)-y*Math.sin(angle)),y:300+s*(x*Math.sin(angle)+y*Math.cos(angle))});
   for(const [index,contact] of connector.contacts.entries()){
    const p=world(index===1?188:32,50);expect(connectorContactPosition(connector,contact.id,view)).toEqual(p);expect(terminationSceneContainsPoint(object,p,0)).toBe(true);
   }
   if(pointOnly){const p=world(32,50);expect(b).toEqual({minX:p.x-4,minY:p.y-4,maxX:p.x+4,maxY:p.y+4});continue;}
   const local=getTerminationArtworkBounds(asset.id,view)!;expect(JSON.parse(object.metadata!.terminationLocalBounds!)).toEqual(local);
   const corners=[world(local[0],local[1]),world(local[2],local[1]),world(local[2],local[3]),world(local[0],local[3])];
   expect(b.minX).toBeCloseTo(Math.min(...corners.map(p=>p.x)));expect(b.maxX).toBeCloseTo(Math.max(...corners.map(p=>p.x)));expect(b.minY).toBeCloseTo(Math.min(...corners.map(p=>p.y)));expect(b.maxY).toBeCloseTo(Math.max(...corners.map(p=>p.y)));
   const blank=world(219,99);expect(terminationSceneContainsPoint(object,blank,0)).toBe(false);
   const center=world((local[0]+local[2])/2,(local[1]+local[3])/2);expect(terminationSceneContainsPoint(object,center,0)).toBe(true);
  }
 });
 it('keeps a safe full-viewBox fallback for legacy or invalid metadata',()=>{
  const {object}=fixture('nvi-fork','drawing');
  for(const invalid of [undefined,'garbage','[0,0,999,100]','[10,0,0,100]','[0,0,null,100]']){
   const metadata={...object.metadata,terminationLocalBounds:invalid} as Record<string,string>;
   expect(terminationSceneBounds({...object,metadata})).toEqual({minX:200,minY:300,maxX:420,maxY:400});
  }
 });
});
