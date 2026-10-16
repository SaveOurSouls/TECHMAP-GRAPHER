import type { RouteDrawingCopy } from "./route-drawing-copy";

/** Source and isolated drawing copies shared by manufacturing cards. */
export interface RouteCardDrawing {
  readonly backgroundOpacity: number;
  readonly drawingCopy?: RouteDrawingCopy;
  readonly isolatedDrawingCopy?: RouteDrawingCopy;
}
