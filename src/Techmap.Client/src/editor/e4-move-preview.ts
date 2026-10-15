import { wireEndpointE4Anchor, type HarnessDesignDocument, type Point } from './model';
import { orthogonalE4Deformation, followE4Junctions, movedE4Junctions, moveE4Ends, preserveE4Leads, resolveE4JunctionMoves } from './e4-editing';
import type { PhysicalDragMode } from './physical-editing';

/** Presentation only: no commands, route search, validation or physical reconciliation.
 * Always derive a frame from the committed document; pointer-up uses the real command.
 * Temporary leads may cross obstacles while the pointer is moving.
 */
export function previewE4ConnectorMove(
  document: HarnessDesignDocument, connectorId: string, position: Point,
  mode: PhysicalDragMode = 'carry',
): HarnessDesignDocument {
  const connector = document.connectors.find(c => c.id === connectorId);
  if (!connector || !Number.isFinite(position.x) || !Number.isFinite(position.y)) return document;
  if (position.x === connector.positions.e4.x && position.y === connector.positions.e4.y) return document;
  const moved = { ...document, connectors: document.connectors.map(c => c === connector
    ? { ...c, positions: { ...c.positions, e4: position } } : c) };
  const proposals = new Map<string, ReadonlyMap<string, Point>>();
  const owners = new Set<string>();
  const wires = document.wires.map(wire => {
    if (![wire.from, wire.to].some(e => e.connectorId === connectorId) ||
        [wire.from, wire.to].some(e => e.screenId)) return wire;
    const a = wireEndpointE4Anchor(document, wire.from), b = wireEndpointE4Anchor(document, wire.to);
    const start = wireEndpointE4Anchor(moved, wire.from), end = wireEndpointE4Anchor(moved, wire.to);
    if (!a || !b || !start || !end) return wire;
    const original = [a.position, ...wire.e4Route, b.position];
    const raw = moveE4Ends(original, start.position, end.position, mode);
    const baseline=moveE4Ends(original,a.position,b.position,mode);
    const geometry=document.views.e4.e4RoutingMode!=="angular"?orthogonalE4Deformation(baseline,raw,start,end,mode):null;
    proposals.set(wire.id, movedE4Junctions(document, wire.id,baseline,geometry?.vertices??raw,geometry?.segments,geometry?.points));
    owners.add(wire.id);
    return { ...wire, e4Route: (geometry?.points??preserveE4Leads(raw, start, end)).slice(1, -1) };
  });
  const positions = resolveE4JunctionMoves(document, proposals);
  // A branch can have both the moved connector and a moved carrier as endpoints.
  // Let the shared-junction helper apply both changes from the original geometry.
  for (const wire of wires) if ([wire.from, wire.to].some(e => e.junctionId && positions.has(e.junctionId)))
    owners.delete(wire.id);
  let preview = positions.size ? followE4Junctions(document, { ...moved, wires }, positions, owners, mode)
    : { ...moved, wires };
  // Screen ports follow the newly displayed member routes. Do this last so their
  // branches have current endpoints without invoking the obstacle-aware router.
  preview = { ...preview, wires: preview.wires.map(wire => {
    if (![wire.from, wire.to].some(e => e.screenId)) return wire;
    const a = wireEndpointE4Anchor(document, wire.from), b = wireEndpointE4Anchor(document, wire.to);
    const start = wireEndpointE4Anchor(preview, wire.from), end = wireEndpointE4Anchor(preview, wire.to);
    if (!a || !b || !start || !end ||
        a.position.x === start.position.x && a.position.y === start.position.y &&
        b.position.x === end.position.x && b.position.y === end.position.y) return wire;
    return { ...wire, e4Route: preserveE4Leads(moveE4Ends(
      [a.position, ...wire.e4Route, b.position], start.position, end.position, mode), start, end).slice(1, -1) };
  }) };
  return preview;
}
