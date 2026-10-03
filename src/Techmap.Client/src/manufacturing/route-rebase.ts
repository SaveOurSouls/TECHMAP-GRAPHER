import type { HarnessDesignDocument } from "../editor/model";
import { generateRoute } from "./route-commands";
import { parseManufacturingRoute, type ManufacturingRoute, type RouteRow } from "./route-model";
import { buildRouteSourceItems, type RouteSourceRef } from "./route-source";
import { orderRouteRows } from "./route-order";

const key = (ref: RouteSourceRef) => `${ref.kind}:${ref.id}`;
/** Builds a reviewable change; callers must display removals before applying it. */
export function previewRouteRebase(route: ManufacturingRoute, document: HarnessDesignDocument, fingerprint: string, quantity = 1): {
  route: ManufacturingRoute; removed: RouteSourceRef[]; added: RouteSourceRef[];
} {
  const available = new Set(buildRouteSourceItems(document).map(item => key(item.ref)));
  const removed = new Map<string, RouteSourceRef>();
  const retained: RouteRow[] = route.rows.map(row => {
    const sourceObjects = row.sourceObjects.filter(ref => {
      if (available.has(key(ref))) return true;
      removed.set(key(ref), ref); return false;
    });
    return {
      ...row, prepared: false, sourceObjects,
      ...(row.components ? { components: row.components.filter(component => available.has(key(component.ref))) } : {}),
      ...(row.assemblyInputs ? { assemblyInputs: row.assemblyInputs.filter(input => input.kind !== "source" || available.has(key(input.ref))) } : {}),
      ...(row.terminalRequirements ? { terminalRequirements: row.terminalRequirements.filter(requirement => available.has(`wire:${requirement.wireId}`)) } : {}),
      ...(row.wireBlankSelections ? { wireBlankSelections: row.wireBlankSelections.filter(selection => available.has(`wire:${selection.wireId}`)) } : {}),
      presentation: { ...row.presentation, objects: row.presentation.objects.filter(item => available.has(key(item.ref))) },
    };
  }).filter((row, index) => row.kind === "assembly" || row.sourceObjects.length > 0 || route.rows[index]!.sourceObjects.length === 0);
  const retainedIds = new Set(retained.map(row => row.id));
  const rows: RouteRow[] = retained.map(row => ({ ...row,
    dependsOn: row.dependsOn.filter(id => retainedIds.has(id)),
    ...(row.assemblyInputs ? { assemblyInputs: row.assemblyInputs.filter(input => input.kind !== "row" || retainedIds.has(input.rowId)) } : {}),
  }));
  const introduced = new Set(rows.flatMap(row => row.sourceObjects.map(key)));
  const fresh = generateRoute(document, fingerprint, quantity).rows.filter(row => row.sourceObjects.some(ref => !introduced.has(key(ref))));
  const added = fresh.flatMap(row => row.sourceObjects);
  const usedIndices = new Set(rows.map(row => row.index).filter(Boolean));
  let nextIndex = 1;
  rows.push(...fresh.map(row => {
    while (usedIndices.has(`ПФ-${String(nextIndex).padStart(2, "0")}`)) nextIndex++;
    const index = `ПФ-${String(nextIndex++).padStart(2, "0")}`;
    usedIndices.add(index);
    return { ...row, id: crypto.randomUUID(), index };
  }));
  return { route: parseManufacturingRoute({ ...route, source: { fingerprintVersion: 1, sha256: fingerprint }, status: "draft", rows: orderRouteRows(rows, document) })!, removed: [...removed.values()], added };
}
