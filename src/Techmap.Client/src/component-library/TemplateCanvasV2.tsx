import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import type {
  NumericExpressionV2,
  ParameterValueV2,
  PointExpressionV2,
  TemplateContentV2,
  TemplateNodeV2,
  TemplateViewV2,
  TransformV2,
} from "./template-model-v2";
import { expandTemplateViewRepeatsV2, type RepeatOccurrenceDescriptorV2 } from "./template-repeat-v2";

export const TEMPLATE_CANVAS_V2_WIDTH = 720;
export const TEMPLATE_CANVAS_V2_HEIGHT = 440;

export type TemplateParameterDefaultsV2 =
  | Readonly<Record<string, ParameterValueV2>>
  | ReadonlyMap<string, ParameterValueV2>;

export interface TemplateCanvasV2Props {
  content: TemplateContentV2;
  viewId: string;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onNodeMove?: (id: string, deltaX: number, deltaY: number) => void;
  resolveAssetUrl: (assetId: string) => string;
  parameterDefaults?: TemplateParameterDefaultsV2;
  width?: number;
  height?: number;
}

type NumericEvaluator = (expression: NumericExpressionV2) => number | null;
type SvgPoint = readonly [number, number];

interface DragStateV2 {
  readonly id: string;
  readonly pointerId: number;
  readonly startClientX: number;
  readonly startClientY: number;
  readonly start: SvgPoint;
  readonly latest: SvgPoint;
}

interface DragPreviewV2 {
  readonly id: string;
  readonly deltaX: number;
  readonly deltaY: number;
}

export interface TemplateCanvasClientRectV2 {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface TemplateNodeDragSampleV2 {
  readonly clientX: number;
  readonly clientY: number;
  readonly templateX: number;
  readonly templateY: number;
}

export function clientPointToTemplateCoordinatesV2(
  rect: TemplateCanvasClientRectV2,
  clientX: number,
  clientY: number,
  viewBoxWidth: number,
  viewBoxHeight: number,
): { x: number; y: number } | null {
  if (![rect.left, rect.top, rect.width, rect.height, clientX, clientY, viewBoxWidth, viewBoxHeight].every(Number.isFinite) ||
      rect.width <= 0 || rect.height <= 0 || viewBoxWidth <= 0 || viewBoxHeight <= 0) return null;
  const scale = Math.min(rect.width / viewBoxWidth, rect.height / viewBoxHeight);
  if (!Number.isFinite(scale) || scale <= 0) return null;
  const offsetX = rect.left + (rect.width - viewBoxWidth * scale) / 2;
  const offsetY = rect.top + (rect.height - viewBoxHeight * scale) / 2;
  return { x: (clientX - offsetX) / scale, y: (clientY - offsetY) / scale };
}

export function completedTemplateNodeDragV2(
  start: TemplateNodeDragSampleV2,
  end: TemplateNodeDragSampleV2,
  thresholdInClientPixels = 3,
): { deltaX: number; deltaY: number } | null {
  const values = [
    start.clientX, start.clientY, start.templateX, start.templateY,
    end.clientX, end.clientY, end.templateX, end.templateY, thresholdInClientPixels,
  ];
  if (!values.every(Number.isFinite) || thresholdInClientPixels < 0) return null;
  if (Math.hypot(end.clientX - start.clientX, end.clientY - start.clientY) < thresholdInClientPixels) return null;
  const deltaX = end.templateX - start.templateX;
  const deltaY = end.templateY - start.templateY;
  return deltaX === 0 && deltaY === 0 ? null : { deltaX, deltaY };
}

function suppliedDefault(
  defaults: TemplateParameterDefaultsV2 | undefined,
  parameterId: string,
): { found: boolean; value: ParameterValueV2 | undefined } {
  if (!defaults) return { found: false, value: undefined };
  if ("get" in defaults && typeof defaults.get === "function") {
    const map = defaults as ReadonlyMap<string, ParameterValueV2>;
    return { found: map.has(parameterId), value: map.get(parameterId) };
  }
  const record = defaults as Readonly<Record<string, ParameterValueV2>>;
  return { found: Object.prototype.hasOwnProperty.call(record, parameterId), value: record[parameterId] };
}

export function createTemplateNumericEvaluatorV2(
  content: TemplateContentV2,
  defaults?: TemplateParameterDefaultsV2,
): NumericEvaluator {
  const parameters = new Map(content.parameters.map(parameter => [parameter.id, parameter]));
  const cached = new Map<string, number | null>();
  const resolving = new Set<string>();

  function finite(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }

  function parameterValue(parameterId: string): number | null {
    const supplied = suppliedDefault(defaults, parameterId);
    if (supplied.found) return finite(supplied.value);
    if (cached.has(parameterId)) return cached.get(parameterId) ?? null;
    const parameter = parameters.get(parameterId);
    if (!parameter || resolving.has(parameterId)) return null;
    resolving.add(parameterId);
    const result = parameter.formula === null
      ? finite(parameter.defaultValue)
      : evaluate(parameter.formula);
    resolving.delete(parameterId);
    cached.set(parameterId, result);
    return result;
  }

  function evaluate(expression: NumericExpressionV2): number | null {
    if (expression.kind === "constant") return finite(expression.value);
    if (expression.kind === "parameter") return parameterValue(expression.parameterId);
    if (expression.kind === "negate") {
      const operand = evaluate(expression.operand);
      return operand === null ? null : finite(-operand);
    }
    const left = evaluate(expression.left);
    const right = evaluate(expression.right);
    if (left === null || right === null) return null;
    let result: number;
    if (expression.operator === "add") result = left + right;
    else if (expression.operator === "subtract") result = left - right;
    else if (expression.operator === "multiply") result = left * right;
    else {
      if (right === 0) return null;
      result = left / right;
    }
    return finite(result);
  }

  return evaluate;
}

function evaluatePoint(point: PointExpressionV2, evaluate: NumericEvaluator): SvgPoint | null {
  const x = evaluate(point.x);
  const y = evaluate(point.y);
  return x === null || y === null ? null : [x, y];
}

function evaluatePoints(points: readonly PointExpressionV2[], evaluate: NumericEvaluator): SvgPoint[] | null {
  const result: SvgPoint[] = [];
  for (const point of points) {
    const evaluated = evaluatePoint(point, evaluate);
    if (!evaluated) return null;
    result.push(evaluated);
  }
  return result;
}

function evaluateTransform(transform: TransformV2, evaluate: NumericEvaluator): string | null {
  const translateX = evaluate(transform.translateX);
  const translateY = evaluate(transform.translateY);
  const rotation = evaluate(transform.rotationDegrees);
  const scaleX = evaluate(transform.scaleX);
  const scaleY = evaluate(transform.scaleY);
  if (translateX === null || translateY === null || rotation === null || scaleX === null || scaleY === null)
    return null;
  return `translate(${formatNumber(translateX)} ${formatNumber(translateY)}) rotate(${formatNumber(rotation)}) scale(${formatNumber(scaleX)} ${formatNumber(scaleY)})`;
}

function formatNumber(value: number): string {
  return Object.is(value, -0) ? "0" : String(value);
}

function pointsAttribute(points: readonly SvgPoint[]): string {
  return points.map(([x, y]) => `${formatNumber(x)},${formatNumber(y)}`).join(" ");
}

function bezierPath(points: readonly SvgPoint[], closed: boolean): string | null {
  if (points.length < 4 || (points.length - 1) % 3 !== 0) return null;
  let path = `M ${formatNumber(points[0]![0])} ${formatNumber(points[0]![1])}`;
  for (let index = 1; index < points.length; index += 3) {
    const first = points[index]!;
    const second = points[index + 1]!;
    const end = points[index + 2]!;
    path += ` C ${formatNumber(first[0])} ${formatNumber(first[1])} ${formatNumber(second[0])} ${formatNumber(second[1])} ${formatNumber(end[0])} ${formatNumber(end[1])}`;
  }
  return closed ? `${path} Z` : path;
}

function rectanglePath(x: number, y: number, width: number, height: number, radii: readonly number[]): string | null {
  if (width <= 0 || height <= 0 || radii.length !== 4 || radii.some(radius => !Number.isFinite(radius))) return null;
  const maximum = Math.min(width, height) / 2;
  const [topLeft, topRight, bottomRight, bottomLeft] = radii.map(radius => Math.min(Math.max(0, radius), maximum));
  return [
    `M ${formatNumber(x + topLeft!)} ${formatNumber(y)}`,
    `H ${formatNumber(x + width - topRight!)}`,
    `Q ${formatNumber(x + width)} ${formatNumber(y)} ${formatNumber(x + width)} ${formatNumber(y + topRight!)}`,
    `V ${formatNumber(y + height - bottomRight!)}`,
    `Q ${formatNumber(x + width)} ${formatNumber(y + height)} ${formatNumber(x + width - bottomRight!)} ${formatNumber(y + height)}`,
    `H ${formatNumber(x + bottomLeft!)}`,
    `Q ${formatNumber(x)} ${formatNumber(y + height)} ${formatNumber(x)} ${formatNumber(y + height - bottomLeft!)}`,
    `V ${formatNumber(y + topLeft!)}`,
    `Q ${formatNumber(x)} ${formatNumber(y)} ${formatNumber(x + topLeft!)} ${formatNumber(y)}`,
    "Z",
  ].join(" ");
}

function stablePlaceholderPosition(id: string, width: number, height: number): SvgPoint {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < id.length; index++) {
    const code = id.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x27d4eb2d);
  }
  const availableWidth = Math.max(1, Math.floor(width - 88));
  const availableHeight = Math.max(1, Math.floor(height - 56));
  return [24 + (first >>> 0) % availableWidth, 24 + (second >>> 0) % availableHeight];
}

function placeholder(
  node: TemplateNodeV2,
  width: number,
  height: number,
  reason: string,
): ReactNode {
  const [x, y] = stablePlaceholderPosition(node.id, width, height);
  return (
    <g
      key={node.id}
      data-template-node-id={node.id}
      data-template-node-kind={node.kind}
      data-render="placeholder"
      pointerEvents="none"
      opacity={node.opacity}
      transform={`translate(${x} ${y})`}
      aria-label={`Не удалось отобразить ${node.kind}`}
    >
      <rect x="-10" y="-10" width="68" height="32" rx="4" fill="#fff7e6" stroke="#a86519" strokeDasharray="4 3" />
      <path d="M 0 10 L 8 -4 L 16 10 Z" fill="none" stroke="#a86519" />
      <text x="22" y="10" fill="#7b4c16" fontSize="10">{node.kind}</text>
      <title>{reason}</title>
    </g>
  );
}

export function TemplateCanvasV2({
  content,
  viewId,
  selectedId,
  onSelect,
  onNodeMove,
  resolveAssetUrl,
  parameterDefaults,
  width = TEMPLATE_CANVAS_V2_WIDTH,
  height = TEMPLATE_CANVAS_V2_HEIGHT,
}: TemplateCanvasV2Props) {
  const dragRef = useRef<DragStateV2 | null>(null);
  const [dragPreview, setDragPreview] = useState<DragPreviewV2 | null>(null);
  const view = content.views.find(candidate => candidate.id === viewId);
  const evaluate = createTemplateNumericEvaluatorV2(content, parameterDefaults);
  const assetIds = new Set(content.assets.map(asset => asset.assetId));
  const logicalContacts = new Map(content.logicalContacts.map(contact => [contact.id, contact]));
  const repeatPreview = new Map<string, readonly RepeatOccurrenceDescriptorV2[]>();
  const repeatedGroupIds = new Set<string>();
  const repeatedPointIds = new Set<string>();
  let repeatPreviewError: string | null = null;
  if (view) try {
    for (const expansion of expandTemplateViewRepeatsV2(content, view.id, { overrides: parameterDefaults })) {
      repeatPreview.set(expansion.prototypeGroupId, expansion.occurrences);
      repeatedGroupIds.add(expansion.prototypeGroupId);
      const placement = view.repeatPlacements.find(item => item.prototypeGroupId === expansion.prototypeGroupId);
      placement?.contactPointIds.forEach(id => repeatedPointIds.add(id));
    }
  } catch (caught) {
    repeatPreviewError = caught instanceof Error ? caught.message : "Повторяемые сегменты не удалось развернуть.";
  }

  useEffect(() => {
    dragRef.current = null;
    setDragPreview(null);
  }, [viewId]);

  const select = (event: ReactPointerEvent<SVGElement>, id: string, interactive = true) => {
    if (!interactive) return;
    event.stopPropagation();
    onSelect(id);
  };

  const selectFromKeyboard = (event: ReactKeyboardEvent<SVGElement>, id: string) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
    onSelect(id);
  };

  const pointFromEvent = (event: ReactPointerEvent<SVGElement>): SvgPoint | null => {
    const svg = event.currentTarget.ownerSVGElement ??
      (event.currentTarget.tagName.toLowerCase() === "svg" ? event.currentTarget as SVGSVGElement : null);
    if (!svg) return null;
    const point = clientPointToTemplateCoordinatesV2(svg.getBoundingClientRect(), event.clientX, event.clientY, width, height);
    return point ? [point.x, point.y] : null;
  };

  const beginNodeGesture = (event: ReactPointerEvent<SVGElement>, id: string, selectable: boolean, movable: boolean) => {
    select(event, id, selectable);
    if (!movable || !onNodeMove) return;
    const start = pointFromEvent(event);
    const svg = event.currentTarget.ownerSVGElement;
    if (!start || !svg) return;
    try { svg.setPointerCapture(event.pointerId); } catch { /* Capture can fail for a pointer that already ended. */ }
    dragRef.current = {
      id,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      start,
      latest: start,
    };
    setDragPreview({ id, deltaX: 0, deltaY: 0 });
  };

  const moveNodeGesture = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const point = pointFromEvent(event);
    if (!point) return;
    dragRef.current = { ...drag, latest: point };
    setDragPreview({ id: drag.id, deltaX: point[0] - drag.start[0], deltaY: point[1] - drag.start[1] });
  };

  const clearNodeGesture = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (drag && drag.pointerId !== event.pointerId) return;
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    } catch { /* The browser can release capture before React handles the terminal event. */ }
    dragRef.current = null;
    setDragPreview(null);
  };

  const endNodeGesture = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const finalPoint = pointFromEvent(event) ?? drag.latest;
    const completed = completedTemplateNodeDragV2(
      { clientX: drag.startClientX, clientY: drag.startClientY, templateX: drag.start[0], templateY: drag.start[1] },
      { clientX: event.clientX, clientY: event.clientY, templateX: finalPoint[0], templateY: finalPoint[1] },
    );
    clearNodeGesture(event);
    if (completed) onNodeMove?.(drag.id, completed.deltaX, completed.deltaY);
  };

  const previewTransform = (nodeId: string, transform: string, topLevel: boolean): string => {
    if (!topLevel || dragPreview?.id !== nodeId) return transform;
    return `translate(${formatNumber(dragPreview.deltaX)} ${formatNumber(dragPreview.deltaY)}) ${transform}`;
  };

  const hasMovableTransform = (node: TemplateNodeV2) =>
    node.transform.translateX.kind === "constant" && node.transform.translateY.kind === "constant";

  function renderLayer(layer: TemplateViewV2["layers"][number]): ReactNode {
    if (!layer.visible) return null;
    const nodesById = new Map(layer.nodes.map(node => [node.id, node]));
    const ownedIds = new Set<string>();
    for (const node of layer.nodes) {
      if (node.kind === "group") for (const childId of node.geometry.childIds) ownedIds.add(childId);
    }

    function renderNode(
      node: TemplateNodeV2,
      ancestorLocked = false,
      ancestors = new Set<string>(),
      rootNodeId = node.id,
      topLevel = true,
      rootMovable = hasMovableTransform(node),
    ): ReactNode {
      if (!node.visible) return null;
      const locked = ancestorLocked || layer.locked || node.locked;
      const transform = evaluateTransform(node.transform, evaluate);
      const strokeWidth = evaluate(node.stroke.width);
      if (transform === null || strokeWidth === null || strokeWidth < 0)
        return placeholder(node, width, height, "Преобразование или толщина линии не вычисляется из параметров.");

      const common = {
        key: node.id,
        "data-template-node-id": node.id,
        "data-template-node-kind": node.kind,
        "data-selected": selectedId === node.id ? "true" : undefined,
        "data-locked": locked ? "true" : undefined,
        opacity: node.opacity,
        transform: previewTransform(node.id, transform, topLevel),
        pointerEvents: layer.locked ? "none" as const : undefined,
        "data-draggable": topLevel && !locked && onNodeMove && rootMovable ? "true" : undefined,
        onPointerDown: (event: ReactPointerEvent<SVGElement>) => beginNodeGesture(event, rootNodeId, !layer.locked, !locked && rootMovable),
      };
      const shape = {
        fill: node.fill.color ?? "none",
        stroke: node.stroke.color,
        strokeWidth,
      };

      if (node.kind === "line" || node.kind === "polyline") {
        const points = evaluatePoints(node.geometry.points, evaluate);
        if (!points || points.length < 2) return placeholder(node, width, height, "Координаты линии не вычисляются из параметров.");
        const bendRadius = evaluate(node.geometry.bendRadius);
        if (bendRadius === null || bendRadius < 0 || node.kind === "polyline" && bendRadius !== 0)
          return placeholder(node, width, height, "Радиус изгиба линии пока нельзя отобразить точно.");
        if (node.kind === "line" && points.length === 2) {
          return <line {...common} {...shape} x1={points[0]![0]} y1={points[0]![1]} x2={points[1]![0]} y2={points[1]![1]} />;
        }
        return <polyline {...common} {...shape} points={pointsAttribute(points)} />;
      }
      if (node.kind === "rectangle") {
        const x = evaluate(node.geometry.x);
        const y = evaluate(node.geometry.y);
        const rectangleWidth = evaluate(node.geometry.width);
        const rectangleHeight = evaluate(node.geometry.height);
        const radii = node.geometry.cornerRadii.map(radius => evaluate(radius));
        if (x === null || y === null || rectangleWidth === null || rectangleHeight === null || radii.some(radius => radius === null))
          return placeholder(node, width, height, "Размер прямоугольника не вычисляется из параметров.");
        const path = rectanglePath(x, y, rectangleWidth, rectangleHeight, radii as number[]);
        return path
          ? <path {...common} {...shape} d={path} />
          : placeholder(node, width, height, "Размер прямоугольника должен быть положительным.");
      }
      if (node.kind === "ellipse") {
        const centerX = evaluate(node.geometry.centerX);
        const centerY = evaluate(node.geometry.centerY);
        const radiusX = evaluate(node.geometry.radiusX);
        const radiusY = evaluate(node.geometry.radiusY);
        if (centerX === null || centerY === null || radiusX === null || radiusY === null || radiusX <= 0 || radiusY <= 0)
          return placeholder(node, width, height, "Радиусы эллипса не вычисляются или не являются положительными.");
        return <ellipse {...common} {...shape} cx={centerX} cy={centerY} rx={radiusX} ry={radiusY} />;
      }
      if (node.kind === "bezier") {
        const points = evaluatePoints(node.geometry.points, evaluate);
        const path = points && bezierPath(points, node.geometry.closed);
        return path
          ? <path {...common} {...shape} d={path} />
          : placeholder(node, width, height, "Контрольные точки кривой не вычисляются из параметров.");
      }
      if (node.kind === "closedContour") {
        const points = evaluatePoints(node.geometry.points, evaluate);
        return points && points.length >= 3
          ? <polygon {...common} {...shape} points={pointsAttribute(points)} />
          : placeholder(node, width, height, "Точки контура не вычисляются из параметров.");
      }
      if (node.kind === "text") {
        const x = evaluate(node.geometry.x);
        const y = evaluate(node.geometry.y);
        const fontSize = evaluate(node.geometry.fontSize);
        if (x === null || y === null || fontSize === null || fontSize <= 0)
          return placeholder(node, width, height, "Положение или размер текста не вычисляется из параметров.");
        return (
          <text
            {...common}
            x={x}
            y={y}
            fill={node.fill.color ?? node.stroke.color}
            stroke="none"
            fontSize={fontSize}
            fontFamily="Segoe UI, sans-serif"
          >
            {node.geometry.text}
          </text>
        );
      }
      if (node.kind === "image") {
        const x = evaluate(node.geometry.x);
        const y = evaluate(node.geometry.y);
        const imageWidth = evaluate(node.geometry.width);
        const imageHeight = evaluate(node.geometry.height);
        if (x === null || y === null || imageWidth === null || imageHeight === null || imageWidth <= 0 || imageHeight <= 0)
          return placeholder(node, width, height, "Рамка изображения не вычисляется или имеет неположительный размер.");
        if (!assetIds.has(node.geometry.assetId)) return placeholder(node, width, height, "Asset изображения отсутствует в шаблоне.");
        if (node.geometry.cropWidth <= 0 || node.geometry.cropHeight <= 0)
          return placeholder(node, width, height, "Область обрезки изображения имеет нулевой размер.");
        let href: string;
        try { href = resolveAssetUrl(node.geometry.assetId); }
        catch { return placeholder(node, width, height, "URL изображения не удалось получить."); }
        if (!href) return placeholder(node, width, height, "URL изображения пуст.");
        const crop = `${formatNumber(node.geometry.cropX)} ${formatNumber(node.geometry.cropY)} ${formatNumber(node.geometry.cropWidth)} ${formatNumber(node.geometry.cropHeight)}`;
        return (
          <g {...common} data-underlay={node.geometry.underlay ? "true" : "false"}>
            <svg
              data-template-image-frame={node.id}
              x={x}
              y={y}
              width={imageWidth}
              height={imageHeight}
              viewBox={crop}
              preserveAspectRatio="none"
              overflow="hidden"
            >
              <image href={href} x="0" y="0" width="1" height="1" preserveAspectRatio="none" />
            </svg>
          </g>
        );
      }

      if (ancestors.has(node.id)) return placeholder(node, width, height, "Обнаружен цикл групп.");
      const nextAncestors = new Set(ancestors);
      nextAncestors.add(node.id);
      const childIds = new Set(node.geometry.childIds);
      const missingChild = node.geometry.childIds.some(childId => !nodesById.has(childId));
      if (missingChild) return placeholder(node, width, height, "Группа ссылается на отсутствующий узел.");
      return (
        <g {...common} data-template-group="true">
          {layer.nodes.map(child => childIds.has(child.id) ? renderNode(child, locked, nextAncestors, rootNodeId, false, rootMovable) : null)}
        </g>
      );
    }

    function renderRepeatedGroup(groupId: string): ReactNode {
      const group = nodesById.get(groupId);
      const occurrences = repeatPreview.get(groupId);
      if (!group || group.kind !== "group" || !occurrences) return null;
      return occurrences.map(occurrence => (
        <g
          key={occurrence.group.key}
          data-template-repeat-domain={occurrence.repeatDomainId}
          data-template-repeat-index={occurrence.index}
          data-template-occurrence-key={occurrence.group.key}
          transform={`translate(${formatNumber(occurrence.offset.x)} ${formatNumber(occurrence.offset.y)})`}
        >
          {renderNode(group, false, new Set(), group.id, false, false)}
        </g>
      ));
    }

    return (
      <g key={layer.id} data-template-layer-id={layer.id} data-locked={layer.locked ? "true" : undefined}>
        {layer.nodes.map(node => ownedIds.has(node.id) ? null : repeatedGroupIds.has(node.id) && repeatPreview.has(node.id) ? renderRepeatedGroup(node.id) : renderNode(node))}
      </g>
    );
  }

  function renderPoint(
    point: TemplateViewV2["contactPoints"][number],
    kind: "contact",
  ): ReactNode;
  function renderPoint(
    point: TemplateViewV2["bundlePorts"][number],
    kind: "bundle",
  ): ReactNode;
  function renderPoint(
    point: TemplateViewV2["contactPoints"][number] | TemplateViewV2["bundlePorts"][number],
    kind: "contact" | "bundle",
  ): ReactNode {
    const x = evaluate(point.x);
    const y = evaluate(point.y);
    if (x === null || y === null) {
      const [placeholderX, placeholderY] = stablePlaceholderPosition(point.id, width, height);
      return (
        <g key={point.id} data-template-point-id={point.id} data-render="placeholder" pointerEvents="none" transform={`translate(${placeholderX} ${placeholderY})`}>
          <circle r="7" fill="#fff7e6" stroke="#a86519" strokeDasharray="3 2" />
          <title>Положение точки не вычисляется из параметров.</title>
        </g>
      );
    }
    const logical = kind === "contact" && "logicalContactId" in point
      ? logicalContacts.get(point.logicalContactId)
      : undefined;
    const name = kind === "bundle" && "name" in point ? point.name : logical?.name ?? "Контакт";
    const number = logical?.number ?? "";
    const label = kind === "contact"
      ? `Контакт ${number || "без номера"}: ${name}; направление ${point.direction}`
      : `Общий выход пучка: ${name}; направление ${point.direction}`;
    const stem = point.direction === "left" ? "M -13 0 H -5"
      : point.direction === "right" ? "M 5 0 H 13"
        : point.direction === "up" ? "M 0 -13 V -5" : "M 0 5 V 13";
    return (
      <g
        key={point.id}
        data-template-point-id={point.id}
        data-template-point-kind={kind}
        data-selected={selectedId === point.id ? "true" : undefined}
        transform={`translate(${formatNumber(x)} ${formatNumber(y)})`}
        onPointerDown={event => select(event, point.id)}
        onKeyDown={event => selectFromKeyboard(event, point.id)}
        role="button"
        tabIndex={0}
        aria-label={label}
      >
        {kind === "contact"
          ? <circle r="5" fill="#fff" stroke="#c54848" strokeWidth="2" />
          : <path d="M 0 -8 L 8 0 L 0 8 L -8 0 Z" fill="#edf7fb" stroke="#36708e" strokeWidth="2" />}
        <path d={stem} fill="none" stroke={kind === "contact" ? "#c54848" : "#36708e"} strokeWidth="2" />
        {number && <text x="12" y="-9" fill="#8f3434" fontSize="13" fontWeight="700">{number}</text>}
        <title>{label}</title>
      </g>
    );
  }

  function renderRepeatedPoints(): ReactNode {
    return [...repeatPreview.values()].flatMap(occurrences => occurrences.flatMap(occurrence => occurrence.contactPoints.map(point => (
      <g
        key={`${viewId}:${point.key}`}
        data-template-point-id={point.prototypeContactPointId}
        data-template-point-kind="contact"
        data-template-occurrence-key={point.key}
        data-template-repeat-index={occurrence.index}
        transform={`translate(${formatNumber(point.x)} ${formatNumber(point.y)})`}
        onPointerDown={event => select(event, point.prototypeContactPointId)}
        onKeyDown={event => selectFromKeyboard(event, point.prototypeContactPointId)}
        role="button"
        tabIndex={0}
        aria-label={`Контакт ${point.number}: ${point.name}; направление ${point.direction}; повтор ${occurrence.index + 1}`}
      >
        <circle r="5" fill="#fff" stroke="#c54848" strokeWidth="2" />
        <path d={point.direction === "left" ? "M -13 0 H -5" : point.direction === "right" ? "M 5 0 H 13" : point.direction === "up" ? "M 0 -13 V -5" : "M 0 5 V 13"} fill="none" stroke="#c54848" strokeWidth="2" />
        <text x="12" y="-9" fill="#8f3434" fontSize="13" fontWeight="700">{point.number}</text>
        <title>{`${point.name} · ${point.direction}`}</title>
      </g>
    ))));
  }

  return (
    <svg
      className="template-canvas-v2"
      viewBox={`0 0 ${formatNumber(width)} ${formatNumber(height)}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={view ? `Редактор вида ${view.name}` : "Вид шаблона не найден"}
      data-template-view-id={view?.id}
      width="100%"
      height="100%"
      style={{ display: "block", touchAction: "none" }}
      onPointerDown={() => onSelect(null)}
      onPointerMove={moveNodeGesture}
      onPointerUp={endNodeGesture}
      onPointerCancel={clearNodeGesture}
    >
      <rect width={width} height={height} fill="#fff" />
      {view ? view.layers.map(renderLayer) : <text x="24" y="36" fill="#7b4c16" fontSize="14">Вид шаблона не найден</text>}
      {view?.contactPoints.map(point => repeatedPointIds.has(point.id) ? null : renderPoint(point, "contact"))}
      {view && renderRepeatedPoints()}
      {view?.bundlePorts.map(point => renderPoint(point, "bundle"))}
      {repeatPreviewError && <g data-template-repeat-error="true" pointerEvents="none">
        <rect x="16" y="16" width={Math.min(width - 32, 520)} height="42" rx="6" fill="#fff7e6" stroke="#a86519" />
        <text x="28" y="34" fill="#7b4c16" fontSize="11" fontWeight="700">Повторы показаны как прототипы</text>
        <text x="28" y="49" fill="#7b4c16" fontSize="9">{repeatPreviewError}</text>
      </g>}
    </svg>
  );
}
