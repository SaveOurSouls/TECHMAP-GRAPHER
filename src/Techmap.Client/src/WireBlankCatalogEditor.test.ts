import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WireBlankPreview } from "./WireBlankCatalogEditor";
import { wireBlankEnds, type WireBlank } from "./WireBlankCatalog";

const row: WireBlank = {
  id: "sample", index: "ПФП-01", title: "Образец", color: "#26609e",
  start: "cut", end: "cut", templateId: "01-cut", photoDataUrl: null, originalPayload: {},
};

function artwork(sample: WireBlank): string {
  const markup = renderToStaticMarkup(createElement(WireBlankPreview, { row: sample }));
  const encoded = markup.match(/src="data:image\/svg\+xml;charset=utf-8,([^"]+)"/)?.[1];
  expect(encoded).toBeTruthy();
  return decodeURIComponent(encoded!);
}

describe("wire blank preview", () => {
  it("assembles each selected end from the canonical artwork on both sides", () => {
    const cut = artwork(row);
    expect(cut).toContain('data-part="cut"');
    for (const end of wireBlankEnds) {
      const left = artwork({ ...row, start: end });
      const right = artwork({ ...row, end });
      expect(left).toContain(`data-part="${end === "sealed-pin" ? "sealed-pin-terminal" : end === "sealed" ? "seal" : end}"`);
      expect(right).toContain('transform="translate(1200 0) scale(-1 1)"');
      expect(right).toContain(`data-part="${end === "sealed-pin" ? "sealed-pin-terminal" : end === "sealed" ? "seal" : end}"`);
      if (end !== "cut") { expect(left).not.toBe(cut); expect(right).not.toBe(cut); }
    }
  });

  it("changes jacket color without recoloring copper or tin, and retains uploaded photo", () => {
    const colored = artwork({ ...row, color: "#ff6600", start: "sealed", end: "tin" });
    expect(colored).toContain("--wire-color:#ff6600");
    expect(colored).toContain('data-part="seal"');
    expect(colored).toContain('data-part="tin"');
    expect(colored).toContain("#874721");
    expect(renderToStaticMarkup(createElement(WireBlankPreview, { row: { ...row, photoDataUrl: "data:image/png;base64,AAAA" } })))
      .toContain('<img class="wire-blank-preview" src="data:image/png;base64,AAAA"');
  });

  it("shares the C1 side profile and preserves jacket/seal/metal overlap", () => {
    const sealed = artwork({ ...row, start: "sealed", end: "sealed-pin" });
    expect(sealed).toContain('data-profile="three-rib-seal"');
    expect(sealed).toContain('data-profile="socket-contact"');
    expect(sealed).toContain('data-profile="pin-contact"');
    const jacket = sealed.indexOf('data-part="terminal-insulation"');
    const seal = sealed.indexOf('data-part="seal"');
    const metal = sealed.indexOf('data-part="terminal-shell"');
    expect(sealed.indexOf('data-part="crimp-strands"')).toBeLessThan(jacket);
    expect(jacket).toBeLessThan(seal);
    expect(seal).toBeLessThan(metal);
    expect(sealed).toContain('data-view="side"');
  });

  it("masks copper beneath the jacket cut on both sides of every terminal style", () => {
    for (const end of ["terminal", "sealed", "sealed-pin"] as const) {
      const svg = artwork({ ...row, start: end, end });
      const groups = svg.split('data-view="side"').slice(1);
      expect(groups).toHaveLength(2);
      for (const side of groups) {
        expect(side.indexOf('data-part="crimp-strands"')).toBeLessThan(side.indexOf('data-part="terminal-insulation"'));
        expect(side.indexOf('data-part="terminal-insulation"')).toBeLessThan(side.indexOf('data-part="terminal-shell"'));
      }
    }
  });
});
