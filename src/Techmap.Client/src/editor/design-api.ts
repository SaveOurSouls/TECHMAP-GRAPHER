import { createMutationHeaders, type LocalSession } from "../local-session";
import { buildApiUrl, type RuntimeConfig } from "../runtime-config";
import { parseHarnessDesignDocument, type HarnessDesignDocument } from "./model";

export interface HarnessDesignResource {
  readonly harnessId: string;
  readonly schemaVersion: 1;
  readonly revision: number;
  readonly content: HarnessDesignDocument;
  readonly updatedUtc: string;
}

export interface HarnessDesignApi {
  get(projectId: string, harnessId: string): Promise<HarnessDesignResource>;
  save(projectId: string, harnessId: string, expectedRevision: number, content: HarnessDesignDocument): Promise<HarnessDesignResource>;
}

export class HarnessDesignApiError extends Error {
  readonly code: string | null;
  readonly currentRevision: number | null;

  constructor(message: string, code: string | null, currentRevision: number | null) {
    super(message);
    this.name = "HarnessDesignApiError";
    this.code = code;
    this.currentRevision = currentRevision;
  }
}

type DesignFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function createHarnessDesignApi(
  config: RuntimeConfig,
  session: LocalSession,
  fetcher: DesignFetcher = fetch,
): HarnessDesignApi {
  const headers = createMutationHeaders(session);
  const resource = (projectId: string, harnessId: string) =>
    `projects/${encodeURIComponent(projectId)}/harnesses/${encodeURIComponent(harnessId)}/design`;

  async function request(
    path: string,
    init: RequestInit,
  ): Promise<HarnessDesignResource> {
    let response: Response;
    try {
      response = await fetcher(buildApiUrl(config, path), {
        credentials: "same-origin",
        cache: "no-store",
        ...init,
      });
    } catch {
      throw new HarnessDesignApiError("Не удалось связаться с локальным сервером.", null, null);
    }
    if (!response.ok) throw await parseError(response);
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      throw new HarnessDesignApiError("Сервер вернул нечитаемый документ жгута.", null, null);
    }
    return parseResource(value);
  }

  return {
    get: (projectId, harnessId) => request(resource(projectId, harnessId), {
      method: "GET",
      headers: { Accept: "application/json" },
    }),
    save: async (projectId, harnessId, expectedRevision, content) => {
      const validatedContent = parseHarnessDesignDocument(content);
      return request(resource(projectId, harnessId), {
        method: "PUT",
        headers,
        body: JSON.stringify({ expectedRevision, schemaVersion: 1, content: validatedContent }),
      });
    },
  };
}

function parseResource(value: unknown): HarnessDesignResource {
  const record = requireRecord(value);
  const harnessId = requireString(record.harnessId, "harnessId");
  if (!/^[0-9a-f-]{36}$/i.test(harnessId) || record.schemaVersion !== 1 ||
      !Number.isSafeInteger(record.revision) || (record.revision as number) < 0) {
    throw new Error("Сервер вернул повреждённые метаданные документа жгута.");
  }
  return {
    harnessId,
    schemaVersion: 1,
    revision: record.revision as number,
    content: parseHarnessDesignDocument(record.content),
    updatedUtc: requireString(record.updatedUtc, "updatedUtc"),
  };
}

async function parseError(response: Response): Promise<HarnessDesignApiError> {
  try {
    const value = requireRecord(await response.json());
    const code = typeof value.error === "string" ? value.error : null;
    const revision = Number.isSafeInteger(value.currentRevision) && (value.currentRevision as number) >= 0
      ? value.currentRevision as number : null;
    const message = code === "design_revision_conflict"
      ? "Документ изменился после открытия. Перезагрузите жгут перед повторным сохранением."
      : code === "harness_not_found" || code === "project_not_found"
        ? "Проект или жгут не найден."
        : typeof value.message === "string" && value.message.trim()
          ? value.message
          : `Сервер не выполнил запрос (HTTP ${response.status}).`;
    return new HarnessDesignApiError(message, code, revision);
  } catch {
    return new HarnessDesignApiError(`Сервер не выполнил запрос (HTTP ${response.status}).`, null, null);
  }
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Сервер вернул повреждённый документ жгута.");
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value) throw new Error(`Поле ответа «${name}» задано неверно.`);
  return value;
}
