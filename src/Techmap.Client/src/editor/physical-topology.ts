import { segmentWireLanes } from "./drawing-thickness";
import { physicalSegmentControls, physicalNodePoint, physicalNodeLocalPoint, constrainedPolyline, physicalSegmentPoints } from "./physical-geometry";
export { physicalSegmentControls, physicalNodePoint, physicalNodeLocalPoint, constrainedPolyline, physicalSegmentPoints } from "./physical-geometry";
import { coveringKind, coveringRoute, resolvedCoveringSpan, trimPolyline, validateCoverings, splitCoveringSpans, pathLength, projectOntoPolyline, type PhysicalCovering } from "./physical-coverings";
import type { HarnessDesignDocument, Point } from "./model";

export interface PhysicalNode { readonly id: string; readonly position: Point; readonly connectorId?: string; readonly wireIds?: readonly string[] }
export interface PhysicalSegment { readonly id: string; readonly from: string; readonly to: string; readonly bends: readonly Point[]; readonly width?:number; readonly color?:string; readonly showWires?:boolean; readonly specificationItemId?:string }
export interface PhysicalStep { readonly segmentId: string; readonly reverse: boolean }
export interface PhysicalRoute { readonly wireId: string; readonly steps: readonly PhysicalStep[]; readonly automatic?:boolean }
export interface PhysicalTopology {
  readonly coverings?: readonly PhysicalCovering[];
  readonly nodes: readonly PhysicalNode[];
  readonly segments: readonly PhysicalSegment[];
  readonly routes: readonly PhysicalRoute[];
  readonly snap: boolean;
}
export const emptyPhysicalTopology = (): PhysicalTopology => ({ nodes: [], segments: [], routes: [], snap: true });

/** One persistent exit per connector; existing exits and routes are never replaced. */
export function ensureConnectorExits(document: HarnessDesignDocument): PhysicalTopology {
  const topology = document.physicalTopology ?? emptyPhysicalTopology();
  const missing = document.connectors.filter(c => !topology.nodes.some(n => n.connectorId === c.id));
  if (!missing.length) return topology;
  return { ...topology, nodes: [...topology.nodes, ...missing.map(c => ({
    id: crypto.randomUUID(), connectorId: c.id, position: { x: 170, y: 60 },
  }))] };
}

/** Editing uses only authored vertices, not the auxiliary vertices of the 15° presentation. */

/** Every displayed corner has a handle. Helpers remember their authored leg, not a transient path index. */
export function physicalSegmentHandles(document: HarnessDesignDocument, segment: PhysicalSegment) {
  const controls = physicalSegmentControls(document, segment);
  return controls.slice(1).flatMap((end, leg) => {
    const path = constrainedPolyline([controls[leg]!, end], document.physicalTopology!.snap);
    return [
      ...path.slice(1, -1).map(point => ({ point, insertAt: leg, bendIndex: null as number | null })),
      ...(leg < segment.bends.length ? [{ point: end, insertAt: leg, bendIndex: leg as number | null }] : []),
    ];
  });
}

/** Moving an automatic corner promotes only that corner to a saved preference. */
export function movePhysicalHandle(document: HarnessDesignDocument, segment: PhysicalSegment, index: number, point: Point): PhysicalSegment {
  const handle = physicalSegmentHandles(document, segment)[index];
  if (!handle) return segment;
  const bends = [...segment.bends];
  if (handle.bendIndex === null) bends.splice(handle.insertAt, 0, point);
  else bends[handle.bendIndex] = point;
  return { ...segment, bends };
}

export function removePhysicalHandle(document: HarnessDesignDocument, segment: PhysicalSegment, index: number): PhysicalSegment {
  const handle = physicalSegmentHandles(document, segment)[index];
  if (!handle || handle.bendIndex === null) return segment;
  return { ...segment, bends: segment.bends.filter((_, i) => i !== handle.bendIndex) };
}

export function insertPhysicalBend(document: HarnessDesignDocument, segment: PhysicalSegment, point: Point): PhysicalSegment {
  const controls = physicalSegmentControls(document, segment);
  let best = Infinity, index = 0;
  for (let i = 0; i < controls.length - 1; i++) {
    const path = constrainedPolyline([controls[i]!, controls[i + 1]!], document.physicalTopology!.snap);
    const projected = projectOntoPolyline(path, point).point;
    const distance = Math.hypot(projected.x - point.x, projected.y - point.y);
    if (distance < best) { best = distance; index = i; }
  }
  if (controls.some(p => Math.hypot(p.x - point.x, p.y - point.y) < 1e-6)) return segment;
  const bends = [...segment.bends]; bends.splice(index, 0, point);
  return { ...segment, bends };
}



/** Preserve both anchors. A short horizontal/vertical completion makes every leg a multiple of 15°. */


export function physicalWirePoints(document: HarnessDesignDocument, wireId: string, start: Point, end: Point): Point[] | null {
  const topology = document.physicalTopology;
  const route = topology?.routes.find(r => r.wireId === wireId);
  if (!topology || !route?.steps.length) return null;
  const points = route.steps.flatMap(step => {
    const segment = topology.segments.find(s => s.id === step.segmentId)!;
    const path = physicalSegmentPoints(document, segment);
    return step.reverse ? path.reverse() : path;
  });
  return constrainedPolyline([start, ...points, end], topology.snap);
}

export function parsePhysicalTopology(value: unknown, document: HarnessDesignDocument): PhysicalTopology | undefined {
  if (value === undefined) return undefined;
  const fail = (): never => { throw new Error("Некорректная физическая трасса: проверьте узлы, участки и порядок маршрутов."); };
  if (!value || typeof value !== "object") return fail();
  const t = value as PhysicalTopology;
  if (!Array.isArray(t.nodes) || !Array.isArray(t.segments) || !Array.isArray(t.routes) || typeof t.snap !== "boolean" ||
      t.nodes.length > 10000 || t.segments.length > 20000 || t.routes.length > 20000) return fail();
  const text = (s: unknown): s is string => typeof s === "string" && s.trim().length > 0 && s.length <= 128;
  const point = (p: Point) => p && Number.isFinite(p.x) && Number.isFinite(p.y) && Math.abs(p.x) <= 1e7 && Math.abs(p.y) <= 1e7;
  const ids = new Set([...document.connectors.map(c => c.id), ...document.wires.map(w => w.id)]);
  const unique = (id: unknown) => { if (!text(id) || ids.has(id)) fail(); ids.add(id as string); };
  for (const n of t.nodes) {
    if (!n) return fail(); unique(n.id);
    if(n.wireIds!==undefined&&(!n.connectorId||!Array.isArray(n.wireIds)||new Set(n.wireIds).size!==n.wireIds.length||n.wireIds.some((id:string)=>!document.wires.some(w=>w.id===id&&(w.from.connectorId===n.connectorId||w.to.connectorId===n.connectorId)))))return fail();
    if (!point(n.position) || n.connectorId !== undefined && !document.connectors.some(c => c.id === n.connectorId)) return fail();
  }

  for (const s of t.segments) {
    if (!s) return fail(); unique(s.id);
    if(s.width!==undefined&&(!Number.isFinite(s.width)||s.width<4||s.width>200)||s.color!==undefined&&!/^#[0-9a-f]{6}$/i.test(s.color)||s.showWires!==undefined&&typeof s.showWires!=="boolean"||s.specificationItemId!==undefined&&!text(s.specificationItemId))return fail();
    if (s.from === s.to || !t.nodes.some(n => n.id === s.from) || !t.nodes.some(n => n.id === s.to) || !Array.isArray(s.bends) || s.bends.length > 1000 || !s.bends.every(point)) return fail();
  }
  const wireIds = new Set<string>();
  for (const r of t.routes) {
    if (!r || wireIds.has(r.wireId) || !document.wires.some(w => w.id === r.wireId) || !Array.isArray(r.steps) || !r.steps.length || r.steps.length > 20000) return fail();
    if(r.automatic!==undefined&&typeof r.automatic!=="boolean")return fail();
    wireIds.add(r.wireId);
    let previous: string | undefined;
    const visited = new Set<string>();
    for (const step of r.steps) {
      const s = t.segments.find(s => s.id === step?.segmentId);
      if (!s || typeof step.reverse !== "boolean" || visited.has(s.id)) return fail();
      visited.add(s.id);
      const from = step.reverse ? s.to : s.from, to = step.reverse ? s.from : s.to;
      if (previous && previous !== from) return fail();
      previous = to;
    }
    const first = t.segments.find(s => s.id === r.steps[0]!.segmentId)!;
    const last = t.segments.find(s => s.id === r.steps.at(-1)!.segmentId)!;
    const from = t.nodes.find(n => n.id === (r.steps[0]!.reverse ? first.to : first.from))!;
    const to = t.nodes.find(n => n.id === (r.steps.at(-1)!.reverse ? last.from : last.to))!;
    const w = document.wires.find(w => w.id === r.wireId)!;
    if(from.wireIds&&!from.wireIds.includes(r.wireId)||to.wireIds&&!to.wireIds.includes(r.wireId))return fail();
    if (from.connectorId && from.connectorId !== w.from.connectorId || to.connectorId && to.connectorId !== w.to.connectorId) return fail();
  }
  validateCoverings(t.coverings, new Set(t.segments.map(s => s.id)), ids);
  for(const c of t.coverings??[])for(const span of c.spans){const count=t.segments.find(s=>s.id===span.segmentId)!.bends.length+2;
    if([span.fromAnchor,span.toAnchor].some(i=>i!==undefined&&i>=count)||span.fromAnchor!==undefined&&span.toAnchor!==undefined&&span.fromAnchor>=span.toAnchor)return fail();}
  return t;
}

/** Explicit split, never inferred from a crossing. All route references retain their order and direction. */
export function splitPhysicalSegment(document: HarnessDesignDocument, segmentId: string, bendIndex: number, nodeId: string, nextId: string): PhysicalTopology {
  const t = document.physicalTopology!;
  const s = t.segments.find(s => s.id === segmentId)!;
  const points = physicalSegmentPoints(document, s);
  if (bendIndex < 1 || bendIndex >= points.length - 1) throw new Error("Выберите существующий перегиб участка.");
  return { ...t, coverings: splitCoveringSpans(t.coverings, segmentId, nextId, pathLength(points.slice(0, bendIndex + 1)) / pathLength(points)), nodes: [...t.nodes, { id: nodeId, position: points[bendIndex]! }],
    segments: [...t.segments.map(item => item.id === s.id ? { ...s, to: nodeId, bends: points.slice(1, bendIndex) } : item),
      { ...s, id: nextId, from: nodeId, to: s.to, bends: points.slice(bendIndex + 1, -1) }],
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

/** Display lanes never alter measured centreline geometry or electrical endpoints. */
const offsetPolyline=(points:readonly Point[],offsets:readonly number[]):Point[]=>points.map((p,i)=>{const a=points[Math.max(0,i-1)]!,b=points[Math.min(points.length-1,i+1)]!,before=Math.hypot(p.x-a.x,p.y-a.y),after=Math.hypot(b.x-p.x,b.y-p.y),u=before?{x:-(p.y-a.y)/before,y:(p.x-a.x)/before}:null,v=after?{x:-(b.y-p.y)/after,y:(b.x-p.x)/after}:null,n=u&&v?{x:u.x+v.x,y:u.y+v.y}:u??v??{x:0,y:1},len=Math.hypot(n.x,n.y)||1;return {x:p.x+n.x/len*offsets[i]!,y:p.y+n.y/len*offsets[i]!};});
export function physicalWireDisplayPaths(document:HarnessDesignDocument,wireId:string,start:Point,end:Point):Point[][]|undefined {
 const t=document.physicalTopology,route=t?.routes.find(r=>r.wireId===wireId);if(!t||!route?.steps.length)return undefined;
 const paths:Point[][]=[];
 for(const step of route.steps){
  const segment=t.segments.find(s=>s.id===step.segmentId)!;
  if(segment.showWires===false)continue;
  const offset=segmentWireLanes(document,segment.id).find(l=>l.id===wireId)?.offset??0;
  const points=physicalSegmentPoints(document,segment);
  const lane=offsetPolyline(points,points.map(()=>offset));
  if(step.reverse)lane.reverse();paths.push(lane);
 }
 const first=route.steps[0]!,last=route.steps.at(-1)!;
 const a=physicalSegmentPoints(document,t.segments.find(s=>s.id===first.segmentId)!);
 const b=physicalSegmentPoints(document,t.segments.find(s=>s.id===last.segmentId)!);
 const from=first.reverse?a.at(-1)!:a[0]!,to=last.reverse?b[0]!:b.at(-1)!;
 const wireExitPath=(document:HarnessDesignDocument,segmentId:string,nodeSide:"from"|"to",wireId:string,contact:Point):Point[]|null=>{
  const route=coveringRoute(document,segmentId);if(!route)return null;
  const spans=(document.physicalTopology?.coverings??[]).filter(c=>coveringKind(c)==="heat-shrink").flatMap(c=>c.spans.filter(s=>s.segmentId===segmentId).map(s=>resolvedCoveringSpan(document,s)));
  const edge=nodeSide==="from"?Math.max(route.min,Math.min(0,...spans.filter(s=>s.from<0&&s.to>=0).map(s=>s.from))):Math.min(route.max,Math.max(1,...spans.filter(s=>s.to>1&&s.from<=1).map(s=>s.to)));
  if(nodeSide==="from"?edge===0:edge===1)return null;const a=Math.min(nodeSide==="from"?0:1,edge),b=Math.max(nodeSide==="from"?0:1,edge);
  const path=trimPolyline(route.points,(route.before+a*route.length)/route.total,(route.before+b*route.length)/route.total),offset=segmentWireLanes(document,segmentId).find(l=>l.id===wireId)?.offset??0,lane=offsetPolyline(path,path.map(()=>offset));
  return nodeSide==="from"?[contact,...lane]:[...lane,contact];
 };
 const fromTail=wireExitPath(document,first.segmentId,first.reverse?"to":"from",wireId,start);
 const toTail=wireExitPath(document,last.segmentId,last.reverse?"from":"to",wireId,end);
 return [fromTail?(first.reverse?fromTail.reverse():fromTail):[start,from],...paths,toTail?(last.reverse?toTail.reverse():toTail):[to,end]];
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

/** Explicit automatic assignment uses geometric lengths only to choose a path, never as manufacturing millimetres. */
export function routePhysicalWires(document:HarnessDesignDocument,topology:PhysicalTopology):PhysicalTopology {
 const accepts=(r:PhysicalRoute)=>{const first=r.steps[0],last=r.steps.at(-1);if(!first||!last)return false;const a=topology.segments.find(s=>s.id===first.segmentId),b=topology.segments.find(s=>s.id===last.segmentId);if(!a||!b)return false;return [first.reverse?a.to:a.from,last.reverse?b.from:b.to].every(id=>{const n=topology.nodes.find(n=>n.id===id);return n&&(!n.wireIds||n.wireIds.includes(r.wireId));});};
 const routes=topology.routes.filter(r=>!r.automatic&&accepts(r)),pinned=new Set(routes.map(r=>r.wireId));
 const graph=new Map<string,{node:string;step:PhysicalStep;cost:number}[]>();
 for(const s of topology.segments){const cost=Math.max(.001,pathLength(physicalSegmentPoints({...document,physicalTopology:topology},s)));
  for(const [from,to,reverse] of [[s.from,s.to,false],[s.to,s.from,true]] as const){if(!graph.has(from))graph.set(from,[]);graph.get(from)!.push({node:to,step:{segmentId:s.id,reverse},cost});}}
 for(const wire of document.wires){if(pinned.has(wire.id)||!wire.from.connectorId||!wire.to.connectorId)continue;
  const eligible=(connectorId:string)=>topology.nodes.filter(n=>n.connectorId===connectorId&&(!n.wireIds||n.wireIds.includes(wire.id))).map(n=>n.id);
  const sources=eligible(wire.from.connectorId),targets=new Set(eligible(wire.to.connectorId));
  const distance=new Map(sources.map(id=>[id,0])),previous=new Map<string,{node:string;step:PhysicalStep}>(),queue=new Set(sources);let found:string|undefined;
  while(queue.size){const id=[...queue].sort((a,b)=>distance.get(a)!-distance.get(b)!||a.localeCompare(b))[0]!;queue.delete(id);
   if(targets.has(id)){found=id;break;}
   const n=topology.nodes.find(n=>n.id===id)!;if(n.connectorId&&!sources.includes(id))continue;
   for(const edge of graph.get(id)??[]){const cost=distance.get(id)!+edge.cost;if(cost<(distance.get(edge.node)??Infinity)-1e-8){distance.set(edge.node,cost);previous.set(edge.node,{node:id,step:edge.step});queue.add(edge.node);}}
  }
  if(found){const steps:PhysicalStep[]=[];let current=found;while(previous.has(current)){const p=previous.get(current)!;steps.unshift(p.step);current=p.node;}if(steps.length)routes.push({wireId:wire.id,steps,automatic:true});}
 }
 return {...topology,routes};
}
