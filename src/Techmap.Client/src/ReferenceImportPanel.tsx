import { type ChangeEvent, type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LocalSession } from "./local-session";
import {
  createReferenceCatalogApi,
  ReferenceCatalogApiError,
  type ReferenceCatalogSnapshot,
  type XlsxFieldMapping,
  type XlsxFieldValueKind,
  type XlsxReferencePreview,
  xlsxFileToBase64,
} from "./reference-catalog-api";
import type { RuntimeConfig } from "./runtime-config";

interface ReferenceImportPanelProps {
  readonly config: RuntimeConfig;
  readonly session: LocalSession;
}

interface ImportSettings {
  readonly sourceId: string;
  readonly sheetName: string;
  readonly headerRow: string;
  readonly firstDataRow: string;
  readonly entityType: string;
  readonly keyColumn: string;
}

type Notice = { readonly tone: "success" | "error" | "info"; readonly text: string };

const initialSettings: ImportSettings = {
  sourceId: "technology-database",
  sheetName: "",
  headerRow: "1",
  firstDataRow: "2",
  entityType: "generic-record",
  keyColumn: "RecordKey",
};

const emptyFieldMapping: XlsxFieldMapping = {
  sourceColumn: "",
  targetProperty: "",
  valueKind: "raw",
  required: false,
  notApplicableTokens: [],
  allowBlank: false,
  allowNotApplicable: false,
};

const valueKindLabels: Readonly<Record<XlsxFieldValueKind, string>> = {
  raw: "Автоматически",
  text: "Текст",
  int64: "Целое число",
  decimal: "Десятичное число",
  boolean: "Да / нет",
};

const stalePreviewCodes = new Set([
  "xlsx_preview_expired",
  "xlsx_preview_active_mismatch",
  "catalog_active_snapshot_changed",
  "catalog_validation_changed",
]);
const maximumMappedFields = 256;

function errorText(error: unknown): string {
  if (error instanceof ReferenceCatalogApiError && error.field) {
    return `${error.message} Место: ${error.field}.`;
  }
  return error instanceof Error ? error.message : "Неизвестная ошибка. Повторите попытку.";
}

function positiveInteger(value: string): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

export function requiredWarningIds(preview: XlsxReferencePreview): readonly string[] {
  return [...new Set(preview.diagnostics
    .filter((diagnostic) => diagnostic.severity === "warning")
    .map((diagnostic) => diagnostic.diagnosticId))];
}

export function canPublishXlsxPreview(
  preview: XlsxReferencePreview | null,
  acknowledgedWarningIds: ReadonlySet<string>,
  now: number,
  stale = false,
): boolean {
  if (
    preview === null ||
    !preview.canPublish ||
    preview.validationSha256 === null ||
    stale ||
    Date.parse(preview.expiresUtc) <= now
  ) return false;
  const required = requiredWarningIds(preview);
  return acknowledgedWarningIds.size === required.length &&
    required.every((diagnosticId) => acknowledgedWarningIds.has(diagnosticId));
}

export function fileSelectionLabel(file: Pick<File, "name" | "size"> | null): string {
  return file === null ? "Файл не выбран" : `${file.name} · ${Math.ceil(file.size / 1024)} КиБ`;
}

export function ReferenceImportPanel({ config, session }: ReferenceImportPanelProps) {
  const api = useMemo(() => createReferenceCatalogApi(config, session), [config, session]);
  const [settings, setSettings] = useState<ImportSettings>(initialSettings);
  const [file, setFile] = useState<File | null>(null);
  const [sheetOptions, setSheetOptions] = useState<readonly { readonly name: string; readonly hidden: boolean }[]>([]);
  const [manualMapping, setManualMapping] = useState(false);
  const [fields, setFields] = useState<readonly XlsxFieldMapping[]>([{ ...emptyFieldMapping }]);
  const [active, setActive] = useState<ReferenceCatalogSnapshot | null | undefined>(undefined);
  const [activeError, setActiveError] = useState<string | null>(null);
  const [preview, setPreview] = useState<XlsxReferencePreview | null>(null);
  const [acknowledgedWarnings, setAcknowledgedWarnings] = useState<ReadonlySet<string>>(new Set());
  const [previewStale, setPreviewStale] = useState(false);
  const [previewPublished, setPreviewPublished] = useState(false);
  const [busy, setBusy] = useState<"preview" | "publish" | "active" | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [now, setNow] = useState(Date.now());
  const activeRequestRef = useRef(0);

  const loadActive = useCallback(async (showBusy: boolean) => {
    const sourceId = settings.sourceId.trim();
    if (!sourceId) {
      setActive(null);
      setActiveError(null);
      return;
    }
    const requestId = ++activeRequestRef.current;
    if (showBusy) setBusy("active");
    try {
      const snapshot = await api.getActive(sourceId);
      if (activeRequestRef.current === requestId) {
        setActive(snapshot);
        setActiveError(null);
      }
    } catch (error) {
      if (activeRequestRef.current === requestId) {
        setActiveError(errorText(error));
        setNotice({ tone: "error", text: errorText(error) });
      }
    } finally {
      if (showBusy && activeRequestRef.current === requestId) setBusy(null);
    }
  }, [api, settings.sourceId]);

  useEffect(() => {
    let cancelled = false;
    const sourceId = settings.sourceId.trim();
    if (!sourceId) {
      setActive(null);
      setActiveError(null);
      return () => { cancelled = true; };
    }
    const requestId = ++activeRequestRef.current;
    setActive(undefined);
    setActiveError(null);
    void api.getActive(sourceId).then((snapshot) => {
      if (!cancelled && activeRequestRef.current === requestId) {
        setActive(snapshot);
        setActiveError(null);
      }
    }).catch((error: unknown) => {
      if (!cancelled && activeRequestRef.current === requestId) {
        setActive(null);
        setActiveError(errorText(error));
        setNotice({ tone: "error", text: errorText(error) });
      }
    });
    return () => { cancelled = true; };
  }, [api, settings.sourceId]);

  useEffect(() => {
    if (preview === null) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, [preview]);

  const invalidatePreview = () => {
    setPreview(null);
    setAcknowledgedWarnings(new Set());
    setPreviewStale(false);
    setPreviewPublished(false);
    setNotice(null);
  };

  const changeSetting = (patch: Readonly<Partial<ImportSettings>>) => {
    setSettings((current) => ({ ...current, ...patch }));
    invalidatePreview();
  };

  const selectFile = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0] ?? null;
    setFile(selected);
    setSheetOptions([]);
    invalidatePreview();
    if (selected && !selected.name.toLocaleLowerCase().endsWith(".xlsx")) {
      setNotice({ tone: "error", text: "Выберите файл с расширением .xlsx." });
    }
  };

  const updateField = (index: number, patch: Readonly<Partial<XlsxFieldMapping>>) => {
    setFields((current) => current.map((field, fieldIndex) => (
      fieldIndex === index ? { ...field, ...patch } : field
    )));
    invalidatePreview();
  };

  const addField = () => {
    if (fields.length >= maximumMappedFields) return;
    setFields((current) => [...current, { ...emptyFieldMapping }]);
    invalidatePreview();
  };

  const removeField = (index: number) => {
    setFields((current) => current.filter((_, fieldIndex) => fieldIndex !== index));
    invalidatePreview();
  };

  const submitPreview = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const sourceId = settings.sourceId.trim();
    const entityType = settings.entityType.trim();
    const keyColumn = settings.keyColumn.trim();
    const headerRow = positiveInteger(settings.headerRow);
    const firstDataRow = positiveInteger(settings.firstDataRow);
    if (!file) {
      setNotice({ tone: "error", text: "Выберите файл XLSX." });
      return;
    }
    if (!sourceId || !entityType || !keyColumn || headerRow === null || firstDataRow === null || firstDataRow <= headerRow) {
      setNotice({ tone: "error", text: "Заполните источник, тип записи и ключевой столбец; строка данных должна идти после заголовков." });
      return;
    }
    const mappedFields: readonly XlsxFieldMapping[] | null = manualMapping
      ? fields.map((field) => ({
        ...field,
        sourceColumn: field.sourceColumn.trim(),
        targetProperty: field.targetProperty.trim(),
        notApplicableTokens: field.notApplicableTokens?.map((token) => token.trim()).filter(Boolean),
      }))
      : null;
    if (manualMapping && (mappedFields === null || mappedFields.length === 0 || mappedFields.some((field) => !field.sourceColumn || !field.targetProperty))) {
      setNotice({ tone: "error", text: "Заполните исходный столбец и поле назначения во всех строках сопоставления." });
      return;
    }

    setBusy("preview");
    setNotice(null);
    setAcknowledgedWarnings(new Set());
    setPreviewStale(false);
    setPreviewPublished(false);
    try {
      const result = await api.previewXlsx(sourceId, {
        fileName: file.name,
        contentBase64: await xlsxFileToBase64(file),
        sheetName: settings.sheetName.trim() || null,
        headerRow,
        firstDataRow,
        entityType,
        keyColumn,
        fields: mappedFields,
      });
      setPreview(result);
      setSheetOptions(result.sheets);
      setNow(Date.now());
      setNotice(result.canPublish
        ? { tone: "success", text: `Проверка завершена: подготовлено записей — ${result.recordCount}.` }
        : { tone: "error", text: "Файл проверен, но содержит блокирующие ошибки. Активная версия не изменена." });
    } catch (error) {
      setPreview(null);
      const diagnostics = error instanceof ReferenceCatalogApiError ? error.diagnostics : [];
      setNotice({
        tone: "error",
        text: diagnostics.length > 0
          ? `${errorText(error)} Диагностик: ${diagnostics.length}.`
          : errorText(error),
      });
    } finally {
      setBusy(null);
    }
  };

  const toggleWarning = (diagnosticId: string, checked: boolean) => {
    setAcknowledgedWarnings((current) => {
      const next = new Set(current);
      if (checked) next.add(diagnosticId);
      else next.delete(diagnosticId);
      return next;
    });
  };

  const publishPreview = async () => {
    if (!canPublishXlsxPreview(preview, acknowledgedWarnings, now, previewStale) || !preview?.validationSha256) return;
    setBusy("publish");
    setNotice(null);
    try {
      const publication = await api.publishXlsx(settings.sourceId.trim(), {
        previewId: preview.previewId,
        expectedValidationSha256: preview.validationSha256,
        expectedActiveSnapshotId: preview.activeSnapshotId,
        acknowledgedWarningIds: [...acknowledgedWarnings],
      });
      activeRequestRef.current += 1;
      setActive(publication.snapshot);
      setActiveError(null);
      setPreviewPublished(true);
      setNotice({
        tone: "success",
        text: publication.status === "unchanged"
          ? "Данные совпадают с активной версией. Новая версия не создавалась."
          : `Опубликована новая версия: ${publication.snapshot.records.length} записей.`,
      });
    } catch (error) {
      if (error instanceof ReferenceCatalogApiError && stalePreviewCodes.has(error.code ?? "")) {
        setPreviewStale(true);
        void loadActive(false);
      }
      setNotice({ tone: "error", text: errorText(error) });
    } finally {
      setBusy(null);
    }
  };

  const warningIds = preview ? requiredWarningIds(preview) : [];
  const expiresAt = preview ? Date.parse(preview.expiresUtc) : 0;
  const previewExpired = preview !== null && expiresAt <= now;
  const publishEnabled = canPublishXlsxPreview(
    preview,
    acknowledgedWarnings,
    now,
    previewStale || previewPublished,
  );

  return (
    <div className="reference-workspace">
      <div className="content-heading reference-heading">
        <div>
          <p className="eyebrow">ЛОКАЛЬНЫЕ ДАННЫЕ</p>
          <h1>Справочники</h1>
          <p>Проверьте XLSX перед публикацией. Ошибочный файл не заменит активную версию.</p>
        </div>
        <button className="secondary-action" type="button" onClick={() => void loadActive(true)} disabled={busy !== null}>
          {busy === "active" ? "Обновление…" : "Обновить статус"}
        </button>
      </div>

      {notice && (
        <div className={`reference-notice ${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}>
          <span>{notice.text}</span>
          <button type="button" aria-label="Закрыть сообщение" onClick={() => setNotice(null)}>×</button>
        </div>
      )}

      <section className="active-reference-card" aria-labelledby="active-reference-title">
        <div>
          <p className="eyebrow">ТЕКУЩЕЕ СОСТОЯНИЕ</p>
          <h2 id="active-reference-title">Активная версия</h2>
        </div>
        {activeError ? (
          <p className="reference-state error">{activeError}</p>
        ) : active === undefined ? (
          <p className="reference-state" role="status">Загружаем…</p>
        ) : active === null ? (
          <p className="reference-state empty">Версия ещё не опубликована</p>
        ) : (
          <dl className="active-reference-facts">
            <div><dt>Записей</dt><dd>{active.records.length}</dd></div>
            <div><dt>Источник</dt><dd>{active.sourceUri ?? active.sourceKind}</dd></div>
            <div><dt>Снимок создан</dt><dd>{formatDateTime(active.capturedUtc)}</dd></div>
            <div><dt>Хеш</dt><dd title={active.sha256}>{active.sha256.slice(0, 12)}…</dd></div>
          </dl>
        )}
      </section>

      <form className="reference-import-card" onSubmit={submitPreview}>
        <div className="section-title-row reference-card-title">
          <div>
            <p className="eyebrow">ШАГ 1</p>
            <h2>Файл и правила чтения</h2>
          </div>
          <span className="selected-file" title={file?.name}>{fileSelectionLabel(file)}</span>
        </div>

        <div className="reference-form-grid">
          <label className="file-picker wide-reference-field">
            <span>Файл XLSX</span>
            <span className="file-picker-control"><strong>Выбрать XLSX</strong><input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={selectFile} disabled={busy !== null} /></span>
            <small>До 25 МиБ. Макросы, внешние связи и формулы в импортируемых полях запрещены.</small>
          </label>
          <label>
            Идентификатор источника
            <input value={settings.sourceId} onChange={(event) => changeSetting({ sourceId: event.target.value })} disabled={busy !== null} required />
          </label>
          <label>
            Лист
            <input list="xlsx-sheet-options" placeholder="Первый видимый лист" value={settings.sheetName} onChange={(event) => changeSetting({ sheetName: event.target.value })} disabled={busy !== null} />
            <datalist id="xlsx-sheet-options">
              {sheetOptions.map((sheet) => <option value={sheet.name} key={sheet.name}>{sheet.hidden ? "Скрытый лист" : "Доступный лист"}</option>)}
            </datalist>
          </label>
          <label>
            Строка заголовков
            <input type="number" min="1" max="100000" step="1" value={settings.headerRow} onChange={(event) => changeSetting({ headerRow: event.target.value })} disabled={busy !== null} required />
          </label>
          <label>
            Первая строка данных
            <input type="number" min="2" max="100000" step="1" value={settings.firstDataRow} onChange={(event) => changeSetting({ firstDataRow: event.target.value })} disabled={busy !== null} required />
          </label>
          <label>
            Тип записи
            <input placeholder="Например, terminal" value={settings.entityType} onChange={(event) => changeSetting({ entityType: event.target.value })} disabled={busy !== null} required />
          </label>
          <label>
            Ключевой столбец
            <input placeholder="Точное имя заголовка" value={settings.keyColumn} onChange={(event) => changeSetting({ keyColumn: event.target.value })} disabled={busy !== null} required />
          </label>
        </div>

        <div className="mapping-section">
          <label className="mapping-toggle">
            <input type="checkbox" checked={manualMapping} onChange={(event) => {
              setManualMapping(event.target.checked);
              invalidatePreview();
            }} disabled={busy !== null} />
            <span><strong>Настроить сопоставление вручную</strong><small>Иначе все столбцы, кроме ключевого, будут импортированы с исходными именами.</small></span>
          </label>

          {manualMapping && (
            <div className="mapping-editor">
              <div className="mapping-header" aria-hidden="true">
                <span>Столбец XLSX</span><span>Поле записи</span><span>Тип</span><span>Обязательное</span><span />
              </div>
              {fields.map((field, index) => (
                <div className="mapping-row" key={index}>
                  <input aria-label={`Исходный столбец ${index + 1}`} value={field.sourceColumn} onChange={(event) => updateField(index, { sourceColumn: event.target.value })} disabled={busy !== null} />
                  <input aria-label={`Поле назначения ${index + 1}`} value={field.targetProperty} onChange={(event) => updateField(index, { targetProperty: event.target.value })} disabled={busy !== null} />
                  <select aria-label={`Тип поля ${index + 1}`} value={field.valueKind} onChange={(event) => updateField(index, { valueKind: event.target.value as XlsxFieldValueKind })} disabled={busy !== null}>
                    {Object.entries(valueKindLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                  </select>
                  <label className="required-toggle"><input type="checkbox" checked={field.required} onChange={(event) => updateField(index, { required: event.target.checked })} disabled={busy !== null} /><span>Да</span></label>
                  <button className="mapping-remove" type="button" aria-label={`Удалить сопоставление ${index + 1}`} onClick={() => removeField(index)} disabled={busy !== null}>×</button>
                  <div className="mapping-policy">
                    <label>
                      Неприменимые значения
                      <input
                        aria-label={`Маркеры неприменимого значения ${index + 1}`}
                        placeholder="Например: -, н/д"
                        value={(field.notApplicableTokens ?? []).join(", ")}
                        onChange={(event) => updateField(index, {
                          notApplicableTokens: event.target.value.split(",").map((token) => token.trim()).filter(Boolean),
                        })}
                        disabled={busy !== null}
                      />
                    </label>
                    <label className="required-toggle">
                      <input type="checkbox" checked={field.allowNotApplicable ?? false} onChange={(event) => updateField(index, { allowNotApplicable: event.target.checked })} disabled={busy !== null} />
                      <span>Разрешить как «не применимо»</span>
                    </label>
                    <label className="required-toggle">
                      <input type="checkbox" checked={field.allowBlank ?? false} onChange={(event) => updateField(index, { allowBlank: event.target.checked })} disabled={busy !== null} />
                      <span>Разрешить пустую ячейку</span>
                    </label>
                  </div>
                </div>
              ))}
              <button className="link-button mapping-add" type="button" onClick={addField} disabled={busy !== null || fields.length >= maximumMappedFields}>+ Добавить поле</button>
            </div>
          )}
        </div>

        <div className="reference-form-actions">
          <button className="primary-action" type="submit" disabled={busy !== null}>
            {busy === "preview" ? "Проверяем файл…" : "Проверить файл"}
          </button>
          <span>Публикация выполняется отдельным действием после проверки.</span>
        </div>
      </form>

      {!preview && (
        <section className="reference-preview-card preview-empty" aria-label="Предварительный просмотр">
          <strong>Сначала проверьте файл</strong>
          <span>Здесь появятся строки, сопоставленные поля и адресные сообщения проверки.</span>
        </section>
      )}

      {preview && (
        <section className="reference-preview-card" aria-labelledby="reference-preview-title">
          <div className="section-title-row reference-card-title">
            <div>
              <p className="eyebrow">ШАГ 2</p>
              <h2 id="reference-preview-title">Предварительный просмотр</h2>
            </div>
            <span className={`preview-status ${preview.canPublish && !previewStale && !previewExpired ? "ready" : "blocked"}`}>
              {previewPublished ? "Опубликовано" : previewStale ? "Нужна повторная проверка" : previewExpired ? "Просмотр истёк" : preview.canPublish ? "Готово к публикации" : "Есть ошибки"}
            </span>
          </div>

          <dl className="preview-facts">
            <div><dt>Лист</dt><dd>{preview.selectedSheet}</dd></div>
            <div><dt>Строк в источнике</dt><dd>{preview.sourceRowCount}</dd></div>
            <div><dt>Записей</dt><dd>{preview.recordCount}</dd></div>
            <div><dt>Действует до</dt><dd>{formatDateTime(preview.expiresUtc)}</dd></div>
          </dl>

          {preview.isTruncated && <p className="preview-limit" role="note">Показаны первые 100 записей. При публикации будет сохранён весь проверенный набор.</p>}

          {preview.diagnostics.length > 0 ? (
            <div className="diagnostics" aria-label="Результаты проверки">
              <h3>Диагностика · {preview.diagnostics.length}</h3>
              {preview.diagnostics.map((diagnostic) => (
                <div className={`diagnostic ${diagnostic.severity}`} key={diagnostic.diagnosticId}>
                  {diagnostic.severity === "warning" && (
                    <input
                      type="checkbox"
                      aria-label={`Подтвердить предупреждение ${diagnostic.message}`}
                      checked={acknowledgedWarnings.has(diagnostic.diagnosticId)}
                      onChange={(event) => toggleWarning(diagnostic.diagnosticId, event.target.checked)}
                      disabled={busy !== null || previewStale || previewExpired}
                    />
                  )}
                  <div>
                    <strong>{diagnostic.severity === "warning" ? "Предупреждение" : "Ошибка"}: {diagnostic.message}</strong>
                    <span>{[diagnostic.sourceLocation, diagnostic.field, diagnostic.sourceKey].filter(Boolean).join(" · ") || diagnostic.code}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="validation-ok">Ошибок и предупреждений не найдено.</p>
          )}

          {preview.records.length > 0 && (
            <div className="preview-table-scroll">
              <table className="preview-table">
                <thead><tr><th>Строка</th><th>Ключ</th>{preview.columns.map((column) => <th key={column.targetProperty}>{column.targetProperty}</th>)}</tr></thead>
                <tbody>
                  {preview.records.map((record) => (
                    <tr key={`${record.rowNumber}-${record.sourceKey}`}>
                      <td>{record.rowNumber}</td>
                      <td><strong>{record.sourceKey}</strong></td>
                      {preview.columns.map((column) => <td key={column.targetProperty}>{formatCell(record.payload[column.targetProperty])}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="publication-bar">
            <div>
              <strong>Опубликовать проверенную версию</strong>
              <span>{warningIds.length > 0
                ? `Подтверждено предупреждений: ${acknowledgedWarnings.size} из ${warningIds.length}`
                : "Активная версия изменится только после нажатия кнопки."}</span>
            </div>
            <button className="primary-action" type="button" onClick={() => void publishPreview()} disabled={!publishEnabled || busy !== null}>
              {busy === "publish" ? "Публикуем…" : "Опубликовать"}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
