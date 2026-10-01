import { connectorContactPosition, type HarnessDesignDocument, type Point } from "./model";
import type { PhysicalDirection, PhysicalNode } from "./physical-topology-model";
import { drawingLocalPoint, drawingPointToLocal } from "./drawing-scale";
import { selectMaterializedContactRepresentation } from "./materialized-contact-representation";
import { directionTowards } from "./pipe-routing";

export function physicalNodePoint(document: HarnessDesignDocument, node: PhysicalNode): Point {
  const connector = document.connectors.find(c => c.id === node.connectorId);
  if(!connector)return node.position;
  const point=drawingLocalPoint(node.position,connector.drawingPlacements),origin=connector.positions.drawing;
  return {x:origin.x+point.x,y:origin.y+point.y};
}

export function physicalNodeLocalPoint(document:HarnessDesignDocument,node:PhysicalNode,world:Point):Point {
 const connector=document.connectors.find(c=>c.id===node.connectorId);
 return connector?drawingPointToLocal({x:world.x-connector.positions.drawing.x,y:world.y-connector.positions.drawing.y},connector.drawingPlacements):world;
}

const directions: Record<PhysicalDirection, Point> = {
  right: { x: 1, y: 0 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, up: { x: 0, y: -1 },
};
/** Directions are local to the connector and rotate with its drawing. */
function worldDirection(document: HarnessDesignDocument, node: PhysicalNode, direction: PhysicalDirection): Point {
  const connector = document.connectors.find(c => c.id === node.connectorId);
  const vector = drawingLocalPoint(directions[direction], connector?.drawingPlacements);
  const length = Math.hypot(vector.x, vector.y);
  return { x: vector.x / length, y: vector.y / length };
}

export function physicalNodeDirection(document: HarnessDesignDocument, node: PhysicalNode, target?: Point): Point | null {
  if (node.direction) return worldDirection(document, node, node.direction);
  const connector = document.connectors.find(c => c.id === node.connectorId);
  const representations = connector?.contacts.flatMap(c => {
    const r = selectMaterializedContactRepresentation(connector, c.id, "drawing");
    return r ? [r] : [];
  }) ?? [];
  // A common port materializes as the same drawing point for all its contacts.
  const common = representations[0];
  if (common && representations.every(r => r.x === common.x && r.y === common.y && r.direction === common.direction))
    return worldDirection(document, node, common.direction);
  if (connector) return worldDirection(document, node, connector.schematic.orientation === "contacts-left" ? "left" : "right");
  return target ? directionTowards(physicalNodePoint(document, node), target) : null;
}

/** Visual direction of a connector exit: its marker faces the attached contacts.
 * Routing still uses the independent outward tangent from physicalNodeDirection. */
export function physicalNodeFacingDirection(document: HarnessDesignDocument, node: PhysicalNode, target?: Point): Point | null {
  if (!node.connectorId) return physicalNodeDirection(document, node, target);
  const connector = document.connectors.find(candidate => candidate.id === node.connectorId);
  const routedWireIds = document.physicalTopology?.routes.flatMap(route => {
    const first = route.steps[0], last = route.steps.at(-1);
    const touches = [first && document.physicalTopology?.segments.find(segment => segment.id === first.segmentId),
      last && document.physicalTopology?.segments.find(segment => segment.id === last.segmentId)]
      .some(segment => segment?.from === node.id || segment?.to === node.id);
    return touches ? [route.wireId] : [];
  }) ?? [];
  const wireIds = node.wireIds ?? (routedWireIds.length ? routedWireIds : undefined);
  const contactIds = new Set(document.wires.filter(wire => !wireIds || wireIds.includes(wire.id)).flatMap(wire =>
    [wire.from, wire.to].flatMap(end => end.connectorId === node.connectorId ? [end.contactId] : [])));
  const points = connector?.contacts.filter(contact => contactIds.has(contact.id))
    .flatMap(contact => {
      const point = connectorContactPosition(connector, contact.id, "drawing");
      return point ? [point] : [];
    }) ?? [];
  if (points.length) {
    const center = points.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 });
    const origin = physicalNodePoint(document, node);
    const x = center.x / points.length - origin.x, y = center.y / points.length - origin.y;
    const length = Math.hypot(x, y);
    if (length > 1e-6) return { x: x / length, y: y / length };
  }
  const outward = physicalNodeDirection(document, node, target);
  return outward ? { x: -outward.x, y: -outward.y } : null;
}

export function physicalNodeContactDirection(document: HarnessDesignDocument, node: PhysicalNode, contactId: string): Point | null {
  const connector = document.connectors.find(c => c.id === node.connectorId);
  const direction = node.contactDirections?.[contactId] ?? (connector && selectMaterializedContactRepresentation(connector, contactId, "drawing")?.direction);
  return direction ? worldDirection(document, node, direction) : physicalNodeDirection(document, node);
}
