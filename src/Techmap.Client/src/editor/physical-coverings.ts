import type { EditorCatalogItem } from "./editor-types";
import { findWireEndpoint, type HarnessDesignDocument, type Point } from "./model";
import { physicalSegmentPoints, physicalSegmentControls, physicalNodePoint } from "./physical-geometry";

export interface CoveringMaterial {
  readonly sourceId: string; readonly snapshotId: string; readonly snapshotSha256: string;
  readonly recordId: string; readonly entityType: "protective-covering";
  readonly sourceKey: string; readonly displayName: string;
}
export interface CoveringSpan { readonly segmentId: string; readonly from: number; readonly to: number; readonly fromAnchor?:number; readonly toAnchor?:number }
export type CoveringKind="heat-shrink"|"nylon"|"braid"|"metal-braid"|"tape"|"band";
export interface PhysicalCovering {
  readonly kind?:CoveringKind;
  readonly lengthMode?:"auto"|"manual";
  readonly id: string; readonly name: string; readonly spans: readonly CoveringSpan[];
  /** Drawing width; zero fits the underlying surfaces automatically. Independent of manufacturing length. */
  readonly width: number; readonly color: string; readonly lengthMm: number | null;
  readonly material?: CoveringMaterial;
}
export function coveringMaterial(item: EditorCatalogItem): CoveringMaterial {
  if (item.entityType !== "protective-covering" || !item.sourceId || !item.snapshotId || !item.snapshotSha256 || !item.recordId || !item.sourceKey) throw new Error("Выберите опубликованный материал защиты с закреплённой версией.");
  return { sourceId: item.sourceId, snapshotId: item.snapshotId, snapshotSha256: item.snapshotSha256, recordId: item.recordId, entityType: "protective-covering", sourceKey: item.sourceKey, displayName: item.referenceDisplayName || item.title };
}
export const pathLength = (points: readonly Point[]) => points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - points[i]!.x, p.y - points[i]!.y), 0);
export function trimPolyline(points: readonly Point[], from: number, to: number): Point[] {
  const total = pathLength(points), start = total * from, end = total * to;
  let distance = 0;
  const result: Point[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!, length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length > 0 && distance + length > start && distance < end) {
      const at = (d: number) => ({ x: a.x + (b.x - a.x) * d / length, y: a.y + (b.y - a.y) * d / length });
      if (!result.length) result.push(at(Math.max(0, start - distance)));
      result.push(at(Math.min(length, end - distance)));
    }
    distance += length;
  }
  return result;
}
export function coveringPaths(document: HarnessDesignDocument, covering: PhysicalCovering): Point[][] {
  return covering.spans.flatMap(span => {
    const route=coveringRoute(document,span.segmentId);if(!route)return [];
    const bounds=resolvedCoveringSpan(document,span);
    return [trimPolyline(route.points,(route.before+bounds.from*route.length)/route.total,(route.before+bounds.to*route.length)/route.total)];
  });
}
export function validateCoverings(value: unknown, segmentIds: ReadonlySet<string>, existingIds: Set<string>): readonly PhysicalCovering[] | undefined {
  if (value === undefined) return undefined;
  const fail = (): never => { throw new Error("Некорректная оболочка: проверьте участки, границы и материал."); };
  if (!Array.isArray(value) || value.length > 10000) return fail();
  for (const c of value as PhysicalCovering[]) {
    if (!c || typeof c.id !== "string" || !c.id.trim() || c.id.length > 128 || existingIds.has(c.id)) return fail();
    existingIds.add(c.id);
    if (typeof c.name !== "string" || !c.name.trim() || c.name.length > 256 || !/^#[0-9a-f]{6}$/i.test(c.color) || !Number.isFinite(c.width) || c.width < 0 || c.width > 1e7) return fail();
    if(c.kind!==undefined&&!["heat-shrink","nylon","braid","metal-braid","tape","band"].includes(c.kind)||c.lengthMode!==undefined&&!["auto","manual"].includes(c.lengthMode))return fail();
    if (c.lengthMm !== null && (!Number.isFinite(c.lengthMm) || c.lengthMm < 0 || c.lengthMm > 1e9 || Math.abs(c.lengthMm * 1000 - Math.round(c.lengthMm * 1000)) > 1e-4)) return fail();
    if (!Array.isArray(c.spans) || !c.spans.length || c.spans.length > 20000 || new Set(c.spans.map(s => s?.segmentId)).size !== c.spans.length) return fail();
    for (const s of c.spans) if (!s || !segmentIds.has(s.segmentId) || !Number.isFinite(s.from) || !Number.isFinite(s.to) || s.from < -10000 || s.to > 10001 || s.from >= s.to || [s.fromAnchor,s.toAnchor].some(i=>i!==undefined&&(!Number.isInteger(i)||i<0||i>1001))) return fail();
    if (c.material !== undefined) {
      if (!c.material || typeof c.material !== "object") return fail();
      const m = c.material;
      if (m.entityType !== "protective-covering" || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(m.snapshotId) || m.snapshotId === "00000000-0000-0000-0000-000000000000" || !/^[\da-f]{64}$/i.test(m.snapshotSha256) || !/^[\da-f]{64}$/i.test(m.recordId)) return fail();
      for (const key of ["sourceId", "sourceKey", "displayName"] as const) if (typeof m[key] !== "string" || !m[key].trim() || m[key].length > 512) return fail();
    }
  }
  return value;
}

export function splitCoveringSpans(coverings: readonly PhysicalCovering[] | undefined, id: string, nextId: string, fraction: number): readonly PhysicalCovering[] | undefined {
  return coverings?.map(c => ({ ...c, spans: c.spans.flatMap(s => s.segmentId !== id ? [s] : [
    ...(s.from < fraction ? [{ segmentId: id, from: s.from / fraction, to: Math.min(s.to, fraction) / fraction }] : []),
    ...(s.to > fraction ? [{ segmentId: nextId, from: Math.max(0, (s.from - fraction) / (1 - fraction)), to: (s.to - fraction) / (1 - fraction) }] : []),
  ]) }));
}

export const standardCoveringKinds=["Термоусадка","Нейлонка","Оплётка","Нитевый бандаж","Обмотка","Металлическая плетёнка"] as const;
export type PhysicalContextAction=typeof standardCoveringKinds[number]|"branch"|"remove-pipe";
export function projectOntoPolyline(points:readonly Point[],point:Point){
 let best={point:points[0]??point,index:1,fraction:0,distance:Infinity},travelled=0;const total=pathLength(points);
 for(let i=1;i<points.length;i++){const a=points[i-1]!,b=points[i]!,dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy),t=length?Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/(length*length))):0;
 const q={x:a.x+t*dx,y:a.y+t*dy},distance=Math.hypot(point.x-q.x,point.y-q.y);
 if(distance<best.distance)best={point:q,index:i,fraction:total?(travelled+t*length)/total:0,distance};travelled+=length;}
 return best;
}
export function standardCovering(document:HarnessDesignDocument,segmentId:string,point:Point,name:typeof standardCoveringKinds[number],id:string):PhysicalCovering {
 const segment=document.physicalTopology!.segments.find(s=>s.id===segmentId)!;
 const at=projectOntoPolyline(physicalSegmentPoints(document,segment),point).fraction;
 return {id,name,kind:coveringKind({name}),lengthMode:"auto",width:0,color:name==="Металлическая плетёнка"?"#73838d":name==="Термоусадка"?"#424c53":"#b19c77",lengthMm:null,spans:[{segmentId,from:Math.max(0,at-.1),to:Math.min(1,at+.1)}]};
}

export function coveringKind(c:{name:string;kind?:CoveringKind}):CoveringKind {
 return c.kind??(/термо/i.test(c.name)?"heat-shrink":/нейлон/i.test(c.name)?"nylon":/метал/i.test(c.name)?"metal-braid":/бандаж/i.test(c.name)?"band":/обмот|лент/i.test(c.name)?"tape":"braid");
}

/** The tails extend the same pipe parameter space towards the connector contacts. */
export function coveringRoute(document:HarnessDesignDocument,segmentId:string) {
 const t=document.physicalTopology,s=t?.segments.find(s=>s.id===segmentId);if(!t||!s)return null;
 const core=physicalSegmentPoints(document,s),length=pathLength(core);if(length<1e-7)return null;
 const tail=(nodeId:string)=>{
  const node=t.nodes.find(n=>n.id===nodeId)!;if(!node.connectorId)return null;
  const ids=t.routes.filter(r=>r.steps.some(p=>p.segmentId===s.id)).map(r=>r.wireId);
  const points=document.wires.filter(w=>ids.includes(w.id)).flatMap(w=>[w.from,w.to].filter(e=>e.connectorId===node.connectorId).flatMap(e=>{const p=findWireEndpoint(document,e,"drawing");return p?[p]:[]}));
  return points.length?{x:points.reduce((n,p)=>n+p.x,0)/points.length,y:points.reduce((n,p)=>n+p.y,0)/points.length}:physicalNodePoint(document,node);
 };
 const a=tail(s.from),b=tail(s.to),before=a?Math.hypot(a.x-core[0]!.x,a.y-core[0]!.y):0,after=b?Math.hypot(b.x-core.at(-1)!.x,b.y-core.at(-1)!.y):0;
 return {points:[...(a?[a]:[]),...core,...(b?[b]:[])],core,length,before,after,total:before+length+after,min:-before/length,max:1+after/length};
}

export function coveringControlFractions(document:HarnessDesignDocument,segmentId:string):number[] {
 const s=document.physicalTopology?.segments.find(s=>s.id===segmentId);if(!s)return [];
 const points=physicalSegmentPoints(document,s);
 return physicalSegmentControls(document,s).map(p=>projectOntoPolyline(points,p).fraction);
}
export function resolvedCoveringSpan(document:HarnessDesignDocument,s:CoveringSpan):CoveringSpan {
 const fractions=coveringControlFractions(document,s.segmentId);
 return {...s,from:s.fromAnchor===undefined?s.from:fractions[s.fromAnchor]??s.from,to:s.toAnchor===undefined?s.to:fractions[s.toAnchor]??s.to};
}
/** Only explicitly bound endpoints use measured pipe intervals; pixels never become millimetres. */
export function coveringMeasuredLength(document:HarnessDesignDocument,c:PhysicalCovering):number|null {
 if(c.lengthMode==="manual"||c.lengthMode===undefined&&c.lengthMm!==null)return c.lengthMm;
 let sum=0;
 for(const s of c.spans){
  if(s.fromAnchor===undefined||s.toAnchor===undefined)return null;
  const dims=document.drawingDocuments?.dimensions?.filter(d=>d.segmentId===s.segmentId)??[];
  const exact=dims.find(d=>d.from===s.fromAnchor&&d.to===s.toAnchor);
  if(exact){if(exact.lengthMm===null)return null;sum+=Math.round(exact.lengthMm*1000);continue;}
  const parts=dims.filter(d=>d.from>=s.fromAnchor!&&d.to<=s.toAnchor!).sort((a,b)=>a.from-b.from);
  let next=s.fromAnchor;
  for(const d of parts){if(d.from!==next||d.lengthMm===null)return null;sum+=Math.round(d.lengthMm*1000);next=d.to;}
  if(next!==s.toAnchor)return null;
 }
 return sum/1000;
}
