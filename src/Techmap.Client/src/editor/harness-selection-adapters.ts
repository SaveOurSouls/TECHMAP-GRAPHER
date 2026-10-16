import { type HarnessDesignDocument, type EditorLayer } from "./model";
import { type EditorCommand } from "./commands";
import { type HarnessEditorView, type EditorLayer as UiLayer } from "./editor-types";

export function normalizeEditorSelection(
  selectedIds: readonly string[],
  selectedPrimaryId: string | null,
  availableObjectIds: ReadonlySet<string>,
): { readonly objectIds: readonly string[]; readonly primaryObjectId: string | null } {
  const objectIds = [...new Set(selectedIds)].filter((id) => availableObjectIds.has(id));
  const primaryObjectId = selectedPrimaryId && availableObjectIds.has(selectedPrimaryId)
    ? selectedPrimaryId
    : objectIds.at(-1) ?? null;
  if (primaryObjectId && !objectIds.includes(primaryObjectId)) objectIds.push(primaryObjectId);
  return { objectIds, primaryObjectId };
}
export function selectedEditorDeletionCommands(
  document: HarnessDesignDocument,
  selectedObjectIds: readonly string[],
): readonly EditorCommand[] {
  const selectedIds = new Set(selectedObjectIds);
  return [
    ...(document.drawingDocuments?.graphics?.some(g=>selectedIds.has(g.id))?[{type:"set-drawing-documents" as const,documents:{...document.drawingDocuments,graphics:document.drawingDocuments.graphics.filter(g=>!selectedIds.has(g.id))}}]:[]),
    ...document.physicalTopology?.joiningPipes?.filter(p=>selectedIds.has(p.id)).map((p):EditorCommand=>({type:"remove-physical-segment",segmentId:p.id}))??[],
    ...(document.drawingDocuments && (document.drawingDocuments.specificationItems?.some(i=>selectedIds.has(i.id))||document.drawingDocuments.tables.some(t=>selectedIds.has(t.id))||document.drawingDocuments.leaders.some(l=>selectedIds.has(l.id)||selectedIds.has(`${l.id}:anchor`))||(document.drawingDocuments.rails??[]).some(r=>selectedIds.has(r.id)||selectedIds.has(`${r.id}:start`)||selectedIds.has(`${r.id}:end`))) ? [{type:"set-drawing-documents" as const,documents:{...document.drawingDocuments,specificationItems:document.drawingDocuments.specificationItems?.filter(i=>!selectedIds.has(i.id)),tables:document.drawingDocuments.tables.filter(t=>!selectedIds.has(t.id)),leaders:document.drawingDocuments.leaders.filter(l=>!selectedIds.has(l.id)&&!selectedIds.has(`${l.id}:anchor`)),rails:(document.drawingDocuments.rails??[]).filter(r=>!selectedIds.has(r.id)&&!selectedIds.has(`${r.id}:start`)&&!selectedIds.has(`${r.id}:end`))}}] : []),
    ...document.wires
      .filter((wire) => selectedIds.has(wire.id))
      .map((wire): EditorCommand => ({ type: "remove-wire", wireId: wire.id })),
    ...(document.drawingDocuments?.dimensions?.some(d=>selectedIds.has(d.id))?[{type:"set-drawing-documents" as const,documents:{...document.drawingDocuments,dimensions:document.drawingDocuments.dimensions.filter(d=>!selectedIds.has(d.id))}}]:[]),
    ...document.connectors
      .filter((connector) => selectedIds.has(connector.id))
      .map((connector): EditorCommand => ({ type: "remove-connector", connectorId: connector.id })),
  ];
}
export function toUiLayers(document: HarnessDesignDocument, view: HarnessEditorView): readonly UiLayer[] {
  return [...document.views[view].layers]
    .sort((left, right) => right.order - left.order)
    .map((layer) => ({ id: layer.id, label: layer.name, visible: layer.visible, locked: layer.locked }));
}
export function fromUiLayers(layers: readonly UiLayer[], previous: readonly EditorLayer[]): readonly EditorLayer[] {
  return layers.map((layer, index) => ({
    id: layer.id,
    name: previous.find((item) => item.id === layer.id)?.name ?? layer.label,
    order: layers.length - index - 1,
    visible: layer.visible,
    locked: layer.locked,
  }));
}
export function snapRoutePoint(
  start: { readonly x: number; readonly y: number },
  point: { readonly x: number; readonly y: number },
  enabled: boolean,
  angleStep = Math.PI / 12,
) {
  if (!enabled) return point;
  const dx = point.x - start.x;
  const dy = point.y - start.y;
  const distance = Math.hypot(dx, dy);
  const angle = Math.round(Math.atan2(dy, dx) / angleStep) * angleStep;
  return { x: start.x + Math.cos(angle) * distance, y: start.y + Math.sin(angle) * distance };
}
