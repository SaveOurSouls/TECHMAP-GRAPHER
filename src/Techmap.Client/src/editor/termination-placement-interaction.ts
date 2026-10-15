import type { EditorLayer, EditorPoint, EditorSceneObject } from './editor-types';

/** Check the current view's target layer immediately before committing placement. */
export function placementLayerError(scene: EditorSceneObject, layers: readonly (Pick<EditorLayer, 'id' | 'visible' | 'locked'> & { readonly label?: string; readonly name?: string })[]): string | null {
  const layer = layers.find(candidate => candidate.id === scene.layerId);
  if (!layer) return 'Слой размещения компонента отсутствует. Восстановите слой соединителей и повторите размещение.';
  const name = layer.label?.trim() || layer.name?.trim() || 'Соединители';
  if (!layer.visible) return `Слой «${name}» скрыт. Покажите слой перед размещением компонента.`;
  if (layer.locked) return `Слой «${name}» заблокирован. Разблокируйте слой перед размещением компонента.`;
  return null;
}

/** Scene contact coordinates are local and already include drawing rotation/scale. */
export function placementOrigin(scene: EditorSceneObject, insertionPoint: EditorPoint): EditorPoint {
  let anchor: EditorPoint | undefined;
  try {
    const points: unknown = JSON.parse(scene.metadata?.materializedContactPoints ?? 'null');
    const first = Array.isArray(points) ? points.find(point => point && Number.isFinite(point.x) && Number.isFinite(point.y)) : undefined;
    if (first) anchor = { x: first.x, y: first.y };
  } catch { /* A missing preview anchor falls back to the symbol's insertion point. */ }
  if (!anchor && scene.metadata?.terminationSymbol) {
    const scale = Number(scene.metadata.terminationScale ?? 1);
    const angle = Number(scene.metadata.terminationRotation ?? 0) * Math.PI / 180;
    anchor = { x: scale * (32 * Math.cos(angle) - 50 * Math.sin(angle)), y: scale * (32 * Math.sin(angle) + 50 * Math.cos(angle)) };
  }
  return { x: insertionPoint.x - (anchor?.x ?? 0), y: insertionPoint.y - (anchor?.y ?? 0) };
}

/** Only the transient picture moves; the source object and its identity stay intact. */
export function placementSceneObject(scene: EditorSceneObject, insertionPoint: EditorPoint): EditorSceneObject {
  return { ...scene, ...placementOrigin(scene, insertionPoint) };
}
