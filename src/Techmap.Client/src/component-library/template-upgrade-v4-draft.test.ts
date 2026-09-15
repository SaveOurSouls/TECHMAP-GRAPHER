import { describe, expect, it } from "vitest";
import {
  addArticleVariantsV3,
  addContactPointV3,
  addContactTypeGroupV3,
  newTemplateContentV3,
  setArticleVariantContactGroupV3,
} from "./template-commands-v3";
import {
  upgradeTemplateContentV3ToV4Draft,
  validateTemplateContentV4Draft,
} from "./template-upgrade-v4-draft";

describe("template v4 draft migration", () => {
  it("keeps the v3 core and adds a valid E4 table snapshot", () => {
    let content = newTemplateContentV3();
    let groupId: string;
    [content, groupId] = addContactTypeGroupV3(content, "Сигнальные");
    [content] = addContactPointV3(content, content.views[0]!.id, {
      number: "1", name: "DATA", contactTypeGroupId: groupId,
    });
    content = addArticleVariantsV3(content, [
      { sourceId: "БД.СОЕД", entityType: "connector", articleKey: "PHR-01" },
    ]);
    content = setArticleVariantContactGroupV3(content, content.articleVariants[0]!.id, groupId, 1, []);
    const before = structuredClone(content);

    const upgraded = upgradeTemplateContentV3ToV4Draft(content);

    expect(content).toEqual(before);
    expect(upgraded.schemaVersion).toBe(4);
    expect(upgraded.logicalContacts).toEqual(content.logicalContacts);
    expect(upgraded.e4ConnectorTable.articles[0]!.articleKey).toBe("PHR-01");
    expect(validateTemplateContentV4Draft(upgraded)).toEqual({ valid: true, diagnostics: [] });
  });
});
