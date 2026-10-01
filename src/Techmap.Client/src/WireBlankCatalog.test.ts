import { describe, expect, it } from "vitest";
import { wireBlankDraft, wireBlankRequest, wireBlankTemplateForEnd, wireBlankTemplateUrl } from "./WireBlankCatalog";
import type { ReferenceCatalogSnapshot } from "./reference-catalog-api";

const snapshot: ReferenceCatalogSnapshot = {
  snapshotId: "11111111-1111-4111-8111-111111111111", sourceId: "technology-wire-blanks",
  contractVersion: 1, capturedUtc: "2026-10-01T00:00:00Z", sourceKind: "editable-table",
  versionFingerprint: "seed", sourceUri: null, sha256: "a".repeat(64), diagnostics: [],
  records: [{ recordId: "b".repeat(64), entityType: "wire-blank", sourceKey: "ПФП-01-CUT",
    sourceLocation: null, payload: { index: "ПФП-01-CUT", title: "Провод нарезан", color: "#26609e",
      start: "cut", end: "cut", templateId: "01-cut", extra: 42 } }],
};

describe("wire semi-finished product catalog", () => {
  it("loads the drawing set and preserves extra payload on save", () => {
    const rows = wireBlankDraft(snapshot);
    expect(rows).toHaveLength(1);
    expect(wireBlankTemplateUrl(rows[0]!.templateId)).toContain("01-cut.svg");
    const request = wireBlankRequest([{ ...rows[0]!, title: "Провод синий", start: "tin", end: "sealed-pin" }], snapshot);
    expect(request.records[0]).toMatchObject({ sourceKey: "ПФП-01-CUT", payload: {
      title: "Провод синий", start: "tin", end: "sealed-pin", extra: 42,
    } });
    expect(wireBlankTemplateForEnd("sealed-pin", "right")).toBe("08-seal-both-mixed");
  });

  it("rejects duplicate names and indices before publication", () => {
    const first = wireBlankDraft(snapshot)[0]!;
    const second = { ...first, id: "second", index: "ПФП-02", title: first.title };
    expect(() => wireBlankRequest([first, second], snapshot)).toThrow(/Название.*повторяется/);
    expect(() => wireBlankRequest([first, { ...second, index: first.index, title: "Иное" }], snapshot)).toThrow(/Индекс.*повторяется/);
  });

  it("keeps uploaded PNG photo in the snapshot and validates its size", () => {
    const row = wireBlankDraft(snapshot)[0]!;
    expect(wireBlankRequest([{ ...row, photoDataUrl: "data:image/png;base64,iVBORw0KGgo=" }], snapshot).records[0]?.payload)
      .toMatchObject({ photoDataUrl: "data:image/png;base64,iVBORw0KGgo=" });
    expect(() => wireBlankRequest([{ ...row, photoDataUrl: "data:text/html;base64,AAAA" }], snapshot)).toThrow(/Фото/);
  });
});
