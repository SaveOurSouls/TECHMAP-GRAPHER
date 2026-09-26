import type { Draft } from "./ComponentLibrary";

export const libraryRecoveryKey = "techmap.recovery.component-library.v1";
export interface LibraryDraftRecovery {
  readonly version: 1;
  readonly savedUtc: string;
  readonly dirty: boolean;
  readonly draft: Draft;
}

type RecoveryStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Keep raw editor state: incomplete fields/generators must also survive a crash. */
export function writeLibraryDraftRecovery(storage: Pick<RecoveryStorage, "setItem">, draft: Draft, dirty: boolean): boolean {
  try {
    storage.setItem(libraryRecoveryKey, JSON.stringify({ version: 1, savedUtc: new Date().toISOString(), dirty, draft } satisfies LibraryDraftRecovery));
    return true;
  } catch { return false; }
}

export function readLibraryDraftRecovery(storage: Pick<RecoveryStorage, "getItem">): LibraryDraftRecovery | null {
  try {
    const raw = storage.getItem(libraryRecoveryKey);
    if (!raw) return null;
    const value = JSON.parse(raw) as LibraryDraftRecovery;
    const draft = value?.draft;
    if (value.version !== 1 || typeof value.savedUtc !== "string" || typeof value.dirty !== "boolean" || !draft ||
        !(draft.templateId === null || typeof draft.templateId === "string") ||
        !Number.isSafeInteger(draft.version) || draft.version < 0 || !Number.isSafeInteger(draft.draftRevision) || draft.draftRevision < 0 ||
        typeof draft.code !== "string" || typeof draft.name !== "string" || !Array.isArray(draft.assets) ||
        !Array.isArray(draft.compatibleTerminalArticleKeys) || !(draft.terminalContactTypeBindings === null || Array.isArray(draft.terminalContactTypeBindings)) ||
        draft.content?.schemaVersion !== 3 || !Array.isArray(draft.content.views) || !draft.content.views.length ||
        draft.content.views.some(view => !Array.isArray(view.layers) || !view.layers.length) ||
        !Array.isArray(draft.content.articleVariants) || !Array.isArray(draft.content.logicalContacts) || !Array.isArray(draft.content.contactTypeGroups) ||
        !Array.isArray(draft.e4ConnectorTable?.articles) || !Array.isArray(draft.e4ConnectorTable.seriesDefaults) || !Array.isArray(draft.e4ConnectorTable.contactTypeGroups)) return null;
    return value;
  } catch { return null; }
}

export function removeLibraryDraftRecovery(storage: Pick<RecoveryStorage, "removeItem">): boolean {
  try { storage.removeItem(libraryRecoveryKey); return true; } catch { return false; }
}
