import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { HarnessDesignDocument } from "../editor/model";
import { buildRouteSourceItems, routeSourceDesignation, routeSourceWireColor, routeSourceWireMaterial } from "../manufacturing/route-source";
import type { RouteV3Node } from "./route-v3-model";
import { routeV3AssignedProductIds, routeV3IsCutCard, routeV3OperationProjectTimes, routeV3Products, type RouteV3Operation } from "./route-v3-operations";
import "./route-v3-operation-table.css";

type Props = {
  node: RouteV3Node; source: HarnessDesignDocument; harnessQuantity: number; batchQuantity: number;
  add: () => void; choose: (id: string) => void; remove: (id: string) => void;
  update: (id: string, patch: Partial<RouteV3Operation>) => void;
  assign: (id: string, productIds: readonly string[]) => void;
};
const seconds = (minutes: number | null) => minutes === null ? "—" : `${Math.round(minutes * 6000) / 100} с`;

function ProductPicker({ node, source, operation, assign, close }: Pick<Props, "node" | "source" | "assign"> & { operation: RouteV3Operation; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [hideUsed, setHideUsed] = useState(false);
  const [query, setQuery] = useState("");
  const items = useMemo(() => buildRouteSourceItems(source), [source]);
  const assigned = routeV3AssignedProductIds(node, operation);
  const operations = node.operations ?? [];
  const earlier = operations.slice(0, operations.findIndex(value => value.id === operation.id));
  const used = new Set(earlier.flatMap(value => routeV3AssignedProductIds(node, value)));
  const products = routeV3Products(node).map(product => {
    const item = items.find(value => value.ref.kind === product.ref?.kind && value.ref.id === product.ref?.id);
    const label = item ? [item.title, item.ref.kind === "wire" ? routeSourceWireMaterial(item) : routeSourceDesignation(item), item.lengthMm == null ? "" : `${item.lengthMm} мм`].filter(Boolean).join(" · ") : node.title;
    return { product, item, label };
  }).filter(({ product, label }) => (!hideUsed || !used.has(product.id) || assigned.includes(product.id)) && label.toLocaleLowerCase("ru").includes(query.toLocaleLowerCase("ru")));
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  return createPortal(<dialog ref={dialog} className="route-v3-product-picker" aria-label={`Полуфабрикаты операции ${operation.title}`} onCancel={event => { event.preventDefault(); event.stopPropagation(); close(); }}>
    <header><div><h3>Полуфабрикаты операции</h3><p>{operation.title} · Выбрано: {assigned.length}</p></div><button type="button" onClick={close}>Готово</button></header>
    <div className="route-v3-product-filter"><input type="search" aria-label="Поиск полуфабрикатов операции" placeholder="Найти полуфабрикат" value={query} onChange={event => setQuery(event.target.value)} /><label><input type="checkbox" checked={hideUsed} onChange={event => setHideUsed(event.target.checked)} />Скрыть выбранные</label></div>
    <p className="route-v3-product-hint">Серым отмечены назначения предыдущим операциям. Их можно выбрать повторно. Изменения сохраняются сразу.</p>
    <div className="route-v3-product-list">{products.map(({ product, item, label }) => <label key={product.id} className={used.has(product.id) ? "used" : ""}>
      <input type="checkbox" aria-label={`Выбрать ${label}`} checked={assigned.includes(product.id)} onChange={event => assign(operation.id, event.target.checked ? [...assigned, product.id] : assigned.filter(id => id !== product.id))} />
      <span>{item?.ref.kind === "wire" && <i className="route-v3-color-swatch" style={{ background: routeSourceWireColor(item).background }} aria-hidden="true" />}{label}{used.has(product.id) && <small>Уже в операциях: {earlier.filter(value => routeV3AssignedProductIds(node, value).includes(product.id)).map(value => `${operations.indexOf(value) + 1}. ${value.title}`).join(", ")}</small>}</span>
    </label>)}{!products.length && <p role="status">Нет подходящих полуфабрикатов. Измените поиск или отключите фильтр.</p>}</div>
  </dialog>, document.body);
}

export function RouteV3OperationTable({ node, source, harnessQuantity, batchQuantity, add, choose, update, assign, remove }: Props) {
  const [pickerId, setPickerId] = useState<string | null>(null);
  const operations = node.operations ?? [];
  const products = routeV3Products(node);
  const picker = operations.find(value => value.id === pickerId);
  const wireCut = routeV3IsCutCard(node) && node.refs.every(ref => ref.kind === "wire");
  return <section className="route-v3-operations" aria-label="Операции карточки">
    <div className="route-v3-section-heading"><div><h4>Операции · {operations.length}</h4><p>БД.ОП · Партия: {batchQuantity} {routeV3IsCutCard(node) ? "заготовок" : "шт."} · Время в секундах; «—» — норма не задана или неприменима.</p></div><button type="button" className="secondary-action" onClick={add}>+ Добавить операцию</button></div>
    <div className="route-v3-operation-grid-wrap"><table className="route-v3-operation-grid" aria-label="Таблица операций">
      <colgroup>{[3, 21, 7, 5, 5, 6, 6, 6, 5, 7, 8, 9, 9, 3].map((width, index) => <col key={index} style={{ width: `${width}%` }} />)}</colgroup>
      <thead><tr>{["№", "Операция / № БД.ОП", "Тип", "L, мм", "Паралл., шт.", "Машина", "Человек", "Доп.", "Циклы", "Подготовка", "На операцию", "На партию", "Полуфабрикаты", ""].map((heading, index) => <th scope="col" key={index}>{heading}</th>)}</tr></thead>
      <tbody>{operations.map((operation, index) => {
        const times = routeV3OperationProjectTimes(operation, node, source, harnessQuantity);
        const assigned = routeV3AssignedProductIds(node, operation);
        const title = `${operation.title}${operation.catalogBinding ? ` · № ${operation.catalogBinding.sourceKey}` : ""}`;
        return <tr key={operation.id}>
          <td>{index + 1}</td><td><button className="route-v3-grid-title" type="button" title={title} aria-label={`Выбрать название операции ${index + 1}`} onClick={() => choose(operation.id)}>{title}</button></td>
          <td title={operation.catalogOperationType}>{operation.catalogOperationType || (operation.kind === "running" ? "Погонная" : "Статичная")}</td>
          <td>{operation.kind === "running" ? <input aria-label={`Длина операции ${index + 1}`} type="number" min="0" value={operation.lengthMm} onChange={event => update(operation.id, { lengthMm: Math.max(0, Number(event.target.value) || 0) })} /> : "—"}</td>
          <td>{wireCut ? <input aria-label={`Параллельная ёмкость операции ${index + 1}`} type="number" min="1" step="1" value={operation.parallelCapacity ?? 1} onChange={event => update(operation.id, { parallelCapacity: Math.max(1, Math.floor(Number(event.target.value) || 1)) })} /> : "—"}</td>
          <td>{seconds(times.machineMinutes)}</td><td>{seconds(times.humanMinutes)}</td><td>{seconds(operation.additionalTimeSeconds == null ? null : operation.additionalTimeSeconds / 60)}</td><td>{times.cycles ?? "—"}</td><td>{seconds(times.setupMinutes)}</td><td>{seconds(times.operationMinutes)}</td><td>{seconds(times.projectMinutes)}</td>
          <td>{products.length > 1 ? <button type="button" aria-label={`Полуфабрикаты операции ${index + 1}`} onClick={() => setPickerId(operation.id)}>Выбрать · {assigned.length}</button> : products.length === 1 ? "1 · авто" : "Нет ПФ"}</td>
          <td><button type="button" className="route-v3-grid-remove" aria-label={`Удалить операцию ${operation.title}`} onClick={() => remove(operation.id)}>×</button></td>
        </tr>;
      })}{!operations.length && <tr><td colSpan={14}>Операции не назначены. Нажмите «Добавить операцию».</td></tr>}</tbody>
    </table></div>
    {picker && <ProductPicker key={picker.id} node={node} source={source} operation={picker} assign={assign} close={() => setPickerId(null)} />}
  </section>;
}
