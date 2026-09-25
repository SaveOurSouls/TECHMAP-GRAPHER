import type { HarnessDesignDocument, Point } from "./model";
import { physicalSegmentPoints } from "./physical-geometry";
import { pathLength, projectOntoPolyline, resolvedCoveringSpan } from "./physical-coverings";
import { drawingBendRadius, drawingRouteSamples } from "./drawing-route-path";
import { pipeMemberSegments, type PipeBundleMember } from "./pipe-bundle-model";
import { pipeBundleSections } from "./pipe-bundle-section";

interface Sample { readonly fraction: number; readonly point: Point }
interface Chain { readonly ids: readonly string[]; readonly lengths: readonly number[]; readonly length: number; readonly samples: readonly Sample[] }
interface Placement {
  readonly coveringId: string;
  readonly ancestors: ReadonlySet<string>;
  readonly axis: Chain;
  readonly chain: Chain;
  readonly start: number;
  readonly end: number;
  readonly reverse: boolean;
  readonly offset: number;
  readonly depth: number;
  readonly leafCount: number;
  readonly groupOffsets: ReadonlyMap<string, number>;
}
interface Projection {
  readonly source: readonly Sample[];
  readonly length: number;
  readonly placements: readonly Placement[];
}

const cache = new WeakMap<HarnessDesignDocument, ReadonlyMap<string, Projection>>();
const nodeCache = new WeakMap<HarnessDesignDocument, ReadonlyMap<string,Point>>();
const mix = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

function at(samples: readonly Sample[], fraction: number): Point {
  if (fraction <= samples[0]!.fraction) return samples[0]!.point;
  const index = samples.findIndex(p => p.fraction >= fraction);
  if (index < 0) return samples.at(-1)!.point;
  const a = samples[index - 1]!, b = samples[index]!;
  return mix(a.point, b.point, (fraction - a.fraction) / (b.fraction - a.fraction || 1));
}

function offsetAt(samples: readonly Sample[], fraction: number, offset: number): Point {
  const point = at(samples, fraction);
  const a = at(samples, Math.max(0, fraction - .00001)), b = at(samples, Math.min(1, fraction + .00001));
  const length = distance(a, b) || 1;
  return { x: point.x - (b.y - a.y) / length * offset, y: point.y + (b.x - a.x) / length * offset };
}

/** An immutable document owns its display cache. No pixel-to-mm or
 * display-to-topology write occurs here. Split continuations share one axis. */
function projections(document: HarnessDesignDocument): ReadonlyMap<string, Projection> {
  const cached = cache.get(document); if (cached) return cached;
  const result = new Map<string, Projection>();
  const topology = document.physicalTopology, coverings = topology?.coverings ?? [];
  if (!topology || !coverings.some(c => c.bundle)) { cache.set(document, result); return result; }
  const sections = pipeBundleSections(document), radius = drawingBendRadius(document);
  const routes = new Map(topology.segments.map(segment => {
    const points = physicalSegmentPoints(document, segment), length = pathLength(points);
    return [segment.id, { length, samples: drawingRouteSamples(points, radius).map(s => ({ point: s.point, fraction: length ? s.distance / length : 0 })) }] as const;
  }));
  const chains = new Map<string, Chain>();
  function chain(ids: readonly string[]): Chain {
    const key = JSON.stringify(ids), existing = chains.get(key); if (existing) return existing;
    const lengths = ids.map(id => routes.get(id)!.length), length = lengths.reduce((a, b) => a + b, 0);
    let before = 0;
    const samples = ids.flatMap((id, i) => {
      const points = routes.get(id)!.samples.map(s => ({ point: s.point, fraction: (before + s.fraction * lengths[i]!) / (length || 1) }));
      before += lengths[i]!; return i ? points.slice(1) : points;
    });
    const value = { ids, lengths, length, samples }; chains.set(key, value); return value;
  }
  function memberChains(members: readonly PipeBundleMember[]): Chain[] {
    return members.flatMap(m => m.kind === "segment" ? [chain(pipeMemberSegments(m))]
      : memberChains(coverings.find(c => c.id === m.id)!.bundle!.members));
  }
  function ancestors(id: string): Set<string> {
    const parents = coverings.filter(c => c.bundle?.members.some(m => m.kind === "covering" && m.id === id));
    return new Set(parents.flatMap(p => [p.id, ...ancestors(p.id)]));
  }
  for (const covering of coverings) {
    if (!covering.bundle) continue;
    const section = sections.get(covering.id)!, members = memberChains(covering.bundle.members);
    const axes = [...new Set(covering.spans.map(s => members.find(c => c.ids.includes(s.segmentId))!))];
    for (const axis of axes) {
      if (!axis.length) continue;
      const ranges = covering.spans.filter(s => axis.ids.includes(s.segmentId)).map(s => {
        const index = axis.ids.indexOf(s.segmentId), before = axis.lengths.slice(0, index).reduce((a, b) => a + b, 0);
        const resolved = resolvedCoveringSpan(document, s);
        return { start: (before + resolved.from * axis.lengths[index]!) / axis.length, end: (before + resolved.to * axis.lengths[index]!) / axis.length };
      }).sort((a, b) => a.start - b.start);
      const intervals: { start: number; end: number }[] = [];
      for (const range of ranges) {
        const previous = intervals.at(-1);
        if (previous && range.start <= previous.end + 1e-7) previous.end = Math.max(previous.end, range.end);
        else intervals.push({ ...range });
      }
      for (const member of members) {
        if (!member.length) continue;
        const direct = distance(at(axis.samples, 0), at(member.samples, 0)) + distance(at(axis.samples, 1), at(member.samples, 1));
        const reverse = member !== axis && distance(at(axis.samples, 0), at(member.samples, 1)) + distance(at(axis.samples, 1), at(member.samples, 0)) < direct;
        for (const id of member.ids) {
          const own = section.leafOffsets.get(id)!;
          // A nested shell uses its group centre, never the axis of one leaf.
          const groupOffsets = new Map([...sections].flatMap(([groupId, child]) => {
            const leaf = child.leafOffsets.get(id);
            return leaf && ancestors(groupId).has(covering.id) ? [[groupId, own.offset - leaf.offset] as const] : [];
          }));
          const source = routes.get(id)!, previous = result.get(id);
          const additions = intervals.map(interval => ({ coveringId: covering.id, ancestors: ancestors(covering.id), axis, chain: member,
            ...interval, reverse, offset: own.offset, depth: own.depth, leafCount: section.leafOffsets.size, groupOffsets }));
          result.set(id, { source: source.samples, length: source.length, placements: [...previous?.placements ?? [], ...additions] });
        }
      }
    }
  }
  for (const [id, value] of result) result.set(id, { ...value, placements: [...value.placements].sort((a, b) => a.leafCount - b.leafCount || a.coveringId.localeCompare(b.coveringId)) });
  cache.set(document, result); return result;
}

function chainFraction(p: Placement, id: string, fraction: number): number {
  const index = p.chain.ids.indexOf(id), before = p.chain.lengths.slice(0, index).reduce((a, b) => a + b, 0);
  const t = (before + fraction * p.chain.lengths[index]!) / p.chain.length;
  return p.reverse ? 1 - t : t;
}
function localFraction(p: Placement, id: string, fraction: number): number {
  const index = p.chain.ids.indexOf(id), before = p.chain.lengths.slice(0, index).reduce((a, b) => a + b, 0);
  return ((p.reverse ? 1 - fraction : fraction) * p.chain.length - before) / p.chain.lengths[index]!;
}
const transition = (p: Placement) => Math.min(.08, (p.end - p.start) / 3);
function weight(p: Placement, t: number): number {
  // Preserve endpoints while converging before, not inside, the sleeve.
  const lo = Math.max(0, p.start - transition(p)), hi = Math.min(1, p.end + transition(p));
  if (t <= lo || t >= hi) return 0;
  return Math.max(0, Math.min(1, (t - lo) / (p.start - lo || .001), (hi - t) / (hi - p.end || .001)));
}
function eligible(p: Placement, coveringId?: string): boolean {
  return !coveringId || p.coveringId !== coveringId && !p.ancestors.has(coveringId);
}

export function hasPipeBundleProjection(document: HarnessDesignDocument, segmentId: string): boolean {
  if(projections(document).has(segmentId))return true;
  const segment=document.physicalTopology?.segments.find(s=>s.id===segmentId);
  return !!segment&&(nodeDisplacements(document).has(segment.from)||nodeDisplacements(document).has(segment.to));
}

export function pipeBundleDepth(document:HarnessDesignDocument,segmentId:string):number {
  return projections(document).get(segmentId)?.placements.at(-1)?.depth??0;
}

/** Sampling stations include sleeve edges and axis bends even on straight pipes.
 * Fractions refer to the original segment, including after a split. */
export function pipeBundleProjectionStops(document: HarnessDesignDocument, segmentId: string, coveringId?: string): number[] {
  const projection = projections(document).get(segmentId); if (!projection) return [];
  return [...new Set(projection.placements.filter(p => eligible(p, coveringId)).flatMap(p =>
    [p.start - transition(p), Math.max(.001, p.start), Math.min(.999, p.end), p.end + transition(p), ...p.axis.samples.map(s => s.fraction)]
      .filter(t => t >= p.start - transition(p) && t <= p.end + transition(p))
      .map(t => localFraction(p, segmentId, t))).filter(t => t > 0 && t < 1))].sort((a, b) => a - b);
}

function rawProjectedPoint(document: HarnessDesignDocument, segmentId: string, fraction: number, point: Point, coveringId?: string): Point {
  const projection = projections(document).get(segmentId); if (!projection) return point;
  const source = at(projection.source, fraction);
  let result = source;
  for (const placement of projection.placements) {
    if (!eligible(placement, coveringId)) continue;
    const t = chainFraction(placement, segmentId, fraction), blend = weight(placement, t);
    if (!blend) continue;
    const offset = coveringId && placement.groupOffsets.has(coveringId) ? placement.groupOffsets.get(coveringId)! : placement.offset;
    result = mix(result, offsetAt(placement.axis.samples, t, offset), blend);
  }
  return { x: point.x + (result.x - source.x), y: point.y + (result.y - source.y) };
}

/** A split creates an actual node at the join. Its visual anchor, and any
 * attached branch, follow the same displacement as the consecutive fragments. */
function nodeDisplacements(document:HarnessDesignDocument):ReadonlyMap<string,Point>{
  const cached=nodeCache.get(document);if(cached)return cached;
  const candidates=new Map<string,Point[]>(),result=new Map<string,Point>();
  for(const segment of document.physicalTopology?.segments??[]){
    const projection=projections(document).get(segment.id);if(!projection)continue;
    for(const [nodeId,fraction] of [[segment.from,0],[segment.to,1]] as const){
      const point=at(projection.source,fraction),projected=rawProjectedPoint(document,segment.id,fraction,point);
      const delta={x:projected.x-point.x,y:projected.y-point.y};
      if(Math.hypot(delta.x,delta.y)>1e-7)candidates.set(nodeId,[...candidates.get(nodeId)??[],delta]);
    }
  }
  for(const [id,deltas] of candidates)if(deltas.every(d=>distance(d,deltas[0]!)<1e-6))result.set(id,deltas[0]!);
  nodeCache.set(document,result);return result;
}

export function pipeBundleNodePoint(document:HarnessDesignDocument,nodeId:string,point:Point):Point{
  const delta=nodeDisplacements(document).get(nodeId);return delta?{x:point.x+delta.x,y:point.y+delta.y}:point;
}

export function projectPipeBundlePoint(document:HarnessDesignDocument,segmentId:string,fraction:number,point:Point,coveringId?:string):Point{
  const projected=rawProjectedPoint(document,segmentId,fraction,point,coveringId);
  if(coveringId)return projected;
  const segment=document.physicalTopology?.segments.find(s=>s.id===segmentId);if(!segment)return projected;
  const shifts=nodeDisplacements(document),source=projections(document).get(segmentId)?.source;
  let result=projected;
  for(const [nodeId,end,blend] of [[segment.from,0,Math.max(0,1-fraction/.08)],[segment.to,1,Math.max(0,1-(1-fraction)/.08)]] as const){
    const shift=shifts.get(nodeId);if(!shift||!blend)continue;
    const own=source?at(source,end):{x:0,y:0},raw=source?rawProjectedPoint(document,segmentId,end,own):own;
    result={x:result.x+(shift.x-raw.x+own.x)*blend,y:result.y+(shift.y-raw.y+own.y)*blend};
  }
  return result;
}

/** Consumers use radius=0: samples already contain circular tangent joins. */
export function pipeBundleDisplaySamples(document: HarnessDesignDocument, segmentId: string): Sample[] | undefined {
  if(!hasPipeBundleProjection(document,segmentId))return undefined;
  const projection = projections(document).get(segmentId);
  const segment=document.physicalTopology!.segments.find(s=>s.id===segmentId)!;
  const raw=projection?undefined:physicalSegmentPoints(document,segment),length=raw?pathLength(raw):0;
  const source=projection?.source??drawingRouteSamples(raw!,drawingBendRadius(document)).map(s=>({point:s.point,fraction:length?s.distance/length:0}));
  const fractions = [...new Set([...source.map(s => s.fraction), ...pipeBundleProjectionStops(document, segmentId),
    ...(nodeDisplacements(document).has(segment.from)?[.08]:[]),...(nodeDisplacements(document).has(segment.to)?[.92]:[])])].sort((a, b) => a - b);
  return fractions.map(fraction => ({ fraction, point: projectPipeBundlePoint(document, segmentId, fraction, at(source, fraction)) }));
}

/** Keep authored handle ordinals; display sampling vertices are never handles. */
export function projectPipeBundleControls(document: HarnessDesignDocument, segmentId: string, points: readonly Point[]): Point[] {
  if (!hasPipeBundleProjection(document, segmentId)) return [...points];
  const route = physicalSegmentPoints(document, document.physicalTopology!.segments.find(s => s.id === segmentId)!);
  return points.map(point => projectPipeBundlePoint(document, segmentId, projectOntoPolyline(route, point).fraction, point));
}

/** Pointer deltas act on authored vertices, not on the generated convergence
 * vertices. Keeping the original displacement prevents the first drag jumping. */
export function unprojectPipeBundleEdit(document: HarnessDesignDocument, segmentId: string, original: Point, target: Point): Point {
  if (!hasPipeBundleProjection(document, segmentId)) return target;
  const displayedOrigin=projectPipeBundleControls(document,segmentId,[original])[0]!;
  return { x: original.x + target.x - displayedOrigin.x, y: original.y + target.y - displayedOrigin.y };
}
