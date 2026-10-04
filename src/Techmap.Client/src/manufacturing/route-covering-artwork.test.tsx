import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { coveringArtworkDescriptor, RouteCoveringArtwork } from "./route-covering-artwork";

describe("route covering artwork", () => {
  const covering = { name: "Оплётка", color: "#73838d", kind: "metal-braid" as const, lengthMm: 240, style: { texture: "Metal049A" as const, hatch: "cross" as const, lineColor: "#263c47" } };

  it("describes the drawing characteristics without changing manufacturing values", () => {
    const descriptor = coveringArtworkDescriptor(covering);
    expect(descriptor.length).toBe("240 мм");
    expect(descriptor.texture).toContain("Metal049A");
    expect(descriptor.hatch).toContain("cross");
    expect(descriptor.label).toContain("Оплётка");
  });

  it("renders a textured rectangular sleeve with an accessible label", () => {
    const markup = renderToStaticMarkup(createElement(RouteCoveringArtwork, { covering }));
    expect(markup).toContain("role=\"img\"");
    expect(markup).toContain("aria-label=\"Оплётка · 240 мм");
    expect(markup).toContain("pattern");
    expect(markup).toContain("<image");
    expect(markup).toContain("Metal049A");
    // The vector weave and volume overlay keep the preview legible when the
    // catalogue image is unavailable in an exported/generated SVG.
    expect(markup).toContain("linearGradient");
    expect(markup).toContain("#e7f0f3");
    expect(markup).toContain("#172a34");
    expect(markup).toContain("240 мм");
    expect(markup).not.toContain("<text");
    expect(markup).not.toContain(" rx=");
  });

  it("keeps the metal braid as a clean autonomous rectangle", () => {
    const markup = renderToStaticMarkup(createElement(RouteCoveringArtwork, { covering }));
    expect(markup).toContain('viewBox="0 0 560 120"');
    expect(markup).toContain('fill="url(#covering-metal-braid');
    expect(markup).toContain('pointer-events="none"');
    expect(markup).not.toContain("<polyline");
    expect(markup).not.toContain("<text");
    expect(markup).not.toContain(" rx=");
  });

  it("keeps the metal weave visible when the catalogue raster is unavailable", () => {
    const markup = renderToStaticMarkup(createElement(RouteCoveringArtwork, {
      covering: { ...covering, style: { ...covering.style, texture: `asset:${"a".repeat(64)}` } },
    }));
    expect(markup).not.toContain("<image");
    expect(markup).toContain("#e7f0f3");
    expect(markup).toContain("#172a34");
    expect(markup).toContain("linearGradient");
  });

  it("renders automatic thread bandage as transverse fibres", () => {
    const markup = renderToStaticMarkup(createElement(RouteCoveringArtwork, {
      covering: { name: "Нитевый бандаж", color: "#ffffff", kind: "band" as const, lengthMm: 400, style: undefined },
    }));
    expect(markup).toContain('data-covering-texture="auto"');
    // The band pattern contains repeated vertical strokes. They remain
    // visible even when the raster reference has not loaded yet.
    expect(markup).toMatch(/M-?\d+(?:\.\d+)? -\d+(?:\.\d+)?V/);
    expect(markup).not.toContain("<text");
    expect(markup).not.toContain(" rx=");
  });
});
