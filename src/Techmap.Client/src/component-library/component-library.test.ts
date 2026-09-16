import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppNavigation } from "../App";
import { parseRuntimeConfig } from "../runtime-config";
import { addLegacyArticleBindingsToV3, articleBindingsFromTemplateV3, ComponentLibrary, connectorArticleInputs, connectorArticleSearchRequest, createTemplateImageNodeV2, isTemplateAssetReferencedV2, isTemplateUndoShortcut } from "./ComponentLibrary";
import { addNodeV2, newTemplateContentV2 } from "./template-commands-v2";
import { validateTemplateContentV2 } from "./template-model-v2";
import { newTemplateContentV3, upsertArticleVariantV3 } from "./template-commands-v3";

const config = parseRuntimeConfig({ configVersion: 1, basePath: "/", apiBasePath: "/api/v1/", appVersion: "1", apiVersion: "1", schemaVersion: "7" });
const session = { csrfNonce: "A".repeat(43), instanceId: "12345678-1234-4123-8123-123456789abc" };

describe("component library UI", () => {
  it("builds active connector lookup requests and maps unique connector records", () => {
    expect(connectorArticleSearchRequest("  XH  ")).toMatchObject({
      text: "XH", entityTypes: ["connector"], sort: "relevance", pageSize: 30, cursor: null,
    });
    const record = (entityType: string, sourceKey: string) => ({
      recordId: crypto.randomUUID(), entityType, sourceKey, payload: {}, sourceLocation: null,
    });
    expect(connectorArticleInputs([
      record("connector", " B2B-XH-A "),
      record("connector", "B2B-XH-A"),
      record("terminal", "SXH-001T-P0.6"),
      record("connector", "B10B-XH-A"),
    ])).toEqual([
      { sourceId: "technology-connectors", entityType: "connector", articleKey: "B2B-XH-A" },
      { sourceId: "technology-connectors", entityType: "connector", articleKey: "B10B-XH-A" },
    ]);
  });
  it("connects Ctrl+Z and Cmd+Z to template undo", () => {
    expect(isTemplateUndoShortcut({ ctrlKey: true, metaKey: false, key: "z" })).toBe(true);
    expect(isTemplateUndoShortcut({ ctrlKey: false, metaKey: true, key: "Z" })).toBe(true);
    expect(isTemplateUndoShortcut({ ctrlKey: false, metaKey: false, key: "z" })).toBe(false);
    expect(isTemplateUndoShortcut({ ctrlKey: true, metaKey: false, key: "z", target: { tagName: "INPUT" } as unknown as EventTarget })).toBe(false);
    expect(isTemplateUndoShortcut({ ctrlKey: true, metaKey: false, key: "z", target: { tagName: "textarea" } as unknown as EventTarget })).toBe(false);
    expect(isTemplateUndoShortcut({ ctrlKey: true, metaKey: false, key: "z", target: { isContentEditable: true } as unknown as EventTarget })).toBe(false);
  });
  it("exposes the library as a primary application section", () => {
    const markup = renderToStaticMarkup(createElement(AppNavigation, { activeSection: "library", onSectionChange: () => undefined }));
    expect(markup).toContain("Библиотека");
    expect(markup).toContain('aria-current="page"');
  });

  it("renders view tabs, primitive tools and versioned save action", () => {
    const markup = renderToStaticMarkup(createElement(ComponentLibrary, { config, session }));
    expect(markup).toContain("БИБЛИОТЕКА СОЕДИНИТЕЛЕЙ");
    expect(markup).toContain("Схема Э4");
    expect(markup).toContain("Чертёж");
    expect(markup).toContain("Прямоугольник");
    expect(markup).toContain("Эллипс");
    expect(markup).toContain("Создать контакт");
    expect(markup).toContain("Разместить связанную точку");
    expect(markup).toContain("Выход пучка");
    expect(markup).toContain('role="tabpanel"');
    expect(markup).toContain("Отменить");
    expect(markup).toContain("Серия и артикулы");
    expect(markup).toContain("Типы контактов");
    expect(markup).toContain("Артикул для предпросмотра");
    expect(markup).toContain("БИБЛИОТЕКА СОЕДИНИТЕЛЕЙ");
    expect(markup).toContain("Изображения");
    expect(markup).toContain("Загрузить PNG");
    expect(markup).toContain("Добавить слой");
    expect(markup).toContain("Сохранить");
  });

  it("uses v3 article variants as the saved lookup index and imports legacy bindings once", () => {
    const legacy = [
      { sourceId: "db", entityType: "connector", articleKey: "A-01" },
      { sourceId: "db", entityType: "connector", articleKey: "A-02" },
    ];
    let content = addLegacyArticleBindingsToV3(newTemplateContentV3(), legacy);
    content = addLegacyArticleBindingsToV3(content, legacy);
    [content] = upsertArticleVariantV3(content, {
      id: content.articleVariants[0]!.id,
      sourceId: "db",
      entityType: "connector",
      articleKey: "A-01-RENAMED",
    });

    expect(content.articleVariants).toHaveLength(2);
    expect(articleBindingsFromTemplateV3(content)).toEqual([
      { sourceId: "db", entityType: "connector", articleKey: "A-01-RENAMED" },
      { sourceId: "db", entityType: "connector", articleKey: "A-02" },
    ]);
  });

  it("creates a valid underlay image and detects its references", () => {
    const content = newTemplateContentV2();
    const view = content.views[0]!;
    const layer = view.layers[0]!;
    const assetId = crypto.randomUUID();
    const node = createTemplateImageNodeV2(assetId, layer.id);
    const withAsset = { ...content, assets: [{ assetId, fileName: "reference.png", mediaType: "image/png", sha256: "a".repeat(64), sizeBytes: 512 }] };
    const placed = addNodeV2(withAsset, view.id, layer.id, node, 0);

    expect(node.geometry).toMatchObject({ assetId, cropX: 0, cropY: 0, cropWidth: 1, cropHeight: 1, underlay: true });
    expect(node.opacity).toBe(1);
    expect(placed.views[0]!.layers[0]!.nodes[0]).toBe(node);
    expect(isTemplateAssetReferencedV2(withAsset, assetId)).toBe(false);
    expect(isTemplateAssetReferencedV2(placed, assetId)).toBe(true);
    expect(validateTemplateContentV2(placed)).toEqual({ valid: true, diagnostics: [] });
  });
});
