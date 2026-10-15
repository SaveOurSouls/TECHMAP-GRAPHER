import type { HarnessDesignDocument } from "../editor/model";
import type { RouteSourceRef } from "../manufacturing/route-source";
import { routeV3SourceGroupKey, routeV3WireArtworkOverride, setRouteV3WireArtworkOverride, type RouteV3Document, type RouteV3WireArtworkOverride } from "./route-v3-model";
import { routeV3WireArtwork } from "./route-v3-wire-artwork";

export function routeV3CompositionGroups(refs: readonly RouteSourceRef[], source: HarnessDesignDocument, graph: RouteV3Document): readonly (readonly RouteSourceRef[])[] {
  const groups = new Map<string, RouteSourceRef[]>();
  for (const ref of refs) {
    const view = ref.kind === "wire" ? routeV3WireArtwork(source, ref.id, routeV3WireArtworkOverride(graph, ref.id)) : null;
    const key = JSON.stringify([routeV3SourceGroupKey(ref, source), view && [view.start, view.end, view.color]]);
    groups.set(key, [...(groups.get(key) ?? []), ref]);
  }
  return [...groups.values()];
}

export function setRouteV3GroupArtwork(graph: RouteV3Document, wireIds: readonly string[], patch: Omit<RouteV3WireArtworkOverride, "wireId">): RouteV3Document {
  return [...new Set(wireIds)].reduce((result, wireId) => setRouteV3WireArtworkOverride(result, { ...(routeV3WireArtworkOverride(result, wireId) ?? { wireId }), ...patch, wireId }), graph);
}
