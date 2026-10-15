import { useId, type ReactNode } from 'react';
import { terminationAsset, terminationDimensionFields, type TerminationLibraryRecord, type TerminationView } from './catalog';
import { TerminationSymbol } from './TerminationSymbol';

interface Props {
  readonly records: readonly TerminationLibraryRecord[];
  readonly label: string;
  readonly selectedId?: string;
  readonly onSelect?: (record: TerminationLibraryRecord) => void;
  readonly onChange?: (record: TerminationLibraryRecord) => void;
  readonly view?: TerminationView;
}
/** One catalog row contract for the home library, picker and pinned properties. */
export function TerminationRecordTable({ records, label, selectedId, onSelect, onChange, view = 'drawing' }: Props) {
  const prefix = useId();
  const dimensions = [...new Set(records.flatMap(r => terminationDimensionFields(r.assetId)))];
  const columns = ['Рисунок', 'Артикул', 'Наименование', 'Производитель', 'Форма', 'Исполнение рисунка', 'Цвет по каталогу', 'Материал наконечника', 'Изоляция', ...dimensions.map(k => `${k}, мм`), 'Ток, А', 'Зачистка, мм', 'Поправка резки, мм', 'Поправка зачистки, мм', 'Проводников от', 'Проводников до', 'Сечение от, мм²', 'Сечение до, мм²', 'Комбинации сечений, мм²', 'Материалы проводников', 'Условия подтверждены', 'Источник условий совместимости', 'Источник данных', 'Примечание'];
  return <div className="termination-table-scroll" role="region" aria-label={label} tabIndex={0} title="Все параметры строки доступны при прокрутке таблицы по горизонтали">
    <table className="termination-record-table" aria-label={label}>
      <thead><tr>{onSelect && <th scope="col">Выбор</th>}{columns.map(c => <th scope="col" key={c}>{c}</th>)}</tr></thead>
      <tbody>{records.map(r => {
        const patch = (p: Partial<TerminationLibraryRecord>) => onChange?.({ ...r, ...p });
        const text = (key: 'article' | 'name' | 'colorName' | 'material' | 'insulation' | 'source' | 'notes', title: string) => onChange
          ? <input aria-label={`${title} · ${r.id}`} value={r[key] ?? ''} maxLength={key === 'name' || key === 'article' ? 512 : 4096} onChange={e => patch({ [key]: e.target.value || null })} />
          : r[key] ?? (key === 'article' ? 'Артикул не задан' : 'Неизвестно');
        const number = (value: number | null, title: string, change: (v: number | null) => void): ReactNode => onChange
          ? <input aria-label={`${title} · ${r.id}`} inputMode="decimal" defaultValue={value ?? ''} placeholder="Неизвестно" onChange={e => change(e.target.value.trim() ? Number(e.target.value.replace(',', '.')) : null)} />
          : value ?? 'Неизвестно';
        const ruleNumber = (key: 'minCount' | 'maxCount' | 'minSectionMm2' | 'maxSectionMm2', title: string) => number(r.conductorRules[key], title, value => patch({ conductorRules: { ...r.conductorRules, [key]: value } }));
        const color = terminationAsset(r.assetId)?.colorOptions;
        return <tr key={r.id} className={selectedId === r.id ? 'is-selected' : undefined}>
          {onSelect && <td><input type="radio" name={`${prefix}-record`} checked={selectedId === r.id} aria-label={`Выбрать ${r.article ?? r.name}`} onChange={() => onSelect(r)} /></td>}
          <td><TerminationSymbol record={r} view={view} width={100} height={55} alt="" /></td>
          <td>{text('article', 'Артикул')}</td><td>{text('name', 'Наименование')}</td><td>{r.manufacturer ?? 'Неизвестно'}</td><td>{terminationAsset(r.assetId)?.name}</td>
          <td>{onChange ? <select aria-label={`Исполнение рисунка · ${r.id}`} value={r.colorId ?? ''} onChange={e => patch({ colorId: e.target.value || null })}><option value="">Исходный рисунок</option>{color?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select> : color?.find(c => c.id === r.colorId)?.name ?? 'Исходный рисунок'}</td>
          <td>{text('colorName', 'Цвет по каталогу')}</td><td>{text('material', 'Материал наконечника')}</td><td>{text('insulation', 'Изоляция')}</td>
          {dimensions.map(k => <td key={k}>{number(r.dimensionsMm[k] ?? null, `${k}, мм`, value => patch({ dimensionsMm: { ...r.dimensionsMm, [k]: value } }))}</td>)}
          <td>{number(r.ratedCurrentA, 'Ток, А', v => patch({ ratedCurrentA: v }))}</td><td>{number(r.stripLengthMm, 'Зачистка, мм', v => patch({ stripLengthMm: v }))}</td>
          <td>{number(r.correctionsMm.cut, 'Поправка резки, мм', v => patch({ correctionsMm: { ...r.correctionsMm, cut: v } }))}</td><td>{number(r.correctionsMm.strip, 'Поправка зачистки, мм', v => patch({ correctionsMm: { ...r.correctionsMm, strip: v } }))}</td>
          <td>{ruleNumber('minCount', 'Проводников от')}</td><td>{ruleNumber('maxCount', 'Проводников до')}</td><td>{ruleNumber('minSectionMm2', 'Сечение от, мм²')}</td><td>{ruleNumber('maxSectionMm2', 'Сечение до, мм²')}</td>
          <td>{onChange ? <input aria-label={`Комбинации сечений · ${r.id}`} defaultValue={r.conductorRules.allowedCombinations.map(c => c.join(' + ')).join('; ')} placeholder="0.5 + 0.5; 1 + 1" onChange={e => patch({ conductorRules: { ...r.conductorRules, allowedCombinations: e.target.value.trim() ? e.target.value.split(';').map(c => c.split('+').map(n => Number(n.trim().replace(',', '.')))) : [] } })} /> : r.conductorRules.allowedCombinations.map(c => c.join(' + ')).join('; ') || 'Неизвестно'}</td>
          <td>{onChange ? <input aria-label={`Материалы проводников · ${r.id}`} defaultValue={r.conductorRules.materials.join(', ')} onChange={e => patch({ conductorRules: { ...r.conductorRules, materials: e.target.value.split(',').map(s => s.trim()).filter(Boolean) } })} /> : r.conductorRules.materials.join(', ') || 'Неизвестно'}</td>
          <td>{onChange ? <input type="checkbox" aria-label={`Условия подтверждены · ${r.id}`} checked={r.conductorRules.confirmed} onChange={e => patch({ conductorRules: { ...r.conductorRules, confirmed: e.target.checked } })} /> : r.conductorRules.confirmed ? 'Да' : 'Нет'}</td>
          <td>{onChange ? <input aria-label={`Источник условий совместимости · ${r.id}`} value={r.conductorRules.evidence ?? ''} onChange={e => patch({ conductorRules: { ...r.conductorRules, evidence: e.target.value || null } })} /> : r.conductorRules.evidence ?? 'Неизвестно'}</td>
          <td>{text('source', 'Источник данных')}</td><td>{text('notes', 'Примечание')}</td>
        </tr>;
      })}</tbody>
    </table>
  </div>;
}
