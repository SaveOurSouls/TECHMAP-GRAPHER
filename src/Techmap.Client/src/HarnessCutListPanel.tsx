import { useEffect, useState } from "react";
import type { HarnessCutList, HarnessCutListApi, HarnessCutListItem } from "./harness-cut-list-api";
import type { HarnessDesignDocument } from "./editor/model";
import { groupedCutListPresentation, nextCutListSort, type CutListSortField } from "./editor/cut-list-presentation";

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

export function HarnessCutListTable({ cutList, document, onReveal, highlightedIds = [] }: { readonly cutList: HarnessCutList; readonly document?: HarnessDesignDocument; readonly onReveal?: (id: string) => void; readonly highlightedIds?: readonly string[] }) {
  const [filter, setFilter] = useState("");
  const [sorts, setSorts] = useState<readonly { readonly field: CutListSortField; readonly direction: "asc" | "desc" }[]>([]);
  const groups = groupedCutListPresentation(cutList.items, document, filter, sorts);
  const sortButton = (field: CutListSortField, label: string) => {
    const index = sorts.findIndex(sort => sort.field === field), current = sorts[index];
    return <button type="button" className="cut-list-sort" onClick={() => setSorts(value => nextCutListSort(value, field))} aria-label={`Сортировать по ${label}`} aria-pressed={index >= 0}>{label}{index >= 0 ? ` ${index + 1}${current!.direction === "desc" ? "↓" : "↑"}` : ""}</button>;
  };
  return <>
    {cutList.warning && <p className="cut-list-warning" role="note">{cutList.warning}</p>}
    {cutList.items.length === 0 ? <p className="cut-list-empty">В жгуте пока нет проводов.</p> : (
      <>
      <div className="cut-list-controls"><label>Фильтр <input type="search" value={filter} onChange={event => setFilter(event.target.value)} placeholder="ПФ, марка, цвет, терминал" aria-label="Фильтр карты резки" /></label><span>{sortButton("mark", "Марка")}{sortButton("color", "Цвет")}{sortButton("section", "Сечение")}{sortButton("terminal", "Терминал")}</span></div>
      {groups.length === 0 ? <p className="cut-list-empty">По фильтру полуфабрикаты не найдены.</p> : <div className="cut-list-scroll">
        <table className="cut-list-table">
          <thead><tr>
            <th>Полуфабрикат</th>
            <th>Марка</th>
            <th>Сечение</th>
            <th>Цвет</th>
            <th>Конец A</th>
            <th>Конец B</th>
            <th>Исходная длина</th>
            <th>Поправки</th>
            <th>Длина резки</th>
            <th>Шт.</th>
            <th>Общий метраж</th>
            <th>Статус</th>
          </tr></thead>
          <tbody>{groups.flatMap(group => [<tr key={`group:${group.id}`} className="cut-list-group"><th colSpan={12}>{group.title} · {group.rows.length}</th></tr>, ...group.rows.map(({ item, name, mark, section, color, terminalFrom, terminalTo }) => <tr key={item.wireId} aria-selected={highlightedIds.includes(item.wireId)} className={highlightedIds.includes(item.wireId) ? "is-related" : ""}>
            <td>{onReveal ? <button type="button" className="ui-control" onClick={() => onReveal(item.wireId)} aria-label={`Показать на чертеже ${name}`}>{name} ↗</button> : <strong>{name}</strong>}<span>{item.wireId}</span><small>{item.materialDisplayName ?? (item.material === "not-pinned" ? "Материал не закреплён" : item.material)}{item.materialSourceKey && item.materialSourceKey !== item.materialDisplayName ? ` · ${item.materialSourceKey}` : ""}</small></td>
            <td>{mark}</td><td>{section}</td><td>{color}</td><td>{terminalFrom}</td><td>{terminalTo}</td>
            <td>{formatMillimetres(item.sourceLengthMm)}</td>
            <td>{formatCorrection(item)}<small>шаг {formatMillimetres(item.roundingStepMm)}</small></td>
            <td>{formatMillimetres(item.cutLengthMm)}</td>
            <td>{item.pieces.toLocaleString("ru-RU")}</td>
            <td>{item.totalMetres === null ? "Не рассчитан" : `${item.totalMetres.toLocaleString("ru-RU", { maximumFractionDigits: 6 })} м`}</td>
            <td><span className={`cut-list-status ${item.status}`}>{item.warnings.includes("length-missing") ? "Нет длины" : item.warnings.includes("material-missing") ? "Нет материала" : "Готово"}</span></td>
          </tr>)])}</tbody>
        </table>
      </div>}</>
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
    setCutList(null);
    setError(null);
    void api.get(projectId, harnessId).then(result => {
      if (!cancelled) setCutList(result);
    }).catch(loadError => {
      if (!cancelled) { setCutList(null); setError(errorText(loadError)); }
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
