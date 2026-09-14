import { describe, expect, it } from "vitest";
import {
  ComponentTemplateContentError,
  isTemplateContentV1,
  isTemplateContentV2,
  parseComponentTemplateContent,
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
});
