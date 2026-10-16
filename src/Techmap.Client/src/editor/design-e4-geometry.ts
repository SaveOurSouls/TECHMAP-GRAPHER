import {
  type WireEndpoint,
  type WireScreenEndpointSide,
  type HarnessDesignDocument,
  type E4RouteAnchor,
  type WireScreenConnectionGeometry,
  type Point,
  type EditorView,
  type WireInstance,
} from "./design-types";
import { connectorContactPosition, connectorE4TableGeometry } from "./connector-presentation";
import { materializedContactWorldRepresentation } from "./materialized-contact-representation";
import { screenCrossSections, clearScreenSections, uprightScreenBody } from "./e4-screen-spans";
import { e4ScreenAlongSize, defaultE4WireLead } from "./design-defaults";
import { straightLeadEnd } from "./route-lead";
import { commonParallelSpan } from "./e4-parallel-spans";
import { segmentPointDistance } from "./segment-geometry";

export function isJunctionEndpoint(endpoint: WireEndpoint): endpoint is Extract<WireEndpoint, { junctionId: string }> {
  return "junctionId" in endpoint;
}
export function createJunctionEndpoint(junctionId: string): WireEndpoint {
  return { junctionId, connectorId: "", contactId: "" };
}
export function isScreenEndpoint(endpoint: WireEndpoint): endpoint is Extract<WireEndpoint, { screenId: string }> {
  return "screenId" in endpoint;
}
export function createScreenEndpoint(screenId: string, screenTerminalSide?: WireScreenEndpointSide): WireEndpoint {
  return screenTerminalSide
    ? { screenId, screenTerminalSide, connectorId: "", contactId: "" }
    : { screenId, connectorId: "", contactId: "" };
}
export function wireEndpointE4Anchor(document: HarnessDesignDocument, endpoint: WireEndpoint): E4RouteAnchor | null {
  return wireEndpointE4AnchorInternal(document, endpoint, new Set());
}
function wireEndpointE4AnchorInternal(
  document: HarnessDesignDocument,
  endpoint: WireEndpoint,
  resolvingScreenIds: ReadonlySet<string>,
): E4RouteAnchor | null {
  if (isJunctionEndpoint(endpoint)) {
    const junction = document.junctions.find((item) => item.id === endpoint.junctionId);
    return junction ? { position: junction.position, leadDirection: null } : null;
  }
  if (isScreenEndpoint(endpoint)) {
    const geometry = wireScreenConnectionGeometry(
      document,
      endpoint.screenId,
      resolvingScreenIds,
      endpoint.screenTerminalSide,
    );
    return geometry ? {
      position: geometry.connectionPoint,
      leadLength: 8,
      leadDirection: geometry.orientation === "horizontal"
        ? geometry.terminalSide === "above" ? "up" : "down"
        : geometry.terminalSide === "above" ? "left" : "right",
    } : null;
  }
  const connector = document.connectors.find((item) => item.id === endpoint.connectorId);
  if (!connector) return null;
  if (connector.terminationComponent) {
    const position = connectorContactPosition(connector, endpoint.contactId, 'e4');
    return position ? {position,leadDirection:connector.contacts.findIndex(c=>c.id===endpoint.contactId)===1?'right':'left'} : null;
  }
  const materialized = materializedContactWorldRepresentation(connector, endpoint.contactId, "e4");
  const position = materialized?.position ?? connectorContactPosition(connector, endpoint.contactId, "e4");
  return position ? {
    position,
    leadDirection: materialized?.direction ??
      (connector.schematic.orientation === "contacts-left" ? "left" : "right"),
  } : null;
}
/** Derives the screen body and its explicit conducting ports from the screened routes. */
export function wireScreenConnectionGeometry(
  document: HarnessDesignDocument,
  screenId: string,
  resolvingScreenIds: ReadonlySet<string> = new Set(),
  preferredTerminalSide?: WireScreenEndpointSide,
): WireScreenConnectionGeometry | null {
  if (resolvingScreenIds.has(screenId)) return null;
  const screen = document.screens.find((item) => item.id === screenId);
  if (!screen) return null;
  const nextResolving = new Set([...resolvingScreenIds, screenId]);
  let spans = screenCrossSections(screen.wireIds.map(wireId => {
    const wire = document.wires.find(item => item.id === wireId);
    const start = wire && wireEndpointE4AnchorInternal(document, wire.from, nextResolving)?.position;
    const end = wire && wireEndpointE4AnchorInternal(document, wire.to, nextResolving)?.position;
    return {id:wireId, points:wire && start && end ? [start,...wire.e4Route,end] : []};
  }));
  spans = clearScreenSections(spans, document.connectors.map(connector => ({
    ...connector.positions.e4, ...connectorE4TableGeometry(connector),
  })), screen.width,e4ScreenAlongSize);
  if (spans.length === 0) return null;
  spans.sort((left, right) => left.firstWireDirection * (left.start - right.start));
  const pathLength = spans.reduce((sum, span) => sum + span.end - span.start, 0);
  const requestedDistance = pathLength * Math.max(0, Math.min(1, screen.position));
  let accumulated = 0;
  let selected = spans[0]!;
  for (const span of spans) {
    if (requestedDistance <= accumulated + span.end - span.start || span === spans.at(-1)) {
      selected = span;
      break;
    }
    accumulated += span.end - span.start;
  }
  const spanOffset = Math.max(0, Math.min(selected.end - selected.start, requestedDistance - accumulated));
  const along = selected.firstWireDirection === 1 ? selected.start + spanOffset : selected.end - spanOffset;
  const {center,alongSize,crossSize}=uprightScreenBody(selected,along,screen.width,e4ScreenAlongSize);
  const configuredSide = screen.terminalSide ?? "above";
  const terminalSides: readonly WireScreenEndpointSide[] = configuredSide === "both"
    ? ["above", "below"]
    : [configuredSide];
  const terminals = terminalSides.map((side) => {
    const direction = side === "above" ? -1 : 1;
    const bodyConnectionPoint = { x: center.x, y: center.y + direction * crossSize / 2 };
    // The port belongs to the oval itself. A wire only becomes connected after
    // the user explicitly starts or ends it on this perimeter point.
    const connectionPoint = bodyConnectionPoint;
    return { side, bodyConnectionPoint, connectionPoint };
  });
  const terminal = preferredTerminalSide === undefined
    ? terminals[0]!
    : terminals.find((item) => item.side === preferredTerminalSide);
  // Never silently move a persisted endpoint to the opposite port when the
  // screen mode changes. Such a document/command must be repaired explicitly.
  if (!terminal) return null;
  return {
    center,
    bodyConnectionPoint: terminal.bodyConnectionPoint,
    connectionPoint: terminal.connectionPoint,
    terminalSide: terminal.side,
    terminals,
    orientation: "horizontal",
    alongSize,
    crossSize,
  };
}
export function wireScreenConnectionPoint(
  document: HarnessDesignDocument,
  screenId: string,
  resolvingScreenIds: ReadonlySet<string> = new Set(),
  preferredTerminalSide?: WireScreenEndpointSide,
): Point | null {
  return wireScreenConnectionGeometry(document, screenId, resolvingScreenIds, preferredTerminalSide)?.connectionPoint ?? null;
}
export function validateE4Polyline(
  start:E4RouteAnchor,intermediate:readonly Point[],end:E4RouteAnchor,minimumLead=defaultE4WireLead,
):void {
  if(!Number.isFinite(minimumLead)||minimumLead<0)throw new Error("Минимальный прямой участок задан неверно.");
  const points=[start.position,...intermediate,end.position];
  for(let i=0;i<points.length;i++){
    const p=points[i]!;
    if(!Number.isFinite(p.x)||!Number.isFinite(p.y)||i>0&&Math.hypot(p.x-points[i-1]!.x,p.y-points[i-1]!.y)<1e-8)throw new Error("Маршрут Э4 должен состоять из ненулевых сегментов.");
  }
  validateLead(start,straightLeadEnd(points),minimumLead);
  validateLead(end,straightLeadEnd([...points].reverse()),minimumLead);
}
export function validateOrthogonalE4Route(
  start: E4RouteAnchor,
  intermediate: readonly Point[],
  end: E4RouteAnchor,
  minimumLead = defaultE4WireLead,
): void {
  if (!Number.isFinite(minimumLead) || minimumLead < 0) throw new Error("Минимальный прямой участок задан неверно.");
  const points = [start.position, ...intermediate, end.position];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!;
    const current = points[index]!;
    if ((previous.x === current.x) === (previous.y === current.y)) {
      throw new Error("Маршрут Э4 должен состоять из ненулевых ортогональных сегментов.");
    }
  }
  validateLead(start, straightLeadEnd(points), minimumLead);
  validateLead(end, straightLeadEnd([...points].reverse()), minimumLead);
}
export function createOrthogonalE4Route(
  start: E4RouteAnchor,
  end: E4RouteAnchor,
  minimumLead = defaultE4WireLead,
): readonly Point[] {
  const startLead = leadPoint(start, minimumLead);
  const endLead = leadPoint(end, minimumLead);
  const candidates: Point[] = [];
  if (!samePoint(start.position, startLead)) candidates.push(startLead);
  if (startLead.x !== endLead.x && startLead.y !== endLead.y) candidates.push({ x: endLead.x, y: startLead.y });
  if (!samePoint(startLead, endLead)) candidates.push(endLead);
  const intermediate = candidates.filter((point, index) => {
    const previous = index === 0 ? start.position : candidates[index - 1]!;
    return !samePoint(point, previous) && !samePoint(point, end.position);
  });
  validateOrthogonalE4Route(start, intermediate, end, minimumLead);
  return intermediate;
}
function validateLead(anchor: E4RouteAnchor, adjacent: Point, minimumLead: number): void {
  minimumLead = Math.min(minimumLead, anchor.leadLength ?? minimumLead);
  if (anchor.leadDirection === null) return;
  const horizontal = anchor.leadDirection === "left" || anchor.leadDirection === "right";
  const distance = anchor.leadDirection === "left"
    ? anchor.position.x - adjacent.x
    : anchor.leadDirection === "right"
      ? adjacent.x - anchor.position.x
      : anchor.leadDirection === "up"
        ? anchor.position.y - adjacent.y
        : adjacent.y - anchor.position.y;
  const aligned = horizontal ? adjacent.y === anchor.position.y : adjacent.x === anchor.position.x;
  if (!aligned || distance < minimumLead) {
    throw new Error("Маршрут Э4 должен иметь прямой участок наружу от контакта.");
  }
}
function leadPoint(anchor: E4RouteAnchor, minimumLead: number): Point {
  minimumLead = Math.min(minimumLead, anchor.leadLength ?? minimumLead);
  if (anchor.leadDirection === "left") return { x: anchor.position.x - minimumLead, y: anchor.position.y };
  if (anchor.leadDirection === "right") return { x: anchor.position.x + minimumLead, y: anchor.position.y };
  if (anchor.leadDirection === "up") return { x: anchor.position.x, y: anchor.position.y - minimumLead };
  if (anchor.leadDirection === "down") return { x: anchor.position.x, y: anchor.position.y + minimumLead };
  return anchor.position;
}
function samePoint(left: Point, right: Point): boolean {
  return left.x === right.x && left.y === right.y;
}
export function findWireEndpoint(
  document: HarnessDesignDocument,
  endpoint: WireEndpoint,
  view: EditorView,
): Point | null {
  if (isJunctionEndpoint(endpoint)) {
    return view === "e4" ? document.junctions.find((item) => item.id === endpoint.junctionId)?.position ?? null : null;
  }
  if (isScreenEndpoint(endpoint)) {
    return view === "e4"
      ? wireScreenConnectionPoint(document, endpoint.screenId, new Set(), endpoint.screenTerminalSide)
      : null;
  }
  const connector = document.connectors.find((item) => item.id === endpoint.connectorId);
  return connector ? connectorContactPosition(connector, endpoint.contactId, view) : null;
}
export function wireE4PathContainsPoint(
  document: HarnessDesignDocument,
  wire: WireInstance,
  point: Point,
): boolean {
  const start = wireEndpointE4Anchor(document, wire.from)?.position;
  const end = wireEndpointE4Anchor(document, wire.to)?.position;
  if (!start || !end) return false;
  const points = [start, ...wire.e4Route, end];
  return points.slice(1).some((current, index) => pointOnSegment(point, points[index]!, current));
}
export function wireGroupHasScreenCrossSection(document:HarnessDesignDocument,wireIds:readonly string[]):boolean {
  return screenCrossSections(wireIds.map(id=>{
    const wire=document.wires.find(w=>w.id===id);
    const a=wire&&wireEndpointE4Anchor(document,wire.from),b=wire&&wireEndpointE4Anchor(document,wire.to);
    return {id,points:wire&&a&&b?[a.position,...wire.e4Route,b.position]:[]};
  })).length>0;
}
export function wireGroupHasCommonE4ParallelSpan(
  document: HarnessDesignDocument,
  wireIds: readonly string[],
): boolean {
  // Independent drawing copies have no E4 anchors at their free ends.
  // Pair membership survives subsequent drawing edits; its visible spans are
  // resolved from the drawing geometry by the renderer.
  if (wireIds.length >= 2 && wireIds.every(id => document.wires.find(w => w.id === id)?.drawingEndpoints)) return true;
  return commonParallelSpan(wireIds.map(id=>{
    const w=document.wires.find(w=>w.id===id),a=w&&wireEndpointE4Anchor(document,w.from),b=w&&wireEndpointE4Anchor(document,w.to);
    return {id,points:w&&a&&b?[a.position,...w.e4Route,b.position]:[]};
  }))!==null;
}
function pointOnSegment(point: Point, start: Point, end: Point): boolean { return segmentPointDistance(point,{start,end})<1e-7; }
