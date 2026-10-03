import type { DiffPairGroup, HarnessDesignDocument, Point } from "./model";
import { commonParallelSpan, parallelSpanLocal, parallelSpanWorld } from "./e4-parallel-spans";
import { drawingPhysicalScale, drawingWireWidth, segmentWireLanes } from "./drawing-thickness";

export interface TwistedPairStroke { readonly points: readonly Point[]; readonly width: number; readonly radius?: number }
export interface TwistedPairPath { readonly path: Point[]; readonly strokes: TwistedPairStroke[] }

function twistRuns(
  length: number,
  pitch: number,
  center: (distance: number) => Point,
  normal: (distance: number) => Point,
  middle: number,
  halfGap: number,
  width: number,
  firstWire: boolean,
  variant: 1 | 2,
): TwistedPairPath | null {
  if (length < Math.max(16, pitch * .8) || Math.abs(halfGap) < 1e-6) return null;
  const turns = Math.max(1, Math.round(length / Math.max(16, pitch)));
  const period = length / turns;
  const gapHalf = Math.min(period / 14, width * .35 + .2);
  const gaps: { start: number; end: number }[] = [];
  for (let crossing = 0; crossing < turns * 2; crossing++) {
    if ((crossing % 2 === 0) !== firstWire) continue;
    const at = (crossing / 2 + .25) * period;
    gaps.push({ start: at - gapHalf, end: at + gapHalf });
  }
  const pointAt = (distance: number): Point => {
    const phase = distance / period * Math.PI * 2;
    const wave = variant === 2 ? 2 / Math.PI * Math.asin(Math.cos(phase)) : Math.cos(phase);
    const offset = middle + (firstWire ? halfGap : -halfGap) * wave;
    const p = center(distance), n = normal(distance);
    return { x: p.x + n.x * offset, y: p.y + n.y * offset };
  };
  const sample = (start: number, end: number): Point[] => {
    const count = Math.max(1, Math.ceil((end - start) / Math.min(3, period / 16)));
    return Array.from({ length: count + 1 }, (_, index) => pointAt(start + (end - start) * index / count));
  };
  const strokes: TwistedPairStroke[] = [];
  let from = 0;
  for (const gap of gaps) {
    if (gap.start > from) strokes.push({ points: sample(from, gap.start), width, radius: 0 });
    from = gap.end;
  }
  if (from < length) strokes.push({ points: sample(from, length), width, radius: 0 });
  return { path: sample(0, length), strokes };
}

export function physicalTwistedPairPath(
  document: HarnessDesignDocument,
  segmentId: string,
  wireId: string,
  centerline: readonly Point[],
): TwistedPairPath | null {
  const group = document.diffPairs.find(pair => pair.wireIds.includes(wireId));
  if (!group || centerline.length < 2) return null;
  if (!group.wireIds.every(id => document.physicalTopology?.routes.some(route =>
    route.wireId === id && route.steps.some(step => step.segmentId === segmentId)))) return null;
  const lanes = segmentWireLanes(document, segmentId);
  const first = lanes.find(lane => lane.id === group.wireIds[0]);
  const second = lanes.find(lane => lane.id === group.wireIds[1]);
  if (!first || !second) return null;
  const middle = (first.offset + second.offset) / 2;
  const halfGap = Math.abs(first.offset - second.offset) > 1e-6
    ? (first.offset - second.offset) / 2
    : (first.width + second.width) / 4 + .5;
  const lengths = [0];
  for (let index = 1; index < centerline.length; index++) {
    const a = centerline[index - 1]!, b = centerline[index]!;
    lengths.push(lengths.at(-1)! + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const length = lengths.at(-1)!;
  const frame = (distance: number) => {
    const next = lengths.findIndex(value => value > distance);
    const index = next < 0 ? centerline.length - 2 : Math.max(0, next - 1);
    const a = centerline[index]!, b = centerline[index + 1]!;
    const leg = lengths[index + 1]! - lengths[index]! || 1;
    const t = Math.max(0, Math.min(1, (distance - lengths[index]!) / leg));
    return { point: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t },
      normal: { x: -(b.y - a.y) / leg, y: (b.x - a.x) / leg } };
  };
  const wire = document.wires.find(item => item.id === wireId)!;
  return twistRuns(length, group.step * drawingPhysicalScale(document), distance => frame(distance).point,
    distance => frame(distance).normal, middle, halfGap, drawingWireWidth(document, wire),
    wireId === group.wireIds[0], group.variant);
}

export function freeTwistedPairPaths(
  group: DiffPairGroup,
  wires: readonly { id: string; points: readonly Point[]; width: number }[],
  physicalScale = 1,
): ReadonlyMap<string, TwistedPairPath> {
  const span = commonParallelSpan(wires);
  if (!span || span.end - span.start < Math.max(16, group.step * physicalScale * .8)) return new Map();
  const firstCross = parallelSpanLocal(span, span.segmentByWireId[group.wireIds[0]]!.start).y;
  const secondCross = parallelSpanLocal(span, span.segmentByWireId[group.wireIds[1]]!.start).y;
  const middle = (firstCross + secondCross) / 2;
  const halfGap = Math.abs(firstCross - secondCross) > 1e-6
    ? (firstCross - secondCross) / 2
    : (wires[0]!.width + wires[1]!.width) / 4 + .5;
  return new Map(wires.flatMap(wire => {
    const segment = span.segmentByWireId[wire.id];
    if (!segment) return [];
    const twisted = twistRuns(span.end - span.start, group.step * physicalScale,
      distance => parallelSpanWorld(span, span.start + distance, 0),
      () => span.direction ? { x: -span.direction.y, y: span.direction.x }
        : span.orientation === "horizontal" ? { x: 0, y: 1 } : { x: 1, y: 0 },
      middle, halfGap, wire.width, wire.id === group.wireIds[0], group.variant);
    if (!twisted) return [];
    const forward = parallelSpanLocal(span, segment.start).x < parallelSpanLocal(span, segment.end).x;
    const path = forward ? twisted.path : [...twisted.path].reverse();
    const before = wire.points.slice(0, segment.index + 1);
    const after = wire.points.slice(segment.index + 1);
    const full = [...before, ...path, ...after];
    const runs = forward ? twisted.strokes : [...twisted.strokes].reverse().map(stroke => ({ ...stroke, points: [...stroke.points].reverse() }));
    const strokes: TwistedPairStroke[] = [
      ...(before.length ? [{ width: wire.width, points: [...before, path[0]!] }] : []),
      ...runs,
      ...(after.length ? [{ width: wire.width, points: [path.at(-1)!, ...after] }] : []),
    ];
    return [[wire.id, { path: full, strokes }]] as const;
  }));
}
