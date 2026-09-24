import type { HarnessDesignDocument } from "./model";
import type { EditorPoint, EditorSceneObject } from "./editor-types";
import { physicalSegmentControls, physicalSegmentPoints } from "./physical-geometry";
import { physicalNodePoint, physicalNodeDirection } from "./physical-ports";
import { drawingPipeWidth } from "./drawing-thickness";
import { defaultLayerIds } from "./model";

/** One boundary between physical topology and presentation. */
export function physicalTopologyScene(document: HarnessDesignDocument): EditorSceneObject[] {
  const topology = document.physicalTopology;
  if (!topology) return [];
  const segments: EditorSceneObject[] = topology.segments.map((segment, i) => ({
    id: segment.id, kind: "physical-segment", label: `S${i + 1}`, layerId: "wires",
    x: 0, y: 0, width: drawingPipeWidth(document, segment), height: 0,
    color: segment.color ?? "#aebfc9", points: physicalSegmentPoints(document, segment),
    pipe: {
      controls: physicalSegmentControls(document, segment),
      handles: segment.path.points,
      wireIds: topology.routes.filter(route => route.steps.some(step => step.segmentId === segment.id)).map(route => route.wireId),
    },
  }));
  const nodes: EditorSceneObject[] = topology.nodes.map((node, i) => {
    const point = physicalNodePoint(document, node);
    return { id: node.id, kind: "physical-node", label: node.connectorId ? "Выход" : `Узел ${i + 1}`,
      layerId: defaultLayerIds.connectionPoints, x: point.x - 5, y: point.y - 5, width: 10, height: 10,
      color: node.connectorId ? "#f59e0b" : "#1179ac",
      metadata: { nodeRole: node.connectorId ? "connector-exit" : "junction" },
      port: { connectorId: node.connectorId, direction: physicalNodeDirection(document, node) } };
  });
  return [...segments, ...nodes];
}

export function pipeSceneControls(object: EditorSceneObject): readonly EditorPoint[] {
  return object.pipe?.controls ?? [];
}
export function pipeSceneHandles(object: EditorSceneObject): readonly EditorPoint[] {
  return object.pipe?.handles ?? [];
}
export function pipeSceneWireIds(object: EditorSceneObject | undefined): readonly string[] {
  return object?.pipe?.wireIds ?? [];
}
