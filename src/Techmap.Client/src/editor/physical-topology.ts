export { parsePhysicalTopology } from "./physical-topology-validation";
export { physicalWirePoints, physicalWireDisplayPaths } from "./physical-wire-geometry";
export { routePhysicalWires } from "./physical-wire-routing";
import { physicalSegmentControls, physicalSegmentPoints } from "./physical-geometry";
export { physicalSegmentControls, physicalNodePoint, physicalNodeLocalPoint, constrainedPolyline, physicalSegmentPoints, physicalNodeDirection, physicalNodeContactDirection, automaticPipeRoute } from "./physical-geometry";
import { splitCoveringSpans, pathLength, projectOntoPolyline } from "./physical-coverings";
import type { HarnessDesignDocument, Point } from "./model";

import { emptyPhysicalTopology, type PhysicalDirection, type PhysicalNode, type PhysicalSegment, type PhysicalTopology } from "./physical-topology-model";
export { emptyPhysicalTopology } from "./physical-topology-model";
export type { PhysicalDirection, PhysicalNode, PhysicalSegment, PhysicalStep, PhysicalRoute, PhysicalTopology } from "./physical-topology-model";

/** One persistent exit per connector; existing exits and routes are never replaced. */
export function ensureConnectorExits(document: HarnessDesignDocument): PhysicalTopology {
  const topology = document.physicalTopology ?? emptyPhysicalTopology();
  const missing = document.connectors.filter(c => !topology.nodes.some(n => n.connectorId === c.id));
  if (!missing.length) return topology;
  return { ...topology, nodes: [...topology.nodes, ...missing.map(c => ({
    id: crypto.randomUUID(), connectorId: c.id, position: { x: 170, y: 60 },
  }))] };
}

/** Editing uses only authored vertices, never automatic presentation vertices. */
export function physicalSegmentHandles(_document: HarnessDesignDocument, segment: PhysicalSegment) {
  return segment.bends.map((point, bendIndex) => ({ point, insertAt: bendIndex, bendIndex }));
}

/** Moving a bend changes that authored bend in place; it never creates another bend. */
export function movePhysicalHandle(document: HarnessDesignDocument, segment: PhysicalSegment, index: number, point: Point): PhysicalSegment {
  const handle = physicalSegmentHandles(document, segment)[index];
  if (!handle) return segment;
  const bends = [...segment.bends];
  bends[handle.bendIndex] = point;
  return { ...segment, bends };
}

export function removePhysicalHandle(document: HarnessDesignDocument, segment: PhysicalSegment, index: number): PhysicalSegment {
  const handle = physicalSegmentHandles(document, segment)[index];
  if (!handle) return segment;
  return { ...segment, bends: segment.bends.filter((_, i) => i !== handle.bendIndex) };
}

export function insertPhysicalBend(document: HarnessDesignDocument, segment: PhysicalSegment, point: Point): PhysicalSegment {
  const controls = physicalSegmentControls(document, segment);
  let best = Infinity, index = 0;
  for (let i = 0; i < controls.length - 1; i++) {
    const path = [controls[i]!, controls[i + 1]!];
    const projected = projectOntoPolyline(path, point).point;
    const distance = Math.hypot(projected.x - point.x, projected.y - point.y);
    if (distance < best) { best = distance; index = i; }
  }
  if (controls.some(p => Math.hypot(p.x - point.x, p.y - point.y) < 1e-6)) return segment;
  const bends = [...segment.bends]; bends.splice(index, 0, point);
  return { ...segment, bends };
}



/** Explicit split, never inferred from a crossing. All route references retain their order and direction. */
export function splitPhysicalSegment(document: HarnessDesignDocument, segmentId: string, bendIndex: number, nodeId: string, nextId: string): PhysicalTopology {
  const t = document.physicalTopology!;
  const s = t.segments.find(s => s.id === segmentId)!;
  const points = physicalSegmentPoints(document, s);
  if (bendIndex < 1 || bendIndex >= points.length - 1) throw new Error("Выберите существующий перегиб участка.");
  const at = points[bendIndex]!, next = points[bendIndex + 1]!, vector = { x: next.x - at.x, y: next.y - at.y };
  const direction: PhysicalDirection = Math.abs(vector.x) >= Math.abs(vector.y) ? (vector.x >= 0 ? "right" : "left") : (vector.y >= 0 ? "down" : "up");
  return { ...t, coverings: splitCoveringSpans(t.coverings, segmentId, nextId, pathLength(points.slice(0, bendIndex + 1)) / pathLength(points)), nodes: [...t.nodes, { id: nodeId, position: at, direction }],
      segments: [...t.segments.map(item => item.id === s.id ? { ...s, to: nodeId, bends: points.slice(1, bendIndex), routing: "fixed" as const } : item),
      { ...s, id: nextId, from: nodeId, to: s.to, bends: points.slice(bendIndex + 1, -1), routing: "fixed" as const }],
    routes: t.routes.map(r => ({ ...r, steps: r.steps.flatMap(step => step.segmentId !== s.id ? [step] : step.reverse
      ? [{ segmentId: nextId, reverse: true }, step] : [step, { segmentId: nextId, reverse: false }]) })) };
}

export function prunePhysicalTopology(document: HarnessDesignDocument): HarnessDesignDocument {
  const t = document.physicalTopology;
  if (!t) return document;
  const nodes = t.nodes.filter(n => !n.connectorId || document.connectors.some(c => c.id === n.connectorId)).map(n=>n.wireIds?{...n,wireIds:n.wireIds.filter(id=>document.wires.some(w=>w.id===id&&(w.from.connectorId===n.connectorId||w.to.connectorId===n.connectorId)))}:n);
  const segments = t.segments.filter(s => nodes.some(n => n.id === s.from) && nodes.some(n => n.id === s.to));
  const routes = t.routes.filter(r => {
    const wire = document.wires.find(w => w.id === r.wireId);
    if (!wire || !r.steps.every(step => segments.some(s => s.id === step.segmentId))) return false;
    const first = segments.find(s => s.id === r.steps[0]?.segmentId), last = segments.find(s => s.id === r.steps.at(-1)?.segmentId);
    if (!first || !last) return false;
    const a = nodes.find(n => n.id === (r.steps[0]!.reverse ? first.to : first.from))?.connectorId;
    const b = nodes.find(n => n.id === (r.steps.at(-1)!.reverse ? last.from : last.to))?.connectorId;
    return (!a || a === wire.from.connectorId) && (!b || b === wire.to.connectorId);
  });
  return { ...document, physicalTopology: { ...t, nodes, segments, routes, coverings: t.coverings?.map(c=>({...c,spans:c.spans.filter(s=>segments.some(segment=>segment.id===s.segmentId))})).filter(c=>c.spans.length) } };
}

/** Split the exact clicked span, preserve existing legs, then add a perpendicular branch handle. */
export function branchPhysicalSegment(document:HarnessDesignDocument,segmentId:string,point:Point,ids:{junction:string;continuation:string;tip:string;branch:string}):PhysicalTopology {
 const t=document.physicalTopology!,segment=t.segments.find(s=>s.id===segmentId);if(!segment)throw new Error("Участок не найден.");
 const points=physicalSegmentPoints(document,segment),hit=projectOntoPolyline(points,point);
 if(hit.fraction<1e-6||hit.fraction>1-1e-6)throw new Error("Для Т-ответвления выберите внутреннюю точку канала.");
 let index=hit.index;
 if(Math.hypot(points[index]!.x-hit.point.x,points[index]!.y-hit.point.y)>1e-7)points.splice(index,0,hit.point);
 const prepared={...document,physicalTopology:{...t,segments:t.segments.map(s=>s.id===segmentId?{...s,bends:points.slice(1,-1)}:s)}};
 // The prepared polyline already respects the current snap; splitting does not straighten it.
 const split=splitPhysicalSegment(prepared,segmentId,index,ids.junction,ids.continuation);
 const a=points[index-1]!,b=points[index+1]!,dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy)||1;
 const reachable=new Set<string>([segment.from,segment.to]);let changed=true;
 while(changed){changed=false;for(const s of t.segments)if(reachable.has(s.from)||reachable.has(s.to)){if(!reachable.has(s.from)||!reachable.has(s.to))changed=true;reachable.add(s.from);reachable.add(s.to);}}
 const connected=new Set(t.nodes.filter(n=>reachable.has(n.id)&&n.connectorId).map(n=>n.connectorId!));
 const targets=new Set(document.wires.flatMap(w=>connected.has(w.from.connectorId)&&!connected.has(w.to.connectorId)?[w.to.connectorId]:connected.has(w.to.connectorId)&&!connected.has(w.from.connectorId)?[w.from.connectorId]:[]));
 const target=document.connectors.filter(c=>targets.has(c.id)).sort((x,y)=>Math.hypot(x.positions.drawing.x-hit.point.x,x.positions.drawing.y-hit.point.y)-Math.hypot(y.positions.drawing.x-hit.point.x,y.positions.drawing.y-hit.point.y))[0];
 const sign=target&&(-dy*(target.positions.drawing.x-hit.point.x)+dx*(target.positions.drawing.y-hit.point.y))<0?-1:1;
 const tip={x:hit.point.x-sign*dy/length*80,y:hit.point.y+sign*dx/length*80};
 return {...split,nodes:[...split.nodes,{id:ids.tip,position:tip}],segments:[...split.segments,{id:ids.branch,from:ids.junction,to:ids.tip,bends:[],width:segment.width,color:segment.color,showWires:segment.showWires}]};
}
