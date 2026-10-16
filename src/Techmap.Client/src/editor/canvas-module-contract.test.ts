import { expect, it } from "vitest";
import * as viewport from "./CanvasViewport";
import { CanvasViewport } from "./CanvasViewportSurface";
import * as rendering from "./canvas-scene-renderer";
import * as selection from "./canvas-selection";
import * as interaction from "./canvas-interaction-helpers";

it("preserves the viewport facade across renderer, selection and interaction boundaries", () => {
  expect(viewport.CanvasViewport).toBe(CanvasViewport);
  const renderNames = ["redrawCanvas", "drawEditorSceneObject", "drawCableSheaths", "wireDrawingEndArtworkPlacement"] as const;
  for (const name of renderNames) expect(viewport[name]).toBe(rendering[name]);
  const selectionNames = ["objectIntersectsSelectionRectangle", "selectionRectangleObjectIds", "freeWireEndpointRefs",
    "freeWireEndAxes", "freeWireEndpointAxis", "snapFreeWireEndpointX"] as const;
  for (const name of selectionNames) expect(viewport[name]).toBe(selection[name]);
  const interactionNames = ["handleEditorViewportWheel", "containInlineEditorPointerEvent", "isInlineEditorReadonlyTarget",
    "isInlineEditorControlTarget", "inlineObjectDragMoved", "inlineObjectDragDestination"] as const;
  for (const name of interactionNames) expect(viewport[name]).toBe(interaction[name]);
  for (const name of ["e4ConnectorSnapTarget", "roundedRectangle", "drawGrid", "useCanvasViewport"]) {
    expect(viewport).not.toHaveProperty(name);
  }
});
