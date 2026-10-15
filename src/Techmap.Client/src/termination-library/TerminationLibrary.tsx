import { useEffect, useMemo, useRef, useState } from 'react';
import { TERMINATION_ASSETS, type TerminationLibraryRecord } from './catalog';
import { generateTerminationSeries, groupTerminationSeries, type TerminationSeries, type TerminationSeriesGeneration, type TerminationSeriesGroup } from './series';
import { saveTerminationSeries, type StorageLike, type TerminationCatalog } from './storage';
import { useTerminationCatalog } from './useTerminationCatalog';
import { TerminationRecordTable } from './TerminationRecordTable';
import { TerminationSeriesTables } from './TerminationSeriesTables';
import './termination-library.css';

type NavigationGuard = (guard: (() => Promise<boolean>) | null) => void;
interface Props { readonly storage?: StorageLike; readonly onNavigationGuard?: NavigationGuard }
interface Draft { readonly series: TerminationSeries; readonly records: readonly TerminationLibraryRecord[]; readonly expected: TerminationCatalog }
const initialGenerator: TerminationSeriesGeneration = { name: '', manufacturer: '', assetId: 'nki-ring', articlePattern: 'ART-{n}', start: 1, step: 1, count: 3, padding: 2 };

export function TerminationLibrary({ storage, onNavigationGuard }: Props) {
  const { target, catalog, setCatalog, storageError, reload } = useTerminationCatalog(storage);
  const [query, setQuery] = useState(''), [family, setFamily] = useState('');
  const [generator, setGenerator] = useState<TerminationSeriesGeneration>(initialGenerator);
  const [showGenerator, setShowGenerator] = useState(false), [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null), [message, setMessage] = useState<string | null>(null);
  const draftAnchor = useRef<HTMLElement>(null);
  const groups = useMemo(() => groupTerminationSeries(catalog.records, catalog.series), [catalog]);
  const dirty = showGenerator || draft !== null;
  useEffect(() => { if (draft) draftAnchor.current?.scrollIntoView({ block: 'start' }); }, [draft?.series.id]);
  useEffect(() => {
    const guard = async () => !dirty || window.confirm('Изменения серии не сохранены. Покинуть библиотеку?');
    onNavigationGuard?.(guard);
    const unload = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', unload);
    return () => { onNavigationGuard?.(null); window.removeEventListener('beforeunload', unload); };
  }, [dirty, onNavigationGuard]);
  const run = (action: () => void) => { try { setMessage(null); action(); setError(null); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось сохранить серию.'); } };
  const edit = (group: TerminationSeriesGroup) => {
    setDraft({ series: { id: group.origin === 'legacy' ? `series:${crypto.randomUUID()}` : group.id, name: group.name, manufacturer: group.manufacturer, assetId: group.assetId, recordIds: group.recordIds }, records: group.records, expected: catalog });
    setShowGenerator(false); setError(null); setMessage(null);
  };
  const generate = () => run(() => {
    const generated = generateTerminationSeries(generator);
    if (draft) {
      if (generated.series.assetId !== draft.series.assetId || generated.series.manufacturer !== draft.series.manufacturer) throw new Error('При дополнении серии форма и производитель должны совпадать.');
      setDraft({ ...draft, records: [...draft.records, ...generated.records], series: { ...draft.series, recordIds: [...draft.series.recordIds, ...generated.series.recordIds] } });
    } else setDraft({ ...generated, expected: catalog });
    setShowGenerator(false);
  });
  return <section className="termination-library termination-library-home" aria-label="Библиотека оконцовок">
    <header className="termination-library-header"><div><h3>Библиотека оконцовок</h3><p>Постоянная библиотека · одна таблица на серию, одна строка на артикул</p></div><div className="termination-actions"><button type="button" disabled={dirty || !!storageError || !target} onClick={() => { setGenerator(initialGenerator); setShowGenerator(true); setMessage(null); }}>Генерировать серию</button><button type="button" disabled={dirty} onClick={reload}>Обновить</button></div></header>
    {storageError && <p className="termination-error" role="alert">{storageError} Сохранение недоступно; существующие данные не перезаписываются.</p>}
    {error && <p className="termination-error" role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {showGenerator && <form className="termination-series-generator" aria-label="Генерация серии" onSubmit={e => { e.preventDefault(); generate(); }}>
      <h4>{draft ? 'Дополнить серию' : 'Новая серия'}</h4><div className="termination-generator-grid">
        <label>Название серии<input required value={generator.name} maxLength={512} disabled={!!draft} onChange={e => setGenerator({ ...generator, name: e.target.value })} /></label>
        <label>Производитель<input required value={generator.manufacturer} maxLength={4096} disabled={!!draft} onChange={e => setGenerator({ ...generator, manufacturer: e.target.value })} /></label>
        <label>Форма<select value={generator.assetId} disabled={!!draft} onChange={e => setGenerator({ ...generator, assetId: e.target.value })}>{TERMINATION_ASSETS.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        <label>Шаблон артикула<input required value={generator.articlePattern} maxLength={512} onChange={e => setGenerator({ ...generator, articlePattern: e.target.value })} /><small>{'{n} — порядковый номер; после генерации артикулы можно изменить в таблице.'}</small></label>
        {(['count', 'start', 'step', 'padding'] as const).map(key => <label key={key}>{({ count: 'Количество артикулов', start: 'Начальный номер', step: 'Шаг номера', padding: 'Разрядность номера' })[key]}<input type="number" required min={key === 'start' || key === 'padding' ? 0 : 1} max={key === 'count' ? 200 : key === 'padding' ? 12 : undefined} step={1} value={generator[key]} onChange={e => setGenerator({ ...generator, [key]: Number(e.target.value) })} /></label>)}
      </div><div className="termination-actions"><button type="submit">Сгенерировать строки</button><button type="button" onClick={() => { setShowGenerator(false); setError(null); }}>Отмена генерации</button></div>
    </form>}
    {draft && <section ref={draftAnchor} className="termination-series-draft" aria-label="Таблица редактирования серии">
      <div className="termination-generator-grid"><label>Название серии<input value={draft.series.name} maxLength={512} onChange={e => setDraft({ ...draft, series: { ...draft.series, name: e.target.value } })} /></label><label>Производитель серии<input value={draft.series.manufacturer ?? ''} maxLength={4096} onChange={e => { const manufacturer = e.target.value || null; setDraft({ ...draft, series: { ...draft.series, manufacturer }, records: draft.records.map(r => ({ ...r, manufacturer })) }); }} /></label></div>
      <p>Неизвестные параметры оставьте пустыми. Комбинации: 0.5 + 0.5; 1 + 1. Цвет рисунка не задаёт сечение.</p>
      <TerminationRecordTable records={draft.records} label="Параметры артикулов серии" onChange={record => setDraft(current => current && ({ ...current, records: current.records.map(r => r.id === record.id ? record : r) }))} />
      <div className="termination-actions"><button type="button" disabled={!!storageError || !target || showGenerator} onClick={() => run(() => { if (!target) throw new Error('Хранилище недоступно.'); const next = saveTerminationSeries(target, draft.series, draft.records, draft.expected); setCatalog(next); setDraft(null); setMessage('Серия сохранена.'); })}>Сохранить серию</button><button type="button" disabled={showGenerator} onClick={() => { setGenerator({ ...initialGenerator, name: draft.series.name, manufacturer: draft.series.manufacturer ?? '', assetId: draft.series.assetId }); setShowGenerator(true); }}>Дополнить генерацией</button><button type="button" onClick={() => { setDraft(null); setShowGenerator(false); setError(null); }}>Отменить изменения</button></div>
    </section>}
    <div className="termination-library-search"><label>Поиск<input value={query} onChange={e => setQuery(e.target.value)} placeholder="Серия, производитель или артикул" /></label><label>Форма<select value={family} onChange={e => setFamily(e.target.value)}><option value="">Все формы</option>{TERMINATION_ASSETS.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label></div>
    <TerminationSeriesTables groups={groups} query={query} family={family} onEdit={!dirty && !storageError ? edit : undefined} />
  </section>;
}
