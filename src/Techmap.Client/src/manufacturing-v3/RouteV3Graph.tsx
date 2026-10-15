import { routeV3CompositionGroups, setRouteV3GroupArtwork } from "./route-v3-composition-groups";
import { RouteV2SourceArtwork } from "../manufacturing-v2/RouteV2Artwork";
import { RouteV3OperationTable as Operations } from "./RouteV3OperationTable";
import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type PointerEvent } from "react";
import type { HarnessDesignDocument } from "../editor/model";
import type { LocalSession } from "../local-session";
import type { RuntimeConfig } from "../runtime-config";
import { createReferenceCatalogApi, type ReferenceCatalogRecord, type ReferenceCatalogSnapshot, type ReferenceCatalogSourceSummary } from "../reference-catalog-api";
import { buildRouteSourceItems, routeSourceDesignation, routeSourceWireColor, routeSourceWireMaterial, type RouteSourceItem } from "../manufacturing/route-source";
import { wireBlankEnds, wireBlankEndLabels } from "../WireBlankCatalog";
import { routeV3WireArtwork, RouteV3WireArtworkPreview } from "./route-v3-wire-artwork";
import { refKey, resetRouteV3WireArtwork, routeV3AssignedProductIds, routeV3BatchQuantity, routeV3ConnectionPort, routeV3GroupedSourceQuantity, routeV3NodeSize, routeV3OperationFromCatalog, routeV3OperationProjectTimes, routeV3Products, routeV3ResizeLayout, routeV3WireArtworkOverride, assignRouteV3OperationProducts, type RouteV3Document, type RouteV3Node, type RouteV3Operation } from "./route-v3-model";
import { connectRouteV3, deleteRouteV3Edge, deleteRouteV3Node, insertRouteV3Node, refreshRouteV3, routeV3EdgeInputRefs, setRouteV3EdgeInputRefs } from "./route-v3-graph";
import { routeV3IsCutCard, routeV3ProcessedQuantity } from "./route-v3-card-quantity";
import { routeV3CatalogGroups, routeV3CatalogNumber } from "./route-v3-operations";
import "./route-v3-graph.css";

function Modal({ label, close, children, cardSettings = false }: { label: string; close: () => void; children: ReactNode; cardSettings?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const el = ref.current; el?.showModal(); return () => el?.close(); }, []);
  return <dialog ref={ref} className={`route-v3-dialog route-v3-card-dialog${cardSettings ? " route-v3-card-settings-dialog" : ""}`} aria-label={label} onCancel={e => { e.preventDefault(); e.stopPropagation(); close(); }}>{children}</dialog>;
}
function WireColorSwatch({ item }: { item: RouteSourceItem }) {
  return <i className="route-v3-color-swatch" style={{ background: routeSourceWireColor(item).background }} aria-hidden="true" />;
}
function SourceDesignation({ item }: { item: RouteSourceItem }) {
  return item.ref.kind === "wire"
    ? <span className="route-v3-material-label"><WireColorSwatch item={item} />{routeSourceWireMaterial(item)}</span>
    : <>{routeSourceDesignation(item)}</>;
}
type Props = { graph: RouteV3Document; source: HarnessDesignDocument; config: RuntimeConfig; session: LocalSession; projectId: string; harnessId: string; harnessQuantity?: number; save: (doc: RouteV3Document) => void; artwork: (node: RouteV3Node) => ReactNode; preview: (node: RouteV3Node) => void; editDrawing: (node: RouteV3Node) => void };
const time = (n: number) => Math.round(n * 100) / 100;
const duration = (value: number | null) => value === null ? "Не задано" : value === 0 ? "0 с" : `${time(value * 60)} с`;
const catalogText = (record: ReferenceCatalogRecord, key: string) => typeof record.payload[key] === "string" ? String(record.payload[key]).trim() : "";

function OperationChooser({ category, setCategory, snapshot, loading, error, choose, close }: { category: string | null; setCategory: (value: string | null) => void; snapshot: ReferenceCatalogSnapshot | null; loading: boolean; error: string | null; choose: (record: ReferenceCatalogRecord) => void; close: () => void }) {
  const records = snapshot?.records.filter(record => record.entityType === "operation") ?? [];
  const groups = routeV3CatalogGroups(records);
  const choices = groups.find(group => group.name === category)?.records ?? [];
  const choiceWidth = Math.min(60, Math.max(20, ...choices.map(record => routeV3CatalogNumber(record).length + 5)));
  return <Modal label="Выбор операции БД.ОП" close={close}>
    <header className="route-v3-preview-heading"><div><small>СПРАВОЧНИК БД.ОП · {category ? "ШАГ 2 ИЗ 2" : "ШАГ 1 ИЗ 2"}</small><h3>{category ?? "Выберите категорию"}</h3></div><button type="button" onClick={close}>Закрыть</button></header>
    {category && <button type="button" className="secondary-action route-v3-chooser-back" onClick={() => setCategory(null)}>← К категориям</button>}
    {loading && <p role="status">Загружаем БД.ОП…</p>}
    {error && <p role="alert" className="route-v3-error">{error}</p>}
    {!loading && !error && !snapshot && <p>Справочник БД.ОП недоступен.</p>}
    {!loading && !error && snapshot && !records.length && <p>В справочнике нет операций.</p>}
    <div className="route-v3-operation-choices" style={{ "--route-v3-choice-width": `${choiceWidth}ch` } as CSSProperties}>{category ? choices.map(record => <button type="button" key={record.recordId} className="route-v3-operation-choice" onClick={() => choose(record)}><span className="route-v3-operation-choice-icon" aria-hidden="true">⚙</span><strong>№ {routeV3CatalogNumber(record)}</strong><small>{catalogText(record, "operationType") || "Тип не указан"}</small></button>) : groups.map(group => <button type="button" key={group.name} className="route-v3-operation-choice" onClick={() => setCategory(group.name)}><span className="route-v3-operation-choice-icon" aria-hidden="true">▦</span><strong>{group.name}</strong><small>{group.records.length} операций</small></button>)}</div>
  </Modal>;
}

function Composition({ node, source, sources, graph, harnessQuantity, updateWireArtwork, resetWireArtwork, operations }: {
  node: RouteV3Node; source: HarnessDesignDocument; sources: readonly RouteSourceItem[]; graph: RouteV3Document; harnessQuantity: number;
  updateWireArtwork: (ids: readonly string[], patch: { color?: string; start?: typeof wireBlankEnds[number]; end?: typeof wireBlankEnds[number] }) => void;
  resetWireArtwork: () => void; operations: ReactNode;
}) {
  const count = routeV3BatchQuantity(node, harnessQuantity);
  const processed = routeV3ProcessedQuantity(node, harnessQuantity);
  const cut = routeV3IsCutCard(node);
  const rows = routeV3CompositionGroups(node.refs, source, graph).map(refs => ({ ref: refs[0]!, refs, item: sources.find(value => refKey(value.ref) === refKey(refs[0]!)) }));
  const wireRefs = node.refs.filter(ref => ref.kind === "wire");
  const operationTimes = (node.operations ?? []).map(operation => routeV3OperationProjectTimes(operation, node, source, harnessQuantity));
  const total = operationTimes.some(value => value.operationMinutes === null) ? null : operationTimes.reduce<number>((sum, value) => sum + value.operationMinutes!, 0);
  const projectTimes = operationTimes.map(value => value.projectMinutes);
  const projectTotal = projectTimes.some(value => value === null) ? null : projectTimes.reduce<number>((sum, value) => sum + value!, 0);
  const rowTime = rows.length === 1 ? total : null;
  return <section className="route-v3-composition route-v2-settings-section" aria-label="Состав карточки">
    <div className="route-v3-section-heading"><div><h4>Состав карточки · {node.refs.length}</h4><p>{cut ? `Резка: ${node.refs.length} заготовки на жгут × ${count} жгут(а) = ${processed} заготовок на партию.` : `Партия: ${count} жгут(а). Количества и время пересчитываются для партии.`}</p>{wireRefs.length > 0 && <p>Начало, конец и цвет меняются для всех проводов строки. Рисунок обновляется сразу.</p>}</div>{wireRefs.length > 0 && <button className="secondary-action" type="button" onClick={resetWireArtwork} title="Сбросит ручной вид проводов и возьмёт его из Э4">Обновить вид проводов по Э4</button>}</div>
    <div className="route-v3-composition-table"><table className="route-v3-direct-composition" aria-label="Полуфабрикаты карточки"><colgroup>{[14,9,10,5,12,6,6,7,7,9,9,6].map((width, index) => <col key={index} style={{ width: `${width}%` }} />)}</colgroup><thead><tr>{["Рисунок", "Объект", "Материал", "Длина", "Концы и разделка", "Кол-во на ПФ", "Кол-во на партию", "Время на операцию", "Время на партию", "Начало", "Конец", "Цвет"].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead><tbody>
      {rows.map(({ ref, refs, item }, index) => {
        const quantity = routeV3GroupedSourceQuantity(ref, refs, source, count);
        const appearance = ref.kind === "wire" ? routeV3WireArtwork(source, ref.id, routeV3WireArtworkOverride(graph, ref.id)) : null;
        const wireColor = item && ref.kind === "wire" ? routeSourceWireColor(item) : null;
        const label = `ПФ-${String(index + 1).padStart(2, "0")}`;
        const ids = refs.map(value => value.id);
        return <Fragment key={refKey(ref)}><tr>
          <td data-label="Рисунок"><div className="route-v3-composition-thumbnail" aria-label={`Рисунок ${label}`}>{appearance && item ? <RouteV3WireArtworkPreview document={source} item={item} override={routeV3WireArtworkOverride(graph, ref.id)} /> : <RouteV2SourceArtwork document={source} ref={ref} item={item} />}</div></td>
          <td data-label="Объект"><strong>{label}</strong><span>{appearance?.name ?? item?.title ?? ref.id}{refs.length > 1 ? ` · ${refs.length} одинаковых` : ""}</span></td>
          <td data-label="Материал">{item ? (ref.kind === "wire" ? <span className="route-v3-material-label"><i className="route-v3-color-swatch" style={{ background: wireColor?.background }} aria-hidden="true" />{routeSourceWireMaterial(item)}</span> : routeSourceDesignation(item)) : "Объект отсутствует в чертеже"}</td>
          <td data-label="Длина">{item?.lengthMm == null ? "—" : `${item.lengthMm} мм`}</td>
          <td data-label="Концы и разделка">{appearance ? <span className="route-v3-wire-ends"><span>Н: {appearance.terminalFrom || "Без разделки"}</span><span>К: {appearance.terminalTo || "Без разделки"}</span></span> : "—"}</td>
          <td data-label="Кол-во на ПФ">{ref.kind === "wire" || ref.kind === "covering" ? "—" : `${quantity.perSemiFinished} шт.`}</td><td data-label="Кол-во на партию">{quantity.perBatch} шт.</td>
          <td data-label="Время на операцию">{rowTime === null || !node.operations?.length ? "—" : `${time(rowTime)} мин`}</td><td data-label="Время на партию">{rowTime === null || projectTotal === null || !node.operations?.length ? "—" : `${time(projectTotal)} мин`}</td>
          <td data-label="Начало">{appearance ? <select aria-label={`Начало ${label}`} title={wireBlankEndLabels[appearance.start]} value={appearance.start} onChange={event => updateWireArtwork(ids, { start: event.target.value as typeof appearance.start })}>{wireBlankEnds.map(value => <option key={value} value={value}>{wireBlankEndLabels[value]}</option>)}</select> : "—"}</td>
          <td data-label="Конец">{appearance ? <select aria-label={`Конец ${label}`} title={wireBlankEndLabels[appearance.end]} value={appearance.end} onChange={event => updateWireArtwork(ids, { end: event.target.value as typeof appearance.end })}>{wireBlankEnds.map(value => <option key={value} value={value}>{wireBlankEndLabels[value]}</option>)}</select> : "—"}</td>
          <td data-label="Цвет">{appearance ? <input type="color" aria-label={`Цвет ${label}`} title={appearance.automatic ? "Вид по Э4" : "Ручной вид"} value={appearance.color} onChange={event => updateWireArtwork(ids, { color: event.target.value })} /> : "—"}</td>
        </tr>{ref.kind !== "wire" && refs.length > 1 && <tr className="route-v3-composition-detail-row"><td colSpan={12}><details className="route-v3-composition-detail"><summary>Исходные оболочки · {refs.length}</summary><p>{refs.map(value => value.id).join(", ")}</p></details></td></tr>}</Fragment>;
      })}
      {!rows.length && <tr><td colSpan={12} className="route-v3-composition-empty">Состав пуст. Выберите сырьё и полуфабрикаты ниже.</td></tr>}
      {!!node.operations?.length && rows.length > 1 && <tr className="route-v3-composition-total"><td colSpan={7}>{cut ? `Итого резка ${processed} заготовок.` : "Операции карточки применяются к составу целиком; время отдельных материалов не распределено."}</td><td data-label="Время на операцию">{total === null ? "Не задано" : `${time(total)} мин`}</td><td data-label="Время на партию">{projectTotal === null ? "Не задано" : `${time(projectTotal)} мин`}</td><td colSpan={3} /></tr>}
      {cut && <tr className="route-v3-composition-operations"><td colSpan={12}>{operations}</td></tr>}
    </tbody></table></div>
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
      return !query || `${item?.title ?? product.ref?.id ?? parent.title} ${item ? item.ref.kind === "wire" ? routeSourceWireMaterial(item) : routeSourceDesignation(item) : ""}`.toLocaleLowerCase().includes(query.toLocaleLowerCase());
    }).map(product => {
      const productRefs = product.ref ? [product.ref] : parent.refs;
      const checked = productRefs.length > 0 && productRefs.every(ref => refs.some(value => refKey(value) === refKey(ref)));
      const item = product.ref && sources.find(value => refKey(value.ref) === refKey(product.ref!));
      return <label className="route-v2-ref-choice" key={product.id}><input type="checkbox" aria-label={`Включить ${item?.title ?? product.ref?.id ?? parent.title} из ${parent.title}`} checked={checked} onChange={event => {
        const selected = new Map(refs.map(ref => [refKey(ref), ref]));
        for (const ref of productRefs) event.target.checked ? selected.set(refKey(ref), ref) : selected.delete(refKey(ref));
        setInputRefs(edge.id, [...selected.values()]);
      }} /><span><strong>{item?.title ?? product.ref?.id ?? parent.title}</strong><small>{item ? <SourceDesignation item={item} /> : `Собранный ПФ · ${productRefs.length} компонентов`}{item?.lengthMm == null ? "" : ` · ${item.lengthMm} мм`}</small></span></label>;
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
  const updateWireArtwork = (wireIds: readonly string[], patch: { readonly color?: string; readonly start?: typeof wireBlankEnds[number]; readonly end?: typeof wireBlankEnds[number] }) => change(d => setRouteV3GroupArtwork(d, wireIds, patch));
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
    {selected && <Modal cardSettings label={`Настройки карточки ${selected.title}`} close={() => select(null)}>
      <header className="route-v3-preview-heading"><h3>{selected.title}</h3><button onClick={() => select(null)}>Закрыть</button></header>
      {error && <p role="alert">{error}</p>}
      <div className="route-v3-settings-top"><label>Название карточки<input value={selected.title} maxLength={512} onChange={e => update({ title: e.target.value || "Карточка" })} /></label><label>Количество на партию, шт.<input type="number" min="1" value={selected.quantity ?? harnessQuantity} onChange={e => update({ quantity: Math.max(1, Number(e.target.value) || 1) })} /></label><button className="secondary-action" onClick={() => editDrawing(selected)}>Открыть редактор рисунка</button></div>
      <Composition node={selected} source={source} sources={sources} graph={graph} harnessQuantity={harnessQuantity} updateWireArtwork={updateWireArtwork} resetWireArtwork={() => change(d => resetRouteV3WireArtwork(d, selected.refs.filter(ref => ref.kind === "wire").map(ref => ref.id)))} operations={<Operations node={selected} source={source} harnessQuantity={harnessQuantity} batchQuantity={routeV3ProcessedQuantity(selected, harnessQuantity)} add={addOperation} choose={id => { setChooser(id); setCategory(null); setCatalogSnapshot(null); setCatalogSourceId(""); }} update={updateOperation} assign={assignOperationProducts} remove={id => update({ operations: selected.operations?.filter(operation => operation.id !== id) })} />} />
      <section className="route-v2-settings-section"><h4>Рисунки полуфабрикатов и фрагменты</h4><button className="route-v3-settings-art" onClick={() => preview(selected)}>{artwork(selected)}</button></section>
      <section className="route-v2-settings-section"><h4>Материалы карточки</h4><input type="search" aria-label="Поиск сырья и полуфабрикатов" value={query} onChange={e => search(e.target.value)} /><div className="route-v2-material-groups"><section><h5>Сырьё</h5><div className="route-v2-source-choices">{sources.filter(s => `${s.title} ${s.material} ${s.section} ${s.color}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(s => <label className="route-v2-ref-choice" key={refKey(s.ref)}><input type="checkbox" aria-label={`Включить сырьё ${s.title}`} checked={(selected.rawRefs ?? selected.refs).some(r => refKey(r) === refKey(s.ref))} onChange={e => update({ rawRefs: e.target.checked ? [...(selected.rawRefs ?? selected.refs), s.ref] : (selected.rawRefs ?? selected.refs).filter(r => refKey(r) !== refKey(s.ref)) })} /><span><strong>{s.title}</strong><small><SourceDesignation item={s} /></small></span></label>)}</div></section><section><h5>Полуфабрикаты по стрелкам</h5><IncomingInputs graph={graph} node={selected} sources={sources} query={query} setInputRefs={setInputRefs} /></section></div></section>
      {!routeV3IsCutCard(selected) && <Operations node={selected} source={source} harnessQuantity={harnessQuantity} batchQuantity={routeV3BatchQuantity(selected, harnessQuantity)} add={addOperation} choose={id => { setChooser(id); setCategory(null); setCatalogSnapshot(null); setCatalogSourceId(""); }} update={updateOperation} assign={assignOperationProducts} remove={id => update({ operations: selected.operations?.filter(operation => operation.id !== id) })} />}
      {selected.kind === "final" && <label><input type="checkbox" checked={!!selected.operatorConfirmed} onChange={e => update({ operatorConfirmed: e.target.checked })} />Оператор подтверждает завершение маршрута</label>}
    </Modal>}
    {chooser && <OperationChooser category={category} setCategory={setCategory} snapshot={catalogSnapshot} loading={catalogLoading} error={catalogError} choose={chooseOperation} close={() => { setChooser(null); setCategory(null); }} />}
    {deleting && <Modal label={deleting.kind === "node" ? "Удалить карточку?" : "Удалить связь?"} close={() => setDeleting(null)}><h3>{deleting.kind === "node" ? "Удалить карточку?" : "Удалить связь?"}</h3><p>{deleting.title}</p><p>Состав зависимых карточек будет пересчитан.</p>{error && <p role="alert">{error}</p>}<button onClick={() => setDeleting(null)}>Отмена</button><button onClick={() => { if (change(d => deleting.kind === "node" ? deleteRouteV3Node(d, deleting.id) : deleteRouteV3Edge(d, deleting.id))) { if (link?.id === deleting.id) setLink(null); setDeleting(null); } }}>Удалить</button></Modal>}
  </div>;
}
