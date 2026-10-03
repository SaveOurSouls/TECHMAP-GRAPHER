import type { HarnessDesignDocument } from "../editor/model";
import { buildRouteSourceItems, type RouteSourceRef } from "./route-source";
import { parseManufacturingRoute, routeRowComposition, type ManufacturingRoute, type RouteAssemblyInput, type RouteRow } from "./route-model";
import { parseRouteDrawingCopy } from "./route-drawing-copy";

const validate = (route: ManufacturingRoute): ManufacturingRoute => parseManufacturingRoute(route)!;
const unique = <T>(items: readonly T[]): T[] => [...new Set(items)];

/** Initial generation only; opening an existing route must preserve manually authored rows. */
export function generateRoute(document: HarnessDesignDocument, sourceSha256: string, quantity = 1): ManufacturingRoute {
  return validate({
    contractVersion: 1, source: { fingerprintVersion: 1, sha256: sourceSha256 }, status: "draft",
    rows: buildRouteSourceItems(document).filter(item => item.ref.kind !== "connector").map((item, index) => ({
      id: `source-${index + 1}`, kind: "semiFinished", index: `ПФ-${String(index + 1).padStart(2, "0")}`, title: item.title, quantity, reserve: 0, operationTimeMinutes: 0, comment: "", sourceObjects: [item.ref], dependsOn: [], operations: [], prepared: false,
      presentation: { backgroundOpacity: .25, objects: [] },
    })),
  });
}

function invalidateDescendants(rows: readonly RouteRow[], changed: ReadonlySet<string>): RouteRow[] {
  const affected = new Set(changed);
  let grew = true;
  while (grew) {
    grew = false;
    for (const row of rows) if (!affected.has(row.id) && row.dependsOn.some(id => affected.has(id))) {
      affected.add(row.id); grew = true;
    }
  }
  return rows.map(row => affected.has(row.id) ? { ...row, prepared: false } : row);
}

export function mergeRouteRows(route: ManufacturingRoute, ids: readonly string[], newId: string): ManufacturingRoute {
  const original = validate(route), selection = new Set(ids);
  if (selection.size !== ids.length || selection.size < 2) throw new Error("Выберите минимум два разных полуфабриката.");
  const selected = original.rows.filter(row => selection.has(row.id));
  if (selected.length !== selection.size || selected.some(row => row.kind !== "semiFinished")) throw new Error("Объединять можно только существующие полуфабрикаты.");
  if (original.rows.some(row => row.id === newId)) throw new Error("ID нового полуфабриката уже существует.");
  const objects = new Map<string, RouteRow["presentation"]["objects"][number]>();
  for (const row of selected) for (const item of row.presentation.objects) {
    const key = `${item.ref.kind}:${item.ref.id}`, old = objects.get(key);
    if (old && JSON.stringify(old) !== JSON.stringify(item)) throw new Error("Разные представления общего объекта. Согласуйте их перед объединением.");
    objects.set(key, item);
  }
  const components = selected.flatMap(row => row.components ?? row.sourceObjects.map(ref => ({ ref, ...(row.index === undefined ? {} : { index: row.index }), title: row.title, ...(row.quantity === undefined ? {} : { quantity: row.quantity }), ...(row.reserve === undefined ? {} : { reserve: row.reserve }), ...(row.operationTimeMinutes === undefined ? {} : { operationTimeMinutes: row.operationTimeMinutes }) })));
  const merged: RouteRow = {
    id: newId, kind: "semiFinished", ...(selected[0]?.index === undefined ? {} : { index: selected[0].index }), title: selected.map(row => row.title).join(" + ").slice(0, 512),
    quantity: Math.max(1, selected.reduce((max, row) => Math.max(max, row.quantity ?? 0), 0)), reserve: selected.reduce((sum, row) => sum + (row.reserve ?? 0), 0), operationTimeMinutes: selected.reduce((sum, row) => sum + (row.operationTimeMinutes ?? 0), 0),
    comment: selected.map(row => row.comment).filter(Boolean).join("\n\n"),
    sourceObjects: selected.flatMap(row => row.sourceObjects), components,
    dependsOn: unique(selected.flatMap(row => row.dependsOn).filter(id => !selection.has(id))),
    operations: selected.flatMap(row => row.operations), prepared: false,
    presentation: { backgroundOpacity: selected[0]!.presentation.backgroundOpacity, objects: [...objects.values()] },
    ...(selected.some(row => row.terminalRequirements) ? { terminalRequirements: selected.flatMap(row => row.terminalRequirements ?? []) } : {}),
    ...(selected.some(row => row.photos) ? { photos: [...new Map(selected.flatMap(row => row.photos ?? []).map(photo => [photo.sha256.toLowerCase(), photo])).values()] } : {}),
    ...(selected.some(row => row.wireBlankSelections) ? { wireBlankSelections: [...new Map(selected.flatMap(row => row.wireBlankSelections ?? []).map(selection => [selection.wireId, selection])).values()] } : {}),
  };
  let inserted = false;
  const rows = original.rows.flatMap(row => {
    if (selection.has(row.id)) {
      if (inserted) return [];
      inserted = true; return [merged];
    }
    const dependsOn = unique(row.dependsOn.map(id => selection.has(id) ? newId : id));
    const assemblyInputs = row.assemblyInputs?.filter((input, index, inputs) => input.kind !== "row" ||
      inputs.findIndex(other => other.kind === "row" && (selection.has(other.rowId) ? newId : other.rowId) === (selection.has(input.rowId) ? newId : input.rowId)) === index)
      .map(input => input.kind === "row" && selection.has(input.rowId) ? { ...input, rowId: newId } : input);
    return [{ ...row, dependsOn, ...(assemblyInputs ? { assemblyInputs } : {}) }];
  });
  return validate({ ...original, status: "draft", rows: invalidateDescendants(rows, new Set([newId])) });
}

export function addAssemblyRow(route: ManufacturingRoute, id: string, title: string, sourceRefs: readonly RouteSourceRef[], dependsOn: readonly string[]): ManufacturingRoute {
  const original = validate(route);
  return validate({ ...original, status: "draft", rows: [...original.rows, {
    id, kind: "assembly", index: `СБ-${String(original.rows.length + 1).padStart(2, "0")}`, title, quantity: 1, reserve: 0, operationTimeMinutes: 0, comment: "", sourceObjects: sourceRefs, dependsOn, operations: [],
    assemblyInputs: [
      ...sourceRefs.map((ref, index) => ({ id: `source-${index + 1}`, kind: "source" as const, ref })),
      ...dependsOn.map((rowId, index) => ({ id: `row-${index + 1}`, kind: "row" as const, rowId })),
    ], presentation: { backgroundOpacity: .25, objects: [] }, prepared: false,
  }] });
}

function inputLines(row: RouteRow): RouteAssemblyInput[] {
  return row.assemblyInputs ? [...row.assemblyInputs] : [
    ...row.sourceObjects.map((ref, index) => ({ id: `source-${index + 1}`, kind: "source" as const, ref })),
    ...row.dependsOn.map((rowId, index) => ({ id: `row-${index + 1}`, kind: "row" as const, rowId })),
  ];
}

/** Adds one addressable input line. A semi-finished row becomes a DAG edge, never a duplicate source. */
export function addAssemblyInput(route: ManufacturingRoute, assemblyId: string, input: RouteAssemblyInput): ManufacturingRoute {
  const original = validate(route);
  const row = original.rows.find(candidate => candidate.id === assemblyId);
  if (!row || row.kind !== "assembly") throw new Error("Строка сборки не найдена.");
  const inputs = inputLines(row);
  if (inputs.some(item => item.id === input.id)) throw new Error("ID входа сборки уже существует.");
  let savedInput: RouteAssemblyInput = input;
  if (input.kind === "source") {
    // Generated routes already have a producing row for each drawing object.
    // Keep the palette action, but persist a DAG edge instead of introducing the source twice.
    const producer = original.rows.find(candidate => candidate.id !== assemblyId && candidate.sourceObjects.some(ref => ref.kind === input.ref.kind && ref.id === input.ref.id));
    if (producer) savedInput = { id: input.id, kind: "row", rowId: producer.id };
  }
  if (savedInput.kind === "row" && inputs.some(item => item.kind === "row" && item.rowId === savedInput.rowId)) {
    throw new Error("Полуфабрикат уже добавлен в сборку.");
  }
  const updated: RouteRow = {
    ...row, assemblyInputs: [...inputs, savedInput],
    sourceObjects: savedInput.kind === "source" ? [...row.sourceObjects, savedInput.ref] : row.sourceObjects,
    dependsOn: savedInput.kind === "row" ? [...row.dependsOn, savedInput.rowId] : row.dependsOn,
  };
  return updateRouteRow(original, assemblyId, updated);
}

/** Removes precisely one input line and any saved shapes no longer in this stage's composition. */
export function removeAssemblyInput(route: ManufacturingRoute, assemblyId: string, inputId: string): ManufacturingRoute {
  const original = validate(route);
  const row = original.rows.find(candidate => candidate.id === assemblyId);
  if (!row || row.kind !== "assembly") throw new Error("Строка сборки не найдена.");
  const inputs = inputLines(row), removed = inputs.find(input => input.id === inputId);
  if (!removed) throw new Error("Вход сборки не найден.");
  const nextRow: RouteRow = {
    ...row, assemblyInputs: inputs.filter(input => input.id !== inputId),
    sourceObjects: removed.kind === "source" ? row.sourceObjects.filter(ref => ref.kind !== removed.ref.kind || ref.id !== removed.ref.id) : row.sourceObjects,
    dependsOn: removed.kind === "row" ? row.dependsOn.filter(id => id !== removed.rowId) : row.dependsOn,
  };
  const next = { ...original, status: "draft" as const, rows: original.rows.map(candidate => candidate.id === assemblyId ? nextRow : candidate) };
  const rows = next.rows.map(candidate => {
    const composed = new Set(routeRowComposition(next, candidate.id).map(ref => `${ref.kind}:${ref.id}`));
    return { ...candidate,
      presentation: { ...candidate.presentation, objects: candidate.presentation.objects.filter(item => composed.has(`${item.ref.kind}:${item.ref.id}`)) },
      ...(candidate.terminalRequirements ? { terminalRequirements: candidate.terminalRequirements.filter(item => composed.has(`wire:${item.wireId}`)) } : {}),
    };
  });
  return validate({ ...next, rows: invalidateDescendants(rows, new Set([assemblyId])) });
}

/** Independent working copy of inherited shapes. Source-only shapes are supplied by the drawing document. */
export function copyAssemblyPresentation(route: ManufacturingRoute, assemblyId: string): RouteRow["presentation"] {
  const original = validate(route);
  const row = original.rows.find(candidate => candidate.id === assemblyId);
  if (!row || row.kind !== "assembly") throw new Error("Строка сборки не найдена.");
  if (routeRowPresentationConflicts(original, assemblyId).length)
    throw new Error("У родителей разные рисунки общего объекта. Выберите геометрию в сборке.");
  const byId = new Map(original.rows.map(candidate => [candidate.id, candidate]));
  const objects = new Map<string, RouteRow["presentation"]["objects"][number]>(), visited = new Set<string>();
  const visit = (id: string): void => {
    if (visited.has(id)) return;
    visited.add(id);
    const current = byId.get(id)!;
    current.dependsOn.forEach(visit);
    current.presentation.objects.forEach(item => objects.set(`${item.ref.kind}:${item.ref.id}`, {
      ref: { ...item.ref }, points: item.points.map(point => ({ ...point })), hidden: item.hidden,
    }));
  };
  visit(assemblyId);
  return { ...row.presentation, objects: [...objects.values()], ...(row.presentation.drawingObjects ? { drawingObjects: row.presentation.drawingObjects.map(object => ({ ...object, points: object.points.map(point => ({ ...point })) })) } : {}), ...(row.presentation.drawingCopy ? { drawingCopy: parseRouteDrawingCopy(row.presentation.drawingCopy) } : {}) };
}

export function updateRouteRow(route: ManufacturingRoute, id: string, patch: Partial<Omit<RouteRow, "id">>): ManufacturingRoute {
  const original = validate(route);
  if (!original.rows.some(row => row.id === id)) throw new Error("Строка маршрута не найдена.");
  const rows = original.rows.map(row => row.id === id ? { ...row, ...patch, id } : row);
  const reset = invalidateDescendants(rows, new Set([id]));
  // Explicit preparation marks only this row ready; descendants still require review.
  return validate({ ...original, status: "draft", rows: reset.map(row => row.id === id && patch.prepared === true ? { ...row, prepared: true } : row) });
}

export interface RoutePresentationConflict {
  readonly ref: RouteSourceRef;
  readonly variants: readonly {
    readonly rowId: string;
    readonly object: RouteRow["presentation"]["objects"][number];
  }[];
}

/** Ancestor shapes are overridden explicitly; incomparable parent branches remain conflicts until resolved locally. */
export function routeRowPresentationConflicts(route: ManufacturingRoute, rowId: string): RoutePresentationConflict[] {
  const original = validate(route);
  const byId = new Map(original.rows.map(row => [row.id, row]));
  type Variant = RoutePresentationConflict["variants"][number];
  const memo = new Map<string, Map<string, Variant[]>>();
  const ancestors = new Map<string, Set<string>>();
  const collectAncestors = (id: string): Set<string> => {
    const cached = ancestors.get(id); if (cached) return cached;
    const row = byId.get(id);
    if (!row) throw new Error("Строка маршрута не найдена.");
    const result = new Set<string>();
    row.dependsOn.forEach(parent => { result.add(parent); collectAncestors(parent).forEach(value => result.add(value)); });
    ancestors.set(id, result); return result;
  };
  const effective = (id: string): Map<string, Variant[]> => {
    const cached = memo.get(id); if (cached) return cached;
    const row = byId.get(id);
    if (!row) throw new Error("Строка маршрута не найдена.");
    const result = new Map<string, Variant[]>();
    for (const parent of row.dependsOn) for (const [key, variants] of effective(parent)) {
      const combined = [...result.get(key) ?? [], ...variants];
      const distinct = [...new Map(combined.map(variant => [variant.rowId, variant])).values()];
      // A newer explicit representation on one path supersedes its ancestor
      // received through another path of the diamond.
      result.set(key, distinct.filter(candidate => !distinct.some(other =>
        other.rowId !== candidate.rowId && collectAncestors(other.rowId).has(candidate.rowId))));
    }
    for (const object of row.presentation.objects) {
      const key = `${object.ref.kind}:${object.ref.id}`;
      result.set(key, [{ rowId: id, object }]);
    }
    memo.set(id, result); return result;
  };
  return [...effective(rowId).values()]
    .filter(variants => new Set(variants.map(item => JSON.stringify(item.object))).size > 1)
    .map(variants => ({ ref: variants[0]!.object.ref, variants }));
}
