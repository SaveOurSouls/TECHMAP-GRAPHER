import type { EditorLayer, EditorPoint, EditorSceneObject, HarnessEditorView } from "./editor-types";
import type { CableInstance } from "./model";
import { terminationSceneContainsPoint } from "./termination-scene";
import { buildWireStripProfileGeometry, type WireStripProfileGeometry } from "./wire-strip-profile-geometry";
import { drawingRouteHitPoints } from "./drawing-route-path";
import { coveringHit } from "./covering-renderer";
import { pipeSceneHandles } from "./physical-scene";
import {
  connectorCanvasContactPoints, contactCrossCenter, e4ContactMarker, getE4ConnectorLayout, hitTestConnectorContact,
} from "./canvas-connector-layout";
import { getE4WireRoute } from "./canvas-e4-scene";
import { objectsInPaintOrder } from "./canvas-paint-order";
import { buildCableSheathGeometry, type CableSheathGeometry } from "./cable-sheath-geometry";
import {
  projectE4DrawingCompanions, projectComponentTemplateView, projectContactSideView,
  type ComponentTemplateViewInstance, type ResolveComponentTemplateAssetUrl,
} from "./component-template-view-renderer";

export function pointToSegmentDistance(point: EditorPoint, start: EditorPoint, end: EditorPoint): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

/** Decoration geometry never substitutes the physical wire route. */
export function getDrawingWireStripProfileGeometries(
  object: EditorSceneObject,
  view?: HarnessEditorView,
): readonly WireStripProfileGeometry[] {
  if (view !== "drawing" || object.kind !== "wire" || !object.stripProfiles) return [];
  return (["from", "to"] as const).flatMap((end) => {
    const profile = object.stripProfiles?.[end];
    const geometry = profile && buildWireStripProfileGeometry(object.points ?? [], end, profile);
    return geometry ? [geometry] : [];
  });
}

function polygonContainsPoint(
  polygon: readonly EditorPoint[],
  point: EditorPoint,
  tolerance: number,
): boolean {
  let positive = false;
  let negative = false;
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index]!;
    const end = polygon[(index + 1) % polygon.length]!;
    if (pointToSegmentDistance(point, start, end) <= tolerance) return true;
    const cross = (end.x - start.x) * (point.y - start.y) - (end.y - start.y) * (point.x - start.x);
    positive ||= cross > 0;
    negative ||= cross < 0;
  }
  return !(positive && negative);
}

export function containsPoint(
  object: EditorSceneObject,
  point: EditorPoint,
  tolerance: number,
  view?: HarnessEditorView,
): boolean {
  if(object.metadata?.terminationSymbol)return terminationSceneContainsPoint(object,point,tolerance);
  if (object.kind === "object-index") return point.x >= object.x - tolerance && point.x <= object.x + object.width + tolerance && point.y >= object.y - tolerance && point.y <= object.y + object.height + tolerance;
  if (object.kind === "position-leader") {
    const circle = object.points?.[1];
    return (circle ? Math.hypot(point.x - circle.x, point.y - circle.y) <= object.width / 2 + tolerance : false) ||
      (object.points?.[0] && object.points[1] ? pointToSegmentDistance(point, object.points[0], object.points[1]) <= tolerance : false);
  }
  if (object.kind === "leader-anchor" || object.kind === "rail-handle") {
    return point.x >= object.x - tolerance && point.x <= object.x + object.width + tolerance && point.y >= object.y - tolerance && point.y <= object.y + object.height + tolerance;
  }
  if(object.kind.startsWith("graphic-")){const p=object.points??[],width=Number(object.metadata?.graphicWidth??2)/2+tolerance,k=object.metadata?.graphicKind;if(k==="contact")return !!p[0]&&Math.hypot(point.x-p[0].x,point.y-p[0].y)<=Math.max(6,width);if(k==="text"){const fontSize=Number(object.metadata?.graphicFontSize??16);return point.x>=object.x-tolerance&&point.x<=object.x+Math.max(fontSize*1.8,object.label.length*fontSize*.65)+tolerance&&point.y>=object.y-fontSize-tolerance&&point.y<=object.y+fontSize*.2+tolerance;}if(k==="rectangle")return point.x>=Math.min(p[0]?.x??0,p[1]?.x??0)-tolerance&&point.x<=Math.max(p[0]?.x??0,p[1]?.x??0)+tolerance&&point.y>=Math.min(p[0]?.y??0,p[1]?.y??0)-tolerance&&point.y<=Math.max(p[0]?.y??0,p[1]?.y??0)+tolerance;if(k==="ellipse"&&p[0]&&p[1]){const center={x:(p[0].x+p[1].x)/2,y:(p[0].y+p[1].y)/2},rx=Math.abs(p[1].x-p[0].x)/2,ry=Math.abs(p[1].y-p[0].y)/2;return rx>0&&ry>0&&Math.abs(((point.x-center.x)/rx)**2+((point.y-center.y)/ry)**2-1)<=Math.max(.2,width/Math.max(rx,ry));}return p.slice(1).some((v,i)=>pointToSegmentDistance(point,p[i]!,v)<=width)||k==="closedContour"&&pointToSegmentDistance(point,p.at(-1)!,p[0]!)<=width;}
  if(object.kind==="position-rail")return !!object.points?.[0]&&!!object.points?.[1]&&pointToSegmentDistance(point,object.points[0],object.points[1])<=tolerance;
  if(object.kind==="dimension"&&object.metadata?.boundDimension==="true"&&Math.hypot(point.x-object.x,point.y-object.y+7)<=Math.max(16,tolerance))return true;
  if(view==="drawing"&&object.kind==="wire"&&object.visibleWireStrokes)return object.visibleWireStrokes.some(stroke=>{const curve=drawingRouteHitPoints(stroke.points,stroke.radius??object.routeRadius);return curve.slice(1).some((p,i)=>pointToSegmentDistance(point,curve[i]!,p)<=stroke.width/2+Math.min(tolerance,2));});
  if(view==="drawing"&&object.kind==="wire"&&object.paths)return object.paths.some(path=>{const curve=drawingRouteHitPoints(path,object.routeRadius);return curve.slice(1).some((p,i)=>pointToSegmentDistance(point,curve[i]!,p)<=tolerance);});
  if (object.kind === "physical-covering" && object.metadata?.surfaces) return coveringHit(object,point,tolerance)!==null;
  if (object.kind === "physical-covering" || object.kind === "physical-segment") return (object.paths ?? [object.points ?? []]).some(path => {const curve=drawingRouteHitPoints(path,object.routeRadius);return curve.slice(1).some((p,i)=>pointToSegmentDistance(point,curve[i]!,p)<=tolerance+object.width/2);});
  if (object.kind === "wire" || object.kind === "dimension") {
    if (getDrawingWireStripProfileGeometries(object, view).some((geometry) =>
      geometry.primitives.some((primitive) => polygonContainsPoint(primitive.polygon, point, tolerance)))) return true;
    const points = view === "e4" && object.kind === "wire" ? getE4WireRoute(object) : view === "drawing" && object.kind === "wire" ? drawingRouteHitPoints(object.points ?? [],object.routeRadius) : object.points ?? [];
    for (let index = 1; index < points.length; index += 1) {
      const start = points[index - 1];
      const end = points[index];
      if (start && end && pointToSegmentDistance(point, start, end) <= tolerance) return true;
    }
    return false;
  }
  for (const contact of connectorCanvasContactPoints(object, view)) {
    if (!contact || contact.status !== "not-connected") continue;
    const cross = contactCrossCenter(contact);
    if (Math.hypot(point.x - cross.x, point.y - cross.y) <= contact.crossSize + tolerance) return true;
  }
  const e4Layout = view === "drawing" ? null : getE4ConnectorLayout(object);
  const width = e4Layout?.width ?? object.width;
  const height = e4Layout?.height ?? object.height;
  if (point.x >= object.x - tolerance && point.x <= object.x + width + tolerance &&
      point.y >= object.y - tolerance && point.y <= object.y + height + tolerance) return true;
  if (!e4Layout) return false;
  return e4Layout.rows.some((row, rowIndex) => {
    const marker = e4ContactMarker(row.status, e4Layout.connectionSide);
    if (!marker) return false;
    const anchor = e4Layout.contactPoints[rowIndex]!;
    const crossCenter = { x: anchor.x + marker.crossCenter.x, y: anchor.y + marker.crossCenter.y };
    // The marker is a single semantic object. Centre its hit target on the X
    // instead of deriving a thin target from the decorative lead and strokes.
    return Math.hypot(point.x - crossCenter.x, point.y - crossCenter.y) <= marker.crossSize + tolerance;
  });
}

export function hitTestWireRoutePoint(
  object: EditorSceneObject | undefined,
  point: EditorPoint,
  zoom: number,
): number | null {
  if (object?.kind !== "wire" && object?.kind !== "physical-segment") return null;
  if (object.metadata?.physicalRoute === "true") return null;
  const points: readonly EditorPoint[] = object.kind === "physical-segment" ? [object.points![0]!, ...pipeSceneHandles(object), object.points!.at(-1)!] : object.points ?? [];
  const tolerance = 10 / zoom;
  let nearest: number | null = null, distance = tolerance;
  for (let pointIndex = 1; pointIndex < points.length - 1; pointIndex += 1) {
    if(object.pipe?.controlledHandles?.includes(pointIndex-1))continue;
    const candidate = points[pointIndex]!;
    const delta = Math.hypot(point.x - candidate.x, point.y - candidate.y);
    if (delta <= distance) { nearest = pointIndex - 1; distance = delta; }
  }
  return nearest;
}

/** Visible member bends share the same consecutive numbering as authored bends. */
export function numberedPipeBendHandles(object:EditorSceneObject):readonly number[] {
  if(object.kind!=="physical-segment")return [];
  return pipeSceneHandles(object).flatMap((_,index)=>object.pipe?.controlledHandles?.includes(index)?[]:[index]);
}

export function pipeMidpoints(object:EditorSceneObject):readonly {index:number;point:EditorPoint}[] {
  if(object.kind!=="physical-segment")return [];
  if(object.pipe?.midpoints)return object.pipe.midpoints.flatMap((point,index)=>
    object.pipe?.controlledMidpoints?.includes(index)||!object.pipe?.joiningTransitionMidpoints?.some(item=>item.index===index)&&pipeSceneHandles(object).some((handle,handleIndex)=>
      !object.pipe?.controlledHandles?.includes(handleIndex)&&Math.hypot(point.x-handle.x,point.y-handle.y)<=10)?[]:[{point,index}]);
  const points=[object.points![0]!,...pipeSceneHandles(object),object.points!.at(-1)!];
  return points.slice(1).map((p,i)=>({index:i,point:{x:(p.x+points[i]!.x)/2,y:(p.y+points[i]!.y)/2}}));
}

export function e4Midpoints(object:EditorSceneObject):readonly {index:number;point:EditorPoint}[] {
  if(object.kind!=="wire"||!object.points)return [];
  return object.points.slice(1).map((p,i)=>({index:i,point:{x:(p.x+object.points![i]!.x)/2,y:(p.y+object.points![i]!.y)/2}}));
}

export function hitTestWireEnd(
  object: EditorSceneObject | undefined,
  point: EditorPoint,
  zoom: number,
): "from" | "to" | null {
  if (object?.kind !== "wire") return null;
  const points = object.points ?? [];
  if (points.length < 2) return null;
  const tolerance = 10 / zoom;
  if (Math.hypot(point.x - points[0]!.x, point.y - points[0]!.y) <= tolerance) return "from";
  const last = points.at(-1)!;
  return Math.hypot(point.x - last.x, point.y - last.y) <= tolerance ? "to" : null;
}

export interface VisibleCableSheathScene {
  readonly geometries: readonly CableSheathGeometry[];
  readonly incompatibleCableIds: readonly string[];
}

/** Resolves visible drawing sheaths without using hidden conductors as geometry. */
export function getVisibleCableSheathScene(
  cables: readonly CableInstance[],
  objects: readonly EditorSceneObject[],
  layers: readonly EditorLayer[],
): VisibleCableSheathScene {
  const layerMap = new Map(layers.map((layer) => [layer.id, layer]));
  const geometries: CableSheathGeometry[] = [];
  const incompatibleCableIds: string[] = [];
  for (const cable of cables) {
    const strip = cable.sheathStrip;
    if (strip && (strip.fromMm === null || strip.toMm === null || cable.lengthMm === null ||
        Math.round((strip.fromMm + strip.toMm) * 1000) === Math.round(cable.lengthMm * 1000))) continue;
    const members = cable.memberWireIds.map((wireId) =>
      objects.find((object) => object.id === wireId && object.kind === "wire"));
    if (members.some((member) => member && layerMap.get(member.layerId)?.visible !== true)) continue;
    const geometry = buildCableSheathGeometry(cable, objects);
    if (geometry) geometries.push(geometry);
    else incompatibleCableIds.push(cable.id);
  }
  return { geometries, incompatibleCableIds };
}

/** Selects the painted sheath contour while leaving its inner conductors easy to hit. */
export function hitTestCableSheath(
  geometries: readonly CableSheathGeometry[],
  point: EditorPoint,
  zoom: number,
): CableSheathGeometry | null {
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const tolerance = 7 / safeZoom;
  for (let index = geometries.length - 1; index >= 0; index -= 1) {
    const geometry = geometries[index]!;
    if (point.x < geometry.bounds.x - tolerance ||
        point.x > geometry.bounds.x + geometry.bounds.width + tolerance ||
        point.y < geometry.bounds.y - tolerance ||
        point.y > geometry.bounds.y + geometry.bounds.height + tolerance) continue;
    if (geometry.edges.some(([start, end]) => pointToSegmentDistance(point, start, end) <= tolerance)) {
      return geometry;
    }
  }
  return null;
}

export function hitTestEditorScene(
  objects: readonly EditorSceneObject[],
  layers: readonly EditorLayer[],
  point: EditorPoint,
  zoom: number,
  view?: HarnessEditorView,
  componentTemplateViewInstances: readonly ComponentTemplateViewInstance[] = [],
  resolveComponentTemplateAssetUrl?: ResolveComponentTemplateAssetUrl,
): string | null {
  const paintOrder = objectsInPaintOrder(objects, layers, view);
  const componentViews = new Map(componentTemplateViewInstances.map(instance => [instance.objectId, instance]));
  const tolerance = 7 / zoom;
  if (view === "drawing") {
    const objectIndex = [...paintOrder].reverse().find(object => object.kind === "object-index" && containsPoint(object, point, tolerance, view));
    if (objectIndex) return objectIndex.id;
  }
  const node = [...paintOrder].reverse().find(o => o.kind === "physical-node" && containsPoint(o, point, tolerance, view));
  if (node) return node.id;
  if (view === "drawing") {
    const position=[...paintOrder].reverse().find(o=>(o.kind==="position-leader"||o.kind==="leader-anchor"||o.kind==="rail-handle")&&containsPoint(o,point,tolerance,view));
    if(position)return position.id;
    const rail=[...paintOrder].reverse().find(o=>o.kind==="position-rail"&&containsPoint(o,point,tolerance,view));
    if(rail)return rail.id;
    const contact = hitTestConnectorContact(paintOrder, layers, point, zoom, view);
    if (contact) return contact.connectorId;
    const annotation=[...paintOrder].reverse().find(o=>(o.kind==="dimension"||o.kind==="physical-covering"||o.kind==="drawing-table")&&containsPoint(o,point,tolerance,view));
    if(annotation)return annotation.id;
    const pipe = [...paintOrder].reverse().find(o => o.kind === "physical-segment" && containsPoint(o, point, tolerance, view));
    if (pipe) return pipe.id;
    const visibleWire=[...paintOrder].reverse().find(o=>o.kind==="wire"&&!!o.visibleWireStrokes&&containsPoint(o,point,tolerance,view));
    if(visibleWire)return visibleWire.id;
  }
  for (let index = paintOrder.length - 1; index >= 0; index -= 1) {
    const object = paintOrder[index];
    const instance = object?.kind === "connector" ? componentViews.get(object.id) : undefined;
    const companions = object && instance && view === "e4" ? projectE4DrawingCompanions(instance, object, getE4ConnectorLayout(object)?.width ?? object.width, resolveComponentTemplateAssetUrl) : [];
    if(companions.some(companion=>companion.visible && point.x >= companion.bounds.minX-tolerance && point.x <= companion.bounds.maxX+tolerance && point.y >= companion.bounds.minY-tolerance && point.y <= companion.bounds.maxY+tolerance)) return object!.id;
    const projection = object && instance && view
      ? projectComponentTemplateView(instance, view, { x: object.x, y: object.y }, resolveComponentTemplateAssetUrl)
      : null;
    const contactSide = object && instance && view === "drawing"
      ? projectContactSideView(instance, { x: object.x, y: object.y }, projection?.bounds ?? {
        minX: object.x, minY: object.y, maxX: object.x + object.width, maxY: object.y + object.height,
      }, resolveComponentTemplateAssetUrl)
      : null;
    if (contactSide?.visible && point.x >= contactSide.drawing.bounds.minX - tolerance && point.x <= contactSide.drawing.bounds.maxX + tolerance &&
        point.y >= contactSide.drawing.bounds.minY - tolerance && point.y <= contactSide.drawing.bounds.maxY + tolerance) return object!.id;
    if (projection && point.x >= projection.bounds.minX - tolerance && point.x <= projection.bounds.maxX + tolerance &&
        point.y >= projection.bounds.minY - tolerance && point.y <= projection.bounds.maxY + tolerance) return object!.id;
    if(view==="drawing"&&object?.kind==="wire"&&object.metadata?.physicalRoute==="true"&&paintOrder.some(o=>o.kind==="physical-segment"&&containsPoint(o,point,tolerance,view)))continue;
    if (object && !(projection && view === "drawing") && containsPoint(object, point, tolerance, view)) return object.id;
  }
  return null;
}

/** Connection points are direct editing anchors and always win over a sleeve. */
export function coveringDragBlockedByPhysicalNode(
  objects: readonly EditorSceneObject[],
  layers: readonly EditorLayer[],
  point: EditorPoint,
  zoom: number,
  view: HarnessEditorView,
): boolean {
  return objects.some(object => object.kind === "physical-node" &&
    layers.some(layer => layer.id === object.layerId && layer.visible && !layer.locked) &&
    containsPoint(object, point, 7 / zoom, view));
}
