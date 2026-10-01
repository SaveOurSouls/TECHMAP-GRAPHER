import { useEffect, useId, useState } from "react";
import type { PublishEditableReferenceTableRequest, ReferenceCatalogSnapshot } from "./reference-catalog-api";
import { wireBlankDraft, wireBlankEndLabels, wireBlankEndNeedsMirror, wireBlankEnds, wireBlankRequest, wireBlankTemplateForEnd, wireBlankTemplateUrl, type WireBlank } from "./WireBlankCatalog";
import "./wire-blank-catalog.css";

function WireBlankPreview({ row }: { row: WireBlank }) {
  const clipId = useId().replaceAll(":", "");
  if (row.photoDataUrl) return <img className="wire-blank-preview" src={row.photoDataUrl} alt={`Фото полуфабриката ${row.title}`} />;
  const left = wireBlankTemplateUrl(wireBlankTemplateForEnd(row.start, "left"));
  const right = wireBlankTemplateUrl(wireBlankTemplateForEnd(row.end, "right"));
  return <svg className="wire-blank-preview" viewBox="0 0 1200 240" role="img" aria-label={`${row.title}: ${wireBlankEndLabels[row.start]} — ${wireBlankEndLabels[row.end]}`}>
    <defs><clipPath id={`${clipId}-left`}><rect width="325" height="240" /></clipPath><clipPath id={`${clipId}-right`}><rect x="875" width="325" height="240" /></clipPath></defs>
    <rect x="220" y="96" width="760" height="48" rx="17" fill={row.color} stroke="#263746" strokeWidth="3" />
    <path d="M320 104H880" stroke="#fff" strokeWidth="3" opacity=".28" />
    {left && <g clipPath={`url(#${clipId}-left)`}><image href={left} width="1200" height="240" transform={wireBlankEndNeedsMirror(row.start, "left") ? "translate(1200 0) scale(-1 1)" : undefined} /></g>}
    {right && <g clipPath={`url(#${clipId}-right)`}><image href={right} width="1200" height="240" transform={wireBlankEndNeedsMirror(row.end, "right") ? "translate(1200 0) scale(-1 1)" : undefined} /></g>}
  </svg>;
}

export function WireBlankCatalogEditor({ snapshot, disabled, onSave }: {
  snapshot: ReferenceCatalogSnapshot | null;
  disabled: boolean;
  onSave: (request: PublishEditableReferenceTableRequest) => Promise<void>;
}) {
  const [rows, setRows] = useState(() => wireBlankDraft(snapshot));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  useEffect(() => { setRows(wireBlankDraft(snapshot)); setError(null); }, [snapshot]);
  const blocked = disabled || saving || uploading;
  const change = (id: string, patch: Partial<WireBlank>) => setRows(current => current.map(row => row.id === id ? { ...row, ...patch } : row));
  const updatePhoto = async (row: WireBlank, file: File | undefined) => {
    if (!file) return;
    try {
      setUploading(true);
      const { importDrawingImage } = await import("./component-library/image-import");
      const asset = await importDrawingImage(file);
      if (asset.contentBase64.length > 1_400_000) throw new Error("Фото полуфабриката должно быть не больше 1 МиБ после преобразования в PNG.");
      change(row.id, { photoDataUrl: `data:image/png;base64,${asset.contentBase64}` });
      setError(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось обновить фото."); }
    finally { setUploading(false); }
  };
  const save = async () => {
    try { setSaving(true); setError(null); await onSave(wireBlankRequest(rows, snapshot)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось сохранить справочник."); }
    finally { setSaving(false); }
  };
  return <section className="wire-blank-catalog" aria-labelledby="wire-blank-title">
    <header className="section-title-row reference-card-title"><div><h2 id="wire-blank-title">Полуфабрикаты провода</h2><p>{rows.length} вариантов обработки провода</p></div><button className="primary-action" type="button" disabled={blocked} onClick={() => void save()}>{saving ? "Сохраняем…" : "Сохранить справочник"}</button></header>
    <p className="wire-blank-catalog-intro">Цвет, исполнение начала и конца меняют рисунок. Собственное фото сохраняется в справочнике и заменяет рисунок до удаления фото.</p>
    {error && <p className="reference-state error" role="alert">{error}</p>}
    <div className="wire-blank-list">{rows.map((row, position) => <article className="wire-blank-card" key={row.id} aria-label={`Полуфабрикат ${position + 1}`}>
      <div className="wire-blank-card-preview"><WireBlankPreview row={row} /></div>
      <div className="wire-blank-card-fields">
        <label>Индекс<input aria-label={`Индекс полуфабриката ${position + 1}`} maxLength={128} value={row.index} disabled={blocked} onChange={event => change(row.id, { index: event.target.value })} /></label>
        <label>Уникальное название<input aria-label={`Название полуфабриката ${position + 1}`} maxLength={512} value={row.title} disabled={blocked} onChange={event => change(row.id, { title: event.target.value })} /></label>
        <label>Цвет провода<span className="wire-blank-color"><input type="color" aria-label={`Цвет полуфабриката ${position + 1}`} value={/^#[0-9a-fA-F]{6}$/.test(row.color) ? row.color : "#26609e"} disabled={blocked} onChange={event => change(row.id, { color: event.target.value })} /><input aria-label={`Код цвета полуфабриката ${position + 1}`} value={row.color} maxLength={7} disabled={blocked} onChange={event => change(row.id, { color: event.target.value })} /></span></label>
        <label>Исполнение начала<select aria-label={`Начало полуфабриката ${position + 1}`} value={row.start} disabled={blocked} onChange={event => change(row.id, { start: event.target.value as WireBlank["start"] })}>{wireBlankEnds.map(end => <option key={end} value={end}>{wireBlankEndLabels[end]}</option>)}</select></label>
        <label>Исполнение конца<select aria-label={`Конец полуфабриката ${position + 1}`} value={row.end} disabled={blocked} onChange={event => change(row.id, { end: event.target.value as WireBlank["end"] })}>{wireBlankEnds.map(end => <option key={end} value={end}>{wireBlankEndLabels[end]}</option>)}</select></label>
      </div>
      <div className="wire-blank-card-actions"><label className="secondary-action">Обновить фото<input type="file" aria-label={`Обновить фото полуфабриката ${position + 1}`} accept=".png,.jpg,.jpeg,.bmp,.svg,.heic,.heif,image/*" disabled={blocked} onChange={event => { void updatePhoto(row, event.target.files?.[0]); event.target.value = ""; }} /></label>{row.photoDataUrl && <button className="secondary-action" type="button" disabled={blocked} onClick={() => change(row.id, { photoDataUrl: null })}>Вернуть рисунок</button>}<button type="button" disabled={blocked} onClick={() => setRows(current => current.filter(item => item.id !== row.id))}>Удалить</button></div>
    </article>)}</div>
    <button type="button" className="secondary-action" disabled={blocked} onClick={() => setRows(current => [...current, { id: crypto.randomUUID(), index: "", title: "", color: "#26609e", start: "cut", end: "cut", templateId: "01-cut", photoDataUrl: null, originalPayload: {} }])}>Добавить полуфабрикат</button>
  </section>;
}
