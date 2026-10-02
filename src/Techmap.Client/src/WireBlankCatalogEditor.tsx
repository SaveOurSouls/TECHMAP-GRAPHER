import { useEffect, useId, useRef, useState } from "react";
import type { PublishEditableReferenceTableRequest, ReferenceCatalogSnapshot } from "./reference-catalog-api";
import { wireBlankDraft, wireBlankEndLabels, wireBlankEnds, wireBlankRequest, type WireBlank, type WireBlankEnd } from "./WireBlankCatalog";
import "./wire-blank-catalog.css";

function WireBlankEndGraphic({ end, side, gradientId }: { end: WireBlankEnd; side: "left" | "right"; gradientId: string }) {
  const mirror = side === "right" ? "translate(1200 0) scale(-1 1)" : undefined;
  return <g transform={mirror} aria-label={wireBlankEndLabels[end]}>
    {end === "cut" && <><path d="M220 101Q213 101 213 108V132Q213 139 220 139" fill="#163d68" stroke="#183a5d" strokeWidth="2"/><path d="M214 110V130" stroke="#6887aa" strokeWidth="2" opacity=".65"/></>}
    {end === "copper" && <><path d="M177 108H220V132H177Z" fill={`url(#${gradientId}-copper)`} stroke="#8b4d2e" strokeWidth="1.5"/><path d="M179 112H218M179 117H218M179 122H218M179 127H218" stroke="#87492a" strokeWidth="1" opacity=".8"/><path d="M220 101Q213 101 213 108V132Q213 139 220 139" fill="#163d68" stroke="#183a5d" strokeWidth="2"/></>}
    {end === "tin" && <><path d="M177 108H220V132H177Z" fill={`url(#${gradientId}-tin)`} stroke="#667981" strokeWidth="1.5"/><path d="M179 112H218M179 117H218M179 122H218M179 127H218" stroke="#82969d" strokeWidth="1" opacity=".8"/><path d="M220 101Q213 101 213 108V132Q213 139 220 139" fill="#163d68" stroke="#183a5d" strokeWidth="2"/></>}
    {(end === "terminal" || end === "sealed" || end === "sealed-pin") && <>
      {end !== "terminal" && <><path d="M222 98Q229 87 241 88H280Q293 88 300 98V143Q293 153 280 153H241Q229 152 222 142Z" fill={`url(#${gradientId}-seal)`} stroke="#315748" strokeWidth="2.4"/><path d="M239 89V152M252 88V153M265 88V153M279 89V152" stroke="#d0e0c6" strokeWidth="5" opacity=".75"/></>}
      {end === "sealed-pin" ? <><path d="M139 101H166L177 107V133L166 139H139Z" fill={`url(#${gradientId}-metal)`} stroke="#536671" strokeWidth="2"/><path d="M39 104Q39 96 47 96H136V144H47Q39 144 39 136Z" fill={`url(#${gradientId}-metal)`} stroke="#4c626b" strokeWidth="2.5"/><path d="M53 109H106V131H53Z" fill="#d5e0e3" opacity=".87"/><path d="M80 104V136M93 104V136" stroke="#72848c" strokeWidth="2"/></> : <><path d="M168 103H207L218 109V131L207 137H168L177 130V110Z" fill={`url(#${gradientId}-metal)`} stroke="#526771" strokeWidth="2.2"/><path d="M181 104V136M193 103V137M204 105V135" stroke="#6f838d" strokeWidth="2.2"/><path d="M139 101H165L177 107V133L165 139H139Z" fill={`url(#${gradientId}-metal)`} stroke="#536671" strokeWidth="2"/></>}
    </>}
  </g>;
}

export function WireBlankPreview({ row }: { row: WireBlank }) {
  const clipId = useId().replaceAll(":", "");
  if (row.photoDataUrl) return <img className="wire-blank-preview" src={row.photoDataUrl} alt={`Фото полуфабриката ${row.title}`} />;
  return <svg className="wire-blank-preview" viewBox="0 0 1200 240" role="img" aria-label={`${row.title}: ${wireBlankEndLabels[row.start]} — ${wireBlankEndLabels[row.end]}`}>
    <defs><linearGradient id={`${clipId}-copper`} x2="0" y2="1"><stop stopColor="#e7ab73"/><stop offset=".48" stopColor="#b76739"/><stop offset="1" stopColor="#814529"/></linearGradient><linearGradient id={`${clipId}-tin`} x2="0" y2="1"><stop stopColor="#f7faf9"/><stop offset=".5" stopColor="#b7c4c7"/><stop offset="1" stopColor="#738b92"/></linearGradient><linearGradient id={`${clipId}-metal`} x2="0" y2="1"><stop stopColor="#e9eff2"/><stop offset=".5" stopColor="#aebfc8"/><stop offset="1" stopColor="#657783"/></linearGradient><linearGradient id={`${clipId}-seal`} x2="0" y2="1"><stop stopColor="#a6c7a4"/><stop offset=".45" stopColor="#648e75"/><stop offset="1" stopColor="#355b53"/></linearGradient></defs>
    <rect x="220" y="96" width="760" height="48" rx="17" fill={row.color} stroke="#263746" strokeWidth="3" />
    <path d="M320 104H880" stroke="#fff" strokeWidth="3" opacity=".28" />
    <WireBlankEndGraphic end={row.start} side="left" gradientId={clipId} />
    <WireBlankEndGraphic end={row.end} side="right" gradientId={clipId} />
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

