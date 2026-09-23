import { type HarnessDesignDocument, type Point, wireEndpointE4Anchor, type E4RouteAnchor } from "./model";

/** Transient rubber-band geometry. Never put this document in history or autosave:
 * the normal move command performs obstacle-aware routing once on release. */
export function previewE4ConnectorMove(document: HarnessDesignDocument, connectorId: string, position: Point): HarnessDesignDocument {
  const moved = { ...document, connectors: document.connectors.map(connector => connector.id === connectorId
    ? { ...connector, positions: { ...connector.positions, e4: position } } : connector) };
  return { ...moved, wires: document.wires.map(wire => {
    const moveStart = wire.from.connectorId === connectorId;
    const moveEnd = wire.to.connectorId === connectorId;
    if (!moveStart && !moveEnd) return wire;
    const start = wireEndpointE4Anchor(moved, wire.from), end = wireEndpointE4Anchor(moved, wire.to);
    if (!start || !end) return wire;
    const previousStart = wireEndpointE4Anchor(document, wire.from), previousEnd = wireEndpointE4Anchor(document, wire.to);
    const spine = wire.e4Route.length ? wire.e4Route : [previousStart!.position, previousEnd!.position];
    const points = [start.position,
      ...(moveStart ? bridge(start, spine[0]!) : []), ...spine,
      ...(moveEnd ? bridge(end, spine.at(-1)!).reverse() : []), end.position];
    const unique = points.filter((point, index) => !index || point.x !== points[index - 1]!.x || point.y !== points[index - 1]!.y);
    return { ...wire, e4Route: unique.slice(1, -1) };
  }) };
}

function bridge(anchor: E4RouteAnchor, target: Point): Point[] {
  const length = Math.min(24, anchor.leadLength ?? 24);
  const horizontal = anchor.leadDirection === "left" || anchor.leadDirection === "right";
  const lead = { x: anchor.position.x + (anchor.leadDirection === "left" ? -length : anchor.leadDirection === "right" ? length : 0),
    y: anchor.position.y + (anchor.leadDirection === "up" ? -length : anchor.leadDirection === "down" ? length : 0) };
  return [lead, horizontal ? { x: lead.x, y: target.y } : { x: target.x, y: lead.y }];
}
