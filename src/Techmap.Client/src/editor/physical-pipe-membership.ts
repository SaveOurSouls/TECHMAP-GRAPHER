import type { HarnessDesignDocument } from './model';
import type { PhysicalTopology } from './physical-topology-model';
import { findPhysicalWireRouteThroughSegment, routePhysicalWires } from './physical-wire-routing';
import { parsePhysicalTopology } from './physical-topology-validation';

function editableSelection(document: HarnessDesignDocument, segmentId: string, wireIds: readonly string[]): { topology: PhysicalTopology; ids: readonly string[] } {
  const topology = document.physicalTopology;
  if (!topology?.segments.some(segment => segment.id === segmentId)) throw new Error('Выберите существующий пайп П.');
  if (document.views.drawing.layers.some(layer => layer.id === 'wires' && layer.locked)) throw new Error('Слой проводов заблокирован. Разблокируйте его перед изменением состава П.');
  const ids = [...new Set(wireIds)];
  if (!ids.length) throw new Error('Выберите хотя бы один провод для изменения состава П.');
  for (const id of ids) {
    const wire = document.wires.find(wire => wire.id === id);
    if (!wire) throw new Error('Выбранный провод отсутствует в жгуте. Обновите выделение.');
    const layer = document.views.drawing.layers.find(layer => layer.id === wire.layerIds.drawing);
    if (!layer) throw new Error('Слой выбранного провода отсутствует. Восстановите слой перед изменением состава П.');
    if (layer.locked) throw new Error(`Слой «${layer.name}» выбранного провода заблокирован. Разблокируйте слой перед изменением состава П.`);
  }
  return { topology, ids };
}

/** Explicit inclusion pins one full route through this pipe, preserving all other wires. */
export function addPipeWires(document: HarnessDesignDocument, segmentId: string, wireIds: readonly string[]): PhysicalTopology {
  const { topology, ids } = editableSelection(document, segmentId, wireIds), selected = new Set(ids);
  const segments = topology.segments.map(segment => {
    if (segment.id !== segmentId || !segment.excludedWireIds?.some(id => selected.has(id))) return segment;
    const excludedWireIds = segment.excludedWireIds.filter(id => !selected.has(id));
    const { excludedWireIds: _old, ...rest } = segment;
    return excludedWireIds.length ? { ...rest, excludedWireIds } : rest;
  });
  const candidate = { ...topology, segments };
  const routes = ids.map(wireId => {
    const route = findPhysicalWireRouteThroughSegment(document, candidate, wireId, segmentId);
    if (!route) {
      const wire = document.wires.find(wire => wire.id === wireId)!;
      const name = wire.circuit.trim() || `Провод ${document.wires.indexOf(wire) + 1}`;
      throw new Error(`Нельзя добавить «${name}» в выбранный П: нет непрерывного пути между его электрическими концами через этот пайп. Проверьте соединение П и допуск провода на выходах.`);
    }
    return route;
  });
  return parsePhysicalTopology({ ...candidate, routes: [...topology.routes.filter(route => !selected.has(route.wireId)), ...routes] }, document)!;
}

/** Exclusion is persistent; only the selected wires may choose an alternative route. */
export function removePipeWires(document: HarnessDesignDocument, segmentId: string, wireIds: readonly string[]): PhysicalTopology {
  const { topology, ids } = editableSelection(document, segmentId, wireIds);
  const candidate = { ...topology, segments: topology.segments.map(segment => segment.id === segmentId
    ? { ...segment, excludedWireIds: [...new Set([...(segment.excludedWireIds ?? []), ...ids])] } : segment) };
  return parsePhysicalTopology(routePhysicalWires(document, candidate, ids), document)!;
}

/** Source exclusion and target inclusion are a single immutable result or one error. */
export function movePipeWires(document: HarnessDesignDocument, fromSegmentId: string, toSegmentId: string, wireIds: readonly string[]): PhysicalTopology {
  if (fromSegmentId === toSegmentId) throw new Error('Выберите другой П для переноса проводов.');
  editableSelection(document, toSegmentId, wireIds);
  const withoutSource = removePipeWires(document, fromSegmentId, wireIds);
  return addPipeWires({ ...document, physicalTopology: withoutSource }, toSegmentId, wireIds);
}
