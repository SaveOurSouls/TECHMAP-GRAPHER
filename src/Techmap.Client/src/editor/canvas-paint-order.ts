import type { EditorLayer, EditorSceneObject, HarnessEditorView } from "./editor-types";

export function objectsInPaintOrder(
  objects: readonly EditorSceneObject[],
  layers: readonly EditorLayer[],
  view?: HarnessEditorView,
): readonly EditorSceneObject[] {
  const objectGroups = new Map<string, EditorSceneObject[]>();
  for (const object of objects) {
    const group = objectGroups.get(object.layerId) ?? [];
    group.push(object);
    objectGroups.set(object.layerId, group);
  }

  const result: EditorSceneObject[] = [];
  for (const layer of [...layers].reverse()) {
    if (layer.visible) result.push(...(objectGroups.get(layer.id) ?? []));
  }
  // Connection points are interaction anchors, not ordinary artwork. Keep them
  // above every user-reordered layer so wires, covers and tables cannot hide them.
  const connectionPoints = result.filter((object) => object.kind === "physical-node");
  const artwork = result.filter((object) => object.kind !== "physical-node");
  // Keep annotations from legacy documents selectable while they migrate to
  // the dedicated material-index layer (which is absent from old layer lists).
  const missingTopAnnotations = objects.filter((object) =>
    (object.kind === "object-index" || object.kind === "position-leader" || object.kind === "leader-anchor") &&
    !layers.some((layer) => layer.id === object.layerId));
  const topAnnotations = artwork.filter((object) => object.kind === "object-index" || object.kind === "position-leader" || object.kind === "leader-anchor");
  const regularArtwork = artwork.filter((object) => object.kind !== "object-index" && object.kind !== "position-leader" && object.kind !== "leader-anchor");
  // Drawing connector pictures are underlays; preserve user order within each pass.
  return view === "drawing"
    ? [...regularArtwork.filter(object => object.kind === "connector" && !object.terminationArtwork?.length), ...regularArtwork.filter(object => object.kind !== "connector"), ...regularArtwork.filter(object => object.kind === 'connector' && object.terminationArtwork?.length), ...connectionPoints, ...topAnnotations, ...missingTopAnnotations]
    : [...artwork, ...connectionPoints];
}
