import type { HarnessDesignDocument } from "../editor/model";
import { buildRouteSourceItems, type RouteSourceRef, type RouteSourceItem } from "../manufacturing/route-source";
import type { RouteV3Node, RouteV3Product } from "./route-v3-model";
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
  readonly outputProductIds?: readonly string[];
  readonly parallelCapacity?: number;
  readonly setupTimeSeconds?: number | null;
  readonly setupGroupKey?: string;
}

const normKeys = ["feedTimeSecondsPerMeter", "toolCycleTimeSeconds", "toolOperationCount", "additionalTimeSeconds", "manualWorkTimeSeconds", "manualTakeTimeSeconds", "manualRemoveTimeSeconds", "setupTimeSeconds"] as const;
const numberOrNull = (value: unknown): number | null => {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim().replace(",", "."));
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }
  return null;
};
const label = (payload: Readonly<Record<string, unknown>>, key: string): string => typeof payload[key] === "string" ? String(payload[key]).trim() : "";

/** The catalog hierarchy follows the source columns, not the calculation type. */
export const routeV3CatalogName = (record: ReferenceCatalogRecord): string => label(record.payload, "name") || "Без названия";
export const routeV3CatalogNumber = (record: ReferenceCatalogRecord): string => record.sourceKey.trim() || "Номер не указан";
export function routeV3CatalogGroups(records: readonly ReferenceCatalogRecord[]): readonly { name: string; records: readonly ReferenceCatalogRecord[] }[] {
  const groups = new Map<string, ReferenceCatalogRecord[]>();
  for (const record of records) {
    if (record.entityType !== "operation") continue;
    const name = routeV3CatalogName(record);
    groups.set(name, [...(groups.get(name) ?? []), record]);
  }
  return [...groups].sort(([left], [right]) => left.localeCompare(right, "ru"))
    .map(([name, entries]) => ({ name, records: entries.sort((left, right) => routeV3CatalogNumber(left).localeCompare(routeV3CatalogNumber(right), "ru", { numeric: true })) }));
}

export function routeV3OperationFromCatalog(record: ReferenceCatalogRecord, snapshot: ReferenceCatalogSnapshot, id: string): RouteV3Operation {
  if (record.entityType !== "operation") throw new Error("Выберите запись БД.ОП.");
  const category = routeV3CatalogName(record);
  const subcategory = routeV3CatalogNumber(record);
  const operationType = label(record.payload, "operationType");
  const kind = operationType.toLocaleLowerCase("ru").includes("погон") ? "running" : "static";
  const norms = Object.fromEntries(normKeys.map(key => [key, numberOrNull(record.payload[key])])) as Pick<RouteV3Operation, typeof normKeys[number]>;
  return {
    id, title: category, kind, lengthMm: 0, speedMmPerMinute: 1, employees: 1, quantity: 1, minutesEach: 0,
    catalogBinding: { sourceId: snapshot.sourceId, snapshotId: snapshot.snapshotId, snapshotSha256: snapshot.sha256, recordId: record.recordId, sourceKey: record.sourceKey, displayName: `${category} · № ${subcategory}` },
    category, subcategory, catalogOperationType: operationType, parallelCapacity: 1, ...norms,
  };
}

export function validRouteV3Operation(op: RouteV3Operation): boolean {
  if (!op || typeof op.id !== "string" || !op.id.trim() || typeof op.title !== "string" || !["running", "static"].includes(op.kind) || [op.lengthMm, op.speedMmPerMinute, op.employees, op.quantity, op.minutesEach].some(n => typeof n !== "number" || !Number.isFinite(n) || n < 0)) return false;
  if (normKeys.some(key => op[key] !== undefined && op[key] !== null && (typeof op[key] !== "number" || !Number.isFinite(op[key]) || op[key]! < 0))) return false;
  if ([op.category, op.subcategory, op.catalogOperationType].some(value => value !== undefined && (typeof value !== "string" || value.length > 512))) return false;
  if (op.outputProductIds !== undefined && (!Array.isArray(op.outputProductIds) || new Set(op.outputProductIds).size !== op.outputProductIds.length || op.outputProductIds.some(value => typeof value !== "string" || !value.trim()))) return false;
  if (op.parallelCapacity !== undefined && (!Number.isInteger(op.parallelCapacity) || op.parallelCapacity < 1)) return false;
  if (op.setupTimeSeconds !== undefined && op.setupTimeSeconds !== null && (typeof op.setupTimeSeconds !== "number" || !Number.isFinite(op.setupTimeSeconds) || op.setupTimeSeconds < 0)) return false;
  if (op.setupGroupKey !== undefined && (typeof op.setupGroupKey !== "string" || op.setupGroupKey.length > 512)) return false;
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

const productId = (nodeId: string, ref?: RouteSourceRef): string => ref ? `product:${nodeId}:${ref.kind}:${ref.id}` : `product:${nodeId}`;
export function routeV3IsCutCard(node: RouteV3Node): boolean {
  return node.kind === "semiFinished" && !node.fragmentIds.length
    && node.refs.length > 0 && node.refs.every(ref => ref.kind === "wire" || ref.kind === "covering" || ref.kind === "cable");
}
export function routeV3Products(node: RouteV3Node): readonly RouteV3Product[] {
  const cut = node.id.startsWith("prepared:") || routeV3IsCutCard(node);
  if (!cut && node.products !== undefined) return node.products.length ? node.products : [{ id: productId(node.id), nodeId: node.id, kind: "assembly" as const }];
  if (cut) {
    const saved = new Map((node.products ?? []).filter(product => product.kind === "source" && product.ref).map(product => [`${product.ref!.kind}:${product.ref!.id}`, product]));
    return node.refs.map(ref => saved.get(`${ref.kind}:${ref.id}`) ?? ({ id: productId(node.id, ref), nodeId: node.id, kind: "source" as const, ref }));
  }
  return [{ id: productId(node.id), nodeId: node.id, kind: "assembly" as const }];
}
export function routeV3AssignedProductIds(node: RouteV3Node, operation: Pick<RouteV3Operation, "outputProductIds">): readonly string[] {
  const products = routeV3Products(node), assigned = operation.outputProductIds?.filter(id => products.some(product => product.id === id)) ?? [];
  // A card with a single output is unambiguous even when an older/UI-created
  // operation persisted an explicit empty selection; keep it automatically assigned.
  return products.length === 1 ? [products[0]!.id] : assigned;
}
export function assignRouteV3OperationProducts(node: RouteV3Node, operationId: string, productIds: readonly string[]): readonly RouteV3Operation[] {
  const ids = new Set(routeV3Products(node).map(product => product.id));
  const valid = [...new Set(productIds.filter(id => ids.has(id)))];
  return (node.operations ?? []).map(operation => operation.id === operationId ? { ...operation, outputProductIds: valid } : operation);
}

export interface RouteV3OperationProjectTimes extends RouteV3OperationTimes { readonly projectMinutes: number | null; readonly cycles: number | null; readonly setupMinutes: number | null; readonly assignedRefs: readonly RouteSourceRef[]; }
export function routeV3OperationProjectTimes(operation: RouteV3Operation, node: RouteV3Node, source: HarnessDesignDocument, harnessQuantity: number): RouteV3OperationProjectTimes {
  const sources = buildRouteSourceItems(source);
  const products = routeV3Products(node), assigned = routeV3AssignedProductIds(node, operation);
  const refs = products.filter(product => assigned.includes(product.id)).flatMap(product => product.ref ? [product.ref] : []);
  const unknown = (): RouteV3OperationProjectTimes => ({ machineMinutes: null, humanMinutes: null, operationMinutes: null, batchMinutes: null, projectMinutes: null, cycles: null, setupMinutes: null, assignedRefs: refs });
  if (!assigned.length) return unknown();
  const items = refs.map(ref => sources.find(item => item.ref.kind === ref.kind && item.ref.id === ref.id)).filter((item): item is RouteSourceItem => !!item);
  if (!refs.length) {
    const times = routeV3OperationTimes(operation, harnessQuantity);
    const setupMinutes = operation.setupTimeSeconds == null ? null : operation.setupTimeSeconds / 60;
    const projectMinutes = times.batchMinutes === null || setupMinutes === null ? null : times.batchMinutes + setupMinutes;
    return { ...times, batchMinutes: projectMinutes, projectMinutes, cycles: harnessQuantity, setupMinutes, assignedRefs: [] };
  }
  if (items.length !== refs.length || !Number.isInteger(harnessQuantity) || harnessQuantity < 1) return unknown();
  const isWireCut = node.kind === "semiFinished" && !node.fragmentIds.length && refs.length > 0 && refs.every(ref => ref.kind === "wire");
  const capacity = isWireCut ? operation.parallelCapacity ?? 1 : 1;
  if (!Number.isInteger(capacity) || capacity < 1) return unknown();
  // A mode fixes cut length and terminal treatment. Parallel slots may differ in
  // material, colour and section; a setup is charged for each loaded slot set.
  const modes = new Map<string, Map<string, { item: RouteSourceItem; units: number }>>();
  for (const item of items) {
    const mode = JSON.stringify([item.ref.kind, item.lengthMm, item.terminalFrom, item.terminalTo, item.stripProfiles ?? null]);
    const parameter = JSON.stringify([item.materialArticle, item.material, item.section, item.color, item.lengthMm, item.terminalFrom, item.terminalTo, item.stripProfiles ?? null]);
    const group = modes.get(mode) ?? new Map<string, { item: RouteSourceItem; units: number }>();
    const entry = group.get(parameter);
    group.set(parameter, { item, units: (entry?.units ?? 0) + harnessQuantity });
    modes.set(mode, group);
  }
  let cycles = 0, setupLoads = 0, operationTotal = 0;
  let representative: RouteV3OperationTimes | null = null;
  let complete = true;
  for (const [, variants] of [...modes].sort(([a], [b]) => a.localeCompare(b))) {
    const ordered = [...variants].sort(([a], [b]) => a.localeCompare(b));
    // A setup loads up to P distinct parameter variants. The same loaded set
    // repeats for all its cycles; 100 identical blanks therefore need one setup.
    for (let offset = 0; offset < ordered.length; offset += capacity) {
      const chunk = ordered.slice(offset, offset + capacity);
      const totalUnits = chunk.reduce((sum, [, entry]) => sum + entry.units, 0);
      const chunkCycles = Math.ceil(totalUnits / capacity);
      cycles += chunkCycles;
      setupLoads += 1;
      const longest = chunk.map(([, entry]) => routeV3OperationTimes({ ...operation, lengthMm: entry.item.lengthMm ?? Number.NaN }, 1));
      const perCycle = longest[0];
      representative ??= perCycle ?? null;
      const cycle = longest.reduce<RouteV3OperationTimes | null>((best, value) => !best || value.operationMinutes !== null && value.operationMinutes > (best.operationMinutes ?? -1) ? value : best, null);
      if (!cycle || cycle.operationMinutes === null || chunk.some(([, entry]) => entry.item.lengthMm === null && operation.kind === "running")) complete = false;
      else operationTotal += cycle.operationMinutes * chunkCycles;
    }
  }
  const setupMinutes = operation.setupTimeSeconds == null ? null : setupLoads * operation.setupTimeSeconds / 60;
  const projectMinutes = complete && setupMinutes !== null ? operationTotal + setupMinutes : null;
  return { machineMinutes: representative?.machineMinutes ?? null, humanMinutes: representative?.humanMinutes ?? null, operationMinutes: representative?.operationMinutes ?? null, batchMinutes: projectMinutes, projectMinutes, cycles, setupMinutes, assignedRefs: refs };
}

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
