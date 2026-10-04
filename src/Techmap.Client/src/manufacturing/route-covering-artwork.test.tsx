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
    // The catalogue image and volume overlay keep the preview legible in the
    // generated SVG.
    expect(markup).toContain("linearGradient");
    expect(markup).toContain("<image");
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

  it("uses the pinned project asset instead of the generic metal fallback", () => {
    const hash = "a".repeat(64);
    const markup = renderToStaticMarkup(createElement(RouteCoveringArtwork, {
      covering: { ...covering, style: { ...covering.style, texture: `asset:${hash}` } },
      textureUrls: { [hash]: "/project/metal-braid.png" },
    }));
    expect(markup).toContain("/project/metal-braid.png");
    expect(markup).not.toContain("#e7f0f3");
    expect(markup).not.toContain("#172a34");
  });

  it("uses the pinned thread-bandage asset without overlaying generic fibres", () => {
    const hash = "b".repeat(64);
    const markup = renderToStaticMarkup(createElement(RouteCoveringArtwork, {
      covering: { name: "Нитевый бандаж", color: "#ffffff", kind: "band" as const, lengthMm: 400, style: { texture: `asset:${hash}` } },
      textureUrls: { [hash]: "/project/thread-bandage.png" },
    }));
    expect(markup).toContain("/project/thread-bandage.png");
    expect(markup).not.toMatch(/M-?\d+(?:\.\d+)? -\d+(?:\.\d+)?V/);
    expect(markup).not.toContain("<text");
    expect(markup).not.toContain(" rx=");
  });
});
