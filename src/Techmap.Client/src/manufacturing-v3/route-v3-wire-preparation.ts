import type { HarnessDesignDocument } from "../editor/model";
import { effectiveEndPreparation } from "../editor/termination-model";
import type { WireBlank, WireBlankEnd } from "../WireBlankCatalog";
import { wirePreparationReady, type WirePreparationScheme } from "../WirePreparationCatalog";
import type { RouteV3Document, RouteV3Node } from "./route-v3-model";
import type { RouteSourceRef } from "../manufacturing/route-source";
import { routeV3Products } from "./route-v3-operations";
import { editableRouteV3, refreshRouteV3 } from "./route-v3-graph";
import { routeV3WireArtwork } from "./route-v3-wire-artwork";
import { routeV3WireEndArtifacts } from "./route-v3-wire-terminals";

export interface WirePreparationAssignment { readonly wireId: string; readonly schemeId: string | null }
export interface RouteV3WirePreparation {
  readonly assignments: readonly WirePreparationAssignment[];
  /** Pinned recipes keep the graph reproducible after catalog changes. */
  readonly schemes: readonly WirePreparationScheme[];
}
export function wirePreparationEnds(source: HarnessDesignDocument, wireId: string): { start: WireBlankEnd; end: WireBlankEnd } {
  const fallback = routeV3WireArtwork(source, wireId);
  const end = (side: "from" | "to"): WireBlankEnd => {
    const p = effectiveEndPreparation(source, { wireId, end: side });
    const artifact = routeV3WireEndArtifacts(source, wireId, side).find(a => a.kind === "terminal");
    if (p?.mode === "pin-sealed") return "sealed-pin";
    if (p?.mode === "socket-sealed") return "sealed";
    if (p?.mode === "lug" || artifact && !p?.mode.startsWith("pin") && !p?.mode.startsWith("socket")) return /female|socket/i.test(artifact?.symbolId ?? "") ? "lug-socket" : "lug-pin";
    if (p?.mode === "pin") return "terminal-pin";
    return (side === "from" ? fallback?.start : fallback?.end) ?? "cut";
  };
  return { start: end("from"), end: end("to") };
}
export function wirePreparationDefault(source: HarnessDesignDocument, wireId: string, blanks: readonly WireBlank[]): WireBlank | undefined {
  const { start, end } = wirePreparationEnds(source, wireId);
  // Orientation does not change the recipe; exact orientation wins if authored twice.
  return blanks.find(b => b.start === start && b.end === end) ?? blanks.find(b => b.start === end && b.end === start);
}
export function wirePreparationAssignments(route: RouteV3Document, source: HarnessDesignDocument, blanks: readonly WireBlank[]): WirePreparationAssignment[] {
  return route.preparedRefs.filter(ref => ref.kind === "wire").map(ref => route.wirePreparation?.assignments.find(a => a.wireId === ref.id)
    ?? { wireId: ref.id, schemeId: wirePreparationDefault(source, ref.id, blanks)?.defaultSchemeId ?? null });
}
export function validWirePreparation(plan: RouteV3WirePreparation): boolean {
  return !!plan && Array.isArray(plan.assignments) && Array.isArray(plan.schemes)
    && new Set(plan.assignments.map(a => a?.wireId)).size === plan.assignments.length
    && plan.assignments.every(a => a && typeof a.wireId === "string" && !!a.wireId.trim() && (a.schemeId === null || typeof a.schemeId === "string" && plan.schemes.some(s => s.id === a.schemeId)))
    && new Set(plan.schemes.map(s => s?.id)).size === plan.schemes.length
    && plan.schemes.every(s => s && typeof s.id === "string" && !!s.id.trim() && typeof s.name === "string" && !!s.name.trim() && typeof s.description === "string" && Array.isArray(s.operations) && wirePreparationReady(s));
}
const managed = (n: RouteV3Node) => n.id === "prepared:wire" || !!n.wirePreparationStage;

/** Builds independent stages with separate products per wire at every step. */
export function buildWirePreparationStages(plan: RouteV3WirePreparation, refs: readonly RouteSourceRef[]): { nodes: RouteV3Node[]; edges: RouteV3Document["edges"]; owners: Map<string, string> } {
  if (!validWirePreparation(plan)) throw new Error("Схемы заготовки повреждены или содержат незаполненные операции.");
  const groups = new Map<string | null, RouteSourceRef[]>();
  for (const ref of refs.filter(r => r.kind === "wire")) {
    const key = plan.assignments.find(a => a.wireId === ref.id)?.schemeId ?? null;
    groups.set(key, [...(groups.get(key) ?? []), ref]);
  }
  const nodes: RouteV3Node[] = [], edges: { id: string; from: string; to: string; refs: readonly RouteSourceRef[] }[] = [], owners = new Map<string, string>();
  let column = 0;
  for (const [key, group] of groups) {
    const scheme = plan.schemes.find(s => s.id === key);
    let previous: string | undefined;
    const steps = scheme?.operations ?? [null];
    steps.forEach((operation, step) => {
      const id = scheme ? `wire-preparation:${scheme.id}:${step}` : "prepared:wire";
      const node: RouteV3Node = {
        id, kind: "semiFinished", title: scheme ? `${scheme.name} · ${step + 1}/${steps.length}: ${operation!.title}` : "Провода · схема не назначена",
        fragmentIds: [], refs: group, rawRefs: previous ? [] : group, inputNodeIds: previous ? [previous] : [], x: 32 + column * 304, y: 32 + step * 328,
        ...(scheme ? { wirePreparationStage: { schemeId: scheme.id, step } } : {}),
      };
      const products = routeV3Products(node);
      nodes.push({ ...node, products, operations: operation ? [{ ...structuredClone(operation), id: `${id}:operation`, outputProductIds: products.map(p => p.id) }] : [] });
      if (previous) edges.push({ id: `edge:${previous}:${id}`, from: previous, to: id, refs: group });
      previous = id;
    });
    for (const ref of group) owners.set(ref.id, previous!);
    column++;
  }
  return { nodes, edges, owners };
}

/** Replaces only generated wire stages, reconnecting each selected downstream wire.
 * The caller confirms replacement of authored data on the stages being replaced. */
export function applyWirePreparation(route: RouteV3Document, assignments: readonly WirePreparationAssignment[], schemes: readonly WirePreparationScheme[], preserveStageEdits = false): RouteV3Document {
  const ids = new Set(assignments.map(a => a.schemeId).filter(Boolean));
  const plan: RouteV3WirePreparation = { assignments, schemes: structuredClone(schemes.filter(s => ids.has(s.id))) };
  const stages = buildWirePreparationStages(plan, route.preparedRefs);
  const prior = editableRouteV3(route);
  const coveredEndOperation = (node: RouteV3Node) => {
    const target = node.operations?.[0]?.terminationOperationSnapshot?.target;
    return node.id.startsWith("termination-operation:") && node.operations?.length === 1 && target?.kind === "wireEnd"
      && assignments.some(a => a.wireId === target.wireId && a.schemeId !== null);
  };
  const removed = new Set(prior.nodes.filter(n => managed(n) || coveredEndOperation(n)).map(n => n.id));
  const nodes = prior.nodes.filter(n => !removed.has(n.id));
  const edges = prior.edges.filter(e => !removed.has(e.from) && !removed.has(e.to));
  const selectedInputs = new Map(nodes.map(n => [n.id, new Set((n.inputNodeIds ?? []).filter(id => !removed.has(id)))]));
  for (const edge of prior.edges.filter(e => removed.has(e.from) && !removed.has(e.to))) {
    const old = prior.nodes.find(n => n.id === edge.from)!;
    const to = prior.nodes.find(n => n.id === edge.to)!;
    const selected = !to.inputNodeIds || to.inputNodeIds.includes(edge.from);
    const groups = new Map<string, RouteSourceRef[]>();
    for (const ref of edge.refs ?? old.refs) {
      const from = stages.owners.get(ref.id);
      if (from) groups.set(from, [...(groups.get(from) ?? []), ref]);
    }
    for (const [from, refs] of groups) {
      const existing = edges.find(e => e.from === from && e.to === edge.to);
      if (existing) { const i = edges.indexOf(existing); edges[i] = { ...existing, refs: [...new Map([...(existing.refs ?? []), ...refs].map(r => [r.id, r])).values()] }; }
      else edges.push({ id: `edge:${from}:${edge.to}`, from, to: edge.to, refs });
      if (selected) selectedInputs.get(edge.to)!.add(from);
    }
  }
  const previousById = new Map(prior.nodes.map(n => [n.id, n]));
  let staged = stages.nodes.map(n => {
    const old = previousById.get(n.id);
    return old ? { ...n, x: old.x, y: old.y, width: old.width, height: old.height, quantity: old.quantity, drawing: old.drawing, ...(preserveStageEdits ? { operations: old.operations } : {}) } : n;
  });
  // A formerly single group may occupy the first new group's default column.
  // Place whole chains in free columns, respecting saved card dimensions.
  const occupied: RouteV3Node[] = [...nodes];
  const chains = new Map<string, RouteV3Node[]>();
  for (const node of staged) {
    const key = node.wirePreparationStage?.schemeId ?? "unassigned";
    chains.set(key, [...(chains.get(key) ?? []), node]);
  }
  staged = [];
  for (const chain of chains.values()) {
    let x = chain[0]!.x;
    let bottom = chain[0]!.y;
    const aligned = chain.map(node => {
      const y = Math.max(node.y, bottom);
      bottom = y + (node.height ?? 264) + 64;
      return { ...node, y };
    });
    // Reserve the entire column, including gaps between steps: a shorter
    // neighbouring scheme must never appear to continue this chain.
    const width = Math.max(...aligned.map(n => n.width ?? 280));
    const blockers = () => occupied.filter(n => x < n.x + (n.width ?? 280) + 24 && x + width + 24 > n.x);
    while (blockers().length) x = Math.max(...blockers().map(n => n.x + (n.width ?? 280) + 24));
    const placedChain = aligned.map(node => ({ ...node, x }));
    staged.push(...placedChain); occupied.push(...placedChain);
  }
  // Move downstream cards only as far as needed to leave space for the new chain.
  const remaining = nodes.map(n => ({ ...n, inputNodeIds: [...selectedInputs.get(n.id)!] }));
  const allEdges = [...edges, ...stages.edges];
  const placed = new Map([...staged, ...remaining].map(n => [n.id, n]));
  const done = new Set<string>();
  const visit = (id: string, seen = new Set<string>()) => {
    if (done.has(id)) return;
    if (seen.has(id)) throw new Error("Связь создаёт цикл зависимостей.");
    const node = placed.get(id)!;
    seen.add(id);
    const parents = allEdges.filter(e => e.to === id).map(e => { visit(e.from, new Set(seen)); return placed.get(e.from)!; });
    if (parents.length) placed.set(id, { ...node, y: Math.max(node.y, ...parents.map(p => p.y + (p.height ?? 264) + 64)) });
    done.add(id);
  };
  for (const node of remaining) visit(node.id);
  return refreshRouteV3({ ...route, wirePreparation: plan, graphEdited: true, nodes: [...placed.values()], edges: allEdges });
}
