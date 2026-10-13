import type { HarnessCutListItem } from "../harness-cut-list-api";
import { wireMarkWithoutSection, wireSemiFinishedProperties } from "../manufacturing/cut-list-properties";
import type { HarnessDesignDocument } from "./model";

export type CutListSortField = "mark" | "color" | "section" | "terminal";
export interface CutListSort { readonly field: CutListSortField; readonly direction: "asc" | "desc"; }
export interface CutListPresentationRow {
  readonly item: HarnessCutListItem;
  readonly name: string;
  readonly mark: string;
  readonly section: string;
  readonly color: string;
  readonly terminalFrom: string;
  readonly terminalTo: string;
}
export interface CutListPresentationGroup { readonly id: "wires" | "coverings"; readonly title: string; readonly rows: readonly CutListPresentationRow[]; }

const compare = (a: string, b: string) => a.localeCompare(b, "ru-RU", { numeric: true, sensitivity: "base" });
const text = (value: string) => value.toLocaleLowerCase("ru-RU");
function generic(item: HarnessCutListItem, document?: HarnessDesignDocument): CutListPresentationRow {
  const covering = document?.physicalTopology?.coverings?.find(candidate => candidate.id === item.wireId);
  const name = covering?.name || item.circuit || item.wireId;
  const material = item.materialDisplayName || (item.material === "not-pinned" ? "Материал не закреплён" : item.material);
  return { item, name, mark: wireMarkWithoutSection(material, ""), section: "—", color: covering?.color || "—", terminalFrom: "—", terminalTo: "—" };
}

export function cutListPresentationRows(items: readonly HarnessCutListItem[], document?: HarnessDesignDocument): readonly CutListPresentationRow[] {
  return items.map(item => {
    const properties = document && (item.sourceKind === "wire" || document.wires.some(wire => wire.id === item.wireId))
      ? wireSemiFinishedProperties(document, item.wireId) : null;
    return properties ? { item, ...properties } : generic(item, document);
  });
}

export function groupedCutListPresentation(items: readonly HarnessCutListItem[], document: HarnessDesignDocument | undefined, filter: string, sorts: readonly CutListSort[]): readonly CutListPresentationGroup[] {
  const filtered = cutListPresentationRows(items, document).filter(row => {
    const query = text(filter.trim());
    return !query || [row.name, row.mark, row.section, row.color, row.terminalFrom, row.terminalTo, row.item.circuit, row.item.wireId].some(value => text(value).includes(query));
  });
  const sortRows = (rows: readonly CutListPresentationRow[]) => rows.map((row, index) => ({ row, index })).sort((a, b) => {
    for (const sort of sorts) {
      const aValue = sort.field === "terminal" ? `${a.row.terminalFrom} ${a.row.terminalTo}` : a.row[sort.field];
      const bValue = sort.field === "terminal" ? `${b.row.terminalFrom} ${b.row.terminalTo}` : b.row[sort.field];
      const result = compare(aValue, bValue);
      if (result) return sort.direction === "asc" ? result : -result;
    }
    return a.index - b.index || compare(a.row.item.wireId, b.row.item.wireId);
  }).map(value => value.row);
  return [
    { id: "wires" as const, title: "Провода и кабели", rows: sortRows(filtered.filter(row => row.item.sourceKind !== "covering")) },
    { id: "coverings" as const, title: "Оболочки", rows: sortRows(filtered.filter(row => row.item.sourceKind === "covering")) },
  ].filter(group => group.rows.length);
}

export function nextCutListSort(sorts: readonly CutListSort[], field: CutListSortField): readonly CutListSort[] {
  const current = sorts.find(sort => sort.field === field);
  if (!current) return [...sorts, { field, direction: "asc" }];
  if (current.direction === "asc") return sorts.map(sort => sort.field === field ? { ...sort, direction: "desc" } : sort);
  return sorts.filter(sort => sort.field !== field);
}
