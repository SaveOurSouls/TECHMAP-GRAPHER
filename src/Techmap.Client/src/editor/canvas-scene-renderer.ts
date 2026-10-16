import { type EditorCamera, type EditorPoint, type EditorSceneObject, type HarnessEditorView, type EditorLayer } from "./editor-types";
import { drawingEndArtworkPlacement } from "./preparation-drawing";
import { ComponentTemplateImageCache, type ComponentTemplateViewInstance, type ResolveComponentTemplateAssetUrl, projectE4DrawingCompanions, shortestDrawingLink, drawProjectedComponentTemplateView, projectComponentTemplateView, projectContactSideView } from "./component-template-view-renderer";
import { renderPartSvg } from "../wire-blank-artwork.mjs";
import { stripProfileStrokeWidth, stripProfileOutline, stripProfilePalette } from "./canvas-wire-strip-style";
import { getDrawingWireStripProfileGeometries, getVisibleCableSheathScene, numberedPipeBendHandles, pipeMidpoints, e4Midpoints } from "./canvas-scene-hit-test";
import { drawVolumeSurface, drawVolumeStroke } from "./drawing-volume";
import { drawCoveringSurface } from "./covering-renderer";
import { traceDrawingRoute } from "./drawing-route-path";
import { strokeE4Wire, drawE4BridgeCrossings, drawE4DifferentialPairs, drawE4Junctions, drawE4Screens } from "./canvas-e4-renderer";
import { getMaterializedConnectorContactPoints, getE4ConnectorLayout, legacyConnectorContactPoints } from "./canvas-connector-layout";
import { drawConnectorContactOverrides, drawE4Connector, drawSelectedConnectorContacts } from "./canvas-connector-renderer";
import { getE4WireRoute, type E4SceneOverlays, parseE4SceneOverlays, getVisibleE4SceneOverlays, getE4WireCrossings } from "./canvas-e4-scene";
import { getE4WireLabelLayout } from "./e4-wire-label";
import { type CableInstance } from "./model";
import { type E4ConnectorSnapGuides } from "./e4-connector-snap";
import { objectsInPaintOrder } from "./canvas-paint-order";
import { terminationSceneBounds } from "./termination-scene";
import { pipeSceneHandles } from "./physical-scene";
import { drawingConnectorIndexLabel } from "./canvas-scene-bounds";
import { type CableSheathGeometry } from "./cable-sheath-geometry";

function roundedRectangle(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

function drawGrid(context: CanvasRenderingContext2D, width: number, height: number, camera: EditorCamera) {
  context.fillStyle = "#f8fafb";
  context.fillRect(0, 0, width, height);
  const minorStep = 20 * camera.zoom;
  const majorStep = 100 * camera.zoom;
  if (minorStep >= 8) {
    context.fillStyle = "#dfe6ea";
    const startX = ((camera.offsetX % minorStep) + minorStep) % minorStep;
    const startY = ((camera.offsetY % minorStep) + minorStep) % minorStep;
    for (let x = startX; x < width; x += minorStep) {
      for (let y = startY; y < height; y += minorStep) context.fillRect(Math.round(x), Math.round(y), 1, 1);
    }
  }
  context.strokeStyle = "#d6e0e5";
  context.lineWidth = 1;
  context.beginPath();
  const majorX = ((camera.offsetX % majorStep) + majorStep) % majorStep;
  const majorY = ((camera.offsetY % majorStep) + majorStep) % majorStep;
  for (let x = majorX; x < width; x += majorStep) {
    context.moveTo(Math.round(x) + 0.5, 0);
    context.lineTo(Math.round(x) + 0.5, height);
  }
  for (let y = majorY; y < height; y += majorStep) {
    context.moveTo(0, Math.round(y) + 0.5);
    context.lineTo(width, Math.round(y) + 0.5);
  }
  context.stroke();
}

export interface WireDrawingEndArtworkPlacement {
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
  readonly scale: number;
}

/** The artwork's jacket edge is x=222 in its viewBox.  Keeping that edge at
 * the authored endpoint places all of the terminal outside the wire route. */
export function wireDrawingEndArtworkPlacement(origin: EditorPoint, adjacent: EditorPoint, drawingWidth: number): WireDrawingEndArtworkPlacement | null {
  return drawingEndArtworkPlacement(origin, adjacent, drawingWidth);
}

function drawWireDrawingEndStyles(context: CanvasRenderingContext2D, object: EditorSceneObject, selected: boolean, cache: ComponentTemplateImageCache): void {
  const points = object.points ?? [];
  const styles = object.drawingEndStyles;
  if (!styles || points.length < 2) return;
  context.save();
  const radius = Number(object.metadata?.drawingWidth ?? 2) * .35;
  (['from', 'to'] as const).forEach((end) => {
    if (object.metadata?.[`free${end === "from" ? "From" : "To"}`] === "false") return;
    const origin = end === 'from' ? points[0]! : points[points.length - 1]!;
    const adjacent = end === 'from' ? points[1]! : points[points.length - 2]!;
    const dx = adjacent.x - origin.x, dy = adjacent.y - origin.y;
    const length = Math.hypot(dx, dy);
    if (!length || styles[end] === 'cut') return;
    const svg = renderPartSvg(styles[end], object.color);
    const entry = cache.get('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg));
    if (entry.state === 'loaded') {
      const placement = wireDrawingEndArtworkPlacement(origin, adjacent, Number(object.metadata?.drawingWidth ?? 3));
      if (!placement) return;
      context.save(); context.translate(placement.x, placement.y); context.rotate(placement.rotation);
      context.scale(placement.scale, placement.scale); context.drawImage(entry.image, 0, -120, 1200, 240); context.restore();
      return;
    }
    const nx = -dy / length, ny = dx / length;
    const depth = Math.min(12, Math.max(5, length * 0.12));
    const tip = { x: origin.x - dx / length * depth, y: origin.y - dy / length * depth };
    context.strokeStyle = selected ? '#1179ac' : '#344b59';
    context.fillStyle = styles[end] === 'tin' ? '#b8c7cc' : styles[end] === 'copper' ? '#ca7e4a' : styles[end] === 'sealed' || styles[end] === 'sealed-pin' ? '#7a929e' : object.color;
    context.lineWidth = Number(object.metadata?.drawingWidth ?? 2) * .05;
    context.beginPath();
    context.moveTo(origin.x + nx * radius, origin.y + ny * radius);
    context.lineTo(tip.x + nx * radius * 1.2, tip.y + ny * radius * 1.2);
    context.lineTo(tip.x - nx * radius * 1.2, tip.y - ny * radius * 1.2);
    context.lineTo(origin.x - nx * radius, origin.y - ny * radius);
    context.closePath(); context.fill(); context.stroke();
    if (styles[end] === 'terminal' || styles[end] === 'sealed' || styles[end] === 'sealed-pin') {
      context.beginPath(); context.arc(tip.x, tip.y, radius * 1.25, 0, Math.PI * 2); context.stroke();
    }
    if (styles[end] === 'sealed-pin') {
      context.beginPath(); context.moveTo(tip.x, tip.y); context.lineTo(tip.x - dx / length * radius * 2.2, tip.y - dy / length * radius * 2.2); context.stroke();
    }
  });
  context.restore();
}

function drawWireStripProfiles(
  context: CanvasRenderingContext2D,
  object: EditorSceneObject,
  selected: boolean,
): void {
  context.save();
  context.setLineDash([]);
  context.lineWidth = stripProfileStrokeWidth;
  context.lineJoin = "miter";
  context.strokeStyle = selected ? "#1179ac" : stripProfileOutline;
  for (const geometry of getDrawingWireStripProfileGeometries(object, "drawing")) {
    geometry.primitives.forEach((primitive, index) => {
      context.beginPath();
      primitive.polygon.forEach((point, index) => index === 0
        ? context.moveTo(point.x, point.y)
        : context.lineTo(point.x, point.y));
      context.closePath();
      context.fillStyle = index === geometry.primitives.length - 1
        ? object.color
        : stripProfilePalette[(primitive.layerIndex - 1) % stripProfilePalette.length]!;
      context.fill();
      if (object.metadata?.volumeShading === "true") {
        drawVolumeSurface(context, primitive.polygon, primitive.centerline);
        context.beginPath();
        primitive.polygon.forEach((point, i) => i === 0 ? context.moveTo(point.x, point.y) : context.lineTo(point.x, point.y));
        context.closePath();
      }
      context.stroke();
    });
  }
  context.restore();
}

export function drawEditorSceneObject(
  context: CanvasRenderingContext2D,
  object: EditorSceneObject,
  selected: boolean,
  view: HarnessEditorView,
  componentTemplateViewInstance?: ComponentTemplateViewInstance,
  resolveComponentTemplateAssetUrl?: ResolveComponentTemplateAssetUrl,
  componentTemplateImageCache = new ComponentTemplateImageCache(),
  minimumStrokePixels = 0,
) {
  context.save();
  if (object.kind === "object-index") {
    const scale = Number(object.metadata?.indexScale ?? 1);
    context.font = `700 ${13 * scale}px Inter, Arial, sans-serif`;
    context.textAlign = "left";
    context.textBaseline = "middle";
    const padX = 4 * scale, height = 18 * scale, width = Math.max(object.width, context.measureText(object.label).width + padX * 2);
    const anchor = object.points?.[0], labelEndpoint = object.points?.[1] ?? { x: object.x + width / 2, y: object.y + height / 2 };
    if (anchor) {
      context.strokeStyle = selected ? "#1179ac" : object.color;
      context.lineWidth = 1;
      context.lineCap = "round";
      context.beginPath(); context.moveTo(anchor.x, anchor.y); context.lineTo(labelEndpoint.x, labelEndpoint.y); context.stroke();
      context.fillStyle = selected ? "#1179ac" : object.color;
      context.beginPath(); context.arc(anchor.x, anchor.y, 2.5 * scale, 0, Math.PI * 2); context.fill();
    }
    context.fillStyle = "rgba(255,255,255,.94)";
    context.fillRect(object.x, object.y, width, height);
    context.fillStyle = selected ? "#1179ac" : object.color;
    context.fillText(object.label, object.x + padX, object.y + height / 2);
    context.restore(); return;
  }
  if(object.kind.startsWith("graphic-")){const p=object.points??[],kind=object.metadata?.graphicKind;context.strokeStyle=selected?"#1179ac":object.color;context.fillStyle=context.strokeStyle;context.lineWidth=selected?Number(object.metadata?.graphicWidth??2)+1:Number(object.metadata?.graphicWidth??2);context.lineCap="round";context.lineJoin="round";context.beginPath();if(kind==="contact"){const q=p[0]!;context.arc(q.x,q.y,5,0,Math.PI*2);context.moveTo(q.x-9,q.y);context.lineTo(q.x+9,q.y);context.moveTo(q.x,q.y-9);context.lineTo(q.x,q.y+9);context.stroke();}else if(kind==="text"){const q=p[0]!;context.translate(q.x,q.y);context.rotate(Number(object.metadata?.graphicAngle??0)*Math.PI/180);const fontSize=Number(object.metadata?.graphicFontSize??16),fontFamily=object.metadata?.graphicFontFamily??"Arial";context.font=`${fontSize}px ${fontFamily}`;context.fillText(object.metadata?.graphicText??object.label,0,0);context.restore();return;}else if(kind==="rectangle"){const a=p[0]!,b=p[1]!;context.strokeRect(Math.min(a.x,b.x),Math.min(a.y,b.y),Math.abs(a.x-b.x),Math.abs(a.y-b.y));}else if(kind==="ellipse"){const a=p[0]!,b=p[1]!;context.ellipse((a.x+b.x)/2,(a.y+b.y)/2,Math.abs(a.x-b.x)/2,Math.abs(a.y-b.y)/2,0,0,Math.PI*2);context.stroke();}else if(kind==="bezier"&&p.length===4){context.moveTo(p[0]!.x,p[0]!.y);context.bezierCurveTo(p[1]!.x,p[1]!.y,p[2]!.x,p[2]!.y,p[3]!.x,p[3]!.y);context.stroke();}else{p.forEach((q,i)=>i?context.lineTo(q.x,q.y):context.moveTo(q.x,q.y));if(kind==="closedContour")context.closePath();context.stroke();}context.restore();return;}
  if(object.kind==="drawing-table") {
    const widths=JSON.parse(object.metadata?.widths ?? "[]") as number[],headers=JSON.parse(object.metadata?.headers ?? "[]") as string[],rows=JSON.parse(object.metadata?.rows ?? "[]") as string[][];
    context.fillStyle="#fff";context.fillRect(object.x,object.y,object.width,object.height);context.strokeStyle=selected?"#1179ac":object.color;context.lineWidth=selected?2:1;context.strokeRect(object.x,object.y,object.width,object.height);
    context.fillStyle=object.color;context.font="bold 12px Arial";context.fillText(object.label,object.x+8,object.y+17);
    const paintRow=(row:string[],y:number,height:number,bold:boolean)=>{let x=object.x;context.font=`${bold?"bold ":""}11px Arial`;row.forEach((value,i)=>{context.strokeRect(x,y,widths[i]!,height);context.save();context.beginPath();context.rect(x+3,y+1,widths[i]!-6,height-2);context.clip();context.fillText(value,x+5,y+height/2+4);context.restore();x+=widths[i]!;});};
    paintRow(headers,object.y+24,28,true);rows.forEach((r,i)=>paintRow(r,object.y+52+i*32,32,false));context.restore();return;
  }
  if(object.kind==="position-leader") {
    const a=object.points?.[0],b=object.points?.[1],radius=object.width/2,scale=radius/12;
    if(a&&b){context.strokeStyle=object.color;context.lineWidth=(selected?2:1)*scale;context.beginPath();context.moveTo(a.x,a.y);context.lineTo(b.x,b.y);context.stroke();context.beginPath();context.arc(b.x,b.y,radius,0,Math.PI*2);context.fillStyle="#fff";context.fill();context.stroke();context.fillStyle=object.color;context.textAlign="center";context.textBaseline="middle";context.font=`${12*scale}px Arial`;context.fillText(object.label,b.x,b.y,radius*1.6);}
    context.restore();return;
  }
  if(object.kind==="position-rail") {
    const a=object.points?.[0],b=object.points?.[1];
    if(a&&b){context.strokeStyle=selected?"#1179ac":object.color;context.lineWidth=selected?2:1;context.setLineDash([9,5,2,5]);context.beginPath();context.moveTo(a.x,a.y);context.lineTo(b.x,b.y);context.stroke();}
    context.restore();return;
  }
  if(object.kind==="rail-handle") {const radius=object.width/2;context.fillStyle=selected?"#1179ac":object.color;context.beginPath();context.arc(object.x+radius,object.y+radius,radius,0,Math.PI*2);context.fill();context.restore();return;}
  if(object.kind==="leader-anchor") {const radius=object.width/2;context.fillStyle=selected?"#1179ac":object.color;context.beginPath();context.arc(object.x+radius,object.y+radius,radius,0,Math.PI*2);context.fill();context.restore();return;}
  if(object.kind==="physical-covering") {drawCoveringSurface(context,object,selected);context.restore();return;}
  if(object.kind==="physical-segment"){
    const points=object.points??[];context.lineJoin="round";context.lineCap="round";
    context.globalAlpha*=Math.max(0,Math.min(1,Number(object.metadata?.opacity??(object.pipe?.role==="joining-pipe"?1:.72))));
    traceDrawingRoute(context,points,object.routeRadius);
    if(selected){context.strokeStyle="#1179ac";context.lineWidth=object.width+2;context.stroke();}
    context.strokeStyle=object.color;context.lineWidth=object.width;context.stroke();
    if(object.metadata?.volumeShading === "true") drawVolumeStroke(context,object.width);

    context.restore();return;
  }
  if(view==="drawing"&&object.kind==="wire"&&object.paths){
    context.lineJoin="round";context.lineCap="round";const lineWidth=Number(object.metadata?.drawingWidth??2);context.lineWidth=selected?lineWidth+1:lineWidth;
    for(const stroke of object.visibleWireStrokes??object.paths.map(points=>({points,width:lineWidth,radius:undefined,lineJoin:undefined as CanvasLineJoin|undefined}))){traceDrawingRoute(context,stroke.points,stroke.radius??object.routeRadius);if(stroke.lineJoin)context.lineJoin=stroke.lineJoin;strokeE4Wire(context,object.color,selected?stroke.width+1:stroke.width);if(object.metadata?.volumeShading === "true")drawVolumeStroke(context,stroke.width);}
    drawWireStripProfiles(context, object, selected);
    drawWireDrawingEndStyles(context, object, selected, componentTemplateImageCache);
    context.restore();return;
  }
  if (object.kind === "physical-node") {
    const x=object.x+5,y=object.y+5;
    // A movable exit point, without an uneditable decorative fitting.
    context.fillStyle=selected?"#00a0b7":object.color;
    context.strokeStyle=object.metadata?.nodeRole === "connector-exit" ? "#8a4b00" : "#17485d";
    context.lineWidth=1.5;
    context.beginPath();context.arc(x,y,5,0,Math.PI*2);context.fill();
    context.stroke();
    context.restore(); return;
  }
  if(object.kind==='connector'&&object.metadata?.terminationSymbol){
    const metadata=object.metadata,points=getMaterializedConnectorContactPoints(object)??[];
    for (const art of object.terminationArtwork ?? []) {
      const entry = componentTemplateImageCache.get(art.href);
      context.save(); context.translate(art.x, art.y); context.rotate(art.rotation); context.scale(art.scale, art.scale);
      if (entry.state === 'loaded') context.drawImage(entry.image, ...art.image);
      else {
        const [x,y,right,bottom] = art.localBounds;
        context.fillStyle = art.mode === 'copper' ? '#ca7e4a' : art.mode === 'tin' ? '#b8c7cc' : '#929699';
        // A calibrated loading/error silhouette also stays within the jacket.
        const height = Math.min(bottom-y,art.conductorDiameter/art.scale);
        context.fillRect(x,(y+bottom-height)/2,right-x,height);
      }
      context.restore();
    }
    if(metadata.terminationPointOnly!=='true'){
      const entry=componentTemplateImageCache.get(metadata.terminationSymbol!);
      if(entry.state==='loaded'){context.save();context.translate(object.x,object.y);context.rotate(Number(metadata.terminationRotation??0)*Math.PI/180);const scale=Number(metadata.terminationScale??1);context.scale(scale,scale);context.drawImage(entry.image,0,0,220,100);context.restore();}
    }
    for(const p of points)if(p){context.beginPath();context.arc(p.x,p.y,selected?5:3.5,0,Math.PI*2);context.fillStyle='#1684ba';context.fill();}
    const anchor=points[0];context.fillStyle='#17384b';context.font='600 12px Arial';if(view!=='drawing')context.fillText(object.label,(anchor?.x??object.x+32),(anchor?.y??object.y+50)-16);
    if(metadata.terminationBadge){context.font='11px Arial';context.fillText(metadata.terminationBadge,(anchor?.x??object.x+32),(anchor?.y??object.y+50)+20);}
    context.restore();return;
  }
  if (object.kind === "connector" && componentTemplateViewInstance) {
    if (view === "e4") {
      const layout=getE4ConnectorLayout(object);
      for(const companion of projectE4DrawingCompanions(componentTemplateViewInstance,object,layout?.width ?? object.width,resolveComponentTemplateAssetUrl).filter(d=>d.visible)) {
        const [from,to]=shortestDrawingLink({minX:object.x,minY:object.y,maxX:object.x+(layout?.width ?? object.width),maxY:object.y+(layout?.height ?? object.height)},companion.bounds);
        context.save();context.strokeStyle="#7b8996";context.lineWidth=1;context.setLineDash([4,4]);context.beginPath();context.moveTo(from.x,from.y);context.lineTo(to.x,to.y);context.stroke();context.restore();
        drawProjectedComponentTemplateView(context,companion,componentTemplateImageCache,selected);
      }
    }
    const projection = projectComponentTemplateView(
      componentTemplateViewInstance, view, { x: object.x, y: object.y }, resolveComponentTemplateAssetUrl,
    );
    if (projection) {
      drawProjectedComponentTemplateView(context, projection, componentTemplateImageCache, selected, minimumStrokePixels);
      drawConnectorContactOverrides(context, object, view, true);
      if (view === "drawing") {
        const contactSide = projectContactSideView(componentTemplateViewInstance, { x: object.x, y: object.y }, projection.bounds, resolveComponentTemplateAssetUrl);
        if (contactSide?.visible) {
          const [from,to] = contactSide.link;
          context.save();context.strokeStyle="#7b8996";context.lineWidth=1;context.setLineDash([4,4]);context.beginPath();context.moveTo(from.x,from.y);context.lineTo(to.x,to.y);context.stroke();context.restore();
          drawProjectedComponentTemplateView(context, contactSide.drawing, componentTemplateImageCache, selected, minimumStrokePixels);
        }
      }
      context.restore();
      return;
    }
  }
  if(object.kind==="dimension"&&object.metadata?.boundDimension==="true"&&object.points&&object.points.length>=4){
    const points=object.points,p=points[1]!,q=points.at(-2)!,line=points.slice(1,-1);
    const scale=Math.max(.25,Math.min(4,Number(object.metadata.dimensionScale??1)||1));
    context.strokeStyle=selected?"#1179ac":object.color;context.fillStyle=context.strokeStyle;context.lineWidth=(selected?2:1)*scale;
    context.setLineDash(object.metadata.auxiliary==="true"?[4,3]:[]);context.beginPath();points.forEach((p,i)=>i?context.lineTo(p.x,p.y):context.moveTo(p.x,p.y));context.stroke();
    for(const [point,next,dot] of [[p,line[1]!,object.metadata.dotStart],[q,line.at(-2)!,object.metadata.dotEnd]] as const){
      context.beginPath();if(dot==="true")context.arc(point.x,point.y,2.5*scale,0,Math.PI*2);
      else {const len=Math.hypot(next.x-point.x,next.y-point.y)||1,dx=(next.x-point.x)/len,dy=(next.y-point.y)/len;context.moveTo(point.x,point.y);context.lineTo(point.x+dx*8*scale-dy*3*scale,point.y+dy*8*scale+dx*3*scale);context.lineTo(point.x+dx*8*scale+dy*3*scale,point.y+dy*8*scale-dx*3*scale);context.closePath();}context.fill();
    }
    const mid=Math.floor((line.length-1)/2),a=line[mid]!,b=line[mid+1]!,angle=Math.atan2(b.y-a.y,b.x-a.x);
    context.translate((a.x+b.x)/2,(a.y+b.y)/2);context.rotate(angle>Math.PI/2||angle< -Math.PI/2?angle+Math.PI:angle);context.font=`600 ${12*scale}px Inter, Arial, sans-serif`;context.textAlign="center";context.fillText(object.label,0,-7*scale);context.restore();return;
  }
  if (object.kind === "specification-item") {
    context.strokeStyle=selected?"#1179ac":object.color;context.fillStyle="#fff";context.lineWidth=selected?3:1.5;
    context.fillRect(object.x,object.y,object.width,object.height);context.strokeRect(object.x,object.y,object.width,object.height);
    context.font="12px Arial";context.fillStyle=object.color;context.fillText(object.label,object.x+6,object.y+24,object.width-12);context.restore();return;
  }
  if (object.kind === "wire" || object.kind === "dimension") {
    const points = view === "e4" && object.kind === "wire" ? getE4WireRoute(object) : object.points ?? [];
    if (points.length >= 2) {
      context.beginPath();
      if(view==="drawing"&&object.kind==="wire")traceDrawingRoute(context,points,object.routeRadius);
      else points.forEach((point, index) => index === 0 ? context.moveTo(point.x, point.y) : context.lineTo(point.x, point.y));
      context.strokeStyle = selected ? "#1179ac" : object.color;
      context.lineWidth = view==="drawing"&&object.kind==="wire"?Number(object.metadata?.drawingWidth??3)+(selected?1:0):selected?4:object.kind==="wire"?3:1.5;
      if (object.kind === "dimension" || object.metadata?.routeMissing === "true") context.setLineDash([7, 5]);
      if (view === "e4" && object.kind === "wire" && !selected) strokeE4Wire(context, object.color);
      else context.stroke();
      context.setLineDash([]);
      if (view === "drawing" && object.kind === "wire") {
        if(object.metadata?.volumeShading === "true") drawVolumeStroke(context,Number(object.metadata?.drawingWidth??3));
        drawWireStripProfiles(context, object, selected);
        drawWireDrawingEndStyles(context, object, selected, componentTemplateImageCache);
      }
      if (selected) {
        context.fillStyle = "#ffffff";
        context.strokeStyle = "#1179ac";
        for (const point of points) {
          context.beginPath();
          context.arc(point.x, point.y, 4.5, 0, Math.PI * 2);
          context.fill();
          context.stroke();
        }
      }
      const rawLabelPosition = Number(object.metadata?.e4LabelPosition ?? "0.5");
      const labelPosition = Number.isFinite(rawLabelPosition) && rawLabelPosition >= 0 && rawLabelPosition <= 1
        ? rawLabelPosition
        : 0.5;
      const labelLayout = view === "e4" && object.kind === "wire" && object.label
        ? getE4WireLabelLayout(points, object.label, labelPosition)
        : null;
      const middle = points[Math.floor(points.length / 2)];
      if (labelLayout) {
        context.fillStyle = "rgba(255, 255, 255, 0.94)";
        roundedRectangle(context, labelLayout.x, labelLayout.y, labelLayout.width, labelLayout.height, 3);
        context.fill();
        context.font = "600 12px Inter, Arial, sans-serif";
        context.fillStyle = "#34566a";
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(object.label, labelLayout.x + labelLayout.width / 2, labelLayout.y + labelLayout.height / 2);
        context.textAlign = "start";
        context.textBaseline = "alphabetic";
      } else if (view !== "e4" && middle && object.label) {
        context.font = "600 12px Inter, Arial, sans-serif";
        context.fillStyle = "#34566a";
        context.fillText(object.label, middle.x + 8, middle.y - 9);
      }
    }
  } else if (object.kind === "connector") {
    const e4Layout = view === "e4" ? getE4ConnectorLayout(object) : null;
    if (e4Layout) {
      drawE4Connector(context, object, e4Layout, selected);
      drawConnectorContactOverrides(context, object, view, false);
      context.restore();
      return;
    }
    roundedRectangle(context, object.x, object.y, object.width, object.height, 7);
    context.fillStyle = "#ffffff";
    context.fill();
    context.strokeStyle = selected ? "#087bb4" : object.color;
    context.lineWidth = selected ? 3 : 2;
    context.stroke();
    if(view!=="drawing"){
      context.fillStyle = "#17384b";
      context.font = "700 13px Inter, Arial, sans-serif";
      context.fillText(object.label, object.x + 12, object.y + 22);
    }
    context.fillStyle = object.color;
    const materializedPoints = getMaterializedConnectorContactPoints(object);
    const points = legacyConnectorContactPoints(object);
    for (let index = 0; index < points.length; index += 1) {
      if (view==="drawing"&&materializedPoints || materializedPoints?.[index]) continue;
      const point = points[index]!;
      context.beginPath();
      context.arc(point.x, point.y, 3.5, 0, Math.PI * 2);
      context.fill();
      context.beginPath();
      context.arc(object.x, point.y, 3.5, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "#55717f";
      context.font = "500 9px Inter, Arial, sans-serif";
      context.fillText(String(index + 1), object.x + 9, point.y + 3);
      context.fillStyle = object.color;
    }
    if (materializedPoints) drawConnectorContactOverrides(context, object, view, false);
  } else {
    context.fillStyle = object.color;
    context.font = "600 14px Inter, Arial, sans-serif";
    context.fillText(object.label, object.x, object.y + 16);
    if (selected) {
      context.strokeStyle = "#087bb4";
      context.setLineDash([5, 4]);
      context.strokeRect(object.x - 6, object.y - 5, object.width + 12, object.height + 10);
    }
  }
  context.restore();
}

export function redrawCanvas(
  canvas: HTMLCanvasElement,
  view: HarnessEditorView,
  camera: EditorCamera,
  objects: readonly EditorSceneObject[],
  layers: readonly EditorLayer[],
  selectedObjectIds: ReadonlySet<string>,
  cables: readonly CableInstance[] = [],
  e4Overlays?: E4SceneOverlays,
  alignmentGuides?: E4ConnectorSnapGuides,
  componentTemplateViewInstances: readonly ComponentTemplateViewInstance[] = [],
  resolveComponentTemplateAssetUrl?: ResolveComponentTemplateAssetUrl,
  componentTemplateImageCache = new ComponentTemplateImageCache(),
  highlightedObjectIds: readonly string[] = [],
  physicalNodePreview?: { readonly from: EditorPoint; readonly to: EditorPoint } | null,
  foregroundWireIds:readonly string[] = [],
  backgroundObjects:readonly EditorSceneObject[] = [],
  backgroundOpacity = 0,
) {
  const context = canvas.getContext("2d");
  if (!context) return;
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(canvas.clientWidth));
  const height = Math.max(1, Math.round(canvas.clientHeight));
  const pixelWidth = Math.round(width * ratio);
  const pixelHeight = Math.round(height * ratio);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  drawGrid(context, width, height, camera);
  context.save();
  context.translate(camera.offsetX, camera.offsetY);
  context.scale(camera.zoom, camera.zoom);
  const componentViews = new Map(componentTemplateViewInstances.map(instance => [instance.objectId, instance]));
  if (backgroundOpacity > 0 && backgroundObjects.length > 0) {
    context.save();
    context.globalAlpha = Math.max(0, Math.min(1, backgroundOpacity));
    if (view === "drawing") drawCableSheaths(context, getVisibleCableSheathScene(cables, backgroundObjects, layers).geometries, new Set(), camera.zoom, new Set());
    for (const object of objectsInPaintOrder(backgroundObjects, layers, view)) {
      drawEditorSceneObject(context, object, false, view,
        object.kind === "connector" ? componentViews.get(object.id) : undefined,
        resolveComponentTemplateAssetUrl, componentTemplateImageCache,
        view === "drawing" ? ratio * .9 : 0);
    }
    context.restore();
  }
  if (view === "drawing") {
    drawCableSheaths(
      context,
      getVisibleCableSheathScene(cables, objects, layers).geometries,
      selectedObjectIds,
      camera.zoom,
      new Set(objects.filter(object => object.kind === "wire" && object.metadata?.volumeShading === "true").map(object => object.id)),
    );
  }
  const highlighted = new Set(highlightedObjectIds);
  for (const object of objectsInPaintOrder(objects, layers, view)) {
    if (highlighted.has(object.id) && object.kind === "wire") {
      const points = view === "e4" ? getE4WireRoute(object) : object.points ?? [];
      context.save(); context.strokeStyle = "#f2af28"; context.globalAlpha = .65;
      context.lineWidth = 9 / Math.max(.5, camera.zoom); context.lineJoin = "round"; context.beginPath();
      for(const path of view==="drawing"?object.paths??[points]:[points]) {if(view==="drawing")traceDrawingRoute(context,path,object.routeRadius);else {context.beginPath();path.forEach((point,i)=>i?context.lineTo(point.x,point.y):context.moveTo(point.x,point.y));}context.stroke();} context.restore();
    }
    if(highlighted.has(object.id)&&object.kind!=="wire") {
      context.save();context.strokeStyle="#f2af28";context.globalAlpha=.7;context.lineWidth=6/Math.max(.5,camera.zoom);
      if(object.kind==="physical-covering"||object.kind==="physical-segment") {for(const path of object.paths??[object.points??[]]){traceDrawingRoute(context,path,object.routeRadius);context.stroke();}}
      else {
        const instance=componentViews.get(object.id);
        const projection=instance&&view==="drawing"?projectComponentTemplateView(instance,view,object,resolveComponentTemplateAssetUrl):null;
        const bounds=terminationSceneBounds(object)??projection?.bounds;
        if(bounds)context.strokeRect(bounds.minX-4,bounds.minY-4,bounds.maxX-bounds.minX+8,bounds.maxY-bounds.minY+8);
        else context.strokeRect(object.x-4,object.y-4,object.width+8,object.height+8);
      }
      context.restore();
    }
    drawEditorSceneObject(
      context,
      object,
      selectedObjectIds.has(object.id),
      view,
      object.kind === "connector" ? componentViews.get(object.id) : undefined,
      resolveComponentTemplateAssetUrl,
      componentTemplateImageCache,
      view === "drawing" ? ratio * .9 : 0,
    );
  }
  if (physicalNodePreview) {
    context.save();
    context.strokeStyle = "#1179ac";
    context.globalAlpha = 0.65;
    context.lineWidth = 2 / Math.max(0.5, camera.zoom);
    context.setLineDash([7 / Math.max(0.5, camera.zoom), 5 / Math.max(0.5, camera.zoom)]);
    context.beginPath();
    context.moveTo(physicalNodePreview.from.x, physicalNodePreview.from.y);
    context.lineTo(physicalNodePreview.to.x, physicalNodePreview.to.y);
    context.stroke();
    context.restore();
  }
  if (view === "drawing") {
    for (const object of objectsInPaintOrder(objects,layers)) {
      if (object.kind !== "physical-node" && object.kind !== "physical-segment") continue;
      const points: EditorPoint[] = object.kind === "physical-node" ? [{x:object.x+5,y:object.y+5}] : [object.points![0]!,...pipeSceneHandles(object),object.points!.at(-1)!];
      const bendHandles=object.kind==="physical-segment"?numberedPipeBendHandles(object):[];
      if(object.kind==="physical-segment")for(const {point:p} of pipeMidpoints(object)){
        context.save();context.globalAlpha=.35;context.fillStyle="#1179ac";context.beginPath();context.arc(p.x,p.y,4/camera.zoom,0,Math.PI*2);context.fill();context.restore();
      }
      context.save(); context.lineWidth=2/camera.zoom; context.strokeStyle="#006f99";
      points.forEach((p,i)=>{
        const controlled=object.pipe?.controlledHandles?.includes(i-1)===true;
        // OP boundary stations shape the projected route, but are not bends.
        if(object.kind==="physical-segment"&&controlled) return;
        const transition=object.kind==="physical-segment"&&object.pipe?.joiningTransitionHandles?.some(handle=>handle.index===i-1)===true;
        context.beginPath();context.arc(p.x,p.y,(object.kind==="physical-node"?6:transition?5.5:controlled?4:5)/camera.zoom,0,Math.PI*2);
        context.fillStyle=object.kind==="physical-node"?object.color:"#fff";context.fill();context.stroke();
        const bendNumber=bendHandles.indexOf(i-1)+1;
        if(bendNumber>0){context.font=`${10/camera.zoom}px Arial`;context.fillStyle="#17485d";context.fillText(String(bendNumber),p.x+8/camera.zoom,p.y-8/camera.zoom);}
      });
      if(object.kind==="physical-node"){const vector = object.port?.direction;if(vector){const length=12/camera.zoom,c={x:points[0]!.x+vector.x*length,y:points[0]!.y+vector.y*length};context.beginPath();context.moveTo(points[0]!.x,points[0]!.y);context.lineTo(c.x,c.y);context.stroke();context.beginPath();context.moveTo(c.x,c.y);context.lineTo(c.x-vector.x*4/camera.zoom-vector.y*3/camera.zoom,c.y-vector.y*4/camera.zoom+vector.x*3/camera.zoom);context.moveTo(c.x,c.y);context.lineTo(c.x-vector.x*4/camera.zoom+vector.y*3/camera.zoom,c.y-vector.y*4/camera.zoom-vector.x*3/camera.zoom);context.stroke();}}
      context.restore();
    }
  }
  if (view === "e4") {
    const overlays = e4Overlays ?? parseE4SceneOverlays(objects);
    const visibleOverlays = getVisibleE4SceneOverlays(overlays, objects, layers);
    if (overlays.crossingStyle === "bridge") {
      const pairKeys = new Set(visibleOverlays.diffPairs.map(pair => [...pair.wireIds].sort().join("\u0000")));
      const crossings = getE4WireCrossings(objects, layers, visibleOverlays.junctions).filter(crossing =>
        !pairKeys.has([crossing.overWireId, crossing.underWireId].sort().join("\u0000")));
      drawE4BridgeCrossings(context, crossings, objects);
    }
    drawE4DifferentialPairs(context, visibleOverlays.diffPairs, objects);
    drawE4Junctions(context, visibleOverlays.junctions);
    drawE4Screens(context, visibleOverlays.screens, objects);
    drawE4ConnectorAlignmentGuides(context, alignmentGuides, camera.zoom);
    for(const wire of objectsInPaintOrder(objects,layers).filter(o=>o.kind==="wire"&&selectedObjectIds.has(o.id))){
      context.save();context.fillStyle="#1179ac";
      for(const {point:p} of e4Midpoints(wire)){context.globalAlpha=.35;context.beginPath();context.arc(p.x,p.y,4/camera.zoom,0,Math.PI*2);context.fill();}
      context.globalAlpha=1;context.lineWidth=1.5/camera.zoom;context.strokeStyle="#006f99";
      for(const p of (wire.points??[]).slice(1,-1)){context.beginPath();context.arc(p.x,p.y,4/camera.zoom,0,Math.PI*2);context.fillStyle="white";context.fill();context.stroke();}
      context.restore();
    }
  }
  // A selected electrical wire is the complete route, including conductors
  // hidden by the first-hit projection. Draw it after every pipe and sleeve.
  if(view==="drawing")for(const object of objectsInPaintOrder(objects,layers,view)){
    if(object.kind!=="wire"||!foregroundWireIds.includes(object.id))continue;
    context.save();context.lineCap="round";context.lineJoin="round";
    const width=Number(object.metadata?.drawingWidth??2.5);
    for(const path of object.paths??[object.points??[]]){
      if(path.length<2)continue;
      traceDrawingRoute(context,path,object.routeRadius);
      context.strokeStyle="#fff";context.lineWidth=width+6/Math.max(.5,camera.zoom);context.stroke();
      traceDrawingRoute(context,path,object.routeRadius);
      context.strokeStyle="#cf5e00";context.lineWidth=width+3/Math.max(.5,camera.zoom);context.stroke();
      traceDrawingRoute(context,path,object.routeRadius);strokeE4Wire(context,object.color,width);
    }
    context.restore();
  }
  // Contact marks and drawing indexes are a final interaction pass.
  // No wire, sleeve, picture, table or E4 overlay can paint over them.
  for (const object of objectsInPaintOrder(objects, layers, view)) {
    if (object.kind !== "connector") continue;
    drawConnectorContactOverrides(context, object, view, true);
    if (selectedObjectIds.has(object.id)) drawSelectedConnectorContacts(context, object, view, camera.zoom);
  }
  if(view==="drawing"){
    const indexed=new Set(objects.filter(object=>object.kind==="object-index").map(object=>object.metadata?.indexObjectId));
    context.save();context.fillStyle="#17384b";context.font="700 13px Inter, Arial, sans-serif";
    for(const object of objectsInPaintOrder(objects,layers,view)){
      if(object.kind!=="connector"||!object.label.trim()||indexed.has(object.id))continue;
      const instance=componentViews.get(object.id),projection=instance?projectComponentTemplateView(instance,"drawing",{x:object.x,y:object.y},resolveComponentTemplateAssetUrl):null;
      const label=drawingConnectorIndexLabel(object,terminationSceneBounds(object)??projection?.bounds??{minX:object.x,minY:object.y,maxX:object.x+object.width,maxY:object.y+object.height});
      context.fillText(label.text,label.x,label.y);
    }
    context.restore();
  }
  context.restore();
}

export function drawCableSheaths(
  context: CanvasRenderingContext2D,
  geometries: readonly CableSheathGeometry[],
  selectedObjectIds: ReadonlySet<string>,
  zoom = 1,
  shadedWireIds: ReadonlySet<string> = new Set(),
): void {
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  for (const geometry of geometries) {
    const selected = geometry.memberWireIds.length > 0 &&
      geometry.memberWireIds.every((wireId) => selectedObjectIds.has(wireId));
    context.save();
    context.beginPath();
    geometry.polygon.forEach((point, index) => index === 0
      ? context.moveTo(point.x, point.y)
      : context.lineTo(point.x, point.y));
    context.closePath();
    context.fillStyle = selected ? "rgba(17, 121, 172, 0.13)" : "rgba(82, 105, 119, 0.08)";
    context.fill();
    if (geometry.memberWireIds.some(id => shadedWireIds.has(id))) {
      drawVolumeSurface(context, geometry.polygon, geometry.centerline);
      context.beginPath();
      geometry.polygon.forEach((point, index) => index === 0 ? context.moveTo(point.x, point.y) : context.lineTo(point.x, point.y));
      context.closePath();
    }
    context.strokeStyle = selected ? "#1179ac" : "#607d8b";
    context.lineWidth = (selected ? 3 : 2) / safeZoom;
    context.setLineDash(selected ? [] : [8 / safeZoom, 4 / safeZoom]);
    context.stroke();
    context.restore();
  }
}

function drawE4ConnectorAlignmentGuides(
  context: CanvasRenderingContext2D,
  guides: E4ConnectorSnapGuides | undefined,
  zoom: number,
) {
  if (!guides?.horizontal && !guides?.vertical) return;
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  context.save();
  context.strokeStyle = "#e04f9c";
  context.lineWidth = 1 / safeZoom;
  context.setLineDash([4 / safeZoom, 3 / safeZoom]);
  context.beginPath();
  if (guides.vertical) {
    context.moveTo(guides.vertical.x, guides.vertical.fromY);
    context.lineTo(guides.vertical.x, guides.vertical.toY);
  }
  if (guides.horizontal) {
    context.moveTo(guides.horizontal.fromX, guides.horizontal.y);
    context.lineTo(guides.horizontal.toX, guides.horizontal.y);
  }
  context.stroke();
  context.restore();
}
