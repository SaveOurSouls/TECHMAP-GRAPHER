import { type EditorPoint, type EditorSceneObject, type EditorLayer } from "./editor-types";
import { terminationSceneBounds } from "./termination-scene";

export interface FreeWireEndpointRef {
  readonly wireId: string;
  readonly end: "from" | "to";
  readonly point: EditorPoint;
}

export interface EditorSelectionRectangle {
  readonly start: EditorPoint;
  readonly end: EditorPoint;
}

function normalizedSelectionRectangle({start,end}:EditorSelectionRectangle) {
  return {minX:Math.min(start.x,end.x),minY:Math.min(start.y,end.y),maxX:Math.max(start.x,end.x),maxY:Math.max(start.y,end.y)};
}

function rectangleOverlaps(left:ReturnType<typeof normalizedSelectionRectangle>,right:ReturnType<typeof normalizedSelectionRectangle>):boolean {
  return left.minX<=right.maxX&&left.maxX>=right.minX&&left.minY<=right.maxY&&left.maxY>=right.minY;
}

function pointInSelectionRectangle(point:EditorPoint,rectangle:ReturnType<typeof normalizedSelectionRectangle>):boolean {
  return point.x>=rectangle.minX&&point.x<=rectangle.maxX&&point.y>=rectangle.minY&&point.y<=rectangle.maxY;
}

function orientation(a:EditorPoint,b:EditorPoint,c:EditorPoint):number {
  return (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
}

function pointOnSegment(point:EditorPoint,start:EditorPoint,end:EditorPoint):boolean {
  return Math.abs(orientation(start,end,point))<.000001&&point.x>=Math.min(start.x,end.x)&&point.x<=Math.max(start.x,end.x)&&point.y>=Math.min(start.y,end.y)&&point.y<=Math.max(start.y,end.y);
}

function segmentsIntersect(a:EditorPoint,b:EditorPoint,c:EditorPoint,d:EditorPoint):boolean {
  const abC=orientation(a,b,c),abD=orientation(a,b,d),cdA=orientation(c,d,a),cdB=orientation(c,d,b);
  if((abC>0)!==(abD>0)&&(cdA>0)!==(cdB>0))return true;
  return abC===0&&pointOnSegment(c,a,b)||abD===0&&pointOnSegment(d,a,b)||cdA===0&&pointOnSegment(a,c,d)||cdB===0&&pointOnSegment(b,c,d);
}

function pathIntersectsSelectionRectangle(points:readonly EditorPoint[],rectangle:ReturnType<typeof normalizedSelectionRectangle>,closed=false):boolean {
  if(points.some(point=>pointInSelectionRectangle(point,rectangle)))return true;
  const corners:EditorPoint[]=[{x:rectangle.minX,y:rectangle.minY},{x:rectangle.maxX,y:rectangle.minY},{x:rectangle.maxX,y:rectangle.maxY},{x:rectangle.minX,y:rectangle.maxY}];
  const edges=[...points.slice(1).map((end,index)=>[points[index]!,end] as const),...(closed&&points.length>2?[[points.at(-1)!,points[0]!] as const]:[])];
  return edges.some(([start,end])=>corners.some((corner,index)=>segmentsIntersect(start,end,corner,corners[(index+1)%corners.length]!)));
}

function ellipseSelectionPath(start:EditorPoint,end:EditorPoint):EditorPoint[] {
  const center={x:(start.x+end.x)/2,y:(start.y+end.y)/2},radiusX=Math.abs(end.x-start.x)/2,radiusY=Math.abs(end.y-start.y)/2;
  return Array.from({length:33},(_,index)=>{const angle=index/32*Math.PI*2;return{x:center.x+Math.cos(angle)*radiusX,y:center.y+Math.sin(angle)*radiusY};});
}

/** Any touched visible object is a candidate for window selection. */
export function objectIntersectsSelectionRectangle(object:EditorSceneObject,selection:EditorSelectionRectangle):boolean {
  const rectangle=normalizedSelectionRectangle(selection),points=object.points??[],kind=object.metadata?.graphicKind;
  const terminationBounds=terminationSceneBounds(object);if(terminationBounds)return rectangleOverlaps(rectangle,terminationBounds);
  if(kind==="text"){
    const fontSize=Number(object.metadata?.graphicFontSize??16),width=Math.max(fontSize*1.8,object.label.length*fontSize*.65);
    return rectangleOverlaps(rectangle,{minX:object.x,minY:object.y-fontSize,maxX:object.x+width,maxY:object.y+fontSize*.2});
  }
  if(kind==="contact"){
    const point=points[0]??{x:object.x,y:object.y};
    return rectangleOverlaps(rectangle,{minX:point.x-6,minY:point.y-6,maxX:point.x+6,maxY:point.y+6});
  }
  if(kind==="rectangle")return rectangleOverlaps(rectangle,{minX:Math.min(points[0]?.x??object.x,points[1]?.x??object.x+object.width),minY:Math.min(points[0]?.y??object.y,points[1]?.y??object.y+object.height),maxX:Math.max(points[0]?.x??object.x,points[1]?.x??object.x+object.width),maxY:Math.max(points[0]?.y??object.y,points[1]?.y??object.y+object.height)});
  if(kind==="ellipse"&&points[0]&&points[1])return pathIntersectsSelectionRectangle(ellipseSelectionPath(points[0],points[1]),rectangle);
  const paths=object.paths??(points.length?[points]:[]);
  if(paths.some(path=>pathIntersectsSelectionRectangle(path,rectangle,kind==="closedContour")))return true;
  return rectangleOverlaps(rectangle,{minX:object.x,minY:object.y,maxX:object.x+Math.max(1,object.width),maxY:object.y+Math.max(1,object.height)});
}

export function selectionRectangleObjectIds(objects:readonly EditorSceneObject[],layers:readonly EditorLayer[],selection:EditorSelectionRectangle):readonly string[] {
  const visible=new Set(layers.filter(layer=>layer.visible).map(layer=>layer.id));
  return objects.filter(object=>visible.has(object.layerId)&&objectIntersectsSelectionRectangle(object,selection)).map(object=>object.id);
}

export type EditorSelectionMode = "replace" | "add" | "toggle";

export interface FreeWireEndAxis {
  readonly end: "from" | "to";
  readonly wireIds: readonly string[];
  readonly x: number;
  readonly minY: number;
  readonly maxY: number;
}

/** Free ends that can share a vertical alignment axis. End orientation and
 * layer are part of compatibility; Y remains independent while X is shared. */
export function freeWireEndpointRefs(objects: readonly EditorSceneObject[], selectedIds: ReadonlySet<string>, layers: readonly EditorLayer[]): FreeWireEndpointRef[] {
  return objects.flatMap(object => {
    if (object.kind !== "wire" || !selectedIds.has(object.id) || !layers.some(layer => layer.id === object.layerId && layer.visible && !layer.locked)) return [];
    return (["from", "to"] as const).flatMap(end => {
      const point = end === "from" ? object.points?.[0] : object.points?.at(-1);
      return point && object.metadata?.[end === "from" ? "freeFrom" : "freeTo"] === "true"
        ? [{ wireId: object.id, end, point }]
        : [];
    });
  });
}

export function freeWireEndAxes(refs: readonly FreeWireEndpointRef[]): FreeWireEndAxis[] {
  return (["from", "to"] as const).flatMap(end => {
    const side = refs.filter(ref => ref.end === end);
    if (side.length < 2) return [];
    return [{ end, wireIds: side.map(ref => ref.wireId),
      x: side.reduce((sum, ref) => sum + ref.point.x, 0) / side.length,
      minY: Math.min(...side.map(ref => ref.point.y)),
      maxY: Math.max(...side.map(ref => ref.point.y)) }];
  });
}

export function freeWireEndpointAxis(refs: readonly FreeWireEndpointRef[]): number | null {
  return freeWireEndAxes(refs)[0]?.x ?? null;
}

export function snapFreeWireEndpointX(point: EditorPoint, refs: readonly FreeWireEndpointRef[], wireId: string, end: "from" | "to", tolerance = 8): EditorPoint {
  const candidates = refs.filter(ref => ref.end === end && ref.wireId !== wireId && Math.abs(ref.point.x - point.x) <= tolerance)
    .sort((a, b) => Math.abs(a.point.x - point.x) - Math.abs(b.point.x - point.x));
  return candidates.length ? { x: candidates[0]!.point.x, y: point.y } : point;
}
