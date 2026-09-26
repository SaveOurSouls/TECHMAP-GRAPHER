import type { HarnessDesignDocument } from "./model";

const draftVersion = 1 as const;

/** Accessing localStorage itself can throw in restricted browser profiles. */
export function browserRecoveryStorage(getStorage: () => Storage = () => window.localStorage): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  try { return getStorage(); }
  catch {
    return {
      getItem: () => { throw new Error("Browser storage unavailable"); },
      setItem: () => { throw new Error("Browser storage unavailable"); },
      removeItem: () => { throw new Error("Browser storage unavailable"); },
    };
  }
}

export interface HarnessDesignRecoveryDraft {
  readonly version: typeof draftVersion;
  readonly projectId: string;
  readonly harnessId: string;
  readonly baseRevision: number;
  readonly content: unknown;
  readonly savedUtc: string;
}

function draftKey(projectId: string, harnessId: string): string {
  return `techmap.recovery.harness-design.${projectId}.${harnessId}`;
}

/** Best-effort browser journal. Storage failures must never block the editor. */
export function writeHarnessDesignRecoveryDraft(
  storage: Pick<Storage, "setItem">,
  projectId: string,
  harnessId: string,
  baseRevision: number,
  content: HarnessDesignDocument,
): boolean {
  try {
    storage.setItem(draftKey(projectId, harnessId), JSON.stringify({
      version: draftVersion,
      projectId,
      harnessId,
      baseRevision,
      content,
      savedUtc: new Date().toISOString(),
    } satisfies HarnessDesignRecoveryDraft));
    return true;
  } catch {
    return false;
  }
}

export function readHarnessDesignRecoveryDraft(
  storage: Pick<Storage, "getItem">,
  projectId: string,
  harnessId: string,
): HarnessDesignRecoveryDraft | null {
  try {
    const json = storage.getItem(draftKey(projectId, harnessId));
    if (!json) return null;
    const value: unknown = JSON.parse(json);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (record.version !== draftVersion || record.projectId !== projectId || record.harnessId !== harnessId ||
        !Number.isSafeInteger(record.baseRevision) || (record.baseRevision as number) < 0 ||
        typeof record.savedUtc !== "string" || typeof record.content !== "object" || record.content === null) {
      return null;
    }
    return record as unknown as HarnessDesignRecoveryDraft;
  } catch {
    return null;
  }
}

export function removeHarnessDesignRecoveryDraft(
  storage: Pick<Storage, "removeItem">,
  projectId: string,
  harnessId: string,
): void {
  try {
    storage.removeItem(draftKey(projectId, harnessId));
  } catch {
    // The acknowledged server copy is authoritative even if browser cleanup
    // is unavailable. A stale journal is ignored when it matches the server.
  }
}
