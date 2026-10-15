import { BUILTIN_TERMINATION_RECORDS, createCustomTerminationRecord, parseTerminationRecord, terminationAsset, type TerminationLibraryRecord } from './catalog';

export interface TerminationSeries {
  readonly id: string;
  readonly name: string;
  readonly manufacturer: string | null;
  readonly assetId: string;
  readonly recordIds: readonly string[];
}
export interface TerminationSeriesGroup extends TerminationSeries {
  readonly origin: 'template' | 'custom' | 'legacy';
  readonly records: readonly TerminationLibraryRecord[];
}
export function parseTerminationSeries(value: unknown, records: readonly TerminationLibraryRecord[]): TerminationSeries {
  if (!value || typeof value !== 'object') throw new Error('Неверная серия оконцовок.');
  const s = value as Record<string, unknown>;
  if (typeof s.id !== 'string' || !/^series:[a-zA-Z0-9._:-]{1,120}$/.test(s.id)
    || typeof s.name !== 'string' || !s.name.trim() || s.name.length > 512
    || (s.manufacturer !== null && (typeof s.manufacturer !== 'string' || s.manufacturer.length > 4096))
    || typeof s.assetId !== 'string' || !terminationAsset(s.assetId)
    || !Array.isArray(s.recordIds) || !s.recordIds.length || s.recordIds.length > 2000
    || s.recordIds.some(id => typeof id !== 'string') || new Set(s.recordIds).size !== s.recordIds.length) {
    throw new Error('Неверные параметры серии оконцовок.');
  }
  const manufacturer = typeof s.manufacturer === 'string' ? s.manufacturer.trim() || null : null;
  const byId = new Map(records.map(r => [r.id, r]));
  if (s.recordIds.some(id => {
    const r = byId.get(id);
    return !r || r.origin !== 'custom' || r.assetId !== s.assetId || r.manufacturer !== manufacturer;
  })) throw new Error('Артикулы серии должны иметь одну форму и производителя.');
  const series = { id: s.id, name: s.name.trim(), manufacturer, assetId: s.assetId, recordIds: s.recordIds as string[] };
  assertUniqueArticles(series.recordIds.map(id => byId.get(id)!));
  return series;
}
function assertUniqueArticles(records: readonly TerminationLibraryRecord[]): void {
  const articles = records.map(r => r.article?.toLocaleLowerCase('ru-RU')).filter(Boolean);
  if (new Set(articles).size !== articles.length) throw new Error('Артикулы внутри серии не должны повторяться.');
}
/** Series identity is explicit; equal shapes/manufacturers never merge generated series. */
export function groupTerminationSeries(records: readonly TerminationLibraryRecord[], series: readonly TerminationSeries[]): TerminationSeriesGroup[] {
  const byId = new Map(records.map(r => [r.id, r]));
  const covered = new Set(series.flatMap(s => s.recordIds));
  const groups: TerminationSeriesGroup[] = BUILTIN_TERMINATION_RECORDS.map(r => ({
    id: `template-series:${r.assetId}`, name: r.name, manufacturer: null, assetId: r.assetId,
    recordIds: [r.id], records: [r], origin: 'template',
  }));
  groups.push(...series.map(s => ({ ...s, origin: 'custom' as const, records: s.recordIds.map(id => byId.get(id)!) })));
  // Legacy articles have no series membership. Keep each as an independent, editable table.
  groups.push(...records.filter(r => !covered.has(r.id)).map(r => ({
    id: `legacy:${r.id}`, name: r.name, manufacturer: r.manufacturer, assetId: r.assetId,
    recordIds: [r.id], records: [r], origin: 'legacy' as const,
  })));
  return groups;
}
export interface TerminationSeriesGeneration {
  readonly name: string;
  readonly manufacturer: string;
  readonly assetId: string;
  readonly articlePattern: string;
  readonly start: number;
  readonly step: number;
  readonly count: number;
  readonly padding: number;
}
export function generateTerminationSeries(input: TerminationSeriesGeneration, id = `series:${crypto.randomUUID()}`): { series: TerminationSeries; records: TerminationLibraryRecord[] } {
  const base = BUILTIN_TERMINATION_RECORDS.find(r => r.assetId === input.assetId);
  if (!base || !input.name.trim() || !input.manufacturer.trim()) throw new Error('Укажите серию, производителя и форму.');
  if (!Number.isSafeInteger(input.count) || input.count < 1 || input.count > 200
    || !Number.isSafeInteger(input.start) || input.start < 0 || !Number.isSafeInteger(input.step) || input.step < 1
    || !Number.isSafeInteger(input.padding) || input.padding < 0 || input.padding > 12
    || !Number.isSafeInteger(input.start + (input.count - 1) * input.step)) throw new Error('Проверьте количество (1–200), начало, шаг и разрядность.');
  if (!input.articlePattern.trim() || (input.count > 1 && !input.articlePattern.includes('{n}'))) throw new Error('Для нескольких артикулов используйте {n} в шаблоне.');
  const records = Array.from({ length: input.count }, (_, i) => {
    const article = input.articlePattern.replaceAll('{n}', String(input.start + i * input.step).padStart(input.padding, '0')).trim();
    return parseTerminationRecord({ ...createCustomTerminationRecord(base), name: `${input.name.trim()} · ${article}`, manufacturer: input.manufacturer.trim(), article });
  });
  assertUniqueArticles(records);
  return { series: parseTerminationSeries({ id, name: input.name, manufacturer: input.manufacturer, assetId: input.assetId, recordIds: records.map(r => r.id) }, records), records };
}
