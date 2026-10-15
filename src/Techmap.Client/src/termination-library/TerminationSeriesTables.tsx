import { terminationAsset, type TerminationLibraryRecord, type TerminationView } from './catalog';
import type { TerminationSeriesGroup } from './series';
import { TerminationRecordTable } from './TerminationRecordTable';

interface Props {
  readonly groups: readonly TerminationSeriesGroup[];
  readonly query: string;
  readonly family: string;
  readonly selectedId?: string;
  readonly onSelect?: (record: TerminationLibraryRecord) => void;
  readonly onEdit?: (group: TerminationSeriesGroup) => void;
  readonly view?: TerminationView;
}
export function TerminationSeriesTables({ groups, query, family, selectedId, onSelect, onEdit, view }: Props) {
  const needle = query.trim().toLocaleLowerCase('ru-RU');
  const matches = groups.filter(g => !family || g.assetId === family).map(g => ({ ...g, records: g.records.filter(r => !needle || [g.name, r.name, r.manufacturer, r.article].some(s => s?.toLocaleLowerCase('ru-RU').includes(needle))) })).filter(g => g.records.length);
  return <div className="termination-series-tables">
    <p className="termination-result-count" role="status">Серий: {matches.length} · строк: {matches.reduce((n, g) => n + g.records.length, 0)}</p>
    {matches.map(g => <section className="termination-series" key={g.id} aria-label={`Серия ${g.name}`}>
      <header><div><h4>{g.name}</h4><small>{terminationAsset(g.assetId)?.name} · {g.manufacturer ?? 'Производитель не задан'} · {g.origin === 'template' ? 'Защищённый шаблон формы' : `${g.records.length} артикулов`}</small></div>{onEdit && g.origin !== 'template' && <button type="button" onClick={() => onEdit(groups.find(full => full.id === g.id)!)}>Изменить серию</button>}</header>
      <TerminationRecordTable records={g.records} label={`Артикулы серии ${g.name}`} selectedId={selectedId} onSelect={onSelect} view={view} />
    </section>)}
    {!matches.length && <p className="termination-empty" role="status">Совпадений нет. Измените поиск или форму.</p>}
  </div>;
}
