export { drawingConnectorIndexLabel, getEditorSceneBounds } from "./canvas-scene-bounds";
export {
  getDrawingWireStripProfileGeometries,
  hitTestWireRoutePoint,
  numberedPipeBendHandles,
  pipeMidpoints,
  e4Midpoints,
  hitTestWireEnd,
  getVisibleCableSheathScene,
  hitTestCableSheath,
  hitTestEditorScene,
  coveringDragBlockedByPhysicalNode,
  type VisibleCableSheathScene,
} from "./canvas-scene-hit-test";
export { drawE4DifferentialPairs } from "./canvas-e4-renderer";
export {
  getE4WireRoute,
  e4WireSegments,
  projectPointToOrthogonalSegment,
  hitTestE4WireSegment,
  hitTestWireSegment,
  parseE4SceneOverlays,
  getE4BridgeGeometry,
  getE4WireCrossings,
  findE4CommonParallelSpan,
  getE4DifferentialPairLayout,
  getE4DifferentialPairLayouts,
  getE4ScreenLayout,
  hitTestE4DifferentialPair,
  hitTestE4Screen,
  hitTestE4ScreenConnection,
  hitTestE4WireLabel,
  getVisibleE4SceneOverlays,
  type E4SegmentOrientation,
  type E4WireSegment,
  type E4WireSegmentHit,
  type OrthogonalProjection,
  type E4JunctionOverlay,
  type E4DifferentialPairOverlay,
  type E4ScreenOverlay,
  type E4ConnectableEndpoint,
  type E4SceneOverlays,
  type E4WireCrossing,
  type E4BridgeGeometry,
  type E4ParallelSpan,
  type E4ScreenLayout,
  type E4DifferentialPairMotif,
  type E4DifferentialPairLayout,
} from "./canvas-e4-scene";
export { objectsInPaintOrder } from "./canvas-paint-order";
export {
  e4ContactMarker, getE4ConnectorLayout, getMaterializedConnectorContactPoints, hitTestConnectorContact,
  type E4ConnectorColumnLayout, type E4ConnectorLayout, type E4ContactMarkerGeometry,
  type MaterializedConnectorContactPoint,
} from "./canvas-connector-layout";
export { drawSelectedConnectorContacts } from "./canvas-connector-renderer";
export { type CanvasViewportProps } from "./canvas-viewport-types";
export { handleEditorViewportWheel, containInlineEditorPointerEvent, isInlineEditorReadonlyTarget, isInlineEditorControlTarget, inlineObjectDragMoved, inlineObjectDragDestination } from "./canvas-interaction-helpers";
export { type WireDrawingEndArtworkPlacement, wireDrawingEndArtworkPlacement, drawEditorSceneObject, redrawCanvas, drawCableSheaths } from "./canvas-scene-renderer";
export { type FreeWireEndpointRef, type EditorSelectionRectangle, objectIntersectsSelectionRectangle, selectionRectangleObjectIds, type EditorSelectionMode, type FreeWireEndAxis, freeWireEndpointRefs, freeWireEndAxes, freeWireEndpointAxis, snapFreeWireEndpointX } from "./canvas-selection";
export { CanvasViewport } from "./CanvasViewportSurface";
