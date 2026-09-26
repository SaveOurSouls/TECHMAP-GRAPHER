import { catalogOuterDiameter } from "./drawing-thickness";
import type { ReferenceCatalogSearchRecord } from "../reference-catalog-api";
import { builtInWireReferences } from "./wire-reference-catalog";
import type { WireMaterialBinding } from "./model";

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

/** Keeps the source units and count suffixes; only a single core omits its count. */
export function formatWireSection(payload: Readonly<Record<string, unknown>>): string {
  const core = field(payload, "Core");
  const sectionC = field(payload, "Сечение C", "Сечение С");
  const pair = field(payload, "Pair");
  const sectionP = field(payload, "Сечение P", "Сечение Р");
  if (/^1[сc]$/iu.test(core.replace(/\s/g, ""))) return sectionC;
  const part = (count: string, section: string) => {
    if (!section || !count || /^(?:0(?:[cpср])?|[-—])$/iu.test(count)) return "";
    return `${count} x ${section}`;
  };
  return [part(core, sectionC), part(pair, sectionP)].filter(Boolean).join(" / ")
    || sectionC || field(payload, "sectionMm2", "Сечение", "section", "awg", "AWG");
}

export function wireDatabaseOption(record: ReferenceCatalogSearchRecord, snapshot?: { readonly snapshotId: string; readonly snapshotSha256: string }): WireDatabaseOption {
  const mark = field(record.payload, "Марка", "mark", "name", "Название", "series", "Серия") || record.sourceKey;
  const section = formatWireSection(record.payload);
  const color = field(record.payload, "Цвет", "color", "Color");
  const diameterMm = catalogOuterDiameter(record.payload);
  return { id: record.recordId, diameterMm, mark, section, color, label: [mark, section].filter(Boolean).join(" · "),
    ...(snapshot && record.entityType === "wire" ? { materialBinding: {
      sourceId: "technology-wires", snapshotId: snapshot.snapshotId, snapshotSha256: snapshot.snapshotSha256,
      recordId: record.recordId, entityType: "wire" as const, sourceKey: record.sourceKey,
      displayName: [mark, section].filter(Boolean).join(" · "),
      ...(diameterMm === undefined ? {} : { outerDiameterMm: diameterMm }),
    } } : {}),
    detail: ["Артикул провода", "Артикул", "Цвет", "Производитель", "Категория"]
      .map(key => text(record.payload[key]) ? `${key}: ${text(record.payload[key])}` : "").filter(Boolean).join(" · "),
    searchText: Object.values(record.payload).map(text).join(" ") };
}

export const builtInWireOptions: readonly WireDatabaseOption[] = builtInWireReferences.map(wire => ({
  id: wire.id, mark: wire.series,
  section: wire.size.system === "awg" ? `${wire.size.value}AWG` : `${text(wire.size.value)} мм²`,
  label: wire.designation, detail: "Встроенный справочник",
}));

export function filterWireOptions(options: readonly WireDatabaseOption[], query: string): readonly WireDatabaseOption[] {
  const normalize = (value: string) => value.toLocaleLowerCase("ru").replace(/[.,]/g, ".");
  const tokens = normalize(query).split(/\s+/).filter(Boolean);
  return options.filter(option => tokens.every(token => normalize(`${option.label} ${option.detail} ${option.searchText ?? ""}`).includes(token)));
}
