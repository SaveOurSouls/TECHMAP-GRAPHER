import { describe, expect, it } from "vitest";
import type { Draft } from "./ComponentLibrary";
import { newTemplateContentV3 } from "./template-commands-v3";
import { createE4ConnectorSeriesTableFromV3 } from "./e4-connector-series-table";
import { libraryRecoveryKey, readLibraryDraftRecovery, removeLibraryDraftRecovery, writeLibraryDraftRecovery } from "./library-draft-recovery";

function draft(): Draft {
  const content = newTemplateContentV3();
  return { templateId: null, version: 0, draftRevision: 0, code: "", name: "Незавершённая серия", assets: [], content, compatibleTerminalArticleKeys: [], terminalContactTypeBindings: [], e4ConnectorTable: createE4ConnectorSeriesTableFromV3(content) };
}
function storage() {
  const items = new Map<string, string>();
  return { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => { items.set(key, value); }, removeItem: (key: string) => { items.delete(key); } };
}

describe("library recovery", () => {
  it("restores incomplete raw editor state before the first server save", () => {
    const store = storage(), value = draft();
    expect(writeLibraryDraftRecovery(store, value, true)).toBe(true);
    expect(readLibraryDraftRecovery(store)).toMatchObject({ version: 1, dirty: true, draft: value });
  });
  it("retains base version and draft revision without upgrading a conflicting local copy", () => {
    const store = storage(), value = { ...draft(), templateId: crypto.randomUUID(), version: 5, draftRevision: 7 };
    writeLibraryDraftRecovery(store, value, true);
    expect(readLibraryDraftRecovery(store)?.draft).toEqual(value);
    writeLibraryDraftRecovery(store, { ...value, draftRevision: 8 }, false);
    expect(readLibraryDraftRecovery(store)).toMatchObject({ dirty: false, draft: { version: 5, draftRevision: 8 } });
  });
  it("rejects incompatible/corrupt snapshots without deleting their bytes", () => {
    const store = storage();
    for (const value of ["{broken", JSON.stringify({ version: 2, draft: draft() }), JSON.stringify({ version: 1, dirty: true, savedUtc: "today", draft: { ...draft(), content: {} } })]) {
      store.setItem(libraryRecoveryKey, value);
      expect(readLibraryDraftRecovery(store)).toBeNull(); expect(store.getItem(libraryRecoveryKey)).toBe(value);
    }
  });
  it("reports storage failure and removes only explicitly discarded recovery", () => {
    const store = storage(); writeLibraryDraftRecovery(store, draft(), true);
    const denied = { setItem: () => { throw new Error("quota"); }, removeItem: () => { throw new Error("denied"); } };
    expect(writeLibraryDraftRecovery(denied, draft(), true)).toBe(false);
    expect(removeLibraryDraftRecovery(denied)).toBe(false);
    expect(readLibraryDraftRecovery(store)).not.toBeNull();
    expect(removeLibraryDraftRecovery(store)).toBe(true); expect(readLibraryDraftRecovery(store)).toBeNull();
  });
});
