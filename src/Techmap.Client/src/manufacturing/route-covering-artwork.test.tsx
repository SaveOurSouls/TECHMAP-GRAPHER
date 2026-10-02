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
    expect(markup).toContain("Metal049A");
    expect(markup).toContain("240 мм");
  });
});
