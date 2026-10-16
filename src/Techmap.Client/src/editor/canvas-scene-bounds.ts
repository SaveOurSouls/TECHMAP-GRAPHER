import type { EditorLayer, EditorSceneObject, HarnessEditorView } from "./editor-types";
import type { EditorSceneBounds } from "./editor-camera";
import type { CableInstance } from "./model";
import { terminationSceneBounds } from "./termination-scene";
import { objectsInPaintOrder } from "./canvas-paint-order";
import { connectorCanvasContactPoints, contactCrossCenter, getE4ConnectorLayout, getMaterializedConnectorContactPoints } from "./canvas-connector-layout";
import {
  getE4WireRoute, getVisibleE4SceneOverlays, parseE4SceneOverlays, getE4DifferentialPairLayouts, getE4ScreenLayout,
  type E4SceneOverlays,
} from "./canvas-e4-scene";
import { getDrawingWireStripProfileGeometries, getVisibleCableSheathScene } from "./canvas-scene-hit-test";
import { stripProfileStrokeWidth } from "./canvas-wire-strip-style";
import { getE4WireLabelLayout } from "./e4-wire-label";
import { parallelSpanWorld } from "./e4-parallel-spans";
import {
  projectE4DrawingCompanion, projectComponentTemplateView, projectContactSideView,
  type ComponentTemplateViewInstance, type ResolveComponentTemplateAssetUrl,
} from "./component-template-view-renderer";

function expandSceneBounds(
  bounds: EditorSceneBounds | null,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): EditorSceneBounds {
  if (!bounds) return { minX, minY, maxX, maxY };
  return {
    minX: Math.min(bounds.minX, minX),
    minY: Math.min(bounds.minY, minY),
    maxX: Math.max(bounds.maxX, maxX),
    maxY: Math.max(bounds.maxY, maxY),
  };
}

/** The index stays outside the projected library drawing, including rotations. */
export function drawingConnectorIndexLabel(object:EditorSceneObject,bounds:EditorSceneBounds) {
  if(object.metadata?.terminationPointOnly==='true'){
    const text=object.label.trim(),x=(bounds.minX+bounds.maxX)/2+14,y=(bounds.minY+bounds.maxY)/2+12;
    return {text,x,y,minX:x-4,minY:y-10,maxX:x+Math.max(28,text.length*8),maxY:y+10};
  }
  const text=object.label.trim(),x=bounds.minX+5,y=bounds.minY-8;
  return {text,x,y,minX:x,minY:y-15,maxX:x+Math.max(28,text.length*8),maxY:y+3};
}

/** Returns world-space bounds for everything painted in the current view. */
export function getEditorSceneBounds(
  objects: readonly EditorSceneObject[],
  layers: readonly EditorLayer[],
  view: HarnessEditorView,
  e4Overlays?: E4SceneOverlays,
  componentTemplateViewInstances: readonly ComponentTemplateViewInstance[] = [],
  resolveComponentTemplateAssetUrl?: ResolveComponentTemplateAssetUrl,
  cables: readonly CableInstance[] = [],
): EditorSceneBounds | null {
  let bounds: EditorSceneBounds | null = null;
  const visibleObjects = objectsInPaintOrder(objects, layers);
  const componentViews = new Map(componentTemplateViewInstances.map(instance => [instance.objectId, instance]));
  for (const object of visibleObjects) {
    const terminationBounds=terminationSceneBounds(object);
    if(terminationBounds){
      bounds=expandSceneBounds(bounds,terminationBounds.minX,terminationBounds.minY,terminationBounds.maxX,terminationBounds.maxY);
      const anchor=getMaterializedConnectorContactPoints(object)?.[0];
      if(view==='drawing'&&object.label.trim()&&!objects.some(candidate=>candidate.kind==='object-index'&&candidate.metadata?.indexObjectId===object.id)){
        const label=drawingConnectorIndexLabel(object,terminationBounds);bounds=expandSceneBounds(bounds,label.minX,label.minY,label.maxX,label.maxY);
      }else if(view==='e4'&&anchor&&object.label.trim())bounds=expandSceneBounds(bounds,anchor.x,anchor.y-31,anchor.x+object.label.length*8,anchor.y-13);
      if(anchor&&object.metadata?.terminationBadge)bounds=expandSceneBounds(bounds,anchor.x,anchor.y+8,anchor.x+object.metadata.terminationBadge.length*7,anchor.y+23);
      continue;
    }
    if (object.kind === "wire" || object.kind === "dimension" || object.kind === "physical-segment" || object.kind === "physical-covering") {
      const points = view === "e4" && object.kind === "wire" ? getE4WireRoute(object) : object.points ?? [];
      for (const point of points) {
        bounds = expandSceneBounds(bounds, point.x, point.y, point.x, point.y);
      }
      for (const geometry of getDrawingWireStripProfileGeometries(object, view)) {
        for (const primitive of geometry.primitives) {
          for (const point of primitive.polygon) {
            bounds = expandSceneBounds(
              bounds,
              point.x - stripProfileStrokeWidth / 2,
              point.y - stripProfileStrokeWidth / 2,
              point.x + stripProfileStrokeWidth / 2,
              point.y + stripProfileStrokeWidth / 2,
            );
          }
        }
      }
      if (view === "e4" && object.kind === "wire" && object.label) {
        const rawPosition = Number(object.metadata?.e4LabelPosition ?? "0.5");
        const position = Number.isFinite(rawPosition) && rawPosition >= 0 && rawPosition <= 1 ? rawPosition : 0.5;
        const label = getE4WireLabelLayout(points, object.label, position);
        if (label) bounds = expandSceneBounds(bounds, label.x, label.y, label.x + label.width, label.y + label.height);
      }
      continue;
    }
    const instance = object.kind === "connector" ? componentViews.get(object.id) : undefined;
    if (instance && view === "e4") {
      const companion = projectE4DrawingCompanion(instance, object, getE4ConnectorLayout(object)?.width ?? object.width, resolveComponentTemplateAssetUrl);
      if (companion) bounds = expandSceneBounds(bounds, companion.bounds.minX, companion.bounds.minY, companion.bounds.maxX, companion.bounds.maxY);
    }
    const projection = instance
      ? projectComponentTemplateView(instance, view, { x: object.x, y: object.y }, resolveComponentTemplateAssetUrl)
      : null;
    if (instance && view === "drawing") {
      const contactSide = projectContactSideView(instance,{x:object.x,y:object.y},projection?.bounds??{
        minX:object.x,minY:object.y,maxX:object.x+object.width,maxY:object.y+object.height,
      },resolveComponentTemplateAssetUrl);
      if (contactSide?.visible) bounds = expandSceneBounds(bounds,contactSide.drawing.bounds.minX,contactSide.drawing.bounds.minY,contactSide.drawing.bounds.maxX,contactSide.drawing.bounds.maxY);
    }
    if(view==="drawing"&&object.kind==="connector"&&object.label.trim()&&!objects.some(candidate=>candidate.kind==="object-index"&&candidate.metadata?.indexObjectId===object.id)){
      const label=drawingConnectorIndexLabel(object,projection?.bounds??{minX:object.x,minY:object.y,maxX:object.x+object.width,maxY:object.y+object.height});
      bounds=expandSceneBounds(bounds,label.minX,label.minY,label.maxX,label.maxY);
    }
    if (projection) {
      bounds = expandSceneBounds(
        bounds,
        projection.bounds.minX,
        projection.bounds.minY,
        projection.bounds.maxX,
        projection.bounds.maxY,
      );
      for (const point of connectorCanvasContactPoints(object, view)) {
        if (!point) continue;
        const cross = point.status === "not-connected" ? contactCrossCenter(point) : point;
        const markerRadius = point.status === "not-connected" ? point.crossSize : 4;
        bounds = expandSceneBounds(
          bounds,
          Math.min(point.x, cross.x) - markerRadius,
          Math.min(point.y, cross.y) - markerRadius,
          Math.max(point.x, cross.x) + markerRadius,
          Math.max(point.y, cross.y) + markerRadius,
        );
        if (point.secondaryPoint) bounds = expandSceneBounds(
          bounds,
          point.secondaryPoint.x - 4,
          point.secondaryPoint.y - 4,
          point.secondaryPoint.x + 4,
          point.secondaryPoint.y + 4,
        );
      }
      continue;
    }
    const e4Layout = view === "e4" ? getE4ConnectorLayout(object) : null;
    const width = e4Layout?.width ?? object.width;
    const height = e4Layout?.height ?? object.height;
    let minX = object.x;
    let maxX = object.x + Math.max(1, width);
    if (e4Layout) {
      const hasDisconnectedContact = e4Layout.rows.some((row) => row.status === "not-connected");
      if (hasDisconnectedContact) {
        if (e4Layout.connectionSide === "left") minX -= 21;
        else maxX += 21;
      }
    }
    bounds = expandSceneBounds(bounds, minX, object.y, maxX, object.y + Math.max(1, height));
    for (const point of connectorCanvasContactPoints(object, view)) {
      if (!point) continue;
      const cross = point.status === "not-connected" ? contactCrossCenter(point) : point;
      const markerRadius = point.status === "not-connected" ? point.crossSize : 4;
      bounds = expandSceneBounds(
        bounds,
        Math.min(point.x, cross.x) - markerRadius,
        Math.min(point.y, cross.y) - markerRadius,
        Math.max(point.x, cross.x) + markerRadius,
        Math.max(point.y, cross.y) + markerRadius,
      );
      if (point.secondaryPoint) bounds = expandSceneBounds(
        bounds,
        point.secondaryPoint.x - 4,
        point.secondaryPoint.y - 4,
        point.secondaryPoint.x + 4,
        point.secondaryPoint.y + 4,
      );
    }
  }

  if (view !== "e4") {
    for (const geometry of getVisibleCableSheathScene(cables, visibleObjects, layers).geometries) {
      bounds = expandSceneBounds(
        bounds,
        geometry.bounds.x,
        geometry.bounds.y,
        geometry.bounds.x + geometry.bounds.width,
        geometry.bounds.y + geometry.bounds.height,
      );
    }
    return bounds;
  }
  const visibleOverlays = getVisibleE4SceneOverlays(
    e4Overlays ?? parseE4SceneOverlays(objects),
    objects,
    layers,
  );
  for (const junction of visibleOverlays.junctions) {
    bounds = expandSceneBounds(
      bounds,
      junction.position.x - 5,
      junction.position.y - 5,
      junction.position.x + 5,
      junction.position.y + 5,
    );
  }
  for (const group of visibleOverlays.diffPairs) {
    for(const layout of getE4DifferentialPairLayouts(group, visibleObjects)){
    for(const along of [layout.span.start,layout.span.end])for(const cross of [layout.crossMinimum,layout.crossMaximum]){
      const p=parallelSpanWorld(layout.span,along,cross);bounds=expandSceneBounds(bounds,p.x,p.y,p.x,p.y);
    }
    }
  }
  for (const screen of visibleOverlays.screens) {
    const layout = getE4ScreenLayout(screen, visibleObjects);
    if (!layout) continue;
    const width = layout.orientation === "horizontal" ? layout.alongSize : layout.crossSize;
    const height = layout.orientation === "horizontal" ? layout.crossSize : layout.alongSize;
    bounds = expandSceneBounds(
      bounds,
      layout.center.x - width / 2,
      layout.center.y - height / 2,
      layout.center.x + width / 2,
      layout.center.y + height / 2,
    );
    for (const terminal of layout.terminals) bounds = expandSceneBounds(
      bounds,
      terminal.connectionPoint.x - 4,
      terminal.connectionPoint.y - 4,
      terminal.connectionPoint.x + 4,
      terminal.connectionPoint.y + 4,
    );
  }
  return bounds;
}
