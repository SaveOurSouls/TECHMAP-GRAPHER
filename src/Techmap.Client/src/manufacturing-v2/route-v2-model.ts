import type { HarnessDesignDocument } from "../editor/model";
import { buildRouteSourceItems, type RouteSourceRef } from "../manufacturing/route-source";

export type RouteV2NodeKind = "semiFinished" | "assembly" | "final";

export interface RouteV2Node {
  readonly id: string;
  readonly kind: RouteV2NodeKind;
  readonly title: string;
  readonly refs: readonly RouteSourceRef[];
  readonly quantity: number;
  readonly x: number;
  readonly y: number;
  readonly operatorConfirmed: boolean;
}

export interface RouteV2Edge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
}

export interface RouteV2Document {
  readonly version: 1;
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
    x: 36 + (index % 3) * 272,
    y: 36 + Math.floor(index / 3) * 174,
    operatorConfirmed: false,
  }));
  return { version: 1, nodes, edges: [], finalNodeId: null };
}

export function parseRouteV2(value: unknown): RouteV2Document | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<RouteV2Document>;
  if (candidate.version !== 1 || !Array.isArray(candidate.nodes) || !Array.isArray(candidate.edges)) return null;
  const nodes = candidate.nodes.filter(node => node && typeof node === "object" && typeof node.id === "string" && typeof node.title === "string" && Array.isArray(node.refs)).map(node => ({
    ...node,
    kind: node.kind === "assembly" || node.kind === "final" ? node.kind : "semiFinished",
    quantity: Number.isFinite(node.quantity) && Number(node.quantity) > 0 ? Number(node.quantity) : 1,
    x: Number.isFinite(node.x) ? Number(node.x) : 36,
    y: Number.isFinite(node.y) ? Number(node.y) : 36,
    operatorConfirmed: Boolean(node.operatorConfirmed),
  })) as RouteV2Node[];
  const ids = new Set(nodes.map(node => node.id));
  const edges = candidate.edges.filter(edge => edge && typeof edge === "object" && typeof edge.id === "string" && typeof edge.from === "string" && typeof edge.to === "string" && ids.has(edge.from) && ids.has(edge.to) && edge.from !== edge.to).map(edge => ({ id: edge.id, from: edge.from, to: edge.to })) as RouteV2Edge[];
  return { version: 1, nodes, edges, finalNodeId: typeof candidate.finalNodeId === "string" && ids.has(candidate.finalNodeId) ? candidate.finalNodeId : null };
}

export function routeV2SourceTitle(document: HarnessDesignDocument, ref: RouteSourceRef): string {
  return buildRouteSourceItems(document).find(item => sourceKey(item.ref) === sourceKey(ref))?.title ?? `${ref.kind}:${ref.id}`;
}
