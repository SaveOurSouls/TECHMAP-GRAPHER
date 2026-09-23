import type { HarnessDesignDocument, Point } from "./model";
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

export function physicalNodeContactDirection(document: HarnessDesignDocument, node: PhysicalNode, contactId: string): Point | null {
  const connector = document.connectors.find(c => c.id === node.connectorId);
  const direction = node.contactDirections?.[contactId] ?? (connector && selectMaterializedContactRepresentation(connector, contactId, "drawing")?.direction);
  return direction ? worldDirection(document, node, direction) : physicalNodeDirection(document, node);
}
