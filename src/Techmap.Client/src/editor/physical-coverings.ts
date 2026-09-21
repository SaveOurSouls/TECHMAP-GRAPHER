import type { EditorCatalogItem } from "./editor-types";
import type { HarnessDesignDocument, Point } from "./model";
import { physicalSegmentPoints } from "./physical-topology";

export interface CoveringMaterial {
  readonly sourceId: string; readonly snapshotId: string; readonly snapshotSha256: string;
  readonly recordId: string; readonly entityType: "protective-covering";
  readonly sourceKey: string; readonly displayName: string;
}
export interface CoveringSpan { readonly segmentId: string; readonly from: number; readonly to: number }
export interface PhysicalCovering {
  readonly id: string; readonly name: string; readonly spans: readonly CoveringSpan[];
  /** Drawing width, independent of manufacturing length. */
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
    const segment = document.physicalTopology?.segments.find(s => s.id === span.segmentId);
    return segment ? [trimPolyline(physicalSegmentPoints(document, segment), span.from, span.to)] : [];
  });
}
export function validateCoverings(value: unknown, segmentIds: ReadonlySet<string>, existingIds: Set<string>): readonly PhysicalCovering[] | undefined {
  if (value === undefined) return undefined;
  const fail = (): never => { throw new Error("Некорректная оболочка: проверьте участки, границы и материал."); };
  if (!Array.isArray(value) || value.length > 10000) return fail();
  for (const c of value as PhysicalCovering[]) {
    if (!c || typeof c.id !== "string" || !c.id.trim() || c.id.length > 128 || existingIds.has(c.id)) return fail();
    existingIds.add(c.id);
    if (typeof c.name !== "string" || !c.name.trim() || c.name.length > 256 || !/^#[0-9a-f]{6}$/i.test(c.color) || !Number.isFinite(c.width) || c.width < 1 || c.width > 200) return fail();
    if (c.lengthMm !== null && (!Number.isFinite(c.lengthMm) || c.lengthMm < 0 || c.lengthMm > 1e9 || Math.abs(c.lengthMm * 1000 - Math.round(c.lengthMm * 1000)) > 1e-4)) return fail();
    if (!Array.isArray(c.spans) || !c.spans.length || c.spans.length > 20000 || new Set(c.spans.map(s => s?.segmentId)).size !== c.spans.length) return fail();
    for (const s of c.spans) if (!s || !segmentIds.has(s.segmentId) || !Number.isFinite(s.from) || !Number.isFinite(s.to) || s.from < 0 || s.to > 1 || s.from >= s.to) return fail();
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

export const standardCoveringKinds=["Термоусадка","Оплётка","Нитевый бандаж","Обмотка","Металлическая плетёнка"] as const;
export type PhysicalContextAction=typeof standardCoveringKinds[number]|"branch";
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
 return {id,name,width:Math.min(200,(segment.width??16)+8),color:name==="Металлическая плетёнка"?"#73838d":name==="Термоусадка"?"#424c53":"#b19c77",lengthMm:null,spans:[{segmentId,from:Math.max(0,at-.1),to:Math.min(1,at+.1)}]};
}
