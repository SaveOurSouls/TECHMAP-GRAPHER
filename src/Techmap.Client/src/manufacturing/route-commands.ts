import type { HarnessDesignDocument } from "../editor/model";
import { buildRouteSourceItems, type RouteSourceRef } from "./route-source";
import { parseManufacturingRoute, type ManufacturingRoute, type RouteRow } from "./route-model";

const validate = (route: ManufacturingRoute): ManufacturingRoute => parseManufacturingRoute(route)!;
const unique = <T>(items: readonly T[]): T[] => [...new Set(items)];

/** Initial generation only; opening an existing route must preserve manually authored rows. */
export function generateRoute(document: HarnessDesignDocument, sourceSha256: string): ManufacturingRoute {
  return validate({
    contractVersion: 1, source: { fingerprintVersion: 1, sha256: sourceSha256 }, status: "draft",
    rows: buildRouteSourceItems(document).filter(item => item.ref.kind !== "connector").map((item, index) => ({
      id: `source-${index + 1}`, kind: "semiFinished", title: item.title, comment: "", sourceObjects: [item.ref], dependsOn: [], operations: [], prepared: false,
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
  const merged: RouteRow = {
    id: newId, kind: "semiFinished", title: selected.map(row => row.title).join(" + ").slice(0, 512),
    comment: selected.map(row => row.comment).filter(Boolean).join("\n\n"),
    sourceObjects: selected.flatMap(row => row.sourceObjects),
    dependsOn: unique(selected.flatMap(row => row.dependsOn).filter(id => !selection.has(id))),
    operations: selected.flatMap(row => row.operations), prepared: false,
    presentation: { backgroundOpacity: selected[0]!.presentation.backgroundOpacity, objects: [...objects.values()] },
    ...(selected.some(row => row.terminalRequirements) ? { terminalRequirements: selected.flatMap(row => row.terminalRequirements ?? []) } : {}),
    ...(selected.some(row => row.photos) ? { photos: [...new Map(selected.flatMap(row => row.photos ?? []).map(photo => [photo.sha256.toLowerCase(), photo])).values()] } : {}),
  };
  let inserted = false;
  const rows = original.rows.flatMap(row => {
    if (selection.has(row.id)) {
      if (inserted) return [];
      inserted = true; return [merged];
    }
    return [{ ...row, dependsOn: unique(row.dependsOn.map(id => selection.has(id) ? newId : id)) }];
  });
  return validate({ ...original, status: "draft", rows: invalidateDescendants(rows, new Set([newId])) });
}

export function addAssemblyRow(route: ManufacturingRoute, id: string, title: string, sourceRefs: readonly RouteSourceRef[], dependsOn: readonly string[]): ManufacturingRoute {
  const original = validate(route);
  return validate({ ...original, status: "draft", rows: [...original.rows, {
    id, kind: "assembly", title, comment: "", sourceObjects: sourceRefs, dependsOn, operations: [],
    presentation: { backgroundOpacity: .25, objects: [] }, prepared: false,
  }] });
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
