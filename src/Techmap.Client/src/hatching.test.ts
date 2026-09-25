import {expect,it,vi} from "vitest";
import sources from "../../../design/hatching_catalog/hatch_sources.json";
import {drawCatalogHatch,hatchingCatalog,hatchSegments} from "./hatching";
const bounds={x:0,y:0,width:160,height:64};
it("matches all 48 original catalogue source hashes and PAT definitions",async()=>{
 expect(hatchingCatalog).toHaveLength(48);
 for(const h of hatchingCatalog){
  const source=sources.find(s=>s.name===h.name.toLowerCase())!;
  const encoder=new TextEncoder(),bytes=encoder.encode(source.text);
  const hash=await crypto.subtle.digest("SHA-1",encoder.encode(`blob ${bytes.length}\0${source.text}`));
  expect(Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,"0")).join("")).toBe(h.source_sha);
  expect(h.lines).toEqual(source.text.split(/\r?\n/).filter(l=>l.trim()&&!/^[*;]/.test(l)).map(l=>l.split(",").map(Number)));
 }
});
it.each(hatchingCatalog)("renders $code from its PAT definitions within the requested bounds",h=>{
 const paths=hatchSegments(h.code,1,0,bounds);expect(paths.length).toBeGreaterThan(0);
 for(const pair of paths)for(const p of pair){expect(p.x).toBeGreaterThanOrEqual(-1e-6);expect(p.x).toBeLessThanOrEqual(160+1e-6);expect(p.y).toBeGreaterThanOrEqual(-1e-6);expect(p.y).toBeLessThanOrEqual(64+1e-6);}
});
it("keeps PAT phase across neighbouring clipped regions instead of repeating a cropped image",()=>{
 const paths=hatchSegments("H06",1,0,{x:160,y:0,width:160,height:64});
 expect(paths.some(([a])=>a.x>160)).toBe(true);
 expect(paths.map(([a,b])=>[a.x-160,a.y,b.x-160,b.y])).not.toEqual(hatchSegments("H06",1,0,bounds).map(([a,b])=>[a.x,a.y,b.x,b.y]));
});
it("changes spacing and stroke width independently",()=>{
 const widths:number[]=[];const ctx=new Proxy({stroke(){widths.push(this.lineWidth)},lineWidth:0},{get:(o,k)=>k in o?Reflect.get(o,k):vi.fn()}) as unknown as CanvasRenderingContext2D;
 drawCatalogHatch(ctx,"H01",1,0,"#123456",2,bounds);drawCatalogHatch(ctx,"H01",2,0,"#123456",2,bounds);drawCatalogHatch(ctx,"H01",2,0,"#123456",4,bounds);
 expect(widths).toEqual([2,2,4]);expect(hatchSegments("H01",2,0,bounds).length).toBeLessThan(hatchSegments("H01",1,0,bounds).length);
});
it("retains dots and rotates horizontal families",()=>{
 expect(hatchSegments("H39",1,0,bounds).some(([a,b])=>a.x===b.x&&a.y===b.y)).toBe(true);
 expect(hatchSegments("H36",1,90,bounds).every(([a,b])=>Math.abs(a.x-b.x)<1e-6)).toBe(true);
});
