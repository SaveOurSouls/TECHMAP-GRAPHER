import { useEffect, useRef, useState } from "react";
import type { PublishEditableReferenceTableRequest, ReferenceCatalogSnapshot } from "./reference-catalog-api";
import { wireBlankDraft, wireBlankEndLabels, wireBlankEnds, wireBlankRequest, type WireBlank } from "./WireBlankCatalog";
import { renderWireSvg } from "./wire-blank-artwork.mjs";
import "./wire-blank-catalog.css";

export function WireBlankPreview({ row }: { row: WireBlank }) {
  if (row.photoDataUrl) return <img className="wire-blank-preview" src={row.photoDataUrl} alt={`Фото полуфабриката ${row.title}`} />;
  const title = `${row.title}: ${wireBlankEndLabels[row.start]} — ${wireBlankEndLabels[row.end]}`;
  const artwork = renderWireSvg({ left: row.start, right: row.end, color: row.color });
  return <img className="wire-blank-preview" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(artwork)}`} alt={title} />;
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
  const [notice, setNotice] = useState<string | null>(null);
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});
  useEffect(() => { setRows(wireBlankDraft(snapshot)); setError(null); setNotice(null); }, [snapshot]);
  const blocked = disabled || saving || uploading;
  const change = (id: string, patch: Partial<WireBlank>) => { setNotice(null); setRows(current => current.map(row => row.id === id ? { ...row, ...patch } : row)); };
  const updatePhoto = async (row: WireBlank, file: File | undefined) => {
    if (!file) return;
    try {
      setUploading(true);
      const { importDrawingImage } = await import("./component-library/image-import");
      const asset = await importDrawingImage(file);
      if (asset.contentBase64.length > 1_400_000) throw new Error("Фото полуфабриката должно быть не больше 1 МиБ после преобразования в PNG.");
      change(row.id, { photoDataUrl: `data:image/png;base64,${asset.contentBase64}` });
      setError(null);
      setNotice(`Фото «${row.title}» обновлено. Сохраните справочник.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось обновить фото."); }
    finally { setUploading(false); }
  };
  const save = async () => {
    try { setSaving(true); setError(null); await onSave(wireBlankRequest(rows, snapshot)); setNotice("Справочник сохранён."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось сохранить справочник."); }
    finally { setSaving(false); }
  };
  return <section className="wire-blank-catalog" aria-labelledby="wire-blank-title">
    <header className="section-title-row reference-card-title"><div><h2 id="wire-blank-title">Полуфабрикаты провода</h2><p>{rows.length} вариантов обработки провода</p></div><button className="primary-action" type="button" disabled={blocked} onClick={() => void save()}>{saving ? "Сохраняем…" : "Сохранить справочник"}</button></header>
    <p className="wire-blank-catalog-intro">Цвет, исполнение начала и конца меняют рисунок. Собственное фото сохраняется в справочнике и заменяет рисунок до удаления фото.</p>
    {error && <p className="reference-state error" role="alert">{error}</p>}
    {notice && <p className="reference-state" role="status">{notice}</p>}
    <div className="wire-blank-list">{rows.map((row, position) => <article className="wire-blank-card" key={row.id} aria-label={`Полуфабрикат ${position + 1}`}>
      <div className="wire-blank-card-preview"><WireBlankPreview row={row} /></div>
      <div className="wire-blank-card-fields">
        <label>Индекс<input aria-label={`Индекс полуфабриката ${position + 1}`} maxLength={128} value={row.index} disabled={blocked} onChange={event => change(row.id, { index: event.target.value })} /></label>
        <label>Уникальное название<input aria-label={`Название полуфабриката ${position + 1}`} maxLength={512} value={row.title} disabled={blocked} onChange={event => change(row.id, { title: event.target.value })} /></label>
        <label>Цвет провода<span className="wire-blank-color"><input type="color" aria-label={`Цвет полуфабриката ${position + 1}`} value={/^#[0-9a-fA-F]{6}$/.test(row.color) ? row.color : "#26609e"} disabled={blocked} onChange={event => change(row.id, { color: event.target.value })} /><input aria-label={`Код цвета полуфабриката ${position + 1}`} value={row.color} maxLength={7} disabled={blocked} onChange={event => change(row.id, { color: event.target.value })} /></span></label>
        <label>Исполнение начала<select aria-label={`Начало полуфабриката ${position + 1}`} value={row.start} disabled={blocked} onChange={event => change(row.id, { start: event.target.value as WireBlank["start"] })}>{wireBlankEnds.map(end => <option key={end} value={end}>{wireBlankEndLabels[end]}</option>)}</select></label>
        <label>Исполнение конца<select aria-label={`Конец полуфабриката ${position + 1}`} value={row.end} disabled={blocked} onChange={event => change(row.id, { end: event.target.value as WireBlank["end"] })}>{wireBlankEnds.map(end => <option key={end} value={end}>{wireBlankEndLabels[end]}</option>)}</select></label>
      </div>
      <div className="wire-blank-card-actions"><button className="secondary-action" type="button" disabled={blocked} onClick={() => fileInputs.current[row.id]?.click()}>Обновить фото</button><input className="wire-blank-file-input" ref={element => { fileInputs.current[row.id] = element; }} type="file" aria-label={`Обновить фото полуфабриката ${position + 1}`} accept=".png,.jpg,.jpeg,.bmp,.svg,.heic,.heif,image/*" disabled={blocked} onChange={event => { void updatePhoto(row, event.target.files?.[0]); event.target.value = ""; }} />{row.photoDataUrl && <button className="secondary-action" type="button" disabled={blocked} onClick={() => change(row.id, { photoDataUrl: null })}>Вернуть рисунок</button>}<button type="button" disabled={blocked} onClick={() => { setNotice(null); setRows(current => current.filter(item => item.id !== row.id)); }}>Удалить</button></div>
    </article>)}</div>
    <button type="button" className="secondary-action" disabled={blocked} onClick={() => setRows(current => [...current, { id: crypto.randomUUID(), index: "", title: "", color: "#26609e", start: "cut", end: "cut", templateId: "01-cut", photoDataUrl: null, originalPayload: {} }])}>Добавить полуфабрикат</button>
  </section>;
}

