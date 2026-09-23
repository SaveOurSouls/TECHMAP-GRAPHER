import type { HarnessDesignDocument, Point } from "./model";
import type { PhysicalNode, PhysicalSegment } from "./physical-topology";
import { drawingLocalPoint, drawingPointToLocal } from "./drawing-scale";
export function physicalSegmentControls(document: HarnessDesignDocument, segment: PhysicalSegment): Point[] {
  const t = document.physicalTopology!;
  return [physicalNodePoint(document, t.nodes.find(n => n.id === segment.from)!), ...segment.bends,
    physicalNodePoint(document, t.nodes.find(n => n.id === segment.to)!)];
}

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

export function constrainedPolyline(points: readonly Point[], snap: boolean): Point[] {
  const result: Point[] = [];
  for (const end of points) {
    const start = result.at(-1);
    if (start && Math.hypot(end.x - start.x, end.y - start.y) < 1e-7) continue;
    if (start && snap) {
      const dx = end.x - start.x, dy = end.y - start.y;
      const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 12)) * Math.PI / 12;
      const cx = Math.cos(angle), sy = Math.sin(angle);
      const distance = Math.min(Math.abs(cx) < 1e-8 ? Infinity : Math.abs(dx / cx), Math.abs(sy) < 1e-8 ? Infinity : Math.abs(dy / sy));
      const bend = { x: start.x + distance * cx, y: start.y + distance * sy };
      if (Number.isFinite(distance) && distance > 1e-7 && Math.hypot(bend.x - end.x, bend.y - end.y) > 1e-7) result.push(bend);
    }
    result.push(end);
  }
  return result;
}

export function physicalSegmentPoints(document: HarnessDesignDocument, segment: PhysicalSegment): Point[] {
  const topology = document.physicalTopology!;
  return constrainedPolyline([physicalNodePoint(document, topology.nodes.find(n => n.id === segment.from)!), ...segment.bends,
    physicalNodePoint(document, topology.nodes.find(n => n.id === segment.to)!)], topology.snap);
}

