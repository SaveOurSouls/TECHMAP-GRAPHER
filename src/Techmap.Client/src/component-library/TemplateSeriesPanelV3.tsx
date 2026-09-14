import { useEffect, useState, type FormEvent } from "react";
import type { ArticleKeyV3, TemplateContentV3 } from "./template-model-v3";
import { articleContactCountIssueV3, articleContactCountRuleV3 } from "./template-model-v3";
import { materializeArticleContactRowsV3 } from "./template-article-contact-rows-v3";
import "./TemplateSeriesPanelV3.css";

export interface NewArticleVariantV3Input {
  readonly sourceId: string;
  readonly entityType: string;
  readonly articleKey: string;
}

export interface TemplateSeriesPanelV3Props {
  readonly content: TemplateContentV3;
  readonly selectedArticleVariantId?: string | null;
  readonly articlePreviewMessage?: string | null;
  readonly articlePreviewError?: string | null;
  readonly articlePreviewRows?: readonly {
    readonly key: string;
    readonly number: string;
    readonly name: string;
    readonly circuitText: string | null;
    readonly contactTypeGroupId: string | null;
  }[];
  readonly onSelectArticleVariant?: (variantId: string | null) => void;
  readonly onAddContactTypeGroup: (name: string) => void;
  readonly onRenameContactTypeGroup: (groupId: string, name: string) => void;
  readonly onDeleteContactTypeGroup: (groupId: string) => void;
  readonly onAddArticleVariant: (input: NewArticleVariantV3Input) => void;
  readonly onUpdateArticleVariant?: (variantId: string, input: NewArticleVariantV3Input) => void;
  readonly onDeleteArticleVariant: (variantId: string) => void;
  readonly onSetArticleContactGroup: (
    variantId: string,
    contactTypeGroupId: string,
    contactCount: number,
    allowedTerminalArticleKeys: readonly ArticleKeyV3[],
  ) => void;
  readonly onRemoveArticleContactGroup: (variantId: string, contactTypeGroupId: string) => void;
}

export function parseTerminalArticleKeysV3(value: string): readonly ArticleKeyV3[] | null {
  const rows: string[][] = [[]];
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (escaped) {
      if (character === "\\" || character === "|" || character === ";") rows.at(-1)!.push(character);
      else rows.at(-1)!.push("\\", character);
      escaped = false;
    } else if (character === "\\") escaped = true;
    else if (character === "|") rows.push([]);
    else if (character === ";" || character === "\n") rows.push([]);
    else if (character !== "\r") rows.at(-1)!.push(character);
  }
  if (escaped) rows.at(-1)!.push("\\");
  const lines = rows.map(part => part.join("").trim()).filter(Boolean);
  if (lines.length % 3 !== 0) return null;
  const result: ArticleKeyV3[] = [], seen = new Set<string>();
  for (let index = 0; index < lines.length; index += 3) {
    const parts = lines.slice(index, index + 3);
    if (parts.some(part => part.length > 512 || /[\u0000-\u001f]/.test(part))) return null;
    const key = { sourceId: parts[0]!, entityType: parts[1]!, articleKey: parts[2]! };
    if (key.sourceId.length > 128 || key.entityType.length > 64) return null;
    const identity = `${key.sourceId}\0${key.entityType}\0${key.articleKey}`;
    if (seen.has(identity)) return null;
    seen.add(identity); result.push(key);
  }
  return result;
}

export function formatTerminalArticleKeysV3(keys: readonly ArticleKeyV3[]): string {
  const escape = (value: string) => value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/;/g, "\\;");
  return keys.map(key => `${escape(key.sourceId)}|${escape(key.entityType)}|${escape(key.articleKey)}`).join("\n");
}

export interface TerminalArticleKeyPatchV3 {
  readonly sourceId?: string;
  readonly entityType?: string;
  readonly articleKey?: string;
}

/** Updates one structured terminal row and returns null while it is incomplete or duplicated. */
export function updateTerminalArticleKeyV3(
  keys: readonly ArticleKeyV3[],
  index: number,
  patch: TerminalArticleKeyPatchV3,
): readonly ArticleKeyV3[] | null {
  if (!Number.isSafeInteger(index) || index < 0 || index >= keys.length) return null;
  const current = keys[index]!;
  const next = {
    sourceId: (patch.sourceId ?? current.sourceId).trim(),
    entityType: (patch.entityType ?? current.entityType).trim(),
    articleKey: (patch.articleKey ?? current.articleKey).trim(),
  };
  if (!next.sourceId || !next.entityType || !next.articleKey || next.sourceId.length > 128 || next.entityType.length > 64 || next.articleKey.length > 512 ||
      [next.sourceId, next.entityType, next.articleKey].some(value => /[\u0000-\u001f]/.test(value))) return null;
  const identity = `${next.sourceId}\0${next.entityType}\0${next.articleKey}`;
  if (keys.some((key, candidateIndex) => candidateIndex !== index && `${key.sourceId}\0${key.entityType}\0${key.articleKey}` === identity)) return null;
  return keys.map((key, candidateIndex) => candidateIndex === index ? next : { ...key });
}

export function appendTerminalArticleKeyV3(
  keys: readonly ArticleKeyV3[],
  value: ArticleKeyV3,
): readonly ArticleKeyV3[] | null {
  const next = updateTerminalArticleKeyV3([...keys, { sourceId: "", entityType: "", articleKey: "" }], keys.length, value);
  return next;
}

export interface ArticleContactGroupEditorValueV3 {
  readonly contactCount: number;
  readonly inherited: boolean;
  readonly configured: boolean;
  readonly allowedTerminalArticleKeys: readonly ArticleKeyV3[];
}

export function articleContactGroupEditorValueV3(
  content: TemplateContentV3,
  variantId: string,
  groupId: string,
): ArticleContactGroupEditorValueV3 {
  const variant = content.articleVariants.find(candidate => candidate.id === variantId);
  const configured = variant?.contactGroups?.find(group => group.contactTypeGroupId === groupId);
  if (configured) return {
    contactCount: configured.contactCount,
    inherited: false,
    configured: true,
    allowedTerminalArticleKeys: configured.allowedTerminalArticleKeys,
  };
  if (!variant || variant.contactGroups !== null)
    return { contactCount: 0, inherited: false, configured: false, allowedTerminalArticleKeys: [] };
  try {
    return {
      contactCount: materializeArticleContactRowsV3(content, variant)
        .filter(row => row.contactTypeGroupId === groupId).length,
      inherited: true,
      configured: false,
      allowedTerminalArticleKeys: [],
    };
  } catch {
    return { contactCount: 0, inherited: true, configured: false, allowedTerminalArticleKeys: [] };
  }
}

export function articleContactGroupCountHelpV3(
  content: TemplateContentV3,
  groupId: string,
  requested: number,
  inherited: boolean,
): { readonly text: string; readonly invalid: boolean } {
  const issue = inherited ? null : articleContactCountIssueV3(content, groupId, requested);
  if (issue) return { text: issue, invalid: true };
  const rule = articleContactCountRuleV3(content, groupId);
  const source = rule.repeatStrides.length === 0
    ? `Сейчас допустимо только значение ${rule.fixedContactCount}. Другое количество требует прототипа контакта и домена повтора этой группы.`
    : rule.repeatStrides.length === 1
      ? `Итог состоит из ${rule.fixedContactCount} фиксированных контактов и повторяемого сегмента по ${rule.repeatStrides[0]} контакта.`
      : "Для группы найдено несколько доменов повтора; перед сохранением оставьте один.";
  return {
    text: inherited ? `Количество наследуется из шаблона. ${source}` : source,
    invalid: rule.repeatStrides.length > 1,
  };
}

function GroupNameEditor({ id, name, onRename, onDelete }: {
  readonly id: string; readonly name: string;
  readonly onRename: (id: string, name: string) => void;
  readonly onDelete: (id: string) => void;
}) {
  const [value, setValue] = useState(name);
  useEffect(() => setValue(name), [id, name]);
  const save = () => { const normalized = value.trim(); if (normalized && normalized !== name) onRename(id, normalized); else setValue(name); };
  return <li>
    <input aria-label={`Название группы ${name}`} value={value} onChange={event => setValue(event.target.value)} onBlur={save} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); save(); } }} />
    <button type="button" onClick={() => onDelete(id)} aria-label={`Удалить группу ${name}`}>×</button>
  </li>;
}

function VariantGroupEditor({ content, variantId, groupId, onSet, onRemove }: {
  readonly content: TemplateContentV3; readonly variantId: string; readonly groupId: string;
  readonly onSet: TemplateSeriesPanelV3Props["onSetArticleContactGroup"];
  readonly onRemove: TemplateSeriesPanelV3Props["onRemoveArticleContactGroup"];
}) {
  const variant = content.articleVariants.find(item => item.id === variantId)!;
  const group = content.contactTypeGroups.find(item => item.id === groupId)!;
  const editor = articleContactGroupEditorValueV3(content, variantId, groupId);
  const count = String(editor.contactCount);
  const configuredTerminals = editor.allowedTerminalArticleKeys;
  const parsedCount = editor.contactCount;
  const countHelp = articleContactGroupCountHelpV3(
    content,
    groupId,
    editor.contactCount,
    editor.inherited,
  );
  const setCountValue = (value: string) => {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 2_000)
      onSet(variant.id, group.id, parsed, configuredTerminals);
  };
  const setTerminalField = (index: number, patch: TerminalArticleKeyPatchV3) => {
    const next = updateTerminalArticleKeyV3(configuredTerminals, index, patch);
    if (next) onSet(variant.id, group.id, parsedCount, next);
  };
  const removeTerminal = (index: number) => {
    const next = configuredTerminals.filter((_, candidateIndex) => candidateIndex !== index);
    onSet(variant.id, group.id, parsedCount, next);
  };
  const addTerminal = () => {
    const next = appendTerminalArticleKeyV3(configuredTerminals, { sourceId: "БД.ТЕР", entityType: "terminal", articleKey: `Новый-${configuredTerminals.length + 1}` });
    if (next) onSet(variant.id, group.id, parsedCount, next);
  };
  return <section className={editor.configured ? "series-v3-contact-group configured" : "series-v3-contact-group"} aria-label={`Группа ${group.name} артикула ${variant.articleKey}`}>
    <header><strong>{group.name}</strong><span>{editor.inherited ? "наследуется из шаблона" : editor.configured ? "собственная настройка" : "не включена в артикул"}</span></header>
    <label>Итоговое количество контактов {editor.inherited ? "(наследуемое)" : ""}<input type="number" min="0" max="2000" step="1" value={count} aria-invalid={countHelp.invalid || undefined} aria-describedby={`contact-count-help-${variant.id}-${group.id}`} onChange={event => setCountValue(event.target.value)} /></label>
    <small id={`contact-count-help-${variant.id}-${group.id}`} role={countHelp.invalid ? "alert" : undefined}>{countHelp.text}</small>
    <div className="series-v3-terminal-heading"><strong>Допустимые терминалы</strong><button type="button" aria-label={`Добавить терминал для группы ${group.name} артикула ${variant.articleKey}`} onClick={addTerminal}>+ Терминал</button></div>
    {configuredTerminals.length === 0 && <small>Терминалы не заданы.</small>}
    <div className="series-v3-terminal-list">
      {configuredTerminals.map((terminal, index) => {
        return <div className="series-v3-terminal-row" key={`${variant.id}-${group.id}-${index}`}>
          <label>Источник<input aria-label={`Источник терминала ${index + 1}`} value={terminal.sourceId} onChange={event => setTerminalField(index, { sourceId: event.target.value })} /></label>
          <label>Тип<input aria-label={`Тип терминала ${index + 1}`} value={terminal.entityType} onChange={event => setTerminalField(index, { entityType: event.target.value })} /></label>
          <label>Артикул<input aria-label={`Артикул терминала ${index + 1}`} value={terminal.articleKey} onChange={event => setTerminalField(index, { articleKey: event.target.value })} /></label>
          <button type="button" className="series-v3-remove-terminal" aria-label={`Удалить терминал ${index + 1}`} onClick={() => removeTerminal(index)}>×</button>
        </div>;
      })}
    </div>
    {editor.configured && <button type="button" aria-label={`Убрать собственную настройку группы ${group.name} артикула ${variant.articleKey}`} onClick={() => onRemove(variant.id, group.id)}>Убрать собственную настройку</button>}
  </section>;
}

function VariantIdentityEditor({ variant, onUpdate }: {
  readonly variant: TemplateContentV3["articleVariants"][number];
  readonly onUpdate?: TemplateSeriesPanelV3Props["onUpdateArticleVariant"];
}) {
  const [sourceId, setSourceId] = useState(variant.sourceId);
  const [entityType, setEntityType] = useState(variant.entityType);
  const [articleKey, setArticleKey] = useState(variant.articleKey);
  useEffect(() => {
    setSourceId(variant.sourceId);
    setEntityType(variant.entityType);
    setArticleKey(variant.articleKey);
  }, [variant.id, variant.sourceId, variant.entityType, variant.articleKey]);
  const save = () => {
    const input = { sourceId: sourceId.trim(), entityType: entityType.trim(), articleKey: articleKey.trim() };
    if (!onUpdate || !input.sourceId || !input.entityType || !input.articleKey) return;
    if (input.sourceId !== variant.sourceId || input.entityType !== variant.entityType || input.articleKey !== variant.articleKey)
      onUpdate(variant.id, input);
  };
  return <div className="series-v3-variant-identity">
    <label>Источник<input value={sourceId} onChange={event => setSourceId(event.target.value)} onBlur={save} /></label>
    <label>Тип<input value={entityType} onChange={event => setEntityType(event.target.value)} onBlur={save} /></label>
    <label>Артикул<input value={articleKey} onChange={event => setArticleKey(event.target.value)} onBlur={save} /></label>
  </div>;
}

export function TemplateSeriesPanelV3(props: TemplateSeriesPanelV3Props) {
  const [groupName, setGroupName] = useState("");
  const [sourceId, setSourceId] = useState("БД.СОЕД");
  const [entityType, setEntityType] = useState("connector");
  const [articleKey, setArticleKey] = useState("");
  const addGroup = (event: FormEvent) => { event.preventDefault(); const name = groupName.trim(); if (!name) return; props.onAddContactTypeGroup(name); setGroupName(""); };
  const addVariant = (event: FormEvent) => {
    event.preventDefault();
    const input = { sourceId: sourceId.trim(), entityType: entityType.trim(), articleKey: articleKey.trim() };
    if (!input.sourceId || !input.entityType || !input.articleKey) return;
    props.onAddArticleVariant(input); setArticleKey("");
  };
  return <details className="template-series-v3">
    <summary>Серия и артикулы <span>{props.content.articleVariants.length}</span></summary>
    <div className="template-series-v3-body">
      <details className="series-v3-guide">
        <summary>Как заполнить шаблон</summary>
        <ol aria-label="Порядок заполнения шаблона">
          <li>Создайте группы контактов.</li>
          <li>В виде Э4 создайте логический контакт-прототип и назначьте ему группу. Нарисуйте один примитив строки, выделите его и сделайте повторяемым с параметром количества. В виде Чертеж разместите связанную точку, выделите один примитив-прототип и разместите существующий повтор в этом виде.</li>
          <li>Добавьте артикулы и задайте количество контактов в каждой группе.</li>
          <li>Укажите допустимые терминалы для групп артикула.</li>
          <li>Выберите конкретный артикул для предпросмотра.</li>
          <li>Проверьте виды Э4 и Чертеж для выбранного артикула.</li>
          <li>Создайте новую версию.</li>
        </ol>
        <p>Если повтор не задан, количество контактов артикула может быть только фактическим числом фиксированных контактов шаблона.</p>
      </details>
      <section className="series-v3-preview" aria-label="Предпросмотр артикула серии">
        <label>Артикул для предпросмотра<select value={props.selectedArticleVariantId ?? ""} onChange={event => props.onSelectArticleVariant?.(event.target.value || null)}>
          <option value="">Параметры шаблона</option>
          {props.content.articleVariants.map(variant => <option key={variant.id} value={variant.id}>{variant.articleKey}</option>)}
        </select></label>
        {props.articlePreviewError ? <p className="series-v3-preview-error" role="alert">{props.articlePreviewError}</p>
          : props.articlePreviewMessage ? <p className="series-v3-preview-status" role="status">{props.articlePreviewMessage}</p>
            : <p>Выберите артикул, чтобы проверить число строк и геометрию всех видов.</p>}
        {props.articlePreviewRows && props.articlePreviewRows.length > 0 && <div className="series-v3-preview-table-wrap">
          <div className="series-v3-preview-rows" role="table" aria-label="Материализованные строки контактов">
            <div role="rowgroup"><div role="row"><strong role="columnheader">№</strong><strong role="columnheader">Группа</strong><strong role="columnheader">Цепь / имя</strong></div></div>
            <div role="rowgroup">{props.articlePreviewRows.slice(0, 12).map(row => <div role="row" key={row.key}>
              <span role="cell">{row.number}</span>
              <span role="cell">{props.content.contactTypeGroups.find(group => group.id === row.contactTypeGroupId)?.name ?? "—"}</span>
              <span role="cell">{row.circuitText || row.name}</span>
            </div>)}</div>
          </div>
          {props.articlePreviewRows.length > 12 && <small>Показаны 12 из {props.articlePreviewRows.length}</small>}
        </div>}
      </section>
      <section className="series-v3-groups" aria-label="Группы типов контактов">
        <header><strong>Группы контактов</strong><small>Сигнальные, силовые и другие типы серии</small></header>
        <form onSubmit={addGroup}><input value={groupName} onChange={event => setGroupName(event.target.value)} placeholder="Например, сигнальные" aria-label="Название новой группы контактов" /><button type="submit" disabled={!groupName.trim()}>+ Группа</button></form>
        {props.content.contactTypeGroups.length ? <ul>{props.content.contactTypeGroups.map(group => <GroupNameEditor key={group.id} id={group.id} name={group.name} onRename={props.onRenameContactTypeGroup} onDelete={props.onDeleteContactTypeGroup} />)}</ul> : <p>Группы ещё не созданы.</p>}
      </section>
      <section className="series-v3-variants" aria-label="Артикулы серии">
        <header><strong>Артикулы серии</strong><small>Каждый артикул задаёт число контактов по группам</small></header>
        <form className="series-v3-add-variant" onSubmit={addVariant}>
          <label>Источник<input value={sourceId} onChange={event => setSourceId(event.target.value)} /></label>
          <label>Тип<input value={entityType} onChange={event => setEntityType(event.target.value)} /></label>
          <label>Артикул<input value={articleKey} onChange={event => setArticleKey(event.target.value)} placeholder="B2B-XH-A" /></label>
          <button type="submit" disabled={!sourceId.trim() || !entityType.trim() || !articleKey.trim()}>+ Артикул</button>
        </form>
        {props.content.articleVariants.length ? <div className="series-v3-variant-list">{props.content.articleVariants.map(variant => <article key={variant.id} className={variant.id === props.selectedArticleVariantId ? "series-v3-variant selected" : "series-v3-variant"}>
          <header><VariantIdentityEditor variant={variant} onUpdate={props.onUpdateArticleVariant} /><button type="button" aria-label={`Удалить артикул ${variant.articleKey}`} onClick={() => props.onDeleteArticleVariant(variant.id)}>×</button></header>
          {!props.content.contactTypeGroups.length && <p>Сначала создайте хотя бы одну группу контактов.</p>}
          {props.content.contactTypeGroups.map(group => <VariantGroupEditor key={group.id} content={props.content} variantId={variant.id} groupId={group.id} onSet={props.onSetArticleContactGroup} onRemove={props.onRemoveArticleContactGroup} />)}
        </article>)}</div> : <p>Артикулы серии ещё не добавлены.</p>}
      </section>
    </div>
  </details>;
}
