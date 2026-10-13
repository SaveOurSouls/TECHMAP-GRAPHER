import { catalogOuterDiameter } from "./drawing-thickness";
import type { ReferenceCatalogSearchRecord } from "../reference-catalog-api";
import { builtInWireReferences } from "./wire-reference-catalog";
import type { WireMaterialBinding } from "./model";

export type WireSectionUnit = "awg" | "mm2";

export interface WireDatabaseOption {
  readonly id: string;
  readonly diameterMm?:number;
  readonly mark: string;
  readonly section: string;
  readonly label: string;
  readonly detail: string;
  readonly searchText?: string;
  readonly color?: string;
  readonly materialBinding?: WireMaterialBinding;
}

export function isSelectableWirePayload(payload: Readonly<Record<string, unknown>>): boolean {
  return Boolean(formatWireSection(payload));
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim()
    : typeof value === "number" && Number.isFinite(value) ? String(value).replace(".", ",") : "";
}

function field(payload: Readonly<Record<string, unknown>>, ...keys: string[]): string {
  for (const key of keys) {
    const value = text(payload[key]);
    if (value) return value;
  }
  return "";
}

function explicitSectionUnit(value: string): WireSectionUnit | undefined {
  if (/awg/iu.test(value)) return "awg";
  if (/(?:мм|mm)\s*[²2]/iu.test(value)) return "mm2";
  return undefined;
}

function declaredSectionUnit(payload: Readonly<Record<string, unknown>>, suffix = ""): WireSectionUnit | undefined {
  const value = field(payload,
    `sectionUnit${suffix}`, `section${suffix}Unit`, `Единица сечения${suffix ? ` ${suffix}` : ""}`,
    `Ед. сечения${suffix ? ` ${suffix}` : ""}`, "sectionUnit", "Единица сечения", "Ед. сечения");
  if (/^awg$/iu.test(value)) return "awg";
  if (/^(?:мм|mm)\s*[²2]$/iu.test(value)) return "mm2";
  return undefined;
}

function sectionWithUnit(value: string, unit: WireSectionUnit | undefined): string {
  if (!value || explicitSectionUnit(value) || !unit) return value;
  return unit === "awg" ? `${value}AWG` : `${value} мм²`;
}

/** The bundled E3:AJ profile stores AWG in its two section columns G and I.
 * A custom catalogue can declare another unit beside its value; no numerical
 * conversion or inference from the mark is ever performed. */
export function wireSectionUnit(payload: Readonly<Record<string, unknown>>): WireSectionUnit | undefined {
  const core = field(payload, "Сечение C", "Сечение С");
  const pair = field(payload, "Сечение P", "Сечение Р");
  return declaredSectionUnit(payload, "C") ?? explicitSectionUnit(core)
    ?? declaredSectionUnit(payload, "P") ?? explicitSectionUnit(pair)
    ?? (core || pair ? "awg" : undefined)
    ?? (field(payload, "awg", "AWG") ? "awg" : undefined)
    ?? (field(payload, "sectionMm2", "Сечение мм2", "Сечение мм²") ? "mm2" : undefined);
}

/** Presentation only: F/G and H/I stay separate in the reference payload.
 * 1C is a mounting stranded wire; its count is omitted only without a second group. */
export function formatWireSection(payload: Readonly<Record<string, unknown>>): string {
  const core = field(payload, "Core");
  const sectionC = field(payload, "Сечение C", "Сечение С");
  const pair = field(payload, "Pair");
  const sectionP = field(payload, "Сечение P", "Сечение Р");
  const coreUnit = declaredSectionUnit(payload, "C") ?? explicitSectionUnit(sectionC) ?? (sectionC ? "awg" : undefined);
  const pairUnit = declaredSectionUnit(payload, "P") ?? explicitSectionUnit(sectionP) ?? (sectionP ? "awg" : undefined);
  const part = (count: string, section: string, unit: WireSectionUnit | undefined) => {
    if (!section || !count || /^(?:0(?:[cpср])?|[-—])$/iu.test(count)) return "";
    return `${count}x${sectionWithUnit(section, unit)}`;
  };
  const secondGroup = part(pair, sectionP, pairUnit);
  const firstGroup = /^1[сc]$/iu.test(core.replace(/\s/g, "")) && !secondGroup
    ? sectionWithUnit(sectionC, coreUnit) : part(core, sectionC, coreUnit);
  return [firstGroup, secondGroup].filter(Boolean).join(" | ")
    || sectionWithUnit(sectionC, coreUnit)
    || sectionWithUnit(field(payload, "sectionMm2", "Сечение мм2", "Сечение мм²"), "mm2")
    || sectionWithUnit(field(payload, "awg", "AWG"), "awg")
    || field(payload, "Сечение", "section");
}

export function wireDatabaseOption(record: ReferenceCatalogSearchRecord, snapshot?: { readonly snapshotId: string; readonly snapshotSha256: string }): WireDatabaseOption {
  const mark = field(record.payload, "Марка", "mark", "name", "Название", "series", "Серия") || record.sourceKey;
  const section = formatWireSection(record.payload);
  const color = field(record.payload, "Цвет", "color", "Color");
  const diameterMm = catalogOuterDiameter(record.payload);
  const sectionUnit = wireSectionUnit(record.payload);
  return { id: record.recordId, diameterMm, mark, section, color, label: [mark, section].filter(Boolean).join(" · "),
    ...(snapshot && record.entityType === "wire" ? { materialBinding: {
      sourceId: "technology-wires", snapshotId: snapshot.snapshotId, snapshotSha256: snapshot.snapshotSha256,
      recordId: record.recordId, entityType: "wire" as const, sourceKey: record.sourceKey,
      displayName: [mark, section].filter(Boolean).join(" · "),
      ...(sectionUnit ? { sectionUnit } : {}),
      ...(diameterMm === undefined ? {} : { outerDiameterMm: diameterMm }),
    } } : {}),
    detail: [
      /^1[сc]$/iu.test(field(record.payload, "Core").replace(/\s/g, "")) ? "монтажный многожильный провод" : "",
      ...["Артикул провода", "Артикул", "Цвет", "Производитель", "Категория"]
        .map(key => text(record.payload[key]) ? `${key}: ${text(record.payload[key])}` : ""),
    ].filter(Boolean).join(" · "),
    searchText: Object.values(record.payload).map(text).join(" ") };
}

export const builtInWireOptions: readonly WireDatabaseOption[] = builtInWireReferences.map(wire => ({
  id: wire.id, mark: wire.series,
  section: wire.size.system === "awg" ? `${wire.size.value}AWG` : `${text(wire.size.value)} мм²`,
  label: wire.designation, detail: "Встроенный справочник",
}));

export function filterWireOptions(options: readonly WireDatabaseOption[], query: string, section = ""): readonly WireDatabaseOption[] {
  const normalize = (value: string) => value.toLocaleLowerCase("ru").replace(/[.,]/g, ".");
  const tokens = normalize(query).split(/\s+/).filter(Boolean);
  const sectionKey = normalizeWireSectionChoice(section);
  return options.filter(option => (!sectionKey || normalizeWireSectionChoice(option.section) === sectionKey) &&
    tokens.every(token => normalize(`${option.label} ${option.detail} ${option.searchText ?? ""}`).includes(token)));
}

/** A mark is offered once; its section remains a separate choice. */
export function wireMarkChoices(options: readonly WireDatabaseOption[], query: string, section = ""): readonly string[] {
  return [...new Map(filterWireOptions(options, query, section)
    .map(option => [normalizeWireChoice(option.mark), option.mark] as const)).values()];
}

/** Values used by the two dependent wire selectors. Keep the complete
 * catalog rows separate: the editor only combines them for display. */
export function normalizeWireChoice(value: string): string {
  return value.trim().toLocaleLowerCase("ru-RU").replace(/ё/g, "е").replace(/[.,]/g, ".").replace(/\s+/g, "");
}

/** Unit labels on old contact presets do not change the imported size value.
 * No conversion between AWG and square millimetres is performed. */
export function normalizeWireSectionChoice(value: string): string {
  return normalizeWireChoice(value).replace(/awg|мм[²2]|mm[²2]/g, "");
}

export function wireSectionChoices(
  options: readonly WireDatabaseOption[],
  mark: string,
  current = "",
): readonly string[] {
  const normalizedMark = normalizeWireChoice(mark);
  const choices = options
    .filter(option => !normalizedMark || normalizeWireChoice(option.mark) === normalizedMark)
    .map(option => option.section.trim())
    .filter(Boolean);
  return [...new Set([current.trim(), ...choices].filter(Boolean))];
}
