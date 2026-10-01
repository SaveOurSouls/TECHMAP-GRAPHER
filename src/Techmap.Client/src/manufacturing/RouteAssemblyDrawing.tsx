import { useMemo, useRef, useState } from "react";
import type { HarnessDesignDocument, Point } from "../editor/model";
import { coveringPaths } from "../editor/physical-coverings";
import { joiningPipePoints } from "../editor/physical-joining-pipes";
import { physicalSegmentPoints } from "../editor/physical-geometry";
import type { RouteRow } from "./route-model";
import type { RouteSourceItem, RouteSourceRef } from "./route-source";
import "./route-assembly-drawing.css";

export type AssemblyDrawingPresentation = RouteRow["presentation"];
export type AssemblyDrawingObject = AssemblyDrawingPresentation["objects"][number];

export interface RouteAssemblyDrawingProps {
  readonly row: RouteRow;
  readonly document: HarnessDesignDocument;
  /** The complete harness projection, used only as a faded editing background. */
  readonly sources: readonly RouteSourceItem[];
  /** Components belonging to this row and therefore eligible for the fragment. */
  readonly items: readonly RouteSourceItem[];
  readonly onSave: (presentation: AssemblyDrawingPresentation) => void;
  readonly onCancel: () => void;
}

const refKey = (ref: RouteSourceRef): string => `${ref.kind}:${ref.id}`;
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

function drawingPoints(document: HarnessDesignDocument, ref: RouteSourceRef): readonly Point[] {
  if (ref.kind === "connector") {
    const connector = document.connectors.find(item => item.id === ref.id);
    return connector ? [connector.positions.drawing] : [];
  }
  if (ref.kind === "wire") {
    const wire = document.wires.find(item => item.id === ref.id);
    if (!wire) return [];
    const from = document.connectors.find(item => item.id === wire.from.connectorId)?.positions.drawing;
    const to = document.connectors.find(item => item.id === wire.to.connectorId)?.positions.drawing;
    return [...(from ? [from] : []), ...wire.drawingRoute, ...(to ? [to] : [])];
  }
  if (ref.kind === "cable") {
    const cable = document.cables.find(item => item.id === ref.id);
    const member = cable?.memberWireIds[0];
    return member ? drawingPoints(document, { kind: "wire", id: member }) : [];
  }
  const covering = document.physicalTopology?.coverings?.find(item => item.id === ref.id);
  if (!covering) return [];
  const paths = coveringPaths(document, covering);
  if (paths.length) return paths.flatMap((path, index) => index ? path.slice(1) : path);
  const segmentId = covering.spans[0]?.segmentId;
  const segment = document.physicalTopology?.segments.find(item => item.id === segmentId);
  return segment && document.physicalTopology ? physicalSegmentPoints(document, segment) : [];
}

function sourceObject(document: HarnessDesignDocument, item: RouteSourceItem, index: number): AssemblyDrawingObject {
  const points = drawingPoints(document, item.ref);
  const fallback: readonly Point[] = item.ref.kind === "connector"
    ? [{ x: 140, y: 100 + index * 110 }]
    : [{ x: 140, y: 100 + index * 110 }, { x: 620, y: 100 + index * 110 }];
  return { ref: item.ref, points: points.length ? points.map(point => ({ ...point })) : fallback, hidden: false };
}

/**
 * Build an isolated presentation draft. It clones every point so dragging in
 * this editor cannot mutate the saved harness document or a route row.
 */
export function createAssemblyDrawingDraft(
  row: RouteRow,
  document: HarnessDesignDocument,
  items: readonly RouteSourceItem[],
): AssemblyDrawingPresentation {
  const saved = new Map(row.presentation.objects.map(object => [refKey(object.ref), object]));
  const objects = items.map((item, index) => {
    const previous = saved.get(refKey(item.ref));
    if (!previous) return sourceObject(document, item, index);
    return { ref: previous.ref, hidden: previous.hidden, points: previous.points.map(point => ({ ...point })) };
  });
  return { backgroundOpacity: clamp(row.presentation.backgroundOpacity, 0, 1), objects };
}

/** The route preview receives only the authored fragment, never the context layer. */
export function assemblyDrawingFragment(presentation: AssemblyDrawingPresentation): AssemblyDrawingPresentation {
  return {
    backgroundOpacity: presentation.backgroundOpacity,
    objects: presentation.objects.filter(object => !object.hidden).map(object => ({
      ...object, points: object.points.map(point => ({ ...point })), hidden: false,
    })),
  };
}

interface DragState { readonly key: string; readonly index: number }

export function RouteAssemblyDrawing({ row, document, sources, items, onSave, onCancel }: RouteAssemblyDrawingProps) {
  const svg = useRef<SVGSVGElement>(null);
  const [presentation, setPresentation] = useState<AssemblyDrawingPresentation>(() => createAssemblyDrawingDraft(row, document, items));
  const [selected, setSelected] = useState<string | null>(null);
  const drag = useRef<DragState | null>(null);
  const sourceByKey = useMemo(() => new Map(items.map(item => [refKey(item.ref), item])), [items]);
  const background = useMemo(() => [
    ...sources.map(item => ({ key: refKey(item.ref), points: drawingPoints(document, item.ref) })).filter(entry => entry.points.length),
    ...(document.physicalTopology?.segments ?? []).map(segment => ({ key: `pipe:${segment.id}`, points: physicalSegmentPoints(document, segment) })),
    ...(document.physicalTopology?.joiningPipes ?? []).map(pipe => ({ key: `joining-pipe:${pipe.id}`, points: joiningPipePoints(pipe) })),
  ], [document, sources]);
  const allPoints = presentation.objects.flatMap(object => object.points);
  const bgPoints = background.flatMap(entry => entry.points);
  const minX = Math.min(0, ...allPoints.map(point => point.x - 90), ...bgPoints.map(point => point.x - 90));
  const minY = Math.min(0, ...allPoints.map(point => point.y - 70), ...bgPoints.map(point => point.y - 70));
  const maxX = Math.max(800, ...allPoints.map(point => point.x + 160), ...bgPoints.map(point => point.x + 160));
  const maxY = Math.max(360, ...allPoints.map(point => point.y + 80), ...bgPoints.map(point => point.y + 80));
  const eventPoint = (event: React.PointerEvent<SVGSVGElement>): Point | null => {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix) return null;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return { x: Math.round(point.x), y: Math.round(point.y) };
  };
  const updateObject = (key: string, update: (object: AssemblyDrawingObject) => AssemblyDrawingObject) => setPresentation(current => ({
    ...current,
    objects: current.objects.map(object => refKey(object.ref) === key ? update(object) : object),
  }));
  const visibleCount = presentation.objects.filter(object => !object.hidden).length;
  const isolate = (key: string) => setPresentation(current => ({ ...current, objects: current.objects.map(object => ({ ...object, hidden: refKey(object.ref) !== key })) }));
  const save = () => onSave(assemblyDrawingFragment(presentation));

  return <section className="route-assembly-drawing" aria-label={`Рисунок сборки ${row.title}`}>
    <header className="route-assembly-drawing__header">
      <div><p className="route-assembly-drawing__eyebrow">РЕЖИМ РИСУНКА СБОРКИ</p><h3>{row.title}</h3><p>Изменения применяются к копии и не меняют чертёж, связи или производственные длины.</p></div>
      <div className="route-assembly-drawing__actions"><button type="button" className="secondary-action" onClick={onCancel}>Отмена</button><button type="button" className="primary-action" onClick={save}>Сохранить фрагмент</button></div>
    </header>
    <div className="route-assembly-drawing__toolbar">
      <label>Фон жгута <output>{Math.round(presentation.backgroundOpacity * 100)}%</output><input type="range" min={0} max={100} step={1} value={Math.round(presentation.backgroundOpacity * 100)} aria-label="Фон жгута" onChange={event => setPresentation(current => ({ ...current, backgroundOpacity: Number(event.target.value) / 100 }))} /></label>
      <span className="route-assembly-drawing__count">В фрагменте: {visibleCount} из {presentation.objects.length}</span>
      <button type="button" className="secondary-action" onClick={() => setPresentation(current => ({ ...current, objects: current.objects.map(object => ({ ...object, hidden: false })) }))}>Показать все</button>
      <button type="button" className="secondary-action" disabled={!selected} onClick={() => {
        if (!selected) return;
        updateObject(selected, object => {
          if (object.points.length < 2) return object;
          const from = object.points[0]!, to = object.points[1]!;
          return { ...object, points: [from, { x: Math.round((from.x + to.x) / 2), y: Math.round((from.y + to.y) / 2) }, ...object.points.slice(1)] };
        });
      }}>Добавить точку</button>
    </div>
    <div className="route-assembly-drawing__workspace">
      <aside className="route-assembly-drawing__objects" aria-label="Комплектующие сборки"><h4>Комплектующие</h4>{presentation.objects.map(object => {
        const key = refKey(object.ref), item = sourceByKey.get(key);
        return <div className={`route-assembly-drawing__object ${selected === key ? "is-selected" : ""} ${object.hidden ? "is-hidden" : ""}`} key={key}>
          <button type="button" className="route-assembly-drawing__object-name" aria-pressed={selected === key} onClick={() => setSelected(key)}><span>{item?.title ?? key}</span><small>{object.hidden ? "Скрыто" : "В фрагменте"}</small></button>
          <button type="button" className="icon-action" aria-label={object.hidden ? `Показать ${item?.title ?? key}` : `Скрыть ${item?.title ?? key}`} onClick={() => updateObject(key, current => ({ ...current, hidden: !current.hidden }))}>{object.hidden ? "◉" : "◌"}</button>
          <button type="button" className="icon-action" aria-label={`Изолировать ${item?.title ?? key}`} onClick={() => isolate(key)}>◎</button>
        </div>;
      })}</aside>
      <svg ref={svg} className="route-assembly-drawing__canvas" viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`} role="img" aria-label="Копия чертежа сборки" onPointerMove={event => {
        const active = drag.current; if (!active) return; const point = eventPoint(event); if (point) updateObject(active.key, object => ({ ...object, points: object.points.map((value, index) => index === active.index ? point : value) }));
      }} onPointerUp={event => { drag.current = null; svg.current?.releasePointerCapture(event.pointerId); }} onPointerCancel={() => { drag.current = null; }}>
        <g className="route-assembly-drawing__background" opacity={presentation.backgroundOpacity} aria-hidden="true" pointerEvents="none">{background.map(entry => <polyline key={entry.key} points={entry.points.map(point => `${point.x},${point.y}`).join(" ")} />)}</g>
        {presentation.objects.map(object => {
          const key = refKey(object.ref), item = sourceByKey.get(key), first = object.points[0], last = object.points.at(-1);
          if (object.hidden || !first || !last) return null;
          return <g key={key} className={`route-assembly-drawing__foreground ${selected === key ? "is-selected" : ""}`} onClick={() => setSelected(key)}>
            <title>{item?.title ?? key}</title><polyline points={object.points.map(point => `${point.x},${point.y}`).join(" ")} className="route-assembly-drawing__line" />
            {object.ref.kind === "connector" ? <rect x={first.x - 18} y={first.y - 18} width={36} height={36} rx={5} className="route-assembly-drawing__connector" /> : null}
            <text x={first.x} y={first.y - 24}>{item?.title ?? key}</text>
            {object.points.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r={8} className="route-assembly-drawing__handle" aria-label={`Точка ${index + 1} ${item?.title ?? key}`} onPointerDown={event => { event.preventDefault(); event.stopPropagation(); setSelected(key); drag.current = { key, index }; svg.current?.setPointerCapture(event.pointerId); }} />)}
          </g>;
        })}
      </svg>
    </div>
    <p className="route-assembly-drawing__hint">Выберите объект в списке или на копии чертежа и перетащите круглую точку. Длина исходного объекта не пересчитывается.</p>
  </section>;
}
