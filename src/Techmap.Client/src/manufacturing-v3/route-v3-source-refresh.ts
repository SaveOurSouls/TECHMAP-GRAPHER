import { buildRouteV3SourceItems } from './route-v3-wire-terminals';
import { usedTerminationArtifactIds } from '../editor/termination-model';
import { routeV3EmbeddedArtifactOwners, routeV3WireEndArtifacts } from './route-v3-wire-terminals';
import type { HarnessDesignDocument, WireEndpoint } from "../editor/model";
import { type RouteSourceRef } from "../manufacturing/route-source";
import { editableRouteV3, refreshRouteV3 } from "./route-v3-graph";
import type { RouteV3Document } from "./route-v3-model";
import {routeV3TerminationOperationRefs} from './route-v3-operations';

export interface RouteV3SourceObject {
  readonly ref: RouteSourceRef;
  /** Electrical/physical terminal identity; presentation coordinates are excluded. */
  readonly attachment: string;
  readonly specification: string;
}
export interface RouteV3SourceState {
  readonly version: 1;
  readonly objects: readonly RouteV3SourceObject[];
  readonly presentation?: string;
  readonly harnessQuantity?: number;
}
export interface RouteV3SourceDivergence {
  readonly key: string;
  readonly ref: RouteSourceRef;
  readonly kind: "added" | "removed" | "attachment" | "specification";
  readonly previous: string | null;
  readonly current: string | null;
  readonly resolved?: boolean;
}
export interface RouteV3SourceRefreshPreview {
  readonly changed: boolean;
  readonly divergences: readonly RouteV3SourceDivergence[];
  readonly nextSourceState: RouteV3SourceState;
}
const refKey = (ref: RouteSourceRef) => `${ref.kind}:${ref.id}`;
const endpoint = (point: WireEndpoint): string => point.junctionId ? `junction:${point.junctionId}` : point.screenId ? `screen:${point.screenId}:${point.screenTerminalSide ?? ""}` : `contact:${point.connectorId}:${point.contactId}`;
const pair = (a: string, b: string): string => [a, b].sort().join(" ↔ ");
const stable = (value: unknown): string => JSON.stringify(value);
const materialIdentity = (binding: { readonly sourceId: string; readonly snapshotId: string; readonly recordId: string } | undefined): string => binding ? `${binding.sourceId}:${binding.snapshotId}:${binding.recordId}` : "";

/** Capture manufacturing identity, not drawing/E4 line geometry or viewport state. */
export function captureRouteV3SourceState(source: HarnessDesignDocument, harnessQuantity = 1): RouteV3SourceState {
  const items = buildRouteV3SourceItems(source);
  const byKey = new Map(items.map(item => [refKey(item.ref), item]));
  const nodes = new Map(source.physicalTopology?.segments.map(segment => [segment.id, segment]) ?? []);
  const physicalRoutes = new Map(source.physicalTopology?.routes.map(route => [route.wireId, route]) ?? []);
  const objects: RouteV3SourceObject[] = [];
  const embeddedArtifacts = routeV3EmbeddedArtifactOwners(source);
  for (const wire of source.wires) {
    const item = byKey.get(`wire:${wire.id}`)!;
    const physicalPath = physicalRoutes.get(wire.id)?.steps.flatMap((step, index) => {
      const segment = nodes.get(step.segmentId);
      if (!segment) return [`missing:${step.segmentId}`];
      const start = step.reverse ? segment.to : segment.from;
      const end = step.reverse ? segment.from : segment.to;
      return index ? [end] : [start, end];
    }) ?? [];
    const preparations=source.terminations?.endPreparations.filter(p=>p.wireId===wire.id).sort((a,b)=>a.end.localeCompare(b.end))??[];
    const groups=source.terminations?.groups.filter(g=>g.memberEnds.some(e=>e.wireId===wire.id)).map(g=>({id:g.id,target:g.target,artifactId:g.artifactId,memberEnds:[...g.memberEnds].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))})).sort((a,b)=>a.id.localeCompare(b.id))??[];
    const twists=source.terminations?.twists.filter(t=>t.memberWireIds.includes(wire.id)).sort((a,b)=>a.id.localeCompare(b.id))??[];
    const operations=source.terminations?.operations.filter(o=>{const t=o.target;return t.kind==='wireEnd'?t.wireId===wire.id:t.kind==='group'?groups.some(g=>g.id===t.groupId):t.kind==='twist'?twists.some(g=>g.id===t.twistId):[wire.from,wire.to].some(e=>e.connectorId===t.connectorId&&t.contactIds.includes(e.contactId));}).sort((a,b)=>a.id.localeCompare(b.id))??[];
    const endArtifacts = [...routeV3WireEndArtifacts(source,wire.id,'from'), ...routeV3WireEndArtifacts(source,wire.id,'to')];
    objects.push({ ref: item.ref, attachment: stable({ electrical: pair(endpoint(wire.from), endpoint(wire.to)), physicalPath, ...(groups.length?{groups}:{}), ...(twists.length?{twists}:{} ) }), specification: stable({ lengthMm: item.lengthMm, material: materialIdentity(wire.materialBinding), materialName: item.material, article: item.materialArticle, section: item.section, color: item.color, terminalFrom: item.terminalFrom, terminalTo: item.terminalTo, stripProfiles: wire.stripProfiles ?? null, ...(preparations.length?{preparations}:{}),...(operations.length?{operations}:{}), ...(endArtifacts.length?{endArtifacts}:{}) }) });
  }
  for (const cable of source.cables) {
    const item = byKey.get(`cable:${cable.id}`)!;
    objects.push({ ref: item.ref, attachment: [...cable.memberWireIds].sort().join("|"), specification: stable({ lengthMm: item.lengthMm, material: materialIdentity(cable.materialBinding), article: item.materialArticle, sheathStrip: cable.sheathStrip ?? null }) });
  }
  for (const covering of source.physicalTopology?.coverings ?? []) {
    const item = byKey.get(`covering:${covering.id}`)!;
    // Replacing a segment while retaining its physical endpoints must not invalidate the route.
    const attachment = covering.spans.map(span => {
      const segment = nodes.get(span.segmentId);
      return segment ? pair(segment.from, segment.to) : `missing:${span.segmentId}`;
    }).sort().join("|");
    objects.push({ ref: item.ref, attachment, specification: stable({ lengthMm: item.lengthMm, kind: covering.kind ?? null, material: materialIdentity(covering.material), name: covering.name }) });
  }
  for(const artifact of (source.terminations?.artifacts??[]).filter(a=>usedTerminationArtifactIds(source).has(a.id))) {
    const groups=source.terminations?.groups.filter(g=>g.artifactId===artifact.id).map(g=>({...g,memberEnds:[...g.memberEnds].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))})).sort((a,b)=>a.id.localeCompare(b.id))??[];
    const owners=source.connectors.filter(c=>c.terminationComponent?.artifactId===artifact.id);
    const operations=source.terminations?.operations.filter(o=>{const t=o.target;return t.kind==='group'?groups.some(g=>g.id===t.groupId):t.kind==='portSet'?owners.some(c=>c.id===t.connectorId):t.kind==='wireEnd'?groups.some(g=>g.memberEnds.some(e=>e.wireId===t.wireId&&e.end===t.end)):false;}).sort((a,b)=>a.id.localeCompare(b.id))??[];
    if (!embeddedArtifacts.has(artifact.id)) objects.push({ref:{kind:'termination-artifact',id:artifact.id},attachment:stable({groups,components:owners.map(c=>({id:c.id,component:c.terminationComponent})).sort((a,b)=>a.id.localeCompare(b.id))}),specification:stable({artifact,operations})});
  }
  for (const connector of source.connectors.filter(c=>!c.terminationComponent)) {
    const item = byKey.get(`connector:${connector.id}`)!;
    objects.push({ ref: item.ref, attachment: connector.id, specification: stable({ designation: connector.designation, partNumber: connector.partNumber }) });
  }
  return { version: 1, objects: objects.sort((a, b) => refKey(a.ref).localeCompare(refKey(b.ref))), presentation: stable({ wires: source.wires.map(w => [w.id, w.drawingRoute, w.e4Route]), physicalTopology: source.physicalTopology, drawingDocuments: source.drawingDocuments }), harnessQuantity };
}

export function validRouteV3SourceState(state: RouteV3SourceState): boolean {
  return !!state && state.version === 1 && (state.presentation === undefined || typeof state.presentation === "string") && (state.harnessQuantity === undefined || Number.isInteger(state.harnessQuantity) && state.harnessQuantity > 0) && Array.isArray(state.objects) && state.objects.length <= 100000 && state.objects.every(o => o && ["wire", "cable", "covering", "connector", "termination-artifact"].includes(o.ref?.kind) && typeof o.ref.id === "string" && !!o.ref.id && typeof o.attachment === "string" && typeof o.specification === "string") && new Set(state.objects.map(o => refKey(o.ref))).size === state.objects.length;
}
export function validRouteV3SourceDivergence(issue: RouteV3SourceDivergence): boolean {
  return !!issue && typeof issue.key === "string" && !!issue.key && ["wire", "cable", "covering", "connector", "termination-artifact"].includes(issue.ref?.kind) && typeof issue.ref.id === "string" && !!issue.ref.id && ["added", "removed", "attachment", "specification"].includes(issue.kind) && [issue.previous, issue.current].every(value => value === null || typeof value === "string") && (issue.resolved === undefined || typeof issue.resolved === "boolean");
}

/** The preview is read-only. Same-point rebinds may update presentation without a qualitative divergence. */
export function previewRouteV3SourceRefresh(route: RouteV3Document, source: HarnessDesignDocument, harnessQuantity = 1): RouteV3SourceRefreshPreview {
  const nextSourceState = captureRouteV3SourceState(source, harnessQuantity);
  // Older saved Route v3 drafts have no baseline; require an explicit first adoption.
  if (!route.sourceState) return { changed: true, divergences: [], nextSourceState };
  const old = new Map(route.sourceState.objects.map(object => [refKey(object.ref), object]));
  const next = new Map(nextSourceState.objects.map(object => [refKey(object.ref), object]));
  const divergences: RouteV3SourceDivergence[] = [];
  const add = (ref: RouteSourceRef, kind: RouteV3SourceDivergence["kind"], previous: string | null, current: string | null) => divergences.push({ key: `${refKey(ref)}:${kind}`, ref, kind, previous, current });
  for (const key of new Set([...old.keys(), ...next.keys()])) {
    const previous = old.get(key), current = next.get(key), ref = (current ?? previous)!.ref;
    if (!previous) add(ref, "added", null, current!.specification);
    else if (!current) add(ref, "removed", previous.specification, null);
    else {
      if (previous.attachment !== current.attachment) add(ref, "attachment", previous.attachment, current.attachment);
      if (previous.specification !== current.specification) add(ref, "specification", previous.specification, current.specification);
    }
  }
  const represented=new Set(route.nodes.flatMap(n=>(n.operations??[]).flatMap(o=>o.terminationOperationId?[o.terminationOperationId]:[])));
  for(const operation of source.terminations?.operations??[])if(!represented.has(operation.id)){
    const ref=routeV3TerminationOperationRefs(source,operation.id)[0];
    if(ref&&!divergences.some(d=>refKey(d.ref)===refKey(ref)&&d.kind==='specification'))add(ref,'specification','Операция отсутствует в маршруте',operation.recipe?.displayName??operation.kind);
  }
  for (const ref of route.preparedRefs.filter(ref=>ref.kind==='termination-artifact'&&source.terminations?.artifacts.some(a=>a.id===ref.id&&a.kind==='sleeve'))) {
    if (!divergences.some(d=>refKey(d.ref)===refKey(ref))) add(ref,'specification','Гильза выделена как подготовленный полуфабрикат','Гильза устанавливается отдельным этапом маршрута');
  }
  return { changed: divergences.length > 0 || route.sourceState.presentation !== nextSourceState.presentation || route.sourceState.harnessQuantity !== nextSourceState.harnessQuantity, divergences, nextSourceState };
}

/** Explicitly apply a reviewed source preview. Authored cards, drawings and edges stay intact. */
export function applyRouteV3SourceRefresh(route: RouteV3Document, preview: RouteV3SourceRefreshPreview): RouteV3Document {
  if (!validRouteV3SourceState(preview.nextSourceState)) throw new Error("Источник Маршрута v3 повреждён.");
  if (!preview.divergences.length) return { ...route, sourceState: preview.nextSourceState };
  const cableMembers = new Set(preview.nextSourceState.objects.filter(o => o.ref.kind === "cable").flatMap(o => o.attachment ? o.attachment.split("|") : []));
  const preparedRefs = preview.nextSourceState.objects.filter(o => o.ref.kind === 'termination-artifact' || o.ref.kind === "cable" || o.ref.kind === "covering" || o.ref.kind === "wire" && !cableMembers.has(o.ref.id)).map(o => o.ref);
  const priorResolved = new Set(route.sourceDivergences?.filter(issue => issue.resolved).map(issue => issue.key) ?? []);
  const editable = editableRouteV3(route);
  const next = { ...editable, preparedRefs, sourceState: preview.nextSourceState, sourceDivergences: preview.divergences.map(issue => priorResolved.has(issue.key) ? { ...issue, resolved: true } : issue), nodes: editable.nodes.map(node => node.id.startsWith("prepared:") ? { ...node, operatorConfirmed: false, rawRefs: node.id === 'prepared:termination-artifact' ? node.rawRefs : preparedRefs.filter(ref => `prepared:${ref.kind}` === node.id) } : node) };
  return refreshRouteV3(next);
}
export function resolveRouteV3SourceDivergence(route: RouteV3Document, key: string): RouteV3Document {
  if (!route.sourceDivergences?.some(issue => issue.key === key)) return route;
  return { ...route, sourceDivergences: route.sourceDivergences.map(issue => issue.key === key ? { ...issue, resolved: true } : issue) };
}
export const routeV3HasUnresolvedSourceChanges = (route: RouteV3Document): boolean => route.sourceDivergences?.some(issue => !issue.resolved) ?? false;
