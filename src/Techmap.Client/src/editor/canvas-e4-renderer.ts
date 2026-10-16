import type { EditorSceneObject } from "./editor-types";
import {
  getE4BridgeGeometry, getE4DifferentialPairLayouts, getE4ScreenLayout,
  type E4WireCrossing, type E4DifferentialPairOverlay, type E4JunctionOverlay, type E4ScreenOverlay,
} from "./canvas-e4-scene";
import { parallelSpanLocal } from "./e4-parallel-spans";
import { E4_BRIDGE_RADIUS } from "./e4-router";

const E4_WHITE_WIRE_OUTLINE = "#53636c";

function isWhiteWireColor(color: string): boolean {
  const normalized = color.trim().toLowerCase().replace(/\s+/g, "");
  return normalized === "white" || normalized === "#fff" || normalized === "#ffffff" ||
    normalized === "#ffffffff" || normalized === "rgb(255,255,255)" || normalized === "rgba(255,255,255,1)";
}

/** Keeps a white E4 conductor visible on the pale canvas without changing its actual colour. */
export function strokeE4Wire(context: CanvasRenderingContext2D, color: string, width = 3): void {
  if (isWhiteWireColor(color)) {
    context.strokeStyle = E4_WHITE_WIRE_OUTLINE;
    context.lineWidth = width + 2;
    context.stroke();
  }
  context.strokeStyle = color;
  context.lineWidth = width;
  context.stroke();
}

export function drawE4BridgeCrossings(
  context: CanvasRenderingContext2D,
  crossings: readonly E4WireCrossing[],
  objects: readonly EditorSceneObject[],
) {
  const radius = E4_BRIDGE_RADIUS;
  for (const crossing of crossings) {
    const over = objects.find((object) => object.id === crossing.overWireId);
    const under = objects.find((object) => object.id === crossing.underWireId);
    if (!over || !under) continue;
    const geometry = getE4BridgeGeometry(crossing, radius);
    context.save();
    context.lineJoin = "round";
    // Remove the straight portion which the bridge replaces, then restore the
    // perpendicular conductor through the cleared centre. This keeps its
    // colour continuous instead of leaving the white break created by the
    // former eraser-only implementation.
    context.strokeStyle = "#f8fafb";
    context.lineWidth = 7;
    context.lineCap = "butt";
    context.beginPath();
    context.moveTo(geometry.clearStart.x, geometry.clearStart.y);
    context.lineTo(geometry.clearEnd.x, geometry.clearEnd.y);
    context.stroke();
    context.lineCap = "butt";
    context.beginPath();
    if(crossing.underDirection){
      const u=crossing.underDirection;context.moveTo(crossing.point.x-u.x*5,crossing.point.y-u.y*5);context.lineTo(crossing.point.x+u.x*5,crossing.point.y+u.y*5);
    } else if (crossing.overOrientation === "horizontal") {
      context.moveTo(crossing.point.x, crossing.point.y - 5);
      context.lineTo(crossing.point.x, crossing.point.y + 5);
    } else {
      context.moveTo(crossing.point.x - 5, crossing.point.y);
      context.lineTo(crossing.point.x + 5, crossing.point.y);
    }
    strokeE4Wire(context, under.color);
    // A halo which follows the raised path establishes layer order. Drawing
    // the same path in colour afterwards keeps the bridge and both feet whole.
    context.strokeStyle = "#f8fafb";
    context.lineWidth = 7;
    context.beginPath();
    context.moveTo(geometry.coloredStart.x, geometry.coloredStart.y);
    context.lineTo(geometry.arcStart.x, geometry.arcStart.y);
    if(crossing.overDirection){
      const u=crossing.overDirection,n={x:u.y,y:-u.x},p=crossing.point;
      context.bezierCurveTo(p.x-u.x*radius/2+n.x*radius,p.y-u.y*radius/2+n.y*radius,p.x+u.x*radius/2+n.x*radius,p.y+u.y*radius/2+n.y*radius,geometry.arcEnd.x,geometry.arcEnd.y);    } else if (crossing.overOrientation === "horizontal") {
      context.bezierCurveTo(
        crossing.point.x - radius / 2, crossing.point.y - radius,
        crossing.point.x + radius / 2, crossing.point.y - radius,
        crossing.point.x + radius, crossing.point.y,
      );
    } else {
      context.bezierCurveTo(
        crossing.point.x + radius, crossing.point.y - radius / 2,
        crossing.point.x + radius, crossing.point.y + radius / 2,
        crossing.point.x, crossing.point.y + radius,
      );
    }
    context.lineTo(geometry.coloredEnd.x, geometry.coloredEnd.y);
    context.stroke();
    context.lineCap = "round";
    strokeE4Wire(context, over.color);
    context.restore();
  }
}

export function drawE4DifferentialPairs(
  context: CanvasRenderingContext2D,
  groups: readonly E4DifferentialPairOverlay[],
  objects: readonly EditorSceneObject[],
) {
  for (const group of groups) {
    for(const layout of getE4DifferentialPairLayouts(group, objects)){
    const span = layout.span;
    const first = objects.find((object) => object.id === group.wireIds[0]);
    const second = objects.find((object) => object.id === group.wireIds[1]);
    if (!first || !second) continue;
    for (const [motifIndex, motif] of layout.motifs.entries()) {
      const { from, to, coloredFrom, coloredTo, center: along } = motif;
      const crossingLength = to - from;
      context.save();
      if(span.direction){const u=span.direction;context.transform(u.x,u.y,-u.y,u.x,0,0);}
      context.lineJoin = "round";
      context.lineCap = "butt";
      context.strokeStyle = "#f8fafb";
      context.lineWidth = 7;
      for (const crossValue of [layout.crossMinimum, layout.crossMaximum]) {
        context.beginPath();
        if (span.orientation === "horizontal") {
          context.moveTo(from, crossValue);
          context.lineTo(to, crossValue);
        } else {
          context.moveTo(crossValue, from);
          context.lineTo(crossValue, to);
        }
        context.stroke();
      }
      context.lineCap = "round";
      const traceMotif = (reverse: boolean, extendBefore: boolean, extendAfter: boolean) => {
        const crossStart = reverse ? layout.crossMaximum : layout.crossMinimum;
        const crossEnd = reverse ? layout.crossMinimum : layout.crossMaximum;
        context.beginPath();
        if (span.orientation === "horizontal") {
          context.moveTo(extendBefore ? coloredFrom : from, crossStart);
          context.lineTo(from, crossStart);
          if (layout.variant === 2) context.lineTo(to, crossEnd);
          else context.bezierCurveTo(along - crossingLength / 4, crossStart, along + crossingLength / 4, crossEnd, to, crossEnd);
          context.lineTo(extendAfter ? coloredTo : to, crossEnd);
        } else {
          context.moveTo(crossStart, extendBefore ? coloredFrom : from);
          context.lineTo(crossStart, from);
          if (layout.variant === 2) context.lineTo(crossEnd, to);
          else context.bezierCurveTo(crossStart, along - crossingLength / 4, crossEnd, along + crossingLength / 4, crossEnd, to);
          context.lineTo(crossEnd, extendAfter ? coloredTo : to);
        }
      };
      // Each X represents two wires swapping lanes. Before the first motif the
      // colours belong to their original lanes; after it they belong to the
      // opposite lanes, and every following motif swaps them back. Repaint the
      // straight spans between motifs with the colour of the physical wire
      // which currently occupies that lane, avoiding a colour splice at the
      // feet of an X.
      const firstSegment=span.segmentByWireId[first.id]!;
      const firstOnMinimum=Math.abs(parallelSpanLocal(span,firstSegment.start).y-layout.crossMinimum)<1e-6;
      const firstStartsOnMinimum = (motifIndex % 2 === 0)===firstOnMinimum;
      traceMotif(!firstStartsOnMinimum, true, true);
      // Both conductors need a halo against the scene painted below. Without
      // this first stroke, a third wire running between the pair's lanes looks
      // electrically joined to the first diagonal at their intersection.
      context.strokeStyle = "#f8fafb";
      context.lineWidth = 7;
      context.lineCap = "butt";
      context.stroke();
      traceMotif(!firstStartsOnMinimum, true, true);
      context.lineCap = "round";
      strokeE4Wire(context, first.color);
      traceMotif(firstStartsOnMinimum, true, true);
      context.strokeStyle = "#f8fafb";
      context.lineWidth = 7;
      context.lineCap = "butt";
      context.stroke();
      context.lineCap = "round";
      strokeE4Wire(context, second.color);
      const nextMotif = layout.motifs[motifIndex + 1];
      const straightEnd = nextMotif?.from ?? span.end;
      if (straightEnd > to) {
        const drawLane = (cross: number, color: string) => {
          context.beginPath();
          if (span.orientation === "horizontal") {
            context.moveTo(to, cross);
            context.lineTo(straightEnd, cross);
          } else {
            context.moveTo(cross, to);
            context.lineTo(cross, straightEnd);
          }
          context.lineCap = "butt";
          strokeE4Wire(context, color);
        };
        const afterSwap = firstStartsOnMinimum;
        drawLane(layout.crossMinimum, afterSwap ? second.color : first.color);
        drawLane(layout.crossMaximum, afterSwap ? first.color : second.color);
      }
      context.restore();
    }
    }
  }
}

export function drawE4Junctions(context: CanvasRenderingContext2D, junctions: readonly E4JunctionOverlay[]) {
  context.save();
  context.fillStyle = "#183b4d";
  for (const junction of junctions) {
    context.beginPath();
    context.arc(junction.position.x, junction.position.y, 5, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}

export function drawE4Screens(
  context: CanvasRenderingContext2D,
  screens: readonly E4ScreenOverlay[],
  objects: readonly EditorSceneObject[],
) {
  for (const screen of screens) {
    const layout = getE4ScreenLayout(screen, objects);
    if (!layout) continue;
    const width = layout.orientation === "horizontal" ? layout.alongSize : layout.crossSize;
    const height = layout.orientation === "horizontal" ? layout.crossSize : layout.alongSize;
    context.beginPath();
    context.ellipse(layout.center.x, layout.center.y, width / 2, height / 2, 0, 0, Math.PI * 2);
    context.fillStyle = "rgba(226, 232, 236, 0.5)";
    context.fill();
    context.strokeStyle = "#506d7c";
    context.lineWidth = 1.5;
    context.stroke();
    for (const terminal of layout.terminals) {
      context.beginPath();
      context.arc(terminal.connectionPoint.x, terminal.connectionPoint.y, 3.5, 0, Math.PI * 2);
      context.fillStyle = "#183b4d";
      context.fill();
    }
  }
}
