import { parseHarnessDesignDocument, type HarnessDesignDocument } from "../editor/model";

export interface RouteDrawingCopy {
  readonly document: Omit<HarnessDesignDocument, "manufacturingRoute">;
  readonly hiddenObjectIds: readonly string[];
}

const maximumCopyBytes = 1024 * 1024;
const fail = (): never => { throw new Error("Копия чертежа в маршруте повреждена или превышает допустимый размер."); };

function inspect(value: unknown, depth = 0, count = { value: 0 }): void {
  if (++count.value > 100_000 || depth > 128) fail();
  if (Array.isArray(value)) {
    if (value.length > 10_000) fail();
    value.forEach(item => inspect(item, depth + 1, count));
  } else if (value !== null && typeof value === "object") {
    if (Object.prototype.hasOwnProperty.call(value, "manufacturingRoute")) fail();
    for (const [key, item] of Object.entries(value)) {
      if (key.length > 256) fail();
      inspect(item, depth + 1, count);
    }
  }
}

/** A bounded, independent snapshot. Route state is never copied back into the design. */
export function parseRouteDrawingCopy(value: unknown): RouteDrawingCopy {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const candidate = value as Record<string, unknown>;
  if (Object.keys(candidate).length !== 2 || !("document" in candidate) || !("hiddenObjectIds" in candidate)) return fail();
  if (!Array.isArray(candidate.hiddenObjectIds) || candidate.hiddenObjectIds.length > 10_000 ||
    candidate.hiddenObjectIds.some(id => typeof id !== "string" || !id.trim() || id.length > 128) ||
    new Set(candidate.hiddenObjectIds).size !== candidate.hiddenObjectIds.length) return fail();
  inspect(candidate.document);
  let serialized: string;
  try { serialized = JSON.stringify(candidate.document); } catch { return fail(); }
  if (new TextEncoder().encode(serialized).length > maximumCopyBytes) return fail();
  const document = parseHarnessDesignDocument(JSON.parse(serialized));
  const { manufacturingRoute: _route, ...copy } = document;
  return { document: copy, hiddenObjectIds: [...candidate.hiddenObjectIds] };
}

export function createRouteDrawingCopy(document: HarnessDesignDocument, hiddenObjectIds: readonly string[] = []): RouteDrawingCopy {
  const { manufacturingRoute: _route, ...source } = document;
  return parseRouteDrawingCopy({ document: source, hiddenObjectIds });
}

/** Legacy migration keeps visibility by stable IDs; old overlay geometry remains a preview fallback. */
export function migrateLegacyRouteDrawingCopy(document: HarnessDesignDocument, drawingObjects: readonly { readonly id: string; readonly hidden: boolean; readonly points: readonly { readonly x: number; readonly y: number }[] }[]): RouteDrawingCopy {
  const base = createRouteDrawingCopy(document, drawingObjects.filter(item => item.hidden).map(item => item.id));
  const states = new Map(drawingObjects.map(item => [item.id, item]));
  const connectors = base.document.connectors.map(connector => {
    const state = states.get(connector.id), point = state?.points[0];
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return connector;
    return { ...connector, positions: { ...connector.positions, drawing: { ...point } } };
  });
  const wires = base.document.wires.map(wire => {
    const state = states.get(wire.id);
    if (!state || state.points.length !== wire.drawingRoute.length + 2 || state.points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return wire;
    return { ...wire, drawingRoute: state.points.slice(1, -1).map(point => ({ ...point })) };
  });
  const topology = base.document.physicalTopology;
  const physicalTopology = topology && { ...topology,
    nodes: topology.nodes.map(node => {
      const state = states.get(node.id), point = state?.points[0];
      return !node.connectorId && point && Number.isFinite(point.x) && Number.isFinite(point.y) ? { ...node, position: { ...point } } : node;
    }),
    segments: topology.segments.map(segment => {
      const state = states.get(segment.id);
      return state && state.points.length === segment.path.points.length + 2 && state.points.slice(1, -1).every(point => Number.isFinite(point.x) && Number.isFinite(point.y))
        ? { ...segment, path: { ...segment.path, points: state.points.slice(1, -1).map(point => ({ ...point })) } } : segment;
    }),
    joiningPipes: topology.joiningPipes?.map(pipe => {
      const state = states.get(pipe.id);
      return state && state.points.length === pipe.path.points.length + 2 && state.points.every(point => Number.isFinite(point.x) && Number.isFinite(point.y))
        ? { ...pipe, start: { ...state.points[0]! }, end: { ...state.points.at(-1)! }, path: { ...pipe.path, points: state.points.slice(1, -1).map(point => ({ ...point })) } } : pipe;
    }),
  };
  try { return createRouteDrawingCopy({ ...base.document, connectors, wires, ...(physicalTopology ? { physicalTopology } : {}) }, base.hiddenObjectIds); }
  catch { return base; }
}

/** IDs whose legacy overlay geometry has no lossless persisted-model mapping. */
export function legacyRouteDrawingCopyWarnings(document: HarnessDesignDocument, drawingObjects: readonly { readonly id: string; readonly points: readonly { readonly x: number; readonly y: number }[] }[]): readonly string[] {
  const known = new Set<string>([
    ...document.connectors.map(item => item.id), ...document.wires.map(item => item.id),
    ...(document.physicalTopology?.nodes.filter(item => !item.connectorId).map(item => item.id) ?? []), ...(document.physicalTopology?.segments.map(item => item.id) ?? []),
    ...(document.physicalTopology?.joiningPipes?.map(item => item.id) ?? []),
  ]);
  return drawingObjects.filter(item => item.points.length > 0 && !known.has(item.id)).map(item => item.id);
}
