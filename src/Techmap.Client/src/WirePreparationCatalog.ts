import type { PublishEditableReferenceTableRequest, ReferenceCatalogSnapshot } from "./reference-catalog-api";
import { validRouteV3Operation, type RouteV3Operation } from "./manufacturing-v3/route-v3-operations";

export const wirePreparationSourceId = "technology-wire-preparation-schemes";
export interface WirePreparationScheme {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly operations: readonly (RouteV3Operation | null)[];
  readonly originalPayload?: Readonly<Record<string, unknown>>;
}
export function wirePreparationDraft(snapshot: ReferenceCatalogSnapshot | null): WirePreparationScheme[] {
  return (snapshot?.records ?? []).filter(r => r.entityType === "wire-preparation-scheme").map(r => ({
    id: r.sourceKey, name: String(r.payload.name ?? ""), description: Array.isArray(r.payload.descriptionLines) && r.payload.descriptionLines.every(v => typeof v === "string") ? r.payload.descriptionLines.join("\n") : String(r.payload.description ?? ""),
    operations: Array.isArray(r.payload.operations) ? r.payload.operations : [null], originalPayload: r.payload,
  }));
}
export function wirePreparationReady(scheme: WirePreparationScheme): boolean {
  return scheme.operations.length > 0 && scheme.operations.every(op => op !== null && validRouteV3Operation(op) && !!op.catalogBinding);
}
export function wirePreparationRequest(rows: readonly WirePreparationScheme[], snapshot: ReferenceCatalogSnapshot | null): PublishEditableReferenceTableRequest {
  if (!rows.length) throw new Error("Добавьте хотя бы одну схему.");
  const names = new Set<string>(), ids = new Set<string>();
  const records = rows.map(row => {
    const name = row.name.trim();
    if (!name || name.length > 512 || !row.id.trim() || ids.has(row.id) || names.has(name.toLocaleLowerCase("ru"))) throw new Error("Названия и ключи схем должны быть непустыми и уникальными.");
    if (!row.operations.length || row.operations.some(op => op !== null && (!validRouteV3Operation(op) || !op.catalogBinding))) throw new Error(`Проверьте операции схемы «${name}».`);
    names.add(name.toLocaleLowerCase("ru")); ids.add(row.id);
    return { entityType: "wire-preparation-scheme", sourceKey: row.id, payload: { ...row.originalPayload, name, description: row.description.replace(/[\r\n\t]/g, " "), descriptionLines: row.description.split(/\r?\n/).map(line => line.replace(/\t/g, " ")), operations: row.operations } };
  });
  return { expectedActiveSnapshotId: snapshot?.snapshotId ?? null, sourceKind: "editable-table", sourceUri: snapshot?.sourceUri ?? null, records };
}

/** TSV copied from a spreadsheet: Name, Description, operation number 1…n.
 * Numbers must resolve uniquely across the explicitly loaded operation catalogs. */
export function importWirePreparationTsv(text: string, catalogs: readonly ReferenceCatalogSnapshot[], makeId: () => string): WirePreparationScheme[] {
  const lines = text.trim().split(/\r?\n/).filter(line => line.trim());
  if (/^(Название|Название схемы)\tОписание(?: схемы)?\tОперация/i.test(lines[0] ?? "")) lines.shift();
  return lines.map((line, index) => {
    const [name = "", description = "", ...numbers] = line.split("\t");
    const operations = (numbers.length ? numbers : [""]).map(number => {
      if (!number.trim()) return null;
      const matches = catalogs.flatMap(snapshot => snapshot.records.filter(r => r.entityType === "operation" && r.sourceKey === number.trim()).map(record => ({ record, snapshot })));
      if (matches.length !== 1) throw new Error(`Строка ${index + 1}: операция № ${number} ${matches.length ? "неоднозначна" : "не найдена"}.`);
      return operationFromCatalog(matches[0]!.record, matches[0]!.snapshot, makeId());
    });
    return { id: makeId(), name, description, operations };
  });
}
import { routeV3OperationFromCatalog as operationFromCatalog } from "./manufacturing-v3/route-v3-operations";
