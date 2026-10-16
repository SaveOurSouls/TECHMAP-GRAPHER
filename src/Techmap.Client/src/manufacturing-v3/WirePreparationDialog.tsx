import { useEffect, useMemo, useRef, useState } from "react";
import type { LocalSession } from "../local-session";
import type { RuntimeConfig } from "../runtime-config";
import { createReferenceCatalogApi } from "../reference-catalog-api";
import { wireBlankDraft, wireBlankSourceId, type WireBlank } from "../WireBlankCatalog";
import { wirePreparationDraft, wirePreparationReady, wirePreparationSourceId, type WirePreparationScheme } from "../WirePreparationCatalog";
import type { HarnessDesignDocument } from "../editor/model";
import type { RouteV3Document } from "./route-v3-model";
import { wirePreparationAssignments, wirePreparationDefault, type WirePreparationAssignment } from "./route-v3-wire-preparation";
import { buildRouteV3SourceItems } from "./route-v3-wire-terminals";
import { RouteV3WireArtworkPreview } from "./route-v3-wire-artwork";
import "../wire-preparation.css";

export function useWirePreparationCatalogs(config: RuntimeConfig, session: LocalSession) {
  const api = useMemo(() => createReferenceCatalogApi(config, session), [config, session]);
  const [data, setData] = useState<{ schemes: WirePreparationScheme[]; blanks: WireBlank[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void Promise.all([api.getActive(wirePreparationSourceId), api.getActive(wireBlankSourceId)]).then(([schemes, blanks]) => {
      if (!schemes || !blanks) throw new Error("Справочники схем и полуфабрикатов провода не загружены.");
      if (!cancelled) setData({ schemes: wirePreparationDraft(schemes), blanks: wireBlankDraft(blanks) });
    }).catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : "Не удалось загрузить справочники."); });
    return () => { cancelled = true; };
  }, [api]);
  return { data, error };
}
export function WirePreparationDialog({ route, source, schemes, blanks, onApply, onClose }: {
  route: RouteV3Document; source: HarnessDesignDocument; schemes: readonly WirePreparationScheme[]; blanks: readonly WireBlank[];
  onApply: (assignments: readonly WirePreparationAssignment[], schemes: readonly WirePreparationScheme[]) => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [rows, setRows] = useState(() => wirePreparationAssignments(route, source, blanks));
  const [error, setError] = useState<string | null>(null);
  const [confirmReplacement, setConfirmReplacement] = useState(false);
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close(); }, []);
  const sources = buildRouteV3SourceItems(source);
  // Deleted catalog recipes remain usable from the pinned route snapshot.
  const available = [...schemes, ...(route.wirePreparation?.schemes ?? []).filter(s => !schemes.some(v => v.id === s.id))];
  const selected = new Set(rows.map(r => r.schemeId).filter(Boolean));
  const steps = available.filter(s => selected.has(s.id) && wirePreparationReady(s)).reduce((sum, s) => sum + s.operations.length, 0);
  return <dialog ref={dialog} className="route-v3-dialog wire-preparation-dialog" aria-label="Заготовка провода" onCancel={e => { e.preventDefault(); onClose(); }}>
    <header className="section-title-row"><div><h2>Заготовка провода</h2><p>{rows.length} проводов · {selected.size} схем · {steps} карточек операций</p></div><button type="button" onClick={onClose}>Закрыть</button></header>
    <p>Схема по умолчанию берётся из «Полуфабрикаты провода». Каждая схема начинается отдельно из исходного сырья. Её операции образуют собственную цепочку в соседней колонке: одна операция — одна карточка. Провода без схемы останутся в отдельной группе.</p>
    {error && <p role="alert">{error}</p>}
    <div className="wire-preparation-scroll"><table><thead><tr><th>Полуфабрикат</th><th>Провод / подключения</th><th>Длина, мм</th><th>Схема заготовки</th><th>Операции по порядку</th></tr></thead><tbody>{rows.map(row => {
      const item = sources.find(i => i.ref.kind === "wire" && i.ref.id === row.wireId);
      const blank = wirePreparationDefault(source, row.wireId, blanks);
      const scheme = available.find(s => s.id === row.schemeId);
      return <tr key={row.wireId}><td>{item && <RouteV3WireArtworkPreview document={source} item={item} />}</td><td>{item?.title ?? row.wireId}<small>{blank?.title ?? "Исполнение отсутствует в справочнике"}</small></td><td>{item?.lengthMm ?? "Не задана"}</td><td><select aria-label={`Схема провода ${row.wireId}`} value={row.schemeId ?? ""} onChange={e => setRows(current => current.map(r => r.wireId === row.wireId ? { ...r, schemeId: e.target.value || null } : r))}><option value="">Не назначена</option>{row.schemeId && !scheme && <option value={row.schemeId}>Схема недоступна</option>}{available.map(s => <option key={s.id} value={s.id}>{s.name}{wirePreparationReady(s) ? "" : " — заполните операции"}</option>)}</select><button type="button" onClick={() => setRows(current => current.map(r => r.wireId === row.wireId ? { ...r, schemeId: blank?.defaultSchemeId ?? null } : r))}>По умолчанию</button></td><td>{scheme ? <ol>{scheme.operations.map((op, i) => <li key={i}>{op?.catalogBinding?.displayName ?? "Операция не назначена"}</li>)}</ol> : "Выберите схему"}</td></tr>;
    })}</tbody></table></div>
    {confirmReplacement && <p role="alert">Операции карточек заготовки будут заменены выбранными схемами. Рисунки и размеры совпавших этапов сохранятся. Каждая цепочка будет размещена в отдельной колонке; выходы переподключатся к последним этапам своих схем.</p>}
    <footer><button type="button" onClick={onClose}>Отмена</button><button type="button" className="primary-action" onClick={() => {
      try {
        for (const row of rows) if (row.schemeId && !available.some(s => s.id === row.schemeId && wirePreparationReady(s))) throw new Error(`Провод ${row.wireId}: заполните операции выбранной схемы в справочнике.`);
        const authored = route.nodes.filter(n => n.id === "prepared:wire" || n.wirePreparationStage).some(n => n.operations?.length || n.drawing);
        if (authored && !confirmReplacement) { setConfirmReplacement(true); return; }
        onApply(rows, available);
      } catch (e) { setError(e instanceof Error ? e.message : "Не удалось применить схемы."); }
    }}>{confirmReplacement ? "Подтвердить замену" : "Применить схемы"}</button></footer>
  </dialog>;
}
