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

/**
 * Paints the volume of a conformal OP shell.  A conformal contour can contain
 * support cells between two pipes, so stroking only its centre path leaves
 * those cells unshaded.  The contour receives the same dark base as a normal
 * volume first; a broad directional wash then carries the highlight/shadow
 * through the filled gap while the centre path keeps the material readable.
 */
export function drawConformalVolumeSurface(
 context: CanvasRenderingContext2D,
 polygon: readonly Point[],
 center: readonly Point[],
): void {
 if (polygon.length < 3) return;
 context.save();
 context.beginPath();
 polygon.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y));
 context.closePath();
 context.fillStyle = "rgba(0,0,0,.20)";
 context.fill();

 // A linear wash is stable for straight and bent OP sections and, unlike a
 // cylinder stroke, is clipped to every part of the expanded contour.
 const first = center[0] ?? polygon[0]!;
 const last = center.at(-1) ?? first;
 const dx = last.x - first.x, dy = last.y - first.y;
 const length = Math.hypot(dx, dy) || 1;
 const nx = -dy / length, ny = dx / length;
 const extent = Math.max(...polygon.map(point => Math.abs((point.x - first.x) * nx + (point.y - first.y) * ny)), 1);
 const gradient = typeof context.createLinearGradient === "function"
   ? context.createLinearGradient(first.x - nx * extent, first.y - ny * extent, first.x + nx * extent, first.y + ny * extent)
   : null;
 if (gradient) {
  gradient.addColorStop(0, "rgba(255,255,255,.10)");
  gradient.addColorStop(.5, "rgba(255,255,255,.015)");
  gradient.addColorStop(1, "rgba(0,0,0,.10)");
  context.fillStyle = gradient;
  context.fill();
 }
 context.restore();
}
