import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createHarnessDesignApi } from "../editor/design-api";
import { createComponentPlacementApi } from "../editor/component-placement-api";
import { buildComponentTemplateViewInstances, buildProjectComponentSnapshotLookup, type ProjectComponentSnapshotLookup } from "../editor/HarnessDesignEditor";
import type { ComponentTemplateViewInstance, ResolveComponentTemplateAssetUrl } from "../editor/component-template-view-renderer";
import type { HarnessDesignDocument, Point } from "../editor/model";
import { terminalArticleLabel } from "../editor/terminal-article-label";
import { createReferenceCatalogApi, type ReferenceCatalogSnapshot, type ReferenceCatalogRecord, type ReferenceCatalogSourceSummary } from "../reference-catalog-api";
import type { LocalSession } from "../local-session";
import type { RuntimeConfig } from "../runtime-config";
import { addAssemblyInput, addAssemblyRow, generateRoute, mergeRouteRows, removeAssemblyInput, routeRowPresentationConflicts, updateRouteRow } from "./route-commands";
import { parseManufacturingRoute, routeOperationModes, routeRowComposition, type ManufacturingRoute, type RouteAssemblyInput, type RouteOperation, type RouteRow } from "./route-model";
import { buildRouteSourceItems, routeSourceDesignation, type RouteSourceItem, type RouteSourceRef } from "./route-source";
import { RouteWorkspace } from "./route-workspace";
import { RoutePhotoList } from "./RoutePhotoList";
import { RouteAssemblyDrawing, RouteAssemblyDrawingPreview } from "./RouteAssemblyDrawing";
import { RouteCoveringArtwork } from "./route-covering-artwork";
import { resolveRouteTerminalRequirements } from "./route-terminal-requirements";
import { wireBlankDraft, wireBlankEndLabels, wireBlankSourceId, type WireBlankEnd } from "../WireBlankCatalog";
import { WireBlankPreview } from "../WireBlankCatalogEditor";
import { matchWireBlank } from "./route-wire-blank";
import "./manufacturing-route.css";

type Props = { config: RuntimeConfig; session: LocalSession; projectId: string; harnessId: string; onClose?: () => boolean | void; onViewChange?: (view: "e4" | "drawing") => void; onNavigationGuard?: (guard: (() => Promise<boolean>) | null) => void };
const operationEntity = "operation";
type AssemblyInputDraft = { kind: "source"; ref: RouteSourceRef } | { kind: "row"; rowId: string };
const operationModes: Record<RouteOperation["mode"], string> = { cut: "Резка", "cut-strip-from": "Резка и зачистка начала", "cut-strip-to": "Резка и зачистка конца", "cut-strip-both": "Резка и зачистка двух концов", "cut-crimp": "Резка и обжим", tin: "Лужение", "strip-from": "Зачистка начала", "strip-to": "Зачистка конца", "strip-both": "Зачистка двух концов", assembly: "Сборка" };

function sourceKey(ref: RouteSourceRef): string { return `${ref.kind}:${ref.id}`; }
function objectPoints(document: HarnessDesignDocument, source: RouteSourceRef): readonly Point[] {
  if (source.kind === "wire") {
    const wire = document.wires.find(item => item.id === source.id);
    if (!wire) return [];
    const from = document.connectors.find(item => item.id === wire.from.connectorId)?.positions.drawing;
    const to = document.connectors.find(item => item.id === wire.to.connectorId)?.positions.drawing;
    return [...(from ? [from] : []), ...wire.drawingRoute, ...(to ? [to] : [])];
  }
  if (source.kind === "connector") {
    const connector = document.connectors.find(item => item.id === source.id);
    return connector ? [connector.positions.drawing] : [];
  }
  if (source.kind === "cable") {
    const wire = document.wires.find(item => document.cables.find(cable => cable.id === source.id)?.memberWireIds.includes(item.id));
    return wire ? objectPoints(document, { kind: "wire", id: wire.id }) : [];
  }
  const covering = document.physicalTopology?.coverings?.find(item => item.id === source.id);
  const segment = covering?.spans[0]?.segmentId;
  const path = document.physicalTopology?.segments.find(item => item.id === segment);
  const from = document.physicalTopology?.nodes.find(item => item.id === path?.from)?.position;
  const to = document.physicalTopology?.nodes.find(item => item.id === path?.to)?.position;
  return path ? [...(from ? [from] : []), ...path.path.points, ...(to ? [to] : [])] : [];
}

function formatMinutes(value: number): string {
  if (!value) return "—";
  const hours = Math.floor(value / 60), minutes = Math.round(value % 60);
  return hours ? `${hours} ч ${minutes ? `${minutes} мин` : ""}`.trim() : `${minutes} мин`;
}

function sourceLabel(ref: RouteSourceRef): string {
  return ref.kind === "wire" ? "Провод" : ref.kind === "cable" ? "Кабель" : ref.kind === "covering" ? "Оболочка" : "Разъём";
}

export function ManufacturingRoutePanel({ config, session, projectId, harnessId, onClose, onViewChange, onNavigationGuard }: Props) {
  const designApi = useMemo(() => createHarnessDesignApi(config, session), [config, session]);
  const referenceApi = useMemo(() => createReferenceCatalogApi(config, session), [config, session]);
  const componentPlacementApi = useMemo(() => createComponentPlacementApi(config, session), [config, session]);
  const [componentSnapshots, setComponentSnapshots] = useState<ProjectComponentSnapshotLookup>(() => new Map());
  const [componentError, setComponentError] = useState<string | null>(null);
  const workspace = useMemo(() => new RouteWorkspace(designApi, projectId, harnessId,
    (value, next) => resolveRouteTerminalRequirements(value.content, next, referenceApi)), [designApi, referenceApi, projectId, harnessId]);
  const { resource, route, dirty, saving, error: syncError, sourcePreview } = useSyncExternalStore(workspace.subscribe, workspace.getSnapshot, workspace.getSnapshot);
  const sources = useMemo(() => resource ? buildRouteSourceItems(resource.content) : [], [resource]);
  const componentTemplateViewInstances = useMemo(() => resource ? buildComponentTemplateViewInstances(resource.content, componentSnapshots) : [], [resource, componentSnapshots]);
  const resolveComponentTemplateAssetUrl = useCallback((snapshotId: string, assetId: string) => componentPlacementApi.assetContentUrl(projectId, harnessId, snapshotId, assetId), [componentPlacementApi, projectId, harnessId]);
  useEffect(() => {
    let cancelled = false;
    void componentPlacementApi.list(projectId, harnessId).then(graph => { if (!cancelled) { setComponentSnapshots(buildProjectComponentSnapshotLookup(graph)); setComponentError(null); } })
      .catch(caught => { if (!cancelled) setComponentError(caught instanceof Error ? caught.message : "Не удалось загрузить библиотечные виды."); });
    return () => { cancelled = true; };
  }, [componentPlacementApi, projectId, harnessId]);
  const [selectedRows, setSelectedRows] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [photoRows, setPhotoRows] = useState<ReadonlySet<string>>(new Set());
  const [localError, setError] = useState<string | null>(null);
  const error = localError || syncError;
  const photoBusy = photoRows.size > 0;
  const persist = workspace.save;
  const markRoute = (next: ManufacturingRoute) => { setError(null); workspace.edit(next); };
  const load = useCallback(async () => { setBusy(true); await workspace.sync(); setBusy(false); }, [workspace]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState !== "hidden") void workspace.sync(); };
    const timer = window.setInterval(refresh, 2000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [workspace]);
  useEffect(() => {
    if (!dirty || !route || syncError || sourcePreview || saving) return;
    const timer = window.setTimeout(() => void persist(), 1000);
    return () => window.clearTimeout(timer);
  }, [dirty, route, syncError, sourcePreview, saving, persist]);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => { if (dirty || saving || photoBusy) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", unload); return () => window.removeEventListener("beforeunload", unload);
  }, [dirty, saving, photoBusy]);
  const guard = useCallback(() => photoBusy || refreshing ? Promise.resolve(false) : persist(), [persist, photoBusy, refreshing]);
  useEffect(() => { onNavigationGuard?.(guard); return () => onNavigationGuard?.(null); }, [guard, onNavigationGuard]);

  const stale = Boolean(route && resource?.sourceFingerprint && route.source.sha256 !== resource.sourceFingerprint);
  const completed = route?.status === "completed";
  const updateRow = (id: string, patch: Partial<Omit<RouteRow, "id">>) => {
    const current = workspace.getSnapshot().route;
    if (current) try { markRoute(updateRouteRow(current, id, patch)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Проверьте строку маршрута."); }
  };
  const generate = async () => {
    if (route || refreshing) return;
    setRefreshing(true); setError(null);
    try {
      if (!await workspace.sync()) return;
      const latest = workspace.getSnapshot().resource;
      if (!latest?.sourceFingerprint) throw new Error("Сервер не передал отпечаток исходного жгута.");
      if (workspace.getSnapshot().route) return;
      markRoute(await resolveRouteTerminalRequirements(latest.content, generateRoute(latest.content, latest.sourceFingerprint, latest.harnessQuantity ?? 1), referenceApi));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Не удалось создать маршрут."); }
    finally { setRefreshing(false); }
  };
  const refreshSource = async () => { setRefreshing(true); await workspace.sync(); setRefreshing(false); };
  const merge = () => { if (!route || selectedRows.length < 2) return; try { markRoute(mergeRouteRows(route, selectedRows, crypto.randomUUID())); setSelectedRows([]); } catch (caught) { setError(caught instanceof Error ? caught.message : "Не удалось объединить строки."); } };
  const addAssembly = () => { if (!route) return; try { markRoute(addAssemblyRow(route, crypto.randomUUID(), "Новая сборка", [], [])); } catch (caught) { setError(caught instanceof Error ? caught.message : "Не удалось добавить сборку."); } };
  const addStageInput = (stage: RouteRow, input: AssemblyInputDraft): boolean => {
    const current = workspace.getSnapshot().route;
    if (!current || current.status === "completed" || sourcePreview || refreshing) return false;
    try {
      if (stage.kind === "assembly") markRoute(addAssemblyInput(current, stage.id, { ...input, id: crypto.randomUUID() }));
      else { const id = crypto.randomUUID(); const assembly = addAssemblyRow(current, id, `Сборка ${stage.title}`, [], [stage.id]); markRoute(addAssemblyInput(assembly, id, { ...input, id: crypto.randomUUID() })); }
      return true;
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Не удалось добавить ресурс к этапу."); return false; }
  };
  const deleteAssemblyInput = (assemblyId: string, inputId: string) => { const current = workspace.getSnapshot().route; if (!current || current.status === "completed" || sourcePreview || refreshing) return; try { markRoute(removeAssemblyInput(current, assemblyId, inputId)); } catch (caught) { setError(caught instanceof Error ? caught.message : "Не удалось удалить вход сборки."); } };
  const toggle = (list: readonly string[], id: string, set: (next: readonly string[]) => void) => set(list.includes(id) ? list.filter(item => item !== id) : [...list, id]);
  const finish = async () => {
    if (!route || stale || refreshing || photoBusy) return;
    try {
      const incomplete = route.rows.filter(row => !row.prepared || !row.operations.length || row.operations.some(operation => !operation.binding));
      if (incomplete.length) throw new Error(`Подготовьте строки и закрепите все операции в БД.ОП: ${incomplete.map(row => row.title).join(", ")}.`);
      const conflicting = route.rows.filter(row => routeRowPresentationConflicts(route, row.id).length > 0);
      if (conflicting.length) throw new Error(`Согласуйте представления общих объектов в строках: ${conflicting.map(row => row.title).join(", ")}.`);
      markRoute(parseManufacturingRoute({ ...route, status: "completed" })!);
      await persist();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Не удалось закончить маршрут."); }
  };
  const closeToProject = async () => {
    if (!await guard()) { setError(photoBusy ? "Дождитесь завершения загрузки фотографий перед выходом к проекту." : "Маршрут сейчас синхронизируется. Повторите переход к проекту после завершения."); return; }
    if (onClose?.() === false) setError("Не удалось открыть меню проектов. Проверьте несохранённые изменения проекта.");
  };
  if (busy) return <section className="manufacturing-route-panel"><div className="route-loading"><span className="route-spinner" />Загрузка маршрутной карты…</div></section>;
  const totalMinutes = route?.rows.reduce((sum, row) => sum + (row.operationTimeMinutes ?? 0) * (row.quantity ?? resource?.harnessQuantity ?? 1), 0) ?? 0;
  const preparedCount = route?.rows.filter(row => row.prepared).length ?? 0;
  const introducedCount = route?.rows.reduce((sum, row) => sum + row.sourceObjects.length, 0) ?? 0;
  return <section className="manufacturing-route-panel" aria-label="Производственный маршрут">
    {onViewChange && <nav className="route-view-navigation" aria-label="Представление жгута">
      {onClose && <button type="button" className="route-home-button" disabled={refreshing || photoBusy} onClick={() => void closeToProject()} aria-label="Вернуться к проекту">← <span>К проекту</span></button>}
      <button type="button" disabled={refreshing || photoBusy} onClick={async () => { if (await guard()) onViewChange("e4"); }}>Схема Э4</button>
      <button type="button" disabled={refreshing || photoBusy} onClick={async () => { if (await guard()) onViewChange("drawing"); }}>Чертёж</button>
      <button type="button" aria-current="page">Маршрут</button>
    </nav>}
    <header className="manufacturing-route-header"><div className="route-heading"><div className="route-heading-mark" aria-hidden="true"><span /><span /><span /></div><div><p className="eyebrow">M5 · МАРШРУТНАЯ КАРТА</p><h2>Маршрут производства</h2><p className="manufacturing-route-status" role="status"><span className={`route-status-dot ${saving ? "saving" : error ? "error" : ""}`} />{saving ? "Сохраняем…" : error ? "Есть ошибки" : dirty ? "Есть несохранённые изменения" : "Все изменения сохранены"} <span>·</span> {resource?.harnessQuantity ?? 1} шт. в заказе</p></div></div>
      <div className="manufacturing-route-actions">{route && (completed ? <><span className="route-ready">Маршрут завершён</span><button type="button" disabled={saving} onClick={() => markRoute({ ...route, status: "draft" })}>Продолжить</button></> : <button type="button" className="finish-action" disabled={stale || refreshing || photoBusy || !!sourcePreview} onClick={() => void finish()}>Закончить маршрут</button>)}{route && <button type="button" className="ghost-action" onClick={() => void refreshSource()} disabled={saving || refreshing}>Синхронизировать</button>}<button type="button" className="primary-action" onClick={() => void persist()} disabled={!route || saving || !dirty || stale || refreshing}>Сохранить</button>{onClose && <button type="button" className="ghost-action" disabled={refreshing || photoBusy} onClick={() => void closeToProject()}>Выйти</button>}</div>
    </header>
    {error && <p className="manufacturing-route-error" role="alert">{error}</p>}{componentError && <p className="manufacturing-route-error" role="alert">Библиотечные рисунки: {componentError}</p>}
    {sourcePreview && <section className="route-rebase-preview" aria-label="Изменения исходного жгута"><div><span className="route-alert-icon">!</span><div><h3>Изменения исходного жгута</h3><p>Добавлено объектов: {sourcePreview.added.length}. Удалено: {sourcePreview.removed.length}. Строки, операции и комментарии сохранятся, но их потребуется проверить.</p></div></div>{sourcePreview.removed.length > 0 && <ul>{sourcePreview.removed.map(ref => <li key={sourceKey(ref)}>Удалена связь: {sources.find(item => sourceKey(item.ref) === sourceKey(ref))?.title ?? ref.id} ({sourceLabel(ref)})</li>)}</ul>}<div className="route-rebase-actions"><button type="button" className="primary-action" onClick={() => void workspace.acceptSourceChanges()}>Применить изменения</button></div></section>}
    {stale && <p className="manufacturing-route-error" role="alert">Исходный жгут изменился. Длины показаны из последнего сохранённого чертежа. Подтвердите удалённые связи в составе маршрута перед продолжением.</p>}
    {!route ? <div className="manufacturing-route-empty"><div className="route-empty-illustration" aria-hidden="true"><span /><span /><span /><i /></div><div><p className="eyebrow">ШАГ 1 ИЗ 3</p><h3>Создайте маршрут из чертежа</h3><p>Провода, кабели и покрытия станут исходными полуфабрикатами. После этого их можно объединять в производственные этапы и добавлять сборочные операции.</p><button type="button" className="primary-action" onClick={() => void generate()} disabled={!resource || refreshing}>{refreshing ? "Создаём маршрут…" : "Создать маршрут"}</button>{!resource && <button type="button" onClick={() => void load()}>Повторить загрузку</button>}</div></div> : <>
      <section className="route-summary" aria-label="Сводка маршрута"><div className="route-summary-item"><span>Этапы</span><strong>{route.rows.length}</strong><small>строк маршрута</small></div><div className="route-summary-item"><span>Готовность</span><strong>{preparedCount}<em>/{route.rows.length}</em></strong><small>подготовлено</small></div><div className="route-summary-item"><span>Объекты</span><strong>{introducedCount}</strong><small>введено в маршрут</small></div><div className="route-summary-item"><span>Время</span><strong>{formatMinutes(totalMinutes)}</strong><small>на партию</small></div><div className="route-summary-progress"><div><span>Готовность маршрута</span><strong>{route.rows.length ? Math.round(preparedCount / route.rows.length * 100) : 0}%</strong></div><div className="route-progress-track"><span style={{ width: `${route.rows.length ? preparedCount / route.rows.length * 100 : 0}%` }} /></div><small>{completed ? "Маршрут закрыт для производства" : "Подготовьте строки и закрепите операции"}</small></div></section>
      <div className="manufacturing-route-toolbar"><div><button type="button" className="toolbar-button" onClick={merge} disabled={selectedRows.length < 2 || stale || refreshing || !!sourcePreview || completed || photoBusy}>Общая операция для выбранных <span>{selectedRows.length || ""}</span></button><button type="button" className="toolbar-button" onClick={addAssembly} disabled={stale || refreshing || !!sourcePreview || completed || photoBusy}>+ Добавить сборку</button></div><span>{route.rows.length} {route.rows.length === 1 ? "этап" : "этапов"} · выбрано {selectedRows.length}</span></div>
      <section className="manufacturing-route-table-card"><div className="route-table-heading"><div><h3>Этапы производства</h3></div><div className="route-table-legend"><span className="legend-dot prepared" /> подготовлено <span className="legend-dot draft" /> требует действий</div></div><div className="route-table route-inline-table" role="table" aria-label="Этапы производственного маршрута">{resource && route.rows.map((row, index) => <RouteRowInline key={row.id} config={config} session={session} projectId={projectId} harnessId={harnessId} componentTemplateViewInstances={row.presentation.drawingCopy ? buildComponentTemplateViewInstances(row.presentation.drawingCopy.document, componentSnapshots) : componentTemplateViewInstances} resolveComponentTemplateAssetUrl={resolveComponentTemplateAssetUrl} row={row} route={route} document={resource.content} sources={sources} ordinal={index + 1}
        disabled={stale || refreshing || !!sourcePreview || completed} selected={selectedRows.includes(row.id)} onSelect={() => toggle(selectedRows, row.id, setSelectedRows)}
        update={patch => updateRow(row.id, patch)} onAddInput={input => addStageInput(row, input)} onRemoveInput={inputId => deleteAssemblyInput(row.id, inputId)} setPhotoBusy={value => setPhotoRows(previous => { const next = new Set(previous); if (value) next.add(row.id); else next.delete(row.id); return next; })} />)}{!route.rows.length && <div className="route-table-empty">Добавьте первый этап из чертежа.</div>}</div></section>
    </>}
  </section>;
}

function operationCategoryLabel(record: ReferenceCatalogRecord): string {
  return typeof record.payload.name === "string" && record.payload.name.trim() ? record.payload.name.trim() : "Без категории";
}


function operationShortLabel(record: ReferenceCatalogRecord): string {
  for (const key of ["operationType", "machine", "instruction", "name"]) if (typeof record.payload[key] === "string" && record.payload[key].trim()) return record.payload[key].trim();
  return "Операция";
}

function operationIcon(name: string): string {
  if (/рез|отрез/i.test(name)) return "✂";
  if (/обжим|опресс/i.test(name)) return "◉";
  if (/зачист|раздел/i.test(name)) return "⌁";
  if (/луж|пайк/i.test(name)) return "♨";
  if (/сбор|монтаж/i.test(name)) return "▣";
  return "⚙";
}

export function RouteRowInline({ config, session, projectId, harnessId, componentTemplateViewInstances, resolveComponentTemplateAssetUrl, setPhotoBusy, row, route, document, sources, update, disabled, selected, ordinal, onSelect, onAddInput, onRemoveInput }: {
  config: RuntimeConfig; session: LocalSession; projectId: string; harnessId: string; setPhotoBusy: (busy: boolean) => void;
  componentTemplateViewInstances?: readonly ComponentTemplateViewInstance[]; resolveComponentTemplateAssetUrl?: ResolveComponentTemplateAssetUrl;
  row: RouteRow; route: ManufacturingRoute; document: HarnessDesignDocument; sources: readonly RouteSourceItem[]; update: (patch: Partial<Omit<RouteRow, "id">>) => void;
  disabled: boolean; selected: boolean; ordinal: number; onSelect: () => void;
  onAddInput?: (input: AssemblyInputDraft) => boolean; onRemoveInput?: (inputId: string) => void;
}) {
  const referenceApi = useMemo(() => createReferenceCatalogApi(config, session), [config, session]);
  const [operationSources, setOperationSources] = useState<readonly ReferenceCatalogSourceSummary[]>([]);
  const [operationSourceId, setOperationSourceId] = useState("");
  const [operationSnapshot, setOperationSnapshot] = useState<ReferenceCatalogSnapshot | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [operationCategory, setOperationCategory] = useState<string | null>(null);
  const [assemblyDrawingOpen, setAssemblyDrawingOpen] = useState(false);
  const [inputChooserOpen, setInputChooserOpen] = useState(false);
  const inputChooser = useRef<HTMLElement>(null);
  const inputChooserTrigger = useRef<HTMLButtonElement>(null);
  const inputChooserWasOpen = useRef(false);
  const [wireBlankSnapshot, setWireBlankSnapshot] = useState<ReferenceCatalogSnapshot | null>(null);
  const [wireBlankError, setWireBlankError] = useState<string | null>(null);
  const [wireBlankLoaded, setWireBlankLoaded] = useState(false);
  const hasOperations = row.operations.length > 0;
  useEffect(() => {
    if (!hasOperations || disabled) return;
    let cancelled = false;
    void referenceApi.listSources().then(items => { if (cancelled) return; const operationItems = items.filter(item => /опера|БД\.ОП|operation/i.test(`${item.sourceId} ${item.displayName}`)); setOperationSources(operationItems); setOperationSourceId(previous => operationItems.some(item => item.sourceId === previous) ? previous : operationItems[0]?.sourceId || ""); })
      .catch(caught => { if (!cancelled) setCatalogError(caught.message); });
    return () => { cancelled = true; };
  }, [referenceApi, hasOperations, disabled]);
  useEffect(() => {
    if (!operationSourceId || !chooserOpen || disabled) return;
    let cancelled = false;
    setOperationSnapshot(null); setCatalogLoading(true); setCatalogError(null);
    void referenceApi.getActive(operationSourceId).then(snapshot => { if (!cancelled) { setOperationSnapshot(snapshot); setCatalogLoading(false); } })
      .catch(caught => { if (!cancelled) { setCatalogError(caught.message); setCatalogLoading(false); } });
    return () => { cancelled = true; };
  }, [referenceApi, operationSourceId, chooserOpen, disabled]);
  const [operationId, setOperationId] = useState(row.operations[0]?.id ?? "");
  const [mode, setMode] = useState<RouteOperation["mode"]>(row.kind === "assembly" ? "assembly" : "cut");
  const operationRecords = useMemo(() => operationSnapshot?.records.filter(record => record.entityType === operationEntity) ?? [], [operationSnapshot]);
  const operationCategories = useMemo(() => [...new Set(operationRecords.map(operationCategoryLabel))].sort((a, b) => a.localeCompare(b, "ru")), [operationRecords]);

  const refs = routeRowComposition(route, row.id);
  const items = refs.map(ref => sources.find(item => sourceKey(item.ref) === sourceKey(ref))).filter((item): item is RouteSourceItem => !!item);
  const wireItems = items.filter(item => item.ref.kind === "wire");
  useEffect(() => {
    if (row.kind !== "semiFinished" || !wireItems.length) return;
    let cancelled = false;
    void referenceApi.getActive(wireBlankSourceId).then(snapshot => { if (!cancelled) { setWireBlankSnapshot(snapshot); setWireBlankError(null); setWireBlankLoaded(true); } })
      .catch(caught => { if (!cancelled) { setWireBlankError(caught instanceof Error ? caught.message : "Справочник полуфабрикатов недоступен."); setWireBlankLoaded(true); } });
    return () => { cancelled = true; };
  }, [referenceApi, row.kind, wireItems.length]);
  const wireIds = new Set(items.filter(item => item.ref.kind === "wire").map(item => item.ref.id));
  const requirements = route.rows.flatMap(row => row.terminalRequirements ?? []).filter(item => wireIds.has(item.wireId));
  const terminalDetail = (item: RouteSourceItem, end: "from" | "to") => {
    const requirement = requirements.find(value => value.wireId === item.ref.id && value.end === end);
    return {
      article: terminalArticleLabel(requirement?.terminalArticle || (end === "from" ? item.terminalFrom : item.terminalTo)) || "—",
      stripLength: requirement?.stripLengthMm == null ? "—" : `${requirement.stripLengthMm} мм`,
      profile: item.stripProfiles?.[end]?.displayName ?? "—",
    };
  };
  const conflicts = routeRowPresentationConflicts(route, row.id);
  const changeOperation = (id: string, patch: Partial<RouteOperation>) => update({ operations: row.operations.map(operation => operation.id === id ? { ...operation, ...patch } : operation) });
  const addOperation = () => { const id = crypto.randomUUID(); update({ operations: [...row.operations, { id, mode, note: "", binding: null }] }); setOperationId(id); };
  const moveOperation = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= row.operations.length) return;
    const operations = [...row.operations];
    const [operation] = operations.splice(index, 1);
    operations.splice(target, 0, operation!);
    update({ operations });
  };
  const bind = (record: ReferenceCatalogRecord) => {
    if (!operationSnapshot || !operationId) return;
    changeOperation(operationId, { binding: { sourceId: operationSourceId, entityType: "operation", snapshotId: operationSnapshot.snapshotId, snapshotSha256: operationSnapshot.sha256, recordId: record.recordId, sourceKey: record.sourceKey, displayName: `${record.sourceKey} · ${operationShortLabel(record)}` } });
    setChooserOpen(false); setOperationCategory(null);
  };
  const guardedUpdate = (patch: Partial<Omit<RouteRow, "id">>) => { if (!disabled) update(patch); };
  const dependsOnRow = (candidateId: string, targetId: string, seen = new Set<string>()): boolean => {
    if (candidateId === targetId) return true;
    if (seen.has(candidateId)) return false;
    seen.add(candidateId);
    return (route.rows.find(candidate => candidate.id === candidateId)?.dependsOn ?? []).some(parentId => dependsOnRow(parentId, targetId, seen));
  };
  const sourceProducer = (ref: RouteSourceRef) => route.rows.find(candidate => candidate.sourceObjects.some(source => sourceKey(source) === sourceKey(ref)));
  const availableBlanks = route.rows.filter(candidate => candidate.kind === "semiFinished" && candidate.prepared && candidate.id !== row.id);
  const inputLines = row.assemblyInputs ?? [];
  const inputAlreadyAdded = (input: AssemblyInputDraft) => {
    const rowId = input.kind === "row" ? input.rowId : sourceProducer(input.ref)?.id;
    return rowId ? inputLines.some(candidate => candidate.kind === "row" && candidate.rowId === rowId) : input.kind === "source" && inputLines.some(candidate => candidate.kind === "source" && sourceKey(candidate.ref) === sourceKey(input.ref));
  };
  const inputBlocked = (input: AssemblyInputDraft) => {
    const sourceRow = input.kind === "row" ? route.rows.find(candidate => candidate.id === input.rowId) : sourceProducer(input.ref);
    if (input.kind === "source" && refs.some(ref => sourceKey(ref) === sourceKey(input.ref))) return true;
    return input.kind === "row" ? !sourceRow || sourceRow.id === row.id || dependsOnRow(sourceRow.id, row.id) : sourceRow ? sourceRow.id === row.id || dependsOnRow(sourceRow.id, row.id) : false;
  };
  const addInput = (input: AssemblyInputDraft) => { if (onAddInput?.(input)) setInputChooserOpen(false); };
  useEffect(() => { if (inputChooserOpen) inputChooser.current?.focus(); else if (inputChooserWasOpen.current) inputChooserTrigger.current?.focus(); inputChooserWasOpen.current = inputChooserOpen; }, [inputChooserOpen]);
  const materialRows = items.map(item => {
    const from = terminalDetail(item, "from"), to = terminalDetail(item, "to");
    const index = row.kind === "semiFinished" ? row.index : undefined;
    return <tr key={sourceKey(item.ref)}>
      <td>{index ? <><strong>{index}</strong><span>{item.title}</span></> : <strong>{item.title}</strong>}{item.cableId && <small title="Жила кабеля: расход учитывается в кабеле">Жила кабеля</small>}</td>
      <td>{routeSourceDesignation(item)}</td>
      <td>{item.ref.kind === "connector" ? "—" : item.lengthMm === null ? "—" : `${item.lengthMm} мм`}</td>
      <td>{item.ref.kind === "wire" ? <><span>Н: {from.article}</span><span>К: {to.article}</span></> : "—"}</td>
      <td>{item.ref.kind === "wire" ? <><span>Н: {from.profile} · {from.stripLength}</span><span>К: {to.profile} · {to.stripLength}</span></> : "—"}</td>
      {row.kind === "semiFinished" && <>
        <td className="route-metric-cell"><RouteNumberField label="Кол-во" unit="шт." value={row.quantity ?? 1} min={1} onChange={value => update({ quantity: value })} /></td>
        <td className="route-metric-cell"><RouteNumberField label="Запас" unit="шт." value={row.reserve ?? 0} min={0} onChange={value => update({ reserve: value })} /></td>
        <td className="route-metric-cell"><RouteNumberField label="Время" unit="мин/шт." value={row.operationTimeMinutes ?? 0} min={0} onChange={value => update({ operationTimeMinutes: value })} /></td>
      </>}
    </tr>;
  });
  return <article id={`route-row-${row.id}`} className={`route-inline-row ${row.kind === "semiFinished" ? "semi-finished" : "assembly"} ${selected ? "selected" : ""}`} role="row" aria-label={`Этап ${ordinal}: ${row.title}`}>
    <div className="route-inline-number" role="cell"><label><input type="checkbox" disabled={disabled || row.kind !== "semiFinished"} aria-label={`Выбрать ${row.title}`} checked={selected} onChange={onSelect} /><span>{String(ordinal).padStart(2, "0")}</span></label></div>
    <fieldset className="route-inline-material" role="cell" disabled={disabled} aria-label={`Идентификация этапа ${ordinal}`}>
      <div className="route-identity-panel"><span className={`route-kind ${row.kind}`}>{row.role === "sharedOperation" ? "ОБЩАЯ ОПЕРАЦИЯ" : row.kind === "assembly" ? "СБОРКА" : "ПОЛУФАБРИКАТ"}</span><div className="route-identity-table" role="group" aria-label="Название этапа"><RouteTextField label="Индекс" value={row.index ?? ""} maxLength={128} onChange={value => update({ index: value })} /><RouteTextField label="Название" value={row.title} maxLength={512} required onChange={value => update({ title: value })} /></div><label className="route-prepared-check"><input type="checkbox" checked={row.prepared} onChange={event => update({ prepared: event.target.checked })} />Подготовлен</label><span className={row.prepared ? "route-ready" : "route-draft"}>{row.prepared ? "Готово" : "Черновик"}</span></div>
      {row.dependsOn.length > 0 && <p className="route-dependency">После этапов {row.dependsOn.map(id => route.rows.findIndex(candidate => candidate.id === id) + 1).join(", ")}</p>}
      {row.kind === "assembly" && <div className="route-assembly-inputs" role="group" aria-label="Входы сборки"><strong>{row.role === "sharedOperation" ? "Участники общей операции" : "Состав сборки"}</strong>{row.assemblyInputs?.map((input, index) => <div className="route-assembly-input" key={input.id}><span>{index + 1}.</span><span>{input.kind === "row" ? route.rows.find(candidate => candidate.id === input.rowId)?.title ?? "Полуфабрикат" : sources.find(item => sourceKey(item.ref) === sourceKey(input.ref))?.title ?? "Сырьё"}</span><button type="button" aria-label={`Удалить вход сборки ${index + 1}`} disabled={disabled} onClick={() => onRemoveInput?.(input.id)}>×</button></div>)}</div>}
      <button ref={inputChooserTrigger} type="button" className="route-stage-add" disabled={disabled} aria-haspopup="dialog" aria-expanded={inputChooserOpen} onClick={() => setInputChooserOpen(true)}>+ Добавить</button>
      {inputChooserOpen && <div className="route-input-chooser-backdrop" role="presentation" onMouseDown={() => setInputChooserOpen(false)}><section ref={inputChooser} className="route-input-chooser" role="dialog" aria-modal="true" aria-label={`Добавить к этапу ${row.title}`} tabIndex={-1} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); setInputChooserOpen(false); } }} onMouseDown={event => event.stopPropagation()}><header><div><h4>Добавить к этапу</h4><p>{row.kind === "assembly" ? "Выберите сырьё или готовый полуфабрикат для сборки." : "Будет создана новая сборка с текущим и выбранным ресурсом."}</p></div><button type="button" aria-label="Закрыть окно добавления" onClick={() => setInputChooserOpen(false)}>×</button></header><div className="route-input-chooser-lists"><section aria-label="Сырьё из спецификации"><h5>Сырьё из спецификации</h5>{sources.length ? sources.map(item => { const input: AssemblyInputDraft = { kind: "source", ref: item.ref }; const added = row.kind === "assembly" && inputAlreadyAdded(input); const blocked = inputBlocked(input); return <button type="button" className="route-input-choice" key={sourceKey(item.ref)} disabled={disabled || added || blocked} onClick={() => addInput(input)}><span className="source-type-icon" aria-hidden="true">{item.ref.kind === "wire" ? "W" : item.ref.kind === "connector" ? "X" : item.ref.kind === "cable" ? "C" : "○"}</span><span><strong>{item.material || item.materialArticle || item.title}</strong><small>{item.title} · {item.lengthMm == null ? "—" : `${item.lengthMm} мм`}</small></span>{added && <em>Добавлено</em>}{blocked && <em>Уже входит в этап</em>}</button>; }) : <p>Материалы не найдены.</p>}</section><section aria-label="Готовые полуфабрикаты"><h5>Готовые полуфабрикаты</h5>{availableBlanks.length ? availableBlanks.map(blank => { const input: AssemblyInputDraft = { kind: "row", rowId: blank.id }; const added = row.kind === "assembly" && inputAlreadyAdded(input); const blocked = inputBlocked(input); return <button type="button" className="route-input-choice" key={blank.id} disabled={disabled || added || blocked} onClick={() => addInput(input)}><span className="source-type-icon" aria-hidden="true">ПФ</span><span><strong>{blank.index || blank.title}</strong><small>{blank.title}</small></span>{added && <em>Добавлено</em>}{blocked && <em>Создаёт цикл</em>}</button>; }) : <p>Подготовленных полуфабрикатов пока нет.</p>}</section></div></section></div>}
      {row.role !== "sharedOperation" && <div className="route-material-table-scroll"><table className={row.kind === "semiFinished" ? "route-material-table route-material-table-components" : "route-material-table"}><thead><tr><th>Объект</th><th>Материал</th><th>Длина</th><th>Концы</th><th>Разделка</th>{row.kind === "semiFinished" && <><th>Кол-во</th><th>Запас</th><th>Время</th></>}</tr></thead><tbody>{materialRows}</tbody>{row.kind === "assembly" && <tfoot><tr><td className="route-metric-cell"><RouteNumberField label="Кол-во" unit="шт." value={row.quantity ?? 1} min={1} onChange={value => update({ quantity: value })} /></td><td className="route-metric-cell"><RouteNumberField label="Запас" unit="шт." value={row.reserve ?? 0} min={0} onChange={value => update({ reserve: value })} /></td><td className="route-metric-cell"><RouteNumberField label="Время" unit="мин/шт." value={row.operationTimeMinutes ?? 0} min={0} onChange={value => update({ operationTimeMinutes: value })} /></td><td colSpan={2}><span className="route-muted">Партия <strong>{formatMinutes((row.operationTimeMinutes ?? 0) * (row.quantity ?? 1))}</strong></span></td></tr></tfoot>}{row.kind === "semiFinished" && <tfoot><tr><td colSpan={8}><span className="route-muted">Партия <strong>{formatMinutes((row.operationTimeMinutes ?? 0) * (row.quantity ?? 1))}</strong></span></td></tr></tfoot>}</table></div>}
      <label className="route-comment-field">Комментарий<textarea aria-label="Комментарий строки" maxLength={4000} value={row.comment} onChange={event => update({ comment: event.target.value })} /></label>
    </fieldset>
    <fieldset className="route-inline-operations" role="cell" disabled={disabled} aria-label={`Операции этапа ${ordinal}`}>
    <section className="route-operations route-editor-block"><div className="route-editor-block-heading"><div><h4>Операции</h4></div></div>
      <table className="route-operations-table" aria-label="Список операций">
        <thead><tr><th scope="col">№</th><th scope="col">Операция</th><th scope="col">Примечание</th><th scope="col" aria-label="Порядок и удаление" /></tr></thead>
        <tbody>{row.operations.map((operation, index) => <tr className={`route-operation-entry ${operationId === operation.id ? "selected" : ""}`} key={operation.id}>
          <td><button type="button" className="route-operation-number" aria-label={`Выбрать операцию ${index + 1}`} aria-pressed={operationId === operation.id} onClick={() => setOperationId(operation.id)}>{index + 1}</button></td>
          <td><button type="button" className="route-operation-trigger" aria-label={`Операция ${index + 1}: ${operation.binding?.displayName ?? "не выбрана"}`} aria-expanded={chooserOpen && operationId === operation.id} aria-controls={`route-operation-chooser-${row.id}`} onClick={() => { setOperationId(operation.id); setOperationCategory(null); setChooserOpen(value => operationId === operation.id ? !value : true); }}>{operation.binding?.displayName ?? "Выбрать операцию"}<span aria-hidden="true">⌄</span></button></td>
          <td><input aria-label={`Примечание операции ${index + 1}`} maxLength={4000} placeholder="Примечание" value={operation.note} onChange={event => changeOperation(operation.id, { note: event.target.value })} /></td>
          <td><div className="route-operation-actions"><button type="button" aria-label={`Переместить операцию ${index + 1} выше`} title="Выше" disabled={index === 0} onClick={() => moveOperation(index, -1)}>↑</button><button type="button" aria-label={`Переместить операцию ${index + 1} ниже`} title="Ниже" disabled={index === row.operations.length - 1} onClick={() => moveOperation(index, 1)}>↓</button><button type="button" aria-label={`Удалить операцию ${index + 1}`} title="Удалить операцию" onClick={() => update({ operations: row.operations.filter(item => item.id !== operation.id) })}>×</button></div></td>
        </tr>)}</tbody>
      </table>
      <div className="route-operation-add"><div className="route-drawing-mode"><label>Режим<select aria-label="Режим новой операции" value={mode} onChange={event => setMode(event.target.value as RouteOperation["mode"])}>{routeOperationModes.map(mode => <option key={mode} value={mode}>{operationModes[mode]}</option>)}</select></label></div><button type="button" className="secondary-action" onClick={addOperation}>+ Добавить операцию</button></div>
      {row.operations.length > 0 && chooserOpen && <div id={`route-operation-chooser-${row.id}`} className="route-operation-binding" aria-label="Выбор операции" onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); if (operationCategory) setOperationCategory(null); else setChooserOpen(false); } }}><div className="route-operation-chooser-heading"><h4>{operationCategory ?? "Категории операций"}</h4><button type="button" onClick={() => operationCategory ? setOperationCategory(null) : setChooserOpen(false)}>{operationCategory ? "← Категории" : "Закрыть"}</button></div>{operationSources.length > 1 && <label>Справочник<select aria-label="Справочник операций" value={operationSourceId} onChange={event => { setOperationSourceId(event.target.value); setOperationCategory(null); }}>{operationSources.map(source => <option key={source.sourceId} value={source.sourceId}>{source.displayName}</option>)}</select></label>}{catalogLoading && <p role="status">Загружаем операции…</p>}{catalogError && <p role="alert">{catalogError}</p>}{!operationSources.length && !catalogLoading && <p>Загрузите справочник БД.ОП.</p>}{operationSnapshot && !operationRecords.length && <p>В справочнике нет операций.</p>}<div className="route-operation-results">{operationCategory === null ? operationCategories.map(category => <button type="button" className="route-operation-card" key={category} onClick={() => setOperationCategory(category)}><span className="route-operation-icon" aria-hidden="true">{operationIcon(category)}</span><span><strong>{category}</strong><small>{operationRecords.filter(record => operationCategoryLabel(record) === category).length} операций</small></span><span aria-hidden="true">›</span></button>) : operationRecords.filter(record => operationCategoryLabel(record) === operationCategory).map(record => <button type="button" className="route-operation-card" key={record.recordId} onClick={() => bind(record)}><span className="route-operation-icon" aria-hidden="true">{operationIcon(operationCategory)}</span><span><strong>№ {record.sourceKey}</strong><small>{operationShortLabel(record)}</small></span></button>)}</div></div>}
    </section>
</fieldset>
    <fieldset className="route-inline-visual" role="cell" disabled={disabled} aria-label={`Рисунок и фото этапа ${ordinal}`}>
    <section className="route-editor-block"><div className="route-editor-block-heading"><div><h4>Рисунок этапа</h4></div><button type="button" className="secondary-action" disabled={disabled} onClick={() => setAssemblyDrawingOpen(true)}>{row.kind === "assembly" ? "Изменить фрагмент" : "Открыть редактор рисунка"}</button></div>{assemblyDrawingOpen ? <RouteAssemblyDrawing config={config} session={session} projectId={projectId} harnessId={harnessId} row={row} document={document} sources={sources} items={items} componentTemplateViewInstances={componentTemplateViewInstances} resolveComponentTemplateAssetUrl={resolveComponentTemplateAssetUrl} onCancel={() => setAssemblyDrawingOpen(false)} onSave={presentation => { guardedUpdate({ presentation }); setAssemblyDrawingOpen(false); }} /> : row.presentation.drawingCopy || row.presentation.drawingObjects ? <><RouteAssemblyDrawingPreview config={config} session={session} projectId={projectId} row={row} document={document} componentTemplateViewInstances={componentTemplateViewInstances} resolveComponentTemplateAssetUrl={resolveComponentTemplateAssetUrl} />{row.kind === "semiFinished" && wireItems.length && <WireBlankStageDrawing row={row} items={wireItems} snapshot={wireBlankSnapshot} loaded={wireBlankLoaded} error={wireBlankError} disabled={disabled} update={guardedUpdate} />}</> : row.kind === "semiFinished" && wireItems.length ? <><WireBlankStageDrawing row={row} items={wireItems} snapshot={wireBlankSnapshot} loaded={wireBlankLoaded} error={wireBlankError} disabled={disabled} update={guardedUpdate} />{items.some(item => item.ref.kind !== "wire") && <RoutePresentation row={row} document={document} sources={sources} items={items.filter(item => item.ref.kind !== "wire")} update={guardedUpdate} disabled={disabled} />}</> : <RoutePresentation row={row} document={document} sources={sources} items={items} update={guardedUpdate} disabled={disabled} />}</section>
    {conflicts.length > 0 && <section className="manufacturing-route-error" role="alert"><strong>Разные представления общего объекта</strong><p>Задайте представление объекта в этой строке, чтобы согласовать результат сборки.</p>{conflicts.map(conflict => <div key={sourceKey(conflict.ref)}><span>{items.find(item => sourceKey(item.ref) === sourceKey(conflict.ref))?.title}</span>{conflict.variants.map(variant => <button key={variant.rowId} type="button" onClick={() => update({ presentation: { ...row.presentation, objects: [...row.presentation.objects.filter(object => sourceKey(object.ref) !== sourceKey(conflict.ref)), variant.object] } })}>Взять из «{route.rows.find(row => row.id === variant.rowId)?.title}»</button>)}</div>)}</section>}
 <section className="route-editor-block route-photo-block"><div className="route-editor-block-heading"><div><h4>Фото этапа</h4></div></div><RoutePhotoList config={config} session={session} projectId={projectId} photos={row.photos} disabled={disabled} onChange={photos => update({ photos })} onBusyChange={setPhotoBusy} /></section></fieldset>

  </article>;
}

export function WireBlankStageDrawing({ row, items, snapshot, loaded = true, error, disabled, update }: { row: RouteRow; items: readonly RouteSourceItem[]; snapshot: ReferenceCatalogSnapshot | null; loaded?: boolean; error: string | null; disabled: boolean; update: (patch: Partial<Omit<RouteRow, "id">>) => void }) {
  const entries = wireBlankDraft(snapshot);
  const select = (wireId: string, recordId: string) => {
    const remaining = (row.wireBlankSelections ?? []).filter(value => value.wireId !== wireId);
    const entry = entries.find(value => value.id === recordId);
    if (!entry || !snapshot) { update({ wireBlankSelections: remaining }); return; }
    update({ wireBlankSelections: [...remaining, { wireId, binding: { sourceId: wireBlankSourceId, entityType: "wire-blank", snapshotId: snapshot.snapshotId, snapshotSha256: snapshot.sha256, recordId: entry.id, sourceKey: entry.index, displayName: entry.title, visual: { start: entry.start, end: entry.end, color: entry.color, templateId: entry.templateId, photoDataUrl: entry.photoDataUrl } } }] });
  };
  return <div className="route-wire-blank-list">{error && <p role="alert">{error}</p>}{!snapshot && !error && <p role="status">{loaded ? "Справочник «Полуфабрикаты провода» недоступен. Закреплённые рисунки сохранены." : "Загружаем справочник «Полуфабрикаты провода»…"}</p>}{items.map(item => {
    const match = matchWireBlank(snapshot, item, row.operations);
    const pinned = row.wireBlankSelections?.find(value => value.wireId === item.ref.id)?.binding;
    const active = pinned ? entries.find(value => value.id === pinned.recordId && snapshot?.snapshotId === pinned.snapshotId) : match.entry;
    const selected = active ?? (pinned ? { id: pinned.recordId, index: pinned.sourceKey, title: pinned.displayName, start: pinned.visual.start as WireBlankEnd, end: pinned.visual.end as WireBlankEnd, color: pinned.visual.color, templateId: pinned.visual.templateId, photoDataUrl: pinned.visual.photoDataUrl, originalPayload: {} } : null);
    const unavailable = Boolean(pinned && !selected);
    return <div className="route-wire-blank" key={item.ref.id}>
      <div className="route-wire-blank__heading"><strong>{item.title}</strong><span>{item.lengthMm === null ? "Длина не задана" : `${item.lengthMm} мм`}</span></div>
      {selected ? <WireBlankPreview row={selected} /> : <div className="route-wire-blank__missing">{unavailable ? "Закреплённый шаблон отсутствует в активной версии справочника" : "Подходящий шаблон не найден"}</div>}
      <div className="route-wire-blank__details"><span>{selected ? `${wireBlankEndLabels[selected.start]} → ${wireBlankEndLabels[selected.end]}` : `По операциям: ${wireBlankEndLabels[match.expected.start]} → ${wireBlankEndLabels[match.expected.end]}`}</span><span>{pinned ? `Выбран: ${pinned.displayName}` : match.reason === "exact" ? "Подставлен автоматически" : match.reason === "ambiguous" ? "Несколько вариантов — выберите шаблон" : "Точного варианта нет — выберите шаблон"}</span></div>
      <label>Шаблон полуфабриката<select aria-label={`Шаблон полуфабриката ${item.title}`} disabled={disabled || !snapshot} value={pinned?.recordId ?? ""} onChange={event => select(item.ref.id, event.target.value)}><option value="">Автоматически</option>{pinned && !entries.some(entry => entry.id === pinned.recordId) && <option value={pinned.recordId}>{pinned.sourceKey} · {pinned.displayName} (закреплённая версия)</option>}{entries.map(entry => <option key={entry.id} value={entry.id}>{entry.index} · {entry.title}</option>)}</select></label>
    </div>;
  })}</div>;
}


function RoutePresentation({ row, document, sources, items, update, disabled }: { row: RouteRow; document: HarnessDesignDocument; sources: readonly RouteSourceItem[]; items: readonly RouteSourceItem[]; disabled: boolean; update: (patch: Partial<Omit<RouteRow, "id">>) => void }) {
  const svg = useRef<SVGSVGElement>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const drag = useRef<{ key: string; index: number } | null>(null);
  const objects = row.kind === "assembly" ? row.presentation.objects.filter(object => items.some(item => sourceKey(item.ref) === sourceKey(object.ref))) : items.map((item, index) => row.presentation.objects.find(object => sourceKey(object.ref) === sourceKey(item.ref)) ?? { ref: item.ref, hidden: false, points: item.ref.kind === "connector" ? [{ x: 140, y: 100 + index * 110 }] : [{ x: 140, y: 100 + index * 110 }, { x: 620, y: 100 + index * 110 }] });
  const presentation = (next = objects, opacity = row.presentation.backgroundOpacity) => update({ presentation: { ...row.presentation, objects: [...row.presentation.objects.filter(object => !items.some(item => sourceKey(item.ref) === sourceKey(object.ref))), ...next], backgroundOpacity: opacity } });
  const allPoints = objects.flatMap(object => object.points);
  const x = Math.min(0, ...allPoints.map(point => point.x - 100)), y = Math.min(0, ...allPoints.map(point => point.y - 65));
  const width = Math.max(800, ...allPoints.map(point => point.x + 170)) - x, height = Math.max(300, ...allPoints.map(point => point.y + 65)) - y;
  // Fit the source diagram as one faded context group; foreground handles use
  // independent presentation coordinates, so dragging never edits harness data.
  const background = row.kind === "assembly" ? [] : sources.map(item => ({ item, points: objectPoints(document, item.ref) })).filter(item => item.points.length);
  const bgPoints = background.flatMap(object => object.points), minX = Math.min(0, ...bgPoints.map(p => p.x)), minY = Math.min(0, ...bgPoints.map(p => p.y));
  const bgWidth = Math.max(1, ...bgPoints.map(p => p.x - minX)), bgHeight = Math.max(1, ...bgPoints.map(p => p.y - minY));
  const scale = Math.min((width - 120) / bgWidth, (height - 80) / bgHeight);
  const eventPoint = (event: React.PointerEvent<SVGSVGElement>): Point | null => { const matrix = svg.current?.getScreenCTM(); if (!matrix) return null; const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse()); return { x: Math.round(point.x), y: Math.round(point.y) }; };
  return <section className="route-presentation-section"><div className="route-presentation-toolbar"><label>Фон жгута <output>{Math.round(row.presentation.backgroundOpacity * 100)}%</output><input type="range" aria-label="Непрозрачность фона жгута" min={0} max={100} step={1} value={Math.round(row.presentation.backgroundOpacity * 100)} onChange={event => presentation(objects, Number(event.target.value) / 100)} /></label>{row.kind !== "assembly" && <><button type="button" onClick={() => presentation(items.map(item => ({ ref: item.ref, points: objectPoints(document, item.ref).length ? [...objectPoints(document, item.ref)] : [{ x: 140, y: 100 }, { x: 620, y: 100 }], hidden: false })))}>Геометрия жгута</button><button type="button" disabled={!selected} onClick={() => presentation(objects.map(object => sourceKey(object.ref) === selected ? { ...object, points: object.points.length > 1 ? [object.points[0]!, { x: (object.points[0]!.x + object.points.at(-1)!.x) / 2, y: object.points[0]!.y + 50 }, object.points.at(-1)!] : object.points } : object))}>Добавить изгиб</button></>}</div>
    {row.kind === "assembly" && !objects.some(object => !object.hidden) && <p className="route-drawing-empty">Откройте режим рисунка и сохраните фрагмент сборки.</p>}
    <p className="route-visually-hidden">Выберите объект и перетащите круглые маркеры. Длина резки остаётся заданной в жгуте.</p>
    <svg ref={svg} className="route-presentation" viewBox={`${x} ${y} ${width} ${height}`} role="img" aria-label="Редактируемое представление строки" onPointerMove={event => { if (disabled || !drag.current) return; const point = eventPoint(event); if (point) presentation(objects.map(object => sourceKey(object.ref) === drag.current!.key ? { ...object, points: object.points.map((value, index) => index === drag.current!.index ? point : value) } : object)); }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
      <g opacity={row.presentation.backgroundOpacity} transform={`translate(${x + 60} ${y + 40}) scale(${scale}) translate(${-minX} ${-minY})`} pointerEvents="none">{background.map(({ item, points }) => item.ref.kind === "connector" ? <rect key={sourceKey(item.ref)} x={points[0]!.x - 12} y={points[0]!.y - 12} width={24} height={24} fill="#536879" /> : <polyline key={sourceKey(item.ref)} points={points.map(p => `${p.x},${p.y}`).join(" ")} fill="none" stroke={item.color ?? "#536879"} strokeWidth={3 / scale} />)}</g>
      {objects.map(object => { const key = sourceKey(object.ref), item = items.find(item => sourceKey(item.ref) === key)!, start = object.points[0], end = object.points.at(-1); if (object.hidden || !start || !end) return null; const covering = object.ref.kind === "covering" ? document.physicalTopology?.coverings?.find(candidate => candidate.id === object.ref.id) : undefined; const coveringLength = Math.max(240, Math.min(720, Math.hypot(end.x - start.x, end.y - start.y))); const coveringCenter = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }; return <g key={key} className={selected === key ? "route-svg-object selected" : "route-svg-object"} onClick={() => setSelected(key)}><title>{item.title}</title>{object.ref.kind === "connector" ? <rect x={start.x - 20} y={start.y - 20} width={40} height={40} rx={5} fill="#fff" stroke="#295770" strokeWidth={3} /> : object.ref.kind === "covering" ? <foreignObject x={coveringCenter.x - coveringLength / 2} y={coveringCenter.y - 45} width={coveringLength} height={90}><RouteCoveringArtwork covering={covering ?? { name: item.title, color: item.color ?? "#aebfc9", lengthMm: item.lengthMm, style: undefined, kind: undefined }} width={coveringLength} height={90} /></foreignObject> : <><polyline points={object.points.map(p => `${p.x},${p.y}`).join(" ")} fill="none" stroke="#243746" strokeWidth={8} /><polyline points={object.points.map(p => `${p.x},${p.y}`).join(" ")} fill="none" stroke={item.color ?? "#d3dbe0"} strokeWidth={5} />{item.terminalFrom && <rect x={start.x - 14} y={start.y - 8} width={24} height={16} fill="#b2bac0" stroke="#455762" />}{item.terminalTo && <rect x={end.x - 10} y={end.y - 8} width={24} height={16} fill="#b2bac0" stroke="#455762" />}</>}
        <text x={start.x} y={start.y - 28}>{item.title}</text><text x={start.x} y={start.y + 30}>{item.lengthMm === null ? "Длина не задана" : `${item.lengthMm} мм`}</text>{item.terminalFrom && <text x={start.x - 15} y={start.y + 49}>{terminalArticleLabel(item.terminalFrom)}</text>}{item.terminalTo && <text x={end.x - 15} y={end.y + 49}>{terminalArticleLabel(item.terminalTo)}</text>}
        {object.points.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r={7} className="route-point-handle" aria-label={`Точка ${index + 1} ${item.title}`} onPointerDown={event => { if (disabled) return; event.preventDefault(); event.stopPropagation(); setSelected(key); drag.current = { key, index }; svg.current?.setPointerCapture(event.pointerId); }} />)}
      </g>; })}
    </svg>
  </section>;
}


function RouteTextField({ label, value, onChange, maxLength, required = false }: { label: string; value: string; onChange: (value: string) => void; maxLength: number; required?: boolean }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return <label>{label}<input aria-label={label} maxLength={maxLength} value={draft} onChange={event => { const next = event.target.value; setDraft(next); if (!required || next.trim()) onChange(next); }} onBlur={() => { if (required && !draft.trim()) setDraft(value); }} /></label>;
}

function RouteNumberField({ label, unit, value, min, onChange }: { label: string; unit: string; value: number; min: number; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const parsed = Number(draft.replace(",", "."));
  const valid = draft.trim() !== "" && Number.isFinite(parsed) && parsed >= min && parsed <= 1e9;
  return <label>{label}<div className="route-number-input"><input aria-label={label} inputMode="decimal" value={draft} aria-invalid={!valid} onChange={event => { const next = event.target.value, number = Number(next.replace(",", ".")); setDraft(next); if (next.trim() && Number.isFinite(number) && number >= min && number <= 1e9) onChange(number); }} onBlur={() => setDraft(String(value))} /><span>{unit}</span></div>{!valid && <small role="alert">От {min} до 1 000 000 000</small>}</label>;
}
