import type { TemplateContentV3 } from "./template-model-v3";
import type { TemplateViewV2 } from "./template-model-v2";
import { materializeE4ConnectorArticle, type E4ConnectorSeriesTable } from "./e4-connector-series-table";

export interface ArticleDrawing { articleVariantId: string; nodeIds: string[]; contactPointIds: string[] }
export interface DrawingContactBinding { logicalContactId: string; seriesRowId: string }

/** A group is selected as a whole, including its descendants. */
export function drawingSelection(view: TemplateViewV2, selectedIds: readonly string[], articleVariantId: string): ArticleDrawing {
  const selected = new Set(selectedIds);
  const nodes = view.layers.flatMap(layer => layer.nodes);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) if (node.kind === "group" && (selected.has(node.id) || node.geometry.childIds.some(id => selected.has(id)))) {
      for (const id of [node.id, ...node.geometry.childIds]) if (!selected.has(id)) { selected.add(id); changed = true; }
    }
  }
  for (const placement of view.repeatPlacements) if (selected.has(placement.prototypeGroupId)) placement.contactPointIds.forEach(id => selected.add(id));
  return { articleVariantId, nodeIds: nodes.filter(node => selected.has(node.id)).map(node => node.id),
    contactPointIds: view.contactPoints.filter(point => selected.has(point.id)).map(point => point.id) };
}

export function articleDrawingView(view: TemplateViewV2, drawings: readonly ArticleDrawing[] | undefined, articleId: string | null): TemplateViewV2 {
  const drawing = drawings?.find(item => item.articleVariantId === articleId);
  if (!drawing || view.kind !== "drawing") return view;
  const nodes = new Set(drawing.nodeIds), points = new Set(drawing.contactPointIds);
  return { ...view, layers: view.layers.map(layer => ({ ...layer, nodes: layer.nodes.map(node => ({ ...node, visible: node.visible && nodes.has(node.id) })) })),
    contactPoints: view.contactPoints.filter(point => points.has(point.id)),
    repeatPlacements: view.repeatPlacements.filter(placement => nodes.has(placement.prototypeGroupId)) };
}

/** Electrical data is read from the article table, never copied back from the drawing. */
export function drawingContactContent(content: TemplateContentV3, table: E4ConnectorSeriesTable,
  bindings: readonly DrawingContactBinding[], articleId: string | null): TemplateContentV3 {
  const rows = articleId ? materializeE4ConnectorArticle(table, articleId).rows
    : table.seriesDefaults.map(row => ({ ...row.values, seriesRowId: row.rowId }));
  const rowsById = new Map(rows.map(row => [row.seriesRowId, row]));
  const byContact = new Map(bindings.map(binding => [binding.logicalContactId, binding.seriesRowId]));
  return { ...content, logicalContacts: content.logicalContacts.map(contact => {
    const row = rowsById.get(byContact.get(contact.id) ?? "");
    return row ? { ...contact, number: row.number, name: row.name, circuitText: row.circuitText, contactTypeGroupId: row.contactTypeGroupId } : contact;
  }) };
}
