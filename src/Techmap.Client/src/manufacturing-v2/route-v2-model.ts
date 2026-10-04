import type { HarnessDesignDocument } from "../editor/model";
import { buildRouteSourceItems, type RouteSourceRef } from "../manufacturing/route-source";
import { parseRouteDrawingCopy, type RouteDrawingCopy } from "../manufacturing/route-drawing-copy";
import type { RouteRow } from "../manufacturing/route-model";

export type RouteV2NodeKind = "semiFinished" | "assembly" | "final";

export interface RouteV2Drawing {
  readonly backgroundOpacity: number;
  readonly drawingCopy?: RouteDrawingCopy;
  readonly isolatedDrawingCopy?: RouteDrawingCopy;
}

export interface RouteV2Node {
  readonly id: string;
  readonly kind: RouteV2NodeKind;
  readonly title: string;
  readonly refs: readonly RouteSourceRef[];
  readonly quantity: number;
  readonly x: number;
  readonly y: number;
  readonly operatorConfirmed: boolean;
  readonly drawing?: RouteV2Drawing;
}

export interface RouteV2Edge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
}

export interface RouteV2Document {
  readonly version: 1;
  readonly layoutVersion?: 2;
  readonly nodes: readonly RouteV2Node[];
  readonly edges: readonly RouteV2Edge[];
  readonly finalNodeId: string | null;
}

const sourceKey = (ref: RouteSourceRef) => `${ref.kind}:${ref.id}`;

export function routeV2StorageKey(projectId: string, harnessId: string): string {
  return `techmap.route-v2.${projectId}.${harnessId}`;
}

export function umlStorageKey(projectId: string, harnessId: string): string {
  return `techmap.uml.${projectId}.${harnessId}`;
}

export function createInitialRouteV2(document: HarnessDesignDocument): RouteV2Document {
  const sources = buildRouteSourceItems(document).filter(item => item.ref.kind === "wire" || item.ref.kind === "covering");
  const groups = [
    { kind: "wire" as const, title: "Нарезанные провода" },
    { kind: "covering" as const, title: "Нарезанные оболочки" },
  ].map(group => ({ ...group, items: sources.filter(item => item.ref.kind === group.kind) })).filter(group => group.items.length > 0);
  const nodes = groups.map((group, index): RouteV2Node => ({
    id: `pf-${group.kind}`,
    kind: "semiFinished",
    title: group.title,
    refs: group.items.map(item => item.ref),
    quantity: 1,
    x: 36 + (index % 3) * 318,
    y: 36 + Math.floor(index / 3) * 330,
    operatorConfirmed: false,
  }));
  return { version: 1, layoutVersion: 2, nodes, edges: [], finalNodeId: null };
}

export function parseRouteV2(value: unknown): RouteV2Document | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<RouteV2Document>;
  if (candidate.version !== 1 || !Array.isArray(candidate.nodes) || !Array.isArray(candidate.edges)) return null;
  const isLegacyLayout = candidate.layoutVersion !== 2;
  const nodes = candidate.nodes.filter(node => node && typeof node === "object" && typeof node.id === "string" && typeof node.title === "string" && Array.isArray(node.refs)).map(node => {
    const refs: RouteSourceRef[] = [];
    const refKeys = new Set<string>();
    for (const ref of node.refs) {
      if (!ref || typeof ref !== "object" || !["wire", "cable", "covering", "connector"].includes(ref.kind) || typeof ref.id !== "string" || !ref.id.trim()) continue;
      const key = sourceKey(ref);
      if (!refKeys.has(key)) { refs.push({ kind: ref.kind, id: ref.id }); refKeys.add(key); }
    }
    let drawing: RouteV2Drawing | undefined;
    const rawDrawing = node.drawing;
    if (rawDrawing !== undefined) {
      if (!rawDrawing || typeof rawDrawing !== "object" || !Number.isFinite(rawDrawing.backgroundOpacity) || Number(rawDrawing.backgroundOpacity) < 0 || Number(rawDrawing.backgroundOpacity) > 1) {
        throw new Error(`Рисунок карточки «${node.title}» повреждён: некорректная прозрачность фона.`);
      }
      const safeCopy = (copy: unknown, label: string): RouteDrawingCopy | undefined => {
        if (copy === undefined) return undefined;
        try { return parseRouteDrawingCopy(copy); }
        catch (error) {
          const detail = error instanceof Error ? ` ${error.message}` : "";
          throw new Error(`Рисунок карточки «${node.title}» повреждён (${label}).${detail}`);
        }
      };
      const drawingCopy = safeCopy(rawDrawing.drawingCopy, "исходная копия");
      const isolatedDrawingCopy = safeCopy(rawDrawing.isolatedDrawingCopy, "изолированная копия");
      drawing = { backgroundOpacity: Number(rawDrawing.backgroundOpacity), ...(drawingCopy ? { drawingCopy } : {}), ...(isolatedDrawingCopy ? { isolatedDrawingCopy } : {}) };
    }
    const oldX = Number.isFinite(node.x) ? Number(node.x) : 36;
    const oldY = Number.isFinite(node.y) ? Number(node.y) : 36;
    return {
      id: node.id,
      kind: node.kind === "assembly" || node.kind === "final" ? node.kind : "semiFinished",
      title: node.title,
      refs,
      quantity: Number.isFinite(node.quantity) && Number(node.quantity) > 0 ? Number(node.quantity) : 1,
      x: isLegacyLayout ? Math.max(12, (oldX - 36) * 318 / 280 + 36) : oldX,
      y: isLegacyLayout ? Math.max(12, (oldY - 36) * 330 / 174 + 36) : oldY,
      operatorConfirmed: Boolean(node.operatorConfirmed),
      ...(drawing ? { drawing } : {}),
    } satisfies RouteV2Node;
  });
  const ids = new Set(nodes.map(node => node.id));
  const edges = candidate.edges.filter(edge => edge && typeof edge === "object" && typeof edge.id === "string" && typeof edge.from === "string" && typeof edge.to === "string" && ids.has(edge.from) && ids.has(edge.to) && edge.from !== edge.to).map(edge => ({ id: edge.id, from: edge.from, to: edge.to })) as RouteV2Edge[];
  return { version: 1, layoutVersion: 2, nodes, edges, finalNodeId: typeof candidate.finalNodeId === "string" && ids.has(candidate.finalNodeId) ? candidate.finalNodeId : null };
}

function appendNode(graph: RouteV2Document, node: RouteV2Node): RouteV2Document {
  if (!node.id || graph.nodes.some(existing => existing.id === node.id)) return graph;
  return { ...graph, nodes: [...graph.nodes, node] };
}

/** Remove a card, all incident links, and clear the final marker when needed. */
export function removeRouteV2Node(graph: RouteV2Document, id: string): RouteV2Document {
  if (!graph.nodes.some(node => node.id === id)) return graph;
  return { ...graph, nodes: graph.nodes.filter(node => node.id !== id), edges: graph.edges.filter(edge => edge.from !== id && edge.to !== id), finalNodeId: graph.finalNodeId === id ? null : graph.finalNodeId };
}

/** Remove one dependency edge by ID. */
export function removeRouteV2Edge(graph: RouteV2Document, id: string): RouteV2Document {
  return { ...graph, edges: graph.edges.filter(edge => edge.id !== id) };
}

/** Add a dependency edge unless it is invalid or already present; reject cycles explicitly. */
export function addRouteV2Edge(graph: RouteV2Document, id: string, from: string, to: string): RouteV2Document {
  if (!id || from === to || !graph.nodes.some(node => node.id === from) || !graph.nodes.some(node => node.id === to)) return graph;
  if (graph.edges.some(edge => edge.id === id || (edge.from === from && edge.to === to))) return graph;

  // Adding from → to creates a cycle exactly when `from` is already reachable from `to`.
  const outgoing = new Map<string, string[]>();
  for (const edge of graph.edges) outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
  const pending = [to];
  const visited = new Set<string>();
  while (pending.length) {
    const current = pending.pop()!;
    if (current === from) throw new Error("Нельзя добавить связь: она создаст цикл зависимостей.");
    if (visited.has(current)) continue;
    visited.add(current);
    pending.push(...(outgoing.get(current) ?? []));
  }

  return { ...graph, edges: [...graph.edges, { id, from, to }] };
}

/** Explicitly replace a card's source refs, removing invalid entries and duplicates. */
export function setRouteV2NodeRefs(graph: RouteV2Document, id: string, refs: readonly RouteSourceRef[]): RouteV2Document {
  if (!graph.nodes.some(node => node.id === id)) return graph;
  const unique: RouteSourceRef[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    if (!ref || !["wire", "cable", "covering", "connector"].includes(ref.kind) || typeof ref.id !== "string" || !ref.id.trim()) continue;
    const key = sourceKey(ref);
    if (!seen.has(key)) { unique.push({ kind: ref.kind, id: ref.id }); seen.add(key); }
  }
  return { ...graph, nodes: graph.nodes.map(node => node.id === id ? { ...node, refs: unique } : node) };
}

/** Create an assembly card with no inherited refs and connect its parent. */
export function addRouteV2Assembly(graph: RouteV2Document, parentId: string, nodeId: string, edgeId: string): RouteV2Document {
  if (!graph.nodes.some(node => node.id === parentId) || !nodeId || !edgeId || graph.nodes.some(node => node.id === nodeId) || graph.edges.some(edge => edge.id === edgeId)) return graph;
  const parent = graph.nodes.find(node => node.id === parentId)!;
  const node: RouteV2Node = { id: nodeId, kind: "assembly", title: `Сборка ${graph.nodes.filter(item => item.kind === "assembly").length + 1}`, refs: [], quantity: 1, x: parent.x, y: Math.max(...graph.nodes.map(item => item.y)) + 330, operatorConfirmed: false };
  return { ...appendNode(graph, node), edges: [...graph.edges, { id: edgeId, from: parentId, to: nodeId }] };
}

/** Create an empty final card. Optional edge IDs connect current graph leaves into it. */
export function addRouteV2Final(graph: RouteV2Document, nodeId: string, edgeIds: readonly string[] = []): RouteV2Document {
  if (graph.finalNodeId || !nodeId || graph.nodes.some(node => node.id === nodeId)) return graph;
  const parents = graph.nodes.filter(node => !graph.edges.some(edge => edge.from === node.id));
  if (new Set(edgeIds).size !== edgeIds.length || edgeIds.some(id => !id || graph.edges.some(edge => edge.id === id))) return graph;
  const node: RouteV2Node = { id: nodeId, kind: "final", title: "Готовый жгут · финальная карточка", refs: [], quantity: 1, x: 48, y: graph.nodes.length ? Math.max(...graph.nodes.map(item => item.y)) + 350 : 36, operatorConfirmed: false };
  const edges = parents.map((parent, index) => ({ id: edgeIds[index] ?? `${nodeId}:from:${parent.id}`, from: parent.id, to: nodeId }));
  if (edges.some(edge => graph.edges.some(existing => existing.id === edge.id)) || new Set(edges.map(edge => edge.id)).size !== edges.length) return graph;
  return { ...appendNode(graph, node), edges: [...graph.edges, ...edges], finalNodeId: nodeId };
}

export function routeV2SourceTitle(document: HarnessDesignDocument, ref: RouteSourceRef): string {
  return buildRouteSourceItems(document).find(item => sourceKey(item.ref) === sourceKey(ref))?.title ?? `${ref.kind}:${ref.id}`;
}

export function routeV2DrawingRow(node: RouteV2Node): RouteRow {
  return {
    id: node.id,
    kind: node.kind === "semiFinished" ? "semiFinished" : "assembly",
    title: node.title,
    quantity: node.quantity,
    comment: "",
    sourceObjects: node.refs,
    dependsOn: [],
    operations: [],
    presentation: {
      backgroundOpacity: node.drawing?.backgroundOpacity ?? 1,
      objects: [],
      ...(node.drawing?.drawingCopy ? { drawingCopy: node.drawing.drawingCopy } : {}),
      ...(node.drawing?.isolatedDrawingCopy ? { isolatedDrawingCopy: node.drawing.isolatedDrawingCopy } : {}),
    },
    prepared: false,
  };
}
