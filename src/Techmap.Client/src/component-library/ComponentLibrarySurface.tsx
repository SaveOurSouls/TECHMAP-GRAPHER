import { InfoHint } from "../InfoHint";
import { TemplateSeriesPanelV3 } from "./TemplateSeriesPanelV3";
import { E4ArticlePreview } from "./E4ArticlePreview";
import { materializeGenerator } from "./drawing-generator";
import { TemplateCanvasV2, type TemplatePointAngleModeV2 } from "./TemplateCanvasV2";
import {
  projectTemplateContentV3CoreToV2,
  addContactTypeGroupV3,
  renameContactTypeGroupV3,
  deleteContactTypeGroupV3,
  upsertArticleVariantV3,
  removeArticleVariantV3,
  renameLayerV3 as renameLayerV2,
  reorderLayerV3 as reorderLayerV2,
  setLayerVisibleV3 as setLayerVisibleV2,
  setLayerLockedV3 as setLayerLockedV2,
  deleteLayerV3 as deleteLayerV2,
  createRepeatPrototypeV3 as createRepeatPrototypeV2,
  constantExpressionV3 as constantExpressionV2,
  attachRepeatDomainV3 as attachRepeatDomainV2,
  setRepeatCountV3 as setRepeatCountV2,
  setRepeatStepV3 as setRepeatStepV2,
  deleteRepeatPrototypeV3 as deleteRepeatPrototypeV2,
  parameterizeNodeDimensionV3 as parameterizeNodeDimensionV2,
  setTemplateParameterDefaultV3 as setTemplateParameterDefaultV2,
  editLogicalContactV3 as editLogicalContactV2,
  editContactPointV3 as editContactPointV2,
  deleteContactPointV3 as deleteContactPointV2,
  editBundlePortV3 as editBundlePortV2,
  deleteBundlePortV3 as deleteBundlePortV2,
  editNodeV3 as editNodeV2,
  setNodeLockedV3 as setNodeLockedV2,
} from "./template-commands-v3";
import { errorText, addSeriesArticles, TEMPLATE_UNDO_LIMIT } from "./library-draft-adapters";
import { findArticleDrawing, articleDrawingView, type DrawingTarget } from "./drawing-bindings";
import { parseConnectorSchematic } from "../editor/model";
import { DrawingToolIcon, drawingToolLabels } from "./DrawingToolIcon";
import { DrawingGeneratorPanel } from "./DrawingGeneratorPanel";
import { materializeE4ConnectorArticle } from "./e4-connector-series-table";
import { DrawingArrayPanel } from "./DrawingArrayPanel";
import { TemplateContactsPanelV2 } from "./TemplateContactsPanelV2";
import { TemplateLayersPanelV2 } from "./TemplateLayersPanelV2";
import { IMAGE_IMPORT_ACCEPT } from "./image-import";
import { TemplateParametersPanelV2 } from "./TemplateParametersPanelV2";
import { nodeLabel, setNodePosition } from "./library-node-editing";
import { DrawingSelectionProperties } from "./DrawingSelectionProperties";
import {
  styleDrawingSelection,
  useInternalDrawingClipboard,
  stretchDrawingSelection,
  rotateDrawingSelection,
} from "./drawing-selection";
import {
  ViewAndLayerProperties,
  ContactPointProperties,
  BundlePortProperties,
  NodeProperties,
  NumericField,
} from "./LibraryEditorProperties";
import { type Props } from "./library-editor-types";
import { useComponentLibrary } from "./useComponentLibrary";
import "./component-library.css";

export function ComponentLibrary(props: Props) {
 const { activeGenerator, activeLayer, activeView, addAsset, addLayer, answerNavigation, appendBasic, appendBundlePort, appendContact, applyGenerator, assetMismatch, assignGenerator, autoSaveFailed, busy, changeContent, changeGenerator, changeShapeContact, clearDrawingScope, clearTargetDrawings, clipboard, clipboardSynchronized, clipboardToken, command, compatibilityContent, copySelection, createGenerator, deleteCanvasPoint, deleteSelection, diagnostics, dirty, draft, drawingSnaps, drawingTab, drawingTableRows, drawingTarget, e4PreviewContent, e4View, editableNode, editorContent, effectivePreviewParameterValues, error, generatedPreview, generatorArticleMode, generatorMode, generatorPreviewError, generatorPreviewPeriods, graphicEditorMode, groupSelection, hasClipboard, insertCanvasPoint, isNewSeries, items, loadList, markDirty, moveCanvasNode, moveCanvasPoint, navigationDialog, open, openDrawingTarget, pasteSelection, pendingLogicalContactId, placeAsset, placeLinkedContact, pointAngleMode, propertyTab, recovery, recoveryError, removeArticleContactGroup, removeAsset, removeDrawingPrompt, removeTemplate, reorderSelection, repeatedContactLabels, resizeCanvasNode, resolveAssetUrl, returnToLibrary, rotateSelection, save, saveAndExitDrawing, saveArticleDrawing, saved, selectBoxObjects, selectCanvasObject, selected, selectedArticleVariantId, selectedBundlePort, selectedContactPoint, selectedId, selectedIds, selectedLogicalContact, selectedNodeIds, selectedNodes, selectedPoint, selectedRowBinding, selectedTableRow, selectionLocked, setActiveLayerIds, setArticleContactGroup, setAutoSaveFailed, setClearDrawingScope, setCompatibleTerminals, setDraft, setDrawingSnaps, setDrawingTab, setError, setGeneratorMode, setGeneratorPreviewPeriods, setGraphicEditorMode, setPendingLogicalContactId, setPointAngleMode, setPreviewParameterValues, setPropertyTab, setRemoveDrawingPrompt, setSelectedArticleVariantId, setSelectedId, setSelectedIds, setSeriesStandardTerminal, setSeriesTerminalContactType, setStandardTerminal, setTerminalArticleQuery, setUndoStack, setViewId, standardTerminalArticleKeys, standardTerminalIdentities, startNew, terminalArticleQuery, terminalArticleSearchMessage, terminalArticleSearchState, terminalArticleSuggestions, terminalContactTypeGroupIds, textEditorRef, undo, undoStack, ungroupSelection, upgradedFromV1, wireLookup } = useComponentLibrary(props);
 return <div className="component-library">
    <dialog ref={navigationDialog} className="project-delete-dialog" aria-labelledby="library-navigation-title" onCancel={event => { event.preventDefault(); answerNavigation("stay"); }}>
      <h2 id="library-navigation-title">Сохранить правки библиотеки?</h2>
      <p>Серия «{draft.code || draft.name}» содержит несохранённые изменения. Сохранённый серверный черновик останется доступен при следующем открытии.</p>
      {draft.templateId === null && <p>Для новой серии сохранение создаст её первую версию в библиотеке.</p>}
      <div className="project-heading-actions"><button type="button" onClick={() => answerNavigation("stay")} autoFocus>Остаться</button><button type="button" onClick={() => answerNavigation("discard")}>Отбросить правки</button><button type="button" className="primary-action" onClick={() => answerNavigation("save")}>{draft.templateId ? "Сохранить черновик" : "Сохранить новую серию"}</button></div>
    </dialog>
    <header className="content-heading library-heading"><div><p className="eyebrow">M2 · БИБЛИОТЕКА СОЕДИНИТЕЛЕЙ</p><h1>Серии и компоненты <InfoHint>Здесь задаются серия, артикулы и таблица контактов Э4. Графика используется для вспомогательных видов.</InfoHint></h1></div><button className="primary-action" type="button" onClick={() => void startNew()} disabled={busy}>+ Новая серия</button></header>
    {error && <div className="error-banner" role="alert"><span>{error}</span><button onClick={() => setError(null)} aria-label="Закрыть">×</button></div>}
    {recoveryError && <div className="error-banner" role="alert">{recoveryError}</div>}
    {recovery && <p role="status">Последний черновик библиотеки восстановлен. Серверная версия не заменялась.</p>}
    {upgradedFromV1 && <div className="library-upgrade-banner" role="status"><strong>Открыта прежняя версия шаблона.</strong><span>Она преобразована только в памяти и будет сохранена как новая версия v3.</span>{diagnostics.map(item => <small key={`${item.code}/${item.path}`}>{item.code}: {item.message}</small>)}</div>}
    {!upgradedFromV1 && diagnostics.length > 0 && <div className="library-diagnostics" role="alert">{diagnostics.map(item => <span key={`${item.code}/${item.path}`}>{item.path}: {item.message}</span>)}</div>}
    <div className="library-layout"><aside className="library-catalog"><div className="panel-heading"><h2>Шаблоны</h2><button className="refresh-button" onClick={() => void loadList()} disabled={busy}>Обновить</button></div><div className="library-template-list">{items.length ? items.map(item => <button key={item.templateId} className={item.templateId === draft.templateId ? "library-template selected" : "library-template"} onClick={() => void open(item)} disabled={busy}><strong>{item.code}</strong><span>{item.name}</span><small>версия {item.version}</small></button>) : <p className="panel-message">Создайте первый графический шаблон.</p>}</div></aside>
      <section className={`library-editor ${graphicEditorMode === "drawing" ? "drawing-mode" : ""}`} aria-busy={busy}>
        <div className="library-metadata"><label>Серия соединителя<input aria-label="Серия соединителя" value={draft.code} onChange={event => { setDraft(current => ({ ...current, code: event.target.value })); markDirty(); }} placeholder="Например, JST XH" /></label><label>Описание<input aria-label="Описание серии" value={draft.name} onChange={event => { setDraft(current => ({ ...current, name: event.target.value })); markDirty(); }} placeholder="Например, разъёмы JST XH" /></label><div><span className={autoSaveFailed ? "library-save-state error" : "library-save-state"} role="status">{busy ? "Сохранение…" : autoSaveFailed ? "Не сохранено" : isNewSeries ? "Новая серия не сохранена" : dirty ? "Изменено" : saved ?? "Сохранено"}</span><button className="primary-action" onClick={() => { setAutoSaveFailed(false); void save(); }} disabled={busy || assetMismatch || (!dirty && draft.draftRevision === 0)}>{busy ? "Сохраняем…" : isNewSeries ? "Создать серию" : "Записать версию"}</button>{draft.templateId && <button type="button" className="danger-action" onClick={() => void removeTemplate()} disabled={busy}>Удалить серию</button>}</div></div>
        {isNewSeries ? <section className="library-new-series" aria-label="Создание новой серии">
          <strong>Новая серия</strong>
          <p>Заполните название и описание, затем создайте серию. Настройки контактов, уплотнителей, терминалов и артикулов станут доступны после сохранения первой версии.</p>
        </section> : <><div className="graphic-editor-switcher" role="toolbar" aria-label="Редактор графики">
          <button type="button" className={graphicEditorMode === "e4" ? "active" : ""} onClick={() => { setGraphicEditorMode("e4"); if (e4View) setViewId(e4View.id); }}>Схема Э4</button>
          <button type="button" className={graphicEditorMode === "drawing" ? "active" : ""} disabled={!draft.templateId || busy} onClick={() => openDrawingTarget(drawingTarget)}>Рисунок</button>
          <InfoHint>Сначала выберите серию слева или создайте новую: заполните серию и описание, затем запишите версию. Рисунки редактируются отдельно для Схемы Э4, Чертежа или Маршрута.</InfoHint>
        </div>
        <div className="library-series-workspace">
        {graphicEditorMode === "e4" && <>
        <TemplateSeriesPanelV3
          articlePreview={<>
        {e4PreviewContent && <E4ArticlePreview wireLookup={wireLookup} content={e4PreviewContent} table={draft.e4ConnectorTable} articleId={selectedArticleVariantId} assets={draft.assets} code={draft.code} name={draft.name} disabled={busy || assetMismatch}
          onTableChange={table => { setDraft(current => ({ ...current, content: { ...current.content, articleVariants: current.content.articleVariants.map(variant => ({ ...variant, contactGroups: table.articles.find(article => article.articleVariantId === variant.id)?.contactGroups.map(group => ({ ...group, allowedTerminalArticleKeys: [...group.allowedTerminalArticleKeys] })) ?? variant.contactGroups })) }, e4ConnectorTable: table })); markDirty(); }}
          onChange={value => { setDraft(current => ({ ...current, e4Presentation: value })); markDirty(); }} />}
        {e4PreviewContent && selectedArticleVariantId && (["e4","drawing","route"] as const).map(target=>{
          const generator=draft.drawingGenerators?.find(g=>g.target===target&&g.articles.some(a=>a.articleId===selectedArticleVariantId));
          if(generator){
            try { const generated=materializeGenerator(draft.content,draft.e4ConnectorTable,draft.drawingContactBindings??[],generator,selectedArticleVariantId);
              return <section key={target} className="library-e4-companion" aria-label={`Рисунок ${target}`}><header><strong>Рисунок · {({e4:"Схема Э4",drawing:"Чертёж",route:"Маршрут"})[target]}</strong><button type="button" onClick={()=>openDrawingTarget(target)}>Редактировать</button></header><TemplateCanvasV2 preview previewKey={selectedArticleVariantId} content={projectTemplateContentV3CoreToV2(generated.content)} viewId={generator.viewId} selectedId={null} onSelect={()=>{}} resolveAssetUrl={resolveAssetUrl}/></section>;
            } catch(caught){return <span role="status" key={target}>{errorText(caught)}</span>;}
          }
          const binding=findArticleDrawing(draft.articleDrawings,selectedArticleVariantId,target);
          const view=compatibilityContent.views.find(v=>binding?.viewId ? v.id===binding.viewId : v.kind==="drawing");
          if(!view || target==="route"&&!binding)return null;
          const filtered=articleDrawingView(view,draft.articleDrawings,selectedArticleVariantId,target);
          if(!filtered.layers.some(l=>l.nodes.some(n=>n.visible))&&!filtered.contactPoints.length)return null;
          return <section key={target} className="library-e4-companion" aria-label={`Рисунок ${target}`}><header><strong>Рисунок · {({e4:"Схема Э4",drawing:"Чертёж",route:"Маршрут"})[target]}</strong><button type="button" onClick={()=>openDrawingTarget(target)}>Редактировать</button></header><TemplateCanvasV2 preview previewKey={selectedArticleVariantId} content={{...compatibilityContent,views:compatibilityContent.views.map(v=>v.id===view.id?filtered:v)}} viewId={view.id} selectedId={null} selectedIds={[]} onSelect={()=>{}} resolveAssetUrl={resolveAssetUrl} repeatedContactLabels={repeatedContactLabels} parameterDefaults={effectivePreviewParameterValues}/></section>;
        })}
          </>}
          independentE4
          content={draft.content}
          compatibleTerminalArticleKeys={draft.compatibleTerminalArticleKeys}
          compatibleSeals={draft.compatibleSeals}
          onChangeCompatibleSeals={seals => { setDraft(current => {
            const presentation = parseConnectorSchematic(current.e4Presentation);
            const hasSealColumn = presentation.customFields.some(field => field.id === "seal");
            const previousSeals = current.compatibleSeals ?? [];
            const availableSeals = new Set(seals.map(seal => seal.article));
            const renamedSeals = seals.length === previousSeals.length
              ? new Map(previousSeals.flatMap((seal, index) => seal.article !== seals[index]?.article
                ? [[seal.article, seals[index]!.article] as const] : []))
              : new Map<string, string>();
            const withoutRemovedSeal = <T extends { readonly customValues?: Record<string, string> }>(values: T): T => {
              const customValues = values.customValues;
              const seal = customValues?.seal;
              const replacement = seal && renamedSeals.get(seal);
              if (!customValues || seal === undefined || seal === "" || (!replacement && availableSeals.has(seal))) return values;
              if (replacement) return { ...values, customValues: { ...customValues, seal: replacement } };
              const { seal: _seal, ...remainingCustomValues } = customValues;
              return { ...values, customValues: remainingCustomValues };
            };
            return {
              ...current,
              compatibleSeals: seals.map(seal => ({ ...seal })),
              e4ConnectorTable: {
                ...current.e4ConnectorTable,
                seriesDefaults: current.e4ConnectorTable.seriesDefaults.map(row => ({
                  ...row, values: withoutRemovedSeal(row.values),
                })),
                articles: current.e4ConnectorTable.articles.map(article => ({
                  ...article, rows: article.rows.map(row => ({
                    ...row, overrides: withoutRemovedSeal(row.overrides),
                  })),
                })),
              },
              ...(hasSealColumn || seals.length === 0 ? {} : { e4Presentation: {
                ...presentation,
                customFields: [...presentation.customFields, { id: "seal", label: "Уплотнитель", visible: true }],
              } }),
            };
          }); markDirty(); }}
          onChangeCompatibleTerminalArticleKeys={setCompatibleTerminals}
          terminalContactTypeGroupIds={terminalContactTypeGroupIds}
          onSetTerminalContactTypeGroup={setSeriesTerminalContactType}
          standardTerminalIdentities={standardTerminalIdentities}
          onSetSeriesStandardTerminal={setSeriesStandardTerminal}
          terminalArticleQuery={terminalArticleQuery}
          terminalArticleSuggestions={terminalArticleSuggestions}
          terminalArticleSearchState={terminalArticleSearchState}
          terminalArticleSearchMessage={terminalArticleSearchMessage}
          onTerminalArticleQueryChange={setTerminalArticleQuery}
          selectedArticleVariantId={selectedArticleVariantId}
          onSelectArticleVariant={variantId => { setSelectedArticleVariantId(variantId); setPreviewParameterValues({}); }}
          onAddContactTypeGroup={name => command(() => addContactTypeGroupV3(draft.content, name)[0])}
          onRenameContactTypeGroup={(groupId, name) => command(() => renameContactTypeGroupV3(draft.content, groupId, name))}
          onDeleteContactTypeGroup={groupId => command(() => deleteContactTypeGroupV3(draft.content, groupId))}
          onAddArticleVariants={inputs => {
            try {
              const content = addSeriesArticles(draft.content, inputs);
              changeContent(content);
              setSelectedArticleVariantId(content.articleVariants.at(-1)!.id);
              return true;
            } catch (caught) {
              setError(errorText(caught));
              return false;
            }
          }}
          onUpdateArticleVariant={(variantId, input) => command(() => upsertArticleVariantV3(draft.content, { id: variantId, ...input })[0])}
          onDeleteArticleVariant={variantId => { if (selectedArticleVariantId === variantId) setSelectedArticleVariantId(null); command(() => removeArticleVariantV3(draft.content, variantId)); }}
          onSetArticleContactGroup={setArticleContactGroup}
          onRemoveArticleContactGroup={removeArticleContactGroup}
          standardTerminalArticleKeys={standardTerminalArticleKeys}
          onSetStandardTerminal={setStandardTerminal}
        />
        </>}
        </div>
        </>}
        {!isNewSeries && <section className={`drawing-editor-shell ${graphicEditorMode === "drawing" ? "" : "drawing-hidden"}`} role="dialog" aria-modal="true" aria-label="Редактор рисунка" onCopy={event=>{if((event.target as HTMLElement).closest("input,textarea,select,[contenteditable=true]") || !selectedNodeIds.length)return;event.preventDefault();copySelection(event.clipboardData);}}>
          <header><strong>Рисунок · {draft.code}</strong><label>Раздел<select aria-label="Раздел рисунка" value={drawingTarget} onChange={e=>openDrawingTarget(e.target.value as DrawingTarget)}><option value="e4">Схема Э4</option><option value="drawing">Чертёж</option><option value="route">Маршрут</option></select></label><InfoHint>Рисунок сохраняется только для выбранного раздела. Перетаскивайте PNG, JPG, BMP, SVG, HEIC или вставляйте изображение Ctrl+V на поле. Изображения преобразуются в PNG локально. «Открыть» выделяет сохранённый набор для редактирования.</InfoHint>
            <label>Артикул<select aria-label="Артикул рисунка" value={selectedArticleVariantId ?? ""} onChange={e=>openDrawingTarget(drawingTarget,e.target.value || null)}><option value="">Прототип</option>{draft.content.articleVariants.map(a=><option key={a.id} value={a.id}>{a.articleKey}</option>)}</select></label>
            <button type="button" onClick={returnToLibrary} disabled={busy}>В библиотеку</button>
            <InfoHint>Возврат сохраняет изменения в текущем редакторе. В библиотеке можно исправить данные серии и записать версию.</InfoHint>
            <button type="button" className="primary-action" onClick={() => void saveAndExitDrawing()} disabled={busy || assetMismatch}>Сохранить и выйти</button>
          </header>
          {error && <div className="error-banner" role="alert">{error}</div>}
          <nav className="drawing-ribbon-tabs" aria-label="Инструменты рисунка">{Object.entries({tools:"Правка",properties:"Свойства",generator:"Генератор",array:"Массив",contacts:"Контакты",layers:"Слои",assets:"Изображения",parameters:"Параметры",articles:"Артикулы"}).map(([id,label])=><button type="button" key={id} aria-pressed={drawingTab===id} onClick={()=>setDrawingTab(id)}>{label}</button>)}</nav>
<div className="drawing-ribbon-page drawing-ribbon-tools">        <div className="library-tools"><span>Примитивы</span><button type="button" onClick={()=>copySelection()} disabled={!selectedNodeIds.length} title="Ctrl+C">Копировать</button><button type="button" onClick={pasteSelection} disabled={!hasClipboard || !activeLayer || activeLayer.locked} title="Ctrl+V">Вставить</button><button type="button" onClick={deleteSelection} disabled={!selectedIds.length || selectionLocked} title="Delete">Удалить</button><button type="button" className="drawing-primitive" title="Контакт" aria-label="Контакт" onClick={()=>appendContact()} disabled={!activeView}><DrawingToolIcon kind="contact"/></button>{(["line", "polyline", "rectangle", "ellipse", "bezier", "closedContour", "text"] as const).map(kind => <button key={kind} className="drawing-primitive" title={drawingToolLabels[kind]} aria-label={drawingToolLabels[kind]} onClick={() => appendBasic(kind)} disabled={!activeLayer || activeLayer.locked}><DrawingToolIcon kind={kind}/></button>)}<label className="angle-snap-control">Угол<select aria-label="Привязка угла" value={pointAngleMode} onChange={event => setPointAngleMode(event.target.value as TemplatePointAngleModeV2)}><option value="snap-15">15°</option><option value="free">Свободно</option></select></label><span className="drawing-snaps">{(["corners", "contours", "tangents"] as const).map(key => <label key={key}><input type="checkbox" checked={drawingSnaps[key]} onChange={e => setDrawingSnaps(current => ({ ...current, [key]: e.target.checked }))} />{({corners:"Углы",contours:"Контуры",tangents:"Касательные"})[key]}</label>)}<InfoHint>Ctrl + колесо — масштаб поля около курсора; Home — исходный масштаб. Привязки действуют при перемещении фигур, контактов и вершин. Касательные — для концов линий и прямых сторон рядом с окружностью.</InfoHint></span><button className="undo-tool" onClick={undo} disabled={undoStack.length === 0} title="Ctrl+Z">↶ Отменить</button></div>
</div>
          <div className="drawing-ribbon" data-ribbon-tab={drawingTab}>
{drawingTab === "generator" && <div className="drawing-ribbon-page"><DrawingGeneratorPanel generator={activeGenerator} previewPeriods={generatorPreviewPeriods} setPreviewPeriods={setGeneratorPreviewPeriods} mode={generatorMode} articleId={selectedArticleVariantId} articles={draft.content.articleVariants.map(a=>({id:a.id,articleKey:a.articleKey,count:materializeE4ConnectorArticle(draft.e4ConnectorTable,a.id).rows.length}))} change={changeGenerator} assign={assignGenerator} apply={applyGenerator} choose={id=>{setGeneratorPreviewPeriods(undefined);setSelectedArticleVariantId(id);setSelectedIds([]);if(!activeGenerator?.articles.some(a=>a.articleId===id))setGeneratorMode("source");}} setMode={mode=>{setGeneratorPreviewPeriods(undefined);setGeneratorMode(mode);setSelectedIds([]);}} create={createGenerator}/></div>}
{drawingTab === "array" && <div className="drawing-ribbon-page">{activeView && activeLayer && <DrawingArrayPanel content={draft.content} viewId={activeView.id} layerId={activeLayer.id} selectedIds={selectedIds} onChange={changeContent} onError={setError} />}</div>}
{drawingTab === "contacts" && <div className="drawing-ribbon-page">{activeView && <TemplateContactsPanelV2
          key={`${activeView.id}:${pendingLogicalContactId ?? ""}`}
          content={compatibilityContent}
          activeViewId={activeView.id}
          preferredLogicalContactId={pendingLogicalContactId}
          onCreateLogicalContact={appendContact}
          onPlaceLinkedContact={placeLinkedContact}
          onAddBundlePort={appendBundlePort}
          onNavigateToMissingPoint={(targetViewId, logicalContactId) => { setViewId(targetViewId); setSelectedId(null); setPendingLogicalContactId(logicalContactId); }}
          onSelectContactPoint={setSelectedId}
          onSelectBundlePort={setSelectedId}
        />}
        </div>}
{drawingTab === "layers" && <div className="drawing-ribbon-page">{activeView && <TemplateLayersPanelV2
          layers={activeView.layers}
          activeLayerId={activeLayer?.id ?? null}
          onActivate={id => { setActiveLayerIds(current => ({ ...current, [activeView.id]: id })); setSelectedId(null); }}
          onAdd={addLayer}
          onRename={(id, name) => command(() => renameLayerV2(draft.content, activeView.id, id, name))}
          onMove={(id, index) => command(() => reorderLayerV2(draft.content, activeView.id, id, index))}
          onToggleVisible={id => { const layer = activeView.layers.find(item => item.id === id)!; command(() => setLayerVisibleV2(draft.content, activeView.id, id, !layer.visible)); }}
          onToggleLocked={id => { const layer = activeView.layers.find(item => item.id === id)!; command(() => setLayerLockedV2(draft.content, activeView.id, id, !layer.locked)); }}
          onDelete={id => { const fallback = activeView.layers.find(item => item.id !== id); if (!fallback) return; command(() => deleteLayerV2(draft.content, activeView.id, id), null); setActiveLayerIds(current => ({ ...current, [activeView.id]: fallback.id })); }}
        />}
        </div>}
{drawingTab === "assets" && <div className="drawing-ribbon-page"><section className="library-assets"><div className="asset-upload"><label className={busy ? "disabled" : ""}>+ Изображение<input type="file" accept={IMAGE_IMPORT_ACCEPT} disabled={busy} onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) void addAsset(file,true); }} /></label><InfoHint>PNG, JPG, BMP, SVG, HEIC: загрузите файл, перетащите его на поле или вставьте Ctrl+V. Изображение хранится в шаблоне как PNG. Выделите нужные объекты и сохраните их для артикула или всей серии.</InfoHint></div>{draft.assets.length > 0 && <div className="asset-list">{draft.assets.map(asset => <article key={asset.assetId}><div className="asset-preview">{draft.templateId && <img src={resolveAssetUrl(asset.assetId)} alt="" />}</div><div><strong>{asset.fileName}</strong><small>{(asset.sizeBytes / 1024).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} КиБ</small></div><div className="asset-actions"><button type="button" onClick={() => placeAsset(asset)} disabled={busy || !activeLayer || activeLayer.locked}>На вид</button><button type="button" className="asset-remove" onClick={() => void removeAsset(asset.assetId)} disabled={busy} aria-label={`Удалить изображение ${asset.fileName}`}>×</button></div></article>)}</div>}</section>
        </div>}
{drawingTab === "parameters" && <div className="drawing-ribbon-page">{activeView && <TemplateParametersPanelV2
          content={compatibilityContent}
          activeViewId={activeView.id}
          activeLayerId={selected?.layer.id ?? activeLayer?.id ?? null}
          selectedNodeId={selected?.node.id ?? null}
          onCreateRepeat={input => command(() => createRepeatPrototypeV2(draft.content, {
            viewId: input.viewId,
            layerId: input.layerId,
            prototypeNodeId: input.prototypeNodeId,
            prototypePointId: input.contactPointId,
            count: input.count,
            step: { x: constantExpressionV2(input.stepX), y: constantExpressionV2(input.stepY) },
          })[0], null)}
          onPlaceRepeatInActiveView={input => {
            if (!activeLayer) return;
            command(() => attachRepeatDomainV2(draft.content, {
              viewId: activeView.id,
              layerId: activeLayer.id,
              prototypeNodeId: input.prototypeNodeId,
              repeatDomainId: input.repeatDomainId,
              step: { x: constantExpressionV2(input.stepX), y: constantExpressionV2(input.stepY) },
            })[0], null);
          }}
          onSetCount={(domainId, count) => {
            command(() => setRepeatCountV2(draft.content, domainId, count));
            setPreviewParameterValues({});
          }}
          onSetStep={(targetViewId, domainId, x, y) => command(() => setRepeatStepV2(
            draft.content, targetViewId, domainId,
            { x: constantExpressionV2(x), y: constantExpressionV2(y) },
          ))}
          onDeleteRepeat={domainId => {
            command(() => deleteRepeatPrototypeV2(draft.content, domainId), null);
            setPreviewParameterValues({});
          }}
          onPreviewValues={setPreviewParameterValues}
          onParameterizeNodeDimension={input => command(() => parameterizeNodeDimensionV2(
            draft.content, input.viewId, input.layerId, input.nodeId, input.dimension,
            { name: input.name, unit: input.unit, defaultValue: input.defaultValue, minimum: input.minimum, maximum: input.maximum },
          )[0])}
          onSetParameterDefault={(parameterId, value) => command(() => setTemplateParameterDefaultV2(draft.content, parameterId, value))}
        />}
          </div>}
          {drawingTab === "articles" && <div className="drawing-ribbon-page">
            <aside className="drawing-articles" aria-label="Рисунки артикулов">
              <header className="ui-section-heading"><strong>Артикулы</strong><InfoHint>Сохраняется выделенный набор, а без выделения — весь открытый рисунок, в том числе пустой. Группа сохраняется целиком. Кнопка записывает черновик на сервер; «Сохранить и выйти» публикует версию. Общие фигуры меняются во всех наборах, куда они включены. Для независимого рисунка очистите выбранный артикул.</InfoHint></header>
              {draft.content.articleVariants.map(article => <div key={article.id} className={selectedArticleVariantId === article.id ? "active" : ""}>
                <button type="button" onClick={() => openDrawingTarget(drawingTarget,article.id)} title="Открыть сохранённый рисунок">{article.articleKey}{findArticleDrawing(draft.articleDrawings,article.id,drawingTarget) ? " ✓" : ""}</button>
                <button type="button" disabled={busy || assetMismatch} onClick={() => void saveArticleDrawing(article.id)}>Сохранить</button>
              </div>)}
              <button type="button" disabled={busy || assetMismatch || !draft.content.articleVariants.length} onClick={()=>void saveArticleDrawing(draft.content.articleVariants[0]!.id,true)}>Сохранить для всей серии</button>
              <button type="button" disabled={busy} onClick={()=>{setClearDrawingScope(selectedArticleVariantId ? "article" : "series");setRemoveDrawingPrompt(true);}}>Очистить рисунки раздела</button>
              {removeDrawingPrompt && <div role="alertdialog" aria-label="Очистить рисунки раздела">
                <p>Удалить рисунки для {clearDrawingScope === "article" && selectedArticleVariantId ? "выбранного артикула" : "всей серии"}? Контакты таблицы сохранятся. Доступна отмена Ctrl+Z.</p>
                <label>Объём очистки<select aria-label="Объём очистки" value={clearDrawingScope} onChange={event=>setClearDrawingScope(event.target.value as "article"|"series")}>
                  <option value="article" disabled={!selectedArticleVariantId}>Выбранный артикул</option><option value="series">Вся серия</option>
                </select></label>
                <button type="button" onClick={clearTargetDrawings}>Очистить</button><button type="button" onClick={()=>setRemoveDrawingPrompt(false)}>Отмена</button>
              </div>}
              <span role="status">{saved}</span>
            </aside>
          </div>}
          </div>
        <div className="drawing-body">
<div className="drawing-properties-sidebar">          <aside className="library-properties" key={selectedIds.join(":")} data-property-tab={propertyTab}><div className="drawing-property-tabs" role="group" aria-label="Свойства объекта">{(["geometry", "stroke", "fill"] as const).map(tab=><button type="button" key={tab} aria-pressed={propertyTab===tab} onClick={()=>setPropertyTab(tab)}>{({geometry:"Геометрия",stroke:"Линия",fill:"Заливка"})[tab]}</button>)}</div><label>Объект<select aria-label="Объект рисунка" value={selectedId ?? ""} onChange={e => { const id=e.target.value; const layer=activeView?.layers.find(l=>l.nodes.some(n=>n.id===id)); if(layer && activeView) setActiveLayerIds(v=>({...v,[activeView.id]:layer.id})); setSelectedId(id || null); }}><option value="">Не выбран</option>{activeView?.layers.flatMap(l=>l.nodes.map((n,i)=><option key={n.id} value={n.id}>{l.name} · {nodeLabel(n)} {i+1}</option>))}</select></label><h3>{selected?.node ? nodeLabel(selected.node) : selectedContactPoint && selectedLogicalContact ? `Контакт №${selectedTableRow?.number ?? selectedLogicalContact.number}` : selectedBundlePort ? "Общий выход пучка" : activeLayer ? "Слой" : "Вид"}</h3>
            {selectedNodeIds.length > 1 && <><button type="button" onClick={groupSelection} disabled={selectionLocked || !selectedNodeIds.every(id=>activeLayer?.nodes.some(node=>node.id===id))}>Сгруппировать</button><DrawingSelectionProperties allNodes={activeView?.layers.flatMap(layer=>layer.nodes)} nodes={selectedNodes} disabled={selectionLocked} change={style=>command(()=>styleDrawingSelection(draft.content,activeView!.id,selectedNodeIds,style))} /></>}
            {selectedNodeIds.length === 1 && selected?.node.kind === "group" && <><button type="button" onClick={ungroupSelection}>Разгруппировать</button><DrawingSelectionProperties allNodes={activeView?.layers.flatMap(layer=>layer.nodes)} nodes={selectedNodes} disabled={selectionLocked} change={style=>command(()=>styleDrawingSelection(draft.content,activeView!.id,selectedNodeIds,style))} /></>}
            {!selected?.node && !selectedPoint && activeView && <ViewAndLayerProperties content={draft.content} viewId={activeView.id} layerId={activeLayer?.id ?? null} change={changeContent} command={command} selectLayer={id => setActiveLayerIds(current => ({ ...current, [activeView.id]: id }))} selectView={setViewId} />}
             {selectedContactPoint && selectedLogicalContact && <label>Контакт таблицы №<select value={selectedRowBinding?.seriesRowId ?? ""} onChange={event => { const seriesRowId = event.target.value; setUndoStack(stack => [...stack.slice(-(TEMPLATE_UNDO_LIMIT - 1)), draft]); setDraft(current => ({...current,drawingContactBindings:[...(current.drawingContactBindings ?? []).filter(binding => binding.logicalContactId !== selectedLogicalContact.id && binding.seriesRowId !== seriesRowId),...(seriesRowId ? [{logicalContactId:selectedLogicalContact.id,seriesRowId}] : [])]})); markDirty(); }}><option value="">Не привязан</option>{drawingTableRows.map(row => <option key={row.seriesRowId} value={row.seriesRowId}>{row.number} · {row.name}</option>)}</select></label>}
             {selectedContactPoint && selectedLogicalContact && activeView && <ContactPointProperties
               point={selectedContactPoint}
               logical={selectedTableRow ? {...selectedLogicalContact, ...selectedTableRow} : selectedLogicalContact}
               tableBound={Boolean(selectedRowBinding)}
               groups={draft.content.contactTypeGroups}
               editLogical={changes => command(() => editLogicalContactV2(draft.content, selectedLogicalContact.id, changes))}
               editPoint={changes => command(() => editContactPointV2(draft.content, activeView.id, selectedContactPoint.id, changes))}
               remove={() => command(() => deleteContactPointV2(draft.content, activeView.id, selectedContactPoint.id), null)}
             />}
             {selectedContactPoint && !selectedLogicalContact && <p className="readonly-note">Логический контакт точки не найден. Проверьте диагностику шаблона.</p>}
             {selectedBundlePort && activeView && <BundlePortProperties port={selectedBundlePort} edit={changes => command(() => editBundlePortV2(draft.content, activeView.id, selectedBundlePort.id, changes))} remove={() => command(() => deleteBundlePortV2(draft.content, activeView.id, selectedBundlePort.id), null)} />}
            {selectedIds.length === 1 && selected?.node && !editableNode && <><p className="readonly-note">Сложный или параметризованный объект доступен только для чтения. Его данные сохраняются без потерь.</p><label>Тип<input value={selected.node.kind} readOnly /></label></>}
            {drawingTarget==="e4" && selectedNodeIds.length===1 && selected && (selected.node.kind==="rectangle" || selected.node.kind==="ellipse") && <fieldset disabled={selectionLocked}><label><input type="checkbox" checked={!!activeView?.contactPoints.some(p=>p.shape?.nodeId===selected.node.id)} onChange={e=>changeShapeContact(e.target.checked)}/>Контакт Э4</label>{activeView?.contactPoints.some(p=>p.shape?.nodeId===selected.node.id) && <label><input type="checkbox" checked={activeView.contactPoints.find(p=>p.shape?.nodeId===selected.node.id)?.shape?.fillFromWire??false} onChange={e=>changeShapeContact(true,e.target.checked)}/>Заливка цветом провода</label>}<InfoHint>Контакты назначаются по порядку свободных строк таблицы. Фигура и её номер повторяются вместе в генераторе. Цвет берётся с подключённого провода; без провода сохраняется обычная заливка.</InfoHint></fieldset>}
            {editableNode && selected && <NodeProperties textEditorRef={textEditorRef} section={propertyTab} node={editableNode} disabled={selected.layer.locked || editableNode.locked} edit={changes => command(() => editNodeV2(draft.content, activeView!.id, selected.layer.id, editableNode.id, changes))} move={(x, y) => command(() => setNodePosition(draft.content, activeView!.id, selected.layer.id, editableNode, x, y))} toggleLock={() => command(() => setNodeLockedV2(draft.content, activeView!.id, selected.layer.id, editableNode.id, !editableNode.locked))} />}
            {selected && selectedNodeIds.length === 1 && selected.node.transform.rotationDegrees.kind === "constant" && <div className="rotation-control"><NumericField label="Поворот, °" value={selected.node.transform.rotationDegrees.value} step={15} disabled={selected.layer.locked || selected.node.locked} change={rotateSelection} /><div className="property-order"><button type="button" disabled={selected.layer.locked || selected.node.locked} onClick={() => rotateSelection(selected.node.transform.rotationDegrees.kind === "constant" ? selected.node.transform.rotationDegrees.value - 90 : 0)}>−90°</button><button type="button" disabled={selected.layer.locked || selected.node.locked} onClick={() => rotateSelection(selected.node.transform.rotationDegrees.kind === "constant" ? selected.node.transform.rotationDegrees.value + 90 : 0)}>+90°</button></div></div>}
            {selected && selectedNodeIds.length === 1 && <><div className="property-order"><button onClick={() => reorderSelection("backward")} disabled={selected.layer.locked || selected.node.locked}>На шаг назад</button><button onClick={() => reorderSelection("forward")} disabled={selected.layer.locked || selected.node.locked}>На шаг вперёд</button></div><button className="danger-action" onClick={deleteSelection} disabled={selectionLocked}>Удалить объект</button></>}
          </aside>
</div>
        <div className="library-workarea" onDragOver={e=>{if(e.dataTransfer.types.includes("Files"))e.preventDefault();}} onDrop={e=>{e.preventDefault();const file=e.dataTransfer.files[0];if(file&&!busy)void addAsset(file,true);}} onPaste={e=>{if((e.target as HTMLElement).closest("input,textarea,select"))return; if(!busy&&clipboard.current&&useInternalDrawingClipboard(e.clipboardData.getData("text/plain"),clipboardToken.current,clipboardSynchronized.current)){e.preventDefault();pasteSelection();return;} const file=Array.from(e.clipboardData.files)[0];if(file&&!busy){e.preventDefault();void addAsset(file,true);}}} inert={busy} id={activeView ? `template-view-panel-${activeView.id}` : undefined} role="region" aria-label="Поле редактирования рисунка">{activeView && <TemplateCanvasV2 content={generatorArticleMode && generatedPreview ? projectTemplateContentV3CoreToV2(generatedPreview.content) : editorContent} viewId={activeView.id} selectedId={selectedId} selectedIds={selectedIds} onSelect={setSelectedId} onSelectionChange={selectCanvasObject} onBoxSelection={selectBoxObjects} onSelectionStretch={(factor,anchor)=>command(()=>stretchDrawingSelection(draft.content,activeView.id,selectedIds,factor,anchor))} onSelectionRotate={(angle,center)=>command(()=>rotateDrawingSelection(draft.content,activeView.id,selectedIds,angle,center))} onEditText={id => { setSelectedId(id); setDrawingTab("properties"); setPropertyTab("geometry"); requestAnimationFrame(() => { textEditorRef.current?.focus(); textEditorRef.current?.select(); }); }} onNodeMove={moveCanvasNode} onNodeResize={resizeCanvasNode} onNodeRotate={(_id, angle) => rotateSelection(angle)} snaps={drawingSnaps} onNodePointMove={moveCanvasPoint} onNodePointInsert={insertCanvasPoint} onNodePointDelete={deleteCanvasPoint} pointAngleMode={pointAngleMode} resolveAssetUrl={resolveAssetUrl} repeatedContactLabels={repeatedContactLabels} parameterDefaults={effectivePreviewParameterValues} />}

        {activeGenerator && generatorMode === "source" && <aside className="generator-preview" aria-label="Результат генератора"><strong>Вариант · {draft.content.articleVariants.find(a=>a.id===selectedArticleVariantId)?.articleKey}</strong>{generatedPreview ? <TemplateCanvasV2 preview previewKey={selectedArticleVariantId} content={projectTemplateContentV3CoreToV2(generatedPreview.content)} viewId={activeGenerator.viewId} selectedId={null} onSelect={()=>{}} resolveAssetUrl={resolveAssetUrl}/> : <span role="status">{generatorPreviewError}</span>}</aside>}
        </div>
        </div></section>}
      </section>
    </div>
  </div>;
}
