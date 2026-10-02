import { describe, expect, it } from "vitest";
import { matchWireBlank, wireBlankEndStates } from "./route-wire-blank";
import type { RouteSourceItem } from "./route-source";
import type { ReferenceCatalogSnapshot } from "../reference-catalog-api";

const item: RouteSourceItem = { ref: { kind: "wire", id: "w" }, title: "XS1 → XS2", lengthMm: null, color: null, material: "", materialArticle: "", section: "", terminalFrom: "T-1", terminalTo: "", stripProfiles: undefined };
const op = (mode: "cut" | "cut-crimp" | "strip-to") => ({ id: mode, binding: null, note: "", mode });
const snapshot = { records: [{ recordId: "a".repeat(64), entityType: "wire-blank", sourceKey: "ПФП-04", payload: { index: "ПФП-04", title: "Наконечник и медь", start: "terminal", end: "copper", templateId: "04-crimp-copper", color: "#26609e" } }] } as unknown as ReferenceCatalogSnapshot;

describe("wire blank selection", () => {
  it("matches only the actual end treatment and never infers a sealed terminal", () => {
    expect(wireBlankEndStates(item, [op("cut-crimp"), op("strip-to")])).toEqual({ start: "terminal", end: "copper" });
    expect(matchWireBlank(snapshot, item, [op("cut-crimp"), op("strip-to")]).entry?.index).toBe("ПФП-04");
    expect(matchWireBlank(snapshot, item, [op("cut")]).reason).toBe("missing");
  });

  it("does not choose an arbitrary entry when two catalog records match", () => {
    const duplicate = { ...snapshot, records: [...snapshot.records, { ...snapshot.records[0]!, recordId: "b".repeat(64), sourceKey: "ПФП-04B" }] };
    expect(matchWireBlank(duplicate, item, [op("cut-crimp"), op("strip-to")]).reason).toBe("ambiguous");
    expect(matchWireBlank(duplicate, item, [op("cut-crimp"), op("strip-to")]).entry).toBeNull();
  });
});
