import type { RouteSourceItem } from "./route-source";
import type { RouteOperation } from "./route-model";
import { wireBlankDraft, type WireBlank, type WireBlankEnd } from "../WireBlankCatalog";
import type { ReferenceCatalogSnapshot } from "../reference-catalog-api";

export interface WireBlankMatch {
  readonly entry: WireBlank | null;
  readonly expected: { readonly start: WireBlankEnd; readonly end: WireBlankEnd };
  readonly reason: "exact" | "ambiguous" | "missing";
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
