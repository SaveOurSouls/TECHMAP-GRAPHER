import { InfoHint } from "../InfoHint";
import { type ServerRecoveryDraft } from "./design-recovery-api";
import { createEditorHistory, undoEditorCommand } from "./history";
import { migrateJoiningPipes, joiningPipeEndpoint, joiningPipeExit } from "./physical-joining-pipes";
import { removeHarnessDesignRecoveryDraft, browserRecoveryStorage } from "./design-recovery-draft";
import { projectComponentTemplateView, projectE4DrawingCompanions } from "./component-template-view-renderer";
import { ComponentGraphErrorAlert, HarnessEditorErrorBoundary } from "./HarnessEditorBoundary";
import { HarnessEditorWorkspace } from "./HarnessEditorWorkspace";
import { withCoveringTextureUrls } from "./covering-assets";
import {
  joiningPipeDraftHighlights,
  toggleJoiningPipeMember,
  beginJoiningPipe,
  JoiningPipeEditor,
  joiningPipeDraftTopology,
} from "./JoiningPipeEditor";
import { DrawingObjectProperties } from "./DrawingObjectProperties";
import { CONTACT_SIDE_VIEW_PLACEMENT_ID, drawingScale } from "./drawing-scale";
import {
  BUILTIN_TERMINATION_RECORDS,
  TerminationLibraryPicker,
  terminationArtifactFromRecord,
} from "../termination-library";
import { ConnectionTableSettings } from "./ConnectionTableSettings";
import { DrawingRangeControl } from "./DrawingRangeControl";
import { drawingReferenceDiameter } from "./drawing-thickness";
import { drawingBendRadius } from "./drawing-route-path";
import { toggleDrawingDimensions, dimensionRouteKey } from "./drawing-dimensions";
import { DocumentIcon } from "./DocumentIcon";
import {
  addDrawingPositions,
  setDrawingPositionsVisibility,
  createPositionRail,
  moveDrawingAnnotation,
} from "./drawing-documents";
import { routeCutReadiness } from "../manufacturing/route-cut-readiness";
import { DrawingTableWindows } from "./DrawingTableWindows";
import { selectedEditorDeletionCommands, fromUiLayers } from "./harness-selection-adapters";
import { PhysicalTopologyPanel } from "./PhysicalTopologyPanel";
import { SpecificationItemsPanel } from "./SpecificationItemsPanel";
import { DrawingDimensionsPanel } from "./DrawingDimensionsPanel";
import { DrawingDocumentsPanel } from "./DrawingDocumentsPanel";
import { HarnessRelationsPanel } from "./HarnessRelationsPanel";
import { resolveHarnessSelection } from "./harness-selection";
import { saveLocalDrawingCopy } from "./harness-component-snapshots";
import { DrawingScaleControl } from "./DrawingScaleControl";
import { TerminationInspector, PhysicalTwistControls } from "./TerminationInspector";
import { E4ConnectorInspector } from "./E4ConnectorInspector";
import { resolveTerminalDetails, wireEndTerminalCorrections } from "./terminal-details";
import { CableSelectionPanel } from "./CableSelectionPanel";
import { placementLayerError, placementOrigin } from "./termination-placement-interaction";
import { moveDrawingIndex } from "./drawing-indices";
import { physicalNodePoint } from "./physical-ports";
import { pipeBundleNodePoint, unprojectPipeBundlePoint } from "./pipe-bundle-projection";
import { moveCovering } from "./covering-layout";
import { routePhysicalWires } from "./physical-wire-routing";
import { connectPhysicalNodeToSegment, branchPhysicalSegment } from "./physical-topology";
import { standardCoveringOver, standardCovering } from "./physical-coverings";
import { type WireEndpoint, createScreenEndpoint, connectorE4Contacts, createJunctionEndpoint } from "./model";
import { createWire } from "./commands";
import { resolvePhysicalRoutePointCommand } from "./physical-route-point-command";
import { physicalTopologyScene } from "./physical-scene";
import { editorWireUpdateCommand } from "./harness-catalog-adapters";
import { type HarnessDesignEditorProps } from "./harness-editor-types";
import { useHarnessDesignEditor } from "./useHarnessDesignEditor";

export function HarnessDesignEditor(props: HarnessDesignEditorProps) {
  const state = useHarnessDesignEditor(props);
  if (!state.ready) return state.earlyContent;
  const { activeWireStripEnd, addCatalogItem, addRoutePoint, backgroundOpacity, beginTerminationPlacement, bendRadiusPreview, catalog, changeDiffPair, changeScreen, componentGraphIntegrityMessage, componentTemplateViewInstances, connectionTableSettings, coveringRatioPreview, createRoutedWire, diagnostics, dimensionScalePreview, drawingDocument, drawingPerimeters, drawingSnaps, e4Detached, editingObjectId, editorWireColors, flushSave, graphicAngleStep, graphicsClipboardRef, harnessDesignation, harnessId, harnessQuantity, hiddenObjectIds, history, historyRef, indexScalePreview, isolateLocalObjects, joiningPipeDraft, layers, leaderScalePreview, loadGeneration, localCopy, materializedConnectorIds, message, minimumOverlapPreview, onClose, onRouteRequest, onSectionChange, onViewChange, opCoveringEdgePreview, pairPitchPreview, pipeOpacityPreview, placementBusy, placementPending, positionsVisible, previewObjectMove, previewResult, projectId, recoveryApi, recoveryArchives, recoveryBusy, recoveryDrafts, recoveryError, recoverySession, refreshComponentGraph, refreshTemplateTerminals, refreshingTerminals, related, relatedSourceIds, resolveComponentTemplateAssetUrl, resource, resourceRef, retryPendingPlacement, revealRequest, routingIssues, run, saveState, savedJsonRef, scene, selectTemplateArticle, selectedCable, selectedConnector, selectedConnectorLayer, selectedConnectorSeries, selectedObjectId, selectedObjectIds, selectedPipeInterval, selectedTemplateArticleOptions, selectedTerminalCorrections, selectedWireIds, selectedWiresLocked, selectionIndex, setActiveWireStripEnd, setBackgroundOpacity, setBendRadiusPreview, setCoveringPreview, setCoveringRatioPreview, setDimensionScalePreview, setDrawingSnaps, setE4Detached, setEditingObjectId, setFreeEndPreviews, setGraphicAngleStep, setHiddenObjectIds, setHistory, setIndexScalePreview, setJoiningPipeDraft, setLeaderScalePreview, setMessage, setMinimumOverlapPreview, setMovePreview, setOpCoveringEdgePreview, setPairPitchPreview, setPipeOpacityPreview, setPipePreview, setRecoveryDrafts, setRecoveryError, setRelatedSourceIds, setRevealRequest, setSaveState, setSelectedObjectId, setSelectedObjectIds, setSelectedPipeInterval, setTerminationDraft, setTerminationPicker, setTerminationPickerError, setThicknessPreview, setUiFailureNonce, setView, setWholeNet, terminalLookup, terminationDraft, terminationPicker, terminationPickerError, terminationPreview, textureAssets, thicknessPreview, uiFailureNonce, view, volumeEligible, wholeNet, wireLookup } = state;
  return (
    <div className={`he-host ${placementBusy ? "is-placement-busy" : ""}`}>
      {message && <div className="he-save-message" role="alert">{message.startsWith("Схема открыта в безопасном режиме")
        ? <>Маршруты требуют проверки. <InfoHint>{message} Редактирование доступно; перемещение блока повторяет поиск маршрутов.</InfoHint></>
        : message}</div>}
      {routingIssues.length > 0 && <div className="he-save-message" role="status">
        Трассировка: {routingIssues.length} требуют перестроения.
        <InfoHint>Изменения сохраняются. Раздвиньте блоки: при каждом перемещении выполняется поиск маршрутов.
          {routingIssues.map((issue) => <div key={issue.wireId}>{issue.wireId}: {issue.message}</div>)}
        </InfoHint>
      </div>}
      {recoveryError && <div className="he-save-message" role="alert">{recoveryError}
        <button type="button" onClick={() => {
          const url = URL.createObjectURL(new Blob([JSON.stringify(history.present, null, 2)], { type: "application/json" }));
          const link = document.createElement("a"); link.href = url; link.download = `harness-${harnessId}-recovery.json`; link.click();
          window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        }}>Скачать текущую копию</button>
      </div>}
      {recoveryDrafts.map(draft => <div key={draft.id} className="he-recovery-draft" role="alert">
        <span>Аварийная копия от ревизии {draft.baseRevision}. Текущий серверный документ не заменён.</span>
        <button type="button" onClick={() => void (async () => {
          if (recoveryBusy.current) return;
          recoveryBusy.current = true;
          const beforeRestore = historyRef.current;
          const generation = loadGeneration.current;
          try {
            const archived: Pick<ServerRecoveryDraft, "draftId" | "sequence">[] = [];
            if (beforeRestore && JSON.stringify(beforeRestore.present) !== savedJsonRef.current) {
              // The current editor can itself contain unsaved edits when another copy is selected.
              const draftId = crypto.randomUUID();
              await recoveryApi.put(projectId, harnessId, draftId, 1,
                resourceRef.current?.revision ?? 0, beforeRestore.present);
              archived.push({ draftId, sequence: 1 });
            }
            // Archive both alternatives before applying the recovery copy.
            const draftId = crypto.randomUUID();
            await recoveryApi.put(projectId, harnessId, draftId, 1, draft.baseRevision, draft.content);
            archived.push({ draftId, sequence: 1 });
            if (generation !== loadGeneration.current) return;
            if (historyRef.current !== beforeRestore) {
              setRecoveryError("Во время подготовки восстановления документ изменился. Обе копии сохранены; повторите восстановление после завершения изменений.");
              return;
            }
            recoverySession.preserve();
            recoveryArchives.current.push(...archived);
            const next = createEditorHistory(migrateJoiningPipes(draft.content));
            historyRef.current = next; setHistory(next);
            setRecoveryDrafts(current => current.filter(item => item.id !== draft.id));
            if (draft.id === "browser") removeHarnessDesignRecoveryDraft(browserRecoveryStorage(), projectId, harnessId);
            setMessage("Аварийная копия восстановлена; исходная и серверная версии сохранены в журнале.");
          } catch { setRecoveryError("Восстановление отменено: не удалось сохранить обе конфликтующие копии в журнале."); }
          finally { recoveryBusy.current = false; }
        })()}>Восстановить</button>
        <button type="button" onClick={() => {
          const url = URL.createObjectURL(new Blob([JSON.stringify(draft, null, 2)], { type: "application/json" }));
          const link = document.createElement("a"); link.href = url; link.download = `harness-${harnessId}-conflict.json`; link.click();
          window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        }}>Скачать обе версии</button>
        <button type="button" onClick={() => void (async () => {
          try {
            if (draft.id === "browser") removeHarnessDesignRecoveryDraft(browserRecoveryStorage(), projectId, harnessId);
            else await recoveryApi.remove(projectId, harnessId, draft.id, draft.sequence!);
            setRecoveryDrafts(current => current.filter(item => item.id !== draft.id));
          } catch { setRecoveryError("Копия изменилась или журнал недоступен. Аварийная копия не удалена."); }
        })()}>Удалить эту аварийную копию</button>
      </div>)}
      {view==="drawing" && drawingDocument.connectors.some(c=>c.libraryBinding?.mode==="template"&&materializedConnectorIds.has(c.id)&&componentTemplateViewInstances.some(i=>i.objectId===c.id&&projectComponentTemplateView(i,"drawing",{x:0,y:0})?.commands.length)&&c.libraryBinding.snapshot.contacts.some(p=>!p.representations.some(r=>r.viewKind==="drawing"))) && <div className="he-save-message" role="alert">В рисунке не заданы точки части контактов. Откройте рисунок артикула в библиотеке, свяжите контакты с колонкой № либо задайте общий выход для чертежа и обновите компонент.</div>}
      {componentGraphIntegrityMessage && <ComponentGraphErrorAlert
        message={componentGraphIntegrityMessage}
        onRetry={() => void refreshComponentGraph(loadGeneration.current)}
      />}
      <HarnessEditorErrorBoundary
        key={`${harnessId}:${uiFailureNonce}`}
        onError={(failure) => setMessage(`Ошибка отображения: ${failure}`)}
        onRecover={() => {
          setEditingObjectId(null);
          setMovePreview(null);
          setUiFailureNonce((value) => value + 1);
        }}
      ><HarnessEditorWorkspace
        harnessId={harnessId}
        harnessDesignation={harnessDesignation}
        view={view}
        objects={withCoveringTextureUrls(scene,textureAssets.urls).map(object => (object.kind === "wire" || object.kind === "physical-segment" || object.kind === "physical-covering") ? {...object,metadata:{...object.metadata,volumeShading:object.metadata?.volumeShading??String(history.present.drawingDocuments?.volumeShading !== false)}} : object)}
        backgroundObjects={localCopy ? withCoveringTextureUrls(scene.filter(object => hiddenObjectIds.includes(object.id)), textureAssets.urls) : undefined}
        backgroundOpacity={localCopy ? backgroundOpacity : undefined}
        layers={layers}
        catalogItems={catalog.items}
        catalogSources={catalog.sources}
        selectedCatalogSourceId={catalog.selectedSourceId}
        catalogQuery={catalog.query}
        catalogLoadState={catalog.loadState}
        catalogMessage={catalog.message}
        catalogHasMore={catalog.hasMore}
        selectedObjectId={selectedObjectId}
        selectedObjectIds={selectedObjectIds}
        terminalCorrections={selectedTerminalCorrections}
        onTerminalCorrectionApply={(wireId, end, correctionMm) => run({
          type: "update-wire", wireId,
          ...(end === "from" ? { endCorrectionFromMm: correctionMm } : { endCorrectionToMm: correctionMm }),
        })}
        highlightedObjectIds={joiningPipeDraft&&history.present.physicalTopology?joiningPipeDraftHighlights(history.present,joiningPipeDraft):[...related.wireIds,...related.componentIds,...relatedSourceIds]}
        foregroundWireIds={relatedSourceIds.length?related.wireIds:selectedObjectIds.filter(id=>history.present.wires.some(wire=>wire.id===id))}
        onObjectPick={view==='drawing'&&joiningPipeDraft?id=>{if(id&&history.present.physicalTopology)setJoiningPipeDraft(toggleJoiningPipeMember(history.present,joiningPipeDraft,id));}:undefined}
        onObjectPickCancel={()=>setJoiningPipeDraft(null)}
        revealRequest={revealRequest}
        objectProperties={view==="drawing"?id=>
          <DrawingObjectProperties document={history.present} objectId={id} selectedIds={selectedObjectIds} onCommand={run} instances={componentTemplateViewInstances} wireMaterialOptions={wireLookup.databaseOptions} onSelect={id=>{setSelectedObjectId(id);setSelectedObjectIds([id]);}}
            contactSideView={(() => { const placement=history.present.connectors.find(connector=>connector.id===id)?.drawingPlacements?.find(item=>item.drawingId===CONTACT_SIDE_VIEW_PLACEMENT_ID); return {exists:!!placement,visible:placement?.visible,scale:placement ? drawingScale([placement],CONTACT_SIDE_VIEW_PLACEMENT_ID) : undefined}; })()}
            contactSideViewActions={{
              onAdd:()=>run({type:"set-contact-side-view",connectorId:id}),
              onSelect:()=>{setSelectedObjectId(id);setSelectedObjectIds([id]);},
              onShow:()=>run({type:"set-contact-side-view",connectorId:id,visible:true}),
              onHide:()=>run({type:"set-contact-side-view",connectorId:id,visible:false}),
              onScaleChange:scale=>run({type:"set-contact-side-view",connectorId:id,scale}),
            }}
            onBundleEdit={bundleId=>{const topology=history.present.physicalTopology;if(topology)setJoiningPipeDraft(beginJoiningPipe(history.present,bundleId,selectedObjectIds));}}/>:undefined}
        documentActions={<>
          <section className="he-utility-section"><h3>Оконцовки</h3>
            <button type="button" onClick={() => { setTerminationDraft(null); setTerminationPickerError(null); setTerminationPicker({}); }}>Наконечник / гильза из библиотеки</button>
            <button type="button" onClick={() => { const record = BUILTIN_TERMINATION_RECORDS.find(r => r.assetId === 'preparation-none'); if (record) beginTerminationPlacement(record); }}>Разделка</button>
            {terminationDraft && <div role="status">Укажите точку подключения на поле. Щелчок — поставить, Esc — отменить.<button type="button" onClick={() => setTerminationDraft(null)}>Отменить размещение</button></div>}
          </section>
          {view === "e4" && <>
            <ConnectionTableSettings />
            <section className="he-utility-section he-controls-section" aria-labelledby="he-e4-routing-heading">
              <h3 id="he-e4-routing-heading">Маршрути Э4</h3>
              <button
                type="button"
                className="ui-control he-control-action"
                aria-pressed={history.present.views.e4.e4RoutingMode === "angular"}
                onClick={() => run({ type: "set-e4-routing-mode", mode: history.present.views.e4.e4RoutingMode === "angular" ? "orthogonal" : "angular" })}
              >
                {history.present.views.e4.e4RoutingMode === "angular" ? "Углы 30° включены" : "Разрешить углы 30°"}
              </button>
              <InfoHint>Выключено: автоматическая трассировка и ручное перемещение используют только горизонтальные и вертикальные участки. Включено: новые автоматические маршруты и перетягивание точек допускают направления, кратные 30°.</InfoHint>
            </section>
          </>}
          {view === "drawing" && <section className="he-utility-section he-controls-section" aria-labelledby="he-controls-heading">
            <h3 id="he-controls-heading">Настройки чертежа</h3>
          {joiningPipeDraft&&history.present.physicalTopology&&<JoiningPipeEditor document={history.present} draft={joiningPipeDraft} onChange={setJoiningPipeDraft} onCancel={()=>setJoiningPipeDraft(null)} onSave={()=>{try{const topology=joiningPipeDraftTopology(history.present,joiningPipeDraft);if(run({type:'set-physical-topology',topology})){setSelectedObjectId(joiningPipeDraft.id);setSelectedObjectIds([joiningPipeDraft.id]);setJoiningPipeDraft(null);}}catch(error){setMessage(error instanceof Error?error.message:'Не удалось сохранить состав группы.');}}}/>}
          <DrawingRangeControl label="Прозрачность П/ОП" accessibleLabel="Прозрачность пайпов и объединяющих пайпов" min={0} max={100} step={1} digits={0} unit="%" value={pipeOpacityPreview??Math.round((1-(history.present.drawingDocuments?.pipeOpacity??.72))*100)} onPreview={setPipeOpacityPreview} onCommit={transparency=>{const pipeOpacity=1-transparency/100;if(pipeOpacity!==(history.present.drawingDocuments?.pipeOpacity??.72))run({type:"set-drawing-documents",documents:{...(history.present.drawingDocuments??{tables:[],leaders:[],bomOrder:[]}),pipeOpacity}});}} hint="Единая прозрачность всех пайпов и объединяющих пайпов на чертеже. Электрические связи и геометрия не меняются."/>
          <DrawingRangeControl label="Толщина" accessibleLabel="Масштаб толщины проводов" min={.2} max={8} step={.05} value={thicknessPreview??history.present.drawingDocuments?.physicalScale??1} onPreview={setThicknessPreview} onCommit={physicalScale=>{if(physicalScale!==(history.present.drawingDocuments?.physicalScale??1))run({type:"set-drawing-documents",documents:{...(history.present.drawingDocuments??{tables:[],leaders:[],bomOrder:[]}),physicalScale}});}} hint={`Опорный диаметр: ${drawingReferenceDiameter(history.present)} мм. Отношения диаметров сохраняются.`}/>
          {history.present.diffPairs.map((pair,index)=><DrawingRangeControl key={pair.id} label={history.present.diffPairs.length===1?"Шаг витой пары":`Шаг пары ${index+1}`} accessibleLabel={`Шаг витой пары ${index+1}`} min={5} max={Math.max(150,Math.ceil(pair.step/50)*50)} step={1} digits={0} unit=" мм" value={pairPitchPreview?.id===pair.id?pairPitchPreview.step:pair.step} onPreview={step=>setPairPitchPreview(step===null?null:{id:pair.id,step})} onCommit={step=>{if(step!==pair.step)run({type:"update-diff-pair",groupId:pair.id,step});}} hint={`Провода ${pair.wireIds.map(id=>history.present.wires.find(wire=>wire.id===id)?.circuit||id).join(" и ")}. Шаг сохраняется в паре Э4; на чертеже учитывается масштаб толщины.`}/>)}
          <DrawingRangeControl label="Диаметры 1:" unit="" digits={1} accessibleLabel="Соотношение диаметров оболочек" min={1.1} max={4} step={.1} value={coveringRatioPreview??history.present.drawingDocuments?.coveringDiameterRatio??2} onPreview={setCoveringRatioPreview} onCommit={coveringDiameterRatio=>{if(coveringDiameterRatio!==(history.present.drawingDocuments?.coveringDiameterRatio??2))run({type:"set-drawing-documents",documents:{...(history.present.drawingDocuments??{tables:[],leaders:[],bomOrder:[]}),coveringDiameterRatio}});}} hint="Глобальное правило 1:x для соседних оболочек. При увеличении ширины переходы сохраняют форму; локальные ширины и материал не меняются."/>
          <DrawingRangeControl label="Радиус" accessibleLabel="Радиус изгибов чертежа" min={0} max={200} step={1} digits={0} unit="" value={bendRadiusPreview??drawingBendRadius(history.present)} onPreview={setBendRadiusPreview} onCommit={bendRadius=>{if(bendRadius!==drawingBendRadius(history.present))run({type:"set-drawing-documents",documents:{...(history.present.drawingDocuments??{tables:[],leaders:[],bomOrder:[]}),bendRadius}});}} hint="Радиус в координатах чертежа: 0 — острый угол. На коротких плечах радиус автоматически уменьшается. Заданные длины проводов и точки перегиба сохраняются."/>
          <DrawingRangeControl label="Позиции" accessibleLabel="Масштаб позиционных обозначений" min={.25} max={4} step={.05} value={leaderScalePreview??history.present.drawingDocuments?.leaderScale??1} onPreview={setLeaderScalePreview} onCommit={leaderScale=>{if(leaderScale!==(history.present.drawingDocuments?.leaderScale??1))run({type:"set-drawing-documents",documents:{...(history.present.drawingDocuments??{tables:[],leaders:[],bomOrder:[]}),leaderScale}});}} hint="Размер кружков, номеров и точек выносок. Ручное положение сохраняется. Escape отменяет изменение; отпускание ползунка сохраняет его одним шагом отмены."/>
          <DrawingRangeControl label="Индексы ×" accessibleLabel="Масштаб индексов объектов" min={.25} max={4} step={.05} value={indexScalePreview??history.present.drawingDocuments?.indexScale??1} onPreview={setIndexScalePreview} onCommit={indexScale=>{if(indexScale!==(history.present.drawingDocuments?.indexScale??1))run({type:"set-drawing-documents",documents:{...(history.present.drawingDocuments??{tables:[],leaders:[],bomOrder:[]}),indexScale}});}} hint="Общий размер индексов соединителей, проводов и оболочек. Размер сохраняется в этом чертеже."/>
          <DrawingRangeControl label="Размеры ×" accessibleLabel="Масштаб размерных обозначений" min={.25} max={4} step={.05} value={dimensionScalePreview??history.present.drawingDocuments?.dimensionScale??1} onPreview={setDimensionScalePreview} onCommit={dimensionScale=>{if(dimensionScale!==(history.present.drawingDocuments?.dimensionScale??1))run({type:"set-drawing-documents",documents:{...(history.present.drawingDocuments??{tables:[],leaders:[],bomOrder:[]}),dimensionScale}});}} hint="Общий размер текста, стрелок, точек и линий размеров. Значения длин и привязки не меняются."/>
          <DrawingRangeControl label="Мин. нахлёст" accessibleLabel="Минимальная длина новой оболочки поверх оболочки" min={20} max={500} step={5} digits={0} unit="px" value={minimumOverlapPreview??history.present.drawingDocuments?.minimumCoveringOverlapPx??100} onPreview={setMinimumOverlapPreview} onCommit={minimumCoveringOverlapPx=>{if(minimumCoveringOverlapPx!==(history.present.drawingDocuments?.minimumCoveringOverlapPx??100))run({type:"set-drawing-documents",documents:{...(history.present.drawingDocuments??{tables:[],leaders:[],bomOrder:[]}),minimumCoveringOverlapPx}});}} hint="Новая оболочка занимает 5% длины нижней, но не меньше заданного значения; если нижняя короче, покрывается доступный участок."/>
          <DrawingRangeControl label="Выступ ОП" accessibleLabel="Ширина выступа оболочки ОП на переходе" min={0} max={24} step={1} digits={0} unit="px" value={opCoveringEdgePreview??history.present.drawingDocuments?.opCoveringEdgePx??2} onPreview={setOpCoveringEdgePreview} onCommit={opCoveringEdgePx=>{if(opCoveringEdgePx!==(history.present.drawingDocuments?.opCoveringEdgePx??2))run({type:"set-drawing-documents",documents:{...(history.present.drawingDocuments??{tables:[],leaders:[],bomOrder:[]}),opCoveringEdgePx}});}} hint="Дополнительная ширина краёв оболочки на переходе ОП↔П. Нулевое значение убирает выступ; значение сохраняется в этом чертеже."/>
          <label>Размеры<select aria-label="Общее направление размеров" value={history.present.drawingDocuments?.dimensionMode??"aligned"} onChange={e=>run({type:"set-drawing-documents",documents:{...(history.present.drawingDocuments??{tables:[],leaders:[],bomOrder:[]}),dimensionMode:e.target.value as import("./drawing-dimensions").DimensionMode}})}><option value="aligned">Между концами</option><option value="horizontal">Горизонтально</option><option value="vertical">Вертикально</option><option value="path">Вдоль пайпа</option></select></label>
          <button type="button" className="ui-control he-control-action" aria-pressed={history.present.drawingDocuments?.showDimensions??!!history.present.drawingDocuments?.dimensions?.length} onClick={()=>run({type:"set-drawing-documents",documents:toggleDrawingDimensions(history.present)})}><span className="he-doc-icon"><DocumentIcon kind="dimensions" /></span>Отобразить размеры</button>
          <button type="button" className="ui-control he-control-action" disabled={!volumeEligible} aria-pressed={history.present.drawingDocuments?.volumeShading!==false} onClick={()=>{const documents=history.present.drawingDocuments??{tables:[],leaders:[],bomOrder:[]};run({type:"set-drawing-documents",documents:{...documents,volumeShading:documents.volumeShading===false}})}}><span className="he-doc-icon"><DocumentIcon kind="volume" /></span>Объёмный свет</button>
          <InfoHint>Затемнение краёв и светлая середина пайпов, проводов и покрытий. Сохраняется для этого чертежа; отключение не меняет материалы, цвета и размеры.</InfoHint>
        </section>}
          <section className="he-utility-section he-documents-section" aria-labelledby="he-documents-heading">
            <h3 id="he-documents-heading">Документы</h3>
            {view === "drawing" && <button type="button" className="ui-control he-document-action" onClick={()=>run({type:"set-drawing-documents",documents:addDrawingPositions(history.present,drawingPerimeters)})}><span className="he-doc-icon"><DocumentIcon kind="positions" /></span>Добавить позиции</button>}
            {view === "drawing" && <button type="button" className="ui-control he-document-action he-document-toggle" aria-pressed={positionsVisible} aria-label={positionsVisible?"Скрыть позиции":"Показать позиции"} title={positionsVisible?"Скрыть позиции на чертеже":"Показать позиции на чертеже"} onClick={()=>run({type:"set-drawing-documents",documents:setDrawingPositionsVisibility(history.present,!positionsVisible,drawingPerimeters)})}><span className="he-doc-icon"><DocumentIcon kind="visibility" visible={positionsVisible} /></span>Позиции</button>}
            {(["connections","cut","bom"] as const).map(kind=><button type="button" className="ui-control he-document-action" key={kind} disabled={kind==="cut"&&!routeCutReadiness(history.present,resource.sourceFingerprint,saveState!=="saved").ready} title={kind==="cut"?routeCutReadiness(history.present,resource.sourceFingerprint,saveState!=="saved").message:undefined} onClick={()=>{if(kind!=="connections"&&view!=="drawing"){setView("drawing");onViewChange?.("drawing");}const documents=history.present.drawingDocuments??{tables:[],leaders:[],bomOrder:[]};if(!documents.tables.some(t=>t.kind===kind))run({type:"set-drawing-documents",documents:{...documents,tables:[...documents.tables,{id:crypto.randomUUID(),kind,position:{x:20,y:20},dock:"bottom",width:960,height:300}]}});}}><span className="he-doc-icon"><DocumentIcon kind={kind} /></span>{kind==="bom"?"Спецификация":kind==="cut"?"Карта резки":"Таблица соединений"}</button>)}
          </section>
        </>}
        drawingWindows={localCopy?.captureSelection ? undefined : camera=><DrawingTableWindows connectionTableSettings={connectionTableSettings} sourceFingerprint={resource.sourceFingerprint} wireOptions={wireLookup.options} wireDatabaseOptions={wireLookup.databaseOptions} onWireSearch={wireLookup.search} perimeters={drawingPerimeters} view={view} document={history.present} camera={camera} quantity={harnessQuantity} revision={resource.revision} unsaved={saveState!=="saved"} selectedIds={[...selectedObjectIds,...related.rowIds]} onChange={documents=>run({type:"set-drawing-documents",documents})} onCommand={run} onReveal={ids=>{setRelatedSourceIds(ids);setSelectedObjectId(null);setSelectedObjectIds([]);}}/>}
        onDimensionCreate={(wireId,from,to,pointCount,mode,auxiliary)=>{
          const wire=history.present.wires.find(w=>w.id===wireId),segment=history.present.physicalTopology?.segments.find(s=>s.id===wireId);if(!wire&&!segment)return;
          const id=crypto.randomUUID(),documents=history.present.drawingDocuments??{tables:[],leaders:[],bomOrder:[]};
          if(segment){
            if(run({type:"add-visible-pipe-dimension",id,segmentId:segment.id,from,to,pointCount,mode:history.present.drawingDocuments?.dimensionMode??mode,auxiliary})){setSelectedObjectId(id);setSelectedObjectIds([id]);}
            return;
          }
          if(run({type:"set-drawing-documents",documents:{...documents,dimensions:[...documents.dimensions??[],{id,wireId,auxiliary,modeOverride:false,from:Math.min(from,to),to:Math.max(from,to),pointCount,routeKey:dimensionRouteKey(history.present,wire!),mode,offset:40,lengthMm:null}]}})){setSelectedObjectId(id);setSelectedObjectIds([id]);}
        }}
        onPositionRailCreate={(start,end,leaderIds)=>{
          const documents=history.present.drawingDocuments??{tables:[],leaders:[],bomOrder:[]};
          const rail={id:crypto.randomUUID(),start,end,leaderIds};
          run({type:"set-drawing-documents",documents:createPositionRail(documents,rail)});
        }}
        onGraphicCreate={graphic=>{const documents=history.present.drawingDocuments??{tables:[],leaders:[],bomOrder:[]};if(run({type:"set-drawing-documents",documents:{...documents,graphics:[...(documents.graphics??[]),graphic]}})){setSelectedObjectId(graphic.id);setSelectedObjectIds([graphic.id]);}}}
        drawingSnaps={drawingSnaps}
        drawingAngleStep={graphicAngleStep}
        selectedGraphic={history.present.drawingDocuments?.graphics?.some(g=>selectedObjectIds.includes(g.id))??false}
        canPasteGraphic={graphicsClipboardRef.current.length>0}
        onGraphicCopy={()=>{graphicsClipboardRef.current=(history.present.drawingDocuments?.graphics??[]).filter(g=>selectedObjectIds.includes(g.id));}}
        onGraphicPaste={()=>{const documents=history.present.drawingDocuments??{tables:[],leaders:[],bomOrder:[]},copies=graphicsClipboardRef.current.map(g=>({...g,id:crypto.randomUUID(),view,points:g.points.map(p=>({x:p.x+20,y:p.y+20}))}));if(copies.length&&run({type:"set-drawing-documents",documents:{...documents,graphics:[...(documents.graphics??[]),...copies]}})){setSelectedObjectIds(copies.map(g=>g.id));setSelectedObjectId(copies.at(-1)?.id??null);}}}
        onGraphicDelete={()=>{const commands=selectedEditorDeletionCommands(history.present,selectedObjectIds);commands.filter(c=>c.type==="set-drawing-documents"&&c.documents.graphics!==undefined).forEach(run);setSelectedObjectIds([]);setSelectedObjectId(null);}}
        onUndo={()=>setHistory(current=>current?undoEditorCommand(current):current)}
        angleStep={graphicAngleStep}
        onAngleStepChange={setGraphicAngleStep}
        onDrawingSnapsChange={setDrawingSnaps}
        relationPanel={()=><>{view === "drawing" && <PhysicalTopologyPanel mode="actions" document={history.present} selectedId={selectedObjectId} selectedIds={selectedObjectIds} onChange={topology => run({ type: "set-physical-topology", topology })} onSelect={(id,additive) => { setRelatedSourceIds([]); setSelectedObjectId(id); setSelectedObjectIds(additive ? [...new Set([...selectedObjectIds,id])] : [id]); }} />}{view==="drawing"&&<SpecificationItemsPanel documents={history.present.drawingDocuments} selectedId={selectedObjectId} onChange={documents=>run({type:"set-drawing-documents",documents})} onSelect={id=>{setSelectedObjectId(id);setSelectedObjectIds([id]);}}/>}{view==="drawing"&&<DrawingDimensionsPanel pipeInterval={selectedPipeInterval} document={history.present} selectedId={selectedObjectId} onChange={documents=>run({type:"set-drawing-documents",documents})}/>} {<DrawingDocumentsPanel connectionTableSettings={connectionTableSettings} sourceFingerprint={resource.sourceFingerprint} unsaved={saveState!=="saved"} wireOptions={wireLookup.options} wireDatabaseOptions={wireLookup.databaseOptions} onWireSearch={wireLookup.search} perimeters={drawingPerimeters} availableKinds={view==="drawing"?undefined:["connections"]} document={history.present} quantity={harnessQuantity} selectedId={selectedObjectId} selectedIds={[...selectedObjectIds,...related.wireIds,...related.componentIds,...related.rowIds]} onChange={documents=>run({type:"set-drawing-documents",documents})} onCommand={run} onReveal={ids=>{setRelatedSourceIds(ids);setSelectedObjectId(null);setSelectedObjectIds([]);}} />}<HarnessRelationsPanel sourceFingerprint={resource.sourceFingerprint} showCut={view==="drawing"} onOpenCut={view==="drawing"?()=>run({type:"set-drawing-documents",documents:{...(history.present.drawingDocuments??{tables:[],leaders:[],bomOrder:[]}),tables:[...(history.present.drawingDocuments?.tables??[]),{id:crypto.randomUUID(),kind:"cut",position:{x:20,y:20}}]}}):undefined} revision={resource.revision} onCommand={run} document={history.present} projectId={projectId} harnessId={harnessId} quantity={harnessQuantity} related={related} wholeNet={wholeNet} onWholeNet={setWholeNet} unsaved={saveState !== "saved"} hiddenCount={related.wireIds.filter(id => { const wire = history.present.wires.find(w => w.id === id); return wire && layers.some(layer => layer.id === wire.layerIds[view] && !layer.visible); }).length}
          onClear={() => {setRelatedSourceIds([]); setSelectedObjectId(null); setSelectedObjectIds([]);}}
          onReveal={id => {
            const found = id && selectionIndex ? resolveHarnessSelection(selectionIndex, [id], wholeNet) : related;
            if (id) { setRelatedSourceIds([id]); setSelectedObjectId(null); setSelectedObjectIds([]); }
            setEditingObjectId(null); setView("drawing"); onViewChange?.("drawing");
            setRevealRequest({token: Date.now(), objectIds: [...found.wireIds, ...found.componentIds]});
          }} />
        </>}
        cables={(previewResult.document ?? history.present).cables}
        e4Overlays={view === "e4" ? {
          crossingStyle: history.present.views.e4.wireCrossingStyle,
          junctions: history.present.junctions,
          diffPairs: history.present.diffPairs,
          screens: history.present.screens,
        } : undefined}
        e4RoutingMode={history.present.views.e4.e4RoutingMode ?? "orthogonal"}
        componentTemplateViewInstances={componentTemplateViewInstances}
        resolveComponentTemplateAssetUrl={resolveComponentTemplateAssetUrl}
        saveState={saveState}
        onSaveRequest={localCopy?.captureSelection ? () => {
          const current = historyRef.current?.present;
          if (current) { try { localCopy.onObjectsSave?.(current, selectedObjectIds, scene); }
            catch (error) { setMessage(error instanceof Error ? error.message : "Не удалось сохранить слепок."); } }
        } : localCopy ? () => {
          const current = historyRef.current?.present;
          if (current) {
            try {
              saveLocalDrawingCopy(current, hiddenObjectIds, backgroundOpacity, localCopy.onSave);
              setSaveState("saved");
              setMessage("");
            } catch (error) {
              setSaveState("error");
              setMessage(error instanceof Error ? error.message : "Не удалось сохранить фрагмент.");
            }
          }
        } : () => void flushSave()}
        localCopyControls={localCopy ? {
          hiddenObjectIds, backgroundOpacity, captureSelection: localCopy.captureSelection, allowCleanSave: localCopy.allowCleanSave,
          onHiddenObjectIdsChange: ids => { setHiddenObjectIds(ids); localCopy.onHiddenObjectIdsChange?.(ids); },
          onBackgroundOpacityChange: opacity => { setBackgroundOpacity(opacity); localCopy.onBackgroundOpacityChange?.(opacity); },
          onObjectsIsolate: localCopy.onIsolateObjects ? isolateLocalObjects : undefined,
          onObjectsSave: localCopy.onObjectsSave ? (objectIds => {
            const current = historyRef.current?.present;
            if (!current) return;
            try { localCopy.onObjectsSave?.(current, objectIds, scene); }
            catch (error) { setMessage(error instanceof Error ? error.message : "Не удалось сохранить слепок."); }
          }) : undefined,
          onCancel: localCopy.onCancel,
        } : undefined}
        onDrawingScale={(connectorId,drawingId,scale)=>run({type:"set-drawing-placement",connectorId,drawingId,scale})}
        onDrawingMove={(connectorId,drawingId,offset)=>run({type:"set-drawing-placement",connectorId,drawingId,offset})}
        propertyInspector={selectedObjectId && history.present.drawingDocuments?.graphics?.some(g=>g.id===selectedObjectId) ? <DrawingObjectProperties document={history.present} objectId={selectedObjectId} selectedIds={selectedObjectIds} onCommand={run} instances={componentTemplateViewInstances} wireMaterialOptions={wireLookup.databaseOptions} onSelect={id=>{setSelectedObjectId(id);setSelectedObjectIds([id]);}}/> : selectedObjectId && (history.present.drawingDocuments?.specificationItems?.some(i=>i.id===selectedObjectId) || history.present.drawingDocuments?.dimensions?.some(d=>d.id===selectedObjectId) || history.present.drawingDocuments?.tables.some(t=>t.id===selectedObjectId) || history.present.drawingDocuments?.leaders.some(l=>l.id===selectedObjectId||`${l.id}:anchor`===selectedObjectId) || history.present.drawingDocuments?.rails?.some(r=>selectedObjectId===r.id||selectedObjectId===`${r.id}:start`||selectedObjectId===`${r.id}:end`) || history.present.physicalTopology?.coverings?.some(c=>c.id===selectedObjectId) || history.present.physicalTopology?.nodes.some(n=>n.id===selectedObjectId) || history.present.physicalTopology?.segments.some(s=>s.id===selectedObjectId) || history.present.physicalTopology?.joiningPipes?.some(p=>p.id===selectedObjectId)) ? <></> : selectedConnector ? (<>
          {view==="e4" && (()=>{
            const instance=componentTemplateViewInstances.find(i=>i.objectId===selectedConnector.id);
            const drawings=instance ? projectE4DrawingCompanions(instance,{x:0,y:0},300,resolveComponentTemplateAssetUrl) : [];
            return drawings.length ? <section className="he-companion-list" aria-label="Рисунки компонента"><header className="ui-section-heading"><strong>Рисунки артикула</strong><InfoHint>Показать или скрыть рисунок на Э4. Перетаскивайте рисунок мышью; прямая пунктирная линия связывает его с таблицей. Группа фигур перемещается как один рисунок.</InfoHint></header>{drawings.map(d=><label key={d.drawingId}><input type="checkbox" aria-label={`Показать ${d.label}`} checked={d.visible} disabled={selectedConnectorLayer?.locked===true} onChange={e=>run({type:"set-drawing-placement",connectorId:selectedConnector.id,drawingId:d.drawingId,visible:e.target.checked})}/>{d.label}<DrawingScaleControl label={`Масштаб ${d.label}`} value={drawingScale(selectedConnector.drawingPlacements,d.drawingId)} disabled={selectedConnectorLayer?.locked===true} onChange={scale=>run({type:"set-drawing-placement",connectorId:selectedConnector.id,drawingId:d.drawingId,scale})}/></label>)}</section> : null;
          })()}
          <TerminationInspector key={selectedConnector.id} document={history.present} connector={selectedConnector} disabled={selectedConnectorLayer?.locked===true} onCommand={run} onChooseArtifact={(apply,kind)=>{setTerminationDraft(null);setTerminationPickerError(null);setTerminationPicker({apply,kind,document:history.present});}}/>
          {!selectedConnector.terminationComponent && <E4ConnectorInspector
            connector={selectedConnector}
            onRefreshTerminals={refreshTemplateTerminals}
            refreshingTerminals={refreshingTerminals}
            series={selectedConnectorSeries}
            templateArticleOptions={selectedTemplateArticleOptions}
            onTemplateArticleSelect={selectTemplateArticle}
            terminalArticles={terminalLookup.articles}
            terminalDetails={(article) => resolveTerminalDetails(article, terminalLookup.records)}
            wireOptions={wireLookup.options} wireMaterialOptions={wireLookup.databaseOptions} wireLookupMessage={wireLookup.message} onWireSearch={wireLookup.search}
            onTerminalSearch={terminalLookup.search}
            wireColors={editorWireColors}
            disabled={selectedConnectorLayer?.locked === true}
            onCommand={run}
          />}
        </>) : view === "drawing" && selectedWireIds.length >= 2 ? (
          <><PhysicalTwistControls document={history.present} wireIds={selectedWireIds} disabled={selectedWiresLocked} onCommand={run}/><CableSelectionPanel
            selectedWireIds={selectedWireIds}
            cable={selectedCable}
            disabled={selectedWiresLocked}
            onCreate={() => run({ type: "add-cable", cable: {
              id: crypto.randomUUID(), memberWireIds: selectedWireIds, lengthMm: null,
              endCorrectionFromMm: 0, endCorrectionToMm: 0, cutRoundingStepMm: 1,
            } })}
            onUpdate={(patch) => selectedCable && run({ type: "update-cable", cableId: selectedCable.id, ...patch })}
            onMaterialClear={() => selectedCable && run({ type: "update-cable", cableId: selectedCable.id, materialBinding: null })}
            onRemove={() => selectedCable && run({ type: "remove-cable", cableId: selectedCable.id })}
          /></>
        ) : undefined}
        canvasEditor={selectedConnector && !selectedConnector.terminationComponent ? (
          <E4ConnectorInspector
            connector={selectedConnector}
            onRefreshTerminals={refreshTemplateTerminals}
            refreshingTerminals={refreshingTerminals}
            series={selectedConnectorSeries}
            templateArticleOptions={selectedTemplateArticleOptions}
            onTemplateArticleSelect={selectTemplateArticle}
            terminalArticles={terminalLookup.articles}
            terminalDetails={(article) => resolveTerminalDetails(article, terminalLookup.records)}
            wireOptions={wireLookup.options} wireMaterialOptions={wireLookup.databaseOptions} wireLookupMessage={wireLookup.message} onWireSearch={wireLookup.search}
            onTerminalSearch={terminalLookup.search}
            wireColors={editorWireColors}
            disabled={selectedConnectorLayer?.locked === true}
            onCommand={run}
            mode="canvas"
            editing={editingObjectId === selectedConnector.id}
            onEditingChange={(editing) => setEditingObjectId(editing ? selectedConnector.id : null)}
          />
        ) : undefined}
        diagnostics={[...diagnostics.map((diagnostic) => ({
          id: diagnostic.id,
          objectId: diagnostic.target.objectId,
          label: diagnostic.designation,
          message: diagnostic.message,
        })), ...routingIssues.map((issue) => ({
          id: `routing:${issue.wireId}`, objectId: issue.wireId,
          label: history.present.wires.find((wire) => wire.id === issue.wireId)?.circuit || issue.wireId,
          message: issue.message,
        }))]}
        pendingPlacement={terminationPreview}
        onPlacementCancel={() => setTerminationDraft(null)}
        onPlace={point => {
          if (!terminationDraft || !terminationPreview) return;
          const layerError = placementLayerError(terminationPreview, history.present.views[view].layers);
          if (layerError) { setMessage(layerError); return; }
          const origin = placementOrigin(terminationPreview, point);
          const connector = {...terminationDraft.connector, positions: {e4: origin, drawing: origin}};
          if (!run({type: 'add-termination-component', ...terminationDraft, connector})) return;
          setTerminationDraft(null); setSelectedObjectId(connector.id); setSelectedObjectIds([connector.id]);
        }}
        previewMessage={previewResult.error}
        onViewChange={(nextView) => {
          setTerminationDraft(null);
          setJoiningPipeDraft(null);
          setEditingObjectId(null);
          setView(nextView);
          onViewChange?.(nextView);
        }}
        onRouteRequest={!localCopy && onRouteRequest ? async () => {
          if (await flushSave()) onRouteRequest();
        } : undefined}
        onSectionChange={!localCopy && onSectionChange ? async section => {
          if (section === "e4" || section === "drawing") return;
          if (await flushSave()) await onSectionChange(section);
        } : undefined}
        onSelectedObjectChange={(objectId) => {
          setRelatedSourceIds([]);
          setSelectedObjectId(objectId);
          setEditingObjectId((current) => current === objectId ? current : null);
        }}
        onSelectedObjectIdsChange={setSelectedObjectIds}
        onCatalogItemActivate={addCatalogItem}
        onCatalogSourceChange={catalog.selectSource}
        onCatalogQueryChange={catalog.changeQuery}
        onCatalogLoadMore={catalog.loadMore}
        onCatalogRetry={catalog.retry}
        onWireMaterialClear={(wireId) => run({ type: "update-wire", wireId, materialBinding: null })}
        wireMaterialOptions={wireLookup.databaseOptions}
        onWireMaterialSelect={(wireId,option)=>{
          if(!option.materialBinding)return;
          const wire=history.present.wires.find(item=>item.id===wireId);
          const end=wire&&[wire.from,wire.to].find(endpoint=>"connectorId" in endpoint);
          if(end&&"connectorId" in end)run({type:"update-contact",connectorId:end.connectorId,contactId:end.contactId,
            wire:option.mark,wireSection:option.section,wireDiameterMm:option.diameterMm??null,
            materialBinding:option.materialBinding,...(option.color?{color:option.color}:{})});
          else run({type:"update-wire",wireId,materialBinding:option.materialBinding});
        }}
        selectedWireStripProfiles={selectedObjectIds.length === 1
          ? history.present.wires.find((wire) => wire.id === selectedObjectIds[0])?.stripProfiles
          : undefined}
        activeWireStripEnd={activeWireStripEnd}
        onActiveWireStripEndChange={setActiveWireStripEnd}
        onWireStripProfileClear={(wireId, end) => run({ type: "set-wire-strip-profile", wireId, end, profile: null })}
        onDrawingEndStyleChange={(wireId, end, style) => run({ type: "set-wire-drawing-end-style", wireId, end, style })}
        onDrawingEndStylesChange={(wireIds, end, style) => run({ type: "set-wire-drawing-end-styles", wireIds, end, style })}
        onDrawingEndEndpointChange={(wireId, end, position) => run({ type: "set-wire-drawing-endpoint", wireId, end, position })}
        onDrawingEndBulkXChange={(wireIds, end, x) => run({ type: "set-wire-drawing-endpoints-x", wireIds, end, x })}
        onRelatedObjectsSelect={ids=>{setRelatedSourceIds(ids);setSelectedObjectId(null);setSelectedObjectIds([]);}}
        onObjectMove={(objectId, point, mode="carry") => {
          const index=moveDrawingIndex(history.present,objectId,point,scene);
          if(index){run({type:"set-drawing-documents",documents:index});return;}
          const annotation=moveDrawingAnnotation(history.present,objectId,point,drawingPerimeters,drawingSnaps);
          if(annotation){run({type:"set-drawing-documents",documents:annotation});return;}
          const topology = history.present.physicalTopology;
          const joiningPipe=topology?.joiningPipes?.find(pipe=>pipe.id===objectId);
          if(joiningPipe){run({type:"move-joining-pipe",pipeId:joiningPipe.id,delta:point});return;}
          const opEndpoint=joiningPipeEndpoint(topology,objectId);
          if(opEndpoint){run({type:"update-joining-pipe",pipeId:opEndpoint.pipe.id,[opEndpoint.side==="from"?"start":"end"]:{x:point.x+5,y:point.y+5}});return;}
          const opExit=joiningPipeExit(topology,objectId);
          if(opExit){run({type:"update-joining-pipe-exit",pipeId:opExit.pipe.id,side:opExit.side,position:{x:point.x+5,y:point.y+5}});return;}
          const node = topology?.nodes.find(n => n.id === objectId);
          if (topology && node) { const original=physicalNodePoint(history.present,node),display=pipeBundleNodePoint(history.present,node.id,original);
            run({type:"move-physical-node",nodeId:node.id,position:{x:point.x+5+original.x-display.x,y:point.y+5+original.y-display.y},mode}); }
          else run({type:"move-connector",connectorId:objectId,view,position:point,physicalDragMode:mode});
        }}
        onPipeIntervalSelect={(id,from,to)=>setSelectedPipeInterval({id,from,to})}
        onCoveringDrag={(id,spanIndex,part,start,point,phase)=>{
          if(phase==="cancel"){setCoveringPreview(null);return;}
          const covering=moveCovering(history.present,id,spanIndex,part,start,point);if(!covering)return;
          if(phase==="preview")setCoveringPreview(covering);
          else {setCoveringPreview(null);const t=history.present.physicalTopology!;run({type:"set-physical-topology",topology:{...t,coverings:t.coverings?.map(c=>c.id===id?covering:c)}});}
        }}
        onPhysicalNodesConnect={(from,to)=>{const t=history.present.physicalTopology;if(t&&from!==to){const existing=t.segments.find(s=>s.from===from&&s.to===to||s.from===to&&s.to===from);const id=existing?.id??crypto.randomUUID();if(existing||run({type:"set-physical-topology",topology:routePhysicalWires(history.present,{...t,segments:[...t.segments,{id,from,to,path: { kind: "routed" as const, points: [] }}]})})){setSelectedObjectId(id);setSelectedObjectIds([id]);}}}}
        onPhysicalNodeConnectToSegment={(fromNodeId,segmentId,point)=>{const t=history.present.physicalTopology;if(!t)return;try{const ids={junction:crypto.randomUUID(),segment:crypto.randomUUID(),continuation:crypto.randomUUID()};const topology=routePhysicalWires(history.present,connectPhysicalNodeToSegment(history.present,fromNodeId,segmentId,unprojectPipeBundlePoint(history.present,segmentId,point),ids));if(run({type:"set-physical-topology",topology})){setSelectedObjectId(ids.segment);setSelectedObjectIds([ids.segment]);}}catch(error){setMessage(error instanceof Error?error.message:"Не удалось присоединить точку к пайпу.");}}}
        onPhysicalContextAction={(segmentId,point,action,target="segment")=>{
          const t=history.present.physicalTopology;if(!t)return;
          if(target!=="covering")point=unprojectPipeBundlePoint(history.present,segmentId,point);
          if(action==="remove-pipe"){
            if(run({type:"remove-physical-segment",segmentId})){setSelectedObjectId(null);setSelectedObjectIds([]);}
            return;
          }
          if(action==="branch"){
            try{const ids={junction:crypto.randomUUID(),continuation:crypto.randomUUID(),tip:crypto.randomUUID(),branch:crypto.randomUUID()};
            if(run({type:"set-physical-topology",topology:branchPhysicalSegment(history.present,segmentId,point,ids)})){setSelectedObjectId(ids.tip);setSelectedObjectIds([ids.tip]);}}
            catch(error){setMessage(error instanceof Error?error.message:"Не удалось создать ответвление.");}return;
          }
          const source=target==="covering"?t.coverings?.find(c=>c.id===segmentId):undefined;
          if(target==="covering"&&!source)return;
          const covering=source?standardCoveringOver(history.present,source,action,crypto.randomUUID(),point):standardCovering(history.present,segmentId,point,action,crypto.randomUUID());
          if(run({type:"set-physical-topology",topology:{...t,coverings:[...t.coverings??[],covering]}})){setSelectedObjectId(covering.id);setSelectedObjectIds([covering.id]);}
        }}
        onObjectMovePreview={previewObjectMove}
        onObjectEditRequest={(objectId) => {
          setSelectedObjectId(objectId);
          setSelectedObjectIds([objectId]);
          setEditingObjectId(objectId);
        }}
        onWireConnect={(from, to) => {
          const resolveEndpoint = (endpoint: typeof from): WireEndpoint | null => {
            if ("screenId" in endpoint) return createScreenEndpoint(endpoint.screenId, endpoint.screenTerminalSide);
            const connector = history.present.connectors.find((item) => item.id === endpoint.connectorId);
            const contact = connector && (view === "e4" ? connectorE4Contacts(connector) : connector.contacts)[endpoint.contactIndex];
            return contact ? { connectorId: endpoint.connectorId, contactId: contact.id } : null;
          };
          const fromEndpoint = resolveEndpoint(from);
          const toEndpoint = resolveEndpoint(to);
          if (!fromEndpoint || !toEndpoint) return;
          const id = crypto.randomUUID();
          if (!run({
            type: "add-wire",
            wire: createRoutedWire(id, fromEndpoint, toEndpoint),
          })) return;
          setSelectedObjectId(id);
          setSelectedObjectIds([id]);
        }}
        onWireReconnect={(wireId, end, target) => {
          const endpoint: WireEndpoint | null = "screenId" in target
            ? createScreenEndpoint(target.screenId, target.screenTerminalSide)
            : (() => {
              const connector = history.present.connectors.find((item) => item.id === target.connectorId);
              const contact = connector && (view === "e4" ? connectorE4Contacts(connector) : connector.contacts)[target.contactIndex];
              return contact ? { connectorId: target.connectorId, contactId: contact.id } : null;
            })();
          if (!endpoint) return;
          const existing = history.present.wires.find(item => item.id === wireId);
          const terminalCorrection = existing
            ? wireEndTerminalCorrections(history.present, { ...existing, [end]: endpoint }, terminalLookup.records)[end]?.plusMm
            : undefined;
          const reconnected = run({
            type: "reconnect-wire",
            wireId,
            end,
            endpoint,
          });
          if (reconnected && terminalCorrection !== undefined && terminalCorrection !== null) run({
            type: "update-wire", wireId,
            ...(end === "from" ? { endCorrectionFromMm: terminalCorrection } : { endCorrectionToMm: terminalCorrection }),
          });
          setSelectedObjectId(wireId);
          setSelectedObjectIds([wireId]);
        }}
        onWireConnectToWire={(from, targetWireId, point) => {
          const fromEndpoint: WireEndpoint | null = "screenId" in from
            ? createScreenEndpoint(from.screenId, from.screenTerminalSide)
            : (() => {
              const connector = history.present.connectors.find((item) => item.id === from.connectorId);
              const contact = connector && (view === "e4" ? connectorE4Contacts(connector) : connector.contacts)[from.contactIndex];
              return contact ? { connectorId: from.connectorId, contactId: contact.id } : null;
            })();
          const targetWire = history.present.wires.find((item) => item.id === targetWireId);
          if (!fromEndpoint || !targetWire) return;
          const wireId = crypto.randomUUID();
          const existingJunction = history.present.junctions.find((junction) =>
            junction.wireIds.includes(targetWireId) &&
            Math.hypot(junction.position.x - point.x, junction.position.y - point.y) < 0.01);
          const junctionId = existingJunction?.id ?? crypto.randomUUID();
          const toEndpoint = createJunctionEndpoint(junctionId);
          const terminalCorrections = wireEndTerminalCorrections(history.present, { from: fromEndpoint, to: toEndpoint }, terminalLookup.records);
          const base = createWire(wireId, fromEndpoint, toEndpoint, null, targetWire.circuit, "#334155",
            terminalCorrections.from?.plusMm ?? 0, terminalCorrections.to?.plusMm ?? 0);
          const branchWire = base;
          const succeeded = existingJunction
            ? run({ type: "add-wire", wire: branchWire, targetWireId })
            : run({
              type: "create-junction",
              junction: { id: junctionId, position: point, wireIds: [targetWireId, wireId] },
              branchWire,
            });
          if (succeeded) {
            setSelectedObjectId(wireId);
            setSelectedObjectIds([wireId]);
          }
        }}
        onWireReconnectToWire={(wireId, end, targetWireId, point) => {
          const existingJunction = history.present.junctions.find((junction) =>
            junction.wireIds.includes(targetWireId) &&
            Math.hypot(junction.position.x - point.x, junction.position.y - point.y) < 0.01);
          const succeeded = existingJunction
            ? run({
              type: "connect-wire-to-wire",
              wireId,
              end,
              targetWireId,
              junctionId: existingJunction.id,
              position: existingJunction.position,
            })
            : run({
              type: "connect-wire-to-wire",
              wireId,
              end,
              targetWireId,
              junctionId: crypto.randomUUID(),
              position: point,
            });
          if (succeeded) {
            setSelectedObjectId(wireId);
            setSelectedObjectIds([wireId]);
          }
        }}
        onE4WireSegmentMove={(wireId, segmentIndex, coordinate) => run({
          type: "move-e4-wire-segment",
          wireId,
          segmentIndex,
          position: { x: coordinate, y: coordinate },
          detached: e4Detached,
        })}
        e4Detached={e4Detached}
        onE4DetachedChange={setE4Detached}
        onE4Reroute={() => {
          if (run({ type: "reroute-e4-wires", wireIds: selectedWireIds })) setE4Detached(false);
        }}
        onE4WireRoutePointRemove={(wireId, routeIndex) => run({
          type: "remove-e4-wire-route-point",
          wireId,
          pointIndex: routeIndex,
        })}
        onE4WireLabelPositionChange={(wireId, position) => run({
          type: "set-e4-wire-label-position",
          wireId,
          position,
        })}
        onE4ScreenPositionChange={(screenId, position) => run({
          type: "update-screen",
          screenId,
          position,
        })}
        onE4CrossingStyleChange={(style) => run({ type: "set-wire-crossing-style", view: "e4", style })}
        onE4DifferentialPairChange={changeDiffPair}
        onE4ScreenChange={changeScreen}
        onE4ClearGroup={() => {
          for (const group of history.present.diffPairs.filter((item) =>
            item.wireIds.some((id) => selectedWireIds.includes(id)))) {
            run({ type: "remove-diff-pair", groupId: group.id });
          }
          for (const screen of history.present.screens.filter((item) =>
            item.wireIds.some((id) => selectedWireIds.includes(id)))) {
            run({ type: "remove-screen", screenId: screen.id });
          }
        }}
        onFreeWireEndpointMove={(wireId,end,position)=>{setFreeEndPreviews([]);run({type:"set-wire-drawing-endpoint",wireId,end,position});}}
        onFreeWireEndpointsXChange={(wireIds,end,x)=>{setFreeEndPreviews([]);run({type:"set-wire-drawing-endpoints-x",wireIds,end,x});}}
        onFreeWireEndpointPreview={(wireId,end,position)=>setFreeEndPreviews(current=>position
          ? [...current.filter(preview=>preview.wireId!==wireId||preview.end!==end),{wireId,end,position}]
          : current.filter(preview=>preview.wireId!==wireId||preview.end!==end))}
        onDetachedPairAction={(wireIds,action)=>run({type:"set-detached-wire-pair",wireIds,action})}
        onWireRoutePointPreview={(id,index,point,mode,insert)=>setPipePreview(point&&(view==="e4"||history.present.wires.some(w=>w.id===id&&w.drawingEndpoints)||history.present.physicalTopology?.segments.some(s=>s.id===id)||history.present.physicalTopology?.joiningPipes?.some(p=>p.id===id))?{id,index,point,mode,insert}:null)}
        onWireRoutePointMove={(wireId, routeIndex, point, mode="carry", insert=false) => {
          if(view==="e4"){run({type:"edit-e4-bend",wireId,index:routeIndex,position:point,mode,insert});return;}
          const topology = history.present.physicalTopology;
          const op=topology?.joiningPipes?.find(p=>p.id===wireId);
          if(op){const command=resolvePhysicalRoutePointCommand(history.present,wireId,routeIndex,point,mode,insert);if(command)run(command);return;}
          const segment = topology?.segments.find(s => s.id === wireId);
          if (topology && segment) {const command=resolvePhysicalRoutePointCommand(history.present,wireId,routeIndex,point,mode,insert);if(command)run(command);return;}
          const wire = history.present.wires.find((item) => item.id === wireId);
          if(wire?.drawingEndpoints){run({type:"edit-detached-wire-bend",wireId,index:routeIndex,position:point,insert});return;}
          if (!wire || routeIndex < 0 || routeIndex >= wire.drawingRoute.length) return;
          const route = wire.drawingRoute.map((item, index) => index === routeIndex ? point : item);
          run({ type: "set-wire-route", wireId, route });
        }}
        onWireRoutePointRemove={(wireId, routeIndex) => {
          const topology = history.present.physicalTopology;
          if(topology?.joiningPipes?.some(p=>p.id===wireId)){run({type:"edit-joining-pipe-bend",pipeId:wireId,index:routeIndex,position:{x:0,y:0},mode:"adjacent",remove:true});return;}
          const segment = topology?.segments.find(s => s.id === wireId);
          if (topology && segment) { const sceneObject=physicalTopologyScene(history.present).find(o=>o.id===wireId);
            const transition=sceneObject?.pipe?.joiningTransitionHandles?.find(handle=>handle.index===routeIndex);
            if(transition){const pipe=topology.joiningPipes?.find(p=>p.members[transition.memberIndex]?.segmentIds.includes(wireId));if(pipe)run({type:"update-joining-pipe-member-bend",pipeId:pipe.id,memberIndex:transition.memberIndex,side:transition.side,clear:true});return;}
            const boundary=sceneObject?.pipe?.joiningBoundaryHandles?.find(handle=>handle.index===routeIndex);
            if(boundary&&(boundary.boundary==="outerEnter"||boundary.boundary==="outerExit")){
              const pipe=topology.joiningPipes?.find(p=>p.members[boundary.memberIndex]?.segmentIds.includes(wireId));
              if(pipe)run({type:"clear-joining-pipe-member-boundary",pipeId:pipe.id,memberIndex:boundary.memberIndex,boundary:boundary.boundary});
              return;
            }
            const authoredIndex=sceneObject?.pipe?.authoredHandleIndices?.[routeIndex];if(authoredIndex===-1)return;
            run({type:"remove-physical-bend",segmentId:wireId,index:(authoredIndex??routeIndex+1)-1}); return; }
          const wire = history.present.wires.find((item) => item.id === wireId);
          if(wire?.drawingEndpoints){run({type:"remove-detached-wire-bend",wireId,index:routeIndex});return;}
          if (!wire || routeIndex < 0 || routeIndex >= wire.drawingRoute.length) return;
          run({ type: "set-wire-route", wireId, route: wire.drawingRoute.filter((_, index) => index !== routeIndex) });
        }}
        onCanvasDoubleClick={addRoutePoint}
        onObjectsChange={(objects) => {
          const selected = selectedObjectId ? objects.find((item) => item.id === selectedObjectId) : null;
          if (!selected || selected.id.startsWith("dimension:")) return;
          const previous = scene.find((item) => item.id === selected.id);
          if (!previous) return;
          if (selected.kind === "connector") {
            if (selected.x !== previous.x || selected.y !== previous.y) {
              run({ type: "move-connector", connectorId: selected.id, view, position: { x: selected.x, y: selected.y } });
            } else if (selected.label !== previous.label) {
              run({ type: "update-connector", connectorId: selected.id, designation: selected.label });
            }
          } else if (selected.kind === "wire") {
            run(editorWireUpdateCommand(selected, previous));
          }
        }}
        onLayersChange={(nextLayers) => run({
          type: "replace-layers",
          view,
          layers: fromUiLayers(nextLayers, history.present.views[view].layers),
        })}
        onClose={localCopy ? localCopy.onCancel : onClose ? async () => {
          if (await flushSave()) onClose();
        } : undefined}
      /></HarnessEditorErrorBoundary>
      {terminationPicker && <div className="he-termination-backdrop">
        <div className="he-termination-modal" role="dialog" aria-modal="true" aria-label="Библиотека оконцовок">
          <TerminationLibraryPicker error={terminationPickerError} onClose={() => setTerminationPicker(null)} view={view} onSelect={record => {
            try {
              if (terminationPicker.apply) {
                if (terminationPicker.document !== historyRef.current?.present) throw new Error('Документ изменился. Закройте библиотеку и повторите выбор для актуального контакта.');
                const artifact = terminationArtifactFromRecord(record, crypto.randomUUID());
                if (terminationPicker.kind && artifact.kind !== terminationPicker.kind) throw new Error(terminationPicker.kind === 'sleeve' ? 'Выберите гильзу с двумя входами.' : 'Выберите наконечник с одним входом.');
                if (terminationPicker.apply(artifact) === false) { setTerminationPickerError('Не удалось назначить оконцовку. Проверьте состав подключения.'); return; }
              } else beginTerminationPlacement(record);
              setTerminationPicker(null);
            } catch (error) { setTerminationPickerError(error instanceof Error ? error.message : 'Не удалось выбрать оконцовку.'); }
          }}/>
        </div>
      </div>}
      {(placementBusy || placementPending) && <div className={placementBusy ? "he-placement-busy" : "he-placement-pending"} role="status" aria-live="polite">
        {placementBusy
          ? "Закрепляем версию компонента в жгуте…"
          : <><span>Ответ сервера не получен. Повтор запроса безопасен и не создаст копию.</span><button type="button" onClick={() => void retryPendingPlacement()}>Повторить</button></>}
      </div>}
    </div>
  );
}
