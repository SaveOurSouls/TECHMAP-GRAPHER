import { type TemplateNodeV3 as TemplateNodeV2, type NumericExpressionV3 as NumericExpressionV2, type TemplateContentV3 as TemplateContentV2 } from "./template-model-v3";
import { type TemplateContentV2 as LegacyTemplateContentV2, type ImageNodeV2 } from "./template-model-v2";
import { constantExpressionV3 as constantExpressionV2, moveNodeV3 as moveNodeV2, type NodeEditV3 as NodeEditV2 } from "./template-commands-v3";

export type EditableNode = Extract<TemplateNodeV2, { kind: "line" | "polyline" | "rectangle" | "ellipse" | "bezier" | "closedContour" | "text" | "image" }>;
export const constantValue = (expression: NumericExpressionV2) => expression.kind === "constant" ? expression.value : null;
export const isTemplateUndoShortcut = (
  event: Pick<KeyboardEvent, "ctrlKey" | "metaKey" | "key"> & { readonly target?: EventTarget | null },
) => {
  const target = event.target as { tagName?: string; isContentEditable?: boolean } | null | undefined;
  const tagName = target?.tagName?.toLowerCase();
  const isTextEditor = target?.isContentEditable || tagName === "input" || tagName === "textarea" || tagName === "select";
  return !isTextEditor && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z";
};
export function isTemplateAssetReferencedV2(content: TemplateContentV2 | LegacyTemplateContentV2, assetId: string): boolean {
  return content.views.some(view => view.layers.some(layer => layer.nodes.some(node =>
    node.kind === "image" && node.geometry.assetId === assetId)));
}
export function createTemplateImageNodeV2(assetId: string, layerId: string): ImageNodeV2 {
  const c = constantExpressionV2;
  return {
    id: crypto.randomUUID(), kind: "image", layerId, visible: true, locked: false, opacity: 1,
    transform: { translateX: c(0), translateY: c(0), rotationDegrees: c(0), scaleX: c(1), scaleY: c(1) },
    stroke: { color: "#000000", width: c(0) }, fill: { color: null },
    geometry: { assetId, x: c(80), y: c(80), width: c(320), height: c(180), cropX: 0, cropY: 0, cropWidth: 1, cropHeight: 1, underlay: true },
  };
}
export function isEditableConstantNode(node: TemplateNodeV2): node is EditableNode {
  const constant = (value: NumericExpressionV2) => value.kind === "constant";
  if (![node.transform.translateX, node.transform.translateY].every(constant)) return false;
  if (node.kind === "line" || node.kind === "polyline" || node.kind === "bezier" || node.kind === "closedContour") return node.geometry.points.every(point => constant(point.x) && constant(point.y));
  if (node.kind === "rectangle") return [node.geometry.x, node.geometry.y, node.geometry.width, node.geometry.height].every(constant);
  if (node.kind === "ellipse") return [node.geometry.centerX, node.geometry.centerY, node.geometry.radiusX, node.geometry.radiusY].every(constant);
  if (node.kind === "text") return [node.geometry.x, node.geometry.y, node.geometry.fontSize].every(constant);
  if (node.kind === "image") return [node.geometry.x, node.geometry.y, node.geometry.width, node.geometry.height].every(constant);
  return false;
}
export function nextTemplateSelectionV2(current: readonly string[], id: string | null, extend: boolean): readonly string[] {
  if (!id) return [];
  if (!extend) return [id];
  return current.includes(id) ? current.filter(candidate => candidate !== id) : [...current, id];
}
export function nodeLabel(node: TemplateNodeV2) { return ({ line: "Линия", polyline: "Ломаная", rectangle: "Прямоугольник", ellipse: "Эллипс", bezier: "Кривая Безье", closedContour: "Контур", text: "Текст", image: "Изображение", group: "Группа" })[node.kind]; }
export function nodePosition(node: EditableNode) { const tx = constantValue(node.transform.translateX)!, ty = constantValue(node.transform.translateY)!; if (node.kind === "line" || node.kind === "polyline" || node.kind === "bezier" || node.kind === "closedContour") return { x: constantValue(node.geometry.points[0]!.x)! + tx, y: constantValue(node.geometry.points[0]!.y)! + ty }; if (node.kind === "ellipse") return { x: constantValue(node.geometry.centerX)! - constantValue(node.geometry.radiusX)! + tx, y: constantValue(node.geometry.centerY)! - constantValue(node.geometry.radiusY)! + ty }; return { x: constantValue(node.geometry.x)! + tx, y: constantValue(node.geometry.y)! + ty }; }
/** Side lengths in drawing units, independent of rotation and camera zoom. */
export function nodeDimensions(node: EditableNode): { width: number; height: number } | null {
  if (node.kind !== "rectangle" && node.kind !== "ellipse" && node.kind !== "image") return null;
  const sx = constantValue(node.transform.scaleX), sy = constantValue(node.transform.scaleY);
  const width = node.kind === "ellipse" ? constantValue(node.geometry.radiusX) : constantValue(node.geometry.width);
  const height = node.kind === "ellipse" ? constantValue(node.geometry.radiusY) : constantValue(node.geometry.height);
  if (sx === null || sy === null || width === null || height === null) return null;
  const diameter = node.kind === "ellipse" ? 2 : 1;
  return { width: width * diameter * Math.abs(sx), height: height * diameter * Math.abs(sy) };
}
export function setNodePosition(content: TemplateContentV2, viewId: string, layerId: string, node: EditableNode, x: number, y: number): TemplateContentV2 {
  const current = nodePosition(node);
  return moveNodeV2(content, viewId, layerId, node.id, x - current.x, y - current.y);
}
export function editDimension(node: EditableNode, key: "width" | "height", value: number, edit: (changes: NodeEditV2) => void) {
  if (!Number.isFinite(value) || value <= 0 || (node.kind !== "rectangle" && node.kind !== "ellipse" && node.kind !== "image")) return;
  const scale = constantValue(node.transform[key === "width" ? "scaleX" : "scaleY"]);
  if (scale === null || !Number.isFinite(scale) || scale === 0) return;
  const localSize = value / Math.abs(scale);
  if (!Number.isFinite(localSize)) return;
  const c = constantExpressionV2;
  if (node.kind === "ellipse") edit({ geometry: { ...node.geometry, [key === "width" ? "radiusX" : "radiusY"]: c(localSize / 2) } });
  else edit({ geometry: { ...node.geometry, [key]: c(localSize) } });
}
