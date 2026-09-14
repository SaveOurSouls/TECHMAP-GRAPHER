import { describe, expect, it } from "vitest";
import { addContactPointV2, newTemplateContentV2 } from "./template-commands-v2";
import { validateTemplateContentV3, type TemplateContentV3 } from "./template-model-v3";
import { upgradeTemplateContentV2ToV3 } from "./template-upgrade-v3";

function validDocument(): TemplateContentV3 {
  const v2 = newTemplateContentV2();
  const [withPoint] = addContactPointV2(v2, v2.views[0]!.id, { number: "1", name: "Сигнал", contactType: "signal" });
  const groupId = crypto.randomUUID(), parameterId = crypto.randomUUID();
  withPoint.parameters.push({ id: parameterId, name: "Ширина", type: "number", unit: "мм", defaultValue: 10, minimum: 1, maximum: 100, formula: null });
  const upgraded = upgradeTemplateContentV2ToV3(withPoint).content;
  upgraded.logicalContacts[0]!.contactTypeGroupId = upgraded.contactTypeGroups[0]!.id;
  upgraded.logicalContacts[0]!.circuitText = "POWER";
  upgraded.articleVariants.push({
    id: crypto.randomUUID(), sourceId: "db-connectors", entityType: "connector", articleKey: "A-01",
    parameterValues: [{ parameterId, value: 15 }],
    contactGroups: [
      {
        contactTypeGroupId: upgraded.contactTypeGroups[0]!.id,
        contactCount: 1,
        allowedTerminalArticleKeys: [],
      },
      {
        contactTypeGroupId: groupId,
        contactCount: 0,
        allowedTerminalArticleKeys: [{ sourceId: "db-terminals", entityType: "terminal", articleKey: "T-01" }],
      },
    ],
  });
  upgraded.contactTypeGroups.push({ id: groupId, name: "Силовой" });
  return upgraded;
}

const codes = (value: unknown) => validateTemplateContentV3(value).diagnostics.map(item => item.code);

describe("template content v3 validation", () => {
  it("accepts the strict contact groups and article-variant contract", () => {
    expect(validateTemplateContentV3(validDocument())).toEqual({ valid: true, diagnostics: [] });
  });

  it("requires exact root, contact, variant, group-row and article-key fields", () => {
    const document = validDocument() as TemplateContentV3 & { surprise?: boolean };
    document.surprise = true;
    expect(codes(document)).toContain("unexpected_key");

    const contact = structuredClone(validDocument()) as unknown as { logicalContacts: Array<Record<string, unknown>> };
    delete contact.logicalContacts[0]!.circuitText;
    expect(codes(contact)).toContain("missing_key");

    const terminal = structuredClone(validDocument()) as unknown as { articleVariants: Array<{ contactGroups: Array<{ allowedTerminalArticleKeys: Array<Record<string, unknown>> }> }> };
    terminal.articleVariants[0]!.contactGroups[1]!.allowedTerminalArticleKeys[0]!.label = "extra";
    expect(codes(terminal)).toContain("unexpected_key");
  });

  it("rejects missing group references and duplicate names case-insensitively", () => {
    const document = validDocument();
    document.contactTypeGroups.push({ id: crypto.randomUUID(), name: document.contactTypeGroups[0]!.name.toUpperCase() });
    document.logicalContacts[0]!.contactTypeGroupId = crypto.randomUUID();

    expect(codes(document)).toEqual(expect.arrayContaining([
      "duplicate_contact_type_group_name",
      "missing_contact_type_group",
    ]));
  });

  it("rejects duplicate article identities and terminal keys", () => {
    const document = validDocument();
    document.articleVariants.push({ ...structuredClone(document.articleVariants[0]!), id: crypto.randomUUID() });
    document.articleVariants[0]!.contactGroups![1]!.allowedTerminalArticleKeys.push(
      { ...document.articleVariants[0]!.contactGroups![1]!.allowedTerminalArticleKeys[0]! },
    );

    expect(codes(document)).toEqual(expect.arrayContaining([
      "duplicate_article_variant",
      "duplicate_terminal_article",
    ]));
  });

  it("rejects parameter references through the projected v2 core with a v3 path", () => {
    const document = validDocument();
    document.articleVariants[0]!.parameterValues[0]!.parameterId = crypto.randomUUID();
    const validation = validateTemplateContentV3(document);

    expect(validation.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({
      code: "missing_parameter",
      path: "$.articleVariants[0].parameterValues[0].parameterId",
    })]));
  });

  it("does not mutate input while projecting unchanged geometry to v2", () => {
    const document = validDocument(), before = structuredClone(document);
    validateTemplateContentV3(document);
    expect(document).toEqual(before);
  });

  it("accepts null contact configuration and rejects control characters in circuit text", () => {
    const document = validDocument();
    document.articleVariants[0]!.contactGroups = null;
    expect(validateTemplateContentV3(document).valid).toBe(true);

    document.logicalContacts[0]!.circuitText = "POWER\u007f";
    expect(codes(document)).toContain("invalid_optional_text");
  });

  it("keeps the inherited geometry boundary strict", () => {
    const document = validDocument() as unknown as { views: Array<{ bundlePorts: Array<Record<string, unknown>> }> };
    document.views[0]!.bundlePorts.push({
      id: crypto.randomUUID(), name: "Пучок", x: { kind: "constant", value: 1 },
      y: { kind: "constant", value: 2 }, direction: "left", logicalContactId: crypto.randomUUID(),
    });

    expect(validateTemplateContentV3(document).diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({
      code: "unexpected_key", path: "$.views[0].bundlePorts[0].logicalContactId",
    })]));
  });

  it("rejects a contact type group ID colliding with a geometry ID", () => {
    const document = validDocument();
    document.contactTypeGroups.push({ id: document.views[0]!.id, name: "Duplicate ID" });

    expect(validateTemplateContentV3(document).diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({
      code: "duplicate_id", path: "$.contactTypeGroups[2].id",
    })]));
  });

  it("rejects fractional counts and duplicate group rows", () => {
    const document = validDocument();
    document.articleVariants[0]!.contactGroups![0]!.contactCount = 1.5;
    document.articleVariants[0]!.contactGroups!.push(structuredClone(document.articleVariants[0]!.contactGroups![0]!));

    expect(codes(document)).toEqual(expect.arrayContaining(["invalid_contact_count", "duplicate_variant_contact_group"]));
  });
});
