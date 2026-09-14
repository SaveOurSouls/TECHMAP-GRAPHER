import {
  addAdditionalViewV2,
  addBasicNodeV2,
  addLayerV2,
  addNodeV2,
  attachRepeatDomainV2,
  constantExpressionV2,
  constantExpressionValueV2,
  createRepeatPrototypeV2,
  deleteAdditionalViewV2,
  deleteLayerV2,
  deleteNodeV2,
  deleteRepeatPrototypeV2,
  editNodeV2,
  evaluateNumericExpressionV2,
  moveNodeV2,
  newTemplateContentV2,
  parameterizeNodeDimensionV2,
  renameLayerV2,
  renameViewV2,
  reorderLayerV2,
  reorderNodeV2,
  setLayerLockedV2,
  setLayerVisibleV2,
  setNodeLockedV2,
  setRepeatCountV2,
  setRepeatStepV2,
  setTemplateParameterDefaultV2,
  TemplateCommandV2Error,
  type AttachRepeatDomainV2Input,
  type BasicNodeKindV2,
  type BundlePortEditV2,
  type ContactPointEditV2,
  type CreateRepeatPrototypeV2Input,
  type ExpressionValuesV2,
  type NewBundlePortV2,
  type NodeEditV2,
  type ParameterizableNodeDimensionV2,
  type ParameterizeNodeDimensionV2Input,
  type RepeatPrototypeIdsV2,
} from "./template-commands-v2";
import {
  type ContactDirectionV2,
  type PointExpressionV2,
  type TemplateContentV2,
  type TemplateNodeV2,
  type TemplateViewV2,
} from "./template-model-v2";
import {
  TEMPLATE_V3_LIMITS,
  validateTemplateContentV3Structure,
  type ArticleContactGroupV3,
  type ArticleKeyV3,
  type ArticleParameterValueV3,
  type ArticleVariantV3,
  type BundlePortV3,
  type ContactTypeGroupV3,
  type LogicalContactV3,
  type TemplateContentV3,
  type TemplateNodeV3,
  type TemplateViewV3,
  type ViewContactPointV3,
} from "./template-model-v3";
import { expandTemplateRepeatsV2, TemplateRepeatV2Error } from "./template-repeat-v2";

export type BasicNodeKindV3 = BasicNodeKindV2;
export type NodeEditV3 = NodeEditV2;
export type ExpressionValuesV3 = ExpressionValuesV2;
export type ContactPointEditV3 = ContactPointEditV2;
export type NewBundlePortV3 = NewBundlePortV2;
export type BundlePortEditV3 = BundlePortEditV2;
export type CreateRepeatPrototypeV3Input = CreateRepeatPrototypeV2Input;
export type RepeatPrototypeIdsV3 = RepeatPrototypeIdsV2;
export type AttachRepeatDomainV3Input = AttachRepeatDomainV2Input;
export type ParameterizableNodeDimensionV3 = ParameterizableNodeDimensionV2;
export type ParameterizeNodeDimensionV3Input = ParameterizeNodeDimensionV2Input;

export interface NewContactPointV3 extends ContactPointEditV3 {
  number?: string;
  name?: string;
  circuitText?: string | null;
  contactTypeGroupId?: string | null;
}

export interface LogicalContactEditV3 {
  number?: string;
  name?: string;
  circuitText?: string | null;
  contactTypeGroupId?: string | null;
}

export interface UpsertArticleVariantV3Input extends ArticleKeyV3 {
  id?: string;
  parameterValues?: readonly ArticleParameterValueV3[];
  contactGroups?: readonly ArticleContactGroupV3[] | null;
}

export class TemplateCommandV3Error extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "TemplateCommandV3Error";
  }
}

export const constantExpressionV3 = constantExpressionV2;
export const constantExpressionValueV3 = constantExpressionValueV2;
export const evaluateNumericExpressionV3 = evaluateNumericExpressionV2;

/** Lossless projection of the shared geometry/parameter core for V2-only consumers. */
export function projectTemplateContentV3CoreToV2(content: TemplateContentV3): TemplateContentV2 {
  const groupNames = new Map(content.contactTypeGroups.map(group => [group.id, group.name]));
  return {
    schemaVersion: 2,
    views: content.views,
    logicalContacts: content.logicalContacts.map(contact => ({
      id: contact.id,
      number: contact.number,
      name: contact.name,
      contactType: contact.contactTypeGroupId === null ? "" : groupNames.get(contact.contactTypeGroupId) ?? "",
    })),
    parameters: content.parameters,
    repeaters: content.repeaters,
    assets: content.assets,
    articleParameterPresets: content.articleVariants.map(variant => ({
      id: variant.id,
      sourceId: variant.sourceId,
      entityType: variant.entityType,
      articleKey: variant.articleKey,
      values: variant.parameterValues,
    })),
  };
}

function restoreFromV2(original: TemplateContentV3, core: TemplateContentV2): TemplateContentV3 {
  const originalContacts = new Map(original.logicalContacts.map(contact => [contact.id, contact]));
  const originalVariants = new Map(original.articleVariants.map(variant => [variant.id, variant]));
  return {
    schemaVersion: 3,
    views: core.views,
    logicalContacts: core.logicalContacts.map(contact => {
      const previous = originalContacts.get(contact.id);
      return previous === undefined
        ? { id: contact.id, number: contact.number, name: contact.name, circuitText: null, contactTypeGroupId: null }
        : { ...previous, number: contact.number, name: contact.name };
    }),
    parameters: core.parameters,
    repeaters: core.repeaters,
    assets: core.assets,
    contactTypeGroups: original.contactTypeGroups,
    articleVariants: core.articleParameterPresets.map(preset => {
      const previous = originalVariants.get(preset.id);
      return {
        id: preset.id,
        sourceId: preset.sourceId,
        entityType: preset.entityType,
        articleKey: preset.articleKey,
        parameterValues: preset.values,
        contactGroups: previous?.contactGroups ?? null,
      };
    }),
  };
}

function translateError(error: unknown): never {
  if (error instanceof TemplateCommandV2Error || error instanceof TemplateRepeatV2Error)
    throw new TemplateCommandV3Error(error.code, error.message);
  throw error;
}

function requireValidInput(content: TemplateContentV3): void {
  const validation = validateTemplateContentV3Structure(content);
  if (!validation.valid)
    throw new TemplateCommandV3Error("invalid_input", validation.diagnostics[0]?.message ?? "Некорректный шаблон v3.");
}

function requireValidResult(content: TemplateContentV3, code: string): TemplateContentV3 {
  const validation = validateTemplateContentV3Structure(content);
  if (!validation.valid)
    throw new TemplateCommandV3Error(code, validation.diagnostics[0]?.message ?? "Команда создала некорректный шаблон v3.");
  try {
    expandTemplateRepeatsV2(projectTemplateContentV3CoreToV2(content));
  } catch (error) {
    translateError(error);
  }
  return content;
}

function runCore(content: TemplateContentV3, code: string, command: (core: TemplateContentV2) => TemplateContentV2): TemplateContentV3 {
  requireValidInput(content);
  try {
    return requireValidResult(restoreFromV2(content, command(projectTemplateContentV3CoreToV2(content))), code);
  } catch (error) {
    translateError(error);
  }
}

function runCoreTuple(
  content: TemplateContentV3,
  code: string,
  command: (core: TemplateContentV2) => [TemplateContentV2, string],
): [TemplateContentV3, string] {
  requireValidInput(content);
  try {
    const [core, id] = command(projectTemplateContentV3CoreToV2(content));
    return [requireValidResult(restoreFromV2(content, core), code), id];
  } catch (error) {
    translateError(error);
  }
}

function runCoreRepeatTuple(
  content: TemplateContentV3,
  code: string,
  command: (core: TemplateContentV2) => [TemplateContentV2, RepeatPrototypeIdsV3],
): [TemplateContentV3, RepeatPrototypeIdsV3] {
  requireValidInput(content);
  try {
    const [core, ids] = command(projectTemplateContentV3CoreToV2(content));
    return [requireValidResult(restoreFromV2(content, core), code), ids];
  } catch (error) {
    translateError(error);
  }
}

export function newTemplateContentV3(): TemplateContentV3 {
  const core = newTemplateContentV2();
  return requireValidResult({
    schemaVersion: 3,
    views: core.views,
    logicalContacts: [],
    parameters: [],
    repeaters: [],
    assets: [],
    contactTypeGroups: [],
    articleVariants: [],
  }, "invalid_initial_content");
}

export function addAdditionalViewV3(content: TemplateContentV3, name = ""): [TemplateContentV3, string] {
  return runCoreTuple(content, "invalid_view", core => addAdditionalViewV2(core, name));
}

export function renameViewV3(content: TemplateContentV3, viewId: string, name: string): TemplateContentV3 {
  return runCore(content, "invalid_view", core => renameViewV2(core, viewId, name));
}

export function deleteAdditionalViewV3(content: TemplateContentV3, viewId: string): TemplateContentV3 {
  return runCore(content, "invalid_view_delete", core => deleteAdditionalViewV2(core, viewId));
}

function requireView(content: TemplateContentV3, viewId: string): TemplateViewV3 {
  const view = content.views.find(candidate => candidate.id === viewId);
  if (!view) throw new TemplateCommandV3Error("view_not_found", "Вид не найден.");
  return view;
}

function replaceView(content: TemplateContentV3, view: TemplateViewV3): TemplateContentV3 {
  return { ...content, views: content.views.map(candidate => candidate.id === view.id ? view : candidate) };
}

function requireLogicalContact(content: TemplateContentV3, logicalContactId: string): LogicalContactV3 {
  const contact = content.logicalContacts.find(candidate => candidate.id === logicalContactId);
  if (!contact) throw new TemplateCommandV3Error("logical_contact_not_found", "Логический контакт не найден.");
  return contact;
}

function requireContactPoint(content: TemplateContentV3, viewId: string, pointId: string): { view: TemplateViewV3; point: ViewContactPointV3 } {
  const view = requireView(content, viewId);
  const point = view.contactPoints.find(candidate => candidate.id === pointId);
  if (!point) throw new TemplateCommandV3Error("contact_point_not_found", "Точка логического контакта не найдена в выбранном виде.");
  return { view, point };
}

function requireBundlePort(content: TemplateContentV3, viewId: string, portId: string): { view: TemplateViewV3; port: BundlePortV3 } {
  const view = requireView(content, viewId);
  const port = view.bundlePorts.find(candidate => candidate.id === portId);
  if (!port) throw new TemplateCommandV3Error("bundle_port_not_found", "Общая точка жгута не найдена в выбранном виде.");
  return { view, port };
}

function normalizedText(value: string, maximum: number, code: string, label: string, allowEmpty = false): string {
  const result = value.trim();
  if ((!allowEmpty && !result) || result.length > maximum || /[\u0000-\u001f]/.test(result))
    throw new TemplateCommandV3Error(code, `${label} должно быть ${allowEmpty ? "" : "непустым и "}не длиннее ${maximum} символов.`);
  return result;
}

function normalizedOptionalText(value: string | null, maximum: number, code: string, label: string): string | null {
  if (value === null) return null;
  if (value.length > maximum || /[\u0000-\u001f]/.test(value))
    throw new TemplateCommandV3Error(code, `${label} должно быть не длиннее ${maximum} символов.`);
  return value;
}

function normalizedDirection(value: ContactDirectionV2): ContactDirectionV2 {
  if (!( ["left", "right", "up", "down"] as const).includes(value))
    throw new TemplateCommandV3Error("invalid_contact_direction", "Неизвестное направление точки контакта.");
  return value;
}

function requireGroup(content: TemplateContentV3, groupId: string): ContactTypeGroupV3 {
  const group = content.contactTypeGroups.find(candidate => candidate.id === groupId);
  if (!group) throw new TemplateCommandV3Error("contact_type_group_not_found", "Группа типа контакта не найдена.");
  return group;
}

function nextContactNumber(content: TemplateContentV3): string {
  const occupied = new Set(content.logicalContacts.map(contact => contact.number));
  for (let number = 1; number <= TEMPLATE_V3_LIMITS.contacts + 1; number++)
    if (!occupied.has(String(number))) return String(number);
  throw new TemplateCommandV3Error("contact_limit", "Не удалось подобрать свободный номер контакта.");
}

function requireUniqueContactNumber(content: TemplateContentV3, number: string, exceptId?: string): void {
  if (content.logicalContacts.some(contact => contact.id !== exceptId && contact.number === number))
    throw new TemplateCommandV3Error("duplicate_contact_number", `Номер контакта ${number} уже используется.`);
}

export function addContactPointV3(
  content: TemplateContentV3,
  viewId: string,
  initial: NewContactPointV3 = {},
): [TemplateContentV3, string] {
  requireValidInput(content);
  const view = requireView(content, viewId);
  if (content.logicalContacts.length >= TEMPLATE_V3_LIMITS.contacts)
    throw new TemplateCommandV3Error("contact_limit", "Достигнут лимит логических контактов.");
  const number = initial.number === undefined
    ? nextContactNumber(content)
    : normalizedText(initial.number, 128, "invalid_contact_number", "Номер контакта");
  requireUniqueContactNumber(content, number);
  if (initial.contactTypeGroupId !== undefined && initial.contactTypeGroupId !== null)
    requireGroup(content, initial.contactTypeGroupId);
  const logicalContact: LogicalContactV3 = {
    id: crypto.randomUUID(),
    number,
    name: initial.name === undefined
      ? `Контакт ${number}`
      : normalizedText(initial.name, 256, "invalid_name", "Название контакта"),
    circuitText: initial.circuitText === undefined
      ? null
      : normalizedOptionalText(initial.circuitText, 4_096, "invalid_circuit_text", "Текст цепи"),
    contactTypeGroupId: initial.contactTypeGroupId ?? null,
  };
  const point: ViewContactPointV3 = {
    id: crypto.randomUUID(),
    logicalContactId: logicalContact.id,
    x: initial.x ?? constantExpressionV3(260),
    y: initial.y ?? constantExpressionV3(200),
    direction: normalizedDirection(initial.direction ?? "right"),
  };
  const next = {
    ...replaceView(content, { ...view, contactPoints: [...view.contactPoints, point] }),
    logicalContacts: [...content.logicalContacts, logicalContact],
  };
  return [requireValidResult(next, "invalid_contact_add"), point.id];
}

export function linkLogicalContactPointV3(
  content: TemplateContentV3,
  viewId: string,
  logicalContactId: string,
  initial: ContactPointEditV3 = {},
): [TemplateContentV3, string] {
  requireValidInput(content);
  const view = requireView(content, viewId);
  requireLogicalContact(content, logicalContactId);
  if (view.contactPoints.some(point => point.logicalContactId === logicalContactId))
    throw new TemplateCommandV3Error("duplicate_contact_point", "В выбранном виде уже есть точка этого логического контакта.");
  const point: ViewContactPointV3 = {
    id: crypto.randomUUID(),
    logicalContactId,
    x: initial.x ?? constantExpressionV3(260),
    y: initial.y ?? constantExpressionV3(200),
    direction: normalizedDirection(initial.direction ?? "right"),
  };
  const next = replaceView(content, { ...view, contactPoints: [...view.contactPoints, point] });
  return [requireValidResult(next, "invalid_contact_link"), point.id];
}

export function editLogicalContactV3(
  content: TemplateContentV3,
  logicalContactId: string,
  changes: LogicalContactEditV3,
): TemplateContentV3 {
  requireValidInput(content);
  const contact = requireLogicalContact(content, logicalContactId);
  const number = changes.number === undefined
    ? contact.number
    : normalizedText(changes.number, 128, "invalid_contact_number", "Номер контакта");
  requireUniqueContactNumber(content, number, contact.id);
  if (changes.contactTypeGroupId !== undefined && changes.contactTypeGroupId !== null)
    requireGroup(content, changes.contactTypeGroupId);
  const nextContact: LogicalContactV3 = {
    ...contact,
    number,
    name: changes.name === undefined
      ? contact.name
      : normalizedText(changes.name, 256, "invalid_name", "Название контакта"),
    circuitText: changes.circuitText === undefined
      ? contact.circuitText
      : normalizedOptionalText(changes.circuitText, 4_096, "invalid_circuit_text", "Текст цепи"),
    contactTypeGroupId: changes.contactTypeGroupId === undefined ? contact.contactTypeGroupId : changes.contactTypeGroupId,
  };
  return requireValidResult({
    ...content,
    logicalContacts: content.logicalContacts.map(candidate => candidate.id === contact.id ? nextContact : candidate),
  }, "invalid_contact_edit");
}

export function editContactPointV3(
  content: TemplateContentV3,
  viewId: string,
  pointId: string,
  changes: ContactPointEditV3,
): TemplateContentV3 {
  requireValidInput(content);
  const { view, point } = requireContactPoint(content, viewId, pointId);
  const nextPoint: ViewContactPointV3 = {
    ...point,
    x: changes.x ?? point.x,
    y: changes.y ?? point.y,
    direction: changes.direction === undefined ? point.direction : normalizedDirection(changes.direction),
  };
  return requireValidResult(replaceView(content, {
    ...view,
    contactPoints: view.contactPoints.map(candidate => candidate.id === point.id ? nextPoint : candidate),
  }), "invalid_contact_point_edit");
}

export function deleteContactPointV3(content: TemplateContentV3, viewId: string, pointId: string): TemplateContentV3 {
  requireValidInput(content);
  const { view, point } = requireContactPoint(content, viewId, pointId);
  const withoutPoint = replaceView(content, {
    ...view,
    contactPoints: view.contactPoints.filter(candidate => candidate.id !== point.id),
    repeatPlacements: view.repeatPlacements.map(placement => ({
      ...placement,
      contactPointIds: placement.contactPointIds.filter(id => id !== point.id),
    })),
  });
  const referenced = withoutPoint.views.some(candidate =>
    candidate.contactPoints.some(other => other.logicalContactId === point.logicalContactId)) ||
    withoutPoint.repeaters.some(repeater => repeater.logicalContactIds.includes(point.logicalContactId));
  const next = referenced ? withoutPoint : {
    ...withoutPoint,
    logicalContacts: withoutPoint.logicalContacts.filter(contact => contact.id !== point.logicalContactId),
  };
  return requireValidResult(next, "invalid_contact_delete");
}

export function addBundlePortV3(
  content: TemplateContentV3,
  viewId: string,
  initial: NewBundlePortV3 = {},
): [TemplateContentV3, string] {
  requireValidInput(content);
  const view = requireView(content, viewId);
  if (view.bundlePorts.length >= TEMPLATE_V3_LIMITS.contacts)
    throw new TemplateCommandV3Error("bundle_port_limit", "Достигнут лимит общих точек жгута в виде.");
  const port: BundlePortV3 = {
    id: crypto.randomUUID(),
    name: initial.name === undefined || initial.name.trim() === ""
      ? `Порт жгута ${view.bundlePorts.length + 1}`
      : normalizedText(initial.name, 256, "invalid_name", "Название порта"),
    x: initial.x ?? constantExpressionV3(260),
    y: initial.y ?? constantExpressionV3(200),
    direction: normalizedDirection(initial.direction ?? "right"),
  };
  const next = replaceView(content, { ...view, bundlePorts: [...view.bundlePorts, port] });
  return [requireValidResult(next, "invalid_bundle_port"), port.id];
}

export function editBundlePortV3(
  content: TemplateContentV3,
  viewId: string,
  portId: string,
  changes: BundlePortEditV3,
): TemplateContentV3 {
  requireValidInput(content);
  const { view, port } = requireBundlePort(content, viewId, portId);
  const nextPort: BundlePortV3 = {
    ...port,
    name: changes.name === undefined ? port.name : normalizedText(changes.name, 256, "invalid_name", "Название порта"),
    x: changes.x ?? port.x,
    y: changes.y ?? port.y,
    direction: changes.direction === undefined ? port.direction : normalizedDirection(changes.direction),
  };
  return requireValidResult(replaceView(content, {
    ...view,
    bundlePorts: view.bundlePorts.map(candidate => candidate.id === port.id ? nextPort : candidate),
  }), "invalid_bundle_port");
}

export function deleteBundlePortV3(content: TemplateContentV3, viewId: string, portId: string): TemplateContentV3 {
  requireValidInput(content);
  const { view, port } = requireBundlePort(content, viewId, portId);
  return requireValidResult(replaceView(content, {
    ...view,
    bundlePorts: view.bundlePorts.filter(candidate => candidate.id !== port.id),
  }), "invalid_bundle_port_delete");
}

export function addContactTypeGroupV3(content: TemplateContentV3, name: string): [TemplateContentV3, string] {
  requireValidInput(content);
  if (content.contactTypeGroups.length >= TEMPLATE_V3_LIMITS.contactTypeGroups)
    throw new TemplateCommandV3Error("contact_type_group_limit", "Достигнут лимит групп типов контактов.");
  const normalized = normalizedText(name, 128, "invalid_contact_type_group_name", "Название группы");
  if (content.contactTypeGroups.some(group => group.name.trim().toLowerCase() === normalized.toLowerCase()))
    throw new TemplateCommandV3Error("duplicate_contact_type_group_name", "Название группы типов контактов уже используется.");
  const group: ContactTypeGroupV3 = { id: crypto.randomUUID(), name: normalized };
  return [requireValidResult({ ...content, contactTypeGroups: [...content.contactTypeGroups, group] }, "invalid_contact_type_group"), group.id];
}

export function renameContactTypeGroupV3(content: TemplateContentV3, groupId: string, name: string): TemplateContentV3 {
  requireValidInput(content);
  const group = requireGroup(content, groupId);
  const normalized = normalizedText(name, 128, "invalid_contact_type_group_name", "Название группы");
  if (content.contactTypeGroups.some(candidate => candidate.id !== group.id && candidate.name.trim().toLowerCase() === normalized.toLowerCase()))
    throw new TemplateCommandV3Error("duplicate_contact_type_group_name", "Название группы типов контактов уже используется.");
  return requireValidResult({
    ...content,
    contactTypeGroups: content.contactTypeGroups.map(candidate => candidate.id === group.id ? { ...candidate, name: normalized } : candidate),
  }, "invalid_contact_type_group");
}

export function deleteContactTypeGroupV3(content: TemplateContentV3, groupId: string): TemplateContentV3 {
  requireValidInput(content);
  requireGroup(content, groupId);
  if (content.logicalContacts.some(contact => contact.contactTypeGroupId === groupId) ||
      content.articleVariants.some(variant => variant.contactGroups?.some(group => group.contactTypeGroupId === groupId)))
    throw new TemplateCommandV3Error("contact_type_group_referenced", "Группа типа контакта используется контактом или вариантом артикула.");
  return requireValidResult({
    ...content,
    contactTypeGroups: content.contactTypeGroups.filter(candidate => candidate.id !== groupId),
  }, "invalid_contact_type_group_delete");
}

function normalizedArticleKey(value: ArticleKeyV3): ArticleKeyV3 {
  return {
    sourceId: normalizedText(value.sourceId, 128, "invalid_article_key", "Источник артикула"),
    entityType: normalizedText(value.entityType, 64, "invalid_article_key", "Тип сущности артикула"),
    articleKey: normalizedText(value.articleKey, 512, "invalid_article_key", "Ключ артикула"),
  };
}

function articleIdentity(value: ArticleKeyV3): string {
  return `${value.sourceId}\0${value.entityType}\0${value.articleKey}`;
}

function cloneContactGroups(value: readonly ArticleContactGroupV3[] | null): ArticleContactGroupV3[] | null {
  return value === null ? null : value.map(group => ({
    ...group,
    allowedTerminalArticleKeys: group.allowedTerminalArticleKeys.map(key => ({ ...key })),
  }));
}

export function upsertArticleVariantV3(
  content: TemplateContentV3,
  input: UpsertArticleVariantV3Input,
): [TemplateContentV3, string] {
  requireValidInput(content);
  const key = normalizedArticleKey(input);
  const byId = input.id === undefined ? undefined : content.articleVariants.find(variant => variant.id === input.id);
  const byKey = content.articleVariants.find(variant => articleIdentity(variant) === articleIdentity(key));
  if (byId !== undefined && byKey !== undefined && byId.id !== byKey.id)
    throw new TemplateCommandV3Error("duplicate_article_variant", "Вариант с таким ключом уже существует.");
  if (byId === undefined && input.id !== undefined && content.articleVariants.length >= TEMPLATE_V3_LIMITS.articleVariants)
    throw new TemplateCommandV3Error("article_variant_limit", "Достигнут лимит вариантов артикула.");
  if (byId === undefined && byKey === undefined && content.articleVariants.length >= TEMPLATE_V3_LIMITS.articleVariants)
    throw new TemplateCommandV3Error("article_variant_limit", "Достигнут лимит вариантов артикула.");
  const existing = byId ?? byKey;
  const id = existing?.id ?? input.id ?? crypto.randomUUID();
  const variant: ArticleVariantV3 = {
    id,
    ...key,
    parameterValues: input.parameterValues === undefined
      ? existing?.parameterValues.map(value => ({ ...value })) ?? []
      : input.parameterValues.map(value => ({ ...value })),
    contactGroups: input.contactGroups === undefined
      ? cloneContactGroups(existing?.contactGroups ?? null)
      : cloneContactGroups(input.contactGroups),
  };
  const variants = existing === undefined
    ? [...content.articleVariants, variant]
    : content.articleVariants.map(candidate => candidate.id === existing.id ? variant : candidate);
  return [requireValidResult({ ...content, articleVariants: variants }, "invalid_article_variant"), id];
}

export function removeArticleVariantV3(content: TemplateContentV3, variantId: string): TemplateContentV3 {
  requireValidInput(content);
  if (!content.articleVariants.some(variant => variant.id === variantId))
    throw new TemplateCommandV3Error("article_variant_not_found", "Вариант артикула не найден.");
  return requireValidResult({
    ...content,
    articleVariants: content.articleVariants.filter(variant => variant.id !== variantId),
  }, "invalid_article_variant_delete");
}

function requireArticleVariant(content: TemplateContentV3, variantId: string): ArticleVariantV3 {
  const variant = content.articleVariants.find(candidate => candidate.id === variantId);
  if (!variant) throw new TemplateCommandV3Error("article_variant_not_found", "Вариант артикула не найден.");
  return variant;
}

function inferredContactGroupConfigs(content: TemplateContentV3): ArticleContactGroupV3[] {
  const repeatedContactIds = new Set(content.repeaters.flatMap(repeater => repeater.logicalContactIds));
  const counts = new Map(content.contactTypeGroups.map(group => [group.id, 0]));
  for (const contact of content.logicalContacts)
    if (contact.contactTypeGroupId !== null && !repeatedContactIds.has(contact.id))
      counts.set(contact.contactTypeGroupId, (counts.get(contact.contactTypeGroupId) ?? 0) + 1);
  for (const repeater of content.repeaters) {
    const parameter = content.parameters.find(candidate => candidate.id === repeater.countParameterId);
    const count = parameter?.type === "integer" && typeof parameter.defaultValue === "number" ? parameter.defaultValue : 0;
    for (const logicalContactId of repeater.logicalContactIds) {
      const groupId = content.logicalContacts.find(contact => contact.id === logicalContactId)?.contactTypeGroupId;
      if (groupId !== null && groupId !== undefined)
        counts.set(groupId, (counts.get(groupId) ?? 0) + count);
    }
  }
  return content.contactTypeGroups.map(group => ({
    contactTypeGroupId: group.id,
    contactCount: counts.get(group.id) ?? 0,
    allowedTerminalArticleKeys: [],
  }));
}

export function setArticleVariantContactGroupV3(
  content: TemplateContentV3,
  variantId: string,
  contactTypeGroupId: string,
  contactCount: number,
  allowedTerminalArticleKeys: readonly ArticleKeyV3[],
): TemplateContentV3 {
  requireValidInput(content);
  const variant = requireArticleVariant(content, variantId);
  requireGroup(content, contactTypeGroupId);
  if (!Number.isSafeInteger(contactCount) || contactCount < 0 || contactCount > TEMPLATE_V3_LIMITS.contacts)
    throw new TemplateCommandV3Error("invalid_contact_count", `Количество контактов должно быть целым числом от 0 до ${TEMPLATE_V3_LIMITS.contacts}.`);
  if (allowedTerminalArticleKeys.length > TEMPLATE_V3_LIMITS.terminalArticlesPerGroup)
    throw new TemplateCommandV3Error("terminal_article_limit", "Превышен лимит совместимых артикулов терминалов.");
  const terminalKeys = allowedTerminalArticleKeys.map(normalizedArticleKey);
  if (new Set(terminalKeys.map(articleIdentity)).size !== terminalKeys.length)
    throw new TemplateCommandV3Error("duplicate_terminal_article", "Артикул терминала повторяется в группе.");
  const existingConfigs = cloneContactGroups(variant.contactGroups) ?? inferredContactGroupConfigs(content);
  const config: ArticleContactGroupV3 = { contactTypeGroupId, contactCount, allowedTerminalArticleKeys: terminalKeys };
  const contactGroups = existingConfigs.some(group => group.contactTypeGroupId === contactTypeGroupId)
    ? existingConfigs.map(group => group.contactTypeGroupId === contactTypeGroupId ? config : group)
    : [...existingConfigs, config];
  const nextVariant = { ...variant, contactGroups };
  return requireValidResult({
    ...content,
    articleVariants: content.articleVariants.map(candidate => candidate.id === variant.id ? nextVariant : candidate),
  }, "invalid_article_contact_group");
}

export const setArticleVariantContactGroupConfigV3 = setArticleVariantContactGroupV3;

export function removeArticleVariantContactGroupV3(
  content: TemplateContentV3,
  variantId: string,
  contactTypeGroupId: string,
): TemplateContentV3 {
  requireValidInput(content);
  const variant = requireArticleVariant(content, variantId);
  if (variant.contactGroups === null || !variant.contactGroups.some(group => group.contactTypeGroupId === contactTypeGroupId))
    throw new TemplateCommandV3Error("article_contact_group_not_found", "Настройка группы контактов варианта не найдена.");
  const remaining = variant.contactGroups.filter(group => group.contactTypeGroupId !== contactTypeGroupId);
  const nextVariant: ArticleVariantV3 = { ...variant, contactGroups: remaining.length === 0 ? null : remaining };
  return requireValidResult({
    ...content,
    articleVariants: content.articleVariants.map(candidate => candidate.id === variant.id ? nextVariant : candidate),
  }, "invalid_article_contact_group_delete");
}

export const removeArticleVariantContactGroupConfigV3 = removeArticleVariantContactGroupV3;

export function createRepeatPrototypeV3(
  content: TemplateContentV3,
  input: CreateRepeatPrototypeV3Input,
): [TemplateContentV3, RepeatPrototypeIdsV3] {
  return runCoreRepeatTuple(content, "invalid_repeat_prototype", core => createRepeatPrototypeV2(core, input));
}

export function attachRepeatDomainV3(
  content: TemplateContentV3,
  input: AttachRepeatDomainV3Input,
): [TemplateContentV3, string] {
  return runCoreTuple(content, "invalid_repeat_attachment", core => attachRepeatDomainV2(core, input));
}

export const attachRepeatDomainCrossViewV3 = attachRepeatDomainV3;

export function deleteRepeatPrototypeV3(content: TemplateContentV3, repeatDomainId: string): TemplateContentV3 {
  return runCore(content, "invalid_repeat_delete", core => deleteRepeatPrototypeV2(core, repeatDomainId));
}

export function setRepeatCountV3(content: TemplateContentV3, repeatDomainId: string, count: number): TemplateContentV3 {
  return runCore(content, "invalid_repeat_count", core => setRepeatCountV2(core, repeatDomainId, count));
}

export function setRepeatStepV3(
  content: TemplateContentV3,
  viewId: string,
  repeatDomainId: string,
  step: PointExpressionV2,
): TemplateContentV3 {
  return runCore(content, "invalid_repeat_step", core => setRepeatStepV2(core, viewId, repeatDomainId, step));
}

export function addLayerV3(content: TemplateContentV3, viewId: string, name: string): [TemplateContentV3, string] {
  return runCoreTuple(content, "invalid_layer", core => addLayerV2(core, viewId, name));
}

export function renameLayerV3(content: TemplateContentV3, viewId: string, layerId: string, name: string): TemplateContentV3 {
  return runCore(content, "invalid_layer", core => renameLayerV2(core, viewId, layerId, name));
}

export function reorderLayerV3(content: TemplateContentV3, viewId: string, layerId: string, toIndex: number): TemplateContentV3 {
  return runCore(content, "invalid_layer", core => reorderLayerV2(core, viewId, layerId, toIndex));
}

export function setLayerVisibleV3(content: TemplateContentV3, viewId: string, layerId: string, visible: boolean): TemplateContentV3 {
  return runCore(content, "invalid_layer", core => setLayerVisibleV2(core, viewId, layerId, visible));
}

export function setLayerLockedV3(content: TemplateContentV3, viewId: string, layerId: string, locked: boolean): TemplateContentV3 {
  return runCore(content, "invalid_layer", core => setLayerLockedV2(core, viewId, layerId, locked));
}

export function deleteLayerV3(content: TemplateContentV3, viewId: string, layerId: string): TemplateContentV3 {
  return runCore(content, "invalid_layer_delete", core => deleteLayerV2(core, viewId, layerId));
}

export function addNodeV3(
  content: TemplateContentV3,
  viewId: string,
  layerId: string,
  node: TemplateNodeV3,
  atIndex?: number,
): TemplateContentV3 {
  return runCore(content, "invalid_node", core => addNodeV2(core, viewId, layerId, node as TemplateNodeV2, atIndex));
}

export function addBasicNodeV3(
  content: TemplateContentV3,
  viewId: string,
  layerId: string,
  kind: BasicNodeKindV3,
): [TemplateContentV3, string] {
  return runCoreTuple(content, "invalid_node", core => addBasicNodeV2(core, viewId, layerId, kind));
}

export function editNodeV3(
  content: TemplateContentV3,
  viewId: string,
  layerId: string,
  nodeId: string,
  changes: NodeEditV3,
): TemplateContentV3 {
  return runCore(content, "invalid_node", core => editNodeV2(core, viewId, layerId, nodeId, changes));
}

export function parameterizeNodeDimensionV3(
  content: TemplateContentV3,
  viewId: string,
  layerId: string,
  nodeId: string,
  dimension: ParameterizableNodeDimensionV3,
  input: ParameterizeNodeDimensionV3Input,
): [TemplateContentV3, string] {
  return runCoreTuple(content, "invalid_parameterized_dimension", core =>
    parameterizeNodeDimensionV2(core, viewId, layerId, nodeId, dimension, input));
}

export function setTemplateParameterDefaultV3(content: TemplateContentV3, parameterId: string, value: number): TemplateContentV3 {
  return runCore(content, "invalid_parameter_default", core => setTemplateParameterDefaultV2(core, parameterId, value));
}

export function setNodeLockedV3(
  content: TemplateContentV3,
  viewId: string,
  layerId: string,
  nodeId: string,
  locked: boolean,
): TemplateContentV3 {
  return runCore(content, "invalid_node", core => setNodeLockedV2(core, viewId, layerId, nodeId, locked));
}

export function moveNodeV3(
  content: TemplateContentV3,
  viewId: string,
  layerId: string,
  nodeId: string,
  deltaX: number,
  deltaY: number,
): TemplateContentV3 {
  return runCore(content, "invalid_node", core => moveNodeV2(core, viewId, layerId, nodeId, deltaX, deltaY));
}

export function deleteNodeV3(content: TemplateContentV3, viewId: string, layerId: string, nodeId: string): TemplateContentV3 {
  return runCore(content, "invalid_node_delete", core => deleteNodeV2(core, viewId, layerId, nodeId));
}

export function reorderNodeV3(
  content: TemplateContentV3,
  viewId: string,
  layerId: string,
  nodeId: string,
  toIndex: number,
): TemplateContentV3 {
  return runCore(content, "invalid_node", core => reorderNodeV2(core, viewId, layerId, nodeId, toIndex));
}
