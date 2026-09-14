import { createMutationHeaders, type LocalSession } from "./local-session";
import { buildApiUrl, type RuntimeConfig } from "./runtime-config";

export const maximumXlsxBytes = 25 * 1024 * 1024;

export type XlsxFieldValueKind = "raw" | "text" | "int64" | "decimal" | "boolean";
export type ReferenceDiagnosticSeverity = "warning" | "error";

export interface XlsxFieldMapping {
  readonly sourceColumn: string;
  readonly targetProperty: string;
  readonly valueKind: XlsxFieldValueKind;
  readonly required: boolean;
  readonly notApplicableTokens?: readonly string[] | null;
  readonly allowBlank?: boolean;
  readonly allowNotApplicable?: boolean;
}

export interface XlsxPreviewRequest {
  readonly fileName: string;
  readonly contentBase64: string;
  readonly sheetName: string | null;
  readonly headerRow: number;
  readonly firstDataRow: number;
  readonly entityType: string;
  readonly keyColumn: string;
  readonly fields: readonly XlsxFieldMapping[] | null;
}

export interface XlsxImportProfile {
  readonly profileId: string;
  readonly displayName: string;
  readonly sourceId: string;
  readonly sheetName: string;
  readonly entityType: string;
  readonly keyColumn: string;
  readonly description: string;
}

export interface XlsxProfilePreviewRequest {
  readonly fileName: string;
  readonly contentBase64: string;
  readonly profileId: string;
}

export interface GoogleSheetsProfilePreviewRequest {
  readonly url: string;
  readonly profileId: string;
}

export interface ReferenceCatalogDiagnostic {
  readonly diagnosticId: string;
  readonly severity: ReferenceDiagnosticSeverity;
  readonly code: string;
  readonly message: string;
  readonly entityType: string | null;
  readonly sourceKey: string | null;
  readonly field: string | null;
  readonly sourceLocation: string | null;
}

export interface ReferenceCatalogRecord {
  readonly recordId: string;
  readonly entityType: string;
  readonly sourceKey: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly sourceLocation: string | null;
}

export interface ReferenceCatalogSnapshot {
  readonly snapshotId: string;
  readonly sourceId: string;
  readonly contractVersion: number;
  readonly capturedUtc: string;
  readonly sourceKind: string;
  readonly versionFingerprint: string;
  readonly sourceUri: string | null;
  readonly sha256: string;
  readonly records: readonly ReferenceCatalogRecord[];
  readonly diagnostics: readonly ReferenceCatalogDiagnostic[];
}

export interface XlsxSheet {
  readonly name: string;
  readonly hidden: boolean;
}

export interface XlsxResolvedColumn {
  readonly header: string;
  readonly columnIndex: number;
  readonly targetProperty: string;
  readonly valueKind: XlsxResolvedValueKind;
}

export type XlsxResolvedValueKind = "rawscalar" | "text" | "textscalar" | "int64" | "decimal" | "boolean";

export interface XlsxPreviewRecord {
  readonly rowNumber: number;
  readonly sourceKey: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly sourceLocation: string;
}

export interface XlsxReferencePreview {
  readonly previewId: string;
  readonly expiresUtc: string;
  readonly activeSnapshotId: string | null;
  readonly snapshotId: string;
  readonly sourceId: string;
  readonly fileName: string;
  readonly sourceSha256: string;
  readonly sheets: readonly XlsxSheet[];
  readonly selectedSheet: string;
  readonly headerRow: number;
  readonly firstDataRow: number;
  readonly entityType: string;
  readonly keyColumn: string;
  readonly columns: readonly XlsxResolvedColumn[];
  readonly sourceRowCount: number;
  readonly recordCount: number;
  readonly isTruncated: boolean;
  readonly validationSha256: string | null;
  readonly canPublish: boolean;
  readonly records: readonly XlsxPreviewRecord[];
  readonly diagnostics: readonly ReferenceCatalogDiagnostic[];
}

export interface PublishXlsxPreviewRequest {
  readonly previewId: string;
  readonly expectedValidationSha256: string;
  readonly expectedActiveSnapshotId: string | null;
  readonly acknowledgedWarningIds: readonly string[];
}

export interface ReferenceCatalogPublication {
  readonly status: "published" | "unchanged";
  readonly previousActiveSnapshotId: string | null;
  readonly snapshot: ReferenceCatalogSnapshot;
}

export interface ReferenceCatalogSearchRequest {
  readonly text: string | null;
  readonly exactSourceKey: string | null;
  readonly entityTypes: readonly string[];
  readonly filters: readonly ReferenceCatalogSearchFilter[];
  readonly filterLogic: "all" | "any";
  readonly sort: "relevance" | "source-key-asc" | "source-key-desc" | "entity-type-asc";
  readonly pageSize: number;
  readonly cursor: string | null;
}

export interface ReferenceCatalogSearchFilter {
  readonly field: string;
  readonly operator: "eq" | "prefix" | "exists" | "missing" | "null" | "blank";
  readonly value?: string | null;
}

export interface ReferenceCatalogSearchRecord {
  readonly recordId: string;
  readonly entityType: string;
  readonly sourceKey: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly sourceLocation: string | null;
}

export interface ReferenceCatalogSearchPage {
  readonly snapshotId: string;
  readonly snapshotSha256: string;
  readonly items: readonly ReferenceCatalogSearchRecord[];
  readonly nextCursor: string | null;
}

export interface ReferenceCatalogApi {
  getXlsxProfiles(): Promise<readonly XlsxImportProfile[]>;
  getActive(sourceId: string): Promise<ReferenceCatalogSnapshot | null>;
  previewXlsx(sourceId: string, request: XlsxPreviewRequest, signal?: AbortSignal): Promise<XlsxReferencePreview>;
  previewXlsxProfile(sourceId: string, request: XlsxProfilePreviewRequest, signal?: AbortSignal): Promise<XlsxReferencePreview>;
  previewGoogleSheetsProfile(sourceId: string, request: GoogleSheetsProfilePreviewRequest, signal?: AbortSignal): Promise<XlsxReferencePreview>;
  publishXlsx(sourceId: string, request: PublishXlsxPreviewRequest): Promise<ReferenceCatalogPublication>;
  searchCatalog(
    sourceId: string,
    request: ReferenceCatalogSearchRequest,
    signal?: AbortSignal,
  ): Promise<ReferenceCatalogSearchPage>;
}

export class ReferenceCatalogApiError extends Error {
  readonly code: string | null;
  readonly field: string | null;
  readonly diagnostics: readonly ReferenceCatalogDiagnostic[];

  constructor(
    message: string,
    code: string | null = null,
    field: string | null = null,
    diagnostics: readonly ReferenceCatalogDiagnostic[] = [],
  ) {
    super(message);
    this.name = "ReferenceCatalogApiError";
    this.code = code;
    this.field = field;
    this.diagnostics = diagnostics;
  }
}

type ReferenceFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sha256Pattern = /^[0-9a-f]{64}$/i;
const severities = new Set<ReferenceDiagnosticSeverity>(["warning", "error"]);
const publicationStatuses = new Set(["published", "unchanged"]);
const resolvedValueKinds = new Set<XlsxResolvedValueKind>([
  "rawscalar", "text", "textscalar", "int64", "decimal", "boolean",
]);
const errorMessages: Readonly<Record<string, string>> = {
  invalid_origin: "Откройте приложение через его локальный адрес.",
  invalid_session: "Локальная сессия завершена. Перезапустите приложение.",
  invalid_csrf_nonce: "Локальная сессия изменилась. Перезапустите приложение.",
  json_content_type_required: "Сервер отклонил формат запроса.",
  request_cancelled: "Проверка файла отменена.",
  xlsx_content_required: "Выберите файл XLSX.",
  xlsx_content_invalid: "Содержимое файла XLSX повреждено.",
  xlsx_file_name_invalid: "Нужен файл с расширением .xlsx.",
  xlsx_invalid: "Файл повреждён или не является поддерживаемым XLSX.",
  xlsx_too_large: "Файл XLSX превышает допустимый размер 25 МиБ.",
  xlsx_mapping_invalid: "Проверьте настройки листа, строк и сопоставления полей.",
  xlsx_profile_not_found: "Выбранный профиль импорта больше недоступен. Обновите список.",
  xlsx_profile_source_mismatch: "Профиль не соответствует выбранному справочнику.",
  google_sheets_url_required: "Вставьте публичную ссылку Google Sheets.",
  google_sheets_url_invalid: "Укажите ссылку на таблицу Google Sheets.",
  google_sheets_not_public: "Таблица Google Sheets недоступна без авторизации. Откройте публичный доступ по ссылке.",
  google_sheets_fetch_failed: "Не удалось прочитать публичную таблицу Google Sheets.",
  google_sheets_access_denied: "Таблица Google Sheets недоступна без авторизации. Откройте публичный доступ по ссылке.",
  google_sheets_not_found: "Таблица Google Sheets не найдена. Проверьте публичную ссылку.",
  google_sheets_unavailable: "Google Sheets временно недоступна. Повторите попытку позже.",
  google_sheets_download_timeout: "Google Sheets не ответила вовремя. Повторите попытку.",
  google_sheets_not_xlsx: "Google Sheets не вернула поддерживаемую рабочую книгу.",
  google_sheets_profile_source_mismatch: "Профиль не соответствует выбранному справочнику.",
  google_sheets_import_busy: "Дождитесь завершения текущей проверки справочника.",
  xlsx_preview_expired: "Предварительный просмотр истёк. Проверьте файл ещё раз.",
  xlsx_preview_active_mismatch: "Активная версия изменилась. Проверьте файл ещё раз.",
  xlsx_publication_invalid: "Данные предварительного просмотра неполны. Проверьте файл ещё раз.",
  catalog_search_invalid: "Параметры поиска справочника заданы неверно.",
  catalog_cursor_invalid: "Страница поиска устарела. Запустите поиск повторно.",
  catalog_cursor_snapshot_changed: "Справочник обновился. Результаты поиска будут загружены заново.",
  catalog_active_snapshot_changed: "Активная версия изменилась. Проверьте файл ещё раз.",
  catalog_validation_failed: "В файле остались блокирующие ошибки.",
  catalog_validation_changed: "Результат проверки изменился. Проверьте файл ещё раз.",
  catalog_warnings_require_acknowledgement: "Просмотрите и подтвердите все предупреждения.",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isAbortError(value: unknown): boolean {
  return value instanceof Error && value.name === "AbortError";
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(message);
  return value;
}

function requireString(record: Record<string, unknown>, key: string, allowEmpty = false): string {
  const value = record[key];
  if (typeof value !== "string" || (!allowEmpty && value.trim() === "")) {
    throw new Error(`Поле ответа «${key}» задано неверно.`);
  }
  return value;
}

function optionalString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new Error(`Поле ответа «${key}» задано неверно.`);
  return value;
}

function nullableUuid(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  if (value === null) return null;
  if (typeof value !== "string" || !uuidPattern.test(value)) {
    throw new Error(`Поле ответа «${key}» задано неверно.`);
  }
  return value;
}

function requireInteger(record: Record<string, unknown>, key: string, minimum = 0): number {
  const value = record[key];
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new Error(`Поле ответа «${key}» задано неверно.`);
  }
  return value as number;
}

function requireBoolean(record: Record<string, unknown>, key: string): boolean {
  const value = record[key];
  if (typeof value !== "boolean") throw new Error(`Поле ответа «${key}» задано неверно.`);
  return value;
}

function requireUuid(record: Record<string, unknown>, key: string): string {
  const value = requireString(record, key);
  if (!uuidPattern.test(value)) throw new Error(`Поле ответа «${key}» задано неверно.`);
  return value;
}

function requireHash(record: Record<string, unknown>, key: string): string {
  const value = requireString(record, key);
  if (!sha256Pattern.test(value)) throw new Error(`Поле ответа «${key}» задано неверно.`);
  return value;
}

function optionalHash(record: Record<string, unknown>, key: string): string | null {
  const value = optionalString(record, key);
  if (value !== null && !sha256Pattern.test(value)) throw new Error(`Поле ответа «${key}» задано неверно.`);
  return value;
}

function requireDateTime(record: Record<string, unknown>, key: string): string {
  const value = requireString(record, key);
  if (!Number.isFinite(Date.parse(value))) throw new Error(`Поле ответа «${key}» задано неверно.`);
  return value;
}

function requireArray(record: Record<string, unknown>, key: string): readonly unknown[] {
  const value = record[key];
  if (!Array.isArray(value)) throw new Error(`Поле ответа «${key}» задано неверно.`);
  return value;
}

function parseDiagnostic(value: unknown): ReferenceCatalogDiagnostic {
  const record = requireRecord(value, "Сервер вернул повреждённую диагностику XLSX.");
  const severity = requireString(record, "severity");
  if (!severities.has(severity as ReferenceDiagnosticSeverity)) {
    throw new Error("Поле ответа «severity» задано неверно.");
  }
  return Object.freeze({
    diagnosticId: requireHash(record, "diagnosticId"),
    severity: severity as ReferenceDiagnosticSeverity,
    code: requireString(record, "code"),
    message: requireString(record, "message"),
    entityType: optionalString(record, "entityType"),
    sourceKey: optionalString(record, "sourceKey"),
    field: optionalString(record, "field"),
    sourceLocation: optionalString(record, "sourceLocation"),
  });
}

function parseXlsxProfile(value: unknown): XlsxImportProfile {
  const record = requireRecord(value, "Сервер вернул повреждённый профиль импорта XLSX.");
  return Object.freeze({
    profileId: requireString(record, "profileId"),
    displayName: requireString(record, "displayName"),
    sourceId: requireString(record, "sourceId"),
    sheetName: requireString(record, "sheetName"),
    entityType: requireString(record, "entityType"),
    keyColumn: requireString(record, "keyColumn"),
    description: requireString(record, "description"),
  });
}

function parseXlsxProfiles(value: unknown): readonly XlsxImportProfile[] {
  if (!Array.isArray(value)) throw new Error("Сервер вернул повреждённый список профилей XLSX.");
  const profiles = value.map(parseXlsxProfile);
  if (new Set(profiles.map((profile) => profile.profileId)).size !== profiles.length) {
    throw new Error("Сервер вернул повторяющиеся профили импорта XLSX.");
  }
  return Object.freeze(profiles);
}

function parseSearchRecord(value: unknown): ReferenceCatalogSearchRecord {
  const record = requireRecord(value, "Сервер вернул повреждённую запись поиска.");
  return Object.freeze({
    recordId: requireString(record, "recordId"),
    entityType: requireString(record, "entityType"),
    sourceKey: requireString(record, "sourceKey"),
    payload: parsePayload(record.payload),
    sourceLocation: optionalString(record, "sourceLocation"),
  });
}

function parseSearchPage(value: unknown): ReferenceCatalogSearchPage {
  const record = requireRecord(value, "Сервер вернул повреждённую страницу поиска.");
  return Object.freeze({
    snapshotId: requireUuid(record, "snapshotId"),
    snapshotSha256: requireHash(record, "snapshotSha256"),
    items: Object.freeze(requireArray(record, "items").map(parseSearchRecord)),
    nextCursor: optionalString(record, "nextCursor"),
  });
}

function parsePayload(value: unknown): Readonly<Record<string, unknown>> {
  return Object.freeze(requireRecord(value, "Сервер вернул повреждённые данные записи XLSX."));
}

function parseRecord(value: unknown): ReferenceCatalogRecord {
  const record = requireRecord(value, "Сервер вернул повреждённую запись справочника.");
  return Object.freeze({
    recordId: requireHash(record, "recordId"),
    entityType: requireString(record, "entityType"),
    sourceKey: requireString(record, "sourceKey"),
    payload: parsePayload(record.payload),
    sourceLocation: optionalString(record, "sourceLocation"),
  });
}

function parseSnapshot(value: unknown): ReferenceCatalogSnapshot {
  const record = requireRecord(value, "Сервер вернул повреждённую версию справочника.");
  const sourceUri = optionalString(record, "sourceUri");
  return Object.freeze({
    snapshotId: requireUuid(record, "snapshotId"),
    sourceId: requireString(record, "sourceId"),
    contractVersion: requireInteger(record, "contractVersion", 1),
    capturedUtc: requireDateTime(record, "capturedUtc"),
    sourceKind: requireString(record, "sourceKind"),
    versionFingerprint: requireString(record, "versionFingerprint"),
    sourceUri,
    sha256: requireHash(record, "sha256"),
    records: Object.freeze(requireArray(record, "records").map(parseRecord)),
    diagnostics: Object.freeze(requireArray(record, "diagnostics").map(parseDiagnostic)),
  });
}

function parsePreviewRecord(value: unknown): XlsxPreviewRecord {
  const record = requireRecord(value, "Сервер вернул повреждённую строку просмотра XLSX.");
  return Object.freeze({
    rowNumber: requireInteger(record, "rowNumber", 1),
    sourceKey: requireString(record, "sourceKey"),
    payload: parsePayload(record.payload),
    sourceLocation: requireString(record, "sourceLocation"),
  });
}

function parsePreview(value: unknown): XlsxReferencePreview {
  const record = requireRecord(value, "Сервер вернул повреждённый предварительный просмотр XLSX.");
  const sheets = requireArray(record, "sheets").map(item => {
    const sheet = requireRecord(item, "Сервер вернул повреждённое описание листа XLSX.");
    return Object.freeze({ name: requireString(sheet, "name"), hidden: requireBoolean(sheet, "hidden") });
  });
  const columns = requireArray(record, "columns").map(item => {
    const column = requireRecord(item, "Сервер вернул повреждённое описание столбца XLSX.");
    const valueKind = requireString(column, "valueKind");
    if (!resolvedValueKinds.has(valueKind as XlsxResolvedValueKind)) {
      throw new Error("Поле ответа «valueKind» задано неверно.");
    }
    return Object.freeze({
      header: requireString(column, "header"),
      columnIndex: requireInteger(column, "columnIndex", 1),
      targetProperty: requireString(column, "targetProperty"),
      valueKind: valueKind as XlsxResolvedValueKind,
    });
  });
  const canPublish = requireBoolean(record, "canPublish");
  const validationSha256 = optionalHash(record, "validationSha256");
  if (canPublish !== (validationSha256 !== null)) {
    throw new Error("Сервер вернул несогласованный результат проверки XLSX.");
  }
  return Object.freeze({
    previewId: requireUuid(record, "previewId"),
    expiresUtc: requireDateTime(record, "expiresUtc"),
    activeSnapshotId: nullableUuid(record, "activeSnapshotId"),
    snapshotId: requireUuid(record, "snapshotId"),
    sourceId: requireString(record, "sourceId"),
    fileName: requireString(record, "fileName"),
    sourceSha256: requireHash(record, "sourceSha256"),
    sheets: Object.freeze(sheets),
    selectedSheet: requireString(record, "selectedSheet"),
    headerRow: requireInteger(record, "headerRow", 1),
    firstDataRow: requireInteger(record, "firstDataRow", 2),
    entityType: requireString(record, "entityType"),
    keyColumn: requireString(record, "keyColumn"),
    columns: Object.freeze(columns),
    sourceRowCount: requireInteger(record, "sourceRowCount"),
    recordCount: requireInteger(record, "recordCount"),
    isTruncated: requireBoolean(record, "isTruncated"),
    validationSha256,
    canPublish,
    records: Object.freeze(requireArray(record, "records").map(parsePreviewRecord)),
    diagnostics: Object.freeze(requireArray(record, "diagnostics").map(parseDiagnostic)),
  });
}

function parsePublication(value: unknown): ReferenceCatalogPublication {
  const record = requireRecord(value, "Сервер вернул повреждённый результат публикации XLSX.");
  const status = requireString(record, "status");
  if (!publicationStatuses.has(status)) throw new Error("Поле ответа «status» задано неверно.");
  const previous = nullableUuid(record, "previousActiveSnapshotId");
  return Object.freeze({
    status: status as "published" | "unchanged",
    previousActiveSnapshotId: previous,
    snapshot: parseSnapshot(record.snapshot),
  });
}

async function responseError(response: Response): Promise<ReferenceCatalogApiError> {
  try {
    const body: unknown = await response.json();
    if (isRecord(body)) {
      const code = typeof body.error === "string" ? body.error : null;
      const field = typeof body.field === "string" ? body.field : null;
      const diagnostics = Array.isArray(body.diagnostics) ? body.diagnostics.map(parseDiagnostic) : [];
      const message = typeof body.message === "string" && body.message.trim() !== ""
        ? body.message
        : code ? errorMessages[code] : null;
      if (message) return new ReferenceCatalogApiError(message, code, field, diagnostics);
    }
  } catch {
    // A stable status-based message below covers malformed error responses.
  }
  if (response.status === 401) return new ReferenceCatalogApiError("Локальная сессия завершена. Перезапустите приложение.");
  if (response.status === 413) return new ReferenceCatalogApiError("Файл XLSX превышает допустимый размер 25 МиБ.");
  return new ReferenceCatalogApiError(`Сервер не выполнил запрос (HTTP ${response.status}).`);
}

export function bytesToBase64(bytes: Uint8Array, encode: (value: string) => string = btoa): string {
  const encoded: string[] = [];
  const chunkSize = 3 * 8192;
  for (let start = 0; start < bytes.length; start += chunkSize) {
    const chunk = bytes.subarray(start, Math.min(start + chunkSize, bytes.length));
    let binary = "";
    for (const byte of chunk) binary += String.fromCharCode(byte);
    encoded.push(encode(binary));
  }
  return encoded.join("");
}

export async function xlsxFileToBase64(file: File): Promise<string> {
  if (!file.name.toLocaleLowerCase().endsWith(".xlsx")) {
    throw new Error("Выберите файл с расширением .xlsx.");
  }
  if (file.size === 0) throw new Error("Выбранный файл пуст.");
  if (file.size > maximumXlsxBytes) throw new Error("Файл XLSX не должен превышать 25 МиБ.");
  return bytesToBase64(new Uint8Array(await file.arrayBuffer()));
}

export function createReferenceCatalogApi(
  config: RuntimeConfig,
  session: LocalSession,
  fetcher: ReferenceFetcher = fetch,
): ReferenceCatalogApi {
  const mutationHeaders = createMutationHeaders(session);

  const resource = (sourceId: string, suffix: string): string =>
    `reference-sources/${encodeURIComponent(sourceId)}/${suffix}`;

  async function request<T>(path: string, init: RequestInit, parse: (input: unknown) => T): Promise<T> {
    let response: Response;
    try {
      response = await fetcher(buildApiUrl(config, path), {
        credentials: "same-origin",
        cache: "no-store",
        ...init,
      });
    } catch (error) {
      if (isAbortError(error)) throw error;
      throw new ReferenceCatalogApiError("Не удалось связаться с локальным сервером.");
    }
    if (!response.ok) throw await responseError(response);
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ReferenceCatalogApiError("Сервер вернул нечитаемый ответ.");
    }
    try {
      return parse(body);
    } catch (error) {
      throw new ReferenceCatalogApiError(error instanceof Error ? error.message : "Сервер вернул повреждённый ответ.");
    }
  }

  return Object.freeze({
    getXlsxProfiles: () => request(
      "reference-import/xlsx-profiles",
      { method: "GET", headers: { Accept: "application/json" } },
      parseXlsxProfiles,
    ),
    getActive: async (sourceId: string) => {
      try {
        return await request(resource(sourceId, "active"), {
          method: "GET",
          headers: { Accept: "application/json" },
        }, parseSnapshot);
      } catch (error) {
        if (error instanceof ReferenceCatalogApiError && error.code === "catalog_active_snapshot_not_found") return null;
        throw error;
      }
    },
    previewXlsx: (sourceId: string, body: XlsxPreviewRequest, signal?: AbortSignal) => request(
      resource(sourceId, "xlsx-previews"),
      { method: "POST", headers: mutationHeaders, body: JSON.stringify(body), signal },
      parsePreview,
    ),
    previewXlsxProfile: (sourceId: string, body: XlsxProfilePreviewRequest, signal?: AbortSignal) => request(
      resource(sourceId, "xlsx-profile-previews"),
      { method: "POST", headers: mutationHeaders, body: JSON.stringify(body), signal },
      parsePreview,
    ),
    previewGoogleSheetsProfile: (sourceId: string, body: GoogleSheetsProfilePreviewRequest, signal?: AbortSignal) => request(
      resource(sourceId, "google-sheets-profile-previews"),
      { method: "POST", headers: mutationHeaders, body: JSON.stringify(body), signal },
      parsePreview,
    ),
    publishXlsx: (sourceId: string, body: PublishXlsxPreviewRequest) => request(
      resource(sourceId, "xlsx-publications"),
      { method: "POST", headers: mutationHeaders, body: JSON.stringify(body) },
      parsePublication,
    ),
    searchCatalog: (
      sourceId: string,
      body: ReferenceCatalogSearchRequest,
      signal?: AbortSignal,
    ) => request(
      resource(sourceId, "catalog-searches"),
      { method: "POST", headers: mutationHeaders, body: JSON.stringify(body), signal },
      parseSearchPage,
    ),
  });
}
