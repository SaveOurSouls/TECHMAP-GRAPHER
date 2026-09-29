import type { HarnessDesignDocument } from "./model";
import type { EditorPoint, EditorSceneObject } from "./editor-types";
import { physicalSegmentControls, physicalSegmentPoints } from "./physical-geometry";
import { physicalNodePoint, physicalNodeDirection } from "./physical-ports";
import { drawingPipeWidth } from "./drawing-thickness";
import { defaultLayerIds } from "./model";
import { physicalEditablePoints } from "./physical-editing";
import { drawingBendRadius } from "./drawing-route-path";
import { hasPipeBundleProjection, pipeBundleDisplaySamples, projectPipeBundleControls, pipeBundleNodePoint,pipeBundleDepth } from "./pipe-bundle-projection";
import { joiningPipePoints, joiningPipeEndpointId } from "./physical-joining-pipes";
import { joiningPipeDisplaySamples,joiningPipeTransitionHandles,joiningPipeWidth,joiningPipeControlsMemberStation } from "./physical-joining-pipe-projection";
import {projectOntoPolyline} from "./physical-coverings";

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
    const route=physicalSegmentPoints(document,segment);
    const controlled=(point:EditorPoint)=>joiningPipeControlsMemberStation(document,segment.id,projectOntoPolyline(route,point).fraction);
    const transitionHandles=joiningPipeTransitionHandles(document,segment.id);
    const authoredHandles=editable.slice(1,-1).map((point,index)=>({fraction:projectOntoPolyline(route,point).fraction,point,authoredIndex:index+1}));
    const mergedHandles=[...authoredHandles,...transitionHandles.map(handle=>({fraction:handle.fraction,point:handle.point,transition:handle}))].sort((a,b)=>a.fraction-b.fraction);
    const handles=mergedHandles.map(handle=>handle.point);
    const authoredHandleIndices=mergedHandles.map(handle=>"authoredIndex" in handle?handle.authoredIndex:-1);
    const joiningTransitionHandleData=mergedHandles.flatMap((handle,index)=>"transition" in handle?[{index,memberIndex:handle.transition.memberIndex,side:handle.transition.side}]:[]);
    const controlledHandleIndices=mergedHandles.flatMap((handle,index)=>"authoredIndex" in handle&&controlled(authored[handle.authoredIndex]!)?[index]:[]);
    return {
    id: segment.id, kind: "physical-segment", label: `S${i + 1}`, layerId: "wires",
    x: 0, y: 0, width: drawingPipeWidth(document, segment), height: 0,
    color: segment.color ?? "#aebfc9", points: display?.map(s => s.point) ?? physicalSegmentPoints(document, segment),
    routeRadius:joiningPipeDisplaySamples(document,segment.id) ? drawingBendRadius(document) : display ? 0 : drawingBendRadius(document),
    pipe: {
      fromNodeId: segment.from,
      toNodeId: segment.to,
      authoredPoints: authored,
      controls: controls,
      handles,
      authoredHandleIndices,
      midpoints,
      controlledHandles:controlledHandleIndices,
      controlledMidpoints:authored.slice(1).flatMap((p,i)=>controlled({x:(p.x+authored[i]!.x)/2,y:(p.y+authored[i]!.y)/2})?[i]:[]),
      joiningTransitionHandles:joiningTransitionHandleData,
      wireIds: topology.routes.filter(route => route.steps.some(step => step.segmentId === segment.id)).map(route => route.wireId),
    },
    ...((segment.volumeShading !== undefined || document.drawingDocuments?.volumeShading === false)
      ? { metadata: { volumeShading: String(segment.volumeShading ?? false) } } : {}),
    };
  });
  const joining: EditorSceneObject[] = (topology.joiningPipes??[]).map((pipe,i)=>{
    const authored=joiningPipePoints(pipe), display=authored;
    const controls=authored,handles=pipe.path.points;
    const midpoints=authored.slice(1).map((p,j)=>({x:(p.x+authored[j]!.x)/2,y:(p.y+authored[j]!.y)/2}));
    const wireIds=[...new Set(pipe.members.flatMap(m=>m.segmentIds).flatMap(id=>topology.routes.filter(route=>route.steps.some(step=>step.segmentId===id)).map(route=>route.wireId)))];
    return {id:pipe.id,kind:"physical-segment" as const,label:`ОП${i+1}`,layerId:"wires",x:0,y:0,width:joiningPipeWidth(document,pipe),height:0,color:pipe.color??"#aebfc9",points:display,paths:[display],routeRadius:drawingBendRadius(document),
      pipe:{role:"joining-pipe" as const,authoredPoints:authored,fromNodeId:joiningPipeEndpointId(pipe.id,"from"),toNodeId:joiningPipeEndpointId(pipe.id,"to"),controls,handles,midpoints,wireIds,memberSegmentIds:pipe.members.flatMap(m=>m.segmentIds)},
      metadata:{joiningPipe:"true",volumeShading:String(pipe.volumeShading??document.drawingDocuments?.volumeShading!==false)}};
  });
  const nodes: EditorSceneObject[] = topology.nodes.map((node, i) => {
    const point = pipeBundleNodePoint(document,node.id,physicalNodePoint(document, node));
    return { id: node.id, kind: "physical-node", label: node.connectorId ? "Выход" : `Узел ${i + 1}`,
      layerId: defaultLayerIds.connectionPoints, x: point.x - 5, y: point.y - 5, width: 10, height: 10,
      color: node.connectorId ? "#f59e0b" : "#1179ac",
      metadata: { nodeRole: node.connectorId ? "connector-exit" : "junction",
        bundleMember: String(topology.segments.some(segment =>
          (segment.from === node.id || segment.to === node.id) && hasPipeBundleProjection(document,segment.id))) },
      port: { connectorId: node.connectorId, direction: physicalNodeDirection(document, node) } };
  });
  const joiningEnds:EditorSceneObject[]=(topology.joiningPipes??[]).flatMap((p,i)=>(["from","to"] as const).map(side=>{
    const point=side==="from"?p.start:p.end;
    return {id:joiningPipeEndpointId(p.id,side),kind:"physical-node",label:`ОП${i+1} · ${side==="from"?"начало":"конец"}`,layerId:defaultLayerIds.connectionPoints,
      x:point.x-5,y:point.y-5,width:10,height:10,color:"#8555ad",metadata:{joiningPipe:p.id,bundleMember:"true"},port:{direction:null}};
  }));
  return [...joining,...segments.sort((a,b)=>pipeBundleDepth(document,a.id)-pipeBundleDepth(document,b.id)), ...nodes,...joiningEnds];
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
