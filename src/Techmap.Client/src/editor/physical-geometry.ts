import type { HarnessDesignDocument, Point } from "./model";
import type { PhysicalDirection, PhysicalNode, PhysicalSegment } from "./physical-topology";
import { drawingLocalPoint, drawingPointToLocal } from "./drawing-scale";
import { selectMaterializedContactRepresentation } from "./materialized-contact-representation";
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
  const from = topology.nodes.find(n => n.id === segment.from)!, to = topology.nodes.find(n => n.id === segment.to)!;
  const start = physicalNodePoint(document, from), end = physicalNodePoint(document, to);
  // In manual geometry the operator owns every corner. Angle preference must
  // never introduce compensating vertices during drag (including preview).
  if (segment.bends.length || segment.routing === "fixed" || !topology.snap) return [start, ...segment.bends, end];
  return automaticPipeRoute(start, end, physicalNodeDirection(document, from, end), physicalNodeDirection(document, to, start));
}

const directions: Record<PhysicalDirection, Point> = {
  right: { x: 1, y: 0 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, up: { x: 0, y: -1 },
};
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;
const opposite = (p: Point): Point => ({ x: -p.x, y: -p.y });
const towards = (a: Point, b: Point): Point => Math.abs(b.x-a.x) >= Math.abs(b.y-a.y)
  ? { x: b.x >= a.x ? 1 : -1, y: 0 } : { x: 0, y: b.y >= a.y ? 1 : -1 };

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
  return target ? towards(physicalNodePoint(document, node), target) : null;
}

export function physicalContactTail(document: HarnessDesignDocument, node: PhysicalNode, contactId: string, start: Point, end: Point): Point[] {
  const outward = physicalNodeContactDirection(document, node, contactId) ?? towards(start, end);
  return automaticPipeRoute(start, end, outward, null);
}

export function physicalNodeContactDirection(document: HarnessDesignDocument, node: PhysicalNode, contactId: string): Point | null {
  const connector = document.connectors.find(c => c.id === node.connectorId);
  const direction = node.contactDirections?.[contactId] ?? (connector && selectMaterializedContactRepresentation(connector, contactId, "drawing")?.direction);
  return direction ? worldDirection(document, node, direction) : physicalNodeDirection(document, node);
}

/** Minimum-corner route, with fixed outward leads and 45° preferred over a square elbow.
 * Searches at most four legs; no intermediate routing vertices are persisted as edits.
 */
export function automaticPipeRoute(start: Point, end: Point, from: Point | null = null, to: Point | null = null): Point[] {
  const delta = { x: end.x-start.x, y: end.y-start.y }, distance = Math.hypot(delta.x, delta.y);
  if (distance < 1e-7) return [start, end];
  const a = from ?? towards(start, end), b = opposite(to ?? towards(end, start));
  if (Math.abs(cross(a, delta)) < 1e-7 && dot(a, delta) > 0 && dot(a,b) > 1-1e-7) return [start,end];
  const compass = Array.from({length:8}, (_,i) => ({x:Math.cos(i*Math.PI/4),y:Math.sin(i*Math.PI/4)}));
  const lead = Math.min(24, distance/4);
  for (let count=2; count<=4; count++) {
    let best: {points:Point[]; score:number} | undefined;
    const consider = (vectors: Point[]) => {
      if (vectors.slice(1).some((v,i)=>Math.abs(dot(v,vectors[i]!)) > 1-1e-7)) return;
      const minimum = vectors.map((_,i)=>i===0||i===vectors.length-1?lead:1e-5);
      const candidates: number[][] = [];
      // The least-norm solution balances the two straight leads in the usual S route.
      const xx=vectors.reduce((s,v)=>s+v.x*v.x,0), yy=vectors.reduce((s,v)=>s+v.y*v.y,0), xy=vectors.reduce((s,v)=>s+v.x*v.y,0), determinant=xx*yy-xy*xy;
      if (Math.abs(determinant)>1e-8) {
        const x=(yy*delta.x-xy*delta.y)/determinant, y=(xx*delta.y-xy*delta.x)/determinant;
        candidates.push(vectors.map(v=>v.x*x+v.y*y));
      }
      // Boundary solutions ensure feasibility even when a lead must stay at its minimum.
      for(let i=0;i<vectors.length;i++) for(let j=i+1;j<vectors.length;j++) {
        const u=vectors[i]!,v=vectors[j]!,det=cross(u,v); if(Math.abs(det)<1e-8)continue;
        const lengths=[...minimum],remaining={...delta};
        vectors.forEach((w,k)=>{if(k!==i&&k!==j){remaining.x-=w.x*lengths[k]!;remaining.y-=w.y*lengths[k]!;}});
        lengths[i]=cross(remaining,v)/det; lengths[j]=cross(u,remaining)/det; candidates.push(lengths);
      }
      for(const lengths of candidates) {
        if(lengths.some((n,i)=>n<minimum[i]!-1e-7))continue;
        const points=[start]; vectors.forEach((v,i)=>{const p=points.at(-1)!;points.push({x:p.x+v.x*lengths[i]!,y:p.y+v.y*lengths[i]!});}); points[points.length-1]=end;
        const diagonal=vectors.slice(1,-1).some(v=>Math.abs(Math.abs(v.x)-Math.abs(v.y))<1e-7);
        const length=lengths.reduce((s,n)=>s+n,0);
        const score=(count===3&&!diagonal?1e9:0)+length+Math.abs(lengths[0]!-lengths.at(-1)!)*1e-5;
        if(!best||score<best.score-1e-7)best={points,score};
      }
    };
    if(count===2)consider([a,b]);
    if(count===3)for(const v of compass)consider([a,v,b]);
    if(count===4)for(const u of compass)for(const v of compass)consider([a,u,v,b]);
    if(best)return best.points;
  }
  // Rotated drawings can have non-octilinear leads: keep both directions exact.
  return [start,{x:start.x+a.x*lead,y:start.y+a.y*lead},{x:end.x-b.x*lead,y:end.y-b.y*lead},end];
}
