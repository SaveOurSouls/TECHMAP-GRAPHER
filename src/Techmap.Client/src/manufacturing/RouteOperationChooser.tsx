import { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import type { ReferenceCatalogRecord, ReferenceCatalogSnapshot, ReferenceCatalogSourceSummary } from "../reference-catalog-api";

export interface RouteOperationChooserProps {
  readonly id: string;
  readonly sources: readonly ReferenceCatalogSourceSummary[];
  readonly sourceId: string;
  readonly onSourceChange: (sourceId: string) => void;
  readonly snapshot: ReferenceCatalogSnapshot | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly onChoose: (record: ReferenceCatalogRecord) => void;
  readonly onClose: () => void;
}

function text(payload: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function category(record: ReferenceCatalogRecord): string {
  return text(record.payload, "name") ?? "Без категории";
}

function label(record: ReferenceCatalogRecord): string {
  for (const key of ["operationType", "machine", "instruction", "name"]) {
    const value = text(record.payload, key);
    if (value) return value;
  }
  return "Операция";
}

export function RouteOperationChooser({ id, sources, sourceId, onSourceChange, snapshot, loading, error, onChoose, onClose }: RouteOperationChooserProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const initialFocus = useRef<HTMLElement | null>(null);
  const records = snapshot?.records.filter(record => record.entityType === "operation") ?? [];
  const groups = useMemo(() => {
    const grouped = new Map<string, ReferenceCatalogRecord[]>();
    for (const record of records) {
      const key = category(record);
      const bucket = grouped.get(key) ?? [];
      bucket.push(record);
      grouped.set(key, bucket);
    }
    return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b, "ru"));
  }, [records]);

  useEffect(() => {
    initialFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const dialog = dialogRef.current;
    const focusable = () => dialog ? [...dialog.querySelectorAll<HTMLElement>("button, select, [href], input, textarea, [tabindex]:not([tabindex='-1'])")].filter(item => !item.hasAttribute("disabled")) : [];
    const focusFirst = () => { focusable()[0]?.focus(); };
    focusFirst();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) { event.preventDefault(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    dialog?.addEventListener("keydown", onKeyDown);
    return () => { dialog?.removeEventListener("keydown", onKeyDown); document.body.style.overflow = previousOverflow; initialFocus.current?.focus(); };
  }, [onClose]);

  return createPortal(
    <div className="manufacturing-route-panel manufacturing-route-portal" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} id={id} className="manufacturing-route-dialog route-operation-chooser-modal" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`}>
        <header className="route-operation-chooser-modal-header"><div><p className="eyebrow">СПРАВОЧНИК БД.ОП</p><h2 id={`${id}-title`}>Категории операций</h2></div><button type="button" aria-label="Закрыть окно выбора операции" onClick={onClose}>×</button></header>
        {sources.length > 1 && <label className="route-operation-chooser-source">Справочник<select aria-label="Справочник операций" value={sourceId} onChange={event => onSourceChange(event.target.value)}>{sources.map(source => <option key={source.sourceId} value={source.sourceId}>{source.displayName}</option>)}</select></label>}
        <div className="route-operation-chooser-modal-body">
          {loading && <p role="status">Загружаем операции…</p>}
          {error && <p role="alert" className="manufacturing-route-error">{error}</p>}
          {!loading && !error && !sources.length && <p>Загрузите справочник БД.ОП.</p>}
          {!loading && !error && snapshot && !records.length && <p>В справочнике нет операций.</p>}
          {groups.map(([name, items]) => <section key={name} className="route-operation-category" aria-labelledby={`${id}-${name}`}><h3 id={`${id}-${name}`}>{name}</h3><div className="route-operation-card-grid">{items.map(record => <button key={record.recordId} type="button" className="route-operation-card" onClick={() => onChoose(record)}><span className="route-operation-icon" aria-hidden="true">⚙</span><span><strong>{label(record)}</strong><small>№ {record.sourceKey}</small></span></button>)}</div></section>)}
        </div>
      </section>
    </div>,
    document.body,
  );
}
