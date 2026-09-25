import type { HarnessDesignDocument } from "./model";
import type { EditorPoint, EditorSceneObject } from "./editor-types";
import { physicalSegmentControls, physicalSegmentPoints } from "./physical-geometry";
import { physicalNodePoint, physicalNodeDirection } from "./physical-ports";
import { drawingPipeWidth } from "./drawing-thickness";
import { defaultLayerIds } from "./model";
import { physicalEditablePoints } from "./physical-editing";
import { drawingBendRadius } from "./drawing-route-path";
import { pipeBundleDisplaySamples, projectPipeBundleControls, pipeBundleNodePoint,pipeBundleDepth } from "./pipe-bundle-projection";

/** One boundary between physical topology and presentation. */
export function physicalTopologyScene(document: HarnessDesignDocument): EditorSceneObject[] {
  const topology = document.physicalTopology;
  if (!topology) return [];
  const segments: EditorSceneObject[] = topology.segments.map((segment, i) => {
    // Controls and grips use the same projection as the painted pipe so a
    // grouped member remains directly editable on its visible path.
    const controls = projectPipeBundleControls(document, segment.id, physicalSegmentControls(document, segment));
    const editable = projectPipeBundleControls(document, segment.id, physicalEditablePoints(document, segment));
    const authored = physicalEditablePoints(document, segment);
    const midpoints = projectPipeBundleControls(document, segment.id, authored.slice(1).map((p,i)=>({x:(p.x+authored[i]!.x)/2,y:(p.y+authored[i]!.y)/2})));
    const display = pipeBundleDisplaySamples(document, segment.id);
    return {
    id: segment.id, kind: "physical-segment", label: `S${i + 1}`, layerId: "wires",
    x: 0, y: 0, width: drawingPipeWidth(document, segment), height: 0,
    color: segment.color ?? "#aebfc9", points: display?.map(s => s.point) ?? physicalSegmentPoints(document, segment),
    routeRadius:display ? 0 : drawingBendRadius(document),
    pipe: {
      controls: controls,
      handles: editable.slice(1,-1),
      midpoints,
      wireIds: topology.routes.filter(route => route.steps.some(step => step.segmentId === segment.id)).map(route => route.wireId),
    },
    ...(document.drawingDocuments?.volumeShading === false ? { metadata: { volumeShading: "false" } } : {}),
    };
  });
  const nodes: EditorSceneObject[] = topology.nodes.map((node, i) => {
    const point = pipeBundleNodePoint(document,node.id,physicalNodePoint(document, node));
    return { id: node.id, kind: "physical-node", label: node.connectorId ? "Выход" : `Узел ${i + 1}`,
      layerId: defaultLayerIds.connectionPoints, x: point.x - 5, y: point.y - 5, width: 10, height: 10,
      color: node.connectorId ? "#f59e0b" : "#1179ac",
      metadata: { nodeRole: node.connectorId ? "connector-exit" : "junction" },
      port: { connectorId: node.connectorId, direction: physicalNodeDirection(document, node) } };
  });
  return [...segments.sort((a,b)=>pipeBundleDepth(document,a.id)-pipeBundleDepth(document,b.id)), ...nodes];
}

export function pipeSceneControls(object: EditorSceneObject): readonly EditorPoint[] {
  return object.pipe?.controls ?? [];
}
export function pipeSceneHandles(object: EditorSceneObject): readonly EditorPoint[] {
  return object.pipe?.handles ?? [];
}
export function pipeSceneEditablePoints(object: EditorSceneObject): readonly EditorPoint[] {
  return object.points?.length ? [object.points[0]!,...pipeSceneHandles(object),object.points.at(-1)!] : [];
}
export function pipeSceneWireIds(object: EditorSceneObject | undefined): readonly string[] {
  return object?.pipe?.wireIds ?? [];
}
