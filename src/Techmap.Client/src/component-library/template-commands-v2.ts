import {
  TEMPLATE_V2_LIMITS,
  validateTemplateContentV2,
  type LayerV2,
  type ContactDirectionV2,
  type LogicalContactV2,
  type NumericExpressionV2,
  type ParameterValueV2,
  type TemplateContentV2,
  type TemplateNodeV2,
  type TemplateViewV2,
  type TransformV2,
  type ViewContactPointV2,
} from "./template-model-v2";

export type BasicNodeKindV2 = "line" | "rectangle" | "ellipse" | "text";
export type NodeEditV2 = Partial<Pick<TemplateNodeV2, "visible" | "locked" | "opacity" | "transform" | "stroke" | "fill">> & {
  geometry?: TemplateNodeV2["geometry"];
};
export type ExpressionValuesV2 = ReadonlyMap<string, ParameterValueV2> | Readonly<Record<string, ParameterValueV2>>;
export interface NewContactPointV2 {
  number?: string;
  name?: string;
  contactType?: string;
  x?: NumericExpressionV2;
  y?: NumericExpressionV2;
  direction?: ContactDirectionV2;
}
export interface LogicalContactEditV2 {
  number?: string;
  name?: string;
  contactType?: string;
}
export interface ContactPointEditV2 {
  x?: NumericExpressionV2;
  y?: NumericExpressionV2;
  direction?: ContactDirectionV2;
}

export class TemplateCommandV2Error extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "TemplateCommandV2Error";
  }
}

export function constantExpressionV2(value: number): NumericExpressionV2 {
  if (!Number.isFinite(value) || Math.abs(value) > TEMPLATE_V2_LIMITS.coordinate)
    throw new TemplateCommandV2Error("invalid_number", "Константа должна быть конечной и находиться в допустимом диапазоне.");
  return { kind: "constant", value };
}

export function constantExpressionValueV2(expression: NumericExpressionV2): number | null {
  return expression.kind === "constant" ? expression.value : null;
}

export function evaluateNumericExpressionV2(expression: NumericExpressionV2, values: ExpressionValuesV2 = {}): number {
  let nodes = 0;
  const readValue = (id: string) => typeof (values as ReadonlyMap<string, ParameterValueV2>).get === "function" ?
    (values as ReadonlyMap<string, ParameterValueV2>).get(id) : (values as Readonly<Record<string, ParameterValueV2>>)[id];
  const visit = (current: NumericExpressionV2, depth: number): number => {
    nodes++;
    if (depth > TEMPLATE_V2_LIMITS.expressionDepth || nodes > TEMPLATE_V2_LIMITS.expressionNodes)
      throw new TemplateCommandV2Error("expression_limit", "Выражение превышает допустимую глубину или размер.");
    let result: number;
    switch (current.kind) {
      case "constant": result = current.value; break;
      case "parameter": {
        const value = readValue(current.parameterId);
        if (typeof value !== "number" || !Number.isFinite(value))
          throw new TemplateCommandV2Error("parameter_value", `Нет числового значения параметра ${current.parameterId}.`);
        result = value;
        break;
      }
      case "negate": result = -visit(current.operand, depth + 1); break;
      case "binary": {
        const left = visit(current.left, depth + 1), right = visit(current.right, depth + 1);
        if (current.operator === "divide" && right === 0)
          throw new TemplateCommandV2Error("division_by_zero", "Деление на ноль запрещено.");
        result = current.operator === "add" ? left + right : current.operator === "subtract" ? left - right :
          current.operator === "multiply" ? left * right : left / right;
        break;
      }
    }
    if (!Number.isFinite(result) || Math.abs(result) > TEMPLATE_V2_LIMITS.coordinate)
      throw new TemplateCommandV2Error("expression_result", "Результат выражения выходит за допустимый диапазон.");
    return result;
  };
  return visit(expression, 1);
}

const identityTransform = (): TransformV2 => ({
  translateX: constantExpressionV2(0), translateY: constantExpressionV2(0),
  rotationDegrees: constantExpressionV2(0), scaleX: constantExpressionV2(1), scaleY: constantExpressionV2(1),
});

const newLayer = (): LayerV2 => ({ id: crypto.randomUUID(), name: "Основной", visible: true, locked: false, nodes: [] });
const newView = (kind: "e4" | "drawing", name: string): TemplateViewV2 => ({
  id: crypto.randomUUID(), name, kind, layers: [newLayer()], contactPoints: [], bundlePorts: [], repeatPlacements: [],
});

export function newTemplateContentV2(): TemplateContentV2 {
  const content: TemplateContentV2 = {
    schemaVersion: 2,
    views: [newView("e4", "Схема Э4"), newView("drawing", "Чертёж")],
    logicalContacts: [], parameters: [], repeaters: [], assets: [], articleParameterPresets: [],
  };
  if (!validateTemplateContentV2(content).valid)
    throw new TemplateCommandV2Error("invalid_initial_content", "Не удалось создать корректный шаблон v2.");
  return content;
}

export function addAdditionalViewV2(content: TemplateContentV2, name = ""): [TemplateContentV2, string] {
  if (content.views.length >= TEMPLATE_V2_LIMITS.views)
    throw new TemplateCommandV2Error("view_limit", "Достигнут лимит видов.");
  const view: TemplateViewV2 = {
    id: crypto.randomUUID(), name: normalizedName(name, `Дополнительный вид ${content.views.length - 1}`),
    kind: "additional", layers: [newLayer()], contactPoints: [], bundlePorts: [], repeatPlacements: [],
  };
  return [{ ...content, views: [...content.views, view] }, view.id];
}

export function renameViewV2(content: TemplateContentV2, viewId: string, name: string): TemplateContentV2 {
  const view = requireView(content, viewId);
  return replaceView(content, viewId, { ...view, name: normalizedName(name) });
}

export function deleteAdditionalViewV2(content: TemplateContentV2, viewId: string): TemplateContentV2 {
  const view = requireView(content, viewId);
  if (view.kind !== "additional")
    throw new TemplateCommandV2Error("mandatory_view", "Виды Э4 и Чертёж удалять нельзя.");
  return { ...content, views: content.views.filter(item => item.id !== viewId) };
}

export function addContactPointV2(
  content: TemplateContentV2,
  viewId: string,
  initial: NewContactPointV2 = {},
): [TemplateContentV2, string] {
  const view = requireView(content, viewId);
  if (content.logicalContacts.length >= TEMPLATE_V2_LIMITS.contacts)
    throw new TemplateCommandV2Error("contact_limit", "Достигнут лимит логических контактов.");
  const number = initial.number === undefined ? nextContactNumber(content) : normalizedContactNumber(initial.number);
  requireUniqueContactNumber(content, number);
  const logicalContact: LogicalContactV2 = {
    id: crypto.randomUUID(),
    number,
    name: initial.name === undefined ? `Контакт ${number}` : normalizedName(initial.name),
    contactType: normalizedContactType(initial.contactType ?? ""),
  };
  const point: ViewContactPointV2 = {
    id: crypto.randomUUID(),
    logicalContactId: logicalContact.id,
    x: initial.x ?? constantExpressionV2(260),
    y: initial.y ?? constantExpressionV2(200),
    direction: normalizedContactDirection(initial.direction ?? "right"),
  };
  const nextView = { ...view, contactPoints: [...view.contactPoints, point] };
  return [{ ...replaceView(content, viewId, nextView), logicalContacts: [...content.logicalContacts, logicalContact] }, point.id];
}

export function editLogicalContactV2(
  content: TemplateContentV2,
  logicalContactId: string,
  changes: LogicalContactEditV2,
): TemplateContentV2 {
  const logicalContact = requireLogicalContact(content, logicalContactId);
  const number = changes.number === undefined ? logicalContact.number : normalizedContactNumber(changes.number);
  if (number !== logicalContact.number) requireUniqueContactNumber(content, number, logicalContact.id);
  const nextLogicalContact: LogicalContactV2 = {
    ...logicalContact,
    number,
    name: changes.name === undefined ? logicalContact.name : normalizedName(changes.name),
    contactType: changes.contactType === undefined ? logicalContact.contactType : normalizedContactType(changes.contactType),
  };
  return { ...content, logicalContacts: content.logicalContacts.map(item => item.id === logicalContact.id ? nextLogicalContact : item) };
}

export function editContactPointV2(
  content: TemplateContentV2,
  viewId: string,
  pointId: string,
  changes: ContactPointEditV2,
): TemplateContentV2 {
  const { view, point } = requireContactPoint(content, viewId, pointId);
  const nextPoint: ViewContactPointV2 = {
    ...point,
    x: changes.x ?? point.x,
    y: changes.y ?? point.y,
    direction: changes.direction === undefined ? point.direction : normalizedContactDirection(changes.direction),
  };
  return replaceView(content, viewId, { ...view, contactPoints: view.contactPoints.map(item => item.id === pointId ? nextPoint : item) });
}

export function deleteContactPointV2(content: TemplateContentV2, viewId: string, pointId: string): TemplateContentV2 {
  const { view, point } = requireContactPoint(content, viewId, pointId);
  const nextView: TemplateViewV2 = {
    ...view,
    contactPoints: view.contactPoints.filter(item => item.id !== pointId),
    repeatPlacements: view.repeatPlacements.map(placement => ({
      ...placement,
      contactPointIds: placement.contactPointIds.filter(id => id !== pointId),
    })),
  };
  const withoutPoint = replaceView(content, viewId, nextView);
  const isReferenced = withoutPoint.views.some(item =>
    item.contactPoints.some(candidate => candidate.logicalContactId === point.logicalContactId)) ||
    withoutPoint.repeaters.some(repeater => repeater.logicalContactIds.includes(point.logicalContactId));
  return isReferenced ? withoutPoint : {
    ...withoutPoint,
    logicalContacts: withoutPoint.logicalContacts.filter(item => item.id !== point.logicalContactId),
  };
}

export function addLayerV2(content: TemplateContentV2, viewId: string, name: string): [TemplateContentV2, string] {
  const view = requireView(content, viewId);
  if (view.layers.length >= TEMPLATE_V2_LIMITS.layers)
    throw new TemplateCommandV2Error("layer_limit", "Достигнут лимит слоёв.");
  const layer: LayerV2 = { id: crypto.randomUUID(), name: normalizedName(name, `Слой ${view.layers.length + 1}`), visible: true, locked: false, nodes: [] };
  return [replaceView(content, viewId, { ...view, layers: [...view.layers, layer] }), layer.id];
}

export function renameLayerV2(content: TemplateContentV2, viewId: string, layerId: string, name: string): TemplateContentV2 {
  const { view, layer } = requireLayer(content, viewId, layerId);
  requireUnlockedLayer(layer);
  return replaceLayer(content, view, layerId, { ...layer, name: normalizedName(name) });
}

export function reorderLayerV2(content: TemplateContentV2, viewId: string, layerId: string, toIndex: number): TemplateContentV2 {
  const view = requireView(content, viewId);
  const fromIndex = view.layers.findIndex(layer => layer.id === layerId);
  if (fromIndex < 0) throw new TemplateCommandV2Error("layer_not_found", "Слой не найден.");
  requireUnlockedLayer(view.layers[fromIndex]!);
  const next = reordered(view.layers, fromIndex, toIndex);
  return next === view.layers ? content : replaceView(content, viewId, { ...view, layers: next });
}

export function setLayerVisibleV2(content: TemplateContentV2, viewId: string, layerId: string, visible: boolean): TemplateContentV2 {
  const { view, layer } = requireLayer(content, viewId, layerId);
  return layer.visible === visible ? content : replaceLayer(content, view, layerId, { ...layer, visible });
}

export function setLayerLockedV2(content: TemplateContentV2, viewId: string, layerId: string, locked: boolean): TemplateContentV2 {
  const { view, layer } = requireLayer(content, viewId, layerId);
  return layer.locked === locked ? content : replaceLayer(content, view, layerId, { ...layer, locked });
}

export function deleteLayerV2(content: TemplateContentV2, viewId: string, layerId: string): TemplateContentV2 {
  const view = requireView(content, viewId);
  if (view.layers.length === 1)
    throw new TemplateCommandV2Error("last_layer", "В виде должен остаться хотя бы один слой.");
  const layer = view.layers.find(item => item.id === layerId);
  if (!layer) throw new TemplateCommandV2Error("layer_not_found", "Слой не найден.");
  requireUnlockedLayer(layer);
  const nodeIds = new Set(layer.nodes.map(node => node.id));
  if (view.repeatPlacements.some(placement => nodeIds.has(placement.prototypeGroupId)))
    throw new TemplateCommandV2Error("layer_referenced", "Слой содержит группу-прототип повтора.");
  return replaceView(content, viewId, { ...view, layers: view.layers.filter(item => item.id !== layerId) });
}

export function addNodeV2(content: TemplateContentV2, viewId: string, layerId: string, node: TemplateNodeV2, atIndex?: number): TemplateContentV2 {
  const { view, layer } = requireLayer(content, viewId, layerId);
  requireUnlockedLayer(layer);
  if (node.layerId !== layerId) throw new TemplateCommandV2Error("layer_reference", "Новый объект должен ссылаться на выбранный слой.");
  if (allIds(content).has(node.id)) throw new TemplateCommandV2Error("duplicate_id", "Идентификатор объекта уже используется.");
  const index = atIndex ?? layer.nodes.length;
  if (!Number.isSafeInteger(index) || index < 0 || index > layer.nodes.length)
    throw new TemplateCommandV2Error("insert_index", "Позиция вставки выходит за границы слоя.");
  const nodes = [...layer.nodes];
  nodes.splice(index, 0, node);
  return replaceLayer(content, view, layerId, { ...layer, nodes });
}

export function addBasicNodeV2(content: TemplateContentV2, viewId: string, layerId: string, kind: BasicNodeKindV2): [TemplateContentV2, string] {
  const id = crypto.randomUUID();
  const base = {
    id, kind, layerId, visible: true, locked: false, opacity: 1, transform: identityTransform(),
    stroke: { color: "#27445a", width: constantExpressionV2(2) }, fill: { color: null },
  };
  const node: TemplateNodeV2 = kind === "line" ? { ...base, kind, geometry: { points: [
    { x: constantExpressionV2(100), y: constantExpressionV2(100) },
    { x: constantExpressionV2(210), y: constantExpressionV2(100) },
  ], bendRadius: constantExpressionV2(0) } } : kind === "rectangle" ? { ...base, kind, geometry: {
    x: constantExpressionV2(100), y: constantExpressionV2(100), width: constantExpressionV2(140), height: constantExpressionV2(70),
    cornerRadii: [constantExpressionV2(0), constantExpressionV2(0), constantExpressionV2(0), constantExpressionV2(0)],
  } } : kind === "ellipse" ? { ...base, kind, geometry: {
    centerX: constantExpressionV2(170), centerY: constantExpressionV2(135), radiusX: constantExpressionV2(70), radiusY: constantExpressionV2(35),
  } } : { ...base, kind, geometry: {
    x: constantExpressionV2(100), y: constantExpressionV2(100), text: "Текст", fontSize: constantExpressionV2(18),
  } };
  return [addNodeV2(content, viewId, layerId, node), id];
}

export function editNodeV2(content: TemplateContentV2, viewId: string, layerId: string, nodeId: string, changes: NodeEditV2): TemplateContentV2 {
  const { view, layer, node } = requireNode(content, viewId, layerId, nodeId);
  requireEditableNode(layer, node);
  const next = { ...node, ...changes, id: node.id, layerId: node.layerId, kind: node.kind } as TemplateNodeV2;
  return replaceLayer(content, view, layerId, { ...layer, nodes: layer.nodes.map(item => item.id === nodeId ? next : item) });
}

export function setNodeLockedV2(content: TemplateContentV2, viewId: string, layerId: string, nodeId: string, locked: boolean): TemplateContentV2 {
  const { view, layer, node } = requireNode(content, viewId, layerId, nodeId);
  requireUnlockedLayer(layer);
  if (node.locked === locked) return content;
  return replaceLayer(content, view, layerId, { ...layer, nodes: layer.nodes.map(item => item.id === nodeId ? { ...item, locked } : item) });
}

export function moveNodeV2(content: TemplateContentV2, viewId: string, layerId: string, nodeId: string, deltaX: number, deltaY: number): TemplateContentV2 {
  if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY))
    throw new TemplateCommandV2Error("invalid_move", "Смещение должно быть конечным числом.");
  const { view, layer, node } = requireNode(content, viewId, layerId, nodeId);
  requireEditableNode(layer, node);
  const moved = moveNodeGeometry(node, deltaX, deltaY);
  return replaceLayer(content, view, layerId, { ...layer, nodes: layer.nodes.map(item => item.id === nodeId ? moved : item) });
}

export function deleteNodeV2(content: TemplateContentV2, viewId: string, layerId: string, nodeId: string): TemplateContentV2 {
  const { view, layer, node } = requireNode(content, viewId, layerId, nodeId);
  requireEditableNode(layer, node);
  if (view.layers.some(item => item.nodes.some(candidate => candidate.kind === "group" && candidate.geometry.childIds.includes(nodeId))) ||
      view.repeatPlacements.some(placement => placement.prototypeGroupId === nodeId))
    throw new TemplateCommandV2Error("node_referenced", "Объект используется группой или повтором.");
  return replaceLayer(content, view, layerId, { ...layer, nodes: layer.nodes.filter(item => item.id !== nodeId) });
}

export function reorderNodeV2(content: TemplateContentV2, viewId: string, layerId: string, nodeId: string, toIndex: number): TemplateContentV2 {
  const { view, layer, node } = requireNode(content, viewId, layerId, nodeId);
  requireEditableNode(layer, node);
  const fromIndex = layer.nodes.findIndex(item => item.id === nodeId);
  const next = reordered(layer.nodes, fromIndex, toIndex);
  return next === layer.nodes ? content : replaceLayer(content, view, layerId, { ...layer, nodes: next });
}

function moveNodeGeometry(node: TemplateNodeV2, deltaX: number, deltaY: number): TemplateNodeV2 {
  const shifted = (expression: NumericExpressionV2, delta: number) => constantExpressionV2(requireConstant(expression) + delta);
  return { ...node, transform: { ...node.transform,
    translateX: shifted(node.transform.translateX, deltaX), translateY: shifted(node.transform.translateY, deltaY) } };
}

function requireConstant(expression: NumericExpressionV2): number {
  if (expression.kind !== "constant")
    throw new TemplateCommandV2Error("non_constant_geometry", "Параметризованную геометрию нельзя перемещать как константу.");
  return expression.value;
}

function requireView(content: TemplateContentV2, viewId: string): TemplateViewV2 {
  const view = content.views.find(item => item.id === viewId);
  if (!view) throw new TemplateCommandV2Error("view_not_found", "Вид не найден.");
  return view;
}

function requireLayer(content: TemplateContentV2, viewId: string, layerId: string): { view: TemplateViewV2; layer: LayerV2 } {
  const view = requireView(content, viewId), layer = view.layers.find(item => item.id === layerId);
  if (!layer) throw new TemplateCommandV2Error("layer_not_found", "Слой не найден.");
  return { view, layer };
}

function requireNode(content: TemplateContentV2, viewId: string, layerId: string, nodeId: string): { view: TemplateViewV2; layer: LayerV2; node: TemplateNodeV2 } {
  const { view, layer } = requireLayer(content, viewId, layerId), node = layer.nodes.find(item => item.id === nodeId);
  if (!node) throw new TemplateCommandV2Error("node_not_found", "Объект не найден.");
  return { view, layer, node };
}

function requireLogicalContact(content: TemplateContentV2, logicalContactId: string): LogicalContactV2 {
  const logicalContact = content.logicalContacts.find(item => item.id === logicalContactId);
  if (!logicalContact) throw new TemplateCommandV2Error("logical_contact_not_found", "Логический контакт не найден.");
  return logicalContact;
}

function requireContactPoint(
  content: TemplateContentV2,
  viewId: string,
  pointId: string,
): { view: TemplateViewV2; point: ViewContactPointV2; logicalContact: LogicalContactV2 } {
  const view = requireView(content, viewId);
  const point = view.contactPoints.find(item => item.id === pointId);
  if (!point) throw new TemplateCommandV2Error("contact_point_not_found", "Точка логического контакта не найдена в выбранном виде.");
  return { view, point, logicalContact: requireLogicalContact(content, point.logicalContactId) };
}

function requireUnlockedLayer(layer: LayerV2): void {
  if (layer.locked) throw new TemplateCommandV2Error("layer_locked", "Слой заблокирован.");
}

function requireEditableNode(layer: LayerV2, node: TemplateNodeV2): void {
  requireUnlockedLayer(layer);
  if (node.locked) throw new TemplateCommandV2Error("node_locked", "Объект заблокирован.");
}

function replaceView(content: TemplateContentV2, viewId: string, view: TemplateViewV2): TemplateContentV2 {
  return { ...content, views: content.views.map(item => item.id === viewId ? view : item) };
}

function replaceLayer(content: TemplateContentV2, view: TemplateViewV2, layerId: string, layer: LayerV2): TemplateContentV2 {
  return replaceView(content, view.id, { ...view, layers: view.layers.map(item => item.id === layerId ? layer : item) });
}

function reordered<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  if (!Number.isSafeInteger(toIndex) || toIndex < 0 || toIndex >= items.length)
    throw new TemplateCommandV2Error("reorder_index", "Позиция выходит за границы списка.");
  if (fromIndex === toIndex) return items;
  const next = [...items], [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item!);
  return next;
}

function normalizedName(value: string, fallback?: string): string {
  const result = value.trim() || fallback;
  if (!result || result.length > 256 || /[\u0000-\u001f]/.test(result))
    throw new TemplateCommandV2Error("invalid_name", "Нужно непустое название не длиннее 256 символов.");
  return result;
}

function normalizedContactNumber(value: string): string {
  const result = value.trim();
  if (!result || result.length > 128 || /[\u0000-\u001f]/.test(result))
    throw new TemplateCommandV2Error("invalid_contact_number", "Нужен непустой номер контакта не длиннее 128 символов.");
  return result;
}

function normalizedContactType(value: string): string {
  const result = value.trim();
  if (result.length > 128 || /[\u0000-\u001f]/.test(result))
    throw new TemplateCommandV2Error("invalid_contact_type", "Тип контакта должен быть не длиннее 128 символов.");
  return result;
}

function normalizedContactDirection(value: ContactDirectionV2): ContactDirectionV2 {
  if (!(["left", "right", "up", "down"] as const).includes(value))
    throw new TemplateCommandV2Error("invalid_contact_direction", "Неизвестное направление точки контакта.");
  return value;
}

function requireUniqueContactNumber(content: TemplateContentV2, number: string, exceptId?: string): void {
  if (content.logicalContacts.some(contact => contact.id !== exceptId && contact.number === number))
    throw new TemplateCommandV2Error("duplicate_contact_number", `Номер контакта ${number} уже используется.`);
}

function nextContactNumber(content: TemplateContentV2): string {
  const occupied = new Set(content.logicalContacts.map(contact => contact.number));
  for (let value = 1; value <= TEMPLATE_V2_LIMITS.contacts + 1; value++) {
    const candidate = String(value);
    if (!occupied.has(candidate)) return candidate;
  }
  throw new TemplateCommandV2Error("contact_limit", "Не удалось подобрать свободный номер контакта.");
}

function allIds(content: TemplateContentV2): Set<string> {
  const result = new Set<string>();
  for (const item of [...content.parameters, ...content.assets.map(asset => ({ id: asset.assetId })), ...content.logicalContacts, ...content.repeaters, ...content.articleParameterPresets]) result.add(item.id);
  for (const view of content.views) {
    result.add(view.id);
    for (const layer of view.layers) { result.add(layer.id); for (const node of layer.nodes) result.add(node.id); }
    for (const point of [...view.contactPoints, ...view.bundlePorts]) result.add(point.id);
  }
  return result;
}
