import {
  type HarnessDesignDocument,
  wireEndpointE4Anchor,
  type Point,
  validateE4Polyline,
  defaultE4WireLead,
} from "./model";
import { commonHorizontalPairSpan } from "./e4-parallel-spans";
import { screenJunctionEnds, validateE4WireIds, simplifyE4IntermediateRoute } from "./command-e4-analysis";

/**
 * Bring an automatically routed differential pair onto the same compact
 * lanes that the E4 motif uses. The transformation is deliberately limited
 * to the common parallel segment and is kept only when the regular route
 * validator accepts the resulting conductors.
 */
export function compactAutomaticDifferentialPairs(
  document: HarnessDesignDocument,
  routedWireIds: readonly string[],
): HarnessDesignDocument {
  const routed = new Set(routedWireIds);
  let result = document;
  for (const group of document.diffPairs) {
    if (!group.wireIds.every(id => routed.has(id))) continue;
    if (group.wireIds.some(id => result.wires.find(wire => wire.id === id)?.drawingEndpoints)) continue;
    const planned = planHorizontalDifferentialPair(result, group.wireIds);
    if (planned) { result = planned; continue; }
    const wires = group.wireIds.map(id => result.wires.find(wire => wire.id === id));
    if (wires.some(wire => !wire)) continue;
    const paths = wires.map(wire => {
      const start = wireEndpointE4Anchor(result, wire!.from)?.position;
      const end = wireEndpointE4Anchor(result, wire!.to)?.position;
      return start && end ? { id: wire!.id, points: [start, ...wire!.e4Route, end] } : null;
    });
    if (paths.some(path => !path)) continue;
    const span = commonHorizontalPairSpan(paths as { id: string; points: readonly Point[] }[]);
    // A differential pair is a horizontal bundle. Oblique/vertical spans are
    // valid ordinary wire geometry, but they are not candidates for the pair
    // planner and must not produce a rotated X decoration.
    if (!span || span.direction || span.orientation !== "horizontal" || span.crossMaximum - span.crossMinimum <= 24 + 1e-6) continue;
    const targetGap = 24;
    const center = (span.crossMinimum + span.crossMaximum) / 2;
    const targets = new Map(group.wireIds.map((id, index) => [id, center + (index === 0 ? -targetGap / 2 : targetGap / 2)]));
    const nextWires = result.wires.map(wire => {
      const target = targets.get(wire.id);
      const segment = span.segmentByWireId[wire.id];
      if (target === undefined || !segment) return wire;
      const start = wireEndpointE4Anchor(result, wire.from)?.position;
      const end = wireEndpointE4Anchor(result, wire.to)?.position;
      if (!start || !end) return wire;
      const full = [start, ...wire.e4Route, end];
      const segmentEnd=segment.endIndex??segment.index+1;
      const p0 = full[segment.index]!, p1 = full[segmentEnd]!;
      const along = (point: Point) => span.orientation === "horizontal" ? point.x : point.y;
      const cross = (point: Point) => span.orientation === "horizontal" ? point.y : point.x;
      const axis0 = along(p0), axis1 = along(p1), direction = axis1 >= axis0 ? 1 : -1;
      const lo = Math.max(Math.min(axis0, axis1), span.start), hi = Math.min(Math.max(axis0, axis1), span.end);
      if (hi - lo <= 1e-6) return wire;
      const axisValues = direction > 0 ? [axis0, lo, hi, axis1] : [axis0, hi, lo, axis1];
      const world = (axis: number, crossValue: number): Point => span.orientation === "horizontal"
        ? { x: axis, y: crossValue } : { x: crossValue, y: axis };
      const replacement = axisValues.map((axis, index) => world(axis, index === 1 || index === 2 ? target : cross(p0)));
      const next = [...full.slice(0, segment.index), ...replacement, ...full.slice(segmentEnd + 1)];
      const compacted = next.filter((point, index) => index === 0 || Math.hypot(point.x - next[index - 1]!.x, point.y - next[index - 1]!.y) > 1e-7);
      try {
        const compactStart = wireEndpointE4Anchor(result, wire.from)!;
        const compactEnd = wireEndpointE4Anchor(result, wire.to)!;
        validateE4Polyline(compactStart, compacted.slice(1, -1), compactEnd,
          screenJunctionEnds(wire) ? 0 : defaultE4WireLead);
        return { ...wire, e4Route: compacted.slice(1, -1) };
      } catch {
        return wire;
      }
    });
    const candidate = { ...result, wires: nextWires };
    // Commit the two conductors as one geometry transaction. Checking each
    // changed lane against the old position of its partner rejects a valid
    // compact pair, while accepting only one lane leaves a wide half-pair.
    try {
      for (const id of group.wireIds) validateE4WireIds(candidate, [id]);
      result = candidate;
    } catch { /* Keep the last valid pair when compact geometry is obstructed. */ }
  }
  return result;
}
function planHorizontalDifferentialPair(
  document: HarnessDesignDocument,
  wireIds: readonly [string, string],
): HarnessDesignDocument | null {
  const wires = wireIds.map(id => document.wires.find(wire => wire.id === id));
  if (wires.some(wire => !wire || wire.e4RouteMode === "manual" ||
      document.junctions.some(junction => junction.wireIds.includes(wire!.id)) ||
      document.screens.some(screen => screen.wireIds.includes(wire!.id)))) return null;
  const anchors = wires.map(wire => ({
    start: wireEndpointE4Anchor(document, wire!.from),
    end: wireEndpointE4Anchor(document, wire!.to),
  }));
  if (anchors.some(pair => !pair.start || !pair.end)) return null;
  const forward = anchors.every(pair => pair.start!.leadDirection === "right" && pair.end!.leadDirection === "left");
  const reverse = anchors.every(pair => pair.start!.leadDirection === "left" && pair.end!.leadDirection === "right");
  if (!forward && !reverse) return null;
  const direction = forward ? 1 : -1;
  const departure = forward
    ? Math.max(...anchors.map(pair => pair.start!.position.x)) + defaultE4WireLead + 4
    : Math.min(...anchors.map(pair => pair.start!.position.x)) - defaultE4WireLead - 4;
  const arrival = forward
    ? Math.min(...anchors.map(pair => pair.end!.position.x)) - defaultE4WireLead - 4
    : Math.max(...anchors.map(pair => pair.end!.position.x)) + defaultE4WireLead + 4;
  if (direction * (arrival - departure) < 48) return null;
  const ys = anchors.map(pair => pair.start!.position.y);
  const firstOnTop = ys[0]! <= ys[1]!;
  const middle = anchors.reduce((sum, pair) => sum + pair.start!.position.y + pair.end!.position.y, 0) / 4;
  const centers = [middle, ...[24, -24, 48, -48, 72, -72].map(delta => middle + delta)];
  for (const center of centers) {
    const lanes = firstOnTop ? [center - 12, center + 12] : [center + 12, center - 12];
    const candidates = wires.map((wire, index) => {
      const { start, end } = anchors[index]!;
      const lane = lanes[index]!;
      const full = [start!.position,
        { x: departure, y: start!.position.y },
        { x: departure, y: lane },
        { x: arrival, y: lane },
        { x: arrival, y: end!.position.y },
        end!.position];
      return { wire: wire!, points: simplifyE4IntermediateRoute(full[0]!, full.slice(1, -1), full.at(-1)!) };
    });
    const candidate: HarnessDesignDocument = { ...document, wires: document.wires.map(wire => {
      const planned = candidates.find(item => item.wire.id === wire.id);
      return planned ? { ...wire, e4Route: planned.points } : wire;
    }) };
    try {
      for (const id of wireIds) validateE4WireIds(candidate, [id]);
      return candidate;
    } catch { /* Try the nearest free parallel lane. */ }
  }
  return null;
}
