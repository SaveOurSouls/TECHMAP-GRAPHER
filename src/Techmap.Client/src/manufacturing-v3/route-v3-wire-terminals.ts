import type { HarnessDesignDocument } from '../editor/model';
import { effectiveEndPreparation, type TerminationArtifact } from '../editor/termination-model';
import { buildRouteSourceItems, type RouteSourceItem } from '../manufacturing/route-source';

/** A terminal belongs to its wire blank; a sleeve joins blanks later in the route. */
export function routeV3WireEndArtifacts(document: HarnessDesignDocument, wireId: string, end: 'from' | 'to'): readonly TerminationArtifact[] {
  const wire = document.wires.find(w => w.id === wireId);
  if (!wire) return [];
  const preparation = effectiveEndPreparation(document, { wireId, end });
  const group = document.terminations?.groups.find(g => g.memberEnds.some(e => e.wireId === wireId && e.end === end));
  const component = document.connectors.find(c => c.id === wire[end].connectorId)?.terminationComponent;
  const ids = [group?.artifactId ?? preparation?.artifactId ?? component?.artifactId, preparation?.sealArtifactId];
  return (document.terminations?.artifacts ?? []).filter(a => a.kind !== 'sleeve' && ids.includes(a.id));
}

export function routeV3EmbeddedArtifactOwners(document: HarnessDesignDocument): ReadonlyMap<string, readonly string[]> {
  const owners = new Map<string, string[]>();
  for (const wire of document.wires) for (const end of ['from', 'to'] as const) {
    for (const artifact of routeV3WireEndArtifacts(document, wire.id, end)) {
      owners.set(artifact.id, [...new Set([...(owners.get(artifact.id) ?? []), wire.id])]);
    }
  }
  return owners;
}

/** V3 production units differ from the material BOM: do not count the end twice. */
export function buildRouteV3SourceItems(document: HarnessDesignDocument): RouteSourceItem[] {
  const embedded = routeV3EmbeddedArtifactOwners(document);
  return buildRouteSourceItems(document).filter(item => item.ref.kind !== 'termination-artifact' || !embedded.has(item.ref.id)).map(item => {
    if (item.ref.kind !== 'wire') return item;
    const label = (end: 'from' | 'to', fallback: string) => {
      const artifacts = routeV3WireEndArtifacts(document, item.ref.id, end);
      const terminal = artifacts.find(a => a.kind === 'terminal');
      return terminal ? [terminal.article.trim() || fallback || 'Наконечник', ...artifacts.filter(a => a.kind === 'seal').map(a => a.article.trim() || 'Уплотнитель')].join(' / ') : fallback;
    };
    return { ...item, terminalFrom: label('from', item.terminalFrom), terminalTo: label('to', item.terminalTo) };
  });
}
