import { parseHarnessDesignDocument, type HarnessDesignDocument } from "../editor/model";
import type { EditorSceneObject } from "../editor/editor-types";

export interface RouteDrawingCopy {
  readonly document: Omit<HarnessDesignDocument, "manufacturingRoute">;
  readonly hiddenObjectIds: readonly string[];
}

/**
 * Creates the second, self-contained copy used by the Route "Изолировать"
 * action.  A scene selection may contain a physical segment instead of its
 * material wire; both forms are accepted.  Physical routing is deliberately
 * discarded.  The selected wires remain ordinary drawing wires and keep their
 * immutable material and end-strip profiles. Endpoint coordinates are stored
 * separately, so connectors that were not selected are never pulled into the
 * detached copy.
 */
export function createIndependentIsolatedDocument(
  source: HarnessDesignDocument,
  scene: readonly EditorSceneObject[],
  selectedObjectIds: readonly string[],
): HarnessDesignDocument | null {
  const selected = new Set(selectedObjectIds);
  const wireIds = new Set<string>();
  const connectorIds = new Set<string>();
  for (const object of scene) {
    if (!selected.has(object.id)) continue;
    if (object.kind === "wire") wireIds.add(object.id);
    if (object.kind === "connector") connectorIds.add(object.id);
    if (object.kind === "physical-segment") for (const wireId of object.pipe?.wireIds ?? []) wireIds.add(wireId);
  }
  if (!wireIds.size && !connectorIds.size) return null;

  const connectors = source.connectors.filter(connector => connectorIds.has(connector.id));
  const sceneById = new Map(scene.map(object => [object.id, object]));
  const wires = source.wires.filter(wire => wireIds.has(wire.id)).map(wire => ({
    ...wire,
    // The endpoint shape remains backwards-compatible, but these identities
    // are deliberately synthetic and have no connector in the detached doc.
    from: { connectorId: `isolated:${wire.id}:from`, contactId: "free" },
    to: { connectorId: `isolated:${wire.id}:to`, contactId: "free" },
    // No source bend handles are carried into the detached fragment.
    // E4 remains available for the copied connector contacts; drawing geometry
    // is detached through drawingEndpoints below.
    e4Route: wire.e4Route,
    e4RouteMode: wire.e4RouteMode ?? "auto",
    drawingRoute: [],
    ...(sceneById.get(wire.id)?.points?.length && sceneById.get(wire.id)!.points!.length >= 2 ? {
      drawingEndpoints: {
        from: { ...sceneById.get(wire.id)!.points![0]! },
        to: { ...sceneById.get(wire.id)!.points!.at(-1)! },
      },
    } : {}),
    drawingEndStyles: wire.drawingEndStyles ?? { from: "cut", to: "cut" },
  }));
  if (!wires.length && !connectors.length) return null;
  const wireSet = new Set(wires.map(wire => wire.id));
  const cables = source.cables.filter(cable => cable.memberWireIds.every(id => wireSet.has(id)));
  const documents = source.drawingDocuments;
  const isolated: HarnessDesignDocument = {
    schemaVersion: source.schemaVersion,
    ...(source.requiredWriterContractVersion === undefined ? {} : { requiredWriterContractVersion: source.requiredWriterContractVersion }),
    connectors,
    wires,
    cables,
    junctions: [],
    diffPairs: [],
    screens: [],
    views: source.views,
    ...(source.customWireColors ? { customWireColors: source.customWireColors } : {}),
    ...(documents ? {
      drawingDocuments: {
        ...documents,
        dimensions: [],
        leaders: [],
        rails: [],
        bomOrder: [],
        bomText: {},
        specificationItems: documents.specificationItems?.filter(item => !item.objectId || wireSet.has(item.objectId) || connectorIds.has(item.objectId)),
      },
    } : {}),
  };
  // parseHarnessDesignDocument normalizes defaults and validates that no
  // dangling source references survived the projection.
  return parseHarnessDesignDocument(isolated);
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
  const migratable = new Map<string, (count: number) => boolean>();
  for (const connector of document.connectors) migratable.set(connector.id, count => count === 1);
  for (const wire of document.wires) migratable.set(wire.id, count => count === wire.drawingRoute.length + 2);
  for (const node of document.physicalTopology?.nodes ?? []) if (!node.connectorId) migratable.set(node.id, count => count === 1);
  for (const segment of document.physicalTopology?.segments ?? []) migratable.set(segment.id, count => count === segment.path.points.length + 2);
  for (const pipe of document.physicalTopology?.joiningPipes ?? []) migratable.set(pipe.id, count => count === pipe.path.points.length + 2);
  return drawingObjects.filter(item => item.points.length > 0 && !migratable.get(item.id)?.(item.points.length)).map(item => item.id);
}
