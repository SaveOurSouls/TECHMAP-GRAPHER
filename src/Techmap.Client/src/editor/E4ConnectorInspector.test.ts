import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { E4ConnectorInspector } from "./E4ConnectorInspector";
import {
  builtInConnectorSeries,
  createBuiltInConnectorInstance,
} from "./connector-series-demo";

describe("E4 connector inline editing", () => {
  it("renders the series article selector in the side panel", () => {
    const connector = createBuiltInConnectorInstance("catalog-connector-series:xs-demo-series", {
      id: "xs1", designation: "XS1", e4Position: { x: 20, y: 30 },
    });
    const markup = renderToStaticMarkup(createElement(E4ConnectorInspector, {
      connector,
      series: builtInConnectorSeries[0],
      disabled: false,
      onCommand: vi.fn(),
    }));

    expect(markup).toContain("Артикул серии");
    expect(markup).toContain("XS-04");
    expect(markup).toContain("XS-10");
    expect(markup).toContain("Поля таблицы · скрыть / показать");
    expect(markup).not.toContain("Добавить строку контакта");
  });

  it("edits free rows on the object and offers terminals from the whole reference", () => {
    const connector = createBuiltInConnectorInstance("catalog-connector-free", {
      id: "free1", designation: "XS9", e4Position: { x: 20, y: 30 }, freeContactCount: 2,
    });
    const markup = renderToStaticMarkup(createElement(E4ConnectorInspector, {
      connector,
      terminalArticles: ["M39029/57-354", "TER-002"],
      disabled: false,
      onCommand: vi.fn(),
      mode: "canvas",
      editing: true,
    }));

    expect(markup).toContain("Поля соединителя XS9");
    expect(markup).toContain("Добавить строку");
    expect(markup).toContain("terminal-articles-free1");
    expect(markup).toContain("M39029/57-354");
    expect(markup).toContain("Скрыть поле");
    expect(markup).toContain("Редактирование включено. Escape — закончить");
    expect(markup).toContain("is-editing");
    expect(markup).toContain("e4cce-title-add");
    expect(markup).toMatch(/class="e4cce-title-add"[^>]*>⊕ Добавить строку/);
    expect(markup).not.toMatch(/class="e4cce-title-add"[^>]*disabled/);
    expect(markup).toContain("e4cce-footer-code");
    expect(markup).toContain("e4cce-footer-article");
    expect(markup).toContain('aria-label="Код свободного блока"');
    expect(markup).toContain('aria-label="Артикул свободного блока"');
    expect(markup).toContain("e4cce-wire-picker");
    expect(markup).toContain("XS9");
  });

  it("keeps add-row immediately available on a selected free block before field editing", () => {
    const connector = createBuiltInConnectorInstance("catalog-connector-free", {
      id: "free1", designation: "XS9", e4Position: { x: 20, y: 30 }, freeContactCount: 2,
    });
    const markup = renderToStaticMarkup(createElement(E4ConnectorInspector, {
      connector,
      disabled: false,
      onCommand: vi.fn(),
      mode: "canvas",
      editing: false,
    }));

    expect(markup).toMatch(/class="e4cce-title-add"[^>]*>⊕ Добавить строку/);
    expect(markup).not.toMatch(/class="e4cce-title-add"[^>]*disabled/);
  });

  it("locks series number and type rows and filters terminals by contact kind", () => {
    const connector = createBuiltInConnectorInstance("catalog-connector-series:xs-demo-series", {
      id: "xs1", designation: "XS1", e4Position: { x: 20, y: 30 },
    });
    const markup = renderToStaticMarkup(createElement(E4ConnectorInspector, {
      connector,
      series: builtInConnectorSeries[0],
      disabled: false,
      onCommand: vi.fn(),
      mode: "canvas",
    }));

    expect(markup).toContain("Двойной клик — редактировать");
    expect(markup).toContain("сигнальный");
    expect(markup).toContain("силовой");
    expect(markup).toContain("коаксиальный");
    expect(markup).toContain("Строки из артикула");
  });

  it("renders actual controls only after the canvas enters editing mode", () => {
    const connector = createBuiltInConnectorInstance("catalog-connector-series:xs-demo-series", {
      id: "xs1", designation: "XS1", e4Position: { x: 20, y: 30 },
    });
    const markup = renderToStaticMarkup(createElement(E4ConnectorInspector, {
      connector,
      series: builtInConnectorSeries[0],
      disabled: false,
      onCommand: vi.fn(),
      mode: "canvas",
      editing: true,
    }));

    expect(markup).toContain("is-editing");
    expect(markup).toContain("Редактирование включено. Escape — закончить");
    expect(markup).toContain('aria-label="Обозначение соединителя"');
    expect(markup).toContain("TERM-SIG-05");
    expect(markup).toContain("Номер и тип заданы артикулом серии");
    expect(markup).toContain("Основной цвет");
    expect(markup).toContain("Второй цвет");
    expect(markup).toContain("Пусто · одноцветный");
    expect(markup).toContain("Новый цвет");
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('class="e4cce-color-popover" hidden=""');
    expect(markup).toContain("e4cce-wire-picker");
  });
});
