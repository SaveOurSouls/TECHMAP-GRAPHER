import { describe, expect, it } from "vitest";
import { matchWireBlank, routeInheritedEndStyles, wireBlankEndStates } from "./route-wire-blank";
import type { ManufacturingRoute, RouteRow } from "./route-model";
import { createEmptyHarnessDesign } from "../editor/model";
import { createWire } from "../editor/commands";
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

const presentation = (styles?: { from: "cut" | "copper" | "tin" | "terminal" | "sealed" | "sealed-pin"; to: "cut" | "copper" | "tin" | "terminal" | "sealed" | "sealed-pin" }): RouteRow["presentation"] => ({
  backgroundOpacity: 1, objects: [], ...(styles ? { drawingCopy: { document: { ...createEmptyHarnessDesign(), wires: [{ ...createWire("w", { connectorId: "a", contactId: "1" }, { connectorId: "b", contactId: "1" }), drawingEndStyles: styles }] }, hiddenObjectIds: [] } } : {}),
});
const row = (id: string, dependsOn: string[], prepared: boolean, sourceObjects: readonly { kind: "wire"; id: string }[], extra: Partial<RouteRow> = {}): RouteRow => ({
  id, kind: "semiFinished", title: id, comment: "", sourceObjects, dependsOn, operations: [], prepared, presentation: presentation(), ...extra,
});
const source = { ...item, ref: { kind: "wire" as const, id: "w" } };

describe("inherited wire end styles", () => {
  it("prefers explicit drawing style over a pinned ancestor and auto mode", () => {
    const ancestor = row("ancestor", [], true, [{ kind: "wire", id: "w" }], { wireBlankSelections: [{ wireId: "w", binding: { sourceId: "technology-wire-blanks", entityType: "wire-blank", snapshotId: "11111111-1111-4111-8111-111111111111", snapshotSha256: "a".repeat(64), recordId: "b".repeat(64), sourceKey: "P", displayName: "P", visual: { start: "sealed", end: "sealed-pin", color: "#26609e", templateId: "x", photoDataUrl: null } } }] });
    const current = row("current", ["ancestor"], false, [{ kind: "wire", id: "w" }], { presentation: presentation({ from: "tin", to: "copper" }) });
    const resolved = routeInheritedEndStyles({ contractVersion: 1, source: { fingerprintVersion: 1, sha256: "c".repeat(64) }, status: "draft", rows: [ancestor, current] }, "current", [source]);
    expect(resolved.get("w")).toEqual({ from: "tin", to: "copper" });
  });

  it("uses the nearest prepared ancestor at a diamond and ignores unrelated rows", () => {
    const far = row("far", [], true, [{ kind: "wire", id: "w" }], { wireBlankSelections: [{ wireId: "w", binding: { sourceId: "technology-wire-blanks", entityType: "wire-blank", snapshotId: "11111111-1111-4111-8111-111111111111", snapshotSha256: "a".repeat(64), recordId: "b".repeat(64), sourceKey: "P", displayName: "P", visual: { start: "sealed", end: "sealed", color: "#26609e", templateId: "x", photoDataUrl: null } } }] });
    const near = row("near", ["far"], true, [{ kind: "wire", id: "w" }], { wireBlankSelections: [{ wireId: "w", binding: { ...far.wireBlankSelections![0]!.binding, visual: { ...far.wireBlankSelections![0]!.binding.visual, start: "copper", end: "tin" } } }] });
    const unrelated = row("unrelated", [], true, [{ kind: "wire", id: "w" }], { wireBlankSelections: [{ wireId: "w", binding: { ...far.wireBlankSelections![0]!.binding, visual: { ...far.wireBlankSelections![0]!.binding.visual, start: "cut", end: "cut" } } }] });
    const sibling = row("sibling", ["far"], true, []);
    const current = row("current", ["near", "sibling"], false, []);
    const route: ManufacturingRoute = { contractVersion: 1, source: { fingerprintVersion: 1, sha256: "c".repeat(64) }, status: "draft", rows: [far, sibling, near, unrelated, current] };
    expect(routeInheritedEndStyles(route, "current", [source]).get("w")).toEqual({ from: "copper", to: "tin" });
  });

  it("derives automatic modes from a prepared wire stage and excludes unfinished or foreign drawings", () => {
    const prepared = row("prepared", [], true, [{ kind: "wire", id: "w" }], { operations: [op("cut-crimp"), op("strip-to")] });
    const unfinished = row("unfinished", ["prepared"], false, [], { presentation: presentation({ from: "sealed", to: "sealed" }) });
    const foreign = row("foreign", [], true, [{ kind: "wire", id: "other" }], { presentation: presentation({ from: "tin", to: "tin" }) });
    const current = row("current", ["unfinished", "foreign"], false, [], { kind: "assembly" });
    const route: ManufacturingRoute = { contractVersion: 1, source: { fingerprintVersion: 1, sha256: "c".repeat(64) }, status: "draft", rows: [prepared, unfinished, foreign, current] };
    expect(routeInheritedEndStyles(route, "current", [source]).get("w")).toEqual({ from: "terminal", to: "copper" });
    expect(routeInheritedEndStyles(route, "missing", [source]).size).toBe(0);
  });

  it("uses current semi-finished pin before preparation without requiring a live catalog", () => {
    const current = row("current", [], false, [{ kind: "wire", id: "w" }], { operations: [op("cut")], wireBlankSelections: [{ wireId: "w", binding: { sourceId: "technology-wire-blanks", entityType: "wire-blank", snapshotId: "11111111-1111-4111-8111-111111111111", snapshotSha256: "a".repeat(64), recordId: "b".repeat(64), sourceKey: "CUSTOM", displayName: "Custom", visual: { start: "sealed-pin", end: "tin", color: "#26609e", templateId: "custom-image", photoDataUrl: null } } }] });
    const route: ManufacturingRoute = { contractVersion: 1, source: { fingerprintVersion: 1, sha256: "c".repeat(64) }, status: "draft", rows: [current] };
    expect(routeInheritedEndStyles(route, "current", [source])).toEqual(new Map([["w", { from: "sealed-pin", to: "tin" }]]));
  });
});
