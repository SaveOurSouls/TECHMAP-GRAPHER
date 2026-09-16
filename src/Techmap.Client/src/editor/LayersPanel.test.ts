import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LayersPanel } from "./LayersPanel";

describe("layers panel", () => {
  it("offers an explicit hide or show action for every layer", () => {
    const markup = renderToStaticMarkup(createElement(LayersPanel, {
      layers: [
        { id: "visible", label: "Провода", visible: true, locked: false },
        { id: "hidden", label: "Размеры", visible: false, locked: false },
      ],
      onVisibilityToggle: vi.fn(),
      onLockToggle: vi.fn(),
      onMove: vi.fn(),
    }));

    expect(markup).toContain('aria-label="Скрыть слой Провода"');
    expect(markup).toContain('aria-label="Показать слой Размеры"');
    expect(markup).toContain("Скрыть");
    expect(markup).toContain("Показать");
    expect(markup).toContain('class="he-layer-row is-hidden"');
  });
});
