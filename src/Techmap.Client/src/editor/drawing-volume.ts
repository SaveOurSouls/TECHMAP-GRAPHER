import type { Point } from "./model";

const bands = [.9, .78, .66, .54, .42, .3, .18];

/** A cross-section profile follows the current canvas path, including rounded bends. */
export function drawVolumeStroke(context: CanvasRenderingContext2D, width: number): void {
  if (!(width > 0)) return;
  context.save();
  context.strokeStyle = "rgba(0,0,0,.25)";
  context.lineWidth = width; context.stroke();
  context.strokeStyle = "rgba(255,255,255,.075)";
  for (const fraction of bands) {
    context.lineWidth = width * fraction; context.stroke();
  }
  context.restore();
}

/** Every polygon side is paired with its centre sample, so tapered and curved
 * sleeves are shaded across local width rather than across their bounding box. */
export function drawVolumeSurface(context: CanvasRenderingContext2D, polygon: readonly Point[], center: readonly Point[]): void {
  if (!center.length || polygon.length !== center.length * 2) return;
  context.save();
  const band = (fraction: number, color: string) => {
    context.beginPath();
    polygon.forEach((p, i) => {
      const c = center[i < center.length ? i : polygon.length - i - 1]!;
      const x = c.x + (p.x - c.x) * fraction, y = c.y + (p.y - c.y) * fraction;
      if (i) context.lineTo(x, y); else context.moveTo(x, y);
    });
    context.closePath(); context.fillStyle = color; context.fill();
  };
  band(1, "rgba(0,0,0,.25)");
  // Clip inner bands to the original contour at tight concave bends.
  context.clip();
  for (const fraction of bands) band(fraction, "rgba(255,255,255,.075)");
  context.restore();
}
