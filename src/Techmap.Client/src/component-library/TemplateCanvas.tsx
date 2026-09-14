import { useRef, type PointerEvent as ReactPointerEvent } from "react";
import { TEMPLATE_HEIGHT, TEMPLATE_WIDTH, moveItem, type TemplateContent, type TemplateView } from "./template-model";

interface Props {
  view: TemplateView;
  content: TemplateContent;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onPreviewChange: (content: TemplateContent) => void;
  onDragCommit: (before: TemplateContent, after: TemplateContent) => void;
}

interface DragState {
  id: string;
  pointerId: number;
  dx: number;
  dy: number;
  before: TemplateContent;
  latest: TemplateContent;
}

interface SvgMatrixLike { readonly a: number; readonly b: number; readonly c: number; readonly d: number; readonly e: number; readonly f: number; }

export function clientToSvgCoordinates(
  svg: Pick<SVGSVGElement, "getScreenCTM">,
  clientX: number,
  clientY: number,
): { x: number; y: number } | null {
  const matrix = svg.getScreenCTM() as SvgMatrixLike | null;
  if (!matrix) return null;
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < Number.EPSILON) return null;
  const x = clientX - matrix.e;
  const y = clientY - matrix.f;
  return {
    x: (matrix.d * x - matrix.c * y) / determinant,
    y: (-matrix.b * x + matrix.a * y) / determinant,
  };
}

export function TemplateCanvas({ view, content, selectedId, onSelect, onPreviewChange, onDragCommit }: Props) {
  const dragRef = useRef<DragState | null>(null);
  function start(event: ReactPointerEvent<SVGElement>, id: string, x: number, y: number) {
    event.stopPropagation();
    onSelect(id);
    const svg = event.currentTarget.ownerSVGElement;
    if (!svg) return;
    const cursor = clientToSvgCoordinates(svg, event.clientX, event.clientY);
    if (!cursor) return;
    svg.setPointerCapture(event.pointerId);
    dragRef.current = { id, pointerId: event.pointerId, dx: cursor.x - x, dy: cursor.y - y, before: content, latest: content };
  }
  function moving(event: ReactPointerEvent<SVGSVGElement>) {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const cursor = clientToSvgCoordinates(event.currentTarget, event.clientX, event.clientY);
    if (!cursor) return;
    const latest = moveItem(drag.before, view.id, drag.id, Math.round(cursor.x - drag.dx), Math.round(cursor.y - drag.dy));
    dragRef.current = { ...drag, latest };
    onPreviewChange(latest);
  }
  function end(event: ReactPointerEvent<SVGSVGElement>) {
    const drag = dragRef.current;
    if (drag?.pointerId !== event.pointerId) return;
    onDragCommit(drag.before, drag.latest);
    dragRef.current = null;
  }
  return (
    <svg className="template-canvas" viewBox={`0 0 ${TEMPLATE_WIDTH} ${TEMPLATE_HEIGHT}`} role="img" aria-label={`Редактор вида ${view.name}`}
      onPointerDown={() => onSelect(null)} onPointerMove={moving} onPointerUp={end} onPointerCancel={end}>
      <defs><pattern id="template-grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M 20 0 L 0 0 0 20" fill="none" stroke="#dce6ec" strokeWidth="1" /></pattern></defs>
      <rect width={TEMPLATE_WIDTH} height={TEMPLATE_HEIGHT} fill="url(#template-grid)" />
      {view.primitives.map(item => {
        const selected = selectedId === item.id;
        if (item.kind === "line") return <line key={item.id} x1={item.x} y1={item.y} x2={item.x + item.width} y2={item.y + item.height} stroke={item.color} strokeWidth={selected ? 4 : 2} onPointerDown={e => start(e, item.id, item.x, item.y)} />;
        if (item.kind === "rectangle") return <rect key={item.id} x={item.x} y={item.y} width={Math.max(1, item.width)} height={Math.max(1, item.height)} fill="white" stroke={item.color} strokeWidth={selected ? 4 : 2} onPointerDown={e => start(e, item.id, item.x, item.y)} />;
        if (item.kind === "ellipse") return <ellipse key={item.id} cx={item.x + item.width / 2} cy={item.y + item.height / 2} rx={Math.max(1, Math.abs(item.width) / 2)} ry={Math.max(1, Math.abs(item.height) / 2)} fill="white" stroke={item.color} strokeWidth={selected ? 4 : 2} onPointerDown={e => start(e, item.id, item.x, item.y)} />;
        return <text key={item.id} x={item.x} y={item.y + 18} fill={item.color} fontSize="18" fontFamily="Segoe UI, sans-serif" fontWeight={selected ? 700 : 400} onPointerDown={e => start(e, item.id, item.x, item.y)}>{item.text || "Текст"}</text>;
      })}
      {view.contactPoints.map(point => <g key={point.id} transform={`translate(${point.x} ${point.y})`} className={selectedId === point.id ? "template-contact selected" : "template-contact"} onPointerDown={e => start(e, point.id, point.x, point.y)}>
        <circle r="7" /><path d="M -11 0 H 11 M 0 -11 V 11" /><text x="12" y="-9">{point.contactNumber}</text><title>{point.name} · {point.direction}</title>
      </g>)}
    </svg>
  );
}
