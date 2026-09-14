import { useCallback, useEffect, useMemo, useState } from "react";
import type { LocalSession } from "../local-session";
import type { RuntimeConfig } from "../runtime-config";
import { createComponentTemplateApi, type ArticleBinding, type ComponentTemplate, type ComponentTemplateSummary, type TemplateAsset } from "./component-template-api";
import { readTemplateAsset } from "./template-assets";
import { TemplateCanvas } from "./TemplateCanvas";
import {
  addContactPoint, addPrimitive, addView, newTemplateContent, updateView, validateTemplate,
  recordTemplateUndo, type ContactDirection, type PrimitiveKind, type TemplateContent,
} from "./template-model";
import "./component-library.css";

interface Props { config: RuntimeConfig; session: LocalSession; }
interface Draft { templateId: string | null; version: number; code: string; name: string; articleBindings: ArticleBinding[]; assets: TemplateAsset[]; content: TemplateContent; }
const newDraft = (): Draft => ({ templateId: null, version: 0, code: "", name: "Новый компонент", articleBindings: [], assets: [], content: newTemplateContent() });
const errorText = (error: unknown) => error instanceof Error ? error.message : "Неизвестная ошибка.";
export const isTemplateUndoShortcut = (event: Pick<KeyboardEvent, "ctrlKey" | "metaKey" | "key">) =>
  (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z";

export function ComponentLibrary({ config, session }: Props) {
  const api = useMemo(() => createComponentTemplateApi(config, session), [config, session]);
  const [items, setItems] = useState<readonly ComponentTemplateSummary[]>([]);
  const [draft, setDraft] = useState<Draft>(() => newDraft());
  const [viewId, setViewId] = useState(() => draft.content.views[0]!.id);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<TemplateContent[]>([]);
  const [dirty, setDirty] = useState(true);
  const [binding, setBinding] = useState<ArticleBinding>({ sourceId: "", entityType: "connector", articleKey: "" });
  const activeView = draft.content.views.find(v => v.id === viewId) ?? draft.content.views[0];
  const primitive = activeView?.primitives.find(item => item.id === selectedId);
  const contact = activeView?.contactPoints.find(item => item.id === selectedId);

  async function loadList() {
    try { setItems(await api.list()); setError(null); } catch (e) { setError(errorText(e)); }
  }
  useEffect(() => { void loadList(); }, [api]);
  async function open(summary: ComponentTemplateSummary) {
    setBusy(true);
    try {
      const item = await api.get(summary.templateId);
      setDraft({ templateId: item.templateId, version: item.version, code: item.code, name: item.name, articleBindings: [...item.articleBindings], assets: [...item.assets], content: structuredClone(item.content) });
      setViewId(item.content.views[0]!.id); setSelectedId(null); setUndoStack([]); setDirty(false); setError(null); setSaved(null);
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  function startNew() { const next = newDraft(); setDraft(next); setViewId(next.content.views[0]!.id); setSelectedId(null); setUndoStack([]); setDirty(true); setError(null); setSaved(null); }
  function markDirty() { setDirty(true); setSaved(null); }
  function changeContent(content: TemplateContent) { setUndoStack(stack => recordTemplateUndo(stack, draft.content, content)); setDraft(current => ({ ...current, content })); markDirty(); }
  function previewContent(content: TemplateContent) { setDraft(current => ({ ...current, content })); markDirty(); }
  function commitDraggedContent(before: TemplateContent, after: TemplateContent) {
    setUndoStack(stack => recordTemplateUndo(stack, before, after));
  }
  const undo = useCallback(() => {
    setUndoStack(stack => {
      const previous = stack.at(-1);
      if (!previous) return stack;
      setDraft(current => ({ ...current, content: previous }));
      setSelectedId(null); markDirty();
      return stack.slice(0, -1);
    });
  }, []);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (isTemplateUndoShortcut(event)) { event.preventDefault(); undo(); }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [undo]);
  async function persistDraft(): Promise<ComponentTemplate | null> {
    const validation = !draft.code.trim() || !draft.name.trim() ? "Заполните код и название шаблона." : validateTemplate(draft.content);
    if (validation) { setError(validation); return null; }
    const body = { code: draft.code.trim(), name: draft.name.trim(), articleBindings: draft.articleBindings, content: draft.content };
    const result = draft.templateId ? await api.save(draft.templateId, { expectedVersion: draft.version, ...body }) : await api.create(body);
    return result;
  }
  function applyPersisted(result: ComponentTemplate) {
    setDraft({ templateId: result.templateId, version: result.version, code: result.code, name: result.name, articleBindings: [...result.articleBindings], assets: [...result.assets], content: structuredClone(result.content) });
    setDirty(false); setSaved(`Сохранена версия ${result.version}`); setError(null);
  }
  async function save() {
    setBusy(true);
    try {
      const result = await persistDraft();
      if (result) { applyPersisted(result); await loadList(); }
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  async function addAsset(file: File) {
    setBusy(true);
    try {
      let persisted: ComponentTemplate | null = null;
      const mustPersist = !draft.templateId || dirty;
      if (mustPersist) persisted = await persistDraft();
      if (mustPersist && !persisted) return;
      if (persisted) applyPersisted(persisted);
      const templateId = persisted?.templateId ?? draft.templateId!;
      const expectedVersion = persisted?.version ?? draft.version;
      const result = await api.addAsset(templateId, { expectedVersion, ...await readTemplateAsset(file) });
      applyPersisted(result); await loadList();
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  async function removeAsset(assetId: string) {
    if (!draft.templateId) return;
    setBusy(true);
    try {
      let persisted: ComponentTemplate | null = null;
      if (dirty) {
        persisted = await persistDraft();
        if (!persisted) return;
        applyPersisted(persisted);
      }
      const templateId = persisted?.templateId ?? draft.templateId;
      const expectedVersion = persisted?.version ?? draft.version;
      const result = await api.removeAsset(templateId, assetId, expectedVersion);
      applyPersisted(result); await loadList();
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  function appendPrimitive(kind: PrimitiveKind) { if (!activeView) return; const [content, id] = addPrimitive(draft.content, activeView.id, kind); changeContent(content); setSelectedId(id); }
  function appendContact() { if (!activeView) return; const [content, id] = addContactPoint(draft.content, activeView.id); changeContent(content); setSelectedId(id); }
  function editPrimitive(patch: Record<string, string | number>) {
    if (!primitive || !activeView) return;
    changeContent(updateView(draft.content, activeView.id, view => ({ ...view, primitives: view.primitives.map(item => item.id === primitive.id ? { ...item, ...patch } : item) })));
  }
  function editContact(patch: Record<string, string | number>) {
    if (!contact || !activeView) return;
    changeContent(updateView(draft.content, activeView.id, view => ({ ...view, contactPoints: view.contactPoints.map(item => item.id === contact.id ? { ...item, ...patch } : item) })));
  }
  function deleteSelection() {
    if (!selectedId || !activeView) return;
    changeContent(updateView(draft.content, activeView.id, view => ({ ...view, primitives: view.primitives.filter(i => i.id !== selectedId), contactPoints: view.contactPoints.filter(i => i.id !== selectedId) })));
    setSelectedId(null);
  }
  function deleteActiveView() {
    if (!activeView || activeView.kind !== "additional") return;
    const content = { ...draft.content, views: draft.content.views.filter(view => view.id !== activeView.id) };
    changeContent(content); setViewId(content.views[0]!.id); setSelectedId(null);
  }
  function addBinding() {
    const next = { sourceId: binding.sourceId.trim(), entityType: binding.entityType.trim(), articleKey: binding.articleKey.trim() };
    if (!next.sourceId || !next.entityType || !next.articleKey) { setError("Для связи заполните источник, тип записи и артикул."); return; }
    if (draft.articleBindings.some(item => item.sourceId === next.sourceId && item.entityType === next.entityType && item.articleKey === next.articleKey)) { setError("Такая связь с артикулом уже добавлена."); return; }
    setDraft(current => ({ ...current, articleBindings: [...current.articleBindings, next] }));
    setBinding(current => ({ ...current, articleKey: "" })); markDirty(); setError(null);
  }
  return <div className="component-library">
    <header className="content-heading library-heading"><div><p className="eyebrow">M2 · ГРАФИЧЕСКИЕ ШАБЛОНЫ</p><h1>Библиотека</h1><p>Виды Э4, чертежа и монтажные изображения хранятся отдельно от справочных характеристик.</p></div><button className="primary-action" type="button" onClick={startNew}>+ Новый шаблон</button></header>
    {error && <div className="error-banner" role="alert"><span>{error}</span><button onClick={() => setError(null)} aria-label="Закрыть">×</button></div>}
    {saved && <div className="success-banner" role="status"><span>{saved}. Размещённые ранее экземпляры сохранят закреплённую версию.</span><button onClick={() => setSaved(null)} aria-label="Закрыть">×</button></div>}
    <div className="library-layout">
      <aside className="library-catalog"><div className="panel-heading"><h2>Шаблоны</h2><button className="refresh-button" onClick={() => void loadList()} disabled={busy}>Обновить</button></div>
        <div className="library-template-list">{items.length ? items.map(item => <button key={item.templateId} className={item.templateId === draft.templateId ? "library-template selected" : "library-template"} onClick={() => void open(item)} disabled={busy}><strong>{item.code}</strong><span>{item.name}</span><small>версия {item.version}</small></button>) : <p className="panel-message">Создайте первый графический шаблон.</p>}</div>
      </aside>
      <section className="library-editor">
        <div className="library-metadata"><label>Код / серия<input value={draft.code} onChange={e => { setDraft(d => ({ ...d, code: e.target.value })); markDirty(); }} placeholder="Например, JST XH" /></label><label>Название<input value={draft.name} onChange={e => { setDraft(d => ({ ...d, name: e.target.value })); markDirty(); }} /></label><div><span>{draft.templateId ? `Версия ${draft.version}` : "Новый шаблон"}</span><button className="primary-action" onClick={() => void save()} disabled={busy}>{busy ? "Сохраняем…" : draft.templateId ? "Создать версию" : "Сохранить"}</button></div></div>
        <details className="library-bindings"><summary>Связи с артикулами <span>{draft.articleBindings.length}</span></summary><div className="binding-form"><label>Источник<input value={binding.sourceId} onChange={e => setBinding(current => ({ ...current, sourceId: e.target.value }))} placeholder="БД.СОЕД" /></label><label>Тип записи<input value={binding.entityType} onChange={e => setBinding(current => ({ ...current, entityType: e.target.value }))} /></label><label>Артикул<input value={binding.articleKey} onChange={e => setBinding(current => ({ ...current, articleKey: e.target.value }))} placeholder="B2B-XH-A" /></label><button className="secondary-action" type="button" onClick={addBinding}>Добавить связь</button></div>{draft.articleBindings.length > 0 && <div className="binding-list">{draft.articleBindings.map((item, index) => <span key={`${item.sourceId}/${item.entityType}/${item.articleKey}`}>{item.sourceId} · {item.entityType} · <strong>{item.articleKey}</strong><button type="button" aria-label={`Удалить связь ${item.articleKey}`} onClick={() => { setDraft(current => ({ ...current, articleBindings: current.articleBindings.filter((_, bindingIndex) => bindingIndex !== index) })); markDirty(); }}>×</button></span>)}</div>}</details>
        <details className="library-assets"><summary>Изображения <span>{draft.assets.length}</span></summary><div className="asset-upload"><label className={busy ? "disabled" : ""}>+ Загрузить PNG<input type="file" accept="image/png" disabled={busy} onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void addAsset(file); }} /></label><small>Изображение хранится в версии шаблона. Размещение на виде включается в формате v2.</small></div>{draft.assets.length > 0 && <div className="asset-list">{draft.assets.map(asset => <article key={asset.assetId}><div className="asset-preview">{draft.templateId && <img src={api.assetContentUrl(draft.templateId, draft.version, asset.assetId)} alt="" />}</div><div><strong>{asset.fileName}</strong><small>{asset.mediaType} · {(asset.sizeBytes / 1024).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} КиБ</small></div><button type="button" onClick={() => void removeAsset(asset.assetId)} disabled={busy} aria-label={`Удалить изображение ${asset.fileName}`}>×</button></article>)}</div>}</details>
        <div className="library-view-tabs" role="tablist">{draft.content.views.map(view => <button key={view.id} className={view.id === activeView?.id ? "active" : ""} onClick={() => { setViewId(view.id); setSelectedId(null); }}>{view.name}</button>)}<button onClick={() => { const content = addView(draft.content, ""); const view = content.views.at(-1)!; changeContent(content); setViewId(view.id); }}>+ Вид</button></div>
        <div className="library-tools"><span>Примитивы</span>{(["line", "rectangle", "ellipse", "text"] as const).map(kind => <button key={kind} onClick={() => appendPrimitive(kind)}>{({ line: "Линия", rectangle: "Прямоугольник", ellipse: "Эллипс", text: "Текст" })[kind]}</button>)}<button onClick={appendContact}>⊕ Точка контакта</button><button className="undo-tool" onClick={undo} disabled={undoStack.length === 0} title="Ctrl+Z">↶ Отменить</button></div>
        <div className="library-workarea">{activeView && <TemplateCanvas view={activeView} content={draft.content} selectedId={selectedId} onSelect={setSelectedId} onPreviewChange={previewContent} onDragCommit={commitDraggedContent} />}
          <aside className="library-properties"><h3>{primitive ? "Примитив" : contact ? "Точка контакта" : "Свойства вида"}</h3>
            {!primitive && !contact && activeView && <><label>Название вида<input value={activeView.name} onChange={e => changeContent(updateView(draft.content, activeView.id, v => ({ ...v, name: e.target.value })))} /></label>{activeView.kind === "additional" && <button className="danger-action" type="button" onClick={deleteActiveView}>Удалить дополнительный вид</button>}</>}
            {primitive && <><strong>{({ line: "Линия", rectangle: "Прямоугольник", ellipse: "Эллипс", text: "Текст" })[primitive.kind]}</strong><CoordinateFields x={primitive.x} y={primitive.y} width={primitive.width} height={primitive.height} onEdit={editPrimitive} />{primitive.kind === "text" && <label>Текст<input value={primitive.text} onChange={e => editPrimitive({ text: e.target.value })} /></label>}<label>Цвет<input type="color" value={primitive.color} onChange={e => editPrimitive({ color: e.target.value })} /></label></>}
            {contact && <><label>Имя<input value={contact.name} onChange={e => editContact({ name: e.target.value })} /></label><label>№ контакта<input value={contact.contactNumber} onChange={e => editContact({ contactNumber: e.target.value })} /></label><label>Направление<select value={contact.direction} onChange={e => editContact({ direction: e.target.value as ContactDirection })}><option value="left">Влево</option><option value="right">Вправо</option><option value="up">Вверх</option><option value="down">Вниз</option></select></label><CoordinateFields x={contact.x} y={contact.y} onEdit={editContact} /></>}
            {(primitive || contact) && <button className="danger-action" onClick={deleteSelection}>Удалить объект</button>}
          </aside>
        </div>
      </section>
    </div>
  </div>;
}

function CoordinateFields({ x, y, width, height, onEdit }: { x: number; y: number; width?: number; height?: number; onEdit: (patch: Record<string, number>) => void }) {
  const number = (key: string, value: string) => { const parsed = Number(value); if (Number.isFinite(parsed)) onEdit({ [key]: parsed }); };
  return <div className="coordinate-grid"><label>X<input type="number" value={x} onChange={e => number("x", e.target.value)} /></label><label>Y<input type="number" value={y} onChange={e => number("y", e.target.value)} /></label>{width !== undefined && <label>Ширина<input type="number" value={width} onChange={e => number("width", e.target.value)} /></label>}{height !== undefined && <label>Высота<input type="number" value={height} onChange={e => number("height", e.target.value)} /></label>}</div>;
}
