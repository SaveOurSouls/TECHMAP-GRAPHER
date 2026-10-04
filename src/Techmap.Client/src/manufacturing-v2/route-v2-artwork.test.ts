import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RouteV2SourceArtwork } from "./RouteV2Artwork";
import type { HarnessDesignDocument } from "../editor/model";

const document = (extra: Partial<HarnessDesignDocument> = {}) => ({ manufacturingRoute: undefined, physicalTopology: { coverings: [{ id: "cover", name: "Оплётка", color: "#445566", style: undefined, kind: undefined, lengthMm: 200 }] }, ...extra } as unknown as HarnessDesignDocument);

describe("RouteV2SourceArtwork", () => {
  it("uses the production wire blank renderer and preserves selected end treatment", () => {
    const wireDoc = document({ manufacturingRoute: { rows: [{ wireBlankSelections: [{ wireId: "wire", binding: { recordId: "r", sourceKey: "PF-1", displayName: "Зачистка", visual: { start: "copper", end: "tin", color: "#123456", templateId: "01-cut", photoDataUrl: null } } }] }] } } as never);
    const wireItem = { ref: { kind: "wire" as const, id: "wire" }, title: "Провод", lengthMm: 10, color: "#123456", material: "", materialArticle: "", section: "", terminalFrom: "", terminalTo: "" };
    const markup = renderToStaticMarkup(createElement(RouteV2SourceArtwork, { document: wireDoc, ref: wireItem.ref, item: wireItem }));
    expect(markup).toContain("data:image/svg+xml");
    expect(markup).toContain("Зачистка");
  });
  it("uses the standalone covering artwork renderer", () => {
    const markup = renderToStaticMarkup(createElement(RouteV2SourceArtwork, { document: document(), ref: { kind: "covering", id: "cover" }, item: { ref: { kind: "covering", id: "cover" }, title: "Оплётка", lengthMm: 200, color: "#445566", material: "", materialArticle: "", section: "", terminalFrom: "", terminalTo: "" } }));
    expect(markup).toContain("route-covering-artwork");
    expect(markup).toContain("Оплётка");
  });
});
