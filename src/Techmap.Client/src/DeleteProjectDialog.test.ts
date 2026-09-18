import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DeleteProjectDialog } from "./DeleteProjectDialog";
import type { ProjectDetails } from "./project-api";

describe("project deletion confirmation", () => {
  it("names the target and never deletes just by opening the confirmation", () => {
    const onConfirm = vi.fn();
    const markup = renderToStaticMarkup(createElement(DeleteProjectDialog, {
      project: { designation: "TEST-ONLY", name: "Test project", harnesses: [{}, {}] } as unknown as ProjectDetails,
      busy: false, error: null, onCancel: vi.fn(), onConfirm,
    }));
    expect(markup).toContain("TEST-ONLY");
    expect(markup).toContain("Test project");
    expect(markup).toContain("жгуты (2)");
    expect(markup).toContain("Отмена");
    expect(markup).toContain('role="tooltip"');
    expect(markup).toContain('autofocus=""');
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("disables both actions during deletion and leaves API errors inside the dialog", () => {
    const markup = renderToStaticMarkup(createElement(DeleteProjectDialog, {
      project: { designation: "TEST", name: "Test", harnesses: [] } as unknown as ProjectDetails,
      busy: true, error: "Конфликт ревизии", onCancel: vi.fn(), onConfirm: vi.fn(),
    }));
    expect(markup).toMatch(/disabled=""[^>]*>Отмена/);
    expect(markup).toMatch(/disabled=""[^>]*>Удаление…/);
    expect(markup).toContain('role="alert">Конфликт ревизии');
  });
});
