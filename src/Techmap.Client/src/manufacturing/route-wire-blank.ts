import type { RouteSourceItem } from "./route-source";
import type { RouteOperation } from "./route-model";
import type { ManufacturingRoute, RouteRow } from "./route-model";
import { routeRowComposition } from "./route-model";
import { wireBlankDraft, type WireBlank, type WireBlankEnd } from "../WireBlankCatalog";
import type { ReferenceCatalogSnapshot } from "../reference-catalog-api";

export interface WireBlankMatch {
  readonly entry: WireBlank | null;
  readonly expected: { readonly start: WireBlankEnd; readonly end: WireBlankEnd };
  readonly reason: "exact" | "ambiguous" | "missing";
}

export interface InheritedWireEndStyle {
  readonly from: WireBlankEnd;
  readonly to: WireBlankEnd;
}

/**
 * Resolves the end treatment visible when a route drawing is opened.  A
 * drawing explicitly edited by an operator wins over a pinned semi-finished
 * snapshot, which wins over the operation-derived default.  Ancestors are
 * traversed by distance so a nearer prepared stage wins at a DAG merge.
 */
export function routeInheritedEndStyles(
  route: ManufacturingRoute,
  rowId: string,
  sources: readonly RouteSourceItem[],
): ReadonlyMap<string, InheritedWireEndStyle> {
  const target = route.rows.find(row => row.id === rowId);
  if (!target) return new Map();
  const composition = new Set(routeRowComposition(route, rowId).filter(ref => ref.kind === "wire").map(ref => ref.id));
  const distances = new Map<string, number>([[rowId, 0]]);
  const queue = [rowId];
  while (queue.length) {
    const id = queue.shift()!;
    const distance = distances.get(id)!;
    const row = route.rows.find(candidate => candidate.id === id);
    for (const parentId of row?.dependsOn ?? []) {
      if (!distances.has(parentId)) { distances.set(parentId, distance + 1); queue.push(parentId); }
    }
  }
  const candidates = route.rows
    .filter(row => row.id === rowId || (row.prepared && distances.has(row.id)))
    .sort((a, b) => (distances.get(a.id)! - distances.get(b.id)!) || route.rows.indexOf(a) - route.rows.indexOf(b));
  const result = new Map<string, InheritedWireEndStyle>();
  const candidateWires = new Map(candidates.map(row => [row.id, new Set(routeRowComposition(route, row.id).filter(ref => ref.kind === "wire").map(ref => ref.id))]));
  const setIfAbsent = (wireId: string, style: InheritedWireEndStyle) => { if (composition.has(wireId) && !result.has(wireId)) result.set(wireId, style); };
  const explicit = (row: RouteRow, wireId: string): InheritedWireEndStyle | undefined => {
    for (const copy of [row.presentation.isolatedDrawingCopy, row.presentation.drawingCopy]) {
      const styles = copy?.document.wires.find(wire => wire.id === wireId)?.drawingEndStyles;
      if (styles) return { from: styles.from, to: styles.to };
    }
    return undefined;
  };
  for (const row of candidates) {
    for (const wireId of composition) {
      if (!candidateWires.get(row.id)!.has(wireId)) continue;
      const style = explicit(row, wireId);
      if (style) setIfAbsent(wireId, style);
    }
  }
  for (const row of candidates) {
    for (const selection of row.wireBlankSelections ?? []) {
      if (row.kind !== "semiFinished" || !candidateWires.get(row.id)!.has(selection.wireId)) continue;
      setIfAbsent(selection.wireId, { from: selection.binding.visual.start as WireBlankEnd, to: selection.binding.visual.end as WireBlankEnd });
    }
  }
  for (const row of candidates) {
    for (const item of sources) {
      if (item.ref.kind !== "wire" || !composition.has(item.ref.id) || !row.sourceObjects.some(ref => ref.kind === "wire" && ref.id === item.ref.id)) continue;
      const expected = wireBlankEndStates(item, row.operations);
      setIfAbsent(item.ref.id, { from: expected.start, to: expected.end });
    }
  }
  // A composed assembly may not list the inherited wire in sourceObjects;
  // derive its final automatic treatment from the current stage as a fallback.
  for (const item of sources) {
    if (item.ref.kind === "wire" && composition.has(item.ref.id) && !result.has(item.ref.id)) {
      const expected = wireBlankEndStates(item, target.operations);
      setIfAbsent(item.ref.id, { from: expected.start, to: expected.end });
    }
  }
  return result;
}

export function wireBlankEndStates(item: RouteSourceItem, operations: readonly RouteOperation[]): { start: WireBlankEnd; end: WireBlankEnd } {
  const modes = new Set(operations.map(operation => operation.mode));
  const prepared = (side: "from" | "to"): WireBlankEnd => {
    const strip = side === "from" ? modes.has("strip-from") || modes.has("cut-strip-from") : modes.has("strip-to") || modes.has("cut-strip-to");
    const both = modes.has("strip-both") || modes.has("cut-strip-both");
    const terminal = side === "from" ? item.terminalFrom : item.terminalTo;
    if (modes.has("cut-crimp") && terminal.trim()) return "terminal";
    if (modes.has("tin") && (strip || both || Boolean(item.stripProfiles?.[side]))) return "tin";
    if (strip || both || item.stripProfiles?.[side]) return "copper";
    return "cut";
  };
  return { start: prepared("from"), end: prepared("to") };
}

export function matchWireBlank(snapshot: ReferenceCatalogSnapshot | null, item: RouteSourceItem, operations: readonly RouteOperation[]): WireBlankMatch {
  const expected = wireBlankEndStates(item, operations);
  const matching = wireBlankDraft(snapshot).filter(entry => entry.start === expected.start && entry.end === expected.end);
  return { entry: matching.length === 1 ? matching[0]! : null, expected, reason: matching.length === 1 ? "exact" : matching.length > 1 ? "ambiguous" : "missing" };
}
