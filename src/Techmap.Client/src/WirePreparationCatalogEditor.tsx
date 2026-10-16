import { useEffect, useState } from "react";
import type { PublishEditableReferenceTableRequest, ReferenceCatalogSnapshot } from "./reference-catalog-api";
import { importWirePreparationTsv, wirePreparationDraft, wirePreparationReady, wirePreparationRequest, type WirePreparationScheme } from "./WirePreparationCatalog";
import { routeV3OperationFromCatalog } from "./manufacturing-v3/route-v3-operations";
import "./wire-preparation.css";

export function WirePreparationCatalogEditor({ snapshot, catalogs, disabled, onSave }: {
  snapshot: ReferenceCatalogSnapshot | null; catalogs: readonly ReferenceCatalogSnapshot[]; disabled: boolean;
  onSave: (request: PublishEditableReferenceTableRequest) => Promise<void>;
}) {
  const [rows, setRows] = useState(() => wirePreparationDraft(snapshot));
  const [error, setError] = useState<string | null>(null), [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false), [paste, setPaste] = useState("");
  useEffect(() => { setRows(wirePreparationDraft(snapshot)); }, [snapshot]);
  const blocked = disabled || saving;
  const choices = catalogs.flatMap(snapshot => snapshot.records.filter(r => r.entityType === "operation").map(record => ({ record, snapshot, key: `${snapshot.sourceId}:${record.recordId}` })));
  const change = (id: string, patch: Partial<WirePreparationScheme>) => setRows(current => current.map(r => r.id === id ? { ...r, ...patch } : r));
  const max = Math.max(1, ...rows.map(r => r.operations.length));
  return <section className="wire-preparation-catalog">
    <header className="section-title-row"><div><h2>Схемы заготовки провода</h2><p>{rows.length} схем · {rows.filter(wirePreparationReady).length} готовы к применению</p></div><button type="button" className="primary-action" disabled={blocked} onClick={async () => {
      try { setSaving(true); setError(null); await onSave(wirePreparationRequest(rows, snapshot)); setNotice("Справочник сохранён."); }
      catch (e) { setError(e instanceof Error ? e.message : "Не удалось сохранить схемы."); } finally { setSaving(false); }
    }}>Сохранить справочник</button></header>
    <p>Выберите операции БД.ОП слева направо. Пустой шаг сохраняется как черновик; такую схему нельзя применить к маршруту.</p>
    {!choices.length && <p role="status">Загрузите справочник БД.ОП для выбора операций.</p>}
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <div className="wire-preparation-scroll"><table><thead><tr><th>Название</th><th>Описание</th>{Array.from({ length: max }, (_, i) => <th key={i}>Операция №{i + 1}</th>)}<th>Действия</th></tr></thead>
      <tbody>{rows.map((row, index) => <tr key={row.id}><td><input aria-label={`Название схемы ${index + 1}`} value={row.name} disabled={blocked} onChange={e => change(row.id, { name: e.target.value })} />{!wirePreparationReady(row) && <small>Заполните операции</small>}</td>
        <td><textarea aria-label={`Описание схемы ${index + 1}`} value={row.description} disabled={blocked} onChange={e => change(row.id, { description: e.target.value })} /></td>
        {Array.from({ length: max }, (_, step) => <td key={step}>{step < row.operations.length && <><select aria-label={`Схема ${index + 1}, операция ${step + 1}`} disabled={blocked} value={row.operations[step]?.catalogBinding ? `${row.operations[step]!.catalogBinding!.sourceId}:${row.operations[step]!.catalogBinding!.recordId}` : ""} onChange={e => {
          const selected = choices.find(c => c.key === e.target.value);
          change(row.id, { operations: row.operations.map((op, i) => i === step ? selected ? routeV3OperationFromCatalog(selected.record, selected.snapshot, crypto.randomUUID()) : null : op) });
        }}><option value="">Выберите операцию</option>{row.operations[step]?.catalogBinding && !choices.some(c => c.key === `${row.operations[step]!.catalogBinding!.sourceId}:${row.operations[step]!.catalogBinding!.recordId}`) && <option value={`${row.operations[step]!.catalogBinding!.sourceId}:${row.operations[step]!.catalogBinding!.recordId}`}>{row.operations[step]!.catalogBinding!.displayName} (сохранённый снимок)</option>}{choices.map(c => <option key={c.key} value={c.key}>{String(c.record.payload.name ?? "Операция")} · № {c.record.sourceKey} · {c.snapshot.sourceId}</option>)}</select>
          <div><button type="button" disabled={blocked || step === 0} aria-label={`Переместить шаг ${step + 1} влево в схеме ${index + 1}`} onClick={() => { const ops = [...row.operations]; [ops[step - 1], ops[step]] = [ops[step]!, ops[step - 1]!]; change(row.id, { operations: ops }); }}>←</button><button type="button" disabled={blocked || row.operations.length === 1} aria-label={`Удалить шаг ${step + 1} в схеме ${index + 1}`} onClick={() => change(row.id, { operations: row.operations.filter((_, i) => i !== step) })}>Удалить шаг</button></div></>}</td>)}
        <td><button type="button" disabled={blocked} onClick={() => change(row.id, { operations: [...row.operations, null] })}>Добавить операцию</button><button type="button" disabled={blocked} onClick={() => setRows(current => current.filter(r => r.id !== row.id))}>Удалить схему</button></td></tr>)}</tbody></table></div>
    <button type="button" disabled={blocked} onClick={() => setRows(current => [...current, { id: crypto.randomUUID(), name: "", description: "", operations: [null] }])}>Добавить схему</button>
    <details><summary>Загрузить из таблицы</summary><p>Вставьте строки из Excel: Название, Описание, номера операций БД.ОП (разделитель — табуляция).</p><textarea aria-label="Строки схем из таблицы" value={paste} onChange={e => setPaste(e.target.value)} /><input type="file" accept=".tsv,.txt" aria-label="Загрузить TSV схем" disabled={blocked} onChange={async e => { const file = e.target.files?.[0]; if (file) { try { setPaste(await file.text()); } catch { setError("Не удалось прочитать файл."); } } }} /><button type="button" disabled={blocked || !paste.trim()} onClick={() => { try { const next = [...rows, ...importWirePreparationTsv(paste, catalogs, () => crypto.randomUUID())]; wirePreparationRequest(next, snapshot); setRows(next); setPaste(""); setError(null); } catch (e) { setError(e instanceof Error ? e.message : "Ошибка импорта."); } }}>Добавить строки в справочник</button></details>
  </section>;
}
