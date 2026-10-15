import { useEffect, useId, useMemo, useState } from 'react';
import { BUILTIN_TERMINATION_RECORDS, TERMINATION_ASSETS, type TerminationLibraryRecord, type TerminationView } from './catalog';
import { type StorageLike } from './storage';
import { groupTerminationSeries } from './series';
import { useTerminationCatalog } from './useTerminationCatalog';
import { TerminationSeriesTables } from './TerminationSeriesTables';
import './termination-library.css';

export interface TerminationLibraryPickerProps {
  readonly onSelect: (record: TerminationLibraryRecord) => void;
  readonly onClose?: () => void;
  readonly selectedId?: string;
  readonly view?: TerminationView;
  readonly storage?: StorageLike;
  readonly error?: string | null;
}
/** Editor entry point is read-only; authoring lives only on the home screen. */
export function TerminationLibraryPicker({ onSelect, onClose, selectedId, view = 'drawing', storage, error }: TerminationLibraryPickerProps) {
  const prefix = useId();
  const { catalog, storageError } = useTerminationCatalog(storage);
  const [selected, setSelected] = useState(selectedId ?? BUILTIN_TERMINATION_RECORDS[0]!.id);
  const [query, setQuery] = useState(''), [family, setFamily] = useState('');
  const [previewView, setPreviewView] = useState<TerminationView>(view);
  useEffect(() => { if (selectedId) setSelected(selectedId); }, [selectedId]);
  const groups = useMemo(() => groupTerminationSeries(catalog.records, catalog.series), [catalog]);
  const current = [...BUILTIN_TERMINATION_RECORDS, ...catalog.records].find(r => r.id === selected) ?? BUILTIN_TERMINATION_RECORDS[0]!;
  return <section className="termination-library termination-library-picker" aria-labelledby={`${prefix}-title`}>
    <header className="termination-library-header"><div><h3 id={`${prefix}-title`}>Библиотека оконцовок</h3><p>Выбор готового артикула. Свойства доступны для просмотра.</p></div>{onClose && <button type="button" onClick={onClose} aria-label="Закрыть библиотеку оконцовок">Закрыть</button>}</header>
    {error && <p className="termination-error" role="alert">{error}</p>}
    {storageError && <p className="termination-error" role="alert">{storageError} Пользовательские записи не перезаписываются.</p>}
    <div className="termination-library-search"><label>Поиск<input value={query} onChange={e => setQuery(e.target.value)} placeholder="Серия, производитель или артикул" /></label><label>Форма<select value={family} onChange={e => setFamily(e.target.value)}><option value="">Все формы</option>{TERMINATION_ASSETS.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label></div>
    <div className="termination-preview-tabs" role="group" aria-label="Вид рисунка"><button type="button" aria-pressed={previewView === 'drawing'} onClick={() => setPreviewView('drawing')}>Чертёж</button><button type="button" aria-pressed={previewView === 'e4'} onClick={() => setPreviewView('e4')}>Э4</button></div>
    <TerminationSeriesTables groups={groups} query={query} family={family} selectedId={current.id} onSelect={r => setSelected(r.id)} view={previewView} />
    <footer className="termination-library-footer"><div className="termination-current"><strong>{current.name}</strong><small>{current.article ?? 'Шаблон · артикул не задан'}</small></div><div className="termination-actions"><button type="button" onClick={() => onSelect(current)}>Выбрать</button></div></footer>
  </section>;
}
