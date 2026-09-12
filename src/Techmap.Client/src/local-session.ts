import { buildApiUrl, type RuntimeConfig } from "./runtime-config";

export interface LocalSession {
  readonly csrfNonce: string;
  readonly instanceId: string;
}

interface SessionRecord {
  readonly csrfNonce?: unknown;
  readonly instanceId?: unknown;
}

export type SessionFetcher = (
  input: string,
  init: RequestInit,
) => Promise<{ readonly ok: boolean; readonly json: () => Promise<unknown> }>;

export async function loadLocalSession(
  config: RuntimeConfig,
  fetcher: SessionFetcher,
): Promise<LocalSession> {
  const response = await fetcher(buildApiUrl(config, "session"), {
    method: "GET",
    cache: "no-store",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error("Локальная HTTP-сессия недоступна. Перезапустите приложение.");
  }

  const input: unknown = await response.json();
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Сервер вернул повреждённую локальную HTTP-сессию.");
  }
  const record = input as SessionRecord;
  if (
    typeof record.csrfNonce !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(record.csrfNonce) ||
    typeof record.instanceId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(record.instanceId)
  ) {
    throw new Error("Сервер вернул повреждённую локальную HTTP-сессию.");
  }

  return Object.freeze({
    csrfNonce: record.csrfNonce,
    instanceId: record.instanceId,
  });
}

export function createMutationHeaders(session: LocalSession): Readonly<Record<string, string>> {
  return Object.freeze({
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-Techmap-CSRF": session.csrfNonce,
  });
}
