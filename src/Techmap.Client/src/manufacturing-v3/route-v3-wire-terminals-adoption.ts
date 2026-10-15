import type { HarnessDesignDocument } from '../editor/model';
import type { RouteSourceRef } from '../manufacturing/route-source';
import type { RouteV3Document, RouteV3Node } from './route-v3-model';
import { routeV3EmbeddedArtifactOwners } from './route-v3-wire-terminals';

/** Explicit source adoption reclassifies only system material cards. Authored
 * drawings and operations survive, as do source IDs in the material BOM. */
export function adoptRouteV3WireTerminals(route: RouteV3Document, source: HarnessDesignDocument): RouteV3Document {
  const owners = routeV3EmbeddedArtifactOwners(source);
  const sleeves = new Set(source.terminations?.artifacts.filter(a=>a.kind==='sleeve').map(a=>a.id));
  if (!owners.size && !sleeves.size) return route;
  const unique = (refs: readonly RouteSourceRef[]) => [...new Map(refs.map(ref => [`${ref.kind}:${ref.id}`, ref])).values()];
  const expand = (refs: readonly RouteSourceRef[]) => unique(refs.flatMap(ref => ref.kind === 'termination-artifact' && owners.has(ref.id)
    ? owners.get(ref.id)!.map(id => ({kind:'wire' as const,id})) : [ref]));
  const embedded = (ref: RouteSourceRef) => ref.kind === 'termination-artifact' && owners.has(ref.id);
  const sleeve = (ref: RouteSourceRef) => ref.kind === 'termination-artifact' && sleeves.has(ref.id);
  const preparedRefs = route.preparedRefs.filter(ref => !embedded(ref) && !sleeve(ref));
  const oldCard = route.nodes.find(n => n.id === 'prepared:termination-artifact');
  const authoredCard = !!oldCard && (!!oldCard.operations?.length || !!oldCard.drawing || !!oldCard.fragmentIds.length);
  const keepCard = authoredCard || !!oldCard?.refs.some(ref => !embedded(ref) && !sleeve(ref));
  let nodes: RouteV3Node[] = route.nodes.filter(n => n !== oldCard || keepCard).map(node => {
    const systemMaterials = node.id === oldCard?.id && !authoredCard;
    const project = systemMaterials ? (refs: readonly RouteSourceRef[]) => refs.filter(ref => !embedded(ref) && !sleeve(ref)) : expand;
    const rawSleeves = !authoredCard && node.id !== oldCard?.id ? route.edges.filter(e=>e.from===oldCard?.id&&e.to===node.id).flatMap(e=>(e.refs??oldCard?.refs??[]).filter(sleeve)) : [];
    return { ...node, refs: project(node.refs), ...(node.rawRefs || rawSleeves.length ? {rawRefs:unique([...project(node.rawRefs??[]),...rawSleeves])} : {}),
      inputNodeIds: node.inputNodeIds?.filter(id => keepCard || id !== oldCard?.id),
      operations: node.operations?.map(operation => ({...operation, ...(operation.outputProductIds ? {outputProductIds:[...new Set(operation.outputProductIds.flatMap(id => {
        for (const [artifactId, wireIds] of owners) {
          const suffix = `:termination-artifact:${artifactId}`;
          if (id.endsWith(suffix)) return wireIds.map(wireId => id.slice(0,-suffix.length)+`:wire:${wireId}`);
        }
        return [id];
      }))]} : {})})) };
  });
  const edges = route.edges.flatMap(edge => {
    if (edge.from !== oldCard?.id || authoredCard) return [{...edge, ...(edge.refs ? {refs:expand(edge.refs)} : {})}];
    // A selected terminal input now comes from its wire blank, even if the old
    // material card also contained sleeves. Never send the whole wire batch.
    const refs = edge.refs ?? oldCard.refs;
    const wireRefs = expand(refs.filter(embedded));
    const rest = refs.filter(ref => !embedded(ref) && !sleeve(ref));
    return [
      ...(keepCard && rest.length ? [{...edge,refs:rest}] : []),
      ...(wireRefs.length && edge.to !== 'prepared:wire' ? [{...edge,id:`${edge.id}:wire-ends`,from:'prepared:wire',refs:wireRefs}] : []),
    ];
  });
  if (edges.some(e => e.from === 'prepared:wire') && !nodes.some(n => n.id === 'prepared:wire')) {
    const refs = preparedRefs.filter(ref => ref.kind === 'wire');
    nodes = [{id:'prepared:wire',kind:'semiFinished',title:'Нарезанные провода',refs,rawRefs:refs,fragmentIds:[],x:32,y:32},...nodes];
  }
  nodes = nodes.map(node => ({...node,inputNodeIds:node.inputNodeIds ? [...new Set([...node.inputNodeIds,...edges.filter(e=>e.to===node.id).map(e=>e.from)])] : undefined}));
  return { ...route, preparedRefs, nodes, edges, fragments: route.fragments.map(fragment => ({...fragment,refs:expand(fragment.refs)})) };
}
