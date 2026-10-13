import type { HarnessDesignDocument } from "../editor/model";
import { buildRouteSourceItems, type RouteSourceRef } from "../manufacturing/route-source";
import type { ReferenceCatalogRecord, ReferenceCatalogSnapshot } from "../reference-catalog-api";
import type { UmlOperation } from "../uml/uml-model";

/** Route v3 norms are seconds; legacy UML fields remain for old saved cards. */
export interface RouteV3Operation extends UmlOperation {
  readonly catalogBinding?: {
    readonly sourceId: string; readonly snapshotId: string; readonly snapshotSha256: string;
    readonly recordId: string; readonly sourceKey: string; readonly displayName: string;
  };
  readonly category?: string;
  readonly subcategory?: string;
  readonly catalogOperationType?: string;
  readonly feedTimeSecondsPerMeter?: number | null;
  readonly toolCycleTimeSeconds?: number | null;
  readonly toolOperationCount?: number | null;
  readonly additionalTimeSeconds?: number | null;
  readonly manualWorkTimeSeconds?: number | null;
  readonly manualTakeTimeSeconds?: number | null;
  readonly manualRemoveTimeSeconds?: number | null;
}

const normKeys = ["feedTimeSecondsPerMeter", "toolCycleTimeSeconds", "toolOperationCount", "additionalTimeSeconds", "manualWorkTimeSeconds", "manualTakeTimeSeconds", "manualRemoveTimeSeconds"] as const;
const numberOrNull = (value: unknown): number | null => {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim().replace(",", "."));
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }
  return null;
};
const label = (payload: Readonly<Record<string, unknown>>, key: string): string => typeof payload[key] === "string" ? String(payload[key]).trim() : "";

export function routeV3OperationFromCatalog(record: ReferenceCatalogRecord, snapshot: ReferenceCatalogSnapshot, id: string): RouteV3Operation {
  if (record.entityType !== "operation") throw new Error("Выберите запись БД.ОП.");
  const category = label(record.payload, "operationType") || "Без типа";
  const subcategory = label(record.payload, "name") || label(record.payload, "instruction") || label(record.payload, "machine") || `Операция № ${record.sourceKey}`;
  const operationType = label(record.payload, "operationType");
  const kind = operationType.toLocaleLowerCase("ru").includes("погон") ? "running" : "static";
  const norms = Object.fromEntries(normKeys.map(key => [key, numberOrNull(record.payload[key])])) as Pick<RouteV3Operation, typeof normKeys[number]>;
  return {
    id, title: subcategory, kind, lengthMm: 0, speedMmPerMinute: 1, employees: 1, quantity: 1, minutesEach: 0,
    catalogBinding: { sourceId: snapshot.sourceId, snapshotId: snapshot.snapshotId, snapshotSha256: snapshot.sha256, recordId: record.recordId, sourceKey: record.sourceKey, displayName: subcategory },
    category, subcategory, catalogOperationType: operationType, ...norms,
  };
}

export function validRouteV3Operation(op: RouteV3Operation): boolean {
  if (!op || typeof op.id !== "string" || !op.id.trim() || typeof op.title !== "string" || !["running", "static"].includes(op.kind) || [op.lengthMm, op.speedMmPerMinute, op.employees, op.quantity, op.minutesEach].some(n => typeof n !== "number" || !Number.isFinite(n) || n < 0)) return false;
  if (normKeys.some(key => op[key] !== undefined && op[key] !== null && (typeof op[key] !== "number" || !Number.isFinite(op[key]) || op[key]! < 0))) return false;
  if ([op.category, op.subcategory, op.catalogOperationType].some(value => value !== undefined && (typeof value !== "string" || value.length > 512))) return false;
  const binding = op.catalogBinding;
  return !binding || [binding.sourceId, binding.snapshotId, binding.snapshotSha256, binding.recordId, binding.sourceKey, binding.displayName].every(value => typeof value === "string" && value.trim().length > 0 && value.length <= 512);
}

export interface RouteV3OperationTimes {
  readonly machineMinutes: number | null;
  readonly humanMinutes: number | null;
  readonly operationMinutes: number | null;
  readonly batchMinutes: number | null;
}

/** Null is unknown, not zero. БД.ОП feed norm is seconds per metre; L is stored in millimetres. */
export function routeV3OperationTimes(operation: RouteV3Operation, batchQuantity = 1): RouteV3OperationTimes {
  if (!Number.isFinite(batchQuantity) || batchQuantity <= 0) throw new Error("Количество партии должно быть положительным.");
  if (operation.catalogOperationType?.toLocaleLowerCase("ru").includes("перемен")) return { machineMinutes: null, humanMinutes: null, operationMinutes: null, batchMinutes: null };
  const extra = operation.additionalTimeSeconds ?? null;
  const manual = [operation.manualWorkTimeSeconds, operation.manualTakeTimeSeconds, operation.manualRemoveTimeSeconds];
  const humanSeconds = manual.every(value => value != null) ? manual.reduce<number>((sum, value) => sum + value!, 0) : null;
  const toolSeconds = operation.toolCycleTimeSeconds != null && operation.toolOperationCount != null ? operation.toolCycleTimeSeconds * operation.toolOperationCount : null;
  let machineSeconds: number | null;
  let operationSeconds: number | null;
  if (operation.kind === "running") {
    machineSeconds = extra !== null && toolSeconds !== null && operation.feedTimeSecondsPerMeter != null && Number.isFinite(operation.lengthMm)
      ? operation.feedTimeSecondsPerMeter * (operation.lengthMm / 1000) + toolSeconds + extra : null;
    operationSeconds = machineSeconds;
  } else {
    machineSeconds = extra !== null && toolSeconds !== null ? toolSeconds + extra : null;
    // The Route v3 owner formula for a static operation is manual work plus extra time.
    operationSeconds = humanSeconds !== null && extra !== null ? humanSeconds + extra : null;
  }
  const multiplier = operation.quantity > 0 ? operation.quantity : 1;
  return {
    machineMinutes: machineSeconds === null ? null : machineSeconds / 60,
    humanMinutes: humanSeconds === null ? null : humanSeconds / 60,
    operationMinutes: operationSeconds === null ? null : operationSeconds * multiplier / 60,
    batchMinutes: operationSeconds === null ? null : operationSeconds * multiplier * batchQuantity / 60,
  };
}
export const routeV3OperationMinutes = (operation: RouteV3Operation): number | null => routeV3OperationTimes(operation).operationMinutes;

export function routeV3BatchQuantity(node: { readonly quantity?: number }, harnessQuantity: number): number {
  const fallback = Number.isFinite(harnessQuantity) && harnessQuantity > 0 ? harnessQuantity : 1;
  return typeof node.quantity === "number" && Number.isFinite(node.quantity) && node.quantity > 0 ? node.quantity : fallback;
}

export function routeV3SourceQuantity(ref: RouteSourceRef, source: HarnessDesignDocument, harnessQuantity: number): { perSemiFinished: number; perBatch: number } {
  const exists = ref.kind === "wire" ? source.wires.some(w => w.id === ref.id)
    : ref.kind === "cable" ? source.cables.some(c => c.id === ref.id)
    : ref.kind === "covering" ? source.physicalTopology?.coverings?.some(c => c.id === ref.id) ?? false
    : source.connectors.some(c => c.id === ref.id);
  const perSemiFinished = exists ? 1 : 0;
  return { perSemiFinished, perBatch: perSemiFinished * (Number.isFinite(harnessQuantity) && harnessQuantity > 0 ? harnessQuantity : 1) };
}

/** Stable production grouping for repeated wire/covering blanks in one harness. */
export function routeV3SourceGroupKey(ref: RouteSourceRef, source: HarnessDesignDocument): string {
  const item = buildRouteSourceItems(source).find(candidate => candidate.ref.kind === ref.kind && candidate.ref.id === ref.id);
  if (!item || (ref.kind !== "wire" && ref.kind !== "covering")) return `${ref.kind}:${ref.id}`;
  if (ref.kind === "wire") {
    const wire = source.wires.find(value => value.id === ref.id)!;
    return JSON.stringify(["wire", wire.materialBinding?.snapshotSha256 ?? "", wire.materialBinding?.recordId ?? "", item.materialArticle, item.material, item.section, item.color, item.lengthMm, item.terminalFrom, item.terminalTo, item.stripProfiles ?? null]);
  }
  const covering = source.physicalTopology?.coverings?.find(value => value.id === ref.id);
  return JSON.stringify(["covering", covering?.material?.snapshotSha256 ?? "", covering?.material?.recordId ?? "", item.materialArticle, item.material, item.lengthMm, covering?.kind ?? null]);
}

export function routeV3GroupedSourceQuantity(ref: RouteSourceRef, refs: readonly RouteSourceRef[], source: HarnessDesignDocument, harnessQuantity: number): { perSemiFinished: number; perBatch: number } {
  const base = routeV3SourceQuantity(ref, source, harnessQuantity);
  if (ref.kind !== "wire" && ref.kind !== "covering") return base;
  const count = refs.filter(candidate => routeV3SourceGroupKey(candidate, source) === routeV3SourceGroupKey(ref, source)).length;
  return { perSemiFinished: count, perBatch: count * (base.perBatch > 0 ? base.perBatch : 1) };
}
