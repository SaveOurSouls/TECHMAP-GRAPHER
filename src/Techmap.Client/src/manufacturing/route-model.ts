import type { Point } from "../editor/model";
import type { RouteSourceRef } from "./route-source";
import type { RouteTerminalRequirement } from "./route-terminal-requirements";

export const routeOperationModes = ["cut", "cut-strip-from", "cut-strip-to", "cut-strip-both", "cut-crimp", "tin", "strip-from", "strip-to", "strip-both", "assembly"] as const;
export interface RouteOperation {
  readonly id: string;
  readonly binding: null | { readonly sourceId: string; readonly entityType: "operation"; readonly snapshotId: string; readonly snapshotSha256: string; readonly recordId: string; readonly sourceKey: string; readonly displayName: string };
  readonly mode: typeof routeOperationModes[number];
  readonly note: string;
}
export interface RouteRow {
  readonly terminalRequirements?: readonly RouteTerminalRequirement[];
  readonly photos?: readonly { readonly sha256: string; readonly name: string }[];
  readonly id: string;
  readonly kind: "semiFinished" | "assembly";
  readonly title: string;
  readonly comment: string;
  readonly sourceObjects: readonly RouteSourceRef[];
  readonly dependsOn: readonly string[];
  readonly operations: readonly RouteOperation[];
  readonly presentation: { readonly backgroundOpacity: number; readonly objects: readonly { readonly ref: RouteSourceRef; readonly points: readonly Point[]; readonly hidden: boolean }[] };
  readonly prepared: boolean;
}
export interface ManufacturingRoute {
  readonly contractVersion: 1;
  readonly source: { readonly fingerprintVersion: 1; readonly sha256: string };
  readonly status: "draft" | "completed";
  readonly rows: readonly RouteRow[];
}
const fail = (): never => { throw new Error("Маршрутная карта повреждена: проверьте строки, операции и зависимости."); };
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : fail();
const text = (value: unknown, limit: number, empty = false): string => typeof value === "string" && value.length <= limit && (empty || Boolean(value.trim())) ? value : fail();
const array = (value: unknown, limit: number): unknown[] => Array.isArray(value) && value.length <= limit ? value : fail();
const bool = (value: unknown): boolean => typeof value === "boolean" ? value : fail();
const hash = (value: unknown): string => typeof value === "string" && /^[a-f0-9]{64}$/i.test(value) ? value : fail();
const refKey = (ref: RouteSourceRef) => `${ref.kind}:${ref.id}`;
function exact(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).some(key => !keys.includes(key)) || keys.some(key => !(key in value))) return fail();
}
function parseRef(value: unknown): RouteSourceRef {
  const v = object(value);
  exact(v, ["kind", "id"]);
  if (!["wire", "cable", "covering", "connector"].includes(String(v.kind))) return fail();
  return { kind: v.kind as RouteSourceRef["kind"], id: text(v.id, 128) };
}
function parseOperation(value: unknown): RouteOperation {
  const v = object(value);
  exact(v, ["id", "binding", "mode", "note"]);
  if (!routeOperationModes.includes(v.mode as RouteOperation["mode"])) return fail();
  let binding: RouteOperation["binding"] = null;
  if (v.binding !== null) {
    const b = object(v.binding);
    exact(b, ["sourceId", "entityType", "snapshotId", "snapshotSha256", "recordId", "sourceKey", "displayName"]);
    if (b.entityType !== "operation" || typeof b.snapshotId !== "string" || b.snapshotId === "00000000-0000-0000-0000-000000000000" || !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(b.snapshotId)) return fail();
    binding = { sourceId: text(b.sourceId, 512), entityType: "operation", snapshotId: b.snapshotId, snapshotSha256: hash(b.snapshotSha256), recordId: hash(b.recordId), sourceKey: text(b.sourceKey, 512), displayName: text(b.displayName, 512) };
  }
  return { id: text(v.id, 128), binding, mode: v.mode as RouteOperation["mode"], note: text(v.note, 4000, true) };
}
function parseTerminalRequirement(value: unknown): RouteTerminalRequirement {
  const v = object(value);
  exact(v, ["wireId", "end", "terminalArticle", "stripLengthMm", "binding"]);
  if (v.end !== "from" && v.end !== "to") return fail();
  const terminalArticle = text(v.terminalArticle, 512, true);
  if (v.stripLengthMm !== null && (typeof v.stripLengthMm !== "number" || !Number.isFinite(v.stripLengthMm) || v.stripLengthMm < 0 || v.stripLengthMm > 1e9 || Math.abs(v.stripLengthMm * 1000 - Math.round(v.stripLengthMm * 1000)) > 1e-4)) return fail();
  let binding: RouteTerminalRequirement["binding"] = null;
  if (v.binding !== null) {
    const b = object(v.binding);
    if (b.entityType !== "terminal" || b.sourceKey !== terminalArticle) return fail();
    const parsed = parseOperation({ id: "terminal", mode: "assembly", note: "", binding: { ...b, entityType: "operation" } }).binding!;
    binding = { ...parsed, entityType: "terminal" };
  } else if (v.stripLengthMm !== null) return fail();
  return { wireId: text(v.wireId, 128), end: v.end, terminalArticle, stripLengthMm: v.stripLengthMm as number | null, binding };
}
export function parseManufacturingRoute(value: unknown): ManufacturingRoute | undefined {
  if (value === undefined) return undefined;
  const v = object(value), source = object(v.source);
  exact(v, ["contractVersion", "source", "status", "rows"]);
  exact(source, ["fingerprintVersion", "sha256"]);
  if (v.contractVersion !== 1 || source.fingerprintVersion !== 1 || !["draft", "completed"].includes(String(v.status))) return fail();
  let refCount = 0;
  const rows = array(v.rows, 1000).map(candidate => {
    const r = object(candidate), p = object(r.presentation);
    exact(r, ["id", "kind", "title", "comment", "sourceObjects", "dependsOn", "operations", "presentation", "prepared", ...(r.photos !== undefined ? ["photos"] : []), ...(r.terminalRequirements !== undefined ? ["terminalRequirements"] : [])]);
    exact(p, ["backgroundOpacity", "objects"]);
    if (!["semiFinished", "assembly"].includes(String(r.kind)) || typeof p.backgroundOpacity !== "number" || !Number.isFinite(p.backgroundOpacity) || p.backgroundOpacity < .1 || p.backgroundOpacity > .5) return fail();
    const sourceObjects = array(r.sourceObjects, 10000).map(parseRef);
    const objects = array(p.objects, 10000).map(candidate => {
      const o = object(candidate);
      exact(o, ["ref", "points", "hidden"]);
      const points = array(o.points, 2000).map(candidate => {
        const p = object(candidate);
        exact(p, ["x", "y"]);
        if (typeof p.x !== "number" || typeof p.y !== "number" || !Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.abs(p.x) > 1e7 || Math.abs(p.y) > 1e7) return fail();
        return { x: p.x, y: p.y };
      });
      return { ref: parseRef(o.ref), points, hidden: bool(o.hidden) };
    });
    refCount += sourceObjects.length + objects.length;
    const operations = array(r.operations, 100).map(parseOperation);
    if (new Set(operations.map(o => o.id)).size !== operations.length || new Set(objects.map(o => refKey(o.ref))).size !== objects.length) return fail();
    const photos = r.photos === undefined ? undefined : array(r.photos, 16).map(candidate => { const photo = object(candidate); exact(photo, ["sha256", "name"]); return { sha256: hash(photo.sha256), name: text(photo.name, 255) }; });
    if (photos && new Set(photos.map(photo => photo.sha256)).size !== photos.length) return fail();
    const terminalRequirements = r.terminalRequirements === undefined ? undefined : array(r.terminalRequirements, 10000).map(parseTerminalRequirement);
    refCount += (terminalRequirements?.length ?? 0) + array(r.dependsOn, 1000).length;
    if (terminalRequirements && (new Set(terminalRequirements.map(item => `${item.wireId}:${item.end}`)).size !== terminalRequirements.length || terminalRequirements.some(item => !sourceObjects.some(ref => ref.kind === "wire" && ref.id === item.wireId)))) return fail();
    return { id: text(r.id, 128), kind: r.kind as RouteRow["kind"], title: text(r.title, 512), comment: text(r.comment, 4000, true), sourceObjects, dependsOn: array(r.dependsOn, 1000).map(id => text(id, 128)), operations, presentation: { backgroundOpacity: p.backgroundOpacity, objects }, prepared: bool(r.prepared), ...(photos ? { photos } : {}), ...(terminalRequirements ? { terminalRequirements } : {}) };
  });
  if (refCount > 10000) return fail();
  const byId = new Map(rows.map(row => [row.id, row]));
  if (byId.size !== rows.length) return fail();
  const introduced = new Set<string>();
  const operationIds = new Set<string>();
  for (const row of rows) {
    for (const op of row.operations) {
      if (operationIds.has(op.id)) return fail();
      operationIds.add(op.id);
    }
    if (new Set(row.dependsOn).size !== row.dependsOn.length || row.dependsOn.some(id => !byId.has(id) || id === row.id)) return fail();
    for (const ref of row.sourceObjects) {
      if (introduced.has(refKey(ref))) return fail();
      introduced.add(refKey(ref));
    }
    const composed = new Set<string>();
    const collected = new Set<string>();
    const collect = (id: string): void => {
      if (collected.has(id)) return;
      collected.add(id);
      const parent = byId.get(id);
      if (!parent) return;
      parent.dependsOn.forEach(collect);
      parent.sourceObjects.forEach(ref => composed.add(refKey(ref)));
    };
    row.dependsOn.forEach(collect);
    row.sourceObjects.forEach(ref => composed.add(refKey(ref)));
    for (const item of row.presentation.objects) if (!composed.has(refKey(item.ref))) return fail();
  }
  const visited = new Set<string>(), visiting = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) return fail();
    if (visited.has(id)) return;
    visiting.add(id); byId.get(id)!.dependsOn.forEach(visit); visiting.delete(id); visited.add(id);
  };
  rows.forEach(row => visit(row.id));
  if (v.status === "completed" && (!rows.length || rows.some(row => !row.prepared || !row.operations.length || row.operations.some(op => !op.binding)))) return fail();
  if (v.status === "completed" && !rows.some(row => {
    if (row.kind !== "assembly") return false;
    const ancestors = new Set<string>();
    const collect = (id: string): void => { if (ancestors.has(id)) return; ancestors.add(id); byId.get(id)!.dependsOn.forEach(collect); };
    collect(row.id);
    return ancestors.size === rows.length;
  })) return fail();
  return { contractVersion: 1, source: { fingerprintVersion: 1, sha256: hash(source.sha256) }, status: v.status as ManufacturingRoute["status"], rows };
}

/** Shared ancestors contribute their physical objects once at a merge. */
export function routeRowComposition(route: ManufacturingRoute, rowId: string): RouteSourceRef[] {
  const refs = new Map<string, RouteSourceRef>(), seen = new Set<string>();
  const visit = (id: string): void => {
    if (seen.has(id)) return;
    seen.add(id);
    const row = route.rows.find(row => row.id === id);
    if (!row) throw new Error("Этап маршрута не найден.");
    row.dependsOn.forEach(visit); row.sourceObjects.forEach(ref => refs.set(refKey(ref), ref));
  };
  visit(rowId); return [...refs.values()];
}
