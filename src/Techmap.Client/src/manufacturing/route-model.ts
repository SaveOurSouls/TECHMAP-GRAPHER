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
/** One visible, removable input line in an assembly row. */
export type RouteAssemblyInput =
  | { readonly id: string; readonly kind: "source"; readonly ref: RouteSourceRef }
  | { readonly id: string; readonly kind: "row"; readonly rowId: string };
export interface RouteRow {
  readonly terminalRequirements?: readonly RouteTerminalRequirement[];
  readonly photos?: readonly { readonly sha256: string; readonly name: string }[];
  readonly id: string;
  readonly kind: "semiFinished" | "assembly";
  /** Human-facing storage/transfer index for the semi-finished product. */
  readonly index?: string;
  readonly title: string;
  /** Quantity to manufacture and safety stock for this stage. */
  readonly quantity?: number;
  readonly reserve?: number;
  /** Planned time for one route row, in minutes. */
  readonly operationTimeMinutes?: number;
  readonly comment: string;
  readonly sourceObjects: readonly RouteSourceRef[];
  readonly dependsOn: readonly string[];
  /** Optional for routes saved before assembly input lines were introduced. */
  readonly assemblyInputs?: readonly RouteAssemblyInput[];
  /** Explicit wire illustration choices pinned to an immutable catalog snapshot. */
  readonly wireBlankSelections?: readonly { readonly wireId: string; readonly binding: { readonly sourceId: "technology-wire-blanks"; readonly entityType: "wire-blank"; readonly snapshotId: string; readonly snapshotSha256: string; readonly recordId: string; readonly sourceKey: string; readonly displayName: string; readonly visual: { readonly start: string; readonly end: string; readonly color: string; readonly templateId: string; readonly photoDataUrl: string | null } } }[];
  readonly operations: readonly RouteOperation[];
  readonly presentation: { readonly backgroundOpacity: number; readonly objects: readonly { readonly ref: RouteSourceRef; readonly points: readonly Point[]; readonly hidden: boolean }[]; readonly drawingObjects?: readonly { readonly id: string; readonly kind: string; readonly layerId: string; readonly points: readonly Point[]; readonly hidden: boolean }[] };
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
function parseAssemblyInput(value: unknown): RouteAssemblyInput {
  const input = object(value);
  if (input.kind === "source") {
    exact(input, ["id", "kind", "ref"]);
    return { id: text(input.id, 128), kind: "source", ref: parseRef(input.ref) };
  }
  if (input.kind === "row") {
    exact(input, ["id", "kind", "rowId"]);
    return { id: text(input.id, 128), kind: "row", rowId: text(input.rowId, 128) };
  }
  return fail();
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
    exact(r, ["id", "kind", "title", "comment", "sourceObjects", "dependsOn", "operations", "presentation", "prepared", ...(r.assemblyInputs !== undefined ? ["assemblyInputs"] : []), ...(r.wireBlankSelections !== undefined ? ["wireBlankSelections"] : []), ...(r.index !== undefined ? ["index"] : []), ...(r.quantity !== undefined ? ["quantity"] : []), ...(r.reserve !== undefined ? ["reserve"] : []), ...(r.operationTimeMinutes !== undefined ? ["operationTimeMinutes"] : []), ...(r.photos !== undefined ? ["photos"] : []), ...(r.terminalRequirements !== undefined ? ["terminalRequirements"] : [])]);
    exact(p, ["backgroundOpacity", "objects", ...(p.drawingObjects !== undefined ? ["drawingObjects"] : [])]);
    if (!["semiFinished", "assembly"].includes(String(r.kind)) || typeof p.backgroundOpacity !== "number" || !Number.isFinite(p.backgroundOpacity) || p.backgroundOpacity < 0 || p.backgroundOpacity > 1) return fail();
    const sourceObjects = array(r.sourceObjects, 10000).map(parseRef);
    const dependsOn = array(r.dependsOn, 1000).map(id => text(id, 128));
    const assemblyInputs = r.assemblyInputs === undefined ? undefined : array(r.assemblyInputs, 10000).map(parseAssemblyInput);
    if (assemblyInputs) {
      if (r.kind !== "assembly" || new Set(assemblyInputs.map(input => input.id)).size !== assemblyInputs.length) return fail();
      const inputSources = assemblyInputs.filter(input => input.kind === "source").map(input => refKey(input.ref));
      const inputRows = assemblyInputs.filter(input => input.kind === "row").map(input => input.rowId);
      if (inputSources.length !== sourceObjects.length || inputRows.length !== dependsOn.length ||
        new Set(inputSources).size !== inputSources.length || new Set(inputRows).size !== inputRows.length ||
        inputSources.some(key => !sourceObjects.some(ref => refKey(ref) === key)) || inputRows.some(id => !dependsOn.includes(id))) return fail();
    }
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
    const drawingObjects = p.drawingObjects === undefined ? undefined : array(p.drawingObjects, 10000).map(candidate => {
      const d = object(candidate); exact(d, ["id", "kind", "layerId", "points", "hidden"]);
      const points = array(d.points, 2000).map(candidate => { const point = object(candidate); exact(point, ["x", "y"]); if (typeof point.x !== "number" || typeof point.y !== "number" || !Number.isFinite(point.x) || !Number.isFinite(point.y) || Math.abs(point.x) > 1e7 || Math.abs(point.y) > 1e7) return fail(); return { x: point.x, y: point.y }; });
      return { id: text(d.id, 128), kind: text(d.kind, 128), layerId: text(d.layerId, 256), points, hidden: bool(d.hidden) };
    });
    if (drawingObjects && new Set(drawingObjects.map(item => `${item.kind}:${item.id}`)).size !== drawingObjects.length) return fail();
    const wireBlankSelections = r.wireBlankSelections === undefined ? undefined : array(r.wireBlankSelections, 10000).map(candidate => {
      const selection = object(candidate); exact(selection, ["wireId", "binding"]);
      const wireId = text(selection.wireId, 128), binding = object(selection.binding);
      exact(binding, ["sourceId", "entityType", "snapshotId", "snapshotSha256", "recordId", "sourceKey", "displayName", "visual"]);
      if (binding.sourceId !== "technology-wire-blanks" || binding.entityType !== "wire-blank" || typeof binding.snapshotId !== "string" || !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(binding.snapshotId) || binding.snapshotId === "00000000-0000-0000-0000-000000000000") return fail();
      const visual = object(binding.visual); exact(visual, ["start", "end", "color", "templateId", "photoDataUrl"]);
      if (!["cut", "copper", "tin", "terminal", "sealed", "sealed-pin"].includes(String(visual.start)) || !["cut", "copper", "tin", "terminal", "sealed", "sealed-pin"].includes(String(visual.end)) || typeof visual.color !== "string" || !/^#[\da-f]{6}$/i.test(visual.color) || visual.photoDataUrl !== null && (typeof visual.photoDataUrl !== "string" || visual.photoDataUrl.length > 1_400_000 || !/^data:image\/png;base64,[a-zA-Z0-9+/]+={0,2}$/.test(visual.photoDataUrl))) return fail();
      return { wireId, binding: { sourceId: "technology-wire-blanks" as const, entityType: "wire-blank" as const, snapshotId: binding.snapshotId, snapshotSha256: hash(binding.snapshotSha256), recordId: hash(binding.recordId), sourceKey: text(binding.sourceKey, 512), displayName: text(binding.displayName, 512), visual: { start: visual.start as string, end: visual.end as string, color: visual.color, templateId: text(visual.templateId, 128), photoDataUrl: visual.photoDataUrl as string | null } } };
    });
    if (wireBlankSelections && (r.kind !== "semiFinished" || new Set(wireBlankSelections.map(item => item.wireId)).size !== wireBlankSelections.length || wireBlankSelections.some(item => !sourceObjects.some(ref => ref.kind === "wire" && ref.id === item.wireId)))) return fail();
    refCount += sourceObjects.length + objects.length + (drawingObjects?.length ?? 0) + (wireBlankSelections?.length ?? 0);
    const operations = array(r.operations, 100).map(parseOperation);
    if (new Set(operations.map(o => o.id)).size !== operations.length || new Set(objects.map(o => refKey(o.ref))).size !== objects.length) return fail();
    const photos = r.photos === undefined ? undefined : array(r.photos, 16).map(candidate => { const photo = object(candidate); exact(photo, ["sha256", "name"]); return { sha256: hash(photo.sha256), name: text(photo.name, 255) }; });
    if (photos && new Set(photos.map(photo => photo.sha256)).size !== photos.length) return fail();
    const terminalRequirements = r.terminalRequirements === undefined ? undefined : array(r.terminalRequirements, 10000).map(parseTerminalRequirement);
    refCount += (terminalRequirements?.length ?? 0) + dependsOn.length;
    if (terminalRequirements && (new Set(terminalRequirements.map(item => `${item.wireId}:${item.end}`)).size !== terminalRequirements.length || terminalRequirements.some(item => !sourceObjects.some(ref => ref.kind === "wire" && ref.id === item.wireId)))) return fail();
    const index = r.index === undefined ? undefined : text(r.index, 128, true);
    const optionalNumber = (value: unknown): number | undefined => value === undefined ? undefined : (typeof value === "number" && Number.isFinite(value) ? value : fail());
    const quantity = optionalNumber(r.quantity);
    const reserve = optionalNumber(r.reserve);
    const operationTimeMinutes = optionalNumber(r.operationTimeMinutes);
    for (const [value, minimum] of [[quantity, 1], [reserve, 0], [operationTimeMinutes, 0]] as const) {
      if (value !== undefined && (value < minimum || value > 1e9 || Math.abs(value * 1000 - Math.round(value * 1000)) > 1e-4)) return fail();
    }
    return { id: text(r.id, 128), kind: r.kind as RouteRow["kind"], ...(index === undefined ? {} : { index }), title: text(r.title, 512), ...(quantity === undefined ? {} : { quantity }), ...(reserve === undefined ? {} : { reserve }), ...(operationTimeMinutes === undefined ? {} : { operationTimeMinutes }), comment: text(r.comment, 4000, true), sourceObjects, dependsOn, ...(assemblyInputs === undefined ? {} : { assemblyInputs }), ...(wireBlankSelections === undefined ? {} : { wireBlankSelections }), operations, presentation: { backgroundOpacity: p.backgroundOpacity, objects, ...(drawingObjects === undefined ? {} : { drawingObjects }) }, prepared: bool(r.prepared), ...(photos ? { photos } : {}), ...(terminalRequirements ? { terminalRequirements } : {}) };
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
  if (v.status === "completed" && !rows.some(row => row.sourceObjects.length)) return fail();
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
