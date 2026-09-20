import type { HarnessDesignDocument, WireEndpoint } from "./model";

/** Electrical identity never depends on labels, geometry or a shared housing. */
export function electricalEndpointKey(endpoint: WireEndpoint): string {
  if (endpoint.junctionId) return JSON.stringify(["junction", endpoint.junctionId]);
  if (endpoint.screenId) return JSON.stringify(["screen", endpoint.screenId]);
  return JSON.stringify(["contact", endpoint.connectorId, endpoint.contactId]);
}

export function buildHarnessSelectionIndex(document: HarnessDesignDocument) {
  const wires = new Map(document.wires.map(wire => [wire.id, wire]));
  const components = new Map<string, Set<string>>();
  const endpoints = new Map<string, Set<string>>();
  const add = (map: Map<string, Set<string>>, key: string, id: string) => {
    if (!map.has(key)) map.set(key, new Set());
    map.get(key)!.add(id);
  };
  for (const wire of document.wires) for (const endpoint of [wire.from, wire.to]) {
    add(endpoints, electricalEndpointKey(endpoint), wire.id);
    add(components, endpoint.junctionId || endpoint.screenId || endpoint.connectorId, wire.id);
  }
  const known = new Set([...wires.keys(), ...document.connectors.map(c => c.id),
    ...document.junctions.map(j => j.id), ...document.screens.map(s => s.id), ...document.cables.map(c => c.id)]);
  const cables = new Map(document.cables.map(cable => [cable.id, cable.memberWireIds]));
  return { wires, components, endpoints, known, cables };
}

/** Returns visual relationships only. Never feed this result into Delete or drag. */
export function resolveHarnessSelection(index: ReturnType<typeof buildHarnessSelectionIndex>, selectedIds: readonly string[], wholeNet = false) {
  const wireIds = new Set<string>();
  const unresolvedIds: string[] = [];
  for (const id of new Set(selectedIds)) {
    if (!index.known.has(id)) { unresolvedIds.push(id); continue; }
    if (index.wires.has(id)) wireIds.add(id);
    for (const wireId of index.cables.get(id) ?? index.components.get(id) ?? []) {
      if (index.wires.has(wireId)) wireIds.add(wireId);
    }
  }
  if (wholeNet) {
    const pending = [...wireIds];
    for (let i = 0; i < pending.length; i++) {
      const wire = index.wires.get(pending[i]!)!;
      for (const endpoint of [wire.from, wire.to]) for (const id of index.endpoints.get(electricalEndpointKey(endpoint)) ?? []) {
        if (!wireIds.has(id)) { wireIds.add(id); pending.push(id); }
      }
    }
  }
  const componentIds = new Set<string>();
  for (const id of wireIds) for (const end of [index.wires.get(id)!.from, index.wires.get(id)!.to]) {
    componentIds.add(end.junctionId || end.screenId || end.connectorId);
  }
  const rowIds = new Set<string>(wireIds);
  for (const [id, members] of index.cables) if (members.some(member => wireIds.has(member))) rowIds.add(id);
  return { wireIds: [...wireIds], componentIds: [...componentIds], rowIds: [...rowIds], unresolvedIds };
}
