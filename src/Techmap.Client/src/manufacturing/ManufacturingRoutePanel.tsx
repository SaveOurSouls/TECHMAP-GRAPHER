import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createHarnessDesignApi } from "../editor/design-api";
import type { HarnessDesignDocument, Point } from "../editor/model";
import { terminalArticleLabel } from "../editor/terminal-article-label";
import { createReferenceCatalogApi, type ReferenceCatalogSearchPage, type ReferenceCatalogRecord, type ReferenceCatalogSourceSummary } from "../reference-catalog-api";
import type { LocalSession } from "../local-session";
import type { RuntimeConfig } from "../runtime-config";
import { addAssemblyRow, generateRoute, mergeRouteRows, routeRowPresentationConflicts, updateRouteRow } from "./route-commands";
import { parseManufacturingRoute, routeOperationModes, routeRowComposition, type ManufacturingRoute, type RouteOperation, type RouteRow } from "./route-model";
import { buildRouteSourceItems, routeSourceDesignation, type RouteSourceItem, type RouteSourceRef } from "./route-source";
import { RouteWorkspace } from "./route-workspace";
import { RoutePhotoList } from "./RoutePhotoList";
import { resolveRouteTerminalRequirements } from "./route-terminal-requirements";
import "./manufacturing-route.css";

type Props = { config: RuntimeConfig; session: LocalSession; projectId: string; harnessId: string; onClose?: () => void; onViewChange?: (view: "e4" | "drawing") => void; onNavigationGuard?: (guard: (() => Promise<boolean>) | null) => void };
const operationEntity = "operation";
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
  const workspace = useMemo(() => new RouteWorkspace(designApi, projectId, harnessId,
    (value, next) => resolveRouteTerminalRequirements(value.content, next, referenceApi)), [designApi, referenceApi, projectId, harnessId]);
  const { resource, route, dirty, saving, error: syncError, sourcePreview } = useSyncExternalStore(workspace.subscribe, workspace.getSnapshot, workspace.getSnapshot);
  const sources = useMemo(() => resource ? buildRouteSourceItems(resource.content) : [], [resource]);
  const [selectedRows, setSelectedRows] = useState<readonly string[]>([]);
  const [selectedSources, setSelectedSources] = useState<readonly string[]>([]);
  const [materialsOpen, setMaterialsOpen] = useState(true);
  const [blanksOpen, setBlanksOpen] = useState(true);
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
  const introduced = useMemo(() => new Set(route?.rows.flatMap(row => row.sourceObjects.map(sourceKey)) ?? []), [route]);
  const fixedBlanks = route?.rows.filter(row => row.kind === "semiFinished" && row.prepared) ?? [];
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
  const addAssembly = () => { if (!route || !selectedSources.length && !selectedRows.length) return; const refs = selectedSources.map(key => sources.find(item => sourceKey(item.ref) === key)?.ref).filter((ref): ref is RouteSourceRef => Boolean(ref)); try { markRoute(addAssemblyRow(route, crypto.randomUUID(), "Новая сборка", refs, selectedRows)); setSelectedSources([]); setSelectedRows([]); } catch (caught) { setError(caught instanceof Error ? caught.message : "Не удалось добавить сборку."); } };
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
  if (busy) return <section className="manufacturing-route-panel"><div className="route-loading"><span className="route-spinner" />Загрузка маршрутной карты…</div></section>;
  const totalMinutes = route?.rows.reduce((sum, row) => sum + (row.operationTimeMinutes ?? 0) * (row.quantity ?? resource?.harnessQuantity ?? 1), 0) ?? 0;
  const preparedCount = route?.rows.filter(row => row.prepared).length ?? 0;
  const introducedCount = route?.rows.reduce((sum, row) => sum + row.sourceObjects.length, 0) ?? 0;
  return <section className="manufacturing-route-panel" aria-label="Производственный маршрут">
    {onViewChange && <nav className="route-view-navigation" aria-label="Представление жгута">
      <button type="button" disabled={refreshing || photoBusy} onClick={async () => { if (await guard()) onViewChange("e4"); }}>Схема Э4</button>
      <button type="button" disabled={refreshing || photoBusy} onClick={async () => { if (await guard()) onViewChange("drawing"); }}>Чертёж</button>
      <button type="button" aria-current="page">Маршрут</button>
    </nav>}
    <header className="manufacturing-route-header"><div className="route-heading"><div className="route-heading-mark" aria-hidden="true"><span /><span /><span /></div><div><p className="eyebrow">M5 · МАРШРУТНАЯ КАРТА</p><h2>Маршрут производства</h2><p className="manufacturing-route-status" role="status"><span className={`route-status-dot ${saving ? "saving" : error ? "error" : ""}`} />{saving ? "Сохраняем…" : error ? "Есть ошибки" : dirty ? "Есть несохранённые изменения" : "Все изменения сохранены"} <span>·</span> {resource?.harnessQuantity ?? 1} шт. в заказе</p></div></div>
      <div className="manufacturing-route-actions">{route && (completed ? <><span className="route-ready">Маршрут завершён</span><button type="button" disabled={saving} onClick={() => markRoute({ ...route, status: "draft" })}>Продолжить</button></> : <button type="button" className="finish-action" disabled={stale || refreshing || photoBusy || !!sourcePreview} onClick={() => void finish()}>Закончить маршрут</button>)}{route && <button type="button" className="ghost-action" onClick={() => void refreshSource()} disabled={saving || refreshing}>Синхронизировать</button>}<button type="button" className="primary-action" onClick={() => void persist()} disabled={!route || saving || !dirty || stale || refreshing}>Сохранить</button>{onClose && <button type="button" className="ghost-action" disabled={refreshing || photoBusy} onClick={async () => { if (await guard()) onClose(); }}>Выйти</button>}</div>
    </header>
    {error && <p className="manufacturing-route-error" role="alert">{error}</p>}
    {sourcePreview && <section className="route-rebase-preview" aria-label="Изменения исходного жгута"><div><span className="route-alert-icon">!</span><div><h3>Изменения исходного жгута</h3><p>Добавлено объектов: {sourcePreview.added.length}. Удалено: {sourcePreview.removed.length}. Строки, операции и комментарии сохранятся, но их потребуется проверить.</p></div></div>{sourcePreview.removed.length > 0 && <ul>{sourcePreview.removed.map(ref => <li key={sourceKey(ref)}>Удалена связь: {sources.find(item => sourceKey(item.ref) === sourceKey(ref))?.title ?? ref.id} ({sourceLabel(ref)})</li>)}</ul>}<div className="route-rebase-actions"><button type="button" className="primary-action" onClick={() => void workspace.acceptSourceChanges()}>Применить изменения</button></div></section>}
    {stale && <p className="manufacturing-route-error" role="alert">Исходный жгут изменился. Длины показаны из последнего сохранённого чертежа. Подтвердите удалённые связи в составе маршрута перед продолжением.</p>}
    {!route ? <div className="manufacturing-route-empty"><div className="route-empty-illustration" aria-hidden="true"><span /><span /><span /><i /></div><div><p className="eyebrow">ШАГ 1 ИЗ 3</p><h3>Создайте маршрут из чертежа</h3><p>Провода, кабели и покрытия станут исходными полуфабрикатами. После этого их можно объединять в производственные этапы и добавлять сборочные операции.</p><button type="button" className="primary-action" onClick={() => void generate()} disabled={!resource || refreshing}>{refreshing ? "Создаём маршрут…" : "Создать маршрут"}</button>{!resource && <button type="button" onClick={() => void load()}>Повторить загрузку</button>}</div></div> : <>
      <section className="route-summary" aria-label="Сводка маршрута"><div className="route-summary-item"><span>Этапы</span><strong>{route.rows.length}</strong><small>строк маршрута</small></div><div className="route-summary-item"><span>Готовность</span><strong>{preparedCount}<em>/{route.rows.length}</em></strong><small>подготовлено</small></div><div className="route-summary-item"><span>Объекты</span><strong>{introducedCount}</strong><small>введено в маршрут</small></div><div className="route-summary-item"><span>Время</span><strong>{formatMinutes(totalMinutes)}</strong><small>на партию</small></div><div className="route-summary-progress"><div><span>Готовность маршрута</span><strong>{route.rows.length ? Math.round(preparedCount / route.rows.length * 100) : 0}%</strong></div><div className="route-progress-track"><span style={{ width: `${route.rows.length ? preparedCount / route.rows.length * 100 : 0}%` }} /></div><small>{completed ? "Маршрут закрыт для производства" : "Подготовьте строки и закрепите операции"}</small></div></section>
      <div className="manufacturing-route-toolbar"><div><button type="button" className="toolbar-button" onClick={merge} disabled={selectedRows.length < 2 || stale || refreshing || !!sourcePreview || completed || photoBusy}>Объединить выбранные <span>{selectedRows.length || ""}</span></button><button type="button" className="toolbar-button" onClick={addAssembly} disabled={!selectedSources.length && !selectedRows.length || stale || refreshing || !!sourcePreview || completed || photoBusy}>+ Добавить сборку</button></div><span>{route.rows.length} {route.rows.length === 1 ? "этап" : "этапов"} · выбрано {selectedRows.length}</span></div>
      <div className={`manufacturing-route-body ${materialsOpen ? "" : "materials-collapsed"} ${blanksOpen ? "" : "blanks-collapsed"}`}><div className="route-quick-access">
        <aside className={`manufacturing-route-sources ${materialsOpen ? "" : "is-collapsed"}`} aria-label="Сырьё из спецификации"><button type="button" className="route-aside-toggle" aria-label={materialsOpen ? "Скрыть сырьё" : "Показать сырьё"} aria-expanded={materialsOpen} onClick={() => setMaterialsOpen(value => !value)}><span aria-hidden="true">▦</span><strong>Сырьё</strong><small>{sources.length}</small><span aria-hidden="true">{materialsOpen ? "‹" : "›"}</span></button>{materialsOpen && <div className="route-source-list">{sources.map(item => { const used = introduced.has(sourceKey(item.ref)); const target = route.rows.find(row => row.sourceObjects.some(ref => sourceKey(ref) === sourceKey(item.ref))); return <div key={sourceKey(item.ref)} className="route-source-check">{used ? <button type="button" className="route-source-jump" aria-label={`Перейти к ${item.title}`} onClick={() => document.getElementById(`route-row-${target?.id}`)?.scrollIntoView({ block: "center", behavior: "smooth" })}>↗</button> : <input type="checkbox" disabled={completed || stale || refreshing || !!sourcePreview} aria-label={`Выбрать ${item.title}`} checked={selectedSources.includes(sourceKey(item.ref))} onChange={() => toggle(selectedSources, sourceKey(item.ref), setSelectedSources)} />}<span className="source-type-icon" aria-hidden="true">{item.ref.kind === "wire" ? "W" : item.ref.kind === "connector" ? "X" : item.ref.kind === "cable" ? "C" : "○"}</span><span><strong>{item.material || item.materialArticle || item.title}</strong><small>{item.title} · {item.lengthMm == null ? "—" : `${item.lengthMm} мм`}</small></span></div>; })}{!sources.length && <p className="route-aside-empty">Материалы не найдены.</p>}</div>}</aside>
        <aside className={`manufacturing-route-sources ${blanksOpen ? "" : "is-collapsed"}`} aria-label="Зафиксированные полуфабрикаты"><button type="button" className="route-aside-toggle" aria-label={blanksOpen ? "Скрыть полуфабрикаты" : "Показать полуфабрикаты"} aria-expanded={blanksOpen} onClick={() => setBlanksOpen(value => !value)}><span aria-hidden="true">▣</span><strong>Полуфабрикаты</strong><small>{fixedBlanks.length}</small><span aria-hidden="true">{blanksOpen ? "‹" : "›"}</span></button>{blanksOpen && <div className="route-source-list">{fixedBlanks.map(row => <label key={row.id} className="route-source-check"><input type="checkbox" disabled={completed || stale || refreshing || !!sourcePreview} checked={selectedRows.includes(row.id)} onChange={() => toggle(selectedRows, row.id, setSelectedRows)} /><span className="source-type-icon" aria-hidden="true">ПФ</span><span><strong>{row.index || row.title}</strong><small>{row.title}</small></span></label>)}{!fixedBlanks.length && <p className="route-aside-empty">Подготовленных полуфабрикатов пока нет.</p>}</div>}</aside>
      </div><section className="manufacturing-route-table-card"><div className="route-table-heading"><div><h3>Этапы производства</h3></div><div className="route-table-legend"><span className="legend-dot prepared" /> подготовлено <span className="legend-dot draft" /> требует действий</div></div><div className="route-table route-inline-table" role="table" aria-label="Этапы производственного маршрута"><div className="route-inline-header" role="row"><span role="columnheader">№</span><span role="columnheader">Этап и материалы</span><span role="columnheader">Параметры</span><span role="columnheader">Операции</span><span role="columnheader">Рисунок и фото</span></div>{resource && route.rows.map((row, index) => <RouteRowInline key={row.id} config={config} session={session} projectId={projectId} row={row} route={route} document={resource.content} sources={sources} ordinal={index + 1}
        disabled={stale || refreshing || !!sourcePreview || completed} selected={selectedRows.includes(row.id)} onSelect={() => toggle(selectedRows, row.id, setSelectedRows)}
        update={patch => updateRow(row.id, patch)} setPhotoBusy={value => setPhotoRows(previous => { const next = new Set(previous); if (value) next.add(row.id); else next.delete(row.id); return next; })} />)}{!route.rows.length && <div className="route-table-empty">Добавьте первый этап из списка сырья.</div>}</div></section></div>
    </>}
  </section>;
}

function operationLabel(record: ReferenceCatalogRecord): string {
  for (const key of ["name", "operationName", "displayName", "title"]) if (typeof record.payload[key] === "string" && record.payload[key].trim()) return record.payload[key].trim();
  return record.sourceKey;
}

export function RouteRowInline({ config, session, projectId, setPhotoBusy, row, route, document, sources, update, disabled, selected, ordinal, onSelect }: {
  config: RuntimeConfig; session: LocalSession; projectId: string; setPhotoBusy: (busy: boolean) => void;
  row: RouteRow; route: ManufacturingRoute; document: HarnessDesignDocument; sources: readonly RouteSourceItem[]; update: (patch: Partial<Omit<RouteRow, "id">>) => void;
  disabled: boolean; selected: boolean; ordinal: number; onSelect: () => void;
}) {
  const referenceApi = useMemo(() => createReferenceCatalogApi(config, session), [config, session]);
  const [operationSources, setOperationSources] = useState<readonly ReferenceCatalogSourceSummary[]>([]);
  const [operationSourceId, setOperationSourceId] = useState("");
  const [operationQuery, setOperationQuery] = useState("");
  const [operationPage, setOperationPage] = useState<ReferenceCatalogSearchPage | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const hasOperations = row.operations.length > 0;
  useEffect(() => {
    if (!hasOperations || disabled) return;
    let cancelled = false;
    void referenceApi.listSources().then(items => { if (cancelled) return; setOperationSources(items); setOperationSourceId(previous => previous || items.find(item => /опера|БД\.ОП|operation/i.test(`${item.sourceId} ${item.displayName}`))?.sourceId || items[0]?.sourceId || ""); })
      .catch(caught => { if (!cancelled) setCatalogError(caught.message); });
    return () => { cancelled = true; };
  }, [referenceApi, hasOperations, disabled]);
  useEffect(() => {
    if (!operationSourceId || !hasOperations || disabled) return;
    setOperationPage(null); setCatalogLoading(true); setCatalogError(null);
    const controller = new AbortController();
    const timer = window.setTimeout(() => void referenceApi.searchCatalog(operationSourceId, {
      text: operationQuery.trim() || null, exactSourceKey: null, entityTypes: [operationEntity], filters: [], filterLogic: "all", sort: "relevance", pageSize: 30, cursor: null,
    }, controller.signal).then(page => { if (!controller.signal.aborted) { setOperationPage(page); setCatalogLoading(false); } }).catch(caught => { if (!controller.signal.aborted) { setCatalogError(caught.message); setCatalogLoading(false); } }), 200);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [referenceApi, operationSourceId, operationQuery, hasOperations, disabled]);
  const [operationId, setOperationId] = useState(row.operations[0]?.id ?? "");
  const [mode, setMode] = useState<RouteOperation["mode"]>(row.kind === "assembly" ? "assembly" : "cut");

  const refs = routeRowComposition(route, row.id);
  const items = refs.map(ref => sources.find(item => sourceKey(item.ref) === sourceKey(ref))).filter((item): item is RouteSourceItem => !!item);
  const wireIds = new Set(items.filter(item => item.ref.kind === "wire").map(item => item.ref.id));
  const requirements = route.rows.flatMap(row => row.terminalRequirements ?? []).filter(item => wireIds.has(item.wireId));
  const conflicts = routeRowPresentationConflicts(route, row.id);
  const changeOperation = (id: string, patch: Partial<RouteOperation>) => update({ operations: row.operations.map(operation => operation.id === id ? { ...operation, ...patch } : operation) });
  const addOperation = () => { const id = crypto.randomUUID(); update({ operations: [...row.operations, { id, mode, note: "", binding: null }] }); setOperationId(id); };
  const bind = (record: ReferenceCatalogRecord) => {
    if (!operationPage || !operationId) return;
    changeOperation(operationId, { binding: { sourceId: operationSourceId, entityType: "operation", snapshotId: operationPage.snapshotId, snapshotSha256: operationPage.snapshotSha256, recordId: record.recordId, sourceKey: record.sourceKey, displayName: operationLabel(record) } });
  };
  const guardedUpdate = (patch: Partial<Omit<RouteRow, "id">>) => { if (!disabled) update(patch); };
  return <article id={`route-row-${row.id}`} className={`route-inline-row ${selected ? "selected" : ""}`} role="row" aria-label={`Этап ${ordinal}: ${row.title}`}>
    <div className="route-inline-number" role="cell"><label><input type="checkbox" disabled={disabled} aria-label={`Выбрать ${row.title}`} checked={selected} onChange={onSelect} /><span>{String(ordinal).padStart(2, "0")}</span></label></div>
    <fieldset className="route-inline-material" role="cell" disabled={disabled} aria-label={`Идентификация этапа ${ordinal}`}>
      <span className={`route-kind ${row.kind}`}>{row.kind === "assembly" ? "СБОРКА" : "ПОЛУФАБРИКАТ"}</span>
      <div className="route-identity-table" role="group" aria-label="Название этапа"><RouteTextField label="Индекс" value={row.index ?? ""} maxLength={128} onChange={value => update({ index: value })} /><RouteTextField label="Название" value={row.title} maxLength={512} required onChange={value => update({ title: value })} /></div>
      {row.dependsOn.length > 0 && <p className="route-dependency">После этапов {row.dependsOn.map(id => route.rows.findIndex(candidate => candidate.id === id) + 1).join(", ")}</p>}
      <div className="route-material-table-scroll"><table className="route-material-table"><thead><tr><th>Объект</th><th>Материал</th><th>Длина</th><th>Концы</th><th>Разделка</th></tr></thead><tbody>{items.map(item => <tr key={sourceKey(item.ref)}><td><strong>{item.title}</strong>{item.cableId && <small title="Жила кабеля: расход учитывается в кабеле">Жила кабеля</small>}</td><td>{routeSourceDesignation(item)}</td><td>{item.ref.kind === "connector" ? "—" : item.lengthMm === null ? "—" : `${item.lengthMm} мм`}</td><td>{item.ref.kind === "wire" ? <><span>Н: {terminalArticleLabel(item.terminalFrom) || "—"}</span><span>К: {terminalArticleLabel(item.terminalTo) || "—"}</span></> : "—"}</td><td>{item.stripProfiles ? `${item.stripProfiles.from?.displayName ?? "—"} / ${item.stripProfiles.to?.displayName ?? "—"}` : "—"}</td></tr>)}</tbody></table></div>
      <label className="route-comment-field">Комментарий<textarea aria-label="Комментарий строки" maxLength={4000} value={row.comment} onChange={event => update({ comment: event.target.value })} /></label>
    </fieldset>
    <fieldset className="route-inline-quantity" role="cell" disabled={disabled} aria-label={`Параметры этапа ${ordinal}`}>
      <div className="route-metrics-table"><RouteNumberField label="Кол-во" unit="шт." value={row.quantity ?? 1} min={1} onChange={value => update({ quantity: value })} /><RouteNumberField label="Запас" unit="шт." value={row.reserve ?? 0} min={0} onChange={value => update({ reserve: value })} /><RouteNumberField label="Время" unit="мин/шт." value={row.operationTimeMinutes ?? 0} min={0} onChange={value => update({ operationTimeMinutes: value })} /><p className="route-muted">Партия <strong>{formatMinutes((row.operationTimeMinutes ?? 0) * (row.quantity ?? 1))}</strong></p></div>
      <label className="route-prepared-check"><input type="checkbox" checked={row.prepared} onChange={event => update({ prepared: event.target.checked })} />Подготовлен</label>
      <span className={row.prepared ? "route-ready" : "route-draft"}>{row.prepared ? "Готово" : "Черновик"}</span>
    </fieldset>
    <fieldset className="route-inline-operations" role="cell" disabled={disabled} aria-label={`Операции этапа ${ordinal}`}>
    <section className="route-operations route-editor-block"><div className="route-editor-block-heading"><div><h4>Операции</h4></div></div><div className="route-operation-add"><label>Режим<select aria-label="Режим новой операции" value={mode} onChange={event => setMode(event.target.value as RouteOperation["mode"])}>{routeOperationModes.map(mode => <option key={mode} value={mode}>{operationModes[mode]}</option>)}</select></label><button type="button" className="secondary-action" onClick={addOperation}>+ Добавить</button></div>
      {row.operations.map((operation, index) => <div className={`route-operation-row ${operationId === operation.id ? "selected" : ""}`} key={operation.id}><label><input type="radio" name={`route-operation-${row.id}`} aria-label={`Выбрать операцию ${index + 1}`} checked={operationId === operation.id} onChange={() => setOperationId(operation.id)} />{index + 1}</label><select aria-label={`Режим операции ${index + 1}`} value={operation.mode} onChange={event => changeOperation(operation.id, { mode: event.target.value as RouteOperation["mode"] })}>{routeOperationModes.map(mode => <option key={mode} value={mode}>{operationModes[mode]}</option>)}</select><span>{operation.binding?.displayName ?? "Выберите операцию ниже"}</span><input aria-label={`Примечание операции ${index + 1}`} maxLength={4000} placeholder="Примечание" value={operation.note} onChange={event => changeOperation(operation.id, { note: event.target.value })} /><button type="button" aria-label={`Удалить операцию ${index + 1}`} title="Удалить операцию" onClick={() => update({ operations: row.operations.filter(item => item.id !== operation.id) })}>×</button></div>)}
      {row.operations.length > 0 && <div className="route-operation-binding"><h4>Выбрать операцию</h4><div><label>Справочник<select aria-label="Справочник операций" value={operationSourceId} onChange={event => setOperationSourceId(event.target.value)}>{operationSources.map(source => <option key={source.sourceId} value={source.sourceId}>{source.displayName}</option>)}</select></label><label>Поиск<input aria-label="Поиск БД.ОП" placeholder="Обозначение или название" value={operationQuery} onChange={event => setOperationQuery(event.target.value)} /></label></div>{catalogLoading && <p role="status">Поиск операций…</p>}{catalogError && <p role="alert">{catalogError}</p>}{!operationSources.length && <p>Загрузите справочник операций.</p>}<div className="route-operation-results">{operationPage?.items.map(record => <button type="button" key={record.recordId} disabled={!row.operations.some(operation => operation.id === operationId)} onClick={() => bind(record)}><strong>{operationLabel(record)}</strong></button>)}{operationPage && !operationPage.items.length && <p>Операции не найдены.</p>}{operationPage?.nextCursor && <p>Уточните поиск, чтобы увидеть другие записи.</p>}</div></div>}
 </section>    {items.some(item => item.ref.kind === "wire") && <section className="route-terminal-requirements"><h4>Зачистка</h4><table><thead><tr><th>Провод</th><th>Конец</th><th>Артикул</th><th>Длина</th></tr></thead><tbody>{items.filter(item => item.ref.kind === "wire").flatMap(item => (["from", "to"] as const).map(end => { const requirement = requirements.find(value => value.wireId === item.ref.id && value.end === end); return <tr key={`${item.ref.id}:${end}`}><td>{item.title}</td><td>{end === "from" ? "Начало" : "Конец"}</td><td>{terminalArticleLabel(requirement?.terminalArticle || (end === "from" ? item.terminalFrom : item.terminalTo)) || "—"}</td><td>{requirement?.stripLengthMm == null ? "—" : `${requirement.stripLengthMm} мм`}</td></tr>; }))}</tbody></table></section>}
</fieldset>
    <fieldset className="route-inline-visual" role="cell" disabled={disabled} aria-label={`Рисунок и фото этапа ${ordinal}`}>
    <section className="route-editor-block"><div className="route-editor-block-heading"><div><h4>Рисунок этапа</h4></div></div><RoutePresentation row={row} document={document} sources={sources} items={items} update={guardedUpdate} disabled={disabled} /></section>
    {conflicts.length > 0 && <section className="manufacturing-route-error" role="alert"><strong>Разные представления общего объекта</strong><p>Задайте представление объекта в этой строке, чтобы согласовать результат сборки.</p>{conflicts.map(conflict => <div key={sourceKey(conflict.ref)}><span>{items.find(item => sourceKey(item.ref) === sourceKey(conflict.ref))?.title}</span>{conflict.variants.map(variant => <button key={variant.rowId} type="button" onClick={() => update({ presentation: { ...row.presentation, objects: [...row.presentation.objects.filter(object => sourceKey(object.ref) !== sourceKey(conflict.ref)), variant.object] } })}>Взять из «{route.rows.find(row => row.id === variant.rowId)?.title}»</button>)}</div>)}</section>}
 <section className="route-editor-block route-photo-block"><div className="route-editor-block-heading"><div><h4>Фото этапа</h4></div></div><RoutePhotoList config={config} session={session} projectId={projectId} photos={row.photos} disabled={disabled} onChange={photos => update({ photos })} onBusyChange={setPhotoBusy} /></section></fieldset>

  </article>;
}

function RoutePresentation({ row, document, sources, items, update, disabled }: { row: RouteRow; document: HarnessDesignDocument; sources: readonly RouteSourceItem[]; items: readonly RouteSourceItem[]; disabled: boolean; update: (patch: Partial<Omit<RouteRow, "id">>) => void }) {
  const svg = useRef<SVGSVGElement>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const drag = useRef<{ key: string; index: number } | null>(null);
  const objects = items.map((item, index) => row.presentation.objects.find(object => sourceKey(object.ref) === sourceKey(item.ref)) ?? { ref: item.ref, hidden: false, points: item.ref.kind === "connector" ? [{ x: 140, y: 100 + index * 110 }] : [{ x: 140, y: 100 + index * 110 }, { x: 620, y: 100 + index * 110 }] });
  const presentation = (next = objects, opacity = row.presentation.backgroundOpacity) => update({ presentation: { objects: next, backgroundOpacity: opacity } });
  const allPoints = objects.flatMap(object => object.points);
  const x = Math.min(0, ...allPoints.map(point => point.x - 100)), y = Math.min(0, ...allPoints.map(point => point.y - 65));
  const width = Math.max(800, ...allPoints.map(point => point.x + 170)) - x, height = Math.max(300, ...allPoints.map(point => point.y + 65)) - y;
  // Fit the source diagram as one faded context group; foreground handles use
  // independent presentation coordinates, so dragging never edits harness data.
  const background = sources.map(item => ({ item, points: objectPoints(document, item.ref) })).filter(item => item.points.length);
  const bgPoints = background.flatMap(object => object.points), minX = Math.min(0, ...bgPoints.map(p => p.x)), minY = Math.min(0, ...bgPoints.map(p => p.y));
  const bgWidth = Math.max(1, ...bgPoints.map(p => p.x - minX)), bgHeight = Math.max(1, ...bgPoints.map(p => p.y - minY));
  const scale = Math.min((width - 120) / bgWidth, (height - 80) / bgHeight);
  const eventPoint = (event: React.PointerEvent<SVGSVGElement>): Point | null => { const matrix = svg.current?.getScreenCTM(); if (!matrix) return null; const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse()); return { x: Math.round(point.x), y: Math.round(point.y) }; };
  return <section className="route-presentation-section"><div className="route-presentation-toolbar"><label>Фон жгута<input type="range" aria-label="Непрозрачность фона жгута" min={.1} max={.5} step={.05} value={row.presentation.backgroundOpacity} onChange={event => presentation(objects, Number(event.target.value))} /></label><button type="button" onClick={() => presentation(items.map(item => ({ ref: item.ref, points: objectPoints(document, item.ref).length ? [...objectPoints(document, item.ref)] : [{ x: 140, y: 100 }, { x: 620, y: 100 }], hidden: false })))}>Геометрия жгута</button><button type="button" disabled={!selected} onClick={() => presentation(objects.map(object => sourceKey(object.ref) === selected ? { ...object, points: object.points.length > 1 ? [object.points[0]!, { x: (object.points[0]!.x + object.points.at(-1)!.x) / 2, y: object.points[0]!.y + 50 }, object.points.at(-1)!] : object.points } : object))}>Добавить изгиб</button></div>
    <p className="route-visually-hidden">Выберите объект и перетащите круглые маркеры. Длина резки остаётся заданной в жгуте.</p>
    <svg ref={svg} className="route-presentation" viewBox={`${x} ${y} ${width} ${height}`} role="img" aria-label="Редактируемое представление строки" onPointerMove={event => { if (disabled || !drag.current) return; const point = eventPoint(event); if (point) presentation(objects.map(object => sourceKey(object.ref) === drag.current!.key ? { ...object, points: object.points.map((value, index) => index === drag.current!.index ? point : value) } : object)); }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
      <g opacity={row.presentation.backgroundOpacity} transform={`translate(${x + 60} ${y + 40}) scale(${scale}) translate(${-minX} ${-minY})`} pointerEvents="none">{background.map(({ item, points }) => item.ref.kind === "connector" ? <rect key={sourceKey(item.ref)} x={points[0]!.x - 12} y={points[0]!.y - 12} width={24} height={24} fill="#536879" /> : <polyline key={sourceKey(item.ref)} points={points.map(p => `${p.x},${p.y}`).join(" ")} fill="none" stroke={item.color ?? "#536879"} strokeWidth={3 / scale} />)}</g>
      {objects.map(object => { const key = sourceKey(object.ref), item = items.find(item => sourceKey(item.ref) === key)!, start = object.points[0], end = object.points.at(-1); if (object.hidden || !start || !end) return null; return <g key={key} className={selected === key ? "route-svg-object selected" : "route-svg-object"} onClick={() => setSelected(key)}><title>{item.title}</title>{object.ref.kind === "connector" ? <rect x={start.x - 20} y={start.y - 20} width={40} height={40} rx={5} fill="#fff" stroke="#295770" strokeWidth={3} /> : <><polyline points={object.points.map(p => `${p.x},${p.y}`).join(" ")} fill="none" stroke="#243746" strokeWidth={8} /><polyline points={object.points.map(p => `${p.x},${p.y}`).join(" ")} fill="none" stroke={item.color ?? "#d3dbe0"} strokeWidth={5} />{item.terminalFrom && <rect x={start.x - 14} y={start.y - 8} width={24} height={16} fill="#b2bac0" stroke="#455762" />}{item.terminalTo && <rect x={end.x - 10} y={end.y - 8} width={24} height={16} fill="#b2bac0" stroke="#455762" />}</>}
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
