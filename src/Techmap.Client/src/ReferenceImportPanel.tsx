import { type ChangeEvent, type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LocalSession } from "./local-session";
import {
  createReferenceCatalogApi,
  isAbortError,
  ReferenceCatalogApiError,
  type GoogleSheetsProfilePreviewRequest,
  type ReferenceCatalogDiagnostic,
  type ReferenceCatalogSourceSummary,
  type ReferenceCatalogSnapshot,
  type XlsxFieldMapping,
  type XlsxFieldValueKind,
  type XlsxImportProfile,
  type XlsxReferencePreview,
  xlsxFileToBase64,
} from "./reference-catalog-api";
import type { RuntimeConfig } from "./runtime-config";
import { EditableReferenceTable } from "./EditableReferenceTable";

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
type ReferenceInputMode = "xlsx" | "google-sheets";

const initialSettings: ImportSettings = {
  sourceId: "technology-database",
  sheetName: "",
  headerRow: "1",
  firstDataRow: "2",
  entityType: "generic-record",
  keyColumn: "RecordKey",
};

const connectorReferenceSourceId = "technology-connectors";

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
  _acknowledgedWarningIds: ReadonlySet<string>,
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
  return true;
}

export function fileSelectionLabel(file: Pick<File, "name" | "size"> | null): string {
  return file === null ? "Файл не выбран" : `${file.name} · ${Math.ceil(file.size / 1024)} КиБ`;
}

export function profileCountLabel(count: number): string {
  const modulo100 = count % 100;
  const modulo10 = count % 10;
  const noun = modulo100 >= 11 && modulo100 <= 14
    ? "профилей"
    : modulo10 === 1 ? "профиль" : modulo10 >= 2 && modulo10 <= 4 ? "профиля" : "профилей";
  return `${count} ${noun}`;
}

export function russianCountLabel(count: number, forms: readonly [string, string, string]): string {
  const absolute = Math.abs(count);
  const modulo100 = absolute % 100;
  const modulo10 = absolute % 10;
  const noun = modulo100 >= 11 && modulo100 <= 14
    ? forms[2]
    : modulo10 === 1 ? forms[0] : modulo10 >= 2 && modulo10 <= 4 ? forms[1] : forms[2];
  return `${count} ${noun}`;
}

/** The catalog keeps stable machine-readable diagnostics; only the display text is simplified. */
export function referenceDiagnosticMessage(diagnostic: ReferenceCatalogDiagnostic): string {
  if (diagnostic.code === "xlsx_cached_formula_values_used") {
    const count = diagnostic.message.match(/\((\d+)\)/)?.[1];
    return `Взяты сохранённые конечные значения формул${count ? `: ${russianCountLabel(Number(count), ["ячейка", "ячейки", "ячеек"])}` : ""}.`;
  }
  if (diagnostic.code === "xlsx_profile_field_incomplete") {
    const count = diagnostic.message.match(/\b(\d+)\s+строк/iu)?.[1];
    return `В профиле есть незаполненные строки${count ? `: ${russianCountLabel(Number(count), ["строка", "строки", "строк"])}` : ""}. Проверьте таблицу.`;
  }
  return diagnostic.message;
}

interface ReferenceDiagnosticItemProps {
  readonly diagnostic: ReferenceCatalogDiagnostic;
}

export function ReferenceDiagnosticItem({ diagnostic }: ReferenceDiagnosticItemProps) {
  const message = referenceDiagnosticMessage(diagnostic);
  const details = [
    diagnostic.message !== message ? ["Исходное сообщение", diagnostic.message] : null,
    diagnostic.sourceLocation ? ["Место", diagnostic.sourceLocation] : null,
    diagnostic.field ? ["Поле данных", diagnostic.field] : null,
    diagnostic.sourceKey ? ["Ключ записи", diagnostic.sourceKey] : null,
    ["Код проверки", diagnostic.code],
  ].filter((item): item is string[] => item !== null);
  return (
    <div className={`diagnostic ${diagnostic.severity}`}>
      {diagnostic.severity === "warning" && <span className="diagnostic-mark" aria-hidden="true">!</span>}
      <div className="diagnostic-content">
        <strong>{diagnostic.severity === "warning" ? "Предупреждение" : "Ошибка"}: {message}</strong>
        <details className="diagnostic-details">
          <summary>Подробности проверки</summary>
          <dl>{details.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        </details>
      </div>
    </div>
  );
}

export function ReferenceValidationDiagnostics({ diagnostics }: {
  readonly diagnostics: readonly ReferenceCatalogDiagnostic[] | null;
}) {
  const errors = diagnostics?.filter((diagnostic) => diagnostic.severity === "error") ?? [];
  const warnings = diagnostics?.filter((diagnostic) => diagnostic.severity === "warning") ?? [];
  return <>
    <div className="reference-validation-heading">
      <strong id="reference-errors-title">Ошибки</strong>
      <span>{errors.length}</span>
    </div>
    {diagnostics === null
      ? <p className="reference-state">Здесь появятся блокирующие ошибки проверки.</p>
      : errors.length > 0
      ? <div className="diagnostics" aria-label="Блокирующие ошибки">
          {errors.map((diagnostic) => <ReferenceDiagnosticItem key={diagnostic.diagnosticId} diagnostic={diagnostic} />)}
        </div>
      : <p className="validation-ok">Блокирующих ошибок нет.</p>}
    {warnings.length > 0 && <details className="reference-warning-log">
      <summary>Предупреждений: {warnings.length}</summary>
      <p className="reference-warning-summary">При успешной проверке предупреждения принимаются автоматически.</p>
      <div className="diagnostics" aria-label="Предупреждения проверки">
        {warnings.map((diagnostic) => <ReferenceDiagnosticItem key={diagnostic.diagnosticId} diagnostic={diagnostic} />)}
      </div>
    </details>}
  </>;
}

export function googleSheetsProfilePreviewRequest(
  url: string,
  profileId: string,
): GoogleSheetsProfilePreviewRequest {
  const normalizedUrl = url.trim();
  const normalizedProfileId = profileId.trim();
  if (!normalizedUrl) throw new Error("Вставьте публичную ссылку Google Sheets.");
  if (!normalizedProfileId) throw new Error("Выберите профиль таблицы Google Sheets.");
  return { url: normalizedUrl, profileId: normalizedProfileId };
}

interface XlsxProfilePickerProps {
  readonly profiles: readonly XlsxImportProfile[] | undefined;
  readonly error: string | null;
  readonly selectedProfileId: string;
  readonly disabled: boolean;
  readonly onSelect: (profileId: string) => void;
}

export function XlsxProfilePicker({
  profiles,
  error,
  selectedProfileId,
  disabled,
  onSelect,
}: XlsxProfilePickerProps) {
  const selectedProfile = profiles?.find((profile) => profile.profileId === selectedProfileId) ?? null;
  if (profiles === undefined) return <p className="xlsx-profile-state" role="status">Загружаем список таблиц…</p>;
  if (error) return <p className="xlsx-profile-state error" role="alert">Не удалось загрузить профили: {error}</p>;
  if (profiles.length === 0) {
    return <p className="xlsx-profile-state">Готовые профили пока недоступны. Используйте универсальный импорт ниже.</p>;
  }
  return (
    <div className="xlsx-profile-picker">
      <label>
        Профиль справочника
        <select value={selectedProfileId} onChange={(event) => onSelect(event.target.value)} disabled={disabled}>
          {profiles.map((profile) => <option value={profile.profileId} key={profile.profileId}>{profile.displayName}</option>)}
        </select>
      </label>
      {selectedProfile && (
        <div className="xlsx-profile-description">
          <strong>{selectedProfile.displayName}</strong>
          <p>{selectedProfile.description}</p>
          <dl>
            <div><dt>Лист</dt><dd>{selectedProfile.sheetName}</dd></div>
            <div><dt>Ключ</dt><dd>{selectedProfile.keyColumn}</dd></div>
          </dl>
        </div>
      )}
    </div>
  );
}

export function ReferenceImportPanel({ config, session }: ReferenceImportPanelProps) {
  const api = useMemo(() => createReferenceCatalogApi(config, session), [config, session]);
  const [settings, setSettings] = useState<ImportSettings>(initialSettings);
  const [profiles, setProfiles] = useState<readonly XlsxImportProfile[] | undefined>(undefined);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [editableSourceId, setEditableSourceId] = useState("");
  const [newSourceId, setNewSourceId] = useState(connectorReferenceSourceId);
  const [sources, setSources] = useState<readonly ReferenceCatalogSourceSummary[] | undefined>(undefined);
  const [sourcesError, setSourcesError] = useState<string | null>(null);
  const [inputMode, setInputMode] = useState<ReferenceInputMode>("xlsx");
  const [googleSheetsUrl, setGoogleSheetsUrl] = useState("");
  const [manualMode, setManualMode] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [sheetOptions, setSheetOptions] = useState<readonly { readonly name: string; readonly hidden: boolean }[]>([]);
  const [manualMapping, setManualMapping] = useState(false);
  const [fields, setFields] = useState<readonly XlsxFieldMapping[]>([{ ...emptyFieldMapping }]);
  const [active, setActive] = useState<ReferenceCatalogSnapshot | null | undefined>(undefined);
  const [activeError, setActiveError] = useState<string | null>(null);
  const [preview, setPreview] = useState<XlsxReferencePreview | null>(null);
  const [previewStale, setPreviewStale] = useState(false);
  const [previewPublished, setPreviewPublished] = useState(false);
  const [busy, setBusy] = useState<"preview" | "publish" | "active" | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [now, setNow] = useState(Date.now());
  const activeRequestRef = useRef(0);
  const previewAbortRef = useRef<AbortController | null>(null);
  const selectedProfile = profiles?.find((profile) => profile.profileId === selectedProfileId) ?? null;
  const activeSourceId = editableSourceId.trim();

  const loadSources = useCallback(async (preferredSourceId?: string) => {
    try {
      const result = await api.listSources();
      setSources(result);
      setSourcesError(null);
      setEditableSourceId((current) => preferredSourceId && result.some((source) => source.sourceId === preferredSourceId)
        ? preferredSourceId
        : result.some((source) => source.sourceId === current) ? current : result[0]?.sourceId ?? "");
    } catch (error) {
      setSources([]);
      setSourcesError(errorText(error));
    }
  }, [api]);

  useEffect(() => { void loadSources(); }, [loadSources]);

  useEffect(() => {
    let cancelled = false;
    void api.getXlsxProfiles().then((result) => {
      if (cancelled) return;
      setProfiles(result);
      setProfileError(null);
      setSelectedProfileId((current) => result.some((profile) => profile.profileId === current)
        ? current
        : result[0]?.profileId ?? "");
    }).catch((error: unknown) => {
      if (cancelled) return;
      setProfiles([]);
      setProfileError(errorText(error));
    });
    return () => { cancelled = true; };
  }, [api]);

  const loadActive = useCallback(async (showBusy: boolean) => {
    const sourceId = activeSourceId;
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
  }, [activeSourceId, api]);

  useEffect(() => {
    let cancelled = false;
    const sourceId = activeSourceId;
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
  }, [activeSourceId, api]);

  useEffect(() => {
    if (preview === null) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, [preview]);

  useEffect(() => () => {
    const request = previewAbortRef.current;
    previewAbortRef.current = null;
    request?.abort();
  }, []);

  const invalidatePreview = () => {
    setPreview(null);
    setPreviewStale(false);
    setPreviewPublished(false);
    setNotice(null);
  };

  const changeSetting = (patch: Readonly<Partial<ImportSettings>>) => {
    setSettings((current) => ({ ...current, ...patch }));
    invalidatePreview();
  };

  const selectProfile = (profileId: string) => {
    setSelectedProfileId(profileId);
    invalidatePreview();
  };

  const changeImportMode = (manual: boolean) => {
    const request = previewAbortRef.current;
    previewAbortRef.current = null;
    request?.abort();
    setBusy((current) => current === "preview" ? null : current);
    setManualMode(manual);
    invalidatePreview();
  };

  const changeInputMode = (mode: ReferenceInputMode) => {
    const request = previewAbortRef.current;
    previewAbortRef.current = null;
    request?.abort();
    setBusy((current) => current === "preview" ? null : current);
    setInputMode(mode);
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

  const publishValidatedPreview = async (candidate: XlsxReferencePreview) => {
    if (!candidate.canPublish || !candidate.validationSha256) return false;
    setBusy("publish");
    try {
      const publication = await api.publishXlsx(candidate.sourceId, {
        previewId: candidate.previewId,
        expectedValidationSha256: candidate.validationSha256,
        expectedActiveSnapshotId: candidate.activeSnapshotId,
        acknowledgedWarningIds: requiredWarningIds(candidate),
      });
      if (publication.snapshot.sourceId === activeSourceId) {
        activeRequestRef.current += 1;
        setActive(publication.snapshot);
        setActiveError(null);
      }
      void loadSources(publication.snapshot.sourceId);
      setPreviewPublished(true);
      setNotice({
        tone: "success",
        text: publication.status === "unchanged"
          ? "Данные совпадают с активной версией. Новая версия не создавалась."
          : `Таблица опубликована: ${publication.snapshot.records.length} записей.`,
      });
      return true;
    } catch (error) {
      if (error instanceof ReferenceCatalogApiError && stalePreviewCodes.has(error.code ?? "")) {
        setPreviewStale(true);
        void loadActive(false);
      }
      setNotice({ tone: "error", text: errorText(error) });
      return false;
    } finally {
      setBusy(null);
    }
  };

  const submitPreview = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (inputMode === "xlsx" && !file) {
      setNotice({ tone: "error", text: "Выберите файл XLSX." });
      return;
    }
    if ((inputMode === "google-sheets" || !manualMode) && !selectedProfile) {
      setNotice({ tone: "error", text: "Выберите профиль справочника." });
      return;
    }

    previewAbortRef.current?.abort();
    const previewController = new AbortController();
    previewAbortRef.current = previewController;
    setBusy("preview");
    setNotice(null);
    setPreviewStale(false);
    setPreviewPublished(false);
    try {
      let result: XlsxReferencePreview;
      if (inputMode === "google-sheets") {
        const profile = selectedProfile!;
        result = await api.previewGoogleSheetsProfile(
          profile.sourceId,
          googleSheetsProfilePreviewRequest(googleSheetsUrl, profile.profileId),
          previewController.signal,
        );
      } else if (manualMode) {
        const contentBase64 = await xlsxFileToBase64(file!);
        const sourceId = settings.sourceId.trim();
        const entityType = settings.entityType.trim();
        const keyColumn = settings.keyColumn.trim();
        const headerRow = positiveInteger(settings.headerRow);
        const firstDataRow = positiveInteger(settings.firstDataRow);
        if (!sourceId || !entityType || !keyColumn || headerRow === null || firstDataRow === null || firstDataRow <= headerRow) {
          throw new Error("Заполните источник, тип записи и ключевой столбец; строка данных должна идти после заголовков.");
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
          throw new Error("Заполните исходный столбец и поле назначения во всех строках сопоставления.");
        }
        result = await api.previewXlsx(sourceId, {
          fileName: file!.name,
          contentBase64,
          sheetName: settings.sheetName.trim() || null,
          headerRow,
          firstDataRow,
          entityType,
          keyColumn,
          fields: mappedFields,
        }, previewController.signal);
      } else {
        const contentBase64 = await xlsxFileToBase64(file!);
        const profile = selectedProfile!;
        result = await api.previewXlsxProfile(profile.sourceId, {
          fileName: file!.name,
          contentBase64,
          profileId: profile.profileId,
        }, previewController.signal);
      }
      if (previewAbortRef.current !== previewController) return;
      setPreview(result);
      setSheetOptions(result.sheets);
      setNow(Date.now());
      if (result.canPublish) {
        await publishValidatedPreview(result);
      } else {
        setNotice({ tone: "error", text: "Источник проверен, но содержит блокирующие ошибки. Активная версия не изменена." });
      }
    } catch (error) {
      if (isAbortError(error) || previewAbortRef.current !== previewController) return;
      setPreview(null);
      const diagnostics = error instanceof ReferenceCatalogApiError ? error.diagnostics : [];
      setNotice({
        tone: "error",
        text: diagnostics.length > 0
          ? `${errorText(error)} Диагностик: ${diagnostics.length}.`
          : errorText(error),
      });
    } finally {
      if (previewAbortRef.current === previewController) {
        previewAbortRef.current = null;
        setBusy(null);
      }
    }
  };

  const publishPreview = async () => {
    if (!preview || !canPublishXlsxPreview(preview, new Set(), now, previewStale || previewPublished)) return;
    await publishValidatedPreview(preview);
  };

  const expiresAt = preview ? Date.parse(preview.expiresUtc) : 0;
  const previewExpired = preview !== null && expiresAt <= now;
  const publishEnabled = canPublishXlsxPreview(
    preview,
    new Set(),
    now,
    previewStale || previewPublished,
  );

  const importForm = (
      <form className="reference-import-card" onSubmit={submitPreview}>
        <div className="section-title-row reference-card-title">
          <div>
            <p className="eyebrow">ШАГ 1</p>
            <h2>Выбор таблицы и источника</h2>
          </div>
          <span className="selected-file" title={inputMode === "xlsx" ? file?.name : googleSheetsUrl}>
            {inputMode === "xlsx" ? fileSelectionLabel(file) : "Публичная Google Sheets"}
          </span>
        </div>

        <fieldset className="reference-source-switch">
          <legend>Источник данных</legend>
          <button type="button" className={inputMode === "xlsx" ? "selected" : ""} aria-pressed={inputMode === "xlsx"} onClick={() => changeInputMode("xlsx")} disabled={busy !== null && busy !== "preview"}>
            Файл XLSX
          </button>
          <button type="button" className={inputMode === "google-sheets" ? "selected" : ""} aria-pressed={inputMode === "google-sheets"} onClick={() => changeInputMode("google-sheets")} disabled={busy !== null && busy !== "preview"}>
            Google Sheets <span>экспериментально</span>
          </button>
          <small>Google Sheets читается только по публичной ссылке и остаётся источником только для чтения.</small>
        </fieldset>

        {inputMode === "xlsx" ? (
          <div className="xlsx-format-guide" role="note" aria-label="Какой XLSX выбрать">
            <strong>Какой файл нужен</strong>
            <p>
              Выберите рабочую книгу <code>База данных. Технология.xlsx</code> целиком.
              Ниже укажите, какую таблицу из книги загрузить: приложение само выберет лист,
              строки, ключ и характеристики.
            </p>
            <p>
              В списке показываются все готовые профили. Новые таблицы будут появляться здесь
              автоматически по мере подготовки правил импорта.
            </p>
          </div>
        ) : (
          <div className="google-sheets-guide" role="note" aria-label="Импорт из Google Sheets">
            <div><strong>Публичная Google Sheets</strong><span>ЭКСПЕРИМЕНТАЛЬНО</span></div>
            <p>Откройте доступ «Все, у кого есть ссылка», затем вставьте ссылку на таблицу. Приложение только читает источник и не изменяет данные в Google.</p>
            <label>
              Ссылка на Google Sheets
              <input
                type="url"
                inputMode="url"
                placeholder="docs.google.com/spreadsheets/d/…"
                value={googleSheetsUrl}
                onChange={(event) => {
                  setGoogleSheetsUrl(event.target.value);
                  invalidatePreview();
                }}
                disabled={busy !== null}
                required
              />
            </label>
          </div>
        )}

        <section className="xlsx-profile-section" aria-labelledby="xlsx-profile-heading">
          <div className="xlsx-profile-heading">
            <div>
              <strong id="xlsx-profile-heading">Что загрузить</strong>
              <span>Одна публикация обновляет один справочник.</span>
            </div>
            {(inputMode === "google-sheets" || !manualMode) && profiles && <span>{profileCountLabel(profiles.length)}</span>}
          </div>
          <XlsxProfilePicker
            profiles={profiles}
            error={profileError}
            selectedProfileId={selectedProfileId}
            disabled={busy !== null || (inputMode === "xlsx" && manualMode)}
            onSelect={selectProfile}
          />
        </section>

        {inputMode === "xlsx" && <div className="reference-form-grid profile-file-grid">
            <label className="file-picker wide-reference-field">
              <span>Файл XLSX</span>
              <span className="file-picker-control"><strong>Выбрать рабочую книгу</strong><input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={selectFile} disabled={busy !== null} /></span>
              <small>До 25 МиБ. Обычные ссылки на сайты разрешены; внешние книги, подключения к данным и макросы запрещены.</small>
            </label>
          </div>}

        {inputMode === "xlsx" && <details className="manual-import-details" open={manualMode} onToggle={(event) => {
          if (event.currentTarget.open !== manualMode) changeImportMode(event.currentTarget.open);
        }}>
          <summary>
            <span><strong>Универсальный импорт</strong><small>Для отдельного нестандартного листа с ручной настройкой</small></span>
          </summary>
          <div className="reference-form-grid manual-import-grid">
            <label>
              Идентификатор источника
              <input value={settings.sourceId} onChange={(event) => changeSetting({ sourceId: event.target.value })} disabled={busy !== null} required={manualMode} />
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
              <input type="number" min="1" max="100000" step="1" value={settings.headerRow} onChange={(event) => changeSetting({ headerRow: event.target.value })} disabled={busy !== null} required={manualMode} />
            </label>
            <label>
              Первая строка данных
              <input type="number" min="2" max="100000" step="1" value={settings.firstDataRow} onChange={(event) => changeSetting({ firstDataRow: event.target.value })} disabled={busy !== null} required={manualMode} />
            </label>
            <label>
              Тип записи
              <input placeholder="Например, terminal" value={settings.entityType} onChange={(event) => changeSetting({ entityType: event.target.value })} disabled={busy !== null} required={manualMode} />
            </label>
            <label>
              Ключевой столбец
              <input placeholder="Точное имя заголовка" value={settings.keyColumn} onChange={(event) => changeSetting({ keyColumn: event.target.value })} disabled={busy !== null} required={manualMode} />
              <small>Столбец с уникальным текстовым артикулом или кодом записи.</small>
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
        </details>}

        <div className="reference-form-actions">
          <button className="primary-action" type="submit" disabled={busy !== null && busy !== "preview"}>
            {busy === "preview"
              ? inputMode === "google-sheets" ? "Читаем Google Sheets…" : "Проверяем файл…"
              : inputMode === "google-sheets" ? "Проверить Google Sheets"
                : manualMode ? "Проверить универсальный импорт"
                  : selectedProfile ? `Проверить ${selectedProfile.displayName.split(" — ")[0]}` : "Проверить таблицу"}
          </button>
          <span>После успешной проверки таблица публикуется автоматически.</span>
        </div>
      </form>
  );

  return (
    <div className="reference-workspace">
      <div className="content-heading reference-heading">
        <div>
          <p className="eyebrow">ЛОКАЛЬНЫЕ ДАННЫЕ</p>
          <h1>Справочники</h1>
          <p>Загрузите нужную таблицу из рабочей книги. Настройки листа и столбцов применятся автоматически.</p>
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

      <section className="reference-tables-workspace" aria-labelledby="active-reference-title">
        <aside className="reference-source-sidebar" aria-label="Загруженные справочники">
          <div><p className="eyebrow">ЗАГРУЖЕННЫЕ ТАБЛИЦЫ</p><h2 id="active-reference-title">Справочники</h2></div>
          {sources === undefined && <p className="reference-state" role="status">Загружаем список…</p>}
          {sourcesError && <p className="reference-state error">{sourcesError}</p>}
          {sources?.length === 0 && <p className="reference-state empty">Загруженных таблиц пока нет.</p>}
          <div className="reference-source-list">
            {sources?.map((source) => <button
              type="button"
              key={source.sourceId}
              className={source.sourceId === activeSourceId ? "selected" : ""}
              aria-pressed={source.sourceId === activeSourceId}
              disabled={busy !== null}
              onClick={() => setEditableSourceId(source.sourceId)}
            ><strong>{profiles?.find((profile) => profile.sourceId === source.sourceId)?.displayName ?? source.displayName}</strong>
              <span>{source.sourceId}</span><em>{russianCountLabel(source.recordCount, ["строка", "строки", "строк"])}</em></button>)}
          </div>
          <form className="reference-new-source" onSubmit={(event) => {
            event.preventDefault();
            const sourceId = newSourceId.trim();
            if (sourceId) setEditableSourceId(sourceId);
          }}>
            <label>Новая таблица<input value={newSourceId} onChange={(event) => setNewSourceId(event.target.value)} disabled={busy !== null} /></label>
            <button type="submit" className="secondary-action" disabled={busy !== null || !newSourceId.trim()}>Создать</button>
          </form>
          <div className="reference-sidebar-divider" />
          {importForm}
          <section className="reference-validation-log" aria-labelledby="reference-errors-title">
            <ReferenceValidationDiagnostics diagnostics={preview?.diagnostics ?? null} />
            {preview !== null && preview.canPublish && !previewPublished && <button className="secondary-action" type="button" onClick={() => void publishPreview()} disabled={!publishEnabled || busy !== null}>
              {busy === "publish" ? "Публикуем…" : "Повторить публикацию"}
            </button>}
          </section>
        </aside>
        <div className="reference-table-main">
          {!activeSourceId && <p className="reference-state empty">Выберите загруженный справочник слева или создайте новую таблицу.</p>}
          {activeSourceId && activeError && <p className="reference-state error">{activeError}</p>}
          {activeSourceId && active === undefined && <p className="reference-state" role="status">Загружаем таблицу…</p>}
          {activeSourceId && !activeError && active !== undefined && <>
            {active && <dl className="active-reference-facts">
              <div><dt>Записей</dt><dd>{active.records.length}</dd></div>
              <div><dt>Источник</dt><dd>{active.sourceUri ?? active.sourceKind}</dd></div>
              <div><dt>Снимок создан</dt><dd>{formatDateTime(active.capturedUtc)}</dd></div>
            </dl>}
            <EditableReferenceTable
              sourceId={activeSourceId}
              snapshot={active}
              disabled={busy !== null}
              onSave={async (request) => {
                setBusy("publish");
                try {
                  const publication = await api.publishEditableTable(activeSourceId, request);
                  setActive(publication.snapshot);
                  await loadSources(publication.snapshot.sourceId);
                  setNotice({ tone: "success", text: publication.status === "unchanged"
                    ? "Изменений в справочнике нет."
                    : `Справочник сохранён: ${publication.snapshot.records.length} записей.` });
                } catch (error) {
                  const message = errorText(error);
                  setNotice({ tone: "error", text: message });
                  throw new Error(message);
                } finally {
                  setBusy(null);
                }
              }}
            />
          </>}
        </div>
      </section>
    </div>
  );
}
