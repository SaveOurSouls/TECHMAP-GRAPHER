import { describe, expect, it } from "vitest";
import {
  ComponentTemplateContentError,
  isTemplateContentV1,
  isTemplateContentV2,
  parseComponentTemplateContent,
  reconcileTemplateEnvelopeAssets,
  upgradeComponentTemplateContentV1,
} from "./template-content";
import { newTemplateContent, type TemplateContent } from "./template-model";

describe("component template content boundary", () => {
  it("keeps schema v1 unchanged until an explicit upgrade is requested", () => {
    const v1 = newTemplateContent();
    const before = JSON.stringify(v1);

    const parsed = parseComponentTemplateContent(v1);

    expect(isTemplateContentV1(parsed)).toBe(true);
    expect(parsed.schemaVersion).toBe(1);
    expect(JSON.stringify(parsed)).toBe(before);
  });

  it("parses an explicitly upgraded schema v2 without rewriting it", () => {
    const upgraded = upgradeComponentTemplateContentV1(newTemplateContent());
    expect(upgraded.content.schemaVersion).toBe(2);

    const parsed = parseComponentTemplateContent(upgraded.content);

    expect(isTemplateContentV2(parsed)).toBe(true);
    expect(parsed).toBe(upgraded.content);
  });

  it("returns inferred cross-view contact diagnostics from the explicit upgrade", () => {
    const contactIds = [crypto.randomUUID(), crypto.randomUUID()];
    const content: TemplateContent = {
      schemaVersion: 1,
      views: [
        {
          id: crypto.randomUUID(), kind: "e4", name: "E4", primitives: [],
          contactPoints: [{ id: contactIds[0]!, name: "Signal", contactNumber: "1", direction: "right", x: 10, y: 20 }],
        },
        {
          id: crypto.randomUUID(), kind: "drawing", name: "Drawing", primitives: [],
          contactPoints: [{ id: contactIds[1]!, name: "Signal", contactNumber: "1", direction: "left", x: 30, y: 40 }],
        },
      ],
    };

    const result = upgradeComponentTemplateContentV1(content);

    expect(result.diagnostics.map(item => item.code)).toEqual(["logical_contact_mapping_inferred"]);
    expect(result.content.views[0]!.contactPoints[0]!.logicalContactId)
      .toBe(result.content.views[1]!.contactPoints[0]!.logicalContactId);
  });

  it("rejects invalid v2 content with addressable diagnostics", () => {
    const invalid = { schemaVersion: 2, views: [] };

    expect(() => parseComponentTemplateContent(invalid)).toThrow(ComponentTemplateContentError);
    try {
      parseComponentTemplateContent(invalid);
    } catch (error) {
      expect(error).toBeInstanceOf(ComponentTemplateContentError);
      expect((error as ComponentTemplateContentError).diagnostics.length).toBeGreaterThan(0);
    }
  });

  it("requires exact v2 asset metadata equality with the version envelope", () => {
    const asset = {
      assetId: crypto.randomUUID(), fileName: "connector.png", mediaType: "image/png",
      sha256: "a".repeat(64), sizeBytes: 128,
    };
    const content = upgradeComponentTemplateContentV1(newTemplateContent(), [asset]).content;

    expect(reconcileTemplateEnvelopeAssets(content, [asset]).diagnostics).toEqual([]);
    expect(reconcileTemplateEnvelopeAssets(content, [{ ...asset, sizeBytes: 129 }]).diagnostics)
      .toEqual([expect.objectContaining({ code: "asset_envelope_mismatch", path: "$.assets" })]);
    expect(reconcileTemplateEnvelopeAssets({ ...content, assets: [] }, [asset]).diagnostics)
      .toEqual([expect.objectContaining({ code: "asset_envelope_mismatch" })]);
  });

  it("copies normalized envelope asset metadata only during an explicit v1 upgrade", () => {
    const assets = [{
      assetId: crypto.randomUUID(), fileName: "connector.png", mediaType: "image/png",
      sha256: "b".repeat(64), sizeBytes: 256,
    }];
    const v1 = newTemplateContent();

    expect(parseComponentTemplateContent(v1).schemaVersion).toBe(1);
    expect(upgradeComponentTemplateContentV1(v1, assets).content.assets).toEqual(assets);
  });
});
