import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { HarnessDocumentTabs, rememberHarnessTab } from "./App";
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
  it("renders three harness-scoped tabs and opens the selected editor", () => {
    const markup = renderToStaticMarkup(createElement(HarnessDocumentTabs, {
      harness,
      activeTab: "drawing",
      onTabChange: vi.fn(),
    }));

    expect(markup).toContain("Схема Э4");
    expect(markup).toContain("Чертёж");
    expect(markup).toContain("Маршрут");
    expect(markup).toContain('role="tab"');
    expect(markup).toContain('aria-selected="true"');
    expect(markup).toContain("Геометрия, размеры и технические требования");
    expect(markup).toContain("Открыть чертёж");
    expect(markup).not.toContain(harness.documents[1]!.documentId);
  });

  it("remembers the active tab independently for each selected harness", () => {
    let state = rememberHarnessTab({}, "harness-a", "drawing");
    state = rememberHarnessTab(state, "harness-b", "route");
    state = rememberHarnessTab(state, "harness-a", "e4");

    expect(state).toEqual({ "harness-a": "e4", "harness-b": "route" });
  });
});
