import { useEffect, useState } from "react";
import type { HarnessCutList, HarnessCutListApi, HarnessCutListItem } from "./harness-cut-list-api";

export interface HarnessCutListPanelProps {
  readonly api: HarnessCutListApi;
  readonly projectId: string;
  readonly harnessId: string;
  readonly onReveal?: (id: string) => void;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Не удалось загрузить карту резки.";
}

function formatMillimetres(value: number | null): string {
  return value === null ? "Не задана" : `${value.toLocaleString("ru-RU", { maximumFractionDigits: 3 })} мм`;
}

function formatCorrection(item: HarnessCutListItem): string {
  const format = (value: number) => `${value > 0 ? "+" : ""}${value.toLocaleString("ru-RU", { maximumFractionDigits: 3 })}`;
  return `${format(item.endCorrectionFromMm)} / ${format(item.endCorrectionToMm)} мм`;
}

export function HarnessCutListTable({ cutList, onReveal, highlightedIds = [] }: { readonly cutList: HarnessCutList; readonly onReveal?: (id: string) => void; readonly highlightedIds?: readonly string[] }) {
  return <>
    {cutList.warning && <p className="cut-list-warning" role="note">{cutList.warning}</p>}
    {cutList.items.length === 0 ? <p className="cut-list-empty">В жгуте пока нет проводов.</p> : (
      <div className="cut-list-scroll">
        <table className="cut-list-table">
          <thead><tr>
            <th>Цепь / провод</th>
            <th>Исходная длина</th>
            <th>Поправки</th>
            <th>Длина резки</th>
            <th>Шт.</th>
            <th>Общий метраж</th>
            <th>Статус</th>
          </tr></thead>
          <tbody>{cutList.items.map(item => <tr key={item.wireId} aria-selected={highlightedIds.includes(item.wireId)} className={highlightedIds.includes(item.wireId) ? "is-related" : ""}>
            <td>{onReveal ? <button type="button" className="ui-control" onClick={() => onReveal(item.wireId)} aria-label={`Показать на чертеже ${item.circuit || item.wireId}`}>{item.circuit || "Без цепи"} ↗</button> : <strong>{item.circuit || "Без цепи"}</strong>}<span>{item.wireId}</span><small>{item.materialDisplayName ?? (item.material === "not-pinned" ? "Материал не закреплён" : item.material)}{item.materialSourceKey && item.materialSourceKey !== item.materialDisplayName ? ` · ${item.materialSourceKey}` : ""}</small></td>
            <td>{formatMillimetres(item.sourceLengthMm)}</td>
            <td>{formatCorrection(item)}<small>шаг {formatMillimetres(item.roundingStepMm)}</small></td>
            <td>{formatMillimetres(item.cutLengthMm)}</td>
            <td>{item.pieces.toLocaleString("ru-RU")}</td>
            <td>{item.totalMetres === null ? "Не рассчитан" : `${item.totalMetres.toLocaleString("ru-RU", { maximumFractionDigits: 6 })} м`}</td>
            <td><span className={`cut-list-status ${item.status}`}>{item.warnings.includes("length-missing") ? "Нет длины" : item.warnings.includes("material-missing") ? "Нет материала" : "Готово"}</span></td>
          </tr>)}</tbody>
        </table>
      </div>
    )}
  </>;
}

export function HarnessCutListPanel({ api, projectId, harnessId, onReveal }: HarnessCutListPanelProps) {
  const [refresh, setRefresh] = useState(0);
  const [cutList, setCutList] = useState<HarnessCutList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void api.get(projectId, harnessId).then(result => {
      if (!cancelled) setCutList(result);
    }).catch(loadError => {
      if (!cancelled) setError(errorText(loadError));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [api, harnessId, projectId, refresh]);

  const current = cutList?.projectId.toLocaleLowerCase() === projectId.toLocaleLowerCase() &&
    cutList.harnessId.toLocaleLowerCase() === harnessId.toLocaleLowerCase() ? cutList : null;

  return <details className="harness-cut-list">
    <summary>Карта резки <span>{current?.items.length ?? 0}</span></summary>
    <div className="cut-list-body">
      <div className="cut-list-heading">
        <p>Первая ведомость длин одного жгута. После сохранения редактора обновите данные.</p>
        <button className="refresh-button" type="button" aria-label="Обновить карту резки после сохранения редактора" onClick={() => setRefresh(value => value + 1)} disabled={loading}>
          {loading ? "Загрузка…" : "Обновить после сохранения"}
        </button>
      </div>
      {error && <p className="cut-list-error" role="alert">{error}</p>}
      {current ? <HarnessCutListTable cutList={current} onReveal={onReveal} />
        : loading ? <p className="cut-list-loading" role="status">Загружаем карту резки…</p>
          : !error && <p className="cut-list-empty">Карта резки пока недоступна.</p>}
    </div>
  </details>;
}
