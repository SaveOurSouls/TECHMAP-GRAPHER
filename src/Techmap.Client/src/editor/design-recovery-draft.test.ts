import { describe, expect, it } from "vitest";
import { createEmptyHarnessDesign } from "./model";
import {
  browserRecoveryStorage,
  readHarnessDesignRecoveryDraft,
  removeHarnessDesignRecoveryDraft,
  writeHarnessDesignRecoveryDraft,
} from "./design-recovery-draft";

class MemoryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

describe("harness design recovery draft", () => {
  it("handles an exception from the browser localStorage getter as a visible write failure", () => {
    const storage = browserRecoveryStorage(() => { throw new Error("SecurityError"); });
    expect(writeHarnessDesignRecoveryDraft(storage, "project", "harness", 0, createEmptyHarnessDesign())).toBe(false);
    expect(readHarnessDesignRecoveryDraft(storage, "project", "harness")).toBeNull();
  });
  it("keeps an unacknowledged full document and removes it only after acknowledgement", () => {
    const storage = new MemoryStorage();
    const content = createEmptyHarnessDesign();

    expect(writeHarnessDesignRecoveryDraft(storage, "project", "harness", 7, content)).toBe(true);
    expect(readHarnessDesignRecoveryDraft(storage, "project", "harness")).toMatchObject({
      version: 1,
      projectId: "project",
      harnessId: "harness",
      baseRevision: 7,
      content,
    });

    removeHarnessDesignRecoveryDraft(storage, "project", "harness");
    expect(readHarnessDesignRecoveryDraft(storage, "project", "harness")).toBeNull();
  });

  it("isolates harnesses and ignores malformed or unavailable browser storage", () => {
    const storage = new MemoryStorage();
    writeHarnessDesignRecoveryDraft(storage, "project", "first", 0, createEmptyHarnessDesign());
    expect(readHarnessDesignRecoveryDraft(storage, "project", "second")).toBeNull();
    storage.values.set("techmap.recovery.harness-design.project.first", "{broken");
    expect(readHarnessDesignRecoveryDraft(storage, "project", "first")).toBeNull();

    const unavailable = {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("full"); },
      removeItem: () => { throw new Error("denied"); },
    };
    expect(readHarnessDesignRecoveryDraft(unavailable, "project", "first")).toBeNull();
    expect(writeHarnessDesignRecoveryDraft(unavailable, "project", "first", 0, createEmptyHarnessDesign())).toBe(false);
    expect(() => removeHarnessDesignRecoveryDraft(unavailable, "project", "first")).not.toThrow();
  });

  it("keeps the draft discoverable after a server revision conflict", () => {
    const storage = new MemoryStorage();
    const content = createEmptyHarnessDesign();
    writeHarnessDesignRecoveryDraft(storage, "project", "harness", 3, content);

    // Reopening can return a newer server revision. The stable project+harness
    // key still exposes the draft and its original base revision to the UI.
    expect(readHarnessDesignRecoveryDraft(storage, "project", "harness")).toMatchObject({
      baseRevision: 3,
      content,
    });
  });
});
