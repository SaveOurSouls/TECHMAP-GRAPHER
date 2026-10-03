import type { HarnessDesignDocument } from "../editor/model";
import { coveringKind } from "../editor/physical-coverings";
import type { RouteSourceRef } from "./route-source";
import type { RouteRow } from "./route-model";

/** Production order of source blanks; assemblies always follow every source blank. */
export function routeSourceRank(ref: RouteSourceRef, document: HarnessDesignDocument): number {
  if (ref.kind === "wire" || ref.kind === "cable") return 0;
  if (ref.kind !== "covering") return 4;
  const covering = document.physicalTopology?.coverings?.find(item => item.id === ref.id);
  if (!covering) return 4;
  const kind = coveringKind(covering);
  return kind === "nylon" || kind === "braid" || kind === "metal-braid" ? 1
    : kind === "heat-shrink" ? 2 : 3;
}

export function orderRouteRows(rows: readonly RouteRow[], document: HarnessDesignDocument): RouteRow[] {
  return rows.map((row, index) => ({ row, index })).sort((a, b) => {
    const rank = (row: RouteRow) => row.kind === "assembly" ? 5
      : Math.min(4, ...row.sourceObjects.map(ref => routeSourceRank(ref, document)));
    return rank(a.row) - rank(b.row) || a.index - b.index;
  }).map(item => item.row);
}
