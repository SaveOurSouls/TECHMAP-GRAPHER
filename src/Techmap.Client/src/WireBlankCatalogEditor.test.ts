import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WireBlankPreview } from "./WireBlankCatalogEditor";
import { wireBlankEnds, type WireBlank } from "./WireBlankCatalog";

const row: WireBlank = {
  id: "sample", index: "ПФП-01", title: "Образец", color: "#26609e",
  start: "cut", end: "cut", templateId: "01-cut", photoDataUrl: null, originalPayload: {},
};

describe("wire blank preview", () => {
  it("draws both selected end treatments as inline SVG", () => {
    const cut = renderToStaticMarkup(createElement(WireBlankPreview, { row }));
    expect(cut).not.toContain("<image");
    for (const end of wireBlankEnds) {
      if (end === "cut") continue;
      const left = renderToStaticMarkup(createElement(WireBlankPreview, { row: { ...row, start: end } }));
      const right = renderToStaticMarkup(createElement(WireBlankPreview, { row: { ...row, end } }));
      expect(left).not.toBe(cut);
      expect(right).not.toBe(cut);
      expect(left).toContain("<g aria-label=");
      expect(right).toContain('transform="translate(1200 0) scale(-1 1)"');
      expect(left).not.toContain("<image");
    }
  });

  it("uses per-card gradient IDs and switches to the uploaded photo", () => {
    const markup = renderToStaticMarkup(createElement(WireBlankPreview, { row: { ...row, start: "sealed", end: "tin" } }));
    expect(markup).toMatch(/fill="url\(#([^)]*)-seal\)"/);
    expect(markup).toMatch(/fill="url\(#([^)]*)-tin\)"/);
    expect(renderToStaticMarkup(createElement(WireBlankPreview, { row: { ...row, photoDataUrl: "data:image/png;base64,AAAA" } })))
      .toContain('<img class="wire-blank-preview" src="data:image/png;base64,AAAA"');
  });
});


