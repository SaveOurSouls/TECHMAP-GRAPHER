import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { canLeaveProject, HarnessDocumentTabs, rememberHarnessTab } from "./App";
import { HarnessSectionNavigation, harnessSectionItems } from "./editor/HarnessSectionNavigation";
import type { HarnessSummary } from "./project-api";

const harness: HarnessSummary = {
  harnessId: "22345678-1234-4123-8123-123456789abc",
  designation: "ЖГ-01",
  quantity: 12,
  sortOrder: 0,
  documents: [
    { documentId: "42345678-1234-4123-8123-123456789abc", kind: "e4", status: "empty" },
    { documentId: "52345678-1234-4123-8123-123456789abc", kind: "drawing", status: "empty" },
    { documentId: "62345678-1234-4123-8123-123456789abc", kind: "route", status: "empty" },
  ],
  createdUtc: "2026-09-12T10:00:00Z",
  updatedUtc: "2026-09-12T10:00:00Z",
};

describe("harness workspace", () => {
  it("renders the three persisted tabs and two isolated test editors", () => {
    const markup = renderToStaticMarkup(createElement(HarnessDocumentTabs, {
      harness,
      activeTab: "drawing",
      onTabChange: vi.fn(),
    }));

    expect(markup).toContain("Схема Э4");
    expect(markup).toContain("Чертёж");
    expect(markup).toContain("Маршрут");
    expect(markup).toContain("Маршрут v2");
    expect(markup).toContain("Маршрут v3");
    expect(markup).toContain("UML");
    expect(markup).toContain("UML универсальный");
    expect(markup).toContain('role="group"');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain("Геометрия, размеры и технические требования");
    expect(markup).toContain("Открыть документ");
    expect(markup).toContain('class="harness-document-button active"');
    expect(markup).not.toContain(harness.documents[1]!.documentId);
  });

  it("remembers the active tab independently for each selected harness", () => {
    let state = rememberHarnessTab({}, "harness-a", "drawing");
    state = rememberHarnessTab(state, "harness-b", "route");
    state = rememberHarnessTab(state, "harness-a", "e4");

    expect(state).toEqual({ "harness-a": "e4", "harness-b": "route" });
  });

  it("renders the five-way editor navigation and project return", () => {
    const markup = renderToStaticMarkup(createElement(HarnessSectionNavigation, {
      active: "route-v2",
      onNavigate: vi.fn(),
      onHome: vi.fn(),
    }));

    expect(harnessSectionItems).toHaveLength(6);
    for (const item of harnessSectionItems) expect(markup).toContain(item.label);
    expect(markup).toContain("К проектам");
    expect(markup).toContain('aria-current="page"');
  });

  it("blocks project-menu return when the draft confirmation is declined", () => {
    const confirm = vi.fn(() => false);

    expect(canLeaveProject(true, confirm)).toBe(false);
    expect(confirm).toHaveBeenCalledOnce();
  });

  it("allows project-menu return after the draft confirmation", () => {
    const confirm = vi.fn(() => true);

    expect(canLeaveProject(true, confirm)).toBe(true);
    expect(confirm).toHaveBeenCalledOnce();
    expect(canLeaveProject(false, confirm)).toBe(true);
    expect(confirm).toHaveBeenCalledOnce();
  });
});
