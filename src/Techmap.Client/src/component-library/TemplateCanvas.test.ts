import { describe, expect, it } from "vitest";
import { clientToSvgCoordinates } from "./TemplateCanvas";

describe("template canvas coordinates", () => {
  it("accounts for vertical letterboxing in a narrow SVG viewport", () => {
    // A 720x440 viewBox fitted into 360x440 uses scale .5 and 110 px top letterbox.
    const svg = { getScreenCTM: () => ({ a: .5, b: 0, c: 0, d: .5, e: 0, f: 110 }) } as unknown as SVGSVGElement;
    expect(clientToSvgCoordinates(svg, 180, 220)).toEqual({ x: 360, y: 220 });
    expect(clientToSvgCoordinates(svg, 50, 120)).toEqual({ x: 100, y: 20 });
  });

  it("supports a translated non-uniform screen transform", () => {
    const svg = { getScreenCTM: () => ({ a: 2, b: 0, c: 0, d: 4, e: 30, f: 10 }) } as unknown as SVGSVGElement;
    expect(clientToSvgCoordinates(svg, 230, 210)).toEqual({ x: 100, y: 50 });
  });

  it("does not return coordinates for an unavailable or singular transform", () => {
    expect(clientToSvgCoordinates({ getScreenCTM: () => null } as unknown as SVGSVGElement, 1, 1)).toBeNull();
    expect(clientToSvgCoordinates({ getScreenCTM: () => ({ a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 }) } as unknown as SVGSVGElement, 1, 1)).toBeNull();
  });
});
