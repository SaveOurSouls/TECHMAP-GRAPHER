import { useEffect, useMemo, useState } from "react";
import type {
  EditableReferenceRecord,
  PublishEditableReferenceTableRequest,
  ReferenceCatalogSnapshot,
} from "./reference-catalog-api";

const fieldLinksKey = "_techmapFieldLinks";

export interface EditableReferenceColumn {
  readonly id: string;
  readonly name: string;
  readonly sourceColumn: string;
}

export interface EditableReferenceRow {
  readonly id: string;
  readonly entityType: string;
  readonly sourceKey: string;
  readonly values: Readonly<Record<string, string>>;
}

export interface EditableReferenceDraft {
  readonly sourceUri: string;
  readonly columns: readonly EditableReferenceColumn[];
  readonly rows: readonly EditableReferenceRow[];
}

interface EditableReferenceTableProps {
  readonly sourceId: string;
  readonly snapshot: ReferenceCatalogSnapshot | null;
  readonly disabled: boolean;
  readonly onSave: (request: PublishEditableReferenceTableRequest) => Promise<void>;
}

function textValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

function fieldLinks(snapshot: ReferenceCatalogSnapshot | null): Readonly<Record<string, string>> {
  const raw = snapshot?.records.find((record) => typeof record.payload[fieldLinksKey] === "string")
    ?.payload[fieldLinksKey];
  if (typeof raw !== "string") return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? Object.fromEntries(Object.entries(parsed).filter((item): item is [string, string] => typeof item[1] === "string"))
      : {};
  } catch {
    return {};
  }
}

export function editableReferenceDraft(snapshot: ReferenceCatalogSnapshot | null): EditableReferenceDraft {
  const links = fieldLinks(snapshot);
  const names = [...new Set(snapshot?.records.flatMap((record) => Object.keys(record.payload)) ?? [])]
    .filter((name) => name !== fieldLinksKey);
  const columns = names.map((name) => ({ id: crypto.randomUUID(), name, sourceColumn: links[name] ?? "" }));
  const rows = (snapshot?.records ?? []).map((record) => ({
    id: crypto.randomUUID(),
    entityType: record.entityType,
    sourceKey: record.sourceKey,
    values: Object.fromEntries(columns.map((column) => [column.id, textValue(record.payload[column.name])])),
  }));
  return { sourceUri: snapshot?.sourceUri ?? "", columns, rows };
}

export function editableReferenceRequest(
  draft: EditableReferenceDraft,
  expectedActiveSnapshotId: string | null,
): PublishEditableReferenceTableRequest {
  const normalizedColumns = draft.columns.map((column) => ({
    ...column,
    name: column.name.trim(),
    sourceColumn: column.sourceColumn.trim(),
  }));
  if (draft.rows.length === 0) throw new Error("Добавьте хотя бы одну строку справочника.");
  if (normalizedColumns.some((column) => !column.name)) throw new Error("Названия полей не должны быть пустыми.");
  if (new Set(normalizedColumns.map((column) => column.name.toLocaleLowerCase("ru-RU"))).size !== normalizedColumns.length) {
    throw new Error("Названия полей не должны повторяться.");
  }
  const seen = new Set<string>();
  const links = Object.fromEntries(normalizedColumns
    .filter((column) => column.sourceColumn)
    .map((column) => [column.name, column.sourceColumn]));
  const records: EditableReferenceRecord[] = draft.rows.map((row, index) => {
    const entityType = row.entityType.trim();
    const sourceKey = row.sourceKey.trim();
    if (!entityType || !sourceKey) throw new Error(`Заполните тип и ключ в строке ${index + 1}.`);
    const identity = `${entityType}\n${sourceKey}`;
    if (seen.has(identity)) throw new Error(`Ключ «${sourceKey}» повторяется для типа «${entityType}».`);
    seen.add(identity);
    return {
      entityType,
      sourceKey,
      payload: {
        ...Object.fromEntries(normalizedColumns.map((column) => [column.name, row.values[column.id] ?? ""])),
        ...(Object.keys(links).length > 0 ? { [fieldLinksKey]: JSON.stringify(links) } : {}),
      },
      sourceLocation: null,
    };
  });
  return {
    expectedActiveSnapshotId,
    sourceUri: draft.sourceUri.trim() || null,
    records,
  };
}

export function EditableReferenceTable({ sourceId, snapshot, disabled, onSave }: EditableReferenceTableProps) {
  const [draft, setDraft] = useState(() => editableReferenceDraft(snapshot));
  const [newFieldName, setNewFieldName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setDraft(editableReferenceDraft(snapshot));
    setError(null);
  }, [snapshot]);
  const blocked = disabled || saving;
  const columnsById = useMemo(() => new Map(draft.columns.map((column) => [column.id, column])), [draft.columns]);

  const addField = () => {
    const name = newFieldName.trim();
    if (!name) return;
    if (draft.columns.some((column) => column.name.toLocaleLowerCase("ru-RU") === name.toLocaleLowerCase("ru-RU"))) {
      setError("Поле с таким названием уже есть.");
      return;
    }
    const column = { id: crypto.randomUUID(), name, sourceColumn: "" };
    setDraft({
      ...draft,
      columns: [...draft.columns, column],
      rows: draft.rows.map((row) => ({ ...row, values: { ...row.values, [column.id]: "" } })),
    });
    setNewFieldName("");
    setError(null);
  };

  const save = async () => {
    try {
      setSaving(true);
      setError(null);
      await onSave(editableReferenceRequest(draft, snapshot?.snapshotId ?? null));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось сохранить справочник.");
    } finally {
      setSaving(false);
    }
  };

  return <section className="editable-reference-card" aria-labelledby="editable-reference-title">
    <div className="section-title-row reference-card-title">
      <div><p className="eyebrow">РЕДАКТИРУЕМАЯ ТАБЛИЦА</p><h2 id="editable-reference-title">{sourceId || "Справочник"}</h2></div>
      <button className="primary-action" type="button" disabled={blocked} onClick={() => void save()}>
        {saving ? "Сохраняем…" : "Сохранить версию"}
      </button>
    </div>
    <p className="editable-reference-note">Строки и поля принадлежат локальному справочнику. Ссылка и имя исходного столбца сохраняются только как настройка будущей синхронизации.</p>
    <label className="editable-reference-source">Ссылка на источник для синхронизации
      <input type="url" value={draft.sourceUri} placeholder="Адрес опубликованного источника" disabled={blocked}
        onChange={(event) => setDraft({ ...draft, sourceUri: event.target.value })} />
    </label>
    <div className="editable-reference-actions">
      <input value={newFieldName} placeholder="Название нового текстового поля" disabled={blocked}
        onChange={(event) => setNewFieldName(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addField(); } }} />
      <button type="button" className="secondary-action" disabled={blocked || !newFieldName.trim()} onClick={addField}>+ Поле</button>
      <button type="button" className="secondary-action" disabled={blocked} onClick={() => setDraft({
        ...draft,
        rows: [...draft.rows, {
          id: crypto.randomUUID(), entityType: draft.rows[0]?.entityType ?? "generic-record", sourceKey: "", values: {},
        }],
      })}>+ Строка</button>
    </div>
    {error && <p className="reference-state error" role="alert">{error}</p>}
    <div className="editable-reference-scroll">
      <table className="editable-reference-table">
        <thead><tr><th>Тип записи</th><th>Ключ / артикул</th>{draft.columns.map((column) => <th key={column.id}>
          <input aria-label={`Название поля ${column.name}`} value={column.name} disabled={blocked}
            onChange={(event) => setDraft({ ...draft, columns: draft.columns.map((item) => item.id === column.id ? { ...item, name: event.target.value } : item) })} />
          <input aria-label={`Столбец синхронизации ${column.name}`} value={column.sourceColumn} disabled={blocked}
            placeholder="Столбец источника"
            onChange={(event) => setDraft({ ...draft, columns: draft.columns.map((item) => item.id === column.id ? { ...item, sourceColumn: event.target.value } : item) })} />
          <button type="button" aria-label={`Удалить поле ${column.name}`} disabled={blocked} onClick={() => setDraft({
            ...draft, columns: draft.columns.filter((item) => item.id !== column.id),
            rows: draft.rows.map((row) => ({ ...row, values: Object.fromEntries(Object.entries(row.values).filter(([key]) => key !== column.id)) })),
          })}>×</button>
        </th>)}<th aria-label="Действия" /></tr></thead>
        <tbody>{draft.rows.map((row, rowIndex) => <tr key={row.id}>
          <td><input aria-label={`Тип записи ${rowIndex + 1}`} value={row.entityType} disabled={blocked} onChange={(event) => setDraft({
            ...draft, rows: draft.rows.map((item) => item.id === row.id ? { ...item, entityType: event.target.value } : item),
          })} /></td>
          <td><input aria-label={`Ключ строки ${rowIndex + 1}`} value={row.sourceKey} disabled={blocked} onChange={(event) => setDraft({
            ...draft, rows: draft.rows.map((item) => item.id === row.id ? { ...item, sourceKey: event.target.value } : item),
          })} /></td>
          {draft.columns.map((column) => <td key={column.id}><input
            aria-label={`${columnsById.get(column.id)?.name ?? column.name}, строка ${rowIndex + 1}`}
            value={row.values[column.id] ?? ""} disabled={blocked}
            onChange={(event) => setDraft({ ...draft, rows: draft.rows.map((item) => item.id === row.id
              ? { ...item, values: { ...item.values, [column.id]: event.target.value } } : item) })} /></td>)}
          <td><button type="button" aria-label={`Удалить строку ${rowIndex + 1}`} disabled={blocked}
            onClick={() => setDraft({ ...draft, rows: draft.rows.filter((item) => item.id !== row.id) })}>×</button></td>
        </tr>)}</tbody>
      </table>
    </div>
  </section>;
}
