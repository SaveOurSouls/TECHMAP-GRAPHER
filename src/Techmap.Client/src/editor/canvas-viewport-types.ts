import {
  type EditorSceneObject,
  type EditorPoint,
  type HarnessEditorView,
  type EditorTool,
  type EditorCamera,
  type EditorLayer,
} from "./editor-types";
import { type CableInstance } from "./model";
import { type E4SceneOverlays, type E4ConnectableEndpoint, type E4SegmentOrientation } from "./canvas-e4-scene";
import {
  type ComponentTemplateViewInstance,
  type ResolveComponentTemplateAssetUrl,
} from "./component-template-view-renderer";
import { type ReactNode } from "react";
import { type CoveringDragPart } from "./covering-layout";
import { type DimensionMode } from "./drawing-dimensions";
import { type DrawingGraphic } from "./drawing-documents";
import { type DrawingSnaps } from "../component-library/drawing-geometry";
import { type EditorViewportSize } from "./editor-camera";
import { type EditorSelectionMode } from "./canvas-selection";
import { type PhysicalDragMode, type BendSnapState } from "./physical-editing";
import { type PhysicalContextAction, type PhysicalContextTarget } from "./physical-coverings";

export interface CanvasViewportProps {
  /** Preview only: absent from the document until onPlace confirms the first contact's world position. */
  readonly pendingPlacement?: EditorSceneObject | null;
  readonly onPlace?: (insertionPoint: EditorPoint) => void;
  readonly onPlacementCancel?: () => void;
  readonly onFreeWireEndpointMove?: (wireId:string,end:"from"|"to",point:EditorPoint)=>void;
  readonly onFreeWireEndpointPreview?: (wireId:string,end:"from"|"to",point:EditorPoint|null)=>void;
  readonly onFreeWireEndpointsXChange?: (wireIds:readonly string[],end:"from"|"to",x:number)=>void;
  readonly onDetachedPairAction?: (wireIds:readonly string[],action:"twist"|"straighten")=>void;
  readonly onFreeWireEndStyleRequest?: (wireId:string,end:"from"|"to")=>void;
  readonly view: HarnessEditorView;
  readonly tool: EditorTool;
  readonly camera: EditorCamera;
  readonly objects: readonly EditorSceneObject[];
  readonly layers: readonly EditorLayer[];
  readonly selectedObjectId: string | null;
  readonly selectedObjectIds?: readonly string[];
  readonly highlightedObjectIds?: readonly string[];
  readonly foregroundWireIds?: readonly string[];
  /** Presentation-only background; these objects are painted but never hit-tested. */
  readonly backgroundObjects?: readonly EditorSceneObject[];
  readonly backgroundOpacity?: number;
  readonly cables?: readonly CableInstance[];
  readonly e4Overlays?: E4SceneOverlays;
  readonly e4RoutingMode?: "orthogonal" | "angular";
  /** Exact project snapshots keyed to connector scene-object ids. */
  readonly componentTemplateViewInstances?: readonly ComponentTemplateViewInstance[];
  /** Resolves an asset inside the exact project snapshot. */
  readonly resolveComponentTemplateAssetUrl?: ResolveComponentTemplateAssetUrl;
  readonly overlay?: ReactNode;
  readonly onPipeIntervalSelect?:(id:string,from:number,to:number)=>void;
  readonly onCoveringDrag?:(id:string,spanIndex:number,part:CoveringDragPart,start:EditorPoint,point:EditorPoint,phase:"preview"|"commit"|"cancel")=>void;
  readonly onDimensionCreate?:(wireId:string,from:number,to:number,pointCount:number,mode:DimensionMode,auxiliary?:boolean)=>void;
  readonly onPositionRailCreate?:(start:EditorPoint,end:EditorPoint,leaderIds:readonly string[])=>void;
  readonly onGraphicCreate?:(graphic:DrawingGraphic)=>void;
  readonly drawingSnaps?:DrawingSnaps;
  readonly drawingAngleStep?:number;
  readonly diagnosticOverlay?: ReactNode;
  readonly inlineEditor?: ReactNode;
  readonly onCameraChange: (camera: EditorCamera) => void;
  readonly onViewportSizeChange?: (size: EditorViewportSize) => void;
  readonly onObjectSelect: (objectId: string | null, additive?: boolean) => void;
  /** Selects all members of a linked E4 overlay in one state update. */
  readonly onObjectGroupSelect?: (objectIds: readonly string[], mode?: EditorSelectionMode) => void;
  /** Available only for editable route fragment copies. */
  readonly onObjectsIsolate?: (objectIds: readonly string[]) => void;
  readonly dimmedObjectIds?: readonly string[];
  readonly onObjectsSave?: (objectIds: readonly string[]) => void;
  readonly onDrawingScale?: (objectId:string,drawingId:string,scale:number)=>void;
  readonly onDrawingMove?: (objectId:string,drawingId:string,offset:EditorPoint)=>void;
  readonly objectProperties?: (objectId:string)=>ReactNode;
  readonly onObjectPick?: (objectId:string|null)=>void;
  readonly onObjectPickCancel?: ()=>void;
  readonly onRelatedObjectsSelect?: (ids:readonly string[])=>void;
  readonly onObjectMove?: (objectId: string, point: EditorPoint, mode?: PhysicalDragMode) => void;
  /** Shows a transient move without adding an undo entry. Passing null clears it. */
  readonly onObjectMovePreview?: (objectId: string, point: EditorPoint | null, mode?: PhysicalDragMode) => void;
  readonly onWireConnect?: (
    from: E4ConnectableEndpoint,
    to: E4ConnectableEndpoint,
  ) => void;
  readonly onWireReconnect?: (
    wireId: string,
    end: "from" | "to",
    target: E4ConnectableEndpoint,
  ) => void;
  readonly onWireConnectToWire?: (
    from: E4ConnectableEndpoint,
    targetWireId: string,
    point: EditorPoint,
  ) => void;
  readonly onWireReconnectToWire?: (
    wireId: string,
    end: "from" | "to",
    targetWireId: string,
    point: EditorPoint,
  ) => void;
  readonly onE4WireSegmentMove?: (wireId: string, segmentIndex: number, coordinate: number) => void;
  readonly onE4WireRoutePointRemove?: (wireId: string, routeIndex: number) => void;
  readonly onE4WireLabelPositionChange?: (wireId: string, position: number) => void;
  readonly onE4ScreenPositionChange?: (screenId: string, position: number) => void;
  readonly onWireToolRequest?: () => void;
  readonly onWireRoutePointPreview?: (id:string,index:number,point:EditorPoint|null, mode?:PhysicalDragMode, insert?:boolean)=>void;
  readonly onWireRoutePointMove?: (wireId: string, routeIndex: number, point: EditorPoint, mode?:PhysicalDragMode, insert?:boolean) => void;
  readonly onWireRoutePointRemove?: (wireId: string, routeIndex: number) => void;
  readonly onObjectEditRequest?: (objectId: string) => void;
  readonly onPhysicalNodesConnect?: (from:string,to:string)=>void;
  readonly onPhysicalNodeConnectToSegment?: (fromNodeId:string,segmentId:string,point:EditorPoint)=>void;
  readonly onPhysicalContextAction?: (segmentId:string,point:EditorPoint,action:PhysicalContextAction,target?:PhysicalContextTarget)=>void;
  readonly onCanvasDoubleClick?: (point: EditorPoint, ctrlKey?: boolean) => void;
  readonly onCatalogDrop: (itemId: string, point: EditorPoint) => void;
}

export interface PointerDrag {
  readonly kind: "pan";
  readonly pointerId: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly camera: EditorCamera;
}

export interface CoveringPointerDrag {readonly kind:"covering";readonly pointerId:number;readonly clientX:number;readonly clientY:number;readonly objectId:string;readonly spanIndex:number;readonly part:CoveringDragPart;readonly start:EditorPoint}

export interface DrawingPointerDrag { readonly kind:"companion"; readonly pointerId:number; readonly clientX:number; readonly clientY:number; readonly objectId:string; readonly drawingId:string; readonly offset:EditorPoint; }

export interface ObjectPointerDrag {
  readonly kind: "object";
  readonly pointerId: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly objectId: string;
  readonly objectX: number;
  readonly objectY: number;
  readonly mode?:PhysicalDragMode;
  readonly anchors?:readonly EditorPoint[];
  readonly routeAnchors?:readonly EditorPoint[];
  readonly snapState?:BendSnapState;
}

export interface WireRoutePointerDrag {
  readonly kind: "wire-route";
  readonly pointerId: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly wireId: string;
  readonly routeIndex: number;
  readonly point: EditorPoint;
  readonly mode?:PhysicalDragMode;
  readonly insert?:boolean;
  readonly opMember?:boolean;
  readonly anchors?:readonly EditorPoint[];
  readonly snapState?:BendSnapState;
}

export interface E4WireSegmentPointerDrag {
  readonly kind: "e4-wire-segment";
  readonly pointerId: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly wireId: string;
  readonly segmentIndex: number;
  readonly orientation: E4SegmentOrientation;
  readonly coordinate: number;
}

export interface E4ScreenPointerDrag {
  readonly kind: "e4-screen";
  readonly pointerId: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly screenId: string;
  readonly orientation: E4SegmentOrientation;
  readonly position: number;
  readonly spanLength: number;
}

export interface E4WireLabelPointerDrag {
  readonly kind: "e4-wire-label";
  readonly pointerId: number;
  readonly wireId: string;
}

export interface PhysicalNodeConnectPointerDrag {
  readonly kind: "physical-node-connect";
  readonly pointerId: number;
  readonly fromNodeId: string;
  readonly clientX: number;
  readonly clientY: number;
  moved: boolean;
}
