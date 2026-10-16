import { type HarnessDesignDocument, type ConnectorInstance, connectorE4TableGeometry, wireEndpointE4Anchor, validateE4Polyline, isJunctionEndpoint, isScreenEndpoint, type Point, type WireInstance, wireE4PathContainsPoint } from "./model";
import { updateConnector, isConnectorEndpoint, findWire, validateJunctionAgainstWires, validateWireGroups, requireJunction } from "./editor-command-invariants";
import { screenJunctionEnds, validateE4WireIds, wireRouteTouchesConnector, createE4RoutingRequest, simplifyE4IntermediateRoute, e4RoutingScore, validateAllE4Wires, orthogonalPathProjectionDistance } from "./command-e4-analysis";
import { routeE4WireThroughWaypoints, validateE4Route, type E4RouterAnchor, routeE4Wire } from "./e4-router";
import { compactAutomaticDifferentialPairs } from "./command-e4-pair-planner";

/** Repairs or upgrades loaded E4 geometry before it is shown or saved. */
export function normalizeE4RoutingDocument(document: HarnessDesignDocument): HarnessDesignDocument {
  return rebuildConnectorE4Wires(document);
}
export function updateConnectorE4Geometry(
  document: HarnessDesignDocument,
  connectorId: string,
  update: (connector: ConnectorInstance) => ConnectorInstance,
): HarnessDesignDocument {
  const before = document.connectors.find((connector) => connector.id === connectorId);
  const changed = updateConnector(document, connectorId, connector => {
    const next = update(connector);
    // Article changes/removal can retire contacts; new rows keep their default order.
    return next.schematic.rowOrder ? { ...next, schematic: { ...next.schematic,
      rowOrder: next.schematic.rowOrder.filter(id => next.contacts.some(contact => contact.id === id)),
    } } : next;
  });
  const after = changed.connectors.find((connector) => connector.id === connectorId);
  if (!before || !after) throw new Error("Соединитель не найден.");
  const oldGeometry = connectorE4TableGeometry(before);
  const newGeometry = connectorE4TableGeometry(after);
  const changedAnchors = before.schematic.orientation !== after.schematic.orientation ||
    oldGeometry.width !== newGeometry.width || oldGeometry.height !== newGeometry.height ||
    before.contacts.some((contact) => {
      const oldPoint = oldGeometry.contactPoints[contact.id];
      const newPoint = newGeometry.contactPoints[contact.id];
      return !oldPoint || !newPoint || oldPoint.x !== newPoint.x || oldPoint.y !== newPoint.y;
    });
  return changedAnchors ? rebuildConnectorE4Wires(changed, connectorId, before) : changed;
}
/** Preserve existing traces where possible, with structurally valid endpoints
 * so a temporary collision can be saved, reopened and repaired by another drag. */
export function retainEditableE4Routes(document: HarnessDesignDocument): HarnessDesignDocument {
  let changed = document;
  for (const wire of document.wires) {
    if (screenJunctionEnds(wire)) {
      changed = routeStraightScreenBranch(changed, wire);
      continue;
    }
    const start = wireEndpointE4Anchor(changed, wire.from);
    const end = wireEndpointE4Anchor(changed, wire.to);
    if (!start || !end) continue;
    try {
      validateE4Polyline(start, wire.e4Route, end);
    } catch {
      const junctions = changed.junctions.filter((junction) => junction.wireIds.includes(wire.id) &&
        ![wire.from, wire.to].some((endpoint) => isJunctionEndpoint(endpoint) && endpoint.junctionId === junction.id));
      const route = routeE4WireThroughWaypoints({ start, end }, junctions.map((junction) => junction.position));
      changed = { ...changed, wires: changed.wires.map((item) => item.id === wire.id
        ? { ...item, e4Route: route.intermediate } : item) };
    }
  }
  return changed;
}
/** Collision diagnostics do not reject edits to electrical data or placement. */
export function e4RoutingIssues(document: HarnessDesignDocument): readonly { wireId: string; message: string }[] {
  return document.wires.flatMap((wire) => {
    try {
      validateE4WireIds(document, [wire.id]);
      return [];
    } catch (error) {
      return [{ wireId: wire.id, message: error instanceof Error ? error.message : "Маршрут требует перестроения." }];
    }
  });
}
export function rebuildConnectorE4Wires(
  document: HarnessDesignDocument,
  changedConnectorId?: string,
  previousConnector?: ConnectorInstance,
): HarnessDesignDocument {
  // Keep manually arranged routes when they remain valid. A route becomes an
  // affected route when its contact anchor moved or a changed/new table now
  // covers it. Completed reroutes reserve their clearance immediately.
  let working = document;
  const preservedManualWireIds = new Set<string>();
  if (changedConnectorId !== undefined && previousConnector !== undefined) {
    for (const wire of working.wires) {
      if (wire.e4RouteMode !== "manual" ||
          (!isConnectorEndpoint(wire.from, changedConnectorId) && !isConnectorEndpoint(wire.to, changedConnectorId))) continue;
      try {
        const preserved = preserveManualE4WireAfterConnectorMove(working, wire.id);
        if (preserved !== null) {
          working = preserved;
          preservedManualWireIds.add(wire.id);
        }
      } catch {
        // The moved table made these guide points invalid. This wire falls
        // through to the ordinary obstacle-aware reroute below.
      }
    }
  }
  const currentConnector = changedConnectorId
    ? working.connectors.find((connector) => connector.id === changedConnectorId)
    : undefined;
  const affectedWireIds = working.wires.flatMap((wire) => {
    const isAutomatic = wire.e4RouteMode !== "manual";
    const connectedToChanged = changedConnectorId !== undefined &&
      (isConnectorEndpoint(wire.from, changedConnectorId) || isConnectorEndpoint(wire.to, changedConnectorId));
    const closeToChangedObstacle = isAutomatic && changedConnectorId !== undefined &&
      [previousConnector, currentConnector].some((connector) => connector !== undefined &&
        wireRouteTouchesConnector(working, wire, connector));
    if (connectedToChanged && preservedManualWireIds.has(wire.id)) return [];
    if (connectedToChanged || closeToChangedObstacle || isAutomatic) return [wire.id];
    const start = wireEndpointE4Anchor(working, wire.from);
    const end = wireEndpointE4Anchor(working, wire.to);
    if (!start || !end) return [wire.id];
    try {
      validateE4Route(
        [start.position, ...wire.e4Route, end.position],
        createE4RoutingRequest(working, wire, wire.id),
      );
      return [];
    } catch {
      return [wire.id];
    }
  });
  return rerouteE4WireBatch(working, [
    ...affectedWireIds,
    ...screenAttachmentWireIds(working, [...affectedWireIds, ...preservedManualWireIds]),
  ]);
}
function preserveManualE4WireAfterConnectorMove(
  document: HarnessDesignDocument,
  wireId: string,
): HarnessDesignDocument | null {
  const wire = findWire(document, wireId);
  // End points in e4Route are generated contact leads. The points between
  // them are the bends and offsets positioned by the operator.
  const guidePoints = wire.e4Route.slice(1, -1);
  if (guidePoints.length === 0) return null;
  const request = createE4RoutingRequest(document, wire, wireId);
  const routed = routeE4WireThroughWaypoints(request, guidePoints);
  const start = wireEndpointE4Anchor(document, wire.from);
  const end = wireEndpointE4Anchor(document, wire.to);
  if (!start || !end) throw new Error("Точки подключения маршрута Э4 не найдены.");
  validateE4Polyline(start, routed.intermediate, end);
  validateE4Route(routed.points, request);
  return {
    ...document,
    wires: document.wires.map((item) => item.id === wireId
      ? { ...item, e4Route: routed.intermediate, e4RouteMode: "manual" as const }
      : item),
  };
}
export function screenAttachmentWireIds(document: HarnessDesignDocument, changedWireIds: readonly string[]): readonly string[] {
  const changed = new Set(changedWireIds);
  const screenIds = new Set(document.screens.filter((screen) =>
    screen.wireIds.some((wireId) => changed.has(wireId))).map((screen) => screen.id));
  return document.wires.flatMap((wire) => !changed.has(wire.id) && [wire.from, wire.to].some((endpoint) =>
    isScreenEndpoint(endpoint) && screenIds.has(endpoint.screenId)) ? [wire.id] : []);
}
export function setE4WireRoute(document: HarnessDesignDocument, wireId: string, route: readonly Point[]): HarnessDesignDocument {
  const wire = findWire(document, wireId);
  if (screenJunctionEnds(wire) && route.length > 0) {
    throw new Error("Подключение экрана к проводу должно быть прямым, без изгибов.");
  }
  const start = wireEndpointE4Anchor(document, wire.from);
  const end = wireEndpointE4Anchor(document, wire.to);
  if (!start || !end) throw new Error("Точки подключения маршрута Э4 не найдены.");
  const copy = route.map(point=>({...point}));
  validateE4Polyline(start, copy, end);
  // A manually moved wire owns the space first. Rebuild automatic neighbours
  // around it so two wires do not deadlock each other as mutual obstacles.
  const changed: HarnessDesignDocument = { ...document, wires: document.wires.map((item) => item.id === wireId
    ? { ...item, e4Route: copy, e4RouteMode: "manual" as const }
    : item) };
  const automaticNeighbours = [...new Set([...changed.wires
    .filter((item) => item.id !== wireId && item.e4RouteMode !== "manual")
    .map((item) => item.id), ...screenAttachmentWireIds(changed, [wireId])])];
  let repaired = changed;
  if (automaticNeighbours.length > 0) {
    try {
      repaired = rerouteE4WireBatch(changed, automaticNeighbours);
    } catch {
      // Keep the explicit manual move visible; the next automatic edit can
      // retry routing when more space becomes available.
    }
  }
  const repairedWire = findWire(repaired, wireId);
  const repairedStart = wireEndpointE4Anchor(repaired, repairedWire.from);
  const repairedEnd = wireEndpointE4Anchor(repaired, repairedWire.to);
  if (!repairedStart || !repairedEnd) throw new Error("Точки подключения маршрута Э4 не найдены.");
  try {
    validateE4Route([repairedStart.position, ...repairedWire.e4Route, repairedEnd.position],
      createE4RoutingRequest(repaired, repairedWire, wireId));
  } catch (error) {
    if (!(error instanceof Error) || !/зазор|пересеч|clearance/i.test(error.message)) throw error;
    const adjusted = nearestValidE4Route(document, wireId, copy);
    if (!adjusted) throw new Error("Рядом с выбранной позицией нет допустимого маршрута Э4 с нужным зазором.");
    repaired = adjusted;
  }
  for (const junction of repaired.junctions.filter((item) => item.wireIds.includes(wireId))) validateJunctionAgainstWires(repaired, junction);
  validateWireGroups(repaired);
  return repaired;
}
export function removeE4WireRoutePoint(
  document: HarnessDesignDocument,
  wireId: string,
  pointIndex: number,
): HarnessDesignDocument {
  const wire = findWire(document, wireId);
  if (!Number.isSafeInteger(pointIndex) || pointIndex < 0 || pointIndex >= wire.e4Route.length) {
    throw new Error("Точка маршрута Э4 не найдена.");
  }
  const start = wireEndpointE4Anchor(document, wire.from);
  const end = wireEndpointE4Anchor(document, wire.to);
  if (!start || !end) throw new Error("Точки подключения маршрута Э4 не найдены.");
  const points = [start.position, ...wire.e4Route, end.position];
  const fullIndex = pointIndex + 1;
  const previous = points[fullIndex - 1]!;
  const selected = points[fullIndex]!;
  const next = points[fullIndex + 1]!;
  const reduced = [...points.slice(1, fullIndex), ...points.slice(fullIndex + 1, -1)];
  if (previous.x !== next.x && previous.y !== next.y) {
    const alternate = selected.x === next.x
      ? { x: previous.x, y: next.y }
      : { x: next.x, y: previous.y };
    const candidates: Point[][] = [];
    // Removing one bend changes the neighboring bend to the other corner of
    // the rectangle. This really removes a stored point instead of replacing
    // it with an indistinguishable copy at the same coordinates.
    if (pointIndex + 1 < wire.e4Route.length) {
      candidates.push(simplifyE4IntermediateRoute(start.position,
        reduced.map((point, index) => index === pointIndex ? alternate : point), end.position));
    }
    if (pointIndex > 0) {
      candidates.push(simplifyE4IntermediateRoute(start.position,
        reduced.map((point, index) => index === pointIndex - 1 ? alternate : point), end.position));
    }
    for (const candidate of candidates) {
      try {
        return setE4WireRoute(document, wireId, candidate);
      } catch {
        // Try adapting the bend on the other side before a full reroute.
      }
    }
    const retainedGuides = reduced.slice(1, -1).filter((_, index) =>
      index !== pointIndex - 1 && index !== pointIndex);
    const routed = routeE4WireThroughWaypoints(
      createE4RoutingRequest(document, wire, wireId),
      retainedGuides,
    );
    return setE4WireRoute(document, wireId, routed.intermediate);
  }
  return setE4WireRoute(document, wireId, reduced);
}
export function rerouteWireE4(document: HarnessDesignDocument, wireId: string): HarnessDesignDocument {
  return rerouteWireE4ThroughJunctions(document, wireId);
}
function routeStraightScreenBranch(document: HarnessDesignDocument, wire: WireInstance): HarnessDesignDocument {
  const ends = screenJunctionEnds(wire)!;
  const anchor = wireEndpointE4Anchor(document, ends.screen)!;
  const junction = requireJunction(document, ends.junction.junctionId);
  const targets = junction.wireIds.filter((id) => id !== wire.id);
  const candidates: Point[] = [];
  for (const targetId of targets) {
    const target = findWire(document, targetId);
    const start = wireEndpointE4Anchor(document, target.from)?.position;
    const end = wireEndpointE4Anchor(document, target.to)?.position;
    if (!start || !end) continue;
    const points = [start, ...target.e4Route, end];
    for (let index = 1; index < points.length; index += 1) {
      const a = points[index - 1]!;
      const b = points[index]!;
      const vertical = anchor.leadDirection === "up" || anchor.leadDirection === "down";
      const divisor=vertical?b.x-a.x:b.y-a.y;
      if(Math.abs(divisor)<1e-8)continue;
      const t=vertical?(anchor.position.x-a.x)/divisor:(anchor.position.y-a.y)/divisor;
      if(t<0||t>1)continue;
      const point=vertical?{x:anchor.position.x,y:a.y+(b.y-a.y)*t}:{x:a.x+(b.x-a.x)*t,y:anchor.position.y};
      const outward = anchor.leadDirection === "up" ? point.y < anchor.position.y
        : anchor.leadDirection === "down" ? point.y > anchor.position.y
          : anchor.leadDirection === "left" ? point.x < anchor.position.x : point.x > anchor.position.x;
      if (outward && targets.every((id) => wireE4PathContainsPoint(document, findWire(document, id), point))) candidates.push(point);
    }
  }
  candidates.sort((a, b) => Math.hypot(a.x - anchor.position.x, a.y - anchor.position.y) -
    Math.hypot(b.x - anchor.position.x, b.y - anchor.position.y));
  for (const point of candidates) {
    const changed = { ...document,
      junctions: document.junctions.map((item) => item.id === junction.id ? { ...item, position: point } : item),
      wires: document.wires.map((item) => item.id === wire.id ? { ...item, e4Route: [] } : item),
    };
    try {
      validateE4WireIds(changed, junction.wireIds);
      return changed;
    } catch { /* Try the next straight span on the same electrical target. */ }
  }
  throw new Error("Для подключения экрана нужен прямой участок до целевого провода без изгибов.");
}
export function rerouteE4WireBatch(document: HarnessDesignDocument, wireIds: readonly string[],firstValid=false): HarnessDesignDocument {
  const baseOrder = [...new Set(wireIds)];
  if (baseOrder.length === 0) return document;
  const byRouteComplexity = [...baseOrder].sort((left, right) => {
    const difference = findWire(document, right).e4Route.length - findWire(document, left).e4Route.length;
    return difference || left.localeCompare(right);
  });
  const candidates = [baseOrder, [...baseOrder].reverse(), byRouteComplexity, [...byRouteComplexity].reverse()];
  // Exhaustive ordering is cheap for the common two-to-four-wire bundle.
  // Larger scenes use bounded deterministic priorities to keep dragging finite.
  if (baseOrder.length <= 4) {
    const visit = (prefix: string[], remaining: string[]) => {
      if (remaining.length === 0) candidates.push(prefix);
      else remaining.forEach((id, index) => visit([...prefix, id], remaining.filter((_, i) => i !== index)));
    };
    visit([], baseOrder);
  }
  for (let offset = 1; offset < Math.min(baseOrder.length, 5); offset += 1) {
    candidates.push([...baseOrder.slice(offset), ...baseOrder.slice(0, offset)]);
  }
  const seen = new Set<string>();
  let lastError: unknown = new Error("Ортогональный маршрут с заданными зазорами не найден.");
  let best: HarnessDesignDocument | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const candidateOrder of candidates) {
    // Screen ports depend on the final routes covered by their oval.
    const order = [...candidateOrder].sort((a, b) =>
      Number([findWire(document, a).from, findWire(document, a).to].some(isScreenEndpoint)) -
      Number([findWire(document, b).from, findWire(document, b).to].some(isScreenEndpoint)));
    const key = order.join("\u0000");
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      let changed = document;
      for (const [index, wireId] of order.entries()) {
        changed = rerouteWireE4ThroughJunctions(changed, wireId, new Set(order.slice(index + 1)));
      }
      validateE4WireIds(changed, order);
      for (const junction of changed.junctions) validateJunctionAgainstWires(changed, junction);
      validateWireGroups(changed);
      if(firstValid)return changed;
      const score = e4RoutingScore(changed);
      if (score < bestScore) {
        best = changed;
        bestScore = score;
      }
    } catch (error) {
      lastError = error;
    }
  }
  if (best) return compactAutomaticDifferentialPairs(best, baseOrder);
  throw lastError;
}
export function reflowWiresAroundLabel(document: HarnessDesignDocument, labelWireId: string): HarnessDesignDocument {
  const routed = rerouteE4WireBatch(document, document.wires
    .filter((wire) => wire.id !== labelWireId && wire.e4RouteMode !== "manual")
    .map((wire) => wire.id));
  validateAllE4Wires(routed);
  return routed;
}
/** A straight bundle acquires parallel jogs when a table changes height.
 * Stagger those new jogs as one small transaction before considering grid
 * search. Only formerly straight conductors participate; authored bends and
 * junction positions are never discarded to make the candidate fit. */
export function spreadMovedE4Shoulders(before:HarnessDesignDocument,document:HarnessDesignDocument,ids:ReadonlySet<string>):HarnessDesignDocument {
  if(document.views.e4.e4RoutingMode==='angular')return document;
  try {validateE4WireIds(document,[...ids]);return document;}catch{/* Try local candidates. */}
  const candidates=document.wires.filter(w=>{
    if(!ids.has(w.id)||w.e4Route.length!==2||w.e4Route[0]!.x!==w.e4Route[1]!.x)return false;
    const old=before.wires.find(item=>item.id===w.id);if(!old)return false;
    const start=wireEndpointE4Anchor(before,old.from),end=wireEndpointE4Anchor(before,old.to);
    return start&&end&&[...old.e4Route,end.position].every(p=>p.y===start.position.y);
  }).sort((a,b)=>a.e4Route[0]!.y-b.e4Route[0]!.y||a.id.localeCompare(b.id));
  if(candidates.length<2)return document;
  const ranks=new Map(candidates.map((w,i)=>[w.id,i]));
  for(const direction of [1,-1])for(const origin of [candidates.length-1,0,(candidates.length-1)/2]){
    const changed={...document,wires:document.wires.map(w=>{
      const rank=ranks.get(w.id);if(rank===undefined)return w;
      const dx=(rank-origin)*24*direction;
      return {...w,e4Route:w.e4Route.map(p=>({x:p.x+dx,y:p.y}))};
    })};
    try {
      validateE4WireIds(changed,[...ids]);
      for(const j of changed.junctions.filter(j=>j.wireIds.some(id=>ids.has(id))))validateJunctionAgainstWires(changed,j);
      return changed;
    }catch{/* Keep the next candidate bounded and deterministic. */}
  }
  return document;
}
/** Keep the author's unaffected corners when the deformed branch is valid.
 * Reflow is a fallback for collisions, not the default for every shared node. */
export function repairE4JunctionBranches(document:HarnessDesignDocument,wireIds:ReadonlySet<string>):HarnessDesignDocument {
  let changed=document;
  const pending=[...wireIds];
  for(const [index,id] of pending.entries()){
    try {
      validateE4WireIds(changed,[id]);
      for(const j of changed.junctions.filter(j=>j.wireIds.includes(id)))validateJunctionAgainstWires(changed,j);
    } catch {
      changed=rerouteWireE4ThroughJunctions(changed,id,new Set(pending.slice(index+1)));
    }
  }
  validateE4WireIds(changed,pending);
  return changed;
}
function nearestValidE4Route(document: HarnessDesignDocument, wireId: string, preferred: readonly Point[]): HarnessDesignDocument | null {
  const wire = findWire(document, wireId);
  const start = wireEndpointE4Anchor(document, wire.from);
  const end = wireEndpointE4Anchor(document, wire.to);
  if (!start || !end) return null;
  const displacement = [0, 8, -8, 16, -16, 24, -24, 32, -32, 48, -48, 64, -64, 96, -96];
  const full = [start.position, ...preferred, end.position];
  const longest = full.slice(1).map((point, index) => ({index,length:Math.abs(point.x-full[index]!.x),horizontal:point.y===full[index]!.y}))
    .filter(item => item.horizontal && item.index>0 && item.index<full.length-2)
    .sort((left,right)=>right.length-left.length)[0];
  const bodyY = longest === undefined ? null : full[longest.index]!.y;
  const candidates = displacement.map(delta => preferred.map((point, index) =>
    bodyY !== null && point.y===bodyY && index>0 && index<preferred.length-1
      ? {x:point.x,y:point.y+delta} : {...point}));
  candidates.push([...wire.e4Route]);
  for (const route of candidates) {
    try {
      validateE4Polyline(start, route, end);
      const candidate = { ...document, wires: document.wires.map(item => item.id === wireId
        ? { ...item, e4Route: route, e4RouteMode: "manual" as const } : item) };
      validateE4Route([start.position, ...route, end.position], createE4RoutingRequest(candidate, wire, wireId));
      return candidate;
    } catch { /* Move to the next nearest legal body position. */ }
  }
  return null;
}
export function rerouteWireE4ThroughJunctions(
  document: HarnessDesignDocument,
  wireId: string,
  additionallyExcludedWireIds: ReadonlySet<string> = new Set(),
): HarnessDesignDocument {
  const wire = findWire(document, wireId);
  if (screenJunctionEnds(wire)) return routeStraightScreenBranch(document, wire);
  const start = wireEndpointE4Anchor(document, wire.from);
  const end = wireEndpointE4Anchor(document, wire.to);
  if (!start || !end) throw new Error("Точки подключения маршрута Э4 не найдены.");
  const endpointJunctionIds = new Set([wire.from, wire.to].filter(isJunctionEndpoint).map((endpoint) => endpoint.junctionId));
  const currentPoints = [start.position, ...wire.e4Route, end.position];
  const waypoints = document.junctions
    .filter((junction) => junction.wireIds.includes(wireId) && !endpointJunctionIds.has(junction.id))
    .map((junction, index) => ({
      junction,
      index,
      distance: orthogonalPathProjectionDistance(currentPoints, junction.position),
    }))
    .sort((left, right) => left.distance - right.distance || left.index - right.index)
    .map(({ junction }) => junction)
    .map((junction): E4RouterAnchor => ({ position: junction.position, leadDirection: null }));
  const anchors: readonly E4RouterAnchor[] = [
    {
      ...start,
      obstacleId: isJunctionEndpoint(wire.from) || isScreenEndpoint(wire.from) ? undefined : wire.from.connectorId,
    },
    ...waypoints,
    {
      ...end,
      obstacleId: isJunctionEndpoint(wire.to) || isScreenEndpoint(wire.to) ? undefined : wire.to.connectorId,
    },
  ];
  if (waypoints.length > 0) {
    try {
      const routed = routeE4WireThroughWaypoints(
        createE4RoutingRequest(document, wire, wireId, anchors[0], anchors.at(-1),
          new Set([wireId, ...additionallyExcludedWireIds])),
        waypoints.map((waypoint) => waypoint.position),
      );
      validateE4Polyline(start, routed.intermediate, end);
      return { ...document, wires: document.wires.map((item) => item.id === wireId
        ? { ...item, e4Route: routed.intermediate } : item) };
    } catch {
      // An unrestricted shortest path can revisit an earlier leg. The
      // sequential builder below reserves completed legs in that case.
    }
  }
  const e4Route: Point[] = [];
  for (let index = 0; index < anchors.length - 1; index += 1) {
    const legStart = anchors[index]!;
    const legEnd = anchors[index + 1]!;
    const occupiedWireIds = new Set([wireId, ...additionallyExcludedWireIds]);
    const routed = routeE4Wire(createE4RoutingRequest(
      document,
      wire,
      wireId,
      legStart,
      legEnd,
      occupiedWireIds,
      e4Route.length > 0 ? [start.position, ...e4Route] : undefined,
    ));
    e4Route.push(...routed.intermediate);
    if (index < anchors.length - 2) e4Route.push({ ...legEnd.position });
  }
  validateE4Polyline(start, e4Route, end);
  validateE4Route(
    [start.position, ...e4Route, end.position],
    createE4RoutingRequest(document, wire, wireId, undefined, undefined, new Set([wireId, ...additionallyExcludedWireIds])),
  );
  return { ...document, wires: document.wires.map((item) => item.id === wireId ? { ...item, e4Route } : item) };
}
export function addTargetWireToJunction(
  document: HarnessDesignDocument,
  junctionId: string,
  targetWireId: string,
): HarnessDesignDocument {
  const junction = requireJunction(document, junctionId);
  const targetWire = findWire(document, targetWireId);
  if (!wireE4PathContainsPoint(document, targetWire, junction.position)) {
    throw new Error("Целевой провод не проходит через существующий узел соединения.");
  }
  const changed = junction.wireIds.includes(targetWireId) ? document : {
    ...document,
    junctions: document.junctions.map((item) => item.id === junctionId
      ? { ...item, wireIds: [...item.wireIds, targetWireId] }
      : item),
  };
  validateJunctionAgainstWires(changed, changed.junctions.find((item) => item.id === junctionId)!);
  return changed;
}
