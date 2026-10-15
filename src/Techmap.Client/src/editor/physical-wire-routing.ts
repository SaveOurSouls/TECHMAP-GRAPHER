import type { HarnessDesignDocument } from "./model";
import type { PhysicalTopology, PhysicalRoute, PhysicalStep } from "./physical-topology-model";
import { physicalSegmentPoints } from "./physical-geometry";
import { pathLength } from "./physical-coverings";

interface RouteEdge {
  readonly node: string;
  readonly step: PhysicalStep;
  readonly cost: number;
}
type RouteGraph = ReadonlyMap<string, readonly RouteEdge[]>;

/** Geometry supplies weights once, independently of wire eligibility and path search. */
function buildRouteGraph(document: HarnessDesignDocument, topology: PhysicalTopology): RouteGraph {
  const graph = new Map<string, RouteEdge[]>();
  const routedDocument = { ...document, physicalTopology: topology };
  const measuredLengths=new Map<string,number>();
  const geometricLengths=new Map(topology.segments.map(s=>[s.id,pathLength(physicalSegmentPoints(routedDocument,s))]));
  for (const segment of topology.segments) {
    const routeKey=JSON.stringify([segment.id,segment.from,segment.to,segment.path.points.length]);
    const dimensions=document.drawingDocuments?.dimensions?.filter(d=>d.segmentId===segment.id&&d.routeKey===routeKey)??[];
    const total=dimensions.find(d=>d.from===0&&d.to===segment.path.points.length+1);
    const ordered=[...dimensions].sort((a,b)=>a.from-b.from);
    let next=0,measured=0,complete=ordered.length>0;
    for(const d of ordered){if(d.from!==next||d.lengthMm===null)complete=false;next=d.to;measured+=d.lengthMm??0;}
    const length=total?.lengthMm??(complete&&next===segment.path.points.length+1?measured:null);
    if(length!==null)measuredLengths.set(segment.id,length);
  }
  // Unknown lengths use a drawing estimate in the same scale, never raw pixels
  // competing against measured millimetres. This estimate is not stored as length.
  const references=[...measuredLengths].filter(([id,n])=>n>0&&geometricLengths.get(id)!>1e-7);
  const scale=references.length?references.reduce((sum,[,n])=>sum+n,0)/references.reduce((sum,[id])=>sum+geometricLengths.get(id)!,0):1;
  for (const segment of topology.segments) {
    const cost = Math.max(.001, measuredLengths.get(segment.id)??geometricLengths.get(segment.id)!*scale);
    for (const [from, to, reverse] of [[segment.from, segment.to, false], [segment.to, segment.from, true]] as const) {
      if (!graph.has(from)) graph.set(from, []);
      graph.get(from)!.push({ node: to, step: { segmentId: segment.id, reverse }, cost });
    }
  }
  return graph;
}

/** An unrelated connector is a terminal unless this wire is explicitly
 * admitted as a physical transit. That keeps the physical graph independent
 * from electrical connectivity while allowing an authored pass-through at X4. */
function shortestRoute(graph: RouteGraph, sources: readonly string[], targets: ReadonlySet<string>): PhysicalStep[] | undefined {
  const distance = new Map(sources.map(id => [id, 0]));
  const previous = new Map<string, { node: string; step: PhysicalStep }>();
  const queue = new Set(sources);
  while (queue.size) {
    const id = [...queue].sort((a, b) => distance.get(a)! - distance.get(b)! || a.localeCompare(b))[0]!;
    queue.delete(id);
    if (targets.has(id)) {
      const steps: PhysicalStep[] = [];
      let current = id;
      while (previous.has(current)) {
        const parent = previous.get(current)!;
        steps.unshift(parent.step);
        current = parent.node;
      }
      return steps;
    }
    for (const edge of graph.get(id) ?? []) {
      const cost = distance.get(id)! + edge.cost;
      if (cost < (distance.get(edge.node) ?? Infinity) - 1e-8) {
        distance.set(edge.node, cost);
        previous.set(edge.node, { node: id, step: edge.step });
        queue.add(edge.node);
      }
    }
  }
  return undefined;
}

function exitsAcceptRoute(topology: PhysicalTopology, route: PhysicalRoute): boolean {
  if (route.steps.some(step => {
    const segment = topology.segments.find(segment => segment.id === step.segmentId);
    return !segment || segment.excludedWireIds?.includes(route.wireId);
  })) return false;
  const first = route.steps[0], last = route.steps.at(-1);
  if (!first || !last) return false;
  const start = topology.segments.find(segment => segment.id === first.segmentId);
  const end = topology.segments.find(segment => segment.id === last.segmentId);
  if (!start || !end) return false;
  return [first.reverse ? start.to : start.from, last.reverse ? end.from : end.to].every(id => {
    const node = topology.nodes.find(node => node.id === id);
    return node && (!node.wireIds || node.wireIds.includes(route.wireId));
  });
}

/** Explicit assignment changes only routes. Drawing distances are not manufacturing millimetres. */
export function routePhysicalWires(document: HarnessDesignDocument, topology: PhysicalTopology, onlyWireIds?: readonly string[]): PhysicalTopology {
  const requested = onlyWireIds && new Set(onlyWireIds);
  const routes = topology.routes.filter(route => requested && !requested.has(route.wireId) || !route.automatic && exitsAcceptRoute(topology, route));
  const pinned = new Set(routes.map(route => route.wireId));
  const graph = buildRouteGraph(document, topology);
  for (const wire of document.wires) {
    if (requested && !requested.has(wire.id) || pinned.has(wire.id) || !wire.from.connectorId || !wire.to.connectorId) continue;
    const eligible = (connectorId: string) => topology.nodes
      .filter(node => node.connectorId === connectorId && (!node.wireIds || node.wireIds.includes(wire.id)))
      .map(node => node.id);
    const allowedTransit=new Set(topology.nodes.filter(node=>node.transitWireIds?.includes(wire.id)).map(node=>node.id));
    const excluded = new Set(topology.segments.filter(segment => segment.excludedWireIds?.includes(wire.id)).map(segment => segment.id));
    const terminalGraph=new Map([...graph].map(([node,edges])=>[
      node,
      node!==undefined&&topology.nodes.some(candidate=>candidate.id===node&&candidate.connectorId)&&
        !allowedTransit.has(node)&&!eligible(wire.from.connectorId).includes(node)&&!eligible(wire.to.connectorId).includes(node)
        ? [] : edges.filter(edge => !excluded.has(edge.step.segmentId)),
    ] as const));
    const steps = shortestRoute(terminalGraph, eligible(wire.from.connectorId), new Set(eligible(wire.to.connectorId)));
    if (steps?.length) routes.push({ wireId: wire.id, steps, automatic: true });
  }
  return { ...topology, routes };
}

interface FlowEdge {
  readonly to: number; readonly reverse: number; capacity: number; readonly cost: number;
  readonly step?: PhysicalStep; readonly terminal?: 'from' | 'to';
}

/** Find a complete simple route through a required pipe. Two disjoint legs are
 * solved together: a greedy shortest first leg can block a feasible second leg.
 * Residual flow can revise that first choice, without fabricating a backtrack
 * through the same pipe or passing an unrelated connector without permission. */
export function findPhysicalWireRouteThroughSegment(document: HarnessDesignDocument, topology: PhysicalTopology, wireId: string, segmentId: string): PhysicalRoute | undefined {
  const wire = document.wires.find(wire => wire.id === wireId), required = topology.segments.find(segment => segment.id === segmentId);
  if (!wire?.from.connectorId || !wire.to.connectorId || !required || required.excludedWireIds?.includes(wireId)) return undefined;
  const eligible = (connectorId: string) => new Set(topology.nodes.filter(node => node.connectorId === connectorId && (!node.wireIds || node.wireIds.includes(wireId))).map(node => node.id));
  const from = eligible(wire.from.connectorId), to = eligible(wire.to.connectorId);
  const allowed = topology.nodes.filter(node => !node.connectorId || from.has(node.id) || to.has(node.id) || node.transitWireIds?.includes(wireId));
  const indexes = new Map(allowed.map((node, index) => [node.id, index * 2]));
  const a = indexes.get(required.from), b = indexes.get(required.to);
  if (a === undefined || b === undefined || !from.size || !to.size) return undefined;
  const source = indexes.size * 2, fromSink = source + 1, toSink = source + 2, sink = source + 3;
  const graph: FlowEdge[][] = Array.from({ length: sink + 1 }, () => []);
  const add = (start: number, end: number, cost: number, metadata: Pick<FlowEdge, 'step' | 'terminal'> = {}) => {
    const forward: FlowEdge = { to: end, reverse: graph[end]!.length, capacity: 1, cost, ...metadata };
    const backward: FlowEdge = { to: start, reverse: graph[start]!.length, capacity: 0, cost: -cost };
    graph[start]!.push(forward); graph[end]!.push(backward);
  };
  for (const [id, index] of indexes) {
    add(index, index + 1, 0);
    if (from.has(id)) add(index + 1, fromSink, 0, { terminal: 'from' });
    if (to.has(id)) add(index + 1, toSink, 0, { terminal: 'to' });
  }
  const excluded = new Set(topology.segments.filter(segment => segment.excludedWireIds?.includes(wireId)).map(segment => segment.id));
  for (const [id, edges] of buildRouteGraph(document, topology)) {
    const start = indexes.get(id); if (start === undefined) continue;
    for (const edge of edges) {
      const end = indexes.get(edge.node);
      if (end !== undefined && edge.step.segmentId !== segmentId && !excluded.has(edge.step.segmentId)) add(start + 1, end, edge.cost, { step: edge.step });
    }
  }
  add(source, a, 0); add(source, b, 0); add(fromSink, sink, 0); add(toSink, sink, 0);
  // Only two units of flow are needed. Residual reverse edges have negative
  // costs; a queue relaxation handles them without assuming nonnegative edges.
  for (let unit = 0; unit < 2; unit++) {
    const distance = Array(graph.length).fill(Infinity) as number[], previous: ({ node: number; edge: number } | undefined)[] = Array(graph.length);
    const queue = [source], queued = new Set([source]); distance[source] = 0;
    for (let head = 0; head < queue.length; head++) {
      const node = queue[head]!; queued.delete(node);
      for (const [index, edge] of graph[node]!.entries()) {
        const cost = distance[node]! + edge.cost;
        if (edge.capacity && cost < distance[edge.to]! - 1e-8) {
          distance[edge.to] = cost; previous[edge.to] = { node, edge: index };
          if (!queued.has(edge.to)) { queued.add(edge.to); queue.push(edge.to); }
        }
      }
    }
    if (!previous[sink]) return undefined;
    let node = sink;
    while (node !== source) {
      const parent = previous[node]!, edge = graph[parent.node]![parent.edge]!;
      edge.capacity--; graph[node]![edge.reverse]!.capacity++; node = parent.node;
    }
  }
  const leg = (start: string): { steps: PhysicalStep[]; terminal: 'from' | 'to' } | undefined => {
    const steps: PhysicalStep[] = [], visited = new Set<string>(); let node = start;
    while (!visited.has(node)) {
      visited.add(node); const out = graph[indexes.get(node)! + 1]!;
      const terminal = out.find(edge => edge.terminal && !edge.capacity)?.terminal;
      if (terminal) return { steps, terminal };
      const step = out.find(edge => edge.step && !edge.capacity)?.step;
      if (!step) return undefined;
      steps.push(step); const segment = topology.segments.find(segment => segment.id === step.segmentId)!;
      node = step.reverse ? segment.from : segment.to;
    }
    return undefined;
  };
  const left = leg(required.from), right = leg(required.to);
  if (!left || !right || left.terminal === right.terminal) return undefined;
  const reverse = (steps: readonly PhysicalStep[]) => [...steps].reverse().map(step => ({ ...step, reverse: !step.reverse }));
  const steps = left.terminal === 'from'
    ? [...reverse(left.steps), { segmentId, reverse: false }, ...right.steps]
    : [...reverse(right.steps), { segmentId, reverse: true }, ...left.steps];
  return { wireId, steps, automatic: false };
}

/** Refresh on graph/placement changes, never on selection or style-only edits. */
export function refreshAutomaticPhysicalRoutes(before:HarnessDesignDocument,after:HarnessDesignDocument):HarnessDesignDocument {
  const t=after.physicalTopology;if(!t||!before.physicalTopology)return after;
  const key=(d:HarnessDesignDocument)=>JSON.stringify([d.physicalTopology?.snap,d.physicalTopology?.nodes,
    d.physicalTopology?.segments.map(s=>[s.id,s.from,s.to,s.path,s.excludedWireIds]),
    d.wires.map(w=>[w.id,w.from,w.to]),
    d.connectors.map(c=>[c.id,c.positions.drawing,c.drawingPlacements]),
    d.drawingDocuments?.dimensions?.filter(d=>d.segmentId).map(d=>[d.segmentId,d.from,d.to,d.lengthMm])]);
  if(key(before)===key(after))return after;
  return {...after,physicalTopology:routePhysicalWires(after,t)};
}
