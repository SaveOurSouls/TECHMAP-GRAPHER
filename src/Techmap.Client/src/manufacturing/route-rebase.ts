import type { HarnessDesignDocument } from "../editor/model";
import { generateRoute } from "./route-commands";
import { parseManufacturingRoute, type ManufacturingRoute, type RouteRow } from "./route-model";
import { buildRouteSourceItems, type RouteSourceRef } from "./route-source";

const key = (ref: RouteSourceRef) => `${ref.kind}:${ref.id}`;
/** Builds a reviewable change; callers must display removals before applying it. */
export function previewRouteRebase(route: ManufacturingRoute, document: HarnessDesignDocument, fingerprint: string): {
  route: ManufacturingRoute; removed: RouteSourceRef[]; added: RouteSourceRef[];
} {
  const available = new Set(buildRouteSourceItems(document).map(item => key(item.ref)));
  const removed = new Map<string, RouteSourceRef>();
  const rows: RouteRow[] = route.rows.map(row => ({
    ...row, prepared: false,
    sourceObjects: row.sourceObjects.filter(ref => {
      if (available.has(key(ref))) return true;
      removed.set(key(ref), ref); return false;
    }),
    ...(row.terminalRequirements ? { terminalRequirements: row.terminalRequirements.filter(requirement => available.has(`wire:${requirement.wireId}`)) } : {}),
    presentation: { ...row.presentation, objects: row.presentation.objects.filter(item => available.has(key(item.ref))) },
  }));
  const introduced = new Set(rows.flatMap(row => row.sourceObjects.map(key)));
  const fresh = generateRoute(document, fingerprint).rows.filter(row => row.sourceObjects.some(ref => !introduced.has(key(ref))));
  const added = fresh.flatMap(row => row.sourceObjects);
  rows.push(...fresh.map(row => ({ ...row, id: crypto.randomUUID() })));
  return { route: parseManufacturingRoute({ ...route, source: { fingerprintVersion: 1, sha256: fingerprint }, status: "draft", rows })!, removed: [...removed.values()], added };
}
