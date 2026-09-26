import { createMutationHeaders, type LocalSession } from "../local-session";
import { buildApiUrl, type RuntimeConfig } from "../runtime-config";
import type { HarnessDesignDocument } from "./model";

export interface ServerRecoveryDraft {
  readonly draftId: string;
  readonly sequence: number;
  readonly baseRevision: number;
  readonly content: unknown;
  readonly serverRevision: number;
  readonly serverContent: unknown;
  readonly savedUtc: string;
}

export function createDesignRecoveryApi(config: RuntimeConfig, session: LocalSession, fetcher = fetch) {
  const headers = createMutationHeaders(session);
  const path = (project: string, harness: string) =>
    `projects/${encodeURIComponent(project)}/harnesses/${encodeURIComponent(harness)}/design/recovery`;
  async function request(project: string, harness: string, suffix = "", init: RequestInit = {}) {
    const response = await fetcher(buildApiUrl(config, path(project, harness) + suffix), {
      credentials: "same-origin", cache: "no-store", ...init,
    });
    if (!response.ok) throw new Error("Не удалось записать или прочитать аварийный журнал на сервере. Сохраните копию документа перед закрытием.");
    return response;
  }
  return {
    list: async (project: string, harness: string): Promise<ServerRecoveryDraft[]> =>
      (await request(project, harness)).json(),
    put: async (project: string, harness: string, id: string, sequence: number, baseRevision: number, content: HarnessDesignDocument) => {
      await request(project, harness, `/${id}`, { method: "PUT", headers, body: JSON.stringify({ sequence, baseRevision, content }) });
    },
    remove: async (project: string, harness: string, id: string, sequence: number) => {
      await request(project, harness, `/${id}?sequence=${sequence}`, { method: "DELETE", headers });
    },
  };
}

/** Serializes writes and conditional cleanup so a save cannot erase newer edits. */
export class DesignRecoverySession {
  private tail: Promise<void> = Promise.resolve();
  private sequence = 0;
  private id = crypto.randomUUID();
  constructor(private readonly api: ReturnType<typeof createDesignRecoveryApi>,
    private readonly project: string, private readonly harness: string) {}

  write(baseRevision: number, content: HarnessDesignDocument): Promise<void> {
    const sequence = ++this.sequence;
    const id = this.id;
    const operation = this.tail.catch(() => {}).then(() => this.api.put(this.project, this.harness, id, sequence, baseRevision, content));
    this.tail = operation;
    return operation;
  }

  clear(): Promise<void> {
    if (!this.sequence) return Promise.resolve();
    const sequence = this.sequence;
    const id = this.id;
    // A subsequent edit has a separate identity even while deletion is pending.
    this.id = crypto.randomUUID();
    this.sequence = 0;
    const operation = this.tail.catch(() => {}).then(() => this.api.remove(this.project, this.harness, id, sequence));
    this.tail = operation;
    return operation;
  }

  preserve(): void { this.id = crypto.randomUUID(); this.sequence = 0; }
}
