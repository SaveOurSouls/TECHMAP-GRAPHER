import {
  type CanvasViewportProps,
  type CoveringPointerDrag,
  type PointerDrag,
  type ObjectPointerDrag,
  type DrawingPointerDrag,
  type WireRoutePointerDrag,
  type E4WireSegmentPointerDrag,
  type E4WireLabelPointerDrag,
  type E4ScreenPointerDrag,
  type PhysicalNodeConnectPointerDrag,
} from "./canvas-viewport-types";
import { useRef, useEffect, useState, useMemo, type PointerEvent, type DragEvent, type MouseEvent } from "react";
import {
  type FreeWireEndpointRef,
  type EditorSelectionRectangle,
  type EditorSelectionMode,
  freeWireEndpointRefs,
  freeWireEndAxes,
  selectionRectangleObjectIds,
  snapFreeWireEndpointX,
} from "./canvas-selection";
import { type EditorPoint, type EditorSceneObject } from "./editor-types";
import {
  ComponentTemplateImageCache,
  projectComponentTemplateView,
  projectE4DrawingCompanions,
  projectContactSideView,
} from "./component-template-view-renderer";
import { type DrawingGraphic, type DrawingGraphicKind } from "./drawing-documents";
import {
  type E4ConnectableEndpoint,
  parseE4SceneOverlays,
  hitTestE4ScreenConnection,
  hitTestWireSegment,
  hitTestE4Screen,
  hitTestE4DifferentialPair,
  hitTestE4WireLabel,
  hitTestE4WireSegment,
  getE4WireRoute,
  getE4ScreenLayout,
  getE4ScreenPositionForPoint,
} from "./canvas-e4-scene";
import { type E4ConnectorSnapGuides, snapE4ConnectorPosition } from "./e4-connector-snap";
import {
  getVisibleCableSheathScene,
  containsPoint,
  hitTestEditorScene,
  hitTestWireRoutePoint,
  pipeMidpoints,
  coveringDragBlockedByPhysicalNode,
  hitTestWireEnd,
  e4Midpoints,
  hitTestCableSheath,
  pointToSegmentDistance,
} from "./canvas-scene-hit-test";
import { getE4ConnectorLayout, hitTestConnectorContact } from "./canvas-connector-layout";
import { redrawCanvas, drawEditorSceneObject } from "./canvas-scene-renderer";
import { placementSceneObject } from "./termination-placement-interaction";
import { warmCoveringTextures, coveringHit, coveringGrips } from "./covering-renderer";
import {
  handleEditorViewportWheel,
  e4ConnectorSnapTarget,
  inlineObjectDragMoved,
  inlineObjectDragDestination,
  containInlineEditorPointerEvent,
  isInlineEditorControlTarget,
  isInlineEditorReadonlyTarget,
} from "./canvas-interaction-helpers";
import { type CanvasHintTarget } from "./CanvasObjectHint";
import {
  snapBendPoint,
  snapPhysicalPoint,
  physicalObjectSnapAnchors,
  physicalObjectRouteAnchors,
  bendSnapAnchors,
  pipeBendSnapAnchors,
  joiningPipeEndpointSnapAnchors,
} from "./physical-editing";
import { type DrawingOutline, snapDrawingPoint } from "../component-library/drawing-geometry";
import { screenToWorld, panEditorCamera } from "./editor-camera";
import { terminationSceneContainsPoint } from "./termination-scene";
import { snapRailEnd, railParameter, railDistance, railCatchDistance } from "./position-rail";
import { pipeSceneEditablePoints, pipeSceneHandles, pipeSceneControls } from "./physical-scene";
import { CONTACT_SIDE_VIEW_PLACEMENT_ID } from "./drawing-scale";
import { projectOntoPolyline } from "./physical-coverings";
import { type CoveringHandle } from "./covering-layout";
import { projectPointToE4WireLabelPosition } from "./e4-wire-label";

export function useCanvasViewport({
  pendingPlacement, onPlace, onPlacementCancel,
  onFreeWireEndpointMove, onFreeWireEndpointsXChange, onFreeWireEndpointPreview, onDetachedPairAction, onFreeWireEndStyleRequest,
  view,
  tool,
  camera,
  objects,
  layers,
  selectedObjectId,
  selectedObjectIds,
  highlightedObjectIds = [],
  foregroundWireIds = [],
  backgroundObjects = [],
  backgroundOpacity = 0,
  cables = [],
  e4Overlays,
  e4RoutingMode = "orthogonal",
  componentTemplateViewInstances = [],
  resolveComponentTemplateAssetUrl,
  overlay,onDimensionCreate,onPositionRailCreate,onGraphicCreate,drawingSnaps={corners:true,contours:true,tangents:true},drawingAngleStep=15,
  diagnosticOverlay,
  inlineEditor,
  onCameraChange,
  onViewportSizeChange,
  onObjectSelect,
  onObjectGroupSelect,
  onObjectsIsolate,
  onObjectsSave,
  dimmedObjectIds,
  objectProperties, onObjectPick, onObjectPickCancel, onRelatedObjectsSelect, onObjectMove, onDrawingMove, onDrawingScale,
  onObjectMovePreview, onPipeIntervalSelect, onCoveringDrag,
  onWireConnect,
  onWireReconnect,
  onWireConnectToWire,
  onWireReconnectToWire,
  onE4WireSegmentMove,
  onE4WireRoutePointRemove,
  onE4WireLabelPositionChange,
  onE4ScreenPositionChange,
  onWireToolRequest,
  onWireRoutePointMove, onWireRoutePointPreview,
  onWireRoutePointRemove,
  onObjectEditRequest,
  onCanvasDoubleClick, onPhysicalContextAction, onPhysicalNodesConnect, onPhysicalNodeConnectToSegment,
  onCatalogDrop,
}: CanvasViewportProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const freeEndDrag = useRef<{wireId:string;end:"from"|"to";pointerId:number;group?:readonly FreeWireEndpointRef[]}|null>(null);
  useEffect(()=>{
    const cancel=(event:KeyboardEvent)=>{if(event.key!=="Escape"||!freeEndDrag.current)return;const d=freeEndDrag.current;freeEndDrag.current=null;for(const ref of d.group??[{wireId:d.wireId,end:d.end}])onFreeWireEndpointPreview?.(ref.wireId,ref.end,null);};
    window.addEventListener("keydown",cancel);
    return ()=>window.removeEventListener("keydown",cancel);
  },[onFreeWireEndpointPreview]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [placementPoint, setPlacementPoint] = useState<EditorPoint | null>(null);
  useEffect(() => { setPlacementPoint(null); }, [pendingPlacement?.id, view]);
  useEffect(() => {
    if (!pendingPlacement) return;
    const cancel = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopPropagation();
      setPlacementPoint(null); onPlacementCancel?.();
    };
    window.addEventListener('keydown', cancel);
    return () => window.removeEventListener('keydown', cancel);
  }, [pendingPlacement, onPlacementCancel]);
  const componentTemplateImageCacheRef = useRef<ComponentTemplateImageCache | null>(null);
  if (!componentTemplateImageCacheRef.current) {
    componentTemplateImageCacheRef.current = new ComponentTemplateImageCache();
  }
  const dragRef = useRef<CoveringPointerDrag | PointerDrag | ObjectPointerDrag | DrawingPointerDrag | WireRoutePointerDrag |
    E4WireSegmentPointerDrag | E4WireLabelPointerDrag | E4ScreenPointerDrag | PhysicalNodeConnectPointerDrag | null>(null);
  const inlineDragRef = useRef<ObjectPointerDrag | null>(null);
  const inlineCaptureRef = useRef<HTMLDivElement | null>(null);
  const inlineDragActivatedRef = useRef(false);
  const suppressInlineDoubleClickUntilRef = useRef(0);
  const [inlineDragOffset, setInlineDragOffset] = useState<EditorPoint | null>(null);
  const [drawingPreview,setDrawingPreview]=useState<{objectId:string;drawingId:string;offset:EditorPoint}|null>(null);
  const [scalePreview,setScalePreview]=useState<{objectId:string;drawingId:string;scale:number}|null>(null);
  const displayInstances=componentTemplateViewInstances.map(instance=>{
    const change=drawingPreview?.objectId===instance.objectId?drawingPreview:scalePreview?.objectId===instance.objectId?scalePreview:null;
    if(!change)return instance;
    const previous=instance.drawingPlacements?.find(p=>p.drawingId===change.drawingId)??{drawingId:change.drawingId,visible:true,offset:{x:0,y:0}};
    return {...instance,drawingPlacements:[...(instance.drawingPlacements??[]).filter(p=>p.drawingId!==change.drawingId),{...previous,...("scale" in change?{scale:change.scale}:{offset:change.offset})}]};
  });
  const [dimensionStart,setDimensionStart]=useState<{wireId:string;index:number;point:EditorPoint;pointCount:number}[]>([]);
  const [railDraft,setRailDraft]=useState<{start:EditorPoint;end:EditorPoint;leaderIds:readonly string[]}|null>(null);
  const [dimensionMessage,setDimensionMessage]=useState("");
  const [graphicStart,setGraphicStart]=useState<EditorPoint|null>(null);
  const [graphicPathDraft,setGraphicPathDraft]=useState<{kind:"line"|"polyline"|"closedContour";points:EditorPoint[]}|null>(null);
  const [graphicPreview,setGraphicPreview]=useState<DrawingGraphic|null>(null);
  const [selectionRectangle,setSelectionRectangle]=useState<EditorSelectionRectangle|null>(null);
  const [selectionCandidateIds,setSelectionCandidateIds]=useState<readonly string[]>([]);
  const selectionDragRef=useRef<{pointerId:number;start:EditorPoint;clientX:number;clientY:number;mode:EditorSelectionMode}|null>(null);
  useEffect(()=>{setDimensionStart([]);setDimensionMessage("");},[tool,view]);
  useEffect(()=>{setRailDraft(null);},[tool,view]);
  useEffect(()=>{setGraphicStart(null);setGraphicPathDraft(null);setGraphicPreview(null);setSelectionRectangle(null);setSelectionCandidateIds([]);selectionDragRef.current=null;},[tool,view]);
  const [wireStart, setWireStart] = useState<E4ConnectableEndpoint | null>(null);
  const [wireReconnect, setWireReconnect] = useState<{ readonly wireId: string; readonly end: "from" | "to" } | null>(null);
  useEffect(() => {
    if (pendingPlacement) { setWireStart(null); setWireReconnect(null); }
  }, [pendingPlacement?.id]);
  const [wireLabelPreview, setWireLabelPreview] = useState<{ readonly wireId: string; readonly position: number } | null>(null);
  const [screenPositionPreview, setScreenPositionPreview] = useState<{ readonly screenId: string; readonly position: number } | null>(null);
  const [connectorAlignmentGuides, setConnectorAlignmentGuides] = useState<E4ConnectorSnapGuides>({});
  const [physicalGuide,setPhysicalGuide]=useState<readonly EditorPoint[]|undefined>();
  const displayObjects = wireLabelPreview
    ? objects.map((object) => object.id === wireLabelPreview.wireId ? {
      ...object,
      metadata: { ...object.metadata, e4LabelPosition: String(wireLabelPreview.position) },
    } : object)
    : objects;
  const activeSelectedIds = selectedObjectIds ?? (selectedObjectId ? [selectedObjectId] : []);
  const selectedSet = new Set(activeSelectedIds);
  const paintObjects=graphicPreview?[...displayObjects,{...graphicPreview,id:"graphic-preview",kind:(`graphic-${graphicPreview.kind.replace("closedContour","closed-contour")}`) as EditorSceneObject["kind"],layerId:view==="drawing"?"dimensions":"connectors",label:graphicPreview.text??graphicPreview.kind,x:Math.min(...graphicPreview.points.map(point=>point.x)),y:Math.min(...graphicPreview.points.map(point=>point.y)),width:Math.max(1,Math.abs((graphicPreview.points.at(-1)?.x??0)-(graphicPreview.points[0]?.x??0))),height:Math.max(1,Math.abs((graphicPreview.points.at(-1)?.y??0)-(graphicPreview.points[0]?.y??0))),color:graphicPreview.color??"#253b4a",metadata:{graphicKind:graphicPreview.kind,graphicView:graphicPreview.view,graphicText:graphicPreview.text??"",graphicAngle:String(graphicPreview.angle??0),graphicFontFamily:graphicPreview.fontFamily??"Arial",graphicFontSize:String(graphicPreview.fontSize??16),graphicWidth:String(graphicPreview.width??2)}}]:displayObjects;
  const paintSelectedSet=graphicPreview?new Set([...selectedSet,"graphic-preview"]):selectedSet;
  const effectiveHighlights=[...highlightedObjectIds,...selectionCandidateIds];
  const freeEndpointRefs = freeWireEndpointRefs(objects, selectedSet, layers);
  const freeEndAxes = freeWireEndAxes(freeEndpointRefs);
  const snapRefs = freeWireEndpointRefs(objects, new Set(objects.map(object => object.id)), layers);
  const pairActionIds=(id:string):readonly string[]=>{
    const selected=objects.filter(o=>o.kind==="wire"&&selectedSet.has(o.id));
    if(selected.length===2)return selected.map(o=>o.id);
    try{const ids:unknown=JSON.parse(objects.find(o=>o.id===id)?.metadata?.drawingPairWireIds??"null");return Array.isArray(ids)&&ids.length===2&&ids.every(id=>typeof id==="string"&&objects.some(o=>o.id===id&&o.kind==="wire"))?ids:[];}catch{return [];}
  };
  const sourceOverlays = useMemo(
    () => e4Overlays ?? parseE4SceneOverlays(objects),
    [e4Overlays, objects],
  );
  const overlays = useMemo(() => screenPositionPreview ? {
    ...sourceOverlays,
    screens: sourceOverlays.screens.map((screen) => screen.id === screenPositionPreview.screenId
      ? { ...screen, position: screenPositionPreview.position }
      : screen),
  } : sourceOverlays, [screenPositionPreview, sourceOverlays]);
  const cableSheathScene = useMemo(
    () => view === "drawing"
      ? getVisibleCableSheathScene(cables, displayObjects, layers)
      : { geometries: [], incompatibleCableIds: [] },
    [cables, displayObjects, layers, view],
  );
  const selectLinkedE4Group = (wireIds: readonly string[]) => {
    if (onObjectGroupSelect) onObjectGroupSelect(wireIds);
    else onObjectSelect(wireIds.at(-1) ?? null, false);
  };
  const selectedObject = objects.find(object => object.id === selectedObjectId);
  const selectedComponentTemplateInstance = componentTemplateViewInstances.find(instance => instance.objectId === selectedObjectId);
  const selectedHasComponentTemplateView = !!selectedObject && !!selectedComponentTemplateInstance &&
    projectComponentTemplateView(
      selectedComponentTemplateInstance,
      view,
      { x: selectedObject.x, y: selectedObject.y },
      resolveComponentTemplateAssetUrl,
    ) !== null;
  const inlineObject = view === "e4" && tool === "select" && selectedObjectId && !selectedHasComponentTemplateView
    ? objects.find((object) => object.id === selectedObjectId && object.kind === "connector") ?? null
    : null;
  const inlineLayout = inlineObject ? getE4ConnectorLayout(inlineObject) : null;
  const [physicalStart,setPhysicalStart]=useState<string|null>(null);
  const [physicalNodePreview,setPhysicalNodePreview]=useState<{from:EditorPoint;to:EditorPoint}|null>(null);

  useEffect(() => {
    if (tool !== "wire") {
      setWireStart(null);
      setWireReconnect(null);
    }
  }, [tool]);

  useEffect(() => {
    const drag = inlineDragRef.current;
    inlineDragRef.current = null;
    if (drag) {
      onObjectMovePreview?.(drag.objectId, null);
      const target=inlineCaptureRef.current;
      if(target?.hasPointerCapture(drag.pointerId))target.releasePointerCapture(drag.pointerId);
    }
    inlineCaptureRef.current = null;
    inlineDragActivatedRef.current = false;
    setInlineDragOffset(null);
    setConnectorAlignmentGuides({});
  }, [inlineObject?.id, tool, view]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const redraw = () => {
      redrawCanvas(
        canvas,
        view,
        camera,
        dimmedObjectIds ? paintObjects.filter(object => !dimmedObjectIds.includes(object.id)) : paintObjects,
        layers,
        paintSelectedSet,
        cables,
        overlays,
        connectorAlignmentGuides,
        displayInstances,
        resolveComponentTemplateAssetUrl,
        componentTemplateImageCacheRef.current!,
        effectiveHighlights,
        physicalNodePreview,
        foregroundWireIds,
        backgroundObjects,
        backgroundOpacity,
      );
      if (pendingPlacement && placementPoint) {
        const context = canvas.getContext('2d');
        if (context) {
          context.save();
          context.translate(camera.offsetX, camera.offsetY); context.scale(camera.zoom, camera.zoom);
          context.globalAlpha = .6;
          drawEditorSceneObject(context, placementSceneObject(pendingPlacement, placementPoint), false, view, undefined, resolveComponentTemplateAssetUrl, componentTemplateImageCacheRef.current!);
          context.globalAlpha = 1; context.beginPath();
          context.arc(placementPoint.x, placementPoint.y, 5 / camera.zoom, 0, Math.PI * 2);
          context.strokeStyle = '#1179ac'; context.lineWidth = 1 / camera.zoom; context.stroke();
          context.restore();
        }
      }
      onViewportSizeChange?.({
        width: Math.max(1, Math.round(canvas.clientWidth)),
        height: Math.max(1, Math.round(canvas.clientHeight)),
      });
    };
    const stopTextures=warmCoveringTextures(redraw,[...paintObjects,...backgroundObjects]);
    componentTemplateImageCacheRef.current!.setInvalidate(redraw);
    redraw();
    const observer = new ResizeObserver(redraw);
    observer.observe(canvas);
    return () => {
      stopTextures();
      observer.disconnect();
      componentTemplateImageCacheRef.current?.setInvalidate(null);
    };
  }, [pendingPlacement, placementPoint, dimmedObjectIds, effectiveHighlights, foregroundWireIds, backgroundObjects, backgroundOpacity, cables, camera, displayInstances, connectorAlignmentGuides, paintObjects, inlineObject?.id, layers, onViewportSizeChange, overlays, resolveComponentTemplateAssetUrl, selectedObjectIds, selectedObjectId, view, physicalNodePreview]);

  useEffect(() => {
    const frame = frameRef.current;
    const canvas = canvasRef.current;
    if (!frame || !canvas) return;
    const wheel = (event: globalThis.WheelEvent) => {
      handleEditorViewportWheel(event, camera, canvas.getBoundingClientRect(), onCameraChange);
    };
    frame.addEventListener("wheel", wheel, { passive: false, capture: true });
    return () => frame.removeEventListener("wheel", wheel, true);
  }, [camera, onCameraChange]);

  useEffect(() => {
    const cancelConnection = () => {
      const drag = dragRef.current;
      if (drag) {
        if(drag.kind==="wire-route")onWireRoutePointPreview?.(drag.wireId,drag.routeIndex,null);
        if(drag.kind==="object")onObjectMovePreview?.(drag.objectId,null);
        if(drag.kind==="covering")onCoveringDrag?.(drag.objectId,drag.spanIndex,drag.part,drag.start,drag.start,"cancel");
        dragRef.current = null;
        const canvas = canvasRef.current;
        if (canvas?.hasPointerCapture(drag.pointerId)) canvas.releasePointerCapture(drag.pointerId);
      }
      const inline = inlineDragRef.current;
      inlineDragRef.current = null;
      if(inline){
        onObjectMovePreview?.(inline.objectId,null);
        const target=inlineCaptureRef.current;
        if(target?.hasPointerCapture(inline.pointerId))target.releasePointerCapture(inline.pointerId);
      }
      inlineCaptureRef.current=null;
      inlineDragActivatedRef.current=false;
      setInlineDragOffset(null);
      setConnectorAlignmentGuides({});
      setDrawingPreview(null);
      setWireLabelPreview(null);
      setScreenPositionPreview(null);
      setPhysicalStart(null);
      setPhysicalNodePreview(null);
      setPhysicalGuide(undefined);
      setGraphicStart(null);
      setGraphicPathDraft(null);
      setGraphicPreview(null);
      setSelectionRectangle(null);
      setSelectionCandidateIds([]);
      selectionDragRef.current=null;
    };
    cancelConnection();
    const keydown = (event: KeyboardEvent) => { if (event.key === "Escape") { setWireStart(null); setWireReconnect(null); cancelConnection(); } };
    window.addEventListener("keydown", keydown);
    return () => { window.removeEventListener("keydown", keydown); cancelConnection(); };
  }, [tool, view]);
  const [physicalMenu,setPhysicalMenu]=useState<{id:string;point:EditorPoint;x:number;y:number; node?:boolean; wires?:boolean; isolationIds?:readonly string[]}|null>(null);
  useEffect(()=>{if(onObjectPick)setPhysicalMenu(null);},[!!onObjectPick]);
  const [hoverTarget,setHoverTarget]=useState<CanvasHintTarget|null>(null);
  useEffect(()=>{setHoverTarget(null);setPhysicalMenu(null);},[view,tool,camera]);
  useEffect(()=>{
    if(hoverTarget&&!objects.some(o=>o.id===hoverTarget.id))setHoverTarget(null);
    if(physicalMenu&&!objects.some(o=>o.id===physicalMenu.id))setPhysicalMenu(null);
  },[objects,hoverTarget,physicalMenu]);
  const localPoint = (clientX: number, clientY: number): EditorPoint => {
    const bounds = canvasRef.current?.getBoundingClientRect();
    return { x: clientX - (bounds?.left ?? 0), y: clientY - (bounds?.top ?? 0) };
  };

  const snappedObjectDestination = (objectId: string, destination: EditorPoint, snapEnabled = false): EditorPoint => {
    if (view !== "e4") {
      setConnectorAlignmentGuides({});
      const drag=dragRef.current;
      const result=drag?.kind==='object'&&drag.routeAnchors?.length
        ?snapBendPoint(destination,drag.routeAnchors,snapEnabled,7/camera.zoom,{x:drag.objectX,y:drag.objectY},Math.PI/6,drag.snapState)
        :snapPhysicalPoint(destination,drag?.kind==="object"?drag.anchors??[]:[],snapEnabled,7/camera.zoom,Math.PI/6);
      setPhysicalGuide(result.guide);
      return result.point;
    }
    const movingObject = objects.find((object) => object.id === objectId);
    const moving = movingObject ? e4ConnectorSnapTarget(movingObject) : null;
    if (!moving) {
      setConnectorAlignmentGuides({});
      return destination;
    }
    const result = snapE4ConnectorPosition(
      moving,
      objects.flatMap((object) => {
        if (layers.find((layer) => layer.id === object.layerId)?.visible === false) return [];
        const target = e4ConnectorSnapTarget(object);
        return target ? [target] : [];
      }),
      destination,
      camera.zoom,
    );
    // Pointer events can arrive faster than the document preview's animation
    // frame. Unchanged guides must not trigger a second full canvas repaint.
    if (JSON.stringify(connectorAlignmentGuides) !== JSON.stringify(result.guides))
      setConnectorAlignmentGuides(result.guides);
    return result.position;
  };

  const snapGraphicPoint = (rawPoint:EditorPoint,anchor?:EditorPoint,angleSnap=true):EditorPoint => {
    const targets:DrawingOutline[]=objects.filter(o=>o.points?.length).map(o=>({id:o.id,points:[...(o.points??[])],closed:["closedContour","ellipse","rectangle"].includes(o.metadata?.graphicKind??""),corners:o.points as {x:number;y:number}[]}));
    const featurePoint=snapDrawingPoint(rawPoint,targets,drawingSnaps,8/camera.zoom,anchor);
    if(!anchor||!angleSnap||drawingAngleStep<=0)return featurePoint;
    const dx=featurePoint.x-anchor.x,dy=featurePoint.y-anchor.y,r=Math.hypot(dx,dy),step=drawingAngleStep*Math.PI/180,a=Math.round(Math.atan2(dy,dx)/step)*step;
    return {x:anchor.x+r*Math.cos(a),y:anchor.y+r*Math.sin(a)};
  };

  const finishGraphicPath=()=>{
    const draft=graphicPathDraft;
    if(!draft)return;
    if(draft.points.length>=2&&onGraphicCreate){
      const kind=draft.kind==="line"&&draft.points.length>2?"polyline":draft.kind;
      onGraphicCreate({id:crypto.randomUUID(),view,kind,points:draft.points,color:"#253b4a",width:2});
    }
    setGraphicPathDraft(null);setGraphicStart(null);setGraphicPreview(null);
  };

  const pointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (pendingPlacement && event.button === 0) {
      event.preventDefault(); event.stopPropagation();
      onPlace?.(screenToWorld(camera, localPoint(event.clientX, event.clientY)));
      setPlacementPoint(null); return;
    }
    // A preparation is only a point on the drawing. Its contact must remain a
    // usable drag handle in Select, rather than switching to wire authoring.
    if (!pendingPlacement && !onObjectPick && event.button === 0 && tool === 'select') {
      const point = screenToWorld(camera, localPoint(event.clientX, event.clientY));
      // An authored physical exit is independently movable, even over a
      // terminal picture. Its own layer controls editing, not the symbol layer.
      const exit = view === 'drawing' ? [...objects].reverse().find(object =>
        object.kind === 'physical-node' && object.port?.connectorId &&
        layers.some(layer => layer.id === object.layerId && layer.visible) &&
        containsPoint(object, point, 7 / camera.zoom, view)) : undefined;
      const foreground = objects.find(object => object.id === hitTestEditorScene(objects, layers, point, camera.zoom, view));
      const annotation = foreground && ['dimension', 'object-index', 'position-leader', 'leader-anchor'].includes(foreground.kind);
      if (exit && !annotation) {
        onObjectSelect(exit.id, event.ctrlKey || event.metaKey || event.shiftKey);
        if (onObjectMove && !layers.find(layer => layer.id === exit.layerId)?.locked) {
          event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = { kind: 'object', pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY,
            objectId: exit.id, objectX: exit.x, objectY: exit.y, mode: event.shiftKey ? 'adjacent' : 'carry', snapState: {},
            anchors: exit.metadata?.bundleMember !== 'true' ? physicalObjectSnapAnchors(objects.filter(o => layers.some(l => l.id === o.layerId && l.visible)), exit) : undefined,
            routeAnchors: physicalObjectRouteAnchors(objects, exit, event.shiftKey ? 'adjacent' : 'carry') };
        }
        return;
      }
      const termination = [...objects].reverse().find(object => object.metadata?.terminationSymbol &&
        layers.some(layer => layer.id === object.layerId && layer.visible) && terminationSceneContainsPoint(object, point, 7 / camera.zoom));
      const top = objects.find(object => object.id === hitTestEditorScene(objects, layers, point, camera.zoom, view));
      // Contact/node/wire decorations may cover a point-sized preparation, but
      // a symbol's transparent viewBox must not steal a foreground component.
      const pointOverlay = top && (['physical-segment', 'physical-covering', 'wire'].includes(top.kind) || view === 'e4' && top.kind === 'physical-node');
      if (termination && (top?.id === termination.id || pointOverlay)) {
        onObjectSelect(termination.id, event.ctrlKey || event.metaKey || event.shiftKey);
        if (onObjectMove && !layers.find(layer => layer.id === termination.layerId)?.locked) {
          event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = { kind: 'object', pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY,
            objectId: termination.id, objectX: termination.x, objectY: termination.y, mode: event.shiftKey ? 'adjacent' : 'carry', snapState: {} };
        }
        return;
      }
    }
    if(event.button===0&&view==="drawing"&&tool==="select"&&(onFreeWireEndpointMove||onFreeWireEndpointsXChange)&&!onObjectPick){
      const p=screenToWorld(camera,localPoint(event.clientX,event.clientY));
      const axis = freeEndAxes.find(axis => Math.abs(axis.x - p.x) <= 8 / camera.zoom &&
        Math.abs((axis.minY + axis.maxY) / 2 - p.y) <= 9 / camera.zoom);
      if (axis && onFreeWireEndpointsXChange) {
        const hit = freeEndpointRefs.find(ref => ref.wireId === axis.wireIds[0] && ref.end === axis.end)!;
        const axisRefs = freeEndpointRefs.filter(ref => axis.wireIds.includes(ref.wireId) && ref.end === axis.end);
        event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
        freeEndDrag.current = { wireId: hit.wireId, end: hit.end, pointerId: event.pointerId, group: axisRefs };
        return;
      }
      const hit=objects.filter(o=>o.kind==="wire"&&layers.some(l=>l.id===o.layerId&&l.visible&&!l.locked)).flatMap(o=>(["from","to"] as const).flatMap(end=>{
        const point=end==="from"?o.points?.[0]:o.points?.at(-1);
        return o.metadata?.[end==="from"?"freeFrom":"freeTo"]==="true"&&point&&Math.hypot(point.x-p.x,point.y-p.y)<=7/camera.zoom?[{wireId:o.id,end,pointerId:event.pointerId}]:[];
      }))[0];
      if(hit){event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);freeEndDrag.current=hit;onObjectSelect(hit.wireId,false);return;}
    }
    setHoverTarget(null);
    if(event.button===2){
      return;
    }
    setPhysicalMenu(null);
    if(event.button===0&&onObjectPick){
      const point=screenToWorld(camera,localPoint(event.clientX,event.clientY));
      const selectable=objects.filter(o=>layers.some(l=>l.id===o.layerId&&!l.locked));
      onObjectPick(hitTestEditorScene(selectable,layers,point,camera.zoom,view,componentTemplateViewInstances,resolveComponentTemplateAssetUrl));
      return;
    }
    if(event.button===0&&tool==="select"&&!onObjectPick){
      const point=screenToWorld(camera,localPoint(event.clientX,event.clientY));
      const hit=hitTestEditorScene(objects,layers,point,camera.zoom,view,componentTemplateViewInstances,resolveComponentTemplateAssetUrl);
      if(!hit){
        event.currentTarget.setPointerCapture(event.pointerId);
        selectionDragRef.current={pointerId:event.pointerId,start:point,clientX:event.clientX,clientY:event.clientY,mode:event.shiftKey?"add":event.ctrlKey||event.metaKey?"toggle":"replace"};
        setSelectionRectangle({start:point,end:point});setSelectionCandidateIds([]);return;
      }
    }
    if(event.button===0&&view==="drawing"&&tool==="position-rail"){
      const point=screenToWorld(camera,localPoint(event.clientX,event.clientY));
      if(!railDraft){setRailDraft({start:point,end:point,leaderIds:[]});return;}
      const end=snapRailEnd(railDraft.start,point);
      if(Math.hypot(end.x-railDraft.start.x,end.y-railDraft.start.y)>=24){
        const ids=[...new Set([...railDraft.leaderIds,...objects.filter(o=>o.kind==="position-leader"&&railParameter({start:railDraft.start,end, id:"preview", leaderIds:[]},{x:o.x+o.width/2,y:o.y+o.height/2})>=0&&railParameter({start:railDraft.start,end,id:"preview",leaderIds:[]},{x:o.x+o.width/2,y:o.y+o.height/2})<=1&&railDistance({start:railDraft.start,end},{x:o.x+o.width/2,y:o.y+o.height/2})<=railCatchDistance/camera.zoom).map(o=>o.id)])];
        onPositionRailCreate?.(railDraft.start,end,ids);
      }
      setRailDraft(null);return;
    }
    if(event.button===0&&tool.startsWith("graphic-")&&onGraphicCreate){
      const rawPoint=screenToWorld(camera,localPoint(event.clientX,event.clientY)),kind=tool.slice(8).replace("closed-contour","closedContour") as DrawingGraphicKind,anchor=graphicPathDraft?.points.at(-1)??graphicStart??undefined,point=snapGraphicPoint(rawPoint,anchor,kind!=="rectangle"&&kind!=="ellipse");
      if(kind==="contact"||kind==="text"){const text=kind==="text"?window.prompt("Текст фигуры","Текст"):undefined;if(kind==="text"&&!text?.trim())return;onGraphicCreate({id:crypto.randomUUID(),view,kind,points:[point],...(kind==="text"?{text:text!.trim(),angle:0,fontFamily:"Arial",fontSize:16}:{}),color:"#253b4a",width:2});return;}
      if(kind==="line"||kind==="polyline"||kind==="closedContour"){
        const previous=graphicPathDraft?.points.at(-1),same=previous&&Math.hypot(previous.x-point.x,previous.y-point.y)<.01;
        if(graphicPathDraft&&same&&graphicPathDraft.points.length>=2){finishGraphicPath();return;}
        const first=graphicPathDraft?.points[0],closes=first&&graphicPathDraft!.points.length>=2&&Math.hypot(first.x-point.x,first.y-point.y)<=8/camera.zoom;
        if(closes){onGraphicCreate({id:crypto.randomUUID(),view,kind:"closedContour",points:[...graphicPathDraft!.points,first],color:"#253b4a",width:2});setGraphicPathDraft(null);setGraphicStart(null);setGraphicPreview(null);return;}
        const next=graphicPathDraft?{...graphicPathDraft,points:same?graphicPathDraft.points:[...graphicPathDraft.points,point]}:{kind,points:[point]};
        setGraphicPathDraft(next);setGraphicStart(next.points[0]??null);setGraphicPreview({id:"preview",view,kind:next.kind,points:[next.points[0]!,next.points[0]!],color:"#253b4a",width:2});return;
      }
      if(!graphicStart){setGraphicStart(point);setGraphicPreview({id:"preview",view,kind,points:[point,point],color:"#253b4a",width:2});return;}
      const dx=point.x-graphicStart.x,dy=point.y-graphicStart.y;
      if(kind==="rectangle"||kind==="ellipse"){
        const radius=event.ctrlKey?Math.hypot(dx,dy):undefined,points=kind==="ellipse"?[{x:graphicStart.x-(radius??Math.abs(dx)),y:graphicStart.y-(radius??Math.abs(dy))},{x:graphicStart.x+(radius??Math.abs(dx)),y:graphicStart.y+(radius??Math.abs(dy))}]:[graphicStart,point];
        onGraphicCreate({id:crypto.randomUUID(),view,kind,points,color:"#253b4a",width:2});setGraphicStart(null);setGraphicPreview(null);return;
      }
      const kindPoints=kind==="bezier"?[graphicStart,{x:graphicStart.x+dx/3,y:graphicStart.y+dy},{x:graphicStart.x+2*dx/3,y:graphicStart.y-dy},point]:[graphicStart,point];
      onGraphicCreate({id:crypto.randomUUID(),view,kind,points:kindPoints,color:"#253b4a",width:2});setGraphicStart(null);setGraphicPreview(null);return;
    }
    if(event.button===0&&view==="drawing"&&tool==="wire"&&onPhysicalNodesConnect){
      const point=screenToWorld(camera,localPoint(event.clientX,event.clientY));
      const node=objects.find(o=>o.kind==="physical-node"&&!o.metadata?.joiningPipe&&layers.some(l=>l.id===o.layerId&&l.visible&&!l.locked)&&containsPoint(o,point,8/camera.zoom,view));
      if(node){
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current={kind:"physical-node-connect",pointerId:event.pointerId,fromNodeId:node.id,clientX:event.clientX,clientY:event.clientY,moved:false};
        setPhysicalNodePreview({from:{x:node.x+5,y:node.y+5},to:{x:node.x+5,y:node.y+5}});
        return;
      }
    }
    // Dimensions, material indexes and positional designations are top-layer
    // annotations. Resolve them before physical editing gestures so a sleeve
    // cannot consume a click intended for the annotation drawn above it.
    if(event.button===0&&view==="drawing"&&tool==="select") {
      const point=screenToWorld(camera,localPoint(event.clientX,event.clientY));
      const annotation=[...objects].reverse().find(o=>["dimension","object-index","position-leader","leader-anchor"].includes(o.kind)&&layers.some(l=>l.id===o.layerId&&l.visible)&&containsPoint(o,point,7/camera.zoom,view));
      if(annotation){
        const layer=layers.find(l=>l.id===annotation.layerId);
        onObjectSelect(annotation.id,event.ctrlKey||event.metaKey||event.shiftKey);
        if(layer?.locked!==true&&onObjectMove){
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current={kind:"object",pointerId:event.pointerId,clientX:event.clientX,clientY:event.clientY,objectId:annotation.id,objectX:annotation.x,objectY:annotation.y,mode:"carry",snapState:{}};
        }
        return;
      }
    }
    if(event.button===0&&event.shiftKey&&view==="drawing"&&tool==="select") {
      const local=localPoint(event.clientX,event.clientY),point=screenToWorld(camera,local);
      const id=hitTestEditorScene(objects,layers,point,camera.zoom,view);
      const pipe=objects.find(o=>o.id===id&&o.kind==="physical-segment");
      const grip=pipe&&(hitTestWireRoutePoint(pipe,point,camera.zoom)!==null||pipeMidpoints(pipe).some(h=>Math.hypot(h.point.x-point.x,h.point.y-point.y)<=7/camera.zoom));
      if(pipe&&!grip) {onObjectSelect(id,false);setPhysicalMenu({id:id!,point,x:event.clientX,y:event.clientY,wires:true});return;}
    }
    if(event.button===0&&view==="drawing"&&tool==="select"&&!event.ctrlKey&&!event.shiftKey&&onCoveringDrag){
      const point=screenToWorld(camera,localPoint(event.clientX,event.clientY)),grip=gripAt(point);
      // A connection point is a direct editing anchor.  Test every physical
      // node here, not just generated OP nodes: this handler runs before the
      // general scene hit-test, so otherwise a sleeve would steal clicks and
      // hover from ordinary connector exits and T junctions.
      const nodeHit=coveringDragBlockedByPhysicalNode(objects,layers,point,camera.zoom,view);
      const pipeGrip=nodeHit||objects.some(o=>o.kind==="physical-segment"&&layers.some(l=>l.id===o.layerId&&l.visible&&!l.locked)&&(hitTestWireRoutePoint(o,point,camera.zoom)!==null||pipeMidpoints(o).some(h=>Math.hypot(h.point.x-point.x,h.point.y-point.y)<=7/camera.zoom)));
      const cover=[...objects].reverse().find(o=>o.kind==="physical-covering"&&layers.some(l=>l.id===o.layerId&&l.visible&&!l.locked)&&coveringHit(o,point,4/camera.zoom)!==null);
      if(!nodeHit&&(grip?.part.startsWith("transition-")||!pipeGrip)&&(grip||cover)){const objectId=grip?.objectId??cover!.id,spanIndex=grip?.spanIndex??coveringHit(cover!,point,4/camera.zoom)!;
        setHoverGrip(null);
        onObjectSelect(objectId,false);event.currentTarget.setPointerCapture(event.pointerId);dragRef.current={kind:"covering",pointerId:event.pointerId,clientX:event.clientX,clientY:event.clientY,objectId,spanIndex,part:grip?.part??"body",start:point};return;}
    }
    const shouldPan = tool === "pan" || event.button === 1;
    if (shouldPan) {
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = {
        kind: "pan",
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        camera,
      };
      return;
    }
    if(view==="drawing"&&tool.startsWith("dimension")&&event.button===0){
      const point=screenToWorld(camera,localPoint(event.clientX,event.clientY));
      const candidates=objects.filter(o=>(o.kind==="physical-segment"||o.kind==="wire"&&o.metadata?.physicalRoute!=="true")&&layers.some(l=>l.id===o.layerId&&l.visible&&!l.locked)).flatMap(w=>(w.kind==="physical-segment"?pipeSceneEditablePoints(w):w.points??[]).map((p,index)=>({wireId:w.id,index,point:p,pointCount:w.kind==="physical-segment"?pipeSceneEditablePoints(w).length:w.points!.length}))).filter(c=>(c.index===0||c.index===c.pointCount-1)&&Math.hypot(c.point.x-point.x,c.point.y-point.y)*camera.zoom<=12).sort((a,b)=>Number(b.wireId===selectedObjectId)-Number(a.wireId===selectedObjectId));
      if(!candidates.length){setDimensionMessage("Укажите конец участка");return;}
      if(!dimensionStart.length){setDimensionStart(candidates);setDimensionMessage("Укажите вторую точку того же пайпа или провода");return;}
      const end=candidates.find(c=>dimensionStart.some(a=>a.wireId===c.wireId&&a.index!==c.index));
      const start=end&&dimensionStart.find(a=>a.wireId===end.wireId&&a.index!==end.index);
      if(!end||!start){setDimensionMessage("Нужны две разные точки одного пайпа или свободного провода");return;}
      onDimensionCreate?.(end.wireId,start.index,end.index,end.pointCount,tool==="dimension-horizontal"?"horizontal":tool==="dimension-vertical"?"vertical":"aligned",tool==="dimension-auxiliary");
      setDimensionStart([]);return;
    }
    if (tool === "wire") {
      const worldPoint = screenToWorld(camera, localPoint(event.clientX, event.clientY));
      const endpoint = (view === "e4"
        ? hitTestE4ScreenConnection(overlays.screens, objects, worldPoint, camera.zoom, layers)
        : null) ?? hitTestConnectorContact(
        objects,
        layers,
        worldPoint,
        camera.zoom,
        view,
      );
      if (wireReconnect) {
        if (endpoint) {
          onWireReconnect?.(wireReconnect.wireId, wireReconnect.end, endpoint);
        } else {
          const target = hitTestWireSegment(objects, layers, worldPoint, camera.zoom, wireReconnect.wireId);
          if (target) onWireReconnectToWire?.(
            wireReconnect.wireId,
            wireReconnect.end,
            target.wireId,
            target.point,
          );
        }
        setWireReconnect(null);
        return;
      }
      if (!wireStart) {
        const selectedWire = objects.find((item) => item.id === selectedObjectId);
        const selectedLayer = selectedWire ? layers.find((item) => item.id === selectedWire.layerId) : null;
        const wireEnd = selectedLayer?.locked === true ? null : hitTestWireEnd(selectedWire, worldPoint, camera.zoom);
        if (wireEnd && selectedWire) {
          setWireReconnect({ wireId: selectedWire.id, end: wireEnd });
          return;
        }
      }
      if (!endpoint) {
        if (wireStart) {
          const target = hitTestWireSegment(objects, layers, worldPoint, camera.zoom);
          if (target && onWireConnectToWire) {
            onWireConnectToWire(wireStart, target.wireId, target.point);
            setWireStart(null);
          }
        }
        return;
      }
      if (!wireStart) {
        setWireStart(endpoint);
        if ("screenId" in endpoint) {
          const screen = overlays.screens.find((item) => item.id === endpoint.screenId);
          if (screen) selectLinkedE4Group(screen.wireIds);
        } else {
          onObjectSelect(endpoint.connectorId, false);
        }
      } else {
        const sameEndpoint = "screenId" in wireStart
          ? "screenId" in endpoint && wireStart.screenId === endpoint.screenId &&
            (wireStart.screenTerminalSide ?? "above") === (endpoint.screenTerminalSide ?? "above")
          : "connectorId" in endpoint && wireStart.connectorId === endpoint.connectorId &&
            wireStart.contactIndex === endpoint.contactIndex;
        if (!sameEndpoint) {
          onWireConnect?.(wireStart, endpoint);
        }
        setWireStart(null);
      }
      return;
    }
    if (tool === "select") {
      const worldPoint = screenToWorld(camera, localPoint(event.clientX, event.clientY));
      if((view==="e4" || view==="drawing") && onDrawingMove && event.button===0) {
        for(const object of [...objects].reverse()) {
          const layer=layers.find(l=>l.id===object.layerId),instance=componentTemplateViewInstances.find(i=>i.objectId===object.id);
          if(object.kind!=="connector" || !instance || !layer?.visible || layer.locked) continue;
          if(view==="e4") {
            const drawing=projectE4DrawingCompanions(instance,object,getE4ConnectorLayout(object)?.width ?? object.width,resolveComponentTemplateAssetUrl).reverse().find(d=>d.visible && worldPoint.x>=d.bounds.minX && worldPoint.x<=d.bounds.maxX && worldPoint.y>=d.bounds.minY && worldPoint.y<=d.bounds.maxY);
            if(drawing) {event.currentTarget.setPointerCapture(event.pointerId);onObjectSelect(object.id,false);dragRef.current={kind:"companion",pointerId:event.pointerId,clientX:event.clientX,clientY:event.clientY,objectId:object.id,drawingId:drawing.drawingId,offset:drawing.offset};return;}
          } else {
            const connectorDrawing=projectComponentTemplateView(instance,"drawing",object,resolveComponentTemplateAssetUrl);
            const contactSide=projectContactSideView(instance,{x:object.x,y:object.y},connectorDrawing?.bounds??{minX:object.x,minY:object.y,maxX:object.x+object.width,maxY:object.y+object.height},resolveComponentTemplateAssetUrl);
            const placement=instance.drawingPlacements?.find(item=>item.drawingId===CONTACT_SIDE_VIEW_PLACEMENT_ID);
            if(contactSide?.visible && placement && worldPoint.x>=contactSide.drawing.bounds.minX && worldPoint.x<=contactSide.drawing.bounds.maxX && worldPoint.y>=contactSide.drawing.bounds.minY && worldPoint.y<=contactSide.drawing.bounds.maxY) {
              event.currentTarget.setPointerCapture(event.pointerId);onObjectSelect(object.id,false);dragRef.current={kind:"companion",pointerId:event.pointerId,clientX:event.clientX,clientY:event.clientY,objectId:object.id,drawingId:CONTACT_SIDE_VIEW_PLACEMENT_ID,offset:placement.offset};return;
            }
          }
        }
      }
      if (view === "e4") {
        const screen = hitTestE4Screen(overlays.screens, objects, worldPoint, camera.zoom, layers);
        const endpoint = hitTestE4ScreenConnection(overlays.screens, objects, worldPoint, camera.zoom, layers) ??
          (screen ? null : hitTestConnectorContact(objects, layers, worldPoint, camera.zoom, view));
        if (endpoint && onWireToolRequest) {
          setWireStart(endpoint);
          if ("screenId" in endpoint) {
            const screen = overlays.screens.find((item) => item.id === endpoint.screenId);
            if (screen) selectLinkedE4Group(screen.wireIds);
          } else {
            onObjectSelect(endpoint.connectorId, false);
          }
          onWireToolRequest();
          return;
        }
        if (screen) {
          selectLinkedE4Group(screen.wireIds);
          if (onE4ScreenPositionChange) {
            event.currentTarget.setPointerCapture(event.pointerId);
            dragRef.current = {
              kind: "e4-screen",
              pointerId: event.pointerId,
              clientX: event.clientX,
              clientY: event.clientY,
              screenId: screen.id,
              orientation: screen.span.orientation,
              position: overlays.screens.find((item) => item.id === screen.id)?.position ?? 0.5,
              spanLength: screen.pathLength,
            };
          }
          return;
        }
        const differentialPair = hitTestE4DifferentialPair(
          overlays.diffPairs,
          objects,
          worldPoint,
          camera.zoom,
          layers,
        );
        if (differentialPair) {
          selectLinkedE4Group(differentialPair.wireIds);
          return;
        }
        const wireLabel = onE4WireLabelPositionChange
          ? hitTestE4WireLabel(objects, layers, worldPoint, camera.zoom)
          : null;
        const selectedWire=objects.find(o=>o.id===selectedObjectId&&o.kind==="wire"&&layers.some(l=>l.id===o.layerId&&l.visible&&!l.locked));
        if(selectedWire&&onWireRoutePointMove){
          const corner=hitTestWireRoutePoint(selectedWire,worldPoint,camera.zoom);
          const middle=corner===null?e4Midpoints(selectedWire).find(h=>Math.hypot(h.point.x-worldPoint.x,h.point.y-worldPoint.y)<=7/camera.zoom):undefined;
          const index=corner??middle?.index;
          if(index!==undefined&&index!==null){
            const points=selectedWire.points!,point=middle?.point??points[index+1]!;
            event.currentTarget.setPointerCapture(event.pointerId);
            dragRef.current={kind:"wire-route",pointerId:event.pointerId,clientX:event.clientX,clientY:event.clientY,wireId:selectedWire.id,routeIndex:index,point,
              mode:event.shiftKey?"adjacent":"carry",insert:!!middle,anchors:bendSnapAnchors(points,index,!!middle,event.shiftKey?"adjacent":"carry"),snapState:{}};
            return;
          }
        }
        if (wireLabel) {
          const wire = objects.find((item) => item.id === wireLabel.wireId);
          const layer = wire ? layers.find((item) => item.id === wire.layerId) : null;
          onObjectSelect(wireLabel.wireId, false);
          if (layer?.locked !== true) {
            event.currentTarget.setPointerCapture(event.pointerId);
            dragRef.current = { kind: "e4-wire-label", pointerId: event.pointerId, wireId: wireLabel.wireId };
          }
          return;
        }
        const segment = onE4WireSegmentMove
          ? hitTestE4WireSegment(objects, layers, worldPoint, camera.zoom)
          : null;
        if (segment) {
          const additive = event.ctrlKey || event.shiftKey;
          const togglingOff = additive && selectedSet.has(segment.wireId);
          onObjectSelect(segment.wireId, additive);
          if (togglingOff) return;
          // The body selects; authoring now belongs to corner/midpoint handles.
          if(onWireRoutePointMove)return;
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = {
            kind: "e4-wire-segment",
            pointerId: event.pointerId,
            clientX: event.clientX,
            clientY: event.clientY,
            wireId: segment.wireId,
            segmentIndex: segment.index,
            orientation: segment.orientation,
            coordinate: segment.orientation === "horizontal" ? segment.start.y : segment.start.x,
          };
          return;
        }
      }
      if (view === "drawing") {
        const pipes=objects.filter(o=>o.kind==="physical-segment"&&layers.some(l=>l.id===o.layerId&&l.visible&&!l.locked)).sort((a,b)=>Number(b.pipe?.role==="joining-pipe")-Number(a.pipe?.role==="joining-pipe"));
        const nodeHit=objects.some(o=>o.kind==="physical-node"&&layers.some(l=>l.id===o.layerId&&l.visible)&&containsPoint(o,worldPoint,7/camera.zoom,view));
        const corner=nodeHit?undefined:pipes.map(o=>({o,index:hitTestWireRoutePoint(o,worldPoint,camera.zoom)}))
          .filter((hit):hit is {o:EditorSceneObject;index:number}=>hit.index!==null)
          .map(hit=>({ ...hit, distance:Math.hypot(worldPoint.x-(hit.o.pipe?.handles[hit.index]!.x??Infinity),worldPoint.y-(hit.o.pipe?.handles[hit.index]!.y??Infinity)) }))
          .sort((a,b)=>a.distance-b.distance)[0];
        const middle=corner||nodeHit?undefined:pipes.flatMap(o=>pipeMidpoints(o).map(h=>({...h,o}))).find(h=>Math.hypot(h.point.x-worldPoint.x,h.point.y-worldPoint.y)<=7/camera.zoom);
        const pipe=corner?.o??middle?.o,index=corner?.index??middle?.index;
        if(pipe&&index!==null&&index!==undefined){
          const points=[pipe.points![0]!,...pipeSceneHandles(pipe),pipe.points!.at(-1)!];
          const point=middle?.point??points[index+1]!;
          onObjectSelect(pipe.id,false);event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current={kind:"wire-route",pointerId:event.pointerId,clientX:event.clientX,clientY:event.clientY,wireId:pipe.id,routeIndex:index,point,
            mode:event.shiftKey?"adjacent":"carry",insert:!!middle,opMember:!!pipe.pipe?.joiningMember,
            anchors:pipe.pipe?pipeBendSnapAnchors(pipe.pipe,points,index,!!middle,event.shiftKey?"adjacent":"carry",point):bendSnapAnchors(points,index,!!middle,event.shiftKey?"adjacent":"carry",point),snapState:{}};
          return;
        }
        const cableSheath = hitTestCableSheath(cableSheathScene.geometries, worldPoint, camera.zoom);
        if (cableSheath && !objects.some(o=>o.kind==="physical-segment"&&containsPoint(o,worldPoint,7/camera.zoom,view))) {
          selectLinkedE4Group(cableSheath.memberWireIds);
          return;
        }
        const selectedWire = objects.find((item) => item.id === selectedObjectId);
        const selectedLayer = selectedWire ? layers.find((item) => item.id === selectedWire.layerId) : null;
        const cornerIndex = selectedLayer?.locked === true || selectedWire?.kind==="wire"&&objects.some(o=>o.kind==="physical-segment"&&containsPoint(o,worldPoint,7/camera.zoom,view))
          ? null
          : hitTestWireRoutePoint(selectedWire, worldPoint, camera.zoom);
        const detachedMiddle=cornerIndex===null&&selectedWire?.metadata?.detachedDrawing==="true"&&selectedLayer?.visible&& !selectedLayer.locked ? e4Midpoints(selectedWire).find(h=>Math.hypot(h.point.x-worldPoint.x,h.point.y-worldPoint.y)<=7/camera.zoom):undefined;
        const routeIndex=cornerIndex??detachedMiddle?.index??null;
        const routePoint = detachedMiddle?.point ?? (routeIndex === null ? null : (selectedWire?.kind==="physical-segment"?[selectedWire.points![0]!,...pipeSceneHandles(selectedWire)]:selectedWire?.points)?.[routeIndex + 1]);
        if (selectedWire && routeIndex !== null && routePoint) {
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = {
            kind: "wire-route",
            pointerId: event.pointerId,
            clientX: event.clientX,
            clientY: event.clientY,
            wireId: selectedWire.id,
            routeIndex,
            point: routePoint,
            insert:!!detachedMiddle,
            mode:selectedWire.metadata?.detachedDrawing==="true"?"adjacent":undefined,
            anchors:selectedWire.metadata?.detachedDrawing==="true"?bendSnapAnchors(selectedWire.points??[],routeIndex,!!detachedMiddle,"adjacent"):undefined,
            snapState:{},
          };
          return;
        }
      }
      const objectId = hitTestEditorScene(
        objects,
        layers,
        worldPoint,
        camera.zoom,
        view,
        componentTemplateViewInstances,
        resolveComponentTemplateAssetUrl,
      );
      const table=objects.find(o=>o.id===objectId&&o.kind==="drawing-table");
      if(table && worldPoint.y>=table.y+52 && onRelatedObjectsSelect) {
        const rows=JSON.parse(table.metadata?.rowObjectIds ?? "[]") as string[][];
        const ids=rows[Math.floor((worldPoint.y-table.y-52)/32)];if(ids){onRelatedObjectsSelect(ids);return;}
      }
      const selectedObject = objects.find((item) => item.id === selectedObjectId);
      const preserveWireForRoutePoint = view === "drawing" && objectId === null &&
        (selectedObject?.kind === "wire" || selectedObject?.kind === "physical-segment") && onCanvasDoubleClick !== undefined;
      if (!preserveWireForRoutePoint) {
        const mode:EditorSelectionMode=event.shiftKey?"add":event.ctrlKey||event.metaKey?"toggle":"replace";
        if(onObjectGroupSelect)onObjectGroupSelect(objectId?[objectId]:[],mode);
        else onObjectSelect(objectId,mode==="toggle");
      }
      const object = objects.find((item) => item.id === objectId);
      const layer = object ? layers.find((item) => item.id === object.layerId) : null;
      if(object?.kind==="physical-segment"&&layer?.locked!==true){const controls=pipeSceneControls(object);const index=projectOntoPolyline(controls,worldPoint).index;onPipeIntervalSelect?.(object.id,Math.max(0,index-1),index);}
      if (object && (object.kind.startsWith("graphic-") || object.kind === "object-index" || object.kind === "dimension" || object.kind === "connector" || object.kind === "specification-item" || object.kind === "physical-node" || object.kind === "drawing-table" || object.kind === "position-leader" || object.kind === "leader-anchor" || object.kind === "position-rail" || object.kind === "rail-handle" || object.kind === "physical-segment" && object.pipe?.role === "joining-pipe") && layer?.locked !== true && onObjectMove) {
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = {
          kind: "object",
          pointerId: event.pointerId,
          clientX: event.clientX,
          clientY: event.clientY,
          objectId: object.id,
          objectX: object.x,
          objectY: object.y,
          mode:event.shiftKey?"adjacent":"carry",
          anchors:view==="drawing"&&object.metadata?.joiningPipe?joiningPipeEndpointSnapAnchors(objects,object):view==="drawing"&&object.metadata?.bundleMember!=="true"&&object.pipe?.role!=="joining-pipe"?physicalObjectSnapAnchors(objects.filter(o=>layers.some(l=>l.id===o.layerId&&l.visible)),object):undefined,
          routeAnchors:view==='drawing'&&!object.metadata?.joiningPipe&&(object.kind==="physical-node"||object.metadata?.bundleMember!=="true")&&object.pipe?.role!=="joining-pipe"?physicalObjectRouteAnchors(objects,object,event.shiftKey?'adjacent':'carry'):undefined,
          snapState:{},
        };
      }
    }
  };

  const [hoverGrip,setHoverGrip]=useState<CoveringHandle|null>(null);
  const gripAt=(point:EditorPoint):CoveringHandle|null=>[...objects].reverse().filter(o=>o.kind==="physical-covering"&&layers.some(l=>l.id===o.layerId&&l.visible&&!l.locked)).flatMap(o=>coveringGrips(o)).find(g=>(g.pointMarker?Math.hypot(point.x-g.point.x,point.y-g.point.y):pointToSegmentDistance(point,g.edgeFrom??{x:g.point.x-g.normal.x*g.halfWidth,y:g.point.y-g.normal.y*g.halfWidth},g.edgeTo??{x:g.point.x+g.normal.x*g.halfWidth,y:g.point.y+g.normal.y*g.halfWidth}))<=8/camera.zoom)??null;
  const pointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    if (pendingPlacement) {
      setPlacementPoint(screenToWorld(camera, localPoint(event.clientX, event.clientY)));
      setHoverTarget(null); event.currentTarget.style.cursor = 'crosshair'; return;
    }
    if(selectionDragRef.current?.pointerId===event.pointerId){
      const drag=selectionDragRef.current,end=screenToWorld(camera,localPoint(event.clientX,event.clientY));
      const selection={start:drag.start,end};setSelectionRectangle(selection);
      setSelectionCandidateIds(selectionRectangleObjectIds(objects,layers,selection));return;
    }
    if(graphicStart&&tool.startsWith("graphic-")&&["graphic-rectangle","graphic-ellipse","graphic-bezier"].includes(tool)){
      const kind=tool.slice(8).replace("closed-contour","closedContour") as DrawingGraphicKind,point=snapGraphicPoint(screenToWorld(camera,localPoint(event.clientX,event.clientY)),graphicStart,kind!=="rectangle"&&kind!=="ellipse"),dx=point.x-graphicStart.x,dy=point.y-graphicStart.y;
      if(kind==="rectangle"||kind==="ellipse"){
        const radius=kind==="ellipse"&&event.ctrlKey?Math.hypot(dx,dy):undefined,points=kind==="ellipse"?[{x:graphicStart.x-(radius??Math.abs(dx)),y:graphicStart.y-(radius??Math.abs(dy))},{x:graphicStart.x+(radius??Math.abs(dx)),y:graphicStart.y+(radius??Math.abs(dy))}]:[graphicStart,point];
        setGraphicPreview({id:"preview",view,kind,points,color:"#253b4a",width:2});
      }
    } else if(graphicPathDraft&&tool.startsWith("graphic-")&&["line","polyline","closedContour"].includes(graphicPathDraft.kind)){
      const point=snapGraphicPoint(screenToWorld(camera,localPoint(event.clientX,event.clientY)),graphicPathDraft.points.at(-1));
      setGraphicPreview({id:"preview",view,kind:graphicPathDraft.kind,points:[...graphicPathDraft.points,point],color:"#253b4a",width:2});
    }
    if(freeEndDrag.current?.pointerId===event.pointerId){const d=freeEndDrag.current;const raw=screenToWorld(camera,localPoint(event.clientX,event.clientY));if(d.group){for(const ref of d.group)onFreeWireEndpointPreview?.(ref.wireId,ref.end,{x:raw.x,y:ref.point.y});}else{const snapped=snapFreeWireEndpointX(raw,snapRefs,d.wireId,d.end,8/camera.zoom);onFreeWireEndpointPreview?.(d.wireId,d.end,snapped);}return;}
    if(railDraft&&view==="drawing"&&tool==="position-rail"){
      const point=screenToWorld(camera,localPoint(event.clientX,event.clientY)),end=snapRailEnd(railDraft.start,point);
      const ids=objects.filter(o=>o.kind==="position-leader"&&railParameter({start:railDraft.start,end,id:"preview",leaderIds:[]},{x:o.x+o.width/2,y:o.y+o.height/2})>=0&&railParameter({start:railDraft.start,end,id:"preview",leaderIds:[]},{x:o.x+o.width/2,y:o.y+o.height/2})<=1&&railDistance({start:railDraft.start,end},{x:o.x+o.width/2,y:o.y+o.height/2})<=railCatchDistance/camera.zoom).map(o=>o.id);
      setRailDraft(previous=>previous?{...previous,end,leaderIds:ids}:null);
      return;
    }
    const drag = dragRef.current;
    if(!drag&&!physicalMenu&&view==="drawing"&&tool==="select"){
      const point=screenToWorld(camera,localPoint(event.clientX,event.clientY)),id=hitTestEditorScene(objects,layers,point,camera.zoom,view,componentTemplateViewInstances,resolveComponentTemplateAssetUrl);
      const object=objects.find(o=>o.id===id),eligible=object&&["connector","wire","physical-node","physical-segment","physical-covering"].includes(object.kind);
      setHoverTarget(previous=>!eligible?null:previous?.id===id&&Math.hypot(previous.x-event.clientX,previous.y-event.clientY)<4?previous:{id:object.id,label:object.label||"Объект",x:event.clientX,y:event.clientY});
    }else setHoverTarget(null);
    if (!drag) {
      const point=screenToWorld(camera,localPoint(event.clientX,event.clientY));
      const nodeHit=view==="drawing"&&coveringDragBlockedByPhysicalNode(objects,layers,point,camera.zoom,view);
      const hit=view==="drawing"&&tool==="select"&&!nodeHit?gripAt(point):null;
      setHoverGrip(hit);event.currentTarget.style.cursor=hit?"ew-resize":"";return;
    }
    if(drag.pointerId !== event.pointerId)return;
    if(drag.kind==="physical-node-connect") {
      if(inlineObjectDragMoved(event.clientX-drag.clientX,event.clientY-drag.clientY)) drag.moved=true;
      const point=screenToWorld(camera,localPoint(event.clientX,event.clientY));
      const source=objects.find(o=>o.id===drag.fromNodeId&&o.kind==="physical-node");
      const target=objects.find(o=>o.kind==="physical-node"&&!o.metadata?.joiningPipe&&o.id!==drag.fromNodeId&&layers.some(l=>l.id===o.layerId&&l.visible&&!l.locked)&&containsPoint(o,point,8/camera.zoom,view));
      const targetSegment=target?undefined:objects.find(o=>o.kind==="physical-segment"&&o.pipe?.role!=="joining-pipe"&&layers.some(l=>l.id===o.layerId&&l.visible&&!l.locked)&&containsPoint(o,point,7/camera.zoom,view));
      const segmentPoint=targetSegment?projectOntoPolyline(targetSegment.points??[],point).point:null;
      setPhysicalNodePreview({from:source?{x:source.x+5,y:source.y+5}:point,to:target?{x:target.x+5,y:target.y+5}:segmentPoint??point});
      return;
    }
    if(drag.kind==="covering"){onCoveringDrag?.(drag.objectId,drag.spanIndex,drag.part,drag.start,screenToWorld(camera,localPoint(event.clientX,event.clientY)),"preview");return;}
    if(drag.kind==="companion") { setDrawingPreview({objectId:drag.objectId,drawingId:drag.drawingId,offset:{x:drag.offset.x+(event.clientX-drag.clientX)/camera.zoom,y:drag.offset.y+(event.clientY-drag.clientY)/camera.zoom}});
    } else if (drag.kind === "pan") {
      onCameraChange(panEditorCamera(drag.camera, event.clientX - drag.clientX, event.clientY - drag.clientY));
    } else if (drag.kind === "object" && inlineObjectDragMoved(event.clientX - drag.clientX, event.clientY - drag.clientY)) {
      const destination = objects.find(o=>o.id===drag.objectId)?.metadata?.joiningPipeExit
        ? inlineObjectDragDestination({ x: drag.objectX, y: drag.objectY }, event.clientX - drag.clientX, event.clientY - drag.clientY, camera.zoom)
        : snappedObjectDestination(drag.objectId, inlineObjectDragDestination(
        { x: drag.objectX, y: drag.objectY },
        event.clientX - drag.clientX,
        event.clientY - drag.clientY,
        camera.zoom,
      ), event.ctrlKey);
      if (onObjectMovePreview) onObjectMovePreview(drag.objectId, destination,drag.mode);
      else setInlineDragOffset({
        x: (destination.x - drag.objectX) * camera.zoom,
        y: (destination.y - drag.objectY) * camera.zoom,
      });
    } else if (drag.kind === "wire-route") {
      if(!inlineObjectDragMoved(event.clientX-drag.clientX,event.clientY-drag.clientY))return;
      const angularSnap = view === "e4" ? e4RoutingMode === "angular" || event.ctrlKey : event.ctrlKey;
      const result=snapBendPoint({x:drag.point.x+(event.clientX-drag.clientX)/camera.zoom,y:drag.point.y+(event.clientY-drag.clientY)/camera.zoom},drag.anchors??[],angularSnap,7/camera.zoom,undefined,Math.PI/6,drag.snapState,drag.opMember?"nearest-compatible":"all");
      setPhysicalGuide(result.guide);
      onWireRoutePointPreview?.(drag.wireId,drag.routeIndex,result.point,drag.mode,drag.insert);
    } else if (drag.kind === "e4-wire-label") {
      const wire = objects.find((item) => item.id === drag.wireId);
      const position = wire
        ? projectPointToE4WireLabelPosition(getE4WireRoute(wire), screenToWorld(camera, localPoint(event.clientX, event.clientY)))
        : null;
      if (position !== null) setWireLabelPreview({ wireId: drag.wireId, position });
    } else if (drag.kind === "e4-screen") {
      const screen = overlays.screens.find((item) => item.id === drag.screenId);
      const layout = screen ? getE4ScreenLayout(screen, objects) : null;
      const worldPoint = screenToWorld(camera, localPoint(event.clientX, event.clientY));
      if (layout) {
        setScreenPositionPreview({
          screenId: drag.screenId,
          position: getE4ScreenPositionForPoint(layout, worldPoint),
        });
      }
    }
  };

  const endPointer = (event: PointerEvent<HTMLCanvasElement>) => {
    if(selectionDragRef.current?.pointerId===event.pointerId){
      const drag=selectionDragRef.current,selection={start:drag.start,end:screenToWorld(camera,localPoint(event.clientX,event.clientY))},ids=selectionRectangleObjectIds(objects,layers,selection);
      if(onObjectGroupSelect)onObjectGroupSelect(ids,drag.mode);
      else if(drag.mode==="replace")onObjectSelect(ids.at(-1)??null,false);else for(const id of ids)onObjectSelect(id,drag.mode==="toggle");
      setSelectionRectangle(null);setSelectionCandidateIds([]);selectionDragRef.current=null;
      if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);return;
    }
    if(freeEndDrag.current?.pointerId===event.pointerId){const d=freeEndDrag.current;freeEndDrag.current=null;const raw=screenToWorld(camera,localPoint(event.clientX,event.clientY));if(d.group&&onFreeWireEndpointsXChange){for(const ref of d.group)onFreeWireEndpointPreview?.(ref.wireId,ref.end,null);onFreeWireEndpointsXChange([...new Set(d.group.map(ref=>ref.wireId))],d.end,raw.x);}else{const snapped=snapFreeWireEndpointX(raw,snapRefs,d.wireId,d.end,8/camera.zoom);onFreeWireEndpointPreview?.(d.wireId,d.end,null);onFreeWireEndpointMove?.(d.wireId,d.end,snapped);}if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);return;}
    if (dragRef.current?.pointerId !== event.pointerId) return;
    if(dragRef.current?.kind==="physical-node-connect") {
      const drag=dragRef.current;
      const point=screenToWorld(camera,localPoint(event.clientX,event.clientY));
      const target=objects.find(o=>o.kind==="physical-node"&&!o.metadata?.joiningPipe&&o.id!==drag.fromNodeId&&layers.some(l=>l.id===o.layerId&&l.visible&&!l.locked)&&containsPoint(o,point,8/camera.zoom,view));
      const targetSegment=target?undefined:objects.find(o=>o.kind==="physical-segment"&&o.pipe?.role!=="joining-pipe"&&layers.some(l=>l.id===o.layerId&&l.visible&&!l.locked)&&containsPoint(o,point,7/camera.zoom,view));
      const moved=drag.moved||inlineObjectDragMoved(event.clientX-drag.clientX,event.clientY-drag.clientY);
      if(moved&&target) {
        onPhysicalNodesConnect?.(drag.fromNodeId,target.id);
        setPhysicalStart(null);
      } else if (moved && targetSegment) {
        onPhysicalNodeConnectToSegment?.(drag.fromNodeId,targetSegment.id,projectOntoPolyline(targetSegment.points??[],point).point);
        setPhysicalStart(null);
      } else if(!moved) {
        if(physicalStart&&physicalStart!==drag.fromNodeId){onPhysicalNodesConnect?.(physicalStart,drag.fromNodeId);setPhysicalStart(null);}
        else setPhysicalStart(drag.fromNodeId);
      } else setPhysicalStart(null);
      setPhysicalNodePreview(null);
    } else if(dragRef.current?.kind==="covering") {const drag=dragRef.current;onCoveringDrag?.(drag.objectId,drag.spanIndex,drag.part,drag.start,screenToWorld(camera,localPoint(event.clientX,event.clientY)),inlineObjectDragMoved(event.clientX-drag.clientX,event.clientY-drag.clientY)?"commit":"cancel");
    } else if(dragRef.current?.kind==="companion") {
      const drag=dragRef.current;
      if(inlineObjectDragMoved(event.clientX-drag.clientX,event.clientY-drag.clientY)) onDrawingMove?.(drag.objectId,drag.drawingId,{x:drag.offset.x+(event.clientX-drag.clientX)/camera.zoom,y:drag.offset.y+(event.clientY-drag.clientY)/camera.zoom});
      setDrawingPreview(null);
    } else if (dragRef.current?.kind === "object") {
      const drag = dragRef.current;
      const deltaX = event.clientX - drag.clientX;
      const deltaY = event.clientY - drag.clientY;
      if (inlineObjectDragMoved(deltaX, deltaY)) {
        onObjectMove?.(drag.objectId, objects.find(o=>o.id===drag.objectId)?.metadata?.joiningPipeExit
          ? inlineObjectDragDestination({ x: drag.objectX, y: drag.objectY }, deltaX, deltaY, camera.zoom)
          : snappedObjectDestination(
          drag.objectId,
          inlineObjectDragDestination({ x: drag.objectX, y: drag.objectY }, deltaX, deltaY, camera.zoom),
          event.ctrlKey,
        ),drag.mode);
      }
      onObjectMovePreview?.(drag.objectId, null);
      setConnectorAlignmentGuides({});
      setPhysicalGuide(undefined);
    } else if (dragRef.current?.kind === "wire-route") {
      const drag = dragRef.current;
      onWireRoutePointPreview?.(drag.wireId,drag.routeIndex,null);
      const moved=inlineObjectDragMoved(event.clientX-drag.clientX,event.clientY-drag.clientY);
      if(drag.insert||moved) {
        const rawPoint = moved ? snapBendPoint({
        x: drag.point.x + (event.clientX - drag.clientX) / camera.zoom,
        y: drag.point.y + (event.clientY - drag.clientY) / camera.zoom,
        }, drag.anchors ?? [], view === "e4" ? e4RoutingMode === "angular" || event.ctrlKey : event.ctrlKey, 7 / camera.zoom, undefined, Math.PI / 6, drag.snapState,drag.opMember?"nearest-compatible":"all").point : drag.point;
        onWireRoutePointMove?.(drag.wireId, drag.routeIndex, rawPoint, drag.mode, drag.insert);
      }
      setPhysicalGuide(undefined);
    } else if (dragRef.current?.kind === "e4-wire-segment") {
      const drag = dragRef.current;
      const pixelDelta = drag.orientation === "horizontal"
        ? event.clientY - drag.clientY
        : event.clientX - drag.clientX;
      if (Math.abs(pixelDelta) >= 1) {
        onE4WireSegmentMove?.(drag.wireId, drag.segmentIndex, drag.coordinate + pixelDelta / camera.zoom);
      }
    } else if (dragRef.current?.kind === "e4-wire-label") {
      const drag = dragRef.current;
      const wire = objects.find((item) => item.id === drag.wireId);
      const position = wire
        ? projectPointToE4WireLabelPosition(getE4WireRoute(wire), screenToWorld(camera, localPoint(event.clientX, event.clientY)))
        : null;
      if (position !== null) onE4WireLabelPositionChange?.(drag.wireId, position);
      setWireLabelPreview(null);
    } else if (dragRef.current?.kind === "e4-screen") {
      const drag = dragRef.current;
      if (screenPositionPreview?.screenId === drag.screenId) {
        onE4ScreenPositionChange?.(drag.screenId, screenPositionPreview.position);
      } else {
        const screen = overlays.screens.find((item) => item.id === drag.screenId);
        const layout = screen ? getE4ScreenLayout(screen, objects) : null;
        const worldPoint = screenToWorld(camera, localPoint(event.clientX, event.clientY));
        if (layout) {
          onE4ScreenPositionChange?.(drag.screenId, getE4ScreenPositionForPoint(layout, worldPoint));
        } else {
          const pixelDelta = drag.orientation === "horizontal"
            ? event.clientX - drag.clientX
            : event.clientY - drag.clientY;
          if (Math.abs(pixelDelta) >= 1) {
            const position = Math.max(0, Math.min(1, drag.position + pixelDelta / camera.zoom / drag.spanLength));
            onE4ScreenPositionChange?.(drag.screenId, position);
          }
        }
      }
      setScreenPositionPreview(null);
    }
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const cancelPointer = (event: PointerEvent<HTMLCanvasElement>) => {
    if(selectionDragRef.current?.pointerId===event.pointerId){selectionDragRef.current=null;setSelectionRectangle(null);setSelectionCandidateIds([]);if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);return;}
    if(freeEndDrag.current?.pointerId===event.pointerId){const d=freeEndDrag.current;freeEndDrag.current=null;for(const ref of d.group??[{wireId:d.wireId,end:d.end}])onFreeWireEndpointPreview?.(ref.wireId,ref.end,null);if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);return;}
    setPhysicalGuide(undefined);
    if (dragRef.current?.pointerId !== event.pointerId) return;
    if(dragRef.current.kind==="covering"){const d=dragRef.current;onCoveringDrag?.(d.objectId,d.spanIndex,d.part,d.start,d.start,"cancel");}
    if(dragRef.current.kind==="companion") setDrawingPreview(null);
    if (dragRef.current.kind === "object") {
      onObjectMovePreview?.(dragRef.current.objectId, null);
      setConnectorAlignmentGuides({});
    }
    if (dragRef.current.kind === "wire-route") onWireRoutePointPreview?.(dragRef.current.wireId,dragRef.current.routeIndex,null);
    if (dragRef.current.kind === "e4-wire-label") setWireLabelPreview(null);
    if (dragRef.current.kind === "e4-screen") setScreenPositionPreview(null);
    if (dragRef.current.kind === "physical-node-connect") {setPhysicalNodePreview(null);setPhysicalStart(null);}
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const allowDrop = (event: DragEvent<HTMLCanvasElement>) => {
    if (!event.dataTransfer.types.includes("application/x-techmap-catalog-item")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const drop = (event: DragEvent<HTMLCanvasElement>) => {
    const itemId = event.dataTransfer.getData("application/x-techmap-catalog-item");
    if (!itemId) return;
    event.preventDefault();
    onCatalogDrop(itemId, screenToWorld(camera, localPoint(event.clientX, event.clientY)));
  };

  const doubleClick = (event: MouseEvent<HTMLCanvasElement>) => {
    if (pendingPlacement) { event.preventDefault(); return; }
    if(onObjectPick)return;
    const point = screenToWorld(camera, localPoint(event.clientX, event.clientY));
    if(tool==="select"){
      const objectId=hitTestEditorScene(objects,layers,point,camera.zoom,view,componentTemplateViewInstances,resolveComponentTemplateAssetUrl),object=objects.find(item=>item.id===objectId);
      if(object?.metadata?.graphicKind==="text"){onObjectSelect(object.id,false);onObjectEditRequest?.(object.id);return;}
    }
    if (view === "e4" && tool === "select" && onE4WireRoutePointRemove) {
      const selectedWire = objects.find((item) => item.id === selectedObjectId);
      const selectedLayer = selectedWire ? layers.find((item) => item.id === selectedWire.layerId) : null;
      const routeIndex = selectedLayer?.locked === true
        ? null
        : hitTestWireRoutePoint(selectedWire, point, camera.zoom);
      if (selectedWire && routeIndex !== null) {
        onE4WireRoutePointRemove(selectedWire.id, routeIndex);
        return;
      }
    }
    if (view === "e4" && tool === "select" && onObjectEditRequest) {
      const objectId = hitTestEditorScene(
        objects,
        layers,
        point,
        camera.zoom,
        view,
        componentTemplateViewInstances,
        resolveComponentTemplateAssetUrl,
      );
      const object = objects.find((item) => item.id === objectId);
      const layer = object ? layers.find((item) => item.id === object.layerId) : null;
      if (object?.kind === "connector" && layer?.locked !== true) {
        onObjectSelect(object.id, false);
        onObjectEditRequest(object.id);
        return;
      }
    }
    if (view === "drawing") {
      const selectedWire = objects.find((item) => item.id === selectedObjectId);
      const selectedLayer = selectedWire ? layers.find((item) => item.id === selectedWire.layerId) : null;
      const routeIndex = selectedLayer?.locked === true
        ? null
        : hitTestWireRoutePoint(selectedWire, point, camera.zoom);
      if (selectedWire && routeIndex !== null) {
        onWireRoutePointRemove?.(selectedWire.id, routeIndex);
        return;
      }
    }
    if(layers.some(l=>l.locked&&objects.some(o=>o.id===selectedObjectId&&o.layerId===l.id)))return;
    onCanvasDoubleClick?.(point, event.ctrlKey);
  };

  const inlinePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    containInlineEditorPointerEvent(event);
    if (isInlineEditorControlTarget(event.target)) return;
    if (event.button === 0 && view === "e4" && tool === "select" && onWireToolRequest) {
      const endpoint = hitTestConnectorContact(
        objects,
        layers,
        screenToWorld(camera, localPoint(event.clientX, event.clientY)),
        camera.zoom,
        view,
      );
      if (endpoint) {
        setWireStart(endpoint);
        onObjectSelect(endpoint.connectorId, false);
        onWireToolRequest();
        return;
      }
    }
    if (event.button !== 0 || tool !== "select" || !inlineObject ||
        !isInlineEditorReadonlyTarget(event.target)) return;
    const layer = layers.find((item) => item.id === inlineObject.layerId);
    if (layer?.locked === true) return;
    if (event.detail >= 2 && Date.now() > suppressInlineDoubleClickUntilRef.current && onObjectEditRequest) {
      onObjectEditRequest(inlineObject.id);
      return;
    }
    if (!onObjectMove) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    inlineCaptureRef.current=event.currentTarget;
    inlineDragRef.current = {
      kind: "object",
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      objectId: inlineObject.id,
      objectX: inlineObject.x,
      objectY: inlineObject.y,
      mode:event.shiftKey?"adjacent":"carry",
    };
    inlineDragActivatedRef.current = false;
  };

  const inlinePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    containInlineEditorPointerEvent(event);
    if (inlineDragRef.current?.pointerId !== event.pointerId) return;
    const drag = inlineDragRef.current;
    const deltaX = event.clientX - drag.clientX;
    const deltaY = event.clientY - drag.clientY;
    if (inlineObjectDragMoved(deltaX, deltaY)) {
      onObjectMove?.(drag.objectId, snappedObjectDestination(
        drag.objectId,
        inlineObjectDragDestination({ x: drag.objectX, y: drag.objectY }, deltaX, deltaY, camera.zoom),
        event.ctrlKey,
      ),drag.mode);
    }
    onObjectMovePreview?.(drag.objectId, null);
    setConnectorAlignmentGuides({});
    if (inlineDragActivatedRef.current) suppressInlineDoubleClickUntilRef.current = Date.now() + 500;
    setInlineDragOffset(null);
    inlineDragRef.current = null;
    inlineCaptureRef.current = null;
    inlineDragActivatedRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const inlinePointerCancel = (event: PointerEvent<HTMLDivElement>) => {
    containInlineEditorPointerEvent(event);
    if (inlineDragRef.current?.pointerId !== event.pointerId) return;
    onObjectMovePreview?.(inlineDragRef.current.objectId, null);
    setConnectorAlignmentGuides({});
    setInlineDragOffset(null);
    inlineDragRef.current = null;
    inlineCaptureRef.current = null;
    inlineDragActivatedRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const inlinePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    containInlineEditorPointerEvent(event);
    const drag = inlineDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.clientX;
    const deltaY = event.clientY - drag.clientY;
    if (!inlineObjectDragMoved(deltaX, deltaY)) return;
    inlineDragActivatedRef.current = true;
    event.preventDefault();
    const destination = snappedObjectDestination(drag.objectId, inlineObjectDragDestination(
      { x: drag.objectX, y: drag.objectY },
      deltaX,
      deltaY,
      camera.zoom,
    ), event.ctrlKey);
    if (onObjectMovePreview) {
      setInlineDragOffset(null);
      onObjectMovePreview(drag.objectId, destination,drag.mode);
    } else {
      setInlineDragOffset({
        x: (destination.x - drag.objectX) * camera.zoom,
        y: (destination.y - drag.objectY) * camera.zoom,
      });
    }
  };

  const inlineDoubleClick = (event: MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (isInlineEditorControlTarget(event.target)) return;
    if (!inlineObject || Date.now() <= suppressInlineDoubleClickUntilRef.current) {
      event.preventDefault();
      return;
    }
    const layer = layers.find((item) => item.id === inlineObject.layerId);
    if (tool === "select" && layer?.locked !== true) onObjectEditRequest?.(inlineObject.id);
  };

  return { activeSelectedIds, allowDrop, camera, cancelPointer, canvasRef, componentTemplateViewInstances, diagnosticOverlay, dimensionMessage, dimensionStart, displayInstances, doubleClick, drop, endPointer, finishGraphicPath, frameRef, freeEndAxes, freeEndpointRefs, graphicPathDraft, graphicStart, hoverGrip, hoverTarget, inlineDoubleClick, inlineDragOffset, inlineEditor, inlineLayout, inlineObject, inlinePointerCancel, inlinePointerDown, inlinePointerMove, inlinePointerUp, layers, localPoint, objectProperties, objects, onDetachedPairAction, onDrawingScale, onFreeWireEndStyleRequest, onFreeWireEndpointMove, onFreeWireEndpointsXChange, onObjectPick, onObjectPickCancel, onObjectSelect, onObjectsIsolate, onObjectsSave, onPhysicalContextAction, onPhysicalNodesConnect, onRelatedObjectsSelect, overlay, pairActionIds, pendingPlacement, physicalGuide, physicalMenu, physicalStart, pointerDown, pointerMove, railDraft, resolveComponentTemplateAssetUrl, selectedObjectId, selectedSet, selectionRectangle, setHoverTarget, setPhysicalMenu, setPlacementPoint, setScalePreview, tool, view, wireReconnect, wireStart };
}
