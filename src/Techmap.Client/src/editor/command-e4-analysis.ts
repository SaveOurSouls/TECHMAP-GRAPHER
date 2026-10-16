import { type Point, type WireInstance, isScreenEndpoint, isJunctionEndpoint, type HarnessDesignDocument, wireEndpointE4Anchor, type ConnectorInstance, connectorE4TableGeometry, type WireEndpoint, defaultE4WireLead, validateE4Polyline } from "./model";
import { polylineLength, validateE4Route, type E4RouterAnchor } from "./e4-router";
import { pointOnOrthogonalSegment, pointsMatch, findWire, collectJunctionComponent, sameEndpoint } from "./editor-command-invariants";
import { segmentEntersRect } from "./segment-geometry";

export function simplifyE4IntermediateRoute(
  start: Point,
  intermediate: readonly Point[],
  end: Point,
): Point[] {
  const result: Point[] = [{ ...start }];
  for (const point of [...intermediate, end]) {
    const last = result.at(-1)!;
    if (last.x === point.x && last.y === point.y) continue;
    result.push({ ...point });
    while (result.length >= 3) {
      const first = result[result.length - 3]!;
      const middle = result[result.length - 2]!;
      const third = result[result.length - 1]!;
      if (!((first.x === middle.x && middle.x === third.x) ||
          (first.y === middle.y && middle.y === third.y))) break;
      result.splice(result.length - 2, 1);
    }
  }
  return result.slice(1, -1);
}
export function screenJunctionEnds(wire: WireInstance) {
  const screen = [wire.from, wire.to].find(isScreenEndpoint);
  const junction = [wire.from, wire.to].find(isJunctionEndpoint);
  return screen && junction ? { screen, junction } : null;
}
export function e4RoutingScore(document: HarnessDesignDocument): number {
  const carriers = document.wires.filter(wire => ![wire.from,wire.to].some(isScreenEndpoint));
  const paths = carriers.map((wire) => [wireEndpointE4Anchor(document, wire.from)!.position,
    ...wire.e4Route, wireEndpointE4Anchor(document, wire.to)!.position]);
  let score = paths.reduce((sum, points) => sum + polylineLength(points) + points.slice(1, -1)
    .filter((point, index) => (points[index]!.x === point.x) !== (point.x === points[index + 2]!.x)).length * 8, 0);
  for (let i = 0; i < paths.length; i += 1) for (let j = i + 1; j < paths.length; j += 1) {
    const crossings = new Set<string>();
    const first = paths[i]!;
    const second = paths[j]!;
    for (let a = 1; a < first.length; a += 1) for (let b = 1; b < second.length; b += 1) {
      const a0 = first[a - 1]!; const a1 = first[a]!;
      const b0 = second[b - 1]!; const b1 = second[b]!;
      const horizontal = a0.y === a1.y;
      if (horizontal === (b0.y === b1.y)) continue;
      const point = horizontal ? { x: b0.x, y: a0.y } : { x: a0.x, y: b0.y };
      if (pointOnOrthogonalSegment(point, a0, a1) && pointOnOrthogonalSegment(point, b0, b1) &&
          !document.junctions.some((junction) => junction.wireIds.includes(carriers[i]!.id) &&
            junction.wireIds.includes(carriers[j]!.id) && pointsMatch(point, junction.position))) {
        crossings.add(`${point.x}:${point.y}`);
      }
    }
    score += crossings.size * 84;
  }
  return score;
}
export function validateAllE4Wires(document: HarnessDesignDocument): void {
  validateE4WireIds(document, document.wires.map((wire) => wire.id));
}
export function validateE4WireIds(document: HarnessDesignDocument, wireIds: readonly string[]): void {
  for (const wireId of wireIds) {
    const wire = findWire(document, wireId);
    const start = wireEndpointE4Anchor(document, wire.from);
    const end = wireEndpointE4Anchor(document, wire.to);
    if (!start || !end) throw new Error("Точки подключения маршрута Э4 не найдены.");
    // A junction component is one electrical net. Its branches may enter the
    // visual label of another branch; treating that annotation as an obstacle
    // would make a valid T connection impossible after its junction moves.
    const junctionComponent = collectJunctionComponent([wireId], document.junctions);
    const request = createE4RoutingRequest(document, wire, wire.id);
    if (screenJunctionEnds(wire) && wire.e4Route.length !== 0) {
      throw new Error("Подключение экрана к проводу должно быть прямым, без изгибов.");
    }
    const points = [start.position, ...wire.e4Route, end.position];
    validateE4Route(
      points,
      {
        ...request,
        obstacles: request.obstacles?.filter((obstacle) =>
          !obstacle.id?.startsWith("wire-label:") ||
          !junctionComponent.has(obstacle.id.slice("wire-label:".length))),
      },
    );
  }
}
function connectorE4RoutingObstacle(connector: ConnectorInstance) {
  const position = connector.positions.e4;
  if (connector.terminationComponent) return { id: connector.id,
    x: position.x + 32, y: position.y + 15, width: 156, height: 70 };
  const geometry = connectorE4TableGeometry(connector);
  return { id: connector.id, x: position.x, y: position.y, width: geometry.width, height: geometry.height };
}
export function wireRouteTouchesConnector(
  document: HarnessDesignDocument,
  wire: WireInstance,
  connector: ConnectorInstance,
): boolean {
  const geometry = connectorE4RoutingObstacle(connector);
  const padding = 4;
  const rect = {
    left: geometry.x - padding,
    right: geometry.x + geometry.width + padding,
    top: geometry.y - padding,
    bottom: geometry.y + geometry.height + padding,
  };
  const start = wireEndpointE4Anchor(document, wire.from)?.position;
  const end = wireEndpointE4Anchor(document, wire.to)?.position;
  if (!start || !end) return true;
  const points = [start, ...wire.e4Route, end];
  for (let index = 1; index < points.length; index += 1) {
    const first = points[index - 1]!;
    const second = points[index]!;
    if (first.x === second.x) {
      if (first.x >= rect.left && first.x <= rect.right &&
          Math.max(Math.min(first.y, second.y), rect.top) <= Math.min(Math.max(first.y, second.y), rect.bottom)) return true;
    } else if (first.y === second.y && first.y >= rect.top && first.y <= rect.bottom &&
        Math.max(Math.min(first.x, second.x), rect.left) <= Math.min(Math.max(first.x, second.x), rect.right)) return true;
    else if (segmentEntersRect({ start: first, end: second }, rect)) return true;
  }
  return false;
}
export function requireE4ModeGeometry(document: HarnessDesignDocument, points: readonly Point[]): void {
  const step=document.views.e4.e4RoutingMode==="angular"?Math.PI/6:Math.PI/2;
  for(let index=1;index<points.length;index++){
    const a=points[index-1]!,b=points[index]!;
    if(a.x===b.x&&a.y===b.y)continue;
    const turns=Math.atan2(b.y-a.y,b.x-a.x)/step;
    if(Math.abs(turns-Math.round(turns))>1e-6)throw new Error(document.views.e4.e4RoutingMode==="angular"
      ?"Маршрут Э4 допускает только углы, кратные 30°."
      :"При выключенных углах маршрут Э4 должен быть ортогональным.");
  }
}
export function createE4RoutingRequest(
  document: HarnessDesignDocument,
  wire: WireInstance,
  wireId: string,
  explicitStart?: E4RouterAnchor,
  explicitEnd?: E4RouterAnchor,
  excludedWireIds: ReadonlySet<string> = new Set([wireId]),
  partialRoute?: readonly Point[],
) {
  const wireStart = wireEndpointE4Anchor(document, wire.from);
  const wireEnd = wireEndpointE4Anchor(document, wire.to);
  if (!wireStart || !wireEnd) throw new Error("Точки подключения маршрута Э4 не найдены.");
  const fanoutLead=(e:WireEndpoint,anchor:E4RouterAnchor):E4RouterAnchor=>{
    if(isJunctionEndpoint(e)||isScreenEndpoint(e)||anchor.leadDirection===null)return anchor;
    const siblings=document.wires.filter(w=>[w.from,w.to].some(x=>sameEndpoint(x,e))).sort((a,b)=>a.id.localeCompare(b.id));
    return siblings.length>1?{...anchor,leadLength:(anchor.leadLength??defaultE4WireLead)+Math.max(0,siblings.findIndex(w=>w.id===wireId))*24}:anchor;
  };
  const start: E4RouterAnchor = fanoutLead(wire.from,explicitStart ?? {
    ...wireStart,
    obstacleId: isJunctionEndpoint(wire.from) || isScreenEndpoint(wire.from) ? undefined : wire.from.connectorId,
  });
  const end: E4RouterAnchor = fanoutLead(wire.to,explicitEnd ?? {
    ...wireEnd,
    obstacleId: isJunctionEndpoint(wire.to) || isScreenEndpoint(wire.to) ? undefined : wire.to.connectorId,
  });
  const fullWirePoints = (candidate: WireInstance): readonly Point[] | null => {
    const candidateStart = wireEndpointE4Anchor(document, candidate.from);
    const candidateEnd = wireEndpointE4Anchor(document, candidate.to);
    if (!candidateStart || !candidateEnd) return null;
    const points = [candidateStart.position, ...candidate.e4Route, candidateEnd.position];
    try {
      validateE4Polyline(candidateStart, candidate.e4Route, candidateEnd, screenJunctionEnds(candidate) ? 0 : defaultE4WireLead);
      return points;
    } catch {
      return null;
    }
  };
  const relatedScreenIds = new Set([
    ...[wire.from, wire.to].flatMap((endpoint) => isScreenEndpoint(endpoint) ? [endpoint.screenId] : []),
  ]);
  const screenRelatedWireIds = new Set([
    ...document.screens.filter((screen) => relatedScreenIds.has(screen.id)).flatMap((screen) => screen.wireIds),
    ...document.wires.filter((candidate) => [candidate.from, candidate.to].some((endpoint) =>
      isScreenEndpoint(endpoint) && relatedScreenIds.has(endpoint.screenId))).map((candidate) => candidate.id),
  ]);
  return {
    start,
    end,
    obstacles: [
      ...document.connectors.map(connectorE4RoutingObstacle),
      // Wire strokes and labels are soft geometry. They are represented in
      // occupiedRoutes below so a rerouted wire may cross or move them; only
      // connector tables remain hard obstacles.
    ],
    occupiedRoutes: [
      ...document.wires.flatMap((candidate) => {
      if (excludedWireIds.has(candidate.id)) return [];
      // Shield leads follow the finished carrier routes. They must never push
      // those routes around, while carriers still reserve space for each other.
      if (relatedScreenIds.size === 0 && [candidate.from,candidate.to].some(isScreenEndpoint)) return [];
      if (screenRelatedWireIds.has(candidate.id)) return [];
      const points = fullWirePoints(candidate);
      const allowedTouchPoints = document.junctions
        .filter((junction) => junction.wireIds.includes(wireId) && junction.wireIds.includes(candidate.id))
        .map((junction) => junction.position);
      const sharedLeadSegments=[wire.from,wire.to].flatMap(e=>{
        if(isJunctionEndpoint(e)||isScreenEndpoint(e)||![candidate.from,candidate.to].some(x=>sameEndpoint(x,e)))return [];
        const a=wireEndpointE4Anchor(document,e);if(!a?.leadDirection)return [];
        const count=document.wires.filter(w=>[w.from,w.to].some(x=>sameEndpoint(x,e))).length;
        const length=(a.leadLength??defaultE4WireLead)+(count-1)*24;
        const dx=a.leadDirection==='left'?-length:a.leadDirection==='right'?length:0;
        const dy=a.leadDirection==='up'?-length:a.leadDirection==='down'?length:0;
        return [{start:a.position,end:{x:a.position.x+dx,y:a.position.y+dy}}];
      });
      return points ? [{ id: candidate.id, points, allowedTouchPoints,sharedLeadSegments }] : [];
      }),
      ...(partialRoute && partialRoute.length >= 2
        ? [{
          id: `partial:${wireId}`,
          points: partialRoute,
          allowCrossings: false,
          allowedTouchPoint: partialRoute.at(-1),
        }]
        : []),
    ],
    // Leave a visible gap from the table stroke while keeping the mandatory
    // contact lead attached to the table itself.
    options: {
      leadLength: screenJunctionEnds(wire) ? 0 : defaultE4WireLead,
      wireClearance: 8,
      obstacleClearance: 4,
      angleStep: document.views.e4.e4RoutingMode === "angular" ? Math.PI / 6 : undefined,
    },
  };
}
export function orthogonalPathProjectionDistance(points: readonly Point[], point: Point): number {
  let distance = 0;
  let bestDeviation = Number.POSITIVE_INFINITY;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1]!;
    const end = points[index]!;
    const horizontal = start.y === end.y;
    const projected = horizontal
      ? { x: Math.max(Math.min(point.x, Math.max(start.x, end.x)), Math.min(start.x, end.x)), y: start.y }
      : { x: start.x, y: Math.max(Math.min(point.y, Math.max(start.y, end.y)), Math.min(start.y, end.y)) };
    const deviation = Math.abs(point.x - projected.x) + Math.abs(point.y - projected.y);
    const projectedDistance = distance + Math.abs(projected.x - start.x) + Math.abs(projected.y - start.y);
    if (deviation < bestDeviation || (deviation === bestDeviation && projectedDistance < bestDistance)) {
      bestDeviation = deviation;
      bestDistance = projectedDistance;
    }
    distance += Math.abs(end.x - start.x) + Math.abs(end.y - start.y);
  }
  return bestDistance;
}
