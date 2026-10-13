import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type PointerEvent } from "react";
import type { HarnessDesignDocument } from "../editor/model";
import type { LocalSession } from "../local-session";
import type { RuntimeConfig } from "../runtime-config";
import { createReferenceCatalogApi, type ReferenceCatalogRecord, type ReferenceCatalogSnapshot, type ReferenceCatalogSourceSummary } from "../reference-catalog-api";
import { buildRouteSourceItems, routeSourceDesignation, type RouteSourceItem } from "../manufacturing/route-source";
import { wireSemiFinishedProperties } from "../manufacturing/cut-list-properties";
import { wireBlankEnds, wireBlankEndLabels } from "../WireBlankCatalog";
import { routeV3WireArtwork, routeV3WireMaterial } from "./route-v3-wire-artwork";
import { formatWireTerminalPair } from "../manufacturing/wire-display-formatters";
import { refKey, resetRouteV3WireArtwork, routeV3AssignedProductIds, routeV3BatchQuantity, routeV3ConnectionPort, routeV3GroupedSourceQuantity, routeV3NodeSize, routeV3OperationFromCatalog, routeV3OperationProjectTimes, routeV3Products, routeV3ResizeLayout, routeV3SourceGroupKey, routeV3WireArtworkOverride, setRouteV3WireArtworkOverride, assignRouteV3OperationProducts, type RouteV3Document, type RouteV3Node, type RouteV3Operation } from "./route-v3-model";
import { connectRouteV3, deleteRouteV3Edge, deleteRouteV3Node, insertRouteV3Node, refreshRouteV3, routeV3EdgeInputRefs, setRouteV3EdgeInputRefs } from "./route-v3-graph";
import { routeV3IsCutCard, routeV3ProcessedQuantity } from "./route-v3-card-quantity";
import "./route-v3-graph.css";

function Modal({ label, close, children }: { label: string; close: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const el = ref.current; el?.showModal(); return () => el?.close(); }, []);
  return <dialog ref={ref} className="route-v3-dialog route-v3-card-dialog" aria-label={label} onCancel={e => { e.preventDefault(); close(); }}>{children}</dialog>;
}
type Props = { graph: RouteV3Document; source: HarnessDesignDocument; config: RuntimeConfig; session: LocalSession; projectId: string; harnessId: string; harnessQuantity?: number; save: (doc: RouteV3Document) => void; artwork: (node: RouteV3Node) => ReactNode; preview: (node: RouteV3Node) => void; editDrawing: (node: RouteV3Node) => void };
const time = (n: number) => Math.round(n * 100) / 100;
const duration = (value: number | null) => value === null ? "Не задано" : value === 0 ? "0 с" : `${time(value * 60)} с`;
const catalogText = (record: ReferenceCatalogRecord, key: string) => typeof record.payload[key] === "string" ? String(record.payload[key]).trim() : "";
const categoryName = (record: ReferenceCatalogRecord) => catalogText(record, "operationType") || "Без типа";
const subcategoryName = (record: ReferenceCatalogRecord) => catalogText(record, "name") || catalogText(record, "machine") || catalogText(record, "instruction") || `Операция № ${record.sourceKey}`;

function OperationChooser({ category, setCategory, snapshot, loading, error, choose, close }: { category: string | null; setCategory: (value: string | null) => void; snapshot: ReferenceCatalogSnapshot | null; loading: boolean; error: string | null; choose: (record: ReferenceCatalogRecord) => void; close: () => void }) {
  const records = snapshot?.records.filter(record => record.entityType === "operation") ?? [];
  const groups = [...new Map(records.map(record => [categoryName(record), true])).keys()].sort((a, b) => a.localeCompare(b, "ru"));
  const choices = category ? records.filter(record => categoryName(record) === category) : records;
  const choiceWidth = Math.min(60, Math.max(20, ...choices.map(record => subcategoryName(record).length + 4)));
  return <Modal label="Выбор операции БД.ОП" close={close}>
    <header className="route-v3-preview-heading"><div><small>СПРАВОЧНИК БД.ОП</small><h3>Выберите операцию</h3></div><button type="button" onClick={close}>Закрыть</button></header>
    <label className="route-v3-chooser-filter">Тип операции<select value={category ?? ""} onChange={event => setCategory(event.target.value || null)}><option value="">Все типы</option>{groups.map(name => <option key={name} value={name}>{name}</option>)}</select></label>
    {loading && <p role="status">Загружаем БД.ОП…</p>}
    {error && <p role="alert" className="route-v3-error">{error}</p>}
    {!loading && !error && !snapshot && <p>Справочник БД.ОП недоступен.</p>}
    {!loading && !error && snapshot && !records.length && <p>В справочнике нет операций.</p>}
    <div className="route-v3-operation-choices" style={{ "--route-v3-choice-width": `${choiceWidth}ch` } as CSSProperties}>{choices.map(record => <button type="button" key={record.recordId} className="route-v3-operation-choice" onClick={() => choose(record)}><span className="route-v3-operation-choice-icon" aria-hidden="true">⚙</span><strong>{subcategoryName(record)}</strong><small>{categoryName(record)}</small></button>)}</div>
  </Modal>;
}

function Composition({ node, source, sources, graph, harnessQuantity, updateWireArtwork, resetWireArtwork, operations }: {
  node: RouteV3Node; source: HarnessDesignDocument; sources: readonly RouteSourceItem[]; graph: RouteV3Document; harnessQuantity: number;
  updateWireArtwork: (id: string, patch: { color?: string; start?: typeof wireBlankEnds[number]; end?: typeof wireBlankEnds[number] }) => void;
  resetWireArtwork: () => void; operations: ReactNode;
}) {
  const count = routeV3BatchQuantity(node, harnessQuantity);
  const processed = routeV3ProcessedQuantity(node, harnessQuantity);
  const cut = routeV3IsCutCard(node);
  const groups = new Map<string, typeof node.refs>();
  for (const ref of node.refs) { const key = routeV3SourceGroupKey(ref, source); groups.set(key, [...(groups.get(key) ?? []), ref]); }
  const rows = [...groups.values()].map(refs => ({ ref: refs[0]!, refs, item: sources.find(value => refKey(value.ref) === refKey(refs[0]!)) }));
  const wireRefs = node.refs.filter(ref => ref.kind === "wire");
  const operationTimes = (node.operations ?? []).map(operation => routeV3OperationProjectTimes(operation, node, source, harnessQuantity));
  const total = operationTimes.some(value => value.operationMinutes === null) ? null : operationTimes.reduce<number>((sum, value) => sum + value.operationMinutes!, 0);
  const projectTimes = operationTimes.map(value => value.projectMinutes);
  const projectTotal = projectTimes.some(value => value === null) ? null : projectTimes.reduce<number>((sum, value) => sum + value!, 0);
  const rowTime = rows.length === 1 ? total : null;
  const wireControls = (id: string) => {
    const appearance = routeV3WireArtwork(source, id, routeV3WireArtworkOverride(graph, id));
    if (!appearance) return null;
    return <div className="route-v3-composition-wire" key={id}><strong>{appearance.name}</strong><span>{appearance.mark} · {appearance.section} · {appearance.colorLabel} · {appearance.automatic ? "по Э4" : "ручной"}</span><label>Начало<select value={appearance.start} onChange={e => updateWireArtwork(id, { start: e.target.value as typeof appearance.start })}>{wireBlankEnds.map(value => <option key={value} value={value}>{wireBlankEndLabels[value]}</option>)}</select></label><label>Конец<select value={appearance.end} onChange={e => updateWireArtwork(id, { end: e.target.value as typeof appearance.end })}>{wireBlankEnds.map(value => <option key={value} value={value}>{wireBlankEndLabels[value]}</option>)}</select></label><label>Цвет<input type="color" aria-label={`Цвет ${id}`} value={appearance.color} onChange={e => updateWireArtwork(id, { color: e.target.value })} /></label></div>;
  };
  return <section className="route-v3-composition route-v2-settings-section" aria-label="Состав карточки">
    <div className="route-v3-section-heading"><div><h4>Состав карточки · {node.refs.length}</h4><p>{cut ? `Резка: ${node.refs.length} заготовки на жгут × ${count} жгут(а) = ${processed} заготовок на партию.` : `Партия: ${count} жгут(а). Количества и время пересчитываются для партии.`}</p></div>{wireRefs.length > 0 && <button className="secondary-action" type="button" onClick={resetWireArtwork} title="Сбросит ручной вид проводов и возьмёт его из Э4">Обновить вид проводов по Э4</button>}</div>
    <div className="route-v3-composition-table"><table aria-label="Полуфабрикаты карточки"><thead><tr><th>Объект</th><th>Материал</th><th>Длина</th><th>Концы и разделка</th><th>Кол-во на ПФ</th><th>Кол-во на партию</th><th>Время на операцию</th><th>Время на партию</th></tr></thead><tbody>
      {rows.map(({ ref, refs, item }, index) => {
        const quantity = routeV3GroupedSourceQuantity(ref, node.refs, source, count);
        const wireProperties = ref.kind === "wire" ? wireSemiFinishedProperties(source, ref.id) : null;
        return <Fragment key={refKey(ref)}><tr><td data-label="Объект"><strong>ПФ-{String(index + 1).padStart(2, "0")}</strong><span>{ref.kind === "wire" ? wireProperties?.name ?? "Провод" : item?.title ?? ref.id}{refs.length > 1 ? ` · ${refs.length} одинаковых` : ""}</span></td><td data-label="Материал">{item ? (ref.kind === "wire" ? routeV3WireMaterial(source, ref.id) : routeSourceDesignation(item)) : "Объект отсутствует в чертеже"}</td><td data-label="Длина">{item?.lengthMm == null ? "—" : `${item.lengthMm} мм`}</td><td data-label="Концы и разделка">{ref.kind === "wire" ? formatWireTerminalPair(wireProperties?.terminalFrom ?? "", wireProperties?.terminalTo ?? "") : "—"}</td><td data-label="Кол-во на ПФ">{ref.kind === "wire" || ref.kind === "covering" ? "—" : `${quantity.perSemiFinished} шт.`}</td><td data-label="Кол-во на партию">{quantity.perBatch} шт.</td><td data-label="Время на операцию">{rowTime === null || !node.operations?.length ? "—" : `${time(rowTime)} мин`}</td><td data-label="Время на партию">{rowTime === null || projectTotal === null || !node.operations?.length ? "—" : `${time(projectTotal)} мин`}</td></tr>{(ref.kind === "wire" || refs.length > 1) && <tr className="route-v3-composition-detail-row"><td colSpan={8}><details className="route-v3-composition-detail"><summary>{ref.kind === "wire" ? `Вид проводов · ${refs.length}` : `Исходные оболочки · ${refs.length}`}</summary>{ref.kind === "wire" ? <div className="route-v3-composition-wire-list">{refs.map(value => wireControls(value.id))}</div> : <p>{refs.map(value => value.id).join(", ")}</p>}</details></td></tr>}</Fragment>;
      })}
      {!rows.length && <tr><td colSpan={8} className="route-v3-composition-empty">Состав пуст. Выберите сырьё и полуфабрикаты ниже.</td></tr>}
      {!!node.operations?.length && rows.length > 1 && <tr className="route-v3-composition-total"><td colSpan={6}>{cut ? `Итого резка ${processed} заготовок.` : "Операции карточки применяются к составу целиком; время отдельных материалов не распределено."}</td><td data-label="Время на операцию">{total === null ? "Не задано" : `${time(total)} мин`}</td><td data-label="Время на партию">{projectTotal === null ? "Не задано" : `${time(projectTotal)} мин`}</td></tr>}
      {cut && <tr className="route-v3-composition-operations"><td colSpan={8}>{operations}</td></tr>}
    </tbody></table></div>
  </section>;
}

function Operations({ node, source, harnessQuantity, batchQuantity, add, choose, update, assign, remove }: {
  node: RouteV3Node; source: HarnessDesignDocument; harnessQuantity: number; batchQuantity: number; add: () => void; choose: (id: string) => void;
  assign: (id: string, productIds: readonly string[]) => void;
  update: (id: string, patch: Partial<RouteV3Operation>) => void; remove: (id: string) => void;
}) {
  const operations = node.operations ?? [];
  const products = routeV3Products(node);
  const sourceItems = useMemo(() => buildRouteSourceItems(source), [source]);
  const productLabel = (ref: RouteV3Node["refs"][number] | undefined): string => {
    if (!ref) return node.title;
    const item = sourceItems.find(value => refKey(value.ref) === refKey(ref));
    return item ? [item.title, routeSourceDesignation(item), item.lengthMm === null ? "" : `${item.lengthMm} мм`].filter(Boolean).join(" · ") : ref.id;
  };
  const wireCut = routeV3IsCutCard(node) && node.refs.every(ref => ref.kind === "wire");
  return <section className="route-v3-operations" aria-label="Операции карточки">
    <div className="route-v3-section-heading"><div><h4>Операции · {operations.length}</h4><p>Нормы закрепляются из БД.ОП и рассчитываются на {batchQuantity} {routeV3IsCutCard(node) ? "заготовок" : "шт."}.</p></div><button type="button" className="secondary-action" onClick={add}>+ Добавить операцию</button></div>
    {!operations.length && <p className="route-v3-operation-empty">Операции не назначены.</p>}
    {operations.map((operation, index) => { const times = routeV3OperationProjectTimes(operation, node, source, harnessQuantity); const assigned = routeV3AssignedProductIds(node, operation); return <article className="route-v3-operation-row" key={operation.id}>
      <div className="route-v3-operation-main"><span className="route-v3-operation-index">{index + 1}</span><button type="button" className="route-v3-operation-title" aria-label={`Выбрать название операции ${index + 1}`} onClick={() => choose(operation.id)}><strong>{operation.title}</strong><small className="route-v3-operation-kind">{operation.catalogOperationType || (operation.kind === "running" ? "Погонная" : "Статичная")}</small><small>{operation.catalogBinding ? `БД.ОП № ${operation.catalogBinding.sourceKey} · ${operation.category ?? "Категория не указана"}` : "Выбрать из БД.ОП"}</small></button><button type="button" className="route-v3-operation-remove" aria-label={`Удалить операцию ${operation.title}`} onClick={() => remove(operation.id)}>×</button></div>
      <div className="route-v3-operation-parameters">{operation.kind === "running" && <label>Длина L, мм<input aria-label={`Длина операции ${index + 1}`} type="number" min="0" value={operation.lengthMm} onChange={event => update(operation.id, { lengthMm: Math.max(0, Number(event.target.value) || 0) })} /></label>}{wireCut && <label>Параллельно, шт.<input aria-label={`Параллельная ёмкость операции ${index + 1}`} type="number" min="1" step="1" value={operation.parallelCapacity ?? 1} onChange={event => update(operation.id, { parallelCapacity: Math.max(1, Math.floor(Number(event.target.value) || 1)) })} /></label>}<span><small>Время машины</small><strong>{duration(times.machineMinutes)}</strong></span><span><small>Время человека</small><strong>{duration(times.humanMinutes)}</strong></span><span><small>Время доп.</small><strong>{operation.additionalTimeSeconds == null ? "Не задано" : `${time(operation.additionalTimeSeconds)} с`}</strong></span><span><small>На операцию</small><strong>{duration(times.operationMinutes)}</strong></span><span><small>На партию</small><strong>{duration(times.batchMinutes)}</strong></span></div>
      {routeV3IsCutCard(node) && products.length > 1 && <fieldset className="route-v3-operation-products"><legend>Продукция операции</legend>{products.map(product => { const label = productLabel(product.ref); return <label key={product.id}><input type="checkbox" aria-label={`Продукция ${label} для операции ${index + 1}`} checked={assigned.includes(product.id)} onChange={event => assign(operation.id, event.target.checked ? [...assigned, product.id] : assigned.filter(id => id !== product.id))} /><span title={label}>{label}</span></label>; })}</fieldset>}
      <p className="route-v3-operation-summary">На проект: <strong>{duration(times.projectMinutes)}</strong> · Циклы: {times.cycles ?? "—"} · Подготовка: {times.setupMinutes === null ? "Не задано" : duration(times.setupMinutes)} · Продукция: {assigned.length ? assigned.length : products.length === 1 ? "авто" : "не назначена"}</p>
      {operation.kind === "running" && <p className="route-v3-operation-formula">Погонная: скорость проката × L + время инструмента × количество операций + время доп.</p>}
    </article>; })}
  </section>;
}

function IncomingInputs({ graph, node, sources, query, setInputRefs }: { graph: RouteV3Document; node: RouteV3Node; sources: readonly RouteSourceItem[]; query: string; setInputRefs: (edgeId: string, refs: RouteV3Node["refs"]) => void }) {
  const edges = graph.edges.filter(edge => edge.to === node.id);
  return <div className="route-v3-input-edge-list">{edges.map(edge => {
    const parent = graph.nodes.find(value => value.id === edge.from);
    if (!parent) return null;
    const refs = routeV3EdgeInputRefs(graph, edge.id);
    const products = routeV3Products(parent);
    return <fieldset className="route-v3-input-edge" key={edge.id}><legend>{parent.title}</legend><div className="route-v3-input-ref-list">{products.filter(product => {
      const item = product.ref && sources.find(value => refKey(value.ref) === refKey(product.ref!));
      return !query || `${item?.title ?? product.ref?.id ?? parent.title} ${item ? routeSourceDesignation(item) : ""}`.toLocaleLowerCase().includes(query.toLocaleLowerCase());
    }).map(product => {
      const productRefs = product.ref ? [product.ref] : parent.refs;
      const checked = productRefs.length > 0 && productRefs.every(ref => refs.some(value => refKey(value) === refKey(ref)));
      const item = product.ref && sources.find(value => refKey(value.ref) === refKey(product.ref!));
      return <label className="route-v2-ref-choice" key={product.id}><input type="checkbox" aria-label={`Включить ${item?.title ?? product.ref?.id ?? parent.title} из ${parent.title}`} checked={checked} onChange={event => {
        const selected = new Map(refs.map(ref => [refKey(ref), ref]));
        for (const ref of productRefs) event.target.checked ? selected.set(refKey(ref), ref) : selected.delete(refKey(ref));
        setInputRefs(edge.id, [...selected.values()]);
      }} /><span><strong>{item?.title ?? product.ref?.id ?? parent.title}</strong><small>{item ? `${routeSourceDesignation(item)}${item.lengthMm == null ? "" : ` · ${item.lengthMm} мм`}` : `Собранный ПФ · ${productRefs.length} компонентов`}</small></span></label>;
    })}</div></fieldset>;
  })}{!edges.length && <p>Подключите входящую карточку стрелкой.</p>}</div>;
}

export function RouteV3Graph({ graph, source, config, session, harnessQuantity = 1, save, artwork, preview, editDrawing }: Props) {
  const current = useRef(graph); current.current = graph;
  const canvas = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ id: string; mode: "move" | "resize"; x: number; y: number; a: number; b: number } | null>(null);
  const [selectedId, select] = useState<string | null>(null);
  const [link, setLink] = useState<{ id: string; x: number; y: number } | null>(null);
  const [deleting, setDeleting] = useState<{ kind: "node" | "edge"; id: string; title: string } | null>(null);
  const [error, setError] = useState("");
  const [query, search] = useState("");
  const [chooser, setChooser] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [catalogSourceId, setCatalogSourceId] = useState("");
  const [catalogSnapshot, setCatalogSnapshot] = useState<ReferenceCatalogSnapshot | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [resizeSnap, setResizeSnap] = useState<{ id: string; width: boolean; height: boolean } | null>(null);
  const catalogApi = useMemo(() => createReferenceCatalogApi(config, session), [config, session]);
  const selected = graph.nodes.find(n => n.id === selectedId);
  const sources = useMemo(() => buildRouteSourceItems(source), [source]);
  const projectMinutes = (node: RouteV3Node): number | null => {
    const values = (node.operations ?? []).map(operation => routeV3OperationProjectTimes(operation, node, source, harnessQuantity).projectMinutes);
    return values.some(value => value === null) ? null : values.reduce<number>((sum, value) => sum + value!, 0);
  };
  const routeMinutes = graph.nodes.map(projectMinutes);
  const routeTotal = routeMinutes.some(value => value === null) ? null : routeMinutes.reduce<number>((sum, value) => sum + value!, 0);
  useEffect(() => {
    if (!chooser) return;
    let cancelled = false;
    setCatalogLoading(true); setCatalogError(null);
    void catalogApi.listSources().then((items: readonly ReferenceCatalogSourceSummary[]) => {
      if (cancelled) return;
      const operationSources = items.filter(item => /опера|БД\.ОП|operation/i.test(`${item.sourceId} ${item.displayName}`));
      if (!operationSources.length) { setCatalogError("Справочник БД.ОП не опубликован."); setCatalogLoading(false); return; }
      setCatalogSourceId(operationSources[0]!.sourceId);
    }).catch(caught => { if (!cancelled) { setCatalogError(caught instanceof Error ? caught.message : "Не удалось открыть БД.ОП."); setCatalogLoading(false); } });
    return () => { cancelled = true; };
  }, [catalogApi, chooser]);
  useEffect(() => {
    if (!chooser || !catalogSourceId) return;
    let cancelled = false;
    setCatalogLoading(true); setCatalogError(null);
    void catalogApi.getActive(catalogSourceId).then(snapshot => { if (!cancelled) { setCatalogSnapshot(snapshot); setCatalogLoading(false); } })
      .catch(caught => { if (!cancelled) { setCatalogError(caught instanceof Error ? caught.message : "Не удалось загрузить операции."); setCatalogLoading(false); } });
    return () => { cancelled = true; };
  }, [catalogApi, catalogSourceId, chooser]);
  const change = (fn: (d: RouteV3Document) => RouteV3Document) => { try { const next = fn(current.current); save(next); current.current = next; setError(""); return true; } catch (e) { setError(e instanceof Error ? e.message : "Не удалось сохранить карточку."); return false; } };
  const update = (patch: Partial<RouteV3Node>) => change(d => refreshRouteV3({ ...d, nodes: d.nodes.map(n => ({ ...n, ...(n.id === selectedId ? patch : {}), operatorConfirmed: patch.operatorConfirmed === undefined ? false : n.id === selectedId ? patch.operatorConfirmed : n.operatorConfirmed })) }));
  const updateWireArtwork = (wireId: string, patch: { readonly color?: string; readonly start?: typeof wireBlankEnds[number]; readonly end?: typeof wireBlankEnds[number] }) => change(d => setRouteV3WireArtworkOverride(d, { ...(routeV3WireArtworkOverride(d, wireId) ?? { wireId }), ...patch, wireId }));
  const begin = (e: PointerEvent<HTMLButtonElement>, node: RouteV3Node, mode: "move" | "resize") => {
    if (e.button !== 0) return; e.preventDefault();
    const size = routeV3NodeSize(node);
    gesture.current = { id: node.id, mode, x: e.clientX, y: e.clientY, a: mode === "move" ? node.x : size.width, b: mode === "move" ? node.y : size.height };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const bounds = canvas.current?.getBoundingClientRect();
    if (link && bounds) setLink({ ...link, x: e.clientX - bounds.left, y: e.clientY - bounds.top });
    const g = gesture.current; if (!g) return;
    const a = g.a + e.clientX - g.x, b = g.b + e.clientY - g.y;
    if (g.mode === "move") {
      change(d => ({ ...d, nodes: d.nodes.map(n => n.id === g.id ? { ...n, x: Math.max(12, a), y: Math.max(12, b) } : n) }));
      return;
    }
    change(d => {
      const layout = routeV3ResizeLayout(d.nodes, g.id, a, b);
      setResizeSnap({ id: g.id, ...layout.snapped });
      return { ...d, nodes: layout.nodes };
    });
  };
  useEffect(() => { const cancel = (e: KeyboardEvent) => { if (e.key === "Escape") setLink(null); }; window.addEventListener("keydown", cancel); return () => window.removeEventListener("keydown", cancel); }, []);
  const plus = (id: string | null) => { const next = crypto.randomUUID(); if (change(d => insertRouteV3Node(d, id, next))) { setLink(null); } };
  const width = Math.max(940, ...graph.nodes.map(n => n.x + routeV3NodeSize(n).width + 64));
  const height = Math.max(580, ...graph.nodes.map(n => n.y + routeV3NodeSize(n).height + 80));
  const incoming = selected ? graph.edges.filter(e => e.to === selected.id).map(edge => ({ edge, node: graph.nodes.find(n => n.id === edge.from)! })) : [];
  const path = (from: { x: number; y: number }, to: { x: number; y: number }) => `M${from.x},${from.y} L${to.x},${to.y}`;
  const updateOperation = (id: string, patch: Partial<RouteV3Operation>) => update({ operations: selected?.operations?.map(o => o.id === id ? { ...o, ...patch } : o) });
  const assignOperationProducts = (id: string, productIds: readonly string[]) => { if (selected) update({ operations: assignRouteV3OperationProducts(selected, id, productIds) }); };
  const setInputRefs = (edgeId: string, refs: RouteV3Node["refs"]) => change(d => refreshRouteV3(setRouteV3EdgeInputRefs(d, edgeId, refs)));
  const addOperation = () => {
    if (!selected) return;
    const id = crypto.randomUUID();
    if (update({ operations: [...(selected.operations ?? []), { id, title: "Выберите операцию БД.ОП", kind: "static", lengthMm: 0, speedMmPerMinute: 1, employees: 1, quantity: 1, minutesEach: 0 }] })) {
      setChooser(id); setCategory(null); setCatalogSnapshot(null); setCatalogSourceId("");
    }
  };
  const chooseOperation = (record: ReferenceCatalogRecord) => {
    if (!chooser || !catalogSnapshot) return;
    const operation = routeV3OperationFromCatalog(record, catalogSnapshot, chooser);
    const firstLength = selected?.refs.map(ref => sources.find(item => refKey(item.ref) === refKey(ref))?.lengthMm).find((length): length is number => length != null) ?? 0;
    const previous = selected?.operations?.find(value => value.id === chooser);
    updateOperation(chooser, { ...operation, lengthMm: firstLength, outputProductIds: previous?.outputProductIds, parallelCapacity: previous?.parallelCapacity ?? 1 });
    setChooser(null); setCategory(null);
  };
  return <div className="route-v3-graph">
    <div className="route-v3-graph-toolbar"><button className="secondary-action" onClick={() => plus(null)}>+ Добавить карточку</button><span>{graph.nodes.length} карточек · {graph.edges.length} связей · на проект: {routeTotal === null ? "Не задано" : `${time(routeTotal)} мин`}</span>{link && <><span role="status">Выберите верхнюю точку другой карточки</span><button onClick={() => setLink(null)}>Отменить связь</button></>}</div>
    {error && <p role="alert" className="route-v3-error">{error}</p>}
    <div className="route-v3-route-scroll"><div ref={canvas} className="route-v3-route-grid" style={{ width, height }} onPointerMove={move} onPointerUp={() => { gesture.current = null; setResizeSnap(null); }} onPointerCancel={() => { gesture.current = null; setResizeSnap(null); }}>
      <svg className="route-v3-graph-edges" width={width} height={height} aria-label="Зависимости полуфабрикатов"><defs><marker id="v3-graph-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8Z" /></marker></defs>{graph.edges.map(edge => {
        const from = graph.nodes.find(n => n.id === edge.from)!, to = graph.nodes.find(n => n.id === edge.to)!;
        const a = routeV3ConnectionPort(from, "bottom"), b = routeV3ConnectionPort(to, "top");
        const title = `${from.title} → ${to.title}`;
        return <g key={edge.id}><path d={path(a, b)} markerEnd="url(#v3-graph-arrow)" /><path className="route-v3-edge-hit" d={path(a, b)} onClick={() => setDeleting({ kind: "edge", id: edge.id, title })} /><foreignObject x={(a.x + b.x) / 2 + 32} y={(a.y + b.y) / 2 - 12} width="26" height="26"><button className="route-v3-edge-delete" aria-label={`Удалить связь ${title}`} onClick={() => setDeleting({ kind: "edge", id: edge.id, title })}>×</button></foreignObject></g>;
      })}{link && graph.nodes.some(n => n.id === link.id) && <path className="route-v3-link-preview" d={path(routeV3ConnectionPort(graph.nodes.find(n => n.id === link.id)!, "bottom"), link)} markerEnd="url(#v3-graph-arrow)" />}</svg>
      {graph.nodes.map(node => <article key={node.id} data-node-id={node.id} className={`route-v3-node route-v3-editable-node ${node.kind}`} style={{ left: node.x, top: node.y, ...routeV3NodeSize(node) }}>
        <button className={`route-v3-port top ${link ? "target" : ""}`} aria-label={`Верхняя точка ${node.title}`} onClick={() => { if (link && change(d => connectRouteV3(d, link.id, node.id, crypto.randomUUID()))) setLink(null); }} />
        <button className="route-v3-card-heading" aria-label={`Переместить ${node.title}`} onPointerDown={e => begin(e, node, "move")}><span className="route-v3-node-kicker">{node.kind === "final" ? "ФИНАЛ" : node.kind === "assembly" ? "СБОРКА" : "ПОЛУФАБРИКАТ"}</span><strong>{node.title}</strong><small>{node.refs.length} комплектующих · {node.quantity ?? 1} шт. · на проект: {(node.operations ?? []).length ? duration(projectMinutes(node)) : "операции не назначены"}</small></button>
        <button className="route-v3-card-delete" aria-label={`Удалить карточку ${node.title}`} onClick={() => setDeleting({ kind: "node", id: node.id, title: node.title })}>×</button>
        <button className="route-v3-card-content" aria-label={`Просмотреть ${node.title}`} onClick={() => preview(node)}>{artwork(node)}{!node.refs.length && !node.fragmentIds.length && <span>Состав пуст</span>}</button>
        <div className="route-v3-card-operations"><strong>Операции · {(node.operations ?? []).length}</strong>{(node.operations ?? []).length ? <div className="route-v3-card-operation-scroll"><table aria-label={`Операции ${node.title}`}><thead><tr><th>Операция</th><th>На проект</th><th>Продукция</th></tr></thead><tbody>{(node.operations ?? []).map(operation => { const assigned = routeV3AssignedProductIds(node, operation); const products = routeV3Products(node).filter(product => assigned.includes(product.id)); const project = routeV3OperationProjectTimes(operation, node, source, harnessQuantity); return <tr key={operation.id}><td>{operation.title}</td><td>{duration(project.projectMinutes)}</td><td>{products.length ? products.map(product => product.ref ? sources.find(item => refKey(item.ref) === refKey(product.ref!))?.title ?? product.ref.id : node.title).join(", ") : "Не назначена"}</td></tr>; })}</tbody></table></div> : <span>Операции не назначены</span>}</div>
        <button className="route-v3-card-settings" onClick={() => { select(node.id); search(""); }}>Настроить карточку</button>
        {resizeSnap?.id === node.id && (resizeSnap.width || resizeSnap.height) && <span className="route-v3-card-size-snap" role="status">{resizeSnap.width && "Ширина совпала"}{resizeSnap.width && resizeSnap.height && " · "}{resizeSnap.height && "Высота совпала"}</span>}
        <button className={`route-v3-port bottom ${link?.id === node.id ? "target" : ""}`} aria-label={`Нижняя точка ${node.title}`} onClick={() => { const p = routeV3ConnectionPort(node, "bottom"); setLink({ id: node.id, x: p.x, y: p.y + 30 }); }} />
        <button className="route-v3-card-plus" aria-label={`Добавить карточку после ${node.title}`} onClick={() => plus(node.id)}>+</button>
        <button className="route-v3-card-resize" aria-label={`Изменить размер ${node.title}`} onPointerDown={e => begin(e, node, "resize")} onKeyDown={e => { const delta = e.key === "ArrowRight" || e.key === "ArrowDown" ? 20 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -20 : 0; if (!delta) return; e.preventDefault(); const s = routeV3NodeSize(node); change(d => ({ ...d, nodes: routeV3ResizeLayout(d.nodes, node.id, s.width + (e.key.includes("Left") || e.key.includes("Right") ? delta : 0), s.height + (e.key.includes("Up") || e.key.includes("Down") ? delta : 0)).nodes })); }} />
      </article>)}
    </div></div>
    {selected && <Modal label={`Настройки карточки ${selected.title}`} close={() => select(null)}>
      <header className="route-v3-preview-heading"><h3>{selected.title}</h3><button onClick={() => select(null)}>Закрыть</button></header>
      {error && <p role="alert">{error}</p>}
      <div className="route-v3-settings-top"><label>Название карточки<input value={selected.title} maxLength={512} onChange={e => update({ title: e.target.value || "Карточка" })} /></label><label>Количество на партию, шт.<input type="number" min="1" value={selected.quantity ?? harnessQuantity} onChange={e => update({ quantity: Math.max(1, Number(e.target.value) || 1) })} /></label><button className="secondary-action" onClick={() => editDrawing(selected)}>Открыть редактор рисунка</button></div>
      <Composition node={selected} source={source} sources={sources} graph={graph} harnessQuantity={harnessQuantity} updateWireArtwork={updateWireArtwork} resetWireArtwork={() => change(d => resetRouteV3WireArtwork(d, selected.refs.filter(ref => ref.kind === "wire").map(ref => ref.id)))} operations={<Operations node={selected} source={source} harnessQuantity={harnessQuantity} batchQuantity={routeV3ProcessedQuantity(selected, harnessQuantity)} add={addOperation} choose={id => { setChooser(id); setCategory(null); setCatalogSnapshot(null); setCatalogSourceId(""); }} update={updateOperation} assign={assignOperationProducts} remove={id => update({ operations: selected.operations?.filter(operation => operation.id !== id) })} />} />
      <section className="route-v2-settings-section"><h4>Рисунки полуфабрикатов и фрагменты</h4><button className="route-v3-settings-art" onClick={() => preview(selected)}>{artwork(selected)}</button></section>
      <section className="route-v2-settings-section"><h4>Материалы карточки</h4><input type="search" aria-label="Поиск сырья и полуфабрикатов" value={query} onChange={e => search(e.target.value)} /><div className="route-v2-material-groups"><section><h5>Сырьё</h5><div className="route-v2-source-choices">{sources.filter(s => `${s.title} ${s.material}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(s => <label className="route-v2-ref-choice" key={refKey(s.ref)}><input type="checkbox" aria-label={`Включить сырьё ${s.title}`} checked={(selected.rawRefs ?? selected.refs).some(r => refKey(r) === refKey(s.ref))} onChange={e => update({ rawRefs: e.target.checked ? [...(selected.rawRefs ?? selected.refs), s.ref] : (selected.rawRefs ?? selected.refs).filter(r => refKey(r) !== refKey(s.ref)) })} /><span><strong>{s.title}</strong><small>{routeSourceDesignation(s)}</small></span></label>)}</div></section><section><h5>Полуфабрикаты по стрелкам</h5><IncomingInputs graph={graph} node={selected} sources={sources} query={query} setInputRefs={setInputRefs} /></section></div></section>
      {!routeV3IsCutCard(selected) && <Operations node={selected} source={source} harnessQuantity={harnessQuantity} batchQuantity={routeV3BatchQuantity(selected, harnessQuantity)} add={addOperation} choose={id => { setChooser(id); setCategory(null); setCatalogSnapshot(null); setCatalogSourceId(""); }} update={updateOperation} assign={assignOperationProducts} remove={id => update({ operations: selected.operations?.filter(operation => operation.id !== id) })} />}
      {selected.kind === "final" && <label><input type="checkbox" checked={!!selected.operatorConfirmed} onChange={e => update({ operatorConfirmed: e.target.checked })} />Оператор подтверждает завершение маршрута</label>}
    </Modal>}
    {chooser && <OperationChooser category={category} setCategory={setCategory} snapshot={catalogSnapshot} loading={catalogLoading} error={catalogError} choose={chooseOperation} close={() => { setChooser(null); setCategory(null); }} />}
    {deleting && <Modal label={deleting.kind === "node" ? "Удалить карточку?" : "Удалить связь?"} close={() => setDeleting(null)}><h3>{deleting.kind === "node" ? "Удалить карточку?" : "Удалить связь?"}</h3><p>{deleting.title}</p><p>Состав зависимых карточек будет пересчитан.</p>{error && <p role="alert">{error}</p>}<button onClick={() => setDeleting(null)}>Отмена</button><button onClick={() => { if (change(d => deleting.kind === "node" ? deleteRouteV3Node(d, deleting.id) : deleteRouteV3Edge(d, deleting.id))) { if (link?.id === deleting.id) setLink(null); setDeleting(null); } }}>Удалить</button></Modal>}
  </div>;
}
