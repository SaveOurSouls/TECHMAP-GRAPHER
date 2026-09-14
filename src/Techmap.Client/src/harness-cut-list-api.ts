import type { LocalSession } from "./local-session";
import { buildApiUrl, type RuntimeConfig } from "./runtime-config";

export type HarnessCutListStatus = "limited";
export type HarnessCutListItemStatus = "ready" | "incomplete";

export interface HarnessCutListItem {
  readonly wireId: string;
  readonly circuit: string;
  readonly material: string;
  readonly sourceLengthMm: number | null;
  readonly endCorrectionFromMm: number;
  readonly endCorrectionToMm: number;
  readonly roundingStepMm: number;
  readonly cutLengthMm: number | null;
  readonly pieces: number;
  readonly totalMetres: number | null;
  readonly status: HarnessCutListItemStatus;
}

export interface HarnessCutList {
  readonly projectId: string;
  readonly harnessId: string;
  readonly harnessQuantity: number;
  readonly status: HarnessCutListStatus;
  readonly warning: string;
  readonly items: readonly HarnessCutListItem[];
}

export interface HarnessCutListApi {
  get(projectId: string, harnessId: string): Promise<HarnessCutList>;
}

export class HarnessCutListApiError extends Error {
  readonly code: string | null;

  constructor(message: string, code: string | null = null) {
    super(message);
    this.name = "HarnessCutListApiError";
    this.code = code;
  }
}

type CutListFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const itemStatuses = new Set<HarnessCutListItemStatus>(["ready", "incomplete"]);

export function createHarnessCutListApi(
  config: RuntimeConfig,
  _session: LocalSession,
  fetcher: CutListFetcher = fetch,
): HarnessCutListApi {
  return Object.freeze({
    async get(projectId: string, harnessId: string): Promise<HarnessCutList> {
      let response: Response;
      try {
        response = await fetcher(buildApiUrl(config,
          `projects/${encodeURIComponent(projectId)}/harnesses/${encodeURIComponent(harnessId)}/cut-list`), {
          method: "GET",
          credentials: "same-origin",
          cache: "no-store",
          headers: { Accept: "application/json" },
        });
      } catch {
        throw new HarnessCutListApiError("Не удалось связаться с локальным сервером.");
      }
      if (!response.ok) throw await responseError(response);
      let value: unknown;
      try {
        value = await response.json();
      } catch {
        throw new HarnessCutListApiError("Сервер вернул нечитаемую карту резки.");
      }
      return parseHarnessCutList(value, projectId, harnessId);
    },
  });
}

export function parseHarnessCutList(
  value: unknown,
  requestedProjectId: string,
  requestedHarnessId: string,
): HarnessCutList {
  const record = requireRecord(value, "Сервер вернул повреждённую карту резки.");
  const projectId = requireUuid(record, "projectId");
  const harnessId = requireUuid(record, "harnessId");
  if (projectId.toLocaleLowerCase() !== requestedProjectId.toLocaleLowerCase() ||
      harnessId.toLocaleLowerCase() !== requestedHarnessId.toLocaleLowerCase()) {
    throw new Error("Карта резки относится к другому проекту или жгуту.");
  }
  if (record.status !== "limited" || !Array.isArray(record.items)) {
    throw new Error("Сервер вернул неподдерживаемую карту резки.");
  }
  const items = record.items.map(parseItem);
  if (new Set(items.map(item => item.wireId)).size !== items.length) {
    throw new Error("Карта резки содержит повторяющиеся провода.");
  }
  return Object.freeze({
    projectId,
    harnessId,
    harnessQuantity: requireInteger(record, "harnessQuantity", 1),
    status: "limited",
    warning: requireString(record, "warning"),
    items: Object.freeze(items),
  });
}

function parseItem(value: unknown): HarnessCutListItem {
  const record = requireRecord(value, "Строка карты резки задана неверно.");
  const status = requireString(record, "status");
  if (!itemStatuses.has(status as HarnessCutListItemStatus)) {
    throw new Error("Статус строки карты резки задан неверно.");
  }
  const sourceLengthMm = requireNullableNumber(record, "sourceLengthMm", 0);
  const cutLengthMm = requireNullableNumber(record, "cutLengthMm", 0);
  const totalMetres = requireNullableNumber(record, "totalMetres", 0);
  if ((status === "ready" && (sourceLengthMm === null || cutLengthMm === null || totalMetres === null)) ||
      (status === "incomplete" && (sourceLengthMm !== null || cutLengthMm !== null || totalMetres !== null))) {
    throw new Error("Статус строки карты резки не согласован с её длинами.");
  }
  return Object.freeze({
    wireId: requireNonEmptyString(record, "wireId"),
    circuit: requireString(record, "circuit"),
    material: requireNonEmptyString(record, "material"),
    sourceLengthMm,
    endCorrectionFromMm: requireNumber(record, "endCorrectionFromMm"),
    endCorrectionToMm: requireNumber(record, "endCorrectionToMm"),
    roundingStepMm: requireNumber(record, "roundingStepMm", Number.MIN_VALUE),
    cutLengthMm,
    pieces: requireInteger(record, "pieces", 1),
    totalMetres,
    status: status as HarnessCutListItemStatus,
  });
}

async function responseError(response: Response): Promise<HarnessCutListApiError> {
  try {
    const value = requireRecord(await response.json(), "");
    const code = typeof value.error === "string" ? value.error : null;
    const message = code === "invalid_session"
      ? "Локальная сессия завершена. Перезапустите приложение."
      : code === "project_not_found" || code === "harness_not_found"
        ? "Проект или жгут не найден. Обновите карточку проекта."
        : typeof value.message === "string" && value.message.trim()
          ? value.message
          : `Сервер не выполнил запрос карты резки (HTTP ${response.status}).`;
    return new HarnessCutListApiError(message, code);
  } catch {
    return new HarnessCutListApiError(`Сервер не выполнил запрос карты резки (HTTP ${response.status}).`);
  }
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string") throw new Error(`Поле ответа «${key}» задано неверно.`);
  return value;
}

function requireNonEmptyString(record: Record<string, unknown>, key: string): string {
  const value = requireString(record, key);
  if (!value.trim()) throw new Error(`Поле ответа «${key}» задано неверно.`);
  return value;
}

function requireUuid(record: Record<string, unknown>, key: string): string {
  const value = requireString(record, key);
  if (!uuidPattern.test(value)) throw new Error(`Поле ответа «${key}» задано неверно.`);
  return value;
}

function requireNumber(record: Record<string, unknown>, key: string, minimum = -Number.MAX_VALUE): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum) {
    throw new Error(`Поле ответа «${key}» задано неверно.`);
  }
  return value;
}

function requireNullableNumber(record: Record<string, unknown>, key: string, minimum: number): number | null {
  return record[key] === null ? null : requireNumber(record, key, minimum);
}

function requireInteger(record: Record<string, unknown>, key: string, minimum: number): number {
  const value = record[key];
  if (!Number.isSafeInteger(value) || Number(value) < minimum) {
    throw new Error(`Поле ответа «${key}» задано неверно.`);
  }
  return Number(value);
}
