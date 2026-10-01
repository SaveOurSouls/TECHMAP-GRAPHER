import manifest from "../public/route-wire-illustrations/manifest.json";
import type { PublishEditableReferenceTableRequest, ReferenceCatalogSnapshot } from "./reference-catalog-api";

export const wireBlankSourceId = "technology-wire-blanks";
export const wireBlankEntityType = "wire-blank";
export const wireBlankEnds = ["cut", "copper", "tin", "terminal", "sealed", "sealed-pin"] as const;
export type WireBlankEnd = typeof wireBlankEnds[number];
export const wireBlankEndLabels: Readonly<Record<WireBlankEnd, string>> = {
  cut: "После резки", copper: "Зачищен · медь", tin: "Лужён",
  terminal: "Наконечник", sealed: "Наконечник с уплотнителем",
  "sealed-pin": "Штыревой наконечник с уплотнителем",
};

export interface WireBlank {
  readonly id: string;
  readonly index: string;
  readonly title: string;
  readonly color: string;
  readonly start: WireBlankEnd;
  readonly end: WireBlankEnd;
  readonly templateId: string;
  readonly photoDataUrl: string | null;
  readonly originalPayload: Readonly<Record<string, unknown>>;
}

const validColor = /^#[0-9a-fA-F]{6}$/;
const validPhoto = /^data:image\/png;base64,[a-zA-Z0-9+/]+={0,2}$/;
const entries = manifest.entries as readonly { readonly id: string; readonly file: string; readonly left: string; readonly right: string; readonly title: string }[];

export function wireBlankTemplate(id: string) { return entries.find(entry => entry.id === id); }
export function wireBlankTemplateForEnd(end: WireBlankEnd, side: "left" | "right") {
  const primary = side === "left" ? "left" : "right";
  const other = side === "left" ? "right" : "left";
  return entries.find(entry => entry[primary] === end && entry[other] === "cut")?.id
    ?? entries.find(entry => entry[primary] === end)?.id
    ?? entries.find(entry => entry[other] === end && entry[primary] === "cut")?.id
    ?? entries.find(entry => entry[other] === end)?.id ?? "01-cut";
}
export function wireBlankEndNeedsMirror(end: WireBlankEnd, side: "left" | "right") {
  return !entries.some(entry => entry[side] === end);
}
export function wireBlankTemplateUrl(id: string) {
  const entry = wireBlankTemplate(id);
  return entry ? `${import.meta.env.BASE_URL}route-wire-illustrations/${entry.file}` : null;
}

export function wireBlankDraft(snapshot: ReferenceCatalogSnapshot | null): WireBlank[] {
  return (snapshot?.records ?? []).filter(record => record.entityType === wireBlankEntityType).map(record => {
    const payload = record.payload;
    const start = String(payload.start ?? "cut"), end = String(payload.end ?? "cut");
    return {
      id: record.recordId, index: String(payload.index ?? record.sourceKey), title: String(payload.title ?? ""),
      color: String(payload.color ?? "#26609e"),
      start: wireBlankEnds.includes(start as WireBlankEnd) ? start as WireBlankEnd : "cut",
      end: wireBlankEnds.includes(end as WireBlankEnd) ? end as WireBlankEnd : "cut",
      templateId: String(payload.templateId ?? "01-cut"),
      photoDataUrl: typeof payload.photoDataUrl === "string" ? payload.photoDataUrl : null,
      originalPayload: payload,
    };
  });
}

export function wireBlankRequest(rows: readonly WireBlank[], snapshot: ReferenceCatalogSnapshot | null): PublishEditableReferenceTableRequest {
  if (!rows.length) throw new Error("Добавьте хотя бы один полуфабрикат.");
  const names = new Set<string>(), indices = new Set<string>();
  const records = rows.map((row, position) => {
    const index = row.index.trim(), title = row.title.trim();
    if (!index || index.length > 128 || !title || title.length > 512) throw new Error(`Заполните индекс и название в строке ${position + 1}.`);
    const key = index.toLocaleLowerCase("ru-RU"), name = title.toLocaleLowerCase("ru-RU");
    if (indices.has(key)) throw new Error(`Индекс «${index}» повторяется.`);
    if (names.has(name)) throw new Error(`Название «${title}» повторяется.`);
    indices.add(key); names.add(name);
    if (!validColor.test(row.color)) throw new Error(`Цвет в строке ${position + 1} должен быть в формате #RRGGBB.`);
    if (!wireBlankEnds.includes(row.start) || !wireBlankEnds.includes(row.end)) throw new Error(`Исполнение конца в строке ${position + 1} неизвестно.`);
    if (row.photoDataUrl && (row.photoDataUrl.length > 1_400_000 || !validPhoto.test(row.photoDataUrl))) throw new Error(`Фото в строке ${position + 1} повреждено или превышает 1 МиБ.`);
    return { entityType: wireBlankEntityType, sourceKey: index, sourceLocation: null, payload: {
      ...row.originalPayload, index, title, color: row.color, start: row.start, end: row.end,
      templateId: row.templateId, photoDataUrl: row.photoDataUrl,
    } };
  });
  return { expectedActiveSnapshotId: snapshot?.snapshotId ?? null, sourceKind: snapshot?.sourceKind ?? "editable-table",
    sourceUri: snapshot?.sourceUri ?? null, records };
}
