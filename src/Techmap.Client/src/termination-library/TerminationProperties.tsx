import { BUILTIN_TERMINATION_RECORDS, parseTerminationRecord, type TerminationLibraryRecord } from './catalog';
import type { TerminationArtifact, TerminationCatalogBinding } from '../editor/termination-model';
import { TerminationRecordTable } from './TerminationRecordTable';
import './termination-library.css';

export function recordFromTerminationBinding(binding?: TerminationCatalogBinding): TerminationLibraryRecord | null {
  try { return binding?.payload ? parseTerminationRecord(binding.payload) : null; } catch { return null; }
}
/** Always read the pinned payload, never the mutable local catalog. */
export function TerminationProperties({ binding, artifact }: { readonly binding?: TerminationCatalogBinding; readonly artifact?: TerminationArtifact }) {
  const pinned = recordFromTerminationBinding(binding ?? artifact?.catalogBinding);
  const base = BUILTIN_TERMINATION_RECORDS.find(r => r.assetId === artifact?.symbolId);
  const fallback = base && artifact ? { ...base, article: artifact.article || null, dimensionsMm: { ...base.dimensionsMm, ...artifact.dimensions }, colorId: artifact.color ?? null } : null;
  const record = pinned ?? fallback;
  return <div className="termination-catalog-properties"><h4>Каталожные свойства</h4>
    {!pinned && <p>Полный снимок каталожных данных отсутствует.</p>}
    {record ? <TerminationRecordTable records={[record]} label="Свойства оконцовки" /> : <table aria-label="Свойства оконцовки"><thead><tr><th>Артикул</th><th>Наименование</th></tr></thead><tbody><tr><td>{artifact?.article || binding?.sourceKey || 'Неизвестно'}</td><td>{binding?.displayName ?? 'Неизвестно'}</td></tr></tbody></table>}
  </div>;
}
