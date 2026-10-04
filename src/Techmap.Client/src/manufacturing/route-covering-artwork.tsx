import { createElement, type ReactElement } from "react";
import type { PhysicalCovering } from "../editor/physical-coverings";
import { coveringKind } from "../editor/physical-coverings";
import { coveringTextureFile, resolvedCoveringStyle } from "../editor/covering-style";
import { coveringTextureUrls } from "../editor/covering-renderer";

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
  const textureFile = coveringTextureFile(descriptor.kind, covering.style);
  const textureUrl = textureFile ? coveringTextureUrls[textureFile] : undefined;
  const tileSize = Math.max(16, 64 / style.textureScale);
  // The route artwork is an SVG snapshot and does not have the canvas
  // centreline that the editor uses for drawThreadBand.  A dedicated
  // transverse repeat keeps a thread band recognisable when the image asset
  // is still loading (or has transparent pixels), while preserving the
  // configured texture angle and scale.
  const threadStep = Math.max(2, 3 * style.textureScale);
  const threadWidth = Math.max(.35, style.textureScale * .65);
  const threadLines = Array.from({ length: Math.ceil(tileSize / threadStep) + 2 }, (_, index) => {
    const x = (index - 1) * threadStep;
    return `M${x} -${tileSize}V${tileSize * 2}`;
  }).join("");
  const swatchY = height * .25;
  const swatchHeight = height * .5;
  return createElement("svg", { className: "route-covering-artwork", viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": descriptor.label, "data-covering-texture": texture ?? "none", preserveAspectRatio: "xMidYMid meet" },
    createElement("title", { key: "title" }, descriptor.label),
    createElement("defs", { key: "defs" },
      createElement("pattern", { id, width: tileSize, height: tileSize, patternUnits: "userSpaceOnUse", patternTransform: `rotate(${style.textureRotation})`, key: "pattern" },
        createElement("rect", { width: tileSize, height: tileSize, fill: color }),
        textureUrl && createElement("image", { href: textureUrl, width: tileSize, height: tileSize, preserveAspectRatio: "xMidYMid slice", opacity: .82 }),
        descriptor.kind === "band" && texture && createElement("path", { d: threadLines, stroke: "#263640", strokeOpacity: .28, strokeWidth: threadWidth * 1.9 }),
        descriptor.kind === "band" && texture && createElement("path", { d: threadLines, stroke: style.textureTint, strokeOpacity: .78, strokeWidth: threadWidth }),
        texture && style.hatch !== "none" && style.hatch !== "dots" && createElement("path", { d: `M-${tileSize * .2} ${tileSize}L${tileSize} -${tileSize * .2}M${tileSize * .3} ${tileSize * 1.3}L${tileSize * 1.3} ${tileSize * .3}`, stroke: style.textureTint, strokeOpacity: .34, strokeWidth: Math.max(1, style.hatchSpacing / 3) }),
        texture && style.hatch === "dots" && createElement("circle", { cx: tileSize / 2, cy: tileSize / 2, r: Math.max(1, style.hatchSpacing / 4), fill: style.textureTint, fillOpacity: .4 }),
      ),
    ),
    createElement("rect", { x: 22, y: swatchY, width: width - 44, height: swatchHeight, fill: `url(#${id})`, stroke: style.lineColor, strokeWidth: Math.max(1.5, style.lineWidth) }),
  );
}
