import type { Point } from "./model";
import { straightLeadEnd } from "./route-lead";

export type E4RouteDirection = "left" | "right" | "up" | "down" | null;

export interface E4RouterAnchor {
  /** A small symbol port may use a shorter lead than a component contact. */
  readonly leadLength?: number;
  readonly position: Point;
  readonly leadDirection: E4RouteDirection;
  /** The obstacle containing this contact. Its outward lead may leave this obstacle. */
  readonly obstacleId?: string;
}

export interface E4RoutingObstacle {
  readonly id?: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface E4OccupiedRoute {
  readonly id?: string;
  /** Full route, including both endpoint positions. */
  readonly points: readonly Point[];
  /** False reserves this route as part of the wire currently being built. */
  readonly allowCrossings?: boolean;
  /** Only this endpoint may touch a non-crossable route. */
  readonly allowedTouchPoint?: Point;
  /** Electrical junctions at which this route may intentionally touch the route being built. */
  readonly allowedTouchPoints?: readonly Point[];
}

export interface E4RouterOptions {
  /** Required straight distance outward from a directed contact. Defaults to 24. */
  readonly leadLength?: number;
  /** Requested distance between parallel portions. The bridge footprint is the hard minimum. */
  readonly wireClearance?: number;
  /** Extra space around table rectangles. Defaults to 0. */
  readonly obstacleClearance?: number;
  /** Extra search coordinate outside all supplied geometry. */
  readonly searchMargin?: number;
  /** Guards an accidental unbounded UI workload. Defaults to 250,000 grid nodes. */
  readonly maxGridNodes?: number;
}

export interface E4RoutingRequest {
  readonly start: E4RouterAnchor;
  readonly end: E4RouterAnchor;
  readonly obstacles?: readonly E4RoutingObstacle[];
  /** Routes already on the canvas. The route currently being rebuilt must be omitted. */
  readonly occupiedRoutes?: readonly E4OccupiedRoute[];
  readonly options?: E4RouterOptions;
}

export interface E4RouteResult {
  /** Full route, including the exact start and end contact positions. */
  readonly points: readonly Point[];
  /** The same representation used by WireInstance.e4Route. */
  readonly intermediate: readonly Point[];
  readonly length: number;
  readonly bends: number;
}

interface NormalizedOptions {
  readonly leadLength: number;
  readonly wireClearance: number;
  readonly obstacleClearance: number;
  readonly searchMargin: number;
  readonly maxGridNodes: number;
}

interface Rect {
  readonly id?: string;
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

interface Segment {
  readonly start: Point;
  readonly end: Point;
  readonly orientation: "horizontal" | "vertical";
}

interface OccupiedSegment extends Segment {
  readonly allowCrossings: boolean;
  readonly allowedTouchPoints: readonly Point[];
}

interface OccupiedBend {
  readonly point: Point;
  readonly allowedTouchPoints: readonly Point[];
}

interface QueueItem {
  readonly state: number;
  /** Routing score: physical length plus an ECAD crossing surcharge. */
  readonly length: number;
  readonly bends: number;
}

const EPSILON = 1e-9;
const NO_DIRECTION = 0;
const HORIZONTAL = 1;
const VERTICAL = 2;

/** A seven-unit bridge also needs space for its coloured feet and halo. */
export const E4_BRIDGE_RADIUS = 7;
// The visible bridge includes two-unit coloured feet plus a seven-pixel halo.
// Keep complete symbols separate, not only their centre-line arcs.
export const E4_BRIDGE_MINIMUM_SPACING = E4_BRIDGE_RADIUS * 2 + 7;

/**
 * Finds an obstacle-aware orthogonal route minimizing length plus crossing
 * surcharge; the number of bends is the deterministic tie-breaker.
 */
export function routeE4Wire(request: E4RoutingRequest): E4RouteResult {
  return routeE4WireThroughWaypoints(request, []);
}

/** Searches one route through ordered mandatory points with the same routing score. */
export function routeE4WireThroughWaypoints(
  request: E4RoutingRequest,
  waypoints: readonly Point[],
): E4RouteResult {
  const input = normalizeRequest(request);
  waypoints.forEach((point, index) => requirePoint(point, `Обязательная точка ${index + 1}`));
  const startLead = leadPoint(input.start, input.options.leadLength, input.obstacles);
  const endLead = leadPoint(input.end, input.options.leadLength, input.obstacles);
  const fixedLeads = createFixedLeads(input.start.position, startLead, endLead, input.end.position);

  validateForcedLead(input.start, startLead, true, input);
  validateForcedLead(input.end, endLead, false, input);

  const { xs, ys } = buildGridCoordinates(input, startLead, endLead, waypoints);
  const gridNodeCount = xs.length * ys.length;
  const searchNodeCount = gridNodeCount * (waypoints.length + 1);
  if (searchNodeCount > input.options.maxGridNodes) {
    throw new Error(`Сетка автотрассировки слишком велика (${searchNodeCount} узлов).`);
  }

  const startNode = nodeIndex(xs, ys, startLead);
  const endNode = nodeIndex(xs, ys, endLead);
  const waypointNodes = waypoints.map((point) => nodeIndex(xs, ys, point));
  const graphPoints = findShortestGridPath(
    xs,
    ys,
    startNode,
    endNode,
    waypointNodes,
    input,
    fixedLeads,
  );
  if (graphPoints === null) throw new Error("Ортогональный маршрут с заданными зазорами не найден.");

  const points = canonicalizeRouteAxes(simplifyPolyline([
    input.start.position,
    ...graphPoints,
    input.end.position,
  ]), input.start.position, input.end.position);
  validateE4Route(points, request);
  return {
    points,
    intermediate: points.slice(1, -1),
    length: polylineLength(points),
    bends: Math.max(0, points.length - 2),
  };
}

/** Validates a full route against the same rules used by routeE4Wire. */
export function validateE4Route(points: readonly Point[], request: E4RoutingRequest): void {
  const input = normalizeRequest(request);
  if (points.length < 2 || !samePoint(points[0]!, input.start.position) ||
      !samePoint(points.at(-1)!, input.end.position)) {
    throw new Error("Маршрут должен начинаться и заканчиваться в заданных контактах.");
  }
  const segments = toSegments(points, "Маршрут");
  validateRouteLead(input.start, {...segments[0]!,end:straightLeadEnd(points)}, true, input.options.leadLength);
  validateRouteLead(input.end, {...segments.at(-1)!,start:straightLeadEnd([...points].reverse())}, false, input.options.leadLength);

  for (let index = 0; index < segments.length; index += 1) {
    const ignoredObstacleIds = new Set<string>();
    if (index === 0 && input.start.obstacleId !== undefined) ignoredObstacleIds.add(input.start.obstacleId);
    if (index === segments.length - 1 && input.end.obstacleId !== undefined) ignoredObstacleIds.add(input.end.obstacleId);
    validateSegmentAgainstObstacles(segments[index]!, input.obstacles, ignoredObstacleIds);
    validateSegmentAgainstOccupied(segments[index]!, input.occupiedSegments, input.options.wireClearance);
    const compulsoryLead = index === 0 && input.start.leadDirection !== null ||
      index === segments.length - 1 && input.end.leadDirection !== null;
    if (!compulsoryLead) {
      validateSegmentAgainstOccupiedBends(segments[index]!, input.occupiedBends, input.options.wireClearance);
    }
  }
  // A crossing is allowed in the middle of two straight portions, but a bend
  // cannot be placed inside another route's bridge footprint. Contact leads
  // are deliberately exempt: the short straight lead is compulsory geometry.
  for (let index = 1; index < points.length - 1; index += 1) {
    if (index === 1 && input.start.leadDirection !== null) continue;
    if (index === points.length - 2 && input.end.leadDirection !== null) continue;
    if (!bendHasOccupiedClearance(points[index]!, input.occupiedSegments, input.options.wireClearance)) {
      throw new Error("Между углом провода и другим проводом не выдержан зазор.");
    }
  }
  validateNoSelfIntersections(segments);
}

export function polylineLength(points: readonly Point[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += Math.abs(points[index]!.x - points[index - 1]!.x) +
      Math.abs(points[index]!.y - points[index - 1]!.y);
  }
  return length;
}

function normalizeRequest(request: E4RoutingRequest): {
  readonly start: E4RouterAnchor;
  readonly end: E4RouterAnchor;
  readonly obstacles: readonly Rect[];
  readonly occupiedSegments: readonly OccupiedSegment[];
  readonly occupiedBends: readonly OccupiedBend[];
  readonly occupiedPoints: readonly Point[];
  readonly options: NormalizedOptions;
} {
  validateAnchor(request.start, "Начальный контакт");
  validateAnchor(request.end, "Конечный контакт");
  const options = normalizeOptions(request.options);
  const obstacleIds = new Set<string>();
  const obstacles = (request.obstacles ?? []).map((obstacle, index): Rect => {
    requireFinite(obstacle.x, `Препятствие ${index + 1}`);
    requireFinite(obstacle.y, `Препятствие ${index + 1}`);
    requireFinite(obstacle.width, `Препятствие ${index + 1}`);
    requireFinite(obstacle.height, `Препятствие ${index + 1}`);
    if (obstacle.width <= 0 || obstacle.height <= 0) {
      throw new Error(`Препятствие ${index + 1} должно иметь положительный размер.`);
    }
    if (obstacle.id !== undefined && obstacleIds.has(obstacle.id)) {
      throw new Error("ID препятствий должны быть уникальны.");
    }
    if (obstacle.id !== undefined) obstacleIds.add(obstacle.id);
    return {
      id: obstacle.id,
      left: obstacle.x - options.obstacleClearance,
      right: obstacle.x + obstacle.width + options.obstacleClearance,
      top: obstacle.y - options.obstacleClearance,
      bottom: obstacle.y + obstacle.height + options.obstacleClearance,
    };
  });
  const occupiedSegments: OccupiedSegment[] = [];
  const occupiedBends: OccupiedBend[] = [];
  const occupiedPoints: Point[] = [];
  for (const route of request.occupiedRoutes ?? []) {
    const segments = toSegments(route.points, `Занятый маршрут${route.id ? ` ${route.id}` : ""}`);
    const allowedTouchPoints = [
      ...(route.allowedTouchPoint ? [route.allowedTouchPoint] : []),
      ...(route.allowedTouchPoints ?? []),
    ];
    occupiedSegments.push(...segments.map((segment) => ({
      ...segment,
      allowCrossings: route.allowCrossings !== false,
      allowedTouchPoints,
    })));
    for (let index = 1; route.allowCrossings !== false && index < segments.length; index += 1) {
      if (segments[index - 1]!.orientation !== segments[index]!.orientation) {
        occupiedBends.push({ point: route.points[index]!, allowedTouchPoints });
      }
    }
    occupiedPoints.push(...route.points);
  }
  return { start: request.start, end: request.end, obstacles, occupiedSegments, occupiedBends, occupiedPoints, options };
}

function normalizeOptions(options: E4RouterOptions | undefined): NormalizedOptions {
  const leadLength = options?.leadLength ?? 24;
  const requestedWireClearance = options?.wireClearance ?? 8;
  const obstacleClearance = options?.obstacleClearance ?? 0;
  const maxGridNodes = options?.maxGridNodes ?? 250_000;
  for (const [name, value] of [
    ["Длина прямого участка", leadLength],
    ["Зазор между проводами", requestedWireClearance],
    ["Зазор до препятствия", obstacleClearance],
  ] as const) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`${name} задан неверно.`);
  }
  if (!Number.isSafeInteger(maxGridNodes) || maxGridNodes < 4) {
    throw new Error("Ограничение размера сетки задано неверно.");
  }
  const wireClearance = Math.max(requestedWireClearance, E4_BRIDGE_MINIMUM_SPACING);
  const defaultMargin = Math.max(16, leadLength, wireClearance, obstacleClearance);
  const searchMargin = options?.searchMargin ?? defaultMargin;
  if (!Number.isFinite(searchMargin) || searchMargin <= 0) {
    throw new Error("Поле поиска автотрассировки задано неверно.");
  }
  return { leadLength, wireClearance, obstacleClearance, searchMargin, maxGridNodes };
}

function validateAnchor(anchor: E4RouterAnchor, label: string): void {
  requirePoint(anchor.position, label);
  if(anchor.leadLength!==undefined&&(!Number.isFinite(anchor.leadLength)||anchor.leadLength<0))throw new Error(`${label}: неверная длина выхода.`);
  if (!["left", "right", "up", "down", null].includes(anchor.leadDirection)) {
    throw new Error(`${label} имеет неизвестное направление выхода.`);
  }
}

function requirePoint(point: Point, label: string): void {
  requireFinite(point.x, label);
  requireFinite(point.y, label);
}

function requireFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new Error(`${label} задан неверно.`);
}

function leadPoint(anchor: E4RouterAnchor, length: number, obstacles: readonly Rect[]): Point {
  length=Math.min(length,anchor.leadLength??length);
  const ownObstacle = anchor.obstacleId === undefined
    ? undefined
    : obstacles.find((obstacle) => obstacle.id === anchor.obstacleId);
  switch (anchor.leadDirection) {
    case "left": return {
      x: Math.min(anchor.position.x - length, ownObstacle?.left ?? anchor.position.x - length),
      y: anchor.position.y,
    };
    case "right": return {
      x: Math.max(anchor.position.x + length, ownObstacle?.right ?? anchor.position.x + length),
      y: anchor.position.y,
    };
    case "up": return {
      x: anchor.position.x,
      y: Math.min(anchor.position.y - length, ownObstacle?.top ?? anchor.position.y - length),
    };
    case "down": return {
      x: anchor.position.x,
      y: Math.max(anchor.position.y + length, ownObstacle?.bottom ?? anchor.position.y + length),
    };
    case null: return anchor.position;
  }
}

function createFixedLeads(start: Point, startLead: Point, endLead: Point, end: Point): readonly {
  readonly segment: Segment;
  readonly graphEndpoint: Point;
}[] {
  const result: { segment: Segment; graphEndpoint: Point }[] = [];
  if (!samePoint(start, startLead)) {
    result.push({ segment: createSegment(start, startLead, "Начальный вывод"), graphEndpoint: startLead });
  }
  if (!samePoint(endLead, end)) {
    result.push({ segment: createSegment(endLead, end, "Конечный вывод"), graphEndpoint: endLead });
  }
  return result;
}

function validateForcedLead(
  anchor: E4RouterAnchor,
  lead: Point,
  isStart: boolean,
  input: ReturnType<typeof normalizeRequest>,
): void {
  if (samePoint(anchor.position, lead)) return;
  const segment = isStart
    ? createSegment(anchor.position, lead, "Прямой участок")
    : createSegment(lead, anchor.position, "Прямой участок");
  const ignored = anchor.obstacleId === undefined ? new Set<string>() : new Set([anchor.obstacleId]);
  validateSegmentAgainstObstacles(segment, input.obstacles, ignored);
  validateSegmentAgainstOccupied(segment, input.occupiedSegments, input.options.wireClearance);
}

function buildGridCoordinates(
  input: ReturnType<typeof normalizeRequest>,
  startLead: Point,
  endLead: Point,
  waypoints: readonly Point[] = [],
): { readonly xs: readonly number[]; readonly ys: readonly number[] } {
  const xs = [input.start.position.x, input.end.position.x, startLead.x, endLead.x];
  const ys = [input.start.position.y, input.end.position.y, startLead.y, endLead.y];
  xs.push(...waypoints.map((point) => point.x));
  ys.push(...waypoints.map((point) => point.y));
  for (const obstacle of input.obstacles) {
    xs.push(obstacle.left, obstacle.right);
    ys.push(obstacle.top, obstacle.bottom);
  }
  for (const point of input.occupiedPoints) {
    xs.push(point.x);
    ys.push(point.y);
  }
  for (const segment of input.occupiedSegments) {
    if (segment.orientation === "horizontal") {
      ys.push(segment.start.y - input.options.wireClearance, segment.start.y + input.options.wireClearance);
      xs.push(
        Math.min(segment.start.x, segment.end.x) - input.options.wireClearance,
        Math.max(segment.start.x, segment.end.x) + input.options.wireClearance,
      );
    } else {
      xs.push(segment.start.x - input.options.wireClearance, segment.start.x + input.options.wireClearance);
      ys.push(
        Math.min(segment.start.y, segment.end.y) - input.options.wireClearance,
        Math.max(segment.start.y, segment.end.y) + input.options.wireClearance,
      );
    }
  }
  const currentXs = uniqueSorted(xs);
  const currentYs = uniqueSorted(ys);
  xs.push(currentXs[0]! - input.options.searchMargin, currentXs.at(-1)! + input.options.searchMargin);
  ys.push(currentYs[0]! - input.options.searchMargin, currentYs.at(-1)! + input.options.searchMargin);
  return { xs: uniqueSorted(xs), ys: uniqueSorted(ys) };
}

function uniqueSorted(values: readonly number[]): readonly number[] {
  const sorted = [...values].sort((left, right) => left - right);
  const result: number[] = [];
  for (const value of sorted) {
    if (result.length === 0 || Math.abs(value - result.at(-1)!) > EPSILON) result.push(value);
  }
  return result;
}

function nodeIndex(xs: readonly number[], ys: readonly number[], point: Point): number {
  const xIndex = xs.findIndex((value) => Math.abs(value - point.x) <= EPSILON);
  const yIndex = ys.findIndex((value) => Math.abs(value - point.y) <= EPSILON);
  if (xIndex < 0 || yIndex < 0) throw new Error("Внутренняя ошибка сетки автотрассировки.");
  return yIndex * xs.length + xIndex;
}

function findShortestGridPath(
  xs: readonly number[],
  ys: readonly number[],
  startNode: number,
  endNode: number,
  waypointNodes: readonly number[],
  input: ReturnType<typeof normalizeRequest>,
  fixedLeads: ReturnType<typeof createFixedLeads>,
): readonly Point[] | null {
  const gridNodeCount = xs.length * ys.length;
  const phaseCount = waypointNodes.length + 1;
  const stateCount = gridNodeCount * phaseCount * 3;
  const lengths = new Float64Array(stateCount);
  lengths.fill(Number.POSITIVE_INFINITY);
  const bends = new Int32Array(stateCount);
  bends.fill(0x7fffffff);
  const previous = new Int32Array(stateCount);
  previous.fill(-1);
  const startDirection = fixedLeads.some((fixed) => samePoint(fixed.graphEndpoint, pointForNode(xs, ys, startNode)))
    ? directionCode(fixedLeads.find((fixed) => samePoint(fixed.graphEndpoint, pointForNode(xs, ys, startNode)))!.segment)
    : NO_DIRECTION;
  const endDirection = fixedLeads.some((fixed) => samePoint(fixed.graphEndpoint, pointForNode(xs, ys, endNode)))
    ? directionCode(fixedLeads.find((fixed) => samePoint(fixed.graphEndpoint, pointForNode(xs, ys, endNode)))!.segment)
    : NO_DIRECTION;
  const advancePhase = (phase: number, node: number) => {
    let result = phase;
    while (result < waypointNodes.length && waypointNodes[result] === node) result += 1;
    return result;
  };
  const stateIndex = (phase: number, node: number, direction: number) =>
    (phase * gridNodeCount + node) * 3 + direction;
  const startPhase = advancePhase(0, startNode);
  if (startNode === endNode && startPhase === waypointNodes.length) {
    return [pointForNode(xs, ys, startNode)];
  }
  const startState = stateIndex(startPhase, startNode, startDirection);
  lengths[startState] = 0;
  bends[startState] = 0;
  const queue = new MinQueue();
  queue.push({ state: startState, length: 0, bends: 0 });

  while (queue.size > 0) {
    const current = queue.pop()!;
    if (!sameCost(current.length, current.bends, lengths[current.state]!, bends[current.state]!)) continue;
    const phaseAndNode = Math.floor(current.state / 3);
    const node = phaseAndNode % gridNodeCount;
    const phase = Math.floor(phaseAndNode / gridNodeCount);
    const previousDirection = current.state % 3;
    for (const neighbor of neighbors(xs, ys, node)) {
      const from = pointForNode(xs, ys, node);
      const to = pointForNode(xs, ys, neighbor.node);
      const segment = createSegment(from, to, "Ребро сетки");
      if (!gridSegmentIsAvailable(segment, input, fixedLeads)) continue;
      const nextDirection = neighbor.direction;
      if (previousDirection !== NO_DIRECTION && previousDirection !== nextDirection &&
          !samePoint(from, pointForNode(xs, ys, startNode)) &&
          !samePoint(from, pointForNode(xs, ys, endNode)) &&
          !bendHasOccupiedClearance(from, input.occupiedSegments, input.options.wireClearance)) continue;
      // A crossing remains legal for the explicit/manual editor, but the
      // automatic ECAD route should prefer a nearby parallel detour. Grid
      // edges often meet on the occupied route coordinate, so endpoint hits
      // count as half and the two adjacent edges form one crossing.
      const nextLength = current.length + neighbor.length +
        automaticCrossingSurcharge(segment, input.occupiedSegments, input.options.wireClearance);
      const nextBends = current.bends +
        (previousDirection !== NO_DIRECTION && previousDirection !== nextDirection ? 1 : 0);
      const nextPhase = advancePhase(phase, neighbor.node);
      const nextState = stateIndex(nextPhase, neighbor.node, nextDirection);
      if (!costIsBetter(nextLength, nextBends, lengths[nextState]!, bends[nextState]!)) continue;
      lengths[nextState] = nextLength;
      bends[nextState] = nextBends;
      previous[nextState] = current.state;
      queue.push({ state: nextState, length: nextLength, bends: nextBends });
    }
  }

  let endState = -1;
  for (const direction of [NO_DIRECTION, HORIZONTAL, VERTICAL]) {
    const state = stateIndex(waypointNodes.length, endNode, direction);
    const finalBends = bends[state]! +
      (endDirection !== NO_DIRECTION && direction !== NO_DIRECTION && direction !== endDirection ? 1 : 0);
    const bestDirection = endState < 0 ? NO_DIRECTION : endState % 3;
    const bestFinalBends = endState < 0 ? 0x7fffffff : bends[endState]! +
      (endDirection !== NO_DIRECTION && bestDirection !== NO_DIRECTION && bestDirection !== endDirection ? 1 : 0);
    if (endState < 0 || costIsBetter(lengths[state]!, finalBends, lengths[endState]!, bestFinalBends)) {
      endState = state;
    }
  }
  if (endState < 0 || !Number.isFinite(lengths[endState]!)) return null;

  const reversed: Point[] = [];
  for (let state = endState; state >= 0; state = previous[state]!) {
    const phaseAndNode = Math.floor(state / 3);
    reversed.push(pointForNode(xs, ys, phaseAndNode % gridNodeCount));
    if (state === startState) break;
  }
  if (!samePoint(reversed.at(-1)!, pointForNode(xs, ys, startNode))) return null;
  return reversed.reverse();
}

function automaticCrossingSurcharge(
  segment: Segment,
  occupiedSegments: readonly OccupiedSegment[],
  wireClearance: number,
): number {
  const crossingCost = wireClearance * 4;
  let result = 0;
  for (const occupied of occupiedSegments) {
    if (!occupied.allowCrossings || occupied.orientation === segment.orientation) continue;
    const intersection = segmentIntersection(segment, occupied);
    if (intersection.kind !== "point") continue;
    const atRouteEndpoint = samePoint(intersection.point, segment.start) ||
      samePoint(intersection.point, segment.end);
    result += atRouteEndpoint ? crossingCost / 2 : crossingCost;
  }
  return result;
}

function directionCode(segment: Segment): number {
  return segment.orientation === "horizontal" ? HORIZONTAL : VERTICAL;
}

function neighbors(
  xs: readonly number[],
  ys: readonly number[],
  node: number,
): readonly { readonly node: number; readonly direction: number; readonly length: number }[] {
  const xIndex = node % xs.length;
  const yIndex = Math.floor(node / xs.length);
  const result: { node: number; direction: number; length: number }[] = [];
  if (xIndex > 0) result.push({ node: node - 1, direction: HORIZONTAL, length: xs[xIndex]! - xs[xIndex - 1]! });
  if (xIndex + 1 < xs.length) result.push({ node: node + 1, direction: HORIZONTAL, length: xs[xIndex + 1]! - xs[xIndex]! });
  if (yIndex > 0) result.push({ node: node - xs.length, direction: VERTICAL, length: ys[yIndex]! - ys[yIndex - 1]! });
  if (yIndex + 1 < ys.length) result.push({ node: node + xs.length, direction: VERTICAL, length: ys[yIndex + 1]! - ys[yIndex]! });
  return result;
}

function pointForNode(xs: readonly number[], ys: readonly number[], node: number): Point {
  return { x: xs[node % xs.length]!, y: ys[Math.floor(node / xs.length)]! };
}

function gridSegmentIsAvailable(
  segment: Segment,
  input: ReturnType<typeof normalizeRequest>,
  fixedLeads: ReturnType<typeof createFixedLeads>,
): boolean {
  try {
    validateSegmentAgainstObstacles(segment, input.obstacles, new Set());
    validateSegmentAgainstOccupied(segment, input.occupiedSegments, input.options.wireClearance);
    validateSegmentAgainstOccupiedBends(segment, input.occupiedBends, input.options.wireClearance);
    for (const fixed of fixedLeads) {
      const intersection = segmentIntersection(segment, fixed.segment);
      if (intersection.kind === "none") continue;
      if (intersection.kind === "point" && samePoint(intersection.point, fixed.graphEndpoint) &&
          (samePoint(segment.start, fixed.graphEndpoint) || samePoint(segment.end, fixed.graphEndpoint))) continue;
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function validateSegmentAgainstObstacles(
  segment: Segment,
  obstacles: readonly Rect[],
  ignoredObstacleIds: ReadonlySet<string>,
): void {
  for (const obstacle of obstacles) {
    if (obstacle.id !== undefined && ignoredObstacleIds.has(obstacle.id)) continue;
    if (segmentCrossesRectInterior(segment, obstacle)) {
      throw new Error(`Маршрут проходит через препятствие${obstacle.id ? ` ${obstacle.id}` : ""}.`);
    }
  }
}

function segmentCrossesRectInterior(segment: Segment, rect: Rect): boolean {
  if (segment.orientation === "horizontal") {
    if (!(segment.start.y > rect.top + EPSILON && segment.start.y < rect.bottom - EPSILON)) return false;
    return positiveOverlap(segment.start.x, segment.end.x, rect.left, rect.right);
  }
  if (!(segment.start.x > rect.left + EPSILON && segment.start.x < rect.right - EPSILON)) return false;
  return positiveOverlap(segment.start.y, segment.end.y, rect.top, rect.bottom);
}

function validateSegmentAgainstOccupied(
  segment: Segment,
  occupiedSegments: readonly OccupiedSegment[],
  clearance: number,
): void {
  for (const occupied of occupiedSegments) {
    if (segment.orientation !== occupied.orientation) {
      const intersection = segmentIntersection(segment, occupied);
      if (intersection.kind === "point") {
        if (touchIsAllowed(intersection.point, segment, occupied)) continue;
        if (!occupied.allowCrossings) {
          throw new Error("Маршрут пересекает уже построенную часть самого себя.");
        }
        continue;
      }
      continue;
    }
    const projectionsOverlap = segment.orientation === "horizontal"
      ? positiveOverlap(segment.start.x, segment.end.x, occupied.start.x, occupied.end.x)
      : positiveOverlap(segment.start.y, segment.end.y, occupied.start.y, occupied.end.y);
    if (!projectionsOverlap) {
      const intersection = segmentIntersection(segment, occupied);
      if (intersection.kind === "point" && touchIsAllowed(intersection.point, segment, occupied)) continue;
      if (intersection.kind === "point" && !occupied.allowCrossings) {
        throw new Error("Маршрут касается уже построенной части самого себя.");
      }
      continue;
    }
    const distance = segment.orientation === "horizontal"
      ? Math.abs(segment.start.y - occupied.start.y)
      : Math.abs(segment.start.x - occupied.start.x);
    if (distance <= EPSILON) throw new Error("Маршрут коллинеарно накладывается на другой провод.");
    if (distance + EPSILON < clearance) throw new Error("Между параллельными проводами не выдержан зазор.");
  }
}

function validateSegmentAgainstOccupiedBends(
  segment: Segment,
  occupiedBends: readonly OccupiedBend[],
  clearance: number,
): void {
  for (const bend of occupiedBends) {
    if (bend.allowedTouchPoints.some((allowed) => samePoint(bend.point, allowed)) &&
        isSegmentEndpoint(bend.point, segment)) continue;
    if (pointToSegmentDistance(bend.point, segment) + EPSILON < clearance) {
      throw new Error("Между проводом и углом другого провода не выдержан зазор.");
    }
  }
}

function bendHasOccupiedClearance(
  point: Point,
  occupiedSegments: readonly OccupiedSegment[],
  clearance: number,
): boolean {
  return occupiedSegments.every((occupied) =>
    occupied.allowedTouchPoints.some((allowed) => samePoint(point, allowed)) ||
    pointToSegmentDistance(point, occupied) + EPSILON >= clearance);
}

function touchIsAllowed(point: Point, segment: Segment, occupied: OccupiedSegment): boolean {
  return isSegmentEndpoint(point, segment) &&
    occupied.allowedTouchPoints.some((allowed) => samePoint(point, allowed));
}

function isSegmentEndpoint(point: Point, segment: Segment): boolean {
  return samePoint(point, segment.start) || samePoint(point, segment.end);
}

function pointToSegmentDistance(point: Point, segment: Segment): number {
  const closest = segment.orientation === "horizontal"
    ? {
      x: clamp(point.x, segment.start.x, segment.end.x),
      y: segment.start.y,
    }
    : {
      x: segment.start.x,
      y: clamp(point.y, segment.start.y, segment.end.y),
    };
  return Math.hypot(point.x - closest.x, point.y - closest.y);
}

function clamp(value: number, first: number, second: number): number {
  return Math.max(Math.min(first, second), Math.min(Math.max(first, second), value));
}

function validateRouteLead(anchor: E4RouterAnchor, segment: Segment, isStart: boolean, length: number): void {
  length=Math.min(length,anchor.leadLength??length);
  if (anchor.leadDirection === null) return;
  const adjacent = isStart ? segment.end : segment.start;
  const deltaX = adjacent.x - anchor.position.x;
  const deltaY = adjacent.y - anchor.position.y;
  const distance = (() => {
    switch (anchor.leadDirection) {
      case "left": return -deltaX;
      case "right": return deltaX;
      case "up": return -deltaY;
      case "down": return deltaY;
      case null: return 0;
    }
  })();
  const aligned = anchor.leadDirection === "left" || anchor.leadDirection === "right"
    ? Math.abs(deltaY) <= EPSILON
    : Math.abs(deltaX) <= EPSILON;
  if (!aligned || distance + EPSILON < length) {
    throw new Error("Маршрут должен иметь прямой участок наружу от контакта.");
  }
}

function validateNoSelfIntersections(segments: readonly Segment[]): void {
  for (let leftIndex = 0; leftIndex < segments.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < segments.length; rightIndex += 1) {
      const left = segments[leftIndex]!;
      const right = segments[rightIndex]!;
      const intersection = segmentIntersection(left, right);
      if (intersection.kind === "none") continue;
      if (rightIndex === leftIndex + 1 && intersection.kind === "point" &&
          samePoint(intersection.point, left.end) &&
          samePoint(intersection.point, right.start)) continue;
      throw new Error("Маршрут не должен пересекать или накладывать сам себя.");
    }
  }
}

function toSegments(points: readonly Point[], label: string): readonly Segment[] {
  if (points.length < 2) throw new Error(`${label} должен содержать не менее двух точек.`);
  points.forEach((point) => requirePoint(point, label));
  return points.slice(1).map((point, index) => createSegment(points[index]!, point, label));
}

function createSegment(start: Point, end: Point, label: string): Segment {
  const horizontal = Math.abs(start.y - end.y) <= EPSILON;
  const vertical = Math.abs(start.x - end.x) <= EPSILON;
  if (horizontal === vertical) throw new Error(`${label} должен состоять из ненулевых ортогональных сегментов.`);
  return { start, end, orientation: horizontal ? "horizontal" : "vertical" };
}

function simplifyPolyline(points: readonly Point[]): readonly Point[] {
  const distinct = points.filter((point, index) => index === 0 || !samePoint(point, points[index - 1]!));
  const result: Point[] = [];
  for (const point of distinct) {
    while (result.length >= 2 && pointsAreCollinear(result.at(-2)!, result.at(-1)!, point) &&
      continuesForward(result.at(-2)!, result.at(-1)!, point)) {
      result.pop();
    }
    result.push(point);
  }
  return result;
}

/** Keeps persisted coordinates exact when the grid merged values within ε. */
function canonicalizeRouteAxes(
  points: readonly Point[],
  start: Point,
  end: Point,
): readonly Point[] {
  const result = points.map((point) => ({ ...point }));
  if (result.length < 2) return [{ ...start }, { ...end }];
  result[0] = { ...start };
  for (let index = 1; index < result.length; index += 1) {
    const previous = result[index - 1]!;
    const current = result[index]!;
    if (Math.abs(current.x - previous.x) <= EPSILON) current.x = previous.x;
    else if (Math.abs(current.y - previous.y) <= EPSILON) current.y = previous.y;
  }
  const last = result.length - 1;
  result[last] = { ...end };
  const previous = result[last - 1]!;
  if (Math.abs(end.x - previous.x) <= EPSILON) previous.x = end.x;
  else if (Math.abs(end.y - previous.y) <= EPSILON) previous.y = end.y;
  return result.filter((point, index) => index === 0 || !samePoint(point, result[index - 1]!));
}

function pointsAreCollinear(first: Point, second: Point, third: Point): boolean {
  return (Math.abs(first.x - second.x) <= EPSILON && Math.abs(second.x - third.x) <= EPSILON) ||
    (Math.abs(first.y - second.y) <= EPSILON && Math.abs(second.y - third.y) <= EPSILON);
}

function continuesForward(first: Point, second: Point, third: Point): boolean {
  return (second.x - first.x) * (third.x - second.x) >= -EPSILON &&
    (second.y - first.y) * (third.y - second.y) >= -EPSILON;
}

function segmentIntersection(left: Segment, right: Segment):
  | { readonly kind: "none" }
  | { readonly kind: "point"; readonly point: Point }
  | { readonly kind: "overlap" } {
  if (left.orientation === right.orientation) {
    const sameAxis = left.orientation === "horizontal"
      ? Math.abs(left.start.y - right.start.y) <= EPSILON
      : Math.abs(left.start.x - right.start.x) <= EPSILON;
    if (!sameAxis) return { kind: "none" };
    const leftStart = left.orientation === "horizontal" ? left.start.x : left.start.y;
    const leftEnd = left.orientation === "horizontal" ? left.end.x : left.end.y;
    const rightStart = right.orientation === "horizontal" ? right.start.x : right.start.y;
    const rightEnd = right.orientation === "horizontal" ? right.end.x : right.end.y;
    const overlapStart = Math.max(Math.min(leftStart, leftEnd), Math.min(rightStart, rightEnd));
    const overlapEnd = Math.min(Math.max(leftStart, leftEnd), Math.max(rightStart, rightEnd));
    if (overlapEnd < overlapStart - EPSILON) return { kind: "none" };
    if (overlapEnd > overlapStart + EPSILON) return { kind: "overlap" };
    return left.orientation === "horizontal"
      ? { kind: "point", point: { x: overlapStart, y: left.start.y } }
      : { kind: "point", point: { x: left.start.x, y: overlapStart } };
  }
  const horizontal = left.orientation === "horizontal" ? left : right;
  const vertical = left.orientation === "vertical" ? left : right;
  const point = { x: vertical.start.x, y: horizontal.start.y };
  return between(point.x, horizontal.start.x, horizontal.end.x) &&
      between(point.y, vertical.start.y, vertical.end.y)
    ? { kind: "point", point }
    : { kind: "none" };
}

function positiveOverlap(firstStart: number, firstEnd: number, secondStart: number, secondEnd: number): boolean {
  return Math.min(Math.max(firstStart, firstEnd), Math.max(secondStart, secondEnd)) -
    Math.max(Math.min(firstStart, firstEnd), Math.min(secondStart, secondEnd)) > EPSILON;
}

function between(value: number, first: number, second: number): boolean {
  return value >= Math.min(first, second) - EPSILON && value <= Math.max(first, second) + EPSILON;
}

function samePoint(left: Point, right: Point): boolean {
  return Math.abs(left.x - right.x) <= EPSILON && Math.abs(left.y - right.y) <= EPSILON;
}

function costIsBetter(length: number, bends: number, previousLength: number, previousBends: number): boolean {
  return length < previousLength - EPSILON ||
    (Math.abs(length - previousLength) <= EPSILON && bends < previousBends);
}

function sameCost(length: number, bends: number, expectedLength: number, expectedBends: number): boolean {
  return Math.abs(length - expectedLength) <= EPSILON && bends === expectedBends;
}

class MinQueue {
  readonly #items: QueueItem[] = [];

  get size(): number { return this.#items.length; }

  push(item: QueueItem): void {
    this.#items.push(item);
    let index = this.#items.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (!queueItemIsBetter(this.#items[index]!, this.#items[parent]!)) break;
      [this.#items[index], this.#items[parent]] = [this.#items[parent]!, this.#items[index]!];
      index = parent;
    }
  }

  pop(): QueueItem | undefined {
    const first = this.#items[0];
    const last = this.#items.pop();
    if (first === undefined || last === undefined) return first;
    if (this.#items.length === 0) return first;
    this.#items[0] = last;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      let best = index;
      if (left < this.#items.length && queueItemIsBetter(this.#items[left]!, this.#items[best]!)) best = left;
      if (right < this.#items.length && queueItemIsBetter(this.#items[right]!, this.#items[best]!)) best = right;
      if (best === index) break;
      [this.#items[index], this.#items[best]] = [this.#items[best]!, this.#items[index]!];
      index = best;
    }
    return first;
  }
}

function queueItemIsBetter(left: QueueItem, right: QueueItem): boolean {
  return costIsBetter(left.length, left.bends, right.length, right.bends) ||
    (sameCost(left.length, left.bends, right.length, right.bends) && left.state < right.state);
}
