import { useEffect, useState } from "react";
import { referenceTableProfiles } from "./reference-table-profiles";
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
  readonly label?: string;
}

export interface EditableReferenceRow {
  readonly id: string;
  readonly entityType: string;
  readonly sourceKey: string;
  readonly values: Readonly<Record<string, string>>;
  readonly originalValues: Readonly<Record<string, unknown>>;
  readonly originalPayload?: Readonly<Record<string, unknown>>;
  readonly sourceLocation?: string | null;
}

export interface EditableReferenceDraft {
  readonly sourceKind: string;
  readonly sourceUri: string;
  readonly columns: readonly EditableReferenceColumn[];
  readonly rows: readonly EditableReferenceRow[];
}

interface EditableReferenceTableProps {
  readonly sourceId: string;
  readonly displayName?: string;
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

const columnOrderKey = "_techmapColumnOrder";
const sourceKeyField = "$sourceKey";
const layerField = /^layer([DL])([123])$/;

export function referenceColumnLabel(column: EditableReferenceColumn): string {
  return column.sourceColumn || column.label || column.name;
}

function storedColumnOrder(snapshot: ReferenceCatalogSnapshot | null): string[] {
  const raw = snapshot?.records.find(record => typeof record.payload[columnOrderKey] === "string")?.payload[columnOrderKey];
  try {
    const value: unknown = typeof raw === "string" ? JSON.parse(raw) : [];
    return Array.isArray(value) ? value.filter((name): name is string => typeof name === "string") : [];
  } catch { return []; }
}

function layerValue(payload: Readonly<Record<string, unknown>>, name: string): unknown {
  const match = layerField.exec(name);
  if (!match || !Array.isArray(payload.layers)) return payload[name];
  const layer = payload.layers.find(item => item && typeof item === "object" && item.index === Number(match[2]));
  return layer?.[match[1] === "D" ? "diameterMm" : "stripLengthMm"];
}

function visibleKey(entityType: string, key: string): string {
  // Coax cable keys contain length-prefixed source values and an optional duplicate suffix.
  const match = entityType === "coax-cable" ? /^(\d+):/.exec(key) : null;
  return match ? key.slice(match[0].length, match[0].length + Number(match[1])) : key;
}

export function editableReferenceDraft(snapshot: ReferenceCatalogSnapshot | null): EditableReferenceDraft {
  const links = fieldLinks(snapshot);
  const profile = referenceTableProfiles[snapshot?.sourceId ?? ""];
  const payloadNames = [...new Set(snapshot?.records.flatMap(record => Object.keys(record.payload)) ?? [])]
    .filter(name => !name.startsWith("_techmap") && !(profile && name === "layers"));
  const storedOrder = storedColumnOrder(snapshot);
  const ordered = storedOrder.length ? storedOrder : snapshot?.sourceId === "technology-wires"
    ? ["Марка", "Core", "Сечение C", "Pair", "Сечение P"].filter(name => payloadNames.includes(name)) : [];
  const names = [...new Set([
    ...ordered,
    ...(profile?.columns.map(column => column.name) ?? []),
    ...payloadNames,
  ])].filter(name => !name.startsWith("_techmap"));
  // Generic imports keep their source headers; wire composite keys never become visible columns.
  if (!profile && snapshot?.sourceId !== "technology-wires" && snapshot?.records.length &&
      !snapshot.records.every(record => /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(record.sourceKey)) &&
      !names.includes(sourceKeyField) && !snapshot.records.every(record => Object.values(record.payload).includes(record.sourceKey))) {
    names.unshift(sourceKeyField);
  }
  const columns = names.map(name => ({ id: crypto.randomUUID(), name, sourceColumn: links[name] ?? "",
    label: profile?.columns.find(column => column.name === name)?.label ?? (name === sourceKeyField ? "Код" : name) }));
  const rows = (snapshot?.records ?? []).map((record) => ({
    id: crypto.randomUUID(),
    entityType: record.entityType,
    sourceKey: record.sourceKey,
    values: Object.fromEntries(columns.map(column => [column.id, textValue(column.name === sourceKeyField
      ? visibleKey(record.entityType, record.sourceKey) : layerValue(record.payload, column.name))])),
    originalValues: Object.fromEntries(columns.map(column => [column.id, column.name === sourceKeyField
      ? visibleKey(record.entityType, record.sourceKey) : layerValue(record.payload, column.name)])),
    originalPayload: record.payload,
    sourceLocation: record.sourceLocation,
  }));
  return { sourceKind: snapshot?.sourceKind ?? "editable-table", sourceUri: snapshot?.sourceUri ?? "", columns, rows };
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
    const keyColumn = normalizedColumns.find(column => column.name === sourceKeyField);
    let sourceKey = row.sourceKey.trim();
    if (keyColumn) {
      const edited = (row.values[keyColumn.id] ?? "").trim();
      const prefix = row.entityType === "coax-cable" ? /^(\d+):/.exec(sourceKey) : null;
      if (!edited) throw new Error(`Заполните ${referenceColumnLabel(keyColumn)} в строке ${index + 1}.`);
      sourceKey = prefix ? `${edited.length}:${edited}${sourceKey.slice(prefix[0].length + Number(prefix[1]))}` : edited;
    }
    if (!entityType || !sourceKey) throw new Error(`Заполните тип и ключ в строке ${index + 1}.`);
    const identity = `${entityType}\n${sourceKey}`;
    if (seen.has(identity)) throw new Error(`Ключ «${sourceKey}» повторяется для типа «${entityType}».`);
    seen.add(identity);
    const payload: Record<string, unknown> = { ...row.originalPayload };
    for (const column of normalizedColumns) {
      if (column.name === sourceKeyField) continue;
      const value = row.values[column.id] ?? "";
      const original = row.originalValues[column.id];
      if (value === textValue(original) && Object.hasOwn(row.originalValues, column.id)) continue;
      const match = layerField.exec(column.name);
      if (match && (Array.isArray(payload.layers) || entityType.startsWith("coax-"))) {
        const layers = Array.isArray(payload.layers) ? payload.layers.map(item => ({ ...item })) : [];
        const layerIndex = Number(match[2]);
        let layer = layers.find(item => item.index === layerIndex);
        if (!layer) { layer = { index: layerIndex }; layers.push(layer); }
        const property = match[1] === "D" ? "diameterMm" : "stripLengthMm";
        if (!value.trim() || value === "—" || value === "-") delete layer[property];
        else {
          const numeric = Number(value.replace(",", "."));
          if (!Number.isFinite(numeric) || numeric < 0) throw new Error(`Введите размер в миллиметрах: ${referenceColumnLabel(column)}, строка ${index + 1}.`);
          layer[property] = numeric;
        }
        payload.layers = layers.filter(item => Object.keys(item).length > 1).sort((a, b) => a.index - b.index);
      } else payload[column.name] = value;
    }
    if (normalizedColumns.some(column => !Object.hasOwn(row.originalValues, column.id))) {
      payload[columnOrderKey] = JSON.stringify(normalizedColumns.map(column => column.name));
    }
    if (Object.keys(links).length > 0) payload[fieldLinksKey] = JSON.stringify(links);
    return {
      entityType, sourceKey, payload,
      sourceLocation: row.sourceLocation ?? null,
    };
  });
  return {
    expectedActiveSnapshotId,
    sourceKind: draft.sourceKind,
    sourceUri: draft.sourceUri.trim() || null,
    records,
  };
}

export function EditableReferenceTable({ sourceId, displayName, snapshot, disabled, onSave }: EditableReferenceTableProps) {
  const [draft, setDraft] = useState(() => editableReferenceDraft(snapshot));
  const [newFieldName, setNewFieldName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [addingColumn, setAddingColumn] = useState(false);
  useEffect(() => {
    setDraft(editableReferenceDraft(snapshot));
    setError(null);
    setAddingColumn(false);
    setNewFieldName("");
  }, [snapshot, sourceId]);
  const blocked = disabled || saving;
  const title = displayName ?? referenceTableProfiles[sourceId]?.title ?? (sourceId === "technology-wires" ? "Провода" : sourceId || "Справочник");

  const addField = () => {
    const name = newFieldName.trim();
    if (!name) return;
    if (name.startsWith("_") || name.startsWith("$")) { setError("Начните название столбца с буквы или цифры."); return; }
    if (draft.columns.some((column) => [column.name, referenceColumnLabel(column)].some(label => label.toLocaleLowerCase("ru-RU") === name.toLocaleLowerCase("ru-RU")))) {
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
    setAddingColumn(false);
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
      <div><h2 id="editable-reference-title">{title}</h2><p className="editable-reference-count">Строк: {draft.rows.length}</p></div>
      <button className="primary-action" type="button" disabled={blocked} onClick={() => void save()}>
        {saving ? "Сохраняем…" : "Сохранить"}
      </button>
    </div>
    <div className="editable-reference-actions">
      <span>Нажмите на ячейку, чтобы изменить значение</span>
      <button type="button" className="secondary-action" disabled={blocked} onClick={() => setAddingColumn(!addingColumn)} aria-expanded={addingColumn}>Добавить столбец</button>
      <button type="button" className="secondary-action" disabled={blocked} onClick={() => setDraft({
        ...draft,
        rows: [...draft.rows, {
          id: crypto.randomUUID(), entityType: draft.rows[0]?.entityType ?? referenceTableProfiles[sourceId]?.entityType ?? "generic-record",
          sourceKey: crypto.randomUUID(), values: {}, originalValues: {},
        }],
      })}>Добавить строку</button>
    </div>
    {addingColumn && <div className="editable-reference-add-column">
      <input aria-label="Название нового столбца" autoFocus value={newFieldName} placeholder="Название столбца" disabled={blocked}
        onChange={(event) => setNewFieldName(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addField(); } }} />
      <button type="button" className="secondary-action" disabled={blocked || !newFieldName.trim()} onClick={addField}>Добавить</button>
    </div>}
    {error && <p className="reference-state error" role="alert">{error}</p>}
    <div className="editable-reference-scroll" role="region" aria-label={`Таблица: ${title}`} tabIndex={0}>
      <table className="editable-reference-table" aria-label={title}>
        <thead><tr><th scope="col" className="editable-reference-position">Поз.</th>{draft.columns.map((column) => <th scope="col" key={column.id}>
          {referenceColumnLabel(column)}
        </th>)}<th scope="col" className="editable-reference-row-action">Действия</th></tr></thead>
        <tbody>{draft.rows.map((row, rowIndex) => <tr key={row.id}>
          <th scope="row" className="editable-reference-position">{rowIndex + 1}</th>
          {draft.columns.map((column) => <td key={column.id}><input
            aria-label={`${referenceColumnLabel(column)}, строка ${rowIndex + 1}`}
            title={row.values[column.id] || referenceColumnLabel(column)} placeholder="—"
            value={row.values[column.id] ?? ""} disabled={blocked}
            onChange={(event) => setDraft({ ...draft, rows: draft.rows.map((item) => item.id === row.id
              ? { ...item, values: { ...item.values, [column.id]: event.target.value } } : item) })} /></td>)}
          <td className="editable-reference-row-action"><button type="button" aria-label={`Удалить строку ${rowIndex + 1}`} disabled={blocked}
            onClick={() => setDraft({ ...draft, rows: draft.rows.filter((item) => item.id !== row.id) })}>Удалить</button></td>
        </tr>)}</tbody>
      </table>
    </div>
    {draft.rows.length === 0 && <p className="editable-reference-empty">В таблице пока нет строк. Добавьте первую строку.</p>}
  </section>;
}
