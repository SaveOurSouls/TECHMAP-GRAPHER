export const SUPPORTED_RUNTIME_CONFIG_VERSION = 1;
export const SUPPORTED_API_VERSION = "1";

export type RuntimeConfigErrorCode =
  | "CONFIG_UNAVAILABLE"
  | "CONFIG_INVALID"
  | "CONFIG_INCOMPATIBLE";

export class RuntimeConfigError extends Error {
  readonly code: RuntimeConfigErrorCode;

  constructor(code: RuntimeConfigErrorCode, message: string) {
    super(message);
    this.name = "RuntimeConfigError";
    this.code = code;
  }
}

export interface RuntimeConfig {
  readonly configVersion: number;
  readonly basePath: string;
  readonly apiBasePath: string;
  readonly appVersion: string;
  readonly apiVersion: string;
  readonly schemaVersion: string;
}

export interface RuntimeConfigResponse {
  readonly ok: boolean;
  readonly json: () => Promise<unknown>;
}

export type RuntimeConfigFetcher = (url: URL) => Promise<RuntimeConfigResponse>;

export function buildRuntimeConfigUrl(moduleUrl: string | URL): URL {
  return new URL("../runtime-config.json", moduleUrl);
}

interface RuntimeConfigRecord {
  readonly configVersion?: unknown;
  readonly basePath?: unknown;
  readonly apiBasePath?: unknown;
  readonly appVersion?: unknown;
  readonly apiVersion?: unknown;
  readonly schemaVersion?: unknown;
}

function failInvalid(field: string): never {
  throw new RuntimeConfigError(
    "CONFIG_INVALID",
    `Параметр runtime-конфигурации «${field}» задан неверно.`,
  );
}

function readNonEmptyString(record: RuntimeConfigRecord, field: keyof RuntimeConfigRecord): string {
  const value = record[field];
  if (typeof value !== "string" || value.trim() === "") {
    return failInvalid(field);
  }
  return value;
}

function readBasePath(record: RuntimeConfigRecord, field: "basePath" | "apiBasePath"): string {
  const value = readNonEmptyString(record, field);
  if (
    !value.startsWith("/") ||
    !value.endsWith("/") ||
    value.includes("\\") ||
    value.includes("?") ||
    value.includes("#") ||
    value.includes("//") ||
    value.split("/").some((part) => part === "." || part === "..")
  ) {
    return failInvalid(field);
  }
  return value;
}

export function parseRuntimeConfig(input: unknown): RuntimeConfig {
  if (input === undefined || input === null) {
    throw new RuntimeConfigError(
      "CONFIG_UNAVAILABLE",
      "Runtime-конфигурация недоступна. Проверьте запуск локального сервера и обновите страницу.",
    );
  }
  if (typeof input !== "object" || Array.isArray(input)) {
    return failInvalid("config");
  }

  const record = input as RuntimeConfigRecord;
  if (record.configVersion !== SUPPORTED_RUNTIME_CONFIG_VERSION) {
    throw new RuntimeConfigError(
      "CONFIG_INCOMPATIBLE",
      "Версия runtime-конфигурации несовместима с этой версией клиента.",
    );
  }

  const basePath = readBasePath(record, "basePath");
  const apiBasePath = readBasePath(record, "apiBasePath");
  const apiVersion = readNonEmptyString(record, "apiVersion");
  if (apiVersion !== SUPPORTED_API_VERSION) {
    throw new RuntimeConfigError(
      "CONFIG_INCOMPATIBLE",
      `Версия API ${apiVersion} не поддерживается этим клиентом.`,
    );
  }
  if (apiBasePath !== `${basePath}api/v1/`) {
    return failInvalid("apiBasePath");
  }

  return Object.freeze({
    configVersion: SUPPORTED_RUNTIME_CONFIG_VERSION,
    basePath,
    apiBasePath,
    appVersion: readNonEmptyString(record, "appVersion"),
    apiVersion,
    schemaVersion: readNonEmptyString(record, "schemaVersion"),
  });
}

export async function loadRuntimeConfig(
  url: URL,
  fetcher: RuntimeConfigFetcher,
): Promise<RuntimeConfig> {
  let response: RuntimeConfigResponse;
  try {
    response = await fetcher(url);
  } catch {
    throw new RuntimeConfigError(
      "CONFIG_UNAVAILABLE",
      "Runtime-конфигурация недоступна. Проверьте запуск локального сервера и обновите страницу.",
    );
  }

  if (!response.ok) {
    throw new RuntimeConfigError(
      "CONFIG_UNAVAILABLE",
      "Сервер не предоставил runtime-конфигурацию. Перезапустите приложение и обновите страницу.",
    );
  }

  let input: unknown;
  try {
    input = await response.json();
  } catch {
    throw new RuntimeConfigError(
      "CONFIG_INVALID",
      "Runtime-конфигурация повреждена и не может быть прочитана.",
    );
  }
  return parseRuntimeConfig(input);
}

export function buildApiUrl(config: RuntimeConfig, resource: string): string {
  const normalized = resource.replace(/^\/+|\/+$/g, "");
  if (
    normalized === "" ||
    normalized.includes("\\") ||
    normalized.includes(":") ||
    normalized.includes("?") ||
    normalized.includes("#") ||
    normalized.split("/").some((part) => part === "." || part === "..")
  ) {
    throw new RuntimeConfigError("CONFIG_INVALID", "Путь API задан неверно.");
  }
  return `${config.apiBasePath}${normalized}`;
}
