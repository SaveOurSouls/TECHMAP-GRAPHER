import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createHarnessDesignApi, type HarnessDesignResource } from "../editor/design-api";
import type { HarnessDesignDocument, Point } from "../editor/model";
import { createReferenceCatalogApi, type ReferenceCatalogSearchPage, type ReferenceCatalogRecord, type ReferenceCatalogSourceSummary } from "../reference-catalog-api";
import type { LocalSession } from "../local-session";
import type { RuntimeConfig } from "../runtime-config";
import { addAssemblyRow, generateRoute, mergeRouteRows, routeRowPresentationConflicts, updateRouteRow } from "./route-commands";
import { parseManufacturingRoute, routeOperationModes, routeRowComposition, type ManufacturingRoute, type RouteOperation, type RouteRow } from "./route-model";
import { buildRouteSourceItems, type RouteSourceItem, type RouteSourceRef } from "./route-source";
import { previewRouteRebase } from "./route-rebase";
import { RoutePhotoList } from "./RoutePhotoList";
import { resolveRouteTerminalRequirements } from "./route-terminal-requirements";
import "./manufacturing-route.css";

type RouteDocument = HarnessDesignDocument & { manufacturingRoute?: ManufacturingRoute };
type RouteResource = HarnessDesignResource & { content: RouteDocument; sourceFingerprint?: string; harnessQuantity?: number };
type Props = { config: RuntimeConfig; session: LocalSession; projectId: string; harnessId: string; onClose?: () => void; onNavigationGuard?: (guard: (() => Promise<boolean>) | null) => void };
const operationEntity = "operation";
const operationModes: Record<RouteOperation["mode"], string> = { cut: "Резка", "cut-strip-from": "Резка и зачистка начала", "cut-strip-to": "Резка и зачистка конца", "cut-strip-both": "Резка и зачистка двух концов", "cut-crimp": "Резка и обжим", tin: "Лужение", "strip-from": "Зачистка начала", "strip-to": "Зачистка конца", "strip-both": "Зачистка двух концов", assembly: "Сборка" };
const cutModes = new Set<RouteOperation["mode"]>(["cut", "cut-strip-from", "cut-strip-to", "cut-strip-both", "cut-crimp"]);

function sourceKey(ref: RouteSourceRef): string { return `${ref.kind}:${ref.id}`; }
function routeOrUndefined(content: RouteDocument): ManufacturingRoute | undefined { return content.manufacturingRoute; }
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

function RouteRowThumbnail({ row, items }: { row: RouteRow; items: readonly RouteSourceItem[] }) {
  const visible = row.presentation.objects.filter(item => !item.hidden && item.points.length > 0);
  if (!visible.length) return <div className="route-row-thumbnail route-row-thumbnail-empty"><span>Нет рисунка</span></div>;
  const points = visible.flatMap(item => item.points), minX = Math.min(...points.map(point => point.x)), maxX = Math.max(...points.map(point => point.x)), minY = Math.min(...points.map(point => point.y)), maxY = Math.max(...points.map(point => point.y));
  const width = Math.max(80, maxX - minX), height = Math.max(34, maxY - minY), pad = 12;
  return <div className="route-row-thumbnail"><svg viewBox={`${minX - pad} ${minY - pad} ${width + pad * 2} ${height + pad * 2}`} role="img" aria-label="Миниатюра представления полуфабриката">
    {visible.map((object, index) => { const item = items.find(candidate => sourceKey(candidate.ref) === sourceKey(object.ref)); return object.ref.kind === "connector" ? <rect key={index} x={object.points[0]!.x - 5} y={object.points[0]!.y - 5} width={10} height={10} rx={2} fill="#fff" stroke="#2b6687" strokeWidth={2} /> : <polyline key={index} points={object.points.map(point => `${point.x},${point.y}`).join(" ")} fill="none" stroke={item?.color ?? "#2a708f"} strokeWidth={Math.max(4, width / 55)} strokeLinecap="round" strokeLinejoin="round" />; })}
  </svg></div>;
}

export function ManufacturingRoutePanel({ config, session, projectId, harnessId, onClose, onNavigationGuard }: Props) {
  const designApi = useMemo(() => createHarnessDesignApi(config, session), [config, session]);
  const referenceApi = useMemo(() => createReferenceCatalogApi(config, session), [config, session]);
  const [resource, setResource] = useState<RouteResource | null>(null);
  const [route, setRoute] = useState<ManufacturingRoute | undefined>();
  const [sources, setSources] = useState<readonly RouteSourceItem[]>([]);
  const [selectedRows, setSelectedRows] = useState<readonly string[]>([]);
  const [selectedSources, setSelectedSources] = useState<readonly string[]>([]);
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [operationSources, setOperationSources] = useState<readonly ReferenceCatalogSourceSummary[]>([]);
  const [operationPage, setOperationPage] = useState<ReferenceCatalogSearchPage | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [operationSourceId, setOperationSourceId] = useState("");
  const [operationQuery, setOperationQuery] = useState("");
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [sourcePreview, setSourcePreview] = useState<{ resource: RouteResource; preview: ReturnType<typeof previewRouteRebase> } | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  const pendingSave = useRef<Promise<boolean> | null>(null);
  const resourceRef = useRef<RouteResource | null>(null);
  const sequence = useRef(0);
  const acknowledgedSequence = useRef(0);
  const failedSave = useRef(false);
  const loadSequence = useRef(0);
  const routeRef = useRef(route);
  routeRef.current = route;

  const load = useCallback(async () => {
    const started = ++loadSequence.current;
    setBusy(true); setError(null);
    try {
      const value = await designApi.get(projectId, harnessId) as RouteResource;
      if (started !== loadSequence.current) return;
      setResource(value); resourceRef.current = value;
      const document = value.content;
      setSources(buildRouteSourceItems(document));
      setRoute(routeOrUndefined(document)); routeRef.current = routeOrUndefined(document); setDirty(false); setSaved(null);
      sequence.current = 0; acknowledgedSequence.current = 0;
    } catch (caught) { if (started === loadSequence.current) setError(caught instanceof Error ? caught.message : "Не удалось загрузить маршрут."); }
    finally { if (started === loadSequence.current) setBusy(false); }
  }, [designApi, harnessId, projectId]);
  useEffect(() => { void load(); return () => { loadSequence.current += 1; }; }, [load]);
  useEffect(() => {
    void referenceApi.listSources().then(items => {
      const preferred = items.find(item => /опера|БД\.ОП|operation/i.test(`${item.sourceId} ${item.displayName}`));
      setOperationSources(items); if (items.length) setOperationSourceId(preferred?.sourceId ?? items[0]!.sourceId);
    }).catch(caught => setCatalogError(caught instanceof Error ? caught.message : "Список справочников недоступен."));
  }, [referenceApi]);
  useEffect(() => {
    if (!operationSourceId) return;
    setOperationPage(null); setCatalogLoading(true); setCatalogError(null);
    const controller = new AbortController();
    const timer = window.setTimeout(() => void referenceApi.searchCatalog(operationSourceId, {
      text: operationQuery.trim() || null, exactSourceKey: null, entityTypes: [operationEntity], filters: [], filterLogic: "all", sort: "relevance", pageSize: 30, cursor: null,
    }, controller.signal).then(page => { if (!controller.signal.aborted) { setOperationPage(page); setCatalogLoading(false); } }).catch(caught => { if (!controller.signal.aborted) { setOperationPage(null); setCatalogLoading(false); setCatalogError(caught instanceof Error ? caught.message : "Поиск операций недоступен."); } }), 200);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [operationQuery, operationSourceId, referenceApi]);

  const markRoute = useCallback((next: ManufacturingRoute) => {
    sequence.current += 1; failedSave.current = false; setRoute(next); routeRef.current = next; setDirty(true); setSaved(null); setError(null);
  }, []);
  const persist = useCallback((): Promise<boolean> => {
    window.clearTimeout(saveTimer.current);
    if (pendingSave.current) return pendingSave.current;
    if (acknowledgedSequence.current === sequence.current) return Promise.resolve(true);
    if (!resourceRef.current) return Promise.resolve(false);
    setSaving(true);
    const drain = async (): Promise<boolean> => {
      try {
        while (acknowledgedSequence.current !== sequence.current) {
          const started = sequence.current, base = resourceRef.current!;
          const content = { ...base.content, manufacturingRoute: routeRef.current } as RouteDocument;
          const result = await designApi.save(projectId, harnessId, base.revision, content) as RouteResource;
          resourceRef.current = result; setResource(result); acknowledgedSequence.current = started;
        }
        failedSave.current = false; setDirty(false); setSaved("Сохранено"); setError(null); return true;
      } catch (caught) { failedSave.current = true; setError(caught instanceof Error ? caught.message : "Не удалось сохранить маршрут."); return false; }
      finally { pendingSave.current = null; setSaving(false); }
    };
    pendingSave.current = drain(); return pendingSave.current;
  }, [designApi, harnessId, projectId]);
  useEffect(() => {
    if (!dirty || !route || failedSave.current) return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => { void persist(); }, 1000);
    return () => window.clearTimeout(saveTimer.current);
  }, [dirty, persist, route]);
  useEffect(() => () => window.clearTimeout(saveTimer.current), []);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => { if (dirty || saving || photoBusy) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", unload); return () => window.removeEventListener("beforeunload", unload);
  }, [dirty, saving, photoBusy]);
  const guard = useCallback(() => photoBusy || refreshing ? Promise.resolve(false) : persist(), [persist, photoBusy, refreshing]);
  useEffect(() => { onNavigationGuard?.(guard); return () => onNavigationGuard?.(null); }, [guard, onNavigationGuard]);

  const selectedRow = route?.rows.find(row => row.id === editingRowId) ?? null;
  const stale = Boolean(route && resource?.sourceFingerprint && route.source.sha256 !== resource.sourceFingerprint);
  const completed = route?.status === "completed";
  const introduced = useMemo(() => new Set(route?.rows.flatMap(row => row.sourceObjects.map(sourceKey)) ?? []), [route]);
  const availableAssemblySources = sources.filter(item => !introduced.has(sourceKey(item.ref)));
  const updateRow = (id: string, patch: Partial<Omit<RouteRow, "id">>) => { if (routeRef.current) try { markRoute(updateRouteRow(routeRef.current, id, patch)); } catch(caught) { setError(caught instanceof Error ? caught.message : "Проверьте строку маршрута."); } };
  const generate = async () => {
    if (!resource || route || refreshing) return;
    setRefreshing(true); setError(null);
    try {
      // Normalize legacy defaults before pinning the server's source fingerprint.
      const acknowledged = await designApi.save(projectId, harnessId, resource.revision, resource.content) as RouteResource;
      if (!acknowledged.sourceFingerprint) throw new Error("Сервер не передал отпечаток исходного жгута. Обновите приложение.");
      resourceRef.current = acknowledged; setResource(acknowledged); setSources(buildRouteSourceItems(acknowledged.content));
       markRoute(await resolveRouteTerminalRequirements(acknowledged.content, generateRoute(acknowledged.content, acknowledged.sourceFingerprint, acknowledged.harnessQuantity ?? 1), referenceApi));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Не удалось создать маршрут."); }
    finally { setRefreshing(false); }
  };
  const refreshSource = async () => {
    if (!route || refreshing || pendingSave.current) return;
    setRefreshing(true); setError(null);
    try {
      const latest = await designApi.get(projectId, harnessId) as RouteResource;
      if (!latest.sourceFingerprint) throw new Error("Сервер не передал отпечаток исходного жгута.");
      const preview = previewRouteRebase(route, latest.content, latest.sourceFingerprint);
      preview.route = await resolveRouteTerminalRequirements(latest.content, preview.route, referenceApi);
      setSourcePreview({ resource: latest, preview });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Не удалось актуализировать маршрут."); }
    finally { setRefreshing(false); }
  };
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
    <header className="manufacturing-route-header"><div className="route-heading"><div className="route-heading-mark" aria-hidden="true"><span /><span /><span /></div><div><p className="eyebrow">M5 · МАРШРУТНАЯ КАРТА</p><h2>Маршрут производства</h2><p className="manufacturing-route-status" role="status"><span className={`route-status-dot ${saving ? "saving" : error ? "error" : ""}`} />{saving ? "Сохраняем…" : error ? "Есть ошибки" : dirty ? "Есть несохранённые изменения" : saved ?? "Все изменения сохранены"} <span>·</span> {resource?.harnessQuantity ?? 1} шт. в заказе</p></div></div>
      <div className="manufacturing-route-actions">{route && (completed ? <><span className="route-ready">Маршрут завершён</span><button type="button" disabled={saving} onClick={() => markRoute({ ...route, status: "draft" })}>Продолжить</button></> : <button type="button" className="finish-action" disabled={stale || refreshing || photoBusy || !!sourcePreview} onClick={() => void finish()}>Закончить маршрут</button>)}{route && <button type="button" className="ghost-action" onClick={() => void refreshSource()} disabled={saving || refreshing}>Обновить источник</button>}<button type="button" className="primary-action" onClick={() => void persist()} disabled={!route || saving || !dirty || stale || refreshing}>Сохранить</button>{onClose && <button type="button" className="ghost-action" disabled={refreshing || photoBusy} onClick={async () => { if (await guard()) onClose(); }}>Выйти</button>}</div>
    </header>
    {error && <p className="manufacturing-route-error" role="alert">{error}</p>}
    {sourcePreview && <section className="route-rebase-preview" aria-label="Изменения исходного жгута"><div><span className="route-alert-icon">!</span><div><h3>Изменения исходного жгута</h3><p>Добавлено объектов: {sourcePreview.preview.added.length}. Удалено: {sourcePreview.preview.removed.length}. Строки, операции и комментарии сохранятся, но их потребуется проверить.</p></div></div>{sourcePreview.preview.removed.length > 0 && <ul>{sourcePreview.preview.removed.map(ref => <li key={sourceKey(ref)}>Удалена связь: {sources.find(item => sourceKey(item.ref) === sourceKey(ref))?.title ?? ref.id} ({sourceLabel(ref)})</li>)}</ul>}<div className="route-rebase-actions"><button type="button" className="primary-action" onClick={() => { resourceRef.current = sourcePreview.resource; setResource(sourcePreview.resource); setSources(buildRouteSourceItems(sourcePreview.resource.content)); markRoute(sourcePreview.preview.route); setSourcePreview(null); }}>Применить изменения</button><button type="button" onClick={() => setSourcePreview(null)}>Отмена</button></div></section>}
    {stale && <p className="manufacturing-route-error" role="alert">Исходный жгут изменился. Обновите источник, затем проверьте состав, операции и представления строк. Редактирование приостановлено.</p>}
    {!route ? <div className="manufacturing-route-empty"><div className="route-empty-illustration" aria-hidden="true"><span /><span /><span /><i /></div><div><p className="eyebrow">ШАГ 1 ИЗ 3</p><h3>Создайте маршрут из чертежа</h3><p>Провода, кабели и покрытия станут исходными полуфабрикатами. После этого их можно объединять в производственные этапы и добавлять сборочные операции.</p><button type="button" className="primary-action" onClick={() => void generate()} disabled={!resource || refreshing}>{refreshing ? "Создаём маршрут…" : "Создать маршрут"}</button>{!resource && <button type="button" onClick={() => void load()}>Повторить загрузку</button>}</div></div> : <>
      <section className="route-summary" aria-label="Сводка маршрута"><div className="route-summary-item"><span>Этапы</span><strong>{route.rows.length}</strong><small>строк маршрута</small></div><div className="route-summary-item"><span>Готовность</span><strong>{preparedCount}<em>/{route.rows.length}</em></strong><small>подготовлено</small></div><div className="route-summary-item"><span>Объекты</span><strong>{introducedCount}</strong><small>введено в маршрут</small></div><div className="route-summary-item"><span>Время</span><strong>{formatMinutes(totalMinutes)}</strong><small>на партию</small></div><div className="route-summary-progress"><div><span>Готовность маршрута</span><strong>{route.rows.length ? Math.round(preparedCount / route.rows.length * 100) : 0}%</strong></div><div className="route-progress-track"><span style={{ width: `${route.rows.length ? preparedCount / route.rows.length * 100 : 0}%` }} /></div><small>{completed ? "Маршрут закрыт для производства" : "Подготовьте строки и закрепите операции"}</small></div></section>
      <div className="manufacturing-route-toolbar"><div><button type="button" className="toolbar-button" onClick={merge} disabled={selectedRows.length < 2 || stale || refreshing || !!sourcePreview || completed}>Объединить выбранные <span>{selectedRows.length || ""}</span></button><button type="button" className="toolbar-button" onClick={addAssembly} disabled={!selectedSources.length && !selectedRows.length || stale || refreshing || !!sourcePreview || completed}>+ Добавить сборку</button></div><span>{route.rows.length} {route.rows.length === 1 ? "этап" : "этапов"} · выбрано {selectedRows.length}</span></div>
      <div className="manufacturing-route-body"><section className="manufacturing-route-table-card"><div className="route-table-heading"><div><h3>Этапы производства</h3><p>Одна строка — один полуфабрикат или группа операций, выполняемых одновременно.</p></div><div className="route-table-legend"><span className="legend-dot prepared" /> подготовлено <span className="legend-dot draft" /> требует действий</div></div><div className="route-table" role="table" aria-label="Этапы производственного маршрута"><div className="route-table-header" role="row"><span>№</span><span>Индекс и полуфабрикат</span><span>Кол-во</span><span>Операции</span><span>Время</span><span>Рисунок</span><span>Фото</span><span>Статус</span></div>{route.rows.map((row, index) => { const rowItems = routeRowComposition(route, row.id).map(ref => sources.find(item => sourceKey(item.ref) === sourceKey(ref))).filter((item): item is RouteSourceItem => Boolean(item)); return <article className={`route-table-row ${selectedRowId === row.id ? "selected" : ""}`} key={row.id} role="row" onClick={() => setSelectedRowId(row.id)}>
        <label className="route-row-number"><input type="checkbox" aria-label={`Выбрать ${row.title}`} checked={selectedRows.includes(row.id)} onChange={() => toggle(selectedRows, row.id, setSelectedRows)} /><span>{String(index + 1).padStart(2, "0")}</span></label>
        <div className="route-table-title"><button type="button" onClick={() => setEditingRowId(row.id)} disabled={stale || refreshing || !!sourcePreview || completed}>{row.title}</button><div><span className={`route-kind ${row.kind}`}>{row.kind === "assembly" ? "СБОРКА" : "ПФ"}</span><small>{row.index ?? `ПФ-${String(index + 1).padStart(2, "0")}`} · {rowItems.length} объектов</small></div>{row.dependsOn.length > 0 && <small className="route-dependency">После этапов {row.dependsOn.map(id => route.rows.findIndex(candidate => candidate.id === id) + 1).join(", ")}</small>}</div>
        <div className="route-table-quantity"><strong>{row.quantity ?? resource?.harnessQuantity ?? 1}</strong><span>+ {row.reserve ?? 0} запас</span></div>
        <div className="route-table-operations">{row.operations.length ? row.operations.slice(0, 2).map(operation => <span className={operation.binding ? "operation-chip bound" : "operation-chip"} key={operation.id}>{operation.binding?.displayName ?? operationModes[operation.mode]}</span>) : <span className="route-muted">Не назначены</span>}{row.operations.length > 2 && <small>+{row.operations.length - 2}</small>}</div>
        <div className="route-table-time">{formatMinutes(row.operationTimeMinutes ?? 0)}</div><RouteRowThumbnail row={row} items={rowItems} /><div className="route-table-photos">{row.photos?.length ? <><span className="photo-count">{row.photos.length}</span><small>фото</small></> : <span className="route-muted">—</span>}</div><span className={row.prepared ? "route-ready" : "route-draft"}>{row.prepared ? "Готово" : "Черновик"}</span>
      </article>; })}{!route.rows.length && <div className="route-table-empty">Добавьте первый этап из списка объектов справа.</div>}</div></section>
      <aside className="manufacturing-route-sources"><div className="route-aside-heading"><div><h3>Объекты чертежа</h3><p>Свободные элементы для следующей сборки.</p></div><span>{availableAssemblySources.length}</span></div><div className="route-source-list">{availableAssemblySources.map(item => <label key={sourceKey(item.ref)} className="route-source-check"><input type="checkbox" checked={selectedSources.includes(sourceKey(item.ref))} onChange={() => toggle(selectedSources, sourceKey(item.ref), setSelectedSources)} /><span className="source-type-icon">{item.ref.kind === "wire" ? "W" : item.ref.kind === "connector" ? "X" : item.ref.kind === "cable" ? "C" : "○"}</span><span><strong>{item.title}</strong><small>{sourceLabel(item.ref)} · {item.lengthMm == null ? "геометрия" : `${item.lengthMm} мм`}</small></span></label>)}{!availableAssemblySources.length && <p className="route-aside-empty">Все источники уже введены. Новая сборка может объединить выбранные этапы.</p>}</div><div className="route-aside-footer"><span>Фон чертежа в редакторе строки</span><span className="opacity-key">10–50%</span></div></aside></div>
    </>}
    {selectedRow && route && resource && <RouteRowEditor key={selectedRow.id} config={config} session={session} projectId={projectId} photoBusy={photoBusy} setPhotoBusy={setPhotoBusy} row={selectedRow} route={route} document={resource.content} sources={sources} update={patch => updateRow(selectedRow.id, patch)} close={async () => { if (!photoBusy && await persist()) setEditingRowId(null); }}
      operationSources={operationSources} operationSourceId={operationSourceId} setOperationSourceId={setOperationSourceId} operationPage={operationPage} operationQuery={operationQuery} setOperationQuery={setOperationQuery} catalogError={catalogError} catalogLoading={catalogLoading} saveError={error} />}
  </section>;
}

function operationLabel(record: ReferenceCatalogRecord): string {
  for (const key of ["name", "operationName", "displayName", "title"]) if (typeof record.payload[key] === "string" && record.payload[key].trim()) return record.payload[key].trim();
  return record.sourceKey;
}

function RouteRowEditor({ config, session, projectId, photoBusy, setPhotoBusy, row, route, document, sources, update, close, operationSources, operationSourceId, setOperationSourceId, operationPage, operationQuery, setOperationQuery, catalogError, catalogLoading, saveError }: {
  config: RuntimeConfig; session: LocalSession; projectId: string; photoBusy: boolean; setPhotoBusy: (busy: boolean) => void;
  row: RouteRow; route: ManufacturingRoute; document: HarnessDesignDocument; sources: readonly RouteSourceItem[]; update: (patch: Partial<Omit<RouteRow, "id">>) => void; close: () => void;
  operationSources: readonly ReferenceCatalogSourceSummary[]; operationSourceId: string; setOperationSourceId: (id: string) => void; operationPage: ReferenceCatalogSearchPage | null; operationQuery: string; setOperationQuery: (value: string) => void; catalogError: string | null; catalogLoading: boolean; saveError: string | null;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState(row.title);
  const [index, setIndex] = useState(row.index ?? "");
  const [quantity, setQuantity] = useState(String(row.quantity ?? 1));
  const [reserve, setReserve] = useState(String(row.reserve ?? 0));
  const [operationTimeMinutes, setOperationTimeMinutes] = useState(String(row.operationTimeMinutes ?? 0));
  const [operationId, setOperationId] = useState(row.operations[0]?.id ?? "");
  const [mode, setMode] = useState<RouteOperation["mode"]>(row.kind === "assembly" ? "assembly" : "cut");
  useEffect(() => { dialog.current?.showModal(); }, []);
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
  const commitTitle = () => { if (title.trim()) { if (title.trim() !== row.title) update({ title: title.trim() }); } else setTitle(row.title); };
  const numberValue = (value: string, fallback: number, min: number) => { const parsed = Number(value.replace(",", ".")); return Number.isFinite(parsed) && parsed >= min ? Math.min(parsed, 1_000_000_000) : fallback; };
  const commitIdentity = () => update({ index: index.trim(), quantity: numberValue(quantity, row.quantity ?? 1, 1), reserve: numberValue(reserve, row.reserve ?? 0, 0), operationTimeMinutes: numberValue(operationTimeMinutes, row.operationTimeMinutes ?? 0, 0) });
  return <dialog ref={dialog} className="manufacturing-route-dialog" aria-label="Редактор строки маршрута" onCancel={event => { event.preventDefault(); if (!photoBusy) { commitTitle(); close(); } }}>
    <header><div><p className="eyebrow">ЭТАП {row.kind === "assembly" ? "СБОРКА" : "ПОЛУФАБРИКАТ"}</p><h3>{row.title}</h3><p className="route-editor-subtitle">Настройте идентификацию, представление и операции этапа.</p></div><button type="button" className="ghost-action" disabled={photoBusy} onClick={() => { commitIdentity(); close(); }}>Выйти</button></header>
    {saveError && <p className="manufacturing-route-error" role="alert">{saveError}</p>}
    <section className="route-editor-identity"><div className="route-editor-fields"><label>Индекс полуфабриката<input aria-label="Индекс полуфабриката" maxLength={128} value={index} onChange={event => setIndex(event.target.value)} onBlur={commitIdentity} placeholder="ПФ-01" /></label><label>Название этапа<input aria-label="Название строки" maxLength={512} value={title} onChange={event => setTitle(event.target.value)} onBlur={commitTitle} /></label><label>Кол-во к выполнению<div className="route-number-input"><input aria-label="Количество к выполнению" inputMode="numeric" value={quantity} onChange={event => setQuantity(event.target.value)} onBlur={commitIdentity} /><span>шт.</span></div></label><label>Запас<div className="route-number-input"><input aria-label="Количество запас" inputMode="numeric" value={reserve} onChange={event => setReserve(event.target.value)} onBlur={commitIdentity} /><span>шт.</span></div></label><label>Время операции<div className="route-number-input"><input aria-label="Время операции" inputMode="decimal" value={operationTimeMinutes} onChange={event => setOperationTimeMinutes(event.target.value)} onBlur={commitIdentity} /><span>мин</span></div></label><label className="route-comment-field">Комментарий технолога<textarea aria-label="Комментарий строки" maxLength={4000} value={row.comment} onChange={event => update({ comment: event.target.value })} /></label></div></section>
    <section className="route-editor-block"><div className="route-editor-block-heading"><div><h4>Представление этапа</h4><p>Исходный чертёж остаётся фоном с прозрачностью 10–50%. Перетаскивайте маркеры, чтобы показать результат операции.</p></div><span className="route-editor-block-tag">ЧЕРТЁЖ</span></div><RoutePresentation row={row} document={document} sources={sources} items={items} update={update} /></section>
    {conflicts.length > 0 && <section className="manufacturing-route-error" role="alert"><strong>Разные представления общего объекта</strong><p>Задайте представление объекта в этой строке, чтобы согласовать результат сборки.</p>{conflicts.map(conflict => <div key={sourceKey(conflict.ref)}><span>{items.find(item => sourceKey(item.ref) === sourceKey(conflict.ref))?.title}</span>{conflict.variants.map(variant => <button key={variant.rowId} type="button" onClick={() => update({ presentation: { ...row.presentation, objects: [...row.presentation.objects.filter(object => sourceKey(object.ref) !== sourceKey(conflict.ref)), variant.object] } })}>Взять из «{route.rows.find(row => row.id === variant.rowId)?.title}»</button>)}</div>)}</section>}
    {items.some(item => item.ref.kind === "wire") && <section className="route-terminal-requirements"><h4>Зачистка по терминалам</h4><table><thead><tr><th>Провод</th><th>Конец</th><th>Терминал</th><th>Длина зачистки</th></tr></thead><tbody>{items.filter(item => item.ref.kind === "wire").flatMap(item => (["from", "to"] as const).map(end => { const requirement = requirements.find(value => value.wireId === item.ref.id && value.end === end); return <tr key={`${item.ref.id}:${end}`}><td>{item.title}</td><td>{end === "from" ? "Начало" : "Конец"}</td><td>{requirement?.terminalArticle || (end === "from" ? item.terminalFrom : item.terminalTo) || "Не назначен"}</td><td>{requirement?.stripLengthMm == null ? "Неизвестно · норма не закреплена" : `${requirement.stripLengthMm} мм`}</td></tr>; }))}</tbody></table></section>}
    <section className="route-operations route-editor-block"><div className="route-editor-block-heading"><div><h4>Технические операции</h4><p>Выберите нужные операции из БД.ОП. Несколько строк можно объединить для одновременной обработки.</p></div><span className="route-editor-block-tag">БД.ОП</span></div><div className="route-operation-add"><label>Добавить режим<select aria-label="Режим новой операции" value={mode} onChange={event => setMode(event.target.value as RouteOperation["mode"])}>{routeOperationModes.map(mode => <option key={mode} value={mode}>{operationModes[mode]}</option>)}</select></label><button type="button" className="secondary-action" onClick={addOperation}>+ Добавить операцию</button></div>
      {row.operations.map((operation, index) => <div className={`route-operation-row ${operationId === operation.id ? "selected" : ""}`} key={operation.id}><label><input type="radio" name="route-operation" aria-label={`Выбрать операцию ${index + 1}`} checked={operationId === operation.id} onChange={() => setOperationId(operation.id)} />{index + 1}</label><select aria-label={`Режим операции ${index + 1}`} value={operation.mode} onChange={event => changeOperation(operation.id, { mode: event.target.value as RouteOperation["mode"] })}>{routeOperationModes.map(mode => <option key={mode} value={mode}>{operationModes[mode]}</option>)}</select><span>{operation.binding?.displayName ?? "Выберите запись БД.ОП ниже"}</span><input aria-label={`Примечание операции ${index + 1}`} maxLength={4000} placeholder="Примечание к операции" value={operation.note} onChange={event => changeOperation(operation.id, { note: event.target.value })} /><button type="button" onClick={() => update({ operations: row.operations.filter(item => item.id !== operation.id) })}>Удалить</button></div>)}
      {row.operations.length > 0 && <div className="route-operation-binding"><h4>БД.ОП · закрепить за выбранной операцией</h4><div><label>Справочник<select aria-label="Справочник операций" value={operationSourceId} onChange={event => setOperationSourceId(event.target.value)}>{operationSources.map(source => <option key={source.sourceId} value={source.sourceId}>{source.displayName}</option>)}</select></label><label>Поиск<input aria-label="Поиск БД.ОП" placeholder="Обозначение или название" value={operationQuery} onChange={event => setOperationQuery(event.target.value)} /></label></div>{catalogLoading && <p role="status">Поиск операций…</p>}{catalogError && <p role="alert">{catalogError}</p>}{!operationSources.length && <p>Загрузите БД.ОП в разделе «Справочники».</p>}<div className="route-operation-results">{operationPage?.items.map(record => <button type="button" key={record.recordId} disabled={!row.operations.some(operation => operation.id === operationId)} onClick={() => bind(record)}><strong>{operationLabel(record)}</strong><small>{record.sourceKey}</small></button>)}{operationPage && !operationPage.items.length && <p>Операции не найдены.</p>}{operationPage?.nextCursor && <p>Уточните поиск, чтобы увидеть другие записи.</p>}</div></div>}
    </section><section className="route-editor-block route-photo-block"><div className="route-editor-block-heading"><div><h4>Фото этапа</h4><p>Перетащите сюда несколько фотографий. Первое фото используется как основное.</p></div><span className="route-editor-block-tag">МЕДИА</span></div><RoutePhotoList config={config} session={session} projectId={projectId} photos={row.photos} onChange={photos => update({ photos })} onBusyChange={setPhotoBusy} /></section><footer><label><input type="checkbox" checked={row.prepared} onChange={event => update({ prepared: event.target.checked })} />Этап подготовлен к производству</label><span>Изменения сохраняются автоматически · {row.operations.length} операций · {formatMinutes(row.operationTimeMinutes ?? 0)} на единицу</span></footer>
  </dialog>;
}

function RoutePresentation({ row, document, sources, items, update }: { row: RouteRow; document: HarnessDesignDocument; sources: readonly RouteSourceItem[]; items: readonly RouteSourceItem[]; update: (patch: Partial<Omit<RouteRow, "id">>) => void }) {
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
  return <section className="route-presentation-section"><div className="route-presentation-toolbar"><h4>Представление строки</h4><label>Фон жгута<input type="range" aria-label="Непрозрачность фона жгута" min={.1} max={.5} step={.05} value={row.presentation.backgroundOpacity} onChange={event => presentation(objects, Number(event.target.value))} /></label><button type="button" onClick={() => presentation(items.map(item => ({ ref: item.ref, points: objectPoints(document, item.ref).length ? [...objectPoints(document, item.ref)] : [{ x: 140, y: 100 }, { x: 620, y: 100 }], hidden: false })))}>Взять геометрию жгута</button><button type="button" disabled={!selected} onClick={() => presentation(objects.map(object => sourceKey(object.ref) === selected ? { ...object, points: object.points.length > 1 ? [object.points[0]!, { x: (object.points[0]!.x + object.points.at(-1)!.x) / 2, y: object.points[0]!.y + 50 }, object.points.at(-1)!] : object.points } : object))}>Добавить изгиб</button></div>
    <p>Выберите объект и перетащите круглые маркеры. Длина резки остаётся заданной в жгуте.</p>
    <svg ref={svg} className="route-presentation" viewBox={`${x} ${y} ${width} ${height}`} role="img" aria-label="Редактируемое представление строки" onPointerMove={event => { if (!drag.current) return; const point = eventPoint(event); if (point) presentation(objects.map(object => sourceKey(object.ref) === drag.current!.key ? { ...object, points: object.points.map((value, index) => index === drag.current!.index ? point : value) } : object)); }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
      <g opacity={row.presentation.backgroundOpacity} transform={`translate(${x + 60} ${y + 40}) scale(${scale}) translate(${-minX} ${-minY})`} pointerEvents="none">{background.map(({ item, points }) => item.ref.kind === "connector" ? <rect key={sourceKey(item.ref)} x={points[0]!.x - 12} y={points[0]!.y - 12} width={24} height={24} fill="#536879" /> : <polyline key={sourceKey(item.ref)} points={points.map(p => `${p.x},${p.y}`).join(" ")} fill="none" stroke={item.color ?? "#536879"} strokeWidth={3 / scale} />)}</g>
      {objects.map(object => { const key = sourceKey(object.ref), item = items.find(item => sourceKey(item.ref) === key)!, start = object.points[0], end = object.points.at(-1); if (object.hidden || !start || !end) return null; return <g key={key} className={selected === key ? "route-svg-object selected" : "route-svg-object"} onClick={() => setSelected(key)}><title>{item.title}</title>{object.ref.kind === "connector" ? <rect x={start.x - 20} y={start.y - 20} width={40} height={40} rx={5} fill="#fff" stroke="#295770" strokeWidth={3} /> : <><polyline points={object.points.map(p => `${p.x},${p.y}`).join(" ")} fill="none" stroke="#243746" strokeWidth={8} /><polyline points={object.points.map(p => `${p.x},${p.y}`).join(" ")} fill="none" stroke={item.color ?? "#d3dbe0"} strokeWidth={5} />{item.terminalFrom && <rect x={start.x - 14} y={start.y - 8} width={24} height={16} fill="#b2bac0" stroke="#455762" />}{item.terminalTo && <rect x={end.x - 10} y={end.y - 8} width={24} height={16} fill="#b2bac0" stroke="#455762" />}</>}
        <text x={start.x} y={start.y - 28}>{item.title}</text><text x={start.x} y={start.y + 30}>{[item.lengthMm === null ? "" : `${item.lengthMm} мм`, item.material, item.section ? `${item.section} мм²` : ""].filter(Boolean).join(" · ")}</text>{item.terminalFrom && <text x={start.x - 15} y={start.y + 49}>{item.terminalFrom}</text>}{item.terminalTo && <text x={end.x - 15} y={end.y + 49}>{item.terminalTo}</text>}
        {object.points.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r={7} className="route-point-handle" aria-label={`Точка ${index + 1} ${item.title}`} onPointerDown={event => { event.preventDefault(); event.stopPropagation(); setSelected(key); drag.current = { key, index }; svg.current?.setPointerCapture(event.pointerId); }} />)}
      </g>; })}
    </svg>
    <ul className="route-source-details">{items.map(item => <li key={sourceKey(item.ref)}><strong>{item.title}</strong><span>{item.cableId ? "Жила кабеля · отдельный расход не суммируется" : ""}</span>{item.stripProfiles && <span>Разделка: {item.stripProfiles.from?.displayName ?? "—"} / {item.stripProfiles.to?.displayName ?? "—"}</span>}</li>)}</ul>
  </section>;
}

