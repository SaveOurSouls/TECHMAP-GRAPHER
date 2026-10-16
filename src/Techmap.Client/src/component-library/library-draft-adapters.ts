import { type TemplateContentV3 as TemplateContentV2 } from "./template-model-v3";
import { type Draft } from "./library-editor-types";
import {
  newTemplateContentV3 as newTemplateContentV2,
  addContactTypeGroupV3,
  addArticleVariantsV3,
  setArticleVariantContactGroupV3,
  upsertArticleVariantV3,
} from "./template-commands-v3";
import { createE4ConnectorSeriesTableFromV3, type E4ConnectorSeriesTable } from "./e4-connector-series-table";
import { readLibraryDraftRecovery } from "./library-draft-recovery";
import { type TemplateContentV4 } from "./template-model-v4";
import { type ArticleBinding } from "./component-template-api";
import { articleIdentity } from "./library-catalog-adapters";
import { type TerminalContactTypeBindingV5 } from "./template-model-v5";
import { type NewArticleVariantV3Input } from "./TemplateSeriesPanelV3";

export const TEMPLATE_UNDO_LIMIT = 100;
export function pushTemplateUndo(stack: readonly TemplateContentV2[], current: TemplateContentV2): TemplateContentV2[] {
  return [...stack.slice(-(TEMPLATE_UNDO_LIMIT - 1)), current];
}
export const newDraft = (): Draft => {
  const content = newTemplateContentV2();
  return { articleDrawings: [], drawingContactBindings: [], templateId: null, version: 0, draftRevision: 0, code: "", name: "Новый компонент", assets: [], content, compatibleTerminalArticleKeys: [], compatibleSeals: [], terminalContactTypeBindings: [], e4ConnectorTable: createE4ConnectorSeriesTableFromV3(content) };
};
export function loadLibraryRecovery() {
  try { return typeof window === "undefined" ? null : readLibraryDraftRecovery(window.localStorage); }
  catch { return null; }
}
export const firstLayerIds = (content: TemplateContentV2) => Object.fromEntries(content.views.map(view => [view.id, view.layers[0]!.id]));
export const errorText = (error: unknown) => error instanceof Error ? error.message : "Неизвестная ошибка.";
export function reconcileE4ConnectorTable(content: TemplateContentV2, previous?: E4ConnectorSeriesTable): E4ConnectorSeriesTable {
  const next = createE4ConnectorSeriesTableFromV3(content, true);
  if (!previous) return next;
  const previousDefaults = new Map(previous.seriesDefaults.map(row => [row.rowId, row]));
  const previousArticles = new Map(previous.articles.map(article => [article.articleVariantId, article]));
  return {
    ...next,
    columns: next.columns.map(column => previous.columns.find(item => item.id === column.id) ?? column),
    seriesDefaults: next.seriesDefaults.map(row => {
      const old = previousDefaults.get(row.rowId);
      return old && (old.values.contactTypeGroupId === null || content.contactTypeGroups.some(group => group.id === old.values.contactTypeGroupId)) ? old : row;
    }),
    articles: next.articles.map(article => {
      const old = previousArticles.get(article.articleVariantId);
      if (!old) return article;
      const oldRows = new Map(old.rows.map(row => [row.seriesRowId, row]));
      return { ...article, rows: article.rows.map(row => {
        const oldRow = oldRows.get(row.seriesRowId);
        return oldRow && (oldRow.overrides.contactTypeGroupId == null || content.contactTypeGroups.some(group => group.id === oldRow.overrides.contactTypeGroupId)) ? oldRow : row;
      }) };
    }),
  };
}
export function v3CoreFromV4(content: TemplateContentV4): TemplateContentV2 {
  const { schemaVersion: _schemaVersion, e4ConnectorTable: _table, ...core } = content;
  return { schemaVersion: 3, ...structuredClone(core) };
}
export function compatibleTerminalsFromV3(content: TemplateContentV2): ArticleBinding[] {
  const result: ArticleBinding[] = [], seen = new Set<string>();
  for (const terminal of content.articleVariants.flatMap(variant =>
    (variant.contactGroups ?? []).flatMap(group => group.allowedTerminalArticleKeys))) {
    const identity = articleIdentity(terminal);
    if (!seen.has(identity)) { seen.add(identity); result.push({ ...terminal }); }
  }
  return result;
}
export function applySeriesTerminalsToEditor(
  content: TemplateContentV2,
  table: E4ConnectorSeriesTable,
  terminals: readonly ArticleBinding[],
  bindings: readonly TerminalContactTypeBindingV5[] | null = null,
  updateStandards = false,
): { content: TemplateContentV2; table: E4ConnectorSeriesTable } {
  const allowed = new Set(terminals.map(articleIdentity));
  const terminalsForGroup = (groupId: string) => terminals.filter(terminal =>
    bindings === null || bindings.some(binding => binding.contactTypeGroupId === groupId &&
      articleIdentity(binding.terminalArticleKey) === articleIdentity(terminal)));
  const terminalAllowedForGroup = (terminal: ArticleBinding | null, groupId: string | null) => terminal === null ||
    (allowed.has(articleIdentity(terminal)) && (bindings === null || (groupId !== null && bindings.some(binding =>
      binding.contactTypeGroupId === groupId && articleIdentity(binding.terminalArticleKey) === articleIdentity(terminal)))));
  const defaultsById = new Map(table.seriesDefaults.map(row => [row.rowId, row.values]));
  return {
    content: {
      ...content,
      articleVariants: content.articleVariants.map(variant => ({
        ...variant,
        contactGroups: variant.contactGroups?.map(group => ({
          ...group,
          allowedTerminalArticleKeys: terminalsForGroup(group.contactTypeGroupId).map(item => ({ ...item })),
        })) ?? null,
      })),
    },
    table: {
      ...table,
      seriesDefaults: table.seriesDefaults.map(row => ({
        ...row,
        values: {
          ...row.values,
          standardTerminalArticleKey: !updateStandards || bindings === null
            ? (terminalAllowedForGroup(row.values.standardTerminalArticleKey, row.values.contactTypeGroupId) ? row.values.standardTerminalArticleKey : null)
            : bindings.find(binding => binding.standard && binding.contactTypeGroupId === row.values.contactTypeGroupId)?.terminalArticleKey ?? null,
        },
      })),
      articles: table.articles.map(article => ({
        ...article,
        contactGroups: article.contactGroups.map(group => ({
          ...group,
          allowedTerminalArticleKeys: terminalsForGroup(group.contactTypeGroupId).map(item => ({ ...item })),
        })),
        rows: article.rows.map(row => ({
          ...row,
          overrides: row.overrides.standardTerminalArticleKey !== undefined &&
            !terminalAllowedForGroup(row.overrides.standardTerminalArticleKey ?? null,
              row.overrides.contactTypeGroupId ?? defaultsById.get(row.seriesRowId)?.contactTypeGroupId ?? null)
            ? { ...row.overrides, standardTerminalArticleKey: null }
            : row.overrides,
        })),
      })),
    },
  };
}
/** XX sets the first contact type count; other groups remain operator-controlled. */
export function addSeriesArticles(content: TemplateContentV2, inputs: readonly NewArticleVariantV3Input[]): TemplateContentV2 {
  let base = content;
  if (inputs.some(input => input.contactCount !== undefined) && !base.contactTypeGroups.length)
    [base] = addContactTypeGroupV3(base, "Сигнальные");
  let next = addArticleVariantsV3(base, inputs);
  inputs.forEach((input, index) => {
    if (input.contactCount === undefined) return;
    const variant = next.articleVariants[base.articleVariants.length + index]!;
    next = setArticleVariantContactGroupV3(next, variant.id, base.contactTypeGroups[0]!.id, input.contactCount, []);
  });
  return next;
}
export function shouldAutoSaveTemplate(input: {
  readonly dirty: boolean;
  readonly failed: boolean;
  readonly busy: boolean;
  readonly assetMismatch: boolean;
  readonly code: string;
  readonly name: string;
}): boolean {
  return input.dirty && !input.failed && !input.busy && !input.assetMismatch &&
    Boolean(input.code.trim()) && Boolean(input.name.trim());
}
/**
 * Old template envelopes used articleBindings as their lookup index. During the
 * explicit v1/v2 upgrade those identities become legacy v3 variants. From v3
 * onward articleVariants is the sole editable authority and the envelope index
 * is derived when the immutable version is saved.
 */
export function addLegacyArticleBindingsToV3(content: TemplateContentV2, bindings: readonly ArticleBinding[]): TemplateContentV2 {
  let next = content;
  const known = new Set(next.articleVariants.map(articleIdentity));
  for (const binding of bindings) {
    if (known.has(articleIdentity(binding))) continue;
    [next] = upsertArticleVariantV3(next, binding);
    known.add(articleIdentity(binding));
  }
  return next;
}
export function articleBindingsFromTemplateV3(content: TemplateContentV2): ArticleBinding[] {
  return content.articleVariants.map(({ sourceId, entityType, articleKey }) => ({ sourceId, entityType, articleKey }));
}
