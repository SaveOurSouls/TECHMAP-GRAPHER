import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppNavigation } from "../App";
import { parseRuntimeConfig } from "../runtime-config";
import { ComponentLibrary, isTemplateUndoShortcut } from "./ComponentLibrary";

const config = parseRuntimeConfig({ configVersion: 1, basePath: "/", apiBasePath: "/api/v1/", appVersion: "1", apiVersion: "1", schemaVersion: "7" });
const session = { csrfNonce: "A".repeat(43), instanceId: "12345678-1234-4123-8123-123456789abc" };

describe("component library UI", () => {
  it("connects Ctrl+Z and Cmd+Z to template undo", () => {
    expect(isTemplateUndoShortcut({ ctrlKey: true, metaKey: false, key: "z" })).toBe(true);
    expect(isTemplateUndoShortcut({ ctrlKey: false, metaKey: true, key: "Z" })).toBe(true);
    expect(isTemplateUndoShortcut({ ctrlKey: false, metaKey: false, key: "z" })).toBe(false);
  });
  it("exposes the library as a primary application section", () => {
    const markup = renderToStaticMarkup(createElement(AppNavigation, { activeSection: "library", onSectionChange: () => undefined }));
    expect(markup).toContain("Библиотека");
    expect(markup).toContain('aria-current="page"');
  });

  it("renders view tabs, primitive tools and versioned save action", () => {
    const markup = renderToStaticMarkup(createElement(ComponentLibrary, { config, session }));
    expect(markup).toContain("ГРАФИЧЕСКИЕ ШАБЛОНЫ");
    expect(markup).toContain("Схема Э4");
    expect(markup).toContain("Чертёж");
    expect(markup).toContain("Прямоугольник");
    expect(markup).toContain("Эллипс");
    expect(markup).toContain("Точка контакта");
    expect(markup).toContain("Отменить");
    expect(markup).toContain("Связи с артикулами");
    expect(markup).toContain("Изображения");
    expect(markup).toContain("Загрузить PNG");
    expect(markup).toContain("Сохранить");
  });
});
