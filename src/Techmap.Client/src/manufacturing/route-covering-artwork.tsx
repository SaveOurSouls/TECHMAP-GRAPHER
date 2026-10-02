import { createElement, type ReactElement } from "react";
import type { PhysicalCovering } from "../editor/physical-coverings";
import { coveringKind } from "../editor/physical-coverings";
import { resolvedCoveringStyle } from "../editor/covering-style";

/** Stable, operator-facing values used by the route artwork and its a11y label. */
export function coveringArtworkDescriptor(covering: Pick<PhysicalCovering, "name" | "color" | "style" | "kind" | "lengthMm">) {
  const style = resolvedCoveringStyle(covering.style);
  const texture = style.texture === "auto" ? "текстура по умолчанию" : style.texture === "none" ? "без текстуры" : `текстура ${style.texture}`;
  const hatch = style.hatch === "none" ? "" : ` · штриховка ${style.hatch}`;
  const length = covering.lengthMm == null ? "длина не задана" : `${covering.lengthMm} мм`;
  return { kind: coveringKind(covering), texture, hatch, length, label: `${covering.name} · ${length} · ${texture}${hatch}` };
}

/** A compact rectangular sleeve swatch for the route table. The route drawing
 * remains the source of geometry; this is only a legible material preview. */
export function RouteCoveringArtwork({ covering, width = 560, height = 120 }: { readonly covering: Pick<PhysicalCovering, "name" | "color" | "style" | "kind" | "lengthMm">; readonly width?: number; readonly height?: number }): ReactElement {
  const style = resolvedCoveringStyle(covering.style);
  const descriptor = coveringArtworkDescriptor(covering);
  const id = `covering-${descriptor.kind}-${Math.abs((covering.name ?? "").split("").reduce((sum, char) => sum * 31 + char.charCodeAt(0), 7))}`;
  const color = /^#[0-9a-f]{6}$/i.test(covering.color ?? "") ? covering.color! : "#aebfc9";
  const texture = style.texture === "none" ? null : style.texture;
  return createElement("svg", { className: "route-covering-artwork", viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": descriptor.label, "data-covering-texture": texture ?? "none", preserveAspectRatio: "xMidYMid meet" },
    createElement("title", { key: "title" }, descriptor.label),
    createElement("defs", { key: "defs" },
      createElement("pattern", { id, width: 18, height: 18, patternUnits: "userSpaceOnUse", patternTransform: `rotate(${style.textureRotation})`, key: "pattern" },
        createElement("rect", { width: 18, height: 18, fill: color }),
        texture && style.hatch !== "dots" && createElement("path", { d: "M-4 18L18 -4M5 23L23 5", stroke: style.textureTint, strokeOpacity: .34, strokeWidth: 3 }),
        texture && style.hatch === "dots" && createElement("circle", { cx: 9, cy: 9, r: 2.3, fill: style.textureTint, fillOpacity: .4 }),
      ),
    ),
    createElement("rect", { x: 22, y: height * .29, width: width - 44, height: height * .42, rx: height * .12, fill: `url(#${id})`, stroke: style.lineColor, strokeWidth: Math.max(1.5, style.lineWidth) }),
    createElement("text", { x: 24, y: height * .2, fill: "#294257", fontSize: 13 }, covering.name),
    createElement("text", { x: 24, y: height * .88, fill: "#46616f", fontSize: 11 }, `${descriptor.length}${descriptor.hatch}`),
  );
}
