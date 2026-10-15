import { buildRouteV3SourceItems } from './route-v3-wire-terminals';
import type { HarnessDesignDocument } from "../editor/model";
import type { EditorSceneObject } from "../editor/editor-types";
import { type RouteSourceRef } from "../manufacturing/route-source";
import { createRouteDrawingCopy, parseRouteDrawingCopy, type RouteDrawingCopy } from "../manufacturing/route-drawing-copy";
import type { RouteV3Operation } from "./route-v3-operations";
import { validRouteV3Operation } from "./route-v3-operations";
import { routeV3TerminationOperationRefs } from './route-v3-operations';
import { captureRouteV3SourceState, validRouteV3SourceState, validRouteV3SourceDivergence, type RouteV3SourceState, type RouteV3SourceDivergence } from "./route-v3-source-refresh";
import type { RouteV2Drawing } from "../manufacturing-v2/route-v2-model";
import { routeV3EmbeddedArtifactOwners } from './route-v3-wire-terminals';
import { adoptRouteV3WireTerminals } from './route-v3-wire-terminals-adoption';

export const ROUTE_V3_NODE_DEFAULT_WIDTH = 280;
export const ROUTE_V3_NODE_DEFAULT_HEIGHT = 264;
export const ROUTE_V3_NODE_MIN_WIDTH = 220;
export const ROUTE_V3_NODE_MIN_HEIGHT = 170;
export const ROUTE_V3_NODE_MAX_WIDTH = 720;
export const ROUTE_V3_NODE_MAX_HEIGHT = 720;
export const ROUTE_V3_CARD_GAP = 24;
export const ROUTE_V3_LAYOUT_MIN_X = 12;
export const ROUTE_V3_SIZE_SNAP_DISTANCE = 12;

export interface RouteV3Fragment {
  readonly id: string;
  readonly title: string;
  readonly mode: "source" | "isolated";
  readonly refs: readonly RouteSourceRef[];
  /** Source scene IDs, independent of edits to the isolated drawing. */
  readonly objectIds: readonly string[];
  readonly backgroundOpacity: number;
  readonly drawingCopy: RouteDrawingCopy;
  readonly isolatedDrawingCopy?: RouteDrawingCopy;
  readonly createdAt: string;
}
export interface RouteV3Node {
  readonly id: string;
  readonly kind: "semiFinished" | "assembly" | "final";
  readonly title: string;
  readonly fragmentIds: readonly string[];
  readonly refs: readonly RouteSourceRef[];
  readonly x: number;
  readonly y: number;
  readonly width?: number;
  readonly height?: number;
  readonly quantity?: number;
  readonly inputNodeIds?: readonly string[];
  readonly operations?: readonly RouteV3Operation[];
  readonly operatorConfirmed?: boolean;
  readonly rawRefs?: readonly RouteSourceRef[];
  /** Stable production products exposed by this card. Cut cards have one per ref; assemblies have one. */
  readonly products?: readonly RouteV3Product[];
  readonly drawing?: RouteV2Drawing;
}
export interface RouteV3Product {
  readonly id: string;
  readonly nodeId: string;
  readonly kind: "source" | "assembly";
  readonly ref?: RouteSourceRef;
}
export interface RouteV3WireArtworkOverride {
  readonly wireId: string;
  readonly color?: string;
  readonly start?: import("../WireBlankCatalog").WireBlankEnd;
  readonly end?: import("../WireBlankCatalog").WireBlankEnd;
}
export interface RouteV3Document {
  readonly version: 1;
  readonly preparedRefs: readonly RouteSourceRef[];
  readonly fragments: readonly RouteV3Fragment[];
  readonly nodes: readonly RouteV3Node[];
  readonly edges: readonly { id: string; from: string; to: string; refs?: readonly RouteSourceRef[] }[];
  readonly generated: boolean;
  readonly backgroundOpacity: number;
  readonly graphEdited?: boolean;
  readonly sourceState?: RouteV3SourceState;
  readonly sourceDivergences?: readonly RouteV3SourceDivergence[];
  /** Sparse V3-only overrides. Missing entry always follows the current E4 model. */
  readonly wireArtwork?: readonly RouteV3WireArtworkOverride[];
}
export const refKey = (ref: RouteSourceRef): string => `${ref.kind}:${ref.id}`;
export const routeV3StorageKey = (projectId: string, harnessId: string): string => `techmap.route-v3.${projectId}.${harnessId}`;
export const fragmentDrawingCopy = (fragment: RouteV3Fragment): RouteDrawingCopy => fragment.isolatedDrawingCopy ?? fragment.drawingCopy;
const clampSize = (value: unknown, fallback: number, min: number, max: number): number => typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
export function routeV3NodeSize(node: Pick<RouteV3Node, "width" | "height">): { width: number; height: number } {
  return { width: clampSize(node.width, ROUTE_V3_NODE_DEFAULT_WIDTH, ROUTE_V3_NODE_MIN_WIDTH, ROUTE_V3_NODE_MAX_WIDTH), height: clampSize(node.height, ROUTE_V3_NODE_DEFAULT_HEIGHT, ROUTE_V3_NODE_MIN_HEIGHT, ROUTE_V3_NODE_MAX_HEIGHT) };
}
export function routeV3ResizeNodeSize(width: number, height: number): { width: number; height: number } {
  return { width: clampSize(width, ROUTE_V3_NODE_DEFAULT_WIDTH, ROUTE_V3_NODE_MIN_WIDTH, ROUTE_V3_NODE_MAX_WIDTH), height: clampSize(height, ROUTE_V3_NODE_DEFAULT_HEIGHT, ROUTE_V3_NODE_MIN_HEIGHT, ROUTE_V3_NODE_MAX_HEIGHT) };
}
export interface RouteV3ResizeLayout {
  readonly nodes: readonly RouteV3Node[];
  readonly size: { readonly width: number; readonly height: number };
  readonly snapped: { readonly width: boolean; readonly height: boolean };
}

const intersects = (a: RouteV3Node, b: RouteV3Node): boolean => {
  const as = routeV3NodeSize(a), bs = routeV3NodeSize(b);
  return a.x < b.x + bs.width && a.x + as.width > b.x && a.y < b.y + bs.height && a.y + as.height > b.y;
};

/** Resize from the bottom-right corner and keep the surrounding board readable.
 * Colliding cards move sideways with a gap; each such move can cascade into its
 * own neighbours. The board has a fixed left edge and grows to the right. */
export function routeV3ResizeLayout(nodes: readonly RouteV3Node[], id: string, width: number, height: number): RouteV3ResizeLayout {
  const resized = nodes.find(node => node.id === id);
  if (!resized) return { nodes, size: routeV3ResizeNodeSize(width, height), snapped: { width: false, height: false } };
  const requested = routeV3ResizeNodeSize(width, height);
  const nearest = (value: number, dimension: "width" | "height") => nodes.filter(node => node.id !== id).map(node => routeV3NodeSize(node)[dimension]).filter(candidate => Math.abs(candidate - value) <= ROUTE_V3_SIZE_SNAP_DISTANCE).sort((a, b) => Math.abs(a - value) - Math.abs(b - value))[0];
  const snappedWidth = nearest(requested.width, "width"), snappedHeight = nearest(requested.height, "height");
  const size = { width: snappedWidth ?? requested.width, height: snappedHeight ?? requested.height };
  const next = nodes.map(node => node.id === id ? { ...node, ...size } : node);
  const byId = new Map(next.map(node => [node.id, node]));
  const pending = [id];
  const moved = new Set<string>();
  while (pending.length) {
    const sourceId = pending.shift()!;
    const source = byId.get(sourceId)!;
    for (const candidate of [...byId.values()]) {
      if (candidate.id === sourceId || !intersects(source, candidate)) continue;
      const sourceSize = routeV3NodeSize(source), candidateSize = routeV3NodeSize(candidate);
      const candidateIsLeft = candidate.x + candidateSize.width / 2 < source.x + sourceSize.width / 2;
      const leftX = source.x - candidateSize.width - ROUTE_V3_CARD_GAP;
      const x = candidateIsLeft && leftX >= ROUTE_V3_LAYOUT_MIN_X ? leftX : source.x + sourceSize.width + ROUTE_V3_CARD_GAP;
      if (candidate.x === x || moved.has(`${sourceId}:${candidate.id}:${x}`)) continue;
      const shifted = { ...candidate, x };
      byId.set(candidate.id, shifted);
      moved.add(`${sourceId}:${candidate.id}:${x}`);
      pending.push(candidate.id);
    }
  }
  return { nodes: next.map(node => byId.get(node.id)!), size, snapped: { width: snappedWidth !== undefined, height: snappedHeight !== undefined } };
}
export function routeV3ConnectionPort(node: Pick<RouteV3Node, "x" | "y" | "width" | "height">, side: "top" | "bottom"): { x: number; y: number } {
  const size = routeV3NodeSize(node); return { x: node.x + size.width / 2, y: node.y + (side === "top" ? 0 : size.height) };
}
export const routeV3NodeQuantity = (node: Pick<RouteV3Node, "quantity">): number => typeof node.quantity === "number" && Number.isFinite(node.quantity) && node.quantity > 0 ? node.quantity : 1;
export const routeV3NodeOperations = (node: Pick<RouteV3Node, "operations">): readonly RouteV3Operation[] => node.operations ?? [];

export function createInitialRouteV3(source: HarnessDesignDocument, harnessQuantity = 1): RouteV3Document {
  const initial:RouteV3Document={ version: 1, preparedRefs: buildRouteV3SourceItems(source).filter(item => item.ref.kind === 'termination-artifact' || item.ref.kind === "covering" || item.ref.kind === "cable" || item.ref.kind === "wire" && !item.cableId).map(item => item.ref), fragments: [], nodes: [], edges: [], generated: false, backgroundOpacity: .2, sourceState: captureRouteV3SourceState(source, harnessQuantity) };
  const prepared = adoptRouteV3WireTerminals(initial,source);
  return source.terminations?.operations.length?generateRouteV3(prepared,source):prepared;
}
export function routeV3WireArtworkOverride(document: RouteV3Document, wireId: string): RouteV3WireArtworkOverride | undefined { return document.wireArtwork?.find(value => value.wireId === wireId); }
export function setRouteV3WireArtworkOverride(document: RouteV3Document, override: RouteV3WireArtworkOverride): RouteV3Document {
  const current = document.wireArtwork ?? [];
  return { ...document, wireArtwork: [...current.filter(value => value.wireId !== override.wireId), override] };
}
export function resetRouteV3WireArtwork(document: RouteV3Document, wireIds: readonly string[]): RouteV3Document {
  const ids = new Set(wireIds), current = document.wireArtwork?.filter(value => !ids.has(value.wireId)) ?? [];
  return { ...document, ...(current.length ? { wireArtwork: current } : { wireArtwork: undefined }) };
}
export function appendRouteV3Fragment(document: RouteV3Document, fragment: RouteV3Fragment): RouteV3Document {
  if (!fragment.objectIds.length) throw new Error("Выберите объекты для слепка.");
  const exists = document.fragments.some(item => item.id === fragment.id);
  return { ...document, fragments: exists ? document.fragments.map(item => item.id === fragment.id ? fragment : item) : [...document.fragments, fragment], generated: false, nodes: document.graphEdited ? document.nodes : [], edges: document.graphEdited ? document.edges : [] };
}
export function removeRouteV3Fragment(document: RouteV3Document, id: string): RouteV3Document {
  return { ...document, fragments: document.fragments.filter(item => item.id !== id), nodes: document.graphEdited ? document.nodes.map(n => ({ ...n, fragmentIds: n.fragmentIds.filter(f => f !== id) })) : [], edges: document.graphEdited ? document.edges : [], generated: false };
}
export function revealedRouteV3Ids(document: RouteV3Document): string[] {
  return [...new Set(document.fragments.flatMap(fragment => fragment.objectIds))];
}

/** Resolve only explicitly selected physical objects, never merely highlighted ones. */
export function captureRouteV3Selection(source: HarnessDesignDocument, scene: readonly EditorSceneObject[], selected: readonly string[]) {
  const ids = new Set(selected.filter(id => scene.some(object => object.id === id)));
  for (const object of scene) {
    if (!ids.has(object.id)) continue;
    if (object.metadata?.indexObjectId) ids.add(object.metadata.indexObjectId);
    if (object.kind === "physical-segment") for (const wireId of object.pipe?.wireIds ?? []) ids.add(wireId);
  }
  // Index labels are part of the same visual object and must follow its visibility.
  for (const object of scene) if (object.metadata?.indexObjectId && ids.has(object.metadata.indexObjectId)) ids.add(object.id);
  const embeddedOwners = routeV3EmbeddedArtifactOwners(source);
  const terminalWireIds = new Set(source.connectors.filter(c=>ids.has(c.id)&&c.terminationComponent?.artifactId).flatMap(c=>embeddedOwners.get(c.terminationComponent!.artifactId!)??[]));
  const refs = buildRouteV3SourceItems(source).filter(item => ids.has(item.ref.id) || item.ref.kind==='wire'&&terminalWireIds.has(item.ref.id) || item.ref.kind==='termination-artifact'&&source.connectors.some(c=>ids.has(c.id)&&c.terminationComponent?.artifactId===item.ref.id) || item.ref.kind === "cable" && source.cables.find(cable => cable.id === item.ref.id)?.memberWireIds.some(wireId => ids.has(wireId))).map(item => item.ref);
  return { objectIds: [...ids], refs, drawingCopy: createRouteDrawingCopy(source, scene.filter(object => !ids.has(object.id)).map(object => object.id)) };
}

/** Every selected source object depends on its latest earlier saved state. */
export function generateRouteV3(document: RouteV3Document, source?: HarnessDesignDocument, _sceneIds: readonly string[] = []): RouteV3Document {
  if (source) document = adoptRouteV3WireTerminals(document, source);
  const nodes: RouteV3Node[] = [];
  const edges: { id: string; from: string; to: string }[] = [];
  const owner = new Map<string, string>();
  const depths = new Map<string, number>();
  const rows = new Map<number, number>();
  const addNode = (node: Omit<RouteV3Node, "x" | "y">, parents: readonly string[]) => {
    const depth = parents.length ? 1 + Math.max(...parents.map(id => depths.get(id) ?? 0)) : 0;
    const column = rows.get(depth) ?? 0;
    nodes.push({ ...node, x: 32 + column * 304, y: 32 + depth * 328 });
    rows.set(depth, column + 1); depths.set(node.id, depth);
    for (const from of parents) edges.push({ id: `edge:${from}:${node.id}`, from, to: node.id });
  };
  for (const kind of ["wire", "cable", "covering",'termination-artifact'] as const) {
    const refs = document.preparedRefs.filter(ref => ref.kind === kind && !(source && ref.kind === 'termination-artifact' && source.terminations?.artifacts.some(a=>a.id===ref.id&&a.kind==='sleeve')));
    if (!refs.length) continue;
    const id = `prepared:${kind}`;
    addNode({ id, kind: "semiFinished", title: kind === 'termination-artifact'?'Оконцовки и уплотнители':kind === "wire" ? "Нарезанные провода" : kind === "covering" ? "Нарезанные оболочки" : "Нарезанные кабели", refs, fragmentIds: [] }, []);
    for (const ref of refs) owner.set(refKey(ref), id);
  }
  if(source){
    const done=new Set<string>();
    const labels={strip:'Зачистка',tin:'Лужение',crimp:'Общий обжим','ultrasonic-weld':'УЗ сварка на гильзе',twist:'Свивка'};
    const addOperation=(id:string)=>{
      if(done.has(id))return;const o=source.terminations?.operations.find(o=>o.id===id);if(!o)return;
      for(const dep of o.dependsOn??[])addOperation(dep);done.add(id);
      const refs=routeV3TerminationOperationRefs(source,id),parents=[...new Set([...refs.map(r=>owner.get(refKey(r))).filter((id):id is string=>!!id),...(o.dependsOn??[]).map(id=>'termination-operation:'+id)])];
      const sleeveCrimp = o.kind === 'crimp' && refs.some(r=>r.kind==='termination-artifact'&&source.terminations?.artifacts.some(a=>a.id===r.id&&a.kind==='sleeve'));
      const operation:RouteV3Operation={id:'termination:'+o.id,terminationOperationId:o.id,terminationOperationSnapshot:structuredClone(o),title:o.recipe?.displayName||(sleeveCrimp?'Опрессовка гильзы':labels[o.kind]),kind:'static',lengthMm:0,speedMmPerMinute:1,employees:1,quantity:1,minutesEach:0};
      const nodeId='termination-operation:'+id;
      addNode({id:nodeId,kind:'assembly',title:operation.title,refs,fragmentIds:[],operations:[operation]},parents);
      for(const ref of refs)owner.set(refKey(ref),nodeId);
    };
    for(const o of source.terminations?.operations??[])addOperation(o.id);
    for (const artifact of source.terminations?.artifacts.filter(a=>a.kind==='sleeve')??[]) {
      if (owner.has(`termination-artifact:${artifact.id}`) || !buildRouteV3SourceItems(source).some(i=>i.ref.kind==='termination-artifact'&&i.ref.id===artifact.id)) continue;
      const connectorIds = new Set(source.connectors.filter(c=>c.terminationComponent?.artifactId===artifact.id).map(c=>c.id));
      const wireIds = new Set([...(source.terminations?.groups.filter(g=>g.artifactId===artifact.id).flatMap(g=>g.memberEnds.map(e=>e.wireId))??[]),...source.wires.filter(w=>[w.from,w.to].some(e=>connectorIds.has(e.connectorId))).map(w=>w.id)]);
      const refs: RouteSourceRef[] = [...[...wireIds].map(id=>({kind:'wire' as const,id})),{kind:'termination-artifact',id:artifact.id}];
      const parents = [...new Set(refs.map(ref=>owner.get(refKey(ref))).filter((id):id is string=>!!id))];
      const nodeId = `sleeve-assembly:${artifact.id}`;
      addNode({id:nodeId,kind:'assembly',title:`Установка гильзы${artifact.article?' '+artifact.article:''}`,refs,fragmentIds:[]},parents);
      for(const ref of refs)owner.set(refKey(ref),nodeId);
    }
  }
  for (const fragment of document.fragments) {
    const parents = new Set(fragment.refs.map(ref => owner.get(refKey(ref))).filter((id): id is string => !!id));
    // A PF is indivisible. Partial reuse would falsely claim its complete assembly.
    const keys = new Set(fragment.refs.map(refKey));
    for (const parent of parents) {
      const prior = nodes.find(node => node.id === parent)!;
      if (prior.fragmentIds.length && prior.refs.some(ref => !keys.has(refKey(ref)))) throw new Error(`«${fragment.title}» использует часть полуфабриката «${prior.title}». Включите его полный состав в слепок.`);
    }
    const nodeId = `fragment:${fragment.id}`;
    addNode({ id: nodeId, kind: parents.size ? "assembly" : "semiFinished", title: fragment.title, refs: fragment.refs, fragmentIds: [fragment.id] }, [...parents]);
    for (const ref of fragment.refs) owner.set(refKey(ref), nodeId);
  }
  // No fictitious completed harness when some material is still unrepresented.
  const allRefs = source ? buildRouteV3SourceItems(source).map(item => item.ref) : [];
  const captured = new Set(document.fragments.flatMap(fragment => fragment.refs.map(refKey)));
  // Scene projections also contain derived labels, dimensions and topology
  // helpers. They are not production inputs, so they must not prevent the
  // final route once every addressable source ref is represented.
  if (allRefs.length && allRefs.every(ref => captured.has(refKey(ref)))) {
    const leaves = nodes.filter(node => node.fragmentIds.length && !edges.some(edge => edge.from === node.id)).map(node => node.id);
    addNode({ id: "route-v3:final", kind: "final", title: "Готовый жгут", refs: allRefs, fragmentIds: [] }, leaves);
  }
  return { ...document, nodes, edges, generated: true, ...(document.graphEdited !== undefined ? { graphEdited: false } : {}) };
}

/** Called only after explicit source adoption; retain authored layout and cards. */
export function syncRouteV3TerminationOperations(document:RouteV3Document,source:HarnessDesignDocument):RouteV3Document {
  document = adoptRouteV3WireTerminals(document, source);
  const generated=generateRouteV3(createInitialRouteV3(source),source);
  const canonical=generated.nodes.filter(n=>n.id.startsWith('termination-operation:')||n.id.startsWith('sleeve-assembly:'));
  const requiredParents=new Set(generated.edges.filter(e=>canonical.some(n=>n.id===e.to)).map(e=>e.from));
  const sourceIds=new Set(source.terminations?.operations.map(o=>o.id)??[]);
  const nodes:RouteV3Node[]=document.nodes.map(n=>({...n,operations:n.operations?.filter(o=>!o.terminationOperationId||sourceIds.has(o.terminationOperationId))}));
  for(const candidate of generated.nodes.filter(n=>canonical.includes(n)||requiredParents.has(n.id))){
    const index=nodes.findIndex(n=>n.id===candidate.id);
    if(index<0)nodes.push({...candidate,rawRefs:candidate.refs,operatorConfirmed:false});
    else if(candidate.id.startsWith('termination-operation:')||candidate.id.startsWith('sleeve-assembly:')){
      const current=nodes[index]!;
      const canonicalOperations=(candidate.operations??[]).map(o=>{
        const previous=current.operations?.find(p=>p.terminationOperationId===o.terminationOperationId||p.id===o.id);
        return previous?.catalogBinding?{...previous,id:o.id,terminationOperationId:o.terminationOperationId,terminationOperationSnapshot:o.terminationOperationSnapshot}:o;
      });
      const canonicalIds=new Set(canonicalOperations.map(o=>o.id));
      nodes[index]={...current,refs:candidate.refs,rawRefs:candidate.refs,operatorConfirmed:false,operations:[...(current.operations??[]).filter(o=>!o.terminationOperationId&&!canonicalIds.has(o.id)),...canonicalOperations]};
    }
  }
  const edges=[...document.edges];
  for(const edge of generated.edges.filter(e=>canonical.some(n=>n.id===e.to)))if(nodes.some(n=>n.id===edge.from)&&!edges.some(e=>e.from===edge.from&&e.to===edge.to))edges.push({...edge,refs:nodes.find(n=>n.id===edge.to)!.refs.filter(r=>nodes.find(n=>n.id===edge.from)!.refs.some(v=>refKey(v)===refKey(r)))});
  return {...document,nodes,edges};
}

/** Reject the whole draft instead of silently dropping damaged snapshots. */
export function parseRouteV3(value: unknown): RouteV3Document | null {
  try {
    const v = value as RouteV3Document;
    if (!v || v.version !== 1 || !Array.isArray(v.fragments) || v.fragments.length > 500 || !Array.isArray(v.preparedRefs) || !Array.isArray(v.nodes) || !Array.isArray(v.edges) || typeof v.generated !== "boolean") return null;
    if (v.graphEdited !== undefined && typeof v.graphEdited !== "boolean") return null;
    const opacity = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1;
    const text = (n: unknown): n is string => typeof n === "string" && n.trim().length > 0 && n.length <= 512;
    const refs = (items: readonly RouteSourceRef[]) => Array.isArray(items) && items.every(ref => ref && ["wire", "cable", "covering", "connector", "termination-artifact"].includes(ref.kind) && text(ref.id)) && new Set(items.map(refKey)).size === items.length;
    if (!opacity(v.backgroundOpacity) || !refs(v.preparedRefs)) return null;
    if (v.wireArtwork !== undefined && (!Array.isArray(v.wireArtwork) || v.wireArtwork.some(value => !value || !text(value.wireId) || (value.color !== undefined && !/^#[0-9a-f]{6}$/i.test(value.color)) || (value.start !== undefined && !["cut", "copper", "tin", "terminal", "sealed", "sealed-pin"].includes(value.start)) || (value.end !== undefined && !["cut", "copper", "tin", "terminal", "sealed", "sealed-pin"].includes(value.end))) || new Set(v.wireArtwork.map(value => value.wireId)).size !== v.wireArtwork.length)) return null;
    const ids = new Set<string>();
    const fragments: RouteV3Fragment[] = [];
    for (const f of v.fragments) {
      if (!f || !text(f.id) || ids.has(f.id) || !text(f.title) || !["source", "isolated"].includes(f.mode) || !refs(f.refs) || !Array.isArray(f.objectIds) || !f.objectIds.length || f.objectIds.some((id: unknown) => !text(id)) || !opacity(f.backgroundOpacity) || !text(f.createdAt)) return null;
      const drawingCopy = parseRouteDrawingCopy(f.drawingCopy);
      const isolatedDrawingCopy = f.isolatedDrawingCopy === undefined ? undefined : parseRouteDrawingCopy(f.isolatedDrawingCopy);
      if (f.mode === "isolated" && !isolatedDrawingCopy) return null;
      fragments.push({ ...f, objectIds: [...new Set(f.objectIds)], drawingCopy, ...(isolatedDrawingCopy ? { isolatedDrawingCopy } : {}) }); ids.add(f.id);
    }
    const nodeIds = new Set<string>();
    for (const node of v.nodes) {
      if (!node || !text(node.id) || nodeIds.has(node.id) || !text(node.title) || !["semiFinished", "assembly", "final"].includes(node.kind) || !refs(node.refs) || !Number.isFinite(node.x) || !Number.isFinite(node.y) || !Array.isArray(node.fragmentIds) || node.fragmentIds.some((id: unknown) => !ids.has(String(id)))) return null;
      nodeIds.add(node.id);
      if (node.rawRefs !== undefined && !refs(node.rawRefs)) return null;
      if (node.products !== undefined && (!Array.isArray(node.products) || new Set(node.products.map((product: RouteV3Product) => product?.id)).size !== node.products.length || node.products.some((product: RouteV3Product) => !product || !text(product.id) || product.nodeId !== node.id || !["source", "assembly"].includes(product.kind) || product.kind === "source" && (!product.ref || !refs([product.ref])) || product.kind === "assembly" && product.ref !== undefined))) return null;
      if (node.operatorConfirmed !== undefined && typeof node.operatorConfirmed !== "boolean") return null;
      if (node.drawing) { if (!opacity(node.drawing.backgroundOpacity)) return null; if (node.drawing.drawingCopy) parseRouteDrawingCopy(node.drawing.drawingCopy); if (node.drawing.isolatedDrawingCopy) parseRouteDrawingCopy(node.drawing.isolatedDrawingCopy); }
      if ([node.width, node.height, node.quantity].some(n => n !== undefined && (typeof n !== "number" || !Number.isFinite(n) || n <= 0))) return null;
      if (node.inputNodeIds !== undefined && (!Array.isArray(node.inputNodeIds) || node.inputNodeIds.some((id: unknown) => !text(id)))) return null;
      // Output IDs may refer to a source removed in a later drawing revision.
      // Keep that assignment in the draft for divergence review; runtime views
      // only use IDs still present in routeV3Products(node).
      if (node.operations !== undefined && (!Array.isArray(node.operations) || node.operations.some((op: RouteV3Operation) => !validRouteV3Operation(op)))) return null;
    }
    const visited = new Set<string>(), visiting = new Set<string>(), edgeIds = new Set<string>();
    for (const edge of v.edges) { if (!edge || !text(edge.id) || edgeIds.has(edge.id) || !nodeIds.has(edge.from) || !nodeIds.has(edge.to) || edge.from === edge.to || edge.refs !== undefined && !refs(edge.refs)) return null; edgeIds.add(edge.id); }
    const visit = (id: string): boolean => { if (visiting.has(id)) return false; if (visited.has(id)) return true; visiting.add(id); if (v.edges.filter(e => e.from === id).some(e => !visit(e.to))) return false; visiting.delete(id); visited.add(id); return true; };
    if ([...nodeIds].some(id => !visit(id))) return null;
    if (v.sourceState !== undefined && !validRouteV3SourceState(v.sourceState)) return null;
    if (v.sourceDivergences !== undefined && (!Array.isArray(v.sourceDivergences) || v.sourceDivergences.some(issue => !validRouteV3SourceDivergence(issue)))) return null;
    return { ...v, fragments };
  } catch { return null; }
}

export type { RouteV3Operation } from "./route-v3-operations";
export { routeV3OperationFromCatalog, routeV3OperationMinutes, routeV3OperationTimes, routeV3BatchQuantity, routeV3SourceQuantity, routeV3SourceGroupKey, routeV3GroupedSourceQuantity, routeV3IsCutCard, routeV3Products, routeV3AssignedProductIds, assignRouteV3OperationProducts, routeV3OperationProjectTimes } from "./route-v3-operations";
export type { RouteV3SourceState, RouteV3SourceDivergence, RouteV3SourceRefreshPreview } from "./route-v3-source-refresh";
export { previewRouteV3SourceRefresh, applyRouteV3SourceRefresh, resolveRouteV3SourceDivergence, routeV3HasUnresolvedSourceChanges, captureRouteV3SourceState } from "./route-v3-source-refresh";
